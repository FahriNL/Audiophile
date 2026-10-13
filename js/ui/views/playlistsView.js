/**
 * playlistsView.js - Playlist management, smart playlists, drag-and-drop edit mode,
 * duplicate protection, and M3U import/export.
 * Integrates with unified CollectionPage and sortable motion engine.
 */

import { store } from '../../core/store.js';
import { playlistService } from '../../playlists/playlistService.js';
import { SmartPlaylistEvaluator } from '../../playlists/smartRules.js';
import { M3UHandler } from '../../playlists/m3u.js';
import { queueManager } from '../../player/queue.js';
import { dialog } from '../components/dialog.js';
import { toast } from '../components/toast.js';
import { escapeHtml, formatDuration } from '../../core/utils.js';
import { CollectionPage } from '../components/collectionPage.js';
import { makeSortable } from '../motion/sortable.js';
import { getIconSvg } from '../icons.js';
import { events } from '../../core/events.js';
import { t } from '../../core/i18n.js';

class PlaylistsView {
  constructor() {
    this.container = null;
    this.activePlaylist = null;
    this.isEditMode = false;
    this.sortableInstance = null;
  }

  init() {
    this.container = document.getElementById('viewPlaylists');
    store.subscribe('playlists', (lists) => {
      if (this.activePlaylist) {
        const updated = (lists || []).find(p => p.id === this.activePlaylist.id);
        if (updated) {
          this.activePlaylist = updated;
          this.renderDetail();
        } else {
          this.activePlaylist = null;
          this.render();
        }
      } else {
        this.render();
      }
    });
    store.subscribe('tracks', () => {
      if (this.activePlaylist) this.renderDetail();
      else this.render();
    });
    events.on('i18n:changed', () => {
      if (this.activePlaylist) this.renderDetail();
      else this.render();
    });

    // New playlist button in header
    document.getElementById('btnNewPlaylist')?.addEventListener('click', () => this.promptCreatePlaylist());
  }

  activate(params = {}) {
    if (params.playlistId) {
      const pl = (store.get('playlists') || []).find(p => p.id === params.playlistId);
      if (pl) {
        this.showDetail(pl);
        return;
      }
    }
    this.activePlaylist = null;
    this.isEditMode = false;
    this.render();
  }

  render() {
    if (!this.container) return;
    if (this.activePlaylist) {
      this.renderDetail();
      return;
    }

    if (this.sortableInstance) {
      this.sortableInstance.destroy();
      this.sortableInstance = null;
    }

    const playlists = store.get('playlists') || [];
    const allTracks = store.get('tracks') || [];
    const statsMap = store.get('stats') || new Map();

    // Calculate smart playlist counts
    const favCount = allTracks.filter(t => statsMap.get(t.id)?.favorite).length;
    const topCount = allTracks.filter(t => (statsMap.get(t.id)?.playCount || 0) > 0).length;
    const hiresCount = allTracks.filter(t => t.tier === 'HI-RES' || t.tier === 'DSD').length;

    this.container.innerHTML = `
      <div class="flex-between" style="margin-bottom:12px;">
        <h3>${escapeHtml(t('playlists.title'))}</h3>
        <div style="display:flex; gap:8px;">
          <label class="btn" style="cursor:pointer;">
            ${escapeHtml(t('playlists.importM3u'))}
            <input type="file" id="inputImportM3u" accept=".m3u,.m3u8" style="display:none;" />
          </label>
          <button class="btn btn-primary" id="btnCreatePlInline">+ ${escapeHtml(t('playlists.newPlaylist'))}</button>
        </div>
      </div>

      <!-- Smart Playlists Section -->
      <h4 style="font-size:0.85rem; color:var(--text-dim); text-transform:uppercase; margin-bottom:10px;">${escapeHtml(t('playlists.smartSection'))}</h4>
      <div class="grid-container" style="margin-bottom:20px;">
        <div class="card smart-card" data-smart="favorites">
          <div class="card-body">
            <div class="card-title">${escapeHtml(t('playlists.smartFavorites'))}</div>
            <div class="card-subtitle">${favCount} ${escapeHtml(t('common.songs'))}</div>
          </div>
        </div>
        <div class="card smart-card" data-smart="topPlayed">
          <div class="card-body">
            <div class="card-title">${escapeHtml(t('playlists.smartTopPlayed'))}</div>
            <div class="card-subtitle">${topCount} ${escapeHtml(t('common.songs'))}</div>
          </div>
        </div>
        <div class="card smart-card" data-smart="allHires">
          <div class="card-body">
            <div class="card-title">${escapeHtml(t('playlists.smartHires'))}</div>
            <div class="card-subtitle">${hiresCount} ${escapeHtml(t('common.songs'))}</div>
          </div>
        </div>
      </div>

      <!-- User Playlists Section -->
      <h4 style="font-size:0.85rem; color:var(--text-dim); text-transform:uppercase; margin-bottom:10px;">Playlist Pengguna (${playlists.length})</h4>
      <div class="grid-container" id="userPlaylistsGrid">
        ${playlists.length === 0 ? '<p style="font-size:0.85rem; color:var(--text-muted); grid-column:1/-1;">Belum ada playlist kustom dibuat.</p>' : ''}
        ${playlists.map(pl => {
          const summary = playlistService.calculateSummary(pl.trackIds || [], allTracks);
          return `
            <div class="card playlist-item-card" data-id="${pl.id}" style="cursor:pointer;">
              <div class="card-thumb" style="width:100%; aspect-ratio:1; overflow:hidden; border-radius:var(--radius-md) var(--radius-md) 0 0;">
                ${playlistService.renderPlaylistThumbnail(pl, allTracks)}
              </div>
              <div class="card-body">
                <div class="card-title truncate">${escapeHtml(pl.name)}</div>
                <div class="card-subtitle truncate">${pl.description ? escapeHtml(pl.description) + ' • ' : ''}${summary.count} lagu</div>
                <div style="font-size:0.68rem; color:var(--accent-light); margin-top:4px;" class="truncate">${summary.qualitySummary}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Event listeners
    document.getElementById('btnCreatePlInline')?.addEventListener('click', () => this.promptCreatePlaylist());

    document.getElementById('inputImportM3u')?.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        await this.handleImportM3U(e.target.files[0]);
      }
    });

    this.container.querySelectorAll('.smart-card').forEach(card => {
      card.addEventListener('click', () => {
        const type = card.getAttribute('data-smart');
        this.openSmartPlaylist(type);
      });
    });

    this.container.querySelectorAll('.playlist-item-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        const pl = playlists.find(p => p.id === id);
        if (pl) this.showDetail(pl);
      });
    });
  }

  showDetail(playlist) {
    this.activePlaylist = playlist;
    this.isEditMode = false;
    this.renderDetail();
  }

  renderDetail() {
    if (!this.container || !this.activePlaylist) return;

    if (this.sortableInstance) {
      this.sortableInstance.destroy();
      this.sortableInstance = null;
    }

    const pl = this.activePlaylist;
    const allTracks = store.get('tracks') || [];
    const trackMap = new Map(allTracks.map(t => [t.id, t]));
    const plTracks = (pl.trackIds || []).map(id => trackMap.get(id)).filter(Boolean);

    const summary = playlistService.calculateSummary(pl.trackIds || [], allTracks);
    const covers = playlistService.getCollageCovers(pl, allTracks, 4);
    const coverHtml = playlistService.renderPlaylistThumbnail(pl, allTracks);
    const colorSourceUrl = covers.length > 0 ? covers[0] : null;

    // Pure icon action buttons per Masalah 5:
    // Play (large 52px accent), Shuffle (44px), Play Next (44px), Queue (44px), Export M3U (44px), Edit (pencil/checkmark 44px)
    const actions = [
      {
        id: 'btnPlayPl',
        title: t('home.playPlaylist'),
        isPrimary: true,
        iconSvg: getIconSvg('play_arrow', { size: 22 }),
        onClick: () => {
          if (plTracks.length > 0) {
            queueManager.setQueue(plTracks, 0);
            toast.success(`Memutar playlist "${pl.name}".`);
          }
        }
      },
      {
        id: 'btnShufflePl',
        title: t('collection.albumDetail.shuffleAlbum'),
        iconSvg: getIconSvg('shuffle', { size: 18 }),
        onClick: () => {
          if (plTracks.length > 0) {
            const shuffled = [...plTracks].sort(() => Math.random() - 0.5);
            queueManager.setQueue(shuffled, 0);
            toast.success(`Memutar acak playlist "${pl.name}".`);
          }
        }
      },
      {
        id: 'btnPlayNextPl',
        title: t('actions.playNext'),
        iconSvg: getIconSvg('skip_next', { size: 18 }),
        onClick: () => {
          if (plTracks.length > 0) {
            queueManager.playNext(plTracks);
            toast.success(`${plTracks.length} lagu disisipkan berikutnya.`);
          }
        }
      },
      {
        id: 'btnQueuePl',
        title: t('collection.selectionBar.addToQueue'),
        iconSvg: getIconSvg('playlist_add', { size: 18 }),
        onClick: () => {
          if (plTracks.length > 0) {
            queueManager.addToQueue(plTracks);
            toast.success(`${plTracks.length} lagu ditambahkan ke antrean.`, {
              action: {
                label: 'Buka Antrean',
                onClick: () => events.emit('drawer:open', 'queue')
              }
            });
          }
        }
      }
    ];

    // Extra sections slot (In Edit Mode: metadata modification & permanent sort toolbar)
    let extraSectionsHtml = '';
    if (this.isEditMode && !pl.isSmart) {
      extraSectionsHtml = `
        <div class="glass-panel" style="padding:16px 20px; border-radius:var(--radius-lg); background:var(--glass-bg-card); border:1px solid var(--glass-border-specular); display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <div style="font-size:0.85rem; font-weight:600; color:var(--accent-light);">Mode Edit Aktif</div>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-secondary btn-sm" id="btnRenamePl">Ubah Nama / Deskripsi</button>
            </div>
          </div>

          <!-- Permanent Sort Toolbar -->
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; border-top:1px solid var(--glass-border-subtle); padding-top:10px;">
            <span style="font-size:0.75rem; color:var(--text-dim);">Terapkan sortir sebagai urutan permanen:</span>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-sm" data-sort="title" style="font-size:0.72rem;">Judul</button>
              <button class="btn btn-sm" data-sort="artist" style="font-size:0.72rem;">Artis</button>
              <button class="btn btn-sm" data-sort="tier" style="font-size:0.72rem;">Kualitas</button>
              <button class="btn btn-sm" data-sort="added" style="font-size:0.72rem;">Tanggal</button>
            </div>
          </div>
        </div>
      `;
    }

    const currentTrack = store.get('currentTrack');

    CollectionPage.render(this.container, {
      type: 'playlist',
      title: pl.name,
      subtitle: pl.description,
      coverHtml,
      colorSourceUrl,
      badgeLabel: summary.qualitySummary.split(',')[0] || 'PLAYLIST',
      badgeClass: 'badge-hires',
      metaLine: `${summary.count} Lagu • Total Durasi: ${formatDuration(summary.totalDuration)}`,
      actions,
      extraSectionsHtml,
      tracks: plTracks,
      playlist: pl,
      isEditMode: this.isEditMode,
      onToggleEditMode: () => {
        this.isEditMode = !this.isEditMode;
        this.renderDetail();
      },
      onExportM3u: () => {
        const m3uStr = M3UHandler.exportM3U(pl.name, plTracks);
        const blob = new Blob([m3uStr], { type: 'audio/x-mpegurl' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${pl.name.replace(/[/\\?%*:|"<>]/g, '_')}.m3u`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Playlist berhasil diekspor ke format M3U.');
      },
      onDeletePlaylist: async () => {
        const confirmed = await dialog.confirm('Hapus Playlist', `Apakah Anda yakin ingin menghapus playlist "${pl.name}"?`);
        if (confirmed) {
          const originalPl = { ...pl, trackIds: [...pl.trackIds] };
          await playlistService.deletePlaylist(pl.id);
          toast.show(`Playlist "${pl.name}" dihapus.`, {
            onUndo: async () => {
              await playlistService.createPlaylist(originalPl.name, originalPl.description, originalPl.trackIds);
              toast.success('Penghapusan playlist dibatalkan.');
            }
          });
          this.activePlaylist = null;
          this.isEditMode = false;
          this.render();
        }
      },
      onRefresh: () => this.renderDetail(),
      currentTrackId: currentTrack?.id,
      playlistId: pl.id,
      backLabel: 'Kembali ke Daftar Playlist',
      onBack: () => {
        this.activePlaylist = null;
        this.isEditMode = false;
        this.render();
      },
      onTrackClick: (track, idx) => {
        if (!this.isEditMode) {
          queueManager.setQueue(plTracks, idx);
        }
      },
      onRemoveTrack: async (idx, track) => {
        const removedTrack = plTracks[idx];
        if (!removedTrack) return;
        await playlistService.removeTrackFromPlaylist(pl.id, idx);
        this.renderDetail();
        toast.show(`"${removedTrack.overrides?.title || removedTrack.metadata?.title || 'Lagu'}" dihapus dari playlist.`, {
          onUndo: async () => {
            await playlistService.addTracksToPlaylist(pl.id, [removedTrack.id]);
            this.renderDetail();
          }
        });
      }
    });

    // Bind Edit Mode Actions
    if (this.isEditMode && !pl.isSmart) {
      document.getElementById('btnRenamePl')?.addEventListener('click', async () => {
        const newName = await dialog.prompt('Ubah Playlist', 'Nama playlist:', pl.name);
        if (newName) {
          const newDesc = await dialog.prompt('Deskripsi Playlist', 'Deskripsi playlist:', pl.description || '');
          await playlistService.renamePlaylist(pl.id, newName, newDesc || '');
          pl.name = newName;
          pl.description = newDesc || '';
          this.renderDetail();
          toast.success('Informasi playlist diperbarui.');
        }
      });

      this.container.querySelectorAll('[data-sort]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const field = btn.getAttribute('data-sort');
          await playlistService.sortPlaylistPermanently(pl.id, field, allTracks);
          this.renderDetail();
          toast.success(`Urutan playlist disimpan permanen berdasarkan ${field}.`);
        });
      });

      // Initialize Sortable Drag-and-Drop in Edit Mode via shared sortable.js
      const tracklistContainer = this.container.querySelector('.collection-tracklist-container');
      if (tracklistContainer && plTracks.length > 1) {
        this.sortableInstance = makeSortable(tracklistContainer, {
          itemSelector: '.collection-edit-row-wrapper',
          handleSelector: '.sortable-handle',
          onReorder: async (fromIndex, toIndex) => {
            if (fromIndex !== toIndex) {
              await playlistService.moveTrack(pl.id, fromIndex, toIndex);
              toast.show('Urutan playlist diperbarui.', {
                onUndo: async () => {
                  await playlistService.moveTrack(pl.id, toIndex, fromIndex);
                  this.renderDetail();
                }
              });
              this.renderDetail();
            }
          }
        });
      }
    }
  }

  async promptCreatePlaylist() {
    const name = await dialog.prompt('Buat Playlist Baru', 'Masukkan nama playlist:', 'Playlist Saya');
    if (name) {
      const desc = await dialog.prompt('Deskripsi (Opsional)', 'Deskripsi playlist:');
      const pl = await playlistService.createPlaylist(name, desc || '');
      toast.success(`Playlist "${pl.name}" berhasil dibuat.`);
      this.showDetail(pl);
    }
  }

  async handleImportM3U(file) {
    try {
      const content = await file.text();
      const allTracks = store.get('tracks') || [];
      const { matchedTrackIds, unmatchedLines } = M3UHandler.parseM3U(content, allTracks);

      const name = file.name.replace(/\.[^/.]+$/, '');
      const pl = await playlistService.createPlaylist(name, 'Diimpor dari berkas M3U', matchedTrackIds);

      toast.success(`Diimpor "${pl.name}" (${matchedTrackIds.length} lagu cocok, ${unmatchedLines.length} tidak ditemukan).`);
      this.showDetail(pl);
    } catch (err) {
      console.error('Import M3U error:', err);
      toast.error('Gagal membaca berkas M3U.');
    }
  }

  openSmartPlaylist(type) {
    const allTracks = store.get('tracks') || [];
    const statsMap = store.get('stats') || new Map();

    let title = '';
    let rules = {};

    if (type === 'favorites') {
      title = 'Favorit Saya';
      rules = { conditions: [{ field: 'favorite', value: true }] };
    } else if (type === 'topPlayed') {
      title = 'Paling Sering Diputar';
      rules = { conditions: [{ field: 'playCount', operator: 'greaterOrEqual', value: 1 }], sort: 'playCountDesc', limit: 100 };
    } else if (type === 'allHires') {
      title = 'Koleksi Hi-Res Murni';
      rules = { matchMode: 'OR', conditions: [{ field: 'tier', operator: 'equals', value: 'HI-RES' }, { field: 'tier', operator: 'equals', value: 'DSD' }] };
    }

    const matched = SmartPlaylistEvaluator.evaluate(allTracks, rules, statsMap);
    const virtualPlaylist = {
      id: 'smart_' + type,
      name: title,
      description: 'Smart playlist otomatis berdasarkan aturan',
      trackIds: matched.map(t => t.id),
      isSmart: true
    };

    this.showDetail(virtualPlaylist);
  }
}

export const playlistsView = new PlaylistsView();
