/**
 * ArpeggioManager — Hold and arpeggiation engine.
 * Modes: 'off' | 'hold' | 'arp'
 * Only affects pitched instruments. Drums bypass entirely.
 */

import { showToast } from '../ui/Toast.js';

export const ARP_MODES = { OFF: 'off', HOLD: 'hold', ARP: 'arp' };

export const CHORD_TYPES = [
  { id: 'major',      name: 'Major',          semitones: [0, 4, 7] },
  { id: 'minor',      name: 'Minor',          semitones: [0, 3, 7] },
  { id: 'dim',        name: 'Diminished',     semitones: [0, 3, 6] },
  { id: 'aug',        name: 'Augmented',      semitones: [0, 4, 8] },
  { id: 'sus',        name: 'Suspended',      semitones: [0, 5, 7] },
  { id: 'maj7',       name: 'Major 7th',      semitones: [0, 4, 7, 11] },
  { id: 'min7',       name: 'Minor 7th',      semitones: [0, 3, 7, 10] },
  { id: 'dom7',       name: 'Dominant 7th',   semitones: [0, 4, 7, 10] },
  { id: 'halfdim7',   name: 'Half dim/Min 7b5', semitones: [0, 3, 6, 10] },
  { id: 'fulldim7',   name: 'Fully dim 7th',  semitones: [0, 3, 6, 9] },
];

export const ARP_PATTERNS = [
  { id: 'up',     name: 'Up' },
  { id: 'down',   name: 'Down' },
  { id: 'updown', name: 'Up/Down' },
  { id: 'random', name: 'Random' },
];

export const ARP_RATES = [
  { id: '1/4',  name: '1/4',  divisor: 480 },
  { id: '1/8',  name: '1/8',  divisor: 240 },
  { id: '1/16', name: '1/16', divisor: 120 },
  { id: '1/32', name: '1/32', divisor: 60 },
];

export class ArpeggioManager {
  constructor(transport, project) {
    this.transport = transport;
    this._project = project;
    this._mode = ARP_MODES.OFF;
    this._synth = null;
    this._realNoteOn = null;
    this._realNoteOff = null;
    this._realAllOff = null;
    this._realCancelNote = null;

    this._latched = new Map();      // midi → { timerId, releaseAt }
    this._arpNotes = new Map();
    this._arpSchedulerId = null;
    this._arpNextTime = null;
    this._scheduleAheadSeconds = 0.08;
    this._schedulerIntervalMs = 25;
    this._arpStep = 0;
    this._pendingChord = [];
    this._pendingTimer = null;

    this._onModeChange = null;
  }

  set onModeChange(fn) { this._onModeChange = fn; }

  get mode() { return this._mode; }

  get _chordType() { return this.project?.settings?.arpChordType || 'major'; }
  get _arpPattern() { return this.project?.settings?.arpPattern || 'up'; }
  get _arpRate() { return this.project?.settings?.arpRate || '1/8'; }
  get _holdDuration() { return this.project?.settings?.holdDuration ?? 3000; }

  set project(p) { this._project = p; }
  get project() { return this._project; }

  wrapSynth(synth) {
    this._synth = synth;
    this._realNoteOn = synth.noteOn.bind(synth);
    this._realNoteOff = synth.noteOff.bind(synth);
    this._realAllOff = synth.allNotesOff.bind(synth);
    this._realCancelNote = synth.cancelNote?.bind(synth) || null;

    const self = this;
    synth.noteOn = function (midi, vel) {
      self._handleNoteOn(midi, vel ?? 0.8);
    };
    synth.noteOff = function (midi) {
      self._handleNoteOff(midi);
    };
  }

  _safeNoteOn(midi, vel, audioTime) { if (this._realNoteOn) this._realNoteOn(midi, vel, audioTime); }
  _safeNoteOff(midi, audioTime) { if (this._realNoteOff) this._realNoteOff(midi, audioTime); }
  _safeAllOff() { if (this._realAllOff) this._realAllOff(); }
  _safeCancelNote(midi, audioTime) {
    if (this._realCancelNote) this._realCancelNote(midi, audioTime);
    else this._safeNoteOff(midi, audioTime);
  }

  _audioNow() {
    return this._synth?.engine?.currentTime ?? this.transport?.engine?.currentTime ?? 0;
  }

  setMode(mode) {
    const prev = this._mode;
    if (prev === ARP_MODES.ARP && mode !== ARP_MODES.ARP) {
      this._stopArp();
    }
    if (prev === ARP_MODES.HOLD && mode !== ARP_MODES.HOLD) {
      this._releaseAll();
    }
    this._mode = mode;
    if (this._onModeChange) this._onModeChange(mode);

    if (prev !== mode) {
      const labels = { off: 'Normal', hold: 'Hold: notes latch', arp: 'Arpeggio on' };
      showToast(labels[mode] || mode);
    }
  }

  cycleMode() {
    const order = [ARP_MODES.OFF, ARP_MODES.HOLD, ARP_MODES.ARP];
    const idx = order.indexOf(this._mode);
    this.setMode(order[(idx + 1) % order.length]);
  }

  _releaseAll() {
    for (const data of this._latched.values()) {
      if (data.timerId) clearTimeout(data.timerId);
    }
    this._latched.clear();
    this._safeAllOff();
  }

  _handleNoteOn(midi, velocity) {
    if (this._mode === ARP_MODES.HOLD) {
      if (this._latched.has(midi)) {
        const data = this._latched.get(midi);
        if (data.timerId) clearTimeout(data.timerId);
        this._latched.delete(midi);
        this._safeCancelNote(midi, this._audioNow());
        return;
      }
      const now = this._audioNow();
      const releaseAt = now + this._holdDuration / 1000;
      const entry = { timerId: null, releaseAt };
      const timerId = setTimeout(() => {
        if (this._latched.get(midi) === entry) this._latched.delete(midi);
      }, this._holdDuration);
      entry.timerId = timerId;
      this._latched.set(midi, entry);
      this._safeNoteOn(midi, velocity, now);
      // The timer above only cleans up latch state. The audible release is
      // scheduled immediately on the AudioContext clock so a busy UI cannot
      // stretch the note.
      this._safeNoteOff(midi, releaseAt);
      return;
    }

    if (this._mode === ARP_MODES.ARP) {
      this._pendingChord.push({ midi, velocity });
      if (this._pendingTimer) clearTimeout(this._pendingTimer);
      this._pendingTimer = setTimeout(() => {
        this._commitChord();
      }, 15);
      return;
    }

    this._safeNoteOn(midi, velocity);
  }

  _commitChord() {
    this._pendingTimer = null;
    const group = [...this._pendingChord];
    this._pendingChord = [];

    if (group.length === 0) return;

    const rootNote = group[0].midi;
    let notes;
    if (group.length > 1) {
      notes = group.map(g => g.midi);
    } else {
      notes = [rootNote];
    }

    this._arpNotes.set(rootNote, { notes, velocity: group[0].velocity });
    this._startArp();
  }

  _handleNoteOff(midi) {
    if (this._mode === ARP_MODES.HOLD) return;

    if (this._mode === ARP_MODES.ARP) {
      for (const [key] of this._arpNotes) {
        const data = this._arpNotes.get(key);
        if (data && data.notes.includes(midi)) {
          this._arpNotes.delete(key);
          if (this._arpNotes.size === 0) {
            this._stopArp();
          }
          return;
        }
      }
      return;
    }

    this._safeNoteOff(midi);
  }

  _startArp() {
    if (this._arpSchedulerId) return;
    this._arpStep = 0;
    const now = this._audioNow();
    this._arpNextTime = now + 0.02;
    this._scheduleArpWindow();
    this._arpSchedulerId = setInterval(() => this._scheduleArpWindow(), this._schedulerIntervalMs);
  }

  _scheduleArpWindow() {
    if (this._arpNotes.size === 0) return;
    const now = this._audioNow();
    const horizon = now + this._scheduleAheadSeconds;
    if (!Number.isFinite(this._arpNextTime) || this._arpNextTime < now) this._arpNextTime = now;

    while (this._arpNextTime < horizon && this._arpNotes.size > 0) {
      const allGroups = [...this._arpNotes.values()].map(data => ({
        notes: data.notes,
        velocity: data.velocity,
      }));
      const stepNotes = this._getPatternNotes(allGroups);
      if (!stepNotes.length) return;

      const rateCfg = ARP_RATES.find(r => r.id === this._arpRate) || ARP_RATES[2];
      const beatsPerSecond = this.transport.bpm / 60;
      const intervalSeconds = Math.max(0.04, (1 / beatsPerSecond) * (rateCfg.divisor / 480));
      const note = stepNotes[this._arpStep % stepNotes.length];
      const noteOffTime = this._arpNextTime + intervalSeconds * 0.55;

      this._safeNoteOn(note.midi, note.velocity, this._arpNextTime);
      this._safeNoteOff(note.midi, noteOffTime);
      this._arpStep += 1;
      this._arpNextTime += intervalSeconds;
    }
  }

  _getPatternNotes(allGroups) {
    const flatten = [];
    for (const group of allGroups) {
      for (const midi of group.notes) {
        flatten.push({ midi, velocity: group.velocity });
      }
    }

    if (flatten.length <= 1) return flatten;

    switch (this._arpPattern) {
      case 'down':
        return [...flatten].reverse();
      case 'updown': {
        const up = [...flatten];
        const down = [...flatten].reverse().slice(1, -1);
        return [...up, ...down];
      }
      case 'random': {
        const arr = [...flatten];
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      }
      default:
        return flatten;
    }
  }

  _stopArp() {
    if (this._arpSchedulerId) {
      clearInterval(this._arpSchedulerId);
      this._arpSchedulerId = null;
    }
    if (this._pendingTimer) {
      clearTimeout(this._pendingTimer);
      this._pendingTimer = null;
    }
    this._pendingChord = [];
    this._safeAllOff();
    this._arpNotes.clear();
    this._arpStep = 0;
    this._arpNextTime = null;
  }
}
