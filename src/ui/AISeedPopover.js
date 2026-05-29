import { AISeedPanel } from './AISeedPanel.js';

export class AISeedPopover {
  constructor({
    controller,
    getProject,
    getActiveInstrumentId,
    getAvailability,
    onSnippetCreated,
    onOpenSettings,
    onSettingsChanged,
  }) {
    this._controller = controller;
    this._getProject = getProject;
    this._getActiveInstrumentId = getActiveInstrumentId;
    this._getAvailability = getAvailability;
    this._onSnippetCreated = onSnippetCreated;
    this._onOpenSettings = onOpenSettings;
    this._onSettingsChanged = onSettingsChanged;
    this._popover = null;
    this._panel = null;
    this._anchorButton = null;
    this._clickOutsideHandler = null;
  }

  toggle(anchor, buttonEl = null) {
    if (buttonEl?.disabled) return;
    if (this._popover) {
      this.close();
      return;
    }
    this.open(anchor, buttonEl);
  }

  open(anchor, buttonEl = null) {
    const popover = document.createElement('div');
    popover.className = 'ai-seed-popover';
    popover.id = 'ai-seed-popover';

    this._panel = new AISeedPanel({
      controller: this._controller,
      getProject: this._getProject,
      getActiveInstrumentId: this._getActiveInstrumentId,
      getAvailability: this._getAvailability,
      onSnippetCreated: this._onSnippetCreated,
      onClose: () => this.close(),
      onOpenSettings: () => {
        this.close();
        this._onOpenSettings?.();
      },
      onSettingsChanged: this._onSettingsChanged,
    });
    popover.appendChild(this._panel.render());

    anchor.appendChild(popover);
    if (buttonEl) buttonEl.setAttribute('aria-expanded', 'true');
    this._popover = popover;
    this._anchorButton = buttonEl;

    const handlePointer = (e) => {
      if (!this._popover) return;
      if (this._popover.contains(e.target)) return;
      if (buttonEl && buttonEl.contains(e.target)) return;
      this.close();
    };
    queueMicrotask(() => {
      document.addEventListener('pointerdown', handlePointer, true);
    });
    this._clickOutsideHandler = handlePointer;
  }

  close() {
    if (this._clickOutsideHandler) {
      document.removeEventListener('pointerdown', this._clickOutsideHandler, true);
      this._clickOutsideHandler = null;
    }
    if (this._panel) {
      this._panel.destroy();
      this._panel = null;
    }
    if (this._popover) {
      this._popover.remove();
      this._popover = null;
    }
    if (this._anchorButton) {
      this._anchorButton.setAttribute('aria-expanded', 'false');
      this._anchorButton = null;
    }
  }

  refresh() {
    this._panel?.refresh?.();
  }
}
