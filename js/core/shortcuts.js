/**
 * shortcuts.js - Comprehensive keyboard shortcut management & custom key mapping
 *
 * Implements UX-01:
 * - Configurable shortcut mappings with conflict detection (system browser conflicts & duplicate actions).
 * - Key recorder ("Tekan tombol...") capturing modifiers (Ctrl, Alt, Shift) + key.
 * - Reset to defaults, export/import JSON configurations.
 * - Respects active text inputs, textareas, and contenteditable elements.
 * - Quick reference help modal ("?") and tooltip integration.
 * - Explanatory guidance: Tab-active shortcut execution vs. OS Media Session hardware keys.
 */

import { store } from './store.js';
import { settings } from './settings.js';
import { engine } from '../player/engine.js';
import { queueManager } from '../player/queue.js';
import { router } from './router.js';
import { toast } from '../ui/components/toast.js';
import { escapeHtml } from './utils.js';
import { getIconSvg } from '../ui/icons.js';

export const DEFAULT_SHORTCUTS = {
  play_pause: { code: 'Space', label: 'Putar / Jeda' },
  next: { code: 'Alt+ArrowRight', label: 'Lagu Berikutnya' },
  prev: { code: 'Alt+ArrowLeft', label: 'Lagu Sebelumnya' },
  seek_backward_5: { code: 'ArrowLeft', label: 'Mundur 5 Detik' },
  seek_forward_5: { code: 'ArrowRight', label: 'Maju 5 Detik' },
  seek_backward_10: { code: 'KeyJ', label: 'Mundur 10 Detik' },
  seek_forward_10: { code: 'KeyL', label: 'Maju 10 Detik' },
  volume_up: { code: 'ArrowUp', label: 'Volume Naik 5%' },
  volume_down: { code: 'ArrowDown', label: 'Volume Turun 5%' },
  mute: { code: 'KeyM', label: 'Bisukan / Bunyikan' },
  shuffle: { code: 'KeyS', label: 'Acak Pemutaran' },
  repeat: { code: 'KeyR', label: 'Ulangi (Semua/Satu/Mati)' },
  toggle_lyrics: { code: 'KeyC', label: 'Lirik Layar Penuh' },
  toggle_queue: { code: 'KeyQ', label: 'Buka / Tutup Antrean' },
  search: { code: 'Ctrl+KeyK', label: 'Cari Musik' },
  toggle_favorite: { code: 'KeyF', label: 'Tandai / Hapus Favorit' },
  toggle_eq: { code: 'KeyE', label: 'Buka Pengaturan Equalizer' },
  toggle_night_mode: { code: 'KeyB', label: 'Mode Malam Audio' },
  help: { code: 'Slash', shift: true, label: 'Bantuan Pintasan (?)' }
};

export const SYSTEM_RESERVED_SHORTCUTS = new Set([
  'Ctrl+KeyT',
  'Ctrl+KeyW',
  'Ctrl+KeyN',
  'Ctrl+KeyL',
  'Ctrl+KeyR',
  'F5',
  'Ctrl+Shift+KeyI',
  'Ctrl+KeyP',
  'Ctrl+KeyS',
  'Ctrl+KeyF',
  'Ctrl+KeyH',
  'Ctrl+KeyJ',
  'Ctrl+KeyU'
]);

export class ShortcutManager {
  constructor() {
    this.shortcuts = {};
    for (const [key, val] of Object.entries(DEFAULT_SHORTCUTS)) {
      this.shortcuts[key] = { ...val };
    }
    this.recordingActionId = null;
    this.recordCallback = null;
    this.isListening = false;
    this.helpModalElement = null;
  }

  /**
   * Initialize shortcuts from saved settings and attach global keydown listener
   */
  init() {
    this.loadSavedShortcuts();
    this.attachListener();
  }

  loadSavedShortcuts() {
    try {
      const saved = settings.get('customShortcuts', null);
      if (saved && typeof saved === 'object') {
        for (const [actionId, mapping] of Object.entries(saved)) {
          if (this.shortcuts[actionId] && mapping && mapping.code) {
            this.shortcuts[actionId] = {
              ...this.shortcuts[actionId],
              code: mapping.code,
              ctrl: !!mapping.ctrl,
              alt: !!mapping.alt,
              shift: !!mapping.shift
            };
          }
        }
      }
    } catch (err) {
      console.warn('Gagal memuat pintasan kustom:', err);
    }
  }

  saveShortcuts() {
    try {
      const toSave = {};
      for (const [actionId, item] of Object.entries(this.shortcuts)) {
        toSave[actionId] = {
          code: item.code,
          ctrl: !!item.ctrl,
          alt: !!item.alt,
          shift: !!item.shift
        };
      }
      settings.set('customShortcuts', toSave);
    } catch (err) {
      console.warn('Gagal menyimpan pintasan:', err);
    }
  }

  attachListener() {
    if (this.isListening) return;
    this.isListening = true;

    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  /**
   * Handle global keydown event
   * @param {KeyboardEvent} e
   */
  handleKeyDown(e) {
    // 1. If currently recording a shortcut
    if (this.recordingActionId) {
      e.preventDefault();
      e.stopPropagation();
      this.finishRecording(e);
      return;
    }

    // 2. Ignore key events when typing inside inputs, selects, or textareas
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) {
      return;
    }

    // 3. Match event against configured shortcuts
    const combo = this.eventToComboString(e);
    const actionId = this.findActionByCombo(combo, e);

    if (actionId) {
      e.preventDefault();
      this.executeAction(actionId);
    }
  }

  /**
   * Convert KeyboardEvent to canonical string representation, e.g. "Ctrl+KeyK", "Space", "Alt+ArrowRight"
   * @param {KeyboardEvent} e
   * @returns {string}
   */
  eventToComboString(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') parts.push('Shift');

    // Use code for consistency across keyboard layouts
    const code = e.code || e.key;
    parts.push(code);

    return parts.join('+');
  }

  /**
   * Match event to configured action
   * @param {string} combo
   * @param {KeyboardEvent} e
   * @returns {string|null} Action ID or null
   */
  findActionByCombo(combo, e) {
    for (const [actionId, mapping] of Object.entries(this.shortcuts)) {
      const matchCode = mapping.code === combo || mapping.code === e.code || mapping.code === e.key;
      const matchCtrl = !!mapping.ctrl === (e.ctrlKey || e.metaKey);
      const matchAlt = !!mapping.alt === e.altKey;
      const matchShift = !!mapping.shift === e.shiftKey;

      // Handle combined code strings like "Alt+ArrowRight"
      if (mapping.code.includes('+')) {
        if (mapping.code === combo) return actionId;
      } else if (matchCode && matchCtrl && matchAlt && matchShift) {
        return actionId;
      }
    }
    return null;
  }

  /**
   * Execute an application action triggered by shortcut
   * @param {string} actionId
   */
  executeAction(actionId) {
    switch (actionId) {
      case 'play_pause':
        if (store.get('isPlaying')) engine.pause();
        else engine.resume();
        break;

      case 'next':
        queueManager.next();
        break;

      case 'prev':
        queueManager.prev();
        break;

      case 'seek_backward_5':
        if (engine.activeAudio) {
          engine.seek(Math.max(0, engine.activeAudio.currentTime - 5));
        }
        break;

      case 'seek_forward_5':
        if (engine.activeAudio) {
          engine.seek(engine.activeAudio.currentTime + 5);
        }
        break;

      case 'seek_backward_10':
        if (engine.activeAudio) {
          engine.seek(Math.max(0, engine.activeAudio.currentTime - 10));
        }
        break;

      case 'seek_forward_10':
        if (engine.activeAudio) {
          engine.seek(engine.activeAudio.currentTime + 10);
        }
        break;

      case 'volume_up':
        if (engine.activeAudio) {
          const v = Math.min(1, Math.round((engine.activeAudio.volume + 0.05) * 100) / 100);
          engine.setVolume(v);
          toast.info(`Volume: ${Math.round(v * 100)}%`);
        }
        break;

      case 'volume_down':
        if (engine.activeAudio) {
          const v = Math.max(0, Math.round((engine.activeAudio.volume - 0.05) * 100) / 100);
          engine.setVolume(v);
          toast.info(`Volume: ${Math.round(v * 100)}%`);
        }
        break;

      case 'mute':
        if (engine.activeAudio) {
          if (engine.activeAudio.volume > 0) {
            this.savedMuteVolume = engine.activeAudio.volume;
            engine.setVolume(0);
            toast.info('Suara dibisukan');
          } else {
            const restore = this.savedMuteVolume || 0.8;
            engine.setVolume(restore);
            toast.info(`Volume: ${Math.round(restore * 100)}%`);
          }
        }
        break;

      case 'shuffle': {
        const curShuffle = store.get('shuffle');
        store.set('shuffle', !curShuffle);
        toast.info(!curShuffle ? 'Acak: Aktif' : 'Acak: Nonaktif');
        break;
      }

      case 'repeat': {
        const modes = ['none', 'all', 'one'];
        const curRepeat = store.get('repeatMode') || 'none';
        const nextIndex = (modes.indexOf(curRepeat) + 1) % modes.length;
        const nextMode = modes[nextIndex];
        store.set('repeatMode', nextMode);
        const labels = { none: 'Mati', all: 'Ulang Semua', one: 'Ulang Satu Lagu' };
        toast.info(`Ulangi: ${labels[nextMode]}`);
        break;
      }

      case 'toggle_lyrics': {
        const fp = document.getElementById('fullPlayerModal');
        if (fp && fp.classList.contains('active')) {
          document.querySelector('.fp-tab-btn[data-fptab="lyrics"]')?.click();
          document.getElementById('btnNpTabLyrics')?.click();
        } else {
          document.getElementById('btnToggleLyricsDrawer')?.click();
        }
        break;
      }

      case 'toggle_queue': {
        document.getElementById('btnToggleQueueDrawer')?.click();
        break;
      }

      case 'search': {
        router.navigate('search');
        const searchInput = document.getElementById('searchInput') || document.getElementById('topQuickSearchInput');
        if (searchInput) {
          setTimeout(() => {
            searchInput.focus();
            searchInput.select?.();
          }, 50);
        }
        break;
      }

      case 'toggle_favorite': {
        const btnFav = document.getElementById('fpBtnFav') || document.getElementById('fsBtnFav');
        if (btnFav) {
          btnFav.click();
        }
        break;
      }

      case 'toggle_eq':
        router.navigate('settings', { tab: 'engine' });
        break;

      case 'toggle_night_mode': {
        const btnNight = document.getElementById('btnToggleNightMode');
        if (btnNight) btnNight.click();
        break;
      }

      case 'help':
        this.openHelpDialog();
        break;
    }
  }

  /**
   * Start recording key sequence for an action
   * @param {string} actionId
   * @param {Function} callback (result: { code, conflictWarning }) => void
   */
  startRecording(actionId, callback) {
    this.recordingActionId = actionId;
    this.recordCallback = callback;
  }

  cancelRecording() {
    this.recordingActionId = null;
    this.recordCallback = null;
  }

  finishRecording(e) {
    // Ignore pure modifier presses
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    // Escape cancels recording
    if (e.key === 'Escape') {
      const cb = this.recordCallback;
      this.cancelRecording();
      if (cb) cb({ cancelled: true });
      return;
    }

    const combo = this.eventToComboString(e);
    const actionId = this.recordingActionId;
    const cb = this.recordCallback;
    this.cancelRecording();

    // 1. Conflict detection with browser shortcuts
    const isSystemConflict = SYSTEM_RESERVED_SHORTCUTS.has(combo);

    // 2. Conflict detection with another existing action
    let otherActionConflict = null;
    for (const [otherId, item] of Object.entries(this.shortcuts)) {
      if (otherId !== actionId && item.code === combo) {
        otherActionConflict = {
          actionId: otherId,
          label: item.label
        };
        break;
      }
    }

    if (cb) {
      cb({
        actionId,
        combo,
        isSystemConflict,
        otherActionConflict
      });
    }
  }

  /**
   * Set custom shortcut mapping for an action
   * @param {string} actionId
   * @param {string} combo
   */
  setShortcut(actionId, combo) {
    if (!this.shortcuts[actionId]) return;

    // Remove this combo from any existing conflicting action
    for (const [otherId, item] of Object.entries(this.shortcuts)) {
      if (otherId !== actionId && item.code === combo) {
        item.code = '';
      }
    }

    this.shortcuts[actionId] = {
      ...this.shortcuts[actionId],
      code: combo
    };

    this.saveShortcuts();
  }

  /**
   * Get all active shortcuts
   * @returns {Object}
   */
  getShortcuts() {
    return { ...this.shortcuts };
  }

  /**
   * Get shortcut details for an action
   * @param {string} actionId
   * @returns {Object|null}
   */
  getShortcut(actionId) {
    return this.shortcuts[actionId] || null;
  }

  /**
   * Reset a single action shortcut to its default
   * @param {string} actionId
   */
  resetSingleShortcut(actionId) {
    if (DEFAULT_SHORTCUTS[actionId]) {
      this.shortcuts[actionId] = { ...DEFAULT_SHORTCUTS[actionId] };
      this.saveShortcuts();
    }
  }

  /**
   * Reset all shortcuts to factory defaults
   */
  resetToDefaults() {
    this.shortcuts = {};
    for (const [key, val] of Object.entries(DEFAULT_SHORTCUTS)) {
      this.shortcuts[key] = { ...val };
    }
    settings.set('customShortcuts', null);
  }

  /**
   * Export shortcut configurations to JSON string
   * @returns {string}
   */
  exportJson() {
    const exportData = {
      app: 'Audiophile',
      type: 'keyboard_shortcuts',
      version: '0.9.3',
      exportedAt: new Date().toISOString(),
      shortcuts: this.shortcuts
    };
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import shortcut configurations from JSON string
   * @param {string} jsonString
   * @returns {{ success: boolean, count: number, error?: string }}
   */
  importJson(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data.shortcuts || typeof data.shortcuts !== 'object') {
        return { success: false, count: 0, error: 'Format berkas pintasan tidak valid.' };
      }

      let count = 0;
      for (const [actionId, item] of Object.entries(data.shortcuts)) {
        if (this.shortcuts[actionId] && item.code) {
          this.shortcuts[actionId].code = item.code;
          count++;
        }
      }

      this.saveShortcuts();
      return { success: true, count };
    } catch (err) {
      return { success: false, count: 0, error: 'Gagal mengurai berkas JSON: ' + err.message };
    }
  }

  /**
   * Format shortcut code for friendly UI presentation
   * @param {string} combo
   * @returns {string}
   */
  formatDisplay(combo) {
    if (!combo) return 'Tidak diatur';
    return combo
      .replace(/Key([A-Z])/g, '$1')
      .replace(/Digit([0-9])/g, '$1')
      .replace(/ArrowRight/g, 'Panah Kanan')
      .replace(/ArrowLeft/g, 'Panah Kiri')
      .replace(/ArrowUp/g, 'Panah Atas')
      .replace(/ArrowDown/g, 'Panah Bawah')
      .replace(/Space/g, 'Spasi')
      .replace(/Slash/g, '?')
      .replace(/\+/g, ' + ');
  }

  /**
   * Open Help Modal ("?") listing all keyboard shortcuts
   */
  openHelpDialog() {
    if (this.helpModalElement) {
      this.helpModalElement.remove();
      this.helpModalElement = null;
    }

    const overlay = document.createElement('div');
    overlay.className = 'metadata-editor-overlay';
    overlay.id = 'shortcutHelpOverlay';

    overlay.innerHTML = `
      <div class="metadata-editor-card" style="max-width:680px;" role="dialog" aria-modal="true" aria-labelledby="shortcutHelpTitle">
        <div class="metadata-editor-header">
          <div style="display:flex; align-items:center; gap:10px;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8"/>
            </svg>
            <div>
              <h3 class="metadata-editor-title" id="shortcutHelpTitle">Pintasan Keyboard Audiophile</h3>
              <p class="metadata-editor-sub">Kendalikan pemutar audio secara cepat menggunakan keyboard</p>
            </div>
          </div>
          <button class="btn btn-icon metadata-editor-close" id="btnHelpClose" aria-label="Tutup">${getIconSvg('close', { size: 18 })}</button>
        </div>

        <div style="background:rgba(59, 130, 246, 0.1); border:1px solid rgba(59, 130, 246, 0.25); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:14px; font-size:0.78rem; color:var(--text-main); line-height:1.45;">
          <strong>Catatan:</strong> Pintasan keyboard aktif saat tab Audiophile sedang dibuka. Tombol fisik media pada keyboard/headset (Play, Next, Prev) dikelola otomatis oleh Media Session sistem operasi.
        </div>

        <div style="max-height:360px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); margin-bottom:16px;">
          <table style="width:100%; border-collapse:collapse; font-size:0.82rem; text-align:left;">
            <thead>
              <tr style="background:rgba(255,255,255,0.04); border-bottom:1px solid var(--border-subtle);">
                <th style="padding:10px 14px; font-weight:600; color:var(--text-dim);">Aksi Pemutar</th>
                <th style="padding:10px 14px; font-weight:600; color:var(--accent-light); text-align:right;">Tombol</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(this.shortcuts).map(([actionId, item]) => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                  <td style="padding:8px 14px; color:var(--text-main);">
                    ${escapeHtml(item.label)}
                  </td>
                  <td style="padding:8px 14px; text-align:right;">
                    <kbd style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.18); border-radius:4px; padding:3px 8px; font-family:var(--font-mono); font-size:0.75rem; color:var(--accent-light);">
                      ${escapeHtml(this.formatDisplay(item.code))}
                    </kbd>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="metadata-editor-footer" style="display:flex; justify-content:space-between; align-items:center;">
          <button type="button" class="btn btn-secondary btn-sm" id="btnHelpGoSettings">
            Atur Pintasan di Pengaturan
          </button>
          <button type="button" class="btn btn-primary" id="btnHelpDone">Tutup</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.helpModalElement = overlay;

    const close = () => {
      if (this.helpModalElement) {
        this.helpModalElement.remove();
        this.helpModalElement = null;
      }
    };

    overlay.querySelector('#btnHelpClose')?.addEventListener('click', close);
    overlay.querySelector('#btnHelpDone')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#btnHelpGoSettings')?.addEventListener('click', () => {
      close();
      router.navigate('settings', { tab: 'shortcuts' });
    });
  }
}

export const shortcutManager = new ShortcutManager();
