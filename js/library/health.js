/**
 * health.js - Library health audit engine, issue detection, and non-destructive virtual repairs
 *
 * Scans local library across 8 quality dimensions:
 * 1. Empty / placeholder metadata tags (title, artist, album, year, trackNo).
 * 2. Missing or low-resolution (< 500px) album cover artworks.
 * 3. Missing files with intelligent relink wizard matcher.
 * 4. Corrupted audio files / decode failures with plain-language diagnostic.
 * 5. Audio duplicates and multi-version groupings (linked to abPlayer & dedupe).
 * 6. Inconsistent artist & album names (e.g., diacritics/casing: "Beyonce" vs "Beyonce").
 * 7. Scattered albums located across multiple physical directory folders.
 * 8. Lossy upgrade candidates (tracks without a lossless counterpart in library).
 *
 * ALL REPAIRS ARE STRICTLY NON-DESTRUCTIVE:
 * Physical files on disk are NEVER touched. All adjustments are stored as virtual overrides
 * in IndexedDB with interactive preview before applying and complete undo capability.
 */

import { store } from '../core/store.js';
import { db } from '../db/db.js';
import { events } from '../core/events.js';
import { DuplicateManager } from './dedupe.js';
import { folderManager } from './folders.js';
import { hashString } from '../core/utils.js';

/**
 * Remove diacritics/accents, trim, and lowercase for fuzzy canonical clustering
 * @param {string} str
 * @returns {string}
 */
export function normalizeCanonicalString(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accent marks
    .replace(/[^a-z0-9]/g, '') // keep alphanumeric
    .trim();
}

/**
 * Determine best canonical recommendation from candidate variants.
 * Prefers accented/diacritic forms or title-cased forms or the highest count.
 * @param {Array<{ name: string, count: number }>} variants
 * @returns {string}
 */
export function pickCanonicalVariant(variants) {
  if (!variants || variants.length === 0) return '';
  if (variants.length === 1) return variants[0].name;

  // 1. Sort by count descending
  const sorted = [...variants].sort((a, b) => b.count - a.count);

  // 2. Check if there's a variant with diacritics (e.g. "Beyonce" with accent)
  const accented = variants.find(v => /[^\u0000-\u007F]/.test(v.name));
  if (accented) return accented.name;

  // 3. Fallback to most frequent variant
  return sorted[0].name;
}

export class LibraryHealthService {
  constructor() {
    this.cachedAudit = null;
    this.isAuditing = false;
    this.undoStack = [];
  }

  /**
   * Run full health audit across all tracks
   * @param {Array<Object>} tracks
   * @param {Function} [onProgress]
   * @returns {Promise<Object>}
   */
  async auditLibrary(tracks = [], onProgress = null) {
    this.isAuditing = true;
    if (onProgress) onProgress(0.1, 'Memulai audit kesehatan...');

    const emptyTags = this.checkEmptyTags(tracks);
    if (onProgress) onProgress(0.25, 'Memeriksa sampul album...');

    const covers = this.checkCovers(tracks);
    if (onProgress) onProgress(0.4, 'Memeriksa berkas hilang & integritas berkas...');

    const missingFiles = this.checkMissingFiles(tracks);
    const corruptedFiles = this.checkCorruptedFiles(tracks);
    if (onProgress) onProgress(0.55, 'Mendeteksi duplikat & versi...');

    const duplicates = this.checkDuplicates(tracks);
    if (onProgress) onProgress(0.7, 'Menganalisis penyeragaman nama artis & album...');

    const inconsistentArtists = this.checkInconsistentArtists(tracks);
    const inconsistentAlbums = this.checkInconsistentAlbums(tracks);
    if (onProgress) onProgress(0.85, 'Mendeteksi album tersebar & kandidat upgrade...');

    const scatteredAlbums = this.checkScatteredAlbums(tracks);
    const lossyUpgradeCandidates = this.checkLossyUpgradeCandidates(tracks);

    const scoreData = this.computeHealthScore(tracks, {
      emptyTags,
      covers,
      missingFiles,
      corruptedFiles,
      duplicates,
      inconsistentArtists,
      inconsistentAlbums,
      scatteredAlbums,
      lossyUpgradeCandidates
    });

    const auditResult = {
      timestamp: Date.now(),
      totalTracks: tracks.length,
      score: scoreData.score,
      grade: scoreData.grade,
      statusLabel: scoreData.statusLabel,
      categories: {
        emptyTags,
        covers,
        missingFiles,
        corruptedFiles,
        duplicates,
        inconsistentArtists,
        inconsistentAlbums,
        scatteredAlbums,
        lossyUpgradeCandidates
      }
    };

    this.cachedAudit = auditResult;
    this.isAuditing = false;
    if (onProgress) onProgress(1.0, 'Audit kesehatan selesai.');

    events.emit('health:audited', auditResult);
    return auditResult;
  }

  /**
   * 1. Check for empty or placeholder metadata tags
   * @param {Array<Object>} tracks
   * @returns {Object}
   */
  checkEmptyTags(tracks) {
    const items = [];
    const emptyCountByField = {
      title: 0,
      artist: 0,
      album: 0,
      year: 0,
      trackNo: 0
    };

    for (const track of tracks) {
      const title = String(track.overrides?.title || track.metadata?.title || '').trim();
      const artist = String(track.overrides?.artist || track.metadata?.artist || '').trim();
      const album = String(track.overrides?.album || track.metadata?.album || '').trim();
      const year = String(track.overrides?.year || track.metadata?.year || '').trim();
      const trackNo = track.overrides?.trackNo ?? track.metadata?.trackNo;

      const emptyFields = [];

      // Title check
      const name = String(track.name || '');
      if (!title || title === name || title === name.replace(/\.[^/.]+$/, '')) {
        emptyFields.push('title');
        emptyCountByField.title++;
      }

      // Artist check
      if (!artist || artist === 'Artis Tidak Diketahui' || artist === 'Unknown Artist') {
        emptyFields.push('artist');
        emptyCountByField.artist++;
      }

      // Album check
      if (!album || album === 'Album Tidak Diketahui' || album === 'Tanpa Album') {
        emptyFields.push('album');
        emptyCountByField.album++;
      }

      // Year check
      if (!year || year === '0' || year === '0000') {
        emptyFields.push('year');
        emptyCountByField.year++;
      }

      // Track number check
      if (!trackNo || Number(trackNo) <= 0) {
        emptyFields.push('trackNo');
        emptyCountByField.trackNo++;
      }

      if (emptyFields.length > 0) {
        items.push({ track, emptyFields });
      }
    }

    return {
      total: items.length,
      emptyCountByField,
      items
    };
  }

  /**
   * 2. Check for missing or low-resolution (< 500px) cover artworks
   * @param {Array<Object>} tracks
   * @returns {Object}
   */
  checkCovers(tracks) {
    const missing = [];
    const lowRes = [];

    for (const track of tracks) {
      const pic = track.overrides?.pictureUrl || track.metadata?.pictureUrl;
      const hasCover = !!(track.metadata?.hasCover || pic);

      if (!hasCover) {
        missing.push({ track, reason: 'missing' });
      } else if (track.metadata?.coverWidth && track.metadata?.coverHeight) {
        if (track.metadata.coverWidth < 500 || track.metadata.coverHeight < 500) {
          lowRes.push({
            track,
            reason: 'low_res',
            width: track.metadata.coverWidth,
            height: track.metadata.coverHeight
          });
        }
      }
    }

    return {
      total: missing.length + lowRes.length,
      missingCount: missing.length,
      lowResCount: lowRes.length,
      items: [...missing, ...lowRes]
    };
  }

  /**
   * 3. Check for missing tracks
   * @param {Array<Object>} tracks
   * @returns {Object}
   */
  checkMissingFiles(tracks) {
    const items = tracks.filter(t => t.missing === true).map(track => ({ track }));
    return {
      total: items.length,
      items
    };
  }

  /**
   * 4. Check for corrupted / unplayable tracks
   * @param {Array<Object>} tracks
   * @returns {Object}
   */
  checkCorruptedFiles(tracks) {
    const items = [];

    for (const track of tracks) {
      let isCorrupted = false;
      let reason = '';

      if (track.corrupted === true) {
        isCorrupted = true;
        reason = 'Berkas ditandai rusak saat proses pembacaan audio.';
      } else if (track.streamInfo) {
        const sr = track.streamInfo.sampleRate;
        const dur = track.streamInfo.duration;
        if (sr !== undefined && (isNaN(sr) || sr <= 0)) {
          isCorrupted = true;
          reason = 'Sample rate audio tidak terdeteksi atau bernilai 0 Hz.';
        } else if (dur !== undefined && (isNaN(dur) || (dur <= 0 && track.size > 10000))) {
          isCorrupted = true;
          reason = 'Durasi audio tidak terdeteksi meskipun ukuran berkas valid.';
        }
      }

      if (isCorrupted) {
        items.push({ track, reason });
      }
    }

    return {
      total: items.length,
      items
    };
  }

  /**
   * 5. Check for duplicate tracks via DuplicateManager
   * @param {Array<Object>} tracks
   * @returns {Object}
   */
  checkDuplicates(tracks) {
    const duplicateMap = DuplicateManager.findDuplicates(tracks);
    const groups = [];
    let duplicateTracksCount = 0;

    for (const [key, group] of duplicateMap.entries()) {
      groups.push({ key, tracks: group });
      duplicateTracksCount += group.length;
    }

    return {
      totalGroups: groups.length,
      totalTracks: duplicateTracksCount,
      groups
    };
  }

  /**
   * 6a. Check for inconsistent artist names (diacritics, casing, minor punctuation)
   * @param {Array<Object>} tracks
   * @returns {Object}
   */
  checkInconsistentArtists(tracks) {
    const map = new Map();

    for (const track of tracks) {
      const rawArtist = String(track.overrides?.artist || track.metadata?.artist || '').trim();
      if (!rawArtist || rawArtist === 'Artis Tidak Diketahui' || rawArtist === 'Unknown Artist') continue;

      const norm = normalizeCanonicalString(rawArtist);
      if (!norm) continue;

      if (!map.has(norm)) {
        map.set(norm, new Map());
      }
      const variantMap = map.get(norm);
      if (!variantMap.has(rawArtist)) {
        variantMap.set(rawArtist, []);
      }
      variantMap.get(rawArtist).push(track);
    }

    const inconsistent = [];
    for (const [normKey, variantMap] of map.entries()) {
      if (variantMap.size > 1) {
        const variants = [];
        for (const [name, trks] of variantMap.entries()) {
          variants.push({ name, count: trks.length, tracks: trks });
        }
        const recommended = pickCanonicalVariant(variants);
        inconsistent.push({
          type: 'artist',
          normalizedKey: normKey,
          variants,
          recommended
        });
      }
    }

    return {
      total: inconsistent.length,
      items: inconsistent
    };
  }

  /**
   * 6b. Check for inconsistent album names for the same artist
   * @param {Array<Object>} tracks
   * @returns {Object}
   */
  checkInconsistentAlbums(tracks) {
    const map = new Map();

    for (const track of tracks) {
      const rawAlbum = String(track.overrides?.album || track.metadata?.album || '').trim();
      const rawArtist = String(track.overrides?.artist || track.metadata?.artist || '').trim();
      if (!rawAlbum || rawAlbum === 'Album Tidak Diketahui' || rawAlbum === 'Tanpa Album') continue;

      const normArtist = normalizeCanonicalString(rawArtist);
      const normAlbum = normalizeCanonicalString(rawAlbum);
      if (!normAlbum) continue;

      const key = `${normArtist}__${normAlbum}`;
      if (!map.has(key)) {
        map.set(key, { rawArtist, variantMap: new Map() });
      }
      const record = map.get(key);
      if (!record.variantMap.has(rawAlbum)) {
        record.variantMap.set(rawAlbum, []);
      }
      record.variantMap.get(rawAlbum).push(track);
    }

    const inconsistent = [];
    for (const [, record] of map.entries()) {
      if (record.variantMap.size > 1) {
        const variants = [];
        for (const [name, trks] of record.variantMap.entries()) {
          variants.push({ name, count: trks.length, tracks: trks });
        }
        const recommended = pickCanonicalVariant(variants);
        inconsistent.push({
          type: 'album',
          artist: record.rawArtist,
          variants,
          recommended
        });
      }
    }

    return {
      total: inconsistent.length,
      items: inconsistent
    };
  }

  /**
   * 7. Check for scattered albums across multiple physical folder paths
   * @param {Array<Object>} tracks
   * @returns {Object}
   */
  checkScatteredAlbums(tracks) {
    const albumMap = new Map();

    for (const track of tracks) {
      const album = String(track.overrides?.album || track.metadata?.album || '').trim();
      const artist = String(track.overrides?.artist || track.metadata?.artist || '').trim();
      if (!album || album === 'Album Tidak Diketahui' || album === 'Tanpa Album') continue;

      const relPath = track.relativePath || '';
      if (!relPath.includes('/')) continue; // Root files don't have subfolders

      const dir = relPath.substring(0, relPath.lastIndexOf('/'));
      const key = `${normalizeCanonicalString(album)}__${normalizeCanonicalString(artist)}`;

      if (!albumMap.has(key)) {
        albumMap.set(key, {
          album,
          artist,
          dirMap: new Map(),
          allTracks: []
        });
      }
      const entry = albumMap.get(key);
      if (!entry.dirMap.has(dir)) {
        entry.dirMap.set(dir, []);
      }
      entry.dirMap.get(dir).push(track);
      entry.allTracks.push(track);
    }

    const scattered = [];
    for (const [, entry] of albumMap.entries()) {
      if (entry.dirMap.size > 1) {
        scattered.push({
          album: entry.album,
          artist: entry.artist,
          directories: Array.from(entry.dirMap.keys()),
          tracks: entry.allTracks
        });
      }
    }

    return {
      total: scattered.length,
      items: scattered
    };
  }

  /**
   * 8. Check for lossy upgrade candidates (tracks without a lossless version in library)
   * @param {Array<Object>} tracks
   * @returns {Object}
   */
  checkLossyUpgradeCandidates(tracks) {
    // Index tracks that have lossless versions
    const losslessKeys = new Set();
    for (const t of tracks) {
      const tier = t.tier || '';
      if (['LOSSLESS', 'STUDIO', 'HI-RES', 'DSD'].includes(tier)) {
        const key = DuplicateManager.getTrackKey(t);
        if (key) losslessKeys.add(key);
      }
    }

    const candidates = [];
    for (const t of tracks) {
      const tier = t.tier || '';
      if (tier === 'LOSSY' || tier === 'LOSSY HQ') {
        const key = DuplicateManager.getTrackKey(t);
        if (key && !losslessKeys.has(key)) {
          candidates.push({
            track: t,
            key,
            currentTier: tier,
            format: t.format || 'mp3'
          });
        }
      }
    }

    return {
      total: candidates.length,
      items: candidates
    };
  }

  /**
   * Compute comprehensive library health score (0 - 100%)
   * @param {Array<Object>} tracks
   * @param {Object} categories
   * @returns {{ score: number, grade: string, statusLabel: string }}
   */
  computeHealthScore(tracks, categories) {
    if (!tracks || tracks.length === 0) {
      return { score: 100, grade: 'A+', statusLabel: 'Library Bersih (0 Lagu)' };
    }

    const total = tracks.length;

    // Severity weights
    const missingRatio = categories.missingFiles.total / total;
    const corruptRatio = categories.corruptedFiles.total / total;
    const emptyTagRatio = categories.emptyTags.total / total;
    const coverMissingRatio = categories.covers.missingCount / total;
    const inconsistentRatio = (categories.inconsistentArtists.total + categories.inconsistentAlbums.total) / Math.max(1, total);

    // Compute raw penalty points (max 100)
    let penalty = 0;
    penalty += missingRatio * 40;        // Missing files are high priority
    penalty += corruptRatio * 40;        // Corrupted files are high priority
    penalty += emptyTagRatio * 20;       // Missing tag info is moderate
    penalty += coverMissingRatio * 15;   // Missing covers
    penalty += inconsistentRatio * 10;   // Minor spelling inconsistencies

    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

    let grade = 'A';
    let statusLabel = 'Sangat Sehat';

    if (score >= 90) {
      grade = 'A';
      statusLabel = 'Sangat Sehat';
    } else if (score >= 75) {
      grade = 'B';
      statusLabel = 'Baik (Perlu Perapian Kecil)';
    } else if (score >= 50) {
      grade = 'C';
      statusLabel = 'Cukup (Ada Beberapa Masalah)';
    } else {
      grade = 'D';
      statusLabel = 'Perlu Perhatian';
    }

    return { score, grade, statusLabel };
  }

  /**
   * Find candidate matches for missing tracks in new file selections
   * @param {Array<Object>} missingTracks
   * @param {Array<File>} candidateFiles
   * @returns {Array<{ missingTrack: Object, matchedFile: File, score: number, reason: string }>}
   */
  findRelinkMatches(missingTracks, candidateFiles) {
    const matches = [];

    for (const track of missingTracks) {
      let bestMatch = null;
      let highestScore = 0;
      let matchReason = '';

      const trkFingerprint = track.fingerprint;
      const trkName = (track.name || '').toLowerCase();
      const trkSize = track.size || 0;
      const trkTitle = normalizeCanonicalString(track.overrides?.title || track.metadata?.title || '');
      const trkArtist = normalizeCanonicalString(track.overrides?.artist || track.metadata?.artist || '');

      for (const file of candidateFiles) {
        const fileFp = hashString(`${file.name}|${file.size}|${file.lastModified}`);
        const fileName = file.name.toLowerCase();
        const fileSize = file.size;

        // 1. Exact Fingerprint match (100%)
        if (trkFingerprint && trkFingerprint === fileFp) {
          bestMatch = file;
          highestScore = 1.0;
          matchReason = 'Sidik jari berkas persis 100%';
          break;
        }

        // 2. Exact filename & exact or near-identical size (95%)
        if (trkName === fileName && Math.abs(trkSize - fileSize) < 1024) {
          if (highestScore < 0.95) {
            bestMatch = file;
            highestScore = 0.95;
            matchReason = 'Nama berkas & ukuran persis cocok';
          }
        }
        // 3. Exact filename match (85%)
        else if (trkName === fileName) {
          if (highestScore < 0.85) {
            bestMatch = file;
            highestScore = 0.85;
            matchReason = 'Nama berkas persis cocok';
          }
        }
        // 4. Fuzzy title & artist match (75%)
        else if (trkTitle && fileName.includes(trkTitle)) {
          if (highestScore < 0.75) {
            bestMatch = file;
            highestScore = 0.75;
            matchReason = 'Judul lagu terkandung di nama berkas';
          }
        }
      }

      if (bestMatch && highestScore >= 0.75) {
        matches.push({
          missingTrack: track,
          matchedFile: bestMatch,
          score: highestScore,
          reason: matchReason
        });
      }
    }

    return matches;
  }

  /**
   * Apply relink matches to restore missing tracks
   * @param {Array<{ missingTrack: Object, matchedFile: File }>} matches
   * @returns {Promise<number>}
   */
  async applyRelinkMatches(matches) {
    if (!matches || matches.length === 0) return 0;

    const allTracks = store.get('tracks') || [];
    let relinkedCount = 0;

    for (const match of matches) {
      const { missingTrack, matchedFile } = match;
      const targetIndex = allTracks.findIndex(t => t.id === missingTrack.id);

      if (targetIndex !== -1) {
        const updatedTrack = {
          ...allTracks[targetIndex],
          missing: false,
          size: matchedFile.size,
          lastModified: matchedFile.lastModified
        };

        allTracks[targetIndex] = updatedTrack;
        folderManager.registerInMemoryFile(updatedTrack.id, matchedFile);
        await db.put('tracks', updatedTrack);
        relinkedCount++;
      }
    }

    if (relinkedCount > 0) {
      store.set('tracks', [...allTracks]);
      events.emit('library:relinked', { count: relinkedCount });
      events.emit('health:repaired', { type: 'relink', count: relinkedCount });
    }

    return relinkedCount;
  }

  /**
   * Apply non-destructive bulk virtual overrides with automatic undo snapshot
   * @param {Array<{ trackId: string, patch: Object }>} repairs
   * @param {string} description Human-readable description
   * @returns {Promise<{ success: boolean, count: number, undoId: string }>}
   */
  async applyBulkOverrides(repairs = [], description = 'Perbaikan massal virtual') {
    if (!repairs || repairs.length === 0) {
      return { success: false, count: 0, undoId: null };
    }

    const allTracks = store.get('tracks') || [];
    const tagOverridesMap = store.get('tagOverrides') || new Map();
    const trackIndexMap = new Map(allTracks.map((t, idx) => [t.id, idx]));

    const previousOverridesSnapshot = [];
    const appliedTracks = [];
    const updatedOverridesForDb = [];

    for (const repair of repairs) {
      const { trackId, patch } = repair;
      const trackIdx = trackIndexMap.get(trackId);
      if (trackIdx === undefined) continue;

      const track = allTracks[trackIdx];
      const prevOverride = tagOverridesMap.get(trackId) || (track.overrides ? { ...track.overrides } : null);

      previousOverridesSnapshot.push({
        trackId,
        previousOverride: prevOverride ? { ...prevOverride } : null
      });

      const nextOverride = {
        ...(prevOverride || {}),
        ...patch
      };

      tagOverridesMap.set(trackId, nextOverride);
      updatedOverridesForDb.push({ trackId, ...nextOverride });

      const updatedTrack = {
        ...track,
        overrides: nextOverride
      };

      // Propagate cover URL if changed
      if (patch.pictureUrl !== undefined) {
        if (!updatedTrack.metadata) updatedTrack.metadata = {};
        updatedTrack.metadata.pictureUrl = patch.pictureUrl;
        updatedTrack.metadata.hasCover = !!patch.pictureUrl;
      }

      allTracks[trackIdx] = updatedTrack;
      appliedTracks.push(updatedTrack);
    }

    // Push record to Undo Stack
    const undoId = 'undo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    this.undoStack.push({
      id: undoId,
      description,
      timestamp: Date.now(),
      previousOverrides: previousOverridesSnapshot,
      repairsCount: repairs.length
    });

    // 1. Persist to IndexedDB
    for (const ov of updatedOverridesForDb) {
      await db.put('tagOverrides', ov);
    }
    for (const trk of appliedTracks) {
      await db.put('tracks', trk);
    }

    // 2. Update reactive Store
    store.set('tagOverrides', new Map(tagOverridesMap));
    store.set('tracks', [...allTracks]);

    // 3. Update currently playing track if affected
    const cur = store.get('currentTrack');
    if (cur && trackIndexMap.has(cur.id)) {
      const updatedCur = allTracks[trackIndexMap.get(cur.id)];
      store.set('currentTrack', { ...updatedCur });
    }

    events.emit('health:repaired', {
      type: 'bulk_override',
      count: appliedTracks.length,
      description,
      undoId
    });

    return { success: true, count: appliedTracks.length, undoId };
  }

  /**
   * Undo the most recent bulk override operation
   * @returns {Promise<Object|null>} Restored operation record or null
   */
  async undoLastRepair() {
    if (this.undoStack.length === 0) return null;

    const record = this.undoStack.pop();
    const allTracks = store.get('tracks') || [];
    const tagOverridesMap = store.get('tagOverrides') || new Map();
    const trackIndexMap = new Map(allTracks.map((t, idx) => [t.id, idx]));

    for (const item of record.previousOverrides) {
      const { trackId, previousOverride } = item;
      const trackIdx = trackIndexMap.get(trackId);
      if (trackIdx === undefined) continue;

      const track = allTracks[trackIdx];

      if (previousOverride === null) {
        tagOverridesMap.delete(trackId);
        await db.delete('tagOverrides', trackId);
        delete track.overrides;
      } else {
        tagOverridesMap.set(trackId, previousOverride);
        await db.put('tagOverrides', { trackId, ...previousOverride });
        track.overrides = { ...previousOverride };
      }

      await db.put('tracks', track);
      allTracks[trackIdx] = { ...track };
    }

    // Update Store
    store.set('tagOverrides', new Map(tagOverridesMap));
    store.set('tracks', [...allTracks]);

    // Update active playing track if needed
    const cur = store.get('currentTrack');
    if (cur && trackIndexMap.has(cur.id)) {
      const updatedCur = allTracks[trackIndexMap.get(cur.id)];
      store.set('currentTrack', { ...updatedCur });
    }

    events.emit('health:undone', { record });
    return record;
  }

  /**
   * Check if undo stack has actions available
   * @returns {boolean}
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * Get description of last undo action
   * @returns {string}
   */
  getLastUndoDescription() {
    if (this.undoStack.length === 0) return '';
    return this.undoStack[this.undoStack.length - 1].description;
  }

  /**
   * Clear all stored undo records
   */
  clearUndoStack() {
    this.undoStack = [];
  }
}

export const healthService = new LibraryHealthService();
