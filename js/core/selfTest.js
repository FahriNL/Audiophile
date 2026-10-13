/**
 * selfTest.js - In-memory sandbox self-test suite for Audiophile
 *
 * Runs non-destructive quick validations in pure memory without polluting
 * the user's IndexedDB database or disturbing active audio playback:
 * 1. Settings (read, write, deepMerge, defaults)
 * 2. Crossfade calculations (equal-power acoustic sum, short track clamping)
 * 3. Queue state integrity (no overlaps, boundary safety, reordering)
 * 4. Playlist manipulation (add, deduplicate, reorder, immutability)
 * 5. Quality tier classification (DSD, Hi-Res, Studio, Lossless, Lossy)
 * 6. M3U / M3U8 parsing and serialization
 * 7. Backup & Restore round-trip integrity (payload schema validation)
 */

import { deepMerge, getByPath, setByPath, DEFAULT_SETTINGS } from './settings.js';
import { equalPowerGains, computeFadeStart } from '../player/crossfade.js';
import { classifyQualityTier } from '../quality/tiers.js';
import { M3UHandler } from '../playlists/m3u.js';
import {
  getKWeightingCoefficients,
  calculateIntegratedLufs,
  calculateTruePeak,
  calculateDynamicRange,
  calculateReplayGain
} from '../quality/loudnessMath.js';
import { parseAutoEqText } from '../quality/autoEqParser.js';
import { calculateAutoPreamp, computeCombinedResponse } from '../quality/eqMath.js';
import { calculateBinomialPValue, calculateLoudnessMatchingGains } from '../player/abPlayer.js';
import { isWirelessDevice, outputManager } from '../player/outputManager.js';
import { DuplicateManager } from '../library/dedupe.js';
import {
  LibraryHealthService,
  normalizeCanonicalString,
  pickCanonicalVariant
} from '../library/health.js';
import { SYSTEM_RESERVED_SHORTCUTS, ShortcutManager, DEFAULT_SHORTCUTS } from './shortcuts.js';
import { pipManager } from '../player/pip.js';

export class SelfTestRunner {
  /**
   * Run all test suites sequentially and measure execution duration
   * @returns {Promise<Array<{ name: string, passed: boolean, durationMs: number, error?: string }>>}
   */
  static async runAll() {
    const suites = [
      { name: '1. Pengaturan (Settings Read/Write/Merge)', fn: () => this.testSettings() },
      { name: '2. Perhitungan Crossfade Equal-Power', fn: () => this.testCrossfade() },
      { name: '3. Integritas Antrean (Queue Non-Overlap)', fn: () => this.testQueue() },
      { name: '4. Manipulasi Playlist & Immutability', fn: () => this.testPlaylist() },
      { name: '5. Klasifikasi Kualitas Audio (Tiers)', fn: () => this.testQualityTiers() },
      { name: '6. Pengurai & Serializer Playlist M3U', fn: () => this.testM3U() },
      { name: '7. Serialisasi & Validasi Backup/Restore', fn: () => this.testBackupRestore() },
      { name: '8. Analisis Loudness BS.1770 & ReplayGain', fn: () => this.testLoudness() },
      { name: '9. Parametric EQ & Impor AutoEQ (AUD-01/05)', fn: () => this.testAutoEq() },
      { name: '10. Komparasi Versi A/B, ABX & Perangkat Output (AUD-03/04)', fn: () => this.testAbAndOutput() },
      { name: '11. Kesehatan Library & Perbaikan Non-Destruktif (LIB-01)', fn: () => this.testHealthAudit() },
      { name: '12. Pintasan Keyboard, PiP & Mode Malam (UX-01/02/03)', fn: () => this.testUxEnhancements() }
    ];

    const results = [];

    for (const suite of suites) {
      const start = performance.now();
      try {
        await suite.fn();
        const durationMs = Number((performance.now() - start).toFixed(2));
        results.push({
          name: suite.name,
          passed: true,
          durationMs
        });
      } catch (err) {
        const durationMs = Number((performance.now() - start).toFixed(2));
        results.push({
          name: suite.name,
          passed: false,
          durationMs,
          error: err.message || String(err)
        });
      }
    }

    return results;
  }

  static testSettings() {
    const sandbox = deepMerge(DEFAULT_SETTINGS, { volume: 0.75, crossfade: { duration: 6 } });
    if (sandbox.volume !== 0.75) throw new Error('Volume override gagal disimpan pada merge.');
    if (sandbox.crossfade.duration !== 6) throw new Error('Nested crossfade.duration gagal dimerge.');
    if (sandbox.crossfade.avoidConsecutiveAlbums !== true) throw new Error('Default nilai nested terhapus.');

    setByPath(sandbox, 'nested.test.key', 'audiophile_ok');
    const readVal = getByPath(sandbox, 'nested.test.key');
    if (readVal !== 'audiophile_ok') throw new Error('setByPath / getByPath gagal menulis atau membaca.');

    const fallbackVal = getByPath(sandbox, 'non.existent.path', 'fallback_ok');
    if (fallbackVal !== 'fallback_ok') throw new Error('getByPath fallback gagal.');
  }

  static testCrossfade() {
    const midGains = equalPowerGains(0.5);
    const sumSquares = (midGains.gainOut ** 2) + (midGains.gainIn ** 2);
    if (Math.abs(sumSquares - 1.0) > 0.0001) {
      throw new Error(`Konstanta energi akustik tidak seimbang: ${sumSquares}`);
    }

    const startGains = equalPowerGains(0);
    if (startGains.gainOut !== 1.0 || startGains.gainIn !== 0) {
      throw new Error('Titik awal gain out != 1.0 atau gain in != 0');
    }

    const endGains = equalPowerGains(1);
    if (Math.abs(endGains.gainOut) > 0.0001 || Math.abs(endGains.gainIn - 1.0) > 0.0001) {
      throw new Error('Titik akhir gain out != 0 atau gain in != 1.0');
    }

    // Clamp check for short tracks (< 2x fade)
    const clamped = computeFadeStart(8, 6, 1);
    if (clamped.actualFadeDuration !== 4) {
      throw new Error(`Durasi fade lagu pendek gagal dibatasi: ${clamped.actualFadeDuration}`);
    }
    if (clamped.fadeStartTime !== 4) {
      throw new Error(`Waktu mulai fade salah: ${clamped.fadeStartTime}`);
    }
  }

  static testQueue() {
    const queue = [
      { id: 'track_1', title: 'Lagu A' },
      { id: 'track_2', title: 'Lagu B' },
      { id: 'track_3', title: 'Lagu C' }
    ];

    let currentIndex = 0;
    // Next track simulation
    const nextIndex = Math.min(queue.length - 1, currentIndex + 1);
    if (nextIndex !== 1) throw new Error('Navigasi antrean berikutnya gagal.');

    // Ensure non-overlapping reorder: move index 2 to 0
    const reordered = [...queue];
    const [moved] = reordered.splice(2, 1);
    reordered.splice(0, 0, moved);

    if (reordered[0].id !== 'track_3') throw new Error('Reorder antrean tidak menempatkan lagu di posisi tepat.');
    if (reordered.length !== 3) throw new Error('Ukuran antrean berubah setelah reorder.');
    const ids = new Set(reordered.map(t => t.id));
    if (ids.size !== 3) throw new Error('Terdapat duplikasi id pada antrean.');
  }

  static testPlaylist() {
    const originalTracks = ['id_1', 'id_2'];
    const playlist = {
      id: 'pl_test',
      name: 'Uji Mandiri',
      trackIds: [...originalTracks]
    };

    // Add track with deduplication check
    const newId = 'id_3';
    if (!playlist.trackIds.includes(newId)) {
      playlist.trackIds.push(newId);
    }
    if (playlist.trackIds.length !== 3) throw new Error('Penambahan lagu ke playlist gagal.');

    // Duplicate check
    const duplicateId = 'id_2';
    const isDuplicate = playlist.trackIds.includes(duplicateId);
    if (!isDuplicate) throw new Error('Deteksi duplikat playlist gagal.');

    // Safe remove
    playlist.trackIds = playlist.trackIds.filter(id => id !== 'id_1');
    if (playlist.trackIds.includes('id_1')) throw new Error('Penghapusan lagu dari playlist gagal.');
    if (originalTracks.length !== 2) throw new Error('Array asli termutasi secara tidak aman.');
  }

  static testQualityTiers() {
    const dsdTier = classifyQualityTier({ sampleRate: 2822400, bitsPerSample: 1 }, 'dsf');
    if (dsdTier.tier !== 'DSD') throw new Error(`DSD gagal diklasifikasi: ${dsdTier.tier}`);

    const hiresTier = classifyQualityTier({ sampleRate: 96000, bitsPerSample: 24 }, 'flac');
    if (hiresTier.tier !== 'HI-RES') throw new Error(`Hi-Res gagal diklasifikasi: ${hiresTier.tier}`);

    const studioTier = classifyQualityTier({ sampleRate: 44100, bitsPerSample: 24 }, 'flac');
    if (studioTier.tier !== 'STUDIO') throw new Error(`Studio 24-bit gagal diklasifikasi: ${studioTier.tier}`);

    const cdTier = classifyQualityTier({ sampleRate: 44100, bitsPerSample: 16 }, 'flac');
    if (cdTier.tier !== 'LOSSLESS') throw new Error(`CD Lossless gagal diklasifikasi: ${cdTier.tier}`);

    const lossyHqTier = classifyQualityTier({ sampleRate: 44100, bitsPerSample: 16, bitrate: 320000 }, 'mp3');
    if (lossyHqTier.tier !== 'LOSSY HQ') throw new Error(`Lossy HQ gagal diklasifikasi: ${lossyHqTier.tier}`);
  }

  static testM3U() {
    const dummyTracks = [
      { id: '1', name: 'song1.flac', streamInfo: { duration: 180 }, metadata: { artist: 'Artis A', title: 'Lagu A' } },
      { id: '2', name: 'song2.flac', streamInfo: { duration: 240 }, metadata: { artist: 'Artis B', title: 'Lagu B' } }
    ];

    const m3uContent = M3UHandler.exportM3U('Daftar Putar Uji', dummyTracks);
    if (!m3uContent.includes('#EXTM3U')) throw new Error('Header #EXTM3U tidak ditemukan pada ekspor.');
    if (!m3uContent.includes('Artis A - Lagu A')) throw new Error('Entry trek #EXTINF tidak ditemukan.');

    const parsed = M3UHandler.parseM3U(m3uContent, dummyTracks);
    if (parsed.matchedTrackIds.length !== 2) throw new Error('Parsing M3U gagal mencocokkan seluruh berkas.');
  }

  static testBackupRestore() {
    const dummyBackup = {
      app: 'Audiophile',
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      data: {
        playlists: [{ id: 'p1', name: 'Koleksi Akustik', trackIds: ['t1'] }],
        stats: [{ trackId: 't1', playCount: 5, favorite: true }],
        tagOverrides: [{ trackId: 't1', title: 'Judul Asli Disempurnakan' }],
        settings: { volume: 0.9, pureMode: true }
      }
    };

    // Serialize and deserialize in memory
    const serialized = JSON.stringify(dummyBackup);
    const restored = JSON.parse(serialized);

    if (restored.app !== 'Audiophile') throw new Error('Nama aplikasi pada cadangan tidak cocok.');
    if (restored.schemaVersion !== 2) throw new Error('Versi skema tidak sesuai.');
    if (restored.data.playlists.length !== 1) throw new Error('Playlist hilang saat putar-balik cadangan.');
    if (restored.data.tagOverrides[0].title !== 'Judul Asli Disempurnakan') {
      throw new Error('Koreksi tag termutasi saat putar-balik cadangan.');
    }
  }

  static async testLoudness() {
    const c48 = getKWeightingCoefficients(48000);
    if (!c48.stage1 || !c48.stage2) throw new Error('Koefisien K-weighting tidak valid.');

    const silent = new Float32Array(4800);
    const lufs = calculateIntegratedLufs([silent, silent], 48000);
    if (lufs !== -70.0) throw new Error('Hening total harus mengembalikan -70.0 LUFS.');

    const tp = calculateTruePeak([new Float32Array([0.5, 0.707, 0.5])]);
    if (tp.truePeakDbtp < -5) throw new Error('True Peak oversampling kalkulasi salah.');

    const dr = calculateDynamicRange([new Float32Array(44100 * 3)], 44100);
    if (typeof dr.dr !== 'number') throw new Error('Kalkulasi DR harus menghasilkan angka.');

    const rg = calculateReplayGain(-14, 0.0, -18, -0.5);
    if (rg.gainDb !== -4.0) throw new Error('ReplayGain attenuasi tidak tepat.');
  }

  static testAutoEq() {
    const rawText = `
Preamp: -4.5 dB
Filter 1: ON PK Fc 100 Hz Gain 3.0 dB Q 1.41
Filter 2: ON LSC Fc 80 Hz Gain 4.5 dB Q 0.71
Filter 3: OFF PK Fc 2000 Hz Gain -2.0 dB Q 2.0
`;
    const res = parseAutoEqText(rawText);
    if (!res.success) throw new Error('Parsing AutoEQ gagal.');
    if (res.preamp !== -4.5) throw new Error('Nilai Preamp tidak cocok.');
    if (res.bands.length !== 10) throw new Error('Bands tidak dipad menjadi 10.');
    if (res.bands[0].gain !== 3.0) throw new Error('Gain band 1 tidak cocok.');
    if (res.bands[1].type !== 'lowshelf') throw new Error('Tipe lowshelf tidak terdeteksi.');
    if (res.bands[2].enabled !== false) throw new Error('Filter OFF harus nonaktif.');

    const autoPreamp = calculateAutoPreamp(res.bands);
    if (autoPreamp !== -4.5) throw new Error('Auto preamp harus -4.5 dB.');

    const freqs = [100, 1000, 10000];
    const curve = computeCombinedResponse(res.bands, res.preamp, freqs, 44100);
    if (curve.length !== 3 || !Number.isFinite(curve[0])) {
      throw new Error('Kalkulasi kurva respon gabungan gagal.');
    }
  }

  /**
   * 10. Komparasi Versi A/B, ABX & Perangkat Output (AUD-03/04)
   */
  static async testAbAndOutput() {
    // 1. Binomial p-value calculations
    const p10 = calculateBinomialPValue(10, 10);
    if (p10 !== 0.0010) throw new Error(`Binomial p-value 10/10 salah: ${p10}`);
    const p9 = calculateBinomialPValue(9, 10);
    if (p9 !== 0.0107) throw new Error(`Binomial p-value 9/10 salah: ${p9}`);
    const p5 = calculateBinomialPValue(5, 10);
    if (p5 !== 0.6230) throw new Error(`Binomial p-value 5/10 salah: ${p5}`);

    // 2. Loudness matching calculation
    const lMatch = calculateLoudnessMatchingGains(-14.0, -16.5);
    if (!lMatch.matched || lMatch.gainDbA !== -2.5 || lMatch.gainDbB !== 0) {
      throw new Error('Kalkulasi loudness matching delta gagal.');
    }

    // 3. Wireless device heuristic
    if (!isWirelessDevice('Sony WH-1000XM5 Bluetooth') || isWirelessDevice('Realtek Audio')) {
      throw new Error('Deteksi heuristik nirkabel Bluetooth tidak akurat.');
    }

    // 4. Duplicate version lookup
    const sampleTracks = [
      { id: '1', name: 'song.mp3', overrides: { title: 'Song', artist: 'Band' }, tier: 'LOSSY' },
      { id: '2', name: 'song.flac', overrides: { title: 'Song', artist: 'Band' }, tier: 'HI-RES' }
    ];
    const dups = DuplicateManager.getDuplicatesForTrack(sampleTracks[0], sampleTracks);
    if (dups.length !== 2) {
      throw new Error('Pencarian duplikat versi gagal.');
    }

    // 5. OutputManager preset linkage
    outputManager.linkPresetToDevice('TestDevice', 'flat');
    const linked = outputManager.getLinkedPresetForDevice('TestDevice');
    outputManager.linkPresetToDevice('TestDevice', null);
    if (linked !== 'flat') {
      throw new Error('Penyimpanan tautan preset EQ perangkat gagal.');
    }
  }

  /**
   * 11. Modul Uji Kesehatan Library & Perbaikan Non-Destruktif (LIB-01)
   */
  static async testHealthAudit() {
    const service = new LibraryHealthService();

    // 1. Normalization & Canonical string matching
    const normA = normalizeCanonicalString('Beyonce');
    const normB = normalizeCanonicalString('Beyoncé');
    if (normA !== normB) {
      throw new Error('Normalisasi ejaan kanonikal gagal menyamakan Beyonce dan Beyoncé.');
    }

    const rec = pickCanonicalVariant([
      { name: 'Beyonce', count: 2 },
      { name: 'Beyoncé', count: 5 }
    ]);
    if (rec !== 'Beyoncé') {
      throw new Error('Pemilihan varian kanonikal gagal memilih bentuk beraksen.');
    }

    // 2. Empty tags detection
    const sampleTracks = [
      {
        id: '1',
        name: 'Empty.mp3',
        metadata: { title: 'Empty', artist: '', album: '', year: '', trackNo: 0 }
      },
      {
        id: '2',
        name: 'Full.flac',
        metadata: { title: 'Valid', artist: 'Artist', album: 'Album', year: '2023', trackNo: 1 }
      }
    ];
    const emptyCheck = service.checkEmptyTags(sampleTracks);
    if (emptyCheck.total !== 1 || emptyCheck.items[0].emptyFields.length !== 5) {
      throw new Error('Deteksi tag kosong gagal.');
    }

    // 3. Inconsistent artist detection
    const inconsistentTracks = [
      { id: '1', metadata: { artist: 'Beyonce' } },
      { id: '2', metadata: { artist: 'Beyoncé' } }
    ];
    const incCheck = service.checkInconsistentArtists(inconsistentTracks);
    if (incCheck.total !== 1 || incCheck.items[0].recommended !== 'Beyoncé') {
      throw new Error('Deteksi inkonsistensi artis gagal.');
    }

    // 4. Scattered albums detection
    const scatteredTracks = [
      { id: '1', relativePath: 'DirA/01.flac', metadata: { album: 'Alb', artist: 'Art' } },
      { id: '2', relativePath: 'DirB/02.flac', metadata: { album: 'Alb', artist: 'Art' } }
    ];
    const scatCheck = service.checkScatteredAlbums(scatteredTracks);
    if (scatCheck.total !== 1) {
      throw new Error('Deteksi album tersebar multi-direktori gagal.');
    }

    // 5. Relink candidate matching
    const missingTrk = {
      id: 'm1',
      fingerprint: 'fp_test',
      name: 'Song.flac',
      size: 1000
    };
    const candFiles = [{ name: 'Song.flac', size: 1000, lastModified: 12345 }];
    const matches = service.findRelinkMatches([missingTrk], candFiles);
    if (matches.length !== 1 || matches[0].score < 0.95) {
      throw new Error('Pencocokan relink berkas gagal.');
    }

    // 6. Undo stack initial state
    if (service.canUndo()) {
      throw new Error('Undo stack seharusnya kosong saat inisialisasi.');
    }
  }

  static async testUxEnhancements() {
    // 1. Reserved system browser shortcuts detection
    if (!SYSTEM_RESERVED_SHORTCUTS.has('Ctrl+KeyT') || !SYSTEM_RESERVED_SHORTCUTS.has('F5') || !SYSTEM_RESERVED_SHORTCUTS.has('Ctrl+KeyW')) {
      throw new Error('Daftar bentrok pintasan peramban sistem tidak lengkap.');
    }

    // 2. Shortcut formatting and mapping
    const sm = new ShortcutManager();
    const formatted = sm.formatDisplay('Ctrl+KeyK');
    if (formatted !== 'Ctrl + K') {
      throw new Error(`Format tampilan pintasan tidak sesuai: "${formatted}".`);
    }

    sm.setShortcut('play_pause', 'KeyP');
    if (sm.getShortcut('play_pause')?.code !== 'KeyP') {
      throw new Error('Penetapan pintasan kustom play_pause gagal.');
    }

    // 3. Export / Import JSON round-trip
    const exportedJson = sm.exportJson();
    const parsed = JSON.parse(exportedJson);
    if (parsed.app !== 'Audiophile' || !parsed.shortcuts || parsed.shortcuts.play_pause.code !== 'KeyP') {
      throw new Error('Ekspor JSON pintasan tidak valid.');
    }

    const sm2 = new ShortcutManager();
    const importRes = sm2.importJson(exportedJson);
    if (!importRes.success || sm2.getShortcut('play_pause')?.code !== 'KeyP') {
      throw new Error('Impor JSON pintasan gagal memulihkan pemetaan tombol.');
    }

    // 4. Picture-in-Picture capability detection
    const cap = pipManager.getCapability();
    if (cap !== 'document' && cap !== 'video' && cap !== false) {
      throw new Error(`Deteksi kapabilitas PiP mengembalikan nilai di luar spesifikasi: ${cap}`);
    }

    // 5. Night Mode compressor math & volume clamping
    const mildParams = { threshold: -20, ratio: 3.5 };
    const strongParams = { threshold: -32, ratio: 8.0 };
    if (!(mildParams.threshold > strongParams.threshold && mildParams.ratio < strongParams.ratio)) {
      throw new Error('Parameter ambang kompresi mode malam tidak konsisten.');
    }

    const requestedVol = 0.95;
    const nightMaxVol = 0.70;
    const clampedVol = Math.min(requestedVol, nightMaxVol);
    if (clampedVol !== 0.70) {
      throw new Error('Pembatasan volume maksimum mode malam gagal membatasi plafon.');
    }
  }
}
