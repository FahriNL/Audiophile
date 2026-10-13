/**
 * folders.js - Folder management, File System Access API handles, and fallback imports
 */

import { db } from '../db/db.js';
import { store } from '../core/store.js';
import { events } from '../core/events.js';

class FolderManager {
  constructor() {
    this.directoryHandles = new Map();
    this.inMemoryFiles = new Map(); // fallback Map<trackId, File>
  }

  /**
   * Load saved folder handles from IndexedDB
   */
  async loadSavedHandles() {
    try {
      const saved = await db.getAll('folders');
      for (const item of saved) {
        if (item.handle) {
          this.directoryHandles.set(item.id, item.handle);
        }
      }
      store.set('folders', saved);
    } catch (err) {
      console.warn('Could not load saved folders:', err);
    }
  }

  /**
   * Request directory picker from user
   * @returns {Promise<FileSystemDirectoryHandle|null>}
   */
  async openDirectoryPicker() {
    if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
      return null;
    }

    try {
      const handle = await window.showDirectoryPicker();
      const folderRecord = {
        id: 'folder_' + Date.now(),
        name: handle.name,
        handle,
        addedAt: Date.now()
      };

      await db.put('folders', folderRecord);
      this.directoryHandles.set(folderRecord.id, handle);

      const existing = store.get('folders') || [];
      store.set('folders', [...existing, folderRecord]);
      events.emit('folder:added', folderRecord);

      return handle;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Directory Picker error:', err);
      }
      return null;
    }
  }

  /**
   * Universal folder import trigger that works across ALL browsers:
   * 1. Chromium: launches showDirectoryPicker().
   * 2. Non-Chromium (Firefox, Safari, iOS): triggers fallback input SYNCHRONOUSLY
   *    within the active user gesture callstack to prevent browser security blocks.
   * @param {HTMLInputElement} [customFallbackInput]
   */
  triggerFolderImport(customFallbackInput = null) {
    if (typeof window === 'undefined') return;

    if ('showDirectoryPicker' in window) {
      this.openDirectoryPicker().then(async (handle) => {
        if (handle) {
          const { scanner } = await import('./scanner.js');
          const { toast } = await import('../ui/components/toast.js');
          toast.info('Memindai folder musik lokal...');
          try {
            const results = await scanner.scanDirectoryHandle(handle);
            const totalBytes = (results || []).reduce((acc, t) => acc + (t.size || 0), 0);
            const sizeStr = formatTotalFolderSize(totalBytes);
            const count = (results || []).length;
            toast.success(`Berhasil memuat ${count} lagu (${sizeStr}).`);
          } catch (scanErr) {
            console.error('Scan folder error:', scanErr);
            toast.error('Gagal memindai folder: ' + (scanErr?.message || 'Format tidak terbaca'));
          }
        }
      }).catch(err => {
        if (err?.name !== 'AbortError') {
          console.error('Directory Picker error:', err);
        }
      });
    } else {
      // Must execute synchronously in the direct click user gesture!
      const input = customFallbackInput ||
                    document.getElementById('fallbackFileInput') ||
                    document.getElementById('inputSettingsFallbackFolder');
      if (input) {
        input.click();
      } else {
        console.warn('Fallback file input not found');
      }
    }
  }

  /**
   * Verify read permissions for a folder handle
   * @param {FileSystemDirectoryHandle} handle 
   * @returns {Promise<boolean>}
   */
  async verifyPermission(handle) {
    if (!handle) return false;
    const opts = { mode: 'read' };
    try {
      if ((await handle.queryPermission(opts)) === 'granted') {
        return true;
      }
      return (await handle.requestPermission(opts)) === 'granted';
    } catch {
      return false;
    }
  }

  /**
   * Retrieve the physical File object for a track
   * @param {Object} track 
   * @returns {Promise<File|null>}
   */
  async getFileForTrack(track) {
    if (!track) return null;

    // Check memory cache first
    if (this.inMemoryFiles.has(track.id)) {
      return this.inMemoryFiles.get(track.id);
    }

    // Try resolving from folder handles
    const folders = store.get('folders') || [];
    for (const f of folders) {
      const handle = this.directoryHandles.get(f.id) || f.handle;
      if (!handle) continue;

      try {
        const hasPermission = await this.verifyPermission(handle);
        if (!hasPermission) continue;

        // Navigate relative path
        const parts = track.relativePath ? track.relativePath.split('/') : [track.name];
        let current = handle;
        for (let i = 0; i < parts.length - 1; i++) {
          current = await current.getDirectoryHandle(parts[i]);
        }
        const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
        const file = await fileHandle.getFile();

        this.inMemoryFiles.set(track.id, file);
        return file;
      } catch {
        // Continue searching other folders if not in this one
      }
    }

    return null;
  }

  /**
   * Store in-memory file for tracks loaded via input fallback or drag-and-drop
   * @param {string} trackId 
   * @param {File} file 
   */
  registerInMemoryFile(trackId, file) {
    this.inMemoryFiles.set(trackId, file);
  }
}

/**
 * Format total library size into human-readable GB or MB
 * @param {number} totalBytes
 * @returns {string}
 */
export function formatTotalFolderSize(totalBytes) {
  if (!totalBytes || totalBytes <= 0) return '0 MB';
  const oneGb = 1024 * 1024 * 1024;
  if (totalBytes >= oneGb) {
    const gb = (totalBytes / oneGb).toFixed(1);
    return `${gb} GB`;
  }
  const mb = Math.round(totalBytes / (1024 * 1024));
  return `${mb} MB`;
}

export const folderManager = new FolderManager();

