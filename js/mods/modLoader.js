/**
 * modLoader.js - Runtime loader and executor for Audiophile mods
 * Dynamically injects scoped CSS, applies element removals, creates Object URLs
 * for internal assets, and executes JavaScript modules in an error-isolated environment.
 */

import { modManager } from './modManager.js';
import { AudiophileModAPI } from './modApi.js';
import { events } from '../core/events.js';
import { toast } from '../ui/components/toast.js';
import { settings } from '../core/settings.js';

class ModLoader {
  constructor() {
    this.activeRuntimes = new Map();
    this.isSafeMode = false;
    this.initialized = false;
  }

  /**
   * Initialize and boot all enabled mods
   */
  async init() {
    if (this.initialized) return;

    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('safe-mode') === '1' || urlParams.get('safemode') === '1') {
        this.isSafeMode = true;
        console.warn('Mode Aman (Safe Mode) aktif: Seluruh mod dilewati.');
        toast.warning('Mode Aman aktif: Seluruh mod dinonaktifkan.');
      }
    }

    let mods = await modManager.loadAllMods();

    // Auto-install sample mod if no mods are installed yet and user has not dismissed it
    const wasSampleDismissed = typeof window !== 'undefined' && localStorage.getItem('sampleModDismissed') === '1';
    if (mods.length === 0 && !wasSampleDismissed && !this.isSafeMode) {
      try {
        const { generateSampleModZip } = await import('./sampleMod.js');
        const zipBytes = await generateSampleModZip();
        const installedMod = await modManager.installFromZip(zipBytes);
        mods = [installedMod];
      } catch (err) {
        console.warn('Auto-install sample mod notice:', err);
      }
    }

    if (!this.isSafeMode) {
      for (const mod of mods) {
        if (mod.enabled) {
          await this.activateMod(mod);
        }
      }
    }

    this._bindEvents();
    this.initialized = true;
  }

  _bindEvents() {
    events.on('mods:toggled', async ({ id, enabled }) => {
      if (enabled) {
        const mod = modManager.getMod(id);
        if (mod) await this.activateMod(mod);
      } else {
        this.deactivateMod(id);
      }
    });

    events.on('mods:deleted', (id) => {
      this.deactivateMod(id);
    });

    events.on('mods:disabledAll', () => {
      this.deactivateAll();
    });

    events.on('mods:installed', async (mod) => {
      if (mod.enabled && !this.isSafeMode) {
        await this.activateMod(mod);
      }
    });
  }

  /**
   * Activate and inject a mod into the live application
   * @param {Object} mod 
   */
  async activateMod(mod) {
    if (!mod || !mod.id) return;
    this.deactivateMod(mod.id);

    const assetUrlMap = new Map();
    const createdBlobUrls = [];
    const injectedStyles = [];
    let removalsStyleEl = null;
    let modError = null;

    // 1. Create Object URLs for all internal files
    if (mod.files && typeof URL !== 'undefined') {
      for (const [path, fileRec] of Object.entries(mod.files)) {
        try {
          const blob = new Blob([fileRec.bytes], { type: fileRec.mime || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          assetUrlMap.set(path, url);
          createdBlobUrls.push(url);
        } catch (err) {
          console.warn(`Gagal membuat URL blob untuk aset ${path}:`, err);
        }
      }
    }

    // 2. Ingest Styles (CSS)
    const entryStyles = mod.manifest?.entryStyles || [];
    if (typeof document !== 'undefined') {
      for (let i = 0; i < entryStyles.length; i++) {
        const stylePath = entryStyles[i].replace(/^\/+/, '');
        const fileRec = mod.files?.[stylePath];
        if (!fileRec || !fileRec.text) continue;

        let cssText = fileRec.text;

        // Automatically replace internal relative URLs with local Blob URLs
        for (const [assetPath, blobUrl] of assetUrlMap.entries()) {
          const regex = new RegExp(`(url\\(['"]?(?:\\.\\/|mod:\\/\\/)?)${escapeRegex(assetPath)}(['"]?\\))`, 'g');
          cssText = cssText.replace(regex, `$1${blobUrl}$2`);
        }

        const styleEl = document.createElement('style');
        styleEl.id = `mod-style-${mod.id}-${i}`;
        styleEl.dataset.modId = mod.id;
        styleEl.textContent = cssText;
        document.head.appendChild(styleEl);
        injectedStyles.push(styleEl);
      }

      // 3. Ingest Removals (Elements to hide/remove)
      const removals = mod.manifest?.removals || [];
      if (Array.isArray(removals) && removals.length > 0) {
        const validSelectors = removals.filter(s => typeof s === 'string' && s.trim());
        if (validSelectors.length > 0) {
          removalsStyleEl = document.createElement('style');
          removalsStyleEl.id = `mod-removals-${mod.id}`;
          removalsStyleEl.dataset.modId = mod.id;
          removalsStyleEl.textContent = `${validSelectors.join(',\n')} {\n  display: none !important;\n}\n`;
          document.head.appendChild(removalsStyleEl);
        }
      }
    }

    // 4. Ingest Scripts (JS) with AudiophileModAPI
    const api = new AudiophileModAPI(mod.id, mod.manifest, assetUrlMap);
    const entryScripts = mod.manifest?.entryScripts || [];

    for (const scriptPath of entryScripts) {
      const cleanPath = scriptPath.replace(/^\/+/, '');
      const fileRec = mod.files?.[cleanPath];
      if (!fileRec || !fileRec.text) continue;

      let executed = false;
      let scriptBlobUrl = null;
      try {
        const scriptBlob = new Blob([fileRec.text], { type: 'application/javascript' });
        scriptBlobUrl = URL.createObjectURL(scriptBlob);

        // Dynamically import ES module
        const modModule = await import(scriptBlobUrl);

        if (typeof modModule.default === 'function') {
          await modModule.default(api);
          executed = true;
        } else if (typeof modModule.init === 'function') {
          await modModule.init(api);
          executed = true;
        }
      } catch (importErr) {
        // Fallback for file:// or origins where dynamic blob import is restricted
      } finally {
        if (scriptBlobUrl) {
          try { URL.revokeObjectURL(scriptBlobUrl); } catch {}
        }
      }

      // Fallback: Safe Function Evaluation
      if (!executed) {
        try {
          let code = fileRec.text;
          code = code.replace(/export\s+default\s+function(?:\s+[\w$]+)?\s*\(([^)]*)\)\s*\{/, 'return (function($1) {');
          code = code.replace(/export\s+default\s*\(([^)]*)\)\s*=>/, 'return (($1) =>');
          code = code.replace(/export\s+default\s+([\w$]+)\s*;?$/, 'return $1;');
          const factory = new Function(code);
          const fn = factory();
          if (typeof fn === 'function') {
            await fn(api);
            executed = true;
          }
        } catch (fallbackErr) {
          modError = fallbackErr;
          console.error(`Galat saat mengeksekusi skrip mod "${mod.name}" (${scriptPath}):`, fallbackErr);
          toast.error(`Mod "${mod.name}" mengalami galat: ${fallbackErr.message || 'Sintaks salah'}`);
        }
      }
    }

    this.activeRuntimes.set(mod.id, {
      id: mod.id,
      name: mod.name,
      api,
      injectedStyles,
      removalsStyleEl,
      createdBlobUrls,
      error: modError
    });
  }

  /**
   * Deactivate and cleanly teardown an active mod
   * @param {string} modId 
   */
  deactivateMod(modId) {
    const runtime = this.activeRuntimes.get(modId);

    // 1. Run Mod API teardown (listeners, DOM, audio nodes)
    try {
      runtime?.api?.teardown();
    } catch (err) {
      console.warn(`Galat saat teardown API mod ${modId}:`, err);
    }

    // 2. Remove injected style tags from runtime tracker
    if (runtime?.injectedStyles) {
      for (const el of runtime.injectedStyles) {
        try { el.remove(); } catch {}
      }
    }

    // 3. Remove removals style tag from runtime tracker
    if (runtime?.removalsStyleEl) {
      try { runtime.removalsStyleEl.remove(); } catch {}
    }

    // 4. Revoke asset Blob URLs
    if (runtime?.createdBlobUrls) {
      for (const url of runtime.createdBlobUrls) {
        try { URL.revokeObjectURL(url); } catch {}
      }
    }

    // 5. Direct DOM Purge: remove ALL style tags and injected elements for this mod
    if (typeof document !== 'undefined') {
      document.querySelectorAll(
        `style[data-mod-id="${modId}"], style[id^="mod-style-${modId}"], style[id^="mod-removals-${modId}"]`
      ).forEach(el => {
        try { el.remove(); } catch {}
      });

      document.querySelectorAll(
        `[id*="-${modId}-"], [data-mod-id="${modId}"], .mod-injected-btn, .mod-injected-nav`
      ).forEach(el => {
        try { el.remove(); } catch {}
      });

      // Restore active theme attribute so native theme CSS applies immediately
      const currentTheme = settings.get('theme', 'dark');
      document.documentElement.setAttribute('data-theme', currentTheme);
    }

    this.activeRuntimes.delete(modId);
  }

  /**
   * Deactivate all active mods
   */
  deactivateAll() {
    const ids = Array.from(this.activeRuntimes.keys());
    for (const id of ids) {
      this.deactivateMod(id);
    }

    if (typeof document !== 'undefined') {
      document.querySelectorAll('style[data-mod-id], style[id^="mod-style-"], style[id^="mod-removals-"]').forEach(el => {
        try { el.remove(); } catch {}
      });
      document.querySelectorAll('.mod-injected-btn, .mod-injected-nav, [id^="mod-btn-"], [id^="mod-dock-"]').forEach(el => {
        try { el.remove(); } catch {}
      });
      const currentTheme = settings.get('theme', 'dark');
      document.documentElement.setAttribute('data-theme', currentTheme);
    }
    this.activeRuntimes.clear();
  }

  /**
   * Check if a mod has an active runtime error
   * @param {string} modId 
   * @returns {Error|null}
   */
  getModError(modId) {
    return this.activeRuntimes.get(modId)?.error || null;
  }
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const modLoader = new ModLoader();
