/**
 * ControllerMode - Gamepad instrument.
 * Maps D-pad + face buttons to scale notes, analog sticks to pitch/mod.
 * Supports pad modes: single and chords. Records modulation.
 */

import { getScaleNotes, midiToNoteName, normalizeMusicalContext, SCALES } from '../engine/MusicTheory.js';
import { SOUND_TRAITS, normalizeSoundTraits } from './WebAudioSynth.js';
import { gamepadButtonInfo } from '../engine/GamepadInputManager.js';

const POLL_INTERVAL = 30;
const TRIGGER_NOTE_MODIFIERS = {
  seventh: { id: 'seventh', name: '7th note', shortName: '7th', scaleOffset: 6 },
  ninth: { id: 'ninth', name: '9th note', shortName: '9th', scaleOffset: 8 },
  eleventh: { id: 'eleventh', name: '11th note', shortName: '11th', scaleOffset: 10 },
  thirteenth: { id: 'thirteenth', name: '13th note', shortName: '13th', scaleOffset: 12 },
  octave: { id: 'octave', name: 'Octave up', shortName: 'Oct', semitoneOffset: 12 },
  fifth: { id: 'fifth', name: 'Fifth up', shortName: '5th', semitoneOffset: 7 },
};

export class ControllerMode {
  constructor(synth, project, modManager, gamepadInput = null) {
    this.synth = synth;
    this._project = project;
    this._modManager = modManager;
    this._gamepadInput = gamepadInput;
    this.el = null;
    this._animFrame = null;
    this._activeMidis = new Map();
    this._activeChords = new Map();
    this._onNoteOn = null;
    this._onNoteOff = null;
    this._onBeforeNoteOn = null;
    this.onToneAssignmentChanged = null;
    this.onToneOverrideChanged = null;

    this.scaleName = 'major';
    this.rootNote = 'C';
    this.octave = 4;
    this.padMode = 'single';
    this._notes = [];
    this._fullScaleNotes = [];

    this._gamepadIndex = -1;
    this._lastPoll = 0;
    this._prevButtons = new Set();
    this._inputUnsubscribers = [];

    this._pitchBend = 0;
    this._modulation = 0;
    this._activeToneOverrides = new Map();
    this._triggerToneValues = { leftTrigger: 0, rightTrigger: 0 };
    this._activePadNotes = new Map();
  }

  set project(p) {
    this._project = p;
    this.setProjectKey(p?.musicalContext);
    this._controllerToneAssignments();
    this._syncTriggerAssignmentSelects();
    this._updateTriggerHelp();
    this._updateTriggerStatus();
  }
  get project() { return this._project; }

  setProjectKey(context) {
    const next = normalizeMusicalContext(context);
    this.rootNote = next.root;
    this.scaleName = next.scale;
    this._updateNotes();
    if (this.el) {
      this._refreshPads();
    }
  }

  setNoteCallbacks(onNoteOn, onNoteOff) {
    this._onNoteOn = onNoteOn;
    this._onNoteOff = onNoteOff;
  }

  setBeforeNoteCallback(fn) {
    this._onBeforeNoteOn = fn;
  }

  _updateNotes() {
    this._fullScaleNotes = getScaleNotes(this.scaleName, this.rootNote, this.octave);
    const scaleDef = SCALES[this.scaleName];
    const count = scaleDef ? scaleDef.intervals.length : 7;
    this._notes = this._fullScaleNotes.slice(0, count);
  }

  _getChordMidis(startIndex) {
    const maxIdx = this._fullScaleNotes.length - 1;
    return [
      this._fullScaleNotes[startIndex],
      this._fullScaleNotes[Math.min(startIndex + 2, maxIdx)],
      this._fullScaleNotes[Math.min(startIndex + 4, maxIdx)],
    ];
  }

  _getModifiedMidis(startIndex) {
    const activeModifiers = this._activeTriggerNoteModifiers();
    if (activeModifiers.length === 0) return [];
    const midis = [];
    const root = this._fullScaleNotes[startIndex] ?? this._notes[startIndex];
    for (const modifier of activeModifiers) {
      let midi = null;
      if (Number.isFinite(modifier.scaleOffset)) {
        midi = this._fullScaleNotes[startIndex + modifier.scaleOffset];
      } else if (Number.isFinite(modifier.semitoneOffset) && Number.isFinite(root)) {
        midi = root + modifier.semitoneOffset;
      }
      if (Number.isFinite(midi) && !midis.includes(midi)) midis.push(midi);
    }
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
          <label class="ctrlmode__label">Pad Mode</label>
          <select class="ctrlmode__select" id="ct-p-mode" aria-label="Pad mode">
            <option value="single" ${this.padMode === 'single' ? 'selected' : ''}>Single</option>
            <option value="chords" ${this.padMode === 'chords' ? 'selected' : ''}>Chords</option>
          </select>
        </div>
        <div class="ctrlmode__octave">
          <button class="btn btn--ghost" id="ct-oct-down" style="min-width:28px;min-height:28px;" aria-label="Octave down">v</button>
          <span class="ctrlmode__oct-label" id="ct-oct-label">Oct ${this.octave}</span>
          <button class="btn btn--ghost" id="ct-oct-up" style="min-width:28px;min-height:28px;" aria-label="Octave up">^</button>
        </div>
        <span class="ctrlmode__status" id="ct-status">No controller detected</span>
      </div>
      <div class="ctrlmode__body">
          <div class="ctrlmode__bindings" id="ct-bindings">
          ${this._renderBindings()}
        </div>
        <div class="ctrlmode__controller" id="ct-controller">
          <div class="ctrlmode__trigger-assignments" aria-label="Trigger assignments">
            <label class="ctrlmode__trigger-select ctrlmode__trigger-select--left">
              <span>Left trigger</span>
              <select class="ctrlmode__select" id="ct-tone-left">
                ${this._renderToneAssignmentOptions('leftTrigger')}
              </select>
            </label>
            <label class="ctrlmode__trigger-select ctrlmode__trigger-select--right">
              <span>Right trigger</span>
              <select class="ctrlmode__select" id="ct-tone-right">
                ${this._renderToneAssignmentOptions('rightTrigger')}
              </select>
            </label>
          </div>
          <div class="ctrlmode__art" aria-label="Game controller">
            <img class="ctrlmode__img" src="${import.meta.env.BASE_URL}controller.png" alt="" aria-hidden="true">
            <span class="ctrlmode__hotspot ctrlmode__hotspot--dpad" id="ct-dpad-u"></span>
            <span class="ctrlmode__hotspot ctrlmode__hotspot--dpad" id="ct-dpad-d"></span>
            <span class="ctrlmode__hotspot ctrlmode__hotspot--dpad" id="ct-dpad-l"></span>
            <span class="ctrlmode__hotspot ctrlmode__hotspot--dpad" id="ct-dpad-r"></span>
            <span class="ctrlmode__hotspot ctrlmode__hotspot--button" id="ct-btn-y"></span>
            <span class="ctrlmode__hotspot ctrlmode__hotspot--button" id="ct-btn-x"></span>
            <span class="ctrlmode__hotspot ctrlmode__hotspot--button" id="ct-btn-a"></span>
            <span class="ctrlmode__hotspot ctrlmode__hotspot--button" id="ct-btn-b"></span>
            <span class="ctrlmode__hotspot ctrlmode__hotspot--bumper" id="ct-bumper-l"></span>
            <span class="ctrlmode__hotspot ctrlmode__hotspot--bumper" id="ct-bumper-r"></span>
            <span class="ctrlmode__hotspot ctrlmode__hotspot--trigger" id="ct-trigger-l"></span>
            <span class="ctrlmode__hotspot ctrlmode__hotspot--trigger" id="ct-trigger-r"></span>
            <span class="ctrlmode__stick" id="ct-stick-l"></span>
            <span class="ctrlmode__stick" id="ct-stick-r"></span>
          </div>
          <div class="ctrlmode__guide" aria-label="Controller controls">
            <span>Left stick: modulation</span>
            <span>Right stick: pitch bend</span>
            <span>Shoulders: octave down / up</span>
            <span>Triggers: Tone or Trigger Notes</span>
          </div>
          <div class="ctrlmode__trigger-help" id="ct-trigger-help" aria-live="polite"></div>
          <div class="ctrlmode__trigger-status" id="ct-trigger-status" aria-live="polite"></div>
        </div>
      </div>
    `;

    this._bindEvents();
    this._updateTriggerHelp();
    this._attachGamepadInput();

    return this.el;
  }

  _renderBindings() {
    const bindings = this.project?.settings?.controllerBindings || {};
    const entries = Object.entries(bindings)
      .filter(([, binding]) => binding)
      .sort(([a], [b]) => Number(a) - Number(b));

    const fallback = this._notes.slice(0, 7).map((midi, i) => {
      const info = midiToNoteName(midi);
      return `<div class="ctrlmode__binding-row ctrlmode__binding-row--fallback">
        <span class="ctrlmode__binding-button">${i + 1}</span>
        <span class="ctrlmode__binding-target">${info.display}</span>
      </div>`;
    }).join('');

    const bindingRows = entries.map(([index, binding]) => {
        const info = gamepadButtonInfo(Number(index));
        return `<div class="ctrlmode__binding-row">
          <span class="ctrlmode__binding-button">${info.short}</span>
          <span class="ctrlmode__binding-target">${this._escapeHtml(binding.label || this._bindingLabel(binding))}</span>
        </div>`;
      }).join('');

    return `
      <div class="ctrlmode__binding-head">
        <span>Custom bindings</span>
        <span>${entries.length ? `${entries.length} set` : 'None set'}</span>
      </div>
      ${entries.length ? bindingRows : '<p class="ctrlmode__binding-empty">No custom bindings yet.</p>'}
      <div class="ctrlmode__binding-head ctrlmode__binding-head--secondary">
        <span>Fallback scale</span>
        <span>Unbound buttons</span>
      </div>
      ${fallback}
      <p class="ctrlmode__binding-note">Use the Controller button in the upper app toolbar to learn or clear custom bindings. Buttons without a custom binding use the fallback scale layout.</p>
    `;
  }

  _renderToneAssignmentOptions(key) {
    const value = this._normalizeTriggerAssignment(this._controllerToneAssignments()[key]);
    const options = [
      ['none', 'None'],
      ['__tone', 'Tone', true],
      ...Object.values(SOUND_TRAITS).map(trait => [trait.id, trait.name]),
      ['__notes', 'Trigger Notes', true],
      ...Object.values(TRIGGER_NOTE_MODIFIERS).map(mod => [`note:${mod.id}`, mod.name]),
    ];
    return options.map(([id, label, disabled]) => `<option value="${id}" ${value === id ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${label}</option>`).join('');
  }

  _bindEvents() {
    this.el.querySelector('#ct-p-mode')?.addEventListener('change', (e) => {
      this.padMode = e.target.value;
    });
    this.el.querySelector('#ct-oct-down')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.shiftOctave(-1);
    });
    this.el.querySelector('#ct-oct-up')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.shiftOctave(1);
    });
    this.el.querySelector('#ct-tone-left')?.addEventListener('change', (e) => {
      this._setToneAssignment('leftTrigger', e.target.value);
    });
    this.el.querySelector('#ct-tone-right')?.addEventListener('change', (e) => {
      this._setToneAssignment('rightTrigger', e.target.value);
    });
    this._syncTriggerAssignmentSelects();
  }

  shiftOctave(delta) {
    const next = Math.max(1, Math.min(6, this.octave + delta));
    if (next === this.octave) return;
    this.octave = next;
    this._updateOctave();
  }

  _updateOctave() {
    this._releaseAllNotes();
    const label = this.el?.querySelector('#ct-oct-label');
    if (label) label.textContent = `Oct ${this.octave}`;
    this._updateNotes();
    this._refreshPads();
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
    this._activePadNotes.clear();
  }

  _refreshPads() {
    const pads = this.el?.querySelector('#ct-pads');
    if (pads) pads.innerHTML = this._renderPads();
  }

  _attachGamepadInput() {
    if (!this._gamepadInput || this._inputUnsubscribers.length) return;
    this._inputUnsubscribers = [
      this._gamepadInput.on('state', ({ label }) => {
        const status = this.el?.querySelector('#ct-status');
        if (status) status.textContent = label || 'No controller detected';
      }),
      this._gamepadInput.on('buttonDown', ({ index }) => this._highlightButton(index, true)),
      this._gamepadInput.on('buttonUp', ({ index }) => this._highlightButton(index, false)),
      this._gamepadInput.on('triggers', ({ buttons, axes }) => this._mapAnalogTriggers(buttons, axes)),
      this._gamepadInput.on('axes', ({ axes }) => this._mapAxes(axes)),
    ];
    const status = this.el?.querySelector('#ct-status');
    if (status) status.textContent = this._gamepadInput.state().label;
  }

  _pollGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;

    if (this._gamepadIndex >= 0) pad = gamepads[this._gamepadIndex];
    if (!pad) {
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          pad = gamepads[i];
          this._gamepadIndex = i;
          break;
        }
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
    this._mapAnalogTriggers(pad.buttons, pad.axes);
    this._mapAxes(pad.axes);
    this._prevButtons = currentButtons;
  }

  _mapButtons(pressed, released) {
    const map = { 12: 0, 13: 1, 14: 2, 15: 3, 0: 4, 1: 5, 2: 6, 3: 0, 4: -1, 5: -2, 6: -3, 7: -4 };

    for (const idx of pressed) {
      const deg = map[idx];
      if (deg === -1) this.shiftOctave(-1);
      else if (deg === -2) this.shiftOctave(1);
      else if (deg === -3) this._setTriggerTone('leftTrigger', 1);
      else if (deg === -4) this._setTriggerTone('rightTrigger', 1);
      else if (deg !== undefined && deg >= 0 && deg < this._notes.length) this._triggerPad(deg);
      this._highlightButton(idx, true);
    }

    for (const idx of released) {
      const deg = map[idx];
      if (deg !== undefined && deg >= 0 && deg < this._notes.length) this._releasePad(deg);
      else if (deg === -3) this._setTriggerTone('leftTrigger', 0);
      else if (deg === -4) this._setTriggerTone('rightTrigger', 0);
      this._highlightButton(idx, false);
    }
  }

  handleFallbackButtonDown(idx) {
    const map = { 12: 0, 13: 1, 14: 2, 15: 3, 0: 4, 1: 5, 2: 6, 3: 0, 4: -1, 5: -2 };
    const deg = map[idx];
    if (deg === -1) this.shiftOctave(-1);
    else if (deg === -2) this.shiftOctave(1);
    else if (deg !== undefined && deg >= 0 && deg < this._notes.length) this._triggerPad(deg);
  }

  handleFallbackButtonUp(idx) {
    const map = { 12: 0, 13: 1, 14: 2, 15: 3, 0: 4, 1: 5, 2: 6, 3: 0 };
    const deg = map[idx];
    if (deg !== undefined && deg >= 0 && deg < this._notes.length) this._releasePad(deg);
  }

  refreshBindings() {
    const panel = this.el?.querySelector('#ct-bindings');
    if (panel) panel.innerHTML = this._renderBindings();
  }

  _controllerToneAssignments() {
    if (!this.project?.settings) return { leftTrigger: 'none', rightTrigger: 'none' };
    if (!this.project.settings.controllerToneAssignments) {
      this.project.settings.controllerToneAssignments = { leftTrigger: 'none', rightTrigger: 'none' };
    }
    const assignments = this.project.settings.controllerToneAssignments;
    const left = this._normalizeTriggerAssignment(assignments.leftTrigger);
    const right = this._normalizeTriggerAssignment(assignments.rightTrigger);
    if (left !== assignments.leftTrigger) assignments.leftTrigger = left;
    if (right !== assignments.rightTrigger) assignments.rightTrigger = right;
    return assignments;
  }

  _normalizeTriggerAssignment(value) {
    if (!value || value === 'none') return 'none';
    if (TRIGGER_NOTE_MODIFIERS[value]) return `note:${value}`;
    if (value.startsWith?.('note:')) {
      const noteId = value.replace('note:', '');
      return TRIGGER_NOTE_MODIFIERS[noteId] ? value : 'none';
    }
    if (SOUND_TRAITS[value]) return value;
    return 'none';
  }

  _syncTriggerAssignmentSelects() {
    const assignments = this._controllerToneAssignments();
    const left = this.el?.querySelector('#ct-tone-left');
    const right = this.el?.querySelector('#ct-tone-right');
    if (left) left.value = assignments.leftTrigger || 'none';
    if (right) right.value = assignments.rightTrigger || 'none';
  }

  _setToneAssignment(key, value) {
    const assignments = this._controllerToneAssignments();
    assignments[key] = this._normalizeTriggerAssignment(value);
    this._activeToneOverrides.clear();
    this._triggerToneValues = { leftTrigger: 0, rightTrigger: 0 };
    this._applyToneOverrides();
    this._syncTriggerAssignmentSelects();
    this._updateTriggerHelp();
    if (this.onToneAssignmentChanged) this.onToneAssignmentChanged(assignments);
    window.dispatchEvent(new CustomEvent('project-controller-tone-assignments-changed', { detail: { assignments } }));
  }

  _setTriggerTone(key, value) {
    const traitId = this._controllerToneAssignments()[key];
    if (!traitId || traitId === 'none' || traitId.startsWith('note:')) {
      this._applyToneOverrides();
      return;
    }
    const amount = Math.max(0, Math.min(1, value));
    if (amount > 0) this._activeToneOverrides.set(traitId, amount);
    else this._activeToneOverrides.delete(traitId);
    this._applyToneOverrides();
  }

  currentSoundTraits(baseTraits = null) {
    const merged = normalizeSoundTraits(baseTraits || this.project?.settings?.soundTraits || {});
    for (const [traitId, value] of this._activeToneOverrides) {
      merged[traitId] = { amount: Math.max(0, Math.min(1, value)) };
    }
    return merged;
  }

  activeTriggerLabels() {
    const assignments = this._controllerToneAssignments();
    const labels = [];
    if (assignments.leftTrigger !== 'none' && this._triggerToneValues.leftTrigger > 0.02) labels.push(this._triggerLabel('leftTrigger', 'LT'));
    if (assignments.rightTrigger !== 'none' && this._triggerToneValues.rightTrigger > 0.02) labels.push(this._triggerLabel('rightTrigger', 'RT'));
    return labels;
  }

  _triggerLabel(key, fallback) {
    const assignment = this._controllerToneAssignments()[key];
    if (assignment?.startsWith('note:')) {
      const modifier = TRIGGER_NOTE_MODIFIERS[assignment.replace('note:', '')];
      return modifier ? `${fallback} ${modifier.shortName || modifier.name}` : fallback;
    }
    const trait = SOUND_TRAITS[assignment];
    if (trait) return `${fallback} ${trait.name}`;
    return fallback;
  }

  _activeTriggerEntries() {
    const assignments = this._controllerToneAssignments();
    return [
      ['leftTrigger', 'LT', assignments.leftTrigger],
      ['rightTrigger', 'RT', assignments.rightTrigger],
    ].filter(([key, , value]) => this._triggerToneValues[key] > 0.02 && value && value !== 'none');
  }

  _activeTriggerNoteModifiers() {
    return this._activeTriggerEntries()
      .filter(([, , value]) => value?.startsWith('note:'))
      .map(([, , value]) => TRIGGER_NOTE_MODIFIERS[value.replace('note:', '')])
      .filter(Boolean);
  }

  _mapAnalogTriggers(buttons, axes = []) {
    const left = this._triggerValue(buttons[6], axes[4]);
    const right = this._triggerValue(buttons[7], axes[5]);
    if (Math.abs(left - this._triggerToneValues.leftTrigger) > 0.02) {
      this._triggerToneValues.leftTrigger = left;
      this._setTriggerTone('leftTrigger', left);
    }
    if (Math.abs(right - this._triggerToneValues.rightTrigger) > 0.02) {
      this._triggerToneValues.rightTrigger = right;
      this._setTriggerTone('rightTrigger', right);
    }
    this._updateTriggerStatus();
  }

  _triggerValue(button, axisValue) {
    if (button?.pressed) return 1;
    if (typeof button?.value === 'number' && button.value > 0.02) return Math.max(0, Math.min(1, button.value));
    if (typeof axisValue === 'number') {
      const normalized = axisValue < 0 ? (axisValue + 1) / 2 : axisValue;
      return Math.max(0, Math.min(1, normalized));
    }
    return 0;
  }

  _applyToneOverrides() {
    const merged = this.currentSoundTraits();
    if (this.onToneOverrideChanged) this.onToneOverrideChanged(merged, this.activeTriggerLabels());
    else this.synth.setSoundTraits(merged);
    this._updateTriggerStatus();
  }

  _updateTriggerStatus() {
    const status = this.el?.querySelector('#ct-trigger-status');
    if (!status) return;
    const active = this._activeTriggerEntries();
    const toneLabels = active
      .filter(([, , value]) => SOUND_TRAITS[value])
      .map(([key, fallback]) => this._triggerLabel(key, fallback));
    const noteLabels = active
      .filter(([, , value]) => value?.startsWith('note:'))
      .map(([key, fallback]) => this._triggerLabel(key, fallback));
    const parts = [];
    if (toneLabels.length) parts.push(`Tone: ${toneLabels.join(' + ')}`);
    if (noteLabels.length) parts.push(`Trigger Notes: ${noteLabels.join(' + ')}`);
    status.textContent = parts.join('  ');
    status.classList.toggle('is-active', parts.length > 0);
  }

  _updateTriggerHelp() {
    const help = this.el?.querySelector('#ct-trigger-help');
    if (!help) return;
    const assignments = Object.values(this._controllerToneAssignments());
    const hasTone = assignments.some(value => SOUND_TRAITS[value]);
    const hasNotes = assignments.some(value => value?.startsWith('note:'));
    const lines = [];
    if (hasNotes) {
      lines.push('<strong>Trigger Notes:</strong> hold the trigger first, then strike a pad. Single mode plays the related note instead; chord mode keeps the chord and adds that related note.');
    }
    if (hasTone) {
      lines.push('<strong>Tone triggers:</strong> hold the trigger while striking a pad to record that Tone into those notes. Let go before the next note to leave Tone off.');
    }
    help.innerHTML = lines.join('<br>');
    help.classList.toggle('is-active', lines.length > 0);
  }

  _triggerPad(deg) {
    const midi = this._notes[deg];
    if (!midi) return;

    if (this.padMode === 'chords') {
      const chordMidis = [...new Set([...this._getChordMidis(deg), ...this._getModifiedMidis(deg)])];
      this._activeChords.set(deg, chordMidis);
      chordMidis.forEach(m => {
        if (this._onBeforeNoteOn) this._onBeforeNoteOn();
        this.synth.noteOn(m);
        if (this._onNoteOn) this._onNoteOn(m, 0.8);
      });
      this._activeMidis.set(midi, true);
      this._activePadNotes.set(deg, chordMidis);
    } else {
      const modifiedMidis = this._getModifiedMidis(deg);
      const midis = modifiedMidis.length ? modifiedMidis : [midi];
      if (midis.some(m => this._activeMidis.has(m))) return;
      midis.forEach(m => {
        this._activeMidis.set(m, true);
        if (this._onBeforeNoteOn) this._onBeforeNoteOn();
        this.synth.noteOn(m, 0.8);
        if (this._onNoteOn) this._onNoteOn(m, 0.8);
      });
      this._activePadNotes.set(deg, midis);
    }
    this._refreshPads();
  }

  _releasePad(deg) {
    const midi = this._notes[deg];
    if (!midi) return;

    if (this.padMode === 'chords') {
      const chordMidis = this._activeChords.get(deg) || this._activePadNotes.get(deg) || [];
      chordMidis.forEach(m => {
        this.synth.noteOff(m);
        if (this._onNoteOff) this._onNoteOff(m);
      });
      this._activeChords.delete(deg);
      this._activeMidis.delete(midi);
    } else {
      const midis = this._activePadNotes.get(deg) || [midi];
      midis.forEach(m => {
        this._activeMidis.delete(m);
        this.synth.noteOff(m);
        if (this._onNoteOff) this._onNoteOff(m);
      });
    }
    this._activePadNotes.delete(deg);
    this._refreshPads();
  }

  _mapAxes(axes) {
    if (axes.length < 4) return;
    const deadZone = 0.1;

    let ry = axes[3];
    let ly = -axes[1];

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
    if (ls) ls.style.transform = `translate(-50%, -50%) translate(${Math.round(axes[0] * 14)}px, ${Math.round(axes[1] * 14)}px)`;
    if (rs) rs.style.transform = `translate(-50%, -50%) translate(${Math.round(axes[2] * 14)}px, ${Math.round(axes[3] * 14)}px)`;
  }

  _highlightButton(idx, on) {
    const ids = {
      12: '#ct-dpad-u', 13: '#ct-dpad-d', 14: '#ct-dpad-l', 15: '#ct-dpad-r',
      0: '#ct-btn-a', 1: '#ct-btn-b', 2: '#ct-btn-x', 3: '#ct-btn-y',
      4: '#ct-bumper-l', 5: '#ct-bumper-r', 6: '#ct-trigger-l', 7: '#ct-trigger-r',
    };
    const el = this.el?.querySelector(ids[idx]);
    if (el) el.classList.toggle('is-active', on);
  }

  _bindingLabel(binding) {
    if (binding?.type === 'drum') return binding.padId || 'Drum';
    if (binding?.type === 'scalePad' && Number.isFinite(binding.padIndex)) {
      const action = binding.padAction === 'chord' ? 'Chord' : binding.padAction === 'root' ? 'Root' : 'Note';
      return binding.label ? `${binding.label} (${action})` : `Pad ${binding.padIndex + 1} (${action})`;
    }
    if (binding?.type === 'midi' && Number.isFinite(binding.midi)) return midiToNoteName(binding.midi).display;
    return 'Unknown';
  }

  _escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
