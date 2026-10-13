/**
 * perf.js - Performance Monitor and Hardware Profiler
 * Measures FPS via requestAnimationFrame, detects device constraints,
 * manages performance profiles (auto/high/balanced/saver), and pauses heavy effects.
 */

import { store } from './store.js';
import { events } from './events.js';

class PerformanceManager {
  constructor() {
    this.currentFps = 60;
    this.targetFps = 60;
    this.activeProfile = 'auto'; // 'auto' | 'high' | 'balanced' | 'saver'
    this.effectiveProfile = 'high'; // resolved profile
    this.frameCount = 0;
    this.lastFrameTime = performance.now();
    this.isMeasuring = false;
    this.rafId = null;
    this.fpsOverlayEl = null;

    // Device tier hints
    this.cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    this.memory = typeof navigator !== 'undefined' ? navigator.deviceMemory || 4 : 4;
    this.isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  init() {
    // Detect preferred setting from store or default
    const savedProfile = store.get('settings')?.perfProfile || 'auto';
    this.setProfile(savedProfile);

    // Visibility change listener: pause background work when tab is hidden
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        const isHidden = document.hidden;
        events.emit('perf:visibilityChange', { isHidden });
        if (isHidden) {
          this.pauseMeasurement();
        } else {
          this.resumeMeasurement();
        }
      });
    }

    this.startMeasurement();
  }

  startMeasurement() {
    if (typeof window === 'undefined' || this.isMeasuring) return;
    this.isMeasuring = true;
    this.lastFrameTime = performance.now();

    const loop = (timestamp) => {
      if (!this.isMeasuring) return;
      const delta = timestamp - this.lastFrameTime;
      this.lastFrameTime = timestamp;

      if (delta > 0) {
        const instantFps = 1000 / delta;
        // Exponential moving average for stable FPS calculation
        this.currentFps = Math.round(this.currentFps * 0.92 + instantFps * 0.08);
      }

      this.frameCount++;
      if (this.frameCount % 30 === 0) {
        store.set('currentFps', this.currentFps);
        if (this.fpsOverlayEl) {
          this.fpsOverlayEl.innerText = `${this.currentFps} FPS (${this.effectiveProfile.toUpperCase()})`;
        }
        if (this.activeProfile === 'auto') {
          this.evaluateAutoProfile();
        }
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  pauseMeasurement() {
    this.isMeasuring = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resumeMeasurement() {
    if (!this.isMeasuring) {
      this.startMeasurement();
    }
  }

  evaluateAutoProfile() {
    // Determine profile based on hardware hints and live FPS
    let nextProfile = 'high';

    if (this.cores <= 2 || this.memory <= 2 || this.currentFps < 38) {
      nextProfile = 'saver';
    } else if (this.cores <= 4 || this.memory <= 4 || this.currentFps < 52) {
      nextProfile = 'balanced';
    } else {
      nextProfile = 'high';
    }

    if (nextProfile !== this.effectiveProfile) {
      this.applyEffectiveProfile(nextProfile);
    }
  }

  setProfile(profileKey) {
    this.activeProfile = profileKey;
    if (profileKey === 'auto') {
      this.evaluateAutoProfile();
    } else {
      this.applyEffectiveProfile(profileKey);
    }
  }

  applyEffectiveProfile(profile) {
    this.effectiveProfile = profile;
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-perf-profile', profile);
    }
    store.set('effectivePerfProfile', profile);
    events.emit('perf:profileChanged', { profile });
  }

  toggleFpsOverlay(show) {
    if (typeof document === 'undefined') return;
    if (show) {
      if (!this.fpsOverlayEl) {
        this.fpsOverlayEl = document.createElement('div');
        this.fpsOverlayEl.id = 'hifiFpsOverlay';
        this.fpsOverlayEl.style.cssText = `
          position: fixed;
          top: 10px;
          left: 10px;
          z-index: 99999;
          background: rgba(0, 0, 0, 0.75);
          color: #38bdf8;
          font-family: monospace;
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid rgba(56, 189, 248, 0.3);
          pointer-events: none;
        `;
        document.body.appendChild(this.fpsOverlayEl);
      }
      this.fpsOverlayEl.style.display = 'block';
    } else if (this.fpsOverlayEl) {
      this.fpsOverlayEl.style.display = 'none';
    }
  }

  isPowerSaver() {
    return this.effectiveProfile === 'saver';
  }

  isHighPerformance() {
    return this.effectiveProfile === 'high';
  }
}

export const perfManager = new PerformanceManager();
