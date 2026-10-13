/**
 * albumsView.js - Albums grid view with cover art and Hi-Res indicator
 */

import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { escapeHtml } from '../../core/utils.js';

class AlbumsView {
  constructor() {
    this.container = null;
  }

  init() {
    this.container = document.getElementById('albumGrid');
    store.subscribe('tracks', () => this.render());
  }

  activate() {
    this.render();
  }

  render() {
    if (!this.container) return;
    const tracks = store.get('tracks') || [];

    const albumsMap = new Map();
    for (const t of tracks) {
      const albumName = t.overrides?.album || t.metadata?.album || 'Tanpa Album';
      if (!albumsMap.has(albumName)) {
        albumsMap.set(albumName, {
          name: albumName,
          artist: t.overrides?.artist || t.metadata?.artist || 'Unknown Artist',
          tracks: [],
          hasHires: false,
          pictureUrl: t.metadata?.pictureUrl
        });
      }
      const record = albumsMap.get(albumName);
      record.tracks.push(t);
      if (t.tier === 'HI-RES' || t.tier === 'DSD') record.hasHires = true;
      if (!record.pictureUrl && t.metadata?.pictureUrl) record.pictureUrl = t.metadata.pictureUrl;
    }

    const countHeader = document.getElementById('statsAlbumsText');
    if (countHeader) countHeader.innerText = `${albumsMap.size} Album Tersedia`;

    this.container.innerHTML = Array.from(albumsMap.values()).map(album => `
      <div class="card album-card" data-album="${escapeHtml(album.name)}" title="${escapeHtml(album.name)} • ${escapeHtml(album.artist)}">
        <div class="card-thumb">
          ${album.pictureUrl ? `<img src="${album.pictureUrl}" alt="Album Art" loading="lazy" />` : `<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 16.5C9.51 16.5 7.5 14.49 7.5 12C7.5 9.51 9.51 7.5 12 7.5C14.49 7.5 16.5 9.51 16.5 12C16.5 14.49 14.49 16.5 12 16.5ZM12 11C11.45 11 11 11.45 11 12C11 12.55 11.45 13 12 13C12.55 13 13 12.55 13 12C13 11.45 12.55 11 12 11Z"/></svg>`}
          ${album.hasHires ? `<div style="position:absolute; top:6px; right:6px;"><span class="badge badge-hires">HI-RES</span></div>` : ''}
        </div>
        <div class="card-body">
          <div class="card-title line-clamp-2" title="${escapeHtml(album.name)}">${escapeHtml(album.name)}</div>
          <div class="card-subtitle truncate">${escapeHtml(album.artist)} • ${album.tracks.length} lagu</div>
        </div>
      </div>
    `).join('');

    this.container.querySelectorAll('.album-card').forEach(card => {
      card.addEventListener('click', () => {
        const albumName = card.getAttribute('data-album');
        if (albumName) {
          router.navigate('albumDetail', { album: albumName });
        }
      });
    });
  }
}

export const albumsView = new AlbumsView();
