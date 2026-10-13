/**
 * diagnostics.js - System diagnostics and browser capability detection for Audiophile
 *
 * Provides:
 * - Browser audio & storage API support checklist
 * - Storage quota and persistence status queries
 * - Sanitized diagnostic report generation (strictly zero personal or library data)
 */

import { APP_VERSION_INFO } from './version.js';

export class DiagnosticsService {
  /**
   * Evaluate browser support for critical modern web audio and storage APIs
   * @returns {Object}
   */
  static getBrowserCapabilities() {
    const isClient = typeof window !== 'undefined';
    const isNav = typeof navigator !== 'undefined';
    const isDoc = typeof document !== 'undefined';

    return {
      fileSystemAccess: {
        id: 'fileSystemAccess',
        name: 'File System Access API (showDirectoryPicker)',
        supported: isClient && Boolean(window.showDirectoryPicker),
        desc: 'Memungkinkan pembacaan berkas audio dari folder lokal secara langsung tanpa pengunggahan.'
      },
      audioSinkId: {
        id: 'audioSinkId',
        name: 'Audio Output Device Selector (setSinkId)',
        supported: typeof HTMLMediaElement !== 'undefined' && Boolean(HTMLMediaElement.prototype.setSinkId),
        desc: 'Memungkinkan pemilihan perangkat keluaran audio fisik (DAC eksternal / headphone khusus).'
      },
      mediaSession: {
        id: 'mediaSession',
        name: 'Media Session API',
        supported: isNav && Boolean('mediaSession' in navigator),
        desc: 'Mengintegrasikan info lagu, cover, dan tombol kendali dengan panel multimedia sistem operasi.'
      },
      viewTransitions: {
        id: 'viewTransitions',
        name: 'View Transitions API',
        supported: isDoc && Boolean(document.startViewTransition),
        desc: 'Animasi perpindahan halaman navigasi halus bawaan mesin peramban.'
      },
      storagePersistence: {
        id: 'storagePersistence',
        name: 'Storage Persistence API (navigator.storage.persist)',
        supported: isNav && Boolean(navigator.storage && navigator.storage.persist),
        desc: 'Melindungi basis data IndexedDB aplikasi agar tidak terhapus otomatis oleh peramban.'
      },
      webAudio: {
        id: 'webAudio',
        name: 'Web Audio API (AudioContext)',
        supported: isClient && Boolean(window.AudioContext || window.webkitAudioContext),
        desc: 'Pemrosesan DSP lanjutan, 10-Band Equalizer, dan kalkulasi analisis spektrum frekuensi FFT.'
      },
      documentPip: {
        id: 'documentPip',
        name: 'Document Picture-in-Picture API',
        supported: isClient && Boolean(window.documentPictureInPicture && window.documentPictureInPicture.requestWindow),
        desc: 'Jendela mengambang penuh dengan cover, kontrol, lirik, dan seek bar (khusus desktop Chrome/Edge).'
      },
      videoPip: {
        id: 'videoPip',
        name: 'Video Picture-in-Picture API',
        supported: isDoc && Boolean(document.pictureInPictureEnabled),
        desc: 'Jendela video mengambang standar fallback dengan kontrol melalui OS Media Session.'
      }
    };
  }

  /**
   * Query persistent storage flag and IndexedDB usage/quota estimation
   * @returns {Promise<{ persisted: boolean, usageBytes: number, quotaBytes: number, usageMB: number, quotaMB: number }>}
   */
  static async getStorageStatus() {
    let persisted = false;
    let usageBytes = 0;
    let quotaBytes = 0;

    if (typeof navigator !== 'undefined' && navigator.storage) {
      if (navigator.storage.persisted) {
        try {
          persisted = await navigator.storage.persisted();
        } catch {
          persisted = false;
        }
      }

      if (navigator.storage.estimate) {
        try {
          const est = await navigator.storage.estimate();
          usageBytes = est.usage || 0;
          quotaBytes = est.quota || 0;
        } catch {
          usageBytes = 0;
          quotaBytes = 0;
        }
      }
    }

    const usageMB = (usageBytes / (1024 * 1024)).toFixed(1);
    const quotaMB = (quotaBytes / (1024 * 1024)).toFixed(0);

    return {
      persisted,
      usageBytes,
      quotaBytes,
      usageMB: Number(usageMB),
      quotaMB: Number(quotaMB)
    };
  }

  /**
   * Request persistent storage permission from the browser
   * @returns {Promise<boolean>}
   */
  static async requestPersistence() {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        return await navigator.storage.persist();
      } catch (err) {
        console.warn('Persistence request failed:', err);
        return false;
      }
    }
    return false;
  }

  /**
   * Detect general operating system and browser family safely
   * @returns {{ os: string, browser: string, engine: string }}
   */
  static getPlatformInfo() {
    if (typeof navigator === 'undefined') {
      return { os: 'Node.js', browser: 'CLI Environment', engine: 'V8' };
    }

    const ua = navigator.userAgent || '';
    let os = 'Unknown OS';
    if (ua.includes('Win')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Linux')) os = 'Linux';

    let browser = 'Unknown Browser';
    if (ua.includes('Edg/')) browser = 'Microsoft Edge';
    else if (ua.includes('Chrome/')) browser = 'Google Chrome';
    else if (ua.includes('Firefox/')) browser = 'Mozilla Firefox';
    else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Apple Safari';

    return {
      os,
      browser,
      engine: navigator.userAgentData?.brands?.map(b => `${b.brand} ${b.version}`).join(', ') || ua
    };
  }

  /**
   * Generate clean JSON diagnostic report for troubleshooting
   * Strictly excludes any track titles, file names, or private user details.
   * @param {Array<Object>} [selfTestResults=[]]
   * @returns {Promise<string>}
   */
  static async generateReport(selfTestResults = []) {
    const platform = this.getPlatformInfo();
    const caps = this.getBrowserCapabilities();
    const storage = await this.getStorageStatus();

    const capabilitiesSummary = {};
    for (const [key, val] of Object.entries(caps)) {
      capabilitiesSummary[key] = val.supported;
    }

    const report = {
      app: APP_VERSION_INFO.name,
      version: APP_VERSION_INFO.version,
      buildDate: APP_VERSION_INFO.buildDate,
      timestamp: new Date().toISOString(),
      platform: {
        os: platform.os,
        browser: platform.browser,
        hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
        deviceMemoryGB: navigator.deviceMemory || 'unknown'
      },
      capabilities: capabilitiesSummary,
      storage: {
        persisted: storage.persisted,
        usageMB: storage.usageMB,
        quotaMB: storage.quotaMB
      },
      selfTest: {
        totalModules: selfTestResults.length,
        passedModules: selfTestResults.filter(r => r.passed).length,
        results: selfTestResults.map(r => ({
          module: r.name,
          passed: r.passed,
          durationMs: r.durationMs,
          error: r.error || null
        }))
      }
    };

    return JSON.stringify(report, null, 2);
  }
}
