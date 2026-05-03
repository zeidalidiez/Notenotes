/**
 * ControllerMode — Gamepad instrument.
 * Maps D-pad + face buttons to scale notes, analog sticks to pitch/mod.
 * Supports pad modes: single, chords, custom. Records modulation.
 */

import { getScaleNotes, midiToNoteName, SCALES, NOTE_NAMES } from '../engine/MusicTheory.js';

const POLL_INTERVAL = 30;

export class ControllerMode {
  constructor(synth, project, modManager) {
    this.synth = synth;
    this._project = project;
    this._modManager = modManager;
    this.el = null;
    this._animFrame = null;
    this._activeMidis = new Map();
    this._activeChords = new Map();
    this._onNoteOn = null;
    this._onNoteOff = null;

    this.scaleName = 'major';
    this.rootNote = 'C';
    this.octave = 4;
    this.padMode = 'single';
    this._notes = [];
    this._fullScaleNotes = [];

    this._gamepadIndex = -1;
    this._lastPoll = 0;
    this._prevButtons = new Set();

    this._pitchBend = 0;
    this._modulation = 0;
  }

  set project(p) { this._project = p; }
  get project() { return this._project; }

  setNoteCallbacks(onNoteOn, onNoteOff) {
    this._onNoteOn = onNoteOn;
    this._onNoteOff = onNoteOff;
  }

  _updateNotes() {
    this._fullScaleNotes = getScaleNotes(this.scaleName, this.rootNote, this.octave);
    const scaleDef = SCALES[this.scaleName];
    const count = scaleDef ? scaleDef.intervals.length : 7;
    this._notes = this._fullScaleNotes.slice(0, count);
  }

  _getChordMidis(startIndex) {
    const midis = [];
    const maxIdx = this._fullScaleNotes.length - 1;
    midis.push(this._fullScaleNotes[startIndex]);
    midis.push(this._fullScaleNotes[Math.min(startIndex + 2, maxIdx)]);
    midis.push(this._fullScaleNotes[Math.min(startIndex + 4, maxIdx)]);
    return midis;
  }

  render() {
    this._updateNotes();

    this.el = document.createElement('div');
    this.el.className = 'controller-mode';
    this.el.id = 'controller-mode';

    this.el.innerHTML = `
      <div class="ctrlmode__controls">
        <div class="ctrlmode__control-group">
          <label class="ctrlmode__label">Root</label>
          <select class="ctrlmode__select" id="ct-p-root" aria-label="Root note">
            ${NOTE_NAMES.map(n => `<option value="${n}" ${n === this.rootNote ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="ctrlmode__control-group">
          <label class="ctrlmode__label">Scale</label>
          <select class="ctrlmode__select" id="ct-p-scale" aria-label="Scale">
            ${Object.entries(SCALES).filter(([k]) => k !== 'chromatic').map(([key, s]) =>
              `<option value="${key}" ${key === this.scaleName ? 'selected' : ''}>${s.name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="ctrlmode__control-group">
          <label class="ctrlmode__label">Pad Mode</label>
          <select class="ctrlmode__select" id="ct-p-mode" aria-label="Pad mode">
            <option value="single" ${this.padMode === 'single' ? 'selected' : ''}>Single</option>
            <option value="chords" ${this.padMode === 'chords' ? 'selected' : ''}>Chords</option>
          </select>
        </div>
        <div class="ctrlmode__octave">
          <button class="btn btn--ghost" id="ct-oct-down" style="min-width:28px;min-height:28px;">▼</button>
          <span class="ctrlmode__oct-label" id="ct-oct-label">Oct ${this.octave}</span>
          <button class="btn btn--ghost" id="ct-oct-up" style="min-width:28px;min-height:28px;">▲</button>
        </div>
        <span class="ctrlmode__status" id="ct-status">No controller detected</span>
      </div>
      <div class="ctrlmode__body">
        <div class="ctrlmode__pads" id="ct-pads">
          ${this._renderPads()}
        </div>
        <div class="ctrlmode__controller" id="ct-controller">
          <svg width="100%" height="100%" viewBox="0 0 300 220" class="ctrlmode__svg">
            <!-- Body -->
            <path d="M55,30 Q30,30 30,60 L30,140 Q30,190 70,190 L90,190 Q110,190 110,160 L110,100 Q110,70 130,70 L170,70 Q190,70 190,100 L190,160 Q190,190 210,190 L230,190 Q270,190 270,140 L270,60 Q270,30 245,30 Z" fill="var(--surface-3)" stroke="var(--surface-4)" stroke-width="2"/>
            <!-- D-pad base -->
            <circle cx="80" cy="75" r="28" fill="var(--surface-2)" stroke="var(--surface-4)" stroke-width="1"/>
            <!-- D-pad directions -->
            <polygon id="ct-dpad-u" points="80,52 72,65 88,65" fill="var(--surface-5)" stroke="var(--surface-4)" stroke-width="1"/>
            <polygon id="ct-dpad-d" points="80,98 72,85 88,85" fill="var(--surface-5)" stroke="var(--surface-4)" stroke-width="1"/>
            <polygon id="ct-dpad-l" points="52,75 65,67 65,83" fill="var(--surface-5)" stroke="var(--surface-4)" stroke-width="1"/>
            <polygon id="ct-dpad-r" points="108,75 95,67 95,83" fill="var(--surface-5)" stroke="var(--surface-4)" stroke-width="1"/>
            <!-- Right buttons -->
            <circle cx="225" cy="62" r="11" fill="var(--surface-5)" stroke="var(--accent-dim)" stroke-width="1.5" id="ct-btn-y"/>
            <text x="225" y="66" text-anchor="middle" fill="var(--text-tertiary)" font-size="9" font-family="var(--font-family)">Y</text>
            <circle cx="205" cy="85" r="11" fill="var(--surface-5)" stroke="var(--accent-dim)" stroke-width="1.5" id="ct-btn-x"/>
            <text x="205" y="89" text-anchor="middle" fill="var(--text-tertiary)" font-size="9" font-family="var(--font-family)">X</text>
            <circle cx="245" cy="85" r="11" fill="var(--surface-5)" stroke="var(--accent-dim)" stroke-width="1.5" id="ct-btn-a"/>
            <text x="245" y="89" text-anchor="middle" fill="var(--text-tertiary)" font-size="9" font-family="var(--font-family)">A</text>
            <circle cx="225" cy="108" r="11" fill="var(--surface-5)" stroke="var(--accent-dim)" stroke-width="1.5" id="ct-btn-b"/>
            <text x="225" y="112" text-anchor="middle" fill="var(--text-tertiary)" font-size="9" font-family="var(--font-family)">B</text>
            <!-- Left stick -->
            <circle cx="80" cy="140" r="22" fill="var(--surface-2)" stroke="var(--surface-4)" stroke-width="1.5"/>
            <circle id="ct-stick-l" cx="80" cy="140" r="10" fill="var(--surface-5)" stroke="var(--accent-dim)" stroke-width="1"/>
            <!-- Right stick -->
            <circle cx="220" cy="140" r="22" fill="var(--surface-2)" stroke="var(--surface-4)" stroke-width="1.5"/>
            <circle id="ct-stick-r" cx="220" cy="140" r="10" fill="var(--surface-5)" stroke="var(--accent-dim)" stroke-width="1"/>
            <!-- Bumpers -->
            <rect id="ct-bumper-l" x="60" y="24" width="60" height="7" rx="3" fill="var(--surface-5)" stroke="var(--surface-4)" stroke-width="1"/>
            <rect id="ct-bumper-r" x="180" y="24" width="60" height="7" rx="3" fill="var(--surface-5)" stroke="var(--surface-4)" stroke-width="1"/>
            <!-- Labels -->
            <text x="80" y="180" text-anchor="middle" fill="var(--text-tertiary)" font-size="7" font-family="var(--font-family)">MOD (L↑↓)</text>
            <text x="220" y="180" text-anchor="middle" fill="var(--text-tertiary)" font-size="7" font-family="var(--font-family)">PITCH (R↑↓)</text>
          </svg>
        </div>
      </div>
    `;

    this._bindEvents();
    this._startPolling();

    return this.el;
  }

  _renderPads() {
    return this._notes.map((midi, i) => {
      const info = midiToNoteName(midi);
      const active = this._activeMidis.has(midi);
      return `<button class="ctrlmode__pad" data-index="${i}" data-midi="${midi}"
                style="background:${active ? 'var(--accent-dim)' : 'var(--surface-3)'}">
                <span class="ctrlmode__pad-degree">${i + 1}</span>
                <span class="ctrlmode__pad-label">${info.display}</span>
              </button>`;
    }).join('');
  }

  _bindEvents() {
    this.el.querySelector('#ct-p-root')?.addEventListener('change', (e) => {
      this.rootNote = e.target.value;
      this._updateNotes(); this._refreshPads();
    });
    this.el.querySelector('#ct-p-scale')?.addEventListener('change', (e) => {
      this.scaleName = e.target.value;
      this._updateNotes(); this._refreshPads();
    });
    this.el.querySelector('#ct-p-mode')?.addEventListener('change', (e) => {
      this.padMode = e.target.value;
    });
    this.el.querySelector('#ct-oct-down')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.octave > 2) { this.octave--; this._updateOctave(); }
    });
    this.el.querySelector('#ct-oct-up')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.octave < 6) { this.octave++; this._updateOctave(); }
    });
  }

  _updateOctave() {
    this._releaseAllNotes();
    this.el.querySelector('#ct-oct-label').textContent = `Oct ${this.octave}`;
    this._updateNotes(); this._refreshPads();
  }

  _releaseAllNotes() {
    for (const [midi] of this._activeMidis) {
      this.synth.noteOff(midi);
      if (this._onNoteOff) this._onNoteOff(midi);
    }
    this._activeMidis.clear();
    for (const [, chordMidis] of this._activeChords) {
      chordMidis.forEach(m => this.synth.noteOff(m));
    }
    this._activeChords.clear();
  }

  _refreshPads() {
    const pads = this.el.querySelector('#ct-pads');
    if (pads) pads.innerHTML = this._renderPads();
  }

  _startPolling() {
    const poll = () => {
      this._animFrame = requestAnimationFrame(poll);
      const now = performance.now();
      if (now - this._lastPoll < POLL_INTERVAL) return;
      this._lastPoll = now;
      this._pollGamepad();
    };
    this._animFrame = requestAnimationFrame(poll);
  }

  _pollGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;

    if (this._gamepadIndex >= 0) pad = gamepads[this._gamepadIndex];
    if (!pad) {
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) { pad = gamepads[i]; this._gamepadIndex = i; break; }
      }
    }

    const status = this.el?.querySelector('#ct-status');
    if (!pad) {
      if (status) status.textContent = 'No controller detected';
      return;
    }
    if (status) status.textContent = 'Controller connected';

    const currentButtons = new Set();
    for (let i = 0; i < pad.buttons.length; i++) {
      if (pad.buttons[i].pressed) currentButtons.add(i);
    }

    const newlyPressed = new Set([...currentButtons].filter(b => !this._prevButtons.has(b)));
    const newlyReleased = new Set([...this._prevButtons].filter(b => !currentButtons.has(b)));

    this._mapButtons(newlyPressed, newlyReleased);
    this._mapAxes(pad.axes);
    this._prevButtons = currentButtons;
  }

  _mapButtons(pressed, released) {
    const map = { 12: 0, 13: 1, 14: 2, 15: 3, 0: 4, 1: 5, 2: 6, 3: 0, 4: -1, 5: -2 };

    for (const idx of pressed) {
      const deg = map[idx];
      if (deg === -1 && this.octave > 2) { this.octave--; this._updateOctave(); }
      else if (deg === -2 && this.octave < 6) { this.octave++; this._updateOctave(); }
      else if (deg !== undefined && deg >= 0 && deg < this._notes.length) {
        this._triggerPad(deg);
      }
      this._highlightButton(idx, true);
    }

    for (const idx of released) {
      const deg = map[idx];
      if (deg !== undefined && deg >= 0 && deg < this._notes.length) {
        this._releasePad(deg);
      }
      this._highlightButton(idx, false);
    }
  }

  _triggerPad(deg) {
    const midi = this._notes[deg];
    if (!midi) return;

    if (this.padMode === 'chords') {
      const chordMidis = this._getChordMidis(deg);
      this._activeChords.set(deg, chordMidis);
      chordMidis.forEach(m => {
        this.synth.noteOn(m);
        if (this._onNoteOn) this._onNoteOn(m, 0.8);
      });
      this._activeMidis.set(midi, true);
    } else {
      if (this._activeMidis.has(midi)) return;
      this._activeMidis.set(midi, true);
      this.synth.noteOn(midi, 0.8);
      if (this._onNoteOn) this._onNoteOn(midi, 0.8);
    }
    this._refreshPads();
  }

  _releasePad(deg) {
    const midi = this._notes[deg];
    if (!midi) return;

    if (this.padMode === 'chords') {
      const chordMidis = this._activeChords.get(deg) || [];
      chordMidis.forEach(m => {
        this.synth.noteOff(m);
        if (this._onNoteOff) this._onNoteOff(m);
      });
      this._activeChords.delete(deg);
      this._activeMidis.delete(midi);
    } else {
      this._activeMidis.delete(midi);
      this.synth.noteOff(midi);
      if (this._onNoteOff) this._onNoteOff(midi);
    }
    this._refreshPads();
  }

  _mapAxes(axes) {
    if (axes.length < 4) return;
    const deadZone = 0.1;

    let ry = axes[3]; // right stick Y → pitch bend
    let ly = -axes[1]; // left stick Y → modulation (up=100%, down=200%)

    if (Math.abs(ry) < deadZone) ry = 0;
    if (Math.abs(ly) < deadZone) ly = 0;

    const pitch = Math.round(ry * 100) / 100;
    const mod = ly < 0 ? Math.round(Math.abs(ly) * 200) / 100 : Math.round(ly * 100) / 100;

    if (pitch !== this._pitchBend || mod !== this._modulation) {
      this._pitchBend = pitch;
      this._modulation = mod;
      if (this._modManager) {
        this._modManager.setPitchBend(pitch);
        this._modManager.setModulation(mod);
      }
    }

    const ls = this.el?.querySelector('#ct-stick-l');
    const rs = this.el?.querySelector('#ct-stick-r');
    if (ls) { ls.setAttribute('cx', 80 + Math.round(axes[0] * 14)); ls.setAttribute('cy', 140 + Math.round(axes[1] * 14)); }
    if (rs) { rs.setAttribute('cx', 220 + Math.round(axes[2] * 14)); rs.setAttribute('cy', 140 + Math.round(axes[3] * 14)); }
  }

  _highlightButton(idx, on) {
    const ids = {
      12: '#ct-dpad-u', 13: '#ct-dpad-d', 14: '#ct-dpad-l', 15: '#ct-dpad-r',
      0: '#ct-btn-a', 1: '#ct-btn-b', 2: '#ct-btn-x', 3: '#ct-btn-y',
      4: '#ct-bumper-l', 5: '#ct-bumper-r',
    };
    const el = this.el?.querySelector(ids[idx]);
    if (el) {
      el.setAttribute('fill', on ? 'var(--accent-light)' : 'var(--surface-5)');
      el.setAttribute('stroke', on ? 'var(--accent)' : (ids[idx].includes('bumper') ? 'var(--surface-4)' : 'var(--accent-dim)'));
    }
  }
}
