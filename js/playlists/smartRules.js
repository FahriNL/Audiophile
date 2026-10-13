/**
 * smartRules.js - Evaluator for rule-based auto-updating Smart Playlists
 */

export class SmartPlaylistEvaluator {
  /**
   * Evaluate if a track matches a set of smart playlist rules
   * @param {Object} track 
   * @param {Object} rules 
   * @param {Map} statsMap Map<trackId, { playCount, favorite, rating, lastPlayed }>
   * @returns {boolean}
   */
  static matchesTrack(track, rules = {}, statsMap = new Map()) {
    const {
      matchMode = 'AND', // 'AND' | 'OR'
      conditions = []
    } = rules;

    if (!conditions || conditions.length === 0) return true;

    const stats = statsMap.get(track.id) || { playCount: 0, favorite: false, rating: 0 };
    const now = Date.now();

    const results = conditions.map(cond => {
      const { field, operator, value } = cond;

      switch (field) {
        case 'tier': {
          if (operator === 'equals') return track.tier === value;
          if (operator === 'in') return Array.isArray(value) && value.includes(track.tier);
          return false;
        }

        case 'verification': {
          const status = track.analysis?.status || 'pending';
          if (operator === 'equals') return status === value;
          if (operator === 'isVerified') return status === 'verified_hires';
          if (operator === 'isSuspect') return status === 'suspected_upsample' || status === 'suspected_transcode';
          return false;
        }

        case 'genre': {
          const g = (track.metadata?.genre || '').toLowerCase();
          const target = String(value || '').toLowerCase();
          if (operator === 'contains') return g.includes(target);
          if (operator === 'equals') return g === target;
          return false;
        }

        case 'artist': {
          const a = (track.overrides?.artist || track.metadata?.artist || '').toLowerCase();
          const target = String(value || '').toLowerCase();
          if (operator === 'contains') return a.includes(target);
          if (operator === 'equals') return a === target;
          return false;
        }

        case 'year': {
          const y = parseInt(track.metadata?.year || '0', 10);
          const targetY = parseInt(value, 10);
          if (operator === 'equals') return y === targetY;
          if (operator === 'greaterThan') return y > targetY;
          if (operator === 'lessThan') return y < targetY;
          return false;
        }

        case 'favorite': {
          return !!stats.favorite === !!value;
        }

        case 'rating': {
          const r = stats.rating || 0;
          const targetR = Number(value);
          if (operator === 'greaterOrEqual') return r >= targetR;
          if (operator === 'equals') return r === targetR;
          return false;
        }

        case 'unplayed': {
          return (stats.playCount || 0) === 0;
        }

        case 'playCount': {
          const count = stats.playCount || 0;
          const targetC = Number(value);
          if (operator === 'greaterOrEqual') return count >= targetC;
          if (operator === 'equals') return count === targetC;
          if (operator === 'lessOrEqual') return count <= targetC;
          return false;
        }

        case 'addedWithinDays': {
          const days = Number(value);
          const diffDays = (now - (track.addedAt || now)) / (1000 * 60 * 60 * 24);
          return diffDays <= days;
        }

        default:
          return true;
      }
    });

    if (matchMode === 'OR') {
      return results.some(Boolean);
    }
    return results.every(Boolean);
  }

  /**
   * Filter and order an array of tracks for a smart playlist
   * @param {Array<Object>} tracks 
   * @param {Object} rules 
   * @param {Map} statsMap 
   * @returns {Array<Object>}
   */
  static evaluate(tracks = [], rules = {}, statsMap = new Map()) {
    let matched = tracks.filter(t => this.matchesTrack(t, rules, statsMap));

    // Sort order
    if (rules.sort) {
      matched.sort((a, b) => {
        if (rules.sort === 'playCountDesc') {
          return (statsMap.get(b.id)?.playCount || 0) - (statsMap.get(a.id)?.playCount || 0);
        }
        if (rules.sort === 'addedDesc') {
          return (b.addedAt || 0) - (a.addedAt || 0);
        }
        if (rules.sort === 'titleAsc') {
          return (a.overrides?.title || a.metadata?.title).localeCompare(b.overrides?.title || b.metadata?.title);
        }
        return 0;
      });
    }

    // Limit count
    if (rules.limit && rules.limit > 0) {
      matched = matched.slice(0, rules.limit);
    }

    return matched;
  }
}
