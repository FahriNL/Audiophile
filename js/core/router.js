/**
 * router.js - Client-side view router
 */

import { store } from './store.js';
import { events } from './events.js';

class Router {
  constructor() {
    this.routes = new Map();
    this.currentRoute = 'library';
  }

  /**
   * Register a view handler for a route key
   * @param {string} route 
   * @param {Object} viewInstance (must implement render() or activate())
   */
  register(route, viewInstance) {
    this.routes.set(route, viewInstance);
  }

  /**
   * Navigate to a route
   * @param {string} route 
   * @param {Object} [params] 
   */
  navigate(route, params = {}) {
    if (!this.routes.has(route)) {
      console.warn(`Route "${route}" not found. Falling back to "home".`);
      route = 'home';
    }

    const prevRoute = this.currentRoute;
    this.previousRoute = prevRoute;
    this.currentRoute = route;

    // Switch DOM panes with View Transition support
    const updateDOM = () => {
      if (typeof document !== 'undefined') {
        document.querySelectorAll('.view-pane')?.forEach(p => p.classList.remove('active'));
        const paneMap = {
          home: 'viewHome',
          collection: 'viewCollection',
          library: 'viewHome',
          search: 'viewSearch',
          albums: 'viewCollection',
          albumDetail: 'viewAlbumDetail',
          artists: 'viewCollection',
          artistDetail: 'viewArtistDetail',
          playlists: 'viewPlaylists',
          queue: 'viewQueue',
          analysis: 'viewSettings',
          settings: 'viewSettings',
          nowPlaying: 'viewNowPlaying',
          health: 'viewHealth'
        };
        const activeId = paneMap[route] || 'viewHome';
        document.getElementById(activeId)?.classList.add('active');

        // Toggle route-now-playing on body for mobile layout orchestration
        document.body?.classList.toggle('route-now-playing', route === 'nowPlaying');

        // Update active nav item
        document.querySelectorAll('.nav-item')?.forEach(t => {
          const vKey = t.getAttribute('data-view');
          const isActive = vKey === route ||
            (vKey === 'home' && (route === 'home' || route === 'library')) ||
            (vKey === 'search' && route === 'search') ||
            (vKey === 'health' && route === 'health') ||
            (vKey === 'collection' && (route === 'collection' || route === 'albums' || route === 'artists' || route === 'playlists' || route === 'albumDetail' || route === 'artistDetail')) ||
            (vKey === 'settings' && (route === 'settings' || route === 'analysis'));
          t.classList.toggle('active', isActive);
        });
      }
    };

    // Synchronously synchronize nav items and body route class before snapshot
    if (typeof document !== 'undefined') {
      document.body?.classList.toggle('route-now-playing', route === 'nowPlaying');
      document.querySelectorAll('.nav-item')?.forEach(t => {
        const vKey = t.getAttribute('data-view');
        const isActive = vKey === route ||
          (vKey === 'home' && (route === 'home' || route === 'library')) ||
          (vKey === 'search' && route === 'search') ||
          (vKey === 'health' && route === 'health') ||
          (vKey === 'collection' && (route === 'collection' || route === 'albums' || route === 'artists' || route === 'playlists' || route === 'albumDetail' || route === 'artistDetail')) ||
          (vKey === 'settings' && (route === 'settings' || route === 'analysis'));
        t.classList.toggle('active', isActive);
      });
    }

    if (typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
      try {
        document.startViewTransition(updateDOM);
      } catch {
        updateDOM();
      }
    } else {
      updateDOM();
    }

    // Update active view in Store
    store.set('currentView', route);

    // Call deactivate on previous if available
    const prevView = this.routes.get(prevRoute);
    if (prevView && typeof prevView.deactivate === 'function') {
      prevView.deactivate();
    }

    // Call activate/render on new view
    const nextView = this.routes.get(route);
    if (nextView && typeof nextView.activate === 'function') {
      nextView.activate(params);
    }

    events.emit('router:navigated', { from: prevRoute, to: route, params });
  }

  getCurrentRoute() {
    return this.currentRoute;
  }

  back() {
    this.navigate(this.previousRoute || 'home');
  }
}

export const router = new Router();
