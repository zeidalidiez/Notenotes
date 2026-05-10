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

export const SOUND_TRAITS = {
  crush: { id: 'crush', name: 'Crush', hint: 'Blocky bitcrush edge', defaultAmount: 0.35 },
  echo: { id: 'echo', name: 'Echo', hint: 'Repeating delay tail', defaultAmount: 0.3 },
  space: { id: 'space', name: 'Space', hint: 'Small room reverb', defaultAmount: 0.25 },
  wobble: { id: 'wobble', name: 'Wobble', hint: 'Moving filter pulse', defaultAmount: 0.3 },
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
  cyber_secks: {
    name: 'Cyber Secks',
    oscillator: { type: 'sine', detune: 0 },
    oscillator2: { type: 'sine', detune: 1200, gain: 0.72 },
    envelope: { attack: 0.008, decay: 0.08, sustain: 0.85, release: 0.08 },
    filter: { type: 'bandpass', frequency: 900, Q: 7 },
    gain: 0.32,
    drive: 0.18,
  },
  heartbound: {
    name: 'Heartbound',
    oscillator: { type: 'square', detune: 0 },
    oscillator2: { type: 'triangle', detune: 1200, gain: 0.3 },
    envelope: { attack: 0.004, decay: 0.12, sustain: 0.65, release: 0.16 },
    filter: { type: 'lowpass', frequency: 7200, Q: 0.8 },
    gain: 0.34,
    drive: 0.04,
  },
  triforce: {
    name: 'Triforce',
    oscillator: { type: 'triangle', detune: 0 },
    envelope: { attack: 0.003, decay: 0.1, sustain: 0.78, release: 0.1 },
    filter: { type: 'lowpass', frequency: 9500, Q: 0.4 },
    gain: 0.42,
    drive: 0,
  },
  bliff: {
    name: 'Bliff',
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
      type: patch.type || 'synth',
      sampleBuffer: patch.sampleBuffer || null,
      rootMidi: patch.rootMidi ?? 60,
      playbackMode: patch.playbackMode || 'gated',
      oscillator: { ...DEFAULT_PATCH.oscillator, ...patch.oscillator },
      oscillator2: patch.oscillator2 ? { ...patch.oscillator2 } : null,
      envelope: { ...DEFAULT_PATCH.envelope, ...patch.envelope },
      filter: { ...DEFAULT_PATCH.filter, ...patch.filter },
      gain: patch.gain ?? DEFAULT_PATCH.gain,
      drive: patch.drive ?? DEFAULT_PATCH.drive,
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
    if (id === 'wobble') return Math.pow(amount, 0.55);
    if (id === 'space') return Math.pow(amount, 0.5);
    return Math.pow(amount, 0.68);
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

    if (p.type === 'sample' && p.sampleBuffer) {
      const source = ctx.createBufferSource();
      source.buffer = p.sampleBuffer;
      source.playbackRate.setValueAtTime(Math.pow(2, (midi - (p.rootMidi ?? 60)) / 12), now);

      const filter = ctx.createBiquadFilter();
      filter.type = p.filter.type;
      filter.frequency.setValueAtTime(p.filter.frequency, now);
      filter.Q.setValueAtTime(p.filter.Q, now);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(velocity, now + p.envelope.attack);
      env.gain.linearRampToValueAtTime(
        velocity * p.envelope.sustain,
        now + p.envelope.attack + p.envelope.decay
      );

      source.connect(filter);
      filter.connect(env);
      env.connect(this._toneInput || this._output);
      source.start(now);

      const voice = { source, filter, env, midi, startTime: now, sample: true };
      this._voices.set(midi, voice);
      this._voiceQueue.push(midi);

      if (p.playbackMode === 'oneShot') {
        const stopAt = now + (p.sampleBuffer.duration / source.playbackRate.value) + 0.05;
        source.stop(stopAt);
        source.addEventListener('ended', () => {
          this._voices.delete(midi);
          const queueIdx = this._voiceQueue.indexOf(midi);
          if (queueIdx !== -1) this._voiceQueue.splice(queueIdx, 1);
        }, { once: true });
      }
      return;
    }

    // Oscillator
    const osc = ctx.createOscillator();
    osc.type = p.oscillator.type;
    osc.frequency.setValueAtTime(midiToFreq(midi), now);
    osc.detune.setValueAtTime(p.oscillator.detune, now);

    let osc2 = null;
    let osc2Gain = null;
    if (p.oscillator2) {
      osc2 = ctx.createOscillator();
      osc2.type = p.oscillator2.type || p.oscillator.type;
      osc2.frequency.setValueAtTime(midiToFreq(midi), now);
      osc2.detune.setValueAtTime(p.oscillator2.detune || 0, now);
      osc2Gain = ctx.createGain();
      osc2Gain.gain.setValueAtTime(p.oscillator2.gain ?? 0.35, now);
    }

    // Filter
    const filter = ctx.createBiquadFilter();
    filter.type = p.filter.type;
    filter.frequency.setValueAtTime(p.filter.frequency, now);
    filter.Q.setValueAtTime(p.filter.Q, now);

    const drive = p.drive > 0 ? ctx.createWaveShaper() : null;
    if (drive) {
      drive.curve = this._makeDriveCurve(p.drive);
      drive.oversample = '2x';
    }

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
    const toneInput = drive || filter;
    osc.connect(toneInput);
    if (osc2 && osc2Gain) {
      osc2.connect(osc2Gain);
      osc2Gain.connect(toneInput);
    }
    const noise = this._createVoiceNoise(now);
    if (noise) noise.gain.connect(toneInput);
    if (drive) drive.connect(filter);
    filter.connect(env);
    env.connect(this._toneInput || this._output);

    osc.start(now);
    if (osc2) osc2.start(now);
    if (noise) noise.source.start(now);

    // Store voice
    const voice = { osc, osc2, noise, filter, env, midi, startTime: now };
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
    const stopAt = now + p.envelope.release + 0.1;
    if (voice.source) { try { voice.source.stop(stopAt); } catch (_) {} }
    if (voice.osc) { try { voice.osc.stop(stopAt); } catch (_) {} }
    if (voice.osc2) { try { voice.osc2.stop(stopAt); } catch (_) {} }
    if (voice.noise) { try { voice.noise.source.stop(stopAt); } catch (_) {} }

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
      filter.frequency.setValueAtTime(650 + (1 - wobbleAmount) * 6800, ctx.currentTime);
      filter.Q.setValueAtTime(1 + wobbleAmount * 11, ctx.currentTime);
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.8 + wobbleAmount * 6.5;
      lfoGain.gain.value = 450 + wobbleAmount * 2700;
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
      const wet = ctx.createGain();
      delay.delayTime.value = 0.12 + echoAmount * 0.38;
      feedback.gain.value = 0.24 + echoAmount * 0.54;
      wet.gain.value = 0.08 + echoAmount * 0.6;
      current.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(this._output);
      this._effectNodes.push(delay, feedback, wet);
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
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }

  _createVoiceNoise(now) {
    const amount = this._traitCurve('noise');
    const ctx = this.engine.ctx;
    if (!ctx || amount <= 0) return null;

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
    gain.gain.setValueAtTime(0.08 + amount * 0.45, now);
    source.connect(gain);
    return { source, gain };
  }
}
