/**
 * collectionView.js - Unified music collection view.
 * Integrates:
 * - Round Artist Profiles (pure circular avatars with NO text beneath, tooltip on hover, click to view detail)
 * - Square Album Cards (standard square artworks with titles and artists)
 * - Playlist Collection & Creator
 * - Complete Tracks Table sub-tab with virtual list & instant search
 */

import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { playlistService } from '../../playlists/playlistService.js';
import { artistMetaService } from '../../library/artistMeta.js';
import { TrackRowRenderer } from '../components/trackRow.js';
import { queueManager } from '../../player/queue.js';
import { escapeHtml, debounce, formatDuration, getArtistInitials, getDarkArtistGradient, hashString, parseArtistNames } from '../../core/utils.js';
import { toast } from '../components/toast.js';
import { DuplicateManager } from '../../library/dedupe.js';
import { abCompareModal } from '../components/abCompareModal.js';
import { classifyQualityTier } from '../../quality/tiers.js';
import { getIconSvg } from '../icons.js';
import { liquid } from '../motion/fluidKit.js';
import { folderManager } from '../../library/folders.js';
import { t } from '../../core/i18n.js';
import { events } from '../../core/events.js';

let orbitMeasureCtx = null;

/**
 * Membangun orbit nama artis: nama ditulis SEKALI dengan spasi alami (rapat),
 * diletakkan simetris di puncak lingkaran, lalu sisa busur diisi
 * "ekor" titik yang mengecil dan memudar sehingga lingkaran tetap terasa penuh 360 derajat.
 */
function buildArtistOrbit(name) {
  const R = 64;
  const CIRC = 2 * Math.PI * R;
  const GAP = 12;
  const MAX_TEXT = CIRC - GAP * 2 - 14;
  let text = (name || 'Artis').toUpperCase().trim().replace(/\s+/g, ' ');
  if (text.length > 40) text = text.slice(0, 38).trim() + '…';

  let fontSize = 10.5;
  const tracking = 0.9;
  const measure = (fs) => {
    try {
      if (!orbitMeasureCtx) orbitMeasureCtx = document.createElement('canvas').getContext('2d');
      orbitMeasureCtx.font = `700 ${fs}px 'Space Grotesk', sans-serif`;
      return orbitMeasureCtx.measureText(text).width + text.length * tracking;
    } catch (e) {
      return text.length * (fs * 0.68 + tracking);
    }
  };
  let width = measure(fontSize);
  if (width > MAX_TEXT) {
    fontSize = Math.max(7, fontSize * (MAX_TEXT / width));
    width = Math.min(MAX_TEXT, measure(fontSize));
  }

  // Titik ekor mengisi sisa busur (searah jarum jam setelah nama)
  const startArc = width + GAP;
  const endArc = CIRC - GAP;
  const step = 7;
  let dots = '';
  const count = Math.floor((endArc - startArc) / step);
  for (let i = 0; i <= count; i++) {
    const s = startArc + i * step;
    const theta = s / R;
    const dotR = 64 + fontSize * 0.36;
    const x = (76 + dotR * Math.sin(theta)).toFixed(2);
    const y = (76 - dotR * Math.cos(theta)).toFixed(2);
    const t = count > 0 ? i / count : 0;
    const r = (1.5 - 1.0 * t).toFixed(2);
    const op = (0.9 - 0.65 * t).toFixed(2);
    dots += `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" opacity="${op}" />`;
  }

  const rotateDeg = (-(width / 2) / R * 180 / Math.PI).toFixed(2);
  return { text, fontSize: fontSize.toFixed(1), textLen: width.toFixed(1), dots, rotateDeg };
}

class CollectionView {
  constructor() {
    this.container = null;
    this.currentSubTab = 'all'; // 'all' | 'albums' | 'artists' | 'playlists' | 'tracks'
    this.trackSearchQuery = '';
  }

  init() {
    this.container = document.getElementById('viewCollection');
    store.subscribe('tracks', () => this.render());
    store.subscribe('playlists', () => this.render());
    events.on('i18n:changed', () => this.render());
  }

  activate(params = {}) {
    if (params.tab) {
      this.currentSubTab = params.tab;
    }
    this.render();
  }

  render() {
    if (!this.container) return;

    const tracks = store.get('tracks') || [];
    const playlists = store.get('playlists') || [];

    if (tracks.length === 0) {
      this.container.innerHTML = `
        <div style="padding:48px 16px; text-align:center;">
          <div class="empty-state" style="max-width:540px; margin:0 auto;">
            <div class="empty-state-icon" style="margin-bottom:16px; color:var(--text-dim); display:flex; justify-content:center;">
              ${getIconSvg('library_music', { size: 48 })}
            </div>
            <h2 style="font-size:1.6rem; font-weight:700; margin-bottom:8px; color:var(--text-main);">${escapeHtml(t('collection.emptyCollection'))}</h2>
            <p style="color:var(--text-muted); font-size:0.9rem; line-height:1.6; margin-bottom:20px;">
              ${escapeHtml(t('collection.emptyDesc'))}
            </p>
            <button class="btn btn-primary" id="btnCollectionImportFolder" style="padding:10px 24px; display:inline-flex; align-items:center; gap:8px;">
              ${getIconSvg('folder_open', { size: 18 })}
              <span>${escapeHtml(t('home.importMusicFolder'))}</span>
            </button>
          </div>
        </div>
      `;
      document.getElementById('btnCollectionImportFolder')?.addEventListener('click', () => {
        folderManager.triggerFolderImport();
      });
      return;
    }

    // 1. Group Artists (split multi-artists separated by ';')
    const artistMap = new Map();
    for (const t of tracks) {
      const rawArtist = t.overrides?.artist || t.metadata?.artist || 'Unknown Artist';
      const parsedArtists = parseArtistNames(rawArtist);
      const names = parsedArtists.length > 0 ? parsedArtists : [rawArtist];
      const trackPic = t.overrides?.pictureUrl !== undefined ? t.overrides.pictureUrl : t.metadata?.pictureUrl;
      for (const name of names) {
        if (!artistMap.has(name)) {
          const cachedMeta = artistMetaService.getFromMemory(name);
          artistMap.set(name, {
            name,
            count: 0,
            pictureUrl: cachedMeta?.avatarUrl || trackPic || null
          });
        }
        const rec = artistMap.get(name);
        rec.count++;
        if (!rec.pictureUrl && trackPic) {
          rec.pictureUrl = trackPic;
        }
      }
    }
    const artists = Array.from(artistMap.values());

    // 2. Group Albums
    const albumMap = new Map();
    for (const t of tracks) {
      const albName = t.overrides?.album || t.metadata?.album || t('player.unknownAlbum');
      const trackPic = t.overrides?.pictureUrl !== undefined ? t.overrides.pictureUrl : t.metadata?.pictureUrl;
      if (!albumMap.has(albName)) {
        albumMap.set(albName, {
          name: albName,
          artist: t.overrides?.artist || t.metadata?.artist || 'Various Artists',
          year: t.metadata?.year || '',
          pictureUrl: trackPic || null,
          tracks: []
        });
      }
      const rec = albumMap.get(albName);
      rec.tracks.push(t);
      if (!rec.pictureUrl && trackPic) rec.pictureUrl = trackPic;
    }
    const albums = Array.from(albumMap.values());
    const duplicateGroups = DuplicateManager.findDuplicates(tracks);

    this.container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:24px;">
        <!-- Header & Internal Sub-Tabs Navigation -->
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px;">
          <div>
            <h2 style="font-size:1.8rem; font-weight:800; color:var(--text-main); margin:0; letter-spacing:-0.02em;">
              ${escapeHtml(t('collection.title'))}
            </h2>
            <div style="font-size:0.8rem; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px;">
              ${albums.length} ${escapeHtml(t('common.albums'))} • ${artists.length} ${escapeHtml(t('common.artists'))} • ${playlists.length} ${escapeHtml(t('collection.subtabs.playlists'))} • ${tracks.length} ${escapeHtml(t('common.songs'))}
            </div>
          </div>

          <!-- Sub-Tabs (Fluid Liquid Segmented Control) -->
          <div class="collection-sub-nav fk-seg" id="collectionSubNav">
            <div class="fk-pill"></div>
            <button class="collection-tab-btn ${this.currentSubTab === 'all' ? 'on active' : ''}" data-tab="all">${escapeHtml(t('collection.subtabs.all'))}</button>
            <button class="collection-tab-btn ${this.currentSubTab === 'albums' ? 'on active' : ''}" data-tab="albums">${escapeHtml(t('collection.subtabs.albums'))}</button>
            <button class="collection-tab-btn ${this.currentSubTab === 'artists' ? 'on active' : ''}" data-tab="artists">${escapeHtml(t('collection.subtabs.artists'))}</button>
            <button class="collection-tab-btn ${this.currentSubTab === 'playlists' ? 'on active' : ''}" data-tab="playlists">${escapeHtml(t('collection.subtabs.playlists'))}</button>
            <button class="collection-tab-btn ${this.currentSubTab === 'tracks' ? 'on active' : ''}" data-tab="tracks">${escapeHtml(t('collection.subtabs.tracks'))}</button>
            ${duplicateGroups.size > 0 ? `
              <button class="collection-tab-btn ${this.currentSubTab === 'duplicates' ? 'on active' : ''}" data-tab="duplicates">${escapeHtml(t('collection.subtabs.duplicates'))}</button>
            ` : ''}
          </div>
        </div>

        <!-- Section: Artists (Pure Circular Profiles with Orbiting Name & Spin on Hover) -->
        ${(this.currentSubTab === 'all' || this.currentSubTab === 'artists') ? `
          <div>
            <div class="home-section-header">
              <h3 class="home-section-title">${escapeHtml(t('collection.artistsSection'))} (${artists.length})</h3>
              <span style="font-size:0.75rem; color:var(--text-dim);">${escapeHtml(t('collection.artistsHoverHint'))}</span>
            </div>
            <div class="${this.currentSubTab === 'all' ? 'collection-artists-strip' : 'collection-artists-grid'}">
              ${artists.map((art, idx) => {
                const initials = getArtistInitials(art.name);
                const darkGradient = getDarkArtistGradient(art.name);
                const orbit = buildArtistOrbit(art.name);
                const pathId = `artistCirclePath_${idx}_${hashString(art.name)}`;
                return `
                <div class="artist-circle-wrapper" data-artist="${escapeHtml(art.name)}" title="${escapeHtml(art.name)} (${t('collection.trackCount', { count: art.count })})">
                  <div class="artist-circle-avatar-box">
                    ${art.pictureUrl ? `
                      <img class="artist-circle-avatar-img" src="${art.pictureUrl}" alt="${escapeHtml(art.name)}" loading="lazy" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
                      <div class="artist-circle-fallback-dark" style="display:none; background:${darkGradient};">
                        <span class="artist-initials">${escapeHtml(initials)}</span>
                      </div>
                    ` : `
                      <div class="artist-circle-fallback-dark" style="background:${darkGradient};">
                        <span class="artist-initials">${escapeHtml(initials)}</span>
                      </div>
                    `}
                  </div>
                  <svg class="artist-circle-ring-svg" viewBox="0 0 152 152" aria-hidden="true">
                    <defs>
                      <path id="${pathId}" d="M 76, 12 a 64, 64 0 1, 1 -0.1, 0" fill="none" />
                    </defs>
                    <g transform="rotate(${orbit.rotateDeg} 76 76)">
                      <text class="artist-orbit-text" style="font-size:${orbit.fontSize}px;">
                        <textPath href="#${pathId}" textLength="${orbit.textLen}" lengthAdjust="spacing">${escapeHtml(orbit.text)}</textPath>
                      </text>
                      ${orbit.dots}
                    </g>
                  </svg>
                </div>
              `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Section: Albums (Square Cards with Two-Line Clamp and Tooltip) -->
        ${(this.currentSubTab === 'all' || this.currentSubTab === 'albums') ? `
          <div>
            <div class="home-section-header">
              <h3 class="home-section-title">${escapeHtml(t('collection.albumsSection', { count: albums.length }))}</h3>
              <span style="font-size:0.75rem; color:var(--text-dim); font-family:var(--font-mono);">${escapeHtml(t('collection.albumReleases', { count: albums.length }))}</span>
            </div>
            <div class="grid-container">
              ${albums.map(alb => `
                <div class="card collection-album-card" data-album="${escapeHtml(alb.name)}" style="cursor:pointer;" title="${escapeHtml(alb.name)} • ${escapeHtml(alb.artist)}">
                  <div class="card-thumb" style="display:flex; align-items:center; justify-content:center; color:var(--text-dim);">
                    ${alb.pictureUrl ? `
                      <img src="${alb.pictureUrl}" alt="${escapeHtml(t('common.albums'))}" loading="lazy" />
                    ` : getIconSvg('library_music', { size: 36 })}
                  </div>
                  <div class="card-body">
                    <div class="card-title line-clamp-2" title="${escapeHtml(alb.name)}">${escapeHtml(alb.name)}</div>
                    <div class="card-subtitle truncate" title="${escapeHtml(alb.artist)}">${escapeHtml(alb.artist)}${alb.year ? ' • ' + alb.year : ''}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Section: Playlists -->
        ${(this.currentSubTab === 'all' || this.currentSubTab === 'playlists') ? `
          <div>
            <div class="home-section-header">
              <h3 class="home-section-title">${escapeHtml(t('collection.playlistsSection', { count: playlists.length }))}</h3>
              <button class="btn btn-primary btn-sm" id="btnCreateNewPlaylist" style="display:inline-flex; align-items:center; gap:6px;">
                ${getIconSvg('add', { size: 16 })}
                <span>${escapeHtml(t('collection.createPlaylist'))}</span>
              </button>
            </div>
            <div class="grid-container">
              ${playlists.map(pl => `
                <div class="card collection-playlist-card" data-playlist-id="${pl.id}" style="cursor:pointer;">
                  <div class="card-thumb" style="width:100%; aspect-ratio:1; overflow:hidden;">
                    ${playlistService.renderPlaylistThumbnail(pl, tracks)}
                  </div>
                  <div class="card-body">
                    <div class="card-title truncate">${escapeHtml(pl.name)}</div>
                    <div class="card-subtitle truncate">${t('collection.trackCount', { count: pl.trackIds?.length || 0 })}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Section: Semua Lagu (Full Tracks Sub-Tab) -->
        ${(this.currentSubTab === 'tracks') ? `
          <div class="glass-panel" style="padding:20px; border-radius:var(--radius-lg);">
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:14px;">
              <h3 style="font-size:1.1rem; font-weight:600; color:var(--text-main); margin:0;">
                ${escapeHtml(t('collection.allTracksTitle', { count: tracks.length }))}
              </h3>
              <input type="text" class="artist-quick-search" id="inputCollectionTrackSearch" placeholder="${escapeHtml(t('collection.searchTracksPlaceholder'))}" value="${escapeHtml(this.trackSearchQuery)}" />
            </div>
            <div id="collectionFilteredTracksContainer" style="display:flex; flex-direction:column; gap:4px;"></div>
          </div>
        ` : ''}

        <!-- Section: Duplicates & Versions (AUD-03) -->
        ${(this.currentSubTab === 'duplicates') ? `
          <div>
            <div class="home-section-header">
              <h3 class="home-section-title">${escapeHtml(t('collection.duplicatesSection', { count: duplicateGroups.size }))}</h3>
              <span style="font-size:0.75rem; color:var(--text-dim);">${escapeHtml(t('collection.duplicatesDesc'))}</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:14px;">
              ${Array.from(duplicateGroups.values()).map(group => {
                const tr = group[0];
                const title = tr.overrides?.title || tr.metadata?.title || tr.name;
                const artist = tr.overrides?.artist || tr.metadata?.artist || 'Unknown Artist';
                return `
                  <div class="card" style="padding:16px; display:flex; flex-direction:column; gap:12px;">
                    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                      <div>
                        <strong style="font-size:1.05rem; color:var(--text-main);">${escapeHtml(title)}</strong>
                        <div style="font-size:0.8rem; color:var(--text-dim); margin-top:2px;">${escapeHtml(artist)} &bull; ${escapeHtml(t('collection.versionsFound', { count: group.length }))}</div>
                      </div>
                      <button class="btn btn-primary btn-sm btn-compare-group" data-key="${escapeHtml(DuplicateManager.getTrackKey(tr))}" style="display:inline-flex; align-items:center; gap:6px;">
                        ${getIconSvg('swap_horiz', { size: 16 })}
                        <span>${escapeHtml(t('collection.compareAB'))}</span>
                      </button>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                      ${group.map((gTrack, idx) => {
                        const tier = classifyQualityTier(gTrack.streamInfo, gTrack.format);
                        return `
                          <div style="display:flex; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.25); border-radius:var(--radius-sm); padding:8px 12px; font-size:0.82rem;">
                            <div style="display:flex; align-items:center; gap:10px;">
                              <span class="mono" style="color:var(--text-dim); font-size:0.75rem;">v${idx + 1}</span>
                              <span class="badge ${tier.badgeClass}">${tier.iconSvg} ${escapeHtml(tier.label)}</span>
                              <span class="mono" style="color:var(--text-main);">${escapeHtml(gTrack.format.toUpperCase())} &bull; ${gTrack.streamInfo?.sampleRate || 44100} Hz / ${gTrack.streamInfo?.bitDepth || 16}-bit</span>
                            </div>
                            <span class="mono" style="color:var(--text-dim); font-size:0.75rem;">${formatDuration(gTrack.streamInfo?.duration || 0)}</span>
                          </div>
                        `;
                      }).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    this.bindEvents(tracks);
  }

  bindEvents(tracks) {
    // Horizontal mouse wheel scrolling for artist circles strip
    const artistsStrip = this.container.querySelector('.collection-artists-strip');
    if (artistsStrip) {
      artistsStrip.addEventListener('wheel', (e) => {
        if (e.deltaY) {
          e.preventDefault();
          artistsStrip.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }

    // Fluid Liquid Sub-Tabs (Fluid Kit v2)
    const subNav = this.container.querySelector('.collection-sub-nav');
    if (subNav) {
      const btns = [...subNav.querySelectorAll('.collection-tab-btn')];
      const activeIdx = btns.findIndex(b => b.getAttribute('data-tab') === this.currentSubTab);
      liquid(subNav, {
        index: activeIdx >= 0 ? activeIdx : 0,
        drag: false,
        onChange: (idx, btn) => {
          const tab = btn.getAttribute('data-tab');
          if (tab && tab !== this.currentSubTab) {
            this.currentSubTab = tab;
            this.render();
          }
        }
      });
      if (activeIdx >= 0 && btns[activeIdx]) {
        try {
          btns[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } catch {
          btns[activeIdx].scrollIntoView();
        }
      }
    }

    // Group comparison button (AUD-03)
    this.container.querySelectorAll('.btn-compare-group').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        const duplicateGroups = DuplicateManager.findDuplicates(tracks);
        const grp = duplicateGroups.get(key);
        if (grp && grp.length > 1) {
          abCompareModal.open(grp[0], grp[1]);
        }
      });
    });

    // Artist Circle Click (Navigates to artist detail)
    this.container.querySelectorAll('.artist-circle-wrapper').forEach(wrapper => {
      wrapper.addEventListener('click', () => {
        const artistName = wrapper.getAttribute('data-artist');
        if (artistName) {
          router.navigate('artistDetail', { artist: artistName });
        }
      });
    });

    // Album Card Click (Navigates to album detail)
    this.container.querySelectorAll('.collection-album-card').forEach(card => {
      card.addEventListener('click', () => {
        const albumName = card.getAttribute('data-album');
        if (albumName) {
          router.navigate('albumDetail', { album: albumName });
        }
      });
    });

    // Playlist Card Click
    this.container.querySelectorAll('.collection-playlist-card').forEach(card => {
      card.addEventListener('click', () => {
        const plId = card.getAttribute('data-playlist-id');
        if (plId) {
          document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.view-pane').forEach(p => p.classList.remove('active'));
          document.getElementById('viewPlaylists')?.classList.add('active');
          router.navigate('playlists', { playlistId: plId });
        }
      });
    });

    // Create Playlist Button
    document.getElementById('btnCreateNewPlaylist')?.addEventListener('click', async () => {
      const name = prompt('Nama Playlist Baru:');
      if (name && name.trim()) {
        const newPl = await playlistService.createPlaylist(name.trim());
        toast.success(`Playlist "${newPl.name}" berhasil dibuat.`);
        document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view-pane').forEach(p => p.classList.remove('active'));
        document.getElementById('viewPlaylists')?.classList.add('active');
        router.navigate('playlists', { playlistId: newPl.id });
      }
    });

    // All Tracks Search
    if (this.currentSubTab === 'tracks') {
      const searchInput = document.getElementById('inputCollectionTrackSearch');
      if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
          this.trackSearchQuery = e.target.value.toLowerCase().trim();
          this.renderTrackRows(tracks);
        }, 150));
      }
      this.renderTrackRows(tracks);
    }
  }

  renderTrackRows(tracks) {
    const container = document.getElementById('collectionFilteredTracksContainer');
    if (!container) return;
    container.innerHTML = '';

    const q = this.trackSearchQuery;
    const filtered = q
      ? tracks.filter(t => {
          const title = (t.overrides?.title || t.metadata?.title || '').toLowerCase();
          const artist = (t.overrides?.artist || t.metadata?.artist || '').toLowerCase();
          const album = (t.overrides?.album || t.metadata?.album || '').toLowerCase();
          return title.includes(q) || artist.includes(q) || album.includes(q);
        })
      : tracks;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="padding:24px 0; text-align:center; color:var(--text-dim); font-size:0.85rem;">
          ${escapeHtml(t('collection.noMatchesForQuery', { query: this.trackSearchQuery }))}
        </div>
      `;
      return;
    }

    const currentTrack = store.get('currentTrack');
    filtered.slice(0, 100).forEach((track, idx) => {
      const row = TrackRowRenderer.render(track, {
        isPlaying: currentTrack && currentTrack.id === track.id,
        showIndex: true,
        index: idx,
        onClick: () => {
          queueManager.setQueue(filtered, idx);
        }
      });
      container.appendChild(row);
    });
  }
}

export const collectionView = new CollectionView();
