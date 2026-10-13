/**
 * artistMeta.js - Online artist metadata fetcher with IndexedDB offline caching.
 * All external network requests are routed through the central network gatekeeper
 * (externalFetch) and guarded by user privacy permissions.
 */

import { db } from '../db/db.js';
import { store } from '../core/store.js';
import { events } from '../core/events.js';
import { coverCache } from './covers.js';
import { externalFetch, isServiceAllowed, isTotalOffline } from '../core/network.js';

class ArtistMetaService {
  constructor() {
    this.memoryCache = new Map();
    this.inFlightRequests = new Map();
  }

  /**
   * Clean artist name for web search queries
   * @param {string} rawName 
   * @returns {string}
   */
  sanitizeArtistName(rawName) {
    if (!rawName || typeof rawName !== 'string') return '';
    let clean = rawName.trim();
    // Strip featuring artists from search query e.g. "Queen feat. David Bowie" -> "Queen"
    clean = clean.replace(/\s+(?:feat\.|ft\.|featuring|with|vs\.)\s+.*$/i, '');
    // Strip parenthesized descriptions e.g. "Chrisye (Indonesian Singer)" -> "Chrisye"
    clean = clean.replace(/\s*\([^)]*\)$/, '');
    return clean.trim();
  }

  /**
   * Retrieve cached artist metadata synchronously if already loaded in memory
   * @param {string} artistName 
   * @returns {Object|null}
   */
  getFromMemory(artistName) {
    if (!artistName) return null;
    return this.memoryCache.get(artistName) || null;
  }

  /**
   * Get artist metadata from IndexedDB cache or fetch from permitted online APIs
   * @param {string} artistName 
   * @param {boolean} forceRefresh 
   * @returns {Promise<Object>}
   */
  async getArtistMeta(artistName, forceRefresh = false) {
    if (!artistName || typeof artistName !== 'string') {
      return this.createEmptyMeta(artistName);
    }

    const cleanName = this.sanitizeArtistName(artistName);
    const cacheKey = `artist_meta:${artistName.toLowerCase().trim()}`;

    // 1. Check in-memory cache
    if (!forceRefresh && this.memoryCache.has(artistName)) {
      const mem = this.memoryCache.get(artistName);
      if (mem?.bannerUrl && (mem.bannerUrl.includes('Tianjin_Grand_Theater') || mem.bannerUrl.includes('Concert_Hall'))) {
        mem.bannerUrl = '';
      }
      return mem;
    }

    // 2. Check IndexedDB persistent store
    if (!forceRefresh) {
      try {
        const stored = await db.get('settings', cacheKey);
        if (stored && stored.data) {
          if (stored.data.bannerUrl && (stored.data.bannerUrl.includes('Tianjin_Grand_Theater') || stored.data.bannerUrl.includes('Concert_Hall'))) {
            stored.data.bannerUrl = '';
            try { await db.put('settings', { key: cacheKey, data: stored.data }); } catch {}
          }
          this.memoryCache.set(artistName, stored.data);
          return stored.data;
        }
      } catch (err) {
        console.warn('Failed to read artist cache from IndexedDB:', err);
      }
    }

    // If master offline mode is on or all external services are disabled, return offline fallback
    if (isTotalOffline()) {
      const offlineMeta = this.createEmptyMeta(artistName);
      offlineMeta.isOfflineOnly = true;
      return offlineMeta;
    }

    // Deduplicate in-flight requests for the same artist
    if (this.inFlightRequests.has(cacheKey)) {
      return this.inFlightRequests.get(cacheKey);
    }

    const fetchPromise = this._fetchOnlineMeta(artistName, cleanName, cacheKey);
    this.inFlightRequests.set(cacheKey, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.inFlightRequests.delete(cacheKey);
    }
  }

  /**
   * Internal routine to query Deezer, MusicBrainz & Wikipedia
   * @private
   */
  async _fetchOnlineMeta(rawArtistName, cleanName, cacheKey) {
    let deezerData = null;
    let mbData = null;
    let wikiData = null;

    // A. Query Deezer if allowed
    if (isServiceAllowed('deezer')) {
      try {
        deezerData = await this._fetchDeezerData(cleanName);
      } catch (err) {
        console.warn('Deezer fetch notice for artist:', cleanName, err);
      }
    }

    // B. Query MusicBrainz if allowed
    if (isServiceAllowed('musicbrainz')) {
      try {
        mbData = await this._fetchMusicBrainzData(cleanName);
      } catch (err) {
        console.warn('MusicBrainz fetch notice for artist:', cleanName, err);
      }
    }

    // C. Query Wikipedia if allowed
    if (isServiceAllowed('wikipedia')) {
      const preferredWikiTitle = mbData?.wikiTitle || deezerData?.name || cleanName;
      try {
        wikiData = await this._fetchWikipediaData(preferredWikiTitle, 'id');
        if (!wikiData || !wikiData.extract || wikiData.type === 'disambiguation') {
          wikiData = await this._fetchWikipediaData(preferredWikiTitle, 'en');
        }
      } catch (err) {
        console.warn('Wikipedia fetch notice for artist:', cleanName, err);
      }
    }

    // D. Fetch stage banner from Wikimedia Commons or Wikipedia if allowed
    let bannerUrl = '';
    const avatarUrl = deezerData?.avatarUrl || wikiData?.thumbnail?.source || '';
    const wikiTitleForMedia = wikiData?.title || mbData?.wikiTitle || cleanName;

    if (isServiceAllowed('wikimedia')) {
      try {
        bannerUrl = await this._fetchWikimediaConcertBanner(cleanName);
      } catch (err) {
        console.warn('Wikimedia banner fetch notice for artist:', cleanName, err);
      }
    }

    if (!bannerUrl && wikiTitleForMedia && isServiceAllowed('wikipedia')) {
      try {
        bannerUrl = await this._fetchWikipediaBanner(wikiTitleForMedia, 'id', avatarUrl);
        if (!bannerUrl) {
          bannerUrl = await this._fetchWikipediaBanner(wikiTitleForMedia, 'en', avatarUrl);
        }
      } catch (err) {
        console.warn('Wikipedia banner fetch notice for artist:', cleanName, err);
      }
    }

    // E. Combine metadata into structured record
    const hasDeezer = Boolean(deezerData?.avatarUrl);
    const hasMb = Boolean(mbData?.country || mbData?.type || mbData?.genres?.length);
    const hasWiki = Boolean(wikiData?.extract);

    let sourceDesc = 'Local';
    if (hasDeezer && hasMb) sourceDesc = 'Deezer + MusicBrainz';
    else if (hasDeezer) sourceDesc = 'Deezer';
    else if (hasMb) sourceDesc = 'MusicBrainz';
    else if (hasWiki) sourceDesc = 'Wikipedia';

    let descText = wikiData?.description || mbData?.disambiguation || '';
    if (deezerData?.nb_fan && deezerData.nb_fan > 0) {
      const fanCountStr = `${deezerData.nb_fan.toLocaleString()} Penggemar`;
      descText = descText ? `${fanCountStr} • ${descText}` : fanCountStr;
    }

    const meta = {
      artistName: rawArtistName,
      cleanName: cleanName,
      title: deezerData?.name || wikiData?.title || rawArtistName,
      description: descText,
      bio: wikiData?.extract || '',
      avatarUrl: avatarUrl || '',
      bannerUrl: bannerUrl || '',
      wikiUrl: wikiData?.content_urls?.desktop?.page || (mbData?.wikiUrl || ''),
      deezerUrl: deezerData?.link || '',
      country: mbData?.country || '',
      type: mbData?.type || '',
      genres: mbData?.genres || [],
      source: sourceDesc,
      lastUpdated: Date.now()
    };

    // F. Cache in memory and persist in IndexedDB
    this.memoryCache.set(rawArtistName, meta);

    try {
      await db.put('settings', { key: cacheKey, data: meta });
    } catch (err) {
      console.warn('Failed to persist artist metadata to IndexedDB:', err);
    }

    return meta;
  }

  /**
   * Fetch artist portrait and fan count from Deezer API via JSONP
   * @private
   */
  _fetchDeezerData(artistName) {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        return resolve(null);
      }
      if (!isServiceAllowed('deezer')) {
        return resolve(null);
      }

      const cbName = `__deezer_cb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      let timer = null;
      const script = document.createElement('script');

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[cbName]; } catch {}
      };

      timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 5000);

      window[cbName] = (data) => {
        cleanup();
        if (data && Array.isArray(data.data) && data.data.length > 0) {
          const match = data.data.find(a => a.name.toLowerCase() === artistName.toLowerCase()) || data.data[0];
          resolve({
            name: match.name,
            avatarUrl: match.picture_xl || match.picture_big || match.picture_medium || '',
            bannerUrl: '',
            nb_fan: match.nb_fan || 0,
            link: match.link || ''
          });
        } else {
          resolve(null);
        }
      };

      script.src = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&output=jsonp&callback=${cbName}`;
      script.onerror = () => {
        cleanup();
        resolve(null);
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Fetch genre, country, and official relations from MusicBrainz API via externalFetch
   * @private
   */
  async _fetchMusicBrainzData(artistName) {
    const mbUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json`;
    
    const res = await externalFetch('musicbrainz', mbUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!res.ok) return null;

    const data = await res.json();
    const artists = data?.artists || [];
    if (artists.length === 0) return null;

    const primary = artists[0];
    const tags = Array.isArray(primary.tags)
      ? primary.tags
          .sort((a, b) => (b.count || 0) - (a.count || 0))
          .slice(0, 4)
          .map(t => this._capitalizeTag(t.name))
      : [];

    let wikiTitle = '';
    let wikiUrl = '';

    if (Array.isArray(primary.relations)) {
      const wikiRel = primary.relations.find(r => r.type === 'wikipedia');
      if (wikiRel && wikiRel.url?.resource) {
        wikiUrl = wikiRel.url.resource;
        const parts = wikiUrl.split('/wiki/');
        if (parts.length > 1) {
          wikiTitle = decodeURIComponent(parts[1].replace(/_/g, ' '));
        }
      }
    }

    return {
      name: primary.name,
      disambiguation: primary.disambiguation || '',
      type: primary.type || '',
      country: primary.country || '',
      genres: tags,
      wikiTitle,
      wikiUrl
    };
  }

  /**
   * Fetch summary from Wikipedia REST API with search fallback via externalFetch
   * @private
   */
  async _fetchWikipediaData(artistName, lang = 'id') {
    const directUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName)}`;
    
    try {
      const res = await externalFetch('wikipedia', directUrl, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.type !== 'disambiguation' && (data.extract || data.thumbnail)) {
          return data;
        }
      }
    } catch {
      // Direct summary failed, proceed to search
    }

    // Fallback: Use Wikipedia Action API search to locate best matching page title
    const searchKeywords = lang === 'id' 
      ? `${artistName} musik OR penyanyi OR musisi OR grup musik`
      : `${artistName} musician OR band OR singer OR music group`;

    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchKeywords)}&format=json&origin=*`;

    const searchRes = await externalFetch('wikipedia', searchUrl);
    if (!searchRes.ok) return null;

    const searchJson = await searchRes.json();
    const hits = searchJson?.query?.search || [];
    if (hits.length === 0) return null;

    let candidate = hits[0].title;
    for (const hit of hits) {
      if (hit.title.toLowerCase().includes(artistName.toLowerCase())) {
        candidate = hit.title;
        break;
      }
    }

    const candidateUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidate)}`;
    const candidateRes = await externalFetch('wikipedia', candidateUrl);
    if (candidateRes.ok) {
      const candidateData = await candidateRes.json();
      if (candidateData.type !== 'disambiguation') {
        return candidateData;
      }
    }

    return null;
  }

  /**
   * Fetch distinct wide stage or concert banner from Wikipedia media list via externalFetch
   * @private
   */
  async _fetchWikipediaBanner(pageTitle, lang = 'en', avatarUrl = '') {
    if (!pageTitle) return null;
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(pageTitle)}`;
      const res = await externalFetch('wikipedia', url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      const items = (data?.items || []).filter(i =>
        i.type === 'image' &&
        i.title &&
        !i.title.match(/svg|sound|audio|icon|logo|stub|portal|cassette|vinyl|disc|signature|crest|coat_of_arms/i)
      );

      let bestUrl = null;
      let bestScore = -1;

      for (const item of items) {
        const src = item.srcset?.[item.srcset.length - 1]?.src || item.srcset?.[0]?.src;
        if (!src) continue;
        const fullUrl = src.startsWith('//') ? `https:${src}` : src;

        if (avatarUrl && fullUrl.toLowerCase().includes(avatarUrl.toLowerCase().slice(-24))) {
          continue;
        }
        if (fullUrl.includes('Tianjin_Grand_Theater') || fullUrl.includes('Concert_Hall')) {
          continue;
        }

        let score = 1;
        const t = item.title.toLowerCase();
        if (t.match(/live|concert|tour|stage|performance|festival|fest|group|band|montage/)) score += 6;
        if (src.includes('1280px') || src.includes('1920px')) score += 3;
        else if (src.includes('500px')) score += 1;

        if (score > bestScore) {
          bestScore = score;
          bestUrl = fullUrl;
        }
      }

      // If no score winner but image items exist, use the largest non-avatar image
      if (!bestUrl && items.length > 0) {
        const fallbackItem = items.find(i => {
          const s = i.srcset?.[i.srcset.length - 1]?.src || i.srcset?.[0]?.src || '';
          const u = s.startsWith('//') ? `https:${s}` : s;
          return !avatarUrl || !u.toLowerCase().includes(avatarUrl.toLowerCase().slice(-24));
        }) || items[0];
        const s = fallbackItem.srcset?.[fallbackItem.srcset.length - 1]?.src || fallbackItem.srcset?.[0]?.src;
        if (s) {
          bestUrl = s.startsWith('//') ? `https:${s}` : s;
        }
      }

      return bestUrl;
    } catch {
      return null;
    }
  }

  /**
   * Fetch distinct wide live concert banner from Wikimedia Commons via externalFetch
   * @private
   */
  async _fetchWikimediaConcertBanner(artistName) {
    if (!artistName) return null;
    const cleanName = this.sanitizeArtistName(artistName);
    const queries = [
      `"${cleanName}" (concert OR live OR stage OR performance OR festival)`,
      `"${cleanName}"`
    ];

    for (const q of queries) {
      try {
        const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&prop=imageinfo&iiprop=url|size&format=json&origin=*`;
        const res = await externalFetch('wikimedia', url);
        if (!res.ok) continue;
        const data = await res.json();
        const pages = Object.values(data.query?.pages || {});
        const valid = pages.filter(p => {
          const info = p.imageinfo?.[0];
          if (!info || !info.url) return false;
          if (info.url.match(/svg|sound|audio|icon|logo|flag|signature/i)) return false;
          if (info.url.includes('Tianjin_Grand_Theater') || info.url.includes('Concert_Hall')) return false;
          const title = (p.title || '').toLowerCase();
          const nameParts = cleanName.toLowerCase().split(/\s+/).filter(part => part.length > 2);
          const matchesName = nameParts.length > 0 && nameParts.some(part => title.includes(part));
          if (!matchesName) return false;
          return info.width >= 800 && info.width > info.height * 1.15;
        });

        if (valid.length > 0) {
          valid.sort((a, b) => (b.imageinfo[0].width || 0) - (a.imageinfo[0].width || 0));
          return valid[0].imageinfo[0].url;
        }
      } catch (err) {
        console.warn('Wikimedia concert banner query notice:', err);
      }
    }
    return null;
  }

  /**
   * Fetch high-resolution official album artwork online from multiple sources:
   * 1. Deezer API (comprehensive international & Indonesian catalogue)
   * 2. iTunes Search API (1200x1200px artwork)
   * 3. MusicBrainz & Cover Art Archive
   * 4. Wikipedia REST API
   * Automatically applies fetched artwork to matching tracks in the library.
   * @param {string} artistName
   * @param {string} albumName
   * @returns {Promise<string|null>}
   */
  async fetchAlbumCoverOnline(artistName, albumName) {
    if (!albumName || albumName === 'Tanpa Album' || albumName === 'Album Tidak Diketahui') return null;
    const cleanArtist = this.sanitizeArtistName(artistName);
    const cacheKey = `album_art:${(cleanArtist + '_' + albumName).toLowerCase().trim()}`;

    // 1. Check IndexedDB cache
    try {
      const cached = await db.get('settings', cacheKey);
      if (cached && cached.data) {
        await this.applyAlbumCoverToLibrary(artistName, albumName, cached.data);
        return cached.data;
      }
    } catch {}

    if (isTotalOffline()) return null;

    let highResUrl = null;

    // A. Query Deezer if allowed (exceptional for Indonesian, Asian, & indie releases)
    if (!highResUrl && isServiceAllowed('deezer')) {
      try {
        const deezerQuery = encodeURIComponent(`${cleanArtist} ${albumName}`.trim());
        const deezerUrl = `https://api.deezer.com/search/album?q=${deezerQuery}&limit=5`;
        const res = await externalFetch('deezer', deezerUrl);
        if (res.ok) {
          const json = await res.json();
          const items = json.data || [];
          if (items.length > 0) {
            const normAlb = albumName.toLowerCase().trim();
            const match = items.find(it => it.title?.toLowerCase().includes(normAlb) || normAlb.includes(it.title?.toLowerCase())) || items[0];
            highResUrl = match.cover_xl || match.cover_big || match.cover_medium || null;
          }
        }
      } catch (err) {
        console.warn('Deezer album artwork search notice:', err);
      }
    }

    // B. Query iTunes Search API if allowed (with ID country and general fallbacks)
    if (!highResUrl && isServiceAllowed('itunes')) {
      try {
        const itunesQueries = [
          `https://itunes.apple.com/search?term=${encodeURIComponent(`${cleanArtist} ${albumName}`.trim())}&entity=album&limit=5`,
          `https://itunes.apple.com/search?term=${encodeURIComponent(`${cleanArtist} ${albumName}`.trim())}&country=ID&limit=5`,
          `https://itunes.apple.com/search?term=${encodeURIComponent(`${cleanArtist} ${albumName}`.trim())}&limit=5`
        ];
        for (const url of itunesQueries) {
          if (highResUrl) break;
          const res = await externalFetch('itunes', url);
          if (res.ok) {
            const json = await res.json();
            const results = json.results || [];
            if (results.length > 0) {
              const normAlb = albumName.toLowerCase().trim();
              const match = results.find(r => 
                (r.collectionName && (r.collectionName.toLowerCase().includes(normAlb) || normAlb.includes(r.collectionName.toLowerCase()))) ||
                (r.trackName && (r.trackName.toLowerCase().includes(normAlb) || normAlb.includes(r.trackName.toLowerCase())))
              ) || results[0];
              if (match?.artworkUrl100) {
                highResUrl = match.artworkUrl100.replace('100x100bb.jpg', '1200x1200bb.jpg');
                break;
              }
            }
          }
        }
      } catch (err) {
        console.warn('iTunes album artwork search notice:', err);
      }
    }

    // C. Query MusicBrainz & Cover Art Archive if allowed
    if (!highResUrl && isServiceAllowed('musicbrainz')) {
      try {
        const mbUrl = `https://musicbrainz.org/ws/2/release/?query=artist:${encodeURIComponent(cleanArtist)}+AND+release:${encodeURIComponent(albumName)}&fmt=json&limit=3`;
        const res = await externalFetch('musicbrainz', mbUrl);
        if (res.ok) {
          const json = await res.json();
          const releases = json.releases || [];
          if (releases.length > 0 && releases[0].id) {
            highResUrl = `https://coverartarchive.org/release/${releases[0].id}/front-500`;
          }
        }
      } catch (err) {
        console.warn('MusicBrainz album artwork search notice:', err);
      }
    }

    // D. Fallback to Wikipedia album thumbnail if allowed
    if (!highResUrl && isServiceAllowed('wikipedia')) {
      try {
        const wikiTitles = [
          `${cleanArtist} (${albumName})`,
          `${albumName} (album)`,
          albumName
        ];
        for (const title of wikiTitles) {
          if (highResUrl) break;
          const wData = await this._fetchWikipediaData(title, 'id') || await this._fetchWikipediaData(title, 'en');
          if (wData?.thumbnail?.source) {
            highResUrl = wData.thumbnail.source;
            break;
          }
        }
      } catch (err) {
        console.warn('Wikipedia album artwork search notice:', err);
      }
    }

    if (highResUrl) {
      try {
        await db.put('settings', { key: cacheKey, data: highResUrl });
      } catch {}
      await this.applyAlbumCoverToLibrary(artistName, albumName, highResUrl);
      return highResUrl;
    }

    return null;
  }

  /**
   * Apply fetched album cover to all tracks in library and persist to IndexedDB
   * @param {string} artistName
   * @param {string} albumName
   * @param {string} coverUrl
   */
  async applyAlbumCoverToLibrary(artistName, albumName, coverUrl) {
    if (!albumName || !coverUrl) return;
    const normAlb = albumName.toLowerCase().trim();
    const cleanArt = this.sanitizeArtistName(artistName).toLowerCase().trim();
    const coverKey = `album:${cleanArt}-${normAlb}`;

    // 1. Cache blob into covers store so it works offline
    try {
      const resp = await fetch(coverUrl);
      if (resp.ok) {
        const blob = await resp.blob();
        await coverCache.saveCover(coverKey, blob, blob.type);
      }
    } catch {}

    // 2. Propagate to all matching tracks in store & IndexedDB
    const tracks = store.get('tracks') || [];
    let updatedCount = 0;
    const updatedTracks = tracks.map(t => {
      const tAlb = (t.overrides?.album || t.metadata?.album || '').toLowerCase().trim();
      const tArt = (t.overrides?.artist || t.metadata?.artist || '').toLowerCase().trim();
      if (tAlb === normAlb && (!cleanArt || tArt.includes(cleanArt) || cleanArt.includes(tArt) || !tArt)) {
        if (!t.metadata) t.metadata = {};
        t.metadata.pictureUrl = coverUrl;
        t.metadata.pictureKey = coverKey;
        t.metadata.hasCover = true;
        updatedCount++;
      }
      return t;
    });

    if (updatedCount > 0) {
      store.set('tracks', updatedTracks);
      try {
        await db.bulkPut('tracks', updatedTracks);
      } catch {}
      events.emit('library:updated', { tracks: updatedTracks });
    }
  }

  /**
   * Helper to parse and extract unique individual artists from track library
   * @param {Array} tracks
   * @returns {string[]}
   */
  getUniqueArtists(tracks = []) {
    const set = new Set();
    for (const t of tracks) {
      const artistStr = (t.overrides?.artist || t.metadata?.artist || t.artist || '').trim();
      if (!artistStr || artistStr === 'Unknown Artist' || artistStr === 'Artis Tidak Diketahui') continue;
      const parts = artistStr.split(';').map(a => a.trim()).filter(Boolean);
      for (const p of parts) {
        set.add(p);
      }
    }
    return Array.from(set).sort();
  }

  /**
   * Helper to extract unique albums from track library
   * @param {Array} tracks
   * @returns {Array<{ artist: string, album: string, cover: string|null }>}
   */
  getUniqueAlbums(tracks = []) {
    const map = new Map();
    for (const t of tracks) {
      const album = (t.overrides?.album || t.metadata?.album || t.album || '').trim();
      if (!album || album === 'Tanpa Album' || album === 'Unknown Album' || album === 'Album Tidak Diketahui') continue;
      const artistRaw = (t.overrides?.artist || t.metadata?.artist || t.artist || 'Unknown Artist').trim();
      const artist = (artistRaw.split(';')[0] || artistRaw).trim();
      const key = `${artist} - ${album}`.toLowerCase();
      if (!map.has(key)) {
        const cover = t.overrides?.pictureUrl || t.metadata?.pictureUrl || t.cover || null;
        map.set(key, { artist, album, cover });
      }
    }
    return Array.from(map.values());
  }

  /**
   * Fetch only artist profile picture (avatar) and update existing cache record
   * @param {string} artistName
   * @param {boolean} forceRefresh
   * @returns {Promise<Object>}
   */
  async fetchArtistProfileOnly(artistName, forceRefresh = true) {
    if (!artistName || typeof artistName !== 'string') return null;
    const cleanName = this.sanitizeArtistName(artistName);
    const existing = await this.getArtistMeta(artistName, false) || this.createEmptyMeta(artistName);
    let avatarUrl = '';

    // A. Query Deezer if allowed
    if (isServiceAllowed('deezer')) {
      try {
        const deezerData = await this._fetchDeezerData(cleanName);
        if (deezerData?.avatarUrl) {
          avatarUrl = deezerData.avatarUrl;
          if (deezerData.nb_fan) existing.fans = deezerData.nb_fan;
        }
      } catch (err) {
        console.warn('Deezer profile fetch notice:', cleanName, err);
      }
    }

    // B. Fallback to Wikipedia thumbnail if allowed
    if (!avatarUrl && isServiceAllowed('wikipedia')) {
      try {
        const wikiData = await this._fetchWikipediaData(cleanName, 'id') || await this._fetchWikipediaData(cleanName, 'en');
        if (wikiData?.thumbnail?.source) {
          avatarUrl = wikiData.thumbnail.source;
        }
      } catch (err) {
        console.warn('Wikipedia profile fetch notice:', cleanName, err);
      }
    }

    if (avatarUrl) {
      existing.avatarUrl = avatarUrl;
      existing.lastUpdated = Date.now();
      this.memoryCache.set(artistName, existing);
      const cacheKey = `artist_meta:${artistName.toLowerCase().trim()}`;
      try {
        await db.put('settings', { key: cacheKey, data: existing });
      } catch {}
    }

    return existing;
  }

  /**
   * Fetch only artist stage/concert banner and update existing cache record
   * @param {string} artistName
   * @param {boolean} forceRefresh
   * @returns {Promise<Object>}
   */
  async fetchArtistBannerOnly(artistName, forceRefresh = true) {
    if (!artistName || typeof artistName !== 'string') return null;
    const cleanName = this.sanitizeArtistName(artistName);
    const existing = await this.getArtistMeta(artistName, false) || this.createEmptyMeta(artistName);
    let bannerUrl = '';

    // A. Query Wikimedia Commons concert banner if allowed
    if (isServiceAllowed('wikimedia')) {
      try {
        bannerUrl = await this._fetchWikimediaConcertBanner(cleanName);
      } catch (err) {
        console.warn('Wikimedia banner fetch notice:', cleanName, err);
      }
    }

    // B. Fallback to Wikipedia media list banner if allowed
    if (!bannerUrl && isServiceAllowed('wikipedia')) {
      try {
        bannerUrl = await this._fetchWikipediaBanner(cleanName, 'id', existing.avatarUrl) ||
                     await this._fetchWikipediaBanner(cleanName, 'en', existing.avatarUrl);
      } catch (err) {
        console.warn('Wikipedia banner fetch notice:', cleanName, err);
      }
    }

    if (bannerUrl) {
      existing.bannerUrl = bannerUrl;
      existing.lastUpdated = Date.now();
      this.memoryCache.set(artistName, existing);
      const cacheKey = `artist_meta:${artistName.toLowerCase().trim()}`;
      try {
        await db.put('settings', { key: cacheKey, data: existing });
      } catch {}
    }

    return existing;
  }

  /**
   * Batch fetch artist profiles with progress callback
   * @param {Function} [onProgress] - callback({ type, current, total, item, percent })
   * @returns {Promise<{ updated: number, total: number }>}
   */
  async batchFetchProfiles(onProgress) {
    const tracks = store.get('tracks') || [];
    const artists = this.getUniqueArtists(tracks);
    let updated = 0;
    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      const percent = Math.round(((i + 1) / (artists.length || 1)) * 100);
      onProgress?.({
        type: 'profile',
        current: i + 1,
        total: artists.length,
        item: artist,
        percent
      });
      try {
        const res = await this.fetchArtistProfileOnly(artist, true);
        if (res?.avatarUrl) updated++;
      } catch (err) {
        console.warn('Batch fetch profile notice:', artist, err);
      }
    }
    return { updated, total: artists.length };
  }

  /**
   * Batch fetch artist banners with progress callback
   * @param {Function} [onProgress] - callback({ type, current, total, item, percent })
   * @returns {Promise<{ updated: number, total: number }>}
   */
  async batchFetchBanners(onProgress) {
    const tracks = store.get('tracks') || [];
    const artists = this.getUniqueArtists(tracks);
    let updated = 0;
    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      const percent = Math.round(((i + 1) / (artists.length || 1)) * 100);
      onProgress?.({
        type: 'banner',
        current: i + 1,
        total: artists.length,
        item: artist,
        percent
      });
      try {
        const res = await this.fetchArtistBannerOnly(artist, true);
        if (res?.bannerUrl) updated++;
      } catch (err) {
        console.warn('Batch fetch banner notice:', artist, err);
      }
    }
    return { updated, total: artists.length };
  }

  /**
   * Batch fetch album covers with progress callback
   * @param {Function} [onProgress] - callback({ type, current, total, item, percent })
   * @returns {Promise<{ updated: number, total: number }>}
   */
  async batchFetchAlbums(onProgress) {
    const tracks = store.get('tracks') || [];
    const albums = this.getUniqueAlbums(tracks);
    let updated = 0;
    for (let i = 0; i < albums.length; i++) {
      const alb = albums[i];
      const percent = Math.round(((i + 1) / (albums.length || 1)) * 100);
      onProgress?.({
        type: 'album',
        current: i + 1,
        total: albums.length,
        item: `${alb.artist} - ${alb.album}`,
        percent
      });
      try {
        const coverUrl = await this.fetchAlbumCoverOnline(alb.artist, alb.album);
        if (coverUrl) updated++;
      } catch (err) {
        console.warn('Batch fetch album notice:', alb.album, err);
      }
    }
    return { updated, total: albums.length };
  }

  /**
   * Batch fetch all metadata (Profiles, Banners, and Album Covers) sequentially
   * @param {Function} [onProgress] - callback({ type, current, total, item, percent })
   * @returns {Promise<{ profiles: Object, banners: Object, albums: Object }>}
   */
  async batchFetchAll(onProgress) {
    const tracks = store.get('tracks') || [];
    const artists = this.getUniqueArtists(tracks);
    const albums = this.getUniqueAlbums(tracks);
    const grandTotal = (artists.length * 2) + albums.length;
    let stepCount = 0;

    const report = (type, item) => {
      stepCount++;
      const percent = Math.min(100, Math.round((stepCount / (grandTotal || 1)) * 100));
      onProgress?.({
        type,
        current: stepCount,
        total: grandTotal,
        item,
        percent
      });
    };

    let pUpdated = 0;
    for (const a of artists) {
      report('profile', a);
      try {
        const res = await this.fetchArtistProfileOnly(a, true);
        if (res?.avatarUrl) pUpdated++;
      } catch {}
    }

    let bUpdated = 0;
    for (const a of artists) {
      report('banner', a);
      try {
        const res = await this.fetchArtistBannerOnly(a, true);
        if (res?.bannerUrl) bUpdated++;
      } catch {}
    }

    let aUpdated = 0;
    for (const alb of albums) {
      report('album', `${alb.artist} - ${alb.album}`);
      try {
        const c = await this.fetchAlbumCoverOnline(alb.artist, alb.album);
        if (c) aUpdated++;
      } catch {}
    }

    return {
      profiles: { updated: pUpdated, total: artists.length },
      banners: { updated: bUpdated, total: artists.length },
      albums: { updated: aUpdated, total: albums.length }
    };
  }

  _capitalizeTag(str) {
    if (!str) return '';
    return str.replace(/\b\w/g, c => c.toUpperCase());
  }

  createEmptyMeta(artistName) {
    return {
      artistName: artistName || 'Unknown Artist',
      cleanName: artistName || 'Unknown Artist',
      title: artistName || 'Unknown Artist',
      description: '',
      bio: '',
      avatarUrl: '',
      bannerUrl: '',
      wikiUrl: '',
      deezerUrl: '',
      country: '',
      type: '',
      genres: [],
      source: 'Local',
      lastUpdated: 0
    };
  }
}

export const artistMetaService = new ArtistMetaService();
