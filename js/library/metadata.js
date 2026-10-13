/**
 * metadata.js - Zero-dependency binary parsers for FLAC, WAV, ID3v2, MP4/ALAC, and DSD
 */

export const MetadataParser = {
  decodeText(bytes, encoding = 'utf-8') {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch {
      let str = '';
      for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
      return str;
    }
  },

  readSynchsafe(view, offset) {
    return (
      (view.getUint8(offset) << 21) |
      (view.getUint8(offset + 1) << 14) |
      (view.getUint8(offset + 2) << 7) |
      view.getUint8(offset + 3)
    );
  },

  // FLAC STREAMINFO + Vorbis Comment + Embedded Picture
  async parseFLAC(file) {
    const buffer = await file.slice(0, 1024 * 1024).arrayBuffer();
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    if (bytes[0] !== 0x66 || bytes[1] !== 0x4C || bytes[2] !== 0x61 || bytes[3] !== 0x43) {
      throw new Error('Header FLAC tidak valid');
    }

    let offset = 4;
    let isLast = false;
    let streamInfo = null;
    let comments = {};
    let pictureData = null;

    while (offset < view.byteLength && !isLast) {
      const headerByte = view.getUint8(offset);
      isLast = (headerByte & 0x80) !== 0;
      const blockType = headerByte & 0x7F;
      const blockLength = (view.getUint8(offset + 1) << 16) | (view.getUint8(offset + 2) << 8) | view.getUint8(offset + 3);
      const blockStart = offset + 4;

      if (blockType === 0 && blockLength >= 34) {
        // STREAMINFO
        const b10 = view.getUint8(blockStart + 10);
        const b11 = view.getUint8(blockStart + 11);
        const b12 = view.getUint8(blockStart + 12);
        const b13 = view.getUint8(blockStart + 13);
        const sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);
        const channels = ((b12 >> 1) & 0x07) + 1;
        const bitsPerSample = (((b12 & 0x01) << 4) | (b13 >> 4)) + 1;
        const totalSamplesHigh = b13 & 0x0F;
        const totalSamplesLow = view.getUint32(blockStart + 14);
        const totalSamples = (totalSamplesHigh * 4294967296) + totalSamplesLow;
        const duration = sampleRate > 0 ? (totalSamples / sampleRate) : 0;
        streamInfo = { sampleRate, channels, bitsPerSample, totalSamples, duration, codec: 'FLAC' };
      } else if (blockType === 4 && blockStart + blockLength <= view.byteLength) {
        // VORBIS_COMMENT
        let p = blockStart;
        const vendorLen = view.getUint32(p, true);
        p += 4 + vendorLen;
        const count = view.getUint32(p, true);
        p += 4;
        for (let c = 0; c < count; c++) {
          if (p + 4 > blockStart + blockLength) break;
          const commLen = view.getUint32(p, true);
          p += 4;
          if (p + commLen > blockStart + blockLength) break;
          const commStr = MetadataParser.decodeText(bytes.subarray(p, p + commLen));
          p += commLen;
          const eqIdx = commStr.indexOf('=');
          if (eqIdx > 0) {
            const k = commStr.substring(0, eqIdx).toUpperCase();
            const v = commStr.substring(eqIdx + 1);
            comments[k] = v;
          }
        }
      } else if (blockType === 6) {
        // PICTURE
        try {
          let pView = view;
          let pBytes = bytes;
          let p = blockStart;

          if (blockStart + blockLength > view.byteLength) {
            const picSlice = await file.slice(offset, Math.min(file.size, offset + 4 + blockLength)).arrayBuffer();
            pView = new DataView(picSlice);
            pBytes = new Uint8Array(picSlice);
            p = 4;
          }

          const picType = pView.getUint32(p);
          p += 4;
          const mimeLen = pView.getUint32(p);
          p += 4;
          const mime = MetadataParser.decodeText(pBytes.subarray(p, p + mimeLen)) || 'image/jpeg';
          p += mimeLen;
          const descLen = pView.getUint32(p);
          p += 4 + descLen + 16;
          const dataLen = pView.getUint32(p);
          p += 4;
          if (picType === 3 || !pictureData) {
            const picBytes = pBytes.subarray(p, p + dataLen);
            pictureData = { mime, bytes: new Uint8Array(picBytes) };
          }
        } catch {}
      }
      offset = blockStart + blockLength;
    }

    return {
      streamInfo: streamInfo || { sampleRate: 44100, channels: 2, bitsPerSample: 16, duration: 0, codec: 'FLAC' },
      metadata: {
        title: comments['TITLE'] || '',
        artist: comments['ARTIST'] || '',
        albumArtist: comments['ALBUMARTIST'] || comments['ALBUM ARTIST'] || '',
        album: comments['ALBUM'] || '',
        trackNo: parseInt(comments['TRACKNUMBER'] || '0', 10),
        discNo: parseInt(comments['DISCNUMBER'] || '1', 10),
        year: comments['DATE'] || comments['YEAR'] || '',
        genre: comments['GENRE'] || '',
        lyrics: comments['LYRICS'] || comments['UNSYNCEDLYRICS'] || '',
        replayGainTrackGain: parseFloat(comments['REPLAYGAIN_TRACK_GAIN'] || '0') || 0,
        pictureUrl: null
      },
      pictureData
    };
  },

  // WAV / RIFF Parser
  async parseWAV(file) {
    const buffer = await file.slice(0, 128 * 1024).arrayBuffer();
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    const riff = MetadataParser.decodeText(bytes.subarray(0, 4));
    const wave = MetadataParser.decodeText(bytes.subarray(8, 12));
    if (riff !== 'RIFF' || wave !== 'WAVE') throw new Error('Bukan file WAV valid');

    let offset = 12;
    let streamInfo = null;
    let metadata = { title: '', artist: '', album: '', year: '', genre: '', pictureUrl: null };

    while (offset + 8 <= view.byteLength) {
      const chunkId = MetadataParser.decodeText(bytes.subarray(offset, offset + 4));
      const chunkSize = view.getUint32(offset + 4, true);
      const chunkStart = offset + 8;

      if (chunkId === 'fmt ') {
        const audioFormat = view.getUint16(chunkStart, true);
        const channels = view.getUint16(chunkStart + 2, true);
        const sampleRate = view.getUint32(chunkStart + 4, true);
        const bitsPerSample = view.getUint16(chunkStart + 14, true);
        streamInfo = {
          sampleRate,
          channels,
          bitsPerSample: bitsPerSample || 16,
          codec: audioFormat === 3 ? 'WAV (Float)' : 'WAV (PCM)',
          duration: 0
        };
      } else if (chunkId === 'data' && streamInfo) {
        const bytesPerSec = streamInfo.sampleRate * streamInfo.channels * (streamInfo.bitsPerSample / 8);
        if (bytesPerSec > 0) streamInfo.duration = chunkSize / bytesPerSec;
      } else if (chunkId === 'LIST' && chunkStart + 4 <= view.byteLength) {
        const listType = MetadataParser.decodeText(bytes.subarray(chunkStart, chunkStart + 4));
        if (listType === 'INFO') {
          let p = chunkStart + 4;
          const end = chunkStart + chunkSize;
          while (p + 8 <= end && p + 8 <= view.byteLength) {
            const subId = MetadataParser.decodeText(bytes.subarray(p, p + 4));
            const subLen = view.getUint32(p + 4, true);
            p += 8;
            if (p + subLen > view.byteLength) break;
            const text = MetadataParser.decodeText(bytes.subarray(p, p + subLen)).replace(/\0/g, '').trim();
            if (subId === 'INAM') metadata.title = text;
            else if (subId === 'IART') metadata.artist = text;
            else if (subId === 'IPRD') metadata.album = text;
            else if (subId === 'ICRD') metadata.year = text;
            else if (subId === 'IGNR') metadata.genre = text;
            p += subLen + (subLen % 2);
          }
        }
      }
      offset = chunkStart + chunkSize + (chunkSize % 2);
    }

    return {
      streamInfo: streamInfo || { sampleRate: 44100, channels: 2, bitsPerSample: 16, duration: 0, codec: 'WAV' },
      metadata
    };
  },

  // ID3v2 & MP3 Frame Parser
  async parseID3v2(file) {
    const initialSize = Math.min(file.size, 512 * 1024);
    let buffer = await file.slice(0, initialSize).arrayBuffer();
    let view = new DataView(buffer);
    let bytes = new Uint8Array(buffer);

    let metadata = { title: '', artist: '', albumArtist: '', album: '', trackNo: 0, year: '', genre: '', lyrics: '', pictureUrl: null };
    let streamInfo = { sampleRate: 44100, channels: 2, bitsPerSample: 16, bitrate: 320, codec: 'MP3', duration: 0 };
    let pictureData = null;

    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      const version = view.getUint8(3);
      const tagSize = MetadataParser.readSynchsafe(view, 6);

      if (10 + tagSize > initialSize) {
        const fullSize = Math.min(file.size, 10 + tagSize, 16 * 1024 * 1024);
        buffer = await file.slice(0, fullSize).arrayBuffer();
        view = new DataView(buffer);
        bytes = new Uint8Array(buffer);
      }

      let offset = 10;
      const endOffset = Math.min(10 + tagSize, view.byteLength);

      while (offset + 10 < endOffset) {
        const frameId = MetadataParser.decodeText(bytes.subarray(offset, offset + 4));
        if (frameId.charCodeAt(0) === 0) break;

        const frameSize = (version === 4) ? MetadataParser.readSynchsafe(view, offset + 4) : view.getUint32(offset + 4);
        const frameStart = offset + 10;
        if (frameStart + frameSize > endOffset) break;

        const frameData = bytes.subarray(frameStart, frameStart + frameSize);
        const encoding = frameData[0];

        if (['TIT2', 'TPE1', 'TPE2', 'TALB', 'TRCK', 'TYER', 'TDRC', 'TCON'].includes(frameId)) {
          const textBytes = frameData.subarray(1);
          const text = MetadataParser.decodeText(textBytes, (encoding === 1 || encoding === 2) ? 'utf-16' : 'utf-8').replace(/\0/g, '').trim();
          if (frameId === 'TIT2') metadata.title = text;
          else if (frameId === 'TPE1') metadata.artist = text;
          else if (frameId === 'TPE2') metadata.albumArtist = text;
          else if (frameId === 'TALB') metadata.album = text;
          else if (frameId === 'TRCK') metadata.trackNo = parseInt(text.split('/')[0] || '0', 10);
          else if (frameId === 'TYER' || frameId === 'TDRC') metadata.year = text.substring(0, 4);
          else if (frameId === 'TCON') metadata.genre = text;
        } else if (frameId === 'APIC' && !pictureData) {
          try {
            let p = 1;
            while (p < frameData.length && frameData[p] !== 0) p++;
            const mime = MetadataParser.decodeText(frameData.subarray(1, p)) || 'image/jpeg';
            p += 2; // skip mime null and picture type byte
            while (p < frameData.length && frameData[p] !== 0) p++;
            p += 1;
            if (p < frameData.length) {
              const imgData = frameData.subarray(p);
              pictureData = { mime, bytes: new Uint8Array(imgData) };
            }
          } catch {}
        } else if (frameId === 'USLT' && !metadata.lyrics) {
          try {
            const enc = frameData[0];
            let p = 4;
            while (p < frameData.length && frameData[p] !== 0) p++;
            p += (enc === 1 || enc === 2) ? 2 : 1;
            if (p < frameData.length) {
              const lyricsBytes = frameData.subarray(p);
              metadata.lyrics = MetadataParser.decodeText(lyricsBytes, (enc === 1 || enc === 2) ? 'utf-16' : 'utf-8').trim();
            }
          } catch {}
        }
        offset = frameStart + frameSize;
      }
    }

    // Scan MP3 audio frame header to get true bitrate/sampleRate
    try {
      for (let i = 0; i < bytes.length - 4; i++) {
        if (bytes[i] === 0xFF && (bytes[i + 1] & 0xE0) === 0xE0) {
          const b1 = bytes[i + 1];
          const b2 = bytes[i + 2];
          const b3 = bytes[i + 3];
          const layer = (b1 >> 1) & 0x03;
          if (layer === 1) { // Layer III
            const bitrateIdx = (b2 >> 4) & 0x0F;
            const sampleRateIdx = (b2 >> 2) & 0x03;
            const channelMode = (b3 >> 6) & 0x03;
            const sampleRates = [44100, 48000, 32000];
            const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
            if (sampleRates[sampleRateIdx] && bitrates[bitrateIdx]) {
              streamInfo.sampleRate = sampleRates[sampleRateIdx];
              streamInfo.bitrate = bitrates[bitrateIdx];
              streamInfo.channels = channelMode === 3 ? 1 : 2;
              streamInfo.duration = Math.round((file.size * 8) / (streamInfo.bitrate * 1000));
              break;
            }
          }
        }
      }
    } catch {}

    return { streamInfo, metadata, pictureData };
  },

  // MP4 / ALAC / AAC Box Parser
  async parseMP4(file) {
    const buffer = await file.slice(0, 1024 * 1024).arrayBuffer();
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    let metadata = { title: '', artist: '', albumArtist: '', album: '', year: '', genre: '', lyrics: '', trackNo: 0, pictureUrl: null };
    let streamInfo = { sampleRate: 44100, channels: 2, bitsPerSample: 16, codec: 'M4A/AAC', duration: 0 };
    let pictureData = null;

    function scanAtoms(start, end) {
      let pos = start;
      while (pos + 8 <= end) {
        const size = view.getUint32(pos);
        const type = MetadataParser.decodeText(bytes.subarray(pos + 4, pos + 8));
        if (size < 8) break;
        const cStart = pos + 8;
        const cEnd = Math.min(pos + size, end);

        if (['moov', 'udta', 'meta', 'ilst', 'mdia', 'minf', 'stbl'].includes(type)) {
          scanAtoms(type === 'meta' ? cStart + 4 : cStart, cEnd);
        } else if (type === '©nam') {
          metadata.title = extractText(cStart, cEnd);
        } else if (type === '©ART') {
          metadata.artist = extractText(cStart, cEnd);
        } else if (type === 'aART') {
          metadata.albumArtist = extractText(cStart, cEnd);
        } else if (type === '©alb') {
          metadata.album = extractText(cStart, cEnd);
        } else if (type === '©day') {
          metadata.year = extractText(cStart, cEnd).substring(0, 4);
        } else if (type === '©gen') {
          metadata.genre = extractText(cStart, cEnd);
        } else if (type === '©lyr') {
          metadata.lyrics = extractText(cStart, cEnd);
        } else if (type === 'covr' && !pictureData) {
          const pic = extractData(cStart, cEnd);
          if (pic) {
            pictureData = { mime: 'image/jpeg', bytes: new Uint8Array(pic) };
          }
        } else if (type === 'alac') {
          streamInfo.codec = 'ALAC (Apple Lossless)';
          streamInfo.bitsPerSample = 24;
        }
        pos += size;
      }
    }

    function extractText(s, e) {
      let p = s;
      while (p + 8 <= e) {
        const sz = view.getUint32(p);
        const tg = MetadataParser.decodeText(bytes.subarray(p + 4, p + 8));
        if (tg === 'data') return MetadataParser.decodeText(bytes.subarray(p + 16, p + sz)).trim();
        p += sz;
      }
      return '';
    }

    function extractData(s, e) {
      let p = s;
      while (p + 8 <= e) {
        const sz = view.getUint32(p);
        const tg = MetadataParser.decodeText(bytes.subarray(p + 4, p + 8));
        if (tg === 'data') return bytes.subarray(p + 16, p + sz);
        p += sz;
      }
      return null;
    }

    try {
      scanAtoms(0, view.byteLength);
    } catch {}

    return { streamInfo, metadata, pictureData };
  },

  // DSD (DSF / DFF) Parser
  async parseDSD(file) {
    const buffer = await file.slice(0, 1024).arrayBuffer();
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const magic = MetadataParser.decodeText(bytes.subarray(0, 4));

    let streamInfo = { sampleRate: 2822400, channels: 2, bitsPerSample: 1, codec: 'DSD (DSF/DFF)', duration: 0 };
    let metadata = { title: file.name.replace(/\.[^/.]+$/, ''), artist: 'DSD Master', album: '', year: '', genre: '', pictureUrl: null };

    if (magic === 'DSD ') {
      try {
        const sr = view.getUint32(52, true);
        const ch = view.getUint32(48, true);
        if (sr > 1000000) streamInfo.sampleRate = sr;
        if (ch > 0 && ch <= 8) streamInfo.channels = ch;
      } catch {}
    }
    return { streamInfo, metadata };
  },

  // Ogg Opus & Ogg Vorbis Parser
  async parseOpus(file) {
    const headChunkSize = Math.min(file.size, 512 * 1024);
    const buffer = await file.slice(0, headChunkSize).arrayBuffer();
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    let streamInfo = { sampleRate: 48000, channels: 2, bitsPerSample: 16, codec: 'Opus', duration: 0 };
    let metadata = {
      title: '',
      artist: '',
      albumArtist: '',
      album: '',
      trackNo: 0,
      discNo: 1,
      year: '',
      genre: '',
      lyrics: '',
      replayGainTrackGain: 0,
      pictureUrl: null
    };
    let pictureData = null;
    let preSkip = 0;

    let offset = 0;
    while (offset + 27 <= bytes.length) {
      if (bytes[offset] !== 0x4F || bytes[offset + 1] !== 0x67 || bytes[offset + 2] !== 0x67 || bytes[offset + 3] !== 0x53) {
        offset++;
        continue;
      }

      const headerType = bytes[offset + 5];
      const granuleLow = view.getUint32(offset + 6, true);
      const granuleHigh = view.getUint32(offset + 10, true);
      const granule = (granuleHigh * 4294967296) + granuleLow;

      const numSegments = bytes[offset + 26];
      let payloadLen = 0;
      for (let s = 0; s < numSegments; s++) {
        payloadLen += bytes[offset + 27 + s];
      }
      const payloadStart = offset + 27 + numSegments;
      const payloadEnd = payloadStart + payloadLen;

      if (payloadEnd > bytes.length) break;

      // 1. OpusHead / Vorbis Identification
      if (payloadLen >= 19) {
        const magic = MetadataParser.decodeText(bytes.subarray(payloadStart, payloadStart + 8));
        if (magic === 'OpusHead') {
          const channels = bytes[payloadStart + 9];
          preSkip = view.getUint16(payloadStart + 10, true);
          const inputSr = view.getUint32(payloadStart + 12, true);
          streamInfo.channels = channels || 2;
          streamInfo.sampleRate = inputSr > 0 ? inputSr : 48000;
          streamInfo.codec = 'Opus';
        }
      } else if (payloadLen >= 7) {
        const vorbisMagic = MetadataParser.decodeText(bytes.subarray(payloadStart, payloadStart + 7));
        if (vorbisMagic === '\x01vorbis') {
          streamInfo.channels = bytes[payloadStart + 11] || 2;
          streamInfo.sampleRate = view.getUint32(payloadStart + 12, true) || 44100;
          streamInfo.codec = 'Ogg Vorbis';
        }
      }

      // 2. OpusTags / Vorbis Comments
      if (payloadLen >= 8) {
        const magic = MetadataParser.decodeText(bytes.subarray(payloadStart, payloadStart + 8));
        let commentPayloadStart = -1;
        if (magic === 'OpusTags') {
          commentPayloadStart = payloadStart + 8;
        } else if (payloadLen >= 7 && MetadataParser.decodeText(bytes.subarray(payloadStart, payloadStart + 7)) === '\x03vorbis') {
          commentPayloadStart = payloadStart + 7;
        }

        if (commentPayloadStart >= 0) {
          let p = commentPayloadStart;
          if (p + 4 <= payloadEnd) {
            const vendorLen = view.getUint32(p, true);
            p += 4 + vendorLen;
            if (p + 4 <= payloadEnd) {
              const count = view.getUint32(p, true);
              p += 4;
              for (let i = 0; i < count && p + 4 <= payloadEnd; i++) {
                const commLen = view.getUint32(p, true);
                p += 4;
                if (p + commLen > payloadEnd) break;
                const commStr = MetadataParser.decodeText(bytes.subarray(p, p + commLen));
                p += commLen;
                const eqIdx = commStr.indexOf('=');
                if (eqIdx > 0) {
                  const key = commStr.substring(0, eqIdx).toUpperCase();
                  const val = commStr.substring(eqIdx + 1).trim();
                  if (key === 'TITLE') metadata.title = val;
                  else if (key === 'ARTIST') metadata.artist = val;
                  else if (key === 'ALBUM') metadata.album = val;
                  else if (key === 'ALBUMARTIST' || key === 'ALBUM ARTIST') metadata.albumArtist = val;
                  else if (key === 'TRACKNUMBER' || key === 'TRACK') metadata.trackNo = parseInt(val, 10) || 0;
                  else if (key === 'DISCNUMBER' || key === 'DISC') metadata.discNo = parseInt(val, 10) || 1;
                  else if (key === 'DATE' || key === 'YEAR') metadata.year = val.substring(0, 4);
                  else if (key === 'GENRE') metadata.genre = val;
                  else if (key === 'LYRICS' || key === 'UNSYNCEDLYRICS') metadata.lyrics = val;
                  else if (key === 'REPLAYGAIN_TRACK_GAIN') metadata.replayGainTrackGain = parseFloat(val) || 0;
                  else if (key === 'METADATA_BLOCK_PICTURE' && !pictureData) {
                    try {
                      const binStr = atob(val);
                      const picBytes = new Uint8Array(binStr.length);
                      for (let b = 0; b < binStr.length; b++) picBytes[b] = binStr.charCodeAt(b);
                      const pView = new DataView(picBytes.buffer);
                      const mimeLen = pView.getUint32(4);
                      const mime = MetadataParser.decodeText(picBytes.subarray(8, 8 + mimeLen));
                      const descLen = pView.getUint32(8 + mimeLen);
                      const dataOffset = 8 + mimeLen + 4 + descLen + 16;
                      const dataLen = pView.getUint32(dataOffset);
                      const imgData = picBytes.subarray(dataOffset + 4, dataOffset + 4 + dataLen);
                      pictureData = { mime: mime || 'image/jpeg', bytes: imgData };
                    } catch {}
                  }
                }
              }
            }
          }
        }
      }

      if ((headerType & 0x04) !== 0 && granule > preSkip) {
        streamInfo.duration = (granule - preSkip) / (streamInfo.sampleRate || 48000);
      }

      offset = payloadEnd;
    }

    if (!streamInfo.duration && file.size > headChunkSize) {
      try {
        const tailSize = Math.min(file.size, 65536);
        const tailBuf = await file.slice(file.size - tailSize, file.size).arrayBuffer();
        const tailBytes = new Uint8Array(tailBuf);
        const tailView = new DataView(tailBuf);
        for (let i = tailBytes.length - 28; i >= 0; i--) {
          if (tailBytes[i] === 0x4F && tailBytes[i + 1] === 0x67 && tailBytes[i + 2] === 0x67 && tailBytes[i + 3] === 0x53) {
            const gLow = tailView.getUint32(i + 6, true);
            const gHigh = tailView.getUint32(i + 10, true);
            const gran = (gHigh * 4294967296) + gLow;
            if (gran > preSkip) {
              streamInfo.duration = (gran - preSkip) / (streamInfo.codec === 'Opus' ? 48000 : streamInfo.sampleRate || 48000);
              break;
            }
          }
        }
      } catch {}
    }

    return { streamInfo, metadata, pictureData };
  }
};
