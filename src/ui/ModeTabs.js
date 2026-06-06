/**
 * ModeTabs — Bottom navigation for switching between Creative, Canvas, and Piano Roll modes.
 */

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

    const tabs = [
      { mode: Modes.CREATIVE, icon: '🎹', label: 'Create' },
      { mode: Modes.CANVAS, icon: '🎼', label: 'Canvas' },
      { mode: Modes.PIANOROLL, icon: '✏️', label: 'Inspect' }
    ];

    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.className = `mode-tabs__tab${tab.mode === this.activeMode ? ' is-active' : ''}`;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', tab.mode === this.activeMode);
      btn.setAttribute('data-mode', tab.mode);
      btn.id = `tab-${tab.mode}`;
      btn.innerHTML = `
        <span class="mode-tabs__icon">${tab.icon}</span>
        <span>${tab.label}</span>
      `;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.setActive(tab.mode);
      });
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
      tab.setAttribute('aria-selected', isActive);
    });

    // Notify listeners
    for (const fn of this._onChangeCallbacks) fn(mode);
  }
}
