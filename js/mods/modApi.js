/**
 * modApi.js - Official Audiophile Modding SDK
 * Exposes a sandboxed, clean, and safe API for client-side JavaScript mods.
 * All registered listeners, DOM elements, and audio nodes are tracked
 * for automatic, leak-free teardown when a mod is disabled or uninstalled.
 */

import { events } from '../core/events.js';
import { store } from '../core/store.js';
import { engine } from '../player/engine.js';
import { toast } from '../ui/components/toast.js';
import { db } from '../db/db.js';
import { playerBar } from '../ui/components/playerBar.js';

export class AudiophileModAPI {
  /**
   * @param {string} modId 
   * @param {Object} manifest 
   * @param {Map<string, string>} assetUrlMap - Map of internal file paths to local Blob URLs
   */
  constructor(modId, manifest, assetUrlMap = new Map()) {
    this.id = modId;
    this.manifest = Object.freeze({ ...manifest });
    this.assetUrlMap = assetUrlMap;

    this._eventListeners = [];
    this._storeUnsubscribers = [];
    this._injectedDomElements = [];
    this._hiddenElements = [];
    this._dspNodes = new Map();
    this._teardownCallbacks = [];

    this._setupSubApis();
  }

  _setupSubApis() {
    const self = this;

    // 1. UI Sub-API
    this.ui = {
      /**
       * Add a custom button to the bottom player bar
       * @param {Object} options
       * @param {string} options.id - Unique ID
       * @param {string} options.title - Tooltip text
       * @param {string} options.iconSvg - Inner SVG icon
       * @param {Function} options.onClick - Click handler
       * @param {'left'|'center'|'right'} [options.section='right']
       * @returns {HTMLElement|null}
       */
      addPlayerButton({ id, title, iconSvg, onClick, section = 'right' }) {
        if (typeof document === 'undefined') return null;
        const targetContainer = document.querySelector(`.player-${section}`) || document.querySelector('.player-right');
        if (!targetContainer) return null;

        const btn = document.createElement('button');
        btn.id = `mod-btn-${self.id}-${id}`;
        btn.className = 'btn btn-icon mod-injected-btn';
        btn.title = title || '';
        btn.setAttribute('aria-label', title || '');
        btn.innerHTML = iconSvg || '';
        if (typeof onClick === 'function') {
          btn.addEventListener('click', onClick);
        }

        const volWrapper = targetContainer.querySelector('.volume-control-wrapper');
        if (volWrapper) {
          targetContainer.insertBefore(btn, volWrapper);
        } else {
          targetContainer.appendChild(btn);
        }
        self._injectedDomElements.push(btn);
        return btn;
      },

      /**
       * Add a custom navigation button to the left dock
       * @param {Object} options
       * @param {string} options.id
       * @param {string} options.label
       * @param {string} options.iconSvg
       * @param {Function} options.onClick
       * @returns {HTMLElement|null}
       */
      addDockItem({ id, label, iconSvg, onClick }) {
        if (typeof document === 'undefined') return null;
        const navList = document.querySelector('.dock-nav-list');
        if (!navList) return null;

        const btn = document.createElement('button');
        btn.id = `mod-dock-${self.id}-${id}`;
        btn.className = 'nav-item mod-injected-nav';
        btn.title = label || '';
        btn.innerHTML = `
          ${iconSvg || ''}
          <span>${label || ''}</span>
        `;
        if (typeof onClick === 'function') {
          btn.addEventListener('click', onClick);
        }

        navList.appendChild(btn);
        self._injectedDomElements.push(btn);
        return btn;
      },

      /**
       * Hide a native UI element
       * @param {string} selector 
       */
      hideElement(selector) {
        if (typeof document === 'undefined') return;
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (!el.dataset.modHidden) {
            el.dataset.modHidden = self.id;
            el.dataset.origDisplay = el.style.display || '';
            el.style.display = 'none';
            self._hiddenElements.push(el);
          }
        });
      },

      /**
       * Alias for hideElement
       * @param {string} selector 
       */
      removeElement(selector) {
        this.hideElement(selector);
      },

      /**
       * Render a sleek glass modal dialog
       * @param {Object} modalOptions
       * @param {string} modalOptions.title
       * @param {string} modalOptions.contentHtml
       * @param {Function} [modalOptions.onClose]
       */
      showModal({ title, contentHtml, onClose }) {
        if (typeof document === 'undefined') return;
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay mod-dialog-overlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0, 0, 0, 0.7)';
        overlay.style.backdropFilter = 'blur(10px)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '99999';

        overlay.innerHTML = `
          <div class="glass-panel" style="max-width:520px; width:90%; padding:24px; border-radius:var(--radius-lg); border:1px solid var(--glass-border-specular); background:var(--glass-bg-elevated); box-shadow:0 24px 60px rgba(0,0,0,0.6);">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
              <h3 style="margin:0; font-size:1.15rem; font-weight:700; color:var(--text-main);">${title || 'Mod Dialog'}</h3>
              <button class="btn btn-icon btn-close" id="btnCloseModModal" title="Tutup" aria-label="Tutup">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59 7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12 5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z"/></svg>
              </button>
            </div>
            <div style="color:var(--text-muted); font-size:0.9rem; line-height:1.5;">${contentHtml || ''}</div>
          </div>
        `;

        const closeBtn = overlay.querySelector('#btnCloseModModal');
        const dismiss = () => {
          overlay.remove();
          if (typeof onClose === 'function') onClose();
        };
        closeBtn?.addEventListener('click', dismiss);
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) dismiss();
        });

        document.body.appendChild(overlay);
        self._injectedDomElements.push(overlay);
        return { close: dismiss };
      },

      /**
       * Register a custom waveform drawer for the player seekbar
       * @param {Object} drawer - Object implementing draw(playerBar), and optional triggerWiggle(targetX, force, playerBar)
       */
      setCustomWaveform(drawer) {
        playerBar.setCustomWaveformDrawer(drawer);
        self.onTeardown(() => {
          if (playerBar.customWaveformDrawer === drawer) {
            playerBar.setCustomWaveformDrawer(null);
          }
        });
      }
    };

    // 2. Audio Sub-API
    this.audio = {
      /**
       * Get reference to active Web Audio AudioContext
       * @returns {AudioContext|null}
       */
      getContext() {
        return engine?.audioCtx || null;
      },

      /**
       * Insert a custom DSP effect node into the Web Audio graph
       * @param {string} nodeId - Unique DSP node name
       * @param {Function} createNodeFn - (audioCtx) => AudioNode
       */
      registerDspNode(nodeId, createNodeFn) {
        if (!engine?.audioCtx || typeof createNodeFn !== 'function') return null;
        try {
          const customNode = createNodeFn(engine.audioCtx);
          if (customNode && customNode.connect) {
            // Hook safely into master preamp node
            if (engine.preampGainNode) {
              engine.preampGainNode.connect(customNode);
              if (engine.eqNodes?.[0]) {
                customNode.connect(engine.eqNodes[0]);
              }
            }
            self._dspNodes.set(nodeId, customNode);
            return customNode;
          }
        } catch (err) {
          console.warn(`Mod ${self.id} gagal memasang node DSP ${nodeId}:`, err);
        }
        return null;
      },

      /**
       * Disconnect and remove a custom DSP effect node
       * @param {string} nodeId 
       */
      removeDspNode(nodeId) {
        const node = self._dspNodes.get(nodeId);
        if (node) {
          try {
            node.disconnect();
          } catch {}
          self._dspNodes.delete(nodeId);
        }
      },

      /**
       * Read raw FFT frequency data for visualizers
       * @returns {Uint8Array|null}
       */
      getFrequencyData() {
        if (!engine?.analyser) return null;
        const data = new Uint8Array(engine.analyser.frequencyBinCount);
        engine.analyser.getByteFrequencyData(data);
        return data;
      },

      /**
       * Read raw time-domain waveform data
       * @returns {Uint8Array|null}
       */
      getWaveformData() {
        if (!engine?.analyser) return null;
        const data = new Uint8Array(engine.analyser.frequencyBinCount);
        engine.analyser.getByteTimeDomainData(data);
        return data;
      }
    };

    // 3. Events Sub-API
    this.events = {
      /**
       * Listen to application event
       * @param {string} eventName 
       * @param {Function} handler 
       */
      on(eventName, handler) {
        if (typeof handler !== 'function') return;
        events.on(eventName, handler);
        self._eventListeners.push({ eventName, handler });
      },

      /**
       * Remove event listener
       * @param {string} eventName 
       * @param {Function} handler 
       */
      off(eventName, handler) {
        events.off(eventName, handler);
        self._eventListeners = self._eventListeners.filter(
          l => !(l.eventName === eventName && l.handler === handler)
        );
      },

      /**
       * Emit custom event
       * @param {string} eventName 
       * @param {*} data 
       */
      emit(eventName, data) {
        events.emit(eventName, data);
      }
    };

    // 4. Store Sub-API
    this.store = {
      /**
       * Get global store value
       * @param {string} key 
       * @returns {*}
       */
      get(key) {
        return store.get(key);
      },

      /**
       * Subscribe to global store changes
       * @param {string} key 
       * @param {Function} callback 
       * @returns {Function} Unsubscribe function
       */
      subscribe(key, callback) {
        const unsub = store.subscribe(key, callback);
        self._storeUnsubscribers.push(unsub);
        return unsub;
      }
    };

    // 5. Toast Sub-API
    this.toast = {
      info: (msg, opts) => toast.info(msg, opts),
      success: (msg, opts) => toast.success(msg, opts),
      error: (msg, opts) => toast.error(msg, opts),
      warning: (msg, opts) => toast.warning(msg, opts)
    };

    // 6. Storage Sub-API (Scoped per Mod)
    this.storage = {
      async get(key, defaultValue = null) {
        const dbKey = `mod_data:${self.id}:${key}`;
        try {
          const rec = await db.get('settings', dbKey);
          return rec ? rec.data : defaultValue;
        } catch {
          return defaultValue;
        }
      },
      async set(key, value) {
        const dbKey = `mod_data:${self.id}:${key}`;
        try {
          await db.put('settings', { key: dbKey, data: value });
          return true;
        } catch {
          return false;
        }
      },
      async remove(key) {
        const dbKey = `mod_data:${self.id}:${key}`;
        try {
          await db.delete('settings', dbKey);
          return true;
        } catch {
          return false;
        }
      }
    };
  }

  /**
   * Resolve an internal file from the mod ZIP to an Object URL
   * @param {string} relativePath 
   * @returns {string|null}
   */
  resolveAssetUrl(relativePath) {
    if (!relativePath) return null;
    const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    return this.assetUrlMap.get(clean) || null;
  }

  /**
   * Register a custom cleanup function to be executed when mod is disabled
   * @param {Function} callback 
   */
  onTeardown(callback) {
    if (typeof callback === 'function') {
      this._teardownCallbacks.push(callback);
    }
  }

  /**
   * Execute comprehensive, leak-free teardown of all mod side-effects
   */
  teardown() {
    // 1. Run custom teardown callbacks
    for (const fn of this._teardownCallbacks) {
      try {
        fn();
      } catch (err) {
        console.warn(`Galat saat menjalankan teardown mod ${this.id}:`, err);
      }
    }
    this._teardownCallbacks = [];

    // 2. Remove all injected DOM elements
    for (const el of this._injectedDomElements) {
      try {
        el.remove();
      } catch {}
    }
    this._injectedDomElements = [];

    // 3. Restore all hidden elements
    for (const el of this._hiddenElements) {
      try {
        if (el.dataset.modHidden === this.id) {
          el.style.display = el.dataset.origDisplay || '';
          delete el.dataset.modHidden;
          delete el.dataset.origDisplay;
        }
      } catch {}
    }
    this._hiddenElements = [];

    // 4. Disconnect all custom DSP audio nodes
    for (const [nodeId, node] of this._dspNodes.entries()) {
      try {
        node.disconnect();
      } catch {}
    }
    this._dspNodes.clear();

    // 5. Remove all registered event listeners
    for (const { eventName, handler } of this._eventListeners) {
      try {
        events.off(eventName, handler);
      } catch {}
    }
    this._eventListeners = [];

    // 6. Unsubscribe from store
    for (const unsub of this._storeUnsubscribers) {
      try {
        if (typeof unsub === 'function') unsub();
      } catch {}
    }
    this._storeUnsubscribers = [];
  }
}
