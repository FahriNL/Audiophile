/**
 * artistsView.js - Artists grid view with track counts
 */

import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { escapeHtml, getArtistInitials, getDarkArtistGradient } from '../../core/utils.js';
import { artistMetaService } from '../../library/artistMeta.js';

class ArtistsView {
  constructor() {
    this.container = null;
  }

  init() {
    this.container = document.getElementById('artistGrid');
    store.subscribe('tracks', () => this.render());
  }

  activate() {
    this.render();
  }

  render() {
    if (!this.container) return;
    const tracks = store.get('tracks') || [];

    const artistMap = new Map();
    for (const t of tracks) {
      const name = t.overrides?.artist || t.metadata?.artist || 'Unknown Artist';
      if (!artistMap.has(name)) {
        const cachedMeta = artistMetaService.getFromMemory(name);
        artistMap.set(name, {
          name,
          count: 0,
          pictureUrl: cachedMeta?.avatarUrl || t.metadata?.pictureUrl
        });
      }
      const record = artistMap.get(name);
      record.count++;
      if (!record.pictureUrl) {
        const cachedMeta = artistMetaService.getFromMemory(name);
        record.pictureUrl = cachedMeta?.avatarUrl || t.metadata?.pictureUrl;
      }
    }

    const countHeader = document.getElementById('statsArtistsText');
    if (countHeader) countHeader.innerText = `${artistMap.size} Artis Ditemukan`;

    this.container.innerHTML = Array.from(artistMap.values()).map(art => {
      const initials = getArtistInitials(art.name);
      const darkGradient = getDarkArtistGradient(art.name);
      return `
      <div class="card artist-card" data-artist="${escapeHtml(art.name)}" title="${escapeHtml(art.name)}">
        <div class="card-thumb">
          ${art.pictureUrl ? `
            <img src="${art.pictureUrl}" alt="Artist Picture" loading="lazy" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
            <div style="display:none; width:100%; height:100%; align-items:center; justify-content:center; background:${darkGradient}; color:#f8fafc; font-family:var(--font-heading); font-size:1.8rem; font-weight:700;">${escapeHtml(initials)}</div>
          ` : `
            <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:${darkGradient}; color:#f8fafc; font-family:var(--font-heading); font-size:1.8rem; font-weight:700;">${escapeHtml(initials)}</div>
          `}
        </div>
        <div class="card-body">
          <div class="card-title line-clamp-2" title="${escapeHtml(art.name)}">${escapeHtml(art.name)}</div>
          <div class="card-subtitle truncate">${art.count} Lagu</div>
        </div>
      </div>
    `;
    }).join('');

    this.container.querySelectorAll('.artist-card').forEach(card => {
      card.addEventListener('click', () => {
        const artistName = card.getAttribute('data-artist');
        if (artistName) {
          router.navigate('artistDetail', { artist: artistName });
        }
      });
    });
  }
}

export const artistsView = new ArtistsView();
