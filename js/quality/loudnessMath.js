/**
 * loudnessMath.js - Audio Loudness, True Peak & Dynamic Range Analysis
 *
 * Implements:
 * 1. ITU-R BS.1770-4 / EBU R128 Integrated Loudness (LUFS) with K-weighting & dual gating (-70 LUFS & -10 LU)
 * 2. ITU-R BS.1770 True Peak (4x oversampling with polyphase sinc interpolation) and Sample Peak (dBFS)
 * 3. Documented open Dynamic Range (DR) estimation (TT DR Meter compatible methodology)
 * 4. ReplayGain calculation with customizable targets (-18, -16, -14 LUFS) and True Peak anti-clipping
 */

/**
 * Pre-filter (Stage 1 - High Shelf) and RLB (Stage 2 - High Pass) filter coefficients
 * Table for common sample rates with analytical bilinear fallback.
 */
export function getKWeightingCoefficients(sampleRate) {
  const fs = Number(sampleRate) || 48000;

  // Pre-filter (High Shelf) parameters: f0 = 1681.97 Hz, Gain = +3.9998 dB, Q = 0.707175
  // RLB filter (High Pass) parameters: f0 = 38.135 Hz, Q = 0.500327
  let stage1;
  let stage2;

  if (fs === 48000) {
    stage1 = {
      b0: 1.53512485958697,
      b1: -2.69169618940638,
      b2: 1.19839281085285,
      a1: -1.69065929318241,
      a2: 0.73248077421585
    };
    stage2 = {
      b0: 1.0,
      b1: -2.0,
      b2: 1.0,
      a1: -1.99004745483398,
      a2: 0.99007225036621
    };
  } else if (fs === 44100) {
    stage1 = {
      b0: 1.53084185958697,
      b1: -2.65097999000000,
      b2: 1.16907908000000,
      a1: -1.66367311000000,
      a2: 0.71261405000000
    };
    stage2 = {
      b0: 1.0,
      b1: -2.0,
      b2: 1.0,
      a1: -1.98916968000000,
      a2: 0.98919904000000
    };
  } else if (fs === 96000) {
    stage1 = {
      b0: 1.53727376,
      b1: -2.71221762,
      b2: 1.21323388,
      a1: -1.70425884,
      a2: 0.74254886
    };
    stage2 = {
      b0: 1.0,
      b1: -2.0,
      b2: 1.0,
      a1: -1.99501185,
      a2: 0.99502422
    };
  } else if (fs === 88200) {
    stage1 = {
      b0: 1.53698240,
      b1: -2.70932145,
      b2: 1.21109820,
      a1: -1.70241020,
      a2: 0.74117865
    };
    stage2 = {
      b0: 1.0,
      b1: -2.0,
      b2: 1.0,
      a1: -1.99457224,
      a2: 0.99458572
    };
  } else {
    // Dynamic calculation for other arbitrary sample rates via bilinear transform
    const f0Shelf = 1681.97445;
    const gainDb = 3.9998438;
    const V = Math.pow(10, gainDb / 20);
    const K = Math.tan((Math.PI * f0Shelf) / fs);
    const norm1 = 1 + Math.SQRT2 * K + K * K;
    stage1 = {
      b0: (V + Math.sqrt(2 * V) * K + K * K) / norm1,
      b1: (2 * (K * K - V)) / norm1,
      b2: (V - Math.sqrt(2 * V) * K + K * K) / norm1,
      a1: (2 * (K * K - 1)) / norm1,
      a2: (1 - Math.SQRT2 * K + K * K) / norm1
    };

    const f0Hp = 38.13547;
    const qHp = 0.500327;
    const Khp = Math.tan((Math.PI * f0Hp) / fs);
    const norm2 = 1 + Khp / qHp + Khp * Khp;
    stage2 = {
      b0: 1.0 / norm2,
      b1: -2.0 / norm2,
      b2: 1.0 / norm2,
      a1: (2 * (Khp * Khp - 1)) / norm2,
      a2: (1 - Khp / qHp + Khp * Khp) / norm2
    };
  }

  return { stage1, stage2 };
}

/**
 * Apply Direct Form II Transposed biquad filter to channel samples
 */
export function applyBiquadFilter(inputSamples, coefs) {
  const len = inputSamples.length;
  const out = new Float32Array(len);
  let d1 = 0;
  let d2 = 0;
  const { b0, b1, b2, a1, a2 } = coefs;

  for (let i = 0; i < len; i++) {
    const x = inputSamples[i];
    const y = b0 * x + d1;
    d1 = b1 * x - a1 * y + d2;
    d2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

/**
 * Calculate Integrated Loudness (LUFS) according to ITU-R BS.1770-4 / EBU R128
 * Dual-gating: Absolute threshold -70 LUFS, Relative threshold -10 LU.
 */
export function calculateIntegratedLufs(channelData, sampleRate) {
  if (!channelData || channelData.length === 0 || channelData[0].length === 0) {
    return -70.0;
  }

  const numChannels = channelData.length;
  const numSamples = channelData[0].length;
  const fs = sampleRate || 44100;

  // 1. Apply K-weighting (Stage 1 High Shelf, then Stage 2 High Pass)
  const coefs = getKWeightingCoefficients(fs);
  const filteredChannels = [];
  for (let c = 0; c < numChannels; c++) {
    const s1 = applyBiquadFilter(channelData[c], coefs.stage1);
    const s2 = applyBiquadFilter(s1, coefs.stage2);
    filteredChannels.push(s2);
  }

  // 2. Block calculation: 400 ms gating blocks with 100 ms step (75% overlap)
  const blockSamples = Math.max(1, Math.round(0.400 * fs));
  const stepSamples = Math.max(1, Math.round(0.100 * fs));
  const numBlocks = Math.floor((numSamples - blockSamples) / stepSamples) + 1;

  if (numBlocks <= 0) {
    return -70.0;
  }

  // Channel weightings for stereo (G_L = 1.0, G_R = 1.0)
  const channelWeights = [1.0, 1.0];
  const blockEnergies = new Float32Array(numBlocks);
  const blockLoudness = new Float32Array(numBlocks);

  for (let b = 0; b < numBlocks; b++) {
    const start = b * stepSamples;
    let blockEnergySum = 0;

    for (let c = 0; c < Math.min(numChannels, 2); c++) {
      const samples = filteredChannels[c];
      let sumSq = 0;
      for (let i = 0; i < blockSamples; i++) {
        const val = samples[start + i];
        sumSq += val * val;
      }
      const meanSq = sumSq / blockSamples;
      blockEnergySum += (channelWeights[c] || 1.0) * meanSq;
    }

    blockEnergies[b] = blockEnergySum;
    blockLoudness[b] = -0.691 + 10 * Math.log10(Math.max(blockEnergySum, 1e-12));
  }

  // 3. Absolute Gating: threshold = -70.0 LUFS
  const absGatedIndices = [];
  let absSumEnergy = 0;
  for (let b = 0; b < numBlocks; b++) {
    if (blockLoudness[b] > -70.0) {
      absGatedIndices.push(b);
      absSumEnergy += blockEnergies[b];
    }
  }

  if (absGatedIndices.length === 0) {
    return -70.0;
  }

  // 4. Relative Gating: Gamma_rel = average of abs-gated blocks - 10.0 LU
  const absAvgEnergy = absSumEnergy / absGatedIndices.length;
  const relThreshold = -0.691 + 10 * Math.log10(Math.max(absAvgEnergy, 1e-12)) - 10.0;

  let relSumEnergy = 0;
  let relCount = 0;
  for (let i = 0; i < absGatedIndices.length; i++) {
    const idx = absGatedIndices[i];
    if (blockLoudness[idx] > relThreshold) {
      relSumEnergy += blockEnergies[idx];
      relCount++;
    }
  }

  if (relCount === 0) {
    return -70.0;
  }

  const finalAvgEnergy = relSumEnergy / relCount;
  const integratedLufs = -0.691 + 10 * Math.log10(Math.max(finalAvgEnergy, 1e-12));

  return Math.round(integratedLufs * 10) / 10;
}

/**
 * Polyphase sinc interpolation FIR filter coefficients for 4x oversampling (sub-phases 1, 2, 3)
 * Half-length = 12 taps (Hamming-windowed sinc with normalized DC gain).
 */
const SINC_TAPS_HALF = 12;
const SINC_COEFS_4X = (() => {
  const phases = [];
  for (let p = 1; p <= 3; p++) {
    const shift = p / 4;
    const filter = new Float32Array(SINC_TAPS_HALF * 2);
    let sum = 0;
    for (let idx = 0; idx < SINC_TAPS_HALF * 2; idx++) {
      const m = idx - SINC_TAPS_HALF;
      const t = m + shift;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.54 + 0.46 * Math.cos((Math.PI * m) / SINC_TAPS_HALF);
      filter[idx] = sinc * w;
      sum += filter[idx];
    }
    for (let idx = 0; idx < SINC_TAPS_HALF * 2; idx++) {
      filter[idx] /= sum;
    }
    phases.push(filter);
  }
  return phases;
})();

/**
 * Calculate Sample Peak (dBFS) and True Peak (dBTP) with 4x oversampling
 */
export function calculateTruePeak(channelData) {
  if (!channelData || channelData.length === 0 || channelData[0].length === 0) {
    return { samplePeakDb: -100, truePeakDbtp: -100, maxLinear: 0 };
  }

  const numChannels = channelData.length;
  const numSamples = channelData[0].length;
  let globalSamplePeak = 0;

  // 1. Compute original sample peak
  for (let c = 0; c < numChannels; c++) {
    const samples = channelData[c];
    for (let i = 0; i < numSamples; i++) {
      const absVal = Math.abs(samples[i]);
      if (absVal > globalSamplePeak) {
        globalSamplePeak = absVal;
      }
    }
  }

  let globalTruePeak = globalSamplePeak;

  // 2. Compute 4x oversampled true peak
  // Optimization: Only evaluate polyphase sinc near candidate peaks within 3 dB of globalSamplePeak
  const candidateThreshold = globalSamplePeak * 0.707;
  const p1 = SINC_COEFS_4X[0];
  const p2 = SINC_COEFS_4X[1];
  const p3 = SINC_COEFS_4X[2];
  const filterLen = SINC_TAPS_HALF * 2;

  for (let c = 0; c < numChannels; c++) {
    const samples = channelData[c];
    for (let i = SINC_TAPS_HALF; i < numSamples - SINC_TAPS_HALF; i++) {
      if (Math.abs(samples[i]) >= candidateThreshold) {
        let v1 = 0;
        let v2 = 0;
        let v3 = 0;
        const start = i - SINC_TAPS_HALF;

        for (let k = 0; k < filterLen; k++) {
          const s = samples[start + k];
          v1 += s * p1[k];
          v2 += s * p2[k];
          v3 += s * p3[k];
        }

        const abs1 = Math.abs(v1);
        const abs2 = Math.abs(v2);
        const abs3 = Math.abs(v3);

        if (abs1 > globalTruePeak) globalTruePeak = abs1;
        if (abs2 > globalTruePeak) globalTruePeak = abs2;
        if (abs3 > globalTruePeak) globalTruePeak = abs3;
      }
    }
  }

  const samplePeakDb = globalSamplePeak > 0 ? 20 * Math.log10(globalSamplePeak) : -100;
  const truePeakDbtp = globalTruePeak > 0 ? 20 * Math.log10(globalTruePeak) : -100;

  return {
    samplePeakDb: Math.round(samplePeakDb * 10) / 10,
    truePeakDbtp: Math.round(truePeakDbtp * 10) / 10,
    maxLinear: globalTruePeak
  };
}

/**
 * Calculate Dynamic Range (DR) using documented open TT DR Meter methodology
 * Compares peak level with top 20% loudest segments (3-second blocks).
 */
export function calculateDynamicRange(channelData, sampleRate) {
  if (!channelData || channelData.length === 0 || channelData[0].length === 0) {
    return { dr: 0, isLowDynamics: false, label: 'DR 0 (perkiraan)' };
  }

  const numChannels = channelData.length;
  const numSamples = channelData[0].length;
  const fs = sampleRate || 44100;
  const segmentLength = Math.max(1, Math.round(3.0 * fs)); // 3-second segments
  const numSegments = Math.floor(numSamples / segmentLength);

  let globalPeak = 0;
  for (let c = 0; c < numChannels; c++) {
    const samples = channelData[c];
    for (let i = 0; i < numSamples; i++) {
      const absVal = Math.abs(samples[i]);
      if (absVal > globalPeak) globalPeak = absVal;
    }
  }

  if (numSegments <= 0 || globalPeak < 1e-5) {
    return { dr: 14, isLowDynamics: false, label: 'DR 14 (perkiraan)' };
  }

  const segmentRmsList = [];
  for (let s = 0; s < numSegments; s++) {
    const start = s * segmentLength;
    let sumSq = 0;
    let totalSamples = 0;

    for (let c = 0; c < numChannels; c++) {
      const samples = channelData[c];
      for (let i = 0; i < segmentLength; i++) {
        const val = samples[start + i];
        sumSq += val * val;
        totalSamples++;
      }
    }

    const rms = Math.sqrt(sumSq / (totalSamples || 1));
    if (rms > 1e-5) {
      segmentRmsList.push(rms);
    }
  }

  if (segmentRmsList.length === 0) {
    return { dr: 14, isLowDynamics: false, label: 'DR 14 (perkiraan)' };
  }

  // Sort ascending
  segmentRmsList.sort((a, b) => a - b);

  // Take top 20% loudest segments
  const top20Count = Math.max(1, Math.round(segmentRmsList.length * 0.20));
  const startIndex = segmentRmsList.length - top20Count;
  let top20SumSq = 0;

  for (let i = startIndex; i < segmentRmsList.length; i++) {
    top20SumSq += segmentRmsList[i] * segmentRmsList[i];
  }

  const top20Rms = Math.sqrt(top20SumSq / top20Count);
  const drValue = Math.max(1, Math.min(30, Math.round(20 * Math.log10(globalPeak / top20Rms))));
  const isLowDynamics = drValue <= 7;

  return {
    dr: drValue,
    isLowDynamics,
    label: `DR ${drValue} (perkiraan)`
  };
}

/**
 * Calculate ReplayGain with anti-clipping headroom protection
 * @param {number} integratedLufs 
 * @param {number} truePeakDbtp 
 * @param {number} [targetLufs=-18]
 * @param {number} [antiClipMargin=-0.5]
 */
export function calculateReplayGain(integratedLufs, truePeakDbtp, targetLufs = -18, antiClipMargin = -0.5) {
  const lufs = Number(integratedLufs) || -18;
  const tp = Number(truePeakDbtp) || 0;
  const target = Number(targetLufs) || -18;

  // Desired gain to reach target LUFS
  let gainDb = target - lufs;
  let isClippedAvoided = false;

  // Prevent inter-sample clipping beyond margin (e.g. -0.5 dBTP)
  const maxSafeGain = antiClipMargin - tp;
  if (gainDb > maxSafeGain) {
    gainDb = maxSafeGain;
    isClippedAvoided = true;
  }

  const roundedGain = Math.round(gainDb * 100) / 100;
  const linearGain = Math.pow(10, roundedGain / 20);

  return {
    gainDb: roundedGain,
    linearGain,
    isClippedAvoided
  };
}
