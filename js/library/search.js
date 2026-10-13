/**
 * search.js - Instant multi-token search, filtering, and sorting
 */

import { getTierRank } from '../quality/tiers.js';

export class SearchEngine {
  /**
   * Filter and sort tracks according to query, filter chips, and sort criteria
   * @param {Array<Object>} tracks 
   * @param {Object} options 
   * @param {string} [options.query] 
   * @param {string} [options.tierFilter] 
   * @param {boolean} [options.onlyHires] 
   * @param {string} [options.sortBy] 
   * @param {Map} [options.statsMap] 
   * @returns {Array<Object>}
   */
  static filterAndSort(tracks = [], options = {}) {
    const {
      query = '',
      tierFilter = 'all',
      onlyHires = false,
      sortBy = 'title_asc',
      statsMap = new Map()
    } = options;

    let result = [...tracks];

    // 1. Only Hi-Res / Lossless filter
    if (onlyHires) {
      result = result.filter(t => t.tier === 'HI-RES' || t.tier === 'DSD' || t.tier === 'STUDIO' || t.tier === 'LOSSLESS');
    }

    // 2. Specific Tier Filter
    if (tierFilter === 'hires') result = result.filter(t => t.tier === 'HI-RES');
    else if (tierFilter === 'studio') result = result.filter(t => t.tier === 'STUDIO');
    else if (tierFilter === 'lossless') result = result.filter(t => t.tier === 'LOSSLESS');
    else if (tierFilter === 'dsd') result = result.filter(t => t.tier === 'DSD');
    else if (tierFilter === 'lossy') result = result.filter(t => t.tier.startsWith('LOSSY'));
    else if (tierFilter === 'verified') result = result.filter(t => t.analysis?.status === 'verified_hires');
    else if (tierFilter === 'suspect') {
      result = result.filter(t => t.analysis?.status === 'suspected_upsample' || t.analysis?.status === 'suspected_transcode');
    } else if (tierFilter === 'favorite') {
      result = result.filter(t => {
        const stat = statsMap.get(t.id);
        return stat?.favorite;
      });
    }

    // 3. Multi-token Search across multiple fields
    if (query && query.trim()) {
      const tokens = query.toLowerCase().trim().split(/\s+/);
      result = result.filter(t => {
        const title = (t.overrides?.title || t.metadata?.title || t.name).toLowerCase();
        const artist = (t.overrides?.artist || t.metadata?.artist || '').toLowerCase();
        const album = (t.overrides?.album || t.metadata?.album || '').toLowerCase();
        const genre = (t.metadata?.genre || '').toLowerCase();
        const tier = (t.tier || '').toLowerCase();
        const format = (t.format || '').toLowerCase();
        const lyrics = (t.metadata?.lyrics || '').toLowerCase();
        const fullHaystack = `${title} ${artist} ${album} ${genre} ${tier} ${format} ${lyrics}`;

        return tokens.every(token => fullHaystack.includes(token));
      });
    }

    // 4. Sorting
    result.sort((a, b) => {
      const titleA = (a.overrides?.title || a.metadata?.title || a.name).toLowerCase();
      const titleB = (b.overrides?.title || b.metadata?.title || b.name).toLowerCase();
      const artistA = (a.overrides?.artist || a.metadata?.artist || '').toLowerCase();
      const artistB = (b.overrides?.artist || b.metadata?.artist || '').toLowerCase();

      switch (sortBy) {
        case 'artist_asc':
          return artistA.localeCompare(artistB) || titleA.localeCompare(titleB);
        case 'album_asc':
          return (a.metadata?.album || '').localeCompare(b.metadata?.album || '') || titleA.localeCompare(titleB);
        case 'samplerate_desc':
          return (b.streamInfo?.sampleRate || 0) - (a.streamInfo?.sampleRate || 0);
        case 'bitdepth_desc':
          return (b.streamInfo?.bitsPerSample || 0) - (a.streamInfo?.bitsPerSample || 0);
        case 'tier_desc': {
          const rankA = getTierRank(a.tier);
          const rankB = getTierRank(b.tier);
          return rankB - rankA;
        }
        case 'added_desc':
          return (b.addedAt || 0) - (a.addedAt || 0);
        case 'playcount_desc': {
          const countA = statsMap.get(a.id)?.playCount || 0;
          const countB = statsMap.get(b.id)?.playCount || 0;
          return countB - countA;
        }
        case 'title_asc':
        default:
          return titleA.localeCompare(titleB);
      }
    });

    return result;
  }
}
