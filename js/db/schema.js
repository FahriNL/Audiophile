/**
 * schema.js - IndexedDB schema definition, stores, indexes, and version migrations
 */

export const DB_NAME = 'HiFiLocalDB';
export const DB_VERSION = 4;

/**
 * Handle database upgrades across versions
 * @param {IDBDatabase} db 
 * @param {IDBVersionChangeEvent} event 
 */
export function migrateDatabase(db, event) {
  const oldVersion = event.oldVersion;

  // Initial store setup (Version 1)
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains('tracks')) {
      const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
      trackStore.createIndex('artist', 'metadata.artist', { unique: false });
      trackStore.createIndex('album', 'metadata.album', { unique: false });
      trackStore.createIndex('tier', 'tier', { unique: false });
      trackStore.createIndex('missing', 'missing', { unique: false });
      trackStore.createIndex('fingerprint', 'fingerprint', { unique: false });
    }

    if (!db.objectStoreNames.contains('folders')) {
      db.createObjectStore('folders', { keyPath: 'id' });
    }

    if (!db.objectStoreNames.contains('playlists')) {
      db.createObjectStore('playlists', { keyPath: 'id' });
    }

    if (!db.objectStoreNames.contains('tagOverrides')) {
      db.createObjectStore('tagOverrides', { keyPath: 'trackId' });
    }

    if (!db.objectStoreNames.contains('analysis')) {
      db.createObjectStore('analysis', { keyPath: 'trackId' });
    }

    if (!db.objectStoreNames.contains('stats')) {
      db.createObjectStore('stats', { keyPath: 'trackId' });
    }

    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'key' });
    }
  }

  // Version 2 upgrades: Ensure indexes and smart playlist fields
  if (oldVersion < 2) {
    if (db.objectStoreNames.contains('tracks')) {
      const tx = event.currentTarget.transaction;
      const trackStore = tx.objectStore('tracks');
      if (!trackStore.indexNames.contains('fingerprint')) {
        trackStore.createIndex('fingerprint', 'fingerprint', { unique: false });
      }
      if (!trackStore.indexNames.contains('missing')) {
        trackStore.createIndex('missing', 'missing', { unique: false });
      }
    }
  }

  // Version 3 upgrades: Dedicated blob store for persistent album covers
  if (oldVersion < 3) {
    if (!db.objectStoreNames.contains('covers')) {
      db.createObjectStore('covers', { keyPath: 'id' });
    }
  }

  // Version 4 upgrades: Dedicated store for user-installed zip mods
  if (oldVersion < 4) {
    if (!db.objectStoreNames.contains('mods')) {
      db.createObjectStore('mods', { keyPath: 'id' });
    }
  }
}
