/**
 * settingsView.js - Application settings, audio engine modes, equalizer,
 * crossfade configuration, audio quality analysis, network privacy controls,
 * comprehensive backup/restore, and system diagnostics with self-test.
 */

import { store } from '../../core/store.js';
import { engine } from '../../player/engine.js';
import { BackupService } from '../../backup/exportImport.js';
import { scanner } from '../../library/scanner.js';
import { folderManager } from '../../library/folders.js';
import { analyzer } from '../../quality/analyzer.js';
import { events } from '../../core/events.js';
import { i18n, t } from '../../core/i18n.js';
import { toast as baseToast } from '../components/toast.js';
import { localizeSettingsHtml, localizeSettingsText } from '../../i18n/settingsLocale.js';

const toast = {
  show: (msg, opts) => baseToast.show(localizeSettingsText(msg, i18n.getLocale()), opts),
  info: (msg, opts) => baseToast.info(localizeSettingsText(msg, i18n.getLocale()), opts),
  success: (msg, opts) => baseToast.success(localizeSettingsText(msg, i18n.getLocale()), opts),
  warning: (msg, opts) => baseToast.warning(localizeSettingsText(msg, i18n.getLocale()), opts),
  error: (msg, opts) => baseToast.error(localizeSettingsText(msg, i18n.getLocale()), opts)
};
import { settings, DEFAULT_SETTINGS } from '../../core/settings.js';
import { EXTERNAL_SERVICES, isTotalOffline, isServiceAllowed } from '../../core/network.js';
import { APP_VERSION_INFO } from '../../core/version.js';
import { DiagnosticsService } from '../../core/diagnostics.js';
import { SelfTestRunner } from '../../core/selfTest.js';
import { escapeHtml, formatDuration } from '../../core/utils.js';
import { computeCombinedResponse, calculateAutoPreamp, generateLogFrequencies } from '../../quality/eqMath.js';
import { parseAutoEqText, formatAutoEqText } from '../../quality/autoEqParser.js';
import { outputManager, isAudioSinkSupported, isSelectAudioOutputSupported, isWirelessDevice } from '../../player/outputManager.js';
import { shortcutManager } from '../../core/shortcuts.js';
import { pipManager } from '../../player/pip.js';
import { dialog } from '../components/dialog.js';
import { liquid } from '../motion/fluidKit.js';
import { artistMetaService } from '../../library/artistMeta.js';
import { getIconSvg } from '../icons.js';
import { modManager } from '../../mods/modManager.js';
import { generateSampleModZip } from '../../mods/sampleMod.js';
import { generateJiggleWaveformModZip } from '../../mods/jiggleWaveformMod.js';

const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [5, 4, 3, 1.5, 0, 0, 0, 0, 0, 0],
  vocal: [-1, -1, 0, 2, 3.5, 3, 2, 1, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 2, 3.5, 4.5, 5],
  acoustic: [3, 2.5, 1, 0, 1.5, 2, 2.5, 3, 2.5, 2]
};

const PARAMETRIC_BUILTIN_PRESETS = {
  flat: {
    name: 'Flat (Default)',
    preamp: 0,
    bands: [
      { type: 'peaking', freq: 31, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 63, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 125, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 250, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 500, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 1000, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 2000, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 4000, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 8000, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 16000, gain: 0, q: 1.41, enabled: true }
    ]
  },
  harman_ie: {
    name: 'Harman Target (In-Ear)',
    preamp: -6.0,
    bands: [
      { type: 'lowshelf', freq: 105, gain: 6.0, q: 0.71, enabled: true },
      { type: 'peaking', freq: 200, gain: -1.0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 800, gain: 0.5, q: 1.0, enabled: true },
      { type: 'peaking', freq: 1500, gain: 1.5, q: 1.41, enabled: true },
      { type: 'peaking', freq: 3000, gain: 4.5, q: 2.0, enabled: true },
      { type: 'peaking', freq: 5500, gain: -2.0, q: 3.0, enabled: true },
      { type: 'peaking', freq: 8000, gain: -1.5, q: 2.0, enabled: true },
      { type: 'highshelf', freq: 10000, gain: -2.0, q: 0.71, enabled: true },
      { type: 'peaking', freq: 13000, gain: 1.0, q: 2.0, enabled: true },
      { type: 'peaking', freq: 16000, gain: 0.0, q: 1.41, enabled: true }
    ]
  },
  harman_oe: {
    name: 'Harman Target (Over-Ear)',
    preamp: -4.5,
    bands: [
      { type: 'lowshelf', freq: 105, gain: 4.5, q: 0.71, enabled: true },
      { type: 'peaking', freq: 250, gain: -1.2, q: 1.0, enabled: true },
      { type: 'peaking', freq: 1000, gain: 0.0, q: 1.0, enabled: true },
      { type: 'peaking', freq: 2000, gain: 2.0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 3200, gain: 3.0, q: 2.0, enabled: true },
      { type: 'peaking', freq: 6000, gain: -2.5, q: 3.0, enabled: true },
      { type: 'peaking', freq: 8500, gain: -1.0, q: 2.5, enabled: true },
      { type: 'highshelf', freq: 10000, gain: -1.5, q: 0.71, enabled: true },
      { type: 'peaking', freq: 14000, gain: 0.5, q: 2.0, enabled: true },
      { type: 'peaking', freq: 18000, gain: 0.0, q: 1.41, enabled: true }
    ]
  },
  bass_boost: {
    name: 'Bass Boost (+4.5 dB)',
    preamp: -4.5,
    bands: [
      { type: 'lowshelf', freq: 105, gain: 4.5, q: 0.71, enabled: true },
      { type: 'peaking', freq: 63, gain: 2.0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 125, gain: 1.0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 250, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 500, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 1000, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 2000, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 4000, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 8000, gain: 0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 16000, gain: 0, q: 1.41, enabled: true }
    ]
  },
  vocal_shine: {
    name: 'Vocal Clarity & Air',
    preamp: -3.0,
    bands: [
      { type: 'highpass', freq: 40, gain: 0, q: 0.71, enabled: true },
      { type: 'peaking', freq: 125, gain: -1.0, q: 1.0, enabled: true },
      { type: 'peaking', freq: 250, gain: -1.5, q: 1.41, enabled: true },
      { type: 'peaking', freq: 500, gain: 0.0, q: 1.0, enabled: true },
      { type: 'peaking', freq: 1000, gain: 1.5, q: 1.41, enabled: true },
      { type: 'peaking', freq: 2500, gain: 3.0, q: 1.8, enabled: true },
      { type: 'peaking', freq: 4500, gain: 2.0, q: 1.41, enabled: true },
      { type: 'peaking', freq: 8000, gain: 1.0, q: 1.41, enabled: true },
      { type: 'highshelf', freq: 10000, gain: 2.5, q: 0.71, enabled: true },
      { type: 'peaking', freq: 16000, gain: 1.0, q: 1.41, enabled: true }
    ]
  }
};


const EQ_FREQS = [
  { label: '31 Hz', hz: '31' },
  { label: '63 Hz', hz: '63' },
  { label: '125 Hz', hz: '125' },
  { label: '250 Hz', hz: '250' },
  { label: '500 Hz', hz: '500' },
  { label: '1 kHz', hz: '1k' },
  { label: '2 kHz', hz: '2k' },
  { label: '4 kHz', hz: '4k' },
  { label: '8 kHz', hz: '8k' },
  { label: '16 kHz', hz: '16k' }
];

class SettingsView {
  constructor() {
    this.container = null;
    this.autoAnalyzeBound = false;
    this.activeCategory = 'all';
    this.lastSelfTestResults = [];
    this.selectedParametricBandIndex = 0;
    this.isDraggingBand = false;
  }

  init() {
    this.container = document.getElementById('viewSettings');

    // Subscribe to analysis progress updates
    store.subscribe('analysisProgress', (prog) => {
      this.updateAnalysisProgress(prog);
    });

    // Initialize Audio Output Device Manager (AUD-04)
    outputManager.init();
    events.on('output:deviceListUpdated', () => {
      if (this.container && this.container.classList.contains('active')) {
        this.render();
      }
    });
    events.on('i18n:changed', () => {
      if (this.container && this.container.classList.contains('active')) {
        this.render();
      }
    });

    // Auto-analysis listener on new folder import
    if (!this.autoAnalyzeBound) {
      events.on('library:scanned', async () => {
        const isAuto = settings.get('autoAnalyzeOnImport', false);
        if (isAuto && !analyzer.isBatchRunning) {
          const tracks = store.get('tracks') || [];
          toast.info('Auto-analisis spektrum kualitas audio dimulai di latar belakang...');
          await analyzer.runBatchAnalysis(tracks, (t) => folderManager.getFileForTrack(t));
        }
      });
      this.autoAnalyzeBound = true;
    }
  }

  activate(params) {
    if (params?.tab) {
      this.activeCategory = params.tab;
    }
    this.render();
  }

  async render() {
    if (!this.container) return;

    const tracks = store.get('tracks') || [];
    const folders = store.get('folders') || [];
    const missingCount = tracks.filter(t => t.missing).length;
    const installedMods = modManager.getAllMods();

    // Quality stats
    const verifiedCount = tracks.filter(t => t.analysis?.status === 'verified_hires').length;
    const suspectCount = tracks.filter(t => t.analysis?.status === 'suspected_upsample' || t.analysis?.status === 'suspected_transcode').length;
    const pendingCount = tracks.filter(t => !t.analysis).length;
    const hiresCount = tracks.filter(t => ['HI-RES', 'STUDIO', 'DSD'].includes(t.qualityTier)).length;
    const albumsCount = new Set(tracks.map(t => t.album)).size;

    const eqGains = settings.get('eqGains', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const eqMode = settings.get('eqMode', 'graphic');
    const eqBypass = settings.get('eqBypass', false);
    const autoPreamp = settings.get('autoPreamp', true);
    const preamp = settings.get('preamp', 0);
    const parametricBands = settings.get('parametricBands', DEFAULT_SETTINGS.parametricBands);
    const customParametricPresets = settings.get('parametricPresets', []);
    const currentParametricPreset = settings.get('parametricCurrentPreset', 'builtin:flat');
    const isCustomModified = currentParametricPreset === '_custom_curve';
    const isCustomSelected = currentParametricPreset.startsWith('custom:');
    const computedPreamp = autoPreamp ? calculateAutoPreamp(parametricBands) : preamp;
    const selectedBand = parametricBands[this.selectedParametricBandIndex] || parametricBands[0];

    const isPure = settings.get('pureMode', true);
    const rgEnabled = settings.get('replayGain', true);
    const rgTarget = settings.get('replayGainTarget', -18);
    const rgAntiClip = settings.get('replayGainPreventClipping', true);
    const crossfeedConfig = settings.get('crossfeed', { enabled: false, preset: 'bauer' }) || {};

    const cfEnabled = settings.get('crossfade.enabled', false);
    const cfDuration = settings.get('crossfade.duration', 4);
    const cfAvoidConsecutive = settings.get('crossfade.avoidConsecutiveAlbums', true);
    const cfManualSkip = settings.get('crossfade.manualSkip', false);

    // Audio Output Device (AUD-04)
    const isSinkSupported = isAudioSinkSupported();
    const isSelectPickerSupported = isSelectAudioOutputSupported();
    const activeDeviceId = settings.get('audioOutput.deviceId', '');
    const activeDeviceLabel = settings.get('audioOutput.deviceLabel', '');
    const outputDevices = isSinkSupported ? await outputManager.getAvailableDevices() : [];
    const isCurrentWireless = isWirelessDevice(activeDeviceLabel);
    const deviceKey = activeDeviceLabel || activeDeviceId || 'default';
    const linkedPreset = outputManager.getLinkedPresetForDevice(deviceKey) || '';

    // Night Mode (UX-03) & PiP (UX-02)
    const nightMode = settings.get('nightMode') || { enabled: false, intensity: 'mild', maxVolume: 0.70, scheduleEnabled: false, scheduleStart: '22:00', scheduleEnd: '06:00' };
    const autoPipOnTabBlur = settings.get('autoPipOnTabBlur', false);
    const pipCap = pipManager.getCapability();
    const isPipOpen = pipManager.isOpen();

    // Privacy & Storage values
    const totalOffline = isTotalOffline();
    const storageInfo = await DiagnosticsService.getStorageStatus();
    const lastBackupAt = settings.get('backup.lastBackupAt');
    const backupDateFormatted = lastBackupAt ? new Date(lastBackupAt).toLocaleDateString(i18n.getLocale() === 'id' ? 'id-ID' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : (i18n.getLocale() === 'en' ? 'Never backed up' : 'Belum pernah dicadangkan');

    const rawHtml = `
      <div class="settings-shell">
        <!-- Main View Header & Subtitle -->
        <div class="settings-header">
          <div class="settings-header-titles">
            <h1 class="settings-title">${escapeHtml(t('settings.title'))}</h1>
            <p class="settings-desc">
              ${escapeHtml(t('settings.desc'))}
            </p>
          </div>

          <!-- Category Navigation Filter Pills (Fluid Liquid Segmented Control) -->
          <nav class="settings-nav-tabs fk-seg" aria-label="${escapeHtml(t('settings.title'))}">
            <div class="fk-pill"></div>
            <button class="settings-nav-tab ${this.activeCategory === 'all' ? 'active on' : ''}" data-cat="all">
              <svg viewBox="0 0 24 24"><path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z"/></svg>
              <span>${escapeHtml(t('settings.nav.all'))}</span>
            </button>
            <button class="settings-nav-tab ${this.activeCategory === 'library' ? 'active' : ''}" data-cat="library">
              <svg viewBox="0 0 24 24"><path d="M20 2H8C6.9 2 6 2.9 6 4V16C6 17.1 6.9 18 8 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2ZM17 7H15V12.37C15 13.64 14.1 14.81 12.84 14.97C11.15 15.2 9.73 13.72 10.04 12.02C10.24 10.92 11.22 10.07 12.34 10C12.97 9.96 13.54 10.16 14 10.51V6C14 5.45 14.45 5 15 5H17C17.55 5 18 5.45 18 6C18 6.55 17.55 7 17 7ZM3 6C2.45 6 2 6.45 2 7V20C2 21.1 2.9 22 4 22H17C17.55 22 18 21.55 18 21C18 20.45 17.55 20 17 20H5C4.45 20 4 19.55 4 19V7C4 6.45 3.55 6 3 6Z"/></svg>
              <span>${escapeHtml(t('settings.nav.library'))}</span>
            </button>
            <button class="settings-nav-tab ${this.activeCategory === 'engine' ? 'active' : ''}" data-cat="engine">
              <svg viewBox="0 0 24 24"><path d="M12 20C13.1 20 14 19.1 14 18V6C14 4.9 13.1 4 12 4C10.9 4 10 4.9 10 6V18C10 19.1 10.9 20 12 20ZM6 20C7.1 20 8 19.1 8 18V14C8 12.9 7.1 12 6 12C4.9 12 4 12.9 4 14V18C4 19.1 4.9 20 6 20ZM16 11V18C16 19.1 16.9 20 18 20C19.1 20 20 19.1 20 18V11C20 9.9 19.1 9 18 9C16.9 9 16 9.9 16 11Z"/></svg>
              <span>${escapeHtml(t('settings.nav.audio'))}</span>
            </button>
            <button class="settings-nav-tab ${this.activeCategory === 'quality' ? 'active' : ''}" data-cat="quality">
              <svg viewBox="0 0 24 24"><path d="M19 4H5C3.89 4 3 4.9 3 6V18C3 19.1 3.89 20 5 20H19C20.1 20 21 19.1 21 18V6C21 4.9 20.1 4 19 4ZM10.25 15C9.84 15 9.5 14.66 9.5 14.25V13H7.5V14.25C7.5 14.66 7.16 15 6.75 15C6.34 15 6 14.66 6 14.25V9.75C6 9.34 6.34 9 6.75 9C7.16 9 7.5 9.34 7.5 9.75V11.5H9.5V9.75C9.5 9.34 9.84 9 10.25 9C10.66 9 11 9.34 11 9.75V14.25C11 14.66 10.66 15 10.25 15ZM18 14C18 14.55 17.55 15 17 15H16.25V15.75C16.25 16.16 15.91 16.5 15.5 16.5C15.09 16.5 14.75 16.16 14.75 15.75V15H14C13.45 15 13 14.55 13 14V10C13 9.45 13.45 9 14 9H17C17.55 9 18 9.45 18 10V14ZM14.5 13.5H16.5V10.5H14.5V13.5Z"/></svg>
              <span>${escapeHtml(t('settings.nav.quality'))}</span>
            </button>
            <button class="settings-nav-tab ${this.activeCategory === 'shortcuts' ? 'active' : ''}" data-cat="shortcuts">
              <svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8"/></svg>
              <span>${escapeHtml(t('settings.nav.shortcuts'))}</span>
            </button>
            <button class="settings-nav-tab ${this.activeCategory === 'privacy' ? 'active' : ''}" data-cat="privacy">
              <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
              <span>${escapeHtml(t('settings.nav.privacy'))}</span>
            </button>
            <button class="settings-nav-tab ${this.activeCategory === 'system' ? 'active' : ''}" data-cat="system">
              <svg viewBox="0 0 24 24"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>
              <span>${escapeHtml(t('settings.nav.system'))}</span>
            </button>
            <button class="settings-nav-tab ${this.activeCategory === 'mods' ? 'active' : ''}" data-cat="mods">
              <svg viewBox="0 0 24 24"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5s-1.12-2.5-2.5-2.5z"/></svg>
              <span>${escapeHtml(t('settings.nav.mods'))}</span>
            </button>
          </nav>
        </div>

        <!-- SECTION 1: PERPUSTAKAAN & PENYIMPANAN -->
        <section class="settings-section ${this.activeCategory !== 'all' && this.activeCategory !== 'library' ? 'hidden' : ''}" data-category="library" id="sec_library">
          <div class="settings-card">
            <div class="settings-section-head">
              <div class="settings-section-icon-box">
                <svg viewBox="0 0 24 24"><path d="M20 2H8C6.9 2 6 2.9 6 4V16C6 17.1 6.9 18 8 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2ZM17 7H15V12.37C15 13.64 14.1 14.81 12.84 14.97C11.15 15.2 9.73 13.72 10.04 12.02C10.24 10.92 11.22 10.07 12.34 10C12.97 9.96 13.54 10.16 14 10.51V6C14 5.45 14.45 5 15 5H17C17.55 5 18 5.45 18 6C18 6.55 17.55 7 17 7ZM3 6C2.45 6 2 6.45 2 7V20C2 21.1 2.9 22 4 22H17C17.55 22 18 21.55 18 21C18 20.45 17.55 20 17 20H5C4.45 20 4 19.55 4 19V7C4 6.45 3.55 6 3 6Z"/></svg>
              </div>
              <div class="settings-section-meta">
                <span class="settings-section-badge">Koleksi & Penyimpanan</span>
                <h2 class="settings-section-title">Penyimpanan & Koleksi Berkas</h2>
                <p class="settings-section-desc">
                  Audiophile membaca berkas audio beresolusi tinggi langsung dari penyimpanan komputer Anda secara aman tanpa diunggah ke server eksternal.
                </p>
              </div>
              <div class="settings-section-actions" style="margin-left:auto;">
                <button class="btn btn-secondary btn-sm btn-reset-sec" data-sec="library" title="Kembalikan bagian ini ke default">Reset Bagian Ini</button>
              </div>
            </div>

            <!-- Active Storage Banner & Stats -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Folder Musik Aktif</h3>
                  <p class="settings-subcard-desc">Lokasi direktori penyimpanan yang saat ini dihubungkan dengan koleksi.</p>
                </div>
                <div class="flex-center" style="gap:8px;">
                  <button class="btn btn-primary" id="btnSettingsImportFolder">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    <span>Impor Folder Musik</span>
                  </button>
                  <button class="btn btn-secondary" id="btnSettingsRescan" title="Pindai ulang penambahan atau perubahan berkas baru">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    <span>Pindai Ulang</span>
                  </button>
                  <input type="file" id="inputSettingsFallbackFolder" webkitdirectory directory multiple style="display:none;" />
                </div>
              </div>

              <!-- Folder Path & Collection Numbers -->
              <div style="background:rgba(255,255,255,0.02); border:1px solid var(--glass-border-subtle); border-radius:var(--radius-sm); padding:10px 14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
                <div class="mono" style="font-size:0.78rem; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                  <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${folders.length > 0 ? '#10b981' : '#f59e0b'};"></span>
                  <span>${folders.length > 0 ? (folders[0].name || 'Folder Aktif Tersambung') : 'Belum ada folder yang dipilih'}</span>
                </div>
                <div style="font-size:0.8rem; color:var(--text-dim); display:flex; gap:14px; flex-wrap:wrap;">
                  <span>Total: <strong style="color:var(--text-main);">${tracks.length} lagu</strong></span>
                  <span>Album: <strong style="color:var(--text-main);">${albumsCount} album</strong></span>
                  <span>Audiophile: <strong style="color:var(--accent-light);">${hiresCount} Hi-Res</strong></span>
                </div>
              </div>
            </div>

            <!-- Missing Tracks Relink Subcard -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Pemulihan Berkas Hilang (Tautkan Ulang)</h3>
                  <p class="settings-subcard-desc">
                    Pertahankan playlist, favorit, dan riwayat putar saat folder atau drive Anda berganti direktori.
                  </p>
                </div>
                <label class="btn ${missingCount > 0 ? 'btn-primary' : 'btn-secondary'}" style="cursor:pointer; display:inline-flex; align-items:center; gap:8px;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  <span>Pilih Berkas untuk Tautkan Ulang</span>
                  <input type="file" id="inputRelinkFiles" webkitdirectory directory multiple style="display:none;" />
                </label>
              </div>

              <div style="font-size:0.78rem; display:flex; align-items:center; gap:8px;">
                <span class="mono" style="padding:2px 8px; border-radius:var(--radius-xs); font-weight:700; ${missingCount > 0 ? 'background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3);' : 'background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.3);'}">
                  ${missingCount > 0 ? `${missingCount} Berkas Hilang` : 'Semua Berkas Terhubung'}
                </span>
                <span style="color:var(--text-dim); font-size:0.75rem;">
                  ${missingCount > 0 ? 'Klik tombol di atas untuk memilih kembali folder baru.' : 'Koleksi dalam kondisi sehat.'}
                </span>
              </div>
            </div>

            <!-- Online Metadata Fetching Subcard (Profil, Banner, Album, Ambil Semua) -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Pengambilan Metadata Online (Fetching)</h3>
                  <p class="settings-subcard-desc">
                    Unduh foto profil musisi (Deezer/Wikipedia), banner panggung konser (Wikimedia Commons), dan sampul album resmi (iTunes) langsung ke penyimpanan lokal.
                  </p>
                </div>
              </div>

              <!-- Action Grid: Profil Saja, Banner Saja, Sampul Album Saja, dan Ambil Semua -->
              <div class="meta-fetch-grid">
                <div class="meta-fetch-card">
                  <div class="meta-fetch-info">
                    <strong>Profil Artis Saja</strong>
                    <span>Foto avatar lingkaran & jumlah penggemar via Deezer / Wikipedia</span>
                  </div>
                  <button class="btn btn-secondary btn-sm" id="btnFetchProfiles">Ambil Profil</button>
                </div>

                <div class="meta-fetch-card">
                  <div class="meta-fetch-info">
                    <strong>Banner Panggung Saja</strong>
                    <span>Foto konser lanskap lebar via Wikimedia Commons & Wikipedia</span>
                  </div>
                  <button class="btn btn-secondary btn-sm" id="btnFetchBanners">Ambil Banner</button>
                </div>

                <div class="meta-fetch-card">
                  <div class="meta-fetch-info">
                    <strong>Sampul Album Saja</strong>
                    <span>Artwork resmi 1200x1200px via iTunes Search API</span>
                  </div>
                  <button class="btn btn-secondary btn-sm" id="btnFetchAlbums">Ambil Sampul Album</button>
                </div>

                <div class="meta-fetch-card meta-fetch-card-highlight">
                  <div class="meta-fetch-info">
                    <strong>Ambil Semua Sekaligus</strong>
                    <span>Sinkronisasi profil, banner, dan album berurutan secara otomatis</span>
                  </div>
                  <button class="btn btn-primary btn-sm" id="btnFetchAllMeta">Ambil Semua</button>
                </div>
              </div>

              <!-- Live Progress Bar & Status (Hidden until active) -->
              <div class="meta-fetch-progress-wrap" id="metaFetchProgressBox" style="display:none;">
                <div class="meta-fetch-progress-header">
                  <span class="mono" id="metaFetchStatusText">Menyiapkan...</span>
                  <span class="mono" id="metaFetchPercentText">0%</span>
                </div>
                <div class="meta-fetch-progress-bar">
                  <div class="meta-fetch-progress-fill" id="metaFetchProgressFill" style="width:0%;"></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- SECTION 2: MESIN AUDIO & DSP -->
        <section class="settings-section ${this.activeCategory !== 'all' && this.activeCategory !== 'engine' ? 'hidden' : ''}" data-category="engine" id="sec_engine">
          <div class="settings-card">
            <div class="settings-section-head">
              <div class="settings-section-icon-box">
                <svg viewBox="0 0 24 24"><path d="M12 20C13.1 20 14 19.1 14 18V6C14 4.9 13.1 4 12 4C10.9 4 10 4.9 10 6V18C10 19.1 10.9 20 12 20ZM6 20C7.1 20 8 19.1 8 18V14C8 12.9 7.1 12 6 12C4.9 12 4 12.9 4 14V18C4 19.1 4.9 20 6 20ZM16 11V18C16 19.1 16.9 20 18 20C19.1 20 20 19.1 20 18V11C20 9.9 19.1 9 18 9C16.9 9 16 9.9 16 11Z"/></svg>
              </div>
              <div class="settings-section-meta">
                <span class="settings-section-badge">Mesin Audio & DSP</span>
                <h2 class="settings-section-title">Pemrosesan Sinyal, Equalizer & Transisi</h2>
                <p class="settings-section-desc">
                  Konfigurasi pipeline audio antara pemutaran murni tanpa manipulasi DSP (Mode Pure), pemrosesan DSP aktif dengan equalizer 10-band, serta peleburan transisi crossfade equal-power.
                </p>
              </div>
              <div class="settings-section-actions" style="margin-left:auto;">
                <button class="btn btn-secondary btn-sm btn-reset-sec" data-sec="pureMode" title="Kembalikan bagian ini ke default">Reset Bagian Ini</button>
              </div>
            </div>

            <!-- Mode Selector Cards -->
            <div class="engine-mode-grid">
              <div class="engine-mode-card ${isPure ? 'active' : ''}" id="btnPureMode" title="Audio diputar langsung tanpa pengolahan di aplikasi. Sistem operasi atau perangkat output masih bisa mengubah sample rate.">
                <div class="engine-mode-top">
                  <span class="engine-mode-name">Mode Pure (Direct)</span>
                  <span class="engine-mode-pill">PURE (TANPA DSP)</span>
                </div>
                <p class="engine-mode-desc">
                  Audio diputar langsung tanpa pewarnaan atau pemrosesan DSP di aplikasi (bypass Web Audio API). Sistem operasi atau perangkat output masih bisa mengubah sample rate. Crossfade berjalan via ramping volume presisi.
                </p>
              </div>

              <div class="engine-mode-card ${!isPure ? 'active' : ''}" id="btnEnhancedMode">
                <div class="engine-mode-top">
                  <span class="engine-mode-name">Mode Enhanced (DSP)</span>
                  <span class="engine-mode-pill">EQUALIZER AKTIF</span>
                </div>
                <p class="engine-mode-desc">
                  Mengaktifkan pemrosesan sinyal digital (DSP), Equalizer grafis 10-Band, ReplayGain penyesuaian kenyaringan suara, dan Web Audio GainNodes.
                </p>
              </div>
            </div>

            <!-- Equalizer Section (Graphic & Parametric EQ) -->
            <div class="settings-subcard eq-container ${isPure ? 'disabled' : ''}">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Equalizer (Grafis & Parametrik)</h3>
                  <p class="settings-subcard-desc">Atur respon frekuensi secara presisi dengan filter grafis analogik atau parametrik 10-band.</p>
                </div>
              </div>

              ${isPure ? `
                <!-- Notice when Pure Mode is Active -->
                <div class="eq-pure-notice">
                  <div class="eq-pure-notice-title">Mode Pure (tanpa DSP) Sedang Aktif</div>
                  <p class="eq-pure-notice-desc">
                    Audio diputar langsung tanpa pengolahan di aplikasi. Sistem operasi atau perangkat output masih bisa mengubah sample rate. Equalizer (Grafis & Parametrik) hanya dapat digunakan dalam Mode Enhanced.
                  </p>
                  <button class="btn btn-primary btn-sm" id="btnEqSwitchToEnhanced">Pindah ke Mode Enhanced</button>
                </div>
              ` : ''}

              <!-- Tab Nav: Graphic vs Parametric -->
              <div class="eq-tabs-nav">
                <button class="eq-tab-btn ${eqMode === 'graphic' ? 'active' : ''}" data-eq-tab="graphic" ${isPure ? 'disabled' : ''}>
                  Grafis 10-Band
                </button>
                <button class="eq-tab-btn ${eqMode === 'parametric' ? 'active' : ''}" data-eq-tab="parametric" ${isPure ? 'disabled' : ''}>
                  Parametrik 10-Band
                </button>
              </div>

              <!-- Graphic Tab Content -->
              <div id="eqGraphicTabContent" style="display:${eqMode === 'graphic' ? 'block' : 'none'};">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
                  <div class="eq-presets-row">
                    <button class="eq-preset-chip active" data-preset="flat" ${isPure ? 'disabled' : ''}>Flat</button>
                    <button class="eq-preset-chip" data-preset="bass" ${isPure ? 'disabled' : ''}>Bass Boost</button>
                    <button class="eq-preset-chip" data-preset="vocal" ${isPure ? 'disabled' : ''}>Vocal Clarity</button>
                    <button class="eq-preset-chip" data-preset="treble" ${isPure ? 'disabled' : ''}>Treble Air</button>
                    <button class="eq-preset-chip" data-preset="acoustic" ${isPure ? 'disabled' : ''}>Acoustic Warm</button>
                  </div>
                  <button class="btn btn-secondary btn-sm" id="btnResetEq" ${isPure ? 'disabled' : ''}>Reset Flat</button>
                </div>

                <div class="eq-sliders-strip">
                  ${EQ_FREQS.map((band, i) => `
                    <div class="eq-band-col">
                      <span class="eq-band-val mono" id="eqLabel_${i}">${eqGains[i] > 0 ? `+${eqGains[i]}` : eqGains[i]}</span>
                      <div class="eq-slider-track-wrap">
                        <input type="range" class="eq-slider" orient="vertical" min="-12" max="12" step="0.5" value="${eqGains[i]}" data-band="${i}" ${isPure ? 'disabled' : ''} />
                      </div>
                      <span class="eq-band-lbl">${band.label}</span>
                    </div>
                  `).join('')}
                </div>
              </div>

              <!-- Parametric Tab Content -->
              <div id="eqParametricTabContent" class="eq-parametric-container" style="display:${eqMode === 'parametric' ? 'flex' : 'none'};">
                <!-- Toolbar: Preamp, Bypass, Preset actions, AutoEQ Importer -->
                <div class="eq-toolbar">
                  <div class="eq-toolbar-group">
                    <button class="btn btn-sm ${eqBypass ? 'btn-danger' : 'btn-secondary'}" id="btnParametricBypass" ${isPure ? 'disabled' : ''} title="Bypass filter EQ untuk perbandingan instan A/B">
                      ${eqBypass ? 'Bypass EQ: AKTIF (A/B)' : 'Bypass EQ: Nonaktif'}
                    </button>

                    <div style="display:flex; align-items:center; gap:8px;">
                      <label class="settings-switch" aria-label="Preamp Otomatis (Anti-Clipping)">
                        <input type="checkbox" id="chkAutoPreamp" ${autoPreamp ? 'checked' : ''} ${isPure ? 'disabled' : ''} />
                        <span class="settings-switch-slider"></span>
                      </label>
                      <span style="font-size:0.78rem; font-weight:600; color:var(--text-main);">Preamp Otomatis</span>
                      <span class="mono" id="labelPreampVal" style="font-size:0.8rem; color:var(--accent); font-weight:700;">${computedPreamp.toFixed(1)} dB</span>
                      ${!autoPreamp ? `
                        <input type="range" id="rangePreamp" min="-15" max="0" step="0.5" value="${preamp}" style="width:90px; cursor:pointer;" ${isPure ? 'disabled' : ''} />
                      ` : ''}
                    </div>
                  </div>

                  <div class="eq-toolbar-group">
                    <select class="settings-select" id="selParametricPreset" style="font-size:0.8rem; max-width:260px;" ${isPure ? 'disabled' : ''}>
                      ${isCustomModified ? `
                        <option value="_custom_curve" selected>Kustom (Disesuaikan)</option>
                      ` : ''}
                      <optgroup label="Preset Bawaan">
                        <option value="builtin:flat" ${currentParametricPreset === 'builtin:flat' ? 'selected' : ''}>Flat (Default)</option>
                        <option value="builtin:harman_ie" ${currentParametricPreset === 'builtin:harman_ie' ? 'selected' : ''}>Harman Target (In-Ear)</option>
                        <option value="builtin:harman_oe" ${currentParametricPreset === 'builtin:harman_oe' ? 'selected' : ''}>Harman Target (Over-Ear)</option>
                        <option value="builtin:bass_boost" ${currentParametricPreset === 'builtin:bass_boost' ? 'selected' : ''}>Bass Boost (+4.5 dB)</option>
                        <option value="builtin:vocal_shine" ${currentParametricPreset === 'builtin:vocal_shine' ? 'selected' : ''}>Vocal Clarity & Air</option>
                      </optgroup>
                      ${customParametricPresets.length > 0 ? `
                        <optgroup label="Preset Kustom Saya">
                          ${customParametricPresets.map(p => `<option value="custom:${escapeHtml(p.id)}" ${currentParametricPreset === `custom:${p.id}` ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                        </optgroup>
                      ` : ''}
                    </select>

                    <button class="btn btn-secondary btn-sm" id="btnResetParametricFlat" ${isPure ? 'disabled' : ''} title="Kembalikan equalizer parametrik ke posisi Flat">Reset Flat</button>
                    <button class="btn btn-secondary btn-sm" id="btnSaveParametricPreset" ${isPure ? 'disabled' : ''} title="Simpan sebagai preset baru">Simpan</button>
                    <button class="btn btn-secondary btn-sm" id="btnRenameParametricPreset" ${isPure || !isCustomSelected ? 'disabled' : ''} title="Ganti nama preset kustom">Ganti Nama</button>
                    <button class="btn btn-secondary btn-sm" id="btnDeleteParametricPreset" ${isPure || !isCustomSelected ? 'disabled' : ''} title="Hapus preset kustom terpilih">Hapus</button>

                    <button class="btn btn-primary btn-sm" id="btnImportAutoEq" ${isPure ? 'disabled' : ''} style="display:inline-flex; align-items:center; gap:6px;">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      <span>Impor AutoEQ</span>
                    </button>
                    <input type="file" id="inputAutoEqFile" accept=".txt" style="display:none;" />
                  </div>
                </div>

                <!-- Combined Response Curve Canvas & 10 Interactive Nodes -->
                <div class="eq-canvas-card">
                  <div class="eq-canvas-wrap">
                    <canvas id="parametricEqCanvas" class="eq-canvas"></canvas>
                  </div>

                  <!-- 10 Band Pills Row -->
                  <div class="eq-bands-selector" id="eqBandsPillsRow">
                    ${parametricBands.map((b, idx) => `
                      <button class="eq-band-pill ${idx === this.selectedParametricBandIndex ? 'active' : ''} ${!b.enabled ? 'disabled' : ''}" data-band-idx="${idx}" type="button" ${isPure ? 'disabled' : ''}>
                        <span class="eq-band-pill-num">${idx + 1}</span>
                        <span class="eq-band-pill-type">${b.type.slice(0, 2)}</span>
                        <span class="eq-band-pill-freq mono">${b.freq >= 1000 ? `${(b.freq / 1000).toFixed(1)}k` : b.freq}</span>
                      </button>
                    `).join('')}
                  </div>
                </div>

                <!-- Band Inspector Panel -->
                <div class="eq-inspector">
                  <div class="eq-inspector-head">
                    <span class="eq-inspector-title" id="inspectorBandTitle">
                      Band ${this.selectedParametricBandIndex + 1}: ${selectedBand.freq} Hz (${selectedBand.type.toUpperCase()})
                    </span>
                    <label style="display:flex; align-items:center; gap:6px; font-size:0.78rem; cursor:pointer;">
                      <input type="checkbox" id="chkBandEnabled" ${selectedBand.enabled ? 'checked' : ''} ${isPure ? 'disabled' : ''} />
                      <span style="color:var(--text-main); font-weight:600;">Aktif</span>
                    </label>
                  </div>

                  <div class="eq-inspector-grid">
                    <div class="eq-inspector-field">
                      <label class="eq-inspector-lbl" for="selBandType">Tipe Filter</label>
                      <select class="settings-select" id="selBandType" ${isPure ? 'disabled' : ''}>
                        <option value="peaking" ${selectedBand.type === 'peaking' ? 'selected' : ''}>Peaking (PK)</option>
                        <option value="lowshelf" ${selectedBand.type === 'lowshelf' ? 'selected' : ''}>Low-Shelf (LS)</option>
                        <option value="highshelf" ${selectedBand.type === 'highshelf' ? 'selected' : ''}>High-Shelf (HS)</option>
                        <option value="notch" ${selectedBand.type === 'notch' ? 'selected' : ''}>Notch (NO)</option>
                        <option value="lowpass" ${selectedBand.type === 'lowpass' ? 'selected' : ''}>Low-Pass (LP)</option>
                        <option value="highpass" ${selectedBand.type === 'highpass' ? 'selected' : ''}>High-Pass (HP)</option>
                      </select>
                    </div>

                    <div class="eq-inspector-field">
                      <label class="eq-inspector-lbl" for="numBandFreq">Frekuensi (20 - 20.000 Hz)</label>
                      <div class="eq-inspector-control">
                        <input type="range" id="rangeBandFreq" min="20" max="20000" step="1" value="${selectedBand.freq}" style="flex:1; cursor:pointer;" ${isPure ? 'disabled' : ''} />
                        <input type="number" class="settings-input mono" id="numBandFreq" min="20" max="20000" value="${selectedBand.freq}" style="width:78px; text-align:center;" ${isPure ? 'disabled' : ''} />
                      </div>
                    </div>

                    <div class="eq-inspector-field">
                      <label class="eq-inspector-lbl" for="numBandGain">Gain (-15 hingga +15 dB)</label>
                      <div class="eq-inspector-control">
                        <input type="range" id="rangeBandGain" min="-15" max="15" step="0.1" value="${selectedBand.gain}" style="flex:1; cursor:pointer;" ${isPure || ['lowpass', 'highpass', 'notch'].includes(selectedBand.type) ? 'disabled' : ''} />
                        <input type="number" class="settings-input mono" id="numBandGain" min="-15" max="15" step="0.1" value="${selectedBand.gain}" style="width:70px; text-align:center;" ${isPure || ['lowpass', 'highpass', 'notch'].includes(selectedBand.type) ? 'disabled' : ''} />
                      </div>
                    </div>

                    <div class="eq-inspector-field">
                      <label class="eq-inspector-lbl" for="numBandQ">Q / Bandwidth (0.1 - 10)</label>
                      <div class="eq-inspector-control">
                        <input type="range" id="rangeBandQ" min="0.1" max="10.0" step="0.05" value="${selectedBand.q}" style="flex:1; cursor:pointer;" ${isPure ? 'disabled' : ''} />
                        <input type="number" class="settings-input mono" id="numBandQ" min="0.1" max="10.0" step="0.05" value="${selectedBand.q}" style="width:70px; text-align:center;" ${isPure ? 'disabled' : ''} />
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Educational Guide Box -->
                <div class="autoeq-guide-box">
                  <div class="autoeq-guide-title">Panduan: Cara Mendapatkan Profil Headphone (AutoEQ)</div>
                  <ol style="margin:0 0 8px 18px; padding:0; display:flex; flex-direction:column; gap:4px;">
                    <li>Cari di peramban web: ketik <strong>"AutoEQ"</strong> diikuti tipe headphone/IEM Anda (contoh: <em>AutoEQ Sennheiser HD600</em> atau buka situs <em>autoeq.app</em>).</li>
                    <li>Unduh berkas konfigurasi parametrik berformat <strong>ParametricEQ.txt</strong> (yang memuat baris <code>Preamp: ...</code> dan <code>Filter 1..N: ...</code>).</li>
                    <li>Klik tombol <strong>"Impor AutoEQ"</strong> di atas dan pilih berkas teks tersebut untuk meninjau kurva respons sebelum disimpan.</li>
                  </ol>
                  <div class="autoeq-guide-note">
                    Catatan Penting Audiophile: Kurva target (seperti Harman Target In-Ear/Over-Ear) merupakan preferensi statistik suara rata-rata pendengar dari riset Harman, bukan kebenaran mutlak. Telinga dan kenyamanan setiap orang berbeda. Silakan geser titik kurva pada grafik di atas untuk menyesuaikan dengan selera pribadi Anda.
                  </div>
                </div>
              </div>
            </div>

            <!-- Normalisasi Kenyaringan & ReplayGain (ITU-R BS.1770) -->
            <div class="settings-subcard ${isPure ? 'disabled' : ''}">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Normalisasi Kenyaringan & ReplayGain (ITU-R BS.1770)</h3>
                  <p class="settings-subcard-desc">
                    Samakan tingkat kenyaringan antar lagu secara non-destruktif berdasarkan tag atau kalkulasi terintegrasi LUFS (Mode Enhanced).
                  </p>
                </div>
                <label class="settings-switch" aria-label="Aktifkan ReplayGain">
                  <input type="checkbox" id="chkReplayGain" ${rgEnabled ? 'checked' : ''} ${isPure ? 'disabled' : ''} />
                  <span class="settings-switch-slider"></span>
                </label>
              </div>

              <div class="settings-row" style="margin-top:12px;">
                <div class="settings-row-text">
                  <span class="settings-row-label">Target Kenyaringan (Integrated LUFS)</span>
                  <span class="settings-row-sub">Pilih standar acuan kenyaringan yang ingin dicapai saat trek diputar.</span>
                </div>
                <select class="settings-select" id="selReplayGainTarget" ${isPure || !rgEnabled ? 'disabled' : ''}>
                  <option value="-18" ${rgTarget === -18 ? 'selected' : ''}>-18 LUFS (EBU R128 / Audiophile)</option>
                  <option value="-16" ${rgTarget === -16 ? 'selected' : ''}>-16 LUFS (Apple Music)</option>
                  <option value="-14" ${rgTarget === -14 ? 'selected' : ''}>-14 LUFS (Spotify / YouTube)</option>
                </select>
              </div>

              <div class="settings-row">
                <div class="settings-row-text">
                  <span class="settings-row-label">Proteksi Anti-Clipping True Peak</span>
                  <span class="settings-row-sub">Otomatis turunkan gain bila penguatan kenyaringan berisiko melewati ambang aman -0.5 dBTP.</span>
                </div>
                <label class="settings-switch" aria-label="Proteksi Anti-Clipping True Peak">
                  <input type="checkbox" id="chkReplayGainAntiClip" ${rgAntiClip ? 'checked' : ''} ${isPure || !rgEnabled ? 'disabled' : ''} />
                  <span class="settings-switch-slider"></span>
                </label>
              </div>
            </div>

            <!-- Simulasi Crossfeed Headphone (Bauer Stereophonic-to-Binaural DSP) -->
            <div class="settings-subcard ${isPure ? 'disabled' : ''}">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Simulasi Crossfeed Headphone (Bauer Binaural DSP)</h3>
                  <p class="settings-subcard-desc">
                    Mencampur sinyal frekuensi rendah antar-kanal dengan penundaan mikrodetik untuk mensimulasikan sepasang speaker monitor di ruangan terbuka, menghilangkan kelelahan telinga akibat pemisahan stereo ekstrem rekaman vintage.
                  </p>
                </div>
                <label class="settings-switch" aria-label="Aktifkan Crossfeed Headphone">
                  <input type="checkbox" id="chkCrossfeed" ${crossfeedConfig.enabled ? 'checked' : ''} ${isPure ? 'disabled' : ''} />
                  <span class="settings-switch-slider"></span>
                </label>
              </div>

              <div class="settings-row" style="margin-top:12px;">
                <div class="settings-row-text">
                  <span class="settings-row-label">Preset Akustik Crossfeed</span>
                  <span class="settings-row-sub">Pilih profil panggung suara binaural yang diinginkan.</span>
                </div>
                <select class="settings-select" id="selCrossfeedPreset" ${isPure || !crossfeedConfig.enabled ? 'disabled' : ''}>
                  <option value="bauer" ${crossfeedConfig.preset === 'bauer' ? 'selected' : ''}>Bauer Standard (Cutoff 700 Hz, 280 us, -4.5 dB)</option>
                  <option value="chumoy" ${crossfeedConfig.preset === 'chumoy' ? 'selected' : ''}>Chu Moy Subtil (Cutoff 700 Hz, 300 us, -6.0 dB)</option>
                  <option value="meier" ${crossfeedConfig.preset === 'meier' ? 'selected' : ''}>Jan Meier Dalam (Cutoff 650 Hz, 350 us, -3.5 dB)</option>
                </select>
              </div>
            </div>

            <!-- Equal-Power Crossfade Controller -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Transisi & Peleburan Audio (Crossfade)</h3>
                  <p class="settings-subcard-desc">
                    Peleburan kurva equal-power (cos/sin) konstan tanpa penurunan intensitas energi suara di titik temu.
                  </p>
                </div>
                <label class="settings-switch" aria-label="Aktifkan crossfade">
                  <input type="checkbox" id="chkCrossfadeEnabled" ${cfEnabled ? 'checked' : ''} />
                  <span class="settings-switch-slider"></span>
                </label>
              </div>

              <!-- Crossfade Duration Slider -->
              <div class="settings-row-item">
                <div class="settings-row-info">
                  <span class="settings-row-label">Durasi Crossfade</span>
                  <span class="settings-row-sub">Pilih rentang peleburan antara 0 hingga 12 detik (langkah 0,5 detik).</span>
                </div>
                <div style="display:flex; align-items:center; gap:12px;">
                  <input type="range" id="rangeCrossfade" min="0" max="12" step="0.5" value="${cfDuration}" style="width:140px; cursor:pointer;" />
                  <span class="mono" id="labelCrossfadeVal" style="font-size:0.85rem; min-width:36px; font-weight:700; color:var(--accent);">${cfDuration}s</span>
                </div>
              </div>

              <!-- Rule 1: Avoid Consecutive Albums -->
              <div class="settings-row-item">
                <div class="settings-row-info">
                  <span class="settings-row-label">Jangan Crossfade Album Bersambung</span>
                  <span class="settings-row-sub">Pertahankan kontinuitas gapless Pure (tanpa DSP) untuk trek berurutan dari album yang sama atau rekaman konser live.</span>
                </div>
                <label class="settings-switch" aria-label="Jangan crossfade album bersambung">
                  <input type="checkbox" id="chkAvoidConsecutive" ${cfAvoidConsecutive ? 'checked' : ''} />
                  <span class="settings-switch-slider"></span>
                </label>
              </div>

              <!-- Rule 2: Manual Skip Micro-Crossfade -->
              <div class="settings-row-item">
                <div class="settings-row-info">
                  <span class="settings-row-label">Crossfade Saat Lewati Manual</span>
                  <span class="settings-row-sub">Terapkan peleburan mikro cepat 250ms saat menekan tombol Next/Prev manual untuk mencegah letupan suara (pop/click).</span>
                </div>
                <label class="settings-switch" aria-label="Crossfade saat lewati manual">
                  <input type="checkbox" id="chkManualSkip" ${cfManualSkip ? 'checked' : ''} />
                  <span class="settings-switch-slider"></span>
                </label>
              </div>
            </div>

            <!-- Perangkat Output Audio (AUD-04) -->
            <div class="settings-subcard" id="cardAudioOutputDevice">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Perangkat Output Audio Fisik</h3>
                  <p class="settings-subcard-desc">
                    Arahkan audio langsung ke perangkat keluaran fisik (DAC eksternal / headphone) dan hubungkan profil preset EQ spesifik per perangkat.
                  </p>
                </div>
              </div>

              ${!isSinkSupported ? `
                <div class="unsupported-device-notice" style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border-subtle); border-radius:var(--radius-sm); padding:14px; font-size:0.82rem; color:var(--text-muted); line-height:1.5;">
                  <strong style="color:var(--text-main);">Pemilihan Perangkat Langsung Tidak Didukung</strong><br/>
                  Peramban ini belum mendukung API pemilihan perangkat audio (setSinkId). Seluruh audio diputar secara normal melalui perangkat audio default sistem operasi Anda.
                </div>
              ` : `
                <!-- Device Picker & Controls -->
                <div class="settings-row-item">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Perangkat Output Aktif</span>
                    <span class="settings-row-sub">Pilih saluran fisik yang digunakan untuk pemutaran musik.</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <select class="settings-select" id="selAudioOutputDevice" style="max-width:280px;">
                      <option value="">Perangkat Audio Default Sistem</option>
                      ${outputDevices.map(d => `
                        <option value="${escapeHtml(d.deviceId)}" ${d.deviceId === activeDeviceId ? 'selected' : ''}>${escapeHtml(d.label)}</option>
                      `).join('')}
                    </select>
                    ${isSelectPickerSupported ? `
                      <button class="btn btn-secondary btn-sm" id="btnSelectAudioOutputPicker" title="Buka dialog pemilihan perangkat sistem bawaan peramban">
                        Pilih via Dialog Sistem
                      </button>
                    ` : ''}
                  </div>
                </div>

                ${isCurrentWireless ? `
                  <div class="wireless-warning-badge">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:2px;"><path d="M7 7l10 10-5 5V2l5 5L7 17"/></svg>
                    <div>
                      <strong>Perangkat Nirkabel Terdeteksi</strong><br/>
                      Kualitas audio Hi-Res mungkin tidak sampai utuh karena kompresi transmisi Bluetooth (perkiraan berdasarkan nama perangkat).
                    </div>
                  </div>
                ` : ''}

                <!-- Linked EQ Preset to Device -->
                <div class="settings-row-item" style="margin-top:12px;">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Hubungkan Preset EQ ke Perangkat Ini</span>
                    <span class="settings-row-sub">Secara otomatis memuat profil Equalizer pilihan setiap kali perangkat ini aktif.</span>
                  </div>
                  <select class="settings-select" id="selDeviceLinkedPreset" style="max-width:280px;">
                    <option value="">Gunakan EQ Terakhir (Tanpa Tautan Khusus)</option>
                    <optgroup label="Preset Grafis">
                      <option value="flat" ${linkedPreset === 'flat' ? 'selected' : ''}>Flat (Bawaan)</option>
                      <option value="bass" ${linkedPreset === 'bass' ? 'selected' : ''}>Bass Boost</option>
                      <option value="vocal" ${linkedPreset === 'vocal' ? 'selected' : ''}>Vocal</option>
                      <option value="treble" ${linkedPreset === 'treble' ? 'selected' : ''}>Treble</option>
                      <option value="acoustic" ${linkedPreset === 'acoustic' ? 'selected' : ''}>Acoustic</option>
                    </optgroup>
                    <optgroup label="Preset Parametrik & AutoEQ">
                      <option value="builtin:harman_ie" ${linkedPreset === 'builtin:harman_ie' ? 'selected' : ''}>Harman Target (In-Ear)</option>
                      <option value="builtin:harman_oe" ${linkedPreset === 'builtin:harman_oe' ? 'selected' : ''}>Harman Target (Over-Ear)</option>
                      <option value="builtin:bass_boost" ${linkedPreset === 'builtin:bass_boost' ? 'selected' : ''}>Bass Boost (+4.5 dB)</option>
                      <option value="builtin:vocal_shine" ${linkedPreset === 'builtin:vocal_shine' ? 'selected' : ''}>Vocal Clarity & Air</option>
                      ${customParametricPresets.map(p => `
                        <option value="${escapeHtml(p.id || p.name)}" ${linkedPreset === (p.id || p.name) ? 'selected' : ''}>${escapeHtml(p.name)}</option>
                      `).join('')}
                    </optgroup>
                  </select>
                </div>
              `}
            </div>

            <!-- Subcard: Mode Malam Audio (UX-03) -->
            <div class="settings-subcard" id="subcardNightMode">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Mode Malam Audio (Night Mode DSP)</h3>
                  <p class="settings-subcard-desc">
                    Kompresi dinamika ringan untuk meratakan perbedaan antara bagian pelan dan dentuman keras, dengan batas volume maksimum aman saat malam hari.
                  </p>
                </div>
                <label class="settings-switch" aria-label="Aktifkan Mode Malam">
                  <input type="checkbox" id="chkNightModeEnable" ${nightMode.enabled ? 'checked' : ''} ${isPure ? 'disabled' : ''} />
                  <span class="settings-switch-slider"></span>
                </label>
              </div>

              ${isPure ? `
                <div class="eq-pure-notice" style="margin-top:12px;">
                  <div class="eq-pure-notice-title">Mode Pure (Direct) Sedang Aktif</div>
                  <p class="eq-pure-notice-desc">
                    Mode Malam memerlukan pengolahan DSP (Web Audio DynamicsCompressorNode). Beralihlah ke Mode Enhanced untuk mengaktifkan fitur ini.
                  </p>
                  <button class="btn btn-primary btn-sm" id="btnNightSwitchToEnhanced">Pindah ke Mode Enhanced</button>
                </div>
              ` : `
                <!-- Night Mode Controls -->
                <div class="settings-row-item">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Tingkat Kompresi Dinamika</span>
                    <span class="settings-row-sub">Pilih seberapa kuat kompresi meratakan dinamika suara.</span>
                  </div>
                  <select class="settings-select" id="selNightIntensity" style="max-width:260px;" ${!nightMode.enabled ? 'disabled' : ''}>
                    <option value="mild" ${nightMode.intensity === 'mild' ? 'selected' : ''}>Ringan (Mild: -20 dB, Rasio 3.5:1)</option>
                    <option value="moderate" ${nightMode.intensity === 'moderate' ? 'selected' : ''}>Sedang (Moderate: -26 dB, Rasio 5.5:1)</option>
                    <option value="strong" ${nightMode.intensity === 'strong' ? 'selected' : ''}>Kuat (Strong: -32 dB, Rasio 8.0:1)</option>
                  </select>
                </div>

                <div class="settings-row-item">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Batas Volume Maksimum</span>
                    <span class="settings-row-sub">Batas plafon output audio agar tidak terdengar terlalu nyaring di malam hari.</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:12px;">
                    <input type="range" id="rangeNightMaxVol" min="0.30" max="1.00" step="0.05" value="${nightMode.maxVolume ?? 0.70}" style="width:140px; cursor:pointer;" ${!nightMode.enabled ? 'disabled' : ''} />
                    <span class="mono" id="labelNightMaxVolVal" style="font-size:0.85rem; min-width:40px; font-weight:700; color:var(--accent);">${Math.round((nightMode.maxVolume ?? 0.70) * 100)}%</span>
                  </div>
                </div>

                <!-- Schedule Section -->
                <div class="settings-row-item" style="border-top:1px solid rgba(255,255,255,0.04); padding-top:14px; margin-top:8px;">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Jadwal Otomatis Malam</span>
                    <span class="settings-row-sub">Aktifkan Mode Malam secara otomatis berdasarkan jam sistem komputer.</span>
                  </div>
                  <label class="settings-switch" aria-label="Jadwal Otomatis Malam">
                    <input type="checkbox" id="chkNightSchedule" ${nightMode.scheduleEnabled ? 'checked' : ''} ${!nightMode.enabled ? 'disabled' : ''} />
                    <span class="settings-switch-slider"></span>
                  </label>
                </div>

                <div class="settings-row-item" id="rowNightScheduleTimes" style="display:${nightMode.scheduleEnabled ? 'flex' : 'none'}; gap:14px; align-items:center;">
                  <div class="settings-row-info">
                    <span class="settings-row-label">Rentang Waktu Aktif</span>
                    <span class="settings-row-sub">Jam mulai dan jam berakhir mode malam.</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <input type="time" class="input" id="inputNightStart" value="${nightMode.scheduleStart || '22:00'}" style="padding:4px 8px; font-size:0.82rem;" />
                    <span style="color:var(--text-dim); font-size:0.8rem;">sampai</span>
                    <input type="time" class="input" id="inputNightEnd" value="${nightMode.scheduleEnd || '06:00'}" style="padding:4px 8px; font-size:0.82rem;" />
                  </div>
                </div>
              `}
            </div>
          </div>
        </section>

        <!-- SECTION: PINTASAN KEYBOARD & MINI PLAYER (UX-01, UX-02) -->
        <section class="settings-section ${this.activeCategory !== 'all' && this.activeCategory !== 'shortcuts' ? 'hidden' : ''}" data-category="shortcuts" id="sec_shortcuts">
          <div class="settings-card">
            <div class="settings-section-head">
              <div class="settings-section-icon-box">
                <svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8"/></svg>
              </div>
              <div class="settings-section-meta">
                <span class="settings-section-badge">Pintasan & Mini Player</span>
                <h2 class="settings-section-title">Pintasan Keyboard & Floating Mini Player</h2>
                <p class="settings-section-desc">
                  Sesuaikan pintasan tombol navigasi sesuai kebiasaan Anda dan aktifkan pemutar mini mengambang (Picture-in-Picture) untuk mendengarkan saat bekerja di aplikasi lain.
                </p>
              </div>
              <div class="settings-section-actions" style="margin-left:auto;">
                <button class="btn btn-secondary btn-sm" id="btnResetAllShortcuts" title="Kembalikan semua pintasan ke bawaan">Reset Pintasan</button>
              </div>
            </div>

            <!-- Subcard: Mini Player Mengambang (Picture-in-Picture) UX-02 -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Mini Player Mengambang (Picture-in-Picture)</h3>
                  <p class="settings-subcard-desc">
                    Tampilkan jendela pemutar kecil selalu di depan layar saat Anda menjelajah tab lain atau aplikasi kerja.
                  </p>
                </div>
                ${pipCap ? `
                  <button class="btn btn-primary btn-sm" id="btnSettingsOpenPip">
                    ${isPipOpen ? 'Tutup Mini Player' : 'Buka Mini Player'}
                  </button>
                ` : `
                  <span class="mono" style="font-size:0.75rem; color:#ef4444; background:rgba(239,68,68,0.1); padding:4px 8px; border-radius:4px;">Tidak Didukung Peramban</span>
                `}
              </div>

              <div style="background:rgba(255,255,255,0.02); border:1px solid var(--glass-border-subtle); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:12px; font-size:0.8rem; color:var(--text-dim); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <div>
                  Status Mesin: <strong style="color:var(--text-main);">${pipCap === 'document' ? 'Document Picture-in-Picture (Interaktif Penuh)' : (pipCap === 'video' ? 'Canvas Video Stream PiP (Kontrol Media Session)' : 'Tidak Didukung')}</strong>
                </div>
                ${!pipCap ? `<span style="font-size:0.75rem; color:var(--text-dim);">Lihat menu Diagnostik untuk penjelasan detail.</span>` : ''}
              </div>

              <div class="settings-row-item">
                <div class="settings-row-info">
                  <span class="settings-row-label">Buka PiP Otomatis Saat Pindah Tab</span>
                  <span class="settings-row-sub">Secara otomatis memunculkan pemutar mini mengambang ketika tab Audiophile tidak aktif / berpindah ke tab lain saat lagu diputar.</span>
                </div>
                <label class="settings-switch" aria-label="Buka PiP otomatis">
                  <input type="checkbox" id="chkAutoPipTab" ${autoPipOnTabBlur ? 'checked' : ''} ${!pipCap ? 'disabled' : ''} />
                  <span class="settings-switch-slider"></span>
                </label>
              </div>
            </div>

            <!-- Subcard: Pintasan Keyboard Kustom UX-01 -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Pintasan Keyboard Kustom</h3>
                  <p class="settings-subcard-desc">
                    Klik tombol "Ubah" pada aksi yang diinginkan, lalu tekan kombinasi tombol baru pada keyboard Anda.
                  </p>
                </div>
                <div class="flex-center" style="gap:8px;">
                  <button class="btn btn-secondary btn-sm" id="btnExportShortcuts" title="Simpan konfigurasi pintasan ke berkas JSON">Ekspor JSON</button>
                  <button class="btn btn-secondary btn-sm" id="btnImportShortcutsTrigger" title="Muat konfigurasi pintasan dari berkas JSON">Impor JSON</button>
                  <input type="file" id="inputImportShortcuts" accept=".json" style="display:none;" />
                </div>
              </div>

              <!-- Tab Active Explanation Notice -->
              <div style="background:rgba(59, 130, 246, 0.08); border:1px solid rgba(59, 130, 246, 0.2); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:14px; font-size:0.78rem; color:var(--text-main); line-height:1.45;">
                <strong>Perhatian:</strong> Pintasan keyboard dalam aplikasi hanya bekerja saat tab peramban Audiophile sedang aktif. Tombol multimedia fisik di keyboard atau headset Anda (Play, Next, Previous) dikelola terpisah melalui Media Session API sistem operasi Anda.
              </div>

              <!-- Shortcut Mapping Table -->
              <div style="border:1px solid var(--glass-border-subtle); border-radius:var(--radius-sm); overflow:hidden;">
                <table style="width:100%; border-collapse:collapse; font-size:0.82rem; text-align:left;">
                  <thead>
                    <tr style="background:rgba(255,255,255,0.03); border-bottom:1px solid var(--glass-border-subtle);">
                      <th style="padding:10px 14px; font-weight:600; color:var(--text-dim);">Fungsi & Aksi</th>
                      <th style="padding:10px 14px; font-weight:600; color:var(--accent-light);">Tombol Saat Ini</th>
                      <th style="padding:10px 14px; font-weight:600; color:var(--text-dim); text-align:right;">Aksi</th>
                    </tr>
                  </thead>
                  <tbody id="shortcutsTableBody">
                    ${Object.entries(shortcutManager.getShortcuts()).map(([actionId, item]) => `
                      <tr style="border-bottom:1px solid rgba(255,255,255,0.02);" data-action-row="${actionId}">
                        <td style="padding:10px 14px; color:var(--text-main); font-weight:500;">
                          ${escapeHtml(item.label)}
                        </td>
                        <td style="padding:10px 14px;">
                          <kbd style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px; padding:3px 8px; font-family:var(--font-mono); font-size:0.75rem; color:var(--accent-light);" id="kbd_${actionId}">
                            ${escapeHtml(shortcutManager.formatDisplay(item.code))}
                          </kbd>
                        </td>
                        <td style="padding:10px 14px; text-align:right;">
                          <div style="display:inline-flex; gap:6px;">
                            <button class="btn btn-secondary btn-sm btn-record-shortcut" data-action="${actionId}">Ubah</button>
                            <button class="btn btn-secondary btn-sm btn-reset-single-shortcut" data-action="${actionId}" title="Kembalikan ke bawaan">Reset</button>
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <!-- SECTION 3: FIDELITAS & SPEKTRUM -->
        <section class="settings-section ${this.activeCategory !== 'all' && this.activeCategory !== 'quality' ? 'hidden' : ''}" data-category="quality" id="sec_quality">
          <div class="settings-card">
            <div class="settings-section-head">
              <div class="settings-section-icon-box">
                <svg viewBox="0 0 24 24"><path d="M19 4H5C3.89 4 3 4.9 3 6V18C3 19.1 3.89 20 5 20H19C20.1 20 21 19.1 21 18V6C21 4.9 20.1 4 19 4ZM10.25 15C9.84 15 9.5 14.66 9.5 14.25V13H7.5V14.25C7.5 14.66 7.16 15 6.75 15C6.34 15 6 14.66 6 14.25V9.75C6 9.34 6.34 9 6.75 9C7.16 9 7.5 9.34 7.5 9.75V11.5H9.5V9.75C9.5 9.34 9.84 9 10.25 9C10.66 9 11 9.34 11 9.75V14.25C11 14.66 10.66 15 10.25 15ZM18 14C18 14.55 17.55 15 17 15H16.25V15.75C16.25 16.16 15.91 16.5 15.5 16.5C15.09 16.5 14.75 16.16 14.75 15.75V15H14C13.45 15 13 14.55 13 14V10C13 9.45 13.45 9 14 9H17C17.55 9 18 9.45 18 10V14ZM14.5 13.5H16.5V10.5H14.5V13.5Z"/></svg>
              </div>
              <div class="settings-section-meta">
                <span class="settings-section-badge">Fidelitas & Verifikasi</span>
                <h2 class="settings-section-title">Audit Spektrogram Keaslian Hi-Res</h2>
                <p class="settings-section-desc">
                  Deteksi keaslian fisik berkas audio menggunakan Fast Fourier Transform (FFT) di Web Worker independen.
                </p>
              </div>
              <div class="settings-section-actions" style="margin-left:auto;">
                <button class="btn btn-secondary btn-sm btn-reset-sec" data-sec="autoAnalyzeOnImport" title="Kembalikan bagian ini ke default">Reset Bagian Ini</button>
              </div>
            </div>

            <!-- Quality Overview Stats -->
            <div class="quality-stats-grid">
              <div class="quality-stat-card">
                <span class="quality-stat-val" style="color:var(--status-verified);">${verifiedCount}</span>
                <span class="quality-stat-lbl">Terverifikasi Hi-Res</span>
              </div>
              <div class="quality-stat-card">
                <span class="quality-stat-val" style="color:var(--status-suspect);">${suspectCount}</span>
                <span class="quality-stat-lbl">Diduga Palsu / Upsample</span>
              </div>
              <div class="quality-stat-card">
                <span class="quality-stat-val" style="color:var(--text-dim);">${pendingCount}</span>
                <span class="quality-stat-lbl">Belum Dianalisis</span>
              </div>
            </div>

            <!-- Batch Analysis Subcard -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Analisis Spektrum Massal</h3>
                  <p class="settings-subcard-desc">
                    Pindai seluruh pustaka untuk mendeteksi berkas upsample palsu dari CD atau transcode lossy dari MP3.
                  </p>
                </div>
                <button class="btn btn-primary" id="btnSettingsBatchAnalyze">
                  <span>${analyzer.isBatchRunning ? 'Hentikan Analisis' : 'Analisis Seluruh Perpustakaan'}</span>
                </button>
              </div>

              <!-- Progress bar container -->
              <div id="settingsBatchProgressWrapper" style="display:${analyzer.isBatchRunning ? 'block' : 'none'}; margin-top:12px;">
                <div class="mono" id="settingsBatchProgressLabel" style="font-size:0.75rem; color:var(--text-dim); margin-bottom:6px;">Menjalankan analisis FFT...</div>
                <div class="settings-progress-track">
                  <div class="settings-progress-fill" id="settingsBatchProgressFill" style="width:0%;"></div>
                </div>
              </div>

              <!-- Auto-analyze toggle -->
              <div class="settings-row-item" style="margin-top:14px; padding-top:12px; border-top:1px solid var(--glass-border-subtle);">
                <div class="settings-row-info">
                  <span class="settings-row-label">Analisis Otomatis Saat Impor</span>
                  <span class="settings-row-sub">Jalankan inspeksi spektrum di latar belakang saat folder baru dihubungkan.</span>
                </div>
                <label class="settings-switch" aria-label="Analisis otomatis saat impor">
                  <input type="checkbox" id="chkAutoAnalyzeOnImport" ${settings.get('autoAnalyzeOnImport') ? 'checked' : ''} />
                  <span class="settings-switch-slider"></span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <!-- SECTION 4: PRIVASI & JARINGAN -->
        <section class="settings-section ${this.activeCategory !== 'all' && this.activeCategory !== 'privacy' ? 'hidden' : ''}" data-category="privacy" id="sec_privacy">
          <div class="settings-card">
            <div class="settings-section-head">
              <div class="settings-section-icon-box">
                <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
              </div>
              <div class="settings-section-meta">
                <span class="settings-section-badge">Privasi & Jaringan</span>
                <h2 class="settings-section-title">Privasi & Gerbang Koneksi Keluar</h2>
                <p class="settings-section-desc">
                  Audiophile dirancang dengan filosofi lokal murni. Kami memberikan kendali penuh terhadap setiap layanan internet eksternal yang dihubungi oleh aplikasi.
                </p>
              </div>
              <div class="settings-section-actions" style="margin-left:auto;">
                <button class="btn btn-secondary btn-sm btn-reset-sec" data-sec="privacy" title="Kembalikan bagian ini ke default">Reset Bagian Ini</button>
              </div>
            </div>

            <!-- Master Offline Toggle Subcard -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <h3 class="settings-subcard-title">Mode Offline Total</h3>
                    ${totalOffline ? `<span class="mono" style="background:#ef4444; color:#fff; padding:2px 8px; border-radius:10px; font-size:0.7rem; font-weight:700;">Offline</span>` : ''}
                  </div>
                  <p class="settings-subcard-desc">
                    Blokir seluruh koneksi internet keluar secara mutlak. Menampilkan lencana Offline kecil dan memastikan data perpustakaan tidak pernah meninggalkan komputer Anda.
                  </p>
                </div>
                <label class="settings-switch" aria-label="Aktifkan Mode Offline Total">
                  <input type="checkbox" id="chkTotalOffline" ${totalOffline ? 'checked' : ''} />
                  <span class="settings-switch-slider"></span>
                </label>
              </div>
            </div>

            <!-- External Services Granular Toggles -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Daftar Layanan Jaringan Eksternal</h3>
                  <p class="settings-subcard-desc">
                    Konfigurasikan izin per layanan. Layanan yang mengirimkan nama artis atau judul album dimatikan secara default demi privasi koleksi Anda.
                  </p>
                </div>
              </div>

              <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
                ${Object.values(EXTERNAL_SERVICES).map(service => {
                  const allowed = isServiceAllowed(service.id);
                  return `
                    <div class="settings-row-item" style="border:1px solid var(--glass-border-subtle); border-radius:var(--radius-sm); padding:12px; background:rgba(255,255,255,0.01);">
                      <div class="settings-row-info" style="flex:1;">
                        <span class="settings-row-label" style="font-size:0.92rem;">${escapeHtml(service.name)}</span>
                        <span class="settings-row-sub" style="margin-top:2px;">${escapeHtml(service.purpose)}</span>
                        <span class="mono" style="font-size:0.75rem; color:var(--text-dim); margin-top:4px; display:block;">
                          Data yang dikirim: <strong style="color:var(--text-main);">${escapeHtml(service.dataSent)}</strong>
                        </span>
                      </div>
                      <label class="settings-switch" aria-label="Toggle ${escapeHtml(service.name)}">
                        <input type="checkbox" class="chk-service-toggle" data-service-id="${service.id}" ${allowed ? 'checked' : ''} ${totalOffline ? 'disabled' : ''} />
                        <span class="settings-switch-slider"></span>
                      </label>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        </section>

        <!-- SECTION 5: SISTEM & CADANGAN -->
        <section class="settings-section ${this.activeCategory !== 'all' && this.activeCategory !== 'system' ? 'hidden' : ''}" data-category="system" id="sec_system">
          <div class="settings-card">
            <div class="settings-section-head">
              <div class="settings-section-icon-box">
                <svg viewBox="0 0 24 24"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>
              </div>
              <div class="settings-section-meta">
                <span class="settings-section-badge">Sistem & Cadangan</span>
                <h2 class="settings-section-title">Pencadangan, Diagnostik & Tampilan</h2>
                <p class="settings-section-desc">
                  Kelola cadangan data pengguna lengkap, verifikasi kapabilitas API peramban, serta preferensi tema dan bahasa antarmuka.
                </p>
              </div>
              <div class="settings-section-actions" style="margin-left:auto;">
                <button class="btn btn-secondary btn-sm btn-reset-sec" data-sec="theme" title="Kembalikan bagian ini ke default">Reset Bagian Ini</button>
              </div>
            </div>

            <!-- Backup & Restore Subcard -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Pencadangan & Pemulihan (Backup & Restore)</h3>
                  <p class="settings-subcard-desc">
                    Simpan playlist, favorit, statistik, tag override, dan konfigurasi ke satu berkas JSON mandiri.
                  </p>
                </div>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                  <button class="btn btn-primary" id="btnExportBackup" style="display:inline-flex; align-items:center; gap:8px;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span>Backup Sekarang</span>
                  </button>
                  <label class="btn btn-secondary" style="cursor:pointer; display:inline-flex; align-items:center; gap:8px;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span>Pulihkan Cadangan (JSON)</span>
                    <input type="file" id="inputImportBackup" accept=".json" style="display:none;" />
                  </label>
                </div>
              </div>
              <div class="mono" style="font-size:0.75rem; color:var(--text-dim); margin-top:8px;">
                Terakhir dicadangkan: <strong style="color:var(--text-main);">${backupDateFormatted}</strong>
              </div>
            </div>

            <!-- Storage Persistence Subcard -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Ketahanan Penyimpanan Lokal (IndexedDB)</h3>
                  <p class="settings-subcard-desc">
                    ${storageInfo.persisted
                      ? 'Penyimpanan permanen aktif. Peramban tidak akan menghapus playlist atau riwayat Anda saat memori disk penuh.'
                      : 'Penyimpanan masih berstatus standar. Klik tombol di samping agar peramban melindungi data dari pembersihan otomatis.'
                    }
                  </p>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                  <span class="mono" style="padding:4px 10px; border-radius:var(--radius-xs); font-size:0.78rem; font-weight:700; ${storageInfo.persisted ? 'background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3);' : 'background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.3);'}">
                    ${storageInfo.persisted ? 'Penyimpanan Permanen Aktif' : 'Status Standar'}
                  </span>
                  ${!storageInfo.persisted ? `
                    <button class="btn btn-secondary btn-sm" id="btnRequestPersist">Aktifkan Proteksi</button>
                  ` : ''}
                </div>
              </div>
              <div class="mono" style="font-size:0.75rem; color:var(--text-dim); margin-top:8px;">
                Penggunaan memori IndexedDB: <strong style="color:var(--text-main);">${storageInfo.usageMB} MB</strong> dari perkiraan kuota <strong style="color:var(--text-main);">${storageInfo.quotaMB} MB</strong>
              </div>
            </div>

            <!-- Desktop PWA Subcard -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Aplikasi Mandiri Desktop (PWA)</h3>
                  <p class="settings-subcard-desc">
                    Jalankan Audiophile sebagai aplikasi native desktop tanpa address bar atau tab peramban, terintegrasi langsung dengan Start Menu dan Taskbar Windows/macOS.
                  </p>
                </div>
                <div id="pwaInstallContainer"></div>
              </div>
            </div>

            <!-- System Diagnostics & Self-Test Subcard -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Tentang Aplikasi & Uji Mandiri Diagnostik</h3>
                  <p class="settings-subcard-desc">
                    ${APP_VERSION_INFO.name} v${APP_VERSION_INFO.version} (${APP_VERSION_INFO.buildDate}). Jalankan uji mandiri logika sistem secara instan di memori peramban.
                  </p>
                </div>
                <button class="btn btn-secondary" id="btnOpenDiagnosticsModal" style="display:inline-flex; align-items:center; gap:8px;">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  <span>Buka Diagnostik & Uji Mandiri</span>
                </button>
              </div>
            </div>

            <!-- Theme & Language Subcard -->
            <div class="settings-subcard">
              <div class="settings-subcard-head">
                <div>
                  <h3 class="settings-subcard-title">Personalisasi Tampilan & Bahasa</h3>
                  <p class="settings-subcard-desc">Pilihan gaya visual Aurora Glass dan lokalisasi antarmuka.</p>
                </div>
              </div>

              <div class="settings-row-item">
                <div class="settings-row-info">
                  <span class="settings-row-label">Tema Tampilan</span>
                  <span class="settings-row-sub">Pilih nuansa warna palet Aurora Glass.</span>
                </div>
                <select class="settings-select" id="selectTheme">
                  <option value="dark" ${settings.get('theme') === 'dark' ? 'selected' : ''}>Aurora Dark (Bawaan)</option>
                  <option value="light" ${settings.get('theme') === 'light' ? 'selected' : ''}>Aurora Light</option>
                  <option value="oled" ${settings.get('theme') === 'oled' ? 'selected' : ''}>OLED True Black</option>
                  <option value="cyberpunk" ${settings.get('theme') === 'cyberpunk' ? 'selected' : ''}>Cyberpunk Neon</option>
                </select>
              </div>

              <div class="settings-row-item">
                <div class="settings-row-info">
                  <span class="settings-row-label">Bahasa Antarmuka</span>
                  <span class="settings-row-sub">Pilih bahasa teks aplikasi.</span>
                </div>
                <select class="settings-select" id="selectLang">
                  <option value="id" ${settings.get('lang') === 'id' ? 'selected' : ''}>Bahasa Indonesia</option>
                  <option value="en" ${settings.get('lang') === 'en' ? 'selected' : ''}>English</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        <!-- SECTION 6: EKSTENSI & PUSAT MOD (ZIP MODDING SYSTEM) -->
        <section class="settings-section ${this.activeCategory !== 'all' && this.activeCategory !== 'mods' ? 'hidden' : ''}" data-category="mods" id="sec_mods">
          <div class="settings-card">
            <div class="settings-section-head">
              <div class="settings-section-icon-box">
                <svg viewBox="0 0 24 24"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5s-1.12-2.5-2.5-2.5z"/></svg>
              </div>
              <div class="settings-section-meta">
                <span class="settings-section-badge">Ekstensi & Modifikasi</span>
                <h2 class="settings-section-title">Pusat Mod Berbasis ZIP</h2>
                <p class="settings-section-desc">
                  Pasang mod tampilan (CSS), fungsional (JS), atau pengurangan elemen UI hanya dengan mengimpor berkas .zip. Seluruh mod diekstrak dan dieksekusi secara lokal dan aman di peramban Anda.
                </p>
              </div>
              <div class="settings-section-actions" style="margin-left:auto; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <button class="btn btn-primary btn-sm" id="btnSettingsInstallSampleMod" title="Pasang contoh mod Cyberpunk Neon & Quick Boost bawaan">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                  <span>Pasang Contoh Mod</span>
                </button>
                <button class="btn btn-secondary btn-sm" id="btnSettingsInstallJiggleMod" title="Pasang mod bilah gelombang pegas interaktif (Jiggle Spring Waveform)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><circle cx="14" cy="12" r="2" fill="currentColor"/></svg>
                  <span>Pasang Mod Gelombang Pegas</span>
                </button>
                <button class="btn btn-secondary btn-sm" id="btnSettingsDownloadStarterKit" title="Unduh template ZIP kosong untuk membuat mod sendiri">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Unduh Template (.zip)</span>
                </button>
                <button class="btn btn-secondary btn-sm" id="btnSettingsSafeMode" title="Nonaktifkan seluruh mod sekaligus">
                  <span>Nonaktifkan Semua Mod</span>
                </button>
              </div>
            </div>

            <!-- ZIP Dropzone -->
            <div class="mod-dropzone" id="modDropzone">
              <div class="mod-dropzone-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </div>
              <div>
                <h3 class="mod-dropzone-title">Tarik & Lepas Berkas Mod .ZIP ke Sini</h3>
                <p class="mod-dropzone-subtitle">atau klik untuk memilih berkas ZIP dari penyimpanan lokal komputer</p>
              </div>
              <input type="file" id="inputModZipFile" accept=".zip,application/zip" style="display:none;" />
            </div>

            <!-- Installed Mods Header & List -->
            <div style="margin-top:20px;">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                <h3 style="font-size:0.95rem; font-weight:700; color:var(--text-main); margin:0;">
                  Daftar Mod Terpasang (${installedMods.length})
                </h3>
                <span class="mono" style="font-size:0.75rem; color:var(--text-dim);">
                  ${installedMods.filter(m => m.enabled).length} Aktif
                </span>
              </div>
              ${this._renderModCardsHtml(installedMods)}
            </div>
          </div>
        </section>
      </div>

      <!-- Modal Placeholder for Backup Restore Preview & Diagnostics -->
      <div id="settingsCustomModalHost"></div>
    `;

    this.container.innerHTML = localizeSettingsHtml(rawHtml, i18n.getLocale());
    this.bindEvents();
  }

  bindEvents() {
    // Category Navigation Filter Pills (Fluid Liquid Tabs)
    const navTabs = this.container.querySelector('.settings-nav-tabs');
    if (navTabs) {
      const tabBtns = [...navTabs.querySelectorAll('.settings-nav-tab')];
      const activeIdx = tabBtns.findIndex(b => b.getAttribute('data-cat') === this.activeCategory);
      liquid(navTabs, {
        index: activeIdx >= 0 ? activeIdx : 0,
        drag: false,
        onChange: (idx, btn) => {
          const cat = btn.getAttribute('data-cat');
          this.activeCategory = cat;

          try {
            btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          } catch {}

          this.container.querySelectorAll('.settings-section').forEach(sec => {
            if (cat === 'all') {
              sec.classList.remove('hidden');
            } else {
              const secCat = sec.getAttribute('data-category');
              if (secCat === cat) {
                sec.classList.remove('hidden');
                sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } else {
                sec.classList.add('hidden');
              }
            }
          });
        }
      });
    }

    // Reset Section Buttons
    this.container.querySelectorAll('.btn-reset-sec').forEach(btn => {
      btn.addEventListener('click', () => {
        const sec = btn.getAttribute('data-sec');
        if (sec === 'library') {
          settings.resetSection('viewMode');
          settings.resetSection('sortFilter');
        } else if (sec === 'pureMode') {
          settings.resetSection('pureMode');
          settings.resetSection('eqGains');
          settings.resetSection('crossfade');
          engine.setPureMode(true);
        } else if (sec === 'autoAnalyzeOnImport') {
          settings.resetSection('autoAnalyzeOnImport');
        } else if (sec === 'privacy') {
          settings.resetSection('privacy');
        } else if (sec === 'theme') {
          settings.resetSection('theme');
          settings.resetSection('lang');
        }
        this.render();
      });
    });

    // Import Folder & Rescan from Settings
    const handleSettingsImport = () => {
      const fallback = document.getElementById('inputSettingsFallbackFolder');
      folderManager.triggerFolderImport(fallback);
    };

    document.getElementById('btnSettingsImportFolder')?.addEventListener('click', handleSettingsImport);

    document.getElementById('inputSettingsFallbackFolder')?.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        toast.info(`Memproses ${e.target.files.length} berkas...`);
        await scanner.scanFileList(e.target.files);
        toast.success('Selesai memproses berkas.');
        e.target.value = '';
        this.render();
      }
    });

    document.getElementById('btnSettingsRescan')?.addEventListener('click', async () => {
      const folders = store.get('folders') || [];
      if (folders.length > 0 && folders[0].handle) {
        toast.info('Memindai ulang folder musik...');
        await scanner.scanDirectoryHandle(folders[0].handle);
        toast.success('Pemindaian ulang selesai.');
        this.render();
      } else {
        toast.info('Folder fisik perlu dihubungkan kembali.');
      }
    });

    // Online Metadata Fetching Event Handlers
    const ensureServicesAllowed = async (requiredServices = []) => {
      if (isTotalOffline()) {
        await dialog.alert({
          title: 'Mode Offline Total Aktif',
          message: 'Mode Offline Total sedang aktif sehingga akses jaringan eksternal diblokir. Nonaktifkan Mode Offline Total di tab Privasi & Jaringan untuk mengambil metadata online.'
        });
        return false;
      }

      const missingServices = requiredServices.filter(s => !isServiceAllowed(s));
      if (missingServices.length > 0) {
        const names = missingServices.map(s => EXTERNAL_SERVICES[s]?.name || s).join(', ');
        const confirm = await dialog.confirm({
          title: 'Izin Layanan Eksternal Diperlukan',
          message: `Untuk mengambil metadata, aplikasi memerlukan akses ke layanan: ${names}. Apakah Anda ingin mengizinkan layanan ini sekarang?`,
          confirmText: 'Izinkan & Lanjutkan',
          cancelText: 'Batal'
        });
        if (!confirm) return false;

        for (const s of missingServices) {
          settings.set(`privacy.services.${s}`, true);
        }
        toast.success(`Layanan ${names} telah diizinkan.`);
      }
      return true;
    };

    const updateFetchProgressUI = (visible, text = '', pct = 0) => {
      const box = document.getElementById('metaFetchProgressBox');
      const statusText = document.getElementById('metaFetchStatusText');
      const percentText = document.getElementById('metaFetchPercentText');
      const fill = document.getElementById('metaFetchProgressFill');
      if (box) box.style.display = visible ? 'flex' : 'none';
      if (statusText && text) statusText.textContent = text;
      if (percentText) percentText.textContent = `${pct}%`;
      if (fill) fill.style.width = `${pct}%`;
    };

    // 1. Fetch Profiles Only
    document.getElementById('btnFetchProfiles')?.addEventListener('click', async () => {
      const allowed = await ensureServicesAllowed(['deezer', 'wikipedia']);
      if (!allowed) return;

      const tracks = store.get('tracks') || [];
      if (tracks.length === 0) {
        toast.info('Belum ada lagu di koleksi untuk diproses.');
        return;
      }

      updateFetchProgressUI(true, 'Memulai pengambilan profil musisi...', 0);
      try {
        const res = await artistMetaService.batchFetchProfiles(({ current, total, item, percent }) => {
          updateFetchProgressUI(true, `Mengambil profil: ${item} (${current}/${total})`, percent);
        });
        updateFetchProgressUI(true, 'Selesai!', 100);
        setTimeout(() => updateFetchProgressUI(false), 2500);
        toast.success(`Berhasil memperbarui ${res.updated} dari ${res.total} profil musisi.`);
        events.emit('library:updated');
      } catch (err) {
        toast.error('Terjadi kesalahan saat mengambil profil.');
        updateFetchProgressUI(false);
      }
    });

    // 2. Fetch Banners Only
    document.getElementById('btnFetchBanners')?.addEventListener('click', async () => {
      const allowed = await ensureServicesAllowed(['wikimedia', 'wikipedia']);
      if (!allowed) return;

      const tracks = store.get('tracks') || [];
      if (tracks.length === 0) {
        toast.info('Belum ada lagu di koleksi untuk diproses.');
        return;
      }

      updateFetchProgressUI(true, 'Memulai pengambilan banner konser...', 0);
      try {
        const res = await artistMetaService.batchFetchBanners(({ current, total, item, percent }) => {
          updateFetchProgressUI(true, `Mengambil banner: ${item} (${current}/${total})`, percent);
        });
        updateFetchProgressUI(true, 'Selesai!', 100);
        setTimeout(() => updateFetchProgressUI(false), 2500);
        toast.success(`Berhasil memperbarui ${res.updated} dari ${res.total} banner artis.`);
        events.emit('library:updated');
      } catch (err) {
        toast.error('Terjadi kesalahan saat mengambil banner.');
        updateFetchProgressUI(false);
      }
    });

    // 3. Fetch Albums Only
    document.getElementById('btnFetchAlbums')?.addEventListener('click', async () => {
      const allowed = await ensureServicesAllowed(['deezer', 'itunes']);
      if (!allowed) return;

      const tracks = store.get('tracks') || [];
      if (tracks.length === 0) {
        toast.info('Belum ada lagu di koleksi untuk diproses.');
        return;
      }

      updateFetchProgressUI(true, 'Memulai pengambilan sampul album resmi...', 0);
      try {
        const res = await artistMetaService.batchFetchAlbums(({ current, total, item, percent }) => {
          updateFetchProgressUI(true, `Mengambil sampul: ${item} (${current}/${total})`, percent);
        });
        updateFetchProgressUI(true, 'Selesai!', 100);
        setTimeout(() => updateFetchProgressUI(false), 2500);
        toast.success(`Berhasil memperbarui ${res.updated} dari ${res.total} sampul album.`);
        events.emit('library:updated');
      } catch (err) {
        toast.error('Terjadi kesalahan saat mengambil sampul album.');
        updateFetchProgressUI(false);
      }
    });

    // 4. Fetch All Metadata
    document.getElementById('btnFetchAllMeta')?.addEventListener('click', async () => {
      const allowed = await ensureServicesAllowed(['deezer', 'wikimedia', 'wikipedia', 'itunes']);
      if (!allowed) return;

      const tracks = store.get('tracks') || [];
      if (tracks.length === 0) {
        toast.info('Belum ada lagu di koleksi untuk diproses.');
        return;
      }

      updateFetchProgressUI(true, 'Memulai sinkronisasi seluruh metadata...', 0);
      try {
        const res = await artistMetaService.batchFetchAll(({ type, current, total, item, percent }) => {
          const typeLabel = type === 'profile' ? 'Profil' : type === 'banner' ? 'Banner' : 'Album';
          updateFetchProgressUI(true, `[${typeLabel}] ${item} (${current}/${total})`, percent);
        });
        updateFetchProgressUI(true, 'Selesai!', 100);
        setTimeout(() => updateFetchProgressUI(false), 3000);
        toast.success(`Sinkronisasi selesai: ${res.profiles.updated} profil, ${res.banners.updated} banner, ${res.albums.updated} album berhasil diperbarui.`);
        events.emit('library:updated');
      } catch (err) {
        toast.error('Terjadi kesalahan saat sinkronisasi metadata.');
        updateFetchProgressUI(false);
      }
    });

    // Batch Quality Analysis
    document.getElementById('btnSettingsBatchAnalyze')?.addEventListener('click', async () => {
      if (analyzer.isBatchRunning) {
        analyzer.stopBatchAnalysis();
        toast.info('Analisis spektrum dihentikan.');
      } else {
        const tracks = store.get('tracks') || [];
        if (tracks.length === 0) {
          toast.info('Belum ada lagu untuk dianalisis.');
          return;
        }
        toast.info(`Memulai analisis spektrum FFT untuk ${tracks.length} lagu...`);
        await analyzer.runBatchAnalysis(tracks, (t) => folderManager.getFileForTrack(t));
        toast.success('Analisis spektrum seluruh pustaka selesai.');
        this.render();
      }
    });

    // Auto-Analyze Checkbox
    document.getElementById('chkAutoAnalyzeOnImport')?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      settings.set('autoAnalyzeOnImport', enabled);
      toast.success(enabled
        ? 'Auto-analisis diaktifkan saat folder pertama kali diimpor.'
        : 'Auto-analisis dinonaktifkan.');
    });

    // Pure / Enhanced Mode Buttons
    document.getElementById('btnPureMode')?.addEventListener('click', () => {
      settings.set('pureMode', true);
      engine.setPureMode(true);
      this.render();
      toast.info('Mode Pure aktif: audio diputar langsung tanpa DSP (bypass Web Audio).');
    });

    document.getElementById('btnEnhancedMode')?.addEventListener('click', () => {
      settings.set('pureMode', false);
      engine.setPureMode(false);
      this.render();
      toast.info('Mode Enhanced aktif: Equalizer 10-Band aktif.');
    });

    document.getElementById('btnEqSwitchToEnhanced')?.addEventListener('click', () => {
      settings.set('pureMode', false);
      engine.setPureMode(false);
      this.render();
      toast.info('Mode Enhanced aktif: Equalizer siap digunakan.');
    });

    // Equalizer Tabs Switching (Graphic | Parametric)
    this.container.querySelectorAll('.eq-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-eq-tab');
        settings.set('eqMode', tab);
        engine.applyCurrentEqSettings();

        this.container.querySelectorAll('.eq-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const graphicWrap = document.getElementById('eqGraphicTabContent');
        const paramWrap = document.getElementById('eqParametricTabContent');
        if (tab === 'graphic') {
          if (graphicWrap) graphicWrap.style.display = 'block';
          if (paramWrap) paramWrap.style.display = 'none';
        } else {
          if (graphicWrap) graphicWrap.style.display = 'none';
          if (paramWrap) paramWrap.style.display = 'flex';
          this.setupParametricCanvas();
        }
      });
    });

    // Graphic Equalizer Sliders & Presets
    const updateEqSetting = (band, val) => {
      engine.setEqGain(band, val);
      const eqGains = [...settings.get('eqGains', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])];
      eqGains[band] = val;
      settings.set('eqGains', eqGains);
    };

    this.container.querySelectorAll('.eq-slider').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const band = parseInt(e.target.getAttribute('data-band'), 10);
        const val = parseFloat(e.target.value);
        const lbl = document.getElementById(`eqLabel_${band}`);
        if (lbl) lbl.innerText = val > 0 ? `+${val}` : `${val}`;
        updateEqSetting(band, val);
      });
    });

    this.container.querySelectorAll('.eq-preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const presetKey = chip.getAttribute('data-preset');
        const targetGains = EQ_PRESETS[presetKey];
        if (!targetGains) return;

        this.container.querySelectorAll('.eq-preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        this.container.querySelectorAll('.eq-slider').forEach((slider, i) => {
          const val = targetGains[i] ?? 0;
          slider.value = val;
          engine.setEqGain(i, val);
          const lbl = document.getElementById(`eqLabel_${i}`);
          if (lbl) lbl.innerText = val > 0 ? `+${val}` : `${val}`;
        });

        settings.set('eqGains', [...targetGains]);
        toast.info(`Preset EQ "${chip.innerText}" diterapkan.`);
      });
    });

    document.getElementById('btnResetEq')?.addEventListener('click', () => {
      this.container.querySelectorAll('.eq-slider').forEach((slider, i) => {
        slider.value = 0;
        engine.setEqGain(i, 0);
        const lbl = document.getElementById(`eqLabel_${i}`);
        if (lbl) lbl.innerText = '0';
      });
      this.container.querySelectorAll('.eq-preset-chip').forEach(c => c.classList.remove('active'));
      settings.set('eqGains', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      toast.info('Equalizer direset ke posisi Flat.');
    });

    // Parametric Equalizer Listeners
    // 1. Bypass A/B Toggle
    document.getElementById('btnParametricBypass')?.addEventListener('click', () => {
      const currentBypass = settings.get('eqBypass', false);
      const nextBypass = !currentBypass;
      settings.set('eqBypass', nextBypass);
      engine.setEqBypass(nextBypass);

      const btn = document.getElementById('btnParametricBypass');
      if (btn) {
        btn.innerText = nextBypass ? 'Bypass EQ: AKTIF (A/B)' : 'Bypass EQ: Nonaktif';
        btn.className = `btn btn-sm ${nextBypass ? 'btn-danger' : 'btn-secondary'}`;
      }
      toast.info(nextBypass
        ? 'Bypass EQ aktif: mendengarkan suara murni tanpa filter (A/B testing).'
        : 'Bypass EQ nonaktif: filter EQ diterapkan.');
    });

    // 2. Auto Preamp Toggle
    document.getElementById('chkAutoPreamp')?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      settings.set('autoPreamp', enabled);
      const bands = settings.get('parametricBands', DEFAULT_SETTINGS.parametricBands);
      let curPreamp = settings.get('preamp', 0);
      if (enabled) {
        curPreamp = calculateAutoPreamp(bands);
        engine.setPreamp(curPreamp);
      } else {
        engine.setPreamp(curPreamp);
      }
      this.render();
      toast.info(enabled
        ? 'Preamp otomatis aktif: gain diturunkan untuk mencegah clipping digital.'
        : 'Preamp manual aktif.');
    });

    // 3. Manual Preamp Slider
    document.getElementById('rangePreamp')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      settings.set('preamp', val);
      engine.setPreamp(val);
      const lbl = document.getElementById('labelPreampVal');
      if (lbl) lbl.innerText = `${val.toFixed(1)} dB`;
      const canvas = document.getElementById('parametricEqCanvas');
      if (canvas) {
        const bands = settings.get('parametricBands', DEFAULT_SETTINGS.parametricBands);
        this.drawParametricCanvas(canvas, bands, val, this.selectedParametricBandIndex);
      }
    });

    // 4. Presets Management (Load, Save, Rename, Delete)
    document.getElementById('selParametricPreset')?.addEventListener('change', (e) => {
      const val = e.target.value;
      let targetBands = null;
      let targetPreamp = 0;

      if (val === '_custom_curve') return;

      if (val.startsWith('builtin:')) {
        const key = val.replace('builtin:', '');
        const p = PARAMETRIC_BUILTIN_PRESETS[key];
        if (p) {
          targetBands = p.bands;
          targetPreamp = p.preamp;
        }
      } else if (val.startsWith('custom:')) {
        const id = val.replace('custom:', '');
        const presets = settings.get('parametricPresets', []);
        const found = presets.find(p => p.id === id);
        if (found) {
          targetBands = found.bands;
          targetPreamp = found.preamp ?? 0;
        }
      }

      if (targetBands) {
        settings.set('parametricCurrentPreset', val);
        const clonedBands = JSON.parse(JSON.stringify(targetBands));
        settings.set('parametricBands', clonedBands);
        if (settings.get('autoPreamp')) {
          targetPreamp = calculateAutoPreamp(clonedBands);
        } else {
          settings.set('preamp', targetPreamp);
        }
        engine.setPreamp(targetPreamp);
        engine.applyCurrentEqSettings();
        toast.info(`Preset parametrik "${e.target.options[e.target.selectedIndex].text}" diterapkan.`);
        this.render();
      }
    });

    document.getElementById('btnResetParametricFlat')?.addEventListener('click', () => {
      const flat = PARAMETRIC_BUILTIN_PRESETS.flat;
      if (!flat) return;
      settings.set('parametricCurrentPreset', 'builtin:flat');
      const clonedBands = JSON.parse(JSON.stringify(flat.bands));
      settings.set('parametricBands', clonedBands);
      let targetPreamp = 0;
      if (settings.get('autoPreamp')) {
        targetPreamp = calculateAutoPreamp(clonedBands);
      } else {
        settings.set('preamp', 0);
      }
      engine.setPreamp(targetPreamp);
      engine.applyCurrentEqSettings();
      toast.info('Equalizer parametrik direset ke posisi Flat.');
      this.render();
    });

    document.getElementById('btnSaveParametricPreset')?.addEventListener('click', () => {
      const name = prompt('Masukkan nama preset parametrik baru:');
      if (!name || !name.trim()) return;

      const currentBands = settings.get('parametricBands', DEFAULT_SETTINGS.parametricBands);
      const currentPreamp = settings.get('preamp', 0);
      const newPreset = {
        id: `preset_${Date.now()}`,
        name: name.trim(),
        bands: JSON.parse(JSON.stringify(currentBands)),
        preamp: currentPreamp
      };

      const customPresets = [...settings.get('parametricPresets', [])];
      customPresets.push(newPreset);
      settings.set('parametricPresets', customPresets);
      settings.set('parametricCurrentPreset', `custom:${newPreset.id}`);
      toast.success(`Preset "${name.trim()}" berhasil disimpan.`);
      this.render();
    });

    document.getElementById('btnRenameParametricPreset')?.addEventListener('click', () => {
      const sel = document.getElementById('selParametricPreset');
      if (!sel || !sel.value.startsWith('custom:')) {
        toast.info('Preset bawaan tidak dapat diubah namanya.');
        return;
      }
      const id = sel.value.replace('custom:', '');
      const customPresets = [...settings.get('parametricPresets', [])];
      const target = customPresets.find(p => p.id === id);
      if (!target) return;

      const newName = prompt('Ubah nama preset:', target.name);
      if (!newName || !newName.trim()) return;

      target.name = newName.trim();
      settings.set('parametricPresets', customPresets);
      toast.success(`Preset diubah nama menjadi "${newName.trim()}".`);
      this.render();
    });

    document.getElementById('btnDeleteParametricPreset')?.addEventListener('click', () => {
      const sel = document.getElementById('selParametricPreset');
      if (!sel || !sel.value.startsWith('custom:')) {
        toast.info('Preset bawaan tidak dapat dihapus.');
        return;
      }
      const id = sel.value.replace('custom:', '');
      const customPresets = settings.get('parametricPresets', []);
      const target = customPresets.find(p => p.id === id);
      if (!target) return;

      if (!confirm(`Hapus preset "${target.name}"?`)) return;

      const filtered = customPresets.filter(p => p.id !== id);
      settings.set('parametricPresets', filtered);
      settings.set('parametricCurrentPreset', 'builtin:flat');
      toast.success(`Preset "${target.name}" dihapus.`);
      this.render();
    });

    // 5. AutoEQ File Importer
    const btnImportAutoEq = document.getElementById('btnImportAutoEq');
    const inputAutoEqFile = document.getElementById('inputAutoEqFile');

    btnImportAutoEq?.addEventListener('click', () => {
      inputAutoEqFile?.click();
    });

    inputAutoEqFile?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text !== 'string') return;

        const parsed = parseAutoEqText(text);
        if (!parsed.success) {
          toast.error(parsed.error || 'Format berkas AutoEQ tidak valid.');
          return;
        }

        this.openAutoEqPreviewModal(parsed, file.name);
      };
      reader.onerror = () => {
        toast.error('Gagal membaca berkas teks.');
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // 6. Band Pills in Parametric EQ
    this.container.querySelectorAll('.eq-band-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const idx = parseInt(pill.getAttribute('data-band-idx'), 10);
        this.selectedParametricBandIndex = idx;
        this.updateParametricInspectorUI();
        const canvas = document.getElementById('parametricEqCanvas');
        if (canvas) {
          const bands = settings.get('parametricBands', DEFAULT_SETTINGS.parametricBands);
          const p = settings.get('autoPreamp') ? calculateAutoPreamp(bands) : settings.get('preamp', 0);
          this.drawParametricCanvas(canvas, bands, p, idx);
        }
      });
    });

    // 7. Band Inspector Inputs
    const onInspectorChange = () => {
      const bands = [...settings.get('parametricBands', DEFAULT_SETTINGS.parametricBands)];
      const idx = this.selectedParametricBandIndex;
      const b = { ...bands[idx] };

      const chkEnabled = document.getElementById('chkBandEnabled');
      const selType = document.getElementById('selBandType');
      const numFreq = document.getElementById('numBandFreq');
      const numGain = document.getElementById('numBandGain');
      const numQ = document.getElementById('numBandQ');

      if (chkEnabled) b.enabled = chkEnabled.checked;
      if (selType) b.type = selType.value;
      if (numFreq) b.freq = Math.max(20, Math.min(20000, Number(numFreq.value) || 1000));
      if (numGain) {
        if (['lowpass', 'highpass', 'notch'].includes(b.type)) {
          b.gain = 0;
        } else {
          b.gain = Math.max(-15, Math.min(15, Number(numGain.value) || 0));
        }
      }
      if (numQ) b.q = Math.max(0.1, Math.min(10.0, Number(numQ.value) || 1.41));

      bands[idx] = b;
      settings.set('parametricBands', bands);
      engine.setParametricBand(idx, b);

      let curPreamp = settings.get('preamp', 0);
      if (settings.get('autoPreamp')) {
        curPreamp = calculateAutoPreamp(bands);
        engine.setPreamp(curPreamp);
        const preLbl = document.getElementById('labelPreampVal');
        if (preLbl) preLbl.innerText = `${curPreamp.toFixed(1)} dB`;
      }

      const canvas = document.getElementById('parametricEqCanvas');
      if (canvas) {
        this.drawParametricCanvas(canvas, bands, curPreamp, idx);
      }
      this.updateParametricInspectorUI();
      this.markParametricCurveCustom();
    };

    document.getElementById('chkBandEnabled')?.addEventListener('change', onInspectorChange);
    document.getElementById('selBandType')?.addEventListener('change', onInspectorChange);

    const rangeFreq = document.getElementById('rangeBandFreq');
    const numFreq = document.getElementById('numBandFreq');
    rangeFreq?.addEventListener('input', (e) => {
      if (numFreq) numFreq.value = e.target.value;
      onInspectorChange();
    });
    numFreq?.addEventListener('change', (e) => {
      if (rangeFreq) rangeFreq.value = e.target.value;
      onInspectorChange();
    });

    const rangeGain = document.getElementById('rangeBandGain');
    const numGain = document.getElementById('numBandGain');
    rangeGain?.addEventListener('input', (e) => {
      if (numGain) numGain.value = e.target.value;
      onInspectorChange();
    });
    numGain?.addEventListener('change', (e) => {
      if (rangeGain) rangeGain.value = e.target.value;
      onInspectorChange();
    });

    const rangeQ = document.getElementById('rangeBandQ');
    const numQ = document.getElementById('numBandQ');
    rangeQ?.addEventListener('input', (e) => {
      if (numQ) numQ.value = e.target.value;
      onInspectorChange();
    });
    numQ?.addEventListener('change', (e) => {
      if (rangeQ) rangeQ.value = e.target.value;
      onInspectorChange();
    });

    // 8. Setup Canvas if in Parametric Mode
    this.setupParametricCanvas();


    // ReplayGain Listeners (ITU-R BS.1770)
    document.getElementById('chkReplayGain')?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      settings.set('replayGain', enabled);
      const cur = store.get('currentTrack');
      if (cur) engine.applyReplayGainForTrack(cur);
      this.render();
      toast.info(enabled ? 'Normalisasi ReplayGain diaktifkan.' : 'ReplayGain dinonaktifkan.');
    });

    document.getElementById('selReplayGainTarget')?.addEventListener('change', (e) => {
      const val = Number(e.target.value) || -18;
      settings.set('replayGainTarget', val);
      const cur = store.get('currentTrack');
      if (cur) engine.applyReplayGainForTrack(cur);
      toast.info(`Target kenyaringan diatur ke ${val} LUFS.`);
    });

    document.getElementById('chkReplayGainAntiClip')?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      settings.set('replayGainPreventClipping', enabled);
      const cur = store.get('currentTrack');
      if (cur) engine.applyReplayGainForTrack(cur);
      toast.info(enabled ? 'Proteksi anti-clipping True Peak aktif.' : 'Proteksi anti-clipping dimatikan.');
    });

    // Crossfeed Listeners (Bauer Binaural DSP)
    document.getElementById('chkCrossfeed')?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      engine.setCrossfeed(enabled);
      this.render();
      toast.info(enabled ? 'Simulasi Crossfeed Headphone diaktifkan.' : 'Crossfeed Headphone dinonaktifkan.');
    });

    document.getElementById('selCrossfeedPreset')?.addEventListener('change', (e) => {
      const preset = e.target.value;
      engine.setCrossfeed(true, { preset });
      this.render();
      toast.info(`Preset Crossfeed diatur ke ${preset.toUpperCase()}.`);
    });

    // Crossfade Toggle, Slider (0 - 12s, step 0.5), & Rules
    document.getElementById('chkCrossfadeEnabled')?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      settings.set('crossfade.enabled', enabled);
      toast.success(enabled ? 'Peleburan Crossfade diaktifkan.' : 'Crossfade dinonaktifkan.');
    });

    const crossfadeRange = document.getElementById('rangeCrossfade');
    crossfadeRange?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      const lbl = document.getElementById('labelCrossfadeVal');
      if (lbl) lbl.innerText = `${val}s`;
      settings.set('crossfade.duration', val);
      if (val > 0 && !settings.get('crossfade.enabled')) {
        settings.set('crossfade.enabled', true);
        const chk = document.getElementById('chkCrossfadeEnabled');
        if (chk) chk.checked = true;
      }
    });

    document.getElementById('chkAvoidConsecutive')?.addEventListener('change', (e) => {
      settings.set('crossfade.avoidConsecutiveAlbums', e.target.checked);
      toast.info(e.target.checked ? 'Album bersambung akan diputar secara gapless.' : 'Semua lagu akan di-crossfade.');
    });

    document.getElementById('chkManualSkip')?.addEventListener('change', (e) => {
      settings.set('crossfade.manualSkip', e.target.checked);
      toast.info(e.target.checked ? 'Crossfade mikro 250ms aktif saat lewati manual.' : 'Lewati manual instan tanpa crossfade.');
    });

    // Audio Output Device (AUD-04)
    const selOutput = this.container.querySelector('#selAudioOutputDevice');
    if (selOutput) {
      selOutput.addEventListener('change', async (e) => {
        const devId = e.target.value;
        const selectedOpt = selOutput.options[selOutput.selectedIndex];
        const label = selectedOpt ? selectedOpt.text : '';
        await outputManager.setAudioOutput(devId, label);
        toast.info(devId ? `Perangkat audio dialihkan ke: ${label}` : 'Menggunakan perangkat audio default sistem.');
        this.render();
      });
    }

    const btnPicker = this.container.querySelector('#btnSelectAudioOutputPicker');
    if (btnPicker) {
      btnPicker.addEventListener('click', async () => {
        const dev = await outputManager.promptSelectOutput();
        if (dev) {
          toast.info(`Perangkat audio dipilih: ${dev.label}`);
          this.render();
        }
      });
    }

    const selLinkedPreset = this.container.querySelector('#selDeviceLinkedPreset');
    if (selLinkedPreset) {
      selLinkedPreset.addEventListener('change', (e) => {
        const val = e.target.value;
        const curDevId = settings.get('audioOutput.deviceId', '');
        const curLabel = settings.get('audioOutput.deviceLabel', '');
        const currentKey = curLabel || curDevId || 'default';
        outputManager.linkPresetToDevice(currentKey, val);
        toast.info(val ? `Preset "${val}" berhasil dihubungkan ke perangkat ini.` : 'Tautan preset EQ dilepas.');
      });
    }

    // Privacy Controls: Master Offline & Per-Service Toggles
    document.getElementById('chkTotalOffline')?.addEventListener('change', (e) => {
      const isOff = e.target.checked;
      settings.set('privacy.totalOffline', isOff);
      toast.info(isOff
        ? 'Mode Offline Total aktif. Seluruh koneksi ke luar diblokir.'
        : 'Mode Offline Total dinonaktifkan.');
      this.render();
    });

    this.container.querySelectorAll('.chk-service-toggle').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const sId = chk.getAttribute('data-service-id');
        const allowed = e.target.checked;
        settings.set(`privacy.services.${sId}`, allowed);
        toast.info(`Layanan "${sId}" ${allowed ? 'diaktifkan' : 'dinonaktifkan'}.`);
      });
    });

    // Relink Missing Files
    document.getElementById('inputRelinkFiles')?.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        toast.info('Mencocokkan berkas...');
        const relinked = await scanner.relinkMissingTracks(Array.from(e.target.files));
        toast.success(`Berhasil mencocokkan ulang ${relinked} berkas.`);
        this.render();
      }
    });

    // Backup Export
    document.getElementById('btnExportBackup')?.addEventListener('click', async () => {
      try {
        const res = await BackupService.exportBackup();
        if (res) {
          toast.success('Berkas cadangan JSON berhasil dibuat.');
          this.render();
        }
      } catch (err) {
        console.error('Export error:', err);
        toast.error('Gagal mengekspor cadangan.');
      }
    });

    // Backup Import with Interactive Preview Dialog
    document.getElementById('inputImportBackup')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const { preview, payload } = await BackupService.validateAndPreview(file);
        this.openRestorePreviewModal(preview, payload);
      } catch (err) {
        console.error('Validation error:', err);
        toast.error(`Format berkas tidak valid: ${err.message}`);
      } finally {
        e.target.value = '';
      }
    });

    // Storage Persistence Request
    document.getElementById('btnRequestPersist')?.addEventListener('click', async () => {
      const granted = await DiagnosticsService.requestPersistence();
      if (granted) {
        toast.success('Penyimpanan lokal berhasil dilindungi permanen!');
      } else {
        toast.info('Peramban belum mengizinkan persistensi. Tandai bookmark atau tambahkan ke layar beranda untuk meningkatkan prioritas.');
      }
      this.render();
    });

    // Open Diagnostics & Self-Test Modal
    document.getElementById('btnOpenDiagnosticsModal')?.addEventListener('click', () => {
      this.openDiagnosticsModal();
    });

    // Desktop PWA Installation
    const isStandalone = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (typeof navigator !== 'undefined' && navigator.standalone);
    const pwaContainer = document.getElementById('pwaInstallContainer');
    if (pwaContainer) {
      if (isStandalone) {
        pwaContainer.innerHTML = localizeSettingsHtml('<span class="badge badge-verified" style="padding:6px 12px; font-size:0.8rem;">Terpasang (Aplikasi Mandiri)</span>', i18n.getLocale());
      } else {
        pwaContainer.innerHTML = localizeSettingsHtml(`
          <button class="btn btn-primary" id="btnInstallPwa" style="display:inline-flex; align-items:center; gap:8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Pasang Aplikasi Desktop</span>
          </button>
        `, i18n.getLocale());
        document.getElementById('btnInstallPwa')?.addEventListener('click', async () => {
          if (window.deferredPwaPrompt) {
            window.deferredPwaPrompt.prompt();
            const { outcome } = await window.deferredPwaPrompt.userChoice;
            if (outcome === 'accepted') {
              toast.success('Pemasangan Audiophile Desktop disetujui.');
            }
            window.deferredPwaPrompt = null;
          } else {
            toast.info('Gunakan ikon instalasi (komputer/panah) di bilah alamat browser Anda untuk memasang.');
          }
        });
      }
    }

    // Theme & Language Selects
    document.getElementById('selectTheme')?.addEventListener('change', (e) => {
      const theme = e.target.value;
      settings.set('theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
      toast.info(`Tema diubah ke: ${theme}`);
    });

    document.getElementById('selectLang')?.addEventListener('change', (e) => {
      const lang = e.target.value;
      settings.set('lang', lang);
      i18n.setLocale(lang);
      toast.info(t('toasts.languageChanged', { lang: lang === 'id' ? 'Bahasa Indonesia' : 'English' }));
    });

    // Night Mode Audio (UX-03)
    document.getElementById('btnNightSwitchToEnhanced')?.addEventListener('click', () => {
      settings.set('pureMode', false);
      engine.setPureMode(false);
      this.render();
      toast.info('Mode Enhanced aktif: Mode Malam siap digunakan.');
    });

    document.getElementById('chkNightModeEnable')?.addEventListener('change', async (e) => {
      const isPure = settings.get('pureMode', true);
      if (isPure && e.target.checked) {
        e.target.checked = false;
        const proceed = await dialog.confirm({
          title: 'Mode Malam Memerlukan Enhanced Mode',
          message: 'Mode Malam menggunakan kompresi rentang dinamis dan batas volume aman yang memerlukan pemrosesan DSP. Mode Pure saat ini aktif. Ingin beralih ke Mode Enhanced?',
          confirmText: 'Beralih ke Enhanced',
          cancelText: 'Batal'
        });
        if (!proceed) return;
        settings.set('pureMode', false);
        engine.setPureMode(false);
        toast.info('Beralih ke Mode Enhanced (DSP)');
      }
      const currentNight = settings.get('nightMode') || { enabled: false, intensity: 'mild', maxVolume: 0.70 };
      const enabled = e.target.checked;
      currentNight.enabled = enabled;
      settings.set('nightMode', currentNight);
      engine.setNightMode(enabled, currentNight);
      toast.info(enabled ? 'Mode Malam Audio diaktifkan.' : 'Mode Malam Audio dinonaktifkan.');
      this.render();
    });

    document.getElementById('selNightIntensity')?.addEventListener('change', (e) => {
      const intensity = e.target.value;
      const currentNight = settings.get('nightMode') || { enabled: false, intensity: 'mild', maxVolume: 0.70 };
      currentNight.intensity = intensity;
      settings.set('nightMode', currentNight);
      engine.setNightMode(currentNight.enabled, currentNight);
      toast.info(`Intensitas kompresi mode malam: ${intensity}`);
    });

    document.getElementById('rangeNightMaxVol')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      const lbl = document.getElementById('labelNightMaxVolVal');
      if (lbl) lbl.innerText = `${Math.round(val * 100)}%`;
      const currentNight = settings.get('nightMode') || { enabled: false, intensity: 'mild', maxVolume: 0.70 };
      currentNight.maxVolume = val;
      settings.set('nightMode', currentNight);
      engine.setNightMode(currentNight.enabled, currentNight);
    });

    document.getElementById('chkNightSchedule')?.addEventListener('change', (e) => {
      const isSched = e.target.checked;
      const currentNight = settings.get('nightMode') || { enabled: false, intensity: 'mild', maxVolume: 0.70 };
      currentNight.scheduleEnabled = isSched;
      settings.set('nightMode', currentNight);
      const row = document.getElementById('rowNightScheduleTimes');
      if (row) row.style.display = isSched ? 'flex' : 'none';
      toast.info(isSched ? 'Jadwal otomatis malam aktif.' : 'Jadwal otomatis dinonaktifkan.');
    });

    document.getElementById('inputNightStart')?.addEventListener('change', (e) => {
      settings.set('nightMode.scheduleStart', e.target.value);
    });

    document.getElementById('inputNightEnd')?.addEventListener('change', (e) => {
      settings.set('nightMode.scheduleEnd', e.target.value);
    });

    // Mini Player (PiP) (UX-02)
    document.getElementById('btnSettingsOpenPip')?.addEventListener('click', async () => {
      await pipManager.toggle();
      this.render();
    });

    document.getElementById('chkAutoPipTab')?.addEventListener('change', (e) => {
      settings.set('autoPipOnTabBlur', e.target.checked);
      toast.info(e.target.checked ? 'Auto-PiP saat pindah tab diaktifkan.' : 'Auto-PiP dinonaktifkan.');
    });

    // Pintasan Keyboard Kustom (UX-01)
    this.container.querySelectorAll('.btn-record-shortcut').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actionId = btn.getAttribute('data-action');
        if (!actionId) return;

        const originalText = btn.innerText;
        btn.innerText = 'Tekan tombol...';
        btn.classList.add('btn-primary');

        shortcutManager.startRecording(actionId, async (res) => {
          btn.innerText = originalText;
          btn.classList.remove('btn-primary');

          if (res.cancelled) {
            toast.info('Perekaman pintasan dibatalkan.');
            return;
          }

          if (res.isSystemConflict) {
            await dialog.alert({
              title: 'Bentrok Pintasan Peramban',
              message: `Kombinasi tombol "${shortcutManager.formatDisplay(res.combo)}" digunakan secara khusus oleh peramban sistem (mis. Ctrl+T, Ctrl+W, F5) dan tidak dapat digunakan.`
            });
            return;
          }

          if (res.otherActionConflict) {
            const confirmReplace = await dialog.confirm({
              title: 'Konflik Pintasan Tombol',
              message: `Tombol "${shortcutManager.formatDisplay(res.combo)}" saat ini digunakan untuk aksi "${res.otherActionConflict.label}". Apakah Anda ingin memindahkannya ke aksi ini?`,
              confirmText: 'Pindahkan Tombol',
              cancelText: 'Batal'
            });
            if (!confirmReplace) return;
          }

          shortcutManager.setShortcut(actionId, res.combo);
          toast.success(`Pintasan tombol berhasil diubah ke "${shortcutManager.formatDisplay(res.combo)}".`);
          this.render();
        });
      });
    });

    this.container.querySelectorAll('.btn-reset-single-shortcut').forEach(btn => {
      btn.addEventListener('click', () => {
        const actionId = btn.getAttribute('data-action');
        if (actionId) {
          shortcutManager.resetSingleShortcut(actionId);
          toast.info('Pintasan dikembalikan ke bawaan.');
          this.render();
        }
      });
    });

    document.getElementById('btnResetAllShortcuts')?.addEventListener('click', () => {
      shortcutManager.resetToDefaults();
      toast.info('Semua pintasan dikembalikan ke setelan pabrik.');
      this.render();
    });

    document.getElementById('btnExportShortcuts')?.addEventListener('click', () => {
      const jsonStr = shortcutManager.exportJson();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audiophile-shortcuts-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Berkas konfigurasi pintasan berhasil diunduh.');
    });

    document.getElementById('btnImportShortcutsTrigger')?.addEventListener('click', () => {
      document.getElementById('inputImportShortcuts')?.click();
    });

    document.getElementById('inputImportShortcuts')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const res = shortcutManager.importJson(text);
        if (res.success) {
          toast.success(`Berhasil mengimpor ${res.count} pintasan.`);
          this.render();
        } else {
          toast.error(res.error || 'Gagal mengimpor berkas pintasan.');
        }
      } catch (err) {
        toast.error('Gagal membaca berkas: ' + err.message);
      }
    });

    this._bindModEvents();
  }

  /**
   * Modal dialog for backup restore preview with Merge vs Overwrite options
   */
  openRestorePreviewModal(preview, payload) {
    const host = document.getElementById('settingsCustomModalHost');
    if (!host) return;

    host.innerHTML = localizeSettingsHtml(`
      <div class="modal-backdrop active" id="modalRestoreBackdrop" style="display:flex; align-items:center; justify-content:center; z-index:10000; position:fixed; inset:0; background:rgba(0,0,0,0.7); backdrop-filter:blur(8px);">
        <div class="glass-panel" style="max-width:540px; width:90%; padding:24px; border-radius:var(--radius-lg); border:1px solid var(--glass-border-specular); background:var(--glass-bg-card); box-shadow:0 20px 40px rgba(0,0,0,0.5);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h3 style="margin:0; font-size:1.2rem; font-weight:700; color:var(--text-main);">Pratinjau Pemulihan Data</h3>
            <button class="btn btn-icon btn-sm" id="btnCloseRestoreModal" aria-label="Tutup">${getIconSvg('close', { size: 18 })}</button>
          </div>

          <div style="background:rgba(255,255,255,0.02); border:1px solid var(--glass-border-subtle); border-radius:var(--radius-sm); padding:14px; margin-bottom:16px;">
            <div style="font-size:0.85rem; color:var(--text-dim); margin-bottom:8px;">
              Aplikasi: <strong style="color:var(--text-main);">${escapeHtml(preview.app)}</strong> (v${escapeHtml(preview.appVersion)})
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:0.82rem;">
              <div>Playlist: <strong style="color:var(--accent);">${preview.playlistsCount} daftar</strong></div>
              <div>Lagu Favorit: <strong style="color:var(--accent);">${preview.favoriteCount} lagu</strong></div>
              <div>Koreksi Tag: <strong style="color:var(--accent);">${preview.overridesCount} entri</strong></div>
              <div>Statistik Putar: <strong style="color:var(--accent);">${preview.statsCount} rekaman</strong></div>
              <div>Folder Terdaftar: <strong style="color:var(--text-main);">${preview.registeredFoldersCount} lokasi</strong></div>
              <div>Pengaturan Disertakan: <strong style="color:var(--text-main);">${preview.hasSettings ? 'Ya' : 'Tidak'}</strong></div>
            </div>
          </div>

          <div style="font-size:0.8rem; color:var(--text-muted); line-height:1.5; margin-bottom:20px;">
            <p style="margin:0 0 6px 0;"><strong>Gabung (Merge):</strong> Menambahkan playlist dan tag baru tanpa menghapus data yang sudah ada.</p>
            <p style="margin:0;"><strong>Timpa (Overwrite):</strong> Menimpa seluruh data lama dengan berkas cadangan ini. <em>Cadangan pengaman otomatis akan dibuat sebelum penimpaan.</em></p>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
            <button class="btn btn-secondary" id="btnCancelRestore">Batal</button>
            <button class="btn btn-secondary" id="btnDoRestoreMerge">Gabung (Merge)</button>
            <button class="btn btn-primary" id="btnDoRestoreOverwrite" style="background:#ef4444; border-color:#dc2626;">Timpa (Overwrite)</button>
          </div>
        </div>
      </div>
    `, i18n.getLocale());

    const closeModal = () => { host.innerHTML = ''; };
    document.getElementById('btnCloseRestoreModal')?.addEventListener('click', closeModal);
    document.getElementById('btnCancelRestore')?.addEventListener('click', closeModal);

    document.getElementById('btnDoRestoreMerge')?.addEventListener('click', async () => {
      closeModal();
      toast.info('Memulihkan dan menggabungkan data...');
      try {
        const report = await BackupService.importBackup(payload, 'merge');
        toast.success(report.message);
        this.render();
      } catch (err) {
        toast.error(`Gagal memulihkan: ${err.message}`);
      }
    });

    document.getElementById('btnDoRestoreOverwrite')?.addEventListener('click', async () => {
      closeModal();
      toast.info('Membuat cadangan pengaman dan memulihkan data...');
      try {
        const report = await BackupService.importBackup(payload, 'overwrite');
        toast.success(`Pemulihan timpa selesai! ${report.message}`);
        this.render();
      } catch (err) {
        toast.error(`Gagal memulihkan: ${err.message}`);
      }
    });
  }

  _bindModEvents() {
    const dropzone = document.getElementById('modDropzone');
    const fileInput = document.getElementById('inputModZipFile');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => {
        fileInput.click();
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          await this._installModFile(files[0]);
        }
      });

      fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
          await this._installModFile(files[0]);
          e.target.value = '';
        }
      });
    }

    // Install sample mod button
    const installSampleHandler = async () => {
      toast.info('Memasang contoh mod (Cyberpunk Neon & Quick Boost)...');
      if (typeof window !== 'undefined') {
        localStorage.removeItem('sampleModDismissed');
      }
      try {
        const zipBytes = await generateSampleModZip();
        const mod = await modManager.installFromZip(zipBytes);
        toast.success(`Contoh mod "${mod.name}" berhasil dipasang dan diaktifkan!`);
        this.render();
      } catch (err) {
        console.error('Sample mod install error:', err);
        toast.error('Gagal memasang contoh mod: ' + err.message);
      }
    };

    document.getElementById('btnSettingsInstallSampleMod')?.addEventListener('click', installSampleHandler);
    document.getElementById('btnEmptyInstallSampleMod')?.addEventListener('click', installSampleHandler);

    const installJiggleHandler = async () => {
      try {
        const zipBytes = await generateJiggleWaveformModZip();
        const mod = await modManager.installFromZip(zipBytes);
        toast.success(`Mod "${mod.name}" berhasil dipasang dan diaktifkan!`);
        this.render();
      } catch (err) {
        console.error('Jiggle mod install error:', err);
        toast.error('Gagal memasang mod gelombang: ' + err.message);
      }
    };

    document.getElementById('btnSettingsInstallJiggleMod')?.addEventListener('click', installJiggleHandler);
    document.getElementById('btnEmptyInstallJiggleMod')?.addEventListener('click', installJiggleHandler);

    // Download starter kit template button
    document.getElementById('btnSettingsDownloadStarterKit')?.addEventListener('click', async () => {
      try {
        const zipBytes = await modManager.generateStarterKitZip();
        const blob = new Blob([zipBytes], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'audiophile-starter-mod.zip';
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Template mod "audiophile-starter-mod.zip" berhasil diunduh!');
      } catch (err) {
        console.error('Starter kit download error:', err);
        toast.error('Gagal mengunduh template: ' + err.message);
      }
    });

    // Safe mode: disable all mods
    document.getElementById('btnSettingsSafeMode')?.addEventListener('click', async () => {
      const confirmed = await dialog.confirm({
        title: 'Nonaktifkan Semua Mod',
        message: 'Apakah Anda ingin menonaktifkan seluruh mod yang terpasang?',
        confirmText: 'Nonaktifkan',
        cancelText: 'Batal'
      });
      if (confirmed) {
        await modManager.disableAllMods();
        toast.warning('Seluruh mod telah dinonaktifkan.');
        this.render();
      }
    });

    // Toggle mod via checkbox switch or action button
    const handleToggleMod = async (modId, nextEnabled) => {
      await modManager.setModEnabled(modId, nextEnabled);
      toast.info(nextEnabled ? `Mod "${modId}" diaktifkan.` : `Mod "${modId}" dinonaktifkan.`);
      this.render();
    };

    this.container.querySelectorAll('.chk-mod-toggle').forEach(chk => {
      chk.addEventListener('change', async (e) => {
        const modId = e.target.getAttribute('data-mod-id');
        await handleToggleMod(modId, e.target.checked);
      });
    });

    this.container.querySelectorAll('.btn-mod-toggle-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        const modId = btn.getAttribute('data-mod-id');
        const mod = modManager.getMod(modId);
        const nextEnabled = !mod?.enabled;
        await handleToggleMod(modId, nextEnabled);
      });
    });

    // Export single mod button
    this.container.querySelectorAll('.btn-mod-export').forEach(btn => {
      btn.addEventListener('click', async () => {
        const modId = btn.getAttribute('data-mod-id');
        try {
          toast.info('Mengemas berkas mod...');
          const zipBytes = await modManager.exportMod(modId);
          const blob = new Blob([zipBytes], { type: 'application/zip' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${modId}.zip`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success(`Mod "${modId}.zip" berhasil diekspor!`);
        } catch (err) {
          toast.error('Gagal mengekspor mod: ' + err.message);
        }
      });
    });

    // Delete single mod button
    this.container.querySelectorAll('.btn-mod-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const modId = btn.getAttribute('data-mod-id');
        const confirmed = await dialog.confirm({
          title: 'Hapus Mod',
          message: `Apakah Anda yakin ingin menghapus mod "${modId}" secara permanen?`,
          confirmText: 'Hapus',
          cancelText: 'Batal'
        });
        if (confirmed) {
          if (modId === 'cyber-neon-bass' && typeof window !== 'undefined') {
            localStorage.setItem('sampleModDismissed', '1');
          }
          await modManager.deleteMod(modId);
          toast.success(`Mod "${modId}" telah dihapus.`);
          this.render();
        }
      });
    });

    // Inspect mod files button
    this.container.querySelectorAll('.btn-mod-inspect').forEach(btn => {
      btn.addEventListener('click', () => {
        const modId = btn.getAttribute('data-mod-id');
        this._openModInspectorModal(modId);
      });
    });
  }

  async _installModFile(file) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Hanya berkas format .zip yang didukung untuk mod.');
      return;
    }
    toast.info(`Mengekstrak dan memasang mod "${file.name}"...`);
    try {
      const mod = await modManager.installFromZip(file);
      toast.success(`Mod "${mod.name}" berhasil dipasang dan diaktifkan!`);
      this.render();
    } catch (err) {
      console.error('Install mod error:', err);
      toast.error('Gagal memasang mod: ' + err.message);
    }
  }

  _renderModCardsHtml(mods) {
    if (!mods || mods.length === 0) {
      return `
        <div style="text-align:center; padding:32px 16px; background:rgba(255,255,255,0.02); border:1px solid var(--glass-border-subtle); border-radius:var(--radius-md);">
          <div style="color:var(--text-dim); margin-bottom:10px;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5s-1.12-2.5-2.5-2.5z"/></svg>
          </div>
          <h4 style="margin:0 0 6px 0; color:var(--text-main); font-size:1rem; font-weight:600;">Belum Ada Mod Terpasang</h4>
          <p style="margin:0 0 16px 0; color:var(--text-dim); font-size:0.82rem; max-width:420px; margin-inline:auto;">
            Tarik & lepas berkas .zip mod ke area di atas, atau klik tombol "Pasang Contoh Mod" untuk mencoba fitur modding.
          </p>
          <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" id="btnEmptyInstallSampleMod">
              <span>Pasang Contoh Mod (Cyberpunk Neon)</span>
            </button>
            <button class="btn btn-secondary btn-sm" id="btnEmptyInstallJiggleMod">
              <span>Pasang Mod Gelombang Pegas</span>
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="mod-list-container">
        ${mods.map(mod => {
          const typeBadgeClass = mod.type === 'theme' ? 'mod-badge-theme' : (mod.type === 'functional' ? 'mod-badge-functional' : 'mod-badge-hybrid');
          const typeLabel = mod.type === 'theme' ? 'Tampilan (CSS)' : (mod.type === 'functional' ? 'Fungsional (JS)' : 'Hybrid (CSS+JS)');
          const fileCount = Object.keys(mod.files || {}).length;
          const removalCount = (mod.manifest?.removals || []).length;

          return `
            <div class="mod-card ${mod.enabled ? 'active' : 'disabled'}" data-mod-id="${escapeHtml(mod.id)}">
              <div class="mod-card-header">
                <div class="mod-card-title-group">
                  <div class="mod-card-title-row">
                    <h3 class="mod-card-name">${escapeHtml(mod.name)}</h3>
                    <span class="mod-badge ${typeBadgeClass}">${typeLabel}</span>
                    ${removalCount > 0 ? `<span class="mod-badge mod-badge-removals">${removalCount} Dihapus</span>` : ''}
                  </div>
                  <div class="mod-card-meta">
                    v${escapeHtml(mod.version)} • oleh ${escapeHtml(mod.author)} • ${fileCount} Berkas
                  </div>
                </div>
                <div class="mod-toggle-group" title="${mod.enabled ? 'Nonaktifkan mod' : 'Aktifkan mod'}">
                  <label class="mod-switch">
                    <input type="checkbox" class="chk-mod-toggle" data-mod-id="${escapeHtml(mod.id)}" ${mod.enabled ? 'checked' : ''} />
                    <span class="mod-slider"></span>
                  </label>
                  <span class="mono" style="font-size:0.75rem; color:${mod.enabled ? 'var(--accent-light)' : 'var(--text-dim)'};">${mod.enabled ? 'Aktif' : 'Nonaktif'}</span>
                </div>
              </div>

              <p class="mod-card-desc">${escapeHtml(mod.description || 'Tidak ada deskripsi.')}</p>

              <div class="mod-card-actions">
                <div style="font-size:0.75rem; color:var(--text-dim);" class="mono">
                  ID: ${escapeHtml(mod.id)}
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <button class="btn btn-sm ${mod.enabled ? 'btn-secondary' : 'btn-primary'} btn-mod-toggle-action" data-mod-id="${escapeHtml(mod.id)}" title="${mod.enabled ? 'Nonaktifkan mod ini' : 'Aktifkan mod ini'}">
                    <span>${mod.enabled ? 'Nonaktifkan' : 'Aktifkan'}</span>
                  </button>
                  <button class="btn btn-secondary btn-sm btn-mod-inspect" data-mod-id="${escapeHtml(mod.id)}" title="Periksa berkas di dalam mod">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    <span>Periksa Berkas</span>
                  </button>
                  <button class="btn btn-secondary btn-sm btn-mod-export" data-mod-id="${escapeHtml(mod.id)}" title="Ekspor kembali menjadi berkas .zip">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span>Ekspor .zip</span>
                  </button>
                  <button class="btn btn-danger btn-sm btn-mod-delete" data-mod-id="${escapeHtml(mod.id)}" title="Hapus mod permanen">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    <span>Hapus</span>
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  _openModInspectorModal(modId) {
    const mod = modManager.getMod(modId);
    if (!mod) return;

    const host = document.getElementById('settingsCustomModalHost');
    if (!host) return;

    const files = Object.entries(mod.files || {});
    let activeFilePath = files[0]?.[0] || '';

    const renderInspector = () => {
      const activeFile = mod.files?.[activeFilePath];
      const previewText = activeFile?.text || (i18n.getLocale() === 'en'
        ? `[Binary file: ${activeFile?.mime || 'unknown'}, ${activeFile?.bytes?.length || 0} bytes]`
        : `[Berkas biner: ${activeFile?.mime || 'unknown'}, ${activeFile?.bytes?.length || 0} byte]`);

      host.innerHTML = localizeSettingsHtml(`
        <div class="modal-backdrop active" id="modalModInspectorBackdrop" style="display:flex; align-items:center; justify-content:center; z-index:10000; position:fixed; inset:0; background:rgba(0,0,0,0.75); backdrop-filter:blur(8px);">
          <div class="glass-panel" style="max-width:760px; width:92%; max-height:85vh; overflow-y:auto; padding:24px; border-radius:var(--radius-lg); border:1px solid var(--glass-border-specular); background:var(--glass-bg-card); box-shadow:0 20px 40px rgba(0,0,0,0.6);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
              <div>
                <h3 style="margin:0; font-size:1.15rem; font-weight:700; color:var(--text-main);">Inspektor Berkas Mod: ${escapeHtml(mod.name)}</h3>
                <span style="font-size:0.75rem; color:var(--text-dim);" class="mono">ID: ${escapeHtml(mod.id)} • Versi ${escapeHtml(mod.version)}</span>
              </div>
              <button class="btn btn-icon btn-close" id="btnCloseModInspector" title="Tutup" aria-label="Tutup">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59 7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12 5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z"/></svg>
              </button>
            </div>

            <div style="display:flex; gap:16px; margin-top:12px; flex-wrap:wrap;">
              <div style="width:200px; flex-shrink:0; display:flex; flex-direction:column; gap:4px; max-height:380px; overflow-y:auto; padding-right:4px;">
                <span class="mono" style="font-size:0.72rem; color:var(--text-dim); margin-bottom:4px;">DAFTAR BERKAS (${files.length})</span>
                ${files.map(([p]) => `
                  <button class="btn btn-sm btn-inspect-file ${p === activeFilePath ? 'btn-primary' : 'btn-secondary'}" data-file-path="${escapeHtml(p)}" style="text-align:left; justify-content:flex-start; font-family:var(--font-mono); font-size:0.75rem; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                    ${escapeHtml(p)}
                  </button>
                `).join('')}
              </div>

              <div style="flex:1; min-width:280px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span class="mono" style="font-size:0.78rem; color:var(--accent); font-weight:600;">${escapeHtml(activeFilePath)}</span>
                  <span class="mono" style="font-size:0.72rem; color:var(--text-dim);">${escapeHtml(activeFile?.mime || '')}</span>
                </div>
                <pre class="mod-inspector-code"><code>${escapeHtml(previewText)}</code></pre>
              </div>
            </div>
          </div>
        </div>
      `, i18n.getLocale());

      host.querySelector('#btnCloseModInspector')?.addEventListener('click', () => {
        host.innerHTML = '';
      });

      host.querySelectorAll('.btn-inspect-file').forEach(b => {
        b.addEventListener('click', () => {
          activeFilePath = b.getAttribute('data-file-path');
          renderInspector();
        });
      });
    };

    renderInspector();
  }

  /**
   * Modal dialog for system diagnostics & in-memory sandbox self-test
   */
  async openDiagnosticsModal() {
    const host = document.getElementById('settingsCustomModalHost');
    if (!host) return;

    const caps = DiagnosticsService.getBrowserCapabilities();
    const storage = await DiagnosticsService.getStorageStatus();
    const platform = DiagnosticsService.getPlatformInfo();

    host.innerHTML = localizeSettingsHtml(`
      <div class="modal-backdrop active" id="modalDiagBackdrop" style="display:flex; align-items:center; justify-content:center; z-index:10000; position:fixed; inset:0; background:rgba(0,0,0,0.75); backdrop-filter:blur(8px);">
        <div class="glass-panel" style="max-width:680px; width:92%; max-height:85vh; overflow-y:auto; padding:24px; border-radius:var(--radius-lg); border:1px solid var(--glass-border-specular); background:var(--glass-bg-card); box-shadow:0 20px 40px rgba(0,0,0,0.6);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div>
              <h3 style="margin:0; font-size:1.25rem; font-weight:700; color:var(--text-main);">Tentang & Diagnostik Sistem</h3>
              <p style="margin:2px 0 0 0; font-size:0.75rem; color:var(--text-dim);">${APP_VERSION_INFO.name} v${APP_VERSION_INFO.version} • ${platform.os} • ${platform.browser}</p>
            </div>
            <button class="btn btn-icon btn-sm" id="btnCloseDiagModal" aria-label="Tutup">${getIconSvg('close', { size: 18 })}</button>
          </div>

          <!-- Browser API Checklist -->
          <div style="margin-bottom:20px;">
            <h4 style="font-size:0.95rem; font-weight:600; color:var(--text-main); margin-bottom:8px;">Kapabilitas Web API Peramban</h4>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${Object.values(caps).map(cap => `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.02); border-radius:var(--radius-xs); border:1px solid var(--glass-border-subtle);">
                  <div>
                    <div style="font-size:0.85rem; font-weight:600; color:var(--text-main);">${escapeHtml(cap.name)}</div>
                    <div style="font-size:0.72rem; color:var(--text-dim);">${escapeHtml(cap.desc)}</div>
                  </div>
                  <span class="mono" style="font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:4px; ${cap.supported ? 'background:rgba(16,185,129,0.15); color:#10b981;' : 'background:rgba(239,68,68,0.15); color:#ef4444;'}">
                    ${cap.supported ? 'Didukung' : 'Tidak Didukung'}
                  </span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Self-Test Runner Section -->
          <div style="margin-bottom:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <h4 style="font-size:0.95rem; font-weight:600; color:var(--text-main); margin:0;">Uji Mandiri Sistem (Sandbox In-Memory)</h4>
              <button class="btn btn-primary btn-sm" id="btnRunSelfTest">Jalankan Uji Mandiri</button>
            </div>
            <p style="font-size:0.75rem; color:var(--text-dim); margin-bottom:10px;">
              Validasi logika mandiri: penulisan setting, crossfade, antrean, playlist, tier, M3U, dan backup di memori.
            </p>
            <div id="selfTestResultsContainer" style="display:flex; flex-direction:column; gap:6px;">
              <div style="padding:12px; text-align:center; font-size:0.8rem; color:var(--text-dim); background:rgba(255,255,255,0.01); border-radius:var(--radius-xs);">
                Klik tombol "Jalankan Uji Mandiri" di atas untuk memulai pengujian in-memory.
              </div>
            </div>
          </div>

          <!-- Diagnostic Report Copy Button -->
          <div style="display:flex; justify-content:space-between; align-items:center; padding-top:14px; border-top:1px solid var(--glass-border-subtle); flex-wrap:wrap; gap:10px;">
            <span style="font-size:0.75rem; color:var(--text-dim);">Laporan diagnostik bebas dari judul lagu atau data pribadi.</span>
            <div style="display:flex; gap:10px;">
              <button class="btn btn-secondary btn-sm" id="btnCopyDiagReport">Salin Laporan Diagnostik</button>
              <button class="btn btn-primary btn-sm" id="btnCloseDiagModalBtn">Selesai</button>
            </div>
          </div>
        </div>
      </div>
    `, i18n.getLocale());

    const closeModal = () => { host.innerHTML = ''; };
    document.getElementById('btnCloseDiagModal')?.addEventListener('click', closeModal);
    document.getElementById('btnCloseDiagModalBtn')?.addEventListener('click', closeModal);

    // Self-Test Runner Button
    document.getElementById('btnRunSelfTest')?.addEventListener('click', async () => {
      const container = document.getElementById('selfTestResultsContainer');
      if (container) {
        container.innerHTML = localizeSettingsHtml(`<div style="padding:12px; text-align:center; font-size:0.8rem; color:var(--accent);">Menjalankan 7 modul uji mandiri...</div>`, i18n.getLocale());
      }

      const results = await SelfTestRunner.runAll();
      this.lastSelfTestResults = results;

      if (container) {
        const resultsMarkup = results.map(res => `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.02); border-radius:var(--radius-xs); border:1px solid var(--glass-border-subtle);">
            <div>
              <span style="font-size:0.82rem; font-weight:600; color:var(--text-main);">${escapeHtml(res.name)}</span>
              ${res.error ? `<div style="font-size:0.7rem; color:#ef4444; margin-top:2px;">${escapeHtml(res.error)}</div>` : ''}
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="mono" style="font-size:0.7rem; color:var(--text-dim);">${res.durationMs}ms</span>
              <span class="mono" style="font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:4px; ${res.passed ? 'background:rgba(16,185,129,0.15); color:#10b981;' : 'background:rgba(239,68,68,0.15); color:#ef4444;'}">
                ${res.passed ? 'Lolos' : 'Gagal'}
              </span>
            </div>
          </div>
        `).join('');
        container.innerHTML = localizeSettingsHtml(resultsMarkup, i18n.getLocale());
      }

      toast.success('Uji mandiri selesai dieksekusi.');
    });

    // Copy Diagnostic Report
    document.getElementById('btnCopyDiagReport')?.addEventListener('click', async () => {
      try {
        const report = await DiagnosticsService.generateReport(this.lastSelfTestResults);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(report);
          toast.success('Laporan diagnostik disalin ke papan klip.');
        } else {
          toast.info('Papan klip tidak didukung. Format teks siap disalin.');
        }
      } catch (err) {
        console.error('Copy report error:', err);
        toast.error('Gagal menyalin laporan diagnostik.');
      }
    });
  }

  updateAnalysisProgress(prog) {
    const wrapper = document.getElementById('settingsBatchProgressWrapper');
    const fill = document.getElementById('settingsBatchProgressFill');
    const label = document.getElementById('settingsBatchProgressLabel');
    const btn = document.getElementById('btnSettingsBatchAnalyze');

    if (!wrapper || !fill || !label || !btn) return;

    if (prog.running) {
      wrapper.style.display = 'block';
      const pct = prog.total > 0 ? Math.round((prog.processed / prog.total) * 100) : 0;
      fill.style.width = `${pct}%`;
      label.innerText = i18n.getLocale() === 'en'
        ? `Analyzing FFT frequencies: ${prog.processed} / ${prog.total} tracks (${pct}%)`
        : `Menganalisis frekuensi FFT: ${prog.processed} / ${prog.total} lagu (${pct}%)`;
      btn.innerHTML = `<span>${i18n.getLocale() === 'en' ? 'Stop Analysis' : 'Hentikan Analisis'}</span>`;
    } else {
      wrapper.style.display = 'none';
      btn.innerHTML = `<span>${i18n.getLocale() === 'en' ? 'Analyze Entire Library' : 'Analisis Seluruh Perpustakaan'}</span>`;
    }
  }

  /**
   * Draw the combined frequency response curve and filter nodes on canvas
   */
  drawParametricCanvas(canvas, bands, preamp = 0, selectedBandIndex = 0) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const width = rect.width;
    const height = rect.height;

    const minFreq = 20;
    const maxFreq = 20000;
    const minDb = -15;
    const maxDb = 15;
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);

    const freqToX = (f) => {
      const clamped = Math.max(minFreq, Math.min(maxFreq, f));
      return ((Math.log10(clamped) - logMin) / (logMax - logMin)) * width;
    };

    const dbToY = (db) => {
      const clamped = Math.max(minDb, Math.min(maxDb, db));
      return height - ((clamped - minDb) / (maxDb - minDb)) * height;
    };

    ctx.clearRect(0, 0, width, height);

    // 1. Grid Lines - Frequency (logarithmic)
    const gridFreqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    gridFreqs.forEach(f => {
      const x = freqToX(f);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
      ctx.fillText(label, x, height - 4);
    });

    // 2. Grid Lines - dB
    const gridDbs = [12, 6, 0, -6, -12];
    ctx.textAlign = 'left';
    gridDbs.forEach(db => {
      const y = dbToY(db);
      ctx.beginPath();
      ctx.strokeStyle = db === 0 ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.04)';
      ctx.setLineDash(db === 0 ? [4, 4] : []);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const label = db > 0 ? `+${db}` : `${db}`;
      ctx.fillStyle = db === 0 ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.3)';
      ctx.fillText(label, 6, y - 2);
    });

    // Preamp line
    if (preamp !== 0) {
      const py = dbToY(preamp);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.setLineDash([3, 3]);
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.7)';
      ctx.fillText(`Preamp: ${preamp.toFixed(1)} dB`, width - 110, py - 3);
    }

    // 3. Combined Response Curve
    const numPoints = Math.max(120, Math.round(width / 3));
    const freqs = generateLogFrequencies(numPoints, minFreq, maxFreq);
    const combinedGains = computeCombinedResponse(bands, preamp, freqs, 44100);

    // Gradient fill under curve
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(59, 130, 246, 0.25)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let p = 0; p < numPoints; p++) {
      const x = freqToX(freqs[p]);
      const y = dbToY(combinedGains[p]);
      if (p === 0) ctx.lineTo(0, y);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Curve line
    ctx.beginPath();
    for (let p = 0; p < numPoints; p++) {
      const x = freqToX(freqs[p]);
      const y = dbToY(combinedGains[p]);
      if (p === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 4. Draw interactive control nodes (Bands 1 to 10)
    bands.forEach((b, i) => {
      const x = freqToX(b.freq);
      const y = dbToY(b.gain);
      const isSelected = (i === selectedBandIndex);

      if (!b.enabled) {
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(100, 116, 139, 0.4)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (isSelected) {
        // Halo
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
        ctx.fill();
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Inner circle
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#3b82f6';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(30, 58, 138, 0.9)';
        ctx.fill();
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      ctx.fillStyle = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.85)';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${i + 1}`, x, y + 3);
    });
  }

  /**
   * Set up pointer events and rendering for the parametric EQ canvas
   */
  setupParametricCanvas() {
    const canvas = document.getElementById('parametricEqCanvas');
    if (!canvas) return;

    const bands = settings.get('parametricBands', DEFAULT_SETTINGS.parametricBands);
    const preamp = settings.get('autoPreamp') ? calculateAutoPreamp(bands) : settings.get('preamp', 0);

    setTimeout(() => {
      this.drawParametricCanvas(canvas, bands, preamp, this.selectedParametricBandIndex);
    }, 20);

    if (canvas._boundPointerEvents) return;
    canvas._boundPointerEvents = true;

    const minFreq = 20;
    const maxFreq = 20000;
    const minDb = -15;
    const maxDb = 15;
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);

    const getPointerPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        width: rect.width,
        height: rect.height
      };
    };

    canvas.addEventListener('pointerdown', (e) => {
      const { x, y, width, height } = getPointerPos(e);
      const curBands = settings.get('parametricBands', DEFAULT_SETTINGS.parametricBands);

      // Find closest node within radius 24px
      let bestIdx = -1;
      let minDist = 24;

      curBands.forEach((b, i) => {
        const clampedF = Math.max(minFreq, Math.min(maxFreq, b.freq));
        const nx = ((Math.log10(clampedF) - logMin) / (logMax - logMin)) * width;
        const clampedG = Math.max(minDb, Math.min(maxDb, b.gain));
        const ny = height - ((clampedG - minDb) / (maxDb - minDb)) * height;
        const dist = Math.hypot(x - nx, y - ny);
        if (dist < minDist) {
          minDist = dist;
          bestIdx = i;
        }
      });

      if (bestIdx !== -1) {
        this.selectedParametricBandIndex = bestIdx;
        this.isDraggingBand = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      } else {
        // Find closest band along X
        let closestIdx = 0;
        let closestXDist = Infinity;
        curBands.forEach((b, i) => {
          const clampedF = Math.max(minFreq, Math.min(maxFreq, b.freq));
          const nx = ((Math.log10(clampedF) - logMin) / (logMax - logMin)) * width;
          const xDist = Math.abs(x - nx);
          if (xDist < closestXDist) {
            closestXDist = xDist;
            closestIdx = i;
          }
        });
        this.selectedParametricBandIndex = closestIdx;
      }

      this.updateParametricInspectorUI();
      const curPreamp = settings.get('autoPreamp') ? calculateAutoPreamp(curBands) : settings.get('preamp', 0);
      this.drawParametricCanvas(canvas, curBands, curPreamp, this.selectedParametricBandIndex);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.isDraggingBand) return;
      const { x, y, width, height } = getPointerPos(e);
      const curBands = [...settings.get('parametricBands', DEFAULT_SETTINGS.parametricBands)];
      const b = { ...curBands[this.selectedParametricBandIndex] };

      const ratioX = Math.max(0, Math.min(1, x / width));
      const newFreq = Math.round(Math.pow(10, logMin + ratioX * (logMax - logMin)));
      b.freq = Math.max(20, Math.min(20000, newFreq));

      const ratioY = 1 - Math.max(0, Math.min(1, y / height));
      const rawGain = minDb + ratioY * (maxDb - minDb);
      const newGain = Math.round(rawGain * 10) / 10;
      if (!['lowpass', 'highpass', 'notch'].includes(b.type)) {
        b.gain = Math.max(-15, Math.min(15, newGain));
      }

      curBands[this.selectedParametricBandIndex] = b;
      settings.set('parametricBands', curBands);
      engine.setParametricBand(this.selectedParametricBandIndex, b);

      let curPreamp = settings.get('preamp', 0);
      if (settings.get('autoPreamp')) {
        curPreamp = calculateAutoPreamp(curBands);
        engine.setPreamp(curPreamp);
        const preLbl = document.getElementById('labelPreampVal');
        if (preLbl) preLbl.innerText = `${curPreamp.toFixed(1)} dB`;
      }

      this.drawParametricCanvas(canvas, curBands, curPreamp, this.selectedParametricBandIndex);
      this.syncParametricInspectorInputs(b);
      this.markParametricCurveCustom();
    });

    const stopDrag = (e) => {
      if (this.isDraggingBand) {
        this.isDraggingBand = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
  }

  /**
   * Sync inspector controls to the currently selected band
   */
  updateParametricInspectorUI() {
    const bands = settings.get('parametricBands', DEFAULT_SETTINGS.parametricBands);
    const idx = this.selectedParametricBandIndex;
    const b = bands[idx] || bands[0];

    const titleEl = document.getElementById('inspectorBandTitle');
    if (titleEl) {
      titleEl.innerText = `Band ${idx + 1}: ${b.freq} Hz (${b.type.toUpperCase()})`;
    }

    const chkEnabled = document.getElementById('chkBandEnabled');
    if (chkEnabled) chkEnabled.checked = b.enabled;

    const selType = document.getElementById('selBandType');
    if (selType) selType.value = b.type;

    const rangeFreq = document.getElementById('rangeBandFreq');
    const numFreq = document.getElementById('numBandFreq');
    if (rangeFreq) rangeFreq.value = b.freq;
    if (numFreq) numFreq.value = b.freq;

    const isGainDisabled = ['lowpass', 'highpass', 'notch'].includes(b.type);
    const rangeGain = document.getElementById('rangeBandGain');
    const numGain = document.getElementById('numBandGain');
    if (rangeGain) {
      rangeGain.value = b.gain;
      rangeGain.disabled = isGainDisabled;
    }
    if (numGain) {
      numGain.value = b.gain;
      numGain.disabled = isGainDisabled;
    }

    const rangeQ = document.getElementById('rangeBandQ');
    const numQ = document.getElementById('numBandQ');
    if (rangeQ) rangeQ.value = b.q;
    if (numQ) numQ.value = b.q;

    // Update band pills active state
    this.container?.querySelectorAll('.eq-band-pill').forEach((pill, pIdx) => {
      if (pIdx === idx) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
      if (!bands[pIdx].enabled) {
        pill.classList.add('disabled');
      } else {
        pill.classList.remove('disabled');
      }
    });
  }

  /**
   * Fast sync during canvas drag to minimize UI jitter
   */
  syncParametricInspectorInputs(b) {
    const titleEl = document.getElementById('inspectorBandTitle');
    if (titleEl) {
      titleEl.innerText = `Band ${this.selectedParametricBandIndex + 1}: ${b.freq} Hz (${b.type.toUpperCase()})`;
    }
    const rangeFreq = document.getElementById('rangeBandFreq');
    const numFreq = document.getElementById('numBandFreq');
    if (rangeFreq) rangeFreq.value = b.freq;
    if (numFreq) numFreq.value = b.freq;

    const rangeGain = document.getElementById('rangeBandGain');
    const numGain = document.getElementById('numBandGain');
    if (rangeGain) rangeGain.value = b.gain;
    if (numGain) numGain.value = b.gain;

    // Update pill display
    const pill = this.container?.querySelector(`.eq-band-pill[data-band-idx="${this.selectedParametricBandIndex}"]`);
    if (pill) {
      const typeSpan = pill.querySelector('.eq-band-pill-type');
      const freqSpan = pill.querySelector('.eq-band-pill-freq');
      if (typeSpan) typeSpan.innerText = b.type.slice(0, 2);
      if (freqSpan) freqSpan.innerText = b.freq >= 1000 ? `${(b.freq / 1000).toFixed(1)}k` : `${b.freq}`;
    }
  }

  /**
   * Mark active parametric curve as custom when user modifies bands
   */
  markParametricCurveCustom() {
    settings.set('parametricCurrentPreset', '_custom_curve');
    const selPreset = document.getElementById('selParametricPreset');
    if (selPreset && selPreset.value !== '_custom_curve') {
      let optCustom = selPreset.querySelector('option[value="_custom_curve"]');
      if (!optCustom) {
        optCustom = document.createElement('option');
        optCustom.value = '_custom_curve';
        optCustom.innerText = 'Kustom (Disesuaikan)';
        selPreset.insertBefore(optCustom, selPreset.firstChild);
      }
      selPreset.value = '_custom_curve';
    }
    const btnRename = document.getElementById('btnRenameParametricPreset');
    const btnDelete = document.getElementById('btnDeleteParametricPreset');
    if (btnRename) btnRename.disabled = true;
    if (btnDelete) btnDelete.disabled = true;
  }

  /**
   * Modal dialog for reviewing AutoEQ ParametricEQ.txt profile before applying
   */
  openAutoEqPreviewModal(parsed, fileName) {
    const host = document.getElementById('settingsCustomModalHost');
    if (!host) return;

    const profileTitle = parsed.profileName || fileName.replace(/\.txt$/i, '');
    host.innerHTML = localizeSettingsHtml(`
      <div class="modal-backdrop active" id="modalAutoEqBackdrop" style="display:flex; align-items:center; justify-content:center; z-index:10000; position:fixed; inset:0; background:rgba(0,0,0,0.75); backdrop-filter:blur(8px);">
        <div class="glass-panel" style="max-width:680px; width:92%; max-height:88vh; overflow-y:auto; padding:24px; border-radius:var(--radius-lg); border:1px solid var(--glass-border-specular); background:var(--glass-bg-card); box-shadow:0 20px 40px rgba(0,0,0,0.6);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <div>
              <h3 style="margin:0; font-size:1.2rem; font-weight:700; color:var(--text-main);">Pratinjau Profil AutoEQ</h3>
              <p style="margin:2px 0 0 0; font-size:0.75rem; color:var(--text-dim);">${escapeHtml(profileTitle)} • Preamp: <strong style="color:var(--accent);">${parsed.preamp} dB</strong></p>
            </div>
            <button class="btn btn-icon btn-sm" id="btnCloseAutoEqModal" aria-label="Tutup">${getIconSvg('close', { size: 18 })}</button>
          </div>

          <!-- Canvas Preview -->
          <div style="background:rgba(8,12,22,0.85); border:1px solid var(--glass-border-subtle); border-radius:var(--radius-md); padding:10px; margin-bottom:16px;">
            <div style="height:150px; position:relative; width:100%;">
              <canvas id="autoEqPreviewCanvas" style="width:100%; height:100%; display:block; border-radius:var(--radius-xs);"></canvas>
            </div>
          </div>

          <!-- Filter Table -->
          <div style="max-height:160px; overflow-y:auto; border:1px solid var(--glass-border-subtle); border-radius:var(--radius-sm); margin-bottom:18px;">
            <table style="width:100%; border-collapse:collapse; font-size:0.75rem; text-align:left;">
              <thead>
                <tr style="background:rgba(255,255,255,0.04); color:var(--text-dim); border-bottom:1px solid var(--glass-border-subtle);">
                  <th style="padding:6px 10px;">Band</th>
                  <th style="padding:6px 10px;">Tipe</th>
                  <th style="padding:6px 10px;">Frekuensi</th>
                  <th style="padding:6px 10px;">Gain</th>
                  <th style="padding:6px 10px;">Q</th>
                  <th style="padding:6px 10px;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${parsed.bands.map((b, i) => `
                  <tr style="border-bottom:1px solid rgba(255,255,255,0.02); color:${b.enabled ? 'var(--text-main)' : 'var(--text-dim)'};">
                    <td style="padding:5px 10px; font-weight:700;" class="mono">${i + 1}</td>
                    <td style="padding:5px 10px; text-transform:uppercase;">${b.type}</td>
                    <td style="padding:5px 10px;" class="mono">${b.freq} Hz</td>
                    <td style="padding:5px 10px;" class="mono">${b.gain > 0 ? `+${b.gain}` : b.gain} dB</td>
                    <td style="padding:5px 10px;" class="mono">${b.q.toFixed(2)}</td>
                    <td style="padding:5px 10px;">${b.enabled ? '<span style="color:#10b981; font-weight:700;">ON</span>' : '<span style="color:#ef4444;">OFF</span>'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:10px;">
            <button class="btn btn-secondary" id="btnCancelAutoEq">Batal</button>
            <button class="btn btn-primary" id="btnApplyAutoEq">Terapkan Profil Ini</button>
          </div>
        </div>
      </div>
    `, i18n.getLocale());

    const prevCanvas = document.getElementById('autoEqPreviewCanvas');
    if (prevCanvas) {
      setTimeout(() => {
        this.drawParametricCanvas(prevCanvas, parsed.bands, parsed.preamp, -1);
      }, 30);
    }

    const closeModal = () => { host.innerHTML = ''; };
    document.getElementById('btnCloseAutoEqModal')?.addEventListener('click', closeModal);
    document.getElementById('btnCancelAutoEq')?.addEventListener('click', closeModal);

    document.getElementById('btnApplyAutoEq')?.addEventListener('click', () => {
      closeModal();
      const newPreset = {
        id: `preset_autoeq_${Date.now()}`,
        name: profileTitle.trim(),
        bands: JSON.parse(JSON.stringify(parsed.bands)),
        preamp: parsed.preamp
      };
      const customPresets = [...settings.get('parametricPresets', [])];
      customPresets.push(newPreset);
      settings.set('parametricPresets', customPresets);
      settings.set('parametricCurrentPreset', `custom:${newPreset.id}`);
      settings.set('parametricBands', parsed.bands);
      settings.set('autoPreamp', false);
      settings.set('preamp', parsed.preamp);
      settings.set('eqMode', 'parametric');
      engine.setPreamp(parsed.preamp);
      engine.applyCurrentEqSettings();
      toast.success(`Profil AutoEQ "${escapeHtml(profileTitle)}" berhasil diterapkan dan disimpan!`);
      this.render();
    });
  }
}


export const settingsView = new SettingsView();
