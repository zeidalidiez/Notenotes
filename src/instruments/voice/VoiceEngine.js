/**
 * VoiceEngine — Modular formant-synthesized vocal instrument.
 *
 * Pure Web Audio API. No samples, no ML models, no external dependencies.
 *
 * Each "voice" is a JSON file containing a bank of syllables. Each syllable
 * is defined as a time-varying parameter sequence (keyframes) describing
 * voicing, amplitude, and formant frequencies over the syllable's duration.
 *
 * The engine reads the JSON and uses Web Audio's parameter scheduling
 * (linearRampToValueAtTime, setValueAtTime) to interpolate filter and
 * oscillator values between keyframes. The user-played pitch sets the
 * voiced oscillator frequency; formants stay fixed regardless of pitch,
 * which is how real vocal tracts work.
 *
 * Adding a new voice means adding a JSON file. No engine changes.
 *
 * See `voices/README.md` for the syllable JSON schema and contribution guide.
 */

import { midiToFreq } from '../../engine/MusicTheory.js';

const FORMANT_COUNT = 3;
const RELEASE_FADE_SEC = 0.08;
const NOISE_BUFFER_SEC = 0.5;

export class VoiceEngine {
  /**
   * @param {AudioEngine} audioEngine
   * @param {AudioNode|null} destination - Where voice output is routed.
   *   Typically the synth's `_toneInput` so voices share the Tone Traits chain.
   */
  constructor(audioEngine, destination = null) {
    this.engine = audioEngine;
    this.destination = destination;
    this.voice = null;          // currently loaded voice {id, name, syllables[]}
    this._syllableMap = null;   // id -> syllable object, for fast lookup
    this._activeVoices = new Map(); // midi -> active voice graph
    this._noiseBuffer = null;
  }

  /**
   * Set the destination node (the synth's tone input).
   * Call after AudioEngine is initialized.
   */
  setDestination(node) {
    this.destination = node;
  }

  /**
   * Load a voice from a parsed JSON object.
   * @param {object} voiceData - Has `id`, `name`, `syllables` fields.
   */
  loadVoice(voiceData) {
    if (!voiceData || !Array.isArray(voiceData.syllables)) {
      console.warn('[VoiceEngine] Invalid voice data:', voiceData);
      return;
    }
    this.voice = voiceData;
    this._syllableMap = new Map();
    for (const syl of voiceData.syllables) {
      if (syl && syl.id) this._syllableMap.set(syl.id, syl);
    }
  }

  /** Returns sorted array of syllable IDs in the loaded voice. */
  getAvailableSyllableIds() {
    if (!this.voice) return [];
    return this.voice.syllables.map(s => s.id);
  }

  /** Returns true if the voice has a syllable matching this id. */
  hasSyllable(id) {
    return !!(this._syllableMap && this._syllableMap.has(id));
  }

  /** Returns the loaded voice's metadata, or null. */
  getVoiceInfo() {
    if (!this.voice) return null;
    return {
      id: this.voice.id,
      name: this.voice.name,
      description: this.voice.description || '',
      syllableCount: this.voice.syllables.length,
    };
  }

  /**
   * Sing a syllable at a given pitch.
   * @param {string} syllableId - Phoneme/syllable ID (e.g., "ah", "han").
   * @param {number} midi - MIDI note number for the voiced fundamental.
   * @param {number} velocity - 0..1 amplitude scale.
   * @param {number} [atTime] - AudioContext time to start. Defaults to now.
   * @param {number} [durationSec] - Override the syllable's natural duration.
   *   Useful when arpeggiating or playing rhythmic patterns. If omitted,
   *   the syllable's `duration` property (as seconds) is used; default 0.6s.
   */
  singSyllable(syllableId, midi, velocity = 0.8, atTime, durationSec) {
    if (!this.engine || !this.engine.ctx || !this.destination) return;
    const syl = this._syllableMap?.get(syllableId);
    if (!syl) return;

    const ctx = this.engine.ctx;
    const startTime = atTime !== undefined ? atTime : ctx.currentTime;
    const naturalDuration = (typeof syl.duration === 'number' && syl.duration > 0) ? syl.duration : 0.6;
    const duration = (typeof durationSec === 'number' && durationSec > 0) ? durationSec : naturalDuration;

    // If a voice is already active for this midi, release it first.
    if (this._activeVoices.has(midi)) {
      this.releaseSyllable(midi);
    }

    const graph = this._buildSyllableGraph(syl, midi, velocity, startTime, duration);
    if (!graph) return;
    graph.midi = midi;
    graph.endTime = startTime + duration;
    this._activeVoices.set(midi, graph);

    // Auto-cleanup once the syllable finishes naturally.
    const cleanupDelay = (graph.endTime - ctx.currentTime + 0.2) * 1000;
    graph.cleanupTimer = setTimeout(() => {
      // Only auto-stop if this exact graph is still active
      if (this._activeVoices.get(midi) === graph) {
        this._stopGraph(graph, ctx.currentTime, /*fadeOnly*/ false);
        this._activeVoices.delete(midi);
      }
    }, Math.max(50, cleanupDelay));
  }

  /**
   * Release a held syllable. Used when the user lifts a pad before the
   * syllable's natural duration completes. Applies a short fade to avoid
   * clicks; the syllable's keyframes continue scheduling but the output
   * gain ramps to zero over RELEASE_FADE_SEC.
   */
  releaseSyllable(midi) {
    const graph = this._activeVoices.get(midi);
    if (!graph) return;
    const ctx = this.engine.ctx;
    const now = ctx.currentTime;
    this._stopGraph(graph, now, /*fadeOnly*/ true);
    this._activeVoices.delete(midi);
  }

  /** Stop all currently sounding syllables. */
  releaseAll() {
    for (const midi of [...this._activeVoices.keys()]) {
      this.releaseSyllable(midi);
    }
  }

  // ---------- internals ----------

  _stopGraph(graph, now, fadeOnly) {
    if (!graph) return;
    if (graph.cleanupTimer) {
      clearTimeout(graph.cleanupTimer);
      graph.cleanupTimer = null;
    }
    try {
      // Cancel any future amplitude scheduling and fade out.
      graph.outputGain.gain.cancelScheduledValues(now);
      graph.outputGain.gain.setValueAtTime(graph.outputGain.gain.value, now);
      graph.outputGain.gain.linearRampToValueAtTime(0, now + RELEASE_FADE_SEC);
    } catch (_) {}
    const stopAt = now + RELEASE_FADE_SEC + 0.05;
    if (graph.osc) { try { graph.osc.stop(stopAt); } catch (_) {} }
    if (graph.noiseSource) { try { graph.noiseSource.stop(stopAt); } catch (_) {} }
  }

  _buildSyllableGraph(syl, midi, velocity, startTime, duration) {
    const ctx = this.engine.ctx;
    if (!ctx) return null;

    const frames = Array.isArray(syl.frames) ? syl.frames : [];
    if (frames.length === 0) return null;

    // Voiced source: a sawtooth oscillator at the user's pitch.
    // Sawtooth gives a rich harmonic spectrum that the formant filters can shape.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(midiToFreq(midi), startTime);

    // Voiced source gain — switched on/off across frames based on `voicing`.
    const voicedGain = ctx.createGain();
    voicedGain.gain.setValueAtTime(0, startTime);

    // Unvoiced (noise) source.
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = this._getNoiseBuffer();
    noiseSource.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, startTime);

    // Formant filters in series (peaking biquad chain).
    // Each filter boosts a formant frequency without killing the rest of the spectrum.
    const formantFilters = [];
    for (let i = 0; i < FORMANT_COUNT; i++) {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      // Frame 0 sets initial values; if absent, neutral defaults.
      const f0Formants = (frames[0]?.formants || []);
      const seed = f0Formants[i];
      f.frequency.setValueAtTime(seed?.hz ?? 1000, startTime);
      f.Q.setValueAtTime(seed?.q ?? 6, startTime);
      f.gain.setValueAtTime(seed?.gain ?? 12, startTime); // boost in dB
      formantFilters.push(f);
    }

    // Mix bus: sums voiced + noise, feeds the formant chain.
    const mixGain = ctx.createGain();
    mixGain.gain.setValueAtTime(1, startTime);

    // Output gain applies the syllable's amplitude envelope and the user velocity.
    const outputGain = ctx.createGain();
    outputGain.gain.setValueAtTime(0, startTime);

    // Wire: voicedGain + noiseGain -> mixGain -> [formant chain] -> outputGain -> destination
    osc.connect(voicedGain);
    voicedGain.connect(mixGain);
    noiseSource.connect(noiseGain);
    noiseGain.connect(mixGain);
    let chain = mixGain;
    for (const f of formantFilters) {
      chain.connect(f);
      chain = f;
    }
    chain.connect(outputGain);
    outputGain.connect(this.destination);

    // Schedule per-frame keyframes.
    for (const frame of frames) {
      const t = startTime + Math.max(0, Math.min(1, frame.t || 0)) * duration;
      const amp = Math.max(0, Math.min(1, (frame.amp ?? 0))) * velocity;

      // Amplitude envelope on outputGain.
      outputGain.gain.linearRampToValueAtTime(amp, t);

      // Voiced/unvoiced gating.
      const voicing = frame.voicing || 'off';
      // Switch instantly for clarity; smooth ramps would muddy the consonant/vowel boundary.
      if (voicing === 'voiced') {
        voicedGain.gain.setValueAtTime(1, t);
        noiseGain.gain.setValueAtTime(0, t);
      } else if (voicing === 'noise') {
        voicedGain.gain.setValueAtTime(0, t);
        noiseGain.gain.setValueAtTime(0.5, t);
      } else {
        voicedGain.gain.setValueAtTime(0, t);
        noiseGain.gain.setValueAtTime(0, t);
      }

      // Formants — interpolate between frames via linear ramps.
      const fFormants = Array.isArray(frame.formants) ? frame.formants : [];
      for (let i = 0; i < FORMANT_COUNT; i++) {
        const target = fFormants[i];
        const f = formantFilters[i];
        if (!target) continue; // leave previous values in place
        f.frequency.linearRampToValueAtTime(target.hz ?? 1000, t);
        f.Q.linearRampToValueAtTime(target.q ?? 6, t);
        f.gain.linearRampToValueAtTime(target.gain ?? 12, t);
      }
    }

    // Always schedule a final fade-to-zero at duration end so we don't click.
    outputGain.gain.linearRampToValueAtTime(0, startTime + duration);

    osc.start(startTime);
    noiseSource.start(startTime);
    // Stop a touch after the duration; release timing handles earlier cutoff.
    const naturalStop = startTime + duration + 0.05;
    osc.stop(naturalStop);
    noiseSource.stop(naturalStop);

    return {
      osc,
      noiseSource,
      voicedGain,
      noiseGain,
      mixGain,
      formantFilters,
      outputGain,
    };
  }

  _getNoiseBuffer() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const ctx = this.engine.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_BUFFER_SEC));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Pink-ish noise (cheap one-pole filtered white) — closer to vocal aspiration
    // than raw white, which sounds too "TV static."
    let last = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      last = last * 0.5 + w * 0.5;
      data[i] = last * 0.7;
    }
    this._noiseBuffer = buffer;
    return buffer;
  }
}
