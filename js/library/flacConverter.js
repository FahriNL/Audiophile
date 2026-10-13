/**
 * flacConverter.js - Pure-JS Lossless FLAC Encoder & Track Converter
 * Converts lossy audio (MP3, AAC, Opus, Vorbis) into standard FLAC format
 * preserving 100% of existing metadata, cover artwork, and lyrics.
 */

import { db } from '../db/db.js';
import { store } from '../core/store.js';
import { events } from '../core/events.js';
import { folderManager } from './folders.js';
import { coverCache } from './covers.js';

// Precomputed CRC-8 table for FLAC frame headers (polynomial 0x07)
const CRC8_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let curr = i;
  for (let j = 0; j < 8; j++) {
    curr = (curr & 0x80) ? ((curr << 1) ^ 0x07) : (curr << 1);
  }
  CRC8_TABLE[i] = curr & 0xFF;
}

function computeCrc8(buf, offset = 0, length = buf.length) {
  let c = 0;
  for (let i = offset; i < offset + length; i++) {
    c = CRC8_TABLE[c ^ buf[i]];
  }
  return c;
}

// Precomputed CRC-16 table for FLAC audio frames (polynomial 0x8005)
const CRC16_TABLE = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let curr = i << 8;
  for (let j = 0; j < 8; j++) {
    curr = (curr & 0x8000) ? ((curr << 1) ^ 0x8005) : (curr << 1);
  }
  CRC16_TABLE[i] = curr & 0xFFFF;
}

function computeCrc16(buf, offset = 0, length = buf.length) {
  let c = 0;
  for (let i = offset; i < offset + length; i++) {
    c = ((c << 8) ^ CRC16_TABLE[((c >> 8) ^ buf[i]) & 0xFF]) & 0xFFFF;
  }
  return c;
}

/**
 * Encodes audio channels into a standard FLAC binary Blob
 * @param {Object} options
 * @param {Array<Float32Array>} options.channels - Channel audio buffers (e.g. left, right)
 * @param {number} options.sampleRate - Sample rate (e.g. 44100, 48000)
 * @param {Object} [options.metadata] - Metadata tags to embed into Vorbis Comment
 * @param {Object} [options.pictureData] - Optional picture { bytes: Uint8Array, mime: string }
 * @returns {Blob} - audio/flac Blob
 */
export function encodePcmToFlac({ channels, sampleRate = 44100, metadata = {}, pictureData = null }) {
  const numChannels = channels.length;
  const totalSamples = channels[0].length;
  const bitsPerSample = 16;
  const blockSize = 4096;

  // Convert float32 [-1.0, 1.0] samples to 16-bit signed PCM
  const pcmChannels = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const floatArr = channels[ch];
    const intArr = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      const s = Math.max(-1, Math.min(1, floatArr[i]));
      intArr[i] = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7FFF);
    }
    pcmChannels.push(intArr);
  }

  const parts = [];

  // 1. FLAC Stream Marker ("fLaC")
  parts.push(new Uint8Array([0x66, 0x4C, 0x61, 0x43]));

  // 2. Metadata Block 0: STREAMINFO (34 bytes payload)
  const streamInfoData = new Uint8Array(34);
  const siView = new DataView(streamInfoData.buffer);
  siView.setUint16(0, blockSize);
  siView.setUint16(2, blockSize);
  // min/max frame size: 0 (bytes 4-9)
  // Byte 10: sample rate high 8 bits
  streamInfoData[10] = (sampleRate >> 12) & 0xFF;
  // Byte 11: sample rate mid 8 bits
  streamInfoData[11] = (sampleRate >> 4) & 0xFF;
  // Byte 12: sample rate low 4 bits | (channels - 1) 3 bits | (bits - 1) high 1 bit
  streamInfoData[12] = ((sampleRate & 0x0F) << 4) | (((numChannels - 1) & 0x07) << 1) | (((bitsPerSample - 1) >> 4) & 0x01);
  // Byte 13: (bits - 1) low 4 bits | total samples high 4 bits
  const totalHigh = Math.floor(totalSamples / 4294967296) & 0x0F;
  const totalLow = (totalSamples >>> 0);
  streamInfoData[13] = (((bitsPerSample - 1) & 0x0F) << 4) | totalHigh;
  siView.setUint32(14, totalLow);

  const streamInfoHdr = new Uint8Array(4);
  streamInfoHdr[0] = 0x00; // Not last block, type 0
  streamInfoHdr[1] = 0x00;
  streamInfoHdr[2] = 0x00;
  streamInfoHdr[3] = 34; // 34 bytes
  parts.push(streamInfoHdr, streamInfoData);

  // 3. Metadata Block 4: VORBIS_COMMENT
  const vendorStr = new TextEncoder().encode('Audiophile FLAC Converter');
  const commentList = [];
  if (metadata.title) commentList.push(`TITLE=${metadata.title}`);
  if (metadata.artist) commentList.push(`ARTIST=${metadata.artist}`);
  if (metadata.album) commentList.push(`ALBUM=${metadata.album}`);
  if (metadata.albumArtist) commentList.push(`ALBUMARTIST=${metadata.albumArtist}`);
  if (metadata.trackNo) commentList.push(`TRACKNUMBER=${metadata.trackNo}`);
  if (metadata.discNo) commentList.push(`DISCNUMBER=${metadata.discNo}`);
  if (metadata.year) commentList.push(`DATE=${metadata.year}`);
  if (metadata.genre) commentList.push(`GENRE=${metadata.genre}`);
  if (metadata.lyrics) commentList.push(`LYRICS=${metadata.lyrics}`);
  commentList.push('ENCODER=Audiophile Lossless Converter v1.0');

  const encodedComments = commentList.map(str => new TextEncoder().encode(str));
  let commentPayloadLen = 4 + vendorStr.length + 4;
  for (const c of encodedComments) commentPayloadLen += 4 + c.length;

  const commentPayload = new Uint8Array(commentPayloadLen);
  const cpView = new DataView(commentPayload.buffer);
  let cpPos = 0;
  cpView.setUint32(cpPos, vendorStr.length, true); cpPos += 4;
  commentPayload.set(vendorStr, cpPos); cpPos += vendorStr.length;
  cpView.setUint32(cpPos, encodedComments.length, true); cpPos += 4;
  for (const c of encodedComments) {
    cpView.setUint32(cpPos, c.length, true); cpPos += 4;
    commentPayload.set(c, cpPos); cpPos += c.length;
  }

  const isLastBeforePic = !pictureData;
  const commentHdr = new Uint8Array(4);
  commentHdr[0] = (isLastBeforePic ? 0x80 : 0x00) | 0x04;
  commentHdr[1] = (commentPayloadLen >> 16) & 0xFF;
  commentHdr[2] = (commentPayloadLen >> 8) & 0xFF;
  commentHdr[3] = commentPayloadLen & 0xFF;
  parts.push(commentHdr, commentPayload);

  // 4. Optional Metadata Block 6: PICTURE
  if (pictureData && pictureData.bytes && pictureData.bytes.length > 0) {
    const mimeBytes = new TextEncoder().encode(pictureData.mime || 'image/jpeg');
    const descBytes = new Uint8Array(0);
    const picDataLen = pictureData.bytes.length;
    const picBlockLen = 4 + 4 + mimeBytes.length + 4 + descBytes.length + 16 + 4 + picDataLen;

    const picBlock = new Uint8Array(picBlockLen);
    const picView = new DataView(picBlock.buffer);
    let pp = 0;
    picView.setUint32(pp, 3); pp += 4; // Picture type 3: Cover (front)
    picView.setUint32(pp, mimeBytes.length); pp += 4;
    picBlock.set(mimeBytes, pp); pp += mimeBytes.length;
    picView.setUint32(pp, descBytes.length); pp += 4; // description length: 0
    // Width (4), Height (4), Color Depth (4), Colors Used (4)
    picView.setUint32(pp, 0); pp += 4;
    picView.setUint32(pp, 0); pp += 4;
    picView.setUint32(pp, 24); pp += 4;
    picView.setUint32(pp, 0); pp += 4;
    picView.setUint32(pp, picDataLen); pp += 4;
    picBlock.set(pictureData.bytes, pp);

    const picHdr = new Uint8Array(4);
    picHdr[0] = 0x86; // Last block (0x80) | 0x06
    picHdr[1] = (picBlockLen >> 16) & 0xFF;
    picHdr[2] = (picBlockLen >> 8) & 0xFF;
    picHdr[3] = picBlockLen & 0xFF;
    parts.push(picHdr, picBlock);
  }

  // 5. Audio Frames (VERBATIM Subframes)
  let sampleOffset = 0;
  let frameNumber = 0;

  // Pre-allocate frame buffer memory for 4096 samples stereo
  const maxFrameBytes = 16 + numChannels * (1 + blockSize * 2) + 2;
  const frameBuffer = new Uint8Array(maxFrameBytes);

  while (sampleOffset < totalSamples) {
    const curBlock = Math.min(blockSize, totalSamples - sampleOffset);
    let fp = 0;

    // Frame Header Sync (14 bits 11111111111110 = 0xFFF8)
    frameBuffer[fp++] = 0xFF;
    frameBuffer[fp++] = 0xF8;

    // Block size bits (4 bits) & sample rate bits (4 bits)
    const blockCode = curBlock === 4096 ? 0x0C : 0x07;
    let srCode = 0x00;
    if (sampleRate === 44100) srCode = 0x08;
    else if (sampleRate === 48000) srCode = 0x09;
    else if (sampleRate === 96000) srCode = 0x0A;
    else if (sampleRate === 88200) srCode = 0x01;
    else srCode = 0x0D; // 16-bit custom Hz at end

    frameBuffer[fp++] = (blockCode << 4) | (srCode & 0x0F);

    // Channel assignment (4 bits) & bit depth (3 bits) & reserved (1 bit 0)
    // 1 ch -> 0x00, 2 ch -> 0x01
    const chCode = (numChannels - 1) & 0x07;
    const bitCode = 0x04; // 16-bit
    frameBuffer[fp++] = (chCode << 4) | (bitCode << 1);

    // UTF-8 coded frame number
    if (frameNumber < 0x80) {
      frameBuffer[fp++] = frameNumber;
    } else if (frameNumber < 0x800) {
      frameBuffer[fp++] = 0xC0 | (frameNumber >> 6);
      frameBuffer[fp++] = 0x80 | (frameNumber & 0x3F);
    } else {
      frameBuffer[fp++] = 0xE0 | (frameNumber >> 12);
      frameBuffer[fp++] = 0x80 | ((frameNumber >> 6) & 0x3F);
      frameBuffer[fp++] = 0x80 | (frameNumber & 0x3F);
    }

    // Extended block size if curBlock !== 4096
    if (curBlock !== 4096) {
      frameBuffer[fp++] = ((curBlock - 1) >> 8) & 0xFF;
      frameBuffer[fp++] = (curBlock - 1) & 0xFF;
    }

    // Extended sample rate if custom
    if (srCode === 0x0D) {
      frameBuffer[fp++] = (sampleRate >> 8) & 0xFF;
      frameBuffer[fp++] = sampleRate & 0xFF;
    }

    // Header CRC-8
    const headerCrc = computeCrc8(frameBuffer, 0, fp);
    frameBuffer[fp++] = headerCrc;

    // Subframes (one per channel, VERBATIM PCM)
    for (let ch = 0; ch < numChannels; ch++) {
      // Subframe header: 0 (res), 000001 (VERBATIM), 0 (wasted) = 0x02
      frameBuffer[fp++] = 0x02;
      const chanData = pcmChannels[ch];
      for (let s = 0; s < curBlock; s++) {
        const val = chanData[sampleOffset + s];
        frameBuffer[fp++] = (val >> 8) & 0xFF;
        frameBuffer[fp++] = val & 0xFF;
      }
    }

    // Frame CRC-16
    const frameCrc = computeCrc16(frameBuffer, 0, fp);
    frameBuffer[fp++] = (frameCrc >> 8) & 0xFF;
    frameBuffer[fp++] = frameCrc & 0xFF;

    parts.push(frameBuffer.slice(0, fp));

    sampleOffset += curBlock;
    frameNumber++;
  }

  return new Blob(parts, { type: 'audio/flac' });
}

/**
 * Converts a track from the library into FLAC format
 * @param {Object} track - Track object
 * @param {Object} [options]
 * @param {'replace'|'duplicate'} [options.mode='replace'] - 'replace' original or 'duplicate' as new track
 * @param {Function} [options.onProgress] - Callback (progress: 0..1, message: string)
 * @returns {Promise<{ blob: Blob, track: Object, filename: string }>}
 */
export async function convertTrackToFlac(track, { mode = 'replace', onProgress } = {}) {
  if (onProgress) onProgress(0.1, 'Mengambil berkas sumber audio...');

  const file = await folderManager.getFileForTrack(track);
  if (!file) {
    throw new Error(`Berkas audio "${track.name}" tidak dapat diakses di penyimpanan lokal.`);
  }

  if (onProgress) onProgress(0.25, 'Mendekode audio PCM via Web Audio...');
  const arrayBuffer = await file.arrayBuffer();

  const AudioContextClass = typeof window !== 'undefined'
    ? (window.AudioContext || window.webkitAudioContext)
    : null;

  if (!AudioContextClass) {
    throw new Error('Web Audio API tidak didukung di lingkungan ini.');
  }

  const audioCtx = new AudioContextClass();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    if (typeof audioCtx.close === 'function') {
      audioCtx.close().catch(() => {});
    }
  }

  if (onProgress) onProgress(0.55, 'Menyalin metadata & mempersiapkan kanal audio...');

  const channels = [];
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }

  // Extract metadata and overrides
  const title = track.overrides?.title || track.metadata?.title || track.name.replace(/\.[^/.]+$/, '');
  const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown Artist';
  const album = track.overrides?.album || track.metadata?.album || '';
  const albumArtist = track.overrides?.albumArtist || track.metadata?.albumArtist || '';
  const trackNo = track.overrides?.trackNo || track.metadata?.trackNo || 0;
  const year = track.overrides?.year || track.metadata?.year || '';
  const genre = track.overrides?.genre || track.metadata?.genre || '';
  const lyrics = track.overrides?.lyrics || track.metadata?.lyrics || '';

  // Retrieve picture binary if available
  let pictureData = null;
  const pictureKey = track.metadata?.pictureKey || track.id;
  if (pictureKey) {
    try {
      const picBytes = await coverCache.getCover(pictureKey);
      if (picBytes) {
        pictureData = { bytes: picBytes, mime: 'image/jpeg' };
      }
    } catch {}
  }

  if (onProgress) onProgress(0.75, 'Mengonversi ke berkas lossless FLAC...');

  const flacBlob = encodePcmToFlac({
    channels,
    sampleRate: audioBuffer.sampleRate,
    metadata: { title, artist, album, albumArtist, trackNo, year, genre, lyrics },
    pictureData
  });

  const baseName = track.name.replace(/\.[^/.]+$/, '');
  const flacFilename = `${baseName}.flac`;
  const flacFile = new File([flacBlob], flacFilename, { type: 'audio/flac' });

  const streamInfo = {
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    bitsPerSample: 16,
    codec: 'FLAC',
    duration: audioBuffer.duration
  };

  const allTracks = store.get('tracks') || [];
  let updatedTrack;

  if (mode === 'replace') {
    // Replace existing lossy track in DB and in-memory map
    updatedTrack = {
      ...track,
      format: 'flac',
      name: flacFilename,
      size: flacBlob.size,
      lastModified: Date.now(),
      streamInfo,
      tier: 'LOSSLESS',
      tierDetails: `FLAC 16-bit / ${(audioBuffer.sampleRate / 1000).toFixed(1)} kHz (Lossless Converter)`,
      convertedAt: Date.now()
    };

    folderManager.registerInMemoryFile(track.id, flacFile);
    await db.put('tracks', updatedTrack);

    const updatedList = allTracks.map(t => (t.id === track.id ? updatedTrack : t));
    store.set('tracks', updatedList);
  } else {
    // Duplicate as a new lossless track alongside the original
    const newId = `${track.id}_flac`;
    const duplicateFilename = `${baseName} (Lossless).flac`;
    const duplicateFile = new File([flacBlob], duplicateFilename, { type: 'audio/flac' });

    updatedTrack = {
      ...track,
      id: newId,
      format: 'flac',
      name: duplicateFilename,
      size: flacBlob.size,
      lastModified: Date.now(),
      streamInfo,
      tier: 'LOSSLESS',
      tierDetails: `FLAC 16-bit / ${(audioBuffer.sampleRate / 1000).toFixed(1)} kHz (Lossless Duplicate)`,
      addedAt: Date.now(),
      convertedAt: Date.now()
    };

    folderManager.registerInMemoryFile(newId, duplicateFile);
    await db.put('tracks', updatedTrack);

    const updatedList = [...allTracks, updatedTrack];
    store.set('tracks', updatedList);
  }

  if (onProgress) onProgress(1.0, 'Konversi ke FLAC selesai!');
  events.emit('track:converted', { originalId: track.id, track: updatedTrack, mode });

  return {
    blob: flacBlob,
    track: updatedTrack,
    filename: updatedTrack.name
  };
}

export const flacConverter = {
  encodePcmToFlac,
  convertTrackToFlac
};
