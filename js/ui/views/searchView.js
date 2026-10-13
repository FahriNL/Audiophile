/**
 * searchView.js - Dedicated Audiophile Search & Exploration View.
 * Features:
 * - Hero search bar with instant debounced multi-category querying
 * - Category filter chips (Semua, Lagu, Artis, Album, Hi-Res / Studio, Lossless CD, Genres)
 * - Live categorized results:
 *   - Artis: circular 136px avatar cards, clicking opens artist detail
 *   - Album: square artwork cards, clicking opens album detail
 *   - Lagu: spec-tagged track rows with 1-click play and queue actions
 * - Explore & Browse tiles when query is empty:
 *   - Audiophile format tiles (Hi-Res 24/96+, Studio Master, DSD, Lossless CD)
 *   - Dynamic library genres explorer
 */

import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { engine } from '../../player/engine.js';
import { queueManager } from '../../player/queue.js';
import { formatDuration, escapeHtml, getArtistInitials, getDarkArtistGradient, parseArtistNames, renderArtistLinks } from '../../core/utils.js';
import { classifyQualityTier } from '../../quality/tiers.js';
import { toast } from '../components/toast.js';
import { contextMenu } from '../components/contextMenu.js';
import { t } from '../../core/i18n.js';
import { events } from '../../core/events.js';

class SearchView {
  constructor() {
    this.container = null;
    this.query = '';
    this.activeFilter = 'all'; // all | tracks | artists | albums | hires | lossless | [genre]
    this.debounceTimer = null;
  }

  init() {
    this.container = document.getElementById('viewSearch');
    store.subscribe('tracks', () => {
      if (this.container && this.container.classList.contains('active')) {
        this.render();
      }
    });
    events.on('i18n:changed', () => {
      if (this.container && this.container.classList.contains('active')) {
        this.render();
      }
    });
  }

  activate(params = {}) {
    if (params && params.query !== undefined) {
      this.query = params.query;
    }
    if (params && params.filter) {
      this.activeFilter = params.filter;
    }
    const input = document.getElementById('topQuickSearchInput');
    const clearBtn = document.getElementById('btnTopSearchClear');
    if (input && this.query) {
      input.value = this.query;
      if (clearBtn) clearBtn.style.display = 'flex';
    }
    this.render();
    this.focusInput();
  }

  focusInput() {
    setTimeout(() => {
      const input = document.getElementById('topQuickSearchInput');
      if (input) {
        input.focus();
        input.select();
      }
    }, 60);
  }

  setQuery(query) {
    this.query = query || '';
    const input = document.getElementById('topQuickSearchInput');
    const clearBtn = document.getElementById('btnTopSearchClear');
    if (input && input.value !== this.query) {
      input.value = this.query;
    }
    if (clearBtn) {
      clearBtn.style.display = this.query ? 'flex' : 'none';
    }
    if (this.query.trim().length >= 2) {
      if (this.saveSearchTimer) clearTimeout(this.saveSearchTimer);
      this.saveSearchTimer = setTimeout(() => {
        this.saveRecentSearch(this.query);
      }, 700);
    }
    this.renderResults();
  }

  getRecentSearches() {
    try {
      const raw = localStorage.getItem('audiophile_recent_searches');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  saveRecentSearch(query) {
    if (!query || !query.trim()) return;
    const q = query.trim();
    try {
      let list = this.getRecentSearches();
      list = [q, ...list.filter(item => item.toLowerCase() !== q.toLowerCase())].slice(0, 8);
      localStorage.setItem('audiophile_recent_searches', JSON.stringify(list));
    } catch {}
  }

  clearRecentSearches() {
    try {
      localStorage.removeItem('audiophile_recent_searches');
    } catch {}
  }

  setFilter(filter) {
    this.activeFilter = filter || 'all';
    this.render();
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:20px; max-width:1100px; margin:0 auto; width:100%;">
        <!-- Dynamic Results or Browse Explore State -->
        <div id="searchDynamicContent"></div>
      </div>
    `;

    this.renderResults();
  }

  renderResults() {
    const content = document.getElementById('searchDynamicContent');
    if (!content) return;

    const tracks = store.get('tracks') || [];
    const q = this.query.trim().toLowerCase();

    // If query is empty and filter is 'all', render Explore & Browse mode
    if (!q && this.activeFilter === 'all') {
      content.innerHTML = this.renderExploreSections(tracks);
      this.bindExploreEvents();
      return;
    }

    // Filter tracks
    const matchingTracks = tracks.filter(t => {
      const title = (t.overrides?.title || t.metadata?.title || t.name || '').toLowerCase();
      const artist = (t.overrides?.artist || t.metadata?.artist || '').toLowerCase();
      const album = (t.overrides?.album || t.metadata?.album || '').toLowerCase();
      const genre = (t.overrides?.genre || t.metadata?.genre || '').toLowerCase();
      const tier = (t.qualityTier || '').toLowerCase();

      // Check text match
      const textMatch = !q || title.includes(q) || artist.includes(q) || album.includes(q) || genre.includes(q) || tier.includes(q);
      if (!textMatch) return false;

      // Check category filter
      if (this.activeFilter === 'hires') {
        return ['hi-res', 'studio', 'dsd'].includes(tier);
      }
      if (this.activeFilter === 'lossless') {
        return tier === 'lossless';
      }
      if (this.activeFilter !== 'all' && this.activeFilter !== 'tracks' && this.activeFilter !== 'artists' && this.activeFilter !== 'albums') {
        // Genre filter
        return genre.toLowerCase() === this.activeFilter.toLowerCase();
      }
      return true;
    });

    // Group matching artists (supports multi-artist delimiter ';')
    const matchingArtistsMap = new Map();
    for (const t of tracks) {
      const rawArt = t.overrides?.artist || t.metadata?.artist || 'Unknown Artist';
      const parsed = parseArtistNames(rawArt);
      const artists = parsed.length > 0 ? parsed : [rawArt];
      for (const art of artists) {
        if (!q || art.toLowerCase().includes(q)) {
          if (!matchingArtistsMap.has(art)) {
            matchingArtistsMap.set(art, { name: art, tracks: [], avatarUrl: t.metadata?.pictureUrl || '' });
          }
          matchingArtistsMap.get(art).tracks.push(t);
        }
      }
    }
    const matchingArtists = [...matchingArtistsMap.values()].slice(0, 8);

    // Group matching albums
    const matchingAlbumsMap = new Map();
    for (const t of tracks) {
      const alb = t.overrides?.album || t.metadata?.album || 'Unknown Album';
      const art = t.overrides?.artist || t.metadata?.artist || 'Unknown Artist';
      if (!q || alb.toLowerCase().includes(q) || art.toLowerCase().includes(q)) {
        if (!matchingAlbumsMap.has(alb)) {
          matchingAlbumsMap.set(alb, { name: alb, artist: art, tracks: [], coverUrl: t.metadata?.pictureUrl || '' });
        }
        matchingAlbumsMap.get(alb).tracks.push(t);
      }
    }
    const matchingAlbums = [...matchingAlbumsMap.values()].slice(0, 8);

    const showTracks = this.activeFilter === 'all' || this.activeFilter === 'tracks' || this.activeFilter === 'hires' || this.activeFilter === 'lossless' || (this.activeFilter !== 'artists' && this.activeFilter !== 'albums');
    const showArtists = (this.activeFilter === 'all' || this.activeFilter === 'artists') && q.length > 0;
    const showAlbums = (this.activeFilter === 'all' || this.activeFilter === 'albums') && q.length > 0;

    const totalResults = matchingTracks.length + (showArtists ? matchingArtists.length : 0) + (showAlbums ? matchingAlbums.length : 0);

    if (totalResults === 0) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </div>
          <h3>${escapeHtml(t('search.noResults'))}</h3>
          <p>${t('search.noResultsDesc', { query: `<strong>${escapeHtml(this.query)}</strong>` })}</p>
          <button class="btn btn-secondary" id="btnResetSearchHero">${escapeHtml(t('search.resetSearch'))}</button>
        </div>
      `;
      document.getElementById('btnResetSearchHero')?.addEventListener('click', () => {
        this.query = '';
        this.activeFilter = 'all';
        this.render();
      });
      return;
    }

    let html = `<div style="display:flex; flex-direction:column; gap:32px;">`;

    // 1. Artis Section (Round 136px circle avatar cards)
    if (showArtists && matchingArtists.length > 0) {
      html += `
        <div>
          <div class="search-category-header">
            <h3>${escapeHtml(t('search.matchingArtists', { count: matchingArtists.length }))}</h3>
          </div>
          <div class="search-artists-grid">
            ${matchingArtists.map(a => {
              const initials = getArtistInitials(a.name);
              const darkGradient = getDarkArtistGradient(a.name);
              return `
              <div class="search-artist-card" data-artist="${escapeHtml(a.name)}" role="button" tabindex="0">
                <div class="search-artist-avatar-wrap">
                  ${a.avatarUrl ? `
                    <img src="${a.avatarUrl}" alt="${escapeHtml(a.name)}" class="search-artist-avatar-img" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
                    <div class="search-artist-avatar-fallback" style="display:none; background:${darkGradient};">
                      <span style="font-family:var(--font-heading); font-size:1.8rem; font-weight:700; color:#f8fafc;">${escapeHtml(initials)}</span>
                    </div>
                  ` : `
                    <div class="search-artist-avatar-fallback" style="background:${darkGradient};">
                      <span style="font-family:var(--font-heading); font-size:1.8rem; font-weight:700; color:#f8fafc;">${escapeHtml(initials)}</span>
                    </div>
                  `}
                </div>
                <div class="search-artist-info">
                  <div class="search-artist-name line-clamp-2" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</div>
                  <div class="search-artist-meta">${a.tracks.length} ${escapeHtml(t('common.songs'))}</div>
                </div>
              </div>
            `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // 2. Album Section (Square cards)
    if (showAlbums && matchingAlbums.length > 0) {
      html += `
        <div>
          <div class="search-category-header">
            <h3>${escapeHtml(t('search.matchingAlbums', { count: matchingAlbums.length }))}</h3>
          </div>
          <div class="search-albums-grid">
            ${matchingAlbums.map(alb => `
              <div class="card search-album-card" data-album="${escapeHtml(alb.name)}" role="button" tabindex="0" title="${escapeHtml(alb.name)} • ${escapeHtml(alb.artist)}">
                <div class="card-thumb">
                  ${alb.coverUrl ? `
                    <img src="${alb.coverUrl}" alt="${escapeHtml(alb.name)}" style="width:100%; height:100%; object-fit:cover;" />
                  ` : `
                    <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:var(--bg-surface-elevated);">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                    </div>
                  `}
                </div>
                <div class="card-body">
                  <div class="card-title line-clamp-2" title="${escapeHtml(alb.name)}">${escapeHtml(alb.name)}</div>
                  <div class="card-subtitle truncate" title="${escapeHtml(alb.artist)}">${escapeHtml(alb.artist)}</div>
                  <div style="font-size:0.7rem; color:var(--text-dim); margin-top:2px;">${alb.tracks.length} ${escapeHtml(t('common.songs'))}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // 3. Lagu Section (Track rows with audiophile specs & actions)
    if (showTracks && matchingTracks.length > 0) {
      html += `
        <div>
          <div class="search-category-header">
            <h3>${escapeHtml(t('search.matchingTracks', { count: matchingTracks.length }))}</h3>
            <button class="btn btn-action-round btn-play-round" id="btnPlayAllSearchResults" title="${escapeHtml(t('search.playAll'))}" aria-label="${escapeHtml(t('search.playAll'))}" style="width:44px; height:44px; min-width:44px; min-height:44px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
            </button>
          </div>
          <div class="track-list" id="searchTracksList">
            ${matchingTracks.map(trk => {
              const title = trk.overrides?.title || trk.metadata?.title || trk.name;
              const artist = trk.overrides?.artist || trk.metadata?.artist || 'Unknown Artist';
              const album = trk.overrides?.album || trk.metadata?.album || '';
              const tierInfo = classifyQualityTier(trk.streamInfo, trk.format);

              return `
                <div class="track-row" data-id="${trk.id}" role="button" tabindex="0">
                  <div class="track-cover-thumb">
                    ${trk.metadata?.pictureUrl ? `
                      <img src="${trk.metadata.pictureUrl}" alt="Cover" />
                    ` : `
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg>
                    `}
                  </div>
                  <div class="track-info">
                    <div class="track-title truncate">${escapeHtml(title)}</div>
                    <div class="track-artist truncate">
                      ${renderArtistLinks(artist)}
                      ${album ? `<span class="meta-dot">&bull;</span><span class="clickable-album" data-album="${escapeHtml(album)}">${escapeHtml(album)}</span>` : ''}
                    </div>
                  </div>
                  <div class="track-meta">
                    <span class="badge ${tierInfo.badgeClass}" title="${escapeHtml(tierInfo.details || tierInfo.label)}" aria-label="${escapeHtml(tierInfo.label)}">${escapeHtml(tierInfo.shortTag || tierInfo.label)}</span>
                    <span class="mono" style="font-size:0.75rem; color:var(--text-muted); min-width:44px; text-align:right;">${formatDuration(trk.duration || 0)}</span>
                    <button class="btn btn-ghost btn-sm btn-play-single-search" data-id="${trk.id}" title="${escapeHtml(t('actions.play'))}">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-sm btn-queue-single-search" data-id="${trk.id}" title="${escapeHtml(t('collection.selectionBar.addToQueue'))}">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    html += `</div>`;
    content.innerHTML = html;

    this.bindResultEvents(matchingTracks);
  }

  renderExploreSections(tracks) {
    const hiresCount = tracks.filter(t => t.qualityTier === 'HI-RES').length;
    const studioCount = tracks.filter(t => t.qualityTier === 'STUDIO').length;
    const dsdCount = tracks.filter(t => t.qualityTier === 'DSD').length;
    const losslessCount = tracks.filter(t => t.qualityTier === 'LOSSLESS').length;

    const recentSearches = this.getRecentSearches();

    // Top artists by track count in collection (supports multi-artist ;)
    const artistsMap = new Map();
    for (const t of tracks) {
      const rawA = t.overrides?.artist || t.metadata?.artist;
      const parsed = parseArtistNames(rawA);
      const list = parsed.length > 0 ? parsed : (rawA ? [rawA] : []);
      for (const a of list) {
        if (a && a !== 'Unknown Artist') {
          artistsMap.set(a, (artistsMap.get(a) || 0) + 1);
        }
      }
    }
    const topArtists = [...artistsMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    // Genres map
    const genresMap = new Map();
    for (const t of tracks) {
      const g = t.metadata?.genre || t.overrides?.genre;
      if (g && typeof g === 'string') {
        const c = g.trim();
        if (c) genresMap.set(c, (genresMap.get(c) || 0) + 1);
      }
    }
    const genresList = [...genresMap.entries()].sort((a, b) => b[1] - a[1]);

    return `
      <div style="display:flex; flex-direction:column; gap:28px;">
        <!-- 0. Recent Searches -->
        ${recentSearches.length > 0 ? `
          <div>
            <div class="search-category-header" style="margin-bottom:8px;">
              <h4 style="font-size:0.85rem; font-weight:700; color:var(--text-main); margin:0;">${escapeHtml(t('search.recentSearches'))}</h4>
              <button class="btn btn-ghost btn-sm" id="btnClearRecentSearches" style="font-size:0.75rem; padding:2px 8px; color:var(--text-dim);">
                ${escapeHtml(t('search.clearHistory'))}
              </button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
              ${recentSearches.map(term => `
                <button class="btn btn-secondary btn-sm search-recent-chip" data-query="${escapeHtml(term)}" style="border-radius:var(--radius-full); padding:4px 12px; font-size:0.78rem;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <span>${escapeHtml(term)}</span>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 1. Audiophile Formats Section (Dimmed if empty) -->
        <div>
          <div class="search-category-header">
            <h3>${escapeHtml(t('search.exploreByQuality'))}</h3>
            <span style="font-size:0.75rem; color:var(--text-dim);">${escapeHtml(t('search.bitstreamTag'))}</span>
          </div>
          <div class="search-browse-grid">
            <div class="search-format-card ${hiresCount === 0 ? 'empty' : ''}" data-format-filter="hires">
              <div class="search-format-badge badge-hires">HI-RES AUDIO</div>
              <div class="search-format-title">Master Hi-Res (24/96+)</div>
              <div class="search-format-desc">24-Bit dengan resolusi sampling 88.2, 96, hingga 192 kHz FLAC & ALAC.</div>
              <div class="search-format-count">${escapeHtml(t('search.tracksAvailable', { count: hiresCount }))}</div>
            </div>

            <div class="search-format-card ${studioCount === 0 ? 'empty' : ''}" data-format-filter="studio">
              <div class="search-format-badge badge-studio">STUDIO MASTER</div>
              <div class="search-format-title">Studio 24-Bit / 44.1-48k</div>
              <div class="search-format-desc">Kedalaman bit 24-bit studio asli untuk rentang dinamis tanpa distorsi.</div>
              <div class="search-format-count">${escapeHtml(t('search.tracksAvailable', { count: studioCount }))}</div>
            </div>

            <div class="search-format-card ${dsdCount === 0 ? 'empty' : ''}" data-format-filter="dsd">
              <div class="search-format-badge badge-dsd">DSD DIRECT STREAM</div>
              <div class="search-format-title">DSD64 / DSD128 / SACD</div>
              <div class="search-format-desc">Modulasi 1-bit Direct Stream Digital murni (DSF, DFF) format SACD audiophile.</div>
              <div class="search-format-count">${escapeHtml(t('search.tracksAvailable', { count: dsdCount }))}</div>
            </div>

            <div class="search-format-card ${losslessCount === 0 ? 'empty' : ''}" data-format-filter="lossless">
              <div class="search-format-badge badge-lossless">LOSSLESS CD</div>
              <div class="search-format-title">CD Standard (16/44.1)</div>
              <div class="search-format-desc">Kualitas Red Book 16-Bit / 44.1 kHz FLAC, WAV & APE tanpa kompresi desibel.</div>
              <div class="search-format-count">${escapeHtml(t('search.tracksAvailable', { count: losslessCount }))}</div>
            </div>
          </div>
        </div>

        <!-- 2. Pintasan Artis Populer -->
        ${topArtists.length > 0 ? `
          <div>
            <div class="search-category-header">
              <h3>${escapeHtml(t('search.popularArtists'))}</h3>
              <span style="font-size:0.75rem; color:var(--text-dim);">${escapeHtml(t('search.topArtistsInCollection', { count: topArtists.length }))}</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:12px;">
              ${topArtists.map(([artistName, songCount]) => {
                const sampleTrack = tracks.find(t => (t.overrides?.artist || t.metadata?.artist) === artistName);
                const pic = sampleTrack?.metadata?.pictureUrl;
                const initials = getArtistInitials(artistName);
                const darkGradient = getDarkArtistGradient(artistName);
                return `
                  <div class="search-artist-shortcut-card" data-artist="${escapeHtml(artistName)}" style="padding:14px 10px; background:var(--glass-bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-md); display:flex; flex-direction:column; align-items:center; text-align:center; cursor:pointer; gap:8px; transition:all 0.18s ease;">
                    <div style="width:52px; height:52px; border-radius:50%; overflow:hidden; background:${darkGradient}; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(0,0,0,0.35);">
                      ${pic ? `<img src="${pic}" alt="${escapeHtml(artistName)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" /><span style="display:none; font-family:var(--font-heading); font-size:1.1rem; font-weight:700; color:#f8fafc;">${escapeHtml(initials)}</span>` : `<span style="font-family:var(--font-heading); font-size:1.1rem; font-weight:700; color:#f8fafc;">${escapeHtml(initials)}</span>`}
                    </div>
                    <div style="min-width:0; width:100%;">
                      <div class="truncate" style="font-size:0.84rem; font-weight:700; color:var(--text-main);" title="${escapeHtml(artistName)}">${escapeHtml(artistName)}</div>
                      <div style="font-size:0.72rem; color:var(--text-dim); margin-top:2px;">${songCount} ${escapeHtml(t('common.songs'))}</div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 3. Genre Explorer -->
        ${genresList.length > 0 ? `
          <div>
            <div class="search-category-header">
              <h3>${escapeHtml(t('search.exploreGenres'))}</h3>
              <span style="font-size:0.75rem; color:var(--text-dim);">${escapeHtml(t('search.categoriesFound', { count: genresList.length }))}</span>
            </div>
            <div class="search-genre-chips-wrap">
              ${genresList.map(([genre, count]) => `
                <div class="search-genre-tile" data-genre="${escapeHtml(genre)}">
                  <span class="search-genre-title">${escapeHtml(genre)}</span>
                  <span class="search-genre-count">${count} ${escapeHtml(t('common.songs'))}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  bindExploreEvents() {
    this.container.querySelectorAll('.search-format-card[data-format-filter]').forEach(card => {
      card.addEventListener('click', () => {
        if (card.classList.contains('empty')) return;
        const fmt = card.getAttribute('data-format-filter');
        if (fmt === 'hires' || fmt === 'studio' || fmt === 'dsd') {
          this.setFilter('hires');
        } else if (fmt === 'lossless') {
          this.setFilter('lossless');
        }
      });
    });

    this.container.querySelectorAll('.search-genre-tile[data-genre]').forEach(tile => {
      tile.addEventListener('click', () => {
        const genre = tile.getAttribute('data-genre');
        this.setFilter(genre);
      });
    });

    // Recent search chips
    this.container.querySelectorAll('.search-recent-chip[data-query]').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.getAttribute('data-query');
        this.setQuery(q);
      });
    });

    // Clear recent searches
    this.container.querySelector('#btnClearRecentSearches')?.addEventListener('click', () => {
      this.clearRecentSearches();
      this.render();
    });

    // Artist shortcut cards
    this.container.querySelectorAll('.search-artist-shortcut-card[data-artist]').forEach(card => {
      card.addEventListener('click', () => {
        const artist = card.getAttribute('data-artist');
        router.navigate('artistDetail', { artist });
      });
    });
  }

  bindResultEvents(matchingTracks) {
    // Artist card clicks
    this.container.querySelectorAll('.search-artist-card[data-artist]').forEach(card => {
      card.addEventListener('click', () => {
        const artist = card.getAttribute('data-artist');
        router.navigate('artistDetail', { artist });
      });
    });

    // Album card clicks
    this.container.querySelectorAll('.search-album-card[data-album]').forEach(card => {
      card.addEventListener('click', () => {
        const album = card.getAttribute('data-album');
        router.navigate('albumDetail', { album });
      });
    });

    // Play all results button
    document.getElementById('btnPlayAllSearchResults')?.addEventListener('click', () => {
      if (matchingTracks.length > 0) {
        queueManager.setQueue(matchingTracks, 0);
        toast.info(`Memutar ${matchingTracks.length} lagu hasil pencarian.`);
      }
    });

    // Individual track play / queue clicks
    this.container.querySelectorAll('.btn-play-single-search').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const idx = matchingTracks.findIndex(t => t.id === id);
        if (idx >= 0) {
          queueManager.setQueue(matchingTracks, idx);
        }
      });
    });

    this.container.querySelectorAll('.btn-queue-single-search').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const trk = matchingTracks.find(t => t.id === id);
        if (trk) {
          queueManager.addToQueue(trk);
          toast.info(`Ditambahkan ke antrean: ${trk.overrides?.title || trk.name}`);
        }
      });
    });

    // Track row click and context menu
    this.container.querySelectorAll('.track-row[data-id]').forEach(row => {
      const id = row.getAttribute('data-id');
      const trk = matchingTracks.find(t => t.id === id);
      if (trk) {
        contextMenu.bind(row, { track: trk });
      }
      row.addEventListener('click', (e) => {
        if (e.target.closest('.clickable-artist') || e.target.closest('.clickable-album') || e.target.closest('button')) {
          return;
        }
        const idx = matchingTracks.findIndex(t => t.id === id);
        if (idx >= 0) {
          queueManager.setQueue(matchingTracks, idx);
        }
      });
    });
  }
}

export const searchView = new SearchView();
