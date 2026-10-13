/**
 * queueView.js - Dedicated playback queue view with reordering, clear queue undo, and smart queue toggle
 */

import { store } from '../../core/store.js';
import { queueManager } from '../../player/queue.js';
import { engine } from '../../player/engine.js';
import { toast } from '../components/toast.js';
import { TrackRowRenderer } from '../components/trackRow.js';
import { formatDuration } from '../../core/utils.js';
import { getIconSvg } from '../icons.js';
import { t } from '../../core/i18n.js';
import { events } from '../../core/events.js';

class QueueView {
  constructor() {
    this.container = null;
  }

  init() {
    this.container = document.getElementById('viewQueue');
    store.subscribe('queue', () => this.render());
    store.subscribe('queueIndex', () => this.render());
    events.on('i18n:changed', () => this.render());
  }

  activate() {
    this.render();
  }

  render() {
    if (!this.container) return;

    const queue = store.get('queue') || [];
    const currentIndex = store.get('queueIndex') ?? -1;
    const settings = store.get('settings') || {};

    let totalDuration = 0;
    queue.forEach(t => totalDuration += (t.streamInfo?.duration || 0));

    this.container.innerHTML = `
      <div class="flex-between" style="margin-bottom:14px; flex-wrap:wrap; gap:8px;">
        <div>
          <h3>${escapeHtml(t('queue.title'))} (${queue.length} ${escapeHtml(t('common.songs'))})</h3>
          <p style="font-size:0.75rem; color:var(--text-dim);" class="mono">${escapeHtml(t('queue.totalDuration', { duration: formatDuration(totalDuration) }))}</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-danger" id="btnClearQueue" ${queue.length === 0 ? 'disabled' : ''}>${escapeHtml(t('queue.clearQueue'))}</button>
        </div>
      </div>

      <!-- Smart Queue Settings Card -->
      <div style="background:var(--glass-bg-card); border:1px solid var(--glass-border-subtle); border-radius:var(--radius-md); padding:12px 16px; margin-bottom:14px;" class="flex-between">
        <div>
          <h4 style="font-size:0.88rem; color:var(--text-main);">${escapeHtml(t('queue.smartQueueTitle'))}</h4>
          <p style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(t('queue.smartQueueDesc'))}</p>
        </div>
        <label style="cursor:pointer; display:flex; align-items:center;">
          <input type="checkbox" id="chkSmartQueueToggle" ${settings.smartQueue ? 'checked' : ''} />
        </label>
      </div>

      <!-- Queue Tracks List -->
      <div id="queueTracksContainer" style="display:flex; flex-direction:column; gap:4px;">
        ${queue.length === 0 ? `<p style="padding:40px; text-align:center; color:var(--text-muted);">${escapeHtml(t('queue.emptyQueueDesc'))}</p>` : ''}
        ${queue.map((track, idx) => `
          <div class="queue-item-row" style="display:flex; align-items:center; background:var(--glass-bg-card); border-radius:var(--radius-sm); border:1px solid var(--glass-border-card); padding-right:8px; ${idx === currentIndex ? 'border-left:3px solid var(--accent);' : ''}">
            <div style="display:flex; flex-direction:column; padding:0 4px; gap:2px;">
              <button class="btn btn-icon btn-queue-up" data-idx="${idx}" title="${escapeHtml(t('actions.reorderUp'))}" style="padding:2px; width:22px; height:20px; font-size:0.7rem;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
              </button>
              <button class="btn btn-icon btn-queue-down" data-idx="${idx}" title="${escapeHtml(t('actions.reorderDown'))}" style="padding:2px; width:22px; height:20px; font-size:0.7rem;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            </div>
            <div style="flex:1; min-width:0;" id="qMount_${idx}"></div>
            <button class="btn btn-icon btn-remove-queue" data-idx="${idx}" title="${escapeHtml(t('actions.removeFromQueue'))}" aria-label="${escapeHtml(t('actions.removeFromQueue'))}" style="color:var(--status-danger); width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; padding:0;">${getIconSvg('close', { size: 16 })}</button>
          </div>
        `).join('')}
      </div>
    `;

    // Mount TrackRowRenderer inside each queue item
    queue.forEach((track, idx) => {
      const mount = document.getElementById(`qMount_${idx}`);
      if (mount) {
        const row = TrackRowRenderer.render(track, {
          isPlaying: idx === currentIndex,
          showIndex: true,
          index: idx,
          onClick: () => {
            queueManager.playAt(idx);
          }
        });
        mount.appendChild(row);
      }
    });

    // Clear Queue Button
    document.getElementById('btnClearQueue')?.addEventListener('click', () => {
      queueManager.clear();
      toast.show('Antrean pemutaran dikosongkan.', {
        onUndo: () => {
          if (queueManager.lastClearedQueue) {
            queueManager.setQueue(queueManager.lastClearedQueue.queue, queueManager.lastClearedQueue.index);
          }
        }
      });
    });

    // Smart Queue Toggle
    document.getElementById('chkSmartQueueToggle')?.addEventListener('change', (e) => {
      const curSettings = store.get('settings') || {};
      store.set('settings', { ...curSettings, smartQueue: e.target.checked });
      toast.info(`Smart Queue: ${e.target.checked ? 'Aktif' : 'Mati'}`);
    });

    // Up / Down reordering buttons
    this.container.querySelectorAll('.btn-queue-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        if (idx > 0) queueManager.reorder(idx, idx - 1);
      });
    });

    this.container.querySelectorAll('.btn-queue-down').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        if (idx < queue.length - 1) queueManager.reorder(idx, idx + 1);
      });
    });

    // Remove item button
    this.container.querySelectorAll('.btn-remove-queue').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const tr = queue[idx];
        queueManager.remove(idx);
        toast.show(`"${tr.metadata?.title || 'Lagu'}" dihapus dari antrean.`, {
          onUndo: () => queueManager.playNext(tr)
        });
      });
    });
  }
}

export const queueView = new QueueView();
