/**
 * playerBar.js - Mini-player bar and expandable audiophile player modal
 * Provides synchronized playback controls, shared-element transitions,
 * gesture pull-to-dismiss, artwork pause scale (0.92x), floating queue drag-and-drop,
 * Audio Stream Inspector (Stats for Nerds), and native Minimalist Fullscreen mode.
 */

import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { engine } from '../../player/engine.js';
import { queueManager } from '../../player/queue.js';
import { sleepTimer } from '../../player/sleepTimer.js';
import { events } from '../../core/events.js';
import { formatDuration, escapeHtml, renderArtistLinks } from '../../core/utils.js';
import { classifyQualityTier } from '../../quality/tiers.js';
import { db } from '../../db/db.js';
import { toast } from './toast.js';
import { contextMenu } from './contextMenu.js';
import { ViewTransitionManager } from '../motion/viewTransition.js';
import { DragGesture } from '../motion/gestures.js';
import { lyricsManager } from '../lyrics.js';
import { settings } from '../../core/settings.js';
import { makeSortable } from '../motion/sortable.js';
import { pipManager } from '../../player/pip.js';
import { dialog } from './dialog.js';
import { shortcutManager } from '../../core/shortcuts.js';
import { getIconSvg } from '../icons.js';
import { t } from '../../core/i18n.js';

class PlayerBarController {
  constructor() {
    this.miniBar = null;
    this.fullPlayer = null;
    this.currentNpTab = 'upNext';
    this.dismissGesture = null;
    this.spectrogramRaf = null;
    this.isSeeking = false;
    this.currentWaveformPeaks = null;
    this.springDisplacement = 0;
    this.springVelocity = 0;
    this.springTargetX = null;
    this.wigglePhase = 0;
    this.wiggleIntensity = 0;
    this.wiggleTargetX = null;
    this.lastScrubX = null;
    this.lastScrubTime = 0;
    this.isHoveringWf = false;
    this.hoverWfX = null;
    this.hoverWfPct = null;
    this.waveformAnimId = null;
    this.customWaveformDrawer = null;
  }

  init() {
    this.miniBar = document.getElementById('miniPlayerBar');
    this.fullPlayer = document.getElementById('fullPlayerModal');

    this.bindEvents();
    this.setupGesture();
    this.setupQueueDragAndDrop();

    store.subscribe('currentTrack', (track) => this.renderTrack(track));
    store.subscribe('isPlaying', (playing) => {
      this.updatePlayIcon(playing);
      this.updateArtworkScale(playing);
      if (playing) this.startWaveformAnimation();
    });
    store.subscribe('currentTime', (time) => this.updateProgress(time));
    store.subscribe('shuffle', (sh) => this.updateShuffleState(sh));
    store.subscribe('repeatMode', (mode) => this.updateRepeatState(mode));
    store.subscribe('queue', () => this.renderNpQueue());
    store.subscribe('queueIndex', () => this.renderNpQueue());
    events.on('queue:updated', () => this.renderNpQueue());
    events.on('engine:trackChanged', () => {
      this.isSeeking = false;
      this.updateProgress(0);
    });
    events.on('engine:dspStateChanged', () => this.updateDspBadges());
    events.on('track:analysisUpdated', ({ trackId, analysis }) => {
      const cur = store.get('currentTrack');
      if (cur && cur.id === trackId) {
        cur.analysis = analysis;
        this.renderWaveform(cur);
      }
    });
    events.on('track:analyzed', ({ trackId, analysis }) => {
      const cur = store.get('currentTrack');
      if (cur && cur.id === trackId) {
        cur.analysis = analysis;
        this.renderWaveform(cur);
      }
    });
    events.on('sleeptimer:fired', () => {
      toast.info(t('sleepTimer.timerFired'));
      this.updateSleepTimerUI();
    });
    events.on('sleeptimer:status', () => {
      this.updateSleepTimerUI();
    });
    events.on('engine:nightModeChanged', (state) => {
      this.updateNightModeUI(state);
    });
    events.on('pip:status', (isOpen) => {
      this.updatePipStatusUI(isOpen);
    });
    events.on('i18n:changed', () => {
      this.updateI18nLabels();
    });

    this.updateNightModeUI();
    this.updatePipCapabilityUI();
    this.updateI18nLabels();
  }

  setupGesture() {
    const topBar = document.querySelector('.np-header-bar') || document.getElementById('fpTopBar') || this.fullPlayer;
    if (!topBar) return;

    this.dismissGesture = new DragGesture(topBar, {
      direction: 'vertical',
      threshold: 110,
      onMove: (delta) => {
        if (delta > 0 && this.fullPlayer && !this.fullPlayer.classList.contains('mode-fullscreen')) {
          this.fullPlayer.style.transform = `translateY(${delta}px)`;
          this.fullPlayer.style.opacity = `${Math.max(0.2, 1 - delta / 360)}`;
        }
      },
      onRelease: () => {
        if (this.fullPlayer) {
          this.fullPlayer.style.transform = 'translateY(0)';
          this.fullPlayer.style.opacity = '1';
        }
      },
      onDismiss: () => {
        this.closeFullPlayer();
      }
    });
  }

  bindEvents() {
    // 1. Play / Pause Toggles
    const togglePlay = (e) => {
      e?.stopPropagation();
      if (store.get('isPlaying')) engine.pause();
      else engine.resume();
    };

    document.getElementById('miniBtnPlay')?.addEventListener('click', togglePlay);
    document.getElementById('mobileBtnPlay')?.addEventListener('click', togglePlay);
    document.getElementById('fpBtnPlay')?.addEventListener('click', togglePlay);
    document.getElementById('fsBtnPlay')?.addEventListener('click', togglePlay);

    // 2. Next & Previous
    const handleNext = (e) => {
      e?.stopPropagation();
      queueManager.next();
    };
    const handlePrev = (e) => {
      e?.stopPropagation();
      queueManager.prev();
    };

    document.getElementById('miniBtnNext')?.addEventListener('click', handleNext);
    document.getElementById('mobileBtnNext')?.addEventListener('click', handleNext);
    document.getElementById('fpBtnNext')?.addEventListener('click', handleNext);
    document.getElementById('fsBtnNext')?.addEventListener('click', handleNext);
    document.getElementById('miniBtnPrev')?.addEventListener('click', handlePrev);
    document.getElementById('fpBtnPrev')?.addEventListener('click', handlePrev);
    document.getElementById('fsBtnPrev')?.addEventListener('click', handlePrev);

    // 3. Open & Close Full Player
    const openHandler = () => this.openFullPlayer();
    document.getElementById('btnExpandPlayer')?.addEventListener('click', openHandler);
    document.getElementById('miniCover')?.addEventListener('click', openHandler);
    document.getElementById('miniPlayerLeft')?.addEventListener('click', (e) => {
      if (e.target.closest('#mobileBtnPlay') || e.target.closest('#mobileBtnNext') || e.target.closest('button')) return;
      openHandler();
    });

    document.getElementById('btnCloseFullPlayer')?.addEventListener('click', (e) => {
      e?.stopPropagation();
      this.closeFullPlayer();
    });

    // 4. Shuffle Toggles
    const toggleShuffle = (e) => {
      e?.stopPropagation();
      const current = !store.get('shuffle');
      store.set('shuffle', current);
      settings.set('shuffle', current);
      toast.info(`${t('player.shuffle')}: ${current ? t('player.active') : t('player.inactive')}`);
    };
    document.getElementById('miniBtnShuffle')?.addEventListener('click', toggleShuffle);
    document.getElementById('fpBtnShuffle')?.addEventListener('click', toggleShuffle);
    document.getElementById('fsBtnShuffle')?.addEventListener('click', toggleShuffle);

    // 5. Repeat Toggles (Cycle: none -> all -> one -> none)
    const cycleRepeat = (e) => {
      e?.stopPropagation();
      const modes = ['none', 'all', 'one'];
      const cur = store.get('repeatMode') || 'none';
      const next = modes[(modes.indexOf(cur) + 1) % modes.length];
      store.set('repeatMode', next);
      settings.set('repeatMode', next);
      const labels = { none: t('player.repeatOff'), all: t('player.repeatAll'), one: t('player.repeatOne') };
      toast.info(`${t('player.repeat')}: ${labels[next] || next}`);
    };
    document.getElementById('miniBtnRepeat')?.addEventListener('click', cycleRepeat);
    document.getElementById('fpBtnRepeat')?.addEventListener('click', cycleRepeat);
    document.getElementById('fsBtnRepeat')?.addEventListener('click', cycleRepeat);

    // 6. Seek Sliders (Synchronized with smooth throttling, deduplication, and wiggle reactivity)
    let pendingSeekTime = null;
    let lastSeekCommit = 0;

    const commitAudioSeek = (targetTime) => {
      const now = Date.now();
      if (now - lastSeekCommit < 80) return;
      lastSeekCommit = now;
      engine.seek(targetTime);
    };

    const handleSeek = (slider, isCommitting = false) => {
      const pct = parseFloat(slider.value);
      slider.style.setProperty('--pct', `${pct}%`);
      const dur = store.get('duration') || 0;
      if (dur > 0) {
        const time = (pct / 100) * dur;
        store.set('currentTime', time);

        // Inject dynamic interactive wiggle on progress bar movement
        const rect = slider.getBoundingClientRect ? slider.getBoundingClientRect() : { width: 480 };
        const scrubPx = (pct / 100) * (rect.width || 480);
        this.triggerWaveformWiggle(scrubPx, isCommitting ? 0.6 : 0.35);

        if (isCommitting) {
          commitAudioSeek(time);
        } else {
          // While dragging: ONLY update visual position, waveform, and pending seek time.
          // Do NOT call engine.seek() on intermediate drag events to eliminate rapid stuttering playback!
          pendingSeekTime = time;
        }
      }
    };

    const playerSeek = document.getElementById('playerSeekSlider');
    const fpSeek = document.getElementById('fpSeekSlider');
    const fsSeek = document.getElementById('fsSeekSlider');
    const allSeekers = [playerSeek, fpSeek, fsSeek].filter(Boolean);

    allSeekers.forEach(slider => {
      const startSeek = () => {
        this.isSeeking = true;
        pendingSeekTime = null;
      };

      slider.addEventListener('pointerdown', startSeek);
      slider.addEventListener('mousedown', startSeek);
      slider.addEventListener('touchstart', startSeek, { passive: true });

      slider.addEventListener('input', () => {
        this.isSeeking = true;
        handleSeek(slider, false);
      });

      const finishSeek = () => {
        if (!this.isSeeking) return;
        this.isSeeking = false;
        const dur = store.get('duration') || 0;
        const time = pendingSeekTime != null ? pendingSeekTime : ((parseFloat(slider.value) / 100) * dur);
        pendingSeekTime = null;
        handleSeek(slider, true);
        try { slider.blur(); } catch {}
      };

      slider.addEventListener('pointerup', finishSeek);
      slider.addEventListener('mouseup', finishSeek);
      slider.addEventListener('touchend', finishSeek);
      slider.addEventListener('change', finishSeek);
    });

    // Waveform Hover Tooltip & Interactive Wiggle Reaction
    const wfContainer = document.getElementById('playerWaveformContainer');
    const wfTooltip = document.getElementById('playerWaveformTooltip');
    if (wfContainer && wfTooltip) {
      wfContainer.addEventListener('mousemove', (e) => {
        const rect = wfContainer.getBoundingClientRect();
        const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const hoverPct = rect.width > 0 ? (offsetX / rect.width) : 0;
        const dur = store.get('duration') || 0;
        const targetSec = hoverPct * dur;

        this.isHoveringWf = true;
        this.hoverWfX = offsetX;
        this.hoverWfPct = hoverPct;

        wfTooltip.style.display = 'block';
        wfTooltip.style.left = `${offsetX}px`;
        wfTooltip.innerText = formatDuration(targetSec);
      });

      wfContainer.addEventListener('mouseleave', () => {
        this.isHoveringWf = false;
        this.hoverWfX = null;
        wfTooltip.style.display = 'none';
      });
    }

    // DSP / Bit-Perfect Pill Interactive Actions
    const handleDspClick = (e) => {
      e?.stopPropagation();
      const dspState = engine.isBitPerfect ? engine.isBitPerfect() : { isBitPerfect: true, details: [] };
      if (dspState.isBitPerfect) {
        toast.info(t('player.bitPerfectNotice'));
      } else {
        toast.info(t('player.dspActiveNotice', { details: dspState.details.join(', ') }));
        router.navigate('settings', { tab: 'audio' });
      }
    };
    ['miniBadgeDsp', 'fpBadgeDsp', 'fsBadgeDsp'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', handleDspClick);
    });

    // 7. Volume Sliders (Synchronized)
    const fsBtnMute = document.getElementById('fsBtnMute');
    let lastNonZeroVolume = settings.get('volume', 1) || 1;

    const updateMuteIcon = (val) => {
      if (fsBtnMute) {
        fsBtnMute.innerHTML = val === 0
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
          : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
        fsBtnMute.title = val === 0 ? t('player.unmute') : t('player.mute');
      }
    };

    const handleVolume = (slider) => {
      const val = parseFloat(slider.value);
      if (val > 0) lastNonZeroVolume = val;
      engine.setVolume(val);
      settings.set('volume', val);
      const pctVal = `${val * 100}%`;
      slider.style.setProperty('--pct', pctVal);
      if (playerVolume && playerVolume !== slider) {
        playerVolume.value = val;
        playerVolume.style.setProperty('--pct', pctVal);
      }
      if (fpVolume && fpVolume !== slider) {
        fpVolume.value = val;
        fpVolume.style.setProperty('--pct', pctVal);
      }
      if (fsVolume && fsVolume !== slider) {
        fsVolume.value = val;
        fsVolume.style.setProperty('--pct', pctVal);
      }
      updateMuteIcon(val);
    };

    const playerVolume = document.getElementById('playerVolumeSlider');
    const fpVolume = document.getElementById('fpVolumeSlider');
    const fsVolume = document.getElementById('fsVolumeSlider');

    // Initialize volume slider values from settings
    const initVol = settings.get('volume', 1);
    const initVolPct = `${initVol * 100}%`;
    [playerVolume, fpVolume, fsVolume].forEach(s => {
      if (s) {
        s.value = initVol;
        s.style.setProperty('--pct', initVolPct);
      }
    });
    updateMuteIcon(initVol);

    playerVolume?.addEventListener('input', () => handleVolume(playerVolume));
    fpVolume?.addEventListener('input', () => handleVolume(fpVolume));
    fsVolume?.addEventListener('input', () => handleVolume(fsVolume));

    fsBtnMute?.addEventListener('click', () => {
      const current = engine.getVolume();
      if (current > 0) {
        lastNonZeroVolume = current;
        handleVolume({ value: 0, style: { setProperty: () => {} } });
      } else {
        handleVolume({ value: lastNonZeroVolume || 0.8, style: { setProperty: () => {} } });
      }
    });

    // 8. Now Playing Mutually Exclusive Right Tabs (Berikutnya vs Lirik)
    const tabUpNext = document.getElementById('btnNpTabUpNext');
    const tabLyrics = document.getElementById('btnNpTabLyrics');
    const paneUpNext = document.getElementById('npPaneUpNext');
    const paneLyrics = document.getElementById('npPaneLyrics');

    const switchNpTab = (tabName) => {
      this.currentNpTab = tabName;
      if (tabName === 'upNext') {
        tabUpNext?.classList.add('active');
        tabLyrics?.classList.remove('active');
        if (paneUpNext) paneUpNext.style.display = 'flex';
        if (paneLyrics) paneLyrics.style.display = 'none';
        this.renderNpQueue();
      } else {
        tabLyrics?.classList.add('active');
        tabUpNext?.classList.remove('active');
        if (paneLyrics) paneLyrics.style.display = 'block';
        if (paneUpNext) paneUpNext.style.display = 'none';
        lyricsManager.onShown?.();
        lyricsManager.centerActiveLine(true);
      }
    };

    tabUpNext?.addEventListener('click', (e) => {
      e.stopPropagation();
      switchNpTab('upNext');
    });

    tabLyrics?.addEventListener('click', (e) => {
      e.stopPropagation();
      switchNpTab('lyrics');
    });

    document.getElementById('fpBtnToggleQueueTab')?.addEventListener('click', (e) => {
      e.stopPropagation();
      switchNpTab('upNext');
      document.getElementById('npPaneUpNext')?.scrollIntoView({ behavior: 'smooth' });
    });

    document.getElementById('fpBtnToggleLyricsTab')?.addEventListener('click', (e) => {
      e.stopPropagation();
      switchNpTab('lyrics');
      document.getElementById('npPaneLyrics')?.scrollIntoView({ behavior: 'smooth' });
    });

    // 9. Cover Hover Action Buttons
    const handleOpenNerdStats = (e) => {
      e?.stopPropagation();
      this.openNerdStats();
    };
    document.getElementById('btnNpAudioInfo')?.addEventListener('click', handleOpenNerdStats);
    document.getElementById('fpBtnInfo')?.addEventListener('click', handleOpenNerdStats);

    document.getElementById('btnNpFullscreen')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.enterFullscreen();
    });

    // 10. Fullscreen Controls
    document.getElementById('btnExitFullscreen')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exitFullscreen();
    });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.fullPlayer?.classList.contains('mode-fullscreen')) {
        this.exitFullscreen(false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.fullPlayer?.classList.contains('mode-fullscreen')) {
          this.exitFullscreen(true);
        } else if (document.getElementById('nerdStatsModal')?.style.display === 'flex') {
          this.closeNerdStats();
        } else if (document.getElementById('sleepTimerModal')?.style.display === 'flex') {
          this.closeSleepTimerModal();
        }
      }
    });

    // 11. Audio Stream Inspector ("Stats for Nerds" Modal)
    document.getElementById('btnCloseNerdStats')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeNerdStats();
    });

    document.getElementById('btnCloseNerdStatsBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeNerdStats();
    });

    document.getElementById('nerdStatsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'nerdStatsModal') {
        this.closeNerdStats();
      }
    });

    document.getElementById('btnCopyNerdStats')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copyNerdStats();
    });

    // 12. Sleep Timer Modal Triggers & Presets
    const handleOpenSleep = (e) => {
      e?.stopPropagation();
      this.openSleepTimerModal();
    };
    document.getElementById('btnMiniSleepTimer')?.addEventListener('click', handleOpenSleep);
    document.getElementById('btnNpSleepTimer')?.addEventListener('click', handleOpenSleep);
    document.getElementById('fpBtnSleep')?.addEventListener('click', handleOpenSleep);
    document.getElementById('fsBtnSleepTimer')?.addEventListener('click', handleOpenSleep);

    document.getElementById('btnCloseSleepTimer')?.addEventListener('click', (e) => {
      e?.stopPropagation();
      this.closeSleepTimerModal();
    });

    document.getElementById('sleepTimerModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'sleepTimerModal') {
        this.closeSleepTimerModal();
      }
    });

    document.querySelectorAll('.btn-sleep-preset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const minAttr = btn.getAttribute('data-minutes');
        if (minAttr === '0') {
          sleepTimer.setTimer('off');
          toast.info(t('sleepTimer.disabledToast'));
        } else if (minAttr === 'end') {
          sleepTimer.setTimer('endOfTrack');
          toast.info(t('sleepTimer.endOfTrackToast'));
        } else {
          const m = parseInt(minAttr, 10);
          if (!isNaN(m) && m > 0) {
            sleepTimer.setTimer(m);
            const slider = document.getElementById('sleepRangeSlider');
            if (slider) slider.value = m;
            const sliderText = document.getElementById('sleepSliderValText');
            if (sliderText) sliderText.innerText = t('sleepTimer.minutesVal', { mins: m });
            toast.info(t('sleepTimer.setToast', { minutes: m }));
          }
        }
        this.updateSleepTimerUI();
      });
    });

    const sleepSlider = document.getElementById('sleepRangeSlider');
    const sleepSliderText = document.getElementById('sleepSliderValText');
    if (sleepSlider && sleepSliderText) {
      sleepSlider.addEventListener('input', () => {
        sleepSliderText.innerText = t('sleepTimer.minutesVal', { mins: sleepSlider.value });
      });
    }

    document.getElementById('btnSleepMinus5')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sleepSlider) {
        sleepSlider.value = Math.max(5, parseInt(sleepSlider.value, 10) - 5);
        if (sleepSliderText) sleepSliderText.innerText = t('sleepTimer.minutesVal', { mins: sleepSlider.value });
      }
    });

    document.getElementById('btnSleepPlus5')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sleepSlider) {
        sleepSlider.value = Math.min(180, parseInt(sleepSlider.value, 10) + 5);
        if (sleepSliderText) sleepSliderText.innerText = t('sleepTimer.minutesVal', { mins: sleepSlider.value });
      }
    });

    document.getElementById('btnSleepApply')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = parseInt(sleepSlider?.value, 10) || 30;
      sleepTimer.setTimer(val);
      toast.info(t('sleepTimer.setToast', { minutes: val }));
      this.updateSleepTimerUI();
    });

    document.getElementById('chkSleepFadeOut')?.addEventListener('change', (e) => {
      sleepTimer.setFadeout(e.target.checked);
    });

    // 13. Queue Actions (Acak Antrean & Kosongkan Antrean)
    document.getElementById('btnNpShuffleQueue')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.shuffleUpcomingQueue();
    });

    document.getElementById('btnNpClearQueue')?.addEventListener('click', (e) => {
      e.stopPropagation();
      queueManager.clear();
      toast.info(t('toasts.queueCleared'));
      this.renderNpQueue();
    });

    // 14. Favorite Toggles
    const handleFavToggle = async (e) => {
      e?.stopPropagation();
      const track = store.get('currentTrack');
      if (!track) return;
      const statsMap = store.get('stats') || new Map();
      const st = statsMap.get(track.id) || { playCount: 0, rating: 0 };
      st.favorite = !st.favorite;
      statsMap.set(track.id, st);
      await db.put('stats', { trackId: track.id, ...st });
      store.set('stats', new Map(statsMap));

      const isFav = st.favorite;
      const btnFav = document.getElementById('fpBtnFav');
      const fsBtnFav = document.getElementById('fsBtnFav');
      if (btnFav) btnFav.style.color = isFav ? 'var(--accent)' : 'inherit';
      if (fsBtnFav) fsBtnFav.style.color = isFav ? 'var(--accent)' : 'inherit';
      toast.info(isFav ? t('toasts.trackLiked') : t('toasts.trackUnliked'));
    };

    document.getElementById('fpBtnFav')?.addEventListener('click', handleFavToggle);
    document.getElementById('fsBtnFav')?.addEventListener('click', handleFavToggle);

    // 15. Night Mode & PiP Actions (UX-02, UX-03)
    const handleNight = (e) => {
      e?.stopPropagation();
      this.handleNightModeToggle();
    };
    document.getElementById('btnToggleNightMode')?.addEventListener('click', handleNight);
    document.getElementById('fsBtnNightMode')?.addEventListener('click', handleNight);

    document.getElementById('btnPlayerPip')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await pipManager.toggle();
    });
  }

  async handleNightModeToggle() {
    const isPure = settings.get('pureMode', true);
    if (isPure) {
      const proceed = await dialog.confirm({
        title: t('player.nightModeRequiresEnhancedTitle'),
        message: t('player.nightModeRequiresEnhancedDesc'),
        confirmText: t('player.switchToEnhanced'),
        cancelText: t('common.cancel')
      });
      if (!proceed) return;

      settings.set('pureMode', false);
      engine.setPureMode(false);
      toast.info(t('player.switchedToEnhanced'));
    }

    const currentNight = settings.get('nightMode') || { enabled: false, intensity: 'mild', maxVolume: 0.70 };
    const nextEnabled = !currentNight.enabled;
    const updated = { ...currentNight, enabled: nextEnabled };
    settings.set('nightMode', updated);
    engine.setNightMode(nextEnabled, updated);
    this.updateNightModeUI({ enabled: nextEnabled });
    toast.info(nextEnabled ? t('player.nightModeEnabled') : t('player.nightModeDisabled'));
  }

  updateNightModeUI(state) {
    const isNight = state?.enabled !== undefined ? !!state.enabled : !!settings.get('nightMode.enabled', false);
    const nightBtns = [
      document.getElementById('btnToggleNightMode'),
      document.getElementById('fsBtnNightMode')
    ];
    nightBtns.forEach(btn => {
      if (btn) {
        btn.classList.toggle('btn-night-active', isNight);
        btn.setAttribute('aria-pressed', isNight ? 'true' : 'false');
        btn.title = isNight ? t('player.nightModeActive') : t('player.nightModeInactive');
      }
    });

    const badge = document.getElementById('miniBadgeNight');
    if (badge) {
      badge.style.display = isNight ? 'inline-block' : 'none';
    }
  }

  updatePipCapabilityUI() {
    const btnPip = document.getElementById('btnPlayerPip');
    if (!btnPip) return;
    const cap = pipManager.getCapability();
    if (!cap) {
      btnPip.style.display = 'none';
    } else {
      btnPip.style.display = 'flex';
      btnPip.title = cap === 'document'
        ? t('player.pipDocument')
        : t('player.pipVideo');
    }
  }

  updatePipStatusUI(isOpen) {
    const btnPip = document.getElementById('btnPlayerPip');
    if (btnPip) {
      btnPip.classList.toggle('btn-pip-active', !!isOpen);
      btnPip.setAttribute('aria-pressed', !!isOpen ? 'true' : 'false');
    }
  }

  async openFullPlayer() {
    router.navigate('nowPlaying');
    this.onNowPlayingActivated();
  }

  async closeFullPlayer() {
    if (this.fullPlayer?.classList.contains('mode-fullscreen') || document.fullscreenElement) {
      this.exitFullscreen(true);
    }
    this.closeNerdStats();
    this.closeSleepTimerModal();
    if (router.getCurrentRoute() === 'nowPlaying') {
      router.back();
    }
  }

  onNowPlayingActivated() {
    const track = store.get('currentTrack');
    if (track) {
      this.renderTrack(track);
    }
    const isPlaying = store.get('isPlaying');
    this.updatePlayIcon(isPlaying);
    this.updateProgress(store.get('currentTime') || 0);

    this.renderNpQueue();
    if (this.currentNpTab === 'lyrics') {
      lyricsManager.onShown?.();
      lyricsManager.centerActiveLine(true);
    }
  }

  enterFullscreen() {
    if (!this.fullPlayer) return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }

    this.fullPlayer.style.display = 'flex';
    this.fullPlayer.classList.add('mode-fullscreen');
    this.fullPlayer.classList.add('active');

    const track = store.get('currentTrack');
    if (track) {
      this.renderTrack(track);
    }
    const isPlaying = store.get('isPlaying');
    this.updatePlayIcon(isPlaying);
    this.updateProgress(store.get('currentTime') || 0);

    lyricsManager.centerActiveLine(true);
  }

  exitFullscreen(requestExitNative = true) {
    if (!this.fullPlayer) return;
    if (requestExitNative && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    this.fullPlayer.classList.remove('mode-fullscreen');
    this.fullPlayer.classList.remove('active');
    this.fullPlayer.style.display = 'none';

    if (this.currentNpTab === 'lyrics') {
      lyricsManager.onShown?.();
      lyricsManager.centerActiveLine(true);
    }
  }

  openSleepTimerModal() {
    const modal = document.getElementById('sleepTimerModal');
    if (!modal) return;
    modal.style.display = 'flex';
    this.updateSleepTimerUI();

    if (this.sleepTimerInterval) clearInterval(this.sleepTimerInterval);
    this.sleepTimerInterval = setInterval(() => {
      this.updateSleepTimerUI();
    }, 1000);
  }

  closeSleepTimerModal() {
    const modal = document.getElementById('sleepTimerModal');
    if (modal) modal.style.display = 'none';
    if (this.sleepTimerInterval) {
      clearInterval(this.sleepTimerInterval);
      this.sleepTimerInterval = null;
    }
  }

  updateSleepTimerUI() {
    const status = sleepTimer.getStatus();
    const statusEl = document.getElementById('sleepTimerStatusText');
    const countdownEl = document.getElementById('sleepCountdownDisplay');
    const progressEl = document.getElementById('sleepDialProgress');
    const btnApply = document.getElementById('btnSleepApply');
    const btnCancel = document.getElementById('btnSleepCancelAction');
    const presets = document.querySelectorAll('.btn-sleep-preset');

    const updateBtns = (active) => {
      const btns = [
        document.getElementById('btnMiniSleepTimer'),
        document.getElementById('btnNpSleepTimer'),
        document.getElementById('fsBtnSleepTimer')
      ];
      btns.forEach(btn => {
        if (btn) btn.style.color = active ? 'var(--accent)' : 'inherit';
      });
    };

    if (!status.active) {
      if (statusEl) statusEl.innerText = t('sleepTimer.dialStatusInactive');
      if (countdownEl) countdownEl.innerText = '--:--';
      if (progressEl) progressEl.style.strokeDashoffset = '515.2';
      if (btnApply) btnApply.style.display = 'block';
      if (btnCancel) btnCancel.style.display = 'none';
      presets.forEach(p => p.classList.remove('active'));
      updateBtns(false);
      return;
    }

    updateBtns(true);
    if (btnApply) btnApply.style.display = 'none';
    if (btnCancel) btnCancel.style.display = 'block';

    if (status.mode === 'endOfTrack') {
      if (statusEl) statusEl.innerText = t('sleepTimer.dialStatusEndOfTrack');
      if (countdownEl) countdownEl.innerText = '1 TRACK';
      if (progressEl) progressEl.style.strokeDashoffset = '0';
      presets.forEach(p => {
        p.classList.toggle('active', p.getAttribute('data-minutes') === 'end');
      });
    } else if (status.remainingSec !== undefined) {
      const mins = Math.floor(status.remainingSec / 60);
      const secs = status.remainingSec % 60;
      const formatted = `${mins}:${secs.toString().padStart(2, '0')}`;
      if (countdownEl) countdownEl.innerText = formatted;
      if (statusEl) statusEl.innerText = status.remainingSec <= 30 ? t('sleepTimer.fadingOut') : t('sleepTimer.stoppingAutomatically');

      if (progressEl && status.initialMinutes) {
        const totalSec = status.initialMinutes * 60;
        const fraction = Math.max(0, Math.min(1, status.remainingSec / totalSec));
        const offset = 515.2 * (1 - fraction);
        progressEl.style.strokeDashoffset = `${offset}`;
      } else if (progressEl) {
        progressEl.style.strokeDashoffset = '0';
      }

      presets.forEach(p => {
        const m = parseInt(p.getAttribute('data-minutes'), 10);
        p.classList.toggle('active', !isNaN(m) && m > 0 && Math.abs(m * 60 - status.remainingSec) < 5);
      });
    }
  }

  renderTrack(track) {
    if (!track) {
      if (this.miniBar) this.miniBar.classList.remove('visible');
      return;
    }

    if (this.miniBar) this.miniBar.classList.add('visible');

    const title = track.overrides?.title || track.metadata?.title || track.name;
    const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown Artist';
    const album = track.overrides?.album || track.metadata?.album || '';
    const tierInfo = classifyQualityTier(track.streamInfo, track.format);

    const artistHtml = renderArtistLinks(artist);
    const albumHtml = album ? ` <span class="meta-dot">&bull;</span> <span class="clickable-album" data-album="${escapeHtml(album)}" data-artist="${escapeHtml(artist)}">${escapeHtml(album)}</span>` : '';
    const combinedArtistAlbum = `${artistHtml}${albumHtml}`;

    // 1. Mini Player Info
    const miniTitle = document.getElementById('miniTitle');
    const miniArtist = document.getElementById('miniArtist');
    if (miniTitle) miniTitle.innerText = title;
    if (miniArtist) miniArtist.innerHTML = combinedArtistAlbum;
    const miniBadge = document.getElementById('miniBadgeTier');
    if (miniBadge) {
      miniBadge.className = `badge ${tierInfo.badgeClass}`;
      if (tierInfo.iconSvg) {
        miniBadge.innerHTML = tierInfo.iconSvg;
      } else {
        miniBadge.innerText = tierInfo.label;
      }
      miniBadge.title = tierInfo.label;
      miniBadge.setAttribute('aria-label', tierInfo.label);
    }

    const miniThumb = document.getElementById('miniCover');
    if (miniThumb) {
      if (track.metadata?.pictureUrl) {
        miniThumb.innerHTML = `<img src="${track.metadata.pictureUrl}" alt="Cover" />`;
        const img = miniThumb.querySelector('img');
        if (img) {
          img.onerror = () => {
            miniThumb.innerHTML = `<svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`;
          };
        }
      } else {
        miniThumb.innerHTML = `<svg class="icon icon-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`;
      }
    }

    // 2. Normal Full Player Info
    const fpTitle = document.getElementById('fpTitle');
    const fpArtist = document.getElementById('fpArtist');
    if (fpTitle) fpTitle.innerText = title;
    if (fpArtist) fpArtist.innerHTML = combinedArtistAlbum;

    const fpBadgeTier = document.getElementById('fpBadgeTier');
    if (fpBadgeTier) {
      fpBadgeTier.className = `badge ${tierInfo.badgeClass}`;
      fpBadgeTier.innerText = tierInfo.details;
    }

    const fpBadgeAuth = document.getElementById('fpBadgeAuth');
    if (fpBadgeAuth) {
      if (track.analysis) {
        fpBadgeAuth.style.display = 'inline-flex';
        if (track.analysis.status === 'verified_hires') {
          fpBadgeAuth.className = 'badge badge-verified';
          fpBadgeAuth.innerText = `[Terverifikasi] ${track.analysis.confidence}%`;
        } else if (track.analysis.status === 'suspected_upsample' || track.analysis.status === 'suspected_transcode') {
          fpBadgeAuth.className = 'badge badge-suspect';
          fpBadgeAuth.innerText = `[Diduga Palsu] ${track.analysis.confidence}%`;
        } else {
          fpBadgeAuth.className = 'badge badge-lossy';
          fpBadgeAuth.innerText = 'Lossy Standar';
        }
      } else {
        fpBadgeAuth.style.display = 'none';
      }
    }

    const fpArt = document.getElementById('fpArtWrapper');
    if (fpArt) {
      if (track.metadata?.pictureUrl) {
        fpArt.innerHTML = `<img src="${track.metadata.pictureUrl}" alt="Cover Artwork" style="width:100%; height:100%; object-fit:cover;" />`;
        const img = fpArt.querySelector('img');
        if (img) {
          img.onerror = () => {
            fpArt.innerHTML = `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`;
          };
        }
      } else {
        fpArt.innerHTML = `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`;
      }
    }

    // 3. Fullscreen Player Info
    const fsTitle = document.getElementById('fsTitle');
    const fsArtist = document.getElementById('fsArtist');
    if (fsTitle) fsTitle.innerText = title;
    if (fsArtist) fsArtist.innerHTML = combinedArtistAlbum;

    const fsBadgeTier = document.getElementById('fsBadgeTier');
    if (fsBadgeTier) {
      fsBadgeTier.className = `badge ${tierInfo.badgeClass}`;
      fsBadgeTier.innerText = tierInfo.details;
    }

    const fsBadgeAuth = document.getElementById('fsBadgeAuth');
    if (fsBadgeAuth) {
      if (track.analysis) {
        fsBadgeAuth.style.display = 'inline-flex';
        if (track.analysis.status === 'verified_hires') {
          fsBadgeAuth.className = 'badge badge-verified';
          fsBadgeAuth.innerText = `[Terverifikasi] ${track.analysis.confidence}%`;
        } else if (track.analysis.status === 'suspected_upsample' || track.analysis.status === 'suspected_transcode') {
          fsBadgeAuth.className = 'badge badge-suspect';
          fsBadgeAuth.innerText = `[Diduga Palsu] ${track.analysis.confidence}%`;
        } else {
          fsBadgeAuth.className = 'badge badge-lossy';
          fsBadgeAuth.innerText = 'Lossy Standar';
        }
      } else {
        fsBadgeAuth.style.display = 'none';
      }
    }

    const fsCoverBox = document.getElementById('fsCoverBox');
    if (fsCoverBox) {
      if (track.metadata?.pictureUrl) {
        fsCoverBox.innerHTML = `<img src="${track.metadata.pictureUrl}" alt="Cover Artwork" />`;
        const img = fsCoverBox.querySelector('img');
        if (img) {
          img.onerror = () => {
            fsCoverBox.innerHTML = `<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`;
          };
        }
      } else {
        fsCoverBox.innerHTML = `<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`;
      }
    }

    // 4. Update Favorite State
    const statsMap = store.get('stats') || new Map();
    const isFav = statsMap.get(track.id)?.favorite || false;
    const btnFav = document.getElementById('fpBtnFav');
    const fsBtnFav = document.getElementById('fsBtnFav');
    if (btnFav) btnFav.style.color = isFav ? 'var(--accent)' : 'inherit';
    if (fsBtnFav) fsBtnFav.style.color = isFav ? 'var(--accent)' : 'inherit';

    // 5. Update Up Next Queue
    this.renderNpQueue();

    // 6. Update Bit-Perfect / DSP Badges
    this.updateDspBadges();

    // 7. Render Audio Waveform Seekbar
    this.renderWaveform(track);
  }

  updateProgress(currentTime) {
    const duration = store.get('duration') || 0;
    const cur = Math.max(0, currentTime || 0);
    const dur = Math.max(0, duration || 0);
    const pct = dur > 0 ? (cur / dur) * 100 : 0;

    // Mini progress bar & seek sliders
    const miniBar = document.getElementById('miniProgressBar');
    if (miniBar) miniBar.style.width = `${pct}%`;

    // Redraw Waveform with current progress (stiff progress update when not spring animating)
    if (!this.waveformAnimId) {
      this.drawWaveformCanvas();
    }

    if (!this.isSeeking) {
      const playerSeek = document.getElementById('playerSeekSlider');
      if (playerSeek) {
        playerSeek.value = pct;
        playerSeek.style.setProperty('--pct', `${pct}%`);
      }

      const fpSeek = document.getElementById('fpSeekSlider');
      if (fpSeek) {
        fpSeek.value = pct;
        fpSeek.style.setProperty('--pct', `${pct}%`);
      }

      const fsSeek = document.getElementById('fsSeekSlider');
      if (fsSeek) {
        fsSeek.value = pct;
        fsSeek.style.setProperty('--pct', `${pct}%`);
      }
    }

    const curTimeFormatted = formatDuration(cur);
    const durFormatted = formatDuration(dur);

    const playerCurEl = document.getElementById('playerCurrentTime');
    const playerDurEl = document.getElementById('playerDuration');
    if (playerCurEl) playerCurEl.innerText = curTimeFormatted;
    if (playerDurEl) playerDurEl.innerText = durFormatted;

    const fpCurEl = document.getElementById('fpCurrentTime');
    const fpDurEl = document.getElementById('fpDuration');
    if (fpCurEl) fpCurEl.innerText = curTimeFormatted;
    if (fpDurEl) fpDurEl.innerText = durFormatted;

    const fsCurEl = document.getElementById('fsCurrentTime');
    const fsDurEl = document.getElementById('fsDuration');
    if (fsCurEl) fsCurEl.innerText = curTimeFormatted;
    if (fsDurEl) fsDurEl.innerText = durFormatted;
  }

  updateDspBadges() {
    const dspState = engine.isBitPerfect ? engine.isBitPerfect() : { isBitPerfect: true, details: [] };
    const isBp = dspState.isBitPerfect;
    const badgeClass = isBp ? 'badge badge-dsp badge-bitperfect' : 'badge badge-dsp badge-dsp-active';
    const label = isBp ? t('player.bitPerfectBadge') : 'DSP Active';
    const title = isBp
      ? t('player.bitPerfectNotice')
      : t('player.dspActiveNotice', { details: dspState.details.join(', ') });

    ['miniBadgeDsp', 'fpBadgeDsp', 'fsBadgeDsp'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.className = badgeClass;
        el.innerText = label;
        el.title = title;
        el.setAttribute('aria-label', title);
      }
    });
  }

  setCustomWaveformDrawer(drawer) {
    this.customWaveformDrawer = drawer;
    this.drawWaveformCanvas();
  }

  triggerWaveformWiggle(targetX, force = 0.5) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let speedBonus = 0;
    let direction = 1;
    if (this.lastScrubX != null && this.lastScrubTime > 0) {
      const dt = Math.max(16, now - this.lastScrubTime);
      const dx = targetX - this.lastScrubX;
      const speed = Math.abs(dx) / dt;
      speedBonus = Math.min(6, speed * 3.5);
      direction = dx >= 0 ? 1 : -1;
    }
    this.lastScrubX = targetX;
    this.lastScrubTime = now;
    this.wiggleTargetX = targetX;
    this.springTargetX = targetX;

    // Physical spring impulse ("seperti pegas")
    // When moved, the line deflects and gains kinetic oscillation energy
    const impulse = (force * 4.5 + speedBonus) * direction;
    this.springVelocity += impulse;
    this.springDisplacement = Math.max(-10, Math.min(10, this.springDisplacement + impulse * 0.35));
    this.wiggleIntensity = Math.min(1.6, Math.abs(this.springDisplacement) / 6 + 0.3);

    if (this.customWaveformDrawer && typeof this.customWaveformDrawer.triggerWiggle === 'function') {
      this.customWaveformDrawer.triggerWiggle(targetX, force, this);
    }

    this.startWaveformAnimation();
  }

  startWaveformAnimation() {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (this.waveformAnimId) return;

    const animate = () => {
      // Harmonic spring oscillator physics:
      // F = -k * x
      // v = (v + F) * damping
      // x = x + v
      const springK = 0.18;    // Tight elastic spring constant
      const springDamp = 0.88; // Damping ratio (settles smoothly within ~0.5s)
      const force = -springK * this.springDisplacement;
      this.springVelocity = (this.springVelocity + force) * springDamp;
      this.springDisplacement += this.springVelocity;
      this.wiggleIntensity = Math.abs(this.springDisplacement) / 10;

      this.drawWaveformCanvas();

      // Only continue animating while the spring has kinetic energy or user is actively dragging
      const hasEnergy = Math.abs(this.springDisplacement) > 0.03 || Math.abs(this.springVelocity) > 0.03;
      if (hasEnergy || this.isSeeking) {
        this.waveformAnimId = requestAnimationFrame(animate);
      } else {
        // Spring has fully settled! Terminate RAF and freeze in stiff resting state
        this.waveformAnimId = null;
        this.springDisplacement = 0;
        this.springVelocity = 0;
        this.wiggleIntensity = 0;
        this.drawWaveformCanvas(); // Final crisp draw at stiff rest
      }
    };

    this.waveformAnimId = requestAnimationFrame(animate);
  }

  renderWaveform(track) {
    const canvas = document.getElementById('playerWaveformCanvas');
    if (!canvas) return;

    let peaks = track?.analysis?.peaks;
    if (!peaks || !Array.isArray(peaks) || peaks.length === 0) {
      // Deterministic synthetic waveform based on track title and duration
      peaks = [];
      const len = 100;
      const seed = ((track?.name || 'track').length + 7) * 13;
      for (let i = 0; i < len; i++) {
        const envelope = Math.sin((i / len) * Math.PI);
        const noise = Math.abs(Math.sin(seed + i * 0.43)) * 0.65 + 0.35;
        peaks.push(Math.round(Math.max(0.15, Math.min(1.0, envelope * noise)) * 1000) / 1000);
      }
    }

    this.currentWaveformPeaks = peaks;
    this.springDisplacement = 0;
    this.springVelocity = 0;
    this.wiggleIntensity = 0;
    this.drawWaveformCanvas();
  }

  drawWaveformCanvas() {
    if (typeof document === 'undefined') return;

    // If a custom waveform drawer is active (via Mod SDK), delegate rendering
    if (this.customWaveformDrawer && typeof this.customWaveformDrawer.draw === 'function') {
      this.customWaveformDrawer.draw(this);
      return;
    }

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

    const peaks = this.currentWaveformPeaks;
    if (!peaks || peaks.length === 0) {
      ctx.restore();
      return;
    }

    const duration = store.get('duration') || 0;
    const currentTime = store.get('currentTime') || 0;
    const progressPct = duration > 0 ? (currentTime / duration) : 0;
    const progressX = progressPct * width;

    const count = peaks.length;
    const barWidth = Math.max(1.8, (width / count) - 1.2);
    const gap = (width - (count * barWidth)) / (count - 1 || 1);

    const isLight = typeof document !== 'undefined' && document.documentElement?.getAttribute('data-theme') === 'light';
    const playedColor = isLight ? '#7c3aed' : '#a855f7';
    const partiallyPlayedColor = isLight ? '#2563eb' : '#38bdf8';
    const unplayedColor = isLight ? 'rgba(15, 23, 42, 0.16)' : 'rgba(255, 255, 255, 0.22)';

    for (let i = 0; i < count; i++) {
      const x = i * (barWidth + gap);
      const amp = Math.max(0.12, Math.min(1.0, Number(peaks[i]) || 0.12));
      const barHeight = Math.max(3, amp * (height - 3));
      const y = (height - barHeight) / 2;

      const isPlayed = (x + barWidth) <= progressX;
      const isPartiallyPlayed = x < progressX && (x + barWidth) > progressX;

      if (isPlayed) {
        ctx.fillStyle = playedColor;
      } else if (isPartiallyPlayed) {
        ctx.fillStyle = partiallyPlayedColor;
      } else {
        ctx.fillStyle = unplayedColor;
      }

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barWidth, barHeight, 1.5);
      } else {
        ctx.rect(x, y, barWidth, barHeight);
      }
      ctx.fill();
    }

    ctx.restore();
  }

  updatePlayIcon(isPlaying) {
    const playSvg = getIconSvg('play_arrow', { size: 24 });
    const pauseSvg = getIconSvg('pause', { size: 24 });
    const fsPlaySvg = getIconSvg('play_arrow', { size: 28 });
    const fsPauseSvg = getIconSvg('pause', { size: 28 });

    const miniIcon = document.getElementById('miniPlayIcon');
    const fpIcon = document.getElementById('fpPlayIcon');
    const mobileIcon = document.getElementById('mobilePlayIcon');
    const fsIcon = document.getElementById('fsPlayIcon');

    if (miniIcon) miniIcon.innerHTML = isPlaying ? pauseSvg : playSvg;
    if (fpIcon) fpIcon.innerHTML = isPlaying ? pauseSvg : playSvg;
    if (mobileIcon) mobileIcon.innerHTML = isPlaying ? pauseSvg : playSvg;
    if (fsIcon) {
      fsIcon.innerHTML = isPlaying ? fsPauseSvg : fsPlaySvg;
      fsIcon.classList.toggle('is-pause', isPlaying);
      fsIcon.classList.toggle('is-play', !isPlaying);
    }
  }

  updateArtworkScale(isPlaying) {
    const fpArt = document.getElementById('fpArtWrapper');
    const fsCover = document.getElementById('fsCoverBox');
    const fsWrapper = document.getElementById('fsCoverWrapper');
    if (isPlaying) {
      if (fpArt) fpArt.classList.remove('paused');
      if (fsCover) fsCover.classList.remove('paused');
      if (fsWrapper) fsWrapper.classList.remove('paused');
    } else {
      if (fpArt) fpArt.classList.add('paused');
      if (fsCover) fsCover.classList.add('paused');
      if (fsWrapper) fsWrapper.classList.add('paused');
    }
  }

  updateShuffleState(isShuffle) {
    const miniBtn = document.getElementById('miniBtnShuffle');
    const fpBtn = document.getElementById('fpBtnShuffle');
    const fsBtn = document.getElementById('fsBtnShuffle');
    if (miniBtn) miniBtn.classList.toggle('active', !!isShuffle);
    if (fpBtn) fpBtn.classList.toggle('active', !!isShuffle);
    if (fsBtn) fsBtn.classList.toggle('active', !!isShuffle);
  }

  updateRepeatState(mode) {
    const miniBtn = document.getElementById('miniBtnRepeat');
    const fpBtn = document.getElementById('fpBtnRepeat');
    const fsBtn = document.getElementById('fsBtnRepeat');
    const isActive = mode !== 'none';
    const isOne = mode === 'one';

    const repeatSvg = getIconSvg('repeat', { size: 20 });
    const repeatOneSvg = getIconSvg('repeat_one', { size: 20 });
    const currentSvg = isOne ? repeatOneSvg : repeatSvg;

    if (miniBtn) {
      miniBtn.classList.toggle('active', isActive);
      miniBtn.title = `Ulang: ${mode.toUpperCase()}`;
      miniBtn.innerHTML = currentSvg;
    }
    if (fpBtn) {
      fpBtn.classList.toggle('active', isActive);
      fpBtn.title = `Ulang: ${mode.toUpperCase()}`;
      fpBtn.innerHTML = currentSvg;
    }
    if (fsBtn) {
      fsBtn.classList.toggle('active', isActive);
      fsBtn.title = `Ulang: ${mode.toUpperCase()}`;
      fsBtn.innerHTML = currentSvg;
    }
  }

  // =========================================================================
  // Up Next Queue & Floating Drag-and-Drop Implementation
  // =========================================================================

  renderNpQueue() {
    const container = document.getElementById('npQueueList');
    if (!container) return;

    const queue = store.get('queue') || [];
    const currentIdx = store.get('queueIndex') ?? -1;

    const summaryEl = document.getElementById('npQueueSummaryText');
    if (summaryEl) {
      summaryEl.innerText = `${queue.length} ${t('queue.itemsInQueue')}`;
    }

    if (queue.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:36px 16px; color:var(--text-dim); font-size:0.85rem;">
          ${t('queue.emptyQueue')}
        </div>
      `;
      return;
    }

    const rowsHtml = queue.map((track, idx) => {
      const isPlayingCurrent = idx === currentIdx;
      const title = track.overrides?.title || track.metadata?.title || track.name;
      const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown Artist';
      const dur = formatDuration(track.duration || 0);
      const tierInfo = classifyQualityTier(track.streamInfo, track.format);

      let thumbHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 16.5C9.51 16.5 7.5 14.49 7.5 12C7.5 9.51 9.51 7.5 12 7.5C14.49 7.5 16.5 9.51 16.5 12C16.5 14.49 14.49 16.5 12 16.5ZM12 11C11.45 11 11 11.45 11 12C11 12.55 11.45 13 12 13C12.55 13 13 12.55 13 12C13 11.45 12.55 11 12 11Z"/></svg>`;
      if (track.metadata?.pictureUrl) {
        thumbHtml = `<img src="${track.metadata.pictureUrl}" alt="Thumb" loading="lazy" />`;
      }

      return `
        <div class="np-queue-row ${isPlayingCurrent ? 'active' : ''}" data-queue-idx="${idx}">
          <span class="np-queue-drag-handle" title="${t('queue.dragToReorder')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/>
              <circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/>
              <circle cx="9" cy="18" r="2"/><circle cx="15" cy="18" r="2"/>
            </svg>
          </span>
          <span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-dim); width:20px; text-align:center; flex-shrink:0;">
            ${idx + 1}
          </span>
          <div class="np-queue-thumb">
            ${thumbHtml}
          </div>
          <div class="np-queue-info">
            <div class="np-queue-title truncate">${escapeHtml(title)}</div>
            <div class="np-queue-artist truncate">
              ${renderArtistLinks(artist)}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
            <span class="badge ${tierInfo.badgeClass}" title="${escapeHtml(tierInfo.label)}" aria-label="${escapeHtml(tierInfo.label)}" style="font-size:0.65rem; padding:2px 6px;">${tierInfo.iconSvg || escapeHtml(tierInfo.label)}</span>
            <span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-dim);">${dur}</span>
            <button class="btn btn-icon btn-sm np-queue-remove-btn" data-remove-idx="${idx}" title="${t('actions.removeFromQueue')}" aria-label="${t('actions.removeFromQueue')}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = rowsHtml;

    // Bind context menu to each queue row
    container.querySelectorAll('.np-queue-row').forEach(rowEl => {
      const qIdx = parseInt(rowEl.getAttribute('data-queue-idx'), 10);
      const trk = queue[qIdx];
      if (trk) {
        contextMenu.bind(rowEl, { track: trk, index: qIdx });
      }
    });

    // Bind click to play on row (excluding handle and remove btn)
    container.querySelectorAll('.np-queue-row').forEach(rowEl => {
      rowEl.addEventListener('click', (e) => {
        if (e.target.closest('.np-queue-remove-btn') || e.target.closest('.np-queue-drag-handle') || e.target.closest('.clickable-artist')) return;
        const qIdx = parseInt(rowEl.getAttribute('data-queue-idx'), 10);
        if (!isNaN(qIdx)) {
          queueManager.playAt(qIdx);
        }
      });
    });

    // Remove item listener
    container.querySelectorAll('.np-queue-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rIdx = parseInt(btn.getAttribute('data-remove-idx'), 10);
        if (!isNaN(rIdx)) {
          queueManager.remove(rIdx);
          this.renderNpQueue();
        }
      });
    });
  }

  setupQueueDragAndDrop() {
    const container = document.getElementById('npQueueList');
    if (!container) return;
    if (this.queueSortable) {
      this.queueSortable.destroy();
    }
    this.queueSortable = makeSortable(container, {
      itemSelector: '.np-queue-row',
      handleSelector: '.np-queue-drag-handle',
      onReorder: (fromIndex, toIndex) => {
        queueManager.reorder(fromIndex, toIndex);
        this.renderNpQueue();
      }
    });
  }

  shuffleUpcomingQueue() {
    const queue = [...(store.get('queue') || [])];
    const curIdx = store.get('queueIndex') ?? -1;
    if (queue.length <= 1) {
      toast.info(t('queue.tooFewToShuffle'));
      return;
    }
    const played = queue.slice(0, curIdx + 1);
    const upcoming = queue.slice(curIdx + 1);
    if (upcoming.length <= 1) {
      toast.info(t('queue.noUpcomingToShuffle'));
      return;
    }
    for (let i = upcoming.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
    }
    store.set('queue', [...played, ...upcoming]);
    toast.info(t('queue.upcomingShuffled'));
    this.renderNpQueue();
  }

  // =========================================================================
  // Audio Stream Inspector ("Stats for Nerds" Modal)
  // =========================================================================

  openNerdStats() {
    const modal = document.getElementById('nerdStatsModal');
    const content = document.getElementById('nerdStatsContent');
    if (!modal || !content) return;

    const track = store.get('currentTrack');
    if (!track) {
      toast.info('Tidak ada lagu yang sedang diputar');
      return;
    }

    const sr = track.streamInfo?.sampleRate || 44100;
    const bits = track.streamInfo?.bitsPerSample || 16;
    const channels = track.streamInfo?.channels || 2;
    const codec = track.streamInfo?.codec || track.format.toUpperCase();
    const bitrate = track.streamInfo?.bitrate ? `${Math.round(track.streamInfo.bitrate / 1000)} kbps` : (['flac', 'wav', 'dsf', 'dff'].includes(track.format) ? 'Lossless VBR' : 'Variabel');
    const devSr = engine.audioCtx ? engine.audioCtx.sampleRate : 48000;
    const isResampling = sr !== devSr;
    const duration = store.get('duration') || 0;
    const curTime = store.get('currentTime') || 0;
    const pureMode = engine.pureMode;

    let authStatus = track.analysis?.status;
    let authLabel = 'Belum Dianalisis';
    let authClass = 'var(--text-dim)';
    if (authStatus === 'verified_hires') {
      authLabel = `Terverifikasi Asli Hi-Res (${track.analysis.confidence}%)`;
      authClass = 'var(--status-verified)';
    } else if (authStatus === 'suspected_upsample' || authStatus === 'suspected_transcode') {
      authLabel = `Diduga Upsampled / Palsu (${track.analysis.confidence}%)`;
      authClass = 'var(--status-suspect)';
    } else if (authStatus) {
      authLabel = 'Lossy Standar';
      authClass = 'var(--text-muted)';
    }

    const cutoffKhz = track.analysis?.spectrumCutoffKhz ? `${track.analysis.spectrumCutoffKhz} kHz` : (sr > 48000 ? `${(sr / 2000).toFixed(1)} kHz (Nyquist Hi-Res)` : '20.0 - 22.0 kHz (Standar CD)');
    const bufferPct = engine.activeAudio?.buffered?.length ? `${Math.min(100, Math.round((engine.activeAudio.buffered.end(engine.activeAudio.buffered.length - 1) / (duration || 1)) * 100))}%` : '100% (Direct Memory Buffer)';
    const fileSize = track.size ? `${(track.size / (1024 * 1024)).toFixed(2)} MB` : 'Berkas Lokal';

    // AUD-02 Metrics formatting
    const lufsVal = track.analysis?.lufs !== undefined ? `${track.analysis.lufs} LUFS` : 'Belum Dianalisis';
    const truePeakVal = track.analysis?.truePeakDbtp !== undefined ? `TP ${track.analysis.truePeakDbtp} dBTP (SP: ${track.analysis.samplePeakDb} dBFS)` : '-';
    let drVal = '-';
    if (track.analysis?.dr !== undefined) {
      drVal = `DR ${track.analysis.dr} (perkiraan)`;
      if (track.analysis.isLowDynamics || track.analysis.dr <= 7) {
        drVal += ' <span style="color:var(--text-dim); font-size:0.75rem; margin-left:6px; font-weight:normal;">[dinamika rendah]</span>';
      }
    }

    const momentary = engine.getMomentaryLoudness();
    let momentaryHtml = '';
    if (momentary.isPure) {
      momentaryHtml = `${track.analysis?.lufs !== undefined ? `${track.analysis.lufs} LUFS` : '-'} <div style="color:var(--text-dim); font-size:0.7rem; margin-top:2px; font-weight:normal; line-height:1.3;">Nilai cache. Mode Pure mematikan DSP Web Audio untuk menjaga integritas bit langsung ke OS. Meter real-time dinonaktifkan untuk mencegah interferensi pemrosesan audio.</div>`;
    } else {
      momentaryHtml = `${momentary.lufs} LUFS <span style="color:var(--status-verified); font-size:0.72rem; margin-left:6px;">(Real-Time)</span>`;
    }

    const rgVal = track.appliedReplayGainDb !== undefined ? `${track.appliedReplayGainDb > 0 ? '+' : ''}${track.appliedReplayGainDb} dB` : (track.metadata?.replayGainTrackGain ? `${track.metadata.replayGainTrackGain} dB (Tag)` : 'Mati / Bypass');

    content.innerHTML = `
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Codec / Format Kontainer</span>
        <span class="nerd-stat-val">${codec} (${track.format.toUpperCase()})</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Kedalaman Bit (Bit Depth)</span>
        <span class="nerd-stat-val">${bits}-bit</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Frekuensi Sampling Sumber</span>
        <span class="nerd-stat-val">${(sr / 1000).toFixed(1)} kHz (${sr} Hz)</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Kanal Audio</span>
        <span class="nerd-stat-val">${channels} Ch (${channels === 2 ? 'Stereo' : 'Mono / Surround'})</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Laju Bit Rata-rata</span>
        <span class="nerd-stat-val">${bitrate}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Loudness Terintegrasi (BS.1770)</span>
        <span class="nerd-stat-val mono">${lufsVal}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">True Peak (4x Oversampling)</span>
        <span class="nerd-stat-val mono">${truePeakVal}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Rentang Dinamika (DR)</span>
        <span class="nerd-stat-val mono">${drVal}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Meter Loudness Sesaat (Momentary)</span>
        <span class="nerd-stat-val mono">${momentaryHtml}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Penyesuaian ReplayGain</span>
        <span class="nerd-stat-val mono">${rgVal}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">FFT Cutoff Frekuensi Spektrum</span>
        <span class="nerd-stat-val">${cutoffKhz}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Verifikasi Keaslian Audio</span>
        <span class="nerd-stat-val" style="color:${authClass};">${authLabel}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Status Resampling OS Mixer</span>
        <span class="nerd-stat-val" style="color:${isResampling ? 'var(--status-suspect)' : 'var(--status-verified)'};">
          ${isResampling ? `Resampling (${sr} Hz -> ${devSr} Hz)` : 'Pure (tanpa DSP) 1:1 Match'}
        </span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">DSP Audio Engine</span>
        <span class="nerd-stat-val">${pureMode ? 'Pure (tanpa DSP)' : 'Enhanced (10-Band EQ & ReplayGain)'}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Hardware Output Sample Rate</span>
        <span class="nerd-stat-val">${(devSr / 1000).toFixed(1)} kHz</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Status Penyangga (Buffer)</span>
        <span class="nerd-stat-val">${bufferPct}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Posisi / Total Durasi</span>
        <span class="nerd-stat-val">${formatDuration(curTime)} / ${formatDuration(duration)}</span>
      </div>
      <div class="nerd-stat-row">
        <span class="nerd-stat-label">Ukuran Berkas</span>
        <span class="nerd-stat-val">${fileSize}</span>
      </div>
    `;

    modal.style.display = 'flex';
  }

  closeNerdStats() {
    const modal = document.getElementById('nerdStatsModal');
    if (modal) modal.style.display = 'none';
  }

  copyNerdStats() {
    const track = store.get('currentTrack');
    if (!track) return;

    const sr = track.streamInfo?.sampleRate || 44100;
    const bits = track.streamInfo?.bitsPerSample || 16;
    const channels = track.streamInfo?.channels || 2;
    const codec = track.streamInfo?.codec || track.format.toUpperCase();
    const bitrate = track.streamInfo?.bitrate ? `${Math.round(track.streamInfo.bitrate / 1000)} kbps` : (['flac', 'wav', 'dsf', 'dff'].includes(track.format) ? 'Lossless VBR' : 'Variabel');
    const devSr = engine.audioCtx ? engine.audioCtx.sampleRate : 48000;
    const isResampling = sr !== devSr;
    const duration = store.get('duration') || 0;
    const curTime = store.get('currentTime') || 0;
    const pureMode = engine.pureMode;
    const title = track.overrides?.title || track.metadata?.title || track.name;
    const artist = track.overrides?.artist || track.metadata?.artist || 'Unknown Artist';

    let authStatus = track.analysis?.status;
    let authLabel = 'Belum Dianalisis';
    if (authStatus === 'verified_hires') {
      authLabel = `Terverifikasi Asli Hi-Res (${track.analysis.confidence}%)`;
    } else if (authStatus === 'suspected_upsample' || authStatus === 'suspected_transcode') {
      authLabel = `Diduga Upsampled / Palsu (${track.analysis.confidence}%)`;
    } else if (authStatus) {
      authLabel = 'Lossy Standar';
    }

    const cutoffKhz = track.analysis?.spectrumCutoffKhz ? `${track.analysis.spectrumCutoffKhz} kHz` : (sr > 48000 ? `${(sr / 2000).toFixed(1)} kHz (Nyquist Hi-Res)` : '20.0 - 22.0 kHz (Standar CD)');
    const bufferPct = engine.activeAudio?.buffered?.length ? `${Math.min(100, Math.round((engine.activeAudio.buffered.end(engine.activeAudio.buffered.length - 1) / (duration || 1)) * 100))}%` : '100% (Direct Memory Buffer)';
    const fileSize = track.size ? `${(track.size / (1024 * 1024)).toFixed(2)} MB` : 'Berkas Lokal';

    const lufsVal = track.analysis?.lufs !== undefined ? `${track.analysis.lufs} LUFS` : 'Belum Dianalisis';
    const truePeakVal = track.analysis?.truePeakDbtp !== undefined ? `TP ${track.analysis.truePeakDbtp} dBTP (SP: ${track.analysis.samplePeakDb} dBFS)` : '-';
    const drVal = track.analysis?.dr !== undefined ? `DR ${track.analysis.dr} (perkiraan)${track.analysis.isLowDynamics || track.analysis.dr <= 7 ? ' [dinamika rendah]' : ''}` : '-';
    const rgVal = track.appliedReplayGainDb !== undefined ? `${track.appliedReplayGainDb > 0 ? '+' : ''}${track.appliedReplayGainDb} dB` : 'Mati';

    const specsText = [
      'AUDIOPHILE STREAM INSPECTOR (STATS FOR NERDS)',
      '============================================',
      `Lagu        : ${title}`,
      `Artis       : ${artist}`,
      `Codec       : ${codec} (${track.format.toUpperCase()})`,
      `Kedalaman   : ${bits}-bit`,
      `Sample Rate : ${(sr / 1000).toFixed(1)} kHz (${sr} Hz)`,
      `Kanal       : ${channels} Ch (${channels === 2 ? 'Stereo' : 'Mono/Multi'})`,
      `Bitrate     : ${bitrate}`,
      `Loudness    : ${lufsVal}`,
      `True Peak   : ${truePeakVal}`,
      `Rentang DR  : ${drVal}`,
      `ReplayGain  : ${rgVal}`,
      `FFT Cutoff  : ${cutoffKhz}`,
      `Keaslian    : ${authLabel}`,
      `Resampling  : ${isResampling ? `Resampling (${sr} Hz -> ${devSr} Hz)` : 'Pure (tanpa DSP) 1:1'}`,
      `DSP Mode    : ${pureMode ? 'Pure (tanpa DSP)' : 'Enhanced Mode'}`,
      `Output HW   : ${(devSr / 1000).toFixed(1)} kHz`,
      `Penyangga   : ${bufferPct}`,
      `Waktu Putar : ${formatDuration(curTime)} / ${formatDuration(duration)}`,
      `Ukuran File : ${fileSize}`
    ].join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(specsText)
        .then(() => toast.info('Statistik audio berhasil disalin ke papan klip'))
        .catch(() => toast.error('Gagal menyalin statistik'));
    }
  }

  // =========================================================================
  // Spectrogram & Signal Path Helpers (Maintained for full system compatibility)
  // =========================================================================

  startSpectrogramLoop() {
    this.stopSpectrogramLoop();
    const canvas = document.getElementById('fpSpectrumCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const render = () => {
      const isPlaying = store.get('isPlaying');
      const track = store.get('currentTrack');
      const modalOpen = this.fullPlayer?.classList.contains('active');

      if (!modalOpen) {
        this.spectrogramRaf = null;
        return;
      }

      const w = (canvas.width = canvas.clientWidth || 400);
      const h = (canvas.height = canvas.clientHeight || 190);

      const isLight = typeof document !== 'undefined' && document.documentElement?.getAttribute('data-theme') === 'light';
      ctx.fillStyle = isLight ? '#f1f5f9' : '#090c12';
      ctx.fillRect(0, 0, w, h);

      if (engine.analyser && isPlaying) {
        const bufferLength = engine.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        engine.analyser.getByteFrequencyData(dataArray);

        const barWidth = (w / bufferLength) * 2.2;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * (h - 12);
          const grad = ctx.createLinearGradient(0, h, 0, h - barHeight);
          grad.addColorStop(0, '#3b82f6');
          grad.addColorStop(1, '#38bdf8');
          ctx.fillStyle = grad;
          ctx.fillRect(x, h - barHeight, Math.max(1, barWidth - 1), barHeight);
          x += barWidth;
        }
      } else if (track?.analysis?.spectrumCurve) {
        this.renderSpectrogram(track);
        return;
      } else {
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h - 4);
        ctx.lineTo(w, h - 4);
        ctx.stroke();
      }

      this.spectrogramRaf = requestAnimationFrame(render);
    };

    this.spectrogramRaf = requestAnimationFrame(render);
  }

  stopSpectrogramLoop() {
    if (this.spectrogramRaf) {
      cancelAnimationFrame(this.spectrogramRaf);
      this.spectrogramRaf = null;
    }
  }

  renderSpectrogram(track) {
    const canvas = document.getElementById('fpSpectrumCanvas');
    if (!canvas || !track) return;

    const ctx = canvas.getContext('2d');
    const w = (canvas.width = canvas.clientWidth || 400);
    const h = (canvas.height = canvas.clientHeight || 190);

    const isLight = typeof document !== 'undefined' && document.documentElement?.getAttribute('data-theme') === 'light';
    ctx.fillStyle = isLight ? '#f1f5f9' : '#090c12';
    ctx.fillRect(0, 0, w, h);

    if (!track.analysis?.spectrumCurve) {
      ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.45)' : 'rgba(255, 255, 255, 0.25)';
      ctx.font = '12px var(--font-mono)';
      ctx.textAlign = 'center';
      ctx.fillText(t('player.noSpectrumAnalysis'), w / 2, h / 2);
      return;
    }

    const curve = track.analysis.spectrumCurve;
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

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(59, 130, 246, 0.35)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  renderSignalPath(track) {
    const container = document.getElementById('fpSignalPathContainer');
    if (!container || !track) return;

    const sr = track.streamInfo?.sampleRate || 44100;
    const bits = track.streamInfo?.bitsPerSample || 16;
    const devSr = engine.audioCtx ? engine.audioCtx.sampleRate : 48000;
    const isResampling = sr !== devSr;

    container.innerHTML = `
      <div class="signal-node">
        <div class="signal-node-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="signal-node-text">
          <h4>${t('player.signalSource')}</h4>
          <p>${track.streamInfo?.codec || track.format.toUpperCase()} • ${bits}-bit / ${(sr / 1000).toFixed(1)} kHz • ${track.streamInfo?.channels || 2} Ch</p>
        </div>
      </div>
      <div class="signal-arrow">↓</div>
      <div class="signal-node">
        <div class="signal-node-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1 2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </div>
        <div class="signal-node-text">
          <h4>${t('player.signalDecoder')}</h4>
          <p>Memory-Safe Object URL Streaming</p>
        </div>
      </div>
      <div class="signal-arrow">↓</div>
      <div class="signal-node">
        <div class="signal-node-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
        </div>
        <div class="signal-node-text">
          <h4>${t('player.signalDsp')}</h4>
          <p title="${t('player.pureTooltip')}">${engine.pureMode ? t('player.pureMode') : t('player.enhancedMode')}</p>
        </div>
      </div>
      <div class="signal-arrow">↓</div>
      <div class="signal-node ${isResampling ? 'alert-node' : ''}">
        <div class="signal-node-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        </div>
        <div class="signal-node-text">
          <h4>${t('player.signalOutput')}</h4>
          <p>Sample Rate Hardware: ${(devSr / 1000).toFixed(1)} kHz</p>
          ${isResampling ? `<p style="color:var(--status-suspect); margin-top:4px;">${t('player.signalResamplingWarn', { sr, devSr })}</p>` : `<p style="color:var(--status-verified); margin-top:4px;">${t('player.signalMatchOk')}</p>`}
        </div>
      </div>
    `;
  }

  updateI18nLabels() {
    const isPlaying = !!store.get('isPlaying');
    const playTitle = isPlaying ? t('player.pause') : t('player.play');
    ['miniBtnPlay', 'mobileBtnPlay', 'fpBtnPlay', 'fsBtnPlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.title = playTitle;
        el.setAttribute('aria-label', t('player.playPauseAria'));
      }
    });

    ['miniBtnNext', 'mobileBtnNext', 'fpBtnNext', 'fsBtnNext'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.title = t('player.next');
        el.setAttribute('aria-label', t('player.nextAria'));
      }
    });

    ['miniBtnPrev', 'fpBtnPrev', 'fsBtnPrev'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.title = t('player.prev');
        el.setAttribute('aria-label', t('player.prevAria'));
      }
    });

    ['miniBtnShuffle', 'fpBtnShuffle', 'fsBtnShuffle'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.title = t('player.shuffle');
        el.setAttribute('aria-label', t('player.shuffleAria'));
      }
    });

    ['miniBtnRepeat', 'fpBtnRepeat', 'fsBtnRepeat'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const mode = store.get('repeatMode') || 'none';
        el.title = `${t('player.repeat')}: ${mode.toUpperCase()}`;
        el.setAttribute('aria-label', t('player.repeatAria'));
      }
    });

    ['btnMiniSleepTimer', 'btnNpSleepTimer', 'fpBtnSleep', 'fsBtnSleepTimer'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.title = t('player.sleepTimer');
        el.setAttribute('aria-label', t('player.sleepTimer'));
      }
    });

    ['btnNpAudioInfo', 'fpBtnInfo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.title = t('player.audioInfo');
        el.setAttribute('aria-label', t('player.audioInfo'));
      }
    });

    const btnNpFs = document.getElementById('btnNpFullscreen');
    if (btnNpFs) {
      btnNpFs.title = t('player.fullscreen');
      btnNpFs.setAttribute('aria-label', t('player.fullscreen'));
    }

    const btnExitFs = document.getElementById('btnExitFullscreen');
    if (btnExitFs) {
      btnExitFs.title = t('player.exitFullscreen');
      btnExitFs.setAttribute('aria-label', t('player.exitFullscreen'));
    }

    const btnCloseFp = document.getElementById('btnCloseFullPlayer');
    if (btnCloseFp) {
      btnCloseFp.title = t('player.close');
      btnCloseFp.setAttribute('aria-label', t('player.close'));
    }

    const btnExpand = document.getElementById('btnExpandPlayer');
    if (btnExpand) {
      btnExpand.title = t('player.expand');
      btnExpand.setAttribute('aria-label', t('player.expand'));
    }

    const fsBtnMute = document.getElementById('fsBtnMute');
    if (fsBtnMute) {
      const val = engine.getVolume ? engine.getVolume() : 1;
      fsBtnMute.title = val === 0 ? t('player.unmute') : t('player.mute');
    }

    const btnNpShuffleQ = document.getElementById('btnNpShuffleQueue');
    if (btnNpShuffleQ) {
      btnNpShuffleQ.title = t('player.shuffleQueue');
      btnNpShuffleQ.setAttribute('aria-label', t('player.shuffleQueue'));
    }

    const btnNpClearQ = document.getElementById('btnNpClearQueue');
    if (btnNpClearQ) {
      btnNpClearQ.title = t('player.clearQueue');
      btnNpClearQ.setAttribute('aria-label', t('player.clearQueue'));
    }

    this.updateDspBadges();
    this.updateNightModeUI();
    this.updatePipCapabilityUI();
    this.updateSleepTimerUI();
    this.renderNpQueue();
  }
}

export const playerBar = new PlayerBarController();
