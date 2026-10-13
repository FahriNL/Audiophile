/**
 * artistDetailView.js - Audiophile-grade artist experience using unified CollectionPage
 * Features:
 * - Shared CollectionPage layout with ambient glass hero header
 * - Pure icon-only action buttons (Play, Shuffle, Add to Queue, Refresh Info)
 * - Top 5 most played tracks with ranking and play counts
 * - Categorized discography (Studio Albums vs Singles & EPs)
 * - Audiophile spec breakdown (format distribution, highest resolution, listening duration)
 * - Interactive biographical description with expandable read-more
 * - Real-time instant search filter across all artist tracks
 */

import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { queueManager } from '../../player/queue.js';
import { formatDuration, escapeHtml, parseArtistNames } from '../../core/utils.js';
import { classifyQualityTier } from '../../quality/tiers.js';
import { CollectionPage } from '../components/collectionPage.js';
import { TrackRowRenderer } from '../components/trackRow.js';
import { toast } from '../components/toast.js';
import { artistMetaService } from '../../library/artistMeta.js';
import { isServiceAllowed, isTotalOffline } from '../../core/network.js';
import { getIconSvg } from '../icons.js';
import { events } from '../../core/events.js';
import { t } from '../../core/i18n.js';

class ArtistDetailView {
  constructor() {
    this.container = null;
    this.currentArtistName = null;
    this.isBioExpanded = false;
    this.filterQuery = '';
  }

  init() {
    this.container = document.getElementById('viewArtistDetail');
    events.on('i18n:changed', () => {
      if (this.currentArtistName && this.container?.classList.contains('active')) {
        this.render();
      }
    });
  }

  activate(params = {}) {
    const isNewArtist = params.artist && params.artist !== this.currentArtistName;
    if (params.artist) {
      this.currentArtistName = params.artist;
      this.isBioExpanded = false;
      this.filterQuery = '';
    }
    if (isNewArtist) {
      CollectionPage.renderSkeleton(this.container, { type: 'artist', rows: 6 });
      requestAnimationFrame(() => this.render());
    } else {
      this.render();
    }
  }

  async render() {
    if (!this.container) return;

    const allTracks = store.get('tracks') || [];
    const artistName = this.currentArtistName || '';
    const artistTracks = allTracks.filter(t => {
      const raw = t.overrides?.artist || t.metadata?.artist || 'Unknown Artist';
      if (raw === artistName) return true;
      const list = parseArtistNames(raw);
      return list.includes(artistName);
    });

    if (artistTracks.length === 0) {
      this.container.innerHTML = `
        <div style="padding:32px 16px;">
          <button class="btn btn-secondary" id="btnBackToArtists" style="margin-bottom:16px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            <span>${escapeHtml(t('collection.backToArtists'))}</span>
          </button>
          <div class="empty-state">
            <h3>${escapeHtml(t('collection.artistNotFound'))}</h3>
            <p>${t('collection.artistNotFoundDesc', { name: escapeHtml(artistName) })}</p>
          </div>
        </div>
      `;
      document.getElementById('btnBackToArtists')?.addEventListener('click', () => router.navigate('artists'));
      return;
    }

    // 1. Compute Stats, Top Tracks, Discography & Audiophile Specs
    const statsMap = store.get('stats') || new Map();
    let totalSec = 0;
    let totalPlays = 0;
    let hiresCount = 0;
    const formatCounts = {};
    let maxBitrate = 0;
    let bestSpecText = '16-bit / 44.1 kHz';

    const rankedTracks = [...artistTracks].map(t => {
      const plays = statsMap.get(t.id)?.playCount || 0;
      totalPlays += plays;
      totalSec += (t.streamInfo?.duration || 0);

      const fmt = (t.format || 'unknown').toUpperCase();
      formatCounts[fmt] = (formatCounts[fmt] || 0) + 1;

      const tier = classifyQualityTier(t.streamInfo, t.format);
      if (tier.tier === 'HI-RES' || tier.tier === 'DSD') hiresCount++;

      // Evaluate best audio specification in collection
      const sampleRate = t.streamInfo?.sampleRate || 44100;
      const bitDepth = t.streamInfo?.bitDepth || 16;
      const metric = sampleRate * (bitDepth / 16);
      if (metric > maxBitrate) {
        maxBitrate = metric;
        if (t.format === 'dsf' || t.format === 'dff') {
          bestSpecText = 'DSD64 (1-bit / 2.82 MHz)';
        } else {
          bestSpecText = `${bitDepth}-bit / ${(sampleRate / 1000).toFixed(1)} kHz ${fmt}`;
        }
      }

      return {
        track: t,
        plays,
        tier
      };
    });

    // Top 5 Most Played Tracks
    const topTracks = [...rankedTracks]
      .sort((a, b) => b.plays - a.plays || (b.track.metadata?.year || 0) - (a.track.metadata?.year || 0))
      .slice(0, 5);

    // Group Discography
    const albumsMap = new Map();
    for (const item of rankedTracks) {
      const t = item.track;
      const albName = t.overrides?.album || t.metadata?.album || 'Tanpa Album';
      if (!albumsMap.has(albName)) {
        albumsMap.set(albName, {
          name: albName,
          pictureUrl: t.metadata?.pictureUrl,
          year: t.metadata?.year || '',
          tracks: []
        });
      }
      const rec = albumsMap.get(albName);
      rec.tracks.push(t);
      if (!rec.pictureUrl && t.metadata?.pictureUrl) rec.pictureUrl = t.metadata.pictureUrl;
    }

    const allAlbums = Array.from(albumsMap.values());
    const studioAlbums = allAlbums.filter(a => a.tracks.length > 3);
    const singlesAndEps = allAlbums.filter(a => a.tracks.length <= 3);

    // Local Cover fallback
    const localCover = artistTracks.find(t => t.metadata?.pictureUrl)?.metadata?.pictureUrl || null;

    // Dominant format text
    const dominantFormat = Object.entries(formatCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'FLAC';
    const dominantPct = Math.round((formatCounts[dominantFormat] / artistTracks.length) * 100);

    // 2. Load or Fetch Online Metadata (Wikipedia / MusicBrainz)
    const cachedMeta = artistMetaService.getFromMemory(artistName);

    this._renderDOM({
      artistName,
      artistTracks,
      topTracks,
      studioAlbums,
      singlesAndEps,
      allAlbums,
      localCover,
      totalPlays,
      totalSec,
      hiresCount,
      bestSpecText,
      dominantFormat,
      dominantPct,
      meta: cachedMeta
    });

    // If metadata was not in memory, fetch asynchronously and update UI smoothly
    if (!cachedMeta) {
      artistMetaService.getArtistMeta(artistName).then(meta => {
        if (this.currentArtistName === artistName && meta) {
          this._updateOnlineMetaDOM(meta);
        }
      }).catch(err => {
        console.warn('Async artist meta fetch failed:', err);
      });
    }
  }

  _renderDOM(data) {
    const {
      artistName,
      artistTracks,
      topTracks,
      studioAlbums,
      singlesAndEps,
      allAlbums,
      localCover,
      totalPlays,
      totalSec,
      hiresCount,
      bestSpecText,
      dominantFormat,
      dominantPct,
      meta
    } = data;

    const avatarImage = meta?.avatarUrl || localCover;
    const bioText = meta?.bio || '';
    const descriptionText = meta?.description || '';
    const genres = meta?.genres || [];
    const country = meta?.country || '';

    // Action buttons per Masalah 5 (Pure Icon buttons, >= 44px, aria-label, title tooltips)
    const actions = [
      {
        id: 'btnPlayArtist',
        title: t('artistDetail.playAll'),
        isPrimary: true,
        iconSvg: getIconSvg('play_arrow', { size: 22 }),
        onClick: () => {
          queueManager.setQueue(artistTracks, 0);
          toast.success(t('toasts.playingArtist', { name: artistName }));
        }
      },
      {
        id: 'btnShuffleArtist',
        title: t('artistDetail.shuffleAll'),
        iconSvg: getIconSvg('shuffle', { size: 18 }),
        onClick: () => {
          const shuffled = [...artistTracks].sort(() => Math.random() - 0.5);
          queueManager.setQueue(shuffled, 0);
          toast.success(t('toasts.shufflingArtist', { name: artistName }));
        }
      },
      {
        id: 'btnQueueArtist',
        title: t('artistDetail.addAllToQueue'),
        iconSvg: getIconSvg('playlist_add', { size: 18 }),
        onClick: () => {
          queueManager.addToQueue(artistTracks);
          toast.success(t('toasts.addedCountToQueue', { count: artistTracks.length }), {
            action: {
              label: t('toasts.openQueue'),
              onClick: () => events.emit('drawer:open', 'queue')
            }
          });
        }
      }
    ];

    let extraBadgesHtml = '';
    if (country) {
      extraBadgesHtml += `<span class="artist-genre-pill">${escapeHtml(country)}</span>`;
    }
    if (meta?.type) {
      extraBadgesHtml += `<span class="artist-genre-pill">${escapeHtml(meta.type)}</span>`;
    }

    // Extra sections: Bio card, Audiophile specs, Top 5 popular tracks, Discography, Instant search
    const extraSectionsHtml = `
      <div style="display:flex; flex-direction:column; gap:20px; margin-top:4px;">
        <!-- Biography Card (Expandable or Offline Placeholder) -->
        <div class="artist-bio-card" id="artistBioCard" style="${bioText || (!isServiceAllowed('wikipedia') || isTotalOffline()) ? '' : 'display:none;'}">
          ${bioText ? `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
              <h3 style="font-size:1.05rem; font-weight:600; color:var(--text-main); margin:0;">${escapeHtml(t('artistDetail.about', { name: artistName }))}</h3>
              ${meta?.wikiUrl ? `
                <a href="${meta.wikiUrl}" target="_blank" rel="noopener noreferrer" style="font-size:0.75rem; color:var(--accent); text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
                  <span>${escapeHtml(t('artistDetail.openWikipedia'))}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              ` : ''}
            </div>
            <div class="artist-bio-text ${this.isBioExpanded ? '' : 'clamped'}" id="artistBioText">
              ${escapeHtml(bioText)}
            </div>
            <button class="btn btn-secondary btn-sm" id="btnToggleBio" style="margin-top:10px; font-size:0.75rem;">
              ${this.isBioExpanded ? escapeHtml(t('artistDetail.showLess')) : escapeHtml(t('artistDetail.readMore'))}
            </button>
          ` : `
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
              <div>
                <h4 style="margin:0 0 4px 0; font-size:0.95rem; font-weight:600; color:var(--text-main);">${escapeHtml(t('artistDetail.bioInfoTitle'))}</h4>
                <p style="margin:0; font-size:0.8rem; color:var(--text-dim);">${escapeHtml(t('artistDetail.bioDisabledDesc'))}</p>
              </div>
              <button class="btn btn-secondary btn-sm" id="btnEnableServicesBio">
                <span>${escapeHtml(t('artistDetail.enableService'))}</span>
              </button>
            </div>
          `}
        </div>

        <!-- Audiophile Specifications Grid -->
        <div>
          <h3 style="font-size:1.05rem; font-weight:600; margin-bottom:12px; color:var(--text-main);">${escapeHtml(t('artistDetail.insightsTitle'))}</h3>
          <div class="audiophile-spec-grid">
            <div class="audiophile-spec-card">
              <span class="audiophile-spec-lbl">${escapeHtml(t('artistDetail.highestQuality'))}</span>
              <span class="audiophile-spec-val" style="color:var(--accent);">${escapeHtml(bestSpecText)}</span>
            </div>
            <div class="audiophile-spec-card">
              <span class="audiophile-spec-lbl">${escapeHtml(t('artistDetail.dominantFormat'))}</span>
              <span class="audiophile-spec-val">${dominantFormat} (${dominantPct}%)</span>
            </div>
            <div class="audiophile-spec-card">
              <span class="audiophile-spec-lbl">${escapeHtml(t('artistDetail.hiresCollection'))}</span>
              <span class="audiophile-spec-val">${hiresCount} / ${artistTracks.length} ${escapeHtml(t('common.songs'))}</span>
            </div>
            <div class="audiophile-spec-card">
              <span class="audiophile-spec-lbl">${escapeHtml(t('artistDetail.totalPlayTime'))}</span>
              <span class="audiophile-spec-val">${formatDuration(totalSec)} (${t('artistDetail.playsCount', { count: totalPlays })})</span>
            </div>
          </div>
        </div>

        <!-- Top 5 Most Played Tracks -->
        ${topTracks.length > 0 ? `
          <div class="glass-panel" style="padding:20px; border-radius:var(--radius-lg); background:var(--glass-bg-card); border:1px solid var(--glass-border-specular); backdrop-filter:var(--glass-filter); -webkit-backdrop-filter:var(--glass-filter);">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
              <h3 style="font-size:1.1rem; font-weight:600; color:var(--text-main); margin:0;">${escapeHtml(t('artistDetail.topTracksTitle'))}</h3>
              <span style="font-size:0.75rem; color:var(--text-dim); font-family:var(--font-mono);">${escapeHtml(t('artistDetail.basedOnPlays'))}</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${topTracks.map((item, idx) => `
                <div class="artist-top-track-row" data-track-id="${item.track.id}" data-idx="${idx}" role="button" tabindex="0" style="cursor:pointer;">
                  <span class="artist-top-track-rank">${idx + 1}</span>
                  <div style="width:40px; height:40px; border-radius:var(--radius-sm); overflow:hidden; background:var(--glass-bg-card); flex-shrink:0;">
                    ${item.track.metadata?.pictureUrl ? `
                      <img src="${item.track.metadata.pictureUrl}" style="width:100%; height:100%; object-fit:cover;" alt="Cover" />
                    ` : `
                      <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-dim);">
                        ${getIconSvg('library_music', { size: 20 })}
                      </div>
                    `}
                  </div>
                  <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; color:var(--text-main); font-size:0.9rem;" class="truncate">${escapeHtml(item.track.overrides?.title || item.track.metadata?.title || 'Unknown Title')}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);" class="truncate">${escapeHtml(item.track.overrides?.album || item.track.metadata?.album || t('player.unknownAlbum'))}</div>
                  </div>
                  <span class="badge badge-${item.tier.tier.toLowerCase()}" style="font-size:0.65rem;">${item.tier.tier}</span>
                  <span style="font-size:0.75rem; font-family:var(--font-mono); color:var(--text-dim); min-width:60px; text-align:right;">${t('artistDetail.playsCount', { count: item.plays })}</span>
                  <span style="font-size:0.8rem; font-family:var(--font-mono); color:var(--text-muted); min-width:44px; text-align:right;">${formatDuration(item.track.streamInfo?.duration || 0)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Discography Section -->
        <div>
          <h3 style="font-size:1.15rem; font-weight:700; color:var(--text-main); margin-bottom:12px;">${escapeHtml(t('artistDetail.discography', { count: allAlbums.length }))}</h3>

          ${studioAlbums.length > 0 ? `
            <div class="discography-group-title">
              <span>${escapeHtml(t('artistDetail.studioAlbums', { count: studioAlbums.length }))}</span>
            </div>
            <div class="grid-container" style="margin-bottom:16px;">
              ${studioAlbums.map(alb => this._renderAlbumCard(alb)).join('')}
            </div>
          ` : ''}

          ${singlesAndEps.length > 0 ? `
            <div class="discography-group-title">
              <span>${escapeHtml(t('artistDetail.singlesAndEps', { count: singlesAndEps.length }))}</span>
            </div>
            <div class="grid-container">
              ${singlesAndEps.map(alb => this._renderAlbumCard(alb)).join('')}
            </div>
          ` : ''}
        </div>

        <!-- All Tracks Search Input Bar -->
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
          <h3 style="font-size:1.1rem; font-weight:600; color:var(--text-main); margin:0;">
            ${escapeHtml(t('artistDetail.allTracks', { count: artistTracks.length }))}
          </h3>
          <input type="text" class="artist-quick-search" id="inputArtistTrackSearch" placeholder="${escapeHtml(t('artistDetail.searchPlaceholder'))}" value="${escapeHtml(this.filterQuery)}" style="background:var(--glass-bg-card); border:1px solid var(--glass-border-specular); color:var(--text-main); padding:6px 12px; border-radius:var(--radius-sm); font-size:0.85rem;" />
        </div>
      </div>
    `;

    const currentTrack = store.get('currentTrack');

    CollectionPage.render(this.container, {
      type: 'artist',
      title: artistName,
      subtitle: descriptionText,
      coverUrl: avatarImage,
      bannerUrl: meta?.bannerUrl || null,
      isAvatarRound: true,
      colorSourceUrl: avatarImage || localCover,
      badgeLabel: t('artistDetail.verifiedBadge'),
      badgeClass: 'badge-verified',
      extraBadgesHtml,
      metaLine: `${artistTracks.length} ${t('common.songs')} • ${formatDuration(totalSec)} • Format: ${dominantFormat} (${dominantPct}%)`,
      actions,
      extraSectionsHtml,
      tracks: artistTracks,
      meta,
      onRefresh: (freshMeta) => {
        if (freshMeta) {
          this._updateOnlineMetaDOM(freshMeta);
        }
        this.render();
      },
      currentTrackId: currentTrack?.id,
      backLabel: t('artistDetail.backLabel'),
      onBack: () => router.navigate('artists'),
      onTrackClick: (track, idx) => {
        queueManager.setQueue(artistTracks, idx);
      }
    });

    this._bindExtraEvents(data);
  }

  _renderAlbumCard(alb) {
    return `
      <div class="card artist-album-card" data-album="${escapeHtml(alb.name)}" style="cursor:pointer;" title="${escapeHtml(alb.name)}">
        <div class="card-thumb" style="display:flex; align-items:center; justify-content:center; color:var(--text-dim);">
          ${alb.pictureUrl
            ? `<img src="${alb.pictureUrl}" alt="${escapeHtml(t('common.albums'))}" loading="lazy" />`
            : getIconSvg('library_music', { size: 36 })
          }
        </div>
        <div class="card-body">
          <div class="card-title line-clamp-2" title="${escapeHtml(alb.name)}">${escapeHtml(alb.name)}</div>
          <div class="card-subtitle truncate">${alb.year ? alb.year + ' • ' : ''}${t('collection.trackCount', { count: alb.tracks.length })}</div>
        </div>
      </div>
    `;
  }

  _bindExtraEvents(data) {
    const { artistTracks, topTracks } = data;

    // Bio Toggle
    document.getElementById('btnToggleBio')?.addEventListener('click', () => {
      this.isBioExpanded = !this.isBioExpanded;
      const bioEl = document.getElementById('artistBioText');
      const btn = document.getElementById('btnToggleBio');
      if (bioEl && btn) {
        if (this.isBioExpanded) {
          bioEl.classList.remove('clamped');
          btn.textContent = t('artistDetail.showLess');
        } else {
          bioEl.classList.add('clamped');
          btn.textContent = t('artistDetail.readMore');
        }
      }
    });

    // Enable Services Button Handler
    document.getElementById('btnEnableServicesBio')?.addEventListener('click', () => {
      router.navigate('settings');
    });

    // Top Tracks Rows Play
    this.container.querySelectorAll('.artist-top-track-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.getAttribute('data-idx'), 10) || 0;
        const tracksToPlay = topTracks.map(item => item.track);
        queueManager.setQueue(tracksToPlay, idx);
      });
    });

    // Album Cards Navigation
    this.container.querySelectorAll('.artist-album-card').forEach(card => {
      card.addEventListener('click', () => {
        const albName = card.getAttribute('data-album');
        if (albName) {
          router.navigate('albumDetail', { album: albName });
        }
      });
    });

    // Instant Search Input
    const searchInput = document.getElementById('inputArtistTrackSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterQuery = e.target.value.toLowerCase().trim();
        this._renderFilteredTrackRows(artistTracks);
      });
    }
  }

  _renderFilteredTrackRows(artistTracks) {
    const container = this.container ? this.container.querySelector('.collection-tracklist-container') : null;
    if (!container) return;
    container.innerHTML = '';

    const query = this.filterQuery;
    const filtered = query
      ? artistTracks.filter(t => {
          const title = (t.overrides?.title || t.metadata?.title || '').toLowerCase();
          const album = (t.overrides?.album || t.metadata?.album || '').toLowerCase();
          return title.includes(query) || album.includes(query);
        })
      : artistTracks;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="padding:24px 0; text-align:center; color:var(--text-dim); font-size:0.85rem;">
          Tidak ada lagu yang cocok dengan "${escapeHtml(this.filterQuery)}"
        </div>
      `;
      return;
    }

    const currentTrack = store.get('currentTrack');
    filtered.forEach((track, idx) => {
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

  _updateOnlineMetaDOM(meta) {
    if (!meta) return;

    // Update subtitle description
    const subtitle = document.getElementById('lblCollectionSubtitle');
    if (subtitle && meta.description) {
      subtitle.textContent = meta.description;
    }

    // Update bio card
    const bioCard = document.getElementById('artistBioCard');
    const bioText = document.getElementById('artistBioText');
    if (bioCard && bioText && meta.bio) {
      bioText.textContent = meta.bio;
      bioCard.style.display = 'block';
    }
  }
}

export const artistDetailView = new ArtistDetailView();
