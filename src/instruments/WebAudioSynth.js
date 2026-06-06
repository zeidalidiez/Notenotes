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
import { adsrEnvelopeValueAt, createAttackDecayCurve } from '../engine/EnvelopeCurves.js';
import { pickZone, playableMidi } from './sampleZone.js';
import { humanize } from '../engine/Humanize.js';

/** Maximum simultaneous voices */
const MAX_VOICES = 8;

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

/** Built-in preset patches — extracted to ./synthPresets.js (re-exported for backward compatibility). */
export { PRESETS } from './synthPresets.js';

export class WebAudioSynth {
  constructor() {
    this.engine = AudioEngine.getInstance();
    /** @type {GainNode|null} */
    this._output = null;
    /** Active voice map: midi note → voice object */
    this._voices = new Map();
    /** Voice queue for stealing */
    this._voiceQueue = [];
    /** Live sample sources in trigger order; hard-bounds concurrent BufferSource nodes */
    this._liveSampleSources = [];
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
    // One combined attack+decay curve: two adjacent setValueCurveAtTime calls
    // overlap when Chrome quantizes the decay's start frame onto the attack's
    // end frame (NotSupportedError on fast retrigger).
    filter.frequency.setValueCurveAtTime(createAttackDecayCurve(baseFrequency, openFrequency, sustainFrequency, attack, decay), now, attack + decay);
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
    // One combined attack+decay curve so the decay never starts on the same
    // quantized render frame the attack ends on (Chrome NotSupportedError).
    gainParam.setValueCurveAtTime(createAttackDecayCurve(0, velocity, velocity * sustain, attack, decay), now, attack + decay);
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
      osc.type = oscPatch.type || this.patch.oscillator.type;
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

      // Hard-cap concurrently-live sample sources independent of the _voices map.
      // Retriggering the same pad keeps _voices at 1 (the future-stop on the old
      // source never frees it), so without this ceiling fast pads pile up hundreds
      // of live resamplers and crash the tab. Stop the oldest at `now` instead.
      while (this._liveSampleSources.length >= MAX_VOICES) {
        this._stopSampleSourceNow(this._liveSampleSources.shift(), now);
      }
      source.start(now);

      const voice = { source, filter, env, midi, startTime: now, velocity, sample: true };
      this._voices.set(midi, voice);
      this._voiceQueue.push(midi);
      const liveEntry = { source, env };
      this._liveSampleSources.push(liveEntry);

      // Always clean up when the sample finishes OR is stopped (gated + oneShot).
      // Without this, fast retriggering piles up BufferSource/filter/gain nodes
      // faster than GC frees them, which can crash the tab (STATUS_BREAKPOINT/OOM).
      // The identity guard stops a finishing old voice from evicting a newer one
      // that reused the same midi key.
      source.addEventListener('ended', () => {
        if (this._voices.get(midi) === voice) {
          this._voices.delete(midi);
          const queueIdx = this._voiceQueue.indexOf(midi);
          if (queueIdx !== -1) this._voiceQueue.splice(queueIdx, 1);
        }
        const liveIdx = this._liveSampleSources.indexOf(liveEntry);
        if (liveIdx !== -1) this._liveSampleSources.splice(liveIdx, 1);
        this._disposeVoiceNodes(voice);
      }, { once: true });

      if (p.playbackMode === 'oneShot') {
        const stopAt = now + (sampleBuffer.duration / source.playbackRate.value) + 0.05;
        try { source.stop(stopAt); } catch (_) {}
      }
      return;
    }

    if (p.type === 'fm') {
      // 2-operator FM: a modulator oscillator drives the carrier's frequency. A
      // fast decay on the modulation index gives the classic clangy-attack →
      // mellow-body motion. The WavExporter mirrors the same instantaneous-
      // frequency math so exports match.
      const fm = p.fm || {};
      const ratio = Math.max(0.01, Number(fm.ratio ?? 2));
      const index = Math.max(0, Number(fm.index ?? 3));
      const indexSustain = Math.max(0, Math.min(1, Number(fm.indexSustain ?? 0)));
      const modDecay = Math.max(0.005, Number(fm.decay ?? 0.4));
      const carrierFreq = midiToFreq(midi);
      const modFreq = carrierFreq * ratio;

      const carrier = ctx.createOscillator();
      carrier.type = p.oscillator.type === 'custom' ? 'sine' : (p.oscillator.type || 'sine');
      carrier.frequency.setValueAtTime(carrierFreq, now);
      carrier.detune.setValueAtTime((p.oscillator.detune || 0), now);

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
      this._scheduleAmpEnvelope(env.gain, p.envelope, velocity, now);

      const toneInput = drive || filter;
      carrier.connect(toneInput);
      if (drive) drive.connect(filter);
      filter.connect(env);
      env.connect(this._toneInput || this._output);

      const vibrato = this._createVibrato([carrier], now);
      carrier.start(now);
      mod.start(now);

      const voice = {
        oscillators: [carrier], fmMod: mod, fmModGain: modGain, vibrato, filter, env,
        midi, startTime: now, velocity, kind: 'fm',
      };
      this._voices.set(midi, voice);
      this._voiceQueue.push(midi);
      carrier.addEventListener('ended', () => {
        if (this._voices.get(midi) === voice) {
          this._voices.delete(midi);
          const qi = this._voiceQueue.indexOf(midi);
          if (qi !== -1) this._voiceQueue.splice(qi, 1);
        }
        this._disposeVoiceNodes(voice);
      }, { once: true });
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

    // Store voice
    const voice = { oscillators, oscillators2, vibrato, noise, filter, env, midi, startTime: now, velocity };
    this._voices.set(midi, voice);
    this._voiceQueue.push(midi);

    // Dispose nodes once the voice's oscillators stop (via noteOff / stealing /
    // panic), mirroring the sample path so rapid retriggering can't pile up nodes.
    const endOsc = oscillators[0];
    if (endOsc) {
      endOsc.addEventListener('ended', () => {
        if (this._voices.get(midi) === voice) {
          this._voices.delete(midi);
          const qi = this._voiceQueue.indexOf(midi);
          if (qi !== -1) this._voiceQueue.splice(qi, 1);
        }
        this._disposeVoiceNodes(voice);
      }, { once: true });
    }
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
    const releaseLevel = this._envelopeLevelAt(p.envelope, now - (voice.startTime ?? now), voice.velocity ?? 1);
    voice.env.gain.cancelScheduledValues(now);
    voice.env.gain.setValueAtTime(Math.max(0.0001, releaseLevel), now);
    // We use setTargetAtTime for a smoother release instead of linearRamp to avoid clicks if the value isn't exact
    voice.env.gain.setTargetAtTime(0, now, p.envelope.release / 3);

    // Schedule oscillator stop after release
    const stopAt = now + p.envelope.release + 0.1;
    if (voice.source) { try { voice.source.stop(stopAt); } catch (_) {} }
    if (voice.osc) { try { voice.osc.stop(stopAt); } catch (_) {} }
    if (voice.osc2) { try { voice.osc2.stop(stopAt); } catch (_) {} }
    for (const osc of voice.oscillators || []) { try { osc.stop(stopAt); } catch (_) {} }
    for (const osc of voice.oscillators2 || []) { try { osc.stop(stopAt); } catch (_) {} }
    if (voice.vibrato?.lfo) { try { voice.vibrato.lfo.stop(stopAt); } catch (_) {} }
    if (voice.noise) { try { voice.noise.source.stop(stopAt); } catch (_) {} }
    if (voice.fmMod) { try { voice.fmMod.stop(stopAt); } catch (_) {} }

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

  panic() {
    const now = this.engine.currentTime;
    for (const voice of this._voices.values()) {
      if (voice.source) { try { voice.source.stop(now); } catch (_) {} }
      if (voice.osc) { try { voice.osc.stop(now); } catch (_) {} }
      if (voice.osc2) { try { voice.osc2.stop(now); } catch (_) {} }
      for (const osc of voice.oscillators || []) { try { osc.stop(now); } catch (_) {} }
      for (const osc of voice.oscillators2 || []) { try { osc.stop(now); } catch (_) {} }
      if (voice.vibrato?.lfo) { try { voice.vibrato.lfo.stop(now); } catch (_) {} }
      if (voice.noise) { try { voice.noise.source.stop(now); } catch (_) {} }
      if (voice.fmMod) { try { voice.fmMod.stop(now); } catch (_) {} }
    }
    for (const entry of this._liveSampleSources) this._stopSampleSourceNow(entry, now);
    this._liveSampleSources = [];
    this._voices.clear();
    this._voiceQueue = [];
    if (this._toneInput && this._output) this._rebuildEffects();
  }

  /**
   * Free an evicted sample source promptly: declick the envelope, then stop the
   * source at `now` so the renderer releases the node this render quantum instead
   * of at its future scheduled stop. Bounds concurrent BufferSource nodes.
   * @param {{source: any, env: any}} [entry]
   * @param {number} now
   */
  _stopSampleSourceNow(entry, now) {
    if (!entry) return;
    try {
      entry.env.gain.cancelScheduledValues(now);
      entry.env.gain.setTargetAtTime(0, now, 0.003);
    } catch (_) {}
    try { entry.source.stop(now); } catch (_) {}
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
    if (voice.noise) { drop(voice.noise.source); drop(voice.noise.gain); }
    if (voice.vibrato) { drop(voice.vibrato.lfo); drop(voice.vibrato.gain); }
    // FM voice extras: the modulator oscillator and its index-envelope gain.
    drop(voice.fmMod); drop(voice.fmModGain);
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
