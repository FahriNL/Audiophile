/**
 * sortable.js - Shared Motion-Driven Drag-and-Drop Reordering Engine
 * Utilizes FLIP animations, spring physics landing, auto-scrolling,
 * touch haptics (300ms long-press), and complete keyboard accessibility.
 * Animates ONLY transform and opacity.
 */

import { Flip } from './flip.js';

export class SortableList {
  /**
   * @param {HTMLElement} container
   * @param {Object} options
   * @param {string} options.itemSelector
   * @param {string} [options.handleSelector]
   * @param {Function} options.onReorder - (fromIndex, toIndex) => void
   * @param {Function} [options.canDrag] - () => boolean
   * @param {HTMLElement} [options.scrollContainer]
   */
  constructor(container, options = {}) {
    this.container = container;
    this.itemSelector = options.itemSelector || '.sortable-item';
    this.handleSelector = options.handleSelector || null;
    this.onReorder = options.onReorder || (() => {});
    this.canDrag = options.canDrag || (() => true);
    this.scrollContainer = options.scrollContainer || container;

    this.isDragging = false;
    this.sourceItem = null;
    this.fromIndex = -1;
    this.currentIndex = -1;
    this.ghost = null;
    this.placeholder = null;

    this.startX = 0;
    this.startY = 0;
    this.offsetY = 0;
    this.holdTimer = null;
    this.autoScrollRaf = null;

    this.keyboardLiftedIndex = -1;
    this.liveRegion = null;

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);

    this.init();
  }

  init() {
    if (!this.container) return;
    this.container.addEventListener('pointerdown', this.boundPointerDown);
    this.container.addEventListener('keydown', this.boundKeyDown);

    // Setup live region for keyboard accessibility
    this.liveRegion = document.createElement('div');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.liveRegion.setAttribute('aria-atomic', 'true');
    this.liveRegion.className = 'sr-only';
    this.liveRegion.style.position = 'absolute';
    this.liveRegion.style.width = '1px';
    this.liveRegion.style.height = '1px';
    this.liveRegion.style.padding = '0';
    this.liveRegion.style.margin = '-1px';
    this.liveRegion.style.overflow = 'hidden';
    this.liveRegion.style.clip = 'rect(0, 0, 0, 0)';
    this.liveRegion.style.border = '0';
    document.body.appendChild(this.liveRegion);
  }

  destroy() {
    if (!this.container) return;
    this.container.removeEventListener('pointerdown', this.boundPointerDown);
    this.container.removeEventListener('keydown', this.boundKeyDown);
    this.cleanupDrag(false);
    if (this.liveRegion) {
      this.liveRegion.remove();
      this.liveRegion = null;
    }
  }

  announce(message) {
    if (this.liveRegion) {
      this.liveRegion.textContent = '';
      setTimeout(() => {
        if (this.liveRegion) this.liveRegion.textContent = message;
      }, 50);
    }
  }

  getItems() {
    return Array.from(this.container.querySelectorAll(this.itemSelector));
  }

  handlePointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (typeof this.canDrag === 'function' && !this.canDrag()) return;

    // Interactive element protection (unless it matches the handle selector)
    const interactive = e.target.closest('button, input, select, textarea, a, .btn-icon, .btn');
    if (interactive && (!this.handleSelector || !interactive.closest(this.handleSelector))) {
      return;
    }

    if (this.handleSelector) {
      const handle = e.target.closest(this.handleSelector);
      if (!handle) return;
    }

    const item = e.target.closest(this.itemSelector);
    if (!item || !this.container.contains(item)) return;

    const items = this.getItems();
    const index = items.indexOf(item);
    if (index === -1) return;

    this.sourceItem = item;
    this.fromIndex = index;
    this.currentIndex = index;
    this.startX = e.clientX;
    this.startY = e.clientY;

    const isTouch = e.pointerType === 'touch';
    const holdDelay = isTouch ? 300 : 150;

    this.holdTimer = setTimeout(() => {
      this.startDrag(e);
      if (isTouch && navigator.vibrate) {
        try { navigator.vibrate(40); } catch (_) {}
      }
    }, holdDelay);

    window.addEventListener('pointermove', this.boundPointerMove, { passive: false });
    window.addEventListener('pointerup', this.boundPointerUp);
    window.addEventListener('pointercancel', this.boundPointerUp);
  }

  startDrag(e) {
    if (this.isDragging || !this.sourceItem) return;
    this.isDragging = true;

    const rect = this.sourceItem.getBoundingClientRect();
    this.offsetY = this.startY - rect.top;

    // Create ghost element
    this.ghost = this.sourceItem.cloneNode(true);
    this.ghost.classList.add('sortable-ghost');
    this.ghost.style.position = 'fixed';
    this.ghost.style.left = `${rect.left}px`;
    this.ghost.style.top = `${rect.top}px`;
    this.ghost.style.width = `${rect.width}px`;
    this.ghost.style.height = `${rect.height}px`;
    this.ghost.style.boxSizing = 'border-box';
    this.ghost.style.pointerEvents = 'none';
    this.ghost.style.zIndex = '99999';
    this.ghost.style.transform = 'scale(1.03)';
    this.ghost.style.opacity = '0.96';
    this.ghost.style.boxShadow = '0 16px 36px rgba(0, 0, 0, 0.65)';
    this.ghost.style.transition = 'transform 100ms cubic-bezier(0.2, 0, 0, 1), opacity 100ms ease';

    document.body.appendChild(this.ghost);

    // Create placeholder
    this.placeholder = document.createElement('div');
    this.placeholder.className = 'sortable-placeholder';
    this.placeholder.style.height = `${rect.height}px`;
    this.placeholder.style.boxSizing = 'border-box';

    this.sourceItem.classList.add('sortable-source');
    this.sourceItem.style.opacity = '0.35';
    this.sourceItem.after(this.placeholder);
  }

  handlePointerMove(e) {
    const distX = Math.abs(e.clientX - this.startX);
    const distY = Math.abs(e.clientY - this.startY);

    if (!this.isDragging) {
      if (e.pointerType === 'touch') {
        // Finger moved > 8px before timer expired: cancel hold to let page scroll
        if (distX > 8 || distY > 8) {
          if (this.holdTimer) {
            clearTimeout(this.holdTimer);
            this.holdTimer = null;
          }
        }
      } else {
        // Mouse moved > 4px: start drag immediately
        if (distX > 4 || distY > 4) {
          if (this.holdTimer) {
            clearTimeout(this.holdTimer);
            this.holdTimer = null;
          }
          this.startDrag(e);
        }
      }
      return;
    }

    e.preventDefault();

    if (!this.ghost || !this.placeholder) return;

    // Update ghost position
    const ghostY = e.clientY - this.offsetY;
    this.ghost.style.top = `${ghostY}px`;

    // Edge auto-scrolling
    this.checkAutoScroll(e.clientY);

    // Identify target index based on item midpoints
    const allItems = this.getItems().filter(item => item !== this.sourceItem);
    let targetIdx = allItems.length;
    let insertBeforeEl = null;

    for (let i = 0; i < allItems.length; i++) {
      const it = allItems[i];
      const b = it.getBoundingClientRect();
      const mid = b.top + b.height / 2;
      if (e.clientY < mid) {
        targetIdx = i;
        insertBeforeEl = it;
        break;
      }
    }

    // Position placeholder and animate shifts via FLIP
    if (insertBeforeEl) {
      if (this.placeholder.nextSibling !== insertBeforeEl) {
        const firstRects = Flip.snapshot(allItems);
        this.container.insertBefore(this.placeholder, insertBeforeEl);
        Flip.animate(firstRects, allItems, { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
        this.currentIndex = targetIdx;
      }
    } else {
      if (this.placeholder.nextSibling !== null) {
        const firstRects = Flip.snapshot(allItems);
        this.container.appendChild(this.placeholder);
        Flip.animate(firstRects, allItems, { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
        this.currentIndex = allItems.length;
      }
    }
  }

  checkAutoScroll(pointerY) {
    const scrollTarget = this.scrollContainer === window ? document.documentElement : this.scrollContainer;
    const bounds = this.scrollContainer === window
      ? { top: 0, bottom: window.innerHeight }
      : this.scrollContainer.getBoundingClientRect();

    const edgeZone = 60;
    const maxSpeed = 14;

    if (this.autoScrollRaf) {
      cancelAnimationFrame(this.autoScrollRaf);
      this.autoScrollRaf = null;
    }

    if (pointerY < bounds.top + edgeZone) {
      const intensity = 1 - Math.max(0, pointerY - bounds.top) / edgeZone;
      const step = -Math.round(intensity * maxSpeed);
      const scrollLoop = () => {
        if (!this.isDragging) return;
        scrollTarget.scrollTop += step;
        this.autoScrollRaf = requestAnimationFrame(scrollLoop);
      };
      this.autoScrollRaf = requestAnimationFrame(scrollLoop);
    } else if (pointerY > bounds.bottom - edgeZone) {
      const intensity = 1 - Math.max(0, bounds.bottom - pointerY) / edgeZone;
      const step = Math.round(intensity * maxSpeed);
      const scrollLoop = () => {
        if (!this.isDragging) return;
        scrollTarget.scrollTop += step;
        this.autoScrollRaf = requestAnimationFrame(scrollLoop);
      };
      this.autoScrollRaf = requestAnimationFrame(scrollLoop);
    }
  }

  handlePointerUp() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    window.removeEventListener('pointermove', this.boundPointerMove);
    window.removeEventListener('pointerup', this.boundPointerUp);
    window.removeEventListener('pointercancel', this.boundPointerUp);

    if (this.autoScrollRaf) {
      cancelAnimationFrame(this.autoScrollRaf);
      this.autoScrollRaf = null;
    }

    if (!this.isDragging) {
      this.cleanupDrag(false);
      return;
    }

    // Spring landing animation onto placeholder
    if (this.ghost && this.placeholder) {
      const pRect = this.placeholder.getBoundingClientRect();
      this.ghost.style.transition = 'all 240ms cubic-bezier(0.175, 0.885, 0.32, 1.15)';
      this.ghost.style.top = `${pRect.top}px`;
      this.ghost.style.left = `${pRect.left}px`;
      this.ghost.style.transform = 'scale(1)';
      this.ghost.style.opacity = '1';

      setTimeout(() => {
        const from = this.fromIndex;
        const to = this.currentIndex;
        this.cleanupDrag(true);
        if (from !== -1 && to !== -1 && from !== to) {
          this.onReorder(from, to);
        }
      }, 240);
    } else {
      this.cleanupDrag(false);
    }
  }

  cancelDrag() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.autoScrollRaf) {
      cancelAnimationFrame(this.autoScrollRaf);
      this.autoScrollRaf = null;
    }
    window.removeEventListener('pointermove', this.boundPointerMove);
    window.removeEventListener('pointerup', this.boundPointerUp);
    window.removeEventListener('pointercancel', this.boundPointerUp);

    this.cleanupDrag(false);
    this.announce('Pemindahan dibatalkan.');
  }

  cleanupDrag(didComplete) {
    this.isDragging = false;
    if (this.ghost) {
      this.ghost.remove();
      this.ghost = null;
    }
    if (this.placeholder) {
      this.placeholder.remove();
      this.placeholder = null;
    }
    if (this.sourceItem) {
      this.sourceItem.classList.remove('sortable-source');
      this.sourceItem.style.opacity = '';
      this.sourceItem = null;
    }
    this.fromIndex = -1;
    this.currentIndex = -1;
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.isDragging) {
        this.cancelDrag();
      } else if (this.keyboardLiftedIndex !== -1) {
        this.cancelKeyboardReorder();
      }
      return;
    }

    // Keyboard Accessibility: Space to lift / drop, Arrow keys to move
    const item = e.target.closest(this.itemSelector);
    if (!item || !this.container.contains(item)) return;

    const items = this.getItems();
    const idx = items.indexOf(item);
    if (idx === -1) return;

    if (e.key === ' ' || e.key === 'Enter') {
      if (e.target.closest('button, input, a') && !e.target.classList.contains('sortable-handle')) {
        return;
      }
      e.preventDefault();

      if (this.keyboardLiftedIndex === -1) {
        // Lift
        this.keyboardLiftedIndex = idx;
        item.classList.add('sortable-lifted');
        item.setAttribute('aria-grabbed', 'true');
        this.announce(`Lagu posisi ${idx + 1} diangkat. Gunakan panah atas atau bawah untuk memindah, Spasi untuk meletakkan.`);
      } else if (this.keyboardLiftedIndex === idx) {
        // Drop
        item.classList.remove('sortable-lifted');
        item.removeAttribute('aria-grabbed');
        this.keyboardLiftedIndex = -1;
        this.announce(`Lagu diletakkan di posisi ${idx + 1}.`);
      }
    } else if (this.keyboardLiftedIndex !== -1) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.keyboardLiftedIndex > 0) {
          const from = this.keyboardLiftedIndex;
          const to = from - 1;
          const firstRects = Flip.snapshot(items);
          this.container.insertBefore(items[from], items[to]);
          const newItems = this.getItems();
          Flip.animate(firstRects, newItems, { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
          this.keyboardLiftedIndex = to;
          newItems[to].focus();
          this.announce(`Dipindahkan ke posisi ${to + 1} dari ${newItems.length}.`);
          this.onReorder(from, to);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.keyboardLiftedIndex < items.length - 1) {
          const from = this.keyboardLiftedIndex;
          const to = from + 1;
          const firstRects = Flip.snapshot(items);
          this.container.insertBefore(items[from], items[to].nextSibling);
          const newItems = this.getItems();
          Flip.animate(firstRects, newItems, { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
          this.keyboardLiftedIndex = to;
          newItems[to].focus();
          this.announce(`Dipindahkan ke posisi ${to + 1} dari ${newItems.length}.`);
          this.onReorder(from, to);
        }
      }
    }
  }

  cancelKeyboardReorder() {
    if (this.keyboardLiftedIndex === -1) return;
    const items = this.getItems();
    const item = items[this.keyboardLiftedIndex];
    if (item) {
      item.classList.remove('sortable-lifted');
      item.removeAttribute('aria-grabbed');
    }
    this.keyboardLiftedIndex = -1;
    this.announce('Pemindahan keyboard dibatalkan.');
  }
}

/**
 * Factory helper for initializing sortable lists
 */
export function makeSortable(container, options = {}) {
  return new SortableList(container, options);
}
