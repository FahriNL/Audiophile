/**
 * analyze.worker.js - Web Worker for FFT frequency spectrum analysis,
 * Hi-Res authenticity verification, and ITU-R BS.1770 / EBU R128 Loudness & True Peak analysis.
 */

import {
  calculateIntegratedLufs,
  calculateTruePeak,
  calculateDynamicRange,
  calculateReplayGain
} from '../quality/loudnessMath.js';

// Hann window function
function hannWindow(n, N) {
  return 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
}

// In-place Radix-2 Cooley-Tukey FFT
function fft(real, imag) {
  const n = real.length;
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wstepR = Math.cos(angle);
    const wstepI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1.0;
      let wi = 0.0;
      for (let k = 0; k < half; k++) {
        const vR = real[i + k + half] * wr - imag[i + k + half] * wi;
        const vI = real[i + k + half] * wi + imag[i + k + half] * wr;
        const uR = real[i + k];
        const uI = imag[i + k];
        real[i + k] = uR + vR;
        imag[i + k] = uI + vI;
        real[i + k + half] = uR - vR;
        imag[i + k + half] = uI - vI;
        const nextWr = wr * wstepR - wi * wstepI;
        wi = wr * wstepI + wi * wstepR;
        wr = nextWr;
      }
    }
  }
}

self.onmessage = async function (e) {
  const { trackId, channelData, sampleRate, tier, targetLufs } = e.data;
  try {
    const N = 8192; // 8192 FFT bins
    const nyquist = sampleRate / 2;
    const binWidth = sampleRate / N;

    const numSamples = channelData[0].length;
    const framesToAverage = 5;
    const step = Math.floor((numSamples - N) / (framesToAverage + 1));
    const avgPowerDb = new Float32Array(N / 2);
    let validFrames = 0;

    let clipCount = 0;
    let sumSquares = 0;
    let peakVal = 0;

    const left = channelData[0];
    const right = channelData.length > 1 ? channelData[1] : channelData[0];

    // Stereo difference for fake stereo detection
    let diffSumSq = 0;
    let sumSumSq = 0;

    for (let i = 0; i < numSamples; i++) {
      const l = left[i];
      const r = right[i];
      const absL = Math.abs(l);
      if (absL >= 0.9995) clipCount++;
      if (absL > peakVal) peakVal = absL;
      sumSquares += l * l;

      const diff = l - r;
      const sumLR = l + r;
      diffSumSq += diff * diff;
      sumSumSq += sumLR * sumLR;
    }

    const rms = Math.sqrt(sumSquares / numSamples);
    const dynamicRangeDb = Math.max(0, 20 * Math.log10((peakVal || 0.0001) / (rms || 0.0001)));
    const isFakeStereo = channelData.length > 1 && (diffSumSq / (sumSumSq + 1e-9) < 0.0001);

    // FFT Frame Averaging across snippet
    for (let f = 1; f <= framesToAverage; f++) {
      const startIdx = f * step;
      if (startIdx + N > numSamples) break;

      const real = new Float32Array(N);
      const imag = new Float32Array(N);

      let frameEnergy = 0;
      for (let n = 0; n < N; n++) {
        const sample = left[startIdx + n];
        const w = hannWindow(n, N);
        real[n] = sample * w;
        frameEnergy += sample * sample;
      }

      if (frameEnergy < 0.0001) continue; // Skip silent frames

      fft(real, imag);

      for (let k = 0; k < N / 2; k++) {
        const magSq = (real[k] * real[k] + imag[k] * imag[k]) / (N * N);
        const db = 10 * Math.log10(Math.max(magSq, 1e-12));
        avgPowerDb[k] += db;
      }
      validFrames++;
    }

    if (validFrames > 0) {
      for (let k = 0; k < N / 2; k++) {
        avgPowerDb[k] /= validFrames;
      }
    }

    // Estimate Noise Floor (median of upper 12% frequency bins)
    const highBinsStart = Math.floor((N / 2) * 0.88);
    let sumFloor = 0;
    let countFloor = 0;
    for (let k = highBinsStart; k < N / 2; k++) {
      sumFloor += avgPowerDb[k];
      countFloor++;
    }
    const noiseFloorDb = countFloor > 0 ? (sumFloor / countFloor) : -90;

    // Detect Cutoff Frequency (highest bin significantly above noise floor)
    let cutoffBin = 0;
    for (let k = Math.floor(1000 / binWidth); k < N / 2; k++) {
      if (avgPowerDb[k] > (noiseFloorDb + 10)) {
        cutoffBin = k;
      }
    }
    const cutoffHz = Math.round(cutoffBin * binWidth);

    // Calculate drop slope around cutoff
    const slopeWindowBins = Math.max(2, Math.floor(2000 / binWidth));
    const preCutoffBin = Math.max(0, cutoffBin - slopeWindowBins);
    const dropDb = Math.max(0, avgPowerDb[preCutoffBin] - noiseFloorDb);

    // Downsample curve (64 points) for UI spectrogram viewer
    const spectrumCurve = [];
    const pointsCount = 64;
    const binStep = Math.floor((N / 2) / pointsCount);
    for (let p = 0; p < pointsCount; p++) {
      let maxP = -120;
      for (let b = 0; b < binStep; b++) {
        const val = avgPowerDb[p * binStep + b];
        if (val > maxP) maxP = val;
      }
      spectrumCurve.push(Math.round(maxP));
    }

    // Heuristic Classification Rules
    let status = 'verified_hires';
    let confidence = 85;
    let notes = '';

    if (sampleRate >= 88200) {
      if (cutoffHz <= 22500 && dropDb > 25) {
        status = 'suspected_upsample';
        confidence = 94;
        notes = `Frekuensi terpotong tajam di ~${(cutoffHz / 1000).toFixed(1)} kHz (karakteristik upsample dari CD 44.1/48 kHz).`;
      } else if (cutoffHz >= 28000) {
        status = 'verified_hires';
        confidence = 92;
        notes = 'Terverifikasi Hi-Res asli. Spektrum harmonik meluas melampaui 28 kHz.';
      } else {
        status = 'verified_hires';
        confidence = 75;
        notes = 'Kandungan spektrum melampaui batas CD standar dengan roll-off instrumen alami.';
      }
    } else if (sampleRate >= 44100 && (tier === 'LOSSLESS' || tier === 'STUDIO')) {
      if (cutoffHz < 19000 && dropDb > 30) {
        status = 'suspected_transcode';
        confidence = 91;
        notes = `Diduga transcode dari lossy (MP3/AAC) dengan batas cutoff di ~${(cutoffHz / 1000).toFixed(1)} kHz.`;
      } else {
        status = 'verified_hires';
        confidence = 88;
        notes = 'Terverifikasi Lossless CD/Studio asli. Respons spektrum penuh hingga ~20 kHz.';
      }
    } else {
      status = 'lossy_expected';
      confidence = 95;
      notes = `Format lossy standar dengan cutoff di ~${(cutoffHz / 1000).toFixed(1)} kHz.`;
    }

    // AUD-02: Comprehensive Loudness, True Peak & Dynamic Range in single decode pass
    const lufs = calculateIntegratedLufs(channelData, sampleRate);
    const tpResult = calculateTruePeak(channelData);
    const drResult = calculateDynamicRange(channelData, sampleRate);
    const rgResult = calculateReplayGain(lufs, tpResult.truePeakDbtp, targetLufs || -18, -0.5);

    // Waveform Seekbar Peaks (100 buckets across song)
    const waveformBuckets = 100;
    const samplesPerBucket = Math.floor(numSamples / waveformBuckets);
    const peaks = new Float32Array(waveformBuckets);

    if (samplesPerBucket > 0) {
      for (let b = 0; b < waveformBuckets; b++) {
        let maxAmp = 0;
        const bStart = b * samplesPerBucket;
        const bEnd = Math.min(numSamples, bStart + samplesPerBucket);
        const sStep = Math.max(1, Math.floor((bEnd - bStart) / 120));
        for (let s = bStart; s < bEnd; s += sStep) {
          const lVal = Math.abs(left[s]);
          const rVal = right ? Math.abs(right[s]) : 0;
          const val = lVal > rVal ? lVal : rVal;
          if (val > maxAmp) maxAmp = val;
        }
        peaks[b] = Math.round(maxAmp * 1000) / 1000;
      }
    }

    self.postMessage({
      trackId,
      success: true,
      analysis: {
        status,
        cutoffHz,
        nyquistHz: Math.round(nyquist),
        noiseFloorDb: Math.round(noiseFloorDb),
        dropDb: Math.round(dropDb),
        confidence,
        clippingCount: clipCount,
        dynamicRangeDb: Math.round(dynamicRangeDb),
        fakeStereo: isFakeStereo,
        notes,
        spectrumCurve,
        peaks: Array.from(peaks),
        // AUD-02 Loudness & Dynamics data:
        lufs,
        samplePeakDb: tpResult.samplePeakDb,
        truePeakDbtp: tpResult.truePeakDbtp,
        dr: drResult.dr,
        isLowDynamics: drResult.isLowDynamics,
        drLabel: drResult.label,
        replayGainDb: rgResult.gainDb,
        replayGainLinear: rgResult.linearGain,
        isClippedAvoided: rgResult.isClippedAvoided,
        analyzedAt: Date.now()
      }
    });
  } catch (err) {
    self.postMessage({ trackId, success: false, error: err.message });
  }
};
