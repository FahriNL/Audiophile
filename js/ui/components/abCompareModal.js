/**
 * abCompareModal.js - Comprehensive A/B version comparison and ABX blind test modal (AUD-03).
 *
 * Provides:
 * - Synchronous dual-playback with ~30ms micro-fade switching
 * - EBU R128 LUFS automatic loudness matching (delta <= 0.1 dB)
 * - Loop selection controls (10s, 15s, 20s, 30s)
 * - Dual side-by-side spectrum visualizers and quality tier badges
 * - Anonymized 10-trial ABX blind test wizard with binomial p-value and version reveal
 */

import { abPlayer } from '../../player/abPlayer.js';
import { engine } from '../../player/engine.js';
import { classifyQualityTier } from '../../quality/tiers.js';
import { formatDuration, escapeHtml } from '../../core/utils.js';
import { toast } from './toast.js';
import { getIconSvg } from '../icons.js';

class ABCompareModalManager {
  constructor() {
    this.overlay = null;
    this.currentMode = 'ab'; // 'ab' | 'abx'
    this.animationFrameId = null;
    this.canvasA = null;
    this.canvasB = null;
    this.ctxA = null;
    this.ctxB = null;
    this.revealed = false;
  }

  /**
   * Open A/B comparison modal between two tracks
   * @param {Object} trackA 
   * @param {Object} trackB 
   */
  async open(trackA, trackB) {
    if (!trackA || !trackB) {
      toast.warning('Pilih minimal dua versi lagu untuk dibandingkan.');
      return;
    }

    // Pause primary engine playback
    engine.pause();

    // Remove any previous modal
    this.close();

    this.revealed = false;
    this.currentMode = 'ab';

    this.overlay = document.createElement('div');
    this.overlay.className = 'ab-compare-overlay active';
    this.overlay.id = 'abCompareOverlay';

    // Render modal skeleton
    this.overlay.innerHTML = `
      <div class="ab-compare-modal" role="dialog" aria-modal="true" aria-labelledby="abModalTitle">
        <!-- Modal Header -->
        <div class="ab-compare-header">
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="ab-header-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
              </svg>
            </div>
            <div>
              <h3 class="ab-modal-title" id="abModalTitle">Bandingkan Versi Audio (A/B)</h3>
              <p class="ab-modal-sub" id="abModalTrackName">Memuat berkas audio...</p>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="ab-mode-tabs">
              <button class="ab-tab-btn active" id="tabModeAb">Mode A/B</button>
              <button class="ab-tab-btn" id="tabModeAbx">Tes Buta (ABX)</button>
            </div>
            <button class="btn btn-icon" id="btnAbClose" aria-label="Tutup">${getIconSvg('close', { size: 18 })}</button>
          </div>
        </div>

        <!-- Enhanced Path Explanation Banner -->
        <div class="ab-notice-card">
          <div class="ab-notice-title">Jalur Pemrosesan Enhanced (DSP)</div>
          <div class="ab-notice-desc">
            Layar perbandingan ini menggunakan jalur Web Audio Enhanced untuk menyamakan kenyaringan kedua file secara otomatis (Loudness Matching), sehingga telinga Anda dapat membandingkan kejernihan rekaman secara objektif tanpa bias volume yang lebih keras.
          </div>
        </div>

        <!-- Modal Body Content -->
        <div class="ab-modal-body" id="abModalBody">
          <div style="text-align:center; padding:40px; color:var(--text-muted);">
            Menyiapkan decoding dan sinkronisasi berkas...
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    // Bind close actions
    this.overlay.querySelector('#btnAbClose').addEventListener('click', () => this.close());
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        this.close();
        window.removeEventListener('keydown', onKeyDown);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    // Bind mode tabs
    const tabAb = this.overlay.querySelector('#tabModeAb');
    const tabAbx = this.overlay.querySelector('#tabModeAbx');

    tabAb.addEventListener('click', () => {
      this.currentMode = 'ab';
      tabAb.classList.add('active');
      tabAbx.classList.remove('active');
      this.renderBody();
    });

    tabAbx.addEventListener('click', () => {
      this.currentMode = 'abx';
      tabAbx.classList.add('active');
      tabAb.classList.remove('active');
      this.renderBody();
    });

    try {
      await abPlayer.load(trackA, trackB);
      const title = trackA.overrides?.title || trackA.metadata?.title || trackA.name;
      const artist = trackA.overrides?.artist || trackA.metadata?.artist || 'Unknown Artist';
      const nameEl = this.overlay.querySelector('#abModalTrackName');
      if (nameEl) nameEl.innerText = `${title} • ${artist}`;

      this.renderBody();
    } catch (err) {
      console.error('Gagal memuat pemutar A/B:', err);
      const bodyEl = this.overlay.querySelector('#abModalBody');
      if (bodyEl) {
        bodyEl.innerHTML = `
          <div style="text-align:center; padding:40px;">
            <p style="color:var(--status-suspect); margin-bottom:12px;">${escapeHtml(err.message || 'Gagal memuat salah satu file audio.')}</p>
            <button class="btn btn-secondary" id="btnErrClose">Tutup</button>
          </div>
        `;
        bodyEl.querySelector('#btnErrClose')?.addEventListener('click', () => this.close());
      }
    }
  }

  /**
   * Render modal body depending on active mode (A/B vs ABX)
   */
  renderBody() {
    const bodyEl = this.overlay?.querySelector('#abModalBody');
    if (!bodyEl) return;

    if (this.currentMode === 'ab') {
      this.renderAbView(bodyEl);
    } else {
      this.renderAbxView(bodyEl);
    }
  }

  // ==========================================
  // VIEW: MODE A/B
  // ==========================================

  renderAbView(container) {
    const trA = abPlayer.trackA;
    const trB = abPlayer.trackB;
    if (!trA || !trB) return;

    const tierA = classifyQualityTier(trA.streamInfo, trA.format);
    const tierB = classifyQualityTier(trB.streamInfo, trB.format);
    const lGains = abPlayer.loudnessGains;

    container.innerHTML = `
      <div class="ab-view-container">
        <!-- Switcher Bar: Big A vs B Buttons -->
        <div class="ab-switcher-grid">
          <button class="ab-switch-btn ${abPlayer.activeChannel === 'A' ? 'active' : ''}" id="btnSwitchA">
            <div class="ab-switch-top">
              <span class="ab-switch-tag">VERSI A</span>
              <span class="badge ${tierA.badgeClass}">${tierA.iconSvg} ${escapeHtml(tierA.label)}</span>
            </div>
            <div class="ab-switch-format truncate">${escapeHtml(trA.format.toUpperCase())} • ${trA.streamInfo?.sampleRate ? `${trA.streamInfo.sampleRate / 1000} kHz` : ''} ${trA.streamInfo?.bitDepth ? `/ ${trA.streamInfo.bitDepth}-bit` : ''}</div>
            <div class="ab-switch-status">${abPlayer.activeChannel === 'A' ? 'Sedang Diputar' : 'Klik untuk Beralih'}</div>
          </button>

          <button class="ab-switch-btn ${abPlayer.activeChannel === 'B' ? 'active' : ''}" id="btnSwitchB">
            <div class="ab-switch-top">
              <span class="ab-switch-tag">VERSI B</span>
              <span class="badge ${tierB.badgeClass}">${tierB.iconSvg} ${escapeHtml(tierB.label)}</span>
            </div>
            <div class="ab-switch-format truncate">${escapeHtml(trB.format.toUpperCase())} • ${trB.streamInfo?.sampleRate ? `${trB.streamInfo.sampleRate / 1000} kHz` : ''} ${trB.streamInfo?.bitDepth ? `/ ${trB.streamInfo.bitDepth}-bit` : ''}</div>
            <div class="ab-switch-status">${abPlayer.activeChannel === 'B' ? 'Sedang Diputar' : 'Klik untuk Beralih'}</div>
          </button>
        </div>

        <!-- Loudness Matching Status -->
        <div class="ab-loudness-card">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              <strong style="font-size:0.85rem; color:var(--text-main);">Penyetaraan Kenyaringan (EBU R128 / BS.1770)</strong>
            </div>
            <span class="mono" style="font-size:0.75rem; color:var(--accent-light); font-weight:700;">
              ${lGains.matched ? `Selisih ≤ 0.1 dB (${lGains.deltaDb} dB dinetralkan)` : 'Menggunakan level asli'}
            </span>
          </div>
          <div class="ab-loudness-sub mono">
            A: ${lGains.gainDbA > 0 ? '+' : ''}${lGains.gainDbA} dB (${trA.analysis?.lufs !== undefined ? `${trA.analysis.lufs} LUFS` : 'Analisis...'})
            &bull;
            B: ${lGains.gainDbB > 0 ? '+' : ''}${lGains.gainDbB} dB (${trB.analysis?.lufs !== undefined ? `${trB.analysis.lufs} LUFS` : 'Analisis...'})
          </div>
        </div>

        <!-- Transport & Loop Controls -->
        <div class="ab-transport-card">
          <div class="ab-transport-row">
            <button class="btn btn-primary ab-play-btn" id="btnAbPlay">
              ${abPlayer.isPlaying ? 'Jeda' : 'Putar Sinkron'}
            </button>
            <div class="ab-scrubber-wrapper">
              <input type="range" class="ab-scrubber" id="abScrubber" min="0" max="${Math.floor(abPlayer.duration || 100)}" value="${Math.floor(abPlayer.currentTime || 0)}" step="0.5" />
              <div class="ab-time-row mono">
                <span id="abCurrentTimeText">${formatDuration(abPlayer.currentTime)}</span>
                <span id="abDurationText">${formatDuration(abPlayer.duration)}</span>
              </div>
            </div>
          </div>

          <!-- Loop Section Chips -->
          <div class="ab-loop-row">
            <span style="font-size:0.75rem; color:var(--text-dim);">Rentang Potongan Loop:</span>
            <div class="ab-loop-chips">
              ${[10, 15, 20, 30].map(dur => `
                <button class="ab-loop-chip ${abPlayer.loopDuration === dur ? 'active' : ''}" data-loop="${dur}">
                  ${dur} Detik
                </button>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Side-by-Side Spectrum Visualizers -->
        <div class="ab-spectrum-grid">
          <div class="ab-spectrum-box">
            <div class="ab-spectrum-box-head">
              <span class="ab-spec-title">Spektrum Versi A</span>
              <span class="mono" style="font-size:0.72rem; color:var(--text-dim);">${trA.streamInfo?.sampleRate || 44100} Hz</span>
            </div>
            <canvas class="ab-canvas" id="canvasSpecA" height="110"></canvas>
            <div class="ab-spec-meta mono">
              <div>Bitrate: ${trA.streamInfo?.bitrate ? `${Math.round(trA.streamInfo.bitrate / 1000)} kbps` : '-'}</div>
              <div>Ukuran: ${trA.size ? `${(trA.size / (1024 * 1024)).toFixed(2)} MB` : '-'}</div>
            </div>
          </div>

          <div class="ab-spectrum-box">
            <div class="ab-spectrum-box-head">
              <span class="ab-spec-title">Spektrum Versi B</span>
              <span class="mono" style="font-size:0.72rem; color:var(--text-dim);">${trB.streamInfo?.sampleRate || 44100} Hz</span>
            </div>
            <canvas class="ab-canvas" id="canvasSpecB" height="110"></canvas>
            <div class="ab-spec-meta mono">
              <div>Bitrate: ${trB.streamInfo?.bitrate ? `${Math.round(trB.streamInfo.bitrate / 1000)} kbps` : '-'}</div>
              <div>Ukuran: ${trB.size ? `${(trB.size / (1024 * 1024)).toFixed(2)} MB` : '-'}</div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind controls
    const btnSwitchA = container.querySelector('#btnSwitchA');
    const btnSwitchB = container.querySelector('#btnSwitchB');
    const btnPlay = container.querySelector('#btnAbPlay');
    const scrubber = container.querySelector('#abScrubber');

    btnSwitchA.addEventListener('click', () => {
      abPlayer.switchTo('A');
      btnSwitchA.classList.add('active');
      btnSwitchB.classList.remove('active');
      btnSwitchA.querySelector('.ab-switch-status').innerText = 'Sedang Diputar';
      btnSwitchB.querySelector('.ab-switch-status').innerText = 'Klik untuk Beralih';
    });

    btnSwitchB.addEventListener('click', () => {
      abPlayer.switchTo('B');
      btnSwitchB.classList.add('active');
      btnSwitchA.classList.remove('active');
      btnSwitchB.querySelector('.ab-switch-status').innerText = 'Sedang Diputar';
      btnSwitchA.querySelector('.ab-switch-status').innerText = 'Klik untuk Beralih';
    });

    btnPlay.addEventListener('click', async () => {
      await abPlayer.togglePlay();
      btnPlay.innerText = abPlayer.isPlaying ? 'Jeda' : 'Putar Sinkron';
    });

    scrubber.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      abPlayer.seek(val);
      abPlayer.loopStart = val;
    });

    container.querySelectorAll('.ab-loop-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        container.querySelectorAll('.ab-loop-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const dur = Number(chip.getAttribute('data-loop'));
        abPlayer.setLoop(dur);
      });
    });

    // Start Live Spectrum Canvas Animation
    this.startSpectrumAnimation();
  }

  // ==========================================
  // VIEW: MODE TES BUTA (ABX)
  // ==========================================

  renderAbxView(container) {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (abPlayer.abxIsComplete) {
      this.renderAbxResults(container);
      return;
    }

    const currentTrial = abPlayer.abxTrial;
    const totalTrials = abPlayer.abxTotalTrials;
    const activeSel = abPlayer.abxActiveSelection;

    container.innerHTML = `
      <div class="abx-view-container">
        <!-- ABX Progress Indicator -->
        <div class="abx-progress-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span class="abx-trial-badge">Percobaan ${currentTrial} dari ${totalTrials}</span>
            <span class="mono" style="font-size:0.75rem; color:var(--text-muted);">${abPlayer.abxTrialsHistory.length} jawaban tersimpan</span>
          </div>
          <div class="abx-dots-row">
            ${Array.from({ length: totalTrials }).map((_, i) => {
              const hist = abPlayer.abxTrialsHistory[i];
              let cls = 'pending';
              if (i === currentTrial - 1) cls = 'current';
              else if (hist) cls = 'done';
              return `<div class="abx-dot ${cls}"></div>`;
            }).join('')}
          </div>
        </div>

        <!-- ABX Listening Console: A, B, and X -->
        <div class="abx-console-card">
          <p style="font-size:0.85rem; color:var(--text-muted); text-align:center; margin-bottom:16px;">
            Dengarkan Versi 1, Versi 2, dan Sampel X secara bebas. Tentukan apakah sampel X identik dengan Versi 1 atau Versi 2.
          </p>
          <div class="abx-source-buttons">
            <button class="abx-src-btn ${activeSel === 'A' ? 'active' : ''}" id="btnAbxSrcA">
              <span class="abx-btn-label">Dengarkan Versi 1</span>
              <span class="abx-btn-sub">Format & Tier Tersembunyi</span>
            </button>
            <button class="abx-src-btn ${activeSel === 'X' ? 'active' : ''}" id="btnAbxSrcX">
              <span class="abx-btn-label">Dengarkan Sampel X</span>
              <span class="abx-btn-sub">Sampel Uji Acak</span>
            </button>
            <button class="abx-src-btn ${activeSel === 'B' ? 'active' : ''}" id="btnAbxSrcB">
              <span class="abx-btn-label">Dengarkan Versi 2</span>
              <span class="abx-btn-sub">Format & Tier Tersembunyi</span>
            </button>
          </div>
        </div>

        <!-- Transport bar -->
        <div style="display:flex; align-items:center; justify-content:center; gap:16px; margin:16px 0;">
          <button class="btn btn-primary" id="btnAbxPlay" style="padding:10px 24px;">
            ${abPlayer.isPlaying ? 'Jeda' : 'Putar Audio'}
          </button>
        </div>

        <!-- User Guess Decision Box -->
        <div class="abx-decision-card">
          <div class="abx-decision-title">Menurut telinga Anda, apakah Sampel X adalah...</div>
          <div class="abx-decision-buttons">
            <button class="btn btn-secondary abx-guess-btn" id="btnGuessA">
              X adalah Versi 1
            </button>
            <button class="btn btn-secondary abx-guess-btn" id="btnGuessB">
              X adalah Versi 2
            </button>
          </div>
        </div>
      </div>
    `;

    // Bind ABX buttons
    container.querySelector('#btnAbxSrcA').addEventListener('click', () => {
      abPlayer.selectAbxSource('A');
      this.renderAbxView(container);
    });

    container.querySelector('#btnAbxSrcB').addEventListener('click', () => {
      abPlayer.selectAbxSource('B');
      this.renderAbxView(container);
    });

    container.querySelector('#btnAbxSrcX').addEventListener('click', () => {
      abPlayer.selectAbxSource('X');
      this.renderAbxView(container);
    });

    container.querySelector('#btnAbxPlay').addEventListener('click', async () => {
      await abPlayer.togglePlay();
      container.querySelector('#btnAbxPlay').innerText = abPlayer.isPlaying ? 'Jeda' : 'Putar Audio';
    });

    container.querySelector('#btnGuessA').addEventListener('click', () => {
      abPlayer.submitAbxGuess('A');
      this.renderAbxView(container);
    });

    container.querySelector('#btnGuessB').addEventListener('click', () => {
      abPlayer.submitAbxGuess('B');
      this.renderAbxView(container);
    });
  }

  // ==========================================
  // VIEW: ABX RESULTS & REVEAL
  // ==========================================

  renderAbxResults(container) {
    const summary = abPlayer.getAbxSummary();
    const trA = abPlayer.trackA;
    const trB = abPlayer.trackB;
    const tierA = classifyQualityTier(trA?.streamInfo, trA?.format);
    const tierB = classifyQualityTier(trB?.streamInfo, trB?.format);

    container.innerHTML = `
      <div class="abx-results-container">
        <div class="abx-result-score-card">
          <div class="abx-result-title">Hasil Uji Mendengar Buta (ABX)</div>
          <div class="abx-score-large mono">${summary.score} / ${summary.total}</div>
          <div class="abx-pct-sub mono">${summary.percentage}% Jawaban Benar</div>

          <div class="abx-pvalue-box mono">
            <div style="font-size:0.75rem; color:var(--text-dim); text-transform:uppercase;">Nilai-p (Probabilitas Kebetulan Acak):</div>
            <div style="font-size:1.15rem; font-weight:700; color:var(--accent); margin-top:2px;">
              ${(summary.pValue * 100).toFixed(2)}% (p = ${summary.pValue})
            </div>
          </div>

          <p class="abx-interp-text">
            ${escapeHtml(summary.interpretation)}
          </p>

          ${!this.revealed ? `
            <div style="margin-top:20px;">
              <button class="btn btn-primary" id="btnRevealVersions" style="padding:10px 24px;">
                Ungkap Versi Asli & Kualitas Berkas
              </button>
            </div>
          ` : `
            <!-- Revealed Version Specs -->
            <div class="abx-reveal-grid" style="margin-top:20px;">
              <div class="abx-reveal-card">
                <div class="abx-reveal-header">
                  <strong>Versi 1 Sebenarnya:</strong>
                  <span class="badge ${tierA.badgeClass}">${tierA.iconSvg} ${escapeHtml(tierA.label)}</span>
                </div>
                <div class="mono" style="font-size:0.8rem; color:var(--text-muted); line-height:1.6; margin-top:8px;">
                  Format: ${trA.format.toUpperCase()}<br/>
                  Sample Rate: ${trA.streamInfo?.sampleRate || 44100} Hz<br/>
                  Bit Depth: ${trA.streamInfo?.bitDepth || 16}-bit
                </div>
              </div>

              <div class="abx-reveal-card">
                <div class="abx-reveal-header">
                  <strong>Versi 2 Sebenarnya:</strong>
                  <span class="badge ${tierB.badgeClass}">${tierB.iconSvg} ${escapeHtml(tierB.label)}</span>
                </div>
                <div class="mono" style="font-size:0.8rem; color:var(--text-muted); line-height:1.6; margin-top:8px;">
                  Format: ${trB.format.toUpperCase()}<br/>
                  Sample Rate: ${trB.streamInfo?.sampleRate || 44100} Hz<br/>
                  Bit Depth: ${trB.streamInfo?.bitDepth || 16}-bit
                </div>
              </div>
            </div>
          `}

          <div style="margin-top:24px; display:flex; gap:10px; justify-content:center;">
            <button class="btn btn-secondary" id="btnRestartAbx">Ulangi Tes Buta</button>
            <button class="btn btn-secondary" id="btnFinishAbx">Selesai</button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnRevealVersions')?.addEventListener('click', () => {
      this.revealed = true;
      this.renderAbxResults(container);
    });

    container.querySelector('#btnRestartAbx').addEventListener('click', () => {
      abPlayer.initAbxState();
      this.revealed = false;
      this.renderAbxView(container);
    });

    container.querySelector('#btnFinishAbx').addEventListener('click', () => {
      this.close();
    });
  }

  // ==========================================
  // REAL-TIME CANVAS FFT VISUALIZER
  // ==========================================

  startSpectrumAnimation() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const draw = () => {
      if (!this.overlay || this.currentMode !== 'ab') return;

      const canvasA = document.getElementById('canvasSpecA');
      const canvasB = document.getElementById('canvasSpecB');
      const timeTxt = document.getElementById('abCurrentTimeText');
      const scrubber = document.getElementById('abScrubber');

      if (timeTxt) timeTxt.innerText = formatDuration(abPlayer.currentTime);
      if (scrubber && !scrubber.matches(':active')) {
        scrubber.value = Math.floor(abPlayer.currentTime);
      }

      const { freqA, freqB } = abPlayer.getLiveSpectrumData();

      if (canvasA) {
        this.drawSpectrumBars(canvasA, freqA, '#2196f3');
      }
      if (canvasB) {
        this.drawSpectrumBars(canvasB, freqB, '#9c27b0');
      }

      this.animationFrameId = requestAnimationFrame(draw);
    };

    this.animationFrameId = requestAnimationFrame(draw);
  }

  drawSpectrumBars(canvas, dataArray, barColor) {
    const ctx = canvas.getContext('2d');
    const width = (canvas.width = canvas.clientWidth || 240);
    const height = (canvas.height = canvas.clientHeight || 110);

    ctx.fillStyle = '#090c12';
    ctx.fillRect(0, 0, width, height);

    if (!dataArray || dataArray.length === 0) return;

    const barCount = 48;
    const step = Math.floor(dataArray.length / barCount) || 1;
    const barWidth = (width / barCount) - 1.5;

    for (let i = 0; i < barCount; i++) {
      const val = dataArray[i * step] || 0;
      const barHeight = (val / 255) * (height - 8);
      const x = i * (barWidth + 1.5);
      const y = height - barHeight;

      ctx.fillStyle = barColor;
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }

  /**
   * Close modal and cleanly stop all audio playback
   */
  close() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    abPlayer.cleanup();

    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}

export const abCompareModal = new ABCompareModalManager();
