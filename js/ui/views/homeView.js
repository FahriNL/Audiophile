/**
 * homeView.js - Audiophile musical home page.
 * Features:
 * - Dynamic Time-of-Day Greeting and Library Status
 * - Daily Picks (4-6 songs with deterministic date-based daily rotation)
 * - Instant Mood & Activity Mixes (Chill, Focus, Energy, Night, Hi-Res)
 * - Daily Auto-Generated Playlists (Daily Discovery, Heavy Rotation, Hi-Res Mix, Today's Favorites)
 * - Starred Favorites Quick Access
 * - Recently Added Albums & Tracks
 */

import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { queueManager } from '../../player/queue.js';
import { artistMetaService } from '../../library/artistMeta.js';
import { formatDuration, escapeHtml, renderArtistLinks } from '../../core/utils.js';
import { classifyQualityTier } from '../../quality/tiers.js';
import { toast } from '../components/toast.js';
import { contextMenu } from '../components/contextMenu.js';
import { folderManager } from '../../library/folders.js';
import { t } from '../../core/i18n.js';
import { events } from '../../core/events.js';

class HomeView {
  constructor() {
    this.container = null;
  }

  init() {
    this.container = document.getElementById('viewHome');
    store.subscribe('tracks', (tracks) => {
      this.primeArtistGenres(tracks);
      this.render();
    });
    store.subscribe('stats', () => this.render());
    events.on('i18n:changed', () => this.render());
  }

  activate() {
    this.primeArtistGenres(store.get('tracks') || []);
    this.render();
  }

  primeArtistGenres(tracks) {
    if (!tracks || tracks.length === 0) return;
    const artists = [...new Set(tracks.map(t => t.overrides?.artist || t.metadata?.artist).filter(Boolean))].slice(0, 25);
    for (const artist of artists) {
      if (!artistMetaService.getFromMemory(artist)) {
        artistMetaService.getArtistMeta(artist).catch(() => {});
      }
    }
  }

  /**
   * Deterministic daily integer seed based on YYYY-MM-DD
   * Ensures the same recommendations appear all day and rotate cleanly at midnight
   */
  getDateSeed() {
    const today = new Date();
    const str = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  /**
   * Linear Congruential Generator for deterministic daily random values
   */
  getPseudoRandom(seed) {
    return function() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 4 && hour < 11) return t('home.greetings.morning');
    if (hour >= 11 && hour < 15) return t('home.greetings.afternoon');
    if (hour >= 15 && hour < 19) return t('home.greetings.evening');
    return t('home.greetings.night');
  }

  getDailyPicks(tracks) {
    if (!tracks || tracks.length === 0) return [];
    if (tracks.length <= 6) return [...tracks];

    const seed = this.getDateSeed();
    const rng = this.getPseudoRandom(seed);
    const shuffled = [...tracks].sort(() => rng() - 0.5);
    return shuffled.slice(0, 6);
  }

  getTrackGenres(track) {
    const artist = track.overrides?.artist || track.metadata?.artist || '';
    const meta = artistMetaService.getFromMemory(artist);
    const metaGenres = meta?.genres && Array.isArray(meta.genres) ? meta.genres.join(' ') : '';
    const localGenre = track.metadata?.genre || track.overrides?.genre || '';
    return `${localGenre} ${metaGenres}`.toLowerCase();
  }

  getMoodTracks(tracks, moodKey) {
    if (!tracks || tracks.length === 0) return [];

    switch (moodKey) {
      case 'chill':
        return tracks.filter(t => {
          const g = this.getTrackGenres(t);
          return g.includes('chill') || g.includes('jazz') || g.includes('acoustic') || g.includes('ambient') || g.includes('folk') || g.includes('lo-fi') || g.includes('indie') || g.includes('easy listening');
        });
      case 'focus':
        return tracks.filter(t => {
          const g = this.getTrackGenres(t);
          const title = (t.metadata?.title || t.name || '').toLowerCase();
          return g.includes('classical') || g.includes('instrumental') || g.includes('soundtrack') || g.includes('piano') || g.includes('ambient') || g.includes('orchestral') || title.includes('instrumental');
        });
      case 'energy':
        return tracks.filter(t => {
          const g = this.getTrackGenres(t);
          return g.includes('rock') || g.includes('metal') || g.includes('electronic') || g.includes('dance') || g.includes('pop') || g.includes('hip hop') || g.includes('upbeat') || g.includes('techno') || g.includes('house');
        });
      case 'night':
        return tracks.filter(t => {
          const g = this.getTrackGenres(t);
          return g.includes('blues') || g.includes('soul') || g.includes('ballad') || g.includes('slow') || g.includes('r&b') || g.includes('neo soul') || g.includes('dark');
        });
      case 'hires':
        return tracks.filter(t => {
          const tier = classifyQualityTier(t.streamInfo, t.format);
          return tier.tier === 'HI-RES' || tier.tier === 'DSD' || tier.tier === 'STUDIO';
        });
      default:
        return tracks;
    }
  }

  getMoodMixes(tracks) {
    const list = [
      {
        id: 'chill',
        title: t('home.moods.chillTitle'),
        desc: t('home.moods.chillDesc'),
        tags: ['Akustik', 'Folk', 'Jazz', 'Lo-Fi'],
        gradient: 'linear-gradient(135deg, rgba(20, 184, 166, 0.42) 0%, rgba(13, 148, 136, 0.22) 50%, rgba(15, 23, 42, 0.75) 100%)',
        accentColor: '#14b8a6',
        iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
      },
      {
        id: 'focus',
        title: t('home.moods.focusTitle'),
        desc: t('home.moods.focusDesc'),
        tags: ['Instrumental', 'Klasik', 'Piano', 'Ambient'],
        gradient: 'linear-gradient(135deg, rgba(99, 102, 241, 0.42) 0%, rgba(79, 70, 229, 0.22) 50%, rgba(15, 23, 42, 0.75) 100%)',
        accentColor: '#6366f1',
        iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`
      },
      {
        id: 'energy',
        title: t('home.moods.energyTitle'),
        desc: t('home.moods.energyDesc'),
        tags: ['Rock', 'Elektronik', 'Dance', 'Upbeat'],
        gradient: 'linear-gradient(135deg, rgba(244, 63, 94, 0.42) 0%, rgba(225, 29, 72, 0.22) 50%, rgba(15, 23, 42, 0.75) 100%)',
        accentColor: '#f43f5e',
        iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`
      },
      {
        id: 'night',
        title: t('home.moods.nightTitle'),
        desc: t('home.moods.nightDesc'),
        tags: ['Soul', 'Blues', 'Slow', 'R&B'],
        gradient: 'linear-gradient(135deg, rgba(168, 85, 247, 0.42) 0%, rgba(147, 51, 234, 0.22) 50%, rgba(15, 23, 42, 0.75) 100%)',
        accentColor: '#a855f7',
        iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
      },
      {
        id: 'hires',
        title: t('home.moods.fidelityTitle'),
        desc: t('home.moods.fidelityDesc'),
        tags: ['24-bit FLAC', 'DSD', 'Studio Master'],
        gradient: 'linear-gradient(135deg, rgba(251, 191, 36, 0.35) 0%, rgba(245, 158, 11, 0.2) 50%, rgba(15, 23, 42, 0.75) 100%)',
        accentColor: '#fbbf24',
        iconSvg: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
      }
    ];

    return list.map(item => {
      let matched = this.getMoodTracks(tracks, item.id);
      if (matched.length === 0 && tracks.length > 0) {
        matched = [...tracks].slice(0, 10);
      }
      return {
        ...item,
        tracks: matched,
        count: matched.length
      };
    });
  }

  getDailyAutoPlaylists(tracks, statsMap) {
    if (!tracks || tracks.length === 0) return [];

    // 1. Daily Discovery (Unplayed or lowest played)
    const unplayed = tracks.filter(t => (statsMap.get(t.id)?.playCount || 0) === 0);
    const discoveryTracks = (unplayed.length >= 5 ? unplayed : tracks).slice(0, 15);

    // 2. Heavy Rotation (Highest played)
    const sortedByPlays = [...tracks]
      .filter(t => (statsMap.get(t.id)?.playCount || 0) > 0)
      .sort((a, b) => (statsMap.get(b.id)?.playCount || 0) - (statsMap.get(a.id)?.playCount || 0));
    const rotationTracks = (sortedByPlays.length >= 5 ? sortedByPlays : tracks).slice(0, 15);

    // 3. Hi-Res Master Mix
    const hiresTracks = tracks.filter(t => {
      const tier = classifyQualityTier(t.streamInfo, t.format);
      return tier.tier === 'HI-RES' || tier.tier === 'DSD' || tier.tier === 'STUDIO';
    }).slice(0, 15);

    // 4. Favorit Hari Ini
    const favTracks = tracks.filter(t => t.favorite).slice(0, 15);

    return [
      {
        id: 'mix_discovery',
        title: 'Daily Discovery',
        desc: t('home.autoDiscoveryDesc'),
        count: discoveryTracks.length,
        tracks: discoveryTracks,
        gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.4), rgba(16, 185, 129, 0.4))'
      },
      {
        id: 'mix_heavy_rotation',
        title: 'Heavy Rotation',
        desc: t('home.autoRotationDesc'),
        count: rotationTracks.length,
        tracks: rotationTracks,
        gradient: 'linear-gradient(135deg, rgba(236, 72, 153, 0.4), rgba(245, 158, 11, 0.4))'
      },
      {
        id: 'mix_hires',
        title: 'Hi-Res Master Mix',
        desc: t('home.autoHiresDesc'),
        count: hiresTracks.length,
        tracks: hiresTracks.length > 0 ? hiresTracks : tracks.slice(0, 15),
        gradient: 'linear-gradient(135deg, rgba(245, 158, 11, 0.45), rgba(139, 92, 246, 0.4))'
      },
      {
        id: 'mix_favorites',
        title: t('playlists.smartFavorites'),
        desc: t('home.autoFavoritesDesc'),
        count: favTracks.length > 0 ? favTracks.length : Math.min(10, tracks.length),
        tracks: favTracks.length > 0 ? favTracks : tracks.slice(0, 10),
        gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.4), rgba(59, 130, 246, 0.45))'
      }
    ];
  }

  render() {
    if (!this.container) return;

    const tracks = store.get('tracks') || [];
    const statsMap = store.get('stats') || new Map();

    if (tracks.length === 0) {
      this.container.innerHTML = `
        <div style="padding:48px 16px; text-align:center;">
          <div class="empty-state" style="max-width:540px; margin:0 auto;">
            <div class="empty-state-icon" style="margin-bottom:16px;">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polygon points="12 11 12 17 17 14"/></svg>
            </div>
            <h2 style="font-size:1.6rem; font-weight:700; margin-bottom:8px; color:var(--text-main);">${escapeHtml(t('home.welcomeTitle'))}</h2>
            <p style="color:var(--text-muted); font-size:0.9rem; line-height:1.6; margin-bottom:20px;">
              ${escapeHtml(t('home.welcomeDesc'))}
            </p>
            <button class="btn btn-primary" id="btnHomeImportFolder" style="padding:10px 24px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
              <span>${escapeHtml(t('home.importMusicFolder'))}</span>
            </button>
          </div>
        </div>
      `;

      document.getElementById('btnHomeImportFolder')?.addEventListener('click', () => {
        folderManager.triggerFolderImport();
      });
      return;
    }

    const greeting = this.getGreeting();
    const dailyPicks = this.getDailyPicks(tracks);
    const autoPlaylists = this.getDailyAutoPlaylists(tracks, statsMap);
    const moodMixes = this.getMoodMixes(tracks);

    // Count statistics
    const albumsSet = new Set(tracks.map(t => t.overrides?.album || t.metadata?.album || 'Unknown'));
    const hiresCount = tracks.filter(t => {
      const tier = classifyQualityTier(t.streamInfo, t.format);
      return tier.tier === 'HI-RES' || tier.tier === 'DSD' || tier.tier === 'STUDIO';
    }).length;

    // Favorite tracks
    const favorites = tracks.filter(t => t.favorite);

    // Recently added (sorted by addedAt desc)
    const recentlyAdded = [...tracks].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 8);

    // Determine last played track or fallback
    const currentTrack = store.get('currentTrack');
    let lastTrack = currentTrack;
    if (!lastTrack) {
      let maxPlayedAt = 0;
      for (const [trackId, stat] of statsMap.entries()) {
        if (stat.lastPlayedAt && stat.lastPlayedAt > maxPlayedAt) {
          maxPlayedAt = stat.lastPlayedAt;
          const found = tracks.find(t => t.id === trackId);
          if (found) lastTrack = found;
        }
      }
    }
    if (!lastTrack && tracks.length > 0) {
      lastTrack = tracks[0];
    }

    this.container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:28px;">
        <!-- 1. Hero Greeting Banner -->
        <div class="home-greeting-banner">
          <div style="display:flex; flex-direction:column; gap:6px; flex:1; min-width:240px;">
            <h1 style="font-size:2rem; font-weight:800; color:var(--text-main); margin:0; letter-spacing:-0.02em;">
              ${greeting}
            </h1>
            <p style="font-size:0.85rem; color:var(--text-muted); margin:0;">
              ${t('home.librarySummary', {
                tracks: `<strong style="color:var(--text-main);">${tracks.length}</strong>`,
                albums: `<strong style="color:var(--text-main);">${albumsSet.size}</strong>`,
                hires: hiresCount
              })}
            </p>
            <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
              <button class="btn btn-secondary btn-sm" id="btnHomeQuickShuffle">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                <span>${escapeHtml(t('home.quickShuffle'))}</span>
              </button>
              <button class="btn btn-ghost btn-sm" id="btnHomeGoToCollection">
                <span>${escapeHtml(t('home.exploreCollection'))}</span>
              </button>
            </div>
          </div>
          ${lastTrack ? `
            <div class="home-hero-resume-box" style="display:flex; align-items:center; gap:14px; background:rgba(255, 255, 255, 0.04); border:1px solid var(--border-medium); border-radius:var(--radius-md); padding:10px 14px; min-width:260px; max-width:360px;">
              <div style="width:52px; height:52px; border-radius:var(--radius-sm); overflow:hidden; background:var(--bg-surface-elevated); flex-shrink:0; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(0,0,0,0.35);">
                ${lastTrack.metadata?.pictureUrl ? `
                  <img src="${lastTrack.metadata.pictureUrl}" alt="Cover" style="width:100%; height:100%; object-fit:cover;" />
                ` : `
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
                `}
              </div>
              <div style="flex:1; min-width:0;">
                <div style="font-size:0.68rem; color:var(--text-dim); text-transform:uppercase; font-weight:700; letter-spacing:0.05em; font-family:var(--font-mono);">${escapeHtml(t('home.lastPlayed'))}</div>
                <div class="truncate" style="font-size:0.86rem; font-weight:700; color:var(--text-main); margin-top:1px;">${escapeHtml(lastTrack.overrides?.title || lastTrack.metadata?.title || lastTrack.name)}</div>
                <div class="truncate" style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(lastTrack.overrides?.artist || lastTrack.metadata?.artist || 'Unknown')}</div>
              </div>
              <button class="btn btn-primary btn-sm" id="btnHomeResumeTrack" data-track-id="${escapeHtml(lastTrack.id)}" title="${escapeHtml(t('home.resume'))}" style="padding:8px 14px; border-radius:var(--radius-sm); font-weight:700;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>${escapeHtml(t('home.resume'))}</span>
              </button>
            </div>
          ` : ''}
        </div>

        <!-- 2. Mood & Activity Filter Mixes -->
        <div>
          <div class="home-section-header">
            <div>
              <h3 class="home-section-title">${escapeHtml(t('home.moodsTitle'))}</h3>
              <span style="font-size:0.75rem; color:var(--text-dim);">${escapeHtml(t('home.moodsDesc'))}</span>
            </div>
          </div>
          <div class="home-mood-grid">
            ${moodMixes.map(mix => `
              <div class="home-mood-card" data-mood="${mix.id}" style="background:${mix.gradient};">
                <div class="home-mood-card-header">
                  <div style="min-width:0; flex:1;">
                    <h4 class="home-mood-title">${escapeHtml(mix.title)}</h4>
                    <p class="home-mood-desc">${escapeHtml(mix.desc)}</p>
                  </div>
                  <div class="home-mood-icon-box" style="color:${mix.accentColor};">
                    ${mix.iconSvg}
                  </div>
                </div>

                <div class="home-mood-tags">
                  ${mix.tags.map(tag => `<span class="home-mood-tag-pill">${escapeHtml(tag)}</span>`).join('')}
                </div>

                <div class="home-mood-footer">
                  <span class="home-mood-count">${escapeHtml(t('home.moods.tracksAvailable', { count: mix.count }))}</span>
                  <div class="home-mood-actions">
                    <button class="btn btn-icon btn-mood-action btn-mood-queue" data-mood="${mix.id}" title="${escapeHtml(t('collection.selectionBar.addToQueue'))}" aria-label="${escapeHtml(t('collection.selectionBar.addToQueue'))}">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </button>
                    <button class="btn btn-icon btn-mood-action btn-mood-play" data-mood="${mix.id}" title="${escapeHtml(t('actions.play'))}" aria-label="${escapeHtml(t('actions.play'))}">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="6 4 20 12 6 20 6 4"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 3. Rekomendasi Lagu Hari Ini (Daily Picks) -->
        <div>
          <div class="home-section-header">
            <div>
              <h3 class="home-section-title">${escapeHtml(t('home.recommendationsTitle'))}</h3>
              <span style="font-size:0.75rem; color:var(--text-dim); font-family:var(--font-mono);">${escapeHtml(t('home.recommendationsDesc'))}</span>
            </div>
            <button class="btn btn-secondary btn-sm" id="btnPlayAllDailyPicks">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>${escapeHtml(t('home.playRecommendations'))}</span>
            </button>
          </div>
          <div class="daily-picks-grid">
            ${dailyPicks.map((track, idx) => {
              const tier = classifyQualityTier(track.streamInfo, track.format);
              const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown Artist';
              return `
                <div class="daily-pick-card" data-idx="${idx}">
                  <div class="daily-pick-thumb">
                    ${track.metadata?.pictureUrl ? `
                      <img src="${track.metadata.pictureUrl}" alt="Cover" loading="lazy" />
                    ` : `
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
                    `}
                    <div class="daily-pick-play-btn">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                  </div>
                  <div style="flex:1; min-width:0;">
                    <div class="daily-pick-title truncate">${escapeHtml(track.overrides?.title || track.metadata?.title || track.name)}</div>
                    <div class="daily-pick-artist truncate">
                      ${renderArtistLinks(artist)}
                    </div>
                  </div>
                  <span class="badge ${tier.badgeClass}" title="${escapeHtml(tier.details || tier.label)}" aria-label="${escapeHtml(tier.label)}" style="font-size:0.65rem;">${escapeHtml(tier.shortTag || tier.label)}</span>
                  <span style="font-size:0.75rem; font-family:var(--font-mono); color:var(--text-dim);">${formatDuration(track.streamInfo?.duration || 0)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- 4. Playlist yang Dibuat Otomatis Hari Ini -->
        <div>
          <div class="home-section-header">
            <div>
              <h3 class="home-section-title">${escapeHtml(t('home.autoPlaylists'))}</h3>
              <span style="font-size:0.75rem; color:var(--text-dim);">${escapeHtml(t('home.moodsDesc'))}</span>
            </div>
          </div>
          <div class="auto-playlist-grid">
            ${autoPlaylists.map(mix => `
              <div class="auto-playlist-card" data-mix-id="${mix.id}" style="background:${mix.gradient};">
                <div class="auto-playlist-content">
                  <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:0.06em; color:rgba(255,255,255,0.8); font-family:var(--font-mono);">
                    Auto Mix • ${mix.count} lagu
                  </div>
                  <div class="auto-playlist-title">${escapeHtml(mix.title)}</div>
                  <div class="auto-playlist-desc">${escapeHtml(mix.desc)}</div>
                  <div class="auto-playlist-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    <span>${escapeHtml(t('home.playPlaylist'))}</span>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 5. Lagu Favorit Anda -->
        ${favorites.length > 0 ? `
          <div>
            <div class="home-section-header">
              <h3 class="home-section-title">${escapeHtml(t('home.favoritesTitle', { count: favorites.length }))}</h3>
              <button class="btn btn-secondary btn-sm" id="btnPlayAllFavorites">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>${escapeHtml(t('home.playAllFavorites'))}</span>
              </button>
            </div>
            <div class="daily-picks-grid">
              ${favorites.slice(0, 4).map((track, idx) => {
                const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown Artist';
                return `
                <div class="daily-pick-card home-fav-card" data-fav-idx="${idx}">
                  <div class="daily-pick-thumb">
                    ${track.metadata?.pictureUrl ? `<img src="${track.metadata.pictureUrl}" alt="Cover" loading="lazy" />` : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg>'}
                    <div class="daily-pick-play-btn">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                  </div>
                  <div style="flex:1; min-width:0;">
                    <div class="daily-pick-title truncate">${escapeHtml(track.overrides?.title || track.metadata?.title || track.name)}</div>
                    <div class="daily-pick-artist truncate">
                      ${renderArtistLinks(artist)}
                    </div>
                  </div>
                  <span style="font-size:0.75rem; font-family:var(--font-mono); color:var(--text-dim);">${formatDuration(track.streamInfo?.duration || 0)}</span>
                </div>
              `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- 6. Baru Ditambahkan (Recently Added) -->
        <div>
          <div class="home-section-header">
            <h3 class="home-section-title">${escapeHtml(t('home.recentlyAdded'))}</h3>
            <span style="font-size:0.75rem; color:var(--text-dim);">${escapeHtml(t('collection.subtabs.all'))}</span>
          </div>
          <div class="daily-picks-grid">
            ${recentlyAdded.slice(0, 4).map((track, idx) => {
              const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown Artist';
              return `
              <div class="daily-pick-card home-recent-card" data-recent-idx="${idx}">
                <div class="daily-pick-thumb">
                  ${track.metadata?.pictureUrl ? `<img src="${track.metadata.pictureUrl}" alt="Cover" loading="lazy" />` : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg>'}
                  <div class="daily-pick-play-btn">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </div>
                </div>
                <div style="flex:1; min-width:0;">
                  <div class="daily-pick-title truncate">${escapeHtml(track.overrides?.title || track.metadata?.title || track.name)}</div>
                  <div class="daily-pick-artist truncate">
                    ${renderArtistLinks(artist)}
                  </div>
                </div>
                <span style="font-size:0.75rem; font-family:var(--font-mono); color:var(--text-dim);">${formatDuration(track.streamInfo?.duration || 0)}</span>
              </div>
            `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    this.bindEvents({
      tracks,
      dailyPicks,
      autoPlaylists,
      favorites,
      recentlyAdded,
      moodMixes,
      lastTrack
    });
  }

  bindEvents(data) {
    const { tracks = [], dailyPicks = [], autoPlaylists = [], favorites = [], recentlyAdded = [], moodMixes = [], lastTrack = null } = data;
    const activeMixes = (moodMixes && moodMixes.length > 0) ? moodMixes : this.getMoodMixes(tracks);

    // Resume Last Played Track
    document.getElementById('btnHomeResumeTrack')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const trackId = e.currentTarget.getAttribute('data-track-id');
      const trk = tracks.find(t => t.id === trackId) || lastTrack;
      if (trk) {
        queueManager.setQueue([trk], 0);
        toast.success(`Melanjutkan: ${trk.overrides?.title || trk.metadata?.title || trk.name}`);
      }
    });

    // Quick Shuffle
    document.getElementById('btnHomeQuickShuffle')?.addEventListener('click', () => {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      queueManager.setQueue(shuffled, 0);
      toast.success('Memutar acak seluruh koleksi perpustakaan.');
    });

    // Go to Collection
    document.getElementById('btnHomeGoToCollection')?.addEventListener('click', () => {
      router.navigate('collection');
    });

    // Mood Card Actions (Card click, Play button, Queue button)
    this.container.querySelectorAll('.home-mood-card').forEach(card => {
      const moodKey = card.getAttribute('data-mood');
      const mix = activeMixes.find(m => m.id === moodKey);
      if (!mix) return;

      const playMix = () => {
        if (mix.tracks.length === 0) {
          toast.info('Tidak ada lagu yang cocok dengan kategori mood ini.');
          return;
        }
        const shuffled = [...mix.tracks].sort(() => Math.random() - 0.5);
        queueManager.setQueue(shuffled, 0);
        toast.success(`Memutar racikan mood: ${mix.title} (${shuffled.length} lagu).`);
      };

      const queueMix = () => {
        if (mix.tracks.length === 0) {
          toast.info('Tidak ada lagu yang cocok dengan kategori mood ini.');
          return;
        }
        const shuffled = [...mix.tracks].sort(() => Math.random() - 0.5);
        queueManager.addToQueue(shuffled);
        toast.success(`${shuffled.length} lagu racikan ${mix.title} ditambahkan ke antrean.`);
      };

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-mood-queue')) {
          e.stopPropagation();
          queueMix();
          return;
        }
        if (e.target.closest('.btn-mood-play')) {
          e.stopPropagation();
          playMix();
          return;
        }
        playMix();
      });
    });

    // Play All Daily Picks
    document.getElementById('btnPlayAllDailyPicks')?.addEventListener('click', () => {
      if (dailyPicks.length > 0) {
        queueManager.setQueue(dailyPicks, 0);
        toast.success('Memutar rekomendasi lagu hari ini.');
      }
    });

    // Daily Pick Card Single Play & Context Menu
    this.container.querySelectorAll('.daily-pick-card[data-idx]').forEach(card => {
      const idx = parseInt(card.getAttribute('data-idx'), 10) || 0;
      const trk = dailyPicks[idx];
      if (trk) {
        contextMenu.bind(card, { track: trk });
      }
      card.addEventListener('click', (e) => {
        if (e.target.closest('.clickable-artist') || e.target.closest('.clickable-album')) return;
        queueManager.setQueue(dailyPicks, idx);
      });
    });

    // Auto Playlist Cards
    this.container.querySelectorAll('.auto-playlist-card').forEach(card => {
      card.addEventListener('click', () => {
        const mixId = card.getAttribute('data-mix-id');
        const mix = autoPlaylists.find(m => m.id === mixId);
        if (mix && mix.tracks.length > 0) {
          queueManager.setQueue(mix.tracks, 0);
          toast.success(`Memutar playlist: ${mix.title}`);
        }
      });
    });

    // Play All Favorites
    document.getElementById('btnPlayAllFavorites')?.addEventListener('click', () => {
      if (favorites.length > 0) {
        queueManager.setQueue(favorites, 0);
        toast.success(`Memutar ${favorites.length} lagu favorit.`);
      }
    });

    // Favorites Single Play & Context Menu
    this.container.querySelectorAll('.home-fav-card').forEach(card => {
      const idx = parseInt(card.getAttribute('data-fav-idx'), 10) || 0;
      const trk = favorites[idx];
      if (trk) {
        contextMenu.bind(card, { track: trk });
      }
      card.addEventListener('click', (e) => {
        if (e.target.closest('.clickable-artist') || e.target.closest('.clickable-album')) return;
        queueManager.setQueue(favorites, idx);
      });
    });

    // Recently Added Single Play & Context Menu
    this.container.querySelectorAll('.home-recent-card').forEach(card => {
      const idx = parseInt(card.getAttribute('data-recent-idx'), 10) || 0;
      const trk = recentlyAdded[idx];
      if (trk) {
        contextMenu.bind(card, { track: trk });
      }
      card.addEventListener('click', (e) => {
        if (e.target.closest('.clickable-artist') || e.target.closest('.clickable-album')) return;
        queueManager.setQueue(recentlyAdded, idx);
      });
    });
  }
}

export const homeView = new HomeView();
