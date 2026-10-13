/**
 * sampleMod.js - Official sample mod definition and generator
 * Provides a ready-to-use sample mod demonstrating visual changes (CSS),
 * element removals, and functional features (JS SDK & DSP).
 */

import { packZip } from './zipEngine.js';

export const SAMPLE_MOD_FILES = {
  'mod.json': JSON.stringify({
    id: 'cyber-neon-bass',
    name: 'Cyberpunk Neon & Quick Boost',
    version: '1.0.0',
    author: 'Audiophile Mod Lab',
    description: 'Mengubah aksen visual menjadi neon cyberpunk cerah, menyembunyikan tombol bawaan yang tidak diperlukan, dan menambahkan tombol aksi matriks kustom.',
    type: 'hybrid',
    entryStyles: [
      'styles/cyber.css'
    ],
    entryScripts: [
      'scripts/cyber.js'
    ],
    removals: [
      '#miniBadgeNight',
      '#btnToggleNightMode'
    ]
  }, null, 2),

  'styles/cyber.css': `/* styles/cyber.css - Kustomisasi Tampilan Cyberpunk */
:root, :root[data-theme], html, body, [data-theme] {
  --accent: #00f0ff !important;
  --accent-light: #70f7ff !important;
  --accent-glow: rgba(0, 240, 255, 0.5) !important;
  --aurora-primary: #00f0ff !important;
  --aurora-secondary: #ff007f !important;
  --border-accent: rgba(0, 240, 255, 0.5) !important;
}

/* Bilah pemutar bawah dengan border neon dan glow */
.glass-player-bar, #glassPlayerBar {
  border-top: 2px solid #00f0ff !important;
  box-shadow: 0 -8px 32px rgba(0, 240, 255, 0.3), 0 0 20px rgba(255, 0, 127, 0.15) !important;
}

/* Aksen tombol putar */
.player-controls .btn-primary,
#miniBtnPlay,
.fs-play-btn {
  background: linear-gradient(135deg, #00f0ff 0%, #0088cc 100%) !important;
  box-shadow: 0 0 20px rgba(0, 240, 255, 0.6) !important;
  color: #050b14 !important;
  border: 1px solid #70f7ff !important;
}

/* Navigasi sidebar aktif bernuansa cyan */
.nav-item.active {
  color: #00f0ff !important;
  background: rgba(0, 240, 255, 0.12) !important;
  border-left: 3px solid #00f0ff !important;
}

/* Seekbar waveform glow */
.waveform-canvas {
  filter: drop-shadow(0 0 4px rgba(0, 240, 255, 0.5));
}

/* Lencana Kualitas Hi-Res dengan gaya neon */
.badge-hires {
  background: rgba(0, 240, 255, 0.15) !important;
  border-color: rgba(0, 240, 255, 0.5) !important;
  color: #00f0ff !important;
}

/* Tombol injeksi mod pada player bar */
.mod-injected-btn {
  background: rgba(0, 240, 255, 0.15) !important;
  border: 1px solid #00f0ff !important;
  color: #00f0ff !important;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.4) !important;
}
`,

  'scripts/cyber.js': `/* scripts/cyber.js - Kustomisasi Fungsional */
export default function init(api) {
  // 1. Tambahkan tombol khusus Cyber Matrix ke Player Bar
  api.ui.addPlayerButton({
    id: 'cyberMatrixBtn',
    title: 'Informasi Cyber Mod (Klik untuk Detail)',
    iconSvg: '<span style="font-weight:800; font-size:11px; letter-spacing:0.5px; color:#00f0ff; padding:2px 4px; border:1px solid #00f0ff; border-radius:4px; text-shadow:0 0 6px #00f0ff;">CYBER</span>',
    onClick: () => {
      api.ui.showModal({
        title: 'Cyberpunk Neon Mod Aktif',
        contentHtml: \`
          <p>Mod ini mendemonstrasikan 3 kemampuan modding web Audiophile:</p>
          <ul style="padding-left:20px; margin:12px 0; display:flex; flex-direction:column; gap:6px;">
            <li><strong>Tampilan (CSS)</strong>: Mengubah aksen warna menjadi palet Cyber Neon Cyan (#00f0ff) dan menambahkan efek glowing pada player bar serta navigasi.</li>
            <li><strong>Pengurangan (Removals)</strong>: Menyembunyikan tombol Mode Malam bawaan dari antarmuka.</li>
            <li><strong>Fungsional (JS)</strong>: Menyuntikkan tombol CYBER ini ke bilah pemutar, menampilkan modal kustom, dan memantau pergantian trek secara real-time.</li>
          </ul>
          <p style="font-size:0.82rem; color:var(--text-dim); margin-top:8px;">Anda dapat menonaktifkan atau menghapus mod ini kapan saja di menu Pengaturan &gt; Tab Ekstensi &amp; Mod.</p>
        \`
      });
    }
  });

  // 2. Dengarkan event saat lagu berganti
  api.events.on('engine:trackChanged', (track) => {
    const title = track?.overrides?.title || track?.metadata?.title || 'Lagu';
    api.toast.info('Cyber Mod: Memutar ' + title);
  });
}
`,

  'README.md': `# Cyberpunk Neon & Quick Boost Mod

Mod resmi contoh untuk mendemonstrasikan sistem modding berbasis ZIP pada Audiophile.

## Kemampuan yang Diterapkan:
1. Tampilan: Palet warna neon cyan dan efek glowing.
2. Pengurangan: Menyembunyikan tombol Mode Malam bawaan.
3. Fungsional: Menambahkan tombol aksi kustom ke player bar dan memantau pemutaran lagu.
`
};

/**
 * Generate binary ZIP buffer for the sample mod
 * @returns {Promise<Uint8Array>}
 */
export async function generateSampleModZip() {
  return packZip(SAMPLE_MOD_FILES);
}
