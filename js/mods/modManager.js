/**
 * modManager.js - Lifecycle management for ZIP-based mods
 * Handles mod installation, manifest validation, IndexedDB persistence,
 * activation toggling, deletion, and ZIP export.
 */

import { db } from '../db/db.js';
import { events } from '../core/events.js';
import { unpackZip, packZip } from './zipEngine.js';

class ModManager {
  constructor() {
    this.cachedMods = new Map();
    this.isInitialized = false;
  }

  /**
   * Load and cache all installed mods from IndexedDB
   * @returns {Promise<Array<Object>>}
   */
  async loadAllMods() {
    try {
      const list = await db.getAll('mods') || [];
      this.cachedMods.clear();
      list.sort((a, b) => (a.priority || 0) - (b.priority || 0));
      for (const m of list) {
        this.cachedMods.set(m.id, m);
      }
      this.isInitialized = true;
      return list;
    } catch (err) {
      console.warn('Gagal memuat daftar mod dari IndexedDB:', err);
      return [];
    }
  }

  /**
   * Get single mod by ID
   * @param {string} id 
   * @returns {Object|null}
   */
  getMod(id) {
    return this.cachedMods.get(id) || null;
  }

  /**
   * Get all cached mods synchronously
   * @returns {Array<Object>}
   */
  getAllMods() {
    return Array.from(this.cachedMods.values());
  }

  /**
   * Install a new mod from a ZIP input (File, Blob, or Uint8Array)
   * @param {File|Blob|Uint8Array|ArrayBuffer} zipInput 
   * @returns {Promise<Object>} Installed mod record
   */
  async installFromZip(zipInput) {
    const filesMap = await unpackZip(zipInput);
    if (!filesMap || filesMap.size === 0) {
      throw new Error('Arsip ZIP kosong atau tidak berisi berkas yang dapat dibaca');
    }

    // 1. Locate manifest file (mod.json or manifest.json)
    let manifestEntry = filesMap.get('mod.json') || filesMap.get('manifest.json');
    if (!manifestEntry) {
      // Look for case-insensitive or nested root folder mod.json
      for (const [p, entry] of filesMap.entries()) {
        const lower = p.toLowerCase();
        if (lower === 'mod.json' || lower.endsWith('/mod.json')) {
          manifestEntry = entry;
          break;
        }
      }
    }

    if (!manifestEntry || !manifestEntry.text) {
      throw new Error('Berkas "mod.json" tidak ditemukan di dalam arsip ZIP');
    }

    // 2. Parse and validate manifest
    let manifest;
    try {
      manifest = JSON.parse(manifestEntry.text);
    } catch (e) {
      throw new Error('Berkas "mod.json" bukan format JSON yang valid: ' + e.message);
    }

    if (!manifest.id || typeof manifest.id !== 'string') {
      throw new Error('Manifest "mod.json" wajib memiliki bidang "id" bertipe string');
    }

    // Validate ID format (alphanumeric, hyphens, underscores)
    const cleanId = manifest.id.trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(cleanId)) {
      throw new Error('ID Mod hanya boleh berisi huruf kecil, angka, tanda hubung (-), dan garis bawah (_)');
    }

    if (!manifest.name || typeof manifest.name !== 'string') {
      throw new Error('Manifest "mod.json" wajib memiliki bidang "name"');
    }

    // Validate declared entry styles and scripts
    const entryStyles = Array.isArray(manifest.entryStyles) ? manifest.entryStyles : [];
    const entryScripts = Array.isArray(manifest.entryScripts) ? manifest.entryScripts : [];

    for (const stylePath of entryStyles) {
      const cleanPath = stylePath.replace(/^\/+/, '');
      if (!filesMap.has(cleanPath)) {
        throw new Error(`Berkas gaya yang dideklarasikan tidak ditemukan di dalam ZIP: ${stylePath}`);
      }
    }

    for (const scriptPath of entryScripts) {
      const cleanPath = scriptPath.replace(/^\/+/, '');
      if (!filesMap.has(cleanPath)) {
        throw new Error(`Berkas skrip yang dideklarasikan tidak ditemukan di dalam ZIP: ${scriptPath}`);
      }
    }

    // Determine mod type
    let modType = manifest.type || 'hybrid';
    if (!manifest.type) {
      if (entryStyles.length > 0 && entryScripts.length === 0) modType = 'theme';
      else if (entryScripts.length > 0 && entryStyles.length === 0) modType = 'functional';
      else modType = 'hybrid';
    }

    // 3. Serialize files map for IndexedDB storage
    const serializedFiles = {};
    for (const [p, file] of filesMap.entries()) {
      serializedFiles[p] = {
        path: p,
        bytes: file.bytes,
        mime: file.mime,
        text: file.text || ''
      };
    }

    const nextPriority = this.cachedMods.size + 1;
    const modRecord = {
      id: cleanId,
      name: manifest.name.trim(),
      version: manifest.version ? String(manifest.version).trim() : '1.0.0',
      author: manifest.author ? String(manifest.author).trim() : 'Komunitas',
      description: manifest.description ? String(manifest.description).trim() : '',
      type: modType,
      manifest: {
        ...manifest,
        id: cleanId,
        entryStyles,
        entryScripts,
        removals: Array.isArray(manifest.removals) ? manifest.removals : []
      },
      files: serializedFiles,
      enabled: true,
      installedAt: Date.now(),
      priority: nextPriority
    };

    // 4. Persist in IndexedDB
    await db.put('mods', modRecord);
    this.cachedMods.set(cleanId, modRecord);

    events.emit('mods:installed', modRecord);
    events.emit('mods:changed', this.getAllMods());

    return modRecord;
  }

  /**
   * Toggle mod enabled or disabled state
   * @param {string} id 
   * @param {boolean} isEnabled 
   * @returns {Promise<boolean>}
   */
  async setModEnabled(id, isEnabled) {
    const mod = this.cachedMods.get(id);
    if (!mod) return false;

    mod.enabled = Boolean(isEnabled);
    await db.put('mods', mod);
    this.cachedMods.set(id, mod);

    events.emit('mods:toggled', { id, enabled: mod.enabled });
    events.emit('mods:changed', this.getAllMods());
    return true;
  }

  /**
   * Delete mod permanently
   * @param {string} id 
   * @returns {Promise<boolean>}
   */
  async deleteMod(id) {
    const mod = this.cachedMods.get(id);
    if (!mod) return false;

    await db.delete('mods', id);
    this.cachedMods.delete(id);

    if (id === 'cyber-neon-bass' && typeof window !== 'undefined') {
      try {
        localStorage.setItem('sampleModDismissed', '1');
      } catch {}
    }

    events.emit('mods:deleted', id);
    events.emit('mods:changed', this.getAllMods());
    return true;
  }

  /**
   * Export installed mod back to downloadable ZIP Uint8Array
   * @param {string} id 
   * @returns {Promise<Uint8Array>}
   */
  async exportMod(id) {
    const mod = this.cachedMods.get(id);
    if (!mod || !mod.files) {
      throw new Error('Mod tidak ditemukan atau data berkas tidak lengkap');
    }

    const filesToPack = {};
    for (const [p, rec] of Object.entries(mod.files)) {
      filesToPack[p] = rec.bytes;
    }

    return packZip(filesToPack);
  }

  /**
   * Emergency Safe Mode: disable all mods
   */
  async disableAllMods() {
    for (const mod of this.cachedMods.values()) {
      mod.enabled = false;
      await db.put('mods', mod);
    }
    events.emit('mods:disabledAll');
    events.emit('mods:changed', this.getAllMods());
  }

  /**
   * Generate an official, fully documented starter kit ZIP
   * @returns {Promise<Uint8Array>}
   */
  async generateStarterKitZip() {
    const starterManifest = {
      id: 'template-starter-mod',
      name: 'Template Starter Mod',
      version: '1.0.0',
      author: 'Nama Anda',
      description: 'Template contoh mod tampilan, pengurangan elemen, dan fungsional audio.',
      type: 'hybrid',
      entryStyles: [
        'styles/theme.css'
      ],
      entryScripts: [
        'scripts/plugin.js'
      ],
      removals: [
        '#btnNpSleepTimer'
      ]
    };

    const starterCss = `/* styles/theme.css - Contoh Kustomisasi Tampilan */
:root {
  /* Ubah aksen warna utama antarmuka */
  --accent: #00e5ff;
  --accent-light: #6effff;
  --accent-glow: rgba(0, 229, 255, 0.35);
}

/* Modifikasi latar belakang player bar */
.glass-player-bar {
  border-top: 1px solid rgba(0, 229, 255, 0.25) !important;
  box-shadow: 0 -8px 24px rgba(0, 229, 255, 0.08) !important;
}
`;

    const starterJs = `/* scripts/plugin.js - Contoh Kustomisasi Fungsional */
export default function init(api) {
  // 1. Tambahkan tombol khusus ke Player Bar
  api.ui.addPlayerButton({
    id: 'btnStarterHello',
    title: 'Pesan dari Mod',
    iconSvg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
    onClick: () => {
      api.toast.success('Halo dari Template Starter Mod!');
    }
  });

  // 2. Dengarkan event saat lagu berganti
  api.events.on('engine:trackChanged', (track) => {
    const title = track.metadata?.title || 'Lagu';
    console.log('[Starter Mod] Sekarang memutar:', title);
  });
}
`;

    const readme = `# Panduan Pembuatan Mod Audiophile

Arsip ZIP ini adalah cetak biru resmi untuk membuat mod Audiophile.

## Struktur Berkas:
- mod.json: Manifest metadata mod (wajib).
- styles/theme.css: Ubah tampilan, font, dan warna.
- scripts/plugin.js: Tambah tombol, event listener, atau efek DSP.
- removals di mod.json: Sembunyikan elemen bawaan yang tidak Anda sukai.

Untuk memasang mod, seret berkas .zip ini langsung ke menu Pengaturan > Tab Mod.
`;

    const files = {
      'mod.json': JSON.stringify(starterManifest, null, 2),
      'styles/theme.css': starterCss,
      'scripts/plugin.js': starterJs,
      'README.md': readme
    };

    return packZip(files);
  }
}

export const modManager = new ModManager();
