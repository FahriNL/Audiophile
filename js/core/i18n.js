/**
 * i18n.js - Localization manager
 */

import id from '../i18n/id.js';
import en from '../i18n/en.js';
import { store } from './store.js';
import { events } from './events.js';

const translations = { id, en };

class I18nManager {
  constructor() {
    this.locale = 'id';
  }

  init(loc = 'id') {
    if (translations[loc]) {
      this.locale = loc;
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('lang', this.locale);
    }
    this.applyToDOM();
  }

  setLocale(loc) {
    if (translations[loc]) {
      this.locale = loc;
      const settings = store.get('settings') || {};
      store.set('settings', { ...settings, lang: loc });
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.setAttribute('lang', loc);
      }
      this.applyToDOM();
      events.emit('i18n:changed', loc);
    }
  }

  applyToDOM(root = (typeof document !== 'undefined' ? document : null)) {
    if (!root || typeof root.querySelectorAll !== 'function') return;

    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = this.t(key);
    });

    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = this.t(key);
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = this.t(key);
    });

    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.title = this.t(key);
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label');
      if (key) el.setAttribute('aria-label', this.t(key));
    });
  }

  getLocale() {
    return this.locale;
  }

  /**
   * Translate a key path (e.g. 'app.title') with optional params interpolation
   * @param {string} keyPath 
   * @param {Object} [params] 
   * @returns {string}
   */
  t(keyPath, params = {}) {
    const keys = keyPath.split('.');
    let res = translations[this.locale];
    for (const k of keys) {
      if (res && res[k] !== undefined) {
        res = res[k];
      } else {
        // Fallback to Indonesian if key missing
        let fallback = translations['id'];
        for (const fk of keys) {
          if (fallback && fallback[fk] !== undefined) fallback = fallback[fk];
          else { fallback = keyPath; break; }
        }
        res = fallback;
        break;
      }
    }

    if (typeof res === 'string') {
      return res.replace(/{(\w+)}/g, (_, match) => params[match] !== undefined ? params[match] : `{${match}}`);
    }
    return keyPath;
  }
}

export const i18n = new I18nManager();
export const t = (key, params) => i18n.t(key, params);
