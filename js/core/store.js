/**
 * store.js - Central application state with reactive subscriptions
 */

import { events } from './events.js';

class Store {
  constructor() {
    this.state = {
      tracks: [],
      folders: [],
      playlists: [],
      tagOverrides: new Map(),
      analysisResults: new Map(),
      stats: new Map(),
      
      currentTrack: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      
      queue: [],
      queueIndex: -1,
      shuffle: false,
      repeatMode: 'none', // 'none' | 'all' | 'one'

      currentView: 'library',
      activePlaylistId: null,
      selectedTrackIds: new Set(),

      filters: {
        tier: 'all',
        search: '',
        sort: 'title_asc',
        onlyHires: false
      },

      settings: {
        pureMode: true,
        replayGain: true,
        gapless: true,
        crossfade: 0,
        theme: 'dark',
        lang: 'id',
        smartQueue: true
      },

      analysisProgress: {
        running: false,
        processed: 0,
        total: 0
      }
    };

    this.subscribers = new Map();
  }

  /**
   * Get current snapshot of a state slice
   * @param {string} key 
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Update state and notify subscribers
   * @param {string} key 
   * @param {any} value 
   */
  set(key, value) {
    const prev = this.state[key];
    this.state[key] = value;
    
    // Notify specific key subscribers
    if (this.subscribers.has(key)) {
      for (const cb of this.subscribers.get(key)) {
        try {
          cb(value, prev);
        } catch (err) {
          console.error(`Store subscription error on "${key}":`, err);
        }
      }
    }

    // Also emit via global eventBus
    events.emit(`state:${key}`, { value, prev });
  }

  /**
   * Subscribe to state slice changes
   * @param {string} key 
   * @param {Function} callback (value, prev) => void
   * @returns {Function} unsubscribe function
   */
  subscribe(key, callback) {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key).add(callback);
    return () => this.subscribers.get(key).delete(callback);
  }

  /**
   * Batch update multiple state fields
   * @param {Object} partialState 
   */
  update(partialState) {
    for (const [key, val] of Object.entries(partialState)) {
      this.set(key, val);
    }
  }
}

export const store = new Store();
