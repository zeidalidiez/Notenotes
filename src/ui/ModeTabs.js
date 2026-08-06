/**
 * ModeTabs — Bottom navigation for switching between Creative, Canvas, and Piano Roll modes.
 */

import { setTabActive } from './InteractionState.js';

export const Modes = {
  CREATIVE: 'creative',
  CANVAS: 'canvas',
  PIANOROLL: 'pianoroll'
};

export class ModeTabs {
  constructor() {
    this.el = null;
    this.activeMode = Modes.PIANOROLL;
    this._onChangeCallbacks = [];
  }

  /**
   * Register a mode change callback.
   * @param {Function} fn - Called with (newMode)
   * @returns {Function} Unsubscribe
   */
  onChange(fn) {
    this._onChangeCallbacks.push(fn);
    return () => {
      const idx = this._onChangeCallbacks.indexOf(fn);
      if (idx !== -1) this._onChangeCallbacks.splice(idx, 1);
    };
  }

  /**
   * Render the mode tabs.
   * @returns {HTMLElement}
   */
  render() {
    this.el = document.createElement('nav');
    this.el.className = 'mode-tabs';
    this.el.id = 'mode-tabs';
    this.el.setAttribute('role', 'tablist');
    this.el.setAttribute('aria-label', 'Workspace modes');

    const tabs = [
      { mode: Modes.CREATIVE, label: 'Create' },
      { mode: Modes.CANVAS, label: 'Canvas' },
      { mode: Modes.PIANOROLL, label: 'Inspect' }
    ];

    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.className = `mode-tabs__tab${tab.mode === this.activeMode ? ' is-active' : ''}`;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('data-mode', tab.mode);
      btn.id = `tab-${tab.mode}`;
      btn.setAttribute('aria-controls', `view-${tab.mode}`);
      setTabActive(btn, tab.mode === this.activeMode);
      btn.innerHTML = `<span class="mode-tabs__label">${tab.label}</span>`;
      btn.addEventListener('click', () => {
        this.setActive(tab.mode);
      });
      btn.addEventListener('keydown', (event) => this._handleTabKeydown(event, tab.mode, tabs));
      this.el.appendChild(btn);
    }

    return this.el;
  }

  /**
   * Set the active mode.
   * @param {string} mode
   */
  setActive(mode) {
    this.activeMode = mode;

    // Update tab styling
    const tabs = this.el.querySelectorAll('.mode-tabs__tab');
    tabs.forEach(tab => {
      const isActive = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', isActive);
      setTabActive(tab, isActive);
    });

    // Notify listeners
    for (const fn of this._onChangeCallbacks) fn(mode);
  }

  _handleTabKeydown(event, currentMode, tabs) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const currentIndex = tabs.findIndex(tab => tab.mode === currentMode);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else nextIndex = (currentIndex + 1) % tabs.length;

    event.preventDefault();
    const nextMode = tabs[nextIndex].mode;
    this.setActive(nextMode);
    this.el.querySelector(`[data-mode="${nextMode}"]`)?.focus?.();
  }
}
