/**
 * flip.js - First Last Invert Play (FLIP) Animation Engine
 * Animates element positional transitions smoothly using only transform.
 * Perfect for Queue reordering and list drag-and-drop.
 */

export class Flip {
  /**
   * Captures initial bounding rects for a list of elements.
   * @param {NodeList|Array<HTMLElement>} elements
   * @param {string} keyAttr - Attribute to identify element (default: 'data-id')
   * @returns {Map<string, DOMRect>}
   */
  static snapshot(elements, keyAttr = 'data-id') {
    const rects = new Map();
    if (!elements) return rects;

    elements.forEach((el) => {
      const key = el.getAttribute(keyAttr) || el.id;
      if (key) {
        rects.set(key, el.getBoundingClientRect());
      }
    });

    return rects;
  }

  /**
   * Executes DOM mutation and animates elements from previous snapshot to new positions.
   * @param {Map<string, DOMRect>} firstRects
   * @param {NodeList|Array<HTMLElement>} elements
   * @param {Object} options
   */
  static animate(firstRects, elements, options = {}) {
    if (!firstRects || firstRects.size === 0 || !elements) return;

    const duration = options.duration ?? 280;
    const easing = options.easing ?? 'cubic-bezier(0.2, 0, 0, 1)';
    const keyAttr = options.keyAttr ?? 'data-id';

    elements.forEach((el) => {
      const key = el.getAttribute(keyAttr) || el.id;
      if (!key) return;

      const first = firstRects.get(key);
      if (!first) return;

      const last = el.getBoundingClientRect();
      const deltaX = first.left - last.left;
      const deltaY = first.top - last.top;

      // Only animate if position actually shifted
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

      // Invert
      el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      el.style.transition = 'none';

      // Force reflow
      void el.offsetHeight;

      // Play
      el.style.transition = `transform ${duration}ms ${easing}`;
      el.style.transform = '';

      const cleanup = () => {
        el.style.transition = '';
        el.style.transform = '';
        el.removeEventListener('transitionend', cleanup);
      };

      el.addEventListener('transitionend', cleanup, { once: true });
    });
  }

  /**
   * Convenience wrapper: snapshots, runs mutate callback, then plays FLIP.
   */
  static async mutateAndAnimate(elements, mutateFn, options = {}) {
    const keyAttr = options.keyAttr ?? 'data-id';
    const firstRects = Flip.snapshot(elements, keyAttr);

    await mutateFn();

    // Query elements again if DOM nodes were replaced
    const newElements = options.getElements ? options.getElements() : elements;
    Flip.animate(firstRects, newElements, options);
  }
}
