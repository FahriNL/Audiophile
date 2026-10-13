/**
 * collectionMenu.js - 3-Dot collection action menu with Windows 11 style
 * cascading submenus for Artist, Album, and Playlist pages.
 * Handles online metadata downloading, manual editing, and playlist management.
 */

import { getIconSvg } from '../icons.js';
import { toast } from './toast.js';
import { artistMetaService } from '../../library/artistMeta.js';
import { collectionEditor } from './collectionEditor.js';
import { t } from '../../core/i18n.js';

class CollectionMenuManager {
  constructor() {
    this.activeMenu = null;
    this._bindGlobalDismiss();
  }

  _bindGlobalDismiss() {
    if (typeof window === 'undefined') return;

    window.addEventListener('click', (e) => {
      if (this.activeMenu && !this.activeMenu.contains(e.target) && !e.target.closest('#btnCollectionMore')) {
        this.close();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeMenu) {
        this.close();
      }
    });

    window.addEventListener('scroll', () => {
      if (this.activeMenu) {
        this.close();
      }
    }, true);
  }

  close() {
    if (this.activeMenu) {
      this.activeMenu.remove();
      this.activeMenu = null;
    }
  }

  /**
   * Bind 3-dot button to open collection actions
   * @param {HTMLElement} btnElement
   * @param {Object} options
   */
  bind(btnElement, options = {}) {
    if (!btnElement) return;

    btnElement.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.activeMenu) {
        this.close();
        return;
      }
      this.open(btnElement, options);
    });
  }

  /**
   * Open the menu attached to the button
   * @param {HTMLElement} btnElement
   * @param {Object} options
   */
  open(btnElement, options = {}) {
    this.close();

    const {
      type = 'album', // 'artist' | 'album' | 'playlist'
      title = '',
      subtitle = '',
      tracks = [],
      meta = null,
      playlist = null,
      coverUrl = null,
      isEditMode = false,
      onToggleEditMode = null,
      onExportM3u = null,
      onDeletePlaylist = null,
      onRefresh = null
    } = options;

    const rect = btnElement.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'collection-dropdown-menu';
    menu.id = 'collectionActionMenu';

    if (type === 'playlist') {
      // Playlist-specific menu: Edit info, Reorder tracks, Export M3U, Delete
      menu.innerHTML = `
        <button type="button" class="collection-submenu-item" id="btnPlMenuEditMeta">
          <span class="collection-menu-icon">${getIconSvg('edit', { size: 18 })}</span>
          <span class="collection-menu-text">${escapeHtml(t('playlists.editInfo'))}</span>
        </button>
        ${!playlist?.isSmart ? `
        <button type="button" class="collection-submenu-item" id="btnPlMenuToggleEdit">
          <span class="collection-menu-icon">${getIconSvg(isEditMode ? 'check' : 'drag_indicator', { size: 18 })}</span>
          <span class="collection-menu-text">${escapeHtml(isEditMode ? t('playlists.finishReorder') : t('playlists.reorderTracks'))}</span>
        </button>
        ` : ''}
        <button type="button" class="collection-submenu-item" id="btnPlMenuExport">
          <span class="collection-menu-icon">${getIconSvg('download', { size: 18 })}</span>
          <span class="collection-menu-text">${escapeHtml(t('playlists.exportM3u'))}</span>
        </button>
        ${!playlist?.isSmart ? `
        <div style="height:1px; background:var(--glass-border-specular); margin:4px 0;"></div>
        <button type="button" class="collection-submenu-item" id="btnPlMenuDelete" style="color:var(--status-danger);">
          <span class="collection-menu-icon" style="color:var(--status-danger);">${getIconSvg('delete', { size: 18 })}</span>
          <span class="collection-menu-text">${escapeHtml(t('playlists.deletePlaylist'))}</span>
        </button>
        ` : ''}
      `;
    } else {
      // Artist & Album menu: Metadata with cascading flyout submenu
      menu.innerHTML = `
        <div class="collection-menu-item has-submenu" id="menuItemMeta" tabindex="0">
          <div class="collection-menu-item-content">
            <span class="collection-menu-icon">${getIconSvg('tune', { size: 18 })}</span>
            <span class="collection-menu-text">${escapeHtml(t('actions.metadata'))}</span>
          </div>
          <span class="collection-menu-arrow">${getIconSvg('chevron_right', { size: 16 })}</span>

          <!-- Cascading Flyout Submenu -->
          <div class="collection-submenu-flyout" id="submenuMetaFlyout">
            <button type="button" class="collection-submenu-item" id="btnSubActionDownload">
              <span class="collection-menu-icon">${getIconSvg('download', { size: 18 })}</span>
              <span class="collection-menu-text">${escapeHtml(t('actions.downloadMetadata'))}</span>
            </button>
            <button type="button" class="collection-submenu-item" id="btnSubActionEdit">
              <span class="collection-menu-icon">${getIconSvg('edit', { size: 18 })}</span>
              <span class="collection-menu-text">${escapeHtml(t('actions.editMetadata'))}</span>
            </button>
          </div>
        </div>
      `;
    }

    document.body.appendChild(menu);
    this.activeMenu = menu;

    // Positioning: bottom-right or bottom-left depending on window width
    const menuWidth = 200;
    const flyoutWidth = 205;
    const padding = 12;

    let left = rect.right - menuWidth;
    if (left < padding) left = padding;

    let top = rect.bottom + 6;
    if (top + 180 > window.innerHeight) {
      top = rect.top - 100;
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    if (type === 'playlist') {
      // Bind playlist actions
      menu.querySelector('#btnPlMenuEditMeta')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        collectionEditor.openPlaylist({
          playlist: playlist || { name: title, description: subtitle },
          onSave: (res) => {
            if (typeof onRefresh === 'function') onRefresh(res);
          }
        });
      });

      menu.querySelector('#btnPlMenuToggleEdit')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        if (typeof onToggleEditMode === 'function') {
          onToggleEditMode();
        }
      });

      menu.querySelector('#btnPlMenuExport')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        if (typeof onExportM3u === 'function') {
          onExportM3u();
        }
      });

      menu.querySelector('#btnPlMenuDelete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        if (typeof onDeletePlaylist === 'function') {
          onDeletePlaylist();
        }
      });
    } else {
      // Position the submenu flyout relative to available horizontal space
      const flyout = menu.querySelector('#submenuMetaFlyout');
      const spaceOnRight = window.innerWidth - (left + menuWidth);
      if (flyout && spaceOnRight < flyoutWidth + padding) {
        // Open flyout to the left
        flyout.style.left = 'auto';
        flyout.style.right = '100%';
        flyout.style.marginLeft = '0';
        flyout.style.marginRight = '6px';
      }

      // Touch support for expanding submenu
      const metaItem = menu.querySelector('#menuItemMeta');
      metaItem?.addEventListener('click', (e) => {
        if (e.target.closest('.collection-submenu-item')) return;
        metaItem.classList.toggle('active');
      });

      // Action: Download Metadata
      menu.querySelector('#btnSubActionDownload')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.close();

        if (type === 'artist') {
          toast.info(`Mengunduh metadata online untuk ${title}...`);
          try {
            const freshMeta = await artistMetaService.getArtistMeta(title, true);
            if (freshMeta) {
              toast.success(`Metadata artis "${title}" berhasil diunduh.`);
              if (typeof onRefresh === 'function') onRefresh(freshMeta);
            } else {
              toast.info(`Tidak ditemukan data baru untuk artis "${title}".`);
            }
          } catch {
            toast.error('Gagal mengunduh metadata artis dari jaringan.');
          }
        } else if (type === 'album') {
          toast.info(`Mencari dan mengunduh sampul album "${title}"...`);
          try {
            const artistName = subtitle || tracks[0]?.metadata?.artist || 'Unknown Artist';
            const freshCover = await artistMetaService.fetchAlbumCoverOnline(artistName, title);
            if (freshCover) {
              toast.success(`Sampul album "${title}" berhasil diunduh.`);
              if (typeof onRefresh === 'function') onRefresh({ coverUrl: freshCover });
            } else {
              toast.info(`Tidak ditemukan sampul online baru untuk "${title}".`);
            }
          } catch {
            toast.error('Gagal mengunduh sampul album dari jaringan.');
          }
        }
      });

      // Action: Edit Metadata
      menu.querySelector('#btnSubActionEdit')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();

        if (type === 'artist') {
          collectionEditor.openArtist({
            artistName: title,
            meta: meta || artistMetaService.getFromMemory(title) || {},
            onSave: (updatedMeta) => {
              if (typeof onRefresh === 'function') onRefresh(updatedMeta);
            }
          });
        } else if (type === 'album') {
          collectionEditor.openAlbum({
            albumName: title,
            artist: subtitle,
            tracks,
            coverUrl,
            onSave: (res) => {
              if (typeof onRefresh === 'function') onRefresh(res);
            }
          });
        }
      });
    }
  }
}

export const collectionMenu = new CollectionMenuManager();
