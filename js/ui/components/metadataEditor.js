/**
 * metadataEditor.js - Interactive metadata and album artwork editor modal
 * Allows editing title, artist, album, genre, year, track number, and cover art
 * with offline persistence to IndexedDB and reactive Store propagation.
 */

import { store } from '../../core/store.js';
import { db } from '../../db/db.js';
import { toast } from './toast.js';
import { escapeHtml } from '../../core/utils.js';
import { getIconSvg } from '../icons.js';
import { t } from '../../core/i18n.js';

class MetadataEditorController {
  constructor() {
    this.overlay = null;
  }

  /**
   * Open the metadata editor dialog for a specific track
   * @param {Object} track
   */
  open(track) {
    if (!track) return;

    // Remove any existing editor overlay
    this.close();

    const title = track.overrides?.title || track.metadata?.title || track.name;
    const artist = track.overrides?.artist || track.metadata?.artist || '';
    const album = track.overrides?.album || track.metadata?.album || '';
    const genre = track.overrides?.genre || track.metadata?.genre || '';
    const year = track.overrides?.year || track.metadata?.year || '';
    const trackNo = track.overrides?.trackNo ?? (track.metadata?.trackNo || '');
    let currentPictureUrl = track.overrides?.pictureUrl || track.metadata?.pictureUrl || null;

    const overlay = document.createElement('div');
    overlay.className = 'metadata-editor-overlay';
    overlay.id = 'metadataEditorModal';

    overlay.innerHTML = `
      <div class="metadata-editor-card" role="dialog" aria-modal="true" aria-labelledby="metaEditTitleHeader">
        <div class="metadata-editor-header">
          <div style="display:flex; align-items:center; gap:10px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <div>
              <h3 class="metadata-editor-title" id="metaEditTitleHeader">${escapeHtml(t('tagEditor.title'))}</h3>
              <p class="metadata-editor-sub">${escapeHtml(track.name || t('tagEditor.audioFile'))}</p>
            </div>
          </div>
          <button class="btn btn-icon metadata-editor-close" id="btnMetaEditClose" aria-label="${escapeHtml(t('common.close'))}">${getIconSvg('close', { size: 18 })}</button>
        </div>

        <form id="metaEditForm" class="metadata-editor-body">
          <!-- Left Column: Album Art Preview & Controls -->
          <div class="metadata-editor-cover-col">
            <div class="metadata-editor-preview-box" id="metaEditCoverPreview">
              ${currentPictureUrl ? `
                <img src="${escapeHtml(currentPictureUrl)}" id="metaEditPreviewImg" alt="Cover" />
              ` : `
                <svg id="metaEditFallbackSvg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="12" cy="12" r="10"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              `}
            </div>
            <input type="file" id="metaEditFileInput" accept="image/png, image/jpeg, image/webp, image/gif" style="display:none;" />
            <button type="button" class="btn btn-secondary btn-sm" id="btnMetaEditChangeCover" style="width:100%;">
              ${escapeHtml(t('tagEditor.changeCover'))}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" id="btnMetaEditRemoveCover" style="width:100%; color:var(--text-dim);">
              ${escapeHtml(t('tagEditor.removeCover'))}
            </button>
            <span style="font-size:0.68rem; color:var(--text-dim); text-align:center;">
              ${escapeHtml(t('tagEditor.coverHint'))}
            </span>
          </div>

          <!-- Right Column: Metadata Fields -->
          <div class="metadata-editor-form-col">
            <div class="meta-form-group">
              <label class="meta-form-label" for="metaEditTitle">${escapeHtml(t('tagEditor.trackTitle'))}</label>
              <input type="text" id="metaEditTitle" class="input" value="${escapeHtml(title)}" required autocomplete="off" />
            </div>

            <div class="meta-form-group">
              <label class="meta-form-label" for="metaEditArtist">${escapeHtml(t('tagEditor.artist'))}</label>
              <input type="text" id="metaEditArtist" class="input" value="${escapeHtml(artist)}" placeholder="${escapeHtml(t('tagEditor.artistPlaceholder'))}" autocomplete="off" />
            </div>

            <div class="meta-form-group">
              <label class="meta-form-label" for="metaEditAlbum">${escapeHtml(t('tagEditor.album'))}</label>
              <input type="text" id="metaEditAlbum" class="input" value="${escapeHtml(album)}" placeholder="${escapeHtml(t('tagEditor.albumPlaceholder'))}" autocomplete="off" />
            </div>

            <div class="meta-form-row">
              <div class="meta-form-group">
                <label class="meta-form-label" for="metaEditGenre">${escapeHtml(t('tagEditor.genre'))}</label>
                <input type="text" id="metaEditGenre" class="input" value="${escapeHtml(genre)}" placeholder="${escapeHtml(t('tagEditor.genrePlaceholder'))}" autocomplete="off" />
              </div>
              <div class="meta-form-group">
                <label class="meta-form-label" for="metaEditYear">${escapeHtml(t('tagEditor.year'))}</label>
                <input type="text" id="metaEditYear" class="input" value="${escapeHtml(year ? String(year) : '')}" placeholder="${escapeHtml(t('tagEditor.yearPlaceholder'))}" maxlength="4" autocomplete="off" />
              </div>
            </div>

            <div class="meta-form-group">
              <label class="meta-form-label" for="metaEditTrackNo">${escapeHtml(t('tagEditor.trackNo'))}</label>
              <input type="number" id="metaEditTrackNo" class="input" value="${escapeHtml(trackNo ? String(trackNo) : '')}" placeholder="${escapeHtml(t('tagEditor.trackNoPlaceholder'))}" min="1" max="999" style="max-width:140px;" />
            </div>
          </div>
        </form>

        <div class="metadata-editor-footer">
          <button type="button" class="btn btn-secondary" id="btnMetaEditCancel">${escapeHtml(t('tagEditor.cancel'))}</button>
          <button type="button" class="btn btn-primary" id="btnMetaEditSave">${escapeHtml(t('tagEditor.saveChanges'))}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlay = overlay;

    // Wiring Preview Image Update
    const previewBox = overlay.querySelector('#metaEditCoverPreview');
    const updatePreview = (url) => {
      if (url) {
        previewBox.innerHTML = `<img src="${escapeHtml(url)}" id="metaEditPreviewImg" alt="Cover" style="width:100%; height:100%; object-fit:cover;" />`;
      } else {
        previewBox.innerHTML = `
          <svg id="metaEditFallbackSvg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        `;
      }
    };

    // File Input
    const fileInput = overlay.querySelector('#metaEditFileInput');
    overlay.querySelector('#btnMetaEditChangeCover')?.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) {
        toast.error(t('tagEditor.fileSizeError'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        currentPictureUrl = ev.target?.result;
        updatePreview(currentPictureUrl);
      };
      reader.readAsDataURL(file);
    });

    overlay.querySelector('#btnMetaEditRemoveCover')?.addEventListener('click', () => {
      currentPictureUrl = null;
      updatePreview(null);
    });

    // Close handlers
    const handleClose = () => this.close();
    overlay.querySelector('#btnMetaEditClose')?.addEventListener('click', handleClose);
    overlay.querySelector('#btnMetaEditCancel')?.addEventListener('click', handleClose);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) handleClose();
    });

    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    this.keydownHandler = handleKeydown;

    // Save handler
    overlay.querySelector('#btnMetaEditSave')?.addEventListener('click', async () => {
      const titleVal = overlay.querySelector('#metaEditTitle')?.value.trim();
      const artistVal = overlay.querySelector('#metaEditArtist')?.value.trim();
      const albumVal = overlay.querySelector('#metaEditAlbum')?.value.trim();
      const genreVal = overlay.querySelector('#metaEditGenre')?.value.trim();
      const yearVal = overlay.querySelector('#metaEditYear')?.value.trim();
      const trackNoVal = overlay.querySelector('#metaEditTrackNo')?.value.trim();

      const newOverrides = {
        ...(track.overrides || {}),
        title: titleVal || track.name,
        artist: artistVal || 'Unknown Artist',
        album: albumVal || 'Tanpa Album',
        genre: genreVal || '',
        year: yearVal || '',
        trackNo: trackNoVal ? parseInt(trackNoVal, 10) : null,
        pictureUrl: currentPictureUrl
      };

      track.overrides = newOverrides;
      if (!track.metadata) track.metadata = {};
      if (currentPictureUrl !== undefined) {
        track.metadata.pictureUrl = currentPictureUrl;
      }

      try {
        // 1. Persist to DB
        await db.put('tracks', track);
        await db.put('tagOverrides', { trackId: track.id, ...newOverrides });

        // 2. Update tagOverrides in Store
        const tagOverridesMap = store.get('tagOverrides') || new Map();
        tagOverridesMap.set(track.id, newOverrides);
        store.set('tagOverrides', new Map(tagOverridesMap));

        // 3. Update all tracks in Store
        const allTracks = store.get('tracks') || [];
        const trkIdx = allTracks.findIndex(t => t.id === track.id);
        if (trkIdx !== -1) {
          allTracks[trkIdx] = { ...track };
        }

        // Propagate cover art to other tracks in the same album that lack a cover
        if (currentPictureUrl && albumVal) {
          const targetAlbumNorm = albumVal.toLowerCase().trim();
          for (let i = 0; i < allTracks.length; i++) {
            const other = allTracks[i];
            if (other.id !== track.id) {
              const otherAlb = (other.overrides?.album || other.metadata?.album || '').toLowerCase().trim();
              if (otherAlb === targetAlbumNorm && (!other.metadata?.pictureUrl && !other.overrides?.pictureUrl)) {
                if (!other.metadata) other.metadata = {};
                other.metadata.pictureUrl = currentPictureUrl;
                other.metadata.hasCover = true;
                db.put('tracks', other).catch(() => {});
              }
            }
          }
        }
        store.set('tracks', [...allTracks]);

        // 4. Update currently playing track if matched
        const cur = store.get('currentTrack');
        if (cur && cur.id === track.id) {
          store.set('currentTrack', { ...track });
        }

        // 5. Update queue if contains this track
        const q = store.get('queue') || [];
        let qUpdated = false;
        const newQ = q.map(item => {
          if (item.id === track.id) {
            qUpdated = true;
            return { ...track };
          }
          return item;
        });
        if (qUpdated) {
          store.set('queue', newQ);
        }

        toast.success(t('tagEditor.saveSuccess'));
        this.close();
      } catch (err) {
        console.error('Gagal menyimpan metadata:', err);
        toast.error(t('toasts.importError', { message: err?.message || 'DB Error' }));
      }
    });

    // Focus first input
    setTimeout(() => {
      overlay.querySelector('#metaEditTitle')?.focus();
    }, 60);
  }

  close() {
    if (this.overlay) {
      if (this.keydownHandler) {
        window.removeEventListener('keydown', this.keydownHandler);
        this.keydownHandler = null;
      }
      this.overlay.remove();
      this.overlay = null;
    }
  }
}

export const metadataEditor = new MetadataEditorController();
