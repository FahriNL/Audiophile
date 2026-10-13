/**
 * collectionEditor.js - Interactive manual metadata editor modal for
 * Artist, Album, and Playlist collection pages.
 * Supports image file replacement, offline IndexedDB persistence,
 * and real-time reactive store propagation.
 */

import { store } from '../../core/store.js';
import { db } from '../../db/db.js';
import { toast } from './toast.js';
import { escapeHtml } from '../../core/utils.js';
import { getIconSvg } from '../icons.js';
import { coverCache } from '../../library/covers.js';
import { events } from '../../core/events.js';
import { playlistService } from '../../playlists/playlistService.js';
import { artistMetaService } from '../../library/artistMeta.js';
import { t } from '../../core/i18n.js';

class CollectionEditorController {
  constructor() {
    this.overlay = null;
  }

  close() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  /**
   * Open manual editor for an Artist
   * @param {Object} params
   */
  openArtist(params = {}) {
    this.close();
    const { artistName = '', meta = {}, onSave = null } = params;

    let currentAvatar = meta.avatarUrl || '';
    let currentBanner = meta.bannerUrl || '';
    let newAvatarBlob = null;
    let newBannerBlob = null;

    const overlay = document.createElement('div');
    overlay.className = 'metadata-editor-overlay';
    overlay.id = 'artistMetaEditorModal';

    overlay.innerHTML = `
      <div class="metadata-editor-card" role="dialog" aria-modal="true" style="max-width:680px;">
        <div class="metadata-editor-header">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="color:var(--accent);">${getIconSvg('edit', { size: 20 })}</span>
            <div>
              <h3 class="metadata-editor-title">Edit Metadata Artis</h3>
              <p class="metadata-editor-sub">${escapeHtml(artistName)}</p>
            </div>
          </div>
          <button class="btn btn-icon metadata-editor-close" id="btnArtistEditClose" aria-label="${escapeHtml(t('common.close'))}">${getIconSvg('close', { size: 18 })}</button>
        </div>

        <form id="artistEditForm" class="metadata-editor-body" style="flex-direction:column; gap:20px;">
          <!-- Images Row -->
          <div style="display:grid; grid-template-columns:1fr 2fr; gap:16px;">
            <!-- Avatar Column -->
            <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
              <span style="font-size:0.75rem; color:var(--text-dim); font-weight:600; text-transform:uppercase;">Foto Profil</span>
              <div id="artistAvatarPreview" style="width:110px; height:110px; border-radius:50%; overflow:hidden; background:var(--bg-surface-elevated); border:2px solid var(--glass-border-specular); display:flex; align-items:center; justify-content:center;">
                ${currentAvatar ? `
                  <img src="${escapeHtml(currentAvatar)}" style="width:100%; height:100%; object-fit:cover;" alt="Avatar" />
                ` : `
                  <span style="color:var(--text-dim); font-size:1.8rem; font-weight:700;">${escapeHtml(artistName.slice(0, 2).toUpperCase())}</span>
                `}
              </div>
              <input type="file" id="inputArtistAvatarFile" accept="image/png, image/jpeg, image/webp" style="display:none;" />
              <button type="button" class="btn btn-secondary btn-sm" id="btnChangeArtistAvatar" style="font-size:0.75rem; padding:4px 10px;">
                Ganti Foto
              </button>
            </div>

            <!-- Banner Column -->
            <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
              <span style="font-size:0.75rem; color:var(--text-dim); font-weight:600; text-transform:uppercase;">Banner Panggung</span>
              <div id="artistBannerPreview" style="width:100%; height:110px; border-radius:var(--radius-md); overflow:hidden; background:var(--bg-surface-elevated); border:1px solid var(--glass-border-specular); display:flex; align-items:center; justify-content:center;">
                ${currentBanner ? `
                  <img src="${escapeHtml(currentBanner)}" style="width:100%; height:100%; object-fit:cover;" alt="Banner" />
                ` : `
                  <span style="color:var(--text-dim); font-size:0.8rem;">Belum ada banner panggung</span>
                `}
              </div>
              <input type="file" id="inputArtistBannerFile" accept="image/png, image/jpeg, image/webp" style="display:none;" />
              <div style="display:flex; gap:8px;">
                <button type="button" class="btn btn-secondary btn-sm" id="btnChangeArtistBanner" style="font-size:0.75rem; padding:4px 10px;">
                  Ganti Banner
                </button>
                <button type="button" class="btn btn-ghost btn-sm" id="btnRemoveArtistBanner" style="font-size:0.75rem; padding:4px 10px; color:var(--text-dim);">
                  Hapus Banner
                </button>
              </div>
            </div>
          </div>

          <!-- Metadata Fields -->
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div class="meta-form-group">
              <label class="meta-form-label" for="editArtistTitle">Deskripsi Ringkas / Subtitle</label>
              <input type="text" id="editArtistDescription" class="input" value="${escapeHtml(meta.description || '')}" placeholder="Contoh: Pemusik Indonesia • Pop, Jazz" autocomplete="off" />
            </div>

            <div class="meta-form-group">
              <label class="meta-form-label" for="editArtistBio">Biografi Lengkap</label>
              <textarea id="editArtistBio" class="input" rows="4" style="resize:vertical; font-size:0.85rem; line-height:1.5;" placeholder="Tuliskan biografi atau catatan artis...">${escapeHtml(meta.bio || '')}</textarea>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="meta-form-group">
                <label class="meta-form-label" for="editArtistCountry">Negara / Asal</label>
                <input type="text" id="editArtistCountry" class="input" value="${escapeHtml(meta.country || '')}" placeholder="Contoh: Indonesia, UK..." autocomplete="off" />
              </div>
              <div class="meta-form-group">
                <label class="meta-form-label" for="editArtistType">Tipe Musisi</label>
                <input type="text" id="editArtistType" class="input" value="${escapeHtml(meta.type || '')}" placeholder="Contoh: Person, Group..." autocomplete="off" />
              </div>
            </div>
          </div>
        </form>

        <div class="metadata-editor-footer">
          <button type="button" class="btn btn-secondary" id="btnArtistEditCancel">${escapeHtml(t('tagEditor.cancel'))}</button>
          <button type="submit" form="artistEditForm" class="btn btn-primary" id="btnArtistEditSave">${escapeHtml(t('tagEditor.saveChanges'))}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlay = overlay;

    // Close handlers
    overlay.querySelector('#btnArtistEditClose')?.addEventListener('click', () => this.close());
    overlay.querySelector('#btnArtistEditCancel')?.addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Avatar File Picker
    const avatarInput = overlay.querySelector('#inputArtistAvatarFile');
    overlay.querySelector('#btnChangeArtistAvatar')?.addEventListener('click', () => avatarInput?.click());
    avatarInput?.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        newAvatarBlob = file;
        const previewUrl = URL.createObjectURL(file);
        const container = overlay.querySelector('#artistAvatarPreview');
        if (container) {
          container.innerHTML = `<img src="${previewUrl}" style="width:100%; height:100%; object-fit:cover;" alt="Avatar" />`;
        }
      }
    });

    // Banner File Picker
    const bannerInput = overlay.querySelector('#inputArtistBannerFile');
    overlay.querySelector('#btnChangeArtistBanner')?.addEventListener('click', () => bannerInput?.click());
    bannerInput?.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        newBannerBlob = file;
        const previewUrl = URL.createObjectURL(file);
        const container = overlay.querySelector('#artistBannerPreview');
        if (container) {
          container.innerHTML = `<img src="${previewUrl}" style="width:100%; height:100%; object-fit:cover;" alt="Banner" />`;
        }
      }
    });

    // Remove banner handler
    overlay.querySelector('#btnRemoveArtistBanner')?.addEventListener('click', () => {
      currentBanner = '';
      newBannerBlob = null;
      const container = overlay.querySelector('#artistBannerPreview');
      if (container) {
        container.innerHTML = `<span style="color:var(--text-dim); font-size:0.8rem;">Belum ada banner panggung</span>`;
      }
    });

    // Save Form Handler
    overlay.querySelector('#artistEditForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const desc = overlay.querySelector('#editArtistDescription')?.value.trim() || '';
      const bio = overlay.querySelector('#editArtistBio')?.value.trim() || '';
      const country = overlay.querySelector('#editArtistCountry')?.value.trim() || '';
      const type = overlay.querySelector('#editArtistType')?.value.trim() || '';

      const updatedMeta = {
        ...meta,
        artistName,
        description: desc,
        bio,
        country,
        type,
        lastUpdated: Date.now()
      };

      if (newAvatarBlob) {
        const reader = new FileReader();
        await new Promise(res => {
          reader.onload = () => {
            updatedMeta.avatarUrl = reader.result;
            res();
          };
          reader.readAsDataURL(newAvatarBlob);
        });
      }

      if (newBannerBlob) {
        const reader = new FileReader();
        await new Promise(res => {
          reader.onload = () => {
            updatedMeta.bannerUrl = reader.result;
            res();
          };
          reader.readAsDataURL(newBannerBlob);
        });
      } else if (!currentBanner) {
        updatedMeta.bannerUrl = '';
      }

      // Persist to IndexedDB settings & memory cache
      const cacheKey = `artist_meta:${artistName.toLowerCase().trim()}`;
      try {
        await db.put('settings', { key: cacheKey, data: updatedMeta });
      } catch (err) {
        console.warn('Failed to save artist meta in DB:', err);
      }
      artistMetaService.memoryCache.set(artistName, updatedMeta);

      this.close();
      toast.success(`Metadata artis "${artistName}" berhasil disimpan.`);
      if (typeof onSave === 'function') onSave(updatedMeta);
    });
  }

  /**
   * Open manual editor for an Album
   * @param {Object} params
   */
  openAlbum(params = {}) {
    this.close();
    const { albumName = '', artist = '', tracks = [], coverUrl = null, onSave = null } = params;

    const firstTrack = tracks[0] || {};
    const year = firstTrack.overrides?.year || firstTrack.metadata?.year || '';
    const genre = firstTrack.overrides?.genre || firstTrack.metadata?.genre || '';
    let currentCoverUrl = coverUrl;
    let newCoverBlob = null;

    const overlay = document.createElement('div');
    overlay.className = 'metadata-editor-overlay';
    overlay.id = 'albumMetaEditorModal';

    overlay.innerHTML = `
      <div class="metadata-editor-card" role="dialog" aria-modal="true" style="max-width:640px;">
        <div class="metadata-editor-header">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="color:var(--accent);">${getIconSvg('edit', { size: 20 })}</span>
            <div>
              <h3 class="metadata-editor-title">Edit Metadata Album</h3>
              <p class="metadata-editor-sub">${escapeHtml(albumName)} (${tracks.length} trek)</p>
            </div>
          </div>
          <button class="btn btn-icon metadata-editor-close" id="btnAlbumEditClose" aria-label="${escapeHtml(t('common.close'))}">${getIconSvg('close', { size: 18 })}</button>
        </div>

        <form id="albumEditForm" class="metadata-editor-body">
          <!-- Left Column: Album Artwork Preview & Controls -->
          <div class="metadata-editor-cover-col">
            <div class="metadata-editor-preview-box" id="albumEditCoverPreview">
              ${currentCoverUrl ? `
                <img src="${escapeHtml(currentCoverUrl)}" id="albumEditPreviewImg" alt="Cover" />
              ` : `
                <span style="color:var(--text-dim);">${getIconSvg('library_music', { size: 48 })}</span>
              `}
            </div>
            <input type="file" id="albumEditFileInput" accept="image/png, image/jpeg, image/webp" style="display:none;" />
            <button type="button" class="btn btn-secondary btn-sm" id="btnAlbumEditChangeCover" style="width:100%;">
              ${escapeHtml(t('tagEditor.changeCover'))}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" id="btnAlbumEditRemoveCover" style="width:100%; color:var(--text-dim);">
              ${escapeHtml(t('tagEditor.removeCover'))}
            </button>
            <span style="font-size:0.68rem; color:var(--text-dim); text-align:center;">
              ${escapeHtml(t('tagEditor.coverHint'))}
            </span>
          </div>

          <!-- Right Column: Metadata Fields -->
          <div class="metadata-editor-form-col">
            <div class="meta-form-group">
              <label class="meta-form-label" for="albumEditName">${escapeHtml(t('tagEditor.album'))}</label>
              <input type="text" id="albumEditName" class="input" value="${escapeHtml(albumName)}" required autocomplete="off" />
            </div>

            <div class="meta-form-group">
              <label class="meta-form-label" for="albumEditArtist">${escapeHtml(t('tagEditor.artist'))}</label>
              <input type="text" id="albumEditArtist" class="input" value="${escapeHtml(artist)}" placeholder="${escapeHtml(t('tagEditor.artistPlaceholder'))}" autocomplete="off" />
            </div>

            <div class="meta-form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div class="meta-form-group">
                <label class="meta-form-label" for="albumEditYear">${escapeHtml(t('tagEditor.year'))}</label>
                <input type="number" id="albumEditYear" class="input" value="${escapeHtml(String(year))}" placeholder="YYYY" min="1900" max="2100" />
              </div>
              <div class="meta-form-group">
                <label class="meta-form-label" for="albumEditGenre">${escapeHtml(t('tagEditor.genre'))}</label>
                <input type="text" id="albumEditGenre" class="input" value="${escapeHtml(genre)}" placeholder="${escapeHtml(t('tagEditor.genrePlaceholder'))}" autocomplete="off" />
              </div>
            </div>

            <div style="font-size:0.75rem; color:var(--text-dim); line-height:1.4; padding:8px 12px; border-radius:var(--radius-sm); background:rgba(255,255,255,0.02); border:1px solid var(--border-subtle);">
              Perubahan akan diterapkan secara otomatis ke seluruh <strong>${tracks.length} lagu</strong> dalam album ini.
            </div>
          </div>
        </form>

        <div class="metadata-editor-footer">
          <button type="button" class="btn btn-secondary" id="btnAlbumEditCancel">${escapeHtml(t('tagEditor.cancel'))}</button>
          <button type="submit" form="albumEditForm" class="btn btn-primary" id="btnAlbumEditSave">${escapeHtml(t('tagEditor.saveChanges'))}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlay = overlay;

    // Close handlers
    overlay.querySelector('#btnAlbumEditClose')?.addEventListener('click', () => this.close());
    overlay.querySelector('#btnAlbumEditCancel')?.addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Cover File Picker
    const fileInput = overlay.querySelector('#albumEditFileInput');
    overlay.querySelector('#btnAlbumEditChangeCover')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        newCoverBlob = file;
        const previewUrl = URL.createObjectURL(file);
        const container = overlay.querySelector('#albumEditCoverPreview');
        if (container) {
          container.innerHTML = `<img src="${previewUrl}" id="albumEditPreviewImg" alt="Cover" />`;
        }
      }
    });

    overlay.querySelector('#btnAlbumEditRemoveCover')?.addEventListener('click', () => {
      currentCoverUrl = null;
      newCoverBlob = null;
      const container = overlay.querySelector('#albumEditCoverPreview');
      if (container) {
        container.innerHTML = `<span style="color:var(--text-dim);">${getIconSvg('library_music', { size: 48 })}</span>`;
      }
    });

    // Save Form Handler
    overlay.querySelector('#albumEditForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newAlbum = overlay.querySelector('#albumEditName')?.value.trim() || albumName;
      const newArtist = overlay.querySelector('#albumEditArtist')?.value.trim() || artist;
      const newYear = parseInt(overlay.querySelector('#albumEditYear')?.value, 10) || null;
      const newGenre = overlay.querySelector('#albumEditGenre')?.value.trim() || '';

      const allTracks = store.get('tracks') || [];
      const trackIdsToUpdate = new Set(tracks.map(t => t.id));

      let savedCoverUrl = currentCoverUrl;
      let coverKey = null;

      if (newCoverBlob) {
        coverKey = `album:${newArtist.toLowerCase().trim()}-${newAlbum.toLowerCase().trim()}`;
        try {
          await coverCache.saveCover(coverKey, newCoverBlob, newCoverBlob.type);
          savedCoverUrl = URL.createObjectURL(newCoverBlob);
        } catch (err) {
          console.warn('Failed to save album cover blob:', err);
        }
      }

      const updatedTracks = allTracks.map(t => {
        if (trackIdsToUpdate.has(t.id)) {
          if (!t.overrides) t.overrides = {};
          if (!t.metadata) t.metadata = {};
          t.overrides.album = newAlbum;
          t.overrides.artist = newArtist;
          if (newYear) {
            t.overrides.year = newYear;
            t.metadata.year = newYear;
          }
          if (newGenre) {
            t.overrides.genre = newGenre;
            t.metadata.genre = newGenre;
          }
          if (savedCoverUrl) {
            t.overrides.pictureUrl = savedCoverUrl;
            t.metadata.pictureUrl = savedCoverUrl;
            t.metadata.hasCover = true;
            if (coverKey) t.metadata.pictureKey = coverKey;
          } else if (currentCoverUrl === null && !newCoverBlob) {
            t.overrides.pictureUrl = null;
            t.metadata.pictureUrl = null;
            t.metadata.hasCover = false;
          }
        }
        return t;
      });

      store.set('tracks', updatedTracks);
      try {
        await db.bulkPut('tracks', updatedTracks.filter(t => trackIdsToUpdate.has(t.id)));
      } catch (err) {
        console.warn('Failed to persist tracks to IndexedDB:', err);
      }

      events.emit('library:updated', { tracks: updatedTracks });

      this.close();
      toast.success(`Metadata album "${newAlbum}" berhasil diperbarui.`);
      if (typeof onSave === 'function') {
        onSave({ newAlbum, newArtist, coverUrl: savedCoverUrl });
      }
    });
  }

  /**
   * Open manual editor for a Playlist
   * @param {Object} params
   */
  openPlaylist(params = {}) {
    this.close();
    const { playlist = {}, onSave = null } = params;

    const overlay = document.createElement('div');
    overlay.className = 'metadata-editor-overlay';
    overlay.id = 'playlistMetaEditorModal';

    overlay.innerHTML = `
      <div class="metadata-editor-card" role="dialog" aria-modal="true" style="max-width:520px;">
        <div class="metadata-editor-header">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="color:var(--accent);">${getIconSvg('edit', { size: 20 })}</span>
            <div>
              <h3 class="metadata-editor-title">${escapeHtml(t('playlists.editInfo'))}</h3>
              <p class="metadata-editor-sub">${escapeHtml(playlist.name || 'Playlist')}</p>
            </div>
          </div>
          <button class="btn btn-icon metadata-editor-close" id="btnPlEditClose" aria-label="${escapeHtml(t('common.close'))}">${getIconSvg('close', { size: 18 })}</button>
        </div>

        <form id="plEditForm" class="metadata-editor-body" style="flex-direction:column; gap:16px;">
          <div class="meta-form-group">
            <label class="meta-form-label" for="inputPlName">${escapeHtml(t('playlists.newPlaylist'))}</label>
            <input type="text" id="inputPlName" class="input" value="${escapeHtml(playlist.name || '')}" required autocomplete="off" />
          </div>

          <div class="meta-form-group">
            <label class="meta-form-label" for="inputPlDesc">Deskripsi (Opsional)</label>
            <textarea id="inputPlDesc" class="input" rows="3" style="resize:vertical;" placeholder="Tambahkan deskripsi mengenai playlist ini...">${escapeHtml(playlist.description || '')}</textarea>
          </div>
        </form>

        <div class="metadata-editor-footer">
          <button type="button" class="btn btn-secondary" id="btnPlEditCancel">${escapeHtml(t('tagEditor.cancel'))}</button>
          <button type="submit" form="plEditForm" class="btn btn-primary" id="btnPlEditSave">${escapeHtml(t('tagEditor.saveChanges'))}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlay = overlay;

    // Close handlers
    overlay.querySelector('#btnPlEditClose')?.addEventListener('click', () => this.close());
    overlay.querySelector('#btnPlEditCancel')?.addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Save Form Handler
    overlay.querySelector('#plEditForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = overlay.querySelector('#inputPlName')?.value.trim() || playlist.name;
      const newDesc = overlay.querySelector('#inputPlDesc')?.value.trim() || '';

      await playlistService.renamePlaylist(playlist.id, newName, newDesc);
      playlist.name = newName;
      playlist.description = newDesc;

      this.close();
      toast.success(`Informasi playlist "${newName}" berhasil disimpan.`);
      if (typeof onSave === 'function') onSave(playlist);
    });
  }
}

export const collectionEditor = new CollectionEditorController();
