/**
 * collectionPage.js - Reusable Unified Collection Page Component
 * Standardizes:
 * - Ambient glass hero header (cover artwork, title, subtitle, badges, audio specs, palette tinting)
 * - Action bar with pure icon-only buttons (Play, Shuffle, Play Next, Queue, Export, Edit, Delete)
 * - Track list rendered via TrackRowRenderer with uniform 60px row height, hover, and quality badges
 * - Custom slot for extra views (Artist top tracks/discography/bio, Album disc groups, Playlist edit tools)
 */

import { escapeHtml, formatDuration, getArtistInitials, getDarkArtistGradient, renderArtistLinks } from '../../core/utils.js';
import { ambientManager } from '../ambient.js';
import { TrackRowRenderer } from './trackRow.js';
import { getIconSvg } from '../icons.js';
import { collectionMenu } from './collectionMenu.js';
import { t } from '../../core/i18n.js';

export class CollectionPage {
  /**
   * Render a complete collection page into a container
   * @param {HTMLElement} container
   * @param {Object} options
   */
  static render(container, options = {}) {
    if (!container) return;

    const {
      type = 'album', // 'album' | 'artist' | 'playlist'
      title = '',
      subtitle = '',
      onSubtitleClick = null,
      coverUrl = null,
      coverHtml = null,
      bannerUrl = null,
      isAvatarRound = false,
      badgeLabel = 'LOSSLESS',
      badgeClass = 'badge-lossless',
      metaLine = '',
      colorSourceUrl = null,
      actions = [],
      extraSectionsHtml = '',
      tracks = [],
      currentTrackId = null,
      isEditMode = false,
      playlistId = null,
      onTrackClick = null,
      onBack = null,
      backLabel = null
    } = options;

    const resolvedBackLabel = backLabel || t('actions.back');
    const heroId = `hero_${type}_${Date.now()}`;

    container.innerHTML = `
      <div class="collection-page" style="display:flex; flex-direction:column; gap:20px;">
        <!-- Top Back Navigation -->
        <div>
          <button class="btn btn-secondary collection-back-btn" id="btnCollectionBack" style="display:inline-flex; align-items:center; gap:8px;">
            ${getIconSvg('arrow_back', { size: 16 })}
            <span>${escapeHtml(resolvedBackLabel)}</span>
          </button>
        </div>

        <!-- Unified Ambient Glass Hero Header -->
        <div class="glass-panel collection-hero-panel" id="${heroId}" style="display:flex; gap:24px; padding:24px; border-radius:var(--radius-lg); align-items:center; flex-wrap:wrap; position:relative; overflow:hidden; border:1px solid var(--glass-border-specular); background:var(--glass-bg-card); backdrop-filter:var(--glass-filter); -webkit-backdrop-filter:var(--glass-filter); transition:background 600ms ease;">
          ${bannerUrl ? `
            <div class="collection-hero-backdrop" style="position:absolute; inset:0; z-index:0; overflow:hidden; pointer-events:none;">
              <img src="${bannerUrl}" style="width:100%; height:100%; object-fit:cover; object-position:center 30%; filter:blur(1px) brightness(0.48); transform:scale(1.05);" alt="Banner" />
              <div style="position:absolute; inset:0; background:linear-gradient(to bottom, rgba(15,23,42,0.3) 0%, rgba(15,23,42,0.85) 75%, var(--bg-base) 100%);"></div>
            </div>
          ` : ''}

          <!-- Cover Artwork / Avatar Box -->
          <div class="collection-cover-box ${isAvatarRound ? 'avatar' : ''}" style="width:160px; height:160px; border-radius:${isAvatarRound ? 'var(--radius-full)' : 'var(--radius-md)'}; overflow:hidden; background:var(--glass-bg-card); border:1px solid var(--glass-border-specular); flex-shrink:0; display:flex; align-items:center; justify-content:center; box-shadow:0 12px 32px rgba(0,0,0,0.45); position:relative; z-index:1;">
            ${coverHtml ? coverHtml : (coverUrl ? `
              <img src="${coverUrl}" style="width:100%; height:100%; object-fit:cover;" alt="Cover" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
              ${type === 'artist' ? `
                <div style="display:none; width:100%; height:100%; align-items:center; justify-content:center; background:${getDarkArtistGradient(title)}; color:#f8fafc; font-family:var(--font-heading); font-size:3rem; font-weight:700;">${escapeHtml(getArtistInitials(title))}</div>
              ` : `
                <div style="display:none; width:100%; height:100%; align-items:center; justify-content:center; background:var(--bg-surface-elevated); color:var(--text-dim);"><svg width="56" height="56" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 16.5C9.51 16.5 7.5 14.49 7.5 12C7.5 9.51 9.51 7.5 12 7.5C14.49 7.5 16.5 9.51 16.5 12C16.5 14.49 14.49 16.5 12 16.5ZM12 11C11.45 11 11 11.45 11 12C11 12.55 11.45 13 12 13C12.55 13 13 12.55 13 12C13 11.45 12.55 11 12 11Z"/></svg></div>
              `}
            ` : (type === 'artist' ? `
              <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:${getDarkArtistGradient(title)}; color:#f8fafc; font-family:var(--font-heading); font-size:3rem; font-weight:700;">${escapeHtml(getArtistInitials(title))}</div>
            ` : `
              <svg width="56" height="56" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 16.5C9.51 16.5 7.5 14.49 7.5 12C7.5 9.51 9.51 7.5 12 7.5C14.49 7.5 16.5 9.51 16.5 12C16.5 14.49 14.49 16.5 12 16.5ZM12 11C11.45 11 11 11.45 11 12C11 12.55 11.45 13 12 13C12.55 13 13 12.55 13 12C13 11.45 12.55 11 12 11Z"/></svg>
            `))}
          </div>

          <!-- Metadata & Action Buttons -->
          <div class="collection-info" style="flex:1; min-width:240px; display:flex; flex-direction:column; gap:8px; position:relative; z-index:1;">
            <!-- Badges Row -->
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              ${badgeLabel ? `<span class="badge ${badgeClass}">${badgeLabel.includes('<svg') ? badgeLabel : escapeHtml(badgeLabel)}</span>` : ''}
              ${options.extraBadgesHtml || ''}
            </div>

            <!-- Title -->
            <h1 class="collection-title" style="font-size:1.8rem; font-weight:700; color:var(--text-main); margin:0; line-height:1.2;">
              ${escapeHtml(title)}
            </h1>

            <!-- Subtitle -->
            ${subtitle ? `
              <div class="collection-subtitle" id="lblCollectionSubtitle" style="font-size:1rem; color:var(--aurora-light); font-weight:500;">
                ${type === 'album' ? renderArtistLinks(subtitle) : escapeHtml(subtitle)}
              </div>
            ` : ''}

            <!-- Summary Meta Line -->
            ${metaLine ? `
              <div class="collection-meta-line mono" style="font-size:0.82rem; color:var(--text-dim); font-family:var(--font-mono);">
                ${escapeHtml(metaLine)}
              </div>
            ` : ''}

            <!-- Pure Icon Action Bar (Masalah 5: >= 44px, no text labels, accessible aria-labels) -->
            <div class="collection-action-bar" style="display:flex; align-items:center; gap:12px; margin-top:8px; flex-wrap:wrap;">
              ${actions.map(act => `
                <button class="btn btn-action-round ${act.isPrimary ? 'btn-play-round' : ''} ${act.isDanger ? 'btn-danger' : ''} ${act.isActive ? 'active' : ''}" id="${act.id}" title="${escapeHtml(act.title)}" aria-label="${escapeHtml(act.title)}" style="${act.style || ''}">
                  ${act.iconSvg}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- 3-Dot More Actions Menu at bottom-right of hero header -->
          <div class="collection-hero-more-anchor">
            <button class="btn btn-action-round collection-btn-more" id="btnCollectionMore" title="${escapeHtml(t('actions.collectionOptions'))}" aria-label="${escapeHtml(t('actions.collectionOptions'))}">
              ${getIconSvg('more_horiz', { size: 20 })}
            </button>
          </div>
        </div>

        <!-- Extra View Sections Slot (Artist Top Tracks, Bio, Discography, Playlist Edit Bar) -->
        <div id="collectionExtraSections">${extraSectionsHtml || ''}</div>

        <!-- Tracklist Panel -->
        <div class="glass-panel collection-tracklist-panel" style="background:var(--glass-bg-card); border:1px solid var(--glass-border-specular); backdrop-filter:var(--glass-filter); -webkit-backdrop-filter:var(--glass-filter); border-radius:var(--radius-lg); padding:16px;">
          <div class="collection-tracklist-container" id="tracklist_${heroId}" style="display:flex; flex-direction:column; gap:4px;"></div>
        </div>
      </div>
    `;

    // 1. Asynchronously extract ambient palette to tint hero header
    const sourceImg = colorSourceUrl || coverUrl;
    if (sourceImg && typeof ambientManager?.extractColorsFromImage === 'function') {
      ambientManager.extractColorsFromImage(sourceImg).then(result => {
        const heroEl = container.querySelector('#' + heroId);
        if (heroEl && result?.ambientColors && result.ambientColors.length >= 2) {
          const c1 = result.ambientColors[0];
          const c2 = result.ambientColors[1];
          heroEl.style.background = `radial-gradient(circle at 18% 22%, ${c1} 0%, transparent 68%), radial-gradient(circle at 82% 78%, ${c2} 0%, transparent 64%), var(--glass-bg-card)`;
        }
      }).catch(() => {});
    }

    // 2. Bind Back button
    container.querySelector('#btnCollectionBack')?.addEventListener('click', () => {
      if (typeof onBack === 'function') onBack();
    });

    // 3. Bind Subtitle click
    if (onSubtitleClick) {
      container.querySelector('#lblCollectionSubtitle')?.addEventListener('click', onSubtitleClick);
    }

    // 4. Bind Action Bar button handlers
    actions.forEach(act => {
      if (act.onClick) {
        container.querySelector('#' + act.id)?.addEventListener('click', act.onClick);
      }
    });

    // 5. Bind 3-Dot More Actions Menu
    const btnMore = container.querySelector('#btnCollectionMore');
    if (btnMore) {
      collectionMenu.bind(btnMore, {
        type,
        title,
        subtitle,
        tracks,
        meta: options.meta || null,
        playlist: options.playlist || null,
        coverUrl,
        isEditMode: options.isEditMode || false,
        onToggleEditMode: options.onToggleEditMode || null,
        onExportM3u: options.onExportM3u || null,
        onDeletePlaylist: options.onDeletePlaylist || null,
        onRefresh: options.onRefresh || null
      });
    }

    // 6. Mount Track Rows
    const tracklistContainer = container.querySelector('.collection-tracklist-container');
    if (tracklistContainer) {
      if (tracks.length === 0) {
        tracklistContainer.innerHTML = `
          <div style="padding:32px 16px; text-align:center; color:var(--text-dim); font-size:0.85rem;">
            ${escapeHtml(t('collection.noTracksInCollection'))}
          </div>
        `;
      } else {
        tracks.forEach((track, idx) => {
          if (isEditMode) {
            // Edit mode row wrapper with sortable drag handle and remove button
            const rowWrapper = document.createElement('div');
            rowWrapper.className = 'collection-edit-row-wrapper';
            rowWrapper.setAttribute('data-idx', String(idx));
            rowWrapper.setAttribute('data-id', track.id);
            rowWrapper.style.display = 'flex';
            rowWrapper.style.alignItems = 'center';
            rowWrapper.style.gap = '8px';
            rowWrapper.style.paddingRight = '8px';
            rowWrapper.style.borderRadius = 'var(--radius-sm)';
            rowWrapper.style.border = '1px solid var(--glass-border-card)';
            rowWrapper.style.background = 'var(--glass-bg-card)';

            // Drag Handle
            const dragHandle = document.createElement('div');
            dragHandle.className = 'sortable-handle';
            dragHandle.setAttribute('title', 'Tahan dan geser untuk ubah urutan');
            dragHandle.setAttribute('aria-label', `Geser posisi lagu ${track.overrides?.title || track.metadata?.title || 'lagu'}`);
            dragHandle.setAttribute('tabindex', '0');
            dragHandle.style.padding = '0 8px';
            dragHandle.innerHTML = getIconSvg('drag_indicator', { size: 16 });
            rowWrapper.appendChild(dragHandle);

            // Track row mount
            const mount = document.createElement('div');
            mount.style.flex = '1';
            mount.style.minWidth = '0';
            const rowEl = TrackRowRenderer.render(track, {
              isPlaying: track.id === currentTrackId,
              showIndex: true,
              index: idx,
              playlistId,
              isEditMode: true,
              onClick: () => {
                if (typeof onTrackClick === 'function') onTrackClick(track, idx);
              }
            });
            mount.appendChild(rowEl);
            rowWrapper.appendChild(mount);

            // Trash remove button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn btn-icon btn-remove-track-row';
            removeBtn.setAttribute('data-idx', String(idx));
            removeBtn.setAttribute('title', 'Hapus dari playlist');
            removeBtn.setAttribute('aria-label', 'Hapus lagu ini dari playlist');
            removeBtn.style.color = 'var(--status-danger)';
            removeBtn.style.minWidth = '36px';
            removeBtn.style.minHeight = '36px';
            removeBtn.innerHTML = getIconSvg('delete', { size: 16 });
            if (options.onRemoveTrack) {
              removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                options.onRemoveTrack(idx, track);
              });
            }
            rowWrapper.appendChild(removeBtn);

            tracklistContainer.appendChild(rowWrapper);
          } else {
            // Standard read-only track row
            const rowEl = TrackRowRenderer.render(track, {
              isPlaying: track.id === currentTrackId,
              showIndex: true,
              index: idx,
              playlistId,
              isEditMode: false,
              onClick: () => {
                if (typeof onTrackClick === 'function') onTrackClick(track, idx);
              }
            });
            tracklistContainer.appendChild(rowEl);
          }
        });
      }
    }
  }

  /**
   * Render skeleton shimmer placeholder to eliminate blank screen flicker
   * @param {HTMLElement} container
   * @param {Object} options
   */
  static renderSkeleton(container, options = {}) {
    if (!container) return;
    const { type = 'album', rows = 6 } = options;
    const isArtist = type === 'artist';

    container.innerHTML = `
      <div class="collection-page skeleton-loading" style="display:flex; flex-direction:column; gap:20px;">
        <div>
          <div class="skeleton-shimmer" style="width:110px; height:34px; border-radius:var(--radius-sm);"></div>
        </div>
        <div class="glass-panel collection-hero-panel" style="display:flex; gap:24px; padding:24px; border-radius:var(--radius-lg); align-items:center; flex-wrap:wrap; border:1px solid var(--glass-border-specular); background:var(--glass-bg-card);">
          <div class="skeleton-shimmer skeleton-hero-cover ${isArtist ? 'avatar' : ''}" style="width:160px; height:160px; ${isArtist ? 'border-radius:var(--radius-full);' : 'border-radius:var(--radius-md);'}"></div>
          <div class="collection-info" style="flex:1; min-width:240px; display:flex; flex-direction:column; gap:12px;">
            <div class="skeleton-shimmer" style="width:90px; height:22px; border-radius:4px;"></div>
            <div class="skeleton-shimmer skeleton-hero-title" style="width:55%; max-width:340px; height:34px; border-radius:6px;"></div>
            <div class="skeleton-shimmer skeleton-hero-meta" style="width:35%; max-width:220px; height:18px; border-radius:4px;"></div>
            <div class="skeleton-hero-actions" style="display:flex; gap:12px; margin-top:8px;">
              <div class="skeleton-shimmer skeleton-circle-btn"></div>
              <div class="skeleton-shimmer skeleton-circle-btn"></div>
              <div class="skeleton-shimmer skeleton-circle-btn"></div>
            </div>
          </div>
        </div>
        <div class="glass-panel collection-tracklist-panel" style="background:var(--glass-bg-card); border:1px solid var(--glass-border-specular); border-radius:var(--radius-lg); padding:16px; display:flex; flex-direction:column; gap:8px;">
          ${Array.from({ length: rows }).map(() => `
            <div class="skeleton-track-row">
              <div class="skeleton-shimmer skeleton-track-num"></div>
              <div class="skeleton-track-main">
                <div class="skeleton-shimmer skeleton-track-title"></div>
                <div class="skeleton-shimmer skeleton-track-sub"></div>
              </div>
              <div class="skeleton-shimmer skeleton-track-dur"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
}
