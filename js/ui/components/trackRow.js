/**
 * trackRow.js - Reusable Track Row component generator with quality badges & events
 */

import { formatDuration, escapeHtml, renderArtistLinks } from '../../core/utils.js';
import { classifyQualityTier } from '../../quality/tiers.js';
import { contextMenu } from './contextMenu.js';
import { selectionBar } from './selectionBar.js';
import { store } from '../../core/store.js';
import { DuplicateManager } from '../../library/dedupe.js';
import { abCompareModal } from './abCompareModal.js';

export class TrackRowRenderer {
  /**
   * Render a track row DOM element
   * @param {Object} track 
   * @param {Object} options 
   * @param {boolean} [options.isPlaying] 
   * @param {boolean} [options.isSelected] 
   * @param {boolean} [options.showIndex] 
   * @param {number} [options.index] 
   * @param {string} [options.playlistId] 
   * @param {boolean} [options.isEditMode]
   * @param {Function} [options.onClick] 
   * @returns {HTMLElement}
   */
  static render(track, options = {}) {
    const {
      isPlaying = false,
      isSelected = false,
      showIndex = false,
      index = 0,
      playlistId = null,
      isEditMode = false,
      onClick
    } = options;

    const row = document.createElement('div');
    row.className = `track-row ${isPlaying ? 'playing' : ''} ${isSelected ? 'selected' : ''} ${track.missing ? 'missing' : ''}`;
    row.setAttribute('data-id', track.id);

    const tierInfo = classifyQualityTier(track.streamInfo, track.format);

    // Duplicate comparison button (AUD-03)
    const allTracks = store.get('tracks') || [];
    const duplicateSiblings = DuplicateManager.getDuplicatesForTrack(track, allTracks);
    const hasDuplicates = duplicateSiblings.length > 1;
    const compareBtnHtml = hasDuplicates
      ? `<button class="btn-compare-track" title="Bandingkan versi lagu ini (A/B)" data-track-id="${escapeHtml(track.id)}" aria-label="Bandingkan">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
          <span>Bandingkan</span>
        </button>`
      : '';

    // Auth badge
    let authBadgeHtml = '';
    if (track.analysis) {
      if (track.analysis.status === 'verified_hires') {
        authBadgeHtml = `<span class="badge badge-verified" title="${escapeHtml(track.analysis.notes)}">[Asli]</span>`;
      } else if (track.analysis.status === 'suspected_upsample' || track.analysis.status === 'suspected_transcode') {
        authBadgeHtml = `<span class="badge badge-suspect" title="${escapeHtml(track.analysis.notes)}">[Palsu]</span>`;
      }
    }

    // Missing badge
    const missingBadgeHtml = track.missing ? `<span class="badge badge-missing">Missing</span>` : '';

    const title = track.overrides?.title || track.metadata?.title || track.name;
    const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown';
    const album = track.overrides?.album || track.metadata?.album || '';
    const duration = formatDuration(track.streamInfo?.duration || 0);

    let coverUrl = track.overrides?.pictureUrl !== undefined ? track.overrides.pictureUrl : track.metadata?.pictureUrl;
    if (!coverUrl && album && album !== 'Tanpa Album' && album !== 'Album Tidak Diketahui') {
      const allTracks = store.get('tracks') || [];
      const normAlb = album.toLowerCase().trim();
      const normArt = (artist || '').toLowerCase().trim();
      const sibling = allTracks.find(t => {
        const tAlb = (t.overrides?.album || t.metadata?.album || '').toLowerCase().trim();
        const tArt = (t.overrides?.artist || t.metadata?.artist || '').toLowerCase().trim();
        const tPic = t.overrides?.pictureUrl || t.metadata?.pictureUrl;
        return tAlb === normAlb && (!normArt || tArt.includes(normArt) || normArt.includes(tArt)) && tPic;
      }) || allTracks.find(t => {
        const tAlb = (t.overrides?.album || t.metadata?.album || '').toLowerCase().trim();
        const tPic = t.overrides?.pictureUrl || t.metadata?.pictureUrl;
        return tAlb === normAlb && tPic;
      });
      if (sibling) {
        coverUrl = sibling.overrides?.pictureUrl || sibling.metadata?.pictureUrl;
        if (!track.metadata) track.metadata = {};
        track.metadata.pictureUrl = coverUrl;
        track.metadata.hasCover = true;
      }
    }
    const thumbHtml = coverUrl
      ? `<img src="${coverUrl}" alt="Cover" loading="lazy" />`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 16.5C9.51 16.5 7.5 14.49 7.5 12C7.5 9.51 9.51 7.5 12 7.5C14.49 7.5 16.5 9.51 16.5 12C16.5 14.49 14.49 16.5 12 16.5ZM12 11C11.45 11 11 11.45 11 12C11 12.55 11.45 13 12 13C12.55 13 13 12.55 13 12C13 11.45 12.55 11 12 11Z"/></svg>`;

    row.innerHTML = `
      ${showIndex ? `<div class="mono" style="font-size:0.75rem; color:var(--text-dim); width:20px; text-align:center;">${index + 1}</div>` : ''}
      <div class="track-cover-thumb">${thumbHtml}</div>
      <div class="track-info">
        <div class="track-title truncate">${escapeHtml(title)}</div>
        <div class="track-artist truncate">
          ${renderArtistLinks(artist)}
          ${album ? `<span class="meta-dot">&bull;</span><span class="clickable-album" data-album="${escapeHtml(album)}">${escapeHtml(album)}</span>` : ''}
        </div>
      </div>
      <div class="track-meta">
        ${compareBtnHtml}
        ${missingBadgeHtml}
        <span class="badge ${tierInfo.badgeClass}" title="${escapeHtml(tierInfo.details || tierInfo.label)}" aria-label="${escapeHtml(tierInfo.label)}">${escapeHtml(tierInfo.shortTag || tierInfo.label)}</span>
        ${authBadgeHtml}
      </div>
      <div class="track-duration">${duration}</div>
    `;

    // Click handler (handles multi-select on ctrl/shift or regular play)
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-compare-track')) {
        e.stopPropagation();
        const otherTrack = duplicateSiblings.find(t => t.id !== track.id) || duplicateSiblings[1];
        abCompareModal.open(track, otherTrack);
        return;
      }
      if (e.target.closest('.clickable-artist') || e.target.closest('.clickable-album')) {
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        selectionBar.toggle(track.id);
        return;
      }
      if (typeof onClick === 'function') onClick(track);
    });

    // Context menu binding
    contextMenu.bind(row, { track, playlistId, index, isEditMode });

    return row;
  }
}
