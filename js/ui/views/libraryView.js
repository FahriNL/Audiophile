/**
 * libraryView.js - Tracks library view with virtual scrolling list, filters, and search
 */

import { store } from '../../core/store.js';
import { queueManager } from '../../player/queue.js';
import { SearchEngine } from '../../library/search.js';
import { TrackRowRenderer } from '../components/trackRow.js';
import { debounce } from '../../core/utils.js';

class LibraryView {
  constructor() {
    this.container = null;
    this.viewport = null;
    this.spacer = null;
    this.content = null;

    this.filteredTracks = [];
    this.itemHeight = 60;
    this.buffer = 8;
  }

  init() {
    this.container = document.getElementById('viewLibrary');
    this.viewport = document.getElementById('trackScrollViewport');
    this.spacer = document.getElementById('trackScrollSpacer');
    this.content = document.getElementById('trackScrollContent');

    this.bindEvents();

    store.subscribe('tracks', () => this.updateList());
    store.subscribe('filters', () => this.updateList());
    store.subscribe('currentTrack', () => this.renderVirtualSlice());
    store.subscribe('selectedTrackIds', () => this.renderVirtualSlice());

    this.viewport?.addEventListener('scroll', () => this.renderVirtualSlice());
    window.addEventListener('resize', () => this.renderVirtualSlice());
  }

  bindEvents() {
    const searchInput = document.getElementById('searchInput');
    const btnClear = document.getElementById('btnClearSearch');

    searchInput?.addEventListener('input', debounce((e) => {
      const q = e.target.value.trim();
      const filters = store.get('filters') || {};
      store.set('filters', { ...filters, search: q });
      if (btnClear) btnClear.style.display = q ? 'block' : 'none';
    }, 200));

    btnClear?.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      const filters = store.get('filters') || {};
      store.set('filters', { ...filters, search: '' });
      btnClear.style.display = 'none';
    });

    // Tier Filter Chips
    document.querySelectorAll('.filter-chips .chip')?.forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const filter = chip.getAttribute('data-filter');
        const filters = store.get('filters') || {};
        store.set('filters', { ...filters, tier: filter });
      });
    });

    // Only Hi-Res Checkbox
    document.getElementById('chkOnlyHires')?.addEventListener('change', (e) => {
      const filters = store.get('filters') || {};
      store.set('filters', { ...filters, onlyHires: e.target.checked });
    });

    // Sort Select
    document.getElementById('sortSelect')?.addEventListener('change', (e) => {
      const filters = store.get('filters') || {};
      store.set('filters', { ...filters, sort: e.target.value });
    });
  }

  activate() {
    this.updateList();
  }

  updateList() {
    const allTracks = store.get('tracks') || [];
    const filters = store.get('filters') || {};
    const statsMap = store.get('stats') || new Map();

    this.filteredTracks = SearchEngine.filterAndSort(allTracks, {
      query: filters.search,
      tierFilter: filters.tier,
      onlyHires: filters.onlyHires,
      sortBy: filters.sort,
      statsMap
    });

    // Update empty state & toolbar
    const emptyState = document.getElementById('emptyStateLibrary');
    const toolbar = document.getElementById('tracksToolbar');
    const isEmpty = this.filteredTracks.length === 0;

    if (toolbar) {
      toolbar.style.display = allTracks.length === 0 ? 'none' : 'flex';
    }

    if (emptyState && this.viewport) {
      emptyState.style.display = isEmpty ? 'flex' : 'none';
      this.viewport.style.display = isEmpty ? 'none' : 'block';

      const h3 = emptyState.querySelector('h3');
      const p = emptyState.querySelector('p');
      const btn = emptyState.querySelector('#btnImportFolderEmpty');

      if (allTracks.length === 0) {
        if (h3) h3.innerText = 'Belum Ada Musik Dimuat';
        if (p) p.innerText = 'Pilih folder musik lokal Anda (FLAC, WAV, ALAC, MP3, DSD). Seluruh pemindaian dilakukan langsung di browser Anda secara offline tanpa internet.';
        if (btn) btn.style.display = 'inline-flex';
      } else {
        if (h3) h3.innerText = 'Tidak Ada Lagu yang Cocok';
        if (p) p.innerText = 'Tidak ditemukan lagu yang cocok dengan kata kunci atau filter aktif.';
        if (btn) btn.style.display = 'none';
      }
    }

    if (this.spacer) {
      this.spacer.style.height = `${this.filteredTracks.length * this.itemHeight}px`;
    }

    const summaryEl = document.getElementById('statsSummaryText');
    if (summaryEl) {
      summaryEl.innerText = `${this.filteredTracks.length} dari ${allTracks.length} lagu ditampilkan`;
    }

    this.renderVirtualSlice();
  }

  renderVirtualSlice() {
    if (!this.viewport || !this.content) return;

    const scrollTop = this.viewport.scrollTop;
    const viewportHeight = this.viewport.clientHeight || 450;

    const startIndex = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.buffer);
    const endIndex = Math.min(
      this.filteredTracks.length,
      Math.ceil((scrollTop + viewportHeight) / this.itemHeight) + this.buffer
    );

    this.content.style.transform = `translateY(${startIndex * this.itemHeight}px)`;
    this.content.innerHTML = '';

    const slice = this.filteredTracks.slice(startIndex, endIndex);
    const currentTrack = store.get('currentTrack');
    const selectedIds = store.get('selectedTrackIds') || new Set();

    slice.forEach((track, idx) => {
      const row = TrackRowRenderer.render(track, {
        isPlaying: currentTrack && currentTrack.id === track.id,
        isSelected: selectedIds.has(track.id),
        index: startIndex + idx,
        onClick: (tr) => {
          queueManager.setQueue(this.filteredTracks, startIndex + idx);
        }
      });
      this.content.appendChild(row);
    });
  }
}

export const libraryView = new LibraryView();
