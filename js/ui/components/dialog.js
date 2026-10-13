/**
 * dialog.js - Accessible modal dialogs (confirm, prompt, custom modal content)
 */

import { escapeHtml } from '../../core/utils.js';
import { getIconSvg } from '../icons.js';
import { t } from '../../core/i18n.js';

class DialogManager {
  /**
   * Display confirmation dialog
   * @param {string|Object} titleOrOptions
   * @param {string} [message]
   * @param {string} [confirmText]
   * @param {string} [cancelText]
   * @returns {Promise<boolean>}
   */
  confirm(titleOrOptions, message, confirmText = null, cancelText = null) {
    let title = titleOrOptions;
    if (typeof titleOrOptions === 'object' && titleOrOptions !== null) {
      title = titleOrOptions.title || '';
      message = titleOrOptions.message || '';
      confirmText = titleOrOptions.confirmText || confirmText;
      cancelText = titleOrOptions.cancelText || cancelText;
    }

    const resolvedConfirmText = confirmText || t('common.yes');
    const resolvedCancelText = cancelText || t('common.cancel');

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay active';

      overlay.innerHTML = `
        <div class="dialog-box" role="dialog" aria-modal="true">
          <div class="dialog-header">
            <h4>${escapeHtml(title)}</h4>
          </div>
          <div class="dialog-body">
            <p style="color:var(--text-muted); font-size:0.88rem;">${escapeHtml(message)}</p>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-cancel">${escapeHtml(resolvedCancelText)}</button>
            <button class="btn btn-primary btn-confirm">${escapeHtml(resolvedConfirmText)}</button>
          </div>
        </div>
      `;

      const cleanup = (result) => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 150);
        resolve(result);
      };

      overlay.querySelector('.btn-cancel').addEventListener('click', () => cleanup(false));
      overlay.querySelector('.btn-confirm').addEventListener('click', () => cleanup(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup(false);
      });

      document.body.appendChild(overlay);
    });
  }

  /**
   * Display accessible alert dialog
   * @param {string|Object} titleOrOptions
   * @param {string} [message]
   * @param {string} [buttonText='Tutup']
   * @returns {Promise<void>}
   */
  alert(titleOrOptions, message, buttonText = null) {
    let title = titleOrOptions;
    if (typeof titleOrOptions === 'object' && titleOrOptions !== null) {
      title = titleOrOptions.title || '';
      message = titleOrOptions.message || '';
      buttonText = titleOrOptions.buttonText || buttonText;
    }

    const resolvedButtonText = buttonText || t('common.close');

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay active';

      overlay.innerHTML = `
        <div class="dialog-box" role="dialog" aria-modal="true">
          <div class="dialog-header">
            <h4>${escapeHtml(title)}</h4>
          </div>
          <div class="dialog-body">
            <p style="color:var(--text-muted); font-size:0.88rem;">${escapeHtml(message)}</p>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-primary btn-alert-ok">${escapeHtml(resolvedButtonText)}</button>
          </div>
        </div>
      `;

      const cleanup = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 150);
        resolve();
      };

      overlay.querySelector('.btn-alert-ok').addEventListener('click', cleanup);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup();
      });

      document.body.appendChild(overlay);
    });
  }

  /**
   * Display text prompt dialog
   * @param {string} title 
   * @param {string} message 
   * @param {string} [defaultValue=''] 
   * @param {string} [placeholder=''] 
   * @returns {Promise<string|null>}
   */
  prompt(title, message, defaultValue = '', placeholder = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay active';

      overlay.innerHTML = `
        <div class="dialog-box" role="dialog" aria-modal="true">
          <div class="dialog-header">
            <h4>${escapeHtml(title)}</h4>
          </div>
          <div class="dialog-body">
            <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:12px;">${escapeHtml(message)}</p>
            <input type="text" class="input dialog-prompt-input" style="width:100%;" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}" />
          </div>
          <div class="dialog-footer">
            <button class="btn btn-cancel">${escapeHtml(t('common.cancel'))}</button>
            <button class="btn btn-primary btn-confirm">${escapeHtml(t('common.save'))}</button>
          </div>
        </div>
      `;

      const input = overlay.querySelector('.dialog-prompt-input');

      const cleanup = (result) => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 150);
        resolve(result);
      };

      overlay.querySelector('.btn-cancel').addEventListener('click', () => cleanup(null));
      overlay.querySelector('.btn-confirm').addEventListener('click', () => cleanup(input.value.trim()));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') cleanup(input.value.trim());
        if (e.key === 'Escape') cleanup(null);
      });

      document.body.appendChild(overlay);
      setTimeout(() => input.focus(), 50);
    });
  }

  /**
   * Display custom content dialog
   * @param {Object} options 
   * @param {string} options.title 
   * @param {HTMLElement|string} options.content 
   * @param {Array<{ label: string, primary?: boolean, danger?: boolean, onClick: Function }>} [options.buttons]
   */
  showCustom({ title, content, buttons = [] }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay active';

      const box = document.createElement('div');
      box.className = 'dialog-box';

      const header = document.createElement('div');
      header.className = 'dialog-header';
      header.innerHTML = `<h4>${escapeHtml(title)}</h4><button class="btn btn-icon btn-close" aria-label="${escapeHtml(t('common.close'))}">${getIconSvg('close', { size: 18 })}</button>`;
      box.appendChild(header);

      const body = document.createElement('div');
      body.className = 'dialog-body';
      if (typeof content === 'string') body.innerHTML = content;
      else body.appendChild(content);
      box.appendChild(body);

      const footer = document.createElement('div');
      footer.className = 'dialog-footer';

      const closeDialog = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 150);
        resolve();
      };

      header.querySelector('.btn-close').addEventListener('click', closeDialog);

      buttons.forEach(btnConfig => {
        const btn = document.createElement('button');
        btn.className = `btn ${btnConfig.primary ? 'btn-primary' : ''} ${btnConfig.danger ? 'btn-danger' : ''}`;
        btn.innerText = btnConfig.label;
        btn.addEventListener('click', async (e) => {
          if (btnConfig.onClick) {
            const shouldClose = await btnConfig.onClick(overlay);
            if (shouldClose !== false) closeDialog();
          } else {
            closeDialog();
          }
        });
        footer.appendChild(btn);
      });

      box.appendChild(footer);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  /**
   * Close all active dialog overlays
   */
  close() {
    if (typeof document === 'undefined') return;
    const overlays = document.querySelectorAll('.dialog-overlay');
    overlays.forEach(overlay => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 150);
    });
  }
}

export const dialog = new DialogManager();
