/**
 * ScaleBoard — 7-Pad scale-locked instrument.
 * Prevents wrong notes by locking pads to the selected scale.
 * Includes octave up/down toggles.
 */

import { getScaleNotes, midiToNoteName, SCALES, NOTE_NAMES } from '../engine/MusicTheory.js';
import { showToast } from '../ui/Toast.js';

export class ScaleBoard {
  /**
   * @param {WebAudioSynth} synth - The synth engine to play through
   * @param {Object} project - The project to read settings from
   */
  constructor(synth, project) {
    this.synth = synth;
    this.el = null;

    // State
    this.scaleName = 'major';
    this.rootNote = 'C';
    this.octave = 4;
    this.padMode = 'single'; // 'single', 'chords', 'custom'
    this.isEditingLayout = false;
    this.customPadTypes = []; // 'single' or 'chord'

    this._notes = [];
    this._fullScaleNotes = [];
    this._activePads = new Set();
    this._activeChords = new Map(); // padIndex -> array of midis
    this._activePadIndexes = new Set();

    // Callbacks for note recording
    this._onNoteOn = null;
    this._onNoteOff = null;

    this._onResize = () => {
      if (this.el) {
        const container = this.el.querySelector('#sb-pads');
        if (container) {
          container.style.gridTemplateColumns = this._gridColumns();
        }
      }
    };
    
    // Now that state is initialized, set the project to trigger updates
    this.project = project;

    window.addEventListener('settings-pads-changed', (e) => {
      if (e.detail && e.detail.count) {
        this._updateNotes(e.detail.count);
      } else {
        this._updateNotes();
      }
      this._refreshPads();
    });
  }

  set project(p) {
    this._project = p;
    this._updateNotes();
    if (this.el) {
      this._refreshPads();
    }
  }

  get project() {
    return this._project;
  }

  /** Set callbacks for note events (used by recording system) */
  setNoteCallbacks(onNoteOn, onNoteOff) {
    this._onNoteOn = onNoteOn;
    this._onNoteOff = onNoteOff;
  }

  /** Recalculate scale notes */
  _updateNotes(overrideCount) {
    this._fullScaleNotes = getScaleNotes(this.scaleName, this.rootNote, this.octave);

    if (this.padMode === 'custom') {
      const count = overrideCount || this.project?.settings?.scalePadsCount || 7;
      this._notes = this._fullScaleNotes.slice(0, Math.min(count, this._fullScaleNotes.length));
    } else {
      const scaleDef = SCALES[this.scaleName];
      const degreeCount = scaleDef ? scaleDef.intervals.length : 7;
      this._notes = this._fullScaleNotes.slice(0, degreeCount);
    }

    const noteCount = this._notes.length;
    while (this.customPadTypes.length < noteCount) {
      this.customPadTypes.push('single');
    }
    this.customPadTypes.length = noteCount;
  }

  /**
   * Render the Scale Board UI.
   * @returns {HTMLElement}
   */
  render() {
    this._updateNotes();

    this.el = document.createElement('div');
    this.el.className = 'scaleboard';
    this.el.id = 'scaleboard';

    this.el.innerHTML = `
      <div class="scaleboard__controls">
        <div class="scaleboard__control-group">
          <label class="scaleboard__label">Root</label>
          <select class="scaleboard__select" id="sb-root" aria-label="Root note">
            ${NOTE_NAMES.map(n => `<option value="${n}" ${n === this.rootNote ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="scaleboard__control-group">
          <label class="scaleboard__label">Scale</label>
          <select class="scaleboard__select" id="sb-scale" aria-label="Scale type">
            ${Object.entries(SCALES).filter(([k]) => k !== 'chromatic').map(([key, s]) =>
              `<option value="${key}" ${key === this.scaleName ? 'selected' : ''}>${s.name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="scaleboard__control-group">
          <label class="scaleboard__label">Pad Mode</label>
          <select class="scaleboard__select" id="sb-pad-mode" aria-label="Pad mode">
            <option value="single" ${this.padMode === 'single' ? 'selected' : ''}>Single</option>
            <option value="chords" ${this.padMode === 'chords' ? 'selected' : ''}>Chords</option>
            <option value="custom" ${this.padMode === 'custom' ? 'selected' : ''}>Custom</option>
          </select>
        </div>
        <div class="scaleboard__octave">
          <button class="btn btn--icon btn--ghost scaleboard__oct-btn" id="sb-oct-down" aria-label="Octave down">▼</button>
          <span class="scaleboard__oct-display" id="sb-oct-display">Oct ${this.octave}</span>
          <button class="btn btn--icon btn--ghost scaleboard__oct-btn" id="sb-oct-up" aria-label="Octave up">▲</button>
        </div>
        ${this.padMode === 'custom' ? `
        <div class="scaleboard__control-group">
          <button class="btn btn--sm ${this.isEditingLayout ? 'btn--primary' : 'btn--ghost'}" id="sb-edit-layout">
            ${this.isEditingLayout ? 'Done' : 'Edit Layout'}
          </button>
        </div>
        ` : ''}
      </div>
      <div class="scaleboard__pads" id="sb-pads" style="grid-template-columns: ${this._gridColumns()}; gap: ${this._gridGap()};">
        ${this._renderPads()}
      </div>
    `;

    this._bindEvents();
    window.addEventListener('resize', this._onResize);
    return this.el;
  }

  _gridColumns() {
    const idealCols = Math.ceil(Math.sqrt(this._notes.length));
    const container = this.el?.querySelector('#sb-pads');
    const width = container?.clientWidth || 360;
    const maxCols = Math.max(1, Math.floor((width - 4) / 72));
    const cols = Math.min(idealCols, maxCols);
    return `repeat(${cols}, 1fr)`;
  }

  _gridGap() {
    return this._notes.length > 9 ? '6px' : 'var(--space-md)';
  }

  _renderPads() {
    return this._notes.map((midi, i) => {
      const noteInfo = midiToNoteName(midi);
      let isChord = this.padMode === 'chords' || (this.padMode === 'custom' && this.customPadTypes[i] === 'chord');
      let typeLabel = isChord ? 'Chord' : 'Note';
      return `
        <button class="scaleboard__pad ${this.isEditingLayout ? 'is-editing' : ''}" data-index="${i}" data-midi="${midi}"
                aria-label="Scale degree ${i + 1}, ${noteInfo.display}">
          <span class="scaleboard__pad-degree">${i + 1}</span>
          <span class="scaleboard__pad-note">${noteInfo.display}</span>
          ${this.padMode === 'custom' ? `<span class="scaleboard__pad-type">${typeLabel}</span>` : ''}
        </button>
      `;
    }).join('');
  }

  _refreshLayout() {
    const parent = this.el.parentNode;
    const oldEl = this.el;
    if (parent) {
      const newEl = this.render();
      parent.replaceChild(newEl, oldEl);
    } else {
      this._refreshPads();
    }
  }

  _refreshPads() {
    this._updateNotes();
    const padsContainer = this.el.querySelector('#sb-pads');
    padsContainer.style.gridTemplateColumns = this._gridColumns();
    padsContainer.innerHTML = this._renderPads();
    this._bindPadEvents();
  }

  _bindEvents() {
    // Root note selector
    this.el.querySelector('#sb-root').addEventListener('change', (e) => {
      this.rootNote = e.target.value;
      this._refreshPads();
    });

    // Scale selector
    this.el.querySelector('#sb-scale').addEventListener('change', (e) => {
      this.scaleName = e.target.value;
      this._refreshPads();
    });

    // Octave controls
    this.el.querySelector('#sb-oct-down').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.shiftOctave(-1);
    });

    this.el.querySelector('#sb-oct-up').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.shiftOctave(1);
    });

    // Mode selector
    this.el.querySelector('#sb-pad-mode')?.addEventListener('change', (e) => {
      this.padMode = e.target.value;
      if (this.padMode !== 'custom') this.isEditingLayout = false;
      this._refreshLayout();
      if (this.padMode === 'custom') {
        showToast('Tap "Edit Layout" to set each pad to Note or Chord');
      }
    });

    // Edit Layout toggle
    this.el.querySelector('#sb-edit-layout')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.isEditingLayout = !this.isEditingLayout;
      this._refreshLayout();
    });

    this._bindPadEvents();
  }

  _getChordMidis(startIndex) {
    // A simple triad (1st, 3rd, 5th in the scale)
    const midis = [];
    const maxIdx = this._fullScaleNotes.length - 1;
    midis.push(this._fullScaleNotes[startIndex]); // root
    midis.push(this._fullScaleNotes[Math.min(startIndex + 2, maxIdx)]); // third
    midis.push(this._fullScaleNotes[Math.min(startIndex + 4, maxIdx)]); // fifth
    return midis;
  }

  _bindPadEvents() {
    const pads = this.el.querySelectorAll('.scaleboard__pad');
    pads.forEach(pad => {
      const i = parseInt(pad.dataset.index, 10);
      const midi = parseInt(pad.dataset.midi, 10);

      // Pointer down → note on / edit toggle
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        
        if (this.isEditingLayout) {
          // Toggle custom type
          this.customPadTypes[i] = this.customPadTypes[i] === 'single' ? 'chord' : 'single';
          this._refreshPads();
          return;
        }

        pad.setPointerCapture(e.pointerId);
        this.pressPad(i);
      });

      const handleRelease = (e) => {
        e.preventDefault();
        if (this.isEditingLayout) return;

        this.releasePad(i);
      };

      // Pointer up → note off
      pad.addEventListener('pointerup', handleRelease);

      // Pointer cancel/leave → note off
      pad.addEventListener('pointercancel', handleRelease);
    });
  }

  pressPad(index) {
    if (this.isEditingLayout || this._activePadIndexes.has(index)) return;
    const pad = this.el?.querySelector(`.scaleboard__pad[data-index="${index}"]`);
    const midi = this._notes[index];
    if (!pad || midi === undefined) return;

    pad.classList.add('is-active');
    this._activePadIndexes.add(index);

    const isChord = this.padMode === 'chords' || (this.padMode === 'custom' && this.customPadTypes[index] === 'chord');
    if (isChord) {
      const chordMidis = this._getChordMidis(index);
      this._activeChords.set(index, chordMidis);
      chordMidis.forEach(m => this._noteOn(m));
    } else {
      this._noteOn(midi);
    }
  }

  releasePad(index) {
    if (!this._activePadIndexes.has(index)) return;
    const pad = this.el?.querySelector(`.scaleboard__pad[data-index="${index}"]`);
    const midi = this._notes[index];
    if (pad) pad.classList.remove('is-active');

    if (this._activeChords.has(index)) {
      const chordMidis = this._activeChords.get(index) || [];
      chordMidis.forEach(m => this._noteOff(m));
      this._activeChords.delete(index);
    } else if (midi !== undefined) {
      this._noteOff(midi);
    }

    this._activePadIndexes.delete(index);
  }

  releaseAllPads() {
    [...this._activePadIndexes].forEach(index => this.releasePad(index));
  }

  shiftOctave(delta) {
    const next = Math.max(2, Math.min(6, this.octave + delta));
    if (next === this.octave) return;
    this.releaseAllPads();
    this.octave = next;
    this.el?.querySelector('#sb-oct-display')?.replaceChildren(`Oct ${this.octave}`);
    if (this.el) this._refreshPads();
  }

  _noteOn(midi) {
    this.synth.noteOn(midi);
    this._activePads.add(midi);
    if (this._onNoteOn) this._onNoteOn(midi, 0.8);
  }

  _noteOff(midi) {
    this.synth.noteOff(midi);
    this._activePads.delete(midi);
    if (this._onNoteOff) this._onNoteOff(midi);
  }
}
