/**
 * Audiophile Service Worker
 * Caches app shell assets for offline standalone PWA capability.
 */
const CACHE_NAME = 'audiophile-shell-v16';
const APP_SHELL = [
  './',
  './index.html',
  './fluid-kit.js',
  './manifest.json',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './css/tokens.css',
  './css/motion.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/themes.css',
  './js/main.js',
  './js/core/version.js',
  './js/core/network.js',
  './js/core/diagnostics.js',
  './js/core/selfTest.js',
  './js/core/settings.js',
  './js/core/perf.js',
  './js/core/events.js',
  './js/core/store.js',
  './js/core/router.js',
  './js/core/utils.js',
  './js/core/i18n.js',
  './js/ui/ambient.js',
  './js/ui/lyrics.js',
  './js/ui/motion/spring.js',
  './js/ui/motion/flip.js',
  './js/ui/motion/viewTransition.js',
  './js/ui/motion/gestures.js',
  './js/i18n/id.js',
  './js/i18n/en.js',
  './js/i18n/settingsLocale.js',
  './js/db/schema.js',
  './js/db/db.js',
  './js/library/covers.js',
  './js/library/artistMeta.js',
  './js/library/folders.js',
  './js/library/metadata.js',
  './js/library/scanner.js',
  './js/library/dedupe.js',
  './js/library/search.js',
  './js/quality/tiers.js',
  './js/quality/loudnessMath.js',
  './js/quality/eqMath.js',
  './js/quality/autoEqParser.js',
  './js/quality/analyzer.js',
  './js/workers/analyze.worker.js',
  './js/player/engine.js',
  './js/player/crossfade.js',
  './js/player/crossfeed.js',
  './js/player/transitions.js',
  './js/player/queue.js',
  './js/player/mediaSession.js',
  './js/player/sleepTimer.js',
  './js/playlists/playlistService.js',
  './js/playlists/smartRules.js',
  './js/playlists/m3u.js',
  './js/backup/exportImport.js',
  './js/ui/components/toast.js',
  './js/ui/components/dialog.js',
  './js/ui/components/contextMenu.js',
  './js/ui/components/selectionBar.js',
  './js/ui/components/collectionPage.js',
  './js/ui/components/trackRow.js',
  './js/ui/components/playerBar.js',
  './js/ui/components/quickSearch.js',
  './js/ui/components/metadataEditor.js',
  './js/ui/components/collectionEditor.js',
  './js/ui/components/abCompareModal.js',
  './js/ui/views/homeView.js',
  './js/ui/views/collectionView.js',
  './js/ui/views/libraryView.js',
  './js/ui/views/albumsView.js',
  './js/ui/views/albumDetailView.js',
  './js/ui/views/artistsView.js',
  './js/ui/views/artistDetailView.js',
  './js/ui/views/playlistsView.js',
  './js/ui/views/queueView.js',
  './js/ui/views/analysisView.js',
  './js/ui/views/searchView.js',
  './js/ui/views/healthView.js',
  './js/ui/views/settingsView.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn('Service worker addAll warning (will cache on fetch):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle HTTP/HTTPS GET requests
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Skip blob URLs or chrome-extension URLs
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached and update in background (stale-while-revalidate)
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.url.startsWith(self.location.origin)) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      });
    }).catch(() => {
      // Fallback to cached index.html for navigation
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});
