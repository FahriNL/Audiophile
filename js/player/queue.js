/**
 * queue.js - Playback queue management, history, smart auto-queue,
 * transition scheduler coordination, and queue state persistence.
 */

import { store } from '../core/store.js';
import { events } from '../core/events.js';
import { engine } from './engine.js';
import { SmartTransitionDetector } from './transitions.js';
import { settings } from '../core/settings.js';

class QueueManager {
  constructor() {
    this.history = [];
    this.lastClearedQueue = null;
    this.isCrossfadePending = false;
    this.isGaplessPending = false;

    events.on('engine:trackEnded', () => this.next(true));

    events.on('engine:preloadNeeded', () => {
      const nextTrack = this.peekNext();
      if (nextTrack) engine.preload(nextTrack);
    });

    // True Gapless Precision Trigger (50ms lookahead before track ends for 0ms acoustic gap)
    events.on('engine:gaplessTriggerTime', () => {
      if (this.isCrossfadePending || engine.crossfade.isFading || this.isGaplessPending) return;

      const repeatMode = store.get('repeatMode') || 'none';
      if (repeatMode === 'one') return;

      const nextTrack = this.peekNext();
      if (!nextTrack) return;

      const appSettings = store.get('settings') || {};
      const currentTrack = store.get('currentTrack');
      const transition = SmartTransitionDetector.determineTransition(currentTrack, nextTrack, appSettings);

      if (transition.type === 'gapless') {
        this.isGaplessPending = true;
        this.next(true).finally(() => {
          setTimeout(() => { this.isGaplessPending = false; }, 400);
        });
      }
    });

    // Precision Crossfade Trigger from Crossfade Scheduler
    events.on('engine:crossfadeTriggerTime', ({ actualFadeDuration, currentTrack }) => {
      if (this.isCrossfadePending || engine.crossfade.isFading) return;

      const repeatMode = store.get('repeatMode') || 'none';
      if (repeatMode === 'one') return;

      const nextTrack = this.peekNext();
      if (!nextTrack) return;

      const appSettings = store.get('settings') || {};
      const transition = SmartTransitionDetector.determineTransition(currentTrack, nextTrack, appSettings);

      if (transition.type === 'crossfade') {
        this.isCrossfadePending = true;
        const fadeDur = actualFadeDuration || transition.duration || 4;
        this.next(false, true, fadeDur).finally(() => {
          this.isCrossfadePending = false;
        });
      }
    });
  }

  get items() {
    return store.get('queue') || [];
  }

  get currentIndex() {
    return store.get('queueIndex') ?? -1;
  }

  getState() {
    return {
      items: store.get('queue') || [],
      currentIndex: store.get('queueIndex') ?? -1
    };
  }

  persistQueue() {
    const queue = store.get('queue') || [];
    const idx = store.get('queueIndex') ?? -1;
    settings.set('savedQueue', queue);
    settings.set('savedQueueIndex', idx);
  }

  /**
   * Play track at specific queue index
   * @param {number} index
   */
  async playAt(index) {
    const queue = store.get('queue') || [];
    if (index < 0 || index >= queue.length) return;
    store.set('queueIndex', index);
    this.persistQueue();
    events.emit('queue:updated', queue);
    const targetTrack = queue[index];
    if (targetTrack) {
      await engine.play(targetTrack, true);
    }
  }

  /**
   * Set entire queue and start playing at specific index
   * @param {Array<Object>} tracks 
   * @param {number} [startIndex=0] 
   */
  async setQueue(tracks = [], startIndex = 0) {
    if (tracks.length === 0) return;

    const newQueue = [...tracks];
    store.set('queue', newQueue);
    store.set('queueIndex', startIndex);
    this.persistQueue();
    events.emit('queue:updated', newQueue);

    const targetTrack = newQueue[startIndex];
    if (targetTrack) {
      await engine.play(targetTrack, true);
    }
  }

  /**
   * Play a track next (insert right after current position)
   * @param {Object|Array<Object>} itemOrItems 
   */
  playNext(itemOrItems) {
    const queue = [...(store.get('queue') || [])];
    const currentIndex = store.get('queueIndex') ?? -1;
    const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];

    if (currentIndex >= 0 && currentIndex < queue.length) {
      queue.splice(currentIndex + 1, 0, ...items);
    } else {
      queue.push(...items);
    }

    store.set('queue', queue);
    this.persistQueue();
    events.emit('queue:updated', queue);
  }

  /**
   * Add tracks to end of queue
   * @param {Object|Array<Object>} itemOrItems 
   */
  addToQueue(itemOrItems) {
    const queue = [...(store.get('queue') || [])];
    const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
    queue.push(...items);

    store.set('queue', queue);
    this.persistQueue();
    events.emit('queue:updated', queue);
  }

  /**
   * Move to next track in queue with smart crossfade or gapless transition
   * @param {boolean} [isGaplessSwitch=false]
   * @param {boolean} [isCrossfadeTriggered=false]
   * @param {number} [crossfadeDuration=0]
   */
  async next(isGaplessSwitch = false, isCrossfadeTriggered = false, crossfadeDuration = 0) {
    const queue = store.get('queue') || [];
    const currentIndex = store.get('queueIndex') ?? -1;
    const repeatMode = store.get('repeatMode') || 'none';
    const isShuffle = store.get('shuffle') || false;
    const appSettings = store.get('settings') || {};

    if (queue.length === 0) return;

    if (repeatMode === 'one') {
      if (!isGaplessSwitch && !isCrossfadeTriggered) {
        engine.seek(0);
        await engine.resume();
      } else {
        const curTrack = queue[currentIndex];
        if (curTrack) {
          await engine.play(curTrack, true, true, 0);
        }
      }
      return;
    }

    let nextIndex = currentIndex + 1;

    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * queue.length);
    } else if (nextIndex >= queue.length) {
      if (repeatMode === 'all') {
        nextIndex = 0;
      } else {
        // Queue finished. Check Smart Queue!
        if (appSettings.smartQueue) {
          const smartTrack = this.recommendNextTrack();
          if (smartTrack) {
            queue.push(smartTrack);
            store.set('queue', queue);
            nextIndex = queue.length - 1;
          } else {
            return;
          }
        } else {
          return;
        }
      }
    }

    const curTrack = queue[currentIndex];
    store.set('queueIndex', nextIndex);
    this.persistQueue();
    const nextTrack = queue[nextIndex];

    if (nextTrack) {
      const transition = SmartTransitionDetector.determineTransition(curTrack, nextTrack, appSettings);
      const cfConfig = appSettings.crossfade || {};

      // Handle manual skip micro-crossfade (~250ms) if triggered manually
      let effectiveFade = crossfadeDuration;
      if (!isCrossfadeTriggered && !isGaplessSwitch && cfConfig.manualSkip) {
        effectiveFade = 0.25;
      }

      if (transition.type === 'gapless' || isGaplessSwitch) {
        await engine.play(nextTrack, true, true, 0);
      } else if (isCrossfadeTriggered || effectiveFade > 0 || transition.type === 'crossfade') {
        const dur = effectiveFade > 0 ? effectiveFade : (transition.duration || cfConfig.duration || 4);
        await engine.play(nextTrack, true, false, dur);
      } else {
        await engine.play(nextTrack, true, false, 0);
      }
    }
  }

  /**
   * Move to previous track in queue
   */
  async prev() {
    const currentTime = store.get('currentTime') || 0;
    if (currentTime > 3) {
      engine.seek(0);
      return;
    }

    const queue = store.get('queue') || [];
    let currentIndex = store.get('queueIndex') ?? 0;
    const appSettings = store.get('settings') || {};
    const cfConfig = appSettings.crossfade || {};

    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = Math.max(0, queue.length - 1);
    }

    store.set('queueIndex', prevIndex);
    this.persistQueue();
    const prevTrack = queue[prevIndex];

    if (prevTrack) {
      const fadeDur = cfConfig.manualSkip ? 0.25 : 0;
      await engine.play(prevTrack, true, false, fadeDur);
    }
  }

  peekNext() {
    const queue = store.get('queue') || [];
    const currentIndex = store.get('queueIndex') ?? -1;
    const isShuffle = store.get('shuffle') || false;
    const repeatMode = store.get('repeatMode') || 'none';

    if (queue.length === 0) return null;

    if (repeatMode === 'one' && currentIndex >= 0 && currentIndex < queue.length) {
      return queue[currentIndex];
    }

    if (isShuffle) {
      if (queue.length > 1) {
        return queue[Math.floor(Math.random() * queue.length)];
      }
      return queue[0];
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex < queue.length) {
      return queue[nextIndex];
    }

    if (repeatMode === 'all') {
      return queue[0];
    }

    return null;
  }

  reorder(fromIndex, toIndex) {
    const queue = [...(store.get('queue') || [])];
    if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) return;

    const [moved] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, moved);

    let curIdx = store.get('queueIndex') ?? -1;
    if (curIdx === fromIndex) {
      curIdx = toIndex;
    } else if (fromIndex < curIdx && toIndex >= curIdx) {
      curIdx--;
    } else if (fromIndex > curIdx && toIndex <= curIdx) {
      curIdx++;
    }

    store.set('queue', queue);
    store.set('queueIndex', curIdx);
    this.persistQueue();
    events.emit('queue:updated', queue);
  }

  remove(index) {
    const queue = [...(store.get('queue') || [])];
    if (index < 0 || index >= queue.length) return;

    queue.splice(index, 1);
    let curIdx = store.get('queueIndex') ?? -1;

    if (index < curIdx) {
      curIdx--;
    } else if (index === curIdx) {
      if (curIdx >= queue.length) curIdx = queue.length - 1;
    }

    store.set('queue', queue);
    store.set('queueIndex', curIdx);
    this.persistQueue();
    events.emit('queue:updated', queue);
  }

  clear() {
    const queue = store.get('queue') || [];
    const curIdx = store.get('queueIndex') ?? -1;
    this.lastClearedQueue = { queue, curIdx };

    store.set('queue', []);
    store.set('queueIndex', -1);
    this.persistQueue();
    events.emit('queue:updated', []);
  }

  undoClear() {
    if (this.lastClearedQueue) {
      store.set('queue', this.lastClearedQueue.queue);
      store.set('queueIndex', this.lastClearedQueue.curIdx);
      this.persistQueue();
      events.emit('queue:updated', this.lastClearedQueue.queue);
      this.lastClearedQueue = null;
    }
  }

  recommendNextTrack() {
    const tracks = store.get('tracks') || [];
    const currentTrack = store.get('currentTrack');
    if (!tracks.length) return null;

    if (currentTrack) {
      const sameGenre = tracks.filter(t => 
        t.id !== currentTrack.id && 
        t.metadata?.genre && 
        t.metadata.genre === currentTrack.metadata?.genre
      );
      if (sameGenre.length) {
        return sameGenre[Math.floor(Math.random() * sameGenre.length)];
      }

      const sameArtist = tracks.filter(t => 
        t.id !== currentTrack.id && 
        (t.overrides?.artist || t.metadata?.artist) === (currentTrack.overrides?.artist || currentTrack.metadata?.artist)
      );
      if (sameArtist.length) {
        return sameArtist[Math.floor(Math.random() * sameArtist.length)];
      }
    }

    return tracks[Math.floor(Math.random() * tracks.length)];
  }
}

export const queueManager = new QueueManager();
