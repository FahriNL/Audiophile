/**
 * main.js - Application entry point, bootstrap, and route coordination
 */

import { db } from './db/db.js';
import { store } from './core/store.js';
import { router } from './core/router.js';
import { events } from './core/events.js';
import { folderManager, formatTotalFolderSize } from './library/folders.js';
import { scanner } from './library/scanner.js';
import { coverCache } from './library/covers.js';
import { playlistService } from './playlists/playlistService.js';
import { MediaSessionController } from './player/mediaSession.js';
import { engine } from './player/engine.js';
import { queueManager } from './player/queue.js';
import { toast } from './ui/components/toast.js';
import { escapeHtml } from './core/utils.js';
import { classifyQualityTier } from './quality/tiers.js';
import { contextMenu } from './ui/components/contextMenu.js';
import { getIconSvg } from './ui/icons.js';
import { i18n, t } from './core/i18n.js';

// Import UI Views
import { homeView } from './ui/views/homeView.js';
import { collectionView } from './ui/views/collectionView.js';
import { libraryView } from './ui/views/libraryView.js';
import { searchView } from './ui/views/searchView.js';
import { albumsView } from './ui/views/albumsView.js';
import { albumDetailView } from './ui/views/albumDetailView.js';
import { artistsView } from './ui/views/artistsView.js';
import { artistDetailView } from './ui/views/artistDetailView.js';
import { playlistsView } from './ui/views/playlistsView.js';
import { queueView } from './ui/views/queueView.js';
import { analysisView } from './ui/views/analysisView.js';
import { settingsView } from './ui/views/settingsView.js';
import { healthView } from './ui/views/healthView.js';
import { playerBar } from './ui/components/playerBar.js';
import { quickSearch } from './ui/components/quickSearch.js';
import { ambientManager } from './ui/ambient.js';
import { lyricsManager } from './ui/lyrics.js';
import { perfManager } from './core/perf.js';
import { settings } from './core/settings.js';
import { shortcutManager } from './core/shortcuts.js';
import { pipManager } from './player/pip.js';
import { initFluidKit } from './ui/motion/fluidKit.js';
import { modLoader } from './mods/modLoader.js';

class Application {
  static async start() {
    console.log('Starting Audiophile Audio System...');
    // 0. Load and merge settings before first render to prevent layout jumping
    await settings.ready;

    // Apply saved language immediately before any view renders
    const savedLang = settings.get('lang', 'id');
    i18n.init(savedLang);
    document.documentElement.setAttribute('lang', savedLang);
    i18n.applyToDOM();

    // Boot ZIP modding engine and active mods
    try {
      await modLoader.init();
    } catch (modBootErr) {
      console.warn('Gagal memuat mod sistem saat startup:', modBootErr);
    }

    // Apply saved theme immediately
    const savedTheme = settings.get('theme', 'dark');
    document.documentElement.setAttribute('data-theme', savedTheme);

    perfManager.init();
    ambientManager.init();
    lyricsManager.init();
    initFluidKit();

    // 1. Initialize Views in Router
    router.register('home', homeView);
    router.register('collection', collectionView);
    router.register('library', homeView);
    router.register('search', searchView);
    router.register('albums', collectionView);
    router.register('albumDetail', albumDetailView);
    router.register('artists', collectionView);
    router.register('artistDetail', artistDetailView);
    router.register('playlists', playlistsView);
    router.register('queue', queueView);
    router.register('analysis', settingsView);
    router.register('settings', settingsView);
    router.register('health', healthView);
    router.register('nowPlaying', {
      activate: () => {
        playerBar.onNowPlayingActivated?.();
      }
    });

    homeView.init();
    collectionView.init();
    libraryView.init();
    searchView.init();
    albumsView.init();
    albumDetailView.init();
    artistsView.init();
    artistDetailView.init();
    playlistsView.init();
    queueView.init();
    analysisView.init();
    settingsView.init();
    healthView.init();
    playerBar.init();
    quickSearch.init();

    // 2. Setup Navigation Controls
    this.setupNavigation();
    this.setupGlobalEvents();

    // 3. Load DB Cached Data
    try {
      await folderManager.loadSavedHandles();
      await playlistService.loadPlaylists();

      const cachedTracks = await db.getAll('tracks');
      const cachedOverrides = await db.getAll('tagOverrides');
      const overridesMap = new Map((cachedOverrides || []).map(o => [o.trackId, o]));
      store.set('tagOverrides', overridesMap);

      if (cachedTracks && cachedTracks.length > 0) {
        let repairedMissingCount = 0;
        const albumCoverMap = new Map();
        for (const trk of cachedTracks) {
          if (trk.missing) {
            trk.missing = false;
            repairedMissingCount++;
          }
          const ov = overridesMap.get(trk.id);
          if (ov) {
            trk.overrides = { ...(trk.overrides || {}), ...ov };
            if (ov.pictureUrl !== undefined) {
              if (!trk.metadata) trk.metadata = {};
              trk.metadata.pictureUrl = ov.pictureUrl;
            }
          }
          if (typeof trk.metadata?.pictureUrl === 'string' && trk.metadata.pictureUrl.startsWith('blob:')) {
            trk.metadata.pictureUrl = null;
          }
          await coverCache.resolveTrackCover(trk);

          const alb = (trk.overrides?.album || trk.metadata?.album || '').toLowerCase().trim();
          const art = (trk.overrides?.artist || trk.metadata?.artist || '').toLowerCase().trim();
          const pic = trk.overrides?.pictureUrl || trk.metadata?.pictureUrl;
          if (alb && alb !== 'tanpa album' && alb !== 'album tidak diketahui' && pic) {
            albumCoverMap.set(`${art}::${alb}`, { pictureUrl: pic, pictureKey: trk.metadata?.pictureKey });
            if (!albumCoverMap.has(alb)) {
              albumCoverMap.set(alb, { pictureUrl: pic, pictureKey: trk.metadata?.pictureKey });
            }
          }
        }

        // Propagate album cover to any track in the same album lacking one
        for (const trk of cachedTracks) {
          const alb = (trk.overrides?.album || trk.metadata?.album || '').toLowerCase().trim();
          const art = (trk.overrides?.artist || trk.metadata?.artist || '').toLowerCase().trim();
          const inherited = albumCoverMap.get(`${art}::${alb}`) || albumCoverMap.get(alb);
          if (inherited && (!trk.metadata?.pictureUrl && !trk.overrides?.pictureUrl)) {
            if (!trk.metadata) trk.metadata = {};
            trk.metadata.pictureUrl = inherited.pictureUrl;
            if (inherited.pictureKey) trk.metadata.pictureKey = inherited.pictureKey;
            trk.metadata.hasCover = true;
          }
        }

        store.set('tracks', cachedTracks);
        if (repairedMissingCount > 0) {
          await db.bulkPut('tracks', cachedTracks);
        }
      }

      const cachedStats = await db.getAll('stats');
      if (cachedStats && cachedStats.length > 0) {
        const statsMap = new Map(cachedStats.map(s => [s.trackId, s]));
        store.set('stats', statsMap);
      }
    } catch (err) {
      console.warn('DB preload warning:', err);
    }

    // 4. Initialize MediaSession
    MediaSessionController.init();

    // 5. Restore Engine Playback & Queue State
    const savedVol = settings.get('volume', 1);
    engine.setVolume(savedVol);
    engine.setPureMode(settings.get('pureMode', true));
    store.set('shuffle', settings.get('shuffle', false));
    store.set('repeatMode', settings.get('repeatMode', 'none'));

    const savedQueue = settings.get('savedQueue', []);
    const savedQueueIdx = settings.get('savedQueueIndex', -1);
    if (Array.isArray(savedQueue) && savedQueue.length > 0) {
      store.set('queue', savedQueue);
      store.set('queueIndex', savedQueueIdx);
    }

    // 6. Initialize Keyboard Shortcuts & PiP Manager (UX-01, UX-02)
    shortcutManager.init();
    pipManager.init();

    // 7. Restore Night Mode Audio DSP & Schedule (UX-03)
    const savedNight = settings.get('nightMode');
    if (savedNight && savedNight.enabled && !settings.get('pureMode', true)) {
      engine.setNightMode(true, savedNight);
    }

    const checkNightSchedule = () => {
      const nm = settings.get('nightMode');
      if (nm && nm.scheduleEnabled && nm.scheduleStart && nm.scheduleEnd && !settings.get('pureMode', true)) {
        const now = new Date();
        const curMin = now.getHours() * 60 + now.getMinutes();
        const [sH, sM] = nm.scheduleStart.split(':').map(Number);
        const [eH, eM] = nm.scheduleEnd.split(':').map(Number);
        const sMin = sH * 60 + sM;
        const eMin = eH * 60 + eM;
        const shouldBeActive = sMin <= eMin
          ? (curMin >= sMin && curMin < eMin)
          : (curMin >= sMin || curMin < eMin);

        if (shouldBeActive !== !!engine.nightMode) {
          engine.setNightMode(shouldBeActive, nm);
          settings.set('nightMode.enabled', shouldBeActive);
        }
      }
    };
    checkNightSchedule();
    setInterval(checkNightSchedule, 60000);

    // 8. Navigate to initial/saved view
    const initialRoute = settings.get('lastRoute', 'home');
    this.switchViewDOM(initialRoute);
    router.navigate(initialRoute);

    // 9. Register Service Worker for PWA
    this.registerServiceWorker();
  }

  static setupNavigation() {
    // Nav Bar Tabs (Dock & Mobile Bottom Nav synchronized)
    document.querySelectorAll('.nav-item')?.forEach(tab => {
      // Prevent browser default mouse focus outline while preserving keyboard navigation
      tab.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });

      tab.addEventListener('click', () => {
        const viewKey = tab.getAttribute('data-view');
        if (!viewKey) return;
        tab.blur();
        document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
        document.querySelectorAll(`.nav-item[data-view="${viewKey}"]`).forEach(t => t.classList.add('active'));
        settings.set('lastRoute', viewKey);
        this.switchViewDOM(viewKey);
        router.navigate(viewKey);
      });
    });

    // Dock Collapse / Expand Toggle
    const dock = document.getElementById('glassDock');
    document.getElementById('btnToggleDock')?.addEventListener('click', () => {
      dock?.classList.toggle('collapsed');
    });

    // Contextual Right Drawer Controls
    const drawer = document.getElementById('contextDrawer');

    const renderDrawerNowPlaying = () => {
      const container = document.getElementById('drawerNowPlayingContent');
      if (!container) return;
      const track = store.get('currentTrack');
      if (!track) {
        container.innerHTML = '<div style="text-align:center; padding:32px 16px; color:var(--text-dim); font-size:0.85rem;">Belum ada lagu yang diputar</div>';
        return;
      }
      const title = track.overrides?.title || track.metadata?.title || track.name;
      const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown Artist';
      const album = track.overrides?.album || track.metadata?.album || '';
      const tierInfo = classifyQualityTier(track.streamInfo, track.format);

      container.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; text-align:center; gap:12px;">
          <div style="width:160px; height:160px; border-radius:var(--radius-md); overflow:hidden; background:var(--glass-bg-elevated); border:1px solid var(--glass-border-specular); box-shadow:var(--shadow-md); display:flex; align-items:center; justify-content:center;">
            ${track.metadata?.pictureUrl ? `<img src="${track.metadata.pictureUrl}" alt="Cover" style="width:100%; height:100%; object-fit:cover;" />` : '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg>'}
          </div>
          <div>
            <span class="badge ${tierInfo.badgeClass}" style="margin-bottom:6px;">${tierInfo.details}</span>
            <h4 style="font-size:1.05rem; margin-top:4px;">${escapeHtml(title)}</h4>
            <p style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(artist)} &bull; ${escapeHtml(album)}</p>
          </div>
          <div style="width:100%; background:var(--glass-bg-card); border:1px solid var(--glass-border-subtle); border-radius:var(--radius-sm); padding:10px 12px; font-size:0.75rem; text-align:left;" class="mono">
            <div style="color:var(--text-dim); margin-bottom:4px; text-transform:uppercase;">Informasi Sinyal File</div>
            <div>Format: ${track.streamInfo?.codec || track.format.toUpperCase()}</div>
            <div>Bit Depth: ${track.streamInfo?.bitsPerSample || 16}-bit</div>
            <div>Sample Rate: ${((track.streamInfo?.sampleRate || 44100)/1000).toFixed(1)} kHz</div>
            <div>Saluran: ${track.streamInfo?.channels || 2} Ch</div>
          </div>
        </div>
      `;
    };

    const renderDrawerQueue = () => {
      const container = document.getElementById('drawerQueueList');
      if (!container) return;
      const queue = queueManager.items || [];
      const currentIdx = queueManager.currentIndex;

      if (queue.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:32px 16px; color:var(--text-dim); font-size:0.85rem;">Antrean kosong</div>';
        return;
      }

      container.innerHTML = queue.map((trk, idx) => {
        const title = escapeHtml(trk.overrides?.title || trk.metadata?.title || trk.name);
        const artist = escapeHtml(trk.overrides?.artist || trk.metadata?.artist || 'Unknown');
        const tier = classifyQualityTier(trk.streamInfo, trk.format);
        const isCurrent = idx === currentIdx;

        return `
          <div class="queue-mini-item ${isCurrent ? 'active' : ''}" data-idx="${idx}" style="display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:var(--radius-sm); cursor:pointer; margin-bottom:4px; background:${isCurrent ? 'var(--glass-bg-elevated)' : 'transparent'}; border:${isCurrent ? '1px solid var(--glass-border-specular)' : '1px solid transparent'};">
            <div style="width:32px; height:32px; border-radius:var(--radius-xs); background:var(--glass-bg-card); display:flex; align-items:center; justify-content:center; flex-shrink:0; overflow:hidden;">
              ${trk.metadata?.pictureUrl ? `<img src="${trk.metadata.pictureUrl}" style="width:100%; height:100%; object-fit:cover;" alt="Cover" />` : `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 16.5C9.51 16.5 7.5 14.49 7.5 12C7.5 9.51 9.51 7.5 12 7.5C14.49 7.5 16.5 9.51 16.5 12C16.5 14.49 14.49 16.5 12 16.5ZM12 11C11.45 11 11 11.45 11 12C11 12.55 11.45 13 12 13C12.55 13 13 12.55 13 12C13 11.45 12.55 11 12 11Z"/></svg>`}
            </div>
            <div style="min-width:0; flex:1;">
              <div class="truncate" style="font-size:0.82rem; font-weight:${isCurrent ? '600' : '400'}; color:${isCurrent ? 'var(--accent)' : 'var(--text-main)'};">${title}</div>
              <div class="truncate" style="font-size:0.72rem; color:var(--text-muted);">${artist}</div>
            </div>
            <span class="badge ${tier.badgeClass}" title="${escapeHtml(tier.label)}" aria-label="${escapeHtml(tier.label)}" style="font-size:0.6rem; padding:1px 5px; flex-shrink:0;">${tier.iconSvg || escapeHtml(tier.label)}</span>
            <button class="btn btn-icon btn-drawer-remove-queue" data-remove-idx="${idx}" title="${t('actions.removeFromQueue')}" aria-label="${t('actions.removeFromQueue')}" style="color:var(--text-dim); padding:0; width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;">${getIconSvg('close', { size: 14 })}</button>
          </div>
        `;
      }).join('');

      container.querySelectorAll('.queue-mini-item').forEach(el => {
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        const trk = queue[idx];
        if (trk) {
          contextMenu.bind(el, { track: trk, index: idx });
        }

        el.addEventListener('click', (e) => {
          if (e.target.closest('.btn-drawer-remove-queue')) return;
          if (!isNaN(idx)) queueManager.playAt(idx);
        });
      });

      container.querySelectorAll('.btn-drawer-remove-queue').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.getAttribute('data-remove-idx'), 10);
          if (!isNaN(idx)) {
            queueManager.remove(idx);
            renderDrawerQueue();
          }
        });
      });

      // Scroll active item into view
      const activeEl = container.querySelector('.queue-mini-item.active');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    };

    const openDrawerTab = (tabName) => {
      if (!drawer) return;
      drawer.classList.add('active');
      document.querySelectorAll('.drawer-tab-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-drawertab') === tabName);
      });

      const paneNowPlaying = document.getElementById('drawerPaneNowPlaying');
      const paneLyrics = document.getElementById('drawerPaneLyrics');
      const paneQueue = document.getElementById('drawerPaneQueue');

      if (paneNowPlaying) paneNowPlaying.style.display = tabName === 'nowPlaying' ? 'block' : 'none';
      if (paneLyrics) paneLyrics.style.display = tabName === 'lyrics' ? 'block' : 'none';
      if (paneQueue) paneQueue.style.display = tabName === 'queue' ? 'block' : 'none';

      if (tabName === 'nowPlaying') renderDrawerNowPlaying();
      if (tabName === 'queue') renderDrawerQueue();
      if (tabName === 'lyrics') {
        lyricsManager.onShown?.();
        lyricsManager.centerActiveLine?.(true);
      }
    };

    store.subscribe('currentTrack', () => {
      if (drawer?.classList.contains('active')) {
        const activeTab = document.querySelector('.drawer-tab-btn.active')?.getAttribute('data-drawertab');
        if (activeTab === 'nowPlaying') renderDrawerNowPlaying();
      }
    });

    store.subscribe('queue', () => {
      if (drawer?.classList.contains('active')) {
        const activeTab = document.querySelector('.drawer-tab-btn.active')?.getAttribute('data-drawertab');
        if (activeTab === 'queue') renderDrawerQueue();
      }
    });

    store.subscribe('queueIndex', () => {
      if (drawer?.classList.contains('active')) {
        const activeTab = document.querySelector('.drawer-tab-btn.active')?.getAttribute('data-drawertab');
        if (activeTab === 'queue') renderDrawerQueue();
      }
    });

    document.getElementById('btnCloseDrawer')?.addEventListener('click', () => {
      drawer?.classList.remove('active');
    });

    document.getElementById('btnToggleLyricsDrawer')?.addEventListener('click', () => {
      const isDrawerOpen = drawer?.classList.contains('active');
      const activeTab = document.querySelector('.drawer-tab-btn.active')?.getAttribute('data-drawertab');
      if (isDrawerOpen && activeTab === 'lyrics') {
        drawer.classList.remove('active');
      } else {
        openDrawerTab('lyrics');
      }
    });

    document.getElementById('btnToggleQueueDrawer')?.addEventListener('click', () => {
      const isDrawerOpen = drawer?.classList.contains('active');
      const activeTab = document.querySelector('.drawer-tab-btn.active')?.getAttribute('data-drawertab');
      if (isDrawerOpen && activeTab === 'queue') {
        drawer.classList.remove('active');
      } else {
        openDrawerTab('queue');
      }
    });

    document.querySelectorAll('.drawer-tab-btn')?.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.getAttribute('data-drawertab');
        openDrawerTab(tabName);
      });
    });

    events.on('drawer:open', (tabName) => {
      openDrawerTab(tabName || 'queue');
    });

    // Drawer Left Resize Handle
    const resizeHandle = document.getElementById('drawerResizeHandle');
    if (resizeHandle && drawer) {
      let isResizing = false;
      resizeHandle.addEventListener('pointerdown', (e) => {
        isResizing = true;
        resizeHandle.setPointerCapture(e.pointerId);
      });
      window.addEventListener('pointermove', (e) => {
        if (!isResizing) return;
        const newWidth = Math.min(Math.max(window.innerWidth - e.clientX - 14, 300), 600);
        drawer.style.width = `${newWidth}px`;
      });
      window.addEventListener('pointerup', () => {
        isResizing = false;
      });
    }

    // Dock Quick Playlists Listing
    const renderDockPlaylists = (playlists = []) => {
      const listEl = document.getElementById('dockPlaylistList');
      if (!listEl) return;
      const filter = (document.getElementById('dockPlaylistSearch')?.value || '').toLowerCase().trim();
      const filtered = playlists.filter(p => !filter || p.name.toLowerCase().includes(filter));
      listEl.innerHTML = filtered.map(p => `
        <div class="dock-playlist-item" data-id="${p.id}" title="${p.name}">
          ${p.name}
        </div>
      `).join('');

      listEl.querySelectorAll('.dock-playlist-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.getAttribute('data-id');
          document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
          this.switchViewDOM('playlists');
          router.navigate('playlists', { playlistId: id });
        });
      });
    };

    store.subscribe('playlists', (pl) => renderDockPlaylists(pl || []));
    document.getElementById('dockPlaylistSearch')?.addEventListener('input', () => {
      renderDockPlaylists(store.get('playlists') || []);
    });

    // Brand Home Button
    document.getElementById('btnBrandHome')?.addEventListener('click', () => {
      document.querySelector('.nav-item[data-view="home"]')?.click();
    });

    // Top Quick Search Button
    document.getElementById('btnTopQuickSearch')?.addEventListener('click', () => {
      router.navigate('search');
      searchView.focusInput();
    });

    // Import Folder Header Button (Fallback & empty states)
    const btnImport = document.getElementById('btnImportFolder');
    const btnImportEmpty = document.getElementById('btnImportFolderEmpty');
    const fallbackInput = document.getElementById('fallbackFileInput');

    const handleImport = () => {
      folderManager.triggerFolderImport(fallbackInput);
    };

    btnImport?.addEventListener('click', handleImport);
    btnImportEmpty?.addEventListener('click', handleImport);

    fallbackInput?.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        toast.info(t('toasts.importProgress', { count: e.target.files.length }));
        try {
          const results = await scanner.scanFileList(e.target.files);
          const totalBytes = (results || []).reduce((acc, t) => acc + (t.size || 0), 0);
          const sizeStr = formatTotalFolderSize(totalBytes);
          toast.success(t('toasts.importSuccess', { count: (results || []).length, size: sizeStr }));
        } catch (err) {
          console.error('File list scan error:', err);
          toast.error(t('toasts.importError', { message: (err?.message || 'Format tidak terbaca') }));
        }
        e.target.value = '';
      }
    });

    // Rescan button
    document.getElementById('btnRescan')?.addEventListener('click', async () => {
      const folders = store.get('folders') || [];
      if (folders.length > 0 && folders[0].handle) {
        toast.info(t('toasts.scanningFolder'));
        await scanner.scanDirectoryHandle(folders[0].handle);
        toast.success(t('toasts.libraryRescanned'));
      }
    });
  }

  static switchViewDOM(viewKey) {
    document.querySelectorAll('.view-pane').forEach(p => p.classList.remove('active'));
    const paneMap = {
      home: 'viewHome',
      collection: 'viewCollection',
      library: 'viewHome',
      search: 'viewSearch',
      albums: 'viewCollection',
      artists: 'viewCollection',
      playlists: 'viewPlaylists',
      albumDetail: 'viewAlbumDetail',
      artistDetail: 'viewArtistDetail',
      queue: 'viewQueue',
      analysis: 'viewSettings',
      settings: 'viewSettings',
      health: 'viewHealth',
      nowPlaying: 'viewNowPlaying'
    };
    const activeId = paneMap[viewKey] || 'viewHome';
    document.getElementById(activeId)?.classList.add('active');
  }

  static setupGlobalEvents() {
    // Window Drag & Drop
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        const files = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
            if (entry) {
              await (async function traverse(ent, path = '') {
                if (ent.isFile) {
                  const f = await new Promise(res => ent.file(res));
                  files.push(f);
                } else if (ent.isDirectory) {
                  const reader = ent.createReader();
                  const entries = await new Promise(res => reader.readEntries(res));
                  for (const sub of entries) {
                    await traverse(sub, path + ent.name + '/');
                  }
                }
              })(entry);
            } else {
              const f = item.getAsFile();
              if (f) files.push(f);
            }
          }
        }
        if (files.length > 0) {
          toast.info(t('toasts.dragDropProgress', { count: files.length }));
          await scanner.scanFileList(files);
          toast.success(t('toasts.dragDropComplete'));
        }
      }
    });

    // Priority dismissal on Escape (Full Player -> Drawer -> Context Menu)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const fp = document.getElementById('fullPlayerModal');
        if (fp && fp.classList.contains('active')) {
          playerBar.closeFullPlayer();
          return;
        }
        const drawer = document.getElementById('contextDrawer');
        if (drawer && drawer.classList.contains('active')) {
          drawer.classList.remove('active');
          return;
        }
        const ctxMenu = document.getElementById('contextMenu');
        if (ctxMenu && ctxMenu.style.display !== 'none') {
          ctxMenu.style.display = 'none';
          return;
        }
      }
    });

    // Global delegation for clickable artist & album names across all views
    document.addEventListener('click', (e) => {
      const artistEl = e.target.closest('.clickable-artist');
      if (artistEl) {
        e.stopPropagation();
        const artistName = artistEl.getAttribute('data-artist') || artistEl.innerText.trim();
        if (artistName && artistName !== 'Unknown Artist' && artistName !== 'Artis Tidak Diketahui') {
          const fp = document.getElementById('fullPlayerModal');
          if (fp && fp.style.display !== 'none') fp.style.display = 'none';
          if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
          const ctxMenu = document.getElementById('contextMenu');
          if (ctxMenu) ctxMenu.style.display = 'none';

          document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
          Application.switchViewDOM('artistDetail');
          router.navigate('artistDetail', { artist: artistName });
          return;
        }
      }

      const albumEl = e.target.closest('.clickable-album');
      if (albumEl) {
        e.stopPropagation();
        const albumName = albumEl.getAttribute('data-album') || albumEl.innerText.trim();
        if (albumName && albumName !== 'Tanpa Album' && albumName !== 'Album Tidak Diketahui') {
          const fp = document.getElementById('fullPlayerModal');
          if (fp && fp.style.display !== 'none') fp.style.display = 'none';
          if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
          const ctxMenu = document.getElementById('contextMenu');
          if (ctxMenu) ctxMenu.style.display = 'none';

          document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
          Application.switchViewDOM('albumDetail');
          router.navigate('albumDetail', { album: albumName });
          return;
        }
      }
    });

    // PWA Offline / Online Network Status
    window.addEventListener('online', () => {
      toast.info(t('toasts.online'));
    });
    window.addEventListener('offline', () => {
      toast.info(t('toasts.offline'));
    });

    // PWA Desktop Installation Prompt Hook
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.deferredPwaPrompt = e;
      events.emit('pwa:installable');
    });

    window.addEventListener('appinstalled', () => {
      window.deferredPwaPrompt = null;
      events.emit('pwa:installed');
      toast.success(t('toasts.appInstalled'));
    });

    // Reapply i18n DOM bindings whenever language changes
    events.on('i18n:changed', () => {
      i18n.applyToDOM();
    });
  }

  static registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js?v=1.0.2', { updateViaCache: 'none' })
          .then((reg) => {
            reg.update().catch(() => {});
            reg.addEventListener('updatefound', () => {
              const installingWorker = reg.installing;
              if (installingWorker) {
                installingWorker.addEventListener('statechange', () => {
                  if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('New Audiophile update installed, activating...');
                  }
                });
              }
            });
          })
          .catch(err => {
            console.warn('SW register notice:', err);
          });

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });
      });
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  Application.start();
});
