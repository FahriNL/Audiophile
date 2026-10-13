/**
 * playlistService.js - Playlist CRUD, duplicate prevention, reordering, and summary calculations
 */

import { db } from '../db/db.js';
import { store } from '../core/store.js';
import { events } from '../core/events.js';

class PlaylistService {
  constructor() {
    this.undoHistory = [];
  }

  /**
   * Load all playlists from IndexedDB
   * @returns {Promise<Array<Object>>}
   */
  async loadPlaylists() {
    try {
      const lists = await db.getAll('playlists');
      store.set('playlists', lists);
      return lists;
    } catch (err) {
      console.error('Failed to load playlists:', err);
      return [];
    }
  }

  /**
   * Create a new playlist
   * @param {string} name 
   * @param {string} [description] 
   * @param {Array<string>} [initialTrackIds] 
   * @param {boolean} [isSmart] 
   * @param {Object} [rules] 
   * @returns {Promise<Object>}
   */
  async createPlaylist(name, description = '', initialTrackIds = [], isSmart = false, rules = null) {
    const newPlaylist = {
      id: 'pl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: name.trim(),
      description: description.trim(),
      trackIds: initialTrackIds,
      isSmart,
      rules,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await db.put('playlists', newPlaylist);
    const existing = store.get('playlists') || [];
    const updated = [...existing, newPlaylist];
    store.set('playlists', updated);

    events.emit('playlist:created', newPlaylist);
    return newPlaylist;
  }

  /**
   * Duplicate an existing playlist
   * @param {string} playlistId 
   * @returns {Promise<Object|null>}
   */
  async duplicatePlaylist(playlistId) {
    const lists = store.get('playlists') || [];
    const source = lists.find(p => p.id === playlistId);
    if (!source) return null;

    return this.createPlaylist(
      `${source.name} (Salinan)`,
      source.description,
      [...source.trackIds],
      source.isSmart,
      source.rules ? JSON.parse(JSON.stringify(source.rules)) : null
    );
  }

  /**
   * Rename a playlist
   * @param {string} playlistId 
   * @param {string} newName 
   * @param {string} [newDesc] 
   */
  async renamePlaylist(playlistId, newName, newDesc) {
    const lists = store.get('playlists') || [];
    const target = lists.find(p => p.id === playlistId);
    if (!target) return;

    target.name = newName.trim();
    if (newDesc !== undefined) target.description = newDesc.trim();
    target.updatedAt = Date.now();

    await db.put('playlists', target);
    store.set('playlists', [...lists]);
    events.emit('playlist:updated', target);
  }

  /**
   * Delete a playlist with undo registration
   * @param {string} playlistId 
   * @returns {Promise<Object|null>}
   */
  async deletePlaylist(playlistId) {
    const lists = store.get('playlists') || [];
    const idx = lists.findIndex(p => p.id === playlistId);
    if (idx === -1) return null;

    const removed = lists[idx];
    await db.delete('playlists', playlistId);

    lists.splice(idx, 1);
    store.set('playlists', [...lists]);

    // Push to undo stack
    const undoAction = async () => {
      await db.put('playlists', removed);
      const cur = store.get('playlists') || [];
      store.set('playlists', [...cur, removed]);
      events.emit('playlist:created', removed);
    };

    events.emit('playlist:deleted', { playlist: removed, undo: undoAction });
    return removed;
  }

  /**
   * Check which trackIds already exist in the target playlist
   * @param {string} playlistId 
   * @param {Array<string>} trackIds 
   * @returns {{ duplicates: Array<string>, unique: Array<string> }}
   */
  checkDuplicates(playlistId, trackIds) {
    const lists = store.get('playlists') || [];
    const target = lists.find(p => p.id === playlistId);
    if (!target) return { duplicates: [], unique: trackIds };

    const existingSet = new Set(target.trackIds);
    const duplicates = [];
    const unique = [];

    for (const id of trackIds) {
      if (existingSet.has(id)) duplicates.push(id);
      else unique.push(id);
    }

    return { duplicates, unique };
  }

  /**
   * Add track IDs to a playlist
   * @param {string} playlistId 
   * @param {Array<string>} trackIds 
   */
  async addTracksToPlaylist(playlistId, trackIds) {
    const lists = store.get('playlists') || [];
    const target = lists.find(p => p.id === playlistId);
    if (!target) return;

    target.trackIds.push(...trackIds);
    target.updatedAt = Date.now();

    await db.put('playlists', target);
    store.set('playlists', lists.map(p => ({ ...p, trackIds: [...p.trackIds] })));
    events.emit('playlist:tracksAdded', { playlistId, count: trackIds.length });
  }

  /**
   * Remove a track at specific index from a playlist with undo capability
   * @param {string} playlistId 
   * @param {number} index 
   */
  async removeTrackFromPlaylist(playlistId, index) {
    const lists = store.get('playlists') || [];
    const target = lists.find(p => p.id === playlistId);
    if (!target || index < 0 || index >= target.trackIds.length) return;

    const removedId = target.trackIds[index];
    target.trackIds.splice(index, 1);
    target.updatedAt = Date.now();

    await db.put('playlists', target);
    store.set('playlists', [...lists]);

    const undoAction = async () => {
      target.trackIds.splice(index, 0, removedId);
      target.updatedAt = Date.now();
      await db.put('playlists', target);
      store.set('playlists', [...lists]);
      events.emit('playlist:updated', target);
    };

    events.emit('playlist:trackRemoved', { playlistId, trackId: removedId, undo: undoAction });
  }

  /**
   * Move track position inside playlist (for Drag-and-drop or Up/Down buttons)
   * @param {string} playlistId 
   * @param {number} fromIndex 
   * @param {number} toIndex 
   */
  async moveTrack(playlistId, fromIndex, toIndex) {
    const lists = store.get('playlists') || [];
    const target = lists.find(p => p.id === playlistId);
    if (!target) return;
    if (fromIndex < 0 || fromIndex >= target.trackIds.length) return;
    if (toIndex < 0 || toIndex >= target.trackIds.length) return;

    const [item] = target.trackIds.splice(fromIndex, 1);
    target.trackIds.splice(toIndex, 0, item);
    target.updatedAt = Date.now();

    await db.put('playlists', target);
    store.set('playlists', [...lists]);
    events.emit('playlist:updated', target);
  }

  /**
   * Sort tracks permanently inside playlist by field
   * @param {string} playlistId 
   * @param {'title'|'artist'|'tier'|'added'} field 
   * @param {Array<Object>} allTracks 
   */
  async sortPlaylistPermanently(playlistId, field, allTracks) {
    const lists = store.get('playlists') || [];
    const target = lists.find(p => p.id === playlistId);
    if (!target) return;

    const trackMap = new Map(allTracks.map(t => [t.id, t]));
    const listTracks = target.trackIds.map(id => trackMap.get(id)).filter(Boolean);

    listTracks.sort((a, b) => {
      if (field === 'title') {
        return (a.overrides?.title || a.metadata?.title || '').localeCompare(b.overrides?.title || b.metadata?.title || '');
      }
      if (field === 'artist') {
        return (a.overrides?.artist || a.metadata?.artist || '').localeCompare(b.overrides?.artist || b.metadata?.artist || '');
      }
      if (field === 'tier') {
        return (b.tier || '').localeCompare(a.tier || '');
      }
      if (field === 'added') {
        return (b.addedAt || 0) - (a.addedAt || 0);
      }
      return 0;
    });

    target.trackIds = listTracks.map(t => t.id);
    target.updatedAt = Date.now();

    await db.put('playlists', target);
    store.set('playlists', [...lists]);
    events.emit('playlist:updated', target);
  }

  /**
   * Calculate summary statistics for a playlist
   * @param {Array<string>} trackIds 
   * @param {Array<Object>} allTracks 
   * @returns {{ totalDuration: number, count: number, qualitySummary: string }}
   */
  calculateSummary(trackIds = [], allTracks = []) {
    const trackMap = new Map(allTracks.map(t => [t.id, t]));
    let totalDuration = 0;
    let hiresCount = 0;
    let studioCount = 0;
    let cdCount = 0;
    let lossyCount = 0;

    for (const id of trackIds) {
      const tr = trackMap.get(id);
      if (tr) {
        totalDuration += (tr.streamInfo?.duration || 0);
        if (tr.tier === 'HI-RES' || tr.tier === 'DSD') hiresCount++;
        else if (tr.tier === 'STUDIO') studioCount++;
        else if (tr.tier === 'LOSSLESS') cdCount++;
        else lossyCount++;
      }
    }

    const qualityParts = [];
    if (hiresCount > 0) qualityParts.push(`${hiresCount} Hi-Res`);
    if (studioCount > 0) qualityParts.push(`${studioCount} Studio`);
    if (cdCount > 0) qualityParts.push(`${cdCount} Lossless`);
    if (lossyCount > 0) qualityParts.push(`${lossyCount} Lossy`);

    return {
      count: trackIds.length,
      totalDuration,
      qualitySummary: qualityParts.join(', ') || '0 Lagu'
    };
  }

  /**
   * Extract up to 4 unique cover artwork URLs from tracks in a playlist,
   * skipping duplicate covers from the same album.
   * @param {Object} playlist 
   * @param {Array<Object>} allTracks 
   * @param {number} [max=4] 
   * @returns {Array<string>}
   */
  getCollageCovers(playlist, allTracks, max = 4) {
    if (!playlist || !playlist.trackIds || playlist.trackIds.length === 0) return [];
    const trackMap = new Map((allTracks || []).map(t => [t.id, t]));
    const covers = [];
    const seenUrls = new Set();
    const seenAlbums = new Set();

    for (const id of playlist.trackIds) {
      const trk = trackMap.get(id);
      if (!trk) continue;
      const pic = trk.overrides?.pictureUrl !== undefined ? trk.overrides.pictureUrl : trk.metadata?.pictureUrl;
      const album = (trk.overrides?.album || trk.metadata?.album || '').toLowerCase().trim();

      if (pic && typeof pic === 'string' && !seenUrls.has(pic)) {
        if (album && album !== 'tanpa album' && album !== 'album tidak diketahui') {
          if (seenAlbums.has(album)) {
            continue;
          }
          seenAlbums.add(album);
        }
        seenUrls.add(pic);
        covers.push(pic);
        if (covers.length >= max) break;
      }
    }
    return covers;
  }

  /**
   * Render playlist thumbnail HTML (dynamic 2x2 collage, single art, or fallback SVG)
   * @param {Object} playlist 
   * @param {Array<Object>} allTracks 
   * @returns {string}
   */
  renderPlaylistThumbnail(playlist, allTracks) {
    const covers = this.getCollageCovers(playlist, allTracks, 4);

    if (covers.length === 0) {
      return `
        <div class="playlist-thumb-fallback">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
          </svg>
        </div>
      `;
    }

    if (covers.length === 1) {
      return `<img src="${covers[0]}" alt="Playlist Cover" class="playlist-thumb-single" loading="lazy" />`;
    }

    const c1 = covers[0];
    const c2 = covers[1];
    const c3 = covers[2] || covers[0];
    const c4 = covers[3] || covers[1];

    return `
      <div class="playlist-thumb-collage">
        <img src="${c1}" alt="Part 1" loading="lazy" />
        <img src="${c2}" alt="Part 2" loading="lazy" />
        <img src="${c3}" alt="Part 3" loading="lazy" />
        <img src="${c4}" alt="Part 4" loading="lazy" />
      </div>
    `;
  }
}

export const playlistService = new PlaylistService();
