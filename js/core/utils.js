/**
 * utils.js - General utility, formatting, and hashing helpers
 */

/**
 * Format duration in seconds to "m:ss" or "h:mm:ss"
 * @param {number} sec 
 * @returns {string}
 */
export function formatDuration(sec) {
  if (isNaN(sec) || sec <= 0) return '0:00';
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);

  if (hours > 0) {
    return `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/**
 * Format sample rate in Hz to kHz or MHz (for DSD)
 * @param {number} hz 
 * @returns {string}
 */
export function formatSampleRate(hz) {
  if (!hz || isNaN(hz)) return '44.1 kHz';
  if (hz >= 1000000) {
    return `${(hz / 1000000).toFixed(2)} MHz`;
  }
  return `${(hz / 1000).toFixed(1)} kHz`;
}

/**
 * Format file size in bytes to human-readable string
 * @param {number} bytes 
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

/**
 * Escape HTML entities to prevent XSS
 * @param {string} str 
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

/**
 * Debounce a function call
 * @param {Function} func 
 * @param {number} wait 
 * @returns {Function}
 */
export function debounce(func, wait = 250) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Fast deterministic string hash (djb2)
 * @param {string} str 
 * @returns {string}
 */
export function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(16);
}

/**
 * Generate a stable, resilient Track ID based on file fingerprint
 * (filename + size + duration/sampleRate) to survive directory moves or rescans.
 * @param {string} fileName 
 * @param {number} size 
 * @param {string} [title]
 * @param {string} [artist]
 * @returns {string}
 */
export function generateStableTrackId(fileName, size, title = '', artist = '') {
  const normFile = (fileName || '').toLowerCase().trim();
  const normTitle = (title || '').toLowerCase().trim();
  const normArtist = (artist || '').toLowerCase().trim();
  const payload = `${normFile}|${size}|${normTitle}|${normArtist}`;
  return 'trk_' + hashString(payload);
}

/**
 * Extract 1-2 initials from an artist or entity name
 * @param {string} name 
 * @returns {string}
 */
export function getArtistInitials(name) {
  if (!name || name === 'Unknown Artist') return '?';
  const clean = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Generate a deterministic dark luxury gradient for artist placeholders
 * @param {string} name 
 * @returns {string}
 */
export function getDarkArtistGradient(name) {
  let hash = 0;
  const str = name || '';
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const palettes = [
    ['#1e293b', '#0f172a'],
    ['#1e1b4b', '#0f172a'],
    ['#132836', '#09141d'],
    ['#1f2937', '#111827'],
    ['#1c1917', '#0c0a09'],
    ['#201633', '#0d0918'],
    ['#142b26', '#091512'],
    ['#2d1b28', '#140c12']
  ];
  const idx = Math.abs(hash) % palettes.length;
  const [c1, c2] = palettes[idx];
  return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}

/**
 * Parse multi-artist string separated by ';' into individual artist names
 * @param {string} artistStr 
 * @returns {string[]}
 */
export function parseArtistNames(artistStr) {
  if (!artistStr || typeof artistStr !== 'string') return [];
  return artistStr
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Render multi-artist HTML with individual clickable links separated by ';'
 * @param {string} artistStr 
 * @returns {string}
 */
export function renderArtistLinks(artistStr) {
  const list = parseArtistNames(artistStr);
  if (list.length === 0) {
    const fallback = artistStr ? escapeHtml(artistStr.trim()) : 'Unknown Artist';
    return `<span class="clickable-artist" data-artist="${fallback}">${fallback}</span>`;
  }
  return list
    .map(name => `<span class="clickable-artist" data-artist="${escapeHtml(name)}">${escapeHtml(name)}</span>`)
    .join('; ');
}

/**
 * Check if a track has a specific artist in its metadata or overrides (supports multi-artist ;)
 * @param {Object} track 
 * @param {string} targetArtist 
 * @returns {boolean}
 */
export function trackHasArtist(track, targetArtist) {
  if (!track || !targetArtist) return false;
  const raw = track.overrides?.artist || track.metadata?.artist || '';
  if (raw === targetArtist) return true;
  const list = parseArtistNames(raw);
  return list.includes(targetArtist);
}

