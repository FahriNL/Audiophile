/**
 * abPlayer.js - Dual-source synchronous audio player engine with ~30ms micro-fade,
 * drift correction (<20ms), ITU-R BS.1770 LUFS loudness matching, dual FFT analyzers,
 * and 10-trial ABX blind test statistical calculation (AUD-03).
 */

import { folderManager } from '../library/folders.js';
import { analyzer } from '../quality/analyzer.js';
import { events } from '../core/events.js';

/**
 * Calculate binomial coefficient nCr
 * @param {number} n 
 * @param {number} k 
 * @returns {number}
 */
export function combination(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let c = 1;
  for (let i = 1; i <= k; i++) {
    c = (c * (n - (k - i))) / i;
  }
  return c;
}

/**
 * Calculate one-tailed binomial p-value under null hypothesis p = 0.5
 * Probability of achieving k or more correct guesses out of n trials purely by random chance.
 * @param {number} k Correct trials
 * @param {number} n Total trials (default 10)
 * @returns {number} p-value rounded to 4 decimals
 */
export function calculateBinomialPValue(k, n = 10) {
  if (k <= 0) return 1.0;
  if (k > n) return 0.0;
  let sum = 0;
  for (let i = k; i <= n; i++) {
    sum += combination(n, i);
  }
  const pVal = sum * Math.pow(0.5, n);
  return Math.round(pVal * 10000) / 10000;
}

/**
 * Compute loudness matching gains from integrated LUFS values.
 * Attenuates the louder version so both versions match loudness with delta <= 0.1 dB without clipping.
 * @param {number|undefined} lufsA 
 * @param {number|undefined} lufsB 
 * @returns {{ gainDbA: number, gainDbB: number, deltaDb: number, matched: boolean }}
 */
export function calculateLoudnessMatchingGains(lufsA, lufsB) {
  if (typeof lufsA !== 'number' || typeof lufsB !== 'number' || isNaN(lufsA) || isNaN(lufsB)) {
    return { gainDbA: 0, gainDbB: 0, deltaDb: 0, matched: false };
  }

  const delta = lufsA - lufsB; // Positive if track A is louder than track B
  let gainDbA = 0;
  let gainDbB = 0;

  if (delta > 0) {
    // Track A is louder than Track B -> attenuate Track A
    gainDbA = -delta;
    gainDbB = 0;
  } else {
    // Track B is louder than Track A -> attenuate Track B
    gainDbA = 0;
    gainDbB = delta; // negative value
  }

  return {
    gainDbA: Math.round(gainDbA * 10) / 10,
    gainDbB: Math.round(gainDbB * 10) / 10,
    deltaDb: Math.round(Math.abs(delta) * 10) / 10,
    matched: true
  };
}

export class ABPlayer {
  constructor() {
    this.trackA = null;
    this.trackB = null;
    this.fileA = null;
    this.fileB = null;
    this.urlA = null;
    this.urlB = null;

    this.audioA = null;
    this.audioB = null;
    this.audioCtx = null;
    this.sourceA = null;
    this.sourceB = null;
    this.loudnessGainA = null;
    this.loudnessGainB = null;
    this.fadeGainA = null;
    this.fadeGainB = null;
    this.analyserA = null;
    this.analyserB = null;
    this.masterGain = null;

    this.activeChannel = 'A'; // 'A' | 'B'
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;

    // Loop controller
    this.loopEnabled = true;
    this.loopDuration = 15; // 10, 15, 20, 30 seconds
    this.loopStart = 0;

    // Loudness matching metadata
    this.loudnessGains = { gainDbA: 0, gainDbB: 0, deltaDb: 0, matched: false };

    // Drift correction monitor
    this.syncInterval = null;

    // ABX Blind Test State
    this.isAbxMode = false;
    this.abxTrial = 1;
    this.abxTotalTrials = 10;
    this.abxTarget = 'A'; // Secret assignment for 'X' in current trial ('A' or 'B')
    this.abxActiveSelection = 'A'; // 'A' | 'B' | 'X'
    this.abxTrialsHistory = [];
    this.abxIsComplete = false;
  }

  /**
   * Load two track versions and initialize Web Audio graph
   * @param {Object} trackA 
   * @param {Object} trackB 
   */
  async load(trackA, trackB) {
    this.cleanup();

    this.trackA = trackA;
    this.trackB = trackB;

    this.fileA = await folderManager.getFileForTrack(trackA);
    this.fileB = await folderManager.getFileForTrack(trackB);

    if (!this.fileA || !this.fileB) {
      throw new Error('Salah satu berkas versi tidak ditemukan dalam folder lokal.');
    }

    this.urlA = URL.createObjectURL(this.fileA);
    this.urlB = URL.createObjectURL(this.fileB);

    this.audioA = document.createElement('audio');
    this.audioB = document.createElement('audio');
    this.audioA.preload = 'auto';
    this.audioB.preload = 'auto';
    this.audioA.src = this.urlA;
    this.audioB.src = this.urlB;

    // Initialize Web Audio API nodes
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextClass();

    this.sourceA = this.audioCtx.createMediaElementSource(this.audioA);
    this.sourceB = this.audioCtx.createMediaElementSource(this.audioB);

    this.loudnessGainA = this.audioCtx.createGain();
    this.loudnessGainB = this.audioCtx.createGain();

    this.fadeGainA = this.audioCtx.createGain();
    this.fadeGainB = this.audioCtx.createGain();

    this.analyserA = this.audioCtx.createAnalyser();
    this.analyserB = this.audioCtx.createAnalyser();
    this.analyserA.fftSize = 256;
    this.analyserB.fftSize = 256;

    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.value = 1.0;

    // Initial switch: start at Channel A with zero micro-fade lag
    this.fadeGainA.gain.value = 1.0;
    this.fadeGainB.gain.value = 0.0;
    this.activeChannel = 'A';

    // Graph routing:
    // sourceA -> loudnessGainA -> analyserA -> fadeGainA -> masterGain -> destination
    // sourceB -> loudnessGainB -> analyserB -> fadeGainB -> masterGain -> destination
    this.sourceA.connect(this.loudnessGainA);
    this.loudnessGainA.connect(this.analyserA);
    this.analyserA.connect(this.fadeGainA);
    this.fadeGainA.connect(this.masterGain);

    this.sourceB.connect(this.loudnessGainB);
    this.loudnessGainB.connect(this.analyserB);
    this.analyserB.connect(this.fadeGainB);
    this.fadeGainB.connect(this.masterGain);

    this.masterGain.connect(this.audioCtx.destination);

    // Apply loudness matching from AUD-02 data
    this.applyLoudnessMatching();

    // Event listeners
    this.setupAudioListeners();

    // Reset ABX state
    this.initAbxState();
  }

  setupAudioListeners() {
    this.audioA.addEventListener('timeupdate', () => {
      this.currentTime = this.audioA.currentTime;
      this.duration = Math.max(this.audioA.duration || 0, this.audioB.duration || 0);

      // Loop controller enforcement
      if (this.loopEnabled && this.loopDuration > 0) {
        if (this.audioA.currentTime >= this.loopStart + this.loopDuration) {
          this.seek(this.loopStart);
        }
      }

      events.emit('ab:timeupdate', {
        currentTime: this.currentTime,
        duration: this.duration,
        loopStart: this.loopStart,
        loopDuration: this.loopDuration
      });
    });

    this.audioA.addEventListener('ended', () => {
      if (!this.loopEnabled) {
        this.pause();
        events.emit('ab:ended');
      }
    });

    // Start drift monitor interval
    this.syncInterval = setInterval(() => {
      if (this.isPlaying && this.audioA && this.audioB) {
        const drift = this.audioA.currentTime - this.audioB.currentTime;
        // Koreksi selisih posisi jika melebihi 20 ms
        if (Math.abs(drift) > 0.020) {
          this.audioB.currentTime = this.audioA.currentTime;
        }
      }
    }, 100);
  }

  /**
   * Calculate and apply AUD-02 integrated LUFS loudness matching
   */
  applyLoudnessMatching() {
    const lufsA = this.trackA?.analysis?.lufs;
    const lufsB = this.trackB?.analysis?.lufs;

    this.loudnessGains = calculateLoudnessMatchingGains(lufsA, lufsB);

    if (this.loudnessGainA && this.loudnessGainB && this.audioCtx) {
      const linA = Math.pow(10, this.loudnessGains.gainDbA / 20);
      const linB = Math.pow(10, this.loudnessGains.gainDbB / 20);
      this.loudnessGainA.gain.setValueAtTime(linA, this.audioCtx.currentTime);
      this.loudnessGainB.gain.setValueAtTime(linB, this.audioCtx.currentTime);
    }

    // If either track lacks LUFS, trigger priority analysis in the background
    if (lufsA === undefined && this.trackA && this.fileA) {
      analyzer.prioritizeTrack(this.trackA, this.fileA).then((res) => {
        if (res) {
          this.trackA.analysis = res;
          this.applyLoudnessMatching();
          events.emit('ab:loudnessUpdated', this.loudnessGains);
        }
      }).catch(() => {});
    }
    if (lufsB === undefined && this.trackB && this.fileB) {
      analyzer.prioritizeTrack(this.trackB, this.fileB).then((res) => {
        if (res) {
          this.trackB.analysis = res;
          this.applyLoudnessMatching();
          events.emit('ab:loudnessUpdated', this.loudnessGains);
        }
      }).catch(() => {});
    }
  }

  /**
   * Switch active playback channel with instant ~30ms micro-fade (no clicks/pops)
   * @param {'A'|'B'} targetChannel 
   */
  switchTo(targetChannel) {
    if (!this.audioCtx || !this.fadeGainA || !this.fadeGainB) return;

    const now = this.audioCtx.currentTime;
    const timeConstant = 0.010; // 3 x 10ms ≈ 30ms smooth exponential fade

    this.fadeGainA.gain.cancelScheduledValues(now);
    this.fadeGainB.gain.cancelScheduledValues(now);

    if (targetChannel === 'A') {
      this.fadeGainA.gain.setTargetAtTime(1.0, now, timeConstant);
      this.fadeGainB.gain.setTargetAtTime(0.0, now, timeConstant);
      this.activeChannel = 'A';
    } else {
      this.fadeGainA.gain.setTargetAtTime(0.0, now, timeConstant);
      this.fadeGainB.gain.setTargetAtTime(1.0, now, timeConstant);
      this.activeChannel = 'B';
    }

    events.emit('ab:channelSwitched', { channel: this.activeChannel });
  }

  /**
   * Play both tracks synchronously
   */
  async play() {
    if (!this.audioA || !this.audioB) return;
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    // Align initial playback position exactly
    this.audioB.currentTime = this.audioA.currentTime;

    await Promise.all([this.audioA.play(), this.audioB.play()]);
    this.isPlaying = true;
    events.emit('ab:playStateChanged', { isPlaying: true });
  }

  /**
   * Pause both tracks
   */
  pause() {
    if (this.audioA) this.audioA.pause();
    if (this.audioB) this.audioB.pause();
    this.isPlaying = false;
    events.emit('ab:playStateChanged', { isPlaying: false });
  }

  /**
   * Toggle play/pause
   */
  async togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      await this.play();
    }
  }

  /**
   * Seek both tracks to a specified position in seconds
   * @param {number} timeSeconds 
   */
  seek(timeSeconds) {
    const clamped = Math.max(0, Math.min(timeSeconds, this.duration || 99999));
    if (this.audioA) this.audioA.currentTime = clamped;
    if (this.audioB) this.audioB.currentTime = clamped;
    this.currentTime = clamped;
  }

  /**
   * Set loop section configuration
   * @param {number} durationSeconds (10, 15, 20, 30)
   * @param {number} [startSeconds] 
   */
  setLoop(durationSeconds, startSeconds = null) {
    this.loopDuration = Number(durationSeconds) || 15;
    if (startSeconds !== null) {
      this.loopStart = Math.max(0, Number(startSeconds) || 0);
    }
    events.emit('ab:loopChanged', { loopStart: this.loopStart, loopDuration: this.loopDuration });
  }

  /**
   * Retrieve live FFT frequency spectrum data for both tracks
   * @returns {{ freqA: Uint8Array, freqB: Uint8Array }}
   */
  getLiveSpectrumData() {
    if (!this.analyserA || !this.analyserB) {
      return { freqA: new Uint8Array(0), freqB: new Uint8Array(0) };
    }
    const freqA = new Uint8Array(this.analyserA.frequencyBinCount);
    const freqB = new Uint8Array(this.analyserB.frequencyBinCount);
    this.analyserA.getByteFrequencyData(freqA);
    this.analyserB.getByteFrequencyData(freqB);
    return { freqA, freqB };
  }

  // ==========================================
  // ABX BLIND TEST ENGINE
  // ==========================================

  initAbxState() {
    this.abxTrial = 1;
    this.abxTotalTrials = 10;
    this.abxTrialsHistory = [];
    this.abxIsComplete = false;
    this.randomizeAbxTarget();
    this.abxActiveSelection = 'A';
  }

  randomizeAbxTarget() {
    this.abxTarget = Math.random() < 0.5 ? 'A' : 'B';
  }

  /**
   * Set active listening selection in ABX mode ('A', 'B', or 'X')
   * @param {'A'|'B'|'X'} selection 
   */
  selectAbxSource(selection) {
    this.abxActiveSelection = selection;
    if (selection === 'X') {
      this.switchTo(this.abxTarget);
    } else {
      this.switchTo(selection);
    }
    events.emit('abx:selectionChanged', { selection });
  }

  /**
   * Submit user guess for current ABX trial
   * @param {'A'|'B'} userGuess 
   * @returns {{ trialNum: number, userGuess: string, isCorrect: boolean, isFinished: boolean }}
   */
  submitAbxGuess(userGuess) {
    if (this.abxIsComplete) {
      return { trialNum: this.abxTrial, userGuess, isCorrect: false, isFinished: true };
    }

    const isCorrect = userGuess === this.abxTarget;
    this.abxTrialsHistory.push({
      trialNum: this.abxTrial,
      secretTarget: this.abxTarget,
      userGuess,
      isCorrect
    });

    if (this.abxTrial >= this.abxTotalTrials) {
      this.abxIsComplete = true;
      const score = this.abxTrialsHistory.filter(t => t.isCorrect).length;
      const pValue = calculateBinomialPValue(score, this.abxTotalTrials);

      events.emit('abx:completed', {
        score,
        total: this.abxTotalTrials,
        pValue,
        history: [...this.abxTrialsHistory]
      });

      return { trialNum: this.abxTrial, userGuess, isCorrect, isFinished: true };
    }

    this.abxTrial++;
    this.randomizeAbxTarget();
    // Default back to A for new trial
    this.selectAbxSource('A');

    events.emit('abx:trialAdvanced', { trial: this.abxTrial, total: this.abxTotalTrials });
    return { trialNum: this.abxTrial - 1, userGuess, isCorrect, isFinished: false };
  }

  /**
   * Get final ABX test results summary
   * @returns {{ score: number, total: number, pValue: number, interpretation: string, history: Array<Object> }}
   */
  getAbxSummary() {
    const score = this.abxTrialsHistory.filter(t => t.isCorrect).length;
    const total = this.abxTrialsHistory.length || this.abxTotalTrials;
    const pValue = calculateBinomialPValue(score, total);

    let interpretation = '';
    if (pValue <= 0.05) {
      interpretation = 'Hasil Sangat Signifikan (p ≤ 5%). Telinga Anda terbukti secara statistik dapat membedakan kedua versi ini dengan jelas tanpa faktor kebetulan!';
    } else if (pValue <= 0.10) {
      interpretation = 'Hasil Cukup Signifikan (p ≈ 5.5%). Kemungkinan besar Anda dapat membedakan kedua versi, meski masih ada sedikit batas toleransi kebetulan.';
    } else {
      interpretation = 'Hasil Tidak Signifikan (p > 10%). Hasil ini setara dengan tebakan acak. Perbedaan kualitas antara kedua file ini kemungkinan besar tidak dapat didengar secara konsisten pada sistem suara ini.';
    }

    return {
      score,
      total,
      pValue,
      percentage: Math.round((score / total) * 100),
      interpretation,
      history: [...this.abxTrialsHistory]
    };
  }

  /**
   * Release all audio elements, intervals, and object URLs
   */
  cleanup() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.pause();

    if (this.audioA) {
      this.audioA.removeAttribute('src');
      this.audioA.load();
      this.audioA = null;
    }
    if (this.audioB) {
      this.audioB.removeAttribute('src');
      this.audioB.load();
      this.audioB = null;
    }

    if (this.urlA) {
      URL.revokeObjectURL(this.urlA);
      this.urlA = null;
    }
    if (this.urlB) {
      URL.revokeObjectURL(this.urlB);
      this.urlB = null;
    }

    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch {}
      this.audioCtx = null;
    }

    this.sourceA = null;
    this.sourceB = null;
    this.loudnessGainA = null;
    this.loudnessGainB = null;
    this.fadeGainA = null;
    this.fadeGainB = null;
    this.analyserA = null;
    this.analyserB = null;
    this.masterGain = null;
    this.isPlaying = false;
  }
}

export const abPlayer = new ABPlayer();
