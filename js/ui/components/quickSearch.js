/**
 * quickSearch.js - In-place top toolbar search widget with 4 instant suggestions
 * Features:
 * - Real-time filtering with max 4 relevant suggestion items (Tracks, Artists, Albums)
 * - 1-Click play track or navigate to artist/album detail
 * - Enter key opens dedicated full search view with full matching list
 * - Keyboard navigation (Ctrl+K focus, Escape dismiss, Arrow Up/Down selection)
 */

import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { queueManager } from '../../player/queue.js';
import { escapeHtml, formatDuration, parseArtistNames } from '../../core/utils.js';
import { classifyQualityTier } from '../../quality/tiers.js';
import { t } from '../../core/i18n.js';

class QuickSearchController {
  constructor() {
    this.widget = null;
    this.input = null;
    this.dropdown = null;
    this.listEl = null;
    this.clearBtn = null;
    this.selectedIndex = -1;
    this.currentSuggestions = [];
  }

  init() {
    this.widget = document.getElementById('topSearchWidget');
    this.input = document.getElementById('topQuickSearchInput');
    this.dropdown = document.getElementById('topSearchDropdown');
    this.listEl = document.getElementById('topSearchDropdownList');
    this.clearBtn = document.getElementById('btnTopSearchClear');

    if (!this.input || !this.dropdown) return;

    this.bindEvents();
  }

  bindEvents() {
    // 1. Input typing
    this.input.addEventListener('input', () => {
      const query = this.input.value.trim();
      if (this.clearBtn) {
        this.clearBtn.style.display = query ? 'flex' : 'none';
      }
      this.handleInput(query);
      if (router.getCurrentRoute() === 'search') {
        import('../views/searchView.js').then(({ searchView }) => {
          searchView.setQuery(query);
        });
      }
    });

    // 2. Clear button
    this.clearBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.input.value = '';
      this.clearBtn.style.display = 'none';
      this.hideDropdown();
      if (router.getCurrentRoute() === 'search') {
        import('../views/searchView.js').then(({ searchView }) => {
          searchView.setQuery('');
        });
      }
      this.input.focus();
    });

    // 3. Key navigation: Enter, Escape, ArrowDown, ArrowUp
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = this.input.value.trim();
        if (this.selectedIndex >= 0 && this.currentSuggestions[this.selectedIndex]) {
          this.activateSuggestion(this.currentSuggestions[this.selectedIndex]);
        } else if (query) {
          this.hideDropdown();
          router.navigate('search', { query });
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hideDropdown();
        this.input.blur();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.moveSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.moveSelection(-1);
      }
    });

    // 4. Focus handling
    this.input.addEventListener('focus', () => {
      const query = this.input.value.trim();
      if (query) {
        this.handleInput(query);
      }
    });

    // 5. Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (this.widget && !this.widget.contains(e.target)) {
        this.hideDropdown();
      }
    });

    // 6. Global shortcut Ctrl+K or Cmd+K
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.input.focus();
        this.input.select();
      }
    });
  }

  handleInput(query) {
    if (!query) {
      this.hideDropdown();
      return;
    }

    const suggestions = this.getSuggestions(query, 4);
    this.currentSuggestions = suggestions;
    this.selectedIndex = -1;
    this.renderSuggestions(suggestions, query);
  }

  getSuggestions(query, max = 4) {
    const q = query.toLowerCase();
    const tracks = store.get('tracks') || [];
    const results = [];
    const seenArtists = new Set();
    const seenAlbums = new Set();

    // Priority 1: Exact / prefix artist match (supports multi-artist delimiter ';')
    for (const t of tracks) {
      const rawArtist = t.overrides?.artist || t.metadata?.artist || '';
      const list = parseArtistNames(rawArtist);
      const artists = list.length > 0 ? list : (rawArtist ? [rawArtist] : []);
      for (const artist of artists) {
        if (artist && artist.toLowerCase().includes(q) && !seenArtists.has(artist.toLowerCase())) {
          seenArtists.add(artist.toLowerCase());
          results.push({
            type: 'artist',
            title: artist,
            subtitle: t('common.artists'),
            badge: t('common.artists').toUpperCase(),
            pictureUrl: t.metadata?.pictureUrl || null,
            data: artist
          });
          if (results.length >= max) break;
        }
      }
      if (results.length >= max) break;
    }

    // Priority 2: Matching album
    if (results.length < max) {
      for (const t of tracks) {
        const album = t.overrides?.album || t.metadata?.album || '';
        const artist = t.overrides?.artist || t.metadata?.artist || 'Unknown';
        if (album && album.toLowerCase().includes(q) && !seenAlbums.has(album.toLowerCase())) {
          seenAlbums.add(album.toLowerCase());
          results.push({
            type: 'album',
            title: album,
            subtitle: artist,
            badge: t('common.albums').toUpperCase(),
            pictureUrl: t.metadata?.pictureUrl || null,
            data: { album, artist }
          });
          if (results.length >= max) break;
        }
      }
    }

    // Priority 3: Matching tracks
    if (results.length < max) {
      for (const t of tracks) {
        const title = t.overrides?.title || t.metadata?.title || t.name;
        const artist = t.overrides?.artist || t.metadata?.artist || 'Unknown';
        if (title.toLowerCase().includes(q) || artist.toLowerCase().includes(q)) {
          const tierInfo = classifyQualityTier(t.streamInfo, t.format);
          results.push({
            type: 'track',
            title,
            subtitle: `${artist} • ${formatDuration(t.duration || 0)}`,
            badge: tierInfo.label,
            pictureUrl: t.metadata?.pictureUrl || null,
            data: t
          });
          if (results.length >= max) break;
        }
      }
    }

    return results.slice(0, max);
  }

  renderSuggestions(suggestions, query) {
    if (!this.listEl) return;

    if (suggestions.length === 0) {
      this.listEl.innerHTML = `
        <div class="top-search-empty">
          ${t('topSearch.noSuggestions', { query: escapeHtml(query) })}<br/>
          <span style="font-size:0.75rem; color:var(--text-dim); margin-top:4px; display:inline-block;">${t('topSearch.pressEnterFull')}</span>
        </div>
      `;
      this.showDropdown();
      return;
    }

    this.listEl.innerHTML = suggestions.map((item, idx) => {
      let iconOrThumb = '';
      if (item.pictureUrl) {
        iconOrThumb = `<img src="${item.pictureUrl}" alt="" loading="lazy" />`;
      } else if (item.type === 'artist') {
        iconOrThumb = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a8.38 8.38 0 0 1 13 0"/></svg>`;
      } else if (item.type === 'album') {
        iconOrThumb = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/></svg>`;
      } else {
        iconOrThumb = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      }

      return `
        <div class="top-search-item" data-index="${idx}">
          <div class="top-search-item-thumb ${item.type === 'artist' ? 'round' : ''}">
            ${iconOrThumb}
          </div>
          <div class="top-search-item-info">
            <div class="top-search-item-title">${escapeHtml(item.title)}</div>
            <div class="top-search-item-subtitle">${escapeHtml(item.subtitle)}</div>
          </div>
          <span class="top-search-item-badge">${escapeHtml(item.badge)}</span>
        </div>
      `;
    }).join('');

    this.listEl.querySelectorAll('.top-search-item').forEach(itemEl => {
      itemEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(itemEl.getAttribute('data-index'), 10);
        if (!isNaN(idx) && suggestions[idx]) {
          this.activateSuggestion(suggestions[idx]);
        }
      });
    });

    this.showDropdown();
  }

  moveSelection(direction) {
    if (this.currentSuggestions.length === 0) return;
    this.selectedIndex += direction;
    if (this.selectedIndex >= this.currentSuggestions.length) this.selectedIndex = 0;
    if (this.selectedIndex < 0) this.selectedIndex = this.currentSuggestions.length - 1;

    const items = this.listEl.querySelectorAll('.top-search-item');
    items.forEach((el, idx) => {
      el.classList.toggle('selected', idx === this.selectedIndex);
      if (idx === this.selectedIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }

  activateSuggestion(item) {
    this.hideDropdown();
    this.input.blur();

    if (item.type === 'track') {
      queueManager.setQueue([item.data], 0);
    } else if (item.type === 'artist') {
      router.navigate('artistDetail', { artist: item.data });
    } else if (item.type === 'album') {
      const albumKey = `${item.data.album}_${item.data.artist}`;
      router.navigate('albumDetail', { album: albumKey });
    }
  }

  showDropdown() {
    if (this.dropdown) this.dropdown.style.display = 'block';
  }

  hideDropdown() {
    if (this.dropdown) this.dropdown.style.display = 'none';
    this.selectedIndex = -1;
  }
}

export const quickSearch = new QuickSearchController();
