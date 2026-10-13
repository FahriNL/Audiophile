/**
 * transitions.js - Smart audio transition detector for gapless & crossfade playback.
 * Automatically enforces gapless Pure (tanpa DSP) transitions for live albums,
 * concept albums, and continuous sequential tracks while avoiding crossfade.
 */

export class SmartTransitionDetector {
  /**
   * Determine if a track is part of a live recording
   * @param {Object} track 
   * @returns {boolean}
   */
  static isLive(track) {
    if (!track) return false;
    const title = (track.overrides?.title || track.metadata?.title || '').toLowerCase();
    const album = (track.overrides?.album || track.metadata?.album || '').toLowerCase();
    const genre = (track.overrides?.genre || track.metadata?.genre || '').toLowerCase();
    const combined = `${title} ${album} ${genre}`;

    const livePattern = /\b(live|concert|in concert|unplugged|on tour|tour|recorded live|live at|live from|live session)\b/i;
    return livePattern.test(combined) || Boolean(track.metadata?.isLive || track.overrides?.isLive);
  }

  /**
   * Determine if two tracks belong to a concept album or continuous mix
   * @param {Object} trackA 
   * @param {Object} trackB 
   * @returns {boolean}
   */
  static isConceptOrContinuous(trackA, trackB) {
    if (!trackA || !trackB) return false;

    const albumA = (trackA.overrides?.album || trackA.metadata?.album || '').toLowerCase().trim();
    const albumB = (trackB.overrides?.album || trackB.metadata?.album || '').toLowerCase().trim();

    // If tracks belong to the exact same album
    if (albumA && albumA === albumB && albumA !== 'tanpa album' && albumA !== 'album tidak diketahui') {
      const trackNoA = parseInt(trackA.overrides?.trackNo || trackA.metadata?.trackNo || 0, 10);
      const trackNoB = parseInt(trackB.overrides?.trackNo || trackB.metadata?.trackNo || 0, 10);

      // Sequential playback within the same album
      if (trackNoA > 0 && trackNoB > 0 && trackNoB === trackNoA + 1) {
        return true;
      }

      // Any tracks from same album when playing continuously
      return true;
    }

    // Check keywords for concept or continuous mixes across albums
    const combined = `${albumA} ${albumB} ${(trackA.metadata?.genre || '')} ${(trackB.metadata?.genre || '')}`.toLowerCase();
    const conceptPattern = /\b(concept|continuous|continuous mix|dj mix|mix|opera|symphony|suite|soundtrack|ost)\b/i;
    return conceptPattern.test(combined);
  }

  /**
   * Determine the optimal transition profile between two tracks
   * @param {Object} trackA Current track
   * @param {Object} trackB Upcoming track
   * @param {Object} settings Application playback settings
   * @returns {{ type: 'gapless'|'crossfade'|'standard', duration?: number, reason: string, crossfade: boolean }}
   */
  static determineTransition(trackA, trackB, settings = {}) {
    if (!trackA || !trackB) {
      return { type: 'standard', reason: 'single_track', crossfade: false };
    }

    const smartEnabled = settings.smartTransitions !== false;
    const cf = typeof settings.crossfade === 'object' && settings.crossfade !== null
      ? settings.crossfade
      : { enabled: (parseFloat(settings.crossfade) || 0) > 0, duration: parseFloat(settings.crossfade) || 0, avoidConsecutiveAlbums: true };

    const avoidConsecutive = cf.avoidConsecutiveAlbums !== false;

    if (smartEnabled || avoidConsecutive) {
      // 1. Live albums or tracks must never be crossfaded
      if (this.isLive(trackA) || this.isLive(trackB)) {
        return {
          type: 'gapless',
          reason: 'live_recording_protection',
          crossfade: false
        };
      }

      // 2. Concept albums or same-album continuous tracks must remain gapless
      if (avoidConsecutive && this.isConceptOrContinuous(trackA, trackB)) {
        return {
          type: 'gapless',
          reason: 'concept_album_continuity',
          crossfade: false
        };
      }
    }

    // 3. Independent/unrelated tracks can crossfade if configured
    const crossfadeDuration = cf.enabled ? (parseFloat(cf.duration) || 0) : 0;
    if (crossfadeDuration > 0) {
      return {
        type: 'crossfade',
        duration: crossfadeDuration,
        reason: 'unrelated_tracks_smooth_mix',
        crossfade: true
      };
    }

    // 4. Default Pure (tanpa DSP) gapless transition
    return {
      type: 'gapless',
      reason: 'standard_gapless',
      crossfade: false
    };
  }
}
