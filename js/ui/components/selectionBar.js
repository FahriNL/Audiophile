/**
 * selectionBar.js - Floating multi-select action bar
 * Accessible pure-icon action buttons (area >= 44px, aria-label, title tooltips)
 */

import { store } from '../../core/store.js';
import { queueManager } from '../../player/queue.js';
import { contextMenu } from './contextMenu.js';
import { toast } from './toast.js';
import { events } from '../../core/events.js';
import { t } from '../../core/i18n.js';

class SelectionBarManager {
  constructor() {
    this.barEl = null;
    this.countEl = null;
    this.btnPlay = null;
    this.btnQueue = null;
    this.btnPlaylist = null;
    this.btnCancel = null;
    this.init();
  }

  init() {
    if (typeof document === 'undefined') return;

    this.barEl = document.createElement('div');
    this.barEl.className = 'selection-bar';

    this.countEl = document.createElement('span');
    this.countEl.className = 'selection-count';
    this.barEl.appendChild(this.countEl);

    // Play Selected Button (Pure Icon, 48px accent)
    const btnPlay = document.createElement('button');
    btnPlay.className = 'btn btn-action-round btn-play-round';
    btnPlay.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="6 4 20 12 6 20 6 4"/>
      </svg>
    `;
    btnPlay.addEventListener('click', () => {
      const selected = this.getSelectedTracks();
      if (selected.length > 0) {
        queueManager.setQueue(selected, 0);
        this.clear();
      }
    });
    this.barEl.appendChild(btnPlay);
    this.btnPlay = btnPlay;

    // Add to Queue Button (Pure Icon, 44px)
    const btnQueue = document.createElement('button');
    btnQueue.className = 'btn btn-action-round';
    btnQueue.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    `;
    btnQueue.addEventListener('click', () => {
      const selected = this.getSelectedTracks();
      if (selected.length > 0) {
        queueManager.addToQueue(selected);
        toast.success(t('actions.addedQueueCount', { count: selected.length }), {
          action: {
            label: t('actions.openQueue'),
            onClick: () => events.emit('drawer:open', 'queue')
          }
        });
        this.clear();
      }
    });
    this.barEl.appendChild(btnQueue);
    this.btnQueue = btnQueue;

    // Add to Playlist Button (Pure Icon, 44px)
    const btnPlaylist = document.createElement('button');
    btnPlaylist.className = 'btn btn-action-round';
    btnPlaylist.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
      </svg>
    `;
    btnPlaylist.addEventListener('click', () => {
      const selected = this.getSelectedTracks();
      if (selected.length > 0) {
        contextMenu.showPlaylistPicker(selected);
        this.clear();
      }
    });
    this.barEl.appendChild(btnPlaylist);
    this.btnPlaylist = btnPlaylist;

    // Cancel / Deselect Button (Pure Icon, 44px)
    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-action-round';
    btnCancel.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    `;
    btnCancel.addEventListener('click', () => this.clear());
    this.barEl.appendChild(btnCancel);
    this.btnCancel = btnCancel;

    document.body.appendChild(this.barEl);

    this.updateI18nLabels();
    events.on('i18n:changed', () => this.updateI18nLabels());

    store.subscribe('selectedTrackIds', (set) => this.render(set));
  }

  updateI18nLabels() {
    if (this.btnPlay) {
      this.btnPlay.setAttribute('title', t('actions.playSelected'));
      this.btnPlay.setAttribute('aria-label', t('actions.playSelected'));
    }
    if (this.btnQueue) {
      this.btnQueue.setAttribute('title', t('actions.addToQueue'));
      this.btnQueue.setAttribute('aria-label', t('actions.addToQueue'));
    }
    if (this.btnPlaylist) {
      this.btnPlaylist.setAttribute('title', t('actions.addToPlaylist'));
      this.btnPlaylist.setAttribute('aria-label', t('actions.addToPlaylist'));
    }
    if (this.btnCancel) {
      this.btnCancel.setAttribute('title', t('actions.deselect'));
      this.btnCancel.setAttribute('aria-label', t('actions.deselect'));
    }
    const selected = store.get('selectedTrackIds');
    if (selected && selected.size > 0) {
      this.render(selected);
    }
  }

  getSelectedTracks() {
    const selectedIds = store.get('selectedTrackIds') || new Set();
    const tracks = store.get('tracks') || [];
    return tracks.filter(t => selectedIds.has(t.id));
  }

  render(selectedSet) {
    const count = selectedSet?.size || 0;
    if (count > 0) {
      this.countEl.innerText = t('collection.selectedCount', { count });
      this.barEl.classList.add('active');
    } else {
      this.barEl.classList.remove('active');
    }
  }

  toggle(trackId) {
    const set = new Set(store.get('selectedTrackIds') || []);
    if (set.has(trackId)) set.delete(trackId);
    else set.add(trackId);
    store.set('selectedTrackIds', set);
  }

  clear() {
    store.set('selectedTrackIds', new Set());
  }

  selectAll(trackIds = []) {
    store.set('selectedTrackIds', new Set(trackIds));
  }
}

export const selectionBar = new SelectionBarManager();
