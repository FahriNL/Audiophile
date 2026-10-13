/**
 * dedupe.js - Duplicate detection, grouping, and highest-quality version identification
 */

import { getTierRank } from '../quality/tiers.js';

export class DuplicateManager {
  /**
   * Group tracks that share identical normalized title and artist
   * @param {Array<Object>} tracks 
   * @returns {Map<string, Array<Object>>} Map of duplicate groups with > 1 track
   */
  static findDuplicates(tracks = []) {
    const groupMap = new Map();

    for (const track of tracks) {
      const title = String(track.overrides?.title || track.metadata?.title || track.name || '')
        .toLowerCase()
        .replace(/\.[^/.]+$/, '')
        .trim();
      const artist = String(track.overrides?.artist || track.metadata?.artist || '')
        .toLowerCase()
        .trim();

      const key = `${title}__${artist}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key).push(track);
    }

    // Filter only groups that have duplicates (length > 1)
    const duplicateGroups = new Map();
    for (const [key, group] of groupMap.entries()) {
      if (group.length > 1) {
        // Sort within group so highest quality tier comes first
        group.sort((a, b) => {
          const rankA = getTierRank(a.tier);
          const rankB = getTierRank(b.tier);
          if (rankB !== rankA) return rankB - rankA;
          // Tie-break by sample rate
          const srA = a.streamInfo?.sampleRate || 0;
          const srB = b.streamInfo?.sampleRate || 0;
          return srB - srA;
        });

        duplicateGroups.set(key, group);
      }
    }

    return duplicateGroups;
  }

  /**
   * Check if a track is the best quality version in its duplicate set
   * @param {Object} track 
   * @param {Map<string, Array<Object>>} duplicateGroups 
   * @returns {boolean}
   */
  static isBestVersion(track, duplicateGroups) {
    const title = String(track.overrides?.title || track.metadata?.title || track.name || '')
      .toLowerCase()
      .replace(/\.[^/.]+$/, '')
      .trim();
    const artist = String(track.overrides?.artist || track.metadata?.artist || '')
      .toLowerCase()
      .trim();
    const key = `${title}__${artist}`;

    if (!duplicateGroups.has(key)) return true;
    const group = duplicateGroups.get(key);
    return group[0].id === track.id;
  }

  /**
   * Compute normalized comparison key for a single track
   * @param {Object} track 
   * @returns {string}
   */
  static getTrackKey(track) {
    if (!track) return '';
    const title = String(track.overrides?.title || track.metadata?.title || track.name || '')
      .toLowerCase()
      .replace(/\.[^/.]+$/, '')
      .trim();
    const artist = String(track.overrides?.artist || track.metadata?.artist || '')
      .toLowerCase()
      .trim();
    return `${title}__${artist}`;
  }

  /**
   * Retrieve all duplicate versions for a given track from the track list
   * @param {Object} track 
   * @param {Array<Object>} allTracks 
   * @returns {Array<Object>} Array of sibling duplicate versions (length > 1 if duplicates exist)
   */
  static getDuplicatesForTrack(track, allTracks = []) {
    if (!track) return [];
    const key = this.getTrackKey(track);
    if (!key) return [track];

    const siblings = allTracks.filter(t => this.getTrackKey(t) === key);
    if (siblings.length <= 1) return siblings;

    // Sort by tier quality descending
    return siblings.sort((a, b) => {
      const rankA = getTierRank(a.tier);
      const rankB = getTierRank(b.tier);
      if (rankB !== rankA) return rankB - rankA;
      const srA = a.streamInfo?.sampleRate || 0;
      const srB = b.streamInfo?.sampleRate || 0;
      return srB - srA;
    });
  }
}
