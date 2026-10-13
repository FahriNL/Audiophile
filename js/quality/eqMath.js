/**
 * eqMath.js - Mathematical calculations for Equalizer frequency response,
 * biquad filter transfer functions, and automatic preamp calculation.
 */

/**
 * Standard biquad filter types supported by Web Audio API
 */
export const EQ_FILTER_TYPES = [
  'peaking',
  'lowshelf',
  'highshelf',
  'notch',
  'lowpass',
  'highpass'
];

/**
 * Compute the complex frequency response H(e^{j omega}) of a biquad filter
 * at frequency f (Hz) given sample rate fs.
 * Returns the magnitude response in linear scale.
 */
export function getBiquadMagnitudeResponse(type, f0, gainDb, Q, f, fs = 48000) {
  if (f <= 0) f = 1;
  const w0 = (2 * Math.PI * f0) / fs;
  const w = (2 * Math.PI * f) / fs;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40); // 10^(gain/40) for shelving and peaking
  const alpha = sinW0 / (2 * Math.max(0.01, Q));

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  switch (type) {
    case 'peaking': {
      b0 = 1 + alpha * A;
      b1 = -2 * cosW0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosW0;
      a2 = 1 - alpha / A;
      break;
    }
    case 'lowshelf': {
      const sqrtA2 = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cosW0 + sqrtA2);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
      b2 = A * ((A + 1) - (A - 1) * cosW0 - sqrtA2);
      a0 = (A + 1) + (A - 1) * cosW0 + sqrtA2;
      a1 = -2 * ((A - 1) + (A + 1) * cosW0);
      a2 = (A + 1) + (A - 1) * cosW0 - sqrtA2;
      break;
    }
    case 'highshelf': {
      const sqrtA2 = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cosW0 + sqrtA2);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
      b2 = A * ((A + 1) + (A - 1) * cosW0 - sqrtA2);
      a0 = (A + 1) - (A - 1) * cosW0 + sqrtA2;
      a1 = 2 * ((A - 1) - (A + 1) * cosW0);
      a2 = (A + 1) - (A - 1) * cosW0 - sqrtA2;
      break;
    }
    case 'lowpass': {
      b0 = (1 - cosW0) / 2;
      b1 = 1 - cosW0;
      b2 = (1 - cosW0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    }
    case 'highpass': {
      b0 = (1 + cosW0) / 2;
      b1 = -(1 + cosW0);
      b2 = (1 + cosW0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    }
    case 'notch': {
      b0 = 1;
      b1 = -2 * cosW0;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    }
    default:
      return 1.0;
  }

  // Normalize by a0
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  a1 /= a0;
  a2 /= a0;

  // Evaluate transfer function on unit circle z = e^(j*w)
  // H(e^jw) = (b0 + b1 e^-jw + b2 e^-2jw) / (1 + a1 e^-jw + a2 e^-2jw)
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cos2W = Math.cos(2 * w);
  const sin2W = Math.sin(2 * w);

  const numReal = b0 + b1 * cosW + b2 * cos2W;
  const numImag = -(b1 * sinW + b2 * sin2W);

  const denReal = 1 + a1 * cosW + a2 * cos2W;
  const denImag = -(a1 * sinW + a2 * sin2W);

  const numMagSq = numReal * numReal + numImag * numImag;
  const denMagSq = denReal * denReal + denImag * denImag;

  if (denMagSq < 1e-12) return 1.0;
  return Math.sqrt(numMagSq / denMagSq);
}

/**
 * Calculate the combined frequency response across multiple EQ bands
 * @param {Array<Object>} bands Array of { type, freq, gain, q, enabled }
 * @param {number} preampDb Preamp in dB
 * @param {Array<number>} frequencies Array of frequencies to evaluate (Hz)
 * @param {number} [fs=48000] Audio context sample rate
 * @returns {Array<number>} Magnitude response in dB for each frequency point
 */
export function computeCombinedResponse(bands, preampDb = 0, frequencies, fs = 48000) {
  const resultDb = new Float32Array(frequencies.length);

  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    let totalLinear = 1.0;

    if (Array.isArray(bands)) {
      for (const band of bands) {
        if (!band || band.enabled === false) continue;
        const mag = getBiquadMagnitudeResponse(
          band.type || 'peaking',
          band.freq || 1000,
          band.gain || 0,
          band.q || 1.0,
          f,
          fs
        );
        totalLinear *= mag;
      }
    }

    const bandDb = totalLinear > 1e-6 ? 20 * Math.log10(totalLinear) : -120;
    resultDb[i] = bandDb + preampDb;
  }

  return resultDb;
}

/**
 * Generate logarithmic spaced frequency array for curve rendering (e.g. 20 Hz to 20,000 Hz)
 */
export function generateLogFrequencies(pointsCount = 200, minHz = 20, maxHz = 20000) {
  const freqs = new Float32Array(pointsCount);
  const minLog = Math.log10(minHz);
  const maxLog = Math.log10(maxHz);
  const step = (maxLog - minLog) / (pointsCount - 1);

  for (let i = 0; i < pointsCount; i++) {
    freqs[i] = Math.pow(10, minLog + i * step);
  }
  return freqs;
}

/**
 * Calculate automatic preamp attenuation based on highest filter boost
 * to strictly prevent digital clipping.
 * @param {Array<Object>} bands
 * @returns {number} Preamp in dB (negative or zero)
 */
export function calculateAutoPreamp(bands) {
  if (!Array.isArray(bands) || bands.length === 0) return 0;

  let maxBoost = 0;
  for (const b of bands) {
    if (!b || b.enabled === false) continue;
    const gain = Number(b.gain) || 0;
    if (gain > maxBoost) {
      maxBoost = gain;
    }
  }

  // If highest boost is +6.2 dB, preamp is -6.2 dB
  return maxBoost > 0 ? -Math.round(maxBoost * 10) / 10 : 0;
}
