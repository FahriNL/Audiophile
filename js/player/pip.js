/**
 * pip.js - Floating Mini Player (Picture-in-Picture)
 *
 * Implements UX-02:
 * 1. Primary Desktop Engine: window.documentPictureInPicture (Document PiP API)
 *    - Floating window with album cover, title, artist, play/pause, next, prev, seek bar, quality badge, active lyrics.
 *    - Bidirectional real-time sync with main audio engine.
 *    - Closes cleanly and returns focus to main window.
 * 2. Fallback Engine: Canvas-streamed <video> with HTMLVideoElement.requestPictureInPicture()
 *    - Renders cover artwork and title to offscreen canvas.
 *    - Controlled natively via OS Media Session integration.
 * 3. Graceful degradation: Hides button if neither is supported (e.g., mobile).
 * 4. Optional auto-open on tab switch (visibilitychange).
 */

import { store } from '../core/store.js';
import { events } from '../core/events.js';
import { engine } from './engine.js';
import { queueManager } from './queue.js';
import { settings } from '../core/settings.js';
import { toast } from '../ui/components/toast.js';
import { escapeHtml, formatDuration } from '../core/utils.js';

class PipManager {
  constructor() {
    this.pipWindow = null;
    this.fallbackVideo = null;
    this.fallbackCanvas = null;
    this.isDocumentPipActive = false;
    this.isVideoPipActive = false;
    this.autoOpenedByVisibility = false;
    this.activeLyricText = '';
  }

  init() {
    // Listen for tab switch if auto-PiP is enabled
    document.addEventListener('visibilitychange', () => {
      this.handleVisibilityChange();
    });

    // Subscribe to track changes for real-time PiP updates
    store.subscribe('currentTrack', (trk) => {
      if (this.isDocumentPipActive) this.updateDocumentPipContent(trk);
      else if (this.isVideoPipActive) this.updateVideoPipCanvas(trk);
    });

    store.subscribe('isPlaying', (playing) => {
      if (this.isDocumentPipActive) this.updateDocumentPipPlayState(playing);
    });

    store.subscribe('currentTime', (time) => {
      if (this.isDocumentPipActive) this.updateDocumentPipProgress(time);
    });
  }

  /**
   * Determine available PiP capability
   * @returns {'document'|'video'|false}
   */
  getCapability() {
    if (typeof window !== 'undefined' && window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function') {
      return 'document';
    }
    if (typeof document !== 'undefined' && document.pictureInPictureEnabled) {
      return 'video';
    }
    return false;
  }

  /**
   * Check if any PiP mode is currently open
   * @returns {boolean}
   */
  isOpen() {
    return this.isDocumentPipActive || this.isVideoPipActive;
  }

  /**
   * Toggle Picture-in-Picture window
   */
  async toggle() {
    if (this.isOpen()) {
      await this.close();
    } else {
      await this.open();
    }
  }

  /**
   * Open floating PiP window using available engine
   */
  async open() {
    const cap = this.getCapability();
    if (!cap) {
      toast.info('Picture-in-Picture tidak didukung pada peramban ini.');
      return false;
    }

    const currentTrack = store.get('currentTrack');
    if (!currentTrack) {
      toast.info('Putar lagu terlebih dahulu untuk membuka Mini Player.');
      return false;
    }

    try {
      if (cap === 'document') {
        return await this.openDocumentPip(currentTrack);
      } else {
        return await this.openVideoPip(currentTrack);
      }
    } catch (err) {
      console.warn('Gagal membuka Picture-in-Picture:', err);
      toast.error('Gagal membuka Mini Player: ' + err.message);
      return false;
    }
  }

  /**
   * Close any open PiP window
   */
  async close() {
    if (this.pipWindow) {
      try {
        this.pipWindow.close();
      } catch {}
      this.pipWindow = null;
      this.isDocumentPipActive = false;
    }

    if (this.isVideoPipActive && document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
      } catch {}
      this.isVideoPipActive = false;
    }

    events.emit('pip:status', false);
  }

  /**
   * Primary: Open Document Picture-in-Picture
   * @param {Object} track
   */
  async openDocumentPip(track) {
    if (this.pipWindow) {
      this.pipWindow.close();
    }

    const pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 320,
      height: 440
    });

    this.pipWindow = pipWindow;
    this.isDocumentPipActive = true;

    // 1. Copy stylesheet styles to the new window
    this.copyStylesToWindow(pipWindow);

    // 2. Build Mini Player UI inside PiP
    pipWindow.document.body.innerHTML = `
      <div class="pip-player-root" id="pipRoot">
        <!-- Cover Art -->
        <div class="pip-cover-wrap">
          <img id="pipCoverImg" src="${track.overrides?.pictureUrl || track.metadata?.pictureUrl || ''}" alt="Cover" style="${(track.overrides?.pictureUrl || track.metadata?.pictureUrl) ? '' : 'display:none;'}" />
          <div id="pipCoverFallback" class="pip-cover-fallback" style="${(track.overrides?.pictureUrl || track.metadata?.pictureUrl) ? 'display:none;' : ''}">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
          <span class="badge pip-badge" id="pipBadge">${escapeHtml(track.tier || 'AUDIO')}</span>
        </div>

        <!-- Track Info -->
        <div class="pip-info">
          <div class="pip-title truncate" id="pipTitle">${escapeHtml(track.overrides?.title || track.metadata?.title || track.name)}</div>
          <div class="pip-artist truncate" id="pipArtist">${escapeHtml(track.overrides?.artist || track.metadata?.artist || 'Unknown Artist')}</div>
        </div>

        <!-- Active Lyric -->
        <div class="pip-lyric truncate" id="pipLyric">${escapeHtml(this.activeLyricText || 'Audiophile')}</div>

        <!-- Seek Bar -->
        <div class="pip-seek-wrap">
          <input type="range" class="pip-seek-slider" id="pipSeek" min="0" max="${Math.round(track.streamInfo?.duration || 100)}" value="${Math.round(store.get('currentTime') || 0)}" />
          <div class="pip-time-row">
            <span id="pipTimeCur">${formatDuration(store.get('currentTime') || 0)}</span>
            <span id="pipTimeDur">${formatDuration(track.streamInfo?.duration || 0)}</span>
          </div>
        </div>

        <!-- Controls -->
        <div class="pip-controls">
          <button class="pip-btn" id="pipBtnPrev" title="Sebelumnya" aria-label="Sebelumnya">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
          </button>
          <button class="pip-btn pip-btn-play" id="pipBtnPlay" title="Putar/Jeda" aria-label="Putar/Jeda">
            ${store.get('isPlaying') ? `
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            ` : `
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            `}
          </button>
          <button class="pip-btn" id="pipBtnNext" title="Berikutnya" aria-label="Berikutnya">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
          </button>
        </div>
      </div>
    `;

    // 3. Attach PiP DOM Events
    const doc = pipWindow.document;

    doc.getElementById('pipBtnPlay')?.addEventListener('click', () => {
      if (store.get('isPlaying')) engine.pause();
      else engine.resume();
    });

    doc.getElementById('pipBtnNext')?.addEventListener('click', () => {
      queueManager.next();
    });

    doc.getElementById('pipBtnPrev')?.addEventListener('click', () => {
      queueManager.prev();
    });

    const seekSlider = doc.getElementById('pipSeek');
    seekSlider?.addEventListener('input', (e) => {
      const targetSec = parseFloat(e.target.value);
      engine.seek(targetSec);
    });

    // 4. Handle Window Close
    pipWindow.addEventListener('pagehide', () => {
      this.pipWindow = null;
      this.isDocumentPipActive = false;
      try {
        window.focus();
      } catch {}
      events.emit('pip:status', false);
    });

    events.emit('pip:status', true);
    return true;
  }

  /**
   * Copy styles and theme variables to Document PiP window
   * @param {Window} win
   */
  copyStylesToWindow(win) {
    const doc = win.document;
    doc.documentElement.setAttribute('data-theme', settings.get('theme', 'dark'));

    // Inject base mini player styles
    const styleEl = doc.createElement('style');
    styleEl.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #090d16;
        color: #f1f5f9;
        height: 100vh;
        overflow: hidden;
        user-select: none;
      }
      .pip-player-root {
        display: flex;
        flex-direction: column;
        height: 100vh;
        padding: 16px;
        gap: 12px;
        justify-content: space-between;
      }
      .pip-cover-wrap {
        position: relative;
        width: 100%;
        flex: 1;
        max-height: 200px;
        border-radius: 12px;
        overflow: hidden;
        background: #172033;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      }
      .pip-cover-wrap img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .pip-cover-fallback {
        color: #64748b;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .pip-badge {
        position: absolute;
        top: 8px;
        left: 8px;
        background: rgba(0,0,0,0.7);
        border: 1px solid #3b82f6;
        color: #93c5fd;
        font-size: 0.65rem;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: monospace;
      }
      .pip-info {
        text-align: center;
      }
      .pip-title {
        font-size: 0.95rem;
        font-weight: 700;
        color: #ffffff;
      }
      .pip-artist {
        font-size: 0.8rem;
        color: #94a3b8;
        margin-top: 2px;
      }
      .pip-lyric {
        font-size: 0.75rem;
        color: #38bdf8;
        text-align: center;
        font-style: italic;
        min-height: 18px;
      }
      .pip-seek-wrap {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .pip-seek-slider {
        width: 100%;
        height: 4px;
        -webkit-appearance: none;
        background: rgba(255,255,255,0.2);
        border-radius: 2px;
        outline: none;
        cursor: pointer;
      }
      .pip-seek-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #3b82f6;
        cursor: pointer;
      }
      .pip-time-row {
        display: flex;
        justify-content: space-between;
        font-size: 0.68rem;
        color: #64748b;
        font-family: monospace;
      }
      .pip-controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
      }
      .pip-btn {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 50%;
        width: 38px;
        height: 38px;
        color: #cbd5e1;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .pip-btn:hover {
        background: rgba(255,255,255,0.15);
        color: #ffffff;
      }
      .pip-btn-play {
        width: 48px;
        height: 48px;
        background: #2563eb;
        border-color: #3b82f6;
        color: #ffffff;
      }
      .pip-btn-play:hover {
        background: #1d4ed8;
      }
      .truncate {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `;
    doc.head.appendChild(styleEl);
  }

  updateDocumentPipContent(track) {
    if (!this.pipWindow || !track) return;
    const doc = this.pipWindow.document;

    const titleEl = doc.getElementById('pipTitle');
    if (titleEl) titleEl.innerText = track.overrides?.title || track.metadata?.title || track.name;

    const artistEl = doc.getElementById('pipArtist');
    if (artistEl) artistEl.innerText = track.overrides?.artist || track.metadata?.artist || 'Unknown Artist';

    const badgeEl = doc.getElementById('pipBadge');
    if (badgeEl) badgeEl.innerText = track.tier || 'AUDIO';

    const imgEl = doc.getElementById('pipCoverImg');
    const fallbackEl = doc.getElementById('pipCoverFallback');
    const pic = track.overrides?.pictureUrl || track.metadata?.pictureUrl;

    if (imgEl && fallbackEl) {
      if (pic) {
        imgEl.src = pic;
        imgEl.style.display = 'block';
        fallbackEl.style.display = 'none';
      } else {
        imgEl.style.display = 'none';
        fallbackEl.style.display = 'flex';
      }
    }

    const durEl = doc.getElementById('pipTimeDur');
    if (durEl) durEl.innerText = formatDuration(track.streamInfo?.duration || 0);

    const seekSlider = doc.getElementById('pipSeek');
    if (seekSlider) seekSlider.max = Math.round(track.streamInfo?.duration || 100);
  }

  updateDocumentPipPlayState(isPlaying) {
    if (!this.pipWindow) return;
    const btn = this.pipWindow.document.getElementById('pipBtnPlay');
    if (!btn) return;

    if (isPlaying) {
      btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    } else {
      btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    }
  }

  updateDocumentPipProgress(currentTime) {
    if (!this.pipWindow) return;
    const doc = this.pipWindow.document;

    const curEl = doc.getElementById('pipTimeCur');
    if (curEl) curEl.innerText = formatDuration(currentTime);

    const seekSlider = doc.getElementById('pipSeek');
    if (seekSlider && doc.activeElement !== seekSlider) {
      seekSlider.value = Math.round(currentTime);
    }
  }

  setLyricLine(text) {
    this.activeLyricText = text || '';
    if (this.pipWindow) {
      const lyricEl = this.pipWindow.document.getElementById('pipLyric');
      if (lyricEl) lyricEl.innerText = this.activeLyricText || 'Audiophile';
    }
  }

  /**
   * Fallback: Canvas-driven <video> PiP
   * @param {Object} track
   */
  async openVideoPip(track) {
    if (!this.fallbackCanvas) {
      this.fallbackCanvas = document.createElement('canvas');
      this.fallbackCanvas.width = 512;
      this.fallbackCanvas.height = 512;
    }

    if (!this.fallbackVideo) {
      this.fallbackVideo = document.createElement('video');
      this.fallbackVideo.muted = true;
      this.fallbackVideo.autoplay = true;
      this.fallbackVideo.playsInline = true;
      this.fallbackVideo.style.position = 'fixed';
      this.fallbackVideo.style.pointerEvents = 'none';
      this.fallbackVideo.style.opacity = '0';
      this.fallbackVideo.style.width = '1px';
      this.fallbackVideo.style.height = '1px';
      document.body.appendChild(this.fallbackVideo);
    }

    this.drawCanvasCover(track);

    const stream = this.fallbackCanvas.captureStream(1);
    this.fallbackVideo.srcObject = stream;
    await this.fallbackVideo.play();
    await this.fallbackVideo.requestPictureInPicture();

    this.isVideoPipActive = true;
    events.emit('pip:status', true);

    this.fallbackVideo.addEventListener('leavepictureinpicture', () => {
      this.isVideoPipActive = false;
      events.emit('pip:status', false);
    }, { once: true });

    return true;
  }

  drawCanvasCover(track) {
    if (!this.fallbackCanvas) return;
    const ctx = this.fallbackCanvas.getContext('2d');
    const { width, height } = this.fallbackCanvas;

    // Dark gradient background
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#090d16');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Title & Artist
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    const title = track.overrides?.title || track.metadata?.title || track.name;
    ctx.fillText(title.substring(0, 24), width / 2, height / 2 - 20);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '24px sans-serif';
    const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown Artist';
    ctx.fillText(artist.substring(0, 30), width / 2, height / 2 + 24);

    // Tier badge
    ctx.fillStyle = '#3b82f6';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(track.tier || 'AUDIO', width / 2, height / 2 + 70);
  }

  updateVideoPipCanvas(track) {
    if (!this.isVideoPipActive) return;
    this.drawCanvasCover(track);
  }

  handleVisibilityChange() {
    const isAutoPipEnabled = settings.get('autoPipOnTabBlur', false);
    if (!isAutoPipEnabled) return;

    if (document.hidden && store.get('isPlaying') && !this.isOpen()) {
      this.autoOpenedByVisibility = true;
      this.open().catch(() => {});
    } else if (!document.hidden && this.autoOpenedByVisibility && this.isOpen()) {
      this.autoOpenedByVisibility = false;
      this.close().catch(() => {});
    }
  }
}

export const pipManager = new PipManager();
