/**
 * toast.js - Toast notifications with optional "Urungkan" (Undo) button
 */

import { escapeHtml } from '../../core/utils.js';
import { t } from '../../core/i18n.js';

class ToastManager {
  constructor() {
    this.region = null;
  }

  ensureRegion() {
    if (!this.region) {
      this.region = document.getElementById('toastRegion');
      if (!this.region) {
        this.region = document.createElement('div');
        this.region.id = 'toastRegion';
        document.body.appendChild(this.region);
      }
    }
  }

  /**
   * Show a toast message
   * @param {string} message 
   * @param {Object} [options] 
   * @param {'info'|'success'|'error'} [options.type='info'] 
   * @param {number} [options.duration=3800] 
   * @param {Function} [options.onUndo] Callback when user clicks Undo
   * @param {string} [options.undoLabel]
   */
  show(message, options = {}) {
    this.ensureRegion();
    const { type = 'info', duration = 4000, onUndo, undoLabel = t('common.undo'), action, actions } = options;

    const toastEl = document.createElement('div');
    toastEl.className = 'toast';
    if (type === 'error') toastEl.style.borderColor = 'var(--status-danger)';
    if (type === 'success') toastEl.style.borderColor = 'var(--status-verified)';

    const msgSpan = document.createElement('span');
    msgSpan.innerText = message;
    toastEl.appendChild(msgSpan);

    // Support action buttons (e.g. [Buka Antrean], [Putar Sekarang])
    const allActions = [];
    if (action && typeof action.onClick === 'function') allActions.push(action);
    if (Array.isArray(actions)) {
      actions.forEach(a => { if (a && typeof a.onClick === 'function') allActions.push(a); });
    }

    allActions.forEach(act => {
      const actBtn = document.createElement('button');
      actBtn.className = 'toast-action-btn';
      actBtn.innerText = act.label || t('common.open');
      actBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          act.onClick();
        } catch (err) {
          console.error('Toast action callback error:', err);
        }
        toastEl.remove();
      });
      toastEl.appendChild(actBtn);
    });

    if (typeof onUndo === 'function') {
      const undoBtn = document.createElement('button');
      undoBtn.className = 'toast-undo-btn';
      undoBtn.innerText = undoLabel;
      undoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          onUndo();
        } catch (err) {
          console.error('Undo callback error:', err);
        }
        toastEl.remove();
      });
      toastEl.appendChild(undoBtn);
    }

    this.region.appendChild(toastEl);

    let dismissTimer = null;
    const startDismiss = (ms) => {
      dismissTimer = setTimeout(() => {
        if (toastEl.parentNode) toastEl.remove();
      }, ms);
    };

    // Pause dismissal on mouse hover so user can easily click action buttons
    toastEl.addEventListener('mouseenter', () => {
      if (dismissTimer) clearTimeout(dismissTimer);
    });

    toastEl.addEventListener('mouseleave', () => {
      startDismiss(1800);
    });

    startDismiss(duration);
  }

  success(msg, opts) { this.show(msg, { ...opts, type: 'success' }); }
  error(msg, opts) { this.show(msg, { ...opts, type: 'error' }); }
  warning(msg, opts) { this.show(msg, { ...opts, type: 'error' }); }
  info(msg, opts) { this.show(msg, { ...opts, type: 'info' }); }
}

export const toast = new ToastManager();
