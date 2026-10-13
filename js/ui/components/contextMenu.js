/**
 * contextMenu.js - Context menu for right-click and mobile long-press gestures
 */

import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { queueManager } from '../../player/queue.js';
import { playlistService } from '../../playlists/playlistService.js';
import { dialog } from './dialog.js';
import { toast } from './toast.js';
import { db } from '../../db/db.js';
import { events } from '../../core/events.js';
import { metadataEditor } from './metadataEditor.js';
import { DuplicateManager } from '../../library/dedupe.js';
import { abCompareModal } from './abCompareModal.js';
import { t } from '../../core/i18n.js';

class ContextMenuManager {
  constructor() {
    this.menuEl = null;
    this.currentContext = null;
    this.init();
  }

  init() {
    if (typeof document === 'undefined') return;
    this.menuEl = document.createElement('div');
    this.menuEl.className = 'context-menu';
    document.body.appendChild(this.menuEl);

    if (typeof window !== 'undefined') {
      window.addEventListener('click', () => this.hide());
      window.addEventListener('scroll', () => this.hide(), true);
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.hide();
      });
    }
  }

  /**
   * Bind long-press (touch) and right-click (mouse) to an element
   * @param {HTMLElement} element 
   * @param {Object} contextData { track, tracks, playlistId, index }
   */
  bind(element, contextData) {
    let touchTimer = null;

    // Desktop Right-Click
    element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.show(e.clientX, e.clientY, contextData);
    });

    // Mobile Long-Press
    element.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) return;
      touchTimer = setTimeout(() => {
        const touch = e.touches[0];
        this.show(touch.clientX, touch.clientY, contextData);
      }, 550);
    }, { passive: true });

    element.addEventListener('touchmove', () => {
      if (touchTimer) clearTimeout(touchTimer);
    });

    element.addEventListener('touchend', () => {
      if (touchTimer) clearTimeout(touchTimer);
    });
  }

  show(x, y, contextData) {
    if (!this.menuEl && typeof document !== 'undefined') {
      this.init();
    }
    if (!this.menuEl) return;

    this.currentContext = contextData;
    this.menuEl.innerHTML = '';

    const { track, tracks, playlistId, index } = contextData;
    const targetTracks = tracks || (track ? [track] : []);
    if (targetTracks.length === 0) return;

    const singleTrack = targetTracks[0];

    // Play action
    this.addItem(t('actions.play'), () => {
      queueManager.setQueue(targetTracks, 0);
    });

    // Play Next
    this.addItem(t('actions.playNext'), () => {
      queueManager.playNext(targetTracks);
      toast.success(t('actions.addedNextCount', { count: targetTracks.length }));
    });

    // Add to Queue
    this.addItem(t('actions.addToQueue'), () => {
      queueManager.addToQueue(targetTracks);
      toast.success(t('actions.addedQueueCount', { count: targetTracks.length }), {
        action: {
          label: t('actions.openQueue'),
          onClick: () => events.emit('drawer:open', 'queue')
        }
      });
    });

    // Edit Metadata
    if (targetTracks.length === 1) {
      this.addItem(t('actions.editTrackInfo'), () => {
        metadataEditor.open(singleTrack);
      });

      // Compare duplicate versions (AUD-03)
      const allTracks = store.get('tracks') || [];
      const duplicates = DuplicateManager.getDuplicatesForTrack(singleTrack, allTracks);
      if (duplicates.length > 1) {
        this.addItem(t('actions.compareVersions'), () => {
          const otherTrack = duplicates.find(t => t.id !== singleTrack.id) || duplicates[1];
          abCompareModal.open(singleTrack, otherTrack);
        });
      }
    }

    // Missing track recovery & deletion
    if (singleTrack && singleTrack.missing) {
      this.addItem(t('actions.relinkFile'), () => {
        router.navigate('health');
        toast.info(t('health.cards.missingDesc'));
      });
      this.addItem(t('actions.removeFromLibrary'), async () => {
        const ok = await dialog.confirm(
          t('actions.removeFromLibraryConfirmTitle'),
          t('actions.removeFromLibraryConfirmDesc', { name: singleTrack.name }),
          t('common.delete'),
          t('common.cancel')
        );
        if (ok) {
          const all = store.get('tracks') || [];
          store.set('tracks', all.filter(t => t.id !== singleTrack.id));
          try {
            await db.delete('tracks', singleTrack.id);
          } catch {}
          toast.info(t('actions.trackRemovedFromLibrary', { name: singleTrack.name }));
        }
      });
    }

    this.addDivider();

    // Add to Playlist (Shows picker modal)
    this.addItem(t('actions.addToPlaylist') + '…', async () => {
      await this.showPlaylistPicker(targetTracks);
    });

    // Toggle Favorite (for single track)
    if (targetTracks.length === 1) {
      const statsMap = store.get('stats') || new Map();
      const isFav = statsMap.get(singleTrack.id)?.favorite || false;
      this.addItem(isFav ? t('actions.removeFromFavorites') : t('actions.markFavorite'), async () => {
        const stat = statsMap.get(singleTrack.id) || { playCount: 0, rating: 0 };
        stat.favorite = !isFav;
        statsMap.set(singleTrack.id, stat);
        await db.put('stats', { trackId: singleTrack.id, ...stat });
        store.set('stats', new Map(statsMap));
        toast.info(stat.favorite ? t('toasts.trackLiked') : t('toasts.trackUnliked'));
      });
    }

    // Playlist-specific remove (only available in edit mode)
    if (playlistId && index !== undefined && contextData.isEditMode) {
      this.addDivider();
      this.addItem(t('actions.removeFromThisPlaylist'), async () => {
        await playlistService.removeTrackFromPlaylist(playlistId, index);
      });
    }

    // Position menu within viewport
    const menuWidth = 220;
    const menuHeight = this.menuEl.children.length * 36;
    const finalX = Math.min(x, window.innerWidth - menuWidth - 10);
    const finalY = Math.min(y, window.innerHeight - menuHeight - 10);

    this.menuEl.style.left = `${Math.max(10, finalX)}px`;
    this.menuEl.style.top = `${Math.max(10, finalY)}px`;
    this.menuEl.classList.add('active');
  }

  addItem(label, onClick) {
    const item = document.createElement('div');
    item.className = 'context-menu-item';
    item.innerText = label;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      onClick();
    });
    this.menuEl.appendChild(item);
  }

  addDivider() {
    const div = document.createElement('div');
    div.className = 'context-menu-divider';
    this.menuEl.appendChild(div);
  }

  hide() {
    if (this.menuEl) {
      this.menuEl.classList.remove('active');
    }
  }

  async showPlaylistPicker(tracks) {
    const playlists = store.get('playlists') || [];
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';

    const trackIds = tracks.map(t => t.id);

    // Option: New Playlist
    const btnNew = document.createElement('button');
    btnNew.className = 'btn btn-primary';
    btnNew.innerText = '+ ' + t('playlists.newPlaylist') + '…';
    btnNew.addEventListener('click', async () => {
      const name = await dialog.prompt(t('playlists.newPlaylist'), t('collection.searchPlaylistsPlaceholder') || 'Playlist:', t('playlists.smartFavorites') || 'My Collection');
      if (name) {
        const pl = await playlistService.createPlaylist(name, '', trackIds);
        toast.success(t('actions.createdPlaylistWithCount', { name: pl.name, count: trackIds.length }));
        dialog.close();
      }
    });
    container.appendChild(btnNew);

    if (playlists.length > 0) {
      const label = document.createElement('p');
      label.style.fontSize = '0.78rem';
      label.style.color = 'var(--text-dim)';
      label.innerText = t('actions.orSelectExisting');
      container.appendChild(label);

      playlists.forEach(pl => {
        const plBtn = document.createElement('button');
        plBtn.className = 'btn';
        plBtn.style.justifyContent = 'space-between';
        plBtn.innerHTML = `<span>${escapeHtml(pl.name)}</span> <span style="font-size:0.75rem; color:var(--text-dim);">${pl.trackIds?.length || 0} ${t('common.songs')}</span>`;
        plBtn.addEventListener('click', async () => {
          // Check duplicates
          const { duplicates, unique } = playlistService.checkDuplicates(pl.id, trackIds);
          let toAdd = trackIds;

          if (duplicates.length > 0) {
            const addAnyway = await dialog.confirm(
              t('actions.duplicateFound'),
              t('actions.duplicateWarningCount', { dupCount: duplicates.length, totalCount: trackIds.length, name: pl.name }),
              t('actions.keepAdding'),
              t('actions.skipDuplicates')
            );
            toAdd = addAnyway ? trackIds : unique;
          }

          if (toAdd.length > 0) {
            await playlistService.addTracksToPlaylist(pl.id, toAdd);
            toast.success(t('actions.addedToPlaylistCount', { count: toAdd.length, name: pl.name }));
            dialog.close();
          } else {
            toast.info(t('actions.allSkippedDuplicates'));
          }
        });
        container.appendChild(plBtn);
      });
    }

    dialog.showCustom({
      title: t('actions.selectTargetPlaylist'),
      content: container,
      buttons: [{ label: t('common.close') }]
    });
  }
}

export const contextMenu = new ContextMenuManager();
