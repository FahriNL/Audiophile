/**
 * analysisView.js - Audio spectrum & ITU-R BS.1770 loudness dashboard, batch runner with pause/resume,
 * and comprehensive spectrogram/dynamics inspector.
 */

import { store } from '../../core/store.js';
import { analyzer } from '../../quality/analyzer.js';
import { folderManager } from '../../library/folders.js';
import { dialog } from '../components/dialog.js';
import { escapeHtml } from '../../core/utils.js';

class AnalysisView {
  constructor() {
    this.container = null;
  }

  init() {
    this.container = document.getElementById('viewAnalysis');
    store.subscribe('analysisProgress', (prog) => this.updateProgress(prog));
    store.subscribe('tracks', () => this.renderStats());
  }

  activate() {
    this.render();
  }

  render() {
    if (!this.container) return;

    const tracks = store.get('tracks') || [];
    const verified = tracks.filter(t => t.analysis?.status === 'verified_hires').length;
    const suspect = tracks.filter(t => t.analysis?.status === 'suspected_upsample' || t.analysis?.status === 'suspected_transcode').length;
    const pending = tracks.filter(t => !t.analysis || t.analysis.lufs === undefined).length;
    const hiresCount = tracks.filter(t => t.tier === 'HI-RES' || t.tier === 'DSD').length;
    const hiresRatio = tracks.length > 0 ? Math.round((hiresCount / tracks.length) * 100) : 0;

    this.container.innerHTML = `
      <div style="background:linear-gradient(135deg, #171d2a 0%, #201a11 100%); border:1px solid var(--border-accent); border-radius:var(--radius-lg); padding:20px; display:flex; flex-direction:column; gap:16px;">
        <div class="flex-between" style="flex-wrap:wrap; gap:12px;">
          <div>
            <h3>Verifikasi Spektrum & Analisis Loudness Terpadu</h3>
            <p style="font-size:0.8rem; color:var(--text-muted); max-width:560px; margin-top:4px;">
              Analisis matematis terpadu dalam satu kali decode: verifikasi batas cutoff Hi-Res asli, pengukuran ITU-R BS.1770-4 LUFS, 4x True Peak oversampling, dan Dynamic Range (DR) terbuka.
            </p>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="btn btn-secondary" id="btnBatchPause" style="display:${analyzer.isBatchRunning ? 'inline-flex' : 'none'};">
              <span id="batchPauseText">${analyzer.isBatchPaused ? 'Lanjutkan' : 'Jeda'}</span>
            </button>
            <button class="btn btn-primary" id="btnBatchAnalyze">
              <span id="batchBtnText">${analyzer.isBatchRunning ? 'Hentikan' : 'Analisis Seluruh Library'}</span>
            </button>
          </div>
        </div>

        <!-- Progress Bar Container -->
        <div id="batchProgressWrapper" style="display:${analyzer.isBatchRunning ? 'block' : 'none'};">
          <div style="width:100%; height:6px; background:rgba(255,255,255,0.1); border-radius:var(--radius-full); overflow:hidden;">
            <div id="batchProgressFill" style="height:100%; background:linear-gradient(90deg, var(--accent), var(--tier-studio)); width:0%;"></div>
          </div>
          <div id="batchProgressLabel" class="mono" style="font-size:0.72rem; color:var(--text-dim); margin-top:6px;">Memproses...</div>
        </div>

        <!-- Stats Grid -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px;">
          <div style="background:rgba(0,0,0,0.35); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:10px 14px;">
            <div style="font-size:0.7rem; color:var(--text-dim); text-transform:uppercase;">Terverifikasi Asli</div>
            <div class="mono" style="font-size:1.3rem; font-weight:700; color:var(--status-verified);">${verified}</div>
          </div>
          <div style="background:rgba(0,0,0,0.35); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:10px 14px;">
            <div style="font-size:0.7rem; color:var(--text-dim); text-transform:uppercase;">Diduga Upsample / Palsu</div>
            <div class="mono" style="font-size:1.3rem; font-weight:700; color:var(--status-suspect);">${suspect}</div>
          </div>
          <div style="background:rgba(0,0,0,0.35); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:10px 14px;">
            <div style="font-size:0.7rem; color:var(--text-dim); text-transform:uppercase;">Rasio Hi-Res Library</div>
            <div class="mono" style="font-size:1.3rem; font-weight:700; color:var(--accent-light);">${hiresRatio}%</div>
          </div>
          <div style="background:rgba(0,0,0,0.35); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:10px 14px;">
            <div style="font-size:0.7rem; color:var(--text-dim); text-transform:uppercase;">Belum Dianalisis</div>
            <div class="mono" style="font-size:1.3rem; font-weight:700; color:var(--text-muted);">${pending}</div>
          </div>
        </div>

        <div style="font-size:0.75rem; color:var(--text-dim); line-height:1.4; border-top:1px solid rgba(255,255,255,0.06); padding-top:8px;">
          <em>Pernyataan Kejujuran:</em> Analisis spektral dan kenyaringan dihitung di peramban secara lokal. Nilai Dynamic Range (DR) menggunakan metode terbuka komparasi puncak terhadap kuantil 20% RMS blok energi dan diberi label perkiraan. Musik dengan dinamika rendah mencerminkan karakteristik produksi/mastering rekaman dan bukan merupakan penilaian kualitas karya.
        </div>
      </div>

      <!-- Analyzed Tracks List -->
      <div style="margin-top:20px;">
        <h4 style="margin-bottom:12px;">Hasil Analisis Spektrum & Loudness Lagu</h4>
        <div id="analysisItemsList" style="display:flex; flex-direction:column; gap:8px;">
          ${tracks.filter(t => t.analysis).length === 0 ? '<p style="color:var(--text-muted); font-size:0.85rem;">Belum ada lagu yang dianalisis. Putar sebuah lagu atau tekan "Analisis Seluruh Library" di atas.</p>' : ''}
          ${tracks.filter(t => t.analysis).slice(0, 80).map(t => {
            const a = t.analysis;
            const isSuspect = a.status === 'suspected_upsample' || a.status === 'suspected_transcode';
            const lufsStr = a.lufs !== undefined ? `${a.lufs} LUFS` : '-';
            const tpStr = a.truePeakDbtp !== undefined ? `TP ${a.truePeakDbtp} dBTP` : '-';
            const drStr = a.dr !== undefined ? `DR ${a.dr} (perkiraan)` : '-';
            const lowDynTag = (a.isLowDynamics || (a.dr !== undefined && a.dr <= 7)) ? '<span style="color:var(--text-dim); font-size:0.7rem; margin-left:4px;">[dinamika rendah]</span>' : '';

            return `
              <div class="card analysis-item-card" data-id="${t.id}" style="padding:12px; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                  <div>
                    <h4 style="font-size:0.9rem;">${escapeHtml(t.overrides?.title || t.metadata?.title || t.name)}</h4>
                    <p style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(t.metadata?.artist || 'Unknown Artist')} • <span class="mono">${t.tierDetails || t.format.toUpperCase()}</span></p>
                    <p style="font-size:0.75rem; color:${isSuspect ? 'var(--status-suspect)' : 'var(--status-verified)'}; margin-top:4px;">
                      ${escapeHtml(a.notes || 'Analisis selesai.')}
                    </p>
                  </div>
                  <span class="badge ${isSuspect ? 'badge-suspect' : 'badge-verified'}">
                    ${isSuspect ? '[Diduga Palsu]' : '[Terverifikasi]'} (${a.confidence || 85}%)
                  </span>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:0.72rem; color:var(--text-dim); margin-top:8px;" class="mono">
                  <span>Cutoff: ${(a.cutoffHz/1000).toFixed(1)} kHz</span>
                  <span>Loudness: <strong style="color:var(--text);">${lufsStr}</strong></span>
                  <span>${tpStr}</span>
                  <span>${drStr}${lowDynTag}</span>
                  <span>Noise: ${a.noiseFloorDb} dB</span>
                  <span>Stereo: ${a.fakeStereo ? '[Dual-Mono]' : '[Normal]'}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Batch analyze triggers
    document.getElementById('btnBatchAnalyze')?.addEventListener('click', async () => {
      if (analyzer.isBatchRunning) {
        analyzer.cancelBatch();
      } else {
        const trs = store.get('tracks') || [];
        await analyzer.runBatchAnalysis(trs, (tr) => folderManager.getFileForTrack(tr));
      }
    });

    document.getElementById('btnBatchPause')?.addEventListener('click', () => {
      if (analyzer.isBatchPaused) {
        analyzer.resumeBatch();
      } else {
        analyzer.pauseBatch();
      }
    });

    // Inspect individual spectrogram & loudness
    this.container.querySelectorAll('.analysis-item-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        const tr = tracks.find(t => t.id === id);
        if (tr) this.showSpectrogramDialog(tr);
      });
    });
  }

  updateProgress(prog) {
    const wrap = document.getElementById('batchProgressWrapper');
    const fill = document.getElementById('batchProgressFill');
    const label = document.getElementById('batchProgressLabel');
    const btnText = document.getElementById('batchBtnText');
    const pauseBtn = document.getElementById('btnBatchPause');
    const pauseText = document.getElementById('batchPauseText');

    if (prog.running) {
      if (wrap) wrap.style.display = 'block';
      if (btnText) btnText.innerText = 'Hentikan';
      if (pauseBtn) pauseBtn.style.display = 'inline-flex';
      if (pauseText) pauseText.innerText = prog.paused ? 'Lanjutkan' : 'Jeda';

      const pct = prog.total > 0 ? Math.round((prog.processed / prog.total) * 100) : 0;
      if (fill) fill.style.width = `${pct}%`;
      const currentLabel = prog.currentTrackTitle ? ` - ${escapeHtml(prog.currentTrackTitle)}` : '';
      if (label) label.innerText = `${prog.paused ? '[DIJEDA] ' : ''}Memproses [${prog.processed} / ${prog.total}]: ${pct}%${currentLabel}`;
    } else {
      if (wrap) wrap.style.display = 'none';
      if (btnText) btnText.innerText = 'Analisis Seluruh Library';
      if (pauseBtn) pauseBtn.style.display = 'none';
    }
  }

  renderStats() {
    if (this.container && !this.activePlaylist) {
      this.render();
    }
  }

  showSpectrogramDialog(track) {
    const a = track.analysis;
    const content = document.createElement('div');
    const lufsVal = a?.lufs !== undefined ? `${a.lufs} LUFS` : '-';
    const tpVal = a?.truePeakDbtp !== undefined ? `${a.truePeakDbtp} dBTP (Sample Peak: ${a.samplePeakDb} dBFS)` : '-';
    let drVal = '-';
    if (a?.dr !== undefined) {
      drVal = `DR ${a.dr} (perkiraan)`;
      if (a.isLowDynamics || a.dr <= 7) drVal += ' [dinamika rendah]';
    }
    const rgVal = a?.replayGainDb !== undefined ? `${a.replayGainDb > 0 ? '+' : ''}${a.replayGainDb} dB` : '-';

    content.innerHTML = `
      <div style="margin-bottom:12px;">
        <h4 style="font-size:1.05rem;">${escapeHtml(track.overrides?.title || track.metadata?.title || track.name)}</h4>
        <p style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(track.metadata?.artist || 'Unknown Artist')} • <span class="mono">${track.tierDetails || track.format.toUpperCase()}</span></p>
      </div>

      <div style="background:#090c12; border-radius:var(--radius-md); padding:10px; margin-bottom:14px;">
        <canvas id="dialogSpecCanvas" style="width:100%; height:180px;"></canvas>
        <div style="display:flex; justify-content:space-between; font-size:0.68rem; font-family:var(--font-mono); color:var(--text-dim); margin-top:4px;">
          <span>0 Hz</span>
          <span>10 kHz</span>
          <span>20 kHz</span>
          <span>${((track.streamInfo?.sampleRate || 44100) / 2000).toFixed(1)} kHz (Nyquist)</span>
        </div>
      </div>

      ${a ? `
        <div style="display:flex; flex-direction:column; gap:6px; font-size:0.8rem;" class="mono">
          <div><strong style="color:var(--text-muted);">Diagnosa Hi-Res:</strong> <span style="color:${a.status === 'verified_hires' ? 'var(--status-verified)' : 'var(--status-suspect)'};">${escapeHtml(a.notes || '-')}</span></div>
          <div><strong style="color:var(--text-muted);">Loudness BS.1770:</strong> <strong style="color:var(--text);">${lufsVal}</strong></div>
          <div><strong style="color:var(--text-muted);">True Peak (4x):</strong> ${tpVal}</div>
          <div><strong style="color:var(--text-muted);">Rentang Dinamika:</strong> ${drVal}</div>
          <div><strong style="color:var(--text-muted);">Rekomendasi ReplayGain:</strong> ${rgVal}</div>
          <div><strong style="color:var(--text-muted);">Cutoff Frekuensi:</strong> ${(a.cutoffHz/1000).toFixed(2)} kHz | Noise Floor: ${a.noiseFloorDb} dBFS</div>
          <div><strong style="color:var(--text-muted);">Integritas Kanal:</strong> ${a.fakeStereo ? '[Peringatan: Diduga Dual-Mono]' : '[Stereo Normal Terverifikasi]'}</div>
        </div>
      ` : '<p style="color:var(--text-dim); font-size:0.8rem;">Lagu ini belum dianalisis.</p>'}
    `;

    dialog.showCustom({
      title: 'Laporan Autentikasi Spektrum & Dinamika Audio',
      content,
      buttons: [{ label: 'Tutup' }]
    });

    if (a?.spectrumCurve) {
      setTimeout(() => {
        const canvas = document.getElementById('dialogSpecCanvas');
        if (canvas) {
          const ctx = canvas.getContext('2d');
          const w = (canvas.width = canvas.clientWidth);
          const h = (canvas.height = canvas.clientHeight);
          ctx.fillStyle = '#090c12';
          ctx.fillRect(0, 0, w, h);

          const curve = a.spectrumCurve;
          const stepX = w / (curve.length - 1);
          ctx.beginPath();
          for (let i = 0; i < curve.length; i++) {
            const y = h - ((curve[i] + 110) / 110) * h;
            const x = i * stepX;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }, 60);
    }
  }
}

export const analysisView = new AnalysisView();
