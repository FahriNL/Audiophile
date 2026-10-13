/**
 * db.js - Promise-based IndexedDB wrapper with transactions and bulk helpers
 */

import { DB_NAME, DB_VERSION, migrateDatabase } from './schema.js';

class DatabaseWrapper {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  /**
   * Connect to IndexedDB instance
   * @returns {Promise<IDBDatabase>}
   */
  async getDb() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        migrateDatabase(db, event);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });

    return this.initPromise;
  }

  /**
   * Put an item in an object store
   * @param {string} storeName 
   * @param {Object} item 
   * @returns {Promise<boolean>}
   */
  async put(storeName, item) {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(item);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Get an item by its primary key
   * @param {string} storeName 
   * @param {any} key 
   * @returns {Promise<any>}
   */
  async get(storeName, key) {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Get all items from an object store
   * @param {string} storeName 
   * @returns {Promise<Array>}
   */
  async getAll(storeName) {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Delete an item by key
   * @param {string} storeName 
   * @param {any} key 
   * @returns {Promise<boolean>}
   */
  async delete(storeName, key) {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Clear all items in an object store
   * @param {string} storeName 
   * @returns {Promise<boolean>}
   */
  async clear(storeName) {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Bulk insert or update items in a single transaction
   * @param {string} storeName 
   * @param {Array<Object>} items 
   * @returns {Promise<boolean>}
   */
  async bulkPut(storeName, items) {
    if (!items || items.length === 0) return true;
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const item of items) {
        store.put(item);
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }
}

export const db = new DatabaseWrapper();
