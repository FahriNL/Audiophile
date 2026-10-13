/**
 * viewTransition.js - View Transitions API Wrapper with Fallbacks
 * Coordinates shared-element transitions (e.g. mini-player cover to full-player cover)
 * with graceful fallback for browsers without document.startViewTransition.
 */

export class ViewTransitionManager {
  /**
   * Runs an update inside a View Transition if supported.
   * @param {Function} updateCallback - Synchronous or asynchronous DOM update
   * @returns {Promise<void>}
   */
  static async transition(updateCallback) {
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      const vt = document.startViewTransition(async () => {
        await updateCallback();
      });
      try {
        await vt.finished;
      } catch {
        // Transition was skipped or aborted
      }
    } else {
      // Fallback: execute update immediately
      await updateCallback();
    }
  }

  /**
   * Temporarily tags an element with a view-transition-name for shared-element animation.
   * @param {HTMLElement} element
   * @param {string} transitionName
   */
  static tagSharedElement(element, transitionName) {
    if (!element) return;
    element.style.viewTransitionName = transitionName;
  }

  /**
   * Clears view-transition-name from element.
   * @param {HTMLElement} element
   */
  static clearSharedElement(element) {
    if (!element) return;
    element.style.viewTransitionName = '';
  }
}
