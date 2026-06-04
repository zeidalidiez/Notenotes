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
import {
  normalizeVelocityResponse,
  velocityAdjustedDrive,
  velocityAdjustedFilterFrequency,
} from '../engine/VelocityResponse.js';
import { normalizeStereoWidth, panForVoice } from '../engine/StereoWidth.js';
import { adsrEnvelopeValueAt, createEnvelopeParamCurve } from '../engine/EnvelopeCurves.js';
import { pickZone, playableMidi } from './sampleZone.js';
import { humanize } from '../engine/Humanize.js';
import { periodicWaveCoefficients } from '../engine/AdditiveWave.js';
import { renderKarplusStrong } from '../engine/KarplusStrong.js';

/** Maximum simultaneous HELD voices (keys currently down). */
const MAX_VOICES = 8;

/**
 * Hard cap on concurrently-SOUNDING voices (held + still releasing). A noteOff
 * removes a voice from `_voices` immediately, but its source keeps playing until
 * its scheduled stop (release tail). Without a cap on the still-ringing voices,
 * rapid tapping piles up dozens of full-volume sources that the audio render
 * thread must keep mixing — which can overload the thread and crash the tab on
 * Windows Chrome (STATUS_BREAKPOINT). 16 is far above any musical need but well
 * under the danger zone, so normal playing is never affected.
 */
const MAX_SOUNDING_VOICES = 16;

/** Fast release (seconds) for stolen / over-cap voices — quick but click-free. */
const FAST_STEAL_RELEASE = 0.05;
/** Release (seconds) applied to the previous copy when the same note retriggers. */
const FAST_RETRIGGER_RELEASE = 0.06;

/**
 * Sample voices are far heavier than synth oscillators — each is an
 * AudioBufferSourceNode replaying a decoded buffer, which Chrome creates and
 * tears down much less cheaply. Cap their concurrency tighter than synths. 8
 * still leaves a full Extensions (13th = 7-note) chord intact.
 */
const MAX_SOUNDING_SAMPLE_VOICES = 8;

/**
 * Minimum seconds between retriggers of the SAME note. Collapses machine-gun
 * re-strumming / pad-hammering that spawns BufferSources faster than the audio
 * thread can free them (the STATUS_BREAKPOINT / OOM gesture). Distinct notes —
 * i.e. the members of a chord — are unaffected, so chords play in full.
 */
const MIN_RETRIGGER_SEC = 0.035;

export const SOUND_TRAITS = {
  crush: { id: 'crush', name: 'Crush', hint: 'Blocky bitcrush edge', defaultAmount: 0.35 },
  echo: { id: 'echo', name: 'Echo', hint: 'Repeating delay tail', defaultAmount: 0.3 },
  space: { id: 'space', name: 'Space', hint: 'Small room reverb', defaultAmount: 0.25 },
  wobble: { id: 'wobble', name: 'Wobble', hint: 'Smooth filter motion', defaultAmount: 0.3 },
  drive: { id: 'drive', name: 'Drive', hint: 'Warm saturation', defaultAmount: 0.35 },
  noise: { id: 'noise', name: 'Noise', hint: 'Breathy note texture', defaultAmount: 0.2 },
};

export function defaultSoundTraits() {
  return Object.fromEntries(
    Object.values(SOUND_TRAITS).map(trait => [
      trait.id,
      { amount: 0 },
    ])
  );
}

export function normalizeSoundTraits(traits = {}) {
  const normalized = defaultSoundTraits();
  for (const id of Object.keys(normalized)) {
    const incoming = traits?.[id] || {};
    const amount = incoming.enabled === false ? 0 : incoming.amount ?? normalized[id].amount;
    normalized[id] = {
      amount: Math.max(0, Math.min(1, Number(amount) || 0)),
    };
  }
  return normalized;
}

/** Default synth patch */
const DEFAULT_PATCH = {
  name: 'Default',
  family: 'chip',
  schemaVersion: 1,
  oscillator: {
    type: 'triangle',     // sine, square, sawtooth, triangle
    detune: 0,            // cents (-100 to 100)
  },
  oscillator2: null,
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
  drive: 0,
  filterEnv: null,
  vibrato: null,
  unison: null,
  keyTrack: 0,
  velocityResponse: null,
  stereoWidth: 0,
};

/** Built-in preset patches */
export const PRESETS = {
  // --- Retro / Chiptune ---
  chip_lead: {
    name: 'Chip Lead',
    family: 'chip',
    oscillator: { type: 'square', detune: 0 },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0.8, release: 0.1 },
    filter: { type: 'lowpass', frequency: 12000, Q: 0.5 },
    gain: 0.35,
  },
  chip_bass: {
    name: 'Chip Bass',
    family: 'chip',
    oscillator: { type: 'square', detune: 0 },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.15 },
    filter: { type: 'lowpass', frequency: 2000, Q: 2 },
    gain: 0.45,
  },
  cyber_secks: {
    name: 'Cyber Secks',
    family: 'chip',
    oscillator: { type: 'sine', detune: 0 },
    oscillator2: { type: 'sine', detune: 1200, gain: 0.72 },
    envelope: { attack: 0.008, decay: 0.08, sustain: 0.85, release: 0.08 },
    filter: { type: 'bandpass', frequency: 900, Q: 7 },
    gain: 0.32,
    drive: 0.18,
  },
  heartbound: {
    name: 'Heartbound',
    family: 'chip',
    oscillator: { type: 'square', detune: 0 },
    oscillator2: { type: 'triangle', detune: 1200, gain: 0.3 },
    envelope: { attack: 0.004, decay: 0.12, sustain: 0.65, release: 0.16 },
    filter: { type: 'lowpass', frequency: 7200, Q: 0.8 },
    gain: 0.34,
    drive: 0.04,
  },
  triforce: {
    name: 'Triforce',
    family: 'chip',
    oscillator: { type: 'triangle', detune: 0 },
    envelope: { attack: 0.003, decay: 0.1, sustain: 0.78, release: 0.1 },
    filter: { type: 'lowpass', frequency: 9500, Q: 0.4 },
    gain: 0.42,
    drive: 0,
  },
  bliff: {
    name: 'Bliff',
    family: 'chip',
    oscillator: { type: 'sawtooth', detune: -7 },
    oscillator2: { type: 'square', detune: -1200, gain: 0.28 },
    envelope: { attack: 0.004, decay: 0.18, sustain: 0.5, release: 0.12 },
    filter: { type: 'lowpass', frequency: 850, Q: 6 },
    gain: 0.52,
    drive: 0.48,
  },

  // --- Modern / Ambient ---
  soft_pad: {
    name: 'Soft Pad',
    family: 'modern',
    schemaVersion: 2,
    oscillator: { type: 'sine', detune: 4 },
    oscillator2: { type: 'triangle', detune: 1200, gain: 0.16 },
    envelope: { attack: 0.075, decay: 0.56, sustain: 0.72, release: 1.25 },
    filter: { type: 'lowpass', frequency: 2800, Q: 0.72 },
    filterEnv: { attack: 0.05, decay: 0.9, sustain: 0.62, depth: 0.28 },
    vibrato: { rate: 4.1, depth: 4, delay: 0.45 },
    unison: { voices: 3, spread: 10 },
    keyTrack: 0.24,
    velocityResponse: { filter: 0.34, drive: 0.015 },
    stereoWidth: 0.34,
    gain: 0.34,
    drive: 0.012,
  },
  shimmer_lead: {
    name: 'Shimmer Lead',
    family: 'modern',
    schemaVersion: 2,
    oscillator: { type: 'sawtooth', detune: 2 },
    oscillator2: { type: 'sine', detune: 1200, gain: 0.14 },
    envelope: { attack: 0.022, decay: 0.28, sustain: 0.44, release: 0.72 },
    filter: { type: 'lowpass', frequency: 5200, Q: 2.6 },
    filterEnv: { attack: 0.01, decay: 0.34, sustain: 0.26, depth: 0.34 },
    vibrato: { rate: 5.4, depth: 5, delay: 0.16 },
    unison: { voices: 3, spread: 8 },
    keyTrack: 0.3,
    velocityResponse: { filter: 0.42, drive: 0.03 },
    stereoWidth: 0.28,
    gain: 0.28,
    drive: 0.04,
  },

  // --- Lo-fi ---
  lofi_keys: {
    name: 'Lo-fi Keys',
    family: 'modern',
    schemaVersion: 2,
    oscillator: { type: 'triangle', detune: 7 },
    oscillator2: { type: 'sine', detune: 1200, gain: 0.16 },
    envelope: { attack: 0.018, decay: 0.38, sustain: 0.34, release: 0.62 },
    filter: { type: 'lowpass', frequency: 2450, Q: 1.35 },
    filterEnv: { attack: 0.01, decay: 0.42, sustain: 0.24, depth: 0.26 },
    vibrato: { rate: 3.6, depth: 5, delay: 0.12 },
    unison: { voices: 2, spread: 6 },
    keyTrack: 0.22,
    velocityResponse: { filter: 0.36, drive: 0.035 },
    stereoWidth: 0.26,
    gain: 0.34,
    drive: 0.08,
  },
  warm_bass: {
    name: 'Warm Bass',
    family: 'modern',
    schemaVersion: 2,
    oscillator: { type: 'sawtooth', detune: 0 },
    oscillator2: { type: 'square', detune: -1200, gain: 0.16 },
    envelope: { attack: 0.006, decay: 0.28, sustain: 0.44, release: 0.22 },
    filter: { type: 'lowpass', frequency: 1120, Q: 4.2 },
    filterEnv: { attack: 0.003, decay: 0.24, sustain: 0.2, depth: 0.46 },
    unison: { voices: 2, spread: 4 },
    keyTrack: 0.15,
    velocityResponse: { filter: 0.32, drive: 0.06 },
    stereoWidth: 0.16,
    gain: 0.46,
    drive: 0.18,
  },

  // --- Classic ---
  pluck: {
    name: 'Pluck',
    family: 'chip',
    oscillator: { type: 'triangle', detune: 0 },
    envelope: { attack: 0.003, decay: 0.25, sustain: 0.0, release: 0.3 },
    filter: { type: 'lowpass', frequency: 6000, Q: 1 },
    gain: 0.5,
  },
  organ: {
    name: 'Organ',
    family: 'modern',
    schemaVersion: 2,
    oscillator: { type: 'sine', detune: 0 },
    oscillator2: { type: 'sine', detune: 1200, gain: 0.34 },
    envelope: { attack: 0.006, decay: 0.06, sustain: 0.88, release: 0.08 },
    filter: { type: 'lowpass', frequency: 8200, Q: 0.55 },
    filterEnv: { attack: 0.004, decay: 0.18, sustain: 0.7, depth: 0.12 },
    vibrato: { rate: 5.8, depth: 3, delay: 0.22 },
    unison: { voices: 2, spread: 3 },
    keyTrack: 0.08,
    velocityResponse: { filter: 0.22, drive: 0.015 },
    stereoWidth: 0.18,
    gain: 0.34,
    drive: 0.025,
  },
  modern_keys: {
    name: 'Modern Keys',
    family: 'modern',
    schemaVersion: 2,
    oscillator: { type: 'triangle', detune: 0 },
    oscillator2: { type: 'sine', detune: 1200, gain: 0.18 },
    envelope: { attack: 0.018, decay: 0.38, sustain: 0.38, release: 0.72 },
    filter: { type: 'lowpass', frequency: 3100, Q: 1.1 },
    filterEnv: { attack: 0.012, decay: 0.45, sustain: 0.28, depth: 0.42 },
    vibrato: { rate: 4.8, depth: 5, delay: 0.18 },
    unison: { voices: 3, spread: 9 },
    keyTrack: 0.25,
    velocityResponse: { filter: 0.44, drive: 0.025 },
    stereoWidth: 0.3,
    gain: 0.34,
    drive: 0.035,
  },
  modern_pad: {
    name: 'Modern Pad',
    family: 'modern',
    schemaVersion: 2,
    oscillator: { type: 'sawtooth', detune: -3 },
    oscillator2: { type: 'triangle', detune: 1200, gain: 0.22 },
    envelope: { attack: 0.09, decay: 0.8, sustain: 0.74, release: 1.6 },
    filter: { type: 'lowpass', frequency: 2200, Q: 0.8 },
    filterEnv: { attack: 0.07, decay: 1.15, sustain: 0.62, depth: 0.56 },
    vibrato: { rate: 4.2, depth: 7, delay: 0.35 },
    unison: { voices: 3, spread: 14 },
    keyTrack: 0.36,
    velocityResponse: { filter: 0.3, drive: 0.012 },
    stereoWidth: 0.42,
    gain: 0.28,
    drive: 0.015,
  },
  modern_bass: {
    name: 'Modern Bass',
    family: 'modern',
    schemaVersion: 2,
    oscillator: { type: 'sawtooth', detune: 0 },
    oscillator2: { type: 'square', detune: -1200, gain: 0.2 },
    envelope: { attack: 0.006, decay: 0.22, sustain: 0.48, release: 0.18 },
    filter: { type: 'lowpass', frequency: 950, Q: 5 },
    filterEnv: { attack: 0.004, decay: 0.26, sustain: 0.18, depth: 0.68 },
    vibrato: null,
    unison: { voices: 2, spread: 5 },
    keyTrack: 0.18,
    velocityResponse: { filter: 0.34, drive: 0.06 },
    stereoWidth: 0.18,
    gain: 0.46,
    drive: 0.22,
  },
  modern_pluck: {
    name: 'Modern Pluck',
    family: 'modern',
    schemaVersion: 2,
    oscillator: { type: 'triangle', detune: 0 },
    oscillator2: { type: 'sawtooth', detune: 1200, gain: 0.12 },
    envelope: { attack: 0.004, decay: 0.24, sustain: 0.05, release: 0.52 },
    filter: { type: 'lowpass', frequency: 4200, Q: 1.6 },
    filterEnv: { attack: 0.002, decay: 0.22, sustain: 0.05, depth: 0.74 },
    vibrato: { rate: 5.2, depth: 4, delay: 0.2 },
    unison: { voices: 3, spread: 7 },
    keyTrack: 0.42,
    velocityResponse: { filter: 0.48, drive: 0.02 },
    stereoWidth: 0.24,
    gain: 0.36,
    drive: 0.02,
  },

  // --- FM (2-operator) ---
  // `fm.ratio` = modulator:carrier frequency ratio (integer = harmonic/clean,
  // non-integer = inharmonic/metallic). `fm.index` = modulation depth; it decays
  // from `index` toward `index*indexSustain` over `fm.decay` seconds, which is
  // what makes the attack bright and the body mellow.
  fm_epiano: {
    name: 'FM E-Piano',
    family: 'fm',
    type: 'fm',
    oscillator: { type: 'sine', detune: 0 },
    fm: { ratio: 1, index: 2.6, indexSustain: 0.12, decay: 0.22 },
    envelope: { attack: 0.002, decay: 1.4, sustain: 0.28, release: 0.45 },
    filter: { type: 'lowpass', frequency: 9000, Q: 0.5 },
    keyTrack: 0.12,
    velocityResponse: { filter: 0.3, drive: 0 },
    gain: 0.5,
    drive: 0.02,
  },
  fm_bell: {
    name: 'FM Bell',
    family: 'fm',
    type: 'fm',
    oscillator: { type: 'sine', detune: 0 },
    fm: { ratio: 1.41, index: 4.2, indexSustain: 0.4, decay: 1.1 },
    envelope: { attack: 0.001, decay: 2.4, sustain: 0.0, release: 1.4 },
    filter: { type: 'lowpass', frequency: 11000, Q: 0.4 },
    gain: 0.42,
  },
  fm_glass_bass: {
    name: 'FM Glass Bass',
    family: 'fm',
    type: 'fm',
    oscillator: { type: 'sine', detune: 0 },
    fm: { ratio: 0.5, index: 1.6, indexSustain: 0.18, decay: 0.16 },
    envelope: { attack: 0.004, decay: 0.3, sustain: 0.55, release: 0.18 },
    filter: { type: 'lowpass', frequency: 2600, Q: 1.4 },
    keyTrack: 0.2,
    velocityResponse: { filter: 0.34, drive: 0.04 },
    gain: 0.5,
    drive: 0.06,
  },
  fm_mallet: {
    name: 'FM Mallet',
    family: 'fm',
    type: 'fm',
    oscillator: { type: 'sine', detune: 0 },
    fm: { ratio: 3.5, index: 3.2, indexSustain: 0.0, decay: 0.07 },
    envelope: { attack: 0.001, decay: 0.5, sustain: 0.0, release: 0.22 },
    filter: { type: 'lowpass', frequency: 10000, Q: 0.5 },
    gain: 0.46,
  },

  // --- Karplus–Strong pluck ---
  // `pluck.decay` = seconds to ~-60 dB; `pluck.damping` 0 = bright/long,
  // 1 = dark/short. Amp envelope stays high (sustain 1) so the string's own
  // decay dominates; release just rounds off note-off.
  pluck_nylon: {
    name: 'Nylon Guitar',
    family: 'pluck',
    type: 'pluck',
    oscillator: { type: 'sine', detune: 0 },
    pluck: { decay: 1.6, damping: 0.5 },
    envelope: { attack: 0.001, decay: 0.02, sustain: 1, release: 0.12 },
    filter: { type: 'lowpass', frequency: 6000, Q: 0.6 },
    gain: 0.6,
  },
  pluck_harp: {
    name: 'Concert Harp (pluck)',
    family: 'pluck',
    type: 'pluck',
    oscillator: { type: 'sine', detune: 0 },
    pluck: { decay: 2.8, damping: 0.32 },
    envelope: { attack: 0.001, decay: 0.02, sustain: 1, release: 0.18 },
    filter: { type: 'lowpass', frequency: 8200, Q: 0.5 },
    gain: 0.56,
  },
  pluck_koto: {
    name: 'Koto',
    family: 'pluck',
    type: 'pluck',
    oscillator: { type: 'sine', detune: 0 },
    pluck: { decay: 1.9, damping: 0.42 },
    envelope: { attack: 0.001, decay: 0.02, sustain: 1, release: 0.14 },
    filter: { type: 'lowpass', frequency: 7000, Q: 0.7 },
    gain: 0.58,
  },
  pluck_kalimba: {
    name: 'Kalimba (pluck)',
    family: 'pluck',
    type: 'pluck',
    oscillator: { type: 'sine', detune: 0 },
    pluck: { decay: 1.1, damping: 0.62 },
    envelope: { attack: 0.001, decay: 0.02, sustain: 1, release: 0.1 },
    filter: { type: 'lowpass', frequency: 5200, Q: 0.8 },
    gain: 0.6,
  },

  // --- Additive (custom PeriodicWave from harmonic recipes) ---
  // `oscillator.type: 'custom'` + `oscillator.partials` = harmonic amplitudes,
  // fundamental first. Shared with the exporter via AdditiveWave so live and
  // export match exactly.
  add_organ: {
    name: 'Additive Organ',
    family: 'additive',
    oscillator: { type: 'custom', detune: 0, partials: [1, 0.6, 0.8, 0.4, 0, 0.3, 0, 0.2] },
    envelope: { attack: 0.006, decay: 0.06, sustain: 0.9, release: 0.09 },
    filter: { type: 'lowpass', frequency: 9000, Q: 0.4 },
    unison: { voices: 2, spread: 4 },
    stereoWidth: 0.18,
    gain: 0.4,
  },
  add_rhodes: {
    name: 'Additive Rhodes',
    family: 'additive',
    oscillator: { type: 'custom', detune: 0, partials: [1, 0, 0, 0.45, 0, 0.2] },
    envelope: { attack: 0.003, decay: 1.3, sustain: 0.18, release: 0.5 },
    filter: { type: 'lowpass', frequency: 7000, Q: 0.6 },
    keyTrack: 0.18,
    velocityResponse: { filter: 0.34, drive: 0 },
    gain: 0.46,
  },
  add_clarinet: {
    name: 'Additive Clarinet',
    family: 'additive',
    oscillator: { type: 'custom', detune: 0, partials: [1, 0, 0.5, 0, 0.33, 0, 0.25] },
    envelope: { attack: 0.04, decay: 0.2, sustain: 0.88, release: 0.18 },
    filter: { type: 'lowpass', frequency: 6000, Q: 0.5 },
    vibrato: { rate: 5, depth: 4, delay: 0.3 },
    gain: 0.4,
  },
  add_reed: {
    name: 'Additive Reed',
    family: 'additive',
    oscillator: { type: 'custom', detune: 0, partials: [1, 0.5, 0.7, 0.3, 0.4, 0.2, 0.15] },
    envelope: { attack: 0.02, decay: 0.24, sustain: 0.8, release: 0.2 },
    filter: { type: 'lowpass', frequency: 6500, Q: 0.6 },
    unison: { voices: 2, spread: 6 },
    stereoWidth: 0.2,
    gain: 0.38,
  },
  add_glass: {
    name: 'Additive Glass',
    family: 'additive',
    oscillator: { type: 'custom', detune: 0, partials: [1, 0, 0, 0, 0.5, 0, 0, 0, 0.3] },
    envelope: { attack: 0.005, decay: 1.6, sustain: 0.1, release: 0.9 },
    filter: { type: 'lowpass', frequency: 12000, Q: 0.4 },
    gain: 0.4,
  },
};

export class WebAudioSynth {
  constructor() {
    this.engine = AudioEngine.getInstance();
    /** @type {GainNode|null} */
    this._output = null;
    /** Active HELD voice map: midi note → voice object */
    this._voices = new Map();
    /** Voice queue for stealing (oldest-held first) */
    this._voiceQueue = [];
    /** Voices that were released/stolen but whose sources are still ringing out. */
    this._releasing = new Set();
    /** One-time guard so the rapid-retrigger throttle warning logs only once. */
    this._floodWarned = false;
    /** midi → AudioContext time of its last trigger, for the retrigger throttle. */
    this._lastTriggerAt = new Map();
    /** Current patch */
    this.patch = { ...DEFAULT_PATCH };
    this.soundTraits = defaultSoundTraits();
    this._toneInput = null;
    this._effectNodes = [];
    this._lfo = null;
    this._lfoGain = null;
  }

  /**
   * Initialize audio nodes. Call after AudioEngine.init().
   */
  init() {
    if (this._output && this._toneInput) return;
    if (!this.engine.ctx) this.engine.initSync();
    this._output = this.engine.createTrackBus();
    this._output.gain.value = this.patch.gain;
    this._toneInput = this.engine.ctx.createGain();
    this._rebuildEffects();
  }

  /**
   * Load a patch (preset or custom).
   * @param {object} patch - Patch object with oscillator, envelope, filter, gain
   */
  loadPatch(patch) {
    this.patch = {
      name: patch.name || 'Custom',
      family: patch.family || DEFAULT_PATCH.family,
      schemaVersion: patch.schemaVersion || DEFAULT_PATCH.schemaVersion,
      type: patch.type || 'synth',
      sampleBuffer: patch.sampleBuffer || null,
      sampleMap: patch.sampleMap || null,
      rootMidi: patch.rootMidi ?? 60,
      playbackMode: patch.playbackMode || 'gated',
      oscillator: { ...DEFAULT_PATCH.oscillator, ...patch.oscillator },
      oscillator2: patch.oscillator2 ? { ...patch.oscillator2 } : null,
      // Voice-specific param blocks for the FM and Karplus–Strong pluck voices.
      fm: patch.fm ? { ...patch.fm } : null,
      pluck: patch.pluck ? { ...patch.pluck } : null,
      envelope: { ...DEFAULT_PATCH.envelope, ...patch.envelope },
      filter: { ...DEFAULT_PATCH.filter, ...patch.filter },
      gain: patch.gain ?? DEFAULT_PATCH.gain,
      drive: patch.drive ?? DEFAULT_PATCH.drive,
      filterEnv: patch.filterEnv ? { ...patch.filterEnv } : null,
      vibrato: patch.vibrato ? { ...patch.vibrato } : null,
      unison: patch.unison ? { ...patch.unison } : null,
      keyTrack: patch.keyTrack ?? DEFAULT_PATCH.keyTrack,
      velocityResponse: patch.velocityResponse ? normalizeVelocityResponse(patch.velocityResponse) : null,
      stereoWidth: normalizeStereoWidth(patch.stereoWidth ?? DEFAULT_PATCH.stereoWidth),
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

  setSoundTraits(traits = {}) {
    this.soundTraits = normalizeSoundTraits(traits);
    if (this._toneInput && this._output) this._rebuildEffects();
  }

  setPan(pan = 0) {
    if (!this._output) this.init();
    this.engine.setTrackBusPan?.(this._output, pan);
  }

  /**
   * The entry point of the Tone effect chain. Other instruments (e.g.,
   * VoiceEngine) can connect their output here so they share Crush, Echo,
   * Wobble, Drive, Space, Noise without each one rebuilding the chain.
   * Returns null until init() has run.
   */
  getSynthInput() {
    return this._toneInput || null;
  }

  _traitCurve(id) {
    const amount = this._traitAmount(id);
    if (id === 'wobble') return Math.pow(amount, 0.72);
    if (id === 'space') return Math.pow(amount, 0.5);
    return Math.pow(amount, 0.68);
  }

  _filterBaseFrequency(midi, velocity = 0.8) {
    const keyTrack = Math.max(0, Math.min(1, this.patch.keyTrack || 0));
    const base = Math.max(40, Math.min(18000, this.patch.filter.frequency * Math.pow(2, ((midi - 60) / 12) * keyTrack)));
    return velocityAdjustedFilterFrequency(base, velocity, this.patch.velocityResponse);
  }

  _scheduleFilterEnvelope(filter, baseFrequency, now) {
    const env = this.patch.filterEnv;
    if (!env || (env.depth || 0) <= 0) return;
    const attack = Math.max(0.001, env.attack ?? 0.01);
    const decay = Math.max(0.001, env.decay ?? 0.3);
    const sustain = Math.max(0, Math.min(1, env.sustain ?? 0.5));
    const depth = Math.max(0, Math.min(1.5, env.depth ?? 0));
    const openFrequency = Math.max(40, Math.min(19000, baseFrequency * (1 + depth * 4)));
    const sustainFrequency = baseFrequency + (openFrequency - baseFrequency) * sustain;
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(baseFrequency, now);
    filter.frequency.setValueCurveAtTime(createEnvelopeParamCurve(baseFrequency, openFrequency, 'attack'), now, attack);
    filter.frequency.setValueCurveAtTime(createEnvelopeParamCurve(openFrequency, sustainFrequency, 'decay'), now + attack, decay);
  }

  _envelopeLevelAt(envelope, elapsed, velocity = 1) {
    return adsrEnvelopeValueAt(elapsed, Number.POSITIVE_INFINITY, envelope || DEFAULT_PATCH.envelope, velocity);
  }

  _scheduleAmpEnvelope(gainParam, envelope, velocity, now) {
    const attack = Math.max(0.001, envelope.attack || 0.001);
    const decay = Math.max(0.001, envelope.decay || 0.001);
    const sustain = Math.max(0, Math.min(1, envelope.sustain ?? DEFAULT_PATCH.envelope.sustain));
    gainParam.cancelScheduledValues(now);
    gainParam.setValueAtTime(0, now);
    gainParam.setValueCurveAtTime(createEnvelopeParamCurve(0, velocity, 'attack'), now, attack);
    gainParam.setValueCurveAtTime(createEnvelopeParamCurve(velocity, velocity * sustain, 'decay'), now + attack, decay);
  }

  _createOscillatorStack(midi, oscPatch, gainAmount, now, layerOffset = 0, extraDetune = 0) {
    const ctx = this.engine.ctx;
    const unison = this.patch.unison || {};
    const voices = Math.max(1, Math.min(5, Math.round(unison.voices || 1)));
    const spread = Math.max(0, Math.min(40, unison.spread || 0));
    const stereoWidth = normalizeStereoWidth(this.patch.stereoWidth || 0);
    const oscillators = [];
    const oscillatorOutputs = [];
    for (let i = 0; i < voices; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const panner = stereoWidth > 0 && ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const spreadOffset = voices === 1 ? 0 : ((i / (voices - 1)) - 0.5) * spread;
      const oscType = oscPatch.type || this.patch.oscillator.type;
      if (oscType === 'custom') {
        // Additive voice: synthesize from a harmonic recipe. setPeriodicWave
        // replaces the named waveform; the same coefficients are evaluated by
        // the WAV exporter so live and export match.
        osc.setPeriodicWave(this._getPeriodicWave(oscPatch.partials || this.patch.oscillator.partials));
      } else {
        osc.type = oscType;
      }
      osc.frequency.setValueAtTime(midiToFreq(midi), now);
      osc.detune.setValueAtTime((oscPatch.detune || 0) + spreadOffset + extraDetune, now);
      gain.gain.setValueAtTime((gainAmount ?? 1) / voices, now);
      osc.connect(gain);
      if (panner) {
        panner.pan.setValueAtTime(panForVoice(i, voices, stereoWidth, layerOffset), now);
        gain.connect(panner);
      }
      oscillators.push(osc);
      oscillatorOutputs.push(panner || gain);
    }
    return { oscillators, oscillatorGains: oscillatorOutputs };
  }

  /**
   * Build (and cache) a PeriodicWave for an additive harmonic recipe. One wave
   * per distinct recipe is reused across notes. Normalization is disabled so the
   * browser uses our coefficients verbatim — matching the offline exporter.
   * @param {number[]} partials harmonic amplitudes, fundamental first
   */
  _getPeriodicWave(partials) {
    const list = (Array.isArray(partials) && partials.length) ? partials : [1];
    const key = list.join(',');
    if (!this._waveCache) this._waveCache = new Map();
    let wave = this._waveCache.get(key);
    if (!wave) {
      const { real, imag } = periodicWaveCoefficients(list);
      wave = this.engine.ctx.createPeriodicWave(real, imag, { disableNormalization: true });
      this._waveCache.set(key, wave);
    }
    return wave;
  }

  _createVibrato(oscillators, now) {
    const vibrato = this.patch.vibrato;
    if (!vibrato || !oscillators.length || (vibrato.depth || 0) <= 0) return null;
    const ctx = this.engine.ctx;
    const lfo = ctx.createOscillator();
    const gain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(vibrato.rate || 5.5, now);
    gain.gain.setValueAtTime(vibrato.depth || 0, now);
    lfo.connect(gain);
    for (const osc of oscillators) gain.connect(osc.detune);
    lfo.start(now + (vibrato.delay || 0));
    return { lfo, gain };
  }

  /**
   * Trigger a note on (start playing).
   * @param {number} midi - MIDI note number
   * @param {number} [velocity=0.8] - Velocity 0–1
   * @param {number} [atTime] - AudioContext time to schedule the note
   */
  noteOn(midi, velocity = 0.8, atTime) {
    if (!this._output || !this._toneInput) this.init();
    this.engine.unlockGesture?.();
    if (!this._output) return;

    const ctx = this.engine.ctx;
    const now = atTime !== undefined ? atTime : ctx.currentTime;
    const p = this.patch;

    // Per-note retrigger throttle: drop spurious rapid re-triggers of the SAME
    // note before they allocate a voice/BufferSource. Uses the audio clock, so a
    // chord (distinct notes at the same instant) is never throttled.
    const lastTrig = this._lastTriggerAt.get(midi);
    if (lastTrig !== undefined && (now - lastTrig) < MIN_RETRIGGER_SEC) return;
    this._lastTriggerAt.set(midi, now);

    // If this note is already playing, release the old copy quickly so a fast
    // retrigger doesn't leave a full-length duplicate ringing out.
    if (this._voices.has(midi)) {
      this._releaseVoice(this._voices.get(midi), now, FAST_RETRIGGER_RELEASE);
    }

    // Voice stealing at max HELD polyphony — a stolen voice yields fast.
    if (this._voices.size >= MAX_VOICES) {
      const oldest = this._voiceQueue.shift();
      const stolen = oldest !== undefined ? this._voices.get(oldest) : null;
      if (stolen) this._releaseVoice(stolen, now, FAST_STEAL_RELEASE);
    }

    if (p.type === 'sample' && (p.sampleBuffer || (p.sampleMap && p.sampleMap.length))) {
      const hasMap = !!(p.sampleMap && p.sampleMap.length);
      // Fold notes far outside the sampled range back in by octaves, so every note
      // stays audible (and in key) rather than pitched into near-silence.
      const playMidi = hasMap ? playableMidi(p.sampleMap, midi) : midi;
      const zone = hasMap ? pickZone(p.sampleMap, playMidi) : null;
      const sampleBuffer = zone ? zone.buffer : p.sampleBuffer;
      const sampleRoot = zone ? zone.rootMidi : (p.rootMidi ?? 60);
      if (!sampleBuffer) return;
      const source = ctx.createBufferSource();
      source.buffer = sampleBuffer;
      source.playbackRate.setValueAtTime(Math.pow(2, (playMidi - sampleRoot) / 12), now);

      const filter = ctx.createBiquadFilter();
      filter.type = p.filter.type;
      const baseFilterFreq = this._filterBaseFrequency(midi, velocity);
      filter.frequency.setValueAtTime(baseFilterFreq, now);
      this._scheduleFilterEnvelope(filter, baseFilterFreq, now);
      filter.Q.setValueAtTime(p.filter.Q, now);

      const env = ctx.createGain();
      this._scheduleAmpEnvelope(env.gain, p.envelope, velocity, now);

      source.connect(filter);
      filter.connect(env);
      env.connect(this._toneInput || this._output);
      source.start(now);

      const voice = { source, filter, env, midi, startTime: now, velocity, sample: true };
      // Register + wire identity-guarded teardown on the source's 'ended' event.
      // Without prompt teardown, fast retriggering piles up BufferSource/filter/
      // gain nodes faster than GC frees them (STATUS_BREAKPOINT/OOM).
      this._registerVoice(voice, midi, source);

      if (p.playbackMode === 'oneShot') {
        const stopAt = now + (sampleBuffer.duration / source.playbackRate.value) + 0.05;
        try { source.stop(stopAt); } catch (_) {}
      }
      // Keep the number of still-ringing voices bounded (rapid-retrigger guard).
      this._enforceSoundingCap(now);
      return;
    }

    if (p.type === 'fm') {
      // 2-operator FM: a modulator oscillator drives the carrier's frequency. A
      // fast decay on the modulation index gives the classic clangy-attack →
      // mellow-body motion. The WAV exporter mirrors the same instantaneous-
      // frequency math so exports match.
      const fm = p.fm || {};
      const ratio = Math.max(0.01, Number(fm.ratio ?? 2));
      const index = Math.max(0, Number(fm.index ?? 3));
      const indexSustain = Math.max(0, Math.min(1, Number(fm.indexSustain ?? 0)));
      const modDecay = Math.max(0.005, Number(fm.decay ?? 0.4));
      const hf = humanize(0.7);
      const carrierFreq = midiToFreq(midi);
      const modFreq = carrierFreq * ratio;

      const carrier = ctx.createOscillator();
      carrier.type = p.oscillator.type === 'custom' ? 'sine' : (p.oscillator.type || 'sine');
      carrier.frequency.setValueAtTime(carrierFreq, now);
      carrier.detune.setValueAtTime((p.oscillator.detune || 0) + hf.detuneCents, now);

      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.setValueAtTime(modFreq, now);
      const modGain = ctx.createGain();
      const peakDev = index * modFreq; // peak carrier-frequency deviation (Hz)
      modGain.gain.setValueAtTime(peakDev, now);
      modGain.gain.setTargetAtTime(peakDev * indexSustain, now, modDecay);
      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      const filter = ctx.createBiquadFilter();
      filter.type = p.filter.type;
      const baseFilterFreq = this._filterBaseFrequency(midi, velocity);
      filter.frequency.setValueAtTime(baseFilterFreq, now);
      this._scheduleFilterEnvelope(filter, baseFilterFreq, now);
      filter.Q.setValueAtTime(p.filter.Q, now);

      const driveAmount = velocityAdjustedDrive(p.drive, velocity, p.velocityResponse);
      const drive = driveAmount > 0 ? ctx.createWaveShaper() : null;
      if (drive) { drive.curve = this._makeDriveCurve(driveAmount); drive.oversample = '2x'; }

      const env = ctx.createGain();
      this._scheduleAmpEnvelope(env.gain, p.envelope, velocity * hf.gainMul, now);

      const toneInput = drive || filter;
      carrier.connect(toneInput);
      if (drive) drive.connect(filter);
      filter.connect(env);
      env.connect(this._toneInput || this._output);

      const vibrato = this._createVibrato([carrier], now);
      carrier.start(now);
      mod.start(now);

      const voice = { oscillators: [carrier], fmMod: mod, fmModGain: modGain, vibrato, filter, env, midi, startTime: now, velocity };
      this._registerVoice(voice, midi, carrier);
      this._enforceSoundingCap(now);
      return;
    }

    if (p.type === 'pluck') {
      // Karplus–Strong plucked string, synthesized into a buffer (works at every
      // pitch — unlike a live feedback DelayNode loop, which Web Audio mutes for
      // sub-render-quantum delays) and played back. The same renderer feeds the
      // WAV exporter, so live and export are identical.
      const pl = p.pluck || {};
      const decaySec = Math.max(0.15, Number(pl.decay ?? 1.8));
      const damping = Math.max(0, Math.min(1, Number(pl.damping ?? 0.5)));
      const lifetime = decaySec + 0.2;

      const samples = renderKarplusStrong({
        freq: midiToFreq(midi),
        sampleRate: ctx.sampleRate,
        durationSec: lifetime,
        decaySec,
        damping,
        // Velocity is applied once, at the amp envelope (like every other voice),
        // so the offline exporter can match without double-scaling.
        velocity: 1,
      });
      const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buf.getChannelData(0).set(samples);
      const source = ctx.createBufferSource();
      source.buffer = buf;

      const filter = ctx.createBiquadFilter();
      filter.type = p.filter.type;
      const baseFilterFreq = this._filterBaseFrequency(midi, velocity);
      filter.frequency.setValueAtTime(baseFilterFreq, now);
      this._scheduleFilterEnvelope(filter, baseFilterFreq, now);
      filter.Q.setValueAtTime(p.filter.Q, now);

      const env = ctx.createGain();
      this._scheduleAmpEnvelope(env.gain, p.envelope, velocity, now);

      source.connect(filter);
      filter.connect(env);
      env.connect(this._toneInput || this._output);
      source.start(now);

      const voice = { source, filter, env, midi, startTime: now, velocity, pluck: true };
      this._registerVoice(voice, midi, source);
      this._enforceSoundingCap(now);
      return;
    }

    // Filter
    const filter = ctx.createBiquadFilter();
    filter.type = p.filter.type;
    const baseFilterFreq = this._filterBaseFrequency(midi, velocity);
    filter.frequency.setValueAtTime(baseFilterFreq, now);
    this._scheduleFilterEnvelope(filter, baseFilterFreq, now);
    filter.Q.setValueAtTime(p.filter.Q, now);

    const h = humanize(0.7); // subtle per-note pitch drift + level variation
    const driveAmount = velocityAdjustedDrive(p.drive, velocity, p.velocityResponse);
    const drive = driveAmount > 0 ? ctx.createWaveShaper() : null;
    if (drive) {
      drive.curve = this._makeDriveCurve(driveAmount);
      drive.oversample = '2x';
    }

    // Envelope (gain)
    const env = ctx.createGain();
    this._scheduleAmpEnvelope(env.gain, p.envelope, velocity * h.gainMul, now);

    // Connect: osc → filter → env → output
    const { oscillators, oscillatorGains } = this._createOscillatorStack(midi, p.oscillator, 1, now, 0, h.detuneCents);
    const { oscillators: oscillators2, oscillatorGains: oscillator2Gains } = p.oscillator2
      ? this._createOscillatorStack(midi, {
        type: p.oscillator2.type || p.oscillator.type,
        detune: p.oscillator2.detune || 0,
      }, p.oscillator2.gain ?? 0.35, now, -1, h.detuneCents)
      : { oscillators: [], oscillatorGains: [] };

    const toneInput = drive || filter;
    for (const gainNode of oscillatorGains) gainNode.connect(toneInput);
    for (const gainNode of oscillator2Gains) gainNode.connect(toneInput);
    const noise = this._createVoiceNoise(now);
    if (noise) noise.gain.connect(toneInput);
    if (drive) drive.connect(filter);
    filter.connect(env);
    env.connect(this._toneInput || this._output);

    const vibrato = this._createVibrato(oscillators.concat(oscillators2), now);
    for (const osc of oscillators.concat(oscillators2)) osc.start(now);
    if (noise) noise.source.start(now);

    // Store voice. Dispose nodes once the voice's first oscillator stops (via
    // noteOff / stealing / panic), mirroring the sample path so rapid
    // retriggering can't pile up nodes.
    const voice = { oscillators, oscillators2, vibrato, noise, filter, env, midi, startTime: now, velocity };
    this._registerVoice(voice, midi, oscillators[0]);
    this._enforceSoundingCap(now);
  }

  /**
   * Trigger a note off (release).
   * @param {number} midi - MIDI note number
   * @param {number} [atTime] - AudioContext time to schedule the release
   */
  noteOff(midi, atTime) {
    const voice = this._voices.get(midi);
    if (!voice) return;
    const now = atTime !== undefined ? atTime : this.engine.ctx.currentTime;
    this._releaseVoice(voice, now, this.patch.envelope.release);
  }

  /**
   * Stop all playing notes immediately.
   */
  allNotesOff() {
    for (const midi of [...this._voices.keys()]) {
      this.noteOff(midi);
    }
  }

  panic() {
    const now = this.engine.currentTime;
    for (const voice of this._voices.values()) {
      this._stopVoiceSources(voice, now);
      this._disposeVoiceNodes(voice);
    }
    for (const voice of this._releasing) {
      this._stopVoiceSources(voice, now);
      this._disposeVoiceNodes(voice);
    }
    this._voices.clear();
    this._voiceQueue = [];
    this._releasing.clear();
    if (this._toneInput && this._output) this._rebuildEffects();
  }

  /**
   * Disconnect a voice's nodes so the audio renderer frees them promptly instead
   * of waiting on GC. Safe to call more than once; never throws.
   */
  _disposeVoiceNodes(voice) {
    if (!voice) return;
    const drop = (node) => { try { node && node.disconnect(); } catch (_) {} };
    drop(voice.source); drop(voice.filter); drop(voice.env);
    for (const o of voice.oscillators || []) drop(o);
    for (const o of voice.oscillators2 || []) drop(o);
    if (voice.fmMod) { drop(voice.fmMod); drop(voice.fmModGain); }
    if (voice.noise) { drop(voice.noise.source); drop(voice.noise.gain); }
    if (voice.vibrato) { drop(voice.vibrato.lfo); drop(voice.vibrato.gain); }
  }

  /**
   * Register a freshly built voice: track it as held, queue it for stealing, and
   * wire a one-time 'ended' cleanup on its terminal node (sample source or first
   * oscillator) so its graph is torn down the instant playback ends or is stopped.
   */
  _registerVoice(voice, midi, endNode) {
    voice.midi = midi;
    voice._releasing = false;
    this._voices.set(midi, voice);
    this._voiceQueue.push(midi);
    if (endNode && typeof endNode.addEventListener === 'function') {
      endNode.addEventListener('ended', () => this._onVoiceEnded(voice), { once: true });
    }
  }

  /** Terminal node finished — forget the voice and free its graph. */
  _onVoiceEnded(voice) {
    this._forgetVoice(voice);
    this._disposeVoiceNodes(voice);
  }

  /** Drop a voice from every bookkeeping structure (identity-guarded). */
  _forgetVoice(voice) {
    if (!voice) return;
    if (this._voices.get(voice.midi) === voice) {
      this._voices.delete(voice.midi);
      const qi = this._voiceQueue.indexOf(voice.midi);
      if (qi !== -1) this._voiceQueue.splice(qi, 1);
    }
    this._releasing.delete(voice);
  }

  /**
   * Move a sounding voice into its release phase: fade the amp envelope to zero
   * and schedule its sources to stop. The voice stays tracked in `_releasing`
   * (so it still counts toward the sounding cap) until its 'ended' fires.
   * Safe to call once per voice; subsequent calls are ignored.
   */
  _releaseVoice(voice, now, releaseSec) {
    if (!voice || voice._releasing) return;
    voice._releasing = true;
    // No longer a held voice (so it can't be re-stolen or double-released).
    if (this._voices.get(voice.midi) === voice) {
      this._voices.delete(voice.midi);
      const qi = this._voiceQueue.indexOf(voice.midi);
      if (qi !== -1) this._voiceQueue.splice(qi, 1);
    }
    this._releasing.add(voice);

    const rel = Math.max(0.005, Number(releaseSec) || 0.005);
    try {
      const g = voice.env && voice.env.gain;
      if (g) {
        const level = this._envelopeLevelAt(this.patch.envelope, now - (voice.startTime ?? now), voice.velocity ?? 1);
        // cancelAndHoldAtTime cleanly truncates an in-flight envelope curve at
        // `now`; falling back to cancelScheduledValues for older engines. This
        // avoids scheduling a value INSIDE an active setValueCurve window (which
        // Chrome treats as an error).
        if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
        else g.cancelScheduledValues(now);
        g.setValueAtTime(Math.max(0.0001, level), now);
        g.setTargetAtTime(0, now, rel / 3);
      }
    } catch (_) { /* scheduling is best-effort; never let it bubble into input handlers */ }

    this._stopVoiceSources(voice, now + rel + 0.1);
  }

  /** Stop every source / oscillator a voice owns. Idempotent; never throws. */
  _stopVoiceSources(voice, when) {
    if (!voice) return;
    const stop = (node) => { if (node) { try { node.stop(when); } catch (_) {} } };
    stop(voice.source);
    stop(voice.osc); stop(voice.osc2);
    for (const o of voice.oscillators || []) stop(o);
    for (const o of voice.oscillators2 || []) stop(o);
    if (voice.fmMod) stop(voice.fmMod);
    if (voice.vibrato && voice.vibrato.lfo) stop(voice.vibrato.lfo);
    if (voice.noise) stop(voice.noise.source);
  }

  /**
   * Hard cap on concurrently-sounding voices (held + releasing). Rapid tapping
   * otherwise piles up released-but-still-ringing voices — their stop is
   * scheduled ahead in time, so the audio render thread keeps mixing all of
   * them. Past a few dozen full-volume sample voices that overloads the render
   * thread and crashes the tab on Windows Chrome (STATUS_BREAKPOINT). We retire
   * the oldest still-ringing voices first with a tiny fade so the cull is
   * click-free, and warn once so the throttle is observable in the console.
   */
  _enforceSoundingCap(now) {
    const cap = (this.patch && this.patch.type === 'sample') ? MAX_SOUNDING_SAMPLE_VOICES : MAX_SOUNDING_VOICES;
    let culled = false;
    let guard = 0;
    while (this._voices.size + this._releasing.size > cap && this._releasing.size > 0 && guard++ < 512) {
      const oldest = this._releasing.values().next().value; // Set preserves insertion (age) order
      if (!oldest) break;
      this._retireVoiceNow(oldest, now);
      culled = true;
    }
    if (culled && !this._floodWarned) {
      this._floodWarned = true;
      try {
        console.warn('[WebAudioSynth] sounding-voice cap engaged — rapid retrigger is being throttled to protect the audio thread.');
      } catch (_) {}
    }
  }

  /**
   * Retire a voice almost immediately (a few-ms fade to avoid a click), then let
   * its 'ended' handler free the nodes. Used by the sounding-voice cap.
   */
  _retireVoiceNow(voice, now) {
    if (!voice) return;
    this._releasing.delete(voice);
    if (this._voices.get(voice.midi) === voice) {
      this._voices.delete(voice.midi);
      const qi = this._voiceQueue.indexOf(voice.midi);
      if (qi !== -1) this._voiceQueue.splice(qi, 1);
    }
    try {
      const g = voice.env && voice.env.gain;
      if (g) {
        if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
        else g.cancelScheduledValues(now);
        g.setTargetAtTime(0, now, 0.004);
      }
    } catch (_) {}
    this._stopVoiceSources(voice, now + 0.02);
  }

  /** Live voice counts — handy for debugging rapid-retrigger behaviour. */
  voiceStats() {
    return {
      held: this._voices.size,
      releasing: this._releasing.size,
      sounding: this._voices.size + this._releasing.size,
      maxSounding: MAX_SOUNDING_VOICES,
    };
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

  _makeDriveCurve(amount) {
    const samples = 256;
    const curve = new Float32Array(samples);
    const k = Math.max(0, amount) * 70;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  _traitAmount(id) {
    const trait = this.soundTraits?.[id];
    return Math.max(0, Math.min(1, trait.amount ?? 0));
  }

  _rebuildEffects() {
    const ctx = this.engine.ctx;
    if (!ctx || !this._toneInput || !this._output) return;

    try { this._toneInput.disconnect(); } catch (_) {}
    for (const node of this._effectNodes) {
      try { node.disconnect(); } catch (_) {}
    }
    if (this._lfo) {
      try { this._lfo.stop(); } catch (_) {}
      try { this._lfo.disconnect(); } catch (_) {}
    }
    if (this._lfoGain) {
      try { this._lfoGain.disconnect(); } catch (_) {}
    }
    this._effectNodes = [];
    this._lfo = null;
    this._lfoGain = null;

    let current = this._toneInput;

    const crushAmount = this._traitCurve('crush');
    if (crushAmount > 0) {
      const crush = ctx.createWaveShaper();
      crush.curve = this._makeCrushCurve(crushAmount);
      current.connect(crush);
      current = crush;
      this._effectNodes.push(crush);
    }

    const driveAmount = this._traitCurve('drive');
    if (driveAmount > 0) {
      const drive = ctx.createWaveShaper();
      drive.curve = this._makeDriveCurve(driveAmount * 1.25);
      drive.oversample = '2x';
      current.connect(drive);
      current = drive;
      this._effectNodes.push(drive);
    }

    const wobbleAmount = this._traitCurve('wobble');
    if (wobbleAmount > 0) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1100 + (1 - wobbleAmount) * 5200, ctx.currentTime);
      filter.Q.setValueAtTime(0.7 + wobbleAmount * 3.2, ctx.currentTime);
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.35 + wobbleAmount * 4.2;
      lfoGain.gain.value = 180 + wobbleAmount * 1300;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();
      current.connect(filter);
      current = filter;
      this._lfo = lfo;
      this._lfoGain = lfoGain;
      this._effectNodes.push(filter);
    }

    const dryOut = ctx.createGain();
    dryOut.gain.value = 1;
    current.connect(dryOut);
    dryOut.connect(this._output);
    this._effectNodes.push(dryOut);

    const echoAmount = this._traitCurve('echo');
    if (echoAmount > 0) {
      const delay = ctx.createDelay(1);
      const feedback = ctx.createGain();
      const feedbackFilter = ctx.createBiquadFilter();
      const wet = ctx.createGain();
      delay.delayTime.value = 0.12 + echoAmount * 0.38;
      feedback.gain.value = 0.18 + echoAmount * 0.42;
      feedbackFilter.type = 'lowpass';
      feedbackFilter.frequency.value = 4200 - echoAmount * 1500;
      feedbackFilter.Q.value = 0.55;
      wet.gain.value = 0.06 + echoAmount * 0.42;
      current.connect(delay);
      delay.connect(feedback);
      feedback.connect(feedbackFilter);
      feedbackFilter.connect(delay);
      delay.connect(wet);
      wet.connect(this._output);
      this._effectNodes.push(delay, feedback, feedbackFilter, wet);
    }

    const spaceAmount = this._traitCurve('space');
    if (spaceAmount > 0) {
      const convolver = ctx.createConvolver();
      const wet = ctx.createGain();
      convolver.buffer = this._makeImpulse(0.8 + spaceAmount * 3.4, 0.9 + spaceAmount * 2.1);
      wet.gain.value = 0.18 + spaceAmount * 0.74;
      current.connect(convolver);
      convolver.connect(wet);
      wet.connect(this._output);
      this._effectNodes.push(convolver, wet);
    }
  }

  _makeCrushCurve(amount) {
    const samples = 256;
    const curve = new Float32Array(samples);
    const steps = Math.max(2, Math.round(72 - amount * 70));
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
  }

  _makeImpulse(duration, decay) {
    const ctx = this.engine.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    const preDelay = Math.floor(ctx.sampleRate * 0.018);
    const reflections = [0.023, 0.041, 0.067, 0.109, 0.163, 0.251];
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < length; i++) {
        if (i < preDelay) {
          data[i] = 0;
          continue;
        }
        const t = i / length;
        const noise = Math.random() * 2 - 1;
        low = low * 0.82 + noise * 0.18;
        const bright = noise * Math.max(0, 1 - t * 2.2);
        const tail = low * Math.pow(1 - t, decay);
        data[i] = (tail * 0.78 + bright * 0.22) * (channel === 0 ? 1 : -0.94);
      }
      for (let r = 0; r < reflections.length; r++) {
        const idx = Math.floor(reflections[r] * ctx.sampleRate * (channel ? 1.08 : 1));
        if (idx < length) data[idx] += (0.32 / (r + 1)) * (channel ? -1 : 1);
      }
    }
    return impulse;
  }

  _createVoiceNoise(now) {
    const amount = this._traitCurve('noise');
    const ctx = this.engine.ctx;
    if (!ctx || amount <= 0) return null;
    const drive = this._traitCurve('drive');

    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.8));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = last * 0.72 + (Math.random() * 2 - 1) * 0.28;
      data[i] = last;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    const driveDucking = Math.pow(1 - drive * 0.78, 2);
    gain.gain.setValueAtTime((0.045 + amount * 0.26) * driveDucking, now);
    source.connect(gain);
    return { source, gain };
  }
}
