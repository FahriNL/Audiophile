/**
 * m3u.js - Import and export extended M3U / M3U8 playlists
 */

export class M3UHandler {
  /**
   * Export an array of tracks to an Extended M3U formatted string
   * @param {string} playlistName 
   * @param {Array<Object>} tracks 
   * @returns {string}
   */
  static exportM3U(playlistName, tracks = []) {
    const lines = [
      '#EXTM3U',
      `#PLAYLIST:${playlistName}`
    ];

    for (const track of tracks) {
      const dur = Math.round(track.streamInfo?.duration || 0);
      const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown';
      const title = track.overrides?.title || track.metadata?.title || track.name;
      const path = track.relativePath || track.name;

      lines.push(`#EXTINF:${dur},${artist} - ${title}`);
      lines.push(path);
    }

    return lines.join('\n');
  }

  /**
   * Parse M3U content and match against library tracks by path or artist + title
   * @param {string} content 
   * @param {Array<Object>} libraryTracks 
   * @returns {{ matchedTrackIds: Array<string>, unmatchedLines: Array<string> }}
   */
  static parseM3U(content, libraryTracks = []) {
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const matchedTrackIds = [];
    const unmatchedLines = [];

    let currentInf = null;

    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) {
        currentInf = line.substring(8);
      } else if (line.startsWith('#')) {
        // Skip comments or #EXTM3U
        continue;
      } else {
        // This is a file path / URL line
        const filePath = line;
        const fileName = filePath.split(/[/\\]/).pop().toLowerCase();

        // 1. Try match by relativePath or name
        let matched = libraryTracks.find(t => {
          const tPath = (t.relativePath || t.name).toLowerCase();
          const tName = t.name.toLowerCase();
          return tPath === filePath.toLowerCase() || tName === fileName;
        });

        // 2. Fallback match by artist - title if EXTINF was present
        if (!matched && currentInf) {
          const commaIdx = currentInf.indexOf(',');
          if (commaIdx !== -1) {
            const trackDesc = currentInf.substring(commaIdx + 1).toLowerCase();
            matched = libraryTracks.find(t => {
              const full = `${t.metadata?.artist} - ${t.metadata?.title}`.toLowerCase();
              return full === trackDesc || trackDesc.includes(t.metadata?.title?.toLowerCase());
            });
          }
        }

        if (matched) {
          matchedTrackIds.push(matched.id);
        } else {
          unmatchedLines.push(line);
        }

        currentInf = null;
      }
    }

    return { matchedTrackIds, unmatchedLines };
  }
}
