/**
 * mediaSession.js - Media Session API for lockscreen controls and system audio metadata
 */

import { engine } from './engine.js';
import { queueManager } from './queue.js';
import { events } from '../core/events.js';

export class MediaSessionController {
  static init() {
    if (!('mediaSession' in navigator)) return;

    events.on('engine:trackChanged', (track) => {
      this.updateMetadata(track);
    });

    try {
      navigator.mediaSession.setActionHandler('play', () => engine.resume());
      navigator.mediaSession.setActionHandler('pause', () => engine.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => queueManager.prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => queueManager.next());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) engine.seek(details.seekTime);
      });
    } catch (err) {
      console.warn('MediaSession handler registration note:', err);
    }
  }

  static updateMetadata(track) {
    if (!('mediaSession' in navigator) || !track) return;

    const title = track.overrides?.title || track.metadata?.title || track.name;
    const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown Artist';
    const album = track.overrides?.album || track.metadata?.album || '';
    const artwork = track.metadata?.pictureUrl
      ? [{ src: track.metadata.pictureUrl, sizes: '512x512', type: 'image/jpeg' }]
      : [];

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork
    });
  }
}
