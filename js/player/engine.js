/**
 * engine.js - Dual audio element gapless engine, pure mode pass-through,
 * Web Audio DSP graph, and integrated equal-power crossfade controller.
 */

import { store } from '../core/store.js';
import { events } from '../core/events.js';
import { folderManager } from '../library/folders.js';
import { coverCache } from '../library/covers.js';
import { MetadataParser } from '../library/metadata.js';
import { db } from '../db/db.js';
import { settings } from '../core/settings.js';
import { analyzer } from '../quality/analyzer.js';
import { calculateAutoPreamp } from '../quality/eqMath.js';
import { CrossfadeController, testVolumeWritable } from './crossfade.js';
import { BauerCrossfeedNode } from './crossfeed.js';

class AudioEngine {
  constructor() {
    this.audioA = typeof document !== 'undefined' ? document.createElement('audio') : null;
    this.audioB = typeof document !== 'undefined' ? document.createElement('audio') : null;
    if (this.audioA) {
      this.audioA.preload = 'auto';
      this.audioB.preload = 'auto';
    }

    this.activeAudio = this.audioA;
    this.standbyAudio = this.audioB;

    this.audioCtx = null;
    this.sourceA = null;
    this.sourceB = null;
    this.fadeGainA = null;
    this.fadeGainB = null;
    this.preampGainNode = null;
    this.eqNodes = [];
    this.replayGainNode = null;
    this.crossfeedNode = null;
    this.analyser = null;
    this.masterGainNode = null;
    this.nightCompressorNode = null;
    this.nightGainNode = null;
    this.nightMode = false;
    this.nightIntensity = 'mild';
    this.nightMaxVolume = 0.70;

    this.pureMode = true;
    this.masterVolume = 1;
    this.wakeLock = null;

    // Crossfade Controller instance
    this.crossfade = new CrossfadeController(this);

    if (this.audioA) this.setupListeners(this.audioA);
    if (this.audioB) this.setupListeners(this.audioB);
  }

  setupListeners(el) {
    el.addEventListener('play', () => {
      store.set('isPlaying', true);
      this.requestWakeLock();
      this.crossfade.startScheduler();
    });

    el.addEventListener('pause', () => {
      if (!this.crossfade.isFading) {
        store.set('isPlaying', false);
        this.releaseWakeLock();
      }
    });

    el.addEventListener('timeupdate', () => {
      if (el === this.activeAudio && !this.crossfade.isFading) {
        store.set('currentTime', el.currentTime);
        store.set('duration', el.duration || 0);
      }
    });

    el.addEventListener('ended', () => {
      if (el === this.activeAudio && !this.crossfade.isFading) {
        events.emit('engine:trackEnded');
      }
    });

    el.addEventListener('seeking', () => {
      if (this.crossfade.isFading) {
        this.crossfade.abortFade(true);
      }
    });

    el.addEventListener('error', (e) => {
      console.error('Audio playback error:', e);
      events.emit('engine:error', { error: el.error, message: 'Format tidak didukung oleh browser Anda' });
    });
  }

  initWebAudio() {
    if (this.audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    this.audioCtx = new AudioContextClass();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    this.fadeGainA = this.audioCtx.createGain();
    this.fadeGainB = this.audioCtx.createGain();
    this.fadeGainA.gain.value = this.activeAudio === this.audioA ? 1 : 0;
    this.fadeGainB.gain.value = this.activeAudio === this.audioB ? 1 : 0;

    this.preampGainNode = this.audioCtx.createGain();
    this.preampGainNode.gain.value = 1;

    this.replayGainNode = this.audioCtx.createGain();
    this.nightCompressorNode = this.audioCtx.createDynamicsCompressor();
    this.nightGainNode = this.audioCtx.createGain();
    this.nightGainNode.gain.value = 1;
    this.masterGainNode = this.audioCtx.createGain();
    this.masterGainNode.gain.value = this.masterVolume;

    // 10-Band Equalizer: 31, 63, 125, 250, 500, 1k, 2k, 4k, 8k, 16k
    const freqs = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.eqNodes = freqs.map((f, i) => {
      const filter = this.audioCtx.createBiquadFilter();
      filter.frequency.value = f;
      if (i === 0) filter.type = 'lowshelf';
      else if (i === freqs.length - 1) filter.type = 'highshelf';
      else {
        filter.type = 'peaking';
        filter.Q.value = 1.4;
      }
      filter.gain.value = 0;
      return filter;
    });

    for (let i = 0; i < this.eqNodes.length - 1; i++) {
      this.eqNodes[i].connect(this.eqNodes[i + 1]);
    }

    const firstEq = this.eqNodes[0];
    this.fadeGainA.connect(this.preampGainNode);
    this.fadeGainB.connect(this.preampGainNode);
    this.preampGainNode.connect(firstEq);

    const lastEq = this.eqNodes[this.eqNodes.length - 1];
    lastEq.connect(this.replayGainNode);
    this.crossfeedNode = new BauerCrossfeedNode(this.audioCtx);
    this.replayGainNode.connect(this.crossfeedNode.input);
    this.crossfeedNode.connect(this.analyser);
    this.analyser.connect(this.nightCompressorNode);
    this.nightCompressorNode.connect(this.nightGainNode);
    this.nightGainNode.connect(this.masterGainNode);
    this.masterGainNode.connect(this.audioCtx.destination);

    // Synchronize initial EQ settings (Graphic or Parametric)
    this.applyCurrentEqSettings();
    this.applyNightModeDsp();
    this.applyCrossfeedSettings();
  }

  attachSources() {
    if (!this.audioCtx) return;
    try {
      if (!this.sourceA) {
        this.sourceA = this.audioCtx.createMediaElementSource(this.audioA);
        this.sourceA.connect(this.fadeGainA);
      }
      if (!this.sourceB) {
        this.sourceB = this.audioCtx.createMediaElementSource(this.audioB);
        this.sourceB.connect(this.fadeGainB);
      }
    } catch (err) {
      console.warn('Web Audio attachSources warning:', err);
    }
  }

  setPureMode(enabled) {
    this.pureMode = enabled;
    if (!enabled) {
      this.initWebAudio();
      this.attachSources();
      this.applyCurrentEqSettings();
    }
    const curSettings = store.get('settings') || {};
    store.set('settings', { ...curSettings, pureMode: enabled });
    events.emit('engine:modeChanged', { pureMode: enabled });
    events.emit('engine:dspStateChanged', this.isBitPerfect());
  }

  setPreamp(dbGain) {
    if (this.preampGainNode && this.audioCtx) {
      const linear = Math.pow(10, (Number(dbGain) || 0) / 20);
      this.preampGainNode.gain.setTargetAtTime(linear, this.audioCtx.currentTime, 0.02);
    }
  }

  setEqGain(bandIndex, dbGain) {
    if (this.eqNodes[bandIndex] && this.audioCtx) {
      const isBypassed = settings.get('eqBypass', false);
      const targetGain = isBypassed ? 0 : (Number(dbGain) || 0);
      this.eqNodes[bandIndex].gain.setTargetAtTime(targetGain, this.audioCtx.currentTime, 0.02);
    }
  }

  setParametricBand(bandIndex, bandData) {
    if (!this.eqNodes[bandIndex] || !this.audioCtx || !bandData) return;
    const filter = this.eqNodes[bandIndex];
    const isBypassed = settings.get('eqBypass', false);

    const targetType = bandData.type || 'peaking';
    try {
      if (filter.type !== targetType) {
        filter.type = targetType;
      }
    } catch {}

    const targetGain = (bandData.enabled !== false && !isBypassed) ? (Number(bandData.gain) || 0) : 0;
    const targetFreq = Math.max(20, Math.min(20000, Number(bandData.freq) || 1000));
    const targetQ = Math.max(0.1, Math.min(10.0, Number(bandData.q) || 1.41));

    filter.frequency.setTargetAtTime(targetFreq, this.audioCtx.currentTime, 0.02);
    filter.gain.setTargetAtTime(targetGain, this.audioCtx.currentTime, 0.02);
    filter.Q.setTargetAtTime(targetQ, this.audioCtx.currentTime, 0.02);
  }

  setEqBypass(bypassed) {
    settings.set('eqBypass', !!bypassed);
    this.applyCurrentEqSettings();
  }

  applyCurrentEqSettings() {
    if (!this.audioCtx || this.eqNodes.length === 0) return;
    const mode = settings.get('eqMode', 'graphic');
    const isBypassed = settings.get('eqBypass', false);

    if (mode === 'parametric') {
      const bands = settings.get('parametricBands', []);
      bands.forEach((b, i) => {
        if (i < this.eqNodes.length) {
          this.setParametricBand(i, b);
        }
      });
    } else {
      const freqs = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
      const eqGains = settings.get('eqGains', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      this.eqNodes.forEach((node, i) => {
        try {
          node.type = i === 0 ? 'lowshelf' : (i === 9 ? 'highshelf' : 'peaking');
        } catch {}
        node.frequency.setTargetAtTime(freqs[i], this.audioCtx.currentTime, 0.02);
        node.Q.setTargetAtTime(1.4, this.audioCtx.currentTime, 0.02);
        const gainVal = isBypassed ? 0 : (Number(eqGains[i]) || 0);
        node.gain.setTargetAtTime(gainVal, this.audioCtx.currentTime, 0.02);
      });
    }

    // Preamp with auto-preamp support
    const autoPreamp = settings.get('autoPreamp', true);
    let preampVal = Number(settings.get('preamp', 0)) || 0;
    if (autoPreamp && !isBypassed) {
      if (mode === 'parametric') {
        const bands = settings.get('parametricBands', []);
        preampVal = calculateAutoPreamp(bands);
      } else {
        const eqGains = settings.get('eqGains', []);
        const maxBoost = Math.max(0, ...eqGains.map(Number));
        preampVal = maxBoost > 0 ? -maxBoost : 0;
      }
    } else if (isBypassed) {
      preampVal = 0;
    }
    this.setPreamp(preampVal);
    events.emit('engine:dspStateChanged', this.isBitPerfect());
  }

  setCrossfeed(enabled, options = {}) {
    const curCrossfeed = settings.get('crossfeed', { enabled: false, preset: 'bauer' }) || {};
    const updated = {
      ...curCrossfeed,
      enabled: !!enabled,
      ...(options.preset ? { preset: options.preset } : {}),
      ...(options.cutoff !== undefined ? { cutoff: options.cutoff } : {}),
      ...(options.delayUs !== undefined ? { delayUs: options.delayUs } : {}),
      ...(options.feedDb !== undefined ? { feedDb: options.feedDb } : {})
    };
    settings.set('crossfeed', updated);
    this.applyCrossfeedSettings();
    events.emit('engine:crossfeedChanged', updated);
    events.emit('engine:dspStateChanged', this.isBitPerfect());
  }

  applyCrossfeedSettings() {
    if (!this.crossfeedNode) return;
    const cf = settings.get('crossfeed', { enabled: false, preset: 'bauer' }) || {};
    this.crossfeedNode.configure(cf);
  }

  /**
   * Determine whether current audio path is Bit-Perfect Passthrough
   * @returns {{ isBitPerfect: boolean, status: 'bitperfect'|'dsp', label: string, details: string[] }}
   */
  isBitPerfect() {
    if (this.pureMode) {
      return {
        isBitPerfect: true,
        status: 'bitperfect',
        label: 'Bit-Perfect',
        details: ['Pure Mode Aktif: Direct Pass-Through ke OS/Hardware DAC tanpa pemrosesan DSP Web Audio.']
      };
    }

    const dspActiveReasons = [];

    // Check EQ
    const isEqBypassed = settings.get('eqBypass', false);
    if (!isEqBypassed) {
      const mode = settings.get('eqMode', 'graphic');
      if (mode === 'parametric') {
        const bands = settings.get('parametricBands', []);
        const activeBands = bands.filter(b => b && b.enabled !== false && Math.abs(Number(b.gain) || 0) > 0.05);
        if (activeBands.length > 0) dspActiveReasons.push(`Parametric EQ (${activeBands.length} filter aktif)`);
      } else {
        const eqGains = settings.get('eqGains', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        const activeGains = eqGains.filter(g => Math.abs(Number(g) || 0) > 0.05);
        if (activeGains.length > 0) dspActiveReasons.push('Graphic EQ 10-Band');
      }
    }

    // Check Preamp
    const preampVal = Number(settings.get('preamp', 0)) || 0;
    if (Math.abs(preampVal) > 0.05) {
      dspActiveReasons.push(`Preamp (${preampVal > 0 ? '+' : ''}${preampVal.toFixed(1)} dB)`);
    }

    // Check ReplayGain
    const rgEnabled = settings.get('replayGain', true);
    const curTrack = store.get('currentTrack');
    if (rgEnabled && curTrack?.appliedReplayGainDb && Math.abs(curTrack.appliedReplayGainDb) > 0.05) {
      dspActiveReasons.push(`ReplayGain (${curTrack.appliedReplayGainDb > 0 ? '+' : ''}${curTrack.appliedReplayGainDb} dB)`);
    }

    // Check Crossfeed
    const cf = settings.get('crossfeed', { enabled: false });
    if (cf && cf.enabled) {
      dspActiveReasons.push(`Crossfeed Headphone (${cf.preset || 'Bauer'})`);
    }

    // Check Night Mode
    if (this.nightMode) {
      dspActiveReasons.push('Mode Malam (Kompresor Dinamika)');
    }

    const isBitPerfect = dspActiveReasons.length === 0;
    return {
      isBitPerfect,
      status: isBitPerfect ? 'bitperfect' : 'dsp',
      label: isBitPerfect ? 'Bit-Perfect' : 'DSP Active',
      details: isBitPerfect
        ? ['Enhanced Mode Unity Gain: Seluruh filter DSP netral (0 dB/Bypass).']
        : dspActiveReasons
    };
  }

  /**
   * Play a track with support for gapless switch, equal-power crossfade, or instant start.
   * @param {Object} track
   * @param {boolean} [autoStart=true]
   * @param {boolean} [isGaplessSwitch=false]
   * @param {number} [crossfadeDuration=0]
   */
  async play(track, autoStart = true, isGaplessSwitch = false, crossfadeDuration = 0) {
    const file = await folderManager.getFileForTrack(track);
    if (!file) {
      throw new Error('Berkas tidak ditemukan. Silakan hubungkan kembali folder.');
    }

    const objectUrl = URL.createObjectURL(file);

    // 1. Equal-power Crossfade Branch
    if (crossfadeDuration > 0 && this.activeAudio && !this.activeAudio.paused) {
      const outgoing = this.activeAudio;
      const incoming = this.standbyAudio;

      // Assign src if not preloaded
      if (!incoming.src) {
        incoming.src = objectUrl;
        incoming.load();
      }

      // Check readiness (readyState >= 3 = HAVE_FUTURE_DATA)
      // If standby is not ready yet, wait briefly or fallback to gapless
      if (incoming.readyState < 3) {
        await new Promise((resolve) => {
          let timer = null;
          const onCanPlay = () => {
            clearTimeout(timer);
            incoming.removeEventListener('canplay', onCanPlay);
            resolve();
          };
          timer = setTimeout(() => {
            incoming.removeEventListener('canplay', onCanPlay);
            resolve();
          }, 350);
          incoming.addEventListener('canplay', onCanPlay);
        });
      }

      // If still not ready, fallback gracefully to gapless switch
      if (incoming.readyState < 2) {
        console.warn('Standby audio not ready for crossfade, falling back to seamless switch');
        incoming.src = objectUrl;
        this.activeAudio = incoming;
        this.standbyAudio = outgoing;
        outgoing.pause();
        outgoing.removeAttribute('src');
        if (autoStart) await incoming.play();
        this.onTrackPlaybackStarted(track, file);
        return;
      }

      const outGainNode = outgoing === this.audioA ? this.fadeGainA : this.fadeGainB;
      const inGainNode = incoming === this.audioA ? this.fadeGainA : this.fadeGainB;

      const fadeStarted = await this.crossfade.executeFade({
        outgoingAudio: outgoing,
        incomingAudio: incoming,
        durationSec: crossfadeDuration,
        outgoingGainNode: outGainNode,
        incomingGainNode: inGainNode,
        onMidpoint: () => {
          // Exactly at 50% blend, switch metadata, lyrics, and Media Session to incoming track
          store.set('currentTime', incoming.currentTime || 0);
          this.onTrackPlaybackStarted(track, file);
        },
        onComplete: () => {
          // Swap active and standby pointers cleanly
          this.activeAudio = incoming;
          this.standbyAudio = outgoing;
        }
      });

      if (!fadeStarted) {
        // Fallback on error
        this.activeAudio = incoming;
        this.standbyAudio = outgoing;
        outgoing.pause();
        outgoing.removeAttribute('src');
        store.set('currentTime', 0);
        if (autoStart) await incoming.play();
        this.onTrackPlaybackStarted(track, file);
      }
      return;
    }

    // 2. Pure (tanpa DSP) Gapless Switch Branch
    if (isGaplessSwitch && this.standbyAudio.src) {
      const outgoing = this.activeAudio;
      this.activeAudio = this.standbyAudio;
      this.standbyAudio = outgoing;
      this.activeAudio.volume = this.masterVolume;
      store.set('currentTime', 0);
      outgoing.pause();
      outgoing.removeAttribute('src');

      if (autoStart) await this.activeAudio.play();
      this.onTrackPlaybackStarted(track, file);
      return;
    }

    // 3. Standard Playback Branch
    this.crossfade.abortFade(true);
    this.activeAudio.src = objectUrl;
    this.activeAudio.currentTime = 0;
    store.set('currentTime', 0);
    const estimatedDur = track.streamInfo?.duration || track.duration || 0;
    if (estimatedDur > 0) {
      store.set('duration', estimatedDur);
    }
    this.activeAudio.volume = this.masterVolume;

    if (autoStart) {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      await this.activeAudio.play();
    }

    this.onTrackPlaybackStarted(track, file);
  }

  async onTrackPlaybackStarted(track, file) {
    // 1. Prioritize and execute Loudness (LUFS / TP / DR) analysis if not yet available
    if (!track.analysis || track.analysis.lufs === undefined) {
      analyzer.prioritizeTrack(track, file).then((res) => {
        if (res) {
          track.analysis = res;
          this.applyReplayGainForTrack(track);
          events.emit('track:analysisUpdated', { trackId: track.id, analysis: res });
        }
      }).catch((e) => console.warn('Loudness priority analysis warning:', e));
    } else {
      this.applyReplayGainForTrack(track);
    }

    // 2. Resolve or extract cover artwork
    if (!track.metadata?.pictureUrl) {
      await coverCache.resolveTrackCover(track);
      if (!track.metadata?.pictureUrl && file) {
        try {
          const ext = track.format;
          let parsed = null;
          if (ext === 'flac') parsed = await MetadataParser.parseFLAC(file);
          else if (ext === 'mp3') parsed = await MetadataParser.parseID3v2(file);
          else if (['m4a', 'alac', 'aac'].includes(ext)) parsed = await MetadataParser.parseMP4(file);
          if (parsed?.pictureData) {
            const url = await coverCache.saveCover(track.id, parsed.pictureData.bytes, parsed.pictureData.mime);
            if (url) {
              if (!track.metadata) track.metadata = {};
              track.metadata.pictureUrl = url;
              track.metadata.pictureKey = track.id;
              track.metadata.hasCover = true;
              await db.put('tracks', track);
            }
          }
        } catch (err) {
          console.warn('Could not extract cover during playback:', err);
        }
      }
    }

    store.set('currentTrack', track);
    events.emit('engine:trackChanged', track);

    // Update play stats in DB
    const statsMap = store.get('stats') || new Map();
    const stat = statsMap.get(track.id) || { playCount: 0, favorite: false, rating: 0 };
    stat.playCount = (stat.playCount || 0) + 1;
    stat.lastPlayed = Date.now();
    statsMap.set(track.id, stat);
    await db.put('stats', { trackId: track.id, ...stat });
    store.set('stats', new Map(statsMap));
  }

  /**
   * Apply ReplayGain non-destructively in Enhanced mode with True Peak anti-clipping
   * @param {Object} track 
   */
  applyReplayGainForTrack(track) {
    if (this.pureMode || !this.replayGainNode || !this.audioCtx) return;

    const rgEnabled = settings.get('replayGain', true);
    let appliedGainDb = 0;

    if (rgEnabled) {
      // Priority 1: Embedded track tag
      if (track.metadata?.replayGainTrackGain !== undefined && track.metadata?.replayGainTrackGain !== null) {
        appliedGainDb = Number(track.metadata.replayGainTrackGain) || 0;
      } else if (track.analysis?.lufs !== undefined) {
        // Priority 2: Calculated from BS.1770 LUFS to user target
        const targetLufs = settings.get('replayGainTarget', -18);
        appliedGainDb = targetLufs - track.analysis.lufs;
      }

      // Priority 3: Anti-clipping protection via 4x True Peak
      const preventClip = settings.get('replayGainPreventClipping', true);
      if (preventClip && track.analysis?.truePeakDbtp !== undefined) {
        const maxSafeGain = -0.5 - track.analysis.truePeakDbtp;
        if (appliedGainDb > maxSafeGain) {
          appliedGainDb = maxSafeGain;
        }
      }
    }

    const linearAmp = Math.pow(10, appliedGainDb / 20);
    this.replayGainNode.gain.setValueAtTime(linearAmp, this.audioCtx.currentTime);
    track.appliedReplayGainDb = Math.round(appliedGainDb * 10) / 10;
    events.emit('engine:dspStateChanged', this.isBitPerfect());
  }

  /**
   * Get momentary loudness (Enhanced Mode) or cached value (Pure Mode)
   * @returns {{ isPure: boolean, lufs: number|null }}
   */
  getMomentaryLoudness() {
    if (this.pureMode || !this.analyser) {
      const cur = store.get('currentTrack');
      return {
        isPure: true,
        lufs: cur?.analysis?.lufs ?? null
      };
    }
    const buffer = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buffer);
    let sumSq = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumSq += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSq / buffer.length);
    if (rms < 1e-5) return { isPure: false, lufs: -70.0 };
    const momentary = -0.691 + 10 * Math.log10(rms * rms);
    return {
      isPure: false,
      lufs: Math.max(-70, Math.min(0, Math.round(momentary * 10) / 10))
    };
  }

  /**
   * Preload standby audio element with next track URL and pre-analyze.
   * @param {Object} nextTrack
   */
  async preload(nextTrack) {
    if (!nextTrack) return;
    try {
      const file = await folderManager.getFileForTrack(nextTrack);
      if (file) {
        this.standbyAudio.src = URL.createObjectURL(file);
        this.standbyAudio.load();
        events.emit('engine:gaplessReady', nextTrack);

        // Pre-analyze upcoming track in priority channel if unanalyzed
        if (!nextTrack.analysis || nextTrack.analysis.lufs === undefined) {
          analyzer.prioritizeTrack(nextTrack, file).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Preload warning:', err);
    }
  }

  pause() {
    this.crossfade.abortFade(true);
    if (this.activeAudio) this.activeAudio.pause();
  }

  resume() {
    return this.activeAudio ? this.activeAudio.play() : Promise.resolve();
  }

  seek(seconds) {
    this.crossfade.abortFade(true);

    // 1. Immediately silence, pause, and unload standbyAudio so it can never leak or play concurrently
    if (this.standbyAudio) {
      try {
        this.standbyAudio.pause();
        this.standbyAudio.currentTime = 0;
        this.standbyAudio.removeAttribute('src');
        this.standbyAudio.load();
      } catch {}
    }

    // 2. Reset lookahead and scheduler state in crossfade controller
    if (this.crossfade) {
      this.crossfade.preloadedForTrackId = null;
      this.crossfade.gaplessTriggeredForTrackId = null;
      this.crossfade.crossfadeTriggeredForTrackId = null;
    }

    // 3. Guarantee Web Audio fade gains with seamless micro-ramp smoothing: active = 1, standby = 0
    if (this.audioCtx) {
      const now = this.audioCtx.currentTime;
      const activeGain = this.activeAudio === this.audioA ? this.fadeGainA : this.fadeGainB;
      const standbyGain = this.activeAudio === this.audioA ? this.fadeGainB : this.fadeGainA;
      if (standbyGain) standbyGain.gain.setValueAtTime(0, now);
      if (activeGain) {
        activeGain.gain.setValueAtTime(0.01, now);
        activeGain.gain.linearRampToValueAtTime(1, now + 0.025);
      }
    }

    // 4. Safely seek active audio
    if (this.activeAudio && this.activeAudio.duration) {
      const clamped = Math.max(0, Math.min(seconds, this.activeAudio.duration));
      this.activeAudio.currentTime = clamped;
      store.set('currentTime', clamped);
    }
  }

  getVolume() {
    return this.masterVolume !== undefined ? this.masterVolume : 1;
  }

  setVolume(val) {
    this.masterVolume = Math.max(0, Math.min(1, Number(val) || 0));

    let effectiveVolume = this.masterVolume;
    if (this.nightMode && this.nightMaxVolume !== undefined) {
      effectiveVolume = Math.min(this.masterVolume, this.nightMaxVolume);
    }

    if (this.masterGainNode && this.audioCtx) {
      this.masterGainNode.gain.setValueAtTime(effectiveVolume, this.audioCtx.currentTime);
    }

    if (this.activeAudio) {
      this.activeAudio.volume = effectiveVolume;
    }
    if (this.standbyAudio) {
      this.standbyAudio.volume = effectiveVolume;
    }
  }

  setNightMode(enabled, options = {}) {
    this.nightMode = !!enabled;
    if (options.intensity) this.nightIntensity = options.intensity;
    if (options.maxVolume !== undefined) this.nightMaxVolume = Number(options.maxVolume);

    this.applyNightModeDsp();
    this.setVolume(this.masterVolume);

    store.set('nightMode', this.nightMode);
    events.emit('engine:nightModeChanged', {
      enabled: this.nightMode,
      intensity: this.nightIntensity,
      maxVolume: this.nightMaxVolume
    });
    events.emit('engine:dspStateChanged', this.isBitPerfect());
  }

  applyNightModeDsp() {
    if (!this.nightCompressorNode || !this.audioCtx) return;

    if (!this.nightMode) {
      // Neutral bypass (ratio 1 = pass-through without dynamic reduction)
      this.nightCompressorNode.threshold.setValueAtTime(0, this.audioCtx.currentTime);
      this.nightCompressorNode.ratio.setValueAtTime(1, this.audioCtx.currentTime);
      if (this.nightGainNode) {
        this.nightGainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
      }
      return;
    }

    const intensity = this.nightIntensity || 'mild';
    const params = {
      mild: { threshold: -20, ratio: 3.5, knee: 12, attack: 0.003, release: 0.25, makeupGain: 0.9 },
      moderate: { threshold: -26, ratio: 5.5, knee: 10, attack: 0.003, release: 0.25, makeupGain: 0.85 },
      strong: { threshold: -32, ratio: 8.0, knee: 8, attack: 0.002, release: 0.20, makeupGain: 0.8 }
    }[intensity] || { threshold: -20, ratio: 3.5, knee: 12, attack: 0.003, release: 0.25, makeupGain: 0.9 };

    this.nightCompressorNode.threshold.setValueAtTime(params.threshold, this.audioCtx.currentTime);
    this.nightCompressorNode.ratio.setValueAtTime(params.ratio, this.audioCtx.currentTime);
    this.nightCompressorNode.knee.setValueAtTime(params.knee, this.audioCtx.currentTime);
    this.nightCompressorNode.attack.setValueAtTime(params.attack, this.audioCtx.currentTime);
    this.nightCompressorNode.release.setValueAtTime(params.release, this.audioCtx.currentTime);

    if (this.nightGainNode) {
      this.nightGainNode.gain.setValueAtTime(params.makeupGain, this.audioCtx.currentTime);
    }
  }

  async requestWakeLock() {
    if ('wakeLock' in navigator && !this.wakeLock) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch {}
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release().then(() => this.wakeLock = null).catch(() => {});
    }
  }
}

export const engine = new AudioEngine();
