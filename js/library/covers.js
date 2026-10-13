/**
 * covers.js - Persistent cover art manager and LRU object URL cache
 * Stores cover image Blobs in IndexedDB (store 'covers') and serves
 * fresh object URLs that persist across refreshes.
 */

import { db } from '../db/db.js';

class CoverCacheManager {
  constructor() {
    this.urlMap = new Map();
    this.activeUrls = new Set();
  }

  getLiveUrl(coverKey) {
    if (!coverKey) return null;
    return this.urlMap.get(coverKey) || null;
  }

  async saveCover(coverKey, blobOrBytes, mime = 'image/jpeg') {
    if (!coverKey || !blobOrBytes) return null;
    try {
      const blob = blobOrBytes instanceof Blob
        ? blobOrBytes
        : new Blob([blobOrBytes], { type: mime || 'image/jpeg' });

      await db.put('covers', {
        id: coverKey,
        blob,
        mime: mime || 'image/jpeg',
        size: blob.size,
        updatedAt: Date.now()
      });

      if (this.urlMap.has(coverKey)) {
        URL.revokeObjectURL(this.urlMap.get(coverKey));
      }

      const url = URL.createObjectURL(blob);
      this.urlMap.set(coverKey, url);
      this.activeUrls.add(url);
      return url;
    } catch (err) {
      console.warn('Gagal menyimpan cover art ke IndexedDB:', err);
      return null;
    }
  }

  async getCoverUrl(coverKey) {
    if (!coverKey) return null;
    if (this.urlMap.has(coverKey)) {
      return this.urlMap.get(coverKey);
    }

    try {
      const record = await db.get('covers', coverKey);
      if (record && record.blob) {
        const url = URL.createObjectURL(record.blob);
        this.urlMap.set(coverKey, url);
        this.activeUrls.add(url);
        return url;
      }
    } catch (err) {
      console.warn('Gagal memuat cover art dari IndexedDB:', err);
    }
    return null;
  }

  async resolveTrackCover(track) {
    if (!track) return null;
    const coverKey = track.metadata?.pictureKey || track.id;
    const url = await this.getCoverUrl(coverKey);
    if (url) {
      if (!track.metadata) track.metadata = {};
      track.metadata.pictureUrl = url;
      track.metadata.pictureKey = coverKey;
      return url;
    }
    return null;
  }

  revokeAll() {
    for (const url of this.activeUrls) {
      URL.revokeObjectURL(url);
    }
    this.urlMap.clear();
    this.activeUrls.clear();
  }
}

export const coverCache = new CoverCacheManager();
