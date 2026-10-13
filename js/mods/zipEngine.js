/**
 * zipEngine.js - Native browser-compatible ZIP packer and unpacker
 * Utilizes standard Web Streams (CompressionStream / DecompressionStream)
 * and DataView for 100% offline, zero-dependency ZIP operations.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
}

const CRC_TABLE = createCrcTable();

/**
 * Calculate IEEE 802.3 32-bit CRC checksum for a byte array
 * @param {Uint8Array} bytes 
 * @returns {number}
 */
export function calculateCrc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Determine MIME type based on file extension
 * @param {string} filename 
 * @returns {string}
 */
export function getMimeType(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'json': return 'application/json';
    case 'css': return 'text/css';
    case 'js': return 'application/javascript';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    case 'gif': return 'image/gif';
    case 'txt': return 'text/plain';
    case 'md': return 'text/markdown';
    case 'woff2': return 'font/woff2';
    case 'woff': return 'font/woff';
    case 'ttf': return 'font/ttf';
    default: return 'application/octet-stream';
  }
}

/**
 * Unpack a ZIP archive buffer into an array of file records
 * @param {ArrayBuffer|Uint8Array|Blob} zipInput 
 * @returns {Promise<Map<string, { path: string, bytes: Uint8Array, text: string, mime: string }>>}
 */
export async function unpackZip(zipInput) {
  let buffer;
  if (zipInput instanceof ArrayBuffer) {
    buffer = new Uint8Array(zipInput);
  } else if (zipInput instanceof Uint8Array) {
    buffer = zipInput;
  } else if (typeof Blob !== 'undefined' && zipInput instanceof Blob) {
    buffer = new Uint8Array(await zipInput.arrayBuffer());
  } else {
    throw new Error('Format masukan ZIP tidak valid');
  }

  if (buffer.length < 22) {
    throw new Error('Ukuran berkas ZIP terlalu kecil atau korup');
  }

  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Scan backwards to find End of Central Directory (EOCD) signature: 0x06054b50
  let eocdOffset = -1;
  const minScan = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minScan; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Tanda tangan akhir arsip ZIP (EOCD) tidak ditemukan');
  }

  const totalEntries = dv.getUint16(eocdOffset + 10, true);
  const cdOffset = dv.getUint32(eocdOffset + 16, true);

  if (cdOffset > buffer.length) {
    throw new Error('Struktur Central Directory ZIP tidak valid');
  }

  const filesMap = new Map();
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buffer.length) break;
    const sig = dv.getUint32(cursor, true);
    if (sig !== 0x02014b50) break; // End of central directory header chain

    const method = dv.getUint16(cursor + 10, true);
    const compSize = dv.getUint32(cursor + 20, true);
    const uncompSize = dv.getUint32(cursor + 24, true);
    const nameLen = dv.getUint16(cursor + 28, true);
    const extraLen = dv.getUint16(cursor + 30, true);
    const commentLen = dv.getUint16(cursor + 32, true);
    const localOffset = dv.getUint32(cursor + 42, true);

    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLen);
    const rawName = textDecoder.decode(nameBytes).replace(/\\/g, '/');
    cursor += 46 + nameLen + extraLen + commentLen;

    // Normalize path and ignore directories or traversal attempts
    let normalizedName = rawName.replace(/^\/+/, '');
    if (normalizedName.endsWith('/') || normalizedName === '') {
      continue;
    }
    if (normalizedName.includes('../')) {
      continue; // Block unsafe directory traversal
    }

    if (localOffset + 30 > buffer.length) {
      throw new Error(`Local header offset di luar jangkauan untuk berkas: ${normalizedName}`);
    }

    const localSig = dv.getUint32(localOffset, true);
    if (localSig !== 0x04034b50) {
      throw new Error(`Tanda tangan local header salah untuk berkas: ${normalizedName}`);
    }

    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;

    if (dataStart + compSize > buffer.length) {
      throw new Error(`Data berkas terpotong untuk: ${normalizedName}`);
    }

    const compBytes = buffer.subarray(dataStart, dataStart + compSize);
    let uncompBytes;

    if (method === 0) {
      // Stored (no compression)
      uncompBytes = new Uint8Array(compBytes);
    } else if (method === 8) {
      // Deflate
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('DecompressionStream tidak didukung di lingkungan peramban ini');
      }
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(compBytes);
      writer.close();
      const res = new Response(ds.readable);
      uncompBytes = new Uint8Array(await res.arrayBuffer());
    } else {
      throw new Error(`Metode kompresi (${method}) belum didukung untuk berkas: ${normalizedName}`);
    }

    const mime = getMimeType(normalizedName);
    let text = '';
    if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/javascript') {
      text = textDecoder.decode(uncompBytes);
    }

    filesMap.set(normalizedName, {
      path: normalizedName,
      bytes: uncompBytes,
      text,
      mime
    });
  }

  return filesMap;
}

/**
 * Pack a map of file entries into a valid binary ZIP buffer
 * @param {Record<string, string|Uint8Array>|Map<string, string|Uint8Array>} files 
 * @returns {Promise<Uint8Array>}
 */
export async function packZip(files) {
  const entries = files instanceof Map ? Array.from(files.entries()) : Object.entries(files);
  const fileRecords = [];
  let currentOffset = 0;
  const parts = [];

  for (const [rawPath, rawContent] of entries) {
    const normalizedPath = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalizedPath) continue;

    const data = typeof rawContent === 'string' ? textEncoder.encode(rawContent) : rawContent;
    const nameBytes = textEncoder.encode(normalizedPath);
    const crc = calculateCrc32(data);

    let compData = data;
    let method = 0; // 0 = store, 8 = deflate

    if (data.length > 20 && typeof CompressionStream !== 'undefined') {
      try {
        const cs = new CompressionStream('deflate-raw');
        const writer = cs.writable.getWriter();
        writer.write(data);
        writer.close();
        const compBuf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
        if (compBuf.length < data.length) {
          compData = compBuf;
          method = 8;
        }
      } catch {
        // Fallback to uncompressed store
        compData = data;
        method = 0;
      }
    }

    // Local file header: 30 bytes + nameLen
    const lfh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lfh.buffer);
    dv.setUint32(0, 0x04034b50, true); // Local file header signature
    dv.setUint16(4, 20, true);          // Version needed
    dv.setUint16(6, 0, true);           // Flags
    dv.setUint16(8, method, true);      // Method
    dv.setUint16(10, 0, true);          // Time
    dv.setUint16(12, 0, true);          // Date
    dv.setUint32(14, crc, true);         // CRC32
    dv.setUint32(18, compData.length, true); // Compressed size
    dv.setUint32(22, data.length, true);     // Uncompressed size
    dv.setUint16(26, nameBytes.length, true);// Name len
    dv.setUint16(28, 0, true);          // Extra field len
    lfh.set(nameBytes, 30);

    parts.push(lfh);
    parts.push(compData);

    fileRecords.push({
      path: normalizedPath,
      nameBytes,
      crc,
      method,
      compLen: compData.length,
      uncompLen: data.length,
      offset: currentOffset
    });

    currentOffset += lfh.length + compData.length;
  }

  const cdStart = currentOffset;
  let cdLen = 0;

  for (const f of fileRecords) {
    const cdh = new Uint8Array(46 + f.nameBytes.length);
    const dv = new DataView(cdh.buffer);
    dv.setUint32(0, 0x02014b50, true); // Central directory header signature
    dv.setUint16(4, 20, true);          // Version made by
    dv.setUint16(6, 20, true);          // Version needed
    dv.setUint16(8, 0, true);           // Flags
    dv.setUint16(10, f.method, true);   // Method
    dv.setUint16(12, 0, true);          // Time
    dv.setUint16(14, 0, true);          // Date
    dv.setUint32(16, f.crc, true);       // CRC-32
    dv.setUint32(20, f.compLen, true);   // Compressed size
    dv.setUint32(24, f.uncompLen, true); // Uncompressed size
    dv.setUint16(28, f.nameBytes.length, true); // Name len
    dv.setUint16(30, 0, true);          // Extra field len
    dv.setUint16(32, 0, true);          // Comment len
    dv.setUint16(34, 0, true);          // Disk start
    dv.setUint16(36, 0, true);          // Internal attrs
    dv.setUint32(38, 0, true);          // External attrs
    dv.setUint32(42, f.offset, true);   // Local header offset
    cdh.set(f.nameBytes, 46);

    parts.push(cdh);
    cdLen += cdh.length;
  }

  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true); // EOCD signature
  edv.setUint16(4, 0, true);          // Disk number
  edv.setUint16(6, 0, true);          // Start disk
  edv.setUint16(8, fileRecords.length, true);  // Disk entries
  edv.setUint16(10, fileRecords.length, true); // Total entries
  edv.setUint32(12, cdLen, true);     // CD size
  edv.setUint32(16, cdStart, true);   // CD offset
  edv.setUint16(20, 0, true);         // Comment len

  parts.push(eocd);

  const totalSize = parts.reduce((acc, p) => acc + p.length, 0);
  const result = new Uint8Array(totalSize);
  let cur = 0;
  for (const part of parts) {
    result.set(part, cur);
    cur += part.length;
  }

  return result;
}
