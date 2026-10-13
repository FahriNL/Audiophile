/**
 * fluidKit.js - Fluid Motion Engine for Audiophile
 * Inspired by Fluid Kit v2:
 * - Damped physical springs generating native CSS linear() curves
 * - Viscous liquid segmented tabs with leading/trailing edge lag
 * - Tactile spring-damped press feedback (.fk-press)
 * - Specular cursor spotlight illumination on glass cards (.fk-light)
 * - Elastic velocity-reactive slider controls
 */

const root = typeof document !== 'undefined' ? document.documentElement : null;
const prefersReduced = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;
const R = prefersReduced ? 0.02 : 1;
const HAS_LINEAR = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('animation-timing-function', 'linear(0,1)');

/**
 * Calculate damped harmonic spring motion curve
 * @param {Object} [config]
 * @param {number} [config.stiffness=170]
 * @param {number} [config.damping=24]
 * @param {number} [config.mass=1]
 * @returns {Object} { at, css, ms, zeta }
 */
export function calculateSpring({ stiffness: k = 170, damping: c = 24, mass: m = 1 } = {}) {
  const w = Math.sqrt(k / m);
  const z = c / (2 * Math.sqrt(k * m));
  const wd = w * Math.sqrt(Math.abs(1 - z * z));
  const x = t => z < 1
    ? 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t))
    : 1 - Math.exp(-w * t) * (1 + w * t);
  const D = Math.min(2.2, Math.max(0.2, 6.9 / (Math.min(z, 1) * w)));
  const at = u => (u <= 0 ? 0 : u >= 1 ? 1 : x(u * D));
  const css = HAS_LINEAR
    ? 'linear(' + Array.from({ length: 49 }, (_, i) => +at(i / 48).toFixed(4)).join(',') + ')'
    : 'cubic-bezier(.2,.85,.15,1)';
  return { at, css, ms: D * 1000 * R, zeta: z };
}

export const SPRINGS = {
  snappy: calculateSpring({ stiffness: 320, damping: 32 }),
  smooth: calculateSpring({ stiffness: 170, damping: 24 }),
  bouncy: calculateSpring({ stiffness: 230, damping: 15 })
};

/**
 * Publish CSS variables for spring curves to :root
 */
export function publishSpringTokens() {
  if (!root) return;
  for (const n in SPRINGS) {
    root.style.setProperty('--fk-' + n, SPRINGS[n].css);
    root.style.setProperty('--fk-' + n + '-t', SPRINGS[n].ms + 'ms');
  }
}

/**
 * Liquid Segmented Control
 * Creates a viscous moving pill behind tab buttons with leading/trailing edge lag.
 * Supports drag with momentum, direct click, and interruptible spring physics.
 * @param {HTMLElement} box - Container with .fk-seg class
 * @param {Object} [options]
 * @param {number} [options.index=0] - Initial active index
 * @param {boolean} [options.drag=true] - Enable drag gesture
 * @param {Object} [options.solver=SPRINGS.smooth] - Spring solver profile
 * @param {Function} [options.onChange] - Callback on tab change
 * @returns {Object} { to, sync }
 */
export function liquid(box, { index = 0, drag = true, solver = SPRINGS.smooth, onChange } = {}) {
  if (!box) return { to: () => {}, sync: () => {} };

  let pill = box.querySelector('.fk-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.className = 'fk-pill';
    box.prepend(pill);
  }

  const buttons = [...box.querySelectorAll('button')];
  if (buttons.length === 0) return { to: () => {}, sync: () => {} };

  let currentIndex = Math.max(0, Math.min(buttons.length - 1, index));
  let activeAnimation = null;
  let gestureState = null;
  let hasMoved = false;

  const getRect = i => {
    const btn = buttons[i];
    if (!btn) return { l: 0, w: 0 };
    return { l: btn.offsetLeft, w: btn.offsetWidth };
  };

  const applyRect = r => {
    pill.style.left = r.l + 'px';
    pill.style.width = r.w + 'px';
  };

  const markButtons = idx => {
    buttons.forEach((b, k) => {
      b.classList.toggle('on', k === idx);
      b.classList.toggle('active', k === idx);
      b.setAttribute('aria-pressed', String(k === idx));
    });
  };

  function to(targetIdx, quiet = false) {
    if (targetIdx < 0 || targetIdx >= buttons.length) return;
    const fromRect = { l: pill.offsetLeft, w: pill.offsetWidth };
    const toRect = getRect(targetIdx);

    if (activeAnimation) {
      activeAnimation.cancel();
      activeAnimation = null;
    }

    markButtons(targetIdx);
    applyRect(toRect);

    if (!quiet && (fromRect.l !== toRect.l || fromRect.w !== toRect.w)) {
      const isForward = toRect.l >= fromRect.l;
      const lag = 0.18;
      const keyframes = [];

      for (let n = 0; n <= 28; n++) {
        const t = n / 28;
        const p = solver.at(t);
        const q = solver.at((t - lag) / (1 - lag));
        const L = fromRect.l + (toRect.l - fromRect.l) * (isForward ? q : p);
        const Rg = fromRect.l + fromRect.w + (toRect.l + toRect.w - fromRect.l - fromRect.w) * (isForward ? p : q);
        keyframes.push({ left: L + 'px', width: Math.max(6, Rg - L) + 'px' });
      }

      activeAnimation = pill.animate(keyframes, {
        duration: solver.ms,
        easing: 'linear'
      });
    }

    if (targetIdx !== currentIndex) {
      currentIndex = targetIdx;
      if (typeof onChange === 'function') {
        onChange(targetIdx, buttons[targetIdx]);
      }
    }
  }

  buttons.forEach((b, i) => {
    b.addEventListener('click', () => {
      if (!hasMoved) to(i);
    });
  });

  if (drag) {
    box.addEventListener('pointerdown', e => {
      hasMoved = false;
      gestureState = {
        x: e.clientX,
        l: pill.offsetLeft,
        px: e.clientX,
        t: e.timeStamp,
        v: 0,
        active: false,
        id: e.pointerId
      };
    });

    box.addEventListener('pointermove', e => {
      if (!gestureState) return;
      const dx = e.clientX - gestureState.x;
      if (!gestureState.active) {
        if (Math.abs(dx) < 8) return;
        gestureState.active = hasMoved = true;
        if (activeAnimation) activeAnimation.cancel();
        box.setPointerCapture(gestureState.id);
      }
      gestureState.v = (e.clientX - gestureState.px) / Math.max(1, e.timeStamp - gestureState.t);
      gestureState.px = e.clientX;
      gestureState.t = e.timeStamp;
      const minLeft = buttons[0].offsetLeft;
      const maxLeft = buttons[buttons.length - 1].offsetLeft;
      pill.style.left = Math.min(maxLeft, Math.max(minLeft, gestureState.l + dx)) + 'px';
    });

    const onPointerUp = () => {
      if (!gestureState) return;
      const s = gestureState;
      gestureState = null;
      if (!s.active) return;
      const center = pill.offsetLeft + pill.offsetWidth / 2 + s.v * 160;
      let bestIndex = 0;
      let minDistance = Infinity;
      buttons.forEach((b, k) => {
        const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - center);
        if (d < minDistance) {
          minDistance = d;
          bestIndex = k;
        }
      });
      to(bestIndex);
      setTimeout(() => { hasMoved = false; }, 0);
    };

    box.addEventListener('pointerup', onPointerUp);
    box.addEventListener('pointercancel', onPointerUp);
  }

  const sync = () => {
    applyRect(getRect(currentIndex));
  };

  markButtons(currentIndex);
  sync();
  window.addEventListener('resize', sync);

  return { to, sync };
}

/**
 * Specular light sheen on cards and panels (.fk-light)
 * @param {string} [selector='.fk-light']
 */
export function enableSpotlight(selector = '.fk-light') {
  if (typeof window === 'undefined') return;

  const findTarget = el => (el && el.closest ? el.closest(selector) : null);

  window.addEventListener('pointermove', e => {
    const target = findTarget(e.target);
    if (target) {
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--fk-x', (e.clientX - rect.left) + 'px');
      target.style.setProperty('--fk-y', (e.clientY - rect.top) + 'px');
    }
  }, { passive: true });

  window.addEventListener('pointerdown', e => {
    const target = findTarget(e.target);
    if (target) target.classList.add('fk-lit');
  }, { passive: true });

  const clearLit = () => {
    document.querySelectorAll('.fk-lit').forEach(el => el.classList.remove('fk-lit'));
  };
  window.addEventListener('pointerup', clearLit, { passive: true });
  window.addEventListener('pointercancel', clearLit, { passive: true });
}

/**
 * Initialize fluid motion engine throughout application
 */
export function initFluidKit() {
  publishSpringTokens();
  enableSpotlight('.fk-light, .glass-panel, .card, .collection-hero-panel');

  if (typeof window !== 'undefined') {
    window.FK = {
      calculateSpring,
      springs: SPRINGS,
      liquid,
      enableSpotlight,
      initFluidKit
    };
  }
}

export const fluidKit = {
  calculateSpring,
  SPRINGS,
  publishSpringTokens,
  liquid,
  enableSpotlight,
  initFluidKit
};
