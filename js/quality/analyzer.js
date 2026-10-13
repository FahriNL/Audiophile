/**
 * analyzer.js - Orchestrates audio spectrum, ITU-R BS.1770 LUFS, True Peak,
 * and Dynamic Range analysis via Web Worker with prioritized queue and persistent caching.
 */

import { db } from '../db/db.js';
import { store } from '../core/store.js';
import { events } from '../core/events.js';
import { settings } from '../core/settings.js';
import { folderManager } from '../library/folders.js';

class AudioAnalyzer {
  constructor() {
    this.worker = null;
    this.pendingCallbacks = new Map();
    this.isBatchRunning = false;
    this.isBatchPaused = false;
    this.shouldCancelBatch = false;
    this.highPriorityTasks = [];
    this.isWorkerBusy = false;
    this.initWorker();
  }

  initWorker() {
    try {
      this.worker = new Worker(new URL('../workers/analyze.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const { trackId, success, analysis, error } = e.data;
        this.isWorkerBusy = false;
        if (this.pendingCallbacks.has(trackId)) {
          const { resolve } = this.pendingCallbacks.get(trackId);
          this.pendingCallbacks.delete(trackId);
          if (success) {
            resolve(analysis);
          } else {
            console.warn(`Analysis failed for track ${trackId}:`, error);
            resolve(null);
          }
        }
      };
      this.worker.onerror = (err) => {
        this.isWorkerBusy = false;
        console.error('Analysis worker error:', err);
      };
    } catch (err) {
      console.warn('Could not initialize module worker, trying fallback:', err);
      try {
        this.worker = new Worker('./js/workers/analyze.worker.js', { type: 'module' });
      } catch (e) {
        console.error('Fatal: Cannot load analyze worker:', e);
      }
    }
  }

  /**
   * Generates a stable fingerprint for cache invalidation
   */
  getTrackFingerprint(track, file) {
    if (!file) return track.id;
    return `${track.id}_${file.size}_${file.lastModified || 0}`;
  }

  /**
   * Prioritize analysis for actively playing or upcoming queue track
   * @param {Object} track 
   * @param {File} [file]
   * @returns {Promise<Object|null>}
   */
  async prioritizeTrack(track, file = null) {
    if (!track) return null;

    try {
      if (!file) {
        file = await folderManager.getFileForTrack(track);
      }
      if (!file) return null;

      const fingerprint = this.getTrackFingerprint(track, file);

      // Check IndexedDB cache first
      const cached = await db.get('analysis', track.id);
      if (cached && cached.fingerprint === fingerprint && cached.lufs !== undefined) {
        track.analysis = cached;
        return cached;
      }

      // Execute with high priority
      return await this.analyzeTrack(track, file, true);
    } catch (err) {
      console.warn(`Prioritize track error for ${track.name}:`, err);
      return null;
    }
  }

  /**
   * Analyze a single track with single-decode audio buffer reuse
   * @param {Object} track 
   * @param {File} file 
   * @param {boolean} [isHighPriority=false]
   * @returns {Promise<Object|null>}
   */
  async analyzeTrack(track, file, isHighPriority = false) {
    if (!file) return null;

    try {
      const fingerprint = this.getTrackFingerprint(track, file);

      // 1. Check cache in IndexedDB
      const cached = await db.get('analysis', track.id);
      if (cached && cached.fingerprint === fingerprint && cached.lufs !== undefined) {
        track.analysis = cached;
        return cached;
      }

      // 2. Single Decode Buffer
      // Decode full file for songs up to 55MB, or representative 45MB slice for gigantic Hi-Res files
      const maxDecodeBytes = 55 * 1024 * 1024;
      const sliceSize = Math.min(file.size, maxDecodeBytes);
      const arrayBuffer = await file.slice(0, sliceSize).arrayBuffer();

      const AudioContextClass = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!AudioContextClass) {
        return {
          status: 'unsupported_rate',
          confidence: 0,
          notes: 'Browser tidak mendukung Web Audio API'
        };
      }

      const tempCtx = new AudioContextClass();
      const audioBuffer = await new Promise((resolve, reject) => {
        tempCtx.decodeAudioData(arrayBuffer, resolve, reject);
      });

      try {
        if (tempCtx.state !== 'closed') tempCtx.close();
      } catch {}

      const channelData = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        channelData.push(audioBuffer.getChannelData(c));
      }

      const targetLufs = settings.get('replayGainTarget', -18);

      // 3. Send to worker for simultaneous FFT spectrum & BS.1770 LUFS/TP/DR calculation
      this.isWorkerBusy = true;
      const analysis = await new Promise((resolve) => {
        this.pendingCallbacks.set(track.id, { resolve });
        this.worker.postMessage({
          trackId: track.id,
          channelData,
          sampleRate: audioBuffer.sampleRate,
          tier: track.tier,
          targetLufs
        });
      });

      if (analysis) {
        // Save to IndexedDB with fingerprint
        const record = {
          trackId: track.id,
          fingerprint,
          ...analysis
        };
        await db.put('analysis', record);

        // Update in-memory track
        track.analysis = analysis;
        const tracks = store.get('tracks') || [];
        const found = tracks.find(t => t.id === track.id);
        if (found) {
          found.analysis = analysis;
          store.set('tracks', [...tracks]);
        }

        events.emit('track:analyzed', { trackId: track.id, analysis });
      }

      return analysis;
    } catch (err) {
      this.isWorkerBusy = false;
      console.warn(`Analysis error for ${track.name}:`, err);
      return null;
    }
  }

  /**
   * Run background batch analysis across unanalyzed tracks
   * Supports pausing, resuming, and priority queue interruption.
   * @param {Array<Object>} tracks 
   * @param {Function} getFileFn (track) => Promise<File>
   */
  async runBatchAnalysis(tracks, getFileFn) {
    if (this.isBatchRunning) {
      if (this.isBatchPaused) {
        this.resumeBatch();
      } else {
        this.pauseBatch();
      }
      return;
    }

    const unanalyzed = tracks.filter(t => !t.analysis || t.analysis.lufs === undefined);
    if (unanalyzed.length === 0) return;

    this.isBatchRunning = true;
    this.isBatchPaused = false;
    this.shouldCancelBatch = false;

    store.set('analysisProgress', {
      running: true,
      paused: false,
      processed: 0,
      total: unanalyzed.length,
      currentTrackTitle: ''
    });

    let count = 0;
    for (const track of unanalyzed) {
      if (this.shouldCancelBatch) break;

      // Handle pause state
      while (this.isBatchPaused && !this.shouldCancelBatch) {
        await new Promise(r => setTimeout(r, 200));
      }

      if (this.shouldCancelBatch) break;

      const title = track.overrides?.title || track.metadata?.title || track.name;
      store.set('analysisProgress', {
        running: true,
        paused: false,
        processed: count,
        total: unanalyzed.length,
        currentTrackTitle: title
      });

      try {
        const file = await getFileFn(track);
        if (file) {
          await this.analyzeTrack(track, file, false);
        }
      } catch (e) {
        console.warn(`Batch item analysis error:`, e);
      }

      count++;

      // Non-blocking yield to allow audio playback and 60fps UI rendering to remain silky smooth
      await new Promise(r => setTimeout(r, 90));
    }

    this.isBatchRunning = false;
    this.isBatchPaused = false;
    store.set('analysisProgress', {
      running: false,
      paused: false,
      processed: count,
      total: unanalyzed.length,
      currentTrackTitle: ''
    });

    events.emit('analysis:batchComplete', { processed: count });
  }

  pauseBatch() {
    if (this.isBatchRunning && !this.isBatchPaused) {
      this.isBatchPaused = true;
      const prog = store.get('analysisProgress') || {};
      store.set('analysisProgress', { ...prog, paused: true });
      events.emit('analysis:batchPaused');
    }
  }

  resumeBatch() {
    if (this.isBatchRunning && this.isBatchPaused) {
      this.isBatchPaused = false;
      const prog = store.get('analysisProgress') || {};
      store.set('analysisProgress', { ...prog, paused: false });
      events.emit('analysis:batchResumed');
    }
  }

  cancelBatch() {
    this.shouldCancelBatch = true;
    this.isBatchRunning = false;
    this.isBatchPaused = false;
    store.set('analysisProgress', { running: false, paused: false, processed: 0, total: 0, currentTrackTitle: '' });
    events.emit('analysis:batchCancelled');
  }
}

export const analyzer = new AudioAnalyzer();
