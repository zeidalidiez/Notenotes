import {
  DEFAULT_DEGREE_COLORS,
  DEFAULT_DEGREE_HIGHLIGHTING,
  degreeForMidi,
  normalizeDegreeHighlighting,
  SCALES,
} from '../engine/MusicTheory.js';
import { DEFAULT_PROGRESSION_GLOW, normalizeProgressionGlow } from '../engine/Progressions.js';
import { DEFAULT_PAD_LAYOUT_TEMPLATE, PAD_LAYOUT_TEMPLATES, normalizePadLayout } from '../engine/PadLayout.js';
import { degreeColorsForPalette, degreePaletteOptions, normalizeDegreePaletteId } from '../engine/DegreePalettes.js';

export function clampCustomPadCount(value) {
  const parsed = parseInt(value, 10);
  const next = Number.isFinite(parsed) ? parsed : 7;
  return Math.max(1, Math.min(16, next));
}

export function clampPianoKeyCount(value) {
  const parsed = parseInt(value, 10);
  const next = Number.isFinite(parsed) ? parsed : 12;
  return Math.max(10, Math.min(32, next));
}

export function normalizePianoCount(value) {
  return parseInt(value, 10) === 2 ? 2 : 1;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value = '') {
  return escapeHtml(value);
}

export class CreateLayoutPopover {
  constructor({
    getProject,
    getScaleBoard,
    getMicroPiano,
    getMusicalContext,
    getScaleIntervals,
    ensureDegreeHighlighting,
    onBeforeOpen,
    onScheduleSave,
    onPadsChanged,
    onPianoChanged,
    onDegreeChanged,
  } = {}) {
    this.getProject = getProject;
    this.getScaleBoard = getScaleBoard;
    this.getMicroPiano = getMicroPiano;
    this.getMusicalContext = getMusicalContext;
    this.getScaleIntervals = getScaleIntervals;
    this.ensureDegreeHighlighting = ensureDegreeHighlighting;
    this.onBeforeOpen = onBeforeOpen;
    this.onScheduleSave = onScheduleSave;
    this.onPadsChanged = onPadsChanged;
    this.onPianoChanged = onPianoChanged;
    this.onDegreeChanged = onDegreeChanged;
    this._padsPopover = null;
    this._padsClickOutsideHandler = null;
    this._keysPopover = null;
    this._keysClickOutsideHandler = null;
    this._padsAnchor = null;
    this._padsButton = null;
    this._keysAnchor = null;
    this._keysButton = null;
  }

  togglePads(anchor, buttonEl) {
    if (this._padsPopover) {
      this.closePads();
      return;
    }
    this.onBeforeOpen?.();
    this.closeKeys();
    this._openPads(anchor, buttonEl);
  }

  toggleKeys(anchor, buttonEl) {
    if (this._keysPopover) {
      this.closeKeys();
      return;
    }
    this.onBeforeOpen?.();
    this.closePads();
    this._openKeys(anchor, buttonEl);
  }

  closePads() {
    if (this._padsClickOutsideHandler) {
      document.removeEventListener('pointerdown', this._padsClickOutsideHandler, true);
      this._padsClickOutsideHandler = null;
    }
    this._padsPopover?.remove();
    this._padsPopover = null;
    this._padsAnchor = null;
    this._padsButton?.setAttribute('aria-expanded', 'false');
    this._padsButton = null;
  }

  closeKeys() {
    if (this._keysClickOutsideHandler) {
      document.removeEventListener('pointerdown', this._keysClickOutsideHandler, true);
      this._keysClickOutsideHandler = null;
    }
    this._keysPopover?.remove();
    this._keysPopover = null;
    this._keysAnchor = null;
    this._keysButton?.setAttribute('aria-expanded', 'false');
    this._keysButton = null;
  }

  closeAll() {
    this.closePads();
    this.closeKeys();
  }

  _openPads(anchor, buttonEl) {
    const project = this.getProject?.();
    const currentLayout = normalizePadLayout(project?.settings?.padLayout, this.getScaleBoard?.()?._notes?.length || 7);
    const popover = document.createElement('div');
    popover.className = 'tone-popover create-control-popover';
    popover.id = 'pads-popover';
    popover.innerHTML = `
      <div class="tone-popover__header">
        <span>Pads</span>
      </div>
      <label class="create-control-popover__row">
        <span>Pad template</span>
        <select class="create-control-popover__select" id="pads-layout-template" aria-label="Pad layout template">
          ${Object.values(PAD_LAYOUT_TEMPLATES).map(template => `
            <option value="${escapeAttr(template.id)}" ${template.id === currentLayout.template ? 'selected' : ''}>${escapeHtml(template.label)}</option>
          `).join('')}
        </select>
      </label>
      <p class="create-control-popover__hint">Templates use relative pad sizes on wider screens and collapse to uniform pads on narrow phones.</p>
      ${this._renderDegreeControls()}
      ${this._renderProgressionGlowControls()}
    `;

    anchor.appendChild(popover);
    buttonEl?.setAttribute('aria-expanded', 'true');
    this._padsPopover = popover;
    this._padsAnchor = anchor;
    this._padsButton = buttonEl;

    popover.querySelector('#pads-layout-template')?.addEventListener('change', (event) => {
      const nextProject = this.getProject?.();
      nextProject.settings ||= {};
      nextProject.settings.padLayout = normalizePadLayout({
        version: 1,
        template: event.target.value || DEFAULT_PAD_LAYOUT_TEMPLATE,
        pads: [],
      }, this.getScaleBoard?.()?._notes?.length || 7);
      this.onScheduleSave?.();
      this.onPadsChanged?.();
    });
    this._bindDegreeControls(popover);
    this._bindProgressionGlowControls(popover);

    const handleOutside = (event) => {
      if (!this._padsPopover) return;
      if (this._padsPopover.contains(event.target)) return;
      if (buttonEl?.contains(event.target)) return;
      this.closePads();
    };
    queueMicrotask(() => document.addEventListener('pointerdown', handleOutside, true));
    this._padsClickOutsideHandler = handleOutside;
  }

  _openKeys(anchor, buttonEl) {
    const project = this.getProject?.();
    const count = project?.settings?.pianoCount || 1;
    const keys = project?.settings?.pianoKeys || 12;
    const popover = document.createElement('div');
    popover.className = 'tone-popover create-control-popover';
    popover.id = 'keys-popover';
    popover.innerHTML = `
      <div class="tone-popover__header">
        <span>Keys</span>
      </div>
      <label class="create-control-popover__row">
        <span>Pianos</span>
        <select class="create-control-popover__select" id="keys-piano-count" aria-label="Number of pianos">
          <option value="1" ${count === 1 ? 'selected' : ''}>1</option>
          <option value="2" ${count === 2 ? 'selected' : ''}>2</option>
        </select>
      </label>
      <label class="create-control-popover__row create-control-popover__row--slider">
        <span>Keys</span>
        <span class="create-control-popover__value" id="keys-count-value">${keys}</span>
        <input class="tone-row__slider" id="keys-count-slider" type="range" min="10" max="32" value="${keys}" aria-label="Piano key count">
      </label>
      ${this._renderDegreeControls()}
      ${this._renderProgressionGlowControls()}
    `;

    anchor.appendChild(popover);
    buttonEl?.setAttribute('aria-expanded', 'true');
    this._keysPopover = popover;
    this._keysAnchor = anchor;
    this._keysButton = buttonEl;

    popover.querySelector('#keys-piano-count')?.addEventListener('change', (event) => {
      const nextProject = this.getProject?.();
      nextProject.settings ||= {};
      nextProject.settings.pianoCount = normalizePianoCount(event.target.value);
      this.onScheduleSave?.();
      this.onPianoChanged?.();
    });
    popover.querySelector('#keys-count-slider')?.addEventListener('input', (event) => {
      const value = clampPianoKeyCount(event.target.value);
      const nextProject = this.getProject?.();
      nextProject.settings ||= {};
      nextProject.settings.pianoKeys = value;
      popover.querySelector('#keys-count-value')?.replaceChildren(String(value));
      this.onScheduleSave?.();
      this.onPianoChanged?.();
    });
    this._bindDegreeControls(popover);
    this._bindProgressionGlowControls(popover);

    const handleOutside = (event) => {
      if (!this._keysPopover) return;
      if (this._keysPopover.contains(event.target)) return;
      if (buttonEl?.contains(event.target)) return;
      this.closeKeys();
    };
    queueMicrotask(() => document.addEventListener('pointerdown', handleOutside, true));
    this._keysClickOutsideHandler = handleOutside;
  }

  _renderDegreeControls() {
    const degree = this.ensureDegreeHighlighting?.() || normalizeDegreeHighlighting();
    const intervals = this.getScaleIntervals?.() || SCALES.major.intervals;
    const context = this.getMusicalContext?.() || { root: 'C', scale: 'major' };
    return `
      <div class="degree-controls" data-degree-controls>
        <div class="degree-controls__head">
          <span>Degree colors</span>
          <button class="btn btn--ghost btn--sm" type="button" data-degree-reset>Reset</button>
        </div>
        <label class="degree-controls__check">
          <input type="checkbox" data-degree-enabled ${degree.enabled ? 'checked' : ''}>
          <span>Highlight scale degrees</span>
        </label>
        <label class="degree-controls__check">
          <input type="checkbox" data-degree-labels ${degree.showLabels ? 'checked' : ''}>
          <span>Show degree labels</span>
        </label>
        <label class="create-control-popover__row create-control-popover__row--slider">
          <span>Color intensity</span>
          <span class="create-control-popover__value" data-degree-intensity-value>${Math.round((degree.intensity ?? 0.22) * 100)}%</span>
          <input class="tone-row__slider" type="range" min="5" max="75" value="${Math.round((degree.intensity ?? 0.22) * 100)}" data-degree-intensity aria-label="Degree color intensity">
        </label>
        <label class="create-control-popover__row degree-controls__palette">
          <span>Palette</span>
          <select data-degree-palette aria-label="Degree color palette">
            ${degreePaletteOptions().map(opt => `<option value="${escapeAttr(opt.value)}" title="${escapeAttr(opt.description)}" ${opt.value === normalizeDegreePaletteId(degree.palette) ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
          </select>
        </label>
        <div class="degree-controls__swatches" aria-label="Degree colors for ${context.root} ${SCALES[context.scale]?.name || 'Major'}">
          ${intervals.map(interval => {
            const meta = degreeForMidi(60 + interval, { root: 'C', scale: 'chromatic' });
            const label = meta?.label || String(interval);
            const name = meta?.name || `Interval ${interval}`;
            const color = degree.colors[interval] || DEFAULT_DEGREE_COLORS[interval];
            return `
              <label class="degree-controls__swatch" title="${escapeAttr(name)}">
                <span>${escapeHtml(label)}</span>
                <input type="color" value="${escapeAttr(color)}" data-degree-color="${interval}" aria-label="${escapeAttr(name)} color">
              </label>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  _bindDegreeControls(popover) {
    if (!popover) return;
    const notify = () => {
      this.onScheduleSave?.();
      this.getScaleBoard?.()?._refreshPads?.();
      this.getMicroPiano?.()?.refreshDegreeHighlights?.();
      this.onDegreeChanged?.();
    };
    popover.querySelector('[data-degree-enabled]')?.addEventListener('change', (event) => {
      const degree = this.ensureDegreeHighlighting?.();
      if (degree) degree.enabled = !!event.target.checked;
      notify();
    });
    popover.querySelector('[data-degree-labels]')?.addEventListener('change', (event) => {
      const degree = this.ensureDegreeHighlighting?.();
      if (degree) degree.showLabels = !!event.target.checked;
      notify();
    });
    popover.querySelector('[data-degree-intensity]')?.addEventListener('input', (event) => {
      const degree = this.ensureDegreeHighlighting?.();
      if (!degree) return;
      degree.intensity = Math.max(0.05, Math.min(0.75, Number(event.target.value) / 100));
      popover.querySelector('[data-degree-intensity-value]')?.replaceChildren(`${Math.round(degree.intensity * 100)}%`);
      notify();
    });
    popover.querySelector('[data-degree-palette]')?.addEventListener('change', (event) => {
      const degree = this.ensureDegreeHighlighting?.();
      if (!degree) return;
      const id = normalizeDegreePaletteId(event.target.value);
      degree.palette = id;
      // Picking a palette sets all degree colors; the swatch pickers still let
      // the user tweak individual colors afterward.
      const colors = degreeColorsForPalette(id);
      degree.colors = colors;
      popover.querySelectorAll('[data-degree-color]').forEach(input => {
        const interval = Number(input.dataset.degreeColor);
        if (colors[interval]) input.value = colors[interval];
      });
      notify();
    });
    popover.querySelectorAll('[data-degree-color]').forEach(input => {
      input.addEventListener('input', (event) => {
        const interval = Number(event.target.dataset.degreeColor);
        const degree = this.ensureDegreeHighlighting?.();
        if (!degree) return;
        degree.colors[interval] = event.target.value;
        notify();
      });
    });
    popover.querySelector('[data-degree-reset]')?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const project = this.getProject?.();
      project.settings ||= {};
      project.settings.degreeHighlighting = normalizeDegreeHighlighting({
        enabled: DEFAULT_DEGREE_HIGHLIGHTING.enabled,
        showLabels: DEFAULT_DEGREE_HIGHLIGHTING.showLabels,
        intensity: DEFAULT_DEGREE_HIGHLIGHTING.intensity,
        colors: { ...DEFAULT_DEGREE_COLORS },
      });
      notify();
      if (popover.id === 'pads-popover') {
        const anchor = this._padsAnchor;
        const button = this._padsButton;
        this.closePads();
        if (anchor) this.togglePads(anchor, button);
      } else {
        const anchor = this._keysAnchor;
        const button = this._keysButton;
        this.closeKeys();
        if (anchor) this.toggleKeys(anchor, button);
      }
    });
  }

  _ensureProgressionGlow() {
    const project = this.getProject?.();
    if (!project) return normalizeProgressionGlow();
    project.settings ||= {};
    project.settings.progressionGlow = normalizeProgressionGlow(project.settings.progressionGlow);
    return project.settings.progressionGlow;
  }

  _renderProgressionGlowControls() {
    const glow = this._ensureProgressionGlow();
    return `
      <div class="degree-controls progression-glow-controls" data-progression-glow-controls>
        <div class="degree-controls__head">
          <span>Chord tone glow</span>
          <button class="btn btn--ghost btn--sm" type="button" data-progression-glow-reset>Reset</button>
        </div>
        <label class="degree-controls__check">
          <input type="checkbox" data-progression-glow-enabled ${glow.enabled ? 'checked' : ''}>
          <span>Show Changes glow</span>
        </label>
        <label class="create-control-popover__row create-control-popover__row--slider">
          <span>Glow intensity</span>
          <span class="create-control-popover__value" data-progression-glow-intensity-value>${Math.round((glow.intensity ?? DEFAULT_PROGRESSION_GLOW.intensity) * 100)}%</span>
          <input class="tone-row__slider" type="range" min="8" max="85" value="${Math.round((glow.intensity ?? DEFAULT_PROGRESSION_GLOW.intensity) * 100)}" data-progression-glow-intensity aria-label="Changes glow intensity">
        </label>
      </div>
    `;
  }

  _bindProgressionGlowControls(popover) {
    if (!popover) return;
    const notify = () => {
      this.onScheduleSave?.();
      this.getScaleBoard?.()?._refreshPads?.();
      this.getMicroPiano?.()?.refreshDegreeHighlights?.();
    };
    popover.querySelector('[data-progression-glow-enabled]')?.addEventListener('change', (event) => {
      const glow = this._ensureProgressionGlow();
      glow.enabled = !!event.target.checked;
      notify();
    });
    popover.querySelector('[data-progression-glow-intensity]')?.addEventListener('input', (event) => {
      const glow = this._ensureProgressionGlow();
      glow.intensity = Math.max(0.08, Math.min(0.85, Number(event.target.value) / 100));
      popover.querySelector('[data-progression-glow-intensity-value]')?.replaceChildren(`${Math.round(glow.intensity * 100)}%`);
      notify();
    });
    popover.querySelector('[data-progression-glow-reset]')?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const project = this.getProject?.();
      project.settings ||= {};
      project.settings.progressionGlow = normalizeProgressionGlow({
        enabled: DEFAULT_PROGRESSION_GLOW.enabled,
        intensity: DEFAULT_PROGRESSION_GLOW.intensity,
      });
      notify();
      if (popover.id === 'pads-popover') {
        const anchor = this._padsAnchor;
        const button = this._padsButton;
        this.closePads();
        if (anchor) this.togglePads(anchor, button);
      } else {
        const anchor = this._keysAnchor;
        const button = this._keysButton;
        this.closeKeys();
        if (anchor) this.toggleKeys(anchor, button);
      }
    });
  }
}
