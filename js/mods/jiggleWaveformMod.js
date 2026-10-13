/**
 * jiggleWaveformMod.js - Official Jiggle Spring Waveform Mod definition and generator
 * Provides a modular, installable ZIP mod that replaces the standard discrete vertical
 * bars waveform with an interactive continuous thick undulating wave line with spring
 * oscillator jiggle physics.
 */

import { packZip } from './zipEngine.js';

export const JIGGLE_MOD_FILES = {
  'mod.json': JSON.stringify({
    id: 'jiggle-spring-waveform',
    name: 'Jiggle Spring Waveform Bar',
    version: '1.0.0',
    author: 'Audiophile Mod Lab',
    description: 'Mengganti bilah progres standar dengan kurva gelombang tebal interaktif dengan animasi getaran pegas (spring jiggle) saat di-scrub dan zonasi volume makro.',
    type: 'hybrid',
    entryStyles: [
      'styles/jiggle.css'
    ],
    entryScripts: [
      'scripts/jiggle.js'
    ]
  }, null, 2),

  'styles/jiggle.css': `/* styles/jiggle.css - Jiggle Spring Waveform Bar Styles */
.waveform-canvas {
  filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.45));
}

[data-theme="light"] .waveform-canvas {
  filter: drop-shadow(0 0 4px rgba(37, 99, 235, 0.25));
}

.mod-injected-btn-jiggle {
  background: rgba(56, 189, 248, 0.15) !important;
  border: 1px solid #38bdf8 !important;
  color: #38bdf8 !important;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.4) !important;
}

[data-theme="light"] .mod-injected-btn-jiggle {
  background: rgba(37, 99, 235, 0.12) !important;
  border: 1px solid #2563eb !important;
  color: #2563eb !important;
  box-shadow: 0 0 8px rgba(37, 99, 235, 0.25) !important;
}
`,

  'scripts/jiggle.js': `/* scripts/jiggle.js - Kustomisasi Kurva Gelombang Pegas Interaktif */
export default function init(api) {
  // Register the custom waveform drawer with the Mod SDK
  api.ui.setCustomWaveform({
    draw(playerBar) {
      const canvas = document.getElementById('playerWaveformCanvas');
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
      const width = canvas.offsetWidth || 480;
      const height = canvas.offsetHeight || 28;

      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const peaks = playerBar.currentWaveformPeaks;
      if (!peaks || peaks.length === 0) {
        ctx.restore();
        return;
      }

      const duration = api.store.get('duration') || 0;
      const currentTime = api.store.get('currentTime') || 0;
      const progressPct = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
      const progressX = progressPct * width;

      const centerY = height / 2;
      const maxWaveHeight = Math.max(4, (height / 2) - 4);

      // 1. Sample wave points along width with broad, sweeping undulations and distinct volume zones
      const points = [];
      const step = 2.5;
      const count = peaks.length;
      const waveFreq = 0.048;

      for (let x = 0; x <= width; x += step) {
        const t = width > 0 ? (x / width) : 0;
        const peakPos = t * (count - 1);

        // Macro volume zone smoothing (combining neighboring buckets into broad musical zones)
        const windowRadius = 6;
        let sumAmp = 0;
        let weightSum = 0;
        for (let w = -windowRadius; w <= windowRadius; w++) {
          const pIdx = Math.max(0, Math.min(count - 1, Math.round(peakPos + w)));
          const weight = Math.exp(-(w * w) / (2 * 3.5 * 3.5));
          sumAmp += (Number(peaks[pIdx]) || 0) * weight;
          weightSum += weight;
        }
        const rawZoneAmp = weightSum > 0 ? (sumAmp / weightSum) : (Number(peaks[Math.round(peakPos)]) || 0);

        // Contrast: quiet sections stay quiet and low, loud sections expand boldly
        const volumeAmp = Math.pow(Math.max(0, Math.min(1.0, rawZoneAmp)), 1.35);

        // Broad sweeping spatial wave carrier (few rises/falls, organic curve)
        const w1 = Math.sin(x * waveFreq);
        const w2 = Math.sin(x * (waveFreq * 2) + 0.8) * 0.18;
        const spatialCarrier = (w1 + w2) / 1.15;

        // Resting volume wave
        const naturalWave = spatialCarrier * (volumeAmp * maxWaveHeight);

        // Spring displacement: active when point is pressed and moved
        let springOffset = 0;
        if (playerBar.springTargetX != null && Math.abs(playerBar.springDisplacement) > 0.001) {
          const dist = Math.abs(x - playerBar.springTargetX);
          const envelope = Math.exp(-(dist * dist) / (2 * 75 * 75));
          const ripple = Math.cos(dist * waveFreq) * envelope;
          springOffset = playerBar.springDisplacement * ripple;
        }

        const totalDisplacement = Math.max(-maxWaveHeight, Math.min(maxWaveHeight, naturalWave + springOffset));
        points.push({ x, y: centerY + totalDisplacement, amp: volumeAmp });
      }

      // Ensure last point reaches exact width
      if (points.length > 0 && points[points.length - 1].x < width) {
        const last = points[points.length - 1];
        points.push({ x: width, y: last.y, amp: last.amp });
      }

      if (points.length < 2) {
        ctx.restore();
        return;
      }

      const isLight = typeof document !== 'undefined' && document.documentElement?.getAttribute('data-theme') === 'light';

      // 2. Draw continuous thick curve stroke
      // A) Played Portion
      if (progressX > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, progressX, height);
        ctx.clip();

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          const xc = (points[i - 1].x + points[i].x) / 2;
          const yc = (points[i - 1].y + points[i].y) / 2;
          ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);

        const playedStrokeGrad = ctx.createLinearGradient(0, 0, Math.max(progressX, 100), 0);
        if (isLight) {
          playedStrokeGrad.addColorStop(0, '#2563eb');
          playedStrokeGrad.addColorStop(0.6, '#0284c7');
          playedStrokeGrad.addColorStop(1, '#7c3aed');
        } else {
          playedStrokeGrad.addColorStop(0, '#00f0ff');
          playedStrokeGrad.addColorStop(0.6, '#38bdf8');
          playedStrokeGrad.addColorStop(1, '#a855f7');
        }

        ctx.strokeStyle = playedStrokeGrad;
        ctx.lineWidth = 4.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = isLight ? 'rgba(37, 99, 235, 0.45)' : 'rgba(56, 189, 248, 0.75)';
        ctx.shadowBlur = isLight ? 6 : 10;
        ctx.stroke();
        ctx.restore();
      }

      // B) Unplayed Portion
      if (progressX < width) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(progressX, 0, width - progressX, height);
        ctx.clip();

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          const xc = (points[i - 1].x + points[i].x) / 2;
          const yc = (points[i - 1].y + points[i].y) / 2;
          ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);

        ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.22)' : 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 3.6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.restore();
      }

      // 3. Playhead Bead
      let playheadY = centerY;
      for (let i = 0; i < points.length - 1; i++) {
        if (progressX >= points[i].x && progressX <= points[i + 1].x) {
          const span = points[i + 1].x - points[i].x;
          const localT = span > 0 ? (progressX - points[i].x) / span : 0;
          playheadY = points[i].y + (points[i + 1].y - points[i].y) * localT;
          break;
        }
      }

      ctx.beginPath();
      ctx.arc(progressX, playheadY, 7.0, 0, Math.PI * 2);
      ctx.fillStyle = isLight ? 'rgba(37, 99, 235, 0.28)' : 'rgba(56, 189, 248, 0.35)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(progressX, playheadY, 4.4, 0, Math.PI * 2);
      ctx.fillStyle = isLight ? '#2563eb' : '#ffffff';
      ctx.shadowColor = isLight ? 'rgba(37, 99, 235, 0.5)' : '#38bdf8';
      ctx.shadowBlur = isLight ? 5 : 8;
      ctx.fill();

      ctx.restore();
    }
  });

  // Action button on player bar
  api.ui.addPlayerButton({
    id: 'jiggleWaveInfoBtn',
    title: 'Informasi Jiggle Spring Waveform (Klik untuk Detail)',
    iconSvg: '<span style="font-weight:700; font-size:10px; color:#38bdf8; border:1px solid #38bdf8; border-radius:3px; padding:1px 3px; letter-spacing:0.5px;">WAVE</span>',
    onClick: () => {
      api.ui.showModal({
        title: 'Jiggle Spring Waveform Mod Aktif',
        contentHtml: \`
          <p>Mod ini mengubah bilah progres audio standar menjadi kurva gelombang tebal dinamis:</p>
          <ul style="padding-left:20px; margin:12px 0; display:flex; flex-direction:column; gap:6px;">
            <li><strong>Fisika Pegas (Spring Jiggle)</strong>: Berosilasi dengan getaran pegas halus saat titik slider ditekan dan dipindahkan.</li>
            <li><strong>Bentuk Stiff Tenang</strong>: Tetap diam dan stabil saat pemutaran musik normal tanpa getaran liar.</li>
            <li><strong>Zonasi Volume Makro</strong>: Menyesuaikan ketebalan dan lengkungan gelombang berdasarkan dinamika musik (bagian keras melengkung anggun, bagian senyap rata).</li>
            <li><strong>Clean Teardown</strong>: Saat dinonaktifkan di Pengaturan, tampilan otomatis kembali ke bilah vertikal bawaan tanpa kebocoran memori.</li>
          </ul>
        \`
      });
    }
  });
}
`,

  'README.md': `# Jiggle Spring Waveform Bar Mod

Mod resmi untuk mengubah bilah progres pemutar menjadi garis gelombang tebal interaktif dengan animasi getaran pegas (spring oscillator).

## Fitur:
1. Garis gelombang tebal bergradasi neon (#00f0ff ke #a855f7) dengan efek pencahayaan dinamis.
2. Fisika pegas (F = -k*x, damping 0.88) yang berosilasi saat seekbar ditekan dan digeser.
3. Bentuk stiff tenang saat pemutaran biasa tanpa getaran liar.
4. Zonasi volume lagu makro yang halus dan harmonis.
`
};

/**
 * Generate binary ZIP buffer for the jiggle waveform mod
 * @returns {Promise<Uint8Array>}
 */
export async function generateJiggleWaveformModZip() {
  return packZip(JIGGLE_MOD_FILES);
}
