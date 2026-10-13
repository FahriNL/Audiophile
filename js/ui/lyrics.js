/**
 * lyrics.js - Advanced Synchronized Lyrics Engine
 * Supports standard LRC, multiple timestamps per line, [offset:+-ms],
 * word-by-word highlighting, spring-based smooth vertical auto-scroll,
 * user scroll timeout pause/resume, and interactive line seek.
 */

import { store } from '../core/store.js';
import { engine } from '../player/engine.js';
import { pipManager } from '../player/pip.js';
import { escapeHtml } from '../core/utils.js';

export class LyricsParser {
  /**
   * Parse raw LRC text into structured line objects
   * @param {string} rawText
   * @returns {{ offset: number, lines: Array<{ time: number, text: string, words?: Array<{ time: number, text: string }> }>, isSynced: boolean }}
   */
  static parse(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { offset: 0, lines: [], isSynced: false };
    }

    const lines = rawText.split(/\r?\n/);
    let offsetMs = 0;
    const parsedLines = [];
    const timeTagRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
    const offsetRegex = /\[offset:\s*([+-]?\d+)\s*\]/i;
    const inlineWordRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>([^<]*)/g;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      // Check for [offset:+-ms] tag
      const offsetMatch = trimmed.match(offsetRegex);
      if (offsetMatch) {
        offsetMs = parseInt(offsetMatch[1], 10) || 0;
        continue;
      }

      // Check line timestamps
      const matches = [...trimmed.matchAll(timeTagRegex)];
      if (matches.length > 0) {
        // Strip line timestamp tags to get text
        let lineText = trimmed.replace(timeTagRegex, '').trim();

        // Check for word-by-word timestamps inside lineText
        const wordMatches = [...lineText.matchAll(inlineWordRegex)];
        let words = null;

        if (wordMatches.length > 0) {
          words = wordMatches.map(wm => {
            const min = parseInt(wm[1], 10);
            const sec = parseInt(wm[2], 10);
            const msStr = wm[3] || '0';
            const ms = parseFloat(`0.${msStr}`);
            const wTime = min * 60 + sec + ms;
            return { time: wTime, text: wm[4].trim() };
          });
          // Clean word tags from line text
          lineText = lineText.replace(/<\d{1,2}:\d{2}(?:\.\d{1,3})?>/g, '').trim();
        }

        // Each timestamp tag on this line generates an entry
        for (const m of matches) {
          const min = parseInt(m[1], 10);
          const sec = parseInt(m[2], 10);
          const msStr = m[3] || '0';
          const ms = parseFloat(`0.${msStr}`);
          const time = min * 60 + sec + ms;

          parsedLines.push({
            time,
            text: lineText,
            words: words ? words.map(w => ({ ...w })) : null
          });
        }
      } else {
        // Un-synced line
        parsedLines.push({
          time: -1,
          text: trimmed,
          words: null
        });
      }
    }

    const isSynced = parsedLines.some(l => l.time >= 0);

    // Apply offset (offset is in milliseconds; positive offset means delay lyrics)
    const offsetSec = offsetMs / 1000;
    if (isSynced && offsetSec !== 0) {
      for (const l of parsedLines) {
        if (l.time >= 0) {
          l.time = Math.max(0, l.time + offsetSec);
          if (l.words) {
            for (const w of l.words) {
              w.time = Math.max(0, w.time + offsetSec);
            }
          }
        }
      }
    }

    // Sort synced lines chronologically
    if (isSynced) {
      parsedLines.sort((a, b) => a.time - b.time);
    }

    return {
      offset: offsetMs,
      lines: parsedLines,
      isSynced
    };
  }
}

export class LyricsController {
  constructor() {
    this.containerFull = null;
    this.containerDrawer = null;
    this.miniLyricEl = null;

    this.currentLyricsData = null;
    this.activeLineIndex = -1;
    this.userScrolling = false;
    this.userScrollTimer = null;
    this.isProgrammaticScroll = false;
    this.resizeObserver = null;
  }

  init() {
    this.containerFull = document.getElementById('fpLyricsContainer');
    this.containerDrawer = document.getElementById('drawerLyricsContainer');
    this.containerFs = document.getElementById('fsLyricsContainer');
    this.miniLyricEl = document.getElementById('playerActiveLyricLine');

    this.setupScrollListeners(this.containerFull);
    this.setupScrollListeners(this.containerDrawer);
    this.setupScrollListeners(this.containerFs);
    this.setupResizeObserver();

    store.subscribe('currentTrack', (track) => {
      this.loadTrackLyrics(track);
    });

    store.subscribe('currentTime', (time) => {
      this.updateTime(time);
    });
  }

  setupResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 50) {
          if (this.activeLineIndex >= 0 && !this.userScrolling) {
            this.centerActiveLine(true);
          }
        }
      }
    });

    if (this.containerFull) this.resizeObserver.observe(this.containerFull);
    if (this.containerDrawer) this.resizeObserver.observe(this.containerDrawer);
    if (this.containerFs) this.resizeObserver.observe(this.containerFs);
  }

  setupScrollListeners(container) {
    if (!container) return;

    const onUserInteraction = () => {
      if (this.isProgrammaticScroll) return;
      this.userScrolling = true;
      if (this.userScrollTimer) clearTimeout(this.userScrollTimer);
      this.userScrollTimer = setTimeout(() => {
        this.userScrolling = false;
        this.centerActiveLine(false);
      }, 3500);
    };

    container.addEventListener('scroll', onUserInteraction, { passive: true });
    container.addEventListener('wheel', onUserInteraction, { passive: true });
    container.addEventListener('touchmove', onUserInteraction, { passive: true });
  }

  onShown() {
    requestAnimationFrame(() => {
      if (this.activeLineIndex >= 0) {
        this.userScrolling = false;
        this.centerActiveLine(true);
      }
    });
  }

  loadTrackLyrics(track) {
    this.activeLineIndex = -1;
    this.userScrolling = false;
    if (this.userScrollTimer) clearTimeout(this.userScrollTimer);

    if (!track || !track.metadata?.lyrics) {
      this.currentLyricsData = null;
      this.renderEmpty();
      return;
    }

    const parsed = LyricsParser.parse(track.metadata.lyrics);
    this.currentLyricsData = parsed;
    this.renderLyrics();

    const curTime = store.get('currentTime') || 0;
    if (curTime > 0) {
      this.updateTime(curTime);
      this.centerActiveLine(true);
    }
  }

  renderEmpty() {
    const emptyHtml = `
      <div class="lyrics-empty-state">
        <p style="color:var(--text-dim); font-size:0.9rem;">Lirik sinkron (.lrc) tidak ditemukan untuk lagu ini</p>
        <span style="color:var(--text-muted); font-size:0.75rem; margin-top:6px; display:block;">
          Letakkan file .lrc di folder lagu dengan nama yang sama untuk menampilkan lirik otomatis.
        </span>
      </div>
    `;

    if (this.containerFull) this.containerFull.innerHTML = emptyHtml;
    if (this.containerDrawer) this.containerDrawer.innerHTML = emptyHtml;
    if (this.containerFs) this.containerFs.innerHTML = emptyHtml;
    if (this.miniLyricEl) this.miniLyricEl.innerText = '';
    pipManager.setLyricLine('');
  }

  renderLyrics() {
    if (!this.currentLyricsData || this.currentLyricsData.lines.length === 0) {
      this.renderEmpty();
      return;
    }

    const { lines, isSynced } = this.currentLyricsData;

    const buildHtml = (containerType) => {
      const lineElements = lines.map((line, idx) => {
        let wordsHtml = escapeHtml(line.text);
        if (line.words && line.words.length > 0) {
          wordsHtml = line.words.map((w, wIdx) => `
            <span class="lyric-word" data-widx="${wIdx}" data-wtime="${w.time}">${escapeHtml(w.text)}</span>
          `).join(' ');
        }

        return `
          <div class="lyric-line ${!isSynced ? 'unsynced' : ''}" data-idx="${idx}" data-time="${line.time}">
            ${wordsHtml}
          </div>
        `;
      }).join('');

      return `<div class="lyrics-inner-scroll" data-target="${containerType}">${lineElements}</div>`;
    };

    if (this.containerFull) {
      this.containerFull.innerHTML = buildHtml('full');
      this.attachLineClickEvents(this.containerFull);
    }

    if (this.containerDrawer) {
      this.containerDrawer.innerHTML = buildHtml('drawer');
      this.attachLineClickEvents(this.containerDrawer);
    }

    if (this.containerFs) {
      this.containerFs.innerHTML = buildHtml('fs');
      this.attachLineClickEvents(this.containerFs);
    }
  }

  attachLineClickEvents(container) {
    if (!container) return;
    container.querySelectorAll('.lyric-line').forEach(el => {
      el.addEventListener('click', () => {
        const time = parseFloat(el.getAttribute('data-time'));
        if (!isNaN(time) && time >= 0) {
          engine.seek(time);
          this.userScrolling = false;
          if (this.userScrollTimer) clearTimeout(this.userScrollTimer);
          const idx = parseInt(el.getAttribute('data-idx'), 10);
          if (!isNaN(idx)) {
            this.activeLineIndex = idx;
            this.highlightActiveLine(idx);
            this.centerActiveLine(true);
          }
        }
      });
    });
  }

  findActiveIndex(lines, currentTime) {
    if (!lines || lines.length === 0) return -1;
    let low = 0;
    let high = lines.length - 1;
    let result = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lines[mid].time <= currentTime) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }

  updateTime(currentTime) {
    if (!this.currentLyricsData || !this.currentLyricsData.isSynced) return;
    const { lines } = this.currentLyricsData;

    const targetIdx = this.findActiveIndex(lines, currentTime);

    // Active line changed
    if (targetIdx !== this.activeLineIndex && targetIdx !== -1) {
      this.activeLineIndex = targetIdx;
      this.highlightActiveLine(targetIdx);
      if (!this.userScrolling) {
        this.centerActiveLine(false);
      }
    }

    // Update word-level highlighting on active line
    if (targetIdx >= 0 && lines[targetIdx].words) {
      this.updateWordHighlight(targetIdx, currentTime);
    }
  }

  highlightActiveLine(idx) {
    const updateContainer = (container) => {
      if (!container) return;
      const allLines = container.querySelectorAll('.lyric-line');
      allLines.forEach((l, i) => {
        if (i === idx) {
          l.classList.add('active');
        } else {
          l.classList.remove('active');
        }
      });
    };

    updateContainer(this.containerFull);
    updateContainer(this.containerDrawer);
    updateContainer(this.containerFs);

    // Update mini player preview
    if (this.miniLyricEl && this.currentLyricsData.lines[idx]) {
      const lineText = this.currentLyricsData.lines[idx].text || '';
      this.miniLyricEl.innerText = lineText;
      pipManager.setLyricLine(lineText);
    }
  }

  updateWordHighlight(lineIdx, currentTime) {
    const lineData = this.currentLyricsData.lines[lineIdx];
    if (!lineData || !lineData.words) return;

    const updateWordsIn = (container) => {
      if (!container) return;
      const activeLineEl = container.querySelector(`.lyric-line[data-idx="${lineIdx}"]`);
      if (!activeLineEl) return;

      const wordSpans = activeLineEl.querySelectorAll('.lyric-word');
      wordSpans.forEach((wSpan, wIdx) => {
        const wTime = lineData.words[wIdx]?.time || 0;
        if (currentTime >= wTime) {
          wSpan.classList.add('active');
        } else {
          wSpan.classList.remove('active');
        }
      });
    };

    updateWordsIn(this.containerFull);
    updateWordsIn(this.containerDrawer);
    updateWordsIn(this.containerFs);
  }

  centerActiveLine(isImmediate = false) {
    const scrollContainer = (container) => {
      if (!container || container.clientHeight === 0) return;
      const activeLine = container.querySelector(`.lyric-line[data-idx="${this.activeLineIndex}"]`);
      if (!activeLine) return;

      const containerH = container.clientHeight;
      const lineTop = activeLine.offsetTop;
      const lineH = activeLine.clientHeight;

      const targetScrollTop = Math.max(0, lineTop - (containerH / 2) + (lineH / 2));

      this.isProgrammaticScroll = true;
      if (isImmediate) {
        container.scrollTop = targetScrollTop;
      } else {
        container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      }
      setTimeout(() => {
        this.isProgrammaticScroll = false;
      }, 350);
    };

    scrollContainer(this.containerFull);
    scrollContainer(this.containerDrawer);
    scrollContainer(this.containerFs);
  }
}

export const lyricsManager = new LyricsController();
