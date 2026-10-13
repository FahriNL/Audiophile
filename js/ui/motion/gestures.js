/**
 * gestures.js - Touch and Pointer Gesture Engine
 * Handles sheet dragging, swipe-to-dismiss, rubber-banding, and velocity tracking.
 * Safe for child interactive elements (buttons, inputs, tabs, sliders).
 */

import { Spring } from './spring.js';

export class DragGesture {
  constructor(element, options = {}) {
    this.element = element;
    this.direction = options.direction || 'vertical'; // 'vertical' | 'horizontal'
    this.threshold = options.threshold || 120; // Distance to trigger dismiss/action
    this.slopThreshold = options.slopThreshold || 10; // Minimum movement to recognize drag (px)
    this.rubberBandFactor = options.rubberBandFactor || 0.35;
    this.maxOvershoot = options.maxOvershoot || 80;

    this.onMove = options.onMove || null;
    this.onRelease = options.onRelease || null;
    this.onDismiss = options.onDismiss || null;

    this.startY = 0;
    this.startX = 0;
    this.currentDelta = 0;
    this.lastTime = 0;
    this.lastPosition = 0;
    this.velocity = 0;
    this.isDragging = false;
    this.activePointerId = null;

    this.spring = new Spring({
      stiffness: 220,
      damping: 26,
      onUpdate: (v) => {
        if (this.onMove) this.onMove(v);
      },
      onRest: () => {
        if (this.onRelease) this.onRelease();
      }
    });

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);

    this.init();
  }

  init() {
    if (!this.element) return;
    this.element.addEventListener('pointerdown', this.boundPointerDown);
  }

  destroy() {
    if (!this.element) return;
    this.element.removeEventListener('pointerdown', this.boundPointerDown);
    window.removeEventListener('pointermove', this.boundPointerMove);
    window.removeEventListener('pointerup', this.boundPointerUp);
    window.removeEventListener('pointercancel', this.boundPointerUp);
    this.spring.stop();
  }

  handlePointerDown(e) {
    // Only primary mouse button or touch/pen
    if (e.button !== 0) return;

    // Never intercept clicks on buttons, inputs, tabs, sliders, links, or controls
    const isInteractive = e.target.closest(
      'button, input, textarea, select, a, .btn, .fp-tab-btn, .drawer-tab-btn, [role="button"], input[type="range"]'
    );
    if (isInteractive) {
      return;
    }

    this.activePointerId = e.pointerId;
    this.isDragging = false;
    this.currentDelta = 0;
    this.startY = e.clientY;
    this.startX = e.clientX;
    this.lastPosition = this.direction === 'vertical' ? e.clientY : e.clientX;
    this.lastTime = performance.now();
    this.velocity = 0;

    window.addEventListener('pointermove', this.boundPointerMove, { passive: true });
    window.addEventListener('pointerup', this.boundPointerUp);
    window.addEventListener('pointercancel', this.boundPointerUp);
  }

  handlePointerMove(e) {
    if (e.pointerId !== this.activePointerId) return;

    const rawDelta = this.direction === 'vertical' ? e.clientY - this.startY : e.clientX - this.startX;

    // Check slop threshold before capturing pointer or starting drag
    if (!this.isDragging) {
      if (Math.abs(rawDelta) > this.slopThreshold) {
        this.isDragging = true;
        this.spring.stop();
        try {
          this.element.setPointerCapture(e.pointerId);
        } catch {
          // Fallback if pointer capture unavailable
        }
      } else {
        return;
      }
    }

    const now = performance.now();
    const dt = Math.max((now - this.lastTime) / 1000, 0.001);
    const pos = this.direction === 'vertical' ? e.clientY : e.clientX;

    // Calculate instantaneous velocity (px/sec)
    this.velocity = (pos - this.lastPosition) / dt;
    this.lastPosition = pos;
    this.lastTime = now;

    // Apply rubber-band resistance when dragging upwards or past bounds
    let adjustedDelta = rawDelta;
    if (rawDelta < 0) {
      const absD = Math.abs(rawDelta);
      const dampened = (absD * this.rubberBandFactor) / (1 + (absD * this.rubberBandFactor) / this.maxOvershoot);
      adjustedDelta = -dampened;
    }

    this.currentDelta = adjustedDelta;
    if (this.onMove) {
      this.onMove(this.currentDelta);
    }
  }

  handlePointerUp(e) {
    if (e.pointerId !== this.activePointerId) return;
    this.activePointerId = null;

    window.removeEventListener('pointermove', this.boundPointerMove);
    window.removeEventListener('pointerup', this.boundPointerUp);
    window.removeEventListener('pointercancel', this.boundPointerUp);

    if (!this.isDragging) {
      // Natural tap/click occurred without movement: do not alter DOM
      return;
    }

    this.isDragging = false;

    try {
      this.element.releasePointerCapture(e.pointerId);
    } catch {
      // Already released
    }

    // Determine if dismissal threshold or velocity reached
    const shouldDismiss = this.currentDelta > this.threshold || this.velocity > 650;

    if (shouldDismiss && this.onDismiss) {
      this.onDismiss(this.velocity);
    } else {
      // Snap back to 0 using spring with current velocity carry-over
      this.spring.snapTo(this.currentDelta);
      this.spring.setTarget(0, this.velocity);
    }
  }
}
