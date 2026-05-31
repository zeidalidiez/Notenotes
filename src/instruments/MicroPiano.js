/**
 * MicroPiano — Chromatic piano keyboard.
 * Supports 1 or 2 stacked keyboards with configurable key count via Settings.
 */

import { correctMidiToScale, degreeForMidi, normalizeDegreeHighlighting, normalizeMusicalContext } from '../engine/MusicTheory.js';
import { activeProgressionResolution, normalizeProgressionGlow } from '../engine/Progressions.js';
import { dwellSettings, tremorAllows } from '../ui/AccessibilityProfiles.js';

export class MicroPiano {
  constructor(synth, project) {
    this.synth = synth;
    this._project = project;
    this.el = null;
    this._baseOctave = 4;
    this._activeKeys = new Set();
    this._activeInputMap = new Map();
    this._activeKeyCounts = new Map();
    this._dwellTimers = new Map();
    this._dwellActiveKeys = new Set();

    this._onNoteOn = null;
    this._onNoteOff = null;
    this._onBeforeNoteOn = null;
    this._onControllerLearnTarget = null;

    window.addEventListener('settings-piano-changed', () => {
      if (this.el) this._refreshAll();
    });
    window.addEventListener('project-progression-changed', () => {
      if (this.el) this._refreshAll();
    });
  }

  set project(p) {
    this._project = p;
    if (this.el) this._refreshAll();
  }
  get project() { return this._project; }

  get _pianoCount() {
    return this.project?.settings?.pianoCount || 1;
  }

  get _pianoKeys() {
    return this.project?.settings?.pianoKeys || 12;
  }

  _baseMidi(offset) {
    return (this._baseOctave + 1) * 12 + offset;
  }

  _pianoLabel(index) {
    const startMidi = this._baseMidi(index * this._pianoKeys);
    const endMidi = startMidi + this._pianoKeys - 1;
    const startOct = Math.floor(startMidi / 12) - 1;
    const endOct = Math.floor(endMidi / 12) - 1;
    if (startOct === endOct) return `Oct ${startOct}`;
    return `Oct ${startOct}–${endOct}`;
  }

  _octaveDisplay() {
    if (this._pianoCount === 1) return this._pianoLabel(0);
    return `A: ${this._pianoLabel(0)} · B: ${this._pianoLabel(1)}`;
  }

  setNoteCallbacks(onNoteOn, onNoteOff) {
    this._onNoteOn = onNoteOn;
    this._onNoteOff = onNoteOff;
  }

  setBeforeNoteCallback(fn) {
    this._onBeforeNoteOn = fn;
  }

  setControllerLearnCallback(fn) {
    this._onControllerLearnTarget = fn;
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'micropiano';
    this.el.id = 'micropiano';

    this.el.innerHTML = `
      <div class="micropiano__controls">
        <button class="btn btn--icon btn--ghost" id="mp-oct-down" aria-label="Octave down">▼</button>
        <span class="micropiano__oct-display" id="mp-oct-display">${this._octaveDisplay()}</span>
        <button class="btn btn--icon btn--ghost" id="mp-oct-up" aria-label="Octave up">▲</button>
      </div>
      <div class="micropiano__boards" id="mp-boards">
        ${this._renderAllKeyboards()}
      </div>
    `;

    this._bindEvents();

    return this.el;
  }

  _renderAllKeyboards() {
    let html = '';
    for (let i = 0; i < this._pianoCount; i++) {
      html += `<div class="micropiano__keyboard" id="mp-keyboard-${i}">
        ${this._renderKeys(i)}
      </div>`;
    }
    return html;
  }

  _renderKeys(boardIndex) {
    const startMidi = this._baseMidi(boardIndex * this._pianoKeys);
    const keyPattern = [
      { white: true,  name: 'C' },
      { white: false, name: 'C#' },
      { white: true,  name: 'D' },
      { white: false, name: 'D#' },
      { white: true,  name: 'E' },
      { white: true,  name: 'F' },
      { white: false, name: 'F#' },
      { white: true,  name: 'G' },
      { white: false, name: 'G#' },
      { white: true,  name: 'A' },
      { white: false, name: 'A#' },
      { white: true,  name: 'B' },
    ];

    let html = '';
    for (let k = 0; k < this._pianoKeys; k++) {
      const midi = startMidi + k;
      const key = keyPattern[midi % 12];
      const cls = key.white ? 'micropiano__key--white' : 'micropiano__key--black';
      const oct = Math.floor(midi / 12) - 1;
      const label = (key.name === 'C' && this._pianoKeys > 12)
        ? `C${oct}`
        : key.name;
      const degreeMeta = this._degreeMetaForMidi(midi);
      const progressionMeta = this._progressionMetaForMidi(midi, degreeMeta);
      const degreeClass = degreeMeta
        ? `${degreeMeta.colorEnabled ? ' micropiano__key--degree-color' : ''}${degreeMeta.label ? ' micropiano__key--degree-label' : ''}`
        : '';
      const progressionClass = progressionMeta ? ' micropiano__key--progression-hot' : '';
      const styleVars = [];
      if (degreeMeta) {
        styleVars.push(`--degree-color: ${this._escapeAttr(degreeMeta.color)}`);
        styleVars.push(`--degree-intensity: ${this._escapeAttr(degreeMeta.intensityPercent)}`);
      }
      if (progressionMeta) {
        styleVars.push(`--progression-color: ${this._escapeAttr(progressionMeta.color)}`);
        styleVars.push(`--progression-intensity: ${this._escapeAttr(progressionMeta.intensityPercent)}`);
      }
      const keyStyle = styleVars.length ? ` style="${styleVars.join('; ')};"` : '';
      html += `<button class="micropiano__key ${cls}${degreeClass}${progressionClass}"${keyStyle} data-midi="${midi}"
                aria-label="${key.name}${oct}">
                <span class="micropiano__key-label">${label}</span>
                ${degreeMeta?.label ? `<span class="micropiano__degree-label">${this._escapeHtml(degreeMeta.label)}</span>` : ''}
              </button>`;
    }
    return html;
  }

  _degreeMetaForMidi(midi) {
    const degree = normalizeDegreeHighlighting(this.project?.settings?.degreeHighlighting);
    if (!degree.enabled && !degree.showLabels) return null;
    const meta = degreeForMidi(midi, normalizeMusicalContext(this.project?.musicalContext));
    if (!meta) return null;
    return {
      color: degree.colors[meta.interval],
      colorEnabled: degree.enabled,
      intensityPercent: `${Math.round((degree.intensity ?? 0.22) * 100)}%`,
      label: degree.showLabels ? meta.label : ''
    };
  }

  _progressionMetaForMidi(midi, degreeMeta = null) {
    const glow = normalizeProgressionGlow(this.project?.settings?.progressionGlow);
    if (!glow.enabled) return null;
    const active = activeProgressionResolution(this.project?.progression, this.project?.musicalContext);
    if (!active?.pitchClasses?.length) return null;
    const pitchClass = ((midi % 12) + 12) % 12;
    if (!active.pitchClasses.includes(pitchClass)) return null;
    return {
      color: degreeMeta?.color || '#79c8ff',
      intensityPercent: `${Math.round(glow.intensity * 100)}%`,
    };
  }

  _escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  _escapeAttr(value = '') {
    return this._escapeHtml(value);
  }

  _refreshKeys() {
    const boards = this.el.querySelector('#mp-boards');
    boards.innerHTML = this._renderAllKeyboards();
    this._bindKeyEvents();
  }

  _refreshAll() {
    const display = this.el.querySelector('#mp-oct-display');
    if (display) display.textContent = this._octaveDisplay();
    this._refreshKeys();
  }

  refreshDegreeHighlights() {
    if (this.el) this._refreshKeys();
  }

  _maxBaseOctave() {
    const totalKeys = this._pianoCount * this._pianoKeys;
    return Math.max(1, Math.floor((97 - totalKeys) / 12));
  }

  _bindEvents() {
    this.el.querySelector('#mp-oct-down').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.shiftOctave(-1);
    });

    this.el.querySelector('#mp-oct-up').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.shiftOctave(1);
    });

    this._bindKeyEvents();
  }

  _bindKeyEvents() {
    const keys = this.el.querySelectorAll('.micropiano__key');
    keys.forEach(key => {
      key.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._cancelDwell(`key:${key.dataset.midi}`);
        const midi = parseInt(key.dataset.midi, 10);
        if (this._onControllerLearnTarget?.(this._controllerLearnTargetForMidi(midi))) return;
        if (!tremorAllows(this.project, `piano:${midi}`)) return;
        key.setPointerCapture(e.pointerId);
        this.pressMidi(midi);
      });

      key.addEventListener('pointerenter', () => {
        const midi = parseInt(key.dataset.midi, 10);
        this._startDwell(`key:${midi}`, key, () => {
          if (!tremorAllows(this.project, `piano:${midi}`)) return;
          this._dwellActiveKeys.add(midi);
          this.pressMidi(midi);
        });
      });

      key.addEventListener('pointerleave', () => {
        const midi = parseInt(key.dataset.midi, 10);
        this._cancelDwell(`key:${midi}`);
        if (this._dwellActiveKeys.has(midi)) this.releaseMidi(midi);
      });

      key.addEventListener('pointerup', (e) => {
        e.preventDefault();
        const midi = parseInt(key.dataset.midi, 10);
        this.releaseMidi(midi);
        this._dwellActiveKeys.delete(midi);
      });

      key.addEventListener('pointercancel', () => {
        const midi = parseInt(key.dataset.midi, 10);
        this.releaseMidi(midi);
      });
    });
  }

  _startDwell(key, el, onComplete) {
    const settings = dwellSettings(this.project);
    if (!settings.enabled) return;
    this._cancelDwell(key);
    el.classList.add('is-dwelling');
    el.style.setProperty('--dwell-ms', `${settings.thresholdMs}ms`);
    const timer = setTimeout(() => {
      this._dwellTimers.delete(key);
      el.classList.remove('is-dwelling');
      onComplete?.();
    }, settings.thresholdMs);
    this._dwellTimers.set(key, { timer, el });
  }

  _cancelDwell(key) {
    const entry = this._dwellTimers.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.el?.classList.remove('is-dwelling');
    this._dwellTimers.delete(key);
  }

  visibleMidis() {
    return [...(this.el?.querySelectorAll('.micropiano__key') || [])]
      .map(key => parseInt(key.dataset.midi, 10))
      .filter(Number.isFinite);
  }

  pressVisibleKey(index) {
    const midi = this.visibleMidis()[index];
    if (midi !== undefined) this.pressMidi(midi);
  }

  releaseVisibleKey(index) {
    const midi = this.visibleMidis()[index];
    if (midi !== undefined) this.releaseMidi(midi);
  }

  releaseAllKeys() {
    for (const key of [...this._dwellTimers.keys()]) this._cancelDwell(key);
    this._dwellActiveKeys.clear();
    [...this._activeKeys].forEach(midi => {
      this.synth.noteOff(midi);
      this.el?.querySelector(`.micropiano__key[data-midi="${midi}"]`)?.classList.remove('is-active');
      if (this._onNoteOff) this._onNoteOff(midi);
    });
    this._activeKeys.clear();
    this._activeInputMap.clear();
    this._activeKeyCounts.clear();
  }

  shiftOctave(delta) {
    const next = Math.max(1, Math.min(this._maxBaseOctave(), this._baseOctave + delta));
    if (next === this._baseOctave) return;
    this.releaseAllKeys();
    this._baseOctave = next;
    this._refreshAll();
  }

  pressMidi(midi) {
    return this._pressResolvedMidi(midi, 0.8, { source: 'piano', correct: true, requireVisibleInput: true });
  }

  pressControllerMidi(midi, velocity = 0.8, options = {}) {
    return this._pressResolvedMidi(midi, velocity, {
      source: options.source || 'controller',
      correct: !!options.correct,
      requireVisibleInput: false
    });
  }

  _pressResolvedMidi(inputMidi, velocity = 0.8, options = {}) {
    const numeric = Math.round(Number(inputMidi));
    if (!Number.isFinite(numeric)) return false;
    if (options.requireVisibleInput && !this.el?.querySelector(`.micropiano__key[data-midi="${numeric}"]`)) return false;
    const source = options.source || 'piano';
    const inputKey = `${source}:${numeric}`;
    if (this._activeInputMap.has(inputKey)) return true;
    const midi = options.correct
      ? correctMidiToScale(numeric, normalizeMusicalContext(this.project?.musicalContext))
      : numeric;

    if (this._onBeforeNoteOn) this._onBeforeNoteOn();
    const count = this._activeKeyCounts.get(midi) || 0;
    const key = this.el?.querySelector(`.micropiano__key[data-midi="${midi}"]`);
    if (count === 0) {
      this.synth.noteOn(midi);
      if (key) key.classList.add('is-active');
      this._activeKeys.add(midi);
      if (this._onNoteOn) this._onNoteOn(midi, velocity);
    }
    this._activeKeyCounts.set(midi, count + 1);
    this._activeInputMap.set(inputKey, midi);
    return true;
  }

  releaseControllerMidi(midi, options = {}) {
    this._releaseResolvedMidi(midi, options.source || 'controller');
  }

  _controllerLearnTargetForMidi(midi) {
    const name = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12];
    const oct = Math.floor(midi / 12) - 1;
    return {
      type: 'midi',
      midi,
      label: `${name}${oct}`,
      source: 'piano',
    };
  }

  releaseMidi(midi) {
    this._releaseResolvedMidi(midi, 'piano');
  }

  _releaseResolvedMidi(inputMidi, source = 'piano') {
    const numeric = Math.round(Number(inputMidi));
    if (!Number.isFinite(numeric)) return;
    const inputKey = `${source}:${numeric}`;
    const midi = this._activeInputMap.get(inputKey);
    if (!Number.isFinite(midi)) return;
    this._activeInputMap.delete(inputKey);
    const nextCount = Math.max(0, (this._activeKeyCounts.get(midi) || 1) - 1);
    if (nextCount > 0) {
      this._activeKeyCounts.set(midi, nextCount);
      return;
    }
    this._activeKeyCounts.delete(midi);
    if (!this._activeKeys.has(midi)) return;
    const key = this.el?.querySelector(`.micropiano__key[data-midi="${midi}"]`);
    this.synth.noteOff(midi);
    if (key) key.classList.remove('is-active');
    this._activeKeys.delete(midi);
    if (this._onNoteOff) this._onNoteOff(midi);
  }
}
