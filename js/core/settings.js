/**
 * settings.js - Single Source of Truth for Audiophile Application Settings
 *
 * Provides:
 * - Schema, defaults, versioning, and migrations
 * - Reactive get / set / update / subscribe API with dot-notation path support
 * - Automatic IndexedDB persistence with 300ms debounce and visibilitychange/pagehide flush
 * - Deep merge during boot (await settings.ready) before initial DOM render to prevent layout jump
 * - navigator.storage.persist() call and error alerting
 * - Per-section reset support
 * - Privacy controls (total offline mode & per-service network access)
 * - Backup scheduling & change counter tracking
 */

import { db } from '../db/db.js';
import { store } from './store.js';
import { events } from './events.js';
import { toast } from '../ui/components/toast.js';

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,

  // Audio Playback
  volume: 1,
  muted: false,
  playbackRate: 1,
  shuffle: false,
  repeatMode: 'none', // 'none' | 'all' | 'one'

  // Crossfade & Transitions
  crossfade: {
    enabled: false,
    duration: 4, // 0 to 12 in 0.5s step
    avoidConsecutiveAlbums: true,
    manualSkip: false
  },
  gapless: true,
  smartTransitions: true,

  // Audio Engine & DSP
  pureMode: true,
  replayGain: true,
  replayGainTarget: -18, // -18 (EBU R128) | -16 (Apple Music) | -14 (Spotify)
  replayGainPreventClipping: true,
  eqMode: 'graphic', // 'graphic' | 'parametric'
  eqBypass: false,
  autoPreamp: true,
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  preamp: 0,
  parametricBands: [
    { type: 'lowshelf', freq: 32, gain: 0, q: 0.71, enabled: true },
    { type: 'peaking', freq: 64, gain: 0, q: 1.41, enabled: true },
    { type: 'peaking', freq: 125, gain: 0, q: 1.41, enabled: true },
    { type: 'peaking', freq: 250, gain: 0, q: 1.41, enabled: true },
    { type: 'peaking', freq: 500, gain: 0, q: 1.41, enabled: true },
    { type: 'peaking', freq: 1000, gain: 0, q: 1.41, enabled: true },
    { type: 'peaking', freq: 2000, gain: 0, q: 1.41, enabled: true },
    { type: 'peaking', freq: 4000, gain: 0, q: 1.41, enabled: true },
    { type: 'peaking', freq: 8000, gain: 0, q: 1.41, enabled: true },
    { type: 'highshelf', freq: 16000, gain: 0, q: 0.71, enabled: true }
  ],
  parametricPresets: [],
  parametricCurrentPreset: 'builtin:flat',

  // Audio Output & Device Management (AUD-04)
  audioOutput: {
    deviceId: '',
    deviceLabel: '',
    deviceEqPresets: {} // { [deviceIdOrLabel]: presetNameOrId }
  },

  // UI, Theme & Localization
  theme: 'dark',
  lang: 'id',
  perfProfile: 'high', // 'high' | 'battery' | 'minimal'
  sidebarWidth: 260,
  sidebarCollapsed: false,
  lastRoute: 'home',

  // View Modes & Sort Preferences
  viewMode: {
    library: 'grid',
    albums: 'grid',
    artists: 'grid',
    playlists: 'grid'
  },
  sortFilter: {
    library: { sort: 'title_asc', filter: 'all' },
    albums: { sort: 'title_asc' },
    artists: { sort: 'name_asc' }
  },

  // Lyrics Customization
  lyrics: {
    fontSize: 16,
    align: 'center', // 'center' | 'left'
    offsets: {} // { [trackId]: offsetInSeconds }
  },

  // Privacy & Network Controls
  privacy: {
    totalOffline: false,
    services: {
      deezer: false,
      musicbrainz: false,
      wikipedia: false,
      wikimedia: false,
      itunes: false
    }
  },

  // Backup & Storage Persistence Metadata
  backup: {
    lastBackupAt: null,
    snoozedUntil: null,
    changesSinceBackup: {
      favorites: 0,
      playlists: 0
    }
  },

  // Library & Analysis
  autoAnalyzeOnImport: false,
  // Queue State Persistence
  savedQueue: [],
  savedQueueIndex: -1,

  // Gelombang 3 (UX-01, UX-02, UX-03)
  customShortcuts: null,
  autoPipOnTabBlur: false,
  nightMode: {
    enabled: false,
    intensity: 'mild', // 'mild' | 'moderate' | 'strong'
    maxVolume: 0.70, // 0.3 to 1.0
    scheduleEnabled: false,
    scheduleStart: '22:00',
    scheduleEnd: '06:00'
  }
};

/**
 * Deep merge source object into target object without mutating defaults.
 */
export function deepMerge(target, source) {
  const output = { ...target };
  if (!source || typeof source !== 'object') return output;

  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (key in target && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = { ...source[key] };
      }
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

/**
 * Access nested property by dot notation path (e.g. 'crossfade.duration').
 */
export function getByPath(obj, path, defaultVal) {
  if (!obj || !path) return defaultVal;
  const parts = path.split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr === undefined || curr === null) return defaultVal;
    curr = curr[part];
  }
  return curr !== undefined ? curr : defaultVal;
}

/**
 * Set nested property by dot notation path.
 */
export function setByPath(obj, path, value) {
  if (!obj || !path) return;
  const parts = path.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (curr[part] === undefined || curr[part] === null || typeof curr[part] !== 'object') {
      curr[part] = {};
    }
    curr = curr[part];
  }
  curr[parts[parts.length - 1]] = value;
}

class SettingsManager {
  constructor() {
    this.data = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    this.subscribers = new Map();
    this.saveTimeout = null;
    this.isReady = false;

    this.ready = this.init();
  }

  async init() {
    try {
      // 1. Request persistent storage from browser
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
      }

      // 2. Load saved settings from IndexedDB
      let saved = null;
      try {
        if (typeof indexedDB !== 'undefined') {
          const row = await db.get('settings', 'app_settings');
          saved = row?.data || null;
        }
      } catch (err) {
        console.warn('Settings load from IndexedDB warning:', err);
      }

      // 3. Deep merge saved settings with default schema
      if (saved) {
        this.data = deepMerge(DEFAULT_SETTINGS, saved);
      } else {
        this.data = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      }

      this.isReady = true;

      // 4. Synchronize with store
      store.set('settings', { ...this.data });

      // 5. Setup lifecycle flushes
      if (typeof window !== 'undefined') {
        window.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') this.flush();
        });
        window.addEventListener('pagehide', () => this.flush());
      }

      return this.data;
    } catch (err) {
      console.error('Settings initialization failed:', err);
      this.isReady = true;
      return this.data;
    }
  }

  get(path, defaultVal = undefined) {
    if (!path) return this.data;
    const val = getByPath(this.data, path, defaultVal);
    if (val !== undefined) return val;
    return getByPath(DEFAULT_SETTINGS, path, defaultVal);
  }

  set(path, value) {
    setByPath(this.data, path, value);
    this.notify(path, value);
    store.set('settings', { ...this.data });
    this.saveDebounced(300);
  }

  update(partial) {
    if (!partial || typeof partial !== 'object') return;
    this.data = deepMerge(this.data, partial);
    for (const key of Object.keys(partial)) {
      this.notify(key, this.data[key]);
    }
    store.set('settings', { ...this.data });
    this.saveDebounced(300);
  }

  getAll() {
    return JSON.parse(JSON.stringify(this.data));
  }

  resetSection(sectionKey) {
    if (sectionKey in DEFAULT_SETTINGS) {
      const defaultVal = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[sectionKey]));
      this.data[sectionKey] = defaultVal;
      this.notify(sectionKey, defaultVal);
      store.set('settings', { ...this.data });
      this.saveDebounced(50);
      toast.info(`Pengaturan bagian "${sectionKey}" dikembalikan ke default.`);
      return true;
    }
    return false;
  }

  subscribe(path, callback) {
    if (!this.subscribers.has(path)) {
      this.subscribers.set(path, new Set());
    }
    this.subscribers.get(path).add(callback);
    return () => {
      this.subscribers.get(path)?.delete(callback);
    };
  }

  notify(path, value) {
    events.emit('settings:changed', { path, value });
    if (this.subscribers.has(path)) {
      for (const cb of this.subscribers.get(path)) {
        try { cb(value); } catch (err) { console.error('Settings listener error:', err); }
      }
    }
    // Also notify root subscribers
    if (this.subscribers.has('*')) {
      for (const cb of this.subscribers.get('*')) {
        try { cb(path, value); } catch (err) { console.error('Settings root listener error:', err); }
      }
    }
  }

  saveDebounced(delay = 300) {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.flush();
    }, delay);
  }

  async flush() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    try {
      await db.put('settings', {
        key: 'app_settings',
        data: this.data,
        updatedAt: Date.now()
      });
    } catch (err) {
      console.error('Failed to persist settings to IndexedDB:', err);
      toast.error('Gagal menyimpan pengaturan ke penyimpanan lokal.');
    }
  }
}

export const settings = new SettingsManager();
