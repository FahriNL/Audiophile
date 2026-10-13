/**
 * crossfade.js - Precision Equal-Power Audio Crossfade Engine
 *
 * Implements:
 * - Equal-power (cos/sin) fade curves ensuring constant acoustic energy sum (cos^2 + sin^2 = 1)
 * - Precision scheduler via requestAnimationFrame (rAF) and high-resolution timers
 * - Dedicated GainNodes for Web Audio mode and smooth element.volume rAF for Pure Mode
 * - Automatic iOS Safari volume-lock detection and fallback
 * - Independent master volume multiplication
 * - Smart skip rules: consecutive album tracks, repeat-one, queue end, short songs (< 2x fade)
 * - Manual skip micro-crossfade (~250ms)
 * - Safe cancellation on seek/pause/stop with zero ghost playback
 * - Midpoint (progress >= 0.5) synchronized metadata and lyrics transition
 */

import { store } from '../core/store.js';
import { events } from '../core/events.js';

/**
 * Pure function: Calculate equal-power gain factors for outgoing and incoming audio.
 * @param {number} progress Normalized progress from 0.0 to 1.0
 * @returns {{ gainOut: number, gainIn: number }}
 */
export function equalPowerGains(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  // Angle goes from 0 to PI/2
  const angle = p * (Math.PI / 2);
  const gainOut = Math.cos(angle);
  const gainIn = Math.sin(angle);
  return { gainOut, gainIn };
}

/**
 * Pure function: Calculate fade start time and clamped duration.
 * @param {number} duration Total track duration in seconds
 * @param {number} configuredFade Configured fade duration in seconds
 * @param {number} [playbackRate=1] Current playback speed
 * @returns {{ fadeStartTime: number, actualFadeDuration: number }}
 */
export function computeFadeStart(duration, configuredFade, playbackRate = 1) {
  const dur = Math.max(0, Number(duration) || 0);
  const rate = Math.max(0.1, Number(playbackRate) || 1);
  const fade = Math.max(0, Number(configuredFade) || 0);

  if (dur <= 0 || fade <= 0) {
    return { fadeStartTime: 0, actualFadeDuration: 0 };
  }

  // If track is shorter than 2x fade duration, automatically clamp fade
  const actualFadeDuration = Math.min(fade, dur / 2);
  const fadeStartTime = Math.max(0, dur - (actualFadeDuration * rate));

  return { fadeStartTime, actualFadeDuration };
}

/**
 * Pure function: Determine whether crossfade should be skipped for a transition.
 * @param {Object} params
 * @returns {boolean}
 */
export function shouldSkipCrossfade({
  isCrossfadeEnabled = false,
  configuredFade = 0,
  isConsecutiveAlbum = false,
  avoidConsecutiveAlbums = true,
  repeatMode = 'none',
  isLastTrackWithoutRepeat = false,
  duration = 0
} = {}) {
  if (!isCrossfadeEnabled || configuredFade <= 0) return true;
  if (repeatMode === 'one') return true;
  if (isLastTrackWithoutRepeat) return true;
  if (duration > 0 && duration <= 2) return true;
  if (isConsecutiveAlbum && avoidConsecutiveAlbums) return true;
  return false;
}

/**
 * Test whether HTMLMediaElement.volume can be altered in the current environment (detects iOS Safari volume lock).
 * @param {HTMLMediaElement} audioEl 
 * @returns {boolean}
 */
export function testVolumeWritable(audioEl) {
  if (!audioEl) return false;
  try {
    const orig = audioEl.volume;
    audioEl.volume = 0.5;
    const isWritable = Math.abs(audioEl.volume - 0.5) < 0.05;
    audioEl.volume = orig;
    return isWritable;
  } catch {
    return false;
  }
}

export class CrossfadeController {
  constructor(audioEngine) {
    this.engine = audioEngine;
    this.isFading = false;
    this.rafId = null;
    this.fadeStartTime = 0;
    this.fadeDurationMs = 0;
    this.midpointReached = false;

    this.outgoing = null;
    this.incoming = null;
    this.outgoingGainNode = null;
    this.incomingGainNode = null;

    this.onMidpointCallback = null;
    this.onCompleteCallback = null;

    // Scheduler state
    this.scheduleRafId = null;
    this.preloadedForTrackId = null;
    this.gaplessTriggeredForTrackId = null;
    this.crossfadeTriggeredForTrackId = null;
    this.isVolumeWritable = true;
    this.hasTestedVolumeWritable = false;
  }

  /**
   * Start scheduler loop to monitor current playback position and initiate preload / crossfade.
   */
  startScheduler() {
    this.stopScheduler();

    const check = () => {
      const active = this.engine.activeAudio;
      if (active && !active.paused && active.duration > 0 && !this.isFading) {
        const curTime = active.currentTime;
        const dur = active.duration;
        const rate = active.playbackRate || 1;
        const remaining = (dur - curTime) / rate;

        // 1. Preload standby element ~15 seconds before track ends
        const curTrack = store.get('currentTrack');
        const curTrackId = curTrack?.id;
        if (remaining <= 15 && this.preloadedForTrackId !== curTrackId) {
          this.preloadedForTrackId = curTrackId;
          events.emit('engine:preloadNeeded');
        }

        // 2. Evaluate crossfade start
        const settings = store.get('settings') || {};
        const cfConfig = settings.crossfade || {};
        const isEnabled = cfConfig.enabled !== false && (cfConfig.duration || 0) > 0;
        const configuredFade = isEnabled ? (cfConfig.duration || 0) : 0;

        const { actualFadeDuration } = computeFadeStart(dur, configuredFade, rate);

        if (isEnabled && actualFadeDuration > 0 && remaining <= actualFadeDuration && this.crossfadeTriggeredForTrackId !== curTrackId) {
          this.crossfadeTriggeredForTrackId = curTrackId;
          events.emit('engine:crossfadeTriggerTime', {
            remaining,
            actualFadeDuration,
            currentTrack: curTrack
          });
        } else if (remaining <= 0.05 && remaining > 0 && this.gaplessTriggeredForTrackId !== curTrackId) {
          // True Gapless: Trigger handoff 50ms before track ends for 0ms transition
          this.gaplessTriggeredForTrackId = curTrackId;
          events.emit('engine:gaplessTriggerTime', {
            remaining,
            currentTrack: curTrack
          });
        }
      }

      this.scheduleRafId = requestAnimationFrame(check);
    };

    this.scheduleRafId = requestAnimationFrame(check);
  }

  stopScheduler() {
    if (this.scheduleRafId) {
      cancelAnimationFrame(this.scheduleRafId);
      this.scheduleRafId = null;
    }
  }

  /**
   * Execute an active equal-power crossfade transition between outgoing and incoming audio.
   * @param {Object} options
   */
  async executeFade({
    outgoingAudio,
    incomingAudio,
    durationSec,
    outgoingGainNode = null,
    incomingGainNode = null,
    onMidpoint = null,
    onComplete = null
  }) {
    if (!outgoingAudio || !incomingAudio) return false;

    // Abort any ongoing fade cleanly first
    this.abortFade(false);

    this.outgoing = outgoingAudio;
    this.incoming = incomingAudio;
    this.outgoingGainNode = outgoingGainNode;
    this.incomingGainNode = incomingGainNode;
    this.fadeDurationMs = Math.max(150, (durationSec || 0) * 1000);
    this.midpointReached = false;
    this.onMidpointCallback = onMidpoint;
    this.onCompleteCallback = onComplete;
    this.isFading = true;

    // Check volume writability once
    if (!this.hasTestedVolumeWritable) {
      this.isVolumeWritable = testVolumeWritable(this.outgoing);
      this.hasTestedVolumeWritable = true;
    }

    // Prepare incoming audio element
    const masterVol = this.engine.masterVolume ?? 1;
    this.applyAudioGains(1, 0, masterVol);

    try {
      if (this.engine.audioCtx && this.engine.audioCtx.state === 'suspended') {
        await this.engine.audioCtx.resume();
      }
      await this.incoming.play();
    } catch (err) {
      console.warn('Crossfade incoming play failed, aborting fade:', err);
      this.abortFade(true);
      return false;
    }

    this.fadeStartTime = performance.now();

    const step = () => {
      if (!this.isFading) return;

      const elapsed = performance.now() - this.fadeStartTime;
      const progress = Math.min(1, elapsed / this.fadeDurationMs);

      const { gainOut, gainIn } = equalPowerGains(progress);
      const currentMaster = this.engine.masterVolume ?? 1;
      this.applyAudioGains(gainOut, gainIn, currentMaster);

      // Trigger midpoint event exactly once at t >= 0.5
      if (progress >= 0.5 && !this.midpointReached) {
        this.midpointReached = true;
        if (typeof this.onMidpointCallback === 'function') {
          this.onMidpointCallback();
        }
      }

      if (progress < 1) {
        this.rafId = requestAnimationFrame(step);
      } else {
        this.finalizeFade();
      }
    };

    this.rafId = requestAnimationFrame(step);
    return true;
  }

  /**
   * Apply gains to outgoing and incoming elements/nodes based on current engine mode.
   * @param {number} gainOut 
   * @param {number} gainIn 
   * @param {number} masterVol 
   */
  applyAudioGains(gainOut, gainIn, masterVol) {
    const isPure = this.engine.pureMode;

    if (!isPure && this.outgoingGainNode && this.incomingGainNode && this.engine.audioCtx) {
      // Enhanced mode with Web Audio GainNodes
      const now = this.engine.audioCtx.currentTime;
      this.outgoingGainNode.gain.setValueAtTime(gainOut, now);
      this.incomingGainNode.gain.setValueAtTime(gainIn, now);
    } else if (this.isVolumeWritable) {
      // Pure mode with native element.volume ramping
      if (this.outgoing) this.outgoing.volume = Math.max(0, Math.min(1, gainOut * masterVol));
      if (this.incoming) this.incoming.volume = Math.max(0, Math.min(1, gainIn * masterVol));
    } else if (this.outgoingGainNode && this.incomingGainNode && this.engine.audioCtx) {
      // Fallback for iOS Safari locked element.volume in Pure Mode
      const now = this.engine.audioCtx.currentTime;
      this.outgoingGainNode.gain.setValueAtTime(gainOut, now);
      this.incomingGainNode.gain.setValueAtTime(gainIn, now);
    }
  }

  /**
   * Finalize completed fade cleanly.
   */
  finalizeFade() {
    this.isFading = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    const masterVol = this.engine.masterVolume ?? 1;

    // Silence and stop outgoing
    if (this.outgoing) {
      this.outgoing.pause();
      this.outgoing.removeAttribute('src');
      this.outgoing.load();
      if (this.isVolumeWritable) this.outgoing.volume = masterVol;
    }

    if (this.outgoingGainNode && this.engine.audioCtx) {
      this.outgoingGainNode.gain.setValueAtTime(0, this.engine.audioCtx.currentTime);
    }

    // Ensure incoming has full volume
    if (this.incoming && this.isVolumeWritable) {
      this.incoming.volume = masterVol;
    }
    if (this.incomingGainNode && this.engine.audioCtx) {
      this.incomingGainNode.gain.setValueAtTime(1, this.engine.audioCtx.currentTime);
    }

    const cb = this.onCompleteCallback;
    this.onCompleteCallback = null;
    this.onMidpointCallback = null;
    if (typeof cb === 'function') cb();
  }

  /**
   * Abort active fade immediately and reset all volumes to normal.
   * @param {boolean} [pauseIncoming=true] 
   */
  abortFade(pauseIncoming = true) {
    if (!this.isFading && !this.rafId) return;

    this.isFading = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    const masterVol = this.engine.masterVolume ?? 1;

    // Reset outgoing volume
    if (this.outgoing && this.isVolumeWritable) {
      this.outgoing.volume = masterVol;
    }
    if (this.outgoingGainNode && this.engine.audioCtx) {
      this.outgoingGainNode.gain.setValueAtTime(1, this.engine.audioCtx.currentTime);
    }

    // Stop or reset incoming if aborting
    if (this.incoming) {
      if (pauseIncoming) {
        this.incoming.pause();
        this.incoming.removeAttribute('src');
        this.incoming.load();
      }
      if (this.isVolumeWritable) {
        this.incoming.volume = 0;
      }
    }
    if (this.incomingGainNode && this.engine.audioCtx) {
      this.incomingGainNode.gain.setValueAtTime(0, this.engine.audioCtx.currentTime);
    }

    this.outgoing = null;
    this.incoming = null;
    this.outgoingGainNode = null;
    this.incomingGainNode = null;
    this.onMidpointCallback = null;
    this.onCompleteCallback = null;
  }
}
