/**
 * outputManager.js - Physical Audio Output Device Selector (setSinkId),
 * device change monitoring, wireless Bluetooth detection heuristic,
 * and per-device EQ preset association (AUD-04).
 */

import { engine } from './engine.js';
import { settings } from '../core/settings.js';
import { events } from '../core/events.js';
import { toast } from '../ui/components/toast.js';

/**
 * Check if the browser supports physical audio sink targeting (setSinkId)
 * @returns {boolean}
 */
export function isAudioSinkSupported() {
  return typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function';
}

/**
 * Check if the browser supports native selectAudioOutput picker
 * (allows selecting output devices without prompting for microphone permission)
 * @returns {boolean}
 */
export function isSelectAudioOutputSupported() {
  return typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.selectAudioOutput === 'function');
}

/**
 * Detect whether an audio output device name suggests a wireless/Bluetooth connection.
 * Heuristic based on common wireless keywords and model patterns.
 * @param {string} deviceName 
 * @returns {boolean}
 */
export function isWirelessDevice(deviceName = '') {
  if (!deviceName || typeof deviceName !== 'string') return false;
  const pattern = /bluetooth|buds|airpods|airpod|wireless|bt-|tws|wh-|wf-|freebuds|galaxy buds|pixel buds|headphone bluetooth|aer|tune\d|anker|soundcore|realme|redmi|oppo enco|sony wi-|sony wh-|sony wf-/i;
  return pattern.test(deviceName);
}

class AudioOutputManager {
  constructor() {
    this.currentDeviceId = '';
    this.currentDeviceLabel = '';
    this.isMonitoring = false;
    this.boundDeviceChangeHandler = null;
  }

  /**
   * Initialize output manager and register hardware disconnect listener
   */
  init() {
    if (typeof window === 'undefined') return;

    this.currentDeviceId = settings.get('audioOutput.deviceId', '');
    this.currentDeviceLabel = settings.get('audioOutput.deviceLabel', '');

    // Setup devicechange listener if available
    if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function' && !this.isMonitoring) {
      this.boundDeviceChangeHandler = () => this.handleDeviceChange();
      navigator.mediaDevices.addEventListener('devicechange', this.boundDeviceChangeHandler);
      this.isMonitoring = true;
    }
  }

  /**
   * Retrieve all physical audio output devices reported by the browser
   * @returns {Promise<Array<{ deviceId: string, label: string, groupId: string, isWireless: boolean }>>}
   */
  async getAvailableDevices() {
    if (!isAudioSinkSupported() || typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const outputDevices = allDevices.filter(dev => dev.kind === 'audiooutput');

      return outputDevices.map((dev, index) => {
        const label = dev.label || (dev.deviceId === 'default' ? 'Perangkat Audio Default Sistem' : `Perangkat Output ${index + 1}`);
        return {
          deviceId: dev.deviceId,
          label,
          groupId: dev.groupId,
          isWireless: isWirelessDevice(label)
        };
      });
    } catch (err) {
      console.warn('Gagal membaca daftar perangkat audio output:', err);
      return [];
    }
  }

  /**
   * Prompt user via native browser selectAudioOutput picker
   * @returns {Promise<{ deviceId: string, label: string }|null>}
   */
  async promptSelectOutput() {
    if (!isSelectAudioOutputSupported()) {
      return null;
    }

    try {
      const device = await navigator.mediaDevices.selectAudioOutput();
      if (device && device.deviceId) {
        await this.setAudioOutput(device.deviceId, device.label);
        return { deviceId: device.deviceId, label: device.label };
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        console.warn('selectAudioOutput error:', err);
      }
    }
    return null;
  }

  /**
   * Switch audio output device across engine media elements and Web Audio context
   * @param {string} sinkId 
   * @param {string} [label=''] 
   * @returns {Promise<boolean>}
   */
  async setAudioOutput(sinkId, label = '') {
    if (!isAudioSinkSupported()) return false;

    try {
      // 1. Apply to active and standby HTMLMediaElements in AudioEngine
      if (engine.audioA && typeof engine.audioA.setSinkId === 'function') {
        await engine.audioA.setSinkId(sinkId);
      }
      if (engine.audioB && typeof engine.audioB.setSinkId === 'function') {
        await engine.audioB.setSinkId(sinkId);
      }

      // 2. Apply to Web Audio AudioContext destination if supported
      if (engine.audioCtx && typeof engine.audioCtx.setSinkId === 'function') {
        try {
          await engine.audioCtx.setSinkId(sinkId);
        } catch (ctxErr) {
          console.warn('AudioContext.setSinkId warning:', ctxErr);
        }
      }

      this.currentDeviceId = sinkId;
      this.currentDeviceLabel = label;

      settings.set('audioOutput.deviceId', sinkId);
      settings.set('audioOutput.deviceLabel', label);

      // 3. Auto-load mapped EQ preset for this device if configured
      this.checkAndApplyLinkedEqPreset(label || sinkId);

      events.emit('output:deviceChanged', { deviceId: sinkId, label });
      return true;
    } catch (err) {
      console.error('Gagal mengalihkan perangkat audio output (setSinkId):', err);
      toast.warning('Gagal mengalihkan perangkat audio. Perangkat mungkin tidak dapat diakses.');
      return false;
    }
  }

  /**
   * Link an EQ preset (graphic or parametric) to a specific device identifier
   * @param {string} deviceKey 
   * @param {string} presetIdOrName 
   */
  linkPresetToDevice(deviceKey, presetIdOrName) {
    if (!deviceKey) return;
    const currentMappings = { ...(settings.get('audioOutput.deviceEqPresets', {})) };
    if (!presetIdOrName) {
      delete currentMappings[deviceKey];
    } else {
      currentMappings[deviceKey] = presetIdOrName;
    }
    settings.set('audioOutput.deviceEqPresets', currentMappings);
  }

  /**
   * Get the mapped EQ preset for a specific device identifier
   * @param {string} deviceKey 
   * @returns {string|null}
   */
  getLinkedPresetForDevice(deviceKey) {
    if (!deviceKey) return null;
    const mappings = settings.get('audioOutput.deviceEqPresets', {});
    return mappings[deviceKey] || null;
  }

  /**
   * Check if the active device has a linked EQ preset and activate it automatically
   * @param {string} deviceKey 
   */
  checkAndApplyLinkedEqPreset(deviceKey) {
    const linkedPreset = this.getLinkedPresetForDevice(deviceKey);
    if (!linkedPreset) return;

    // Check Graphic EQ preset
    const graphicPresets = {
      flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bass: [5, 4, 3, 1.5, 0, 0, 0, 0, 0, 0],
      vocal: [-1, -1, 0, 2, 3.5, 3, 2, 1, 0, 0],
      treble: [0, 0, 0, 0, 0, 1, 2, 3.5, 4.5, 5],
      acoustic: [3, 2.5, 1, 0, 1.5, 2, 2.5, 3, 2.5, 2]
    };

    if (graphicPresets[linkedPreset]) {
      settings.set('eqMode', 'graphic');
      settings.set('eqGains', [...graphicPresets[linkedPreset]]);
      engine.applyCurrentEqSettings();
      events.emit('output:presetApplied', { mode: 'graphic', preset: linkedPreset });
      return;
    }

    // Check Parametric EQ preset
    const customPresets = settings.get('parametricPresets', []);
    const matchingCustom = customPresets.find(p => p.id === linkedPreset || p.name === linkedPreset);

    if (matchingCustom) {
      settings.set('eqMode', 'parametric');
      settings.set('parametricCurrentPreset', matchingCustom.id || matchingCustom.name);
      settings.set('parametricBands', JSON.parse(JSON.stringify(matchingCustom.bands)));
      if (matchingCustom.preamp !== undefined) {
        settings.set('preamp', matchingCustom.preamp);
      }
      engine.applyCurrentEqSettings();
      events.emit('output:presetApplied', { mode: 'parametric', preset: matchingCustom.name });
      return;
    }

    if (linkedPreset.startsWith('builtin:')) {
      const builtinKey = linkedPreset.replace('builtin:', '');
      settings.set('eqMode', 'parametric');
      settings.set('parametricCurrentPreset', linkedPreset);
      events.emit('output:presetApplied', { mode: 'parametric', preset: builtinKey });
    }
  }

  /**
   * Monitor devicechange events: auto-pause if the active output device was unplugged
   */
  async handleDeviceChange() {
    try {
      const devices = await this.getAvailableDevices();
      
      // If user had selected a specific non-default device and it disappeared
      if (this.currentDeviceId && this.currentDeviceId !== 'default') {
        const stillExists = devices.some(d => d.deviceId === this.currentDeviceId);
        if (!stillExists) {
          // Device was physically disconnected!
          engine.pause();
          toast.warning('Perangkat audio terputus. Pemutaran dijeda secara otomatis.');
          
          // Revert to system default
          await this.setAudioOutput('', 'Perangkat Audio Default Sistem');
          events.emit('output:deviceDisconnected', {
            previousDeviceId: this.currentDeviceId,
            previousLabel: this.currentDeviceLabel
          });
        }
      }

      events.emit('output:deviceListUpdated', devices);
    } catch (err) {
      console.warn('Error handling devicechange:', err);
    }
  }
}

export const outputManager = new AudioOutputManager();
