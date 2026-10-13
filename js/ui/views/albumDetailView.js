/**
 * albumDetailView.js - Dedicated album view using unified CollectionPage
 * Features:
 * - Shared CollectionPage layout with ambient glass hero header
 * - Pure icon-only action buttons (Play, Shuffle, Add to Queue)
 * - Standardized TrackRowRenderer track list
 */

import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { queueManager } from '../../player/queue.js';
import { formatDuration, escapeHtml } from '../../core/utils.js';
import { classifyQualityTier } from '../../quality/tiers.js';
import { CollectionPage } from '../components/collectionPage.js';
import { toast } from '../components/toast.js';
import { getIconSvg } from '../icons.js';
import { events } from '../../core/events.js';
import { t } from '../../core/i18n.js';

class AlbumDetailView {
  constructor() {
    this.container = null;
    this.currentAlbumName = null;
  }

  init() {
    this.container = document.getElementById('viewAlbumDetail');
    events.on('i18n:changed', () => {
      if (this.currentAlbumName && this.container?.classList.contains('active')) {
        this.render();
      }
    });
  }

  activate(params = {}) {
    const isNewAlbum = params.album && params.album !== this.currentAlbumName;
    if (params.album) {
      this.currentAlbumName = params.album;
    }
    if (isNewAlbum) {
      CollectionPage.renderSkeleton(this.container, { type: 'album', rows: 8 });
      requestAnimationFrame(() => this.render());
    } else {
      this.render();
    }
  }

  render() {
    if (!this.container) return;

    const allTracks = store.get('tracks') || [];
    const albumName = this.currentAlbumName || '';
    const albumTracks = allTracks.filter(t => (t.overrides?.album || t.metadata?.album || t('player.unknownAlbum')) === albumName);

    if (albumTracks.length === 0) {
      this.container.innerHTML = `
        <div style="padding:32px 16px;">
          <button class="btn btn-secondary" id="btnBackToAlbums" style="margin-bottom:16px;">
            ${getIconSvg('arrow_back', { size: 16 })}
            <span>${escapeHtml(t('collection.backToAlbums'))}</span>
          </button>
          <div class="empty-state">
            <h3>${escapeHtml(t('collection.albumNotFound'))}</h3>
            <p>${t('collection.albumNotFoundDesc', { name: escapeHtml(albumName) })}</p>
          </div>
        </div>
      `;
      document.getElementById('btnBackToAlbums')?.addEventListener('click', () => router.navigate('albums'));
      return;
    }

    // Sort by trackNo if available
    albumTracks.sort((a, b) => {
      const na = a.overrides?.trackNo || a.metadata?.trackNo || 0;
      const nb = b.overrides?.trackNo || b.metadata?.trackNo || 0;
      return na - nb;
    });

    const firstTrack = albumTracks[0];
    const artist = firstTrack.overrides?.artist || firstTrack.metadata?.artist || t('player.unknownArtist');
    const year = firstTrack.metadata?.year || '';
    const genre = firstTrack.metadata?.genre || '';
    const coverUrl = albumTracks.find(t => t.overrides?.pictureUrl)?.overrides?.pictureUrl ||
                     albumTracks.find(t => t.metadata?.pictureUrl)?.metadata?.pictureUrl || null;

    if (coverUrl) {
      albumTracks.forEach(t => {
        if (!t.overrides?.pictureUrl && !t.metadata?.pictureUrl) {
          if (!t.metadata) t.metadata = {};
          t.metadata.pictureUrl = coverUrl;
          t.metadata.hasCover = true;
        }
      });
    }

    let totalSec = 0;
    let highestTier = null;
    for (const t of albumTracks) {
      totalSec += (t.streamInfo?.duration || 0);
      const tier = classifyQualityTier(t.streamInfo, t.format);
      if (!highestTier || tier.tier === 'HI-RES' || tier.tier === 'DSD') {
        highestTier = tier;
      }
    }

    const currentTrack = store.get('currentTrack');

    // Build icon-only action bar per Masalah 5
    const actions = [
      {
        id: 'btnPlayAlbum',
        title: t('collection.albumDetail.playAlbum'),
        isPrimary: true,
        iconSvg: getIconSvg('play_arrow', { size: 22 }),
        onClick: () => {
          queueManager.setQueue(albumTracks, 0);
          toast.success(t('toasts.playingAlbum', { name: albumName }));
        }
      },
      {
        id: 'btnShuffleAlbum',
        title: t('collection.albumDetail.shuffleAlbum'),
        iconSvg: getIconSvg('shuffle', { size: 18 }),
        onClick: () => {
          const shuffled = [...albumTracks].sort(() => Math.random() - 0.5);
          queueManager.setQueue(shuffled, 0);
          toast.success(t('toasts.shufflingAlbum', { name: albumName }));
        }
      },
      {
        id: 'btnQueueAlbum',
        title: t('collection.selectionBar.addToQueue'),
        iconSvg: getIconSvg('playlist_add', { size: 18 }),
        onClick: () => {
          queueManager.addToQueue(albumTracks);
          toast.success(t('toasts.addedCountToQueue', { count: albumTracks.length }), {
            action: {
              label: t('toasts.openQueue'),
              onClick: () => events.emit('drawer:open', 'queue')
            }
          });
        }
      }
    ];

    let extraBadgesHtml = '';
    if (year) {
      extraBadgesHtml += `<span style="font-size:0.8rem; color:var(--text-muted); font-family:var(--font-mono);">${escapeHtml(year)}</span>`;
    }
    if (genre) {
      extraBadgesHtml += `<span style="font-size:0.8rem; color:var(--text-dim);">• ${escapeHtml(genre)}</span>`;
    }

    CollectionPage.render(this.container, {
      type: 'album',
      title: albumName,
      subtitle: artist,
      onSubtitleClick: () => router.navigate('artistDetail', { artist }),
      coverUrl,
      colorSourceUrl: coverUrl,
      badgeLabel: highestTier ? (highestTier.iconSvg || highestTier.label) : 'LOSSLESS',
      badgeClass: highestTier ? highestTier.badgeClass : 'badge-lossless',
      extraBadgesHtml,
      metaLine: t('collection.albumDetail.metaLine', { count: albumTracks.length, duration: formatDuration(totalSec) }),
      actions,
      tracks: albumTracks,
      currentTrackId: currentTrack?.id,
      onRefresh: (res) => {
        if (res?.newAlbum && res.newAlbum !== albumName) {
          this.currentAlbumName = res.newAlbum;
        }
        this.render();
      },
      backLabel: t('collection.backToAlbums'),
      onBack: () => router.navigate('albums'),
      onTrackClick: (track, idx) => {
        queueManager.setQueue(albumTracks, idx);
      }
    });
  }
}

export const albumDetailView = new AlbumDetailView();
