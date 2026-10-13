/**
 * crossfeed.js - Bauer Stereophonic-to-Binaural Headphone DSP Engine
 *
 * Simulates loudspeaker acoustic crosstalk for headphones and IEMs,
 * eliminating "super-stereo" acoustic fatigue from hard-panned mixes (60s/70s rock, jazz, classical)
 * by applying interaural time delay (~250-350 microseconds) and interaural head-shadow filtering (~700 Hz lowpass).
 */

export const CROSSFEED_PRESETS = {
  bauer: {
    id: 'bauer',
    name: 'Bauer Standard',
    description: 'Panggung suara seimbang dan natural (Cutoff 700 Hz, delay 280 us, atenuasi -4.5 dB)',
    cutoff: 700,
    delayUs: 280,
    feedDb: -4.5
  },
  chumoy: {
    id: 'chumoy',
    name: 'Chu Moy (Subtil)',
    description: 'Crossfeed ringan dengan pemisahan stereo tinggi (Cutoff 700 Hz, delay 300 us, atenuasi -6.0 dB)',
    cutoff: 700,
    delayUs: 300,
    feedDb: -6.0
  },
  meier: {
    id: 'meier',
    name: 'Jan Meier (Dalam)',
    description: 'Panggung suara luas untuk rekaman pemisahan ekstrem (Cutoff 650 Hz, delay 350 us, atenuasi -3.5 dB)',
    cutoff: 650,
    delayUs: 350,
    feedDb: -3.5
  }
};

/**
 * Pure function: Calculate linear gain coefficient from decibel attenuation.
 * @param {number} db
 * @returns {number}
 */
export function calculateCrossfeedLinearGain(db) {
  const safeDb = typeof db === 'number' && !isNaN(db) ? db : -4.5;
  return Math.pow(10, safeDb / 20);
}

/**
 * Pure function: Convert microseconds to seconds for Web Audio DelayNode.
 * @param {number} microseconds
 * @returns {number}
 */
export function microsecondsToSeconds(microseconds) {
  const safeUs = Math.max(50, Math.min(1000, Number(microseconds) || 280));
  return safeUs * 1e-6;
}

/**
 * Bauer Stereophonic-to-Binaural Crossfeed DSP Node
 */
export class BauerCrossfeedNode {
  /**
   * @param {AudioContext} audioCtx
   * @param {Object} [options]
   */
  constructor(audioCtx, options = {}) {
    this.audioCtx = audioCtx;
    this.enabled = !!options.enabled;
    this.preset = options.preset || 'bauer';
    this.cutoff = Number(options.cutoff) || 700;
    this.delayUs = Number(options.delayUs) || 280;
    this.feedDb = Number(options.feedDb) || -4.5;

    // Boundary Nodes
    this.input = this.audioCtx.createGain();
    this.output = this.audioCtx.createGain();

    // Dry / Wet Routing
    this.dryGain = this.audioCtx.createGain();
    this.wetGain = this.audioCtx.createGain();

    // 1. Dry Path (Direct passthrough when disabled)
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    // 2. Wet Path (Stereo Splitter -> Filter & Delay Matrix -> Stereo Merger)
    this.splitter = this.audioCtx.createChannelSplitter(2);
    this.merger = this.audioCtx.createChannelMerger(2);

    this.input.connect(this.wetGain);
    this.wetGain.connect(this.splitter);

    // Direct Gains
    this.directL = this.audioCtx.createGain();
    this.directR = this.audioCtx.createGain();
    this.directL.gain.value = 1.0;
    this.directR.gain.value = 1.0;

    // Crossfeed Left -> Right Ear
    this.filterL = this.audioCtx.createBiquadFilter();
    this.filterL.type = 'lowpass';
    this.filterL.frequency.value = this.cutoff;
    this.filterL.Q.value = 0.5; // gentle Butterworth roll-off

    this.delayL = this.audioCtx.createDelay(0.01);
    this.delayL.delayTime.value = microsecondsToSeconds(this.delayUs);

    this.crossGainL = this.audioCtx.createGain();
    this.crossGainL.gain.value = calculateCrossfeedLinearGain(this.feedDb);

    // Crossfeed Right -> Left Ear
    this.filterR = this.audioCtx.createBiquadFilter();
    this.filterR.type = 'lowpass';
    this.filterR.frequency.value = this.cutoff;
    this.filterR.Q.value = 0.5;

    this.delayR = this.audioCtx.createDelay(0.01);
    this.delayR.delayTime.value = microsecondsToSeconds(this.delayUs);

    this.crossGainR = this.audioCtx.createGain();
    this.crossGainR.gain.value = calculateCrossfeedLinearGain(this.feedDb);

    // Routing Left Channel (Splitter output 0)
    // Direct Left to Left Ear (Merger input 0)
    this.splitter.connect(this.directL, 0);
    this.directL.connect(this.merger, 0, 0);

    // Cross Left to Right Ear (Merger input 1)
    this.splitter.connect(this.filterL, 0);
    this.filterL.connect(this.delayL);
    this.delayL.connect(this.crossGainL);
    this.crossGainL.connect(this.merger, 0, 1);

    // Routing Right Channel (Splitter output 1)
    // Direct Right to Right Ear (Merger input 1)
    this.splitter.connect(this.directR, 1);
    this.directR.connect(this.merger, 0, 1);

    // Cross Right to Left Ear (Merger input 0)
    this.splitter.connect(this.filterR, 1);
    this.filterR.connect(this.delayR);
    this.delayR.connect(this.crossGainR);
    this.crossGainR.connect(this.merger, 0, 0);

    // Wet Output to Master Output
    this.merger.connect(this.output);

    // Initialize state
    this.applyState();
  }

  applyState() {
    const now = this.audioCtx.currentTime;
    if (this.enabled) {
      this.dryGain.gain.setTargetAtTime(0, now, 0.02);
      this.wetGain.gain.setTargetAtTime(1, now, 0.02);
    } else {
      this.dryGain.gain.setTargetAtTime(1, now, 0.02);
      this.wetGain.gain.setTargetAtTime(0, now, 0.02);
    }

    const linearFeed = calculateCrossfeedLinearGain(this.feedDb);
    const delaySec = microsecondsToSeconds(this.delayUs);

    this.filterL.frequency.setTargetAtTime(this.cutoff, now, 0.02);
    this.filterR.frequency.setTargetAtTime(this.cutoff, now, 0.02);

    this.delayL.delayTime.setTargetAtTime(delaySec, now, 0.02);
    this.delayR.delayTime.setTargetAtTime(delaySec, now, 0.02);

    this.crossGainL.gain.setTargetAtTime(linearFeed, now, 0.02);
    this.crossGainR.gain.setTargetAtTime(linearFeed, now, 0.02);
  }

  /**
   * Enable or disable crossfeed processing
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.applyState();
  }

  /**
   * Apply predefined crossfeed preset
   * @param {'bauer'|'chumoy'|'meier'} presetId
   */
  setPreset(presetId) {
    const preset = CROSSFEED_PRESETS[presetId] || CROSSFEED_PRESETS.bauer;
    this.preset = preset.id;
    this.cutoff = preset.cutoff;
    this.delayUs = preset.delayUs;
    this.feedDb = preset.feedDb;
    this.applyState();
  }

  /**
   * Configure custom parameters
   * @param {Object} params
   */
  configure(params = {}) {
    if (params.enabled !== undefined) this.enabled = !!params.enabled;
    if (params.preset && CROSSFEED_PRESETS[params.preset]) {
      this.setPreset(params.preset);
      return;
    }
    if (params.cutoff !== undefined) this.cutoff = Math.max(200, Math.min(2000, Number(params.cutoff)));
    if (params.delayUs !== undefined) this.delayUs = Math.max(50, Math.min(1000, Number(params.delayUs)));
    if (params.feedDb !== undefined) this.feedDb = Math.max(-12, Math.min(-1, Number(params.feedDb)));
    this.applyState();
  }

  connect(destination) {
    return this.output.connect(destination);
  }

  disconnect() {
    return this.output.disconnect();
  }
}
