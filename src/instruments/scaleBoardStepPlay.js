/**
 * scaleBoardStepPlay — ScaleBoard step-sequencer + step-editor feature
 * (pattern model, rendering, event binding, the step-editor modal).
 *
 * Split out of ScaleBoard for size and composed back via Object.assign.
 * Bodies unchanged.
 */

import { getScaleNotes, midiToNoteName, SCALES } from '../engine/MusicTheory.js';
import { showToast } from '../ui/Toast.js';

export const STEP_PLAY_DEFAULT_OCTAVE = 4;
export const STEP_PLAY_MIN_OCTAVE = 1;
export const STEP_PLAY_MAX_OCTAVE = 6;

export const ScaleBoardStepPlayMixin = {
  _stepSequenceString() {
    return this._stepEntries().map(entry => midiToNoteName(entry.midi).display).join(' ');
  },

  _scaleDegreeCount() {
    return SCALES[this.scaleName]?.intervals?.length || 7;
  },

  _normalizeStepDegree(degree) {
    const parsed = parseInt(degree, 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 64 ? parsed : null;
  },

  _normalizeStepMidi(midi) {
    const parsed = parseInt(midi, 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 127 ? parsed : null;
  },

  _entryForStepDegree(degree) {
    const normalized = this._normalizeStepDegree(degree);
    if (!normalized) return null;
    const midi = this._midiForStepDegree(normalized);
    if (!Number.isInteger(midi)) return null;
    return { degree: normalized, midi };
  },

  _defaultStepEntries() {
    return Array.from({ length: this._scaleDegreeCount() }, (_, index) => this._entryForStepDegree(index + 1)).filter(Boolean);
  },

  _entriesFromDegreeString(value) {
    const degrees = (String(value || '').match(/\d+/g) || [])
      .map(token => parseInt(token, 10))
      .filter(degree => Number.isInteger(degree) && degree > 0 && degree <= 64);
    return degrees.map(degree => this._entryForStepDegree(degree)).filter(Boolean);
  },

  _normalizeStepEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.map(entry => {
      const degree = this._normalizeStepDegree(entry?.degree ?? entry);
      const midi = this._normalizeStepMidi(entry?.midi);
      const resolvedMidi = midi ?? (degree ? this._midiForStepDegree(degree) : null);
      if (!Number.isInteger(resolvedMidi)) return null;
      const normalized = { midi: resolvedMidi };
      if (degree) normalized.degree = degree;

      const alternateDegree = this._normalizeStepDegree(entry?.alternateDegree);
      const alternateMidi = this._normalizeStepMidi(entry?.alternateMidi);
      const resolvedAlternateMidi = alternateMidi ?? (alternateDegree ? this._midiForStepDegree(alternateDegree) : null);
      if (Number.isInteger(resolvedAlternateMidi)) {
        normalized.alternateMidi = resolvedAlternateMidi;
        if (alternateDegree) normalized.alternateDegree = alternateDegree;
      }
      return normalized;
    }).filter(Boolean);
  },

  _upgradeStepPlayPattern() {
    const settings = this.project?.settings;
    if (!settings) return;
    const hasPattern = Array.isArray(settings.stepPlayPattern) && settings.stepPlayPattern.length > 0;
    const hasLegacySequence = typeof settings.stepPlaySequence === 'string' && settings.stepPlaySequence.trim().length > 0;
    const needsMidi = hasPattern && settings.stepPlayPattern.some(entry => !Number.isInteger(this._normalizeStepMidi(entry?.midi)));
    if (!hasPattern && !hasLegacySequence) return;
    if (hasPattern && !needsMidi) return;

    const source = hasPattern
      ? settings.stepPlayPattern
      : this._entriesFromDegreeString(settings.stepPlaySequence);
    const upgraded = this._normalizeStepEntries(source);
    if (!upgraded.length) return;
    settings.stepPlayPattern = upgraded.map(entry => ({ ...entry }));
    settings.stepPlaySequence = upgraded
      .map(entry => entry.degree ? String(entry.degree) : midiToNoteName(entry.midi).display)
      .join(' ');
  },

  _stepEntries() {
    const pattern = this._normalizeStepEntries(this.project?.settings?.stepPlayPattern);
    if (pattern.length) return pattern;
    const legacy = this._entriesFromDegreeString(this.project?.settings?.stepPlaySequence);
    return legacy.length ? legacy : this._defaultStepEntries();
  },

  _stepScaleNotes(requiredCount = 32) {
    return getScaleNotes(this.scaleName, this.rootNote, STEP_PLAY_DEFAULT_OCTAVE, Math.max(32, requiredCount));
  },

  _midiForStepDegree(degree) {
    const notes = this._stepScaleNotes(degree);
    return notes[degree - 1];
  },

  _stepLabel(degree) {
    const midi = this._midiForStepDegree(degree);
    const note = midiToNoteName(midi);
    return { degree, midi, note };
  },

  _entryForStepMidi(midi, degree = null) {
    const normalizedMidi = this._normalizeStepMidi(midi);
    if (!Number.isInteger(normalizedMidi)) return null;
    const normalized = { midi: normalizedMidi };
    const normalizedDegree = this._normalizeStepDegree(degree);
    if (normalizedDegree) normalized.degree = normalizedDegree;
    return normalized;
  },

  _stepEntryLabel(entry) {
    const normalized = this._normalizeStepEntries([entry])[0] || this._entryForStepDegree(1);
    const midi = normalized?.midi ?? 60;
    return {
      ...normalized,
      note: midiToNoteName(midi),
      outOfScale: !this._degreeMetaForMidi(midi, { includeOutOfScale: true })?.inScale,
    };
  },

  _persistStepEntries(entries) {
    if (!this.project) return;
    if (!this.project.settings) this.project.settings = {};
    const normalized = this._normalizeStepEntries(entries);
    const next = normalized.length ? normalized : this._defaultStepEntries();
    this.project.settings.stepPlayPattern = next.map(entry => ({ ...entry }));
    this.project.settings.stepPlaySequence = next
      .map(entry => entry.degree ? String(entry.degree) : midiToNoteName(entry.midi).display)
      .join(' ');
    this._stepPointer = 0;
    this._stepLoopIndex = 0;
    if (this.onStepPlayChanged) this.onStepPlayChanged(this.project.settings.stepPlaySequence);
  },

  _persistStepSequence(value) {
    this._persistStepEntries(this._entriesFromDegreeString(value));
  },

  _renderStepPlay() {
    const chips = this._renderStepChips();
    return `
      <div class="step-play" id="sb-step-play">
        <div class="step-play__main">
          <button class="step-play__trigger" id="sb-step-trigger" type="button" aria-label="Play next step">
            <span class="step-play__trigger-label">Step</span>
            <span class="step-play__trigger-sub">Press any keyboard key or MIDI note to advance</span>
          </button>
          <div class="step-play__sequence" id="sb-step-sequence" aria-live="polite">${chips}</div>
        </div>
        <div class="step-play__actions">
          <button class="btn btn--sm btn--ghost" id="sb-step-edit" type="button">Edit Sequence</button>
          <button class="btn btn--sm btn--ghost" id="sb-step-reset" type="button">Reset</button>
        </div>
      </div>
    `;
  },

  _renderStepChips() {
    const sequence = this._stepEntries();
    return sequence.map((entry, step) => {
      const label = this._stepEntryLabel(entry);
      const { midi, note } = label;
      const alternate = entry.alternateMidi ? this._stepEntryLabel({ midi: entry.alternateMidi, degree: entry.alternateDegree }) : null;
      const isCurrent = step === (this._stepPointer % Math.max(1, sequence.length));
      const degreeMeta = this._degreeMetaForMidi(midi);
      const degreeClass = degreeMeta?.colorEnabled ? ' step-play__chip--degree-color' : '';
      const outClass = label.outOfScale ? ' step-play__chip--out' : '';
      const degreeStyle = degreeMeta?.colorEnabled
        ? ` style="--degree-color: ${this._escapeAttr(degreeMeta.color)}; --degree-intensity: ${this._escapeAttr(degreeMeta.intensityPercent)};"`
        : '';
      return `
        <span class="step-play__chip${degreeClass}${outClass}${isCurrent ? ' is-current' : ''}"${degreeStyle} data-step-chip="${step}">
          <span>${step + 1}</span>
          <small>${this._escapeHtml(note.display)}</small>
          ${label.outOfScale ? '<b class="step-play__out-badge">OUT</b>' : ''}
          ${alternate ? `<em>⇄ ${this._escapeHtml(alternate.note.display)}${alternate.outOfScale ? ' <b class="step-play__out-badge">OUT</b>' : ''}</em>` : ''}
        </span>
      `;
    }).join('');
  },

  _bindStepPlayEvents() {
    if (this.padMode !== 'step') return;
    const trigger = this.el.querySelector('#sb-step-trigger');
    trigger?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.triggerStepPlay();
    });
    this.el.querySelector('#sb-step-edit')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._openStepEditor();
    });
    this.el.querySelector('#sb-step-reset')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._persistStepEntries(this._defaultStepEntries());
      this._refreshStepSequenceUi();
      showToast('Step Play sequence reset');
    });
  },

  _refreshStepSequenceUi() {
    if (this.padMode !== 'step') return;
    const sequence = this.el?.querySelector('#sb-step-sequence');
    if (!sequence) return;
    const active = this.el?.querySelector('#sb-step-trigger')?.classList.contains('is-active');
    sequence.innerHTML = this._renderStepChips();
    if (active) this.el?.querySelector('#sb-step-trigger')?.classList.add('is-active');
  },

  triggerStepPlay() {
    if (this.padMode !== 'step') return false;
    const sequence = this._stepEntries();
    if (!sequence.length) return false;
    const step = this._stepPointer % sequence.length;
    const entry = sequence[step];
    const useAlternate = this._stepLoopIndex % 2 === 1 && Number.isInteger(entry.alternateMidi);
    const midi = useAlternate ? entry.alternateMidi : entry.midi;
    if (midi === undefined) return false;

    this._releaseStepPlay();
    if (step >= sequence.length - 1) {
      this._stepPointer = 0;
      this._stepLoopIndex += 1;
    } else {
      this._stepPointer = step + 1;
    }
    this._activeStepMidis = [midi];
    this.el?.querySelector('#sb-step-trigger')?.classList.add('is-active');
    this._noteOn(midi);
    this._refreshStepSequenceUi();

    this._stepReleaseTimer = setTimeout(() => {
      this._releaseStepPlay();
      this._refreshStepSequenceUi();
    }, 420);
    return true;
  },

  _releaseStepPlay() {
    if (this._stepReleaseTimer) {
      clearTimeout(this._stepReleaseTimer);
      this._stepReleaseTimer = null;
    }
    if (this._activeStepMidis.length) {
      this._activeStepMidis.forEach(midi => this._noteOff(midi));
      this._activeStepMidis = [];
    }
    this.el?.querySelector('#sb-step-trigger')?.classList.remove('is-active');
  },

  _openStepEditor() {
    this._closeStepEditor();
    this._stepEditorOctave = STEP_PLAY_DEFAULT_OCTAVE;
    this._stepEditorSequence = this._stepEntries().map(entry => ({ ...entry }));
    this._stepEditorAltTarget = null;
    this._stepEditorUndoStack = [];
    const overlay = document.createElement('div');
    overlay.className = 'step-editor-backdrop';
    overlay.innerHTML = this._renderStepEditor();
    document.body.appendChild(overlay);
    this._stepEditorOverlay = overlay;
    this._bindStepEditorEvents();
  },

  _closeStepEditor() {
    if (this._stepEditorKeyHandler) {
      document.removeEventListener('keydown', this._stepEditorKeyHandler, true);
      this._stepEditorKeyHandler = null;
    }
    this._stepEditorOverlay?.remove();
    this._stepEditorOverlay = null;
    this._stepEditorSequence = [];
    this._stepEditorAltTarget = null;
    this._stepEditorUndoStack = [];
  },

  _renderStepEditor() {
    return `
      <div class="step-editor" role="dialog" aria-modal="true" aria-label="Edit Step Play sequence">
        <div class="step-editor__header">
          <h2>Edit Sequence</h2>
          <p>Tap notes from the current scale to add them. Saved steps keep their exact pitch even if key, scale, or Pads octave changes later.</p>
        </div>
        <div class="step-editor__palette">
          <button class="btn btn--icon btn--ghost" id="step-editor-oct-down" type="button" aria-label="Lower note row">◀</button>
          <div class="step-editor__notes" id="step-editor-notes">${this._renderStepEditorNotes()}</div>
          <button class="btn btn--icon btn--ghost" id="step-editor-oct-up" type="button" aria-label="Higher note row">▶</button>
        </div>
        <div class="step-editor__sequence" id="step-editor-sequence">${this._renderStepEditorSequence()}</div>
        <div class="step-editor__actions">
          <button class="btn btn--ghost" id="step-editor-undo" type="button" disabled>Undo</button>
          <button class="btn btn--ghost" id="step-editor-clear" type="button">Clear</button>
          <button class="btn btn--ghost" id="step-editor-cancel" type="button">Cancel</button>
          <button class="btn btn--primary" id="step-editor-save" type="button">Save</button>
        </div>
      </div>
    `;
  },

  _renderStepEditorNotes() {
    const degreeCount = this._scaleDegreeCount();
    const notes = getScaleNotes(this.scaleName, this.rootNote, this._stepEditorOctave, degreeCount);
    return Array.from({ length: degreeCount }, (_, index) => {
      const degree = index + 1;
      const midi = notes[index];
      const note = midiToNoteName(midi);
      const degreeMeta = this._degreeMetaForMidi(midi);
      const degreeClass = degreeMeta?.colorEnabled ? ' step-editor__note--degree-color' : '';
      const degreeStyle = degreeMeta?.colorEnabled
        ? ` style="--degree-color: ${this._escapeAttr(degreeMeta.color)}; --degree-intensity: ${this._escapeAttr(degreeMeta.intensityPercent)};"`
        : '';
      return `
        <button class="step-editor__note${degreeClass}"${degreeStyle} type="button" data-degree="${degree}" data-midi="${midi}">
          <span>${this._escapeHtml(note.display)}</span>
          <small>${degree}</small>
        </button>
      `;
    }).join('');
  },

  _renderStepEditorSequence() {
    const entries = this._stepEditorSequence || [];
    if (!entries.length) return '<p class="step-editor__empty">Tap notes above to build the sequence.</p>';
    return entries.map((entry, index) => {
      const label = this._stepEntryLabel(entry);
      const { midi, note } = label;
      const alternate = entry.alternateMidi ? this._stepEntryLabel({ midi: entry.alternateMidi, degree: entry.alternateDegree }) : null;
      const pickingAlt = this._stepEditorAltTarget === index;
      const degreeMeta = this._degreeMetaForMidi(midi);
      const degreeClass = degreeMeta?.colorEnabled ? ' step-editor__seq-chip--degree-color' : '';
      const outClass = label.outOfScale ? ' step-editor__seq-chip--out' : '';
      const degreeStyle = degreeMeta?.colorEnabled
        ? ` style="--degree-color: ${this._escapeAttr(degreeMeta.color)}; --degree-intensity: ${this._escapeAttr(degreeMeta.intensityPercent)};"`
        : '';
      return `
        <div class="step-editor__seq-item${pickingAlt ? ' is-picking-alt' : ''}">
          <button class="step-editor__seq-chip${degreeClass}${outClass}"${degreeStyle} type="button" data-remove-step="${index}" title="Remove ${note.display}">
            <span>${index + 1}</span>
            <small>${this._escapeHtml(note.display)}</small>
            ${label.outOfScale ? '<b class="step-play__out-badge">OUT</b>' : ''}
            ${alternate ? `<em>⇄ ${this._escapeHtml(alternate.note.display)}${alternate.outOfScale ? ' <b class="step-play__out-badge">OUT</b>' : ''}</em>` : ''}
          </button>
          <button class="step-editor__seq-alt" type="button" data-alt-step="${index}">
            ${pickingAlt ? 'Pick note' : alternate ? 'Change alt' : 'Alt'}
          </button>
          ${alternate ? `<button class="step-editor__seq-clear-alt" type="button" data-clear-alt="${index}" aria-label="Clear alternate">Clear</button>` : ''}
        </div>
      `;
    }).join('');
  },

  _bindStepEditorEvents() {
    const overlay = this._stepEditorOverlay;
    if (!overlay) return;
    const syncSequence = () => this._refreshStepEditorSequence();
    overlay.querySelector('#step-editor-cancel')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._closeStepEditor();
    });
    overlay.querySelector('#step-editor-undo')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._undoStepEditor();
    });
    overlay.querySelector('#step-editor-save')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._persistStepEntries(this._stepEditorSequence);
      this._refreshStepSequenceUi();
      this._closeStepEditor();
      showToast('Step Play sequence updated');
    });
    overlay.querySelector('#step-editor-clear')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._pushStepEditorUndo();
      this._stepEditorSequence = [];
      this._stepEditorAltTarget = null;
      syncSequence();
    });
    overlay.querySelector('#step-editor-oct-down')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._stepEditorOctave = Math.max(STEP_PLAY_MIN_OCTAVE, this._stepEditorOctave - 1);
      overlay.querySelector('#step-editor-notes').innerHTML = this._renderStepEditorNotes();
      this._bindStepEditorNoteEvents();
    });
    overlay.querySelector('#step-editor-oct-up')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._stepEditorOctave = Math.min(STEP_PLAY_MAX_OCTAVE, this._stepEditorOctave + 1);
      overlay.querySelector('#step-editor-notes').innerHTML = this._renderStepEditorNotes();
      this._bindStepEditorNoteEvents();
    });
    const esc = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
      }
    };
    this._stepEditorKeyHandler = esc;
    document.addEventListener('keydown', this._stepEditorKeyHandler, true);
    this._bindStepEditorNoteEvents();
    this._bindStepEditorRemoveEvents();
    this._syncStepEditorUndoButton();
  },

  _refreshStepEditorSequence() {
    const target = this._stepEditorOverlay?.querySelector('#step-editor-sequence');
    if (!target) return;
    target.innerHTML = this._renderStepEditorSequence();
    this._bindStepEditorRemoveEvents();
    this._syncStepEditorUndoButton();
  },

  _pushStepEditorUndo() {
    const snapshot = {
      sequence: this._stepEditorSequence.map(entry => ({ ...entry })),
      altTarget: this._stepEditorAltTarget,
    };
    this._stepEditorUndoStack.push(snapshot);
    if (this._stepEditorUndoStack.length > 10) this._stepEditorUndoStack.shift();
    this._syncStepEditorUndoButton();
  },

  _undoStepEditor() {
    const previous = this._stepEditorUndoStack.pop();
    if (!previous) return;
    this._stepEditorSequence = previous.sequence.map(entry => ({ ...entry }));
    this._stepEditorAltTarget = previous.altTarget;
    this._refreshStepEditorSequence();
  },

  _syncStepEditorUndoButton() {
    const button = this._stepEditorOverlay?.querySelector('#step-editor-undo');
    if (button) button.disabled = this._stepEditorUndoStack.length === 0;
  },

  _bindStepEditorNoteEvents() {
    const overlay = this._stepEditorOverlay;
    if (!overlay) return;
    overlay.querySelectorAll('[data-degree]').forEach(button => {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const degree = this._normalizeStepDegree(button.dataset.degree);
        if (!degree) return;
        const nextEntry = this._entryForStepMidi(button.dataset.midi, degree);
        if (!nextEntry) return;
        this._pushStepEditorUndo();
        if (Number.isInteger(this._stepEditorAltTarget) && this._stepEditorSequence[this._stepEditorAltTarget]) {
          this._stepEditorSequence[this._stepEditorAltTarget].alternateDegree = nextEntry.degree;
          this._stepEditorSequence[this._stepEditorAltTarget].alternateMidi = nextEntry.midi;
          this._stepEditorAltTarget = null;
        } else {
          this._stepEditorSequence.push(nextEntry);
        }
        this._refreshStepEditorSequence();
      });
    });
  },

  _bindStepEditorRemoveEvents() {
    const overlay = this._stepEditorOverlay;
    if (!overlay) return;
    overlay.querySelectorAll('[data-remove-step]').forEach(button => {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const removeIndex = parseInt(button.dataset.removeStep, 10);
        this._pushStepEditorUndo();
        this._stepEditorSequence.splice(removeIndex, 1);
        if (this._stepEditorAltTarget === removeIndex) this._stepEditorAltTarget = null;
        else if (this._stepEditorAltTarget > removeIndex) this._stepEditorAltTarget -= 1;
        this._refreshStepEditorSequence();
      });
    });
    overlay.querySelectorAll('[data-alt-step]').forEach(button => {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(button.dataset.altStep, 10);
        this._stepEditorAltTarget = this._stepEditorAltTarget === index ? null : index;
        this._refreshStepEditorSequence();
      });
    });
    overlay.querySelectorAll('[data-clear-alt]').forEach(button => {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(button.dataset.clearAlt, 10);
        this._pushStepEditorUndo();
        if (this._stepEditorSequence[index]) delete this._stepEditorSequence[index].alternateDegree;
        if (this._stepEditorAltTarget === index) this._stepEditorAltTarget = null;
        this._refreshStepEditorSequence();
      });
    });
  },
};
