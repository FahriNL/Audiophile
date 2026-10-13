/**
 * sleepTimer.js - Sleep timer controller for pausing playback automatically
 */

import { engine } from './engine.js';
import { events } from '../core/events.js';

class SleepTimerManager {
  constructor() {
    this.timerHandle = null;
    this.stopAtEndOfTrack = false;
    this.targetTimestamp = null;
    this.initialMinutes = 0;
    this.fadeout = true;
    this.fadeoutInterval = null;
    this.originalVolume = null;

    events.on('engine:trackEnded', () => {
      if (this.stopAtEndOfTrack) {
        this.stopAtEndOfTrack = false;
        engine.pause();
        events.emit('sleeptimer:fired');
      }
    });
  }

  setFadeout(enabled) {
    this.fadeout = Boolean(enabled);
  }

  /**
   * Set sleep timer in minutes or 'endOfTrack'
   * @param {number|'endOfTrack'|'off'} option 
   */
  setTimer(option) {
    this.clear();

    if (option === 'off' || option === 0) {
      events.emit('sleeptimer:status', { active: false });
      return;
    }

    if (option === 'endOfTrack') {
      this.stopAtEndOfTrack = true;
      events.emit('sleeptimer:status', { active: true, mode: 'endOfTrack' });
      return;
    }

    const minutes = Number(option);
    if (!isNaN(minutes) && minutes > 0) {
      this.initialMinutes = minutes;
      this.targetTimestamp = Date.now() + minutes * 60 * 1000;

      if (this.fadeout) {
        this.fadeoutInterval = setInterval(() => {
          const remainingSec = Math.max(0, Math.round((this.targetTimestamp - Date.now()) / 1000));
          if (remainingSec <= 30 && remainingSec > 0) {
            if (this.originalVolume === null) {
              this.originalVolume = engine.activeAudio?.volume ?? 1;
            }
            const factor = remainingSec / 30;
            engine.setVolume(this.originalVolume * factor);
          }
        }, 1000);
      }

      this.timerHandle = setTimeout(() => {
        engine.pause();
        if (this.originalVolume !== null) {
          engine.setVolume(this.originalVolume);
        }
        this.clear();
        events.emit('sleeptimer:fired');
      }, minutes * 60 * 1000);

      events.emit('sleeptimer:status', {
        active: true,
        minutes,
        targetTimestamp: this.targetTimestamp
      });
    }
  }

  clear() {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
    if (this.fadeoutInterval) {
      clearInterval(this.fadeoutInterval);
      this.fadeoutInterval = null;
    }
    if (this.originalVolume !== null) {
      engine.setVolume(this.originalVolume);
      this.originalVolume = null;
    }
    this.stopAtEndOfTrack = false;
    this.targetTimestamp = null;
    this.initialMinutes = 0;
  }

  getStatus() {
    if (this.stopAtEndOfTrack) return { active: true, mode: 'endOfTrack', initialMinutes: 0 };
    if (this.targetTimestamp) {
      const remainingSec = Math.max(0, Math.round((this.targetTimestamp - Date.now()) / 1000));
      return { 
        active: true, 
        remainingSec, 
        initialMinutes: this.initialMinutes,
        fadeout: this.fadeout 
      };
    }
    return { active: false, fadeout: this.fadeout };
  }
}

export const sleepTimer = new SleepTimerManager();
