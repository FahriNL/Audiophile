/**
 * autoEqParser.js - Tolerant parser and serializer for AutoEQ ParametricEQ.txt files
 *
 * Handles standard formats produced by the AutoEQ headphone calibration project:
 * Preamp: -6.2 dB
 * Filter 1: ON PK Fc 105 Hz Gain 4.3 dB Q 0.70
 * Filter 2: ON LSC Fc 105 Hz Gain 6.5 dB Q 0.70
 * Filter 3: ON HSC Fc 10000 Hz Gain -2.0 dB Q 0.70
 */

/**
 * Maps AutoEQ shorthand filter codes to Web Audio BiquadFilterNode types
 */
const TYPE_MAP = {
  pk: 'peaking',
  peak: 'peaking',
  peaking: 'peaking',
  lsc: 'lowshelf',
  ls: 'lowshelf',
  lowshelf: 'lowshelf',
  low_shelf: 'lowshelf',
  hsc: 'highshelf',
  hs: 'highshelf',
  highshelf: 'highshelf',
  high_shelf: 'highshelf',
  lp: 'lowpass',
  lowpass: 'lowpass',
  hp: 'highpass',
  highpass: 'highpass',
  no: 'notch',
  notch: 'notch'
};

const REVERSE_TYPE_MAP = {
  peaking: 'PK',
  lowshelf: 'LSC',
  highshelf: 'HSC',
  lowpass: 'LP',
  highpass: 'HP',
  notch: 'NO'
};

/**
 * Parse an AutoEQ ParametricEQ.txt text file
 * @param {string} text Raw content of ParametricEQ.txt
 * @returns {{ success: boolean, preamp: number, bands: Array<Object>, warnings: Array<string>, error?: string }}
 */
export function parseAutoEqText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return {
      success: false,
      preamp: 0,
      bands: [],
      warnings: [],
      error: 'Berkas kosong atau tidak dapat dibaca. Pastikan Anda memilih berkas teks ParametricEQ.txt yang valid.'
    };
  }

  const lines = text.split(/\r?\n/);
  let preamp = 0;
  let hasPreamp = false;
  const parsedFilters = [];
  const warnings = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex].trim();
    if (!rawLine || rawLine.startsWith('#') || rawLine.startsWith('//')) {
      continue; // Skip comments and empty lines
    }

    // 1. Check for Preamp line: e.g. "Preamp: -6.2 dB"
    const preampMatch = rawLine.match(/^preamp\s*:\s*([+-]?\d+(?:\.\d+)?)\s*(?:db)?/i);
    if (preampMatch) {
      preamp = parseFloat(preampMatch[1]);
      hasPreamp = true;
      continue;
    }

    // 2. Check for Filter line:
    // e.g. "Filter 1: ON PK Fc 105 Hz Gain 4.3 dB Q 0.70"
    // or "Filter 2: LSC Fc 105 Gain 6.5 Q 0.70"
    const filterRegex = /filter\s*\d*\s*:\s*(?:(on|off)\s+)?([a-z_]+)\s+fc\s+([0-9.]+)\s*(?:hz)?\s+gain\s+([+-]?[0-9.]+)\s*(?:db)?\s+q\s+([0-9.]+)/i;
    const match = rawLine.match(filterRegex);

    if (match) {
      const stateStr = (match[1] || 'on').toLowerCase();
      const rawType = match[2].toLowerCase();
      const freq = parseFloat(match[3]);
      const gain = parseFloat(match[4]);
      const q = parseFloat(match[5]);

      const normalizedType = TYPE_MAP[rawType] || 'peaking';
      const enabled = stateStr !== 'off';

      // Clamp parameters safely within bounds
      const clampedFreq = Math.max(20, Math.min(20000, Math.round(freq)));
      const clampedGain = Math.max(-15, Math.min(15, Math.round(gain * 10) / 10));
      const clampedQ = Math.max(0.1, Math.min(10.0, Math.round(q * 100) / 100));

      parsedFilters.push({
        type: normalizedType,
        freq: clampedFreq,
        gain: clampedGain,
        q: clampedQ,
        enabled
      });
    } else if (rawLine.toLowerCase().startsWith('filter')) {
      warnings.push(`Baris ${lineIndex + 1} dilewati karena format tidak dikenal: "${rawLine}"`);
    }
  }

  if (parsedFilters.length === 0) {
    return {
      success: false,
      preamp: 0,
      bands: [],
      warnings,
      error: 'Tidak ditemukan konfigurasi filter EQ yang valid di dalam berkas. Pastikan format baris mengandung "Filter N: ON/OFF PK/LSC/HSC Fc X Gain Y Q Z".'
    };
  }

  // If there are more than 10 bands in the file, take the first 10 active bands
  let finalBands = parsedFilters;
  if (finalBands.length > 10) {
    warnings.push(`Profil memiliki ${parsedFilters.length} band. Menggunakan 10 band pertama untuk kompatibilitas mesin audio 10-band.`);
    finalBands = finalBands.slice(0, 10);
  }

  // Pad to 10 bands if fewer than 10
  while (finalBands.length < 10) {
    const lastFreq = finalBands.length > 0 ? finalBands[finalBands.length - 1].freq : 1000;
    finalBands.push({
      type: 'peaking',
      freq: Math.min(20000, Math.round(lastFreq * 1.5)),
      gain: 0,
      q: 1.41,
      enabled: false
    });
  }

  return {
    success: true,
    preamp: Math.round(preamp * 10) / 10,
    hasPreamp,
    bands: finalBands,
    totalParsed: parsedFilters.length,
    warnings
  };
}

/**
 * Format parametric bands into AutoEQ ParametricEQ.txt compatible text
 * @param {number} preamp Preamp in dB
 * @param {Array<Object>} bands Array of 10 bands
 * @returns {string} Text formatted as ParametricEQ.txt
 */
export function formatAutoEqText(preamp = 0, bands = []) {
  const lines = [
    `Preamp: ${(preamp > 0 ? '+' : '')}${preamp.toFixed(1)} dB`
  ];

  bands.forEach((b, i) => {
    const state = b.enabled !== false ? 'ON' : 'OFF';
    const typeStr = REVERSE_TYPE_MAP[b.type] || 'PK';
    const freq = Math.round(b.freq || 1000);
    const gain = Number(b.gain || 0).toFixed(1);
    const q = Number(b.q || 1.41).toFixed(2);
    lines.push(`Filter ${i + 1}: ${state} ${typeStr} Fc ${freq} Hz Gain ${gain} dB Q ${q}`);
  });

  return lines.join('\n');
}
