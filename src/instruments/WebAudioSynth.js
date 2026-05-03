/**
 * WebAudioSynth — Polyphonic synthesizer using Web Audio API.
 * Supports multiple waveforms, ADSR envelope, filter, and presets
 * spanning retro/chiptune, modern/ambient, and lo-fi aesthetics.
 * 
 * Users can create complex instruments by adjusting all parameters
 * and saving/loading JSON patch files.
 */

import { AudioEngine } from '../engine/AudioEngine.js';
import { midiToFreq } from '../engine/MusicTheory.js';

/** Maximum simultaneous voices */
const MAX_VOICES = 8;

/** Default synth patch */
const DEFAULT_PATCH = {
  name: 'Default',
  oscillator: {
    type: 'triangle',     // sine, square, sawtooth, triangle
    detune: 0,            // cents (-100 to 100)
  },
  envelope: {
    attack: 0.01,         // seconds
    decay: 0.15,          // seconds
    sustain: 0.6,         // 0–1
    release: 0.3,         // seconds
  },
  filter: {
    type: 'lowpass',      // lowpass, highpass, bandpass
    frequency: 8000,      // Hz
    Q: 1,                 // resonance (0.1–20)
  },
  gain: 0.5,
};

/** Built-in preset patches */
export const PRESETS = {
  // --- Retro / Chiptune ---
  chip_lead: {
    name: 'Chip Lead',
    oscillator: { type: 'square', detune: 0 },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0.8, release: 0.1 },
    filter: { type: 'lowpass', frequency: 12000, Q: 0.5 },
    gain: 0.35,
  },
  chip_bass: {
    name: 'Chip Bass',
    oscillator: { type: 'square', detune: 0 },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.15 },
    filter: { type: 'lowpass', frequency: 2000, Q: 2 },
    gain: 0.45,
  },

  // --- Modern / Ambient ---
  soft_pad: {
    name: 'Soft Pad',
    oscillator: { type: 'sine', detune: 8 },
    envelope: { attack: 0.6, decay: 0.5, sustain: 0.7, release: 1.2 },
    filter: { type: 'lowpass', frequency: 3000, Q: 0.7 },
    gain: 0.4,
  },
  shimmer_lead: {
    name: 'Shimmer Lead',
    oscillator: { type: 'sawtooth', detune: 5 },
    envelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.8 },
    filter: { type: 'lowpass', frequency: 5000, Q: 3 },
    gain: 0.3,
  },

  // --- Lo-fi ---
  lofi_keys: {
    name: 'Lo-fi Keys',
    oscillator: { type: 'triangle', detune: 12 },
    envelope: { attack: 0.02, decay: 0.4, sustain: 0.3, release: 0.6 },
    filter: { type: 'lowpass', frequency: 2500, Q: 1.5 },
    gain: 0.4,
  },
  warm_bass: {
    name: 'Warm Bass',
    oscillator: { type: 'sawtooth', detune: 0 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.2 },
    filter: { type: 'lowpass', frequency: 1200, Q: 4 },
    gain: 0.5,
  },

  // --- Classic ---
  pluck: {
    name: 'Pluck',
    oscillator: { type: 'triangle', detune: 0 },
    envelope: { attack: 0.003, decay: 0.25, sustain: 0.0, release: 0.3 },
    filter: { type: 'lowpass', frequency: 6000, Q: 1 },
    gain: 0.5,
  },
  organ: {
    name: 'Organ',
    oscillator: { type: 'sine', detune: 0 },
    envelope: { attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.05 },
    filter: { type: 'lowpass', frequency: 10000, Q: 0.5 },
    gain: 0.4,
  },
};

export class WebAudioSynth {
  constructor() {
    this.engine = AudioEngine.getInstance();
    /** @type {GainNode|null} */
    this._output = null;
    /** Active voice map: midi note → voice object */
    this._voices = new Map();
    /** Voice queue for stealing */
    this._voiceQueue = [];
    /** Current patch */
    this.patch = { ...DEFAULT_PATCH };
  }

  /**
   * Initialize audio nodes. Call after AudioEngine.init().
   */
  init() {
    this._output = this.engine.createTrackBus();
    this._output.gain.value = this.patch.gain;
  }

  /**
   * Load a patch (preset or custom).
   * @param {object} patch - Patch object with oscillator, envelope, filter, gain
   */
  loadPatch(patch) {
    this.patch = {
      name: patch.name || 'Custom',
      oscillator: { ...DEFAULT_PATCH.oscillator, ...patch.oscillator },
      envelope: { ...DEFAULT_PATCH.envelope, ...patch.envelope },
      filter: { ...DEFAULT_PATCH.filter, ...patch.filter },
      gain: patch.gain ?? DEFAULT_PATCH.gain,
    };
    if (this._output) {
      this._output.gain.setTargetAtTime(this.patch.gain, this.engine.currentTime, 0.01);
    }
  }

  /**
   * Export the current patch as a JSON-serializable object.
   * @returns {object}
   */
  exportPatch() {
    return JSON.parse(JSON.stringify(this.patch));
  }

  /**
   * Trigger a note on (start playing).
   * @param {number} midi - MIDI note number
   * @param {number} [velocity=0.8] - Velocity 0–1
   * @param {number} [atTime] - AudioContext time to schedule the note
   */
  noteOn(midi, velocity = 0.8, atTime) {
    if (!this._output) return;

    // If this note is already playing, stop it first
    if (this._voices.has(midi)) {
      this.noteOff(midi);
    }

    // Voice stealing if at max polyphony
    if (this._voices.size >= MAX_VOICES) {
      const oldest = this._voiceQueue.shift();
      if (oldest !== undefined) {
        this.noteOff(oldest);
      }
    }

    const ctx = this.engine.ctx;
    const now = atTime !== undefined ? atTime : ctx.currentTime;
    const p = this.patch;

    // Oscillator
    const osc = ctx.createOscillator();
    osc.type = p.oscillator.type;
    osc.frequency.setValueAtTime(midiToFreq(midi), now);
    osc.detune.setValueAtTime(p.oscillator.detune, now);

    // Filter
    const filter = ctx.createBiquadFilter();
    filter.type = p.filter.type;
    filter.frequency.setValueAtTime(p.filter.frequency, now);
    filter.Q.setValueAtTime(p.filter.Q, now);

    // Envelope (gain)
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    // Attack
    env.gain.linearRampToValueAtTime(velocity, now + p.envelope.attack);
    // Decay → Sustain
    env.gain.linearRampToValueAtTime(
      velocity * p.envelope.sustain,
      now + p.envelope.attack + p.envelope.decay
    );

    // Connect: osc → filter → env → output
    osc.connect(filter);
    filter.connect(env);
    env.connect(this._output);

    osc.start(now);

    // Store voice
    const voice = { osc, filter, env, midi, startTime: now };
    this._voices.set(midi, voice);
    this._voiceQueue.push(midi);
  }

  /**
   * Trigger a note off (release).
   * @param {number} midi - MIDI note number
   * @param {number} [atTime] - AudioContext time to schedule the release
   */
  noteOff(midi, atTime) {
    const voice = this._voices.get(midi);
    if (!voice) return;

    const ctx = this.engine.ctx;
    const now = atTime !== undefined ? atTime : ctx.currentTime;
    const p = this.patch;

    // Release envelope
    voice.env.gain.cancelScheduledValues(now);
    // We use setTargetAtTime for a smoother release instead of linearRamp to avoid clicks if the value isn't exact
    voice.env.gain.setTargetAtTime(0, now, p.envelope.release / 3);

    // Schedule oscillator stop after release
    voice.osc.stop(now + p.envelope.release + 0.1);

    // Remove from map
    this._voices.delete(midi);
    const queueIdx = this._voiceQueue.indexOf(midi);
    if (queueIdx !== -1) this._voiceQueue.splice(queueIdx, 1);
  }

  /**
   * Stop all playing notes immediately.
   */
  allNotesOff() {
    for (const midi of [...this._voices.keys()]) {
      this.noteOff(midi);
    }
  }

  /**
   * Set the synth output volume.
   * @param {number} value - 0–1
   */
  setVolume(value) {
    if (this._output) {
      this._output.gain.setTargetAtTime(value, this.engine.currentTime, 0.01);
    }
  }
}
