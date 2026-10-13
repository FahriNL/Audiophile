/**
 * scanner.js - Incremental library scanner, stable ID assignment, and missing track relink
 */

import { MetadataParser } from './metadata.js';
import { coverCache } from './covers.js';
import { classifyQualityTier } from '../quality/tiers.js';
import { generateStableTrackId, hashString } from '../core/utils.js';
import { db } from '../db/db.js';
import { store } from '../core/store.js';
import { events } from '../core/events.js';
import { folderManager } from './folders.js';

export const SUPPORTED_EXTENSIONS = [
  'flac', 'wav', 'aiff', 'm4a', 'mp3', 'aac', 'ogg', 'opus', 'dsf', 'dff', 'wv', 'ape'
];

class LibraryScanner {
  /**
   * Scan all entries inside a directory handle recursively
   * @param {FileSystemDirectoryHandle} dirHandle 
   * @returns {Promise<Array<{ file: File, relativePath: string }>>}
   */
  async scanDirectoryHandle(dirHandle) {
    const fileEntries = [];
    const lrcMap = new Map();
    const companionArtMap = new Map();

    async function walk(handle, path = '') {
      for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          const ext = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
          const baseName = file.name.replace(/\.[^/.]+$/, '').toLowerCase();
          if (SUPPORTED_EXTENSIONS.includes(ext)) {
            fileEntries.push({
              file,
              relativePath: path ? `${path}/${file.name}` : file.name
            });
          } else if (ext === 'lrc') {
            const text = await file.text();
            lrcMap.set(baseName, text);
          } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
            if (['cover', 'folder', 'front', 'album'].includes(baseName)) {
              companionArtMap.set(path || '', file);
            }
          }
        } else if (entry.kind === 'directory') {
          await walk(entry, path ? `${path}/${entry.name}` : entry.name);
        }
      }
    }

    await walk(dirHandle);
    return this.processScannedFiles(fileEntries, lrcMap, companionArtMap);
  }

  /**
   * Scan files from HTML file input or drag-and-drop
   * @param {FileList|Array<File>} fileList 
   */
  async scanFileList(fileList) {
    const fileEntries = [];
    const lrcMap = new Map();
    const companionArtMap = new Map();

    for (const file of fileList) {
      const ext = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
      const baseName = file.name.replace(/\.[^/.]+$/, '').toLowerCase();
      const path = file.webkitRelativePath ? file.webkitRelativePath.substring(0, file.webkitRelativePath.lastIndexOf('/')) : '';
      if (SUPPORTED_EXTENSIONS.includes(ext)) {
        fileEntries.push({
          file,
          relativePath: file.webkitRelativePath || file.name
        });
      } else if (ext === 'lrc') {
        try {
          const text = await file.text();
          lrcMap.set(baseName, text);
        } catch {}
      } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
        if (['cover', 'folder', 'front', 'album'].includes(baseName)) {
          companionArtMap.set(path, file);
        }
      }
    }

    return this.processScannedFiles(fileEntries, lrcMap, companionArtMap);
  }

  /**
   * Process and parse raw scanned files, assign stable IDs, and detect missing tracks
   * @param {Array<{ file: File, relativePath: string }>} fileEntries 
   * @param {Map<string, string>} lrcMap 
   * @param {Map<string, File>} companionArtMap
   */
  async processScannedFiles(fileEntries, lrcMap = new Map(), companionArtMap = new Map()) {
    const existingTracks = await db.getAll('tracks');
    const existingMap = new Map(existingTracks.map(t => [t.id, t]));
    const existingOverrides = await db.getAll('tagOverrides');
    const overridesMap = new Map((existingOverrides || []).map(o => [o.trackId, o]));
    const foundTrackIds = new Set();
    const updatedTracks = [];

    const totalFiles = fileEntries.length;
    let processedCount = 0;

    for (let i = 0; i < totalFiles; i++) {
      const entry = fileEntries[i];
      const { file, relativePath } = entry;
      processedCount++;

      // Non-blocking yield every 10 files to keep browser UI responsive during 180+ track / 7GB scans
      if (i > 0 && i % 10 === 0) {
        events.emit('scan:progress', {
          current: processedCount,
          total: totalFiles,
          percent: Math.round((processedCount / totalFiles) * 100),
          filename: file.name
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      try {
        const ext = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();

        // Fingerprint to identify the file even if path or name changed
        const fingerprint = hashString(`${file.name}|${file.size}|${file.lastModified}`);

        // Try fast lookup if already exists with same size & lastModified
        let existingTrack = Array.from(existingMap.values()).find(
          t => t.fingerprint === fingerprint || (t.relativePath === relativePath && t.size === file.size)
        );

        let parsed = { streamInfo: {}, metadata: {} };
        if (!existingTrack) {
          try {
            if (ext === 'flac') parsed = await MetadataParser.parseFLAC(file);
            else if (ext === 'wav') parsed = await MetadataParser.parseWAV(file);
            else if (ext === 'mp3') parsed = await MetadataParser.parseID3v2(file);
            else if (['m4a', 'alac', 'aac'].includes(ext)) parsed = await MetadataParser.parseMP4(file);
            else if (['dsf', 'dff'].includes(ext)) parsed = await MetadataParser.parseDSD(file);
            else if (['opus', 'ogg'].includes(ext)) parsed = await MetadataParser.parseOpus(file);
            else parsed = await MetadataParser.parseID3v2(file);
          } catch (err) {
            console.warn(`Parse warning for ${file.name}:`, err);
          }
        }

        const title = parsed.metadata?.title || (existingTrack?.metadata?.title) || file.name.replace(/\.[^/.]+$/, '');
        const artist = parsed.metadata?.artist || (existingTrack?.metadata?.artist) || '';
        
        // Compute Stable ID based on filename, size, and metadata
        const stableId = existingTrack ? existingTrack.id : generateStableTrackId(file.name, file.size, title, artist);
        foundTrackIds.add(stableId);

        // Register file in memory map
        folderManager.registerInMemoryFile(stableId, file);

        // Companion .lrc
        const baseName = file.name.substring(0, file.name.lastIndexOf('.')).toLowerCase();
        const companionLrc = lrcMap.get(baseName);
        if (companionLrc) {
          if (!parsed.metadata) parsed.metadata = {};
          parsed.metadata.lyrics = companionLrc;
          parsed.metadata.hasLrc = true;
        }

        const streamInfo = Object.keys(parsed.streamInfo || {}).length > 0 ? parsed.streamInfo : (existingTrack?.streamInfo || {});
        const tierInfo = classifyQualityTier(streamInfo, ext);

        // Save and resolve cover art - declared BEFORE companion art check to avoid TDZ ReferenceError
        let pictureKey = existingTrack?.metadata?.pictureKey || null;
        let pictureUrl = null;

        // Check companion cover art if file has no embedded artwork
        if (!parsed.pictureData && !pictureKey) {
          const folderPath = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
          const companionFile = companionArtMap.get(folderPath) || companionArtMap.get('');
          if (companionFile) {
            try {
              const buf = await companionFile.arrayBuffer();
              parsed.pictureData = {
                bytes: new Uint8Array(buf),
                mime: companionFile.type || 'image/jpeg'
              };
            } catch {}
          }
        }

        if (parsed.pictureData) {
          pictureKey = stableId;
          pictureUrl = await coverCache.saveCover(stableId, parsed.pictureData.bytes, parsed.pictureData.mime);
        } else if (pictureKey) {
          pictureUrl = await coverCache.getCoverUrl(pictureKey);
        }

        const trackRecord = {
          id: stableId,
          fingerprint,
          name: file.name,
          relativePath,
          size: file.size,
          lastModified: file.lastModified,
          format: ext,
          streamInfo,
          metadata: {
            title,
            artist: artist || 'Artis Tidak Diketahui',
            albumArtist: parsed.metadata?.albumArtist || existingTrack?.metadata?.albumArtist || '',
            album: parsed.metadata?.album || existingTrack?.metadata?.album || 'Album Tidak Diketahui',
            trackNo: parsed.metadata?.trackNo || existingTrack?.metadata?.trackNo || 0,
            year: parsed.metadata?.year || existingTrack?.metadata?.year || '',
            genre: parsed.metadata?.genre || existingTrack?.metadata?.genre || '',
            lyrics: parsed.metadata?.lyrics || existingTrack?.metadata?.lyrics || '',
            hasLrc: !!companionLrc || !!existingTrack?.metadata?.hasLrc,
            pictureKey: pictureKey || (pictureUrl ? stableId : null),
            pictureUrl: pictureUrl || null,
            hasCover: !!(pictureKey || pictureUrl),
            replayGainTrackGain: parsed.metadata?.replayGainTrackGain || existingTrack?.metadata?.replayGainTrackGain || 0
          },
          tier: tierInfo.tier,
          tierDetails: tierInfo.details,
          missing: false, // successfully located
          addedAt: existingTrack?.addedAt || Date.now()
        };

        // Preserve edited tags and cover overrides
        const savedOverride = overridesMap.get(stableId) || existingTrack?.overrides;
        if (savedOverride) {
          trackRecord.overrides = { ...savedOverride };
          if (savedOverride.pictureUrl !== undefined) {
            trackRecord.metadata.pictureUrl = savedOverride.pictureUrl;
            if (savedOverride.pictureUrl) trackRecord.metadata.hasCover = true;
          }
        }

        updatedTracks.push(trackRecord);
      } catch (fileErr) {
        console.warn(`File scanning fault-isolation error for ${file.name}:`, fileErr);
      }
    }

    // Retain existing library tracks without falsely marking them missing
    for (const [id, track] of existingMap.entries()) {
      if (!foundTrackIds.has(id)) {
        track.missing = false;
        updatedTracks.push(track);
      }
    }

    // Automatic album artwork inheritance:
    // If some songs in an album lack cover art, inherit from any song in the same album that has one
    const albumCoverMap = new Map();
    for (const t of updatedTracks) {
      const alb = (t.overrides?.album || t.metadata?.album || '').toLowerCase().trim();
      const art = (t.overrides?.artist || t.metadata?.artist || '').toLowerCase().trim();
      if (alb && alb !== 'tanpa album' && alb !== 'album tidak diketahui') {
        const pic = t.overrides?.pictureUrl || t.metadata?.pictureUrl;
        const key = t.metadata?.pictureKey;
        if (pic) {
          albumCoverMap.set(`${art}::${alb}`, { pictureUrl: pic, pictureKey: key });
          if (!albumCoverMap.has(alb)) {
            albumCoverMap.set(alb, { pictureUrl: pic, pictureKey: key });
          }
        }
      }
    }

    if (albumCoverMap.size > 0) {
      for (const t of updatedTracks) {
        const alb = (t.overrides?.album || t.metadata?.album || '').toLowerCase().trim();
        const art = (t.overrides?.artist || t.metadata?.artist || '').toLowerCase().trim();
        const inherited = albumCoverMap.get(`${art}::${alb}`) || albumCoverMap.get(alb);
        if (inherited && !t.metadata.pictureUrl && !t.overrides?.pictureUrl) {
          t.metadata.pictureUrl = inherited.pictureUrl;
          if (inherited.pictureKey) t.metadata.pictureKey = inherited.pictureKey;
          t.metadata.hasCover = true;
        }
      }
    }

    // Persist all tracks to IndexedDB
    await db.bulkPut('tracks', updatedTracks);
    store.set('tracks', updatedTracks);
    events.emit('library:scanned', { total: updatedTracks.length, found: foundTrackIds.size });

    return updatedTracks;
  }

  /**
   * Relink missing tracks with new files based on name, size, or fingerprint
   * @param {Array<File>} candidates 
   * @returns {Promise<number>} number of relinked tracks
   */
  async relinkMissingTracks(candidates) {
    const tracks = store.get('tracks') || [];
    const missingTracks = tracks.filter(t => t.missing);
    if (missingTracks.length === 0) return 0;

    let relinkedCount = 0;

    for (const file of candidates) {
      const fp = hashString(`${file.name}|${file.size}|${file.lastModified}`);
      const match = missingTracks.find(
        t => t.fingerprint === fp || (t.name.toLowerCase() === file.name.toLowerCase() && Math.abs(t.size - file.size) < 1024)
      );

      if (match) {
        match.missing = false;
        match.size = file.size;
        match.lastModified = file.lastModified;
        folderManager.registerInMemoryFile(match.id, file);
        await db.put('tracks', match);
        relinkedCount++;
      }
    }

    if (relinkedCount > 0) {
      store.set('tracks', [...tracks]);
      events.emit('library:relinked', { count: relinkedCount });
    }

    return relinkedCount;
  }
}

export const scanner = new LibraryScanner();
