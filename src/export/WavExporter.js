import { DRUM_KITS } from '../instruments/SketchKit.js';
import { PRESETS } from '../instruments/WebAudioSynth.js';
import { secondsPerTickForMeter, ticksPerBarForMeter } from '../engine/Meter.js';
import { normalizeClipTimeScale } from '../engine/ClipTimeScale.js';
import {
  normalizeVelocityResponse,
  velocityAdjustedDrive,
  velocityAdjustedFilterFrequency,
} from '../engine/VelocityResponse.js';

const TICKS_PER_BEAT = 480;
const SAMPLE_RATE = 44100;
const TWO_PI = Math.PI * 2;

const DEFAULT_EXPORT_PATCH = {
  name: 'Default',
  oscillator: { type: 'triangle', detune: 0 },
  oscillator2: null,
  envelope: { attack: 0.01, decay: 0.15, sustain: 0.6, release: 0.3 },
  filter: { type: 'lowpass', frequency: 8000, Q: 1 },
  gain: 0.5,
  drive: 0,
  filterEnv: null,
  vibrato: null,
  unison: null,
  keyTrack: 0,
  velocityResponse: null,
  schemaVersion: 1,
};

function secondsPerTickFor(projectOrSnippet = {}, bpm = 120) {
  return secondsPerTickForMeter(projectOrSnippet.meter || projectOrSnippet.timeSignature, bpm, TICKS_PER_BEAT);
}

function ticksPerBar(projectOrSnippet = {}) {
  return ticksPerBarForMeter(projectOrSnippet.meter || projectOrSnippet.timeSignature, TICKS_PER_BEAT);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeExportPatch(patch = {}) {
  return {
    ...DEFAULT_EXPORT_PATCH,
    ...patch,
    oscillator: { ...DEFAULT_EXPORT_PATCH.oscillator, ...(patch.oscillator || {}) },
    oscillator2: patch.oscillator2 ? { ...patch.oscillator2 } : null,
    envelope: { ...DEFAULT_EXPORT_PATCH.envelope, ...(patch.envelope || {}) },
    filter: { ...DEFAULT_EXPORT_PATCH.filter, ...(patch.filter || {}) },
    filterEnv: patch.filterEnv ? { ...patch.filterEnv } : null,
    vibrato: patch.vibrato ? { ...patch.vibrato } : null,
    unison: patch.unison ? { ...patch.unison } : null,
    keyTrack: Number(patch.keyTrack) || 0,
    velocityResponse: patch.velocityResponse ? normalizeVelocityResponse(patch.velocityResponse) : null,
    schemaVersion: patch.schemaVersion || 1,
  };
}

function oscillatorValue(type = 'sine', phaseCycles = 0) {
  const phase = phaseCycles - Math.floor(phaseCycles);
  if (type === 'square') return phase < 0.5 ? 1 : -1;
  if (type === 'sawtooth') return 2 * phase - 1;
  if (type === 'triangle') return 1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));
  return Math.sin(phase * TWO_PI);
}

function envelopeValue(t, durationSec, env) {
  const attack = Math.max(0.001, env.attack || 0.001);
  const decay = Math.max(0.001, env.decay || 0.001);
  const sustain = clamp(env.sustain ?? 0.6, 0, 1);
  const release = Math.max(0.001, env.release || 0.001);
  if (t < attack) return t / attack;
  if (t < attack + decay) {
    const d = (t - attack) / decay;
    return 1 + (sustain - 1) * d;
  }
  if (t <= durationSec) return sustain;
  return Math.max(0, sustain * (1 - ((t - durationSec) / release)));
}

function filterFrequencyForPatch(patch, midi, t, velocity = 0.8) {
  const trackedBase = clamp(
    (patch.filter.frequency || DEFAULT_EXPORT_PATCH.filter.frequency)
      * Math.pow(2, ((midi - 60) / 12) * clamp(patch.keyTrack || 0, 0, 1)),
    40,
    18000,
  );
  const base = velocityAdjustedFilterFrequency(trackedBase, velocity, patch.velocityResponse);
  const env = patch.filterEnv;
  if (!env || (env.depth || 0) <= 0) return base;
  const attack = Math.max(0.001, env.attack ?? 0.01);
  const decay = Math.max(0.001, env.decay ?? 0.3);
  const sustain = clamp(env.sustain ?? 0.5, 0, 1);
  const depth = clamp(env.depth ?? 0, 0, 1.5);
  const opened = clamp(base * (1 + depth * 4), 40, 19000);
  if (t < attack) return base + (opened - base) * (t / attack);
  if (t < attack + decay) {
    const d = (t - attack) / decay;
    return opened + ((base + (opened - base) * sustain) - opened) * d;
  }
  return base + (opened - base) * sustain;
}

function filterStep(input, state, type, cutoffHz) {
  const alpha = clamp((TWO_PI * cutoffHz) / (TWO_PI * cutoffHz + SAMPLE_RATE), 0.001, 0.99);
  state.low += (input - state.low) * alpha;
  if (type === 'highpass') return input - state.low;
  if (type === 'bandpass') {
    const high = input - state.low;
    state.band += (high - state.band) * Math.min(0.45, alpha * 3);
    return state.band;
  }
  return state.low;
}

function driveSample(sample, amount = 0) {
  if (!amount) return sample;
  const k = Math.max(0, amount) * 70;
  return ((1 + k) * sample) / (1 + k * Math.abs(sample));
}

function ensureLength(samples, seconds) {
  const length = Math.max(1, Math.ceil(seconds * SAMPLE_RATE));
  return samples?.length >= length ? samples : new Float32Array(length);
}

function mixSample(buffer, index, value) {
  if (index >= 0 && index < buffer.length) {
    buffer[index] = Math.max(-1, Math.min(1, buffer[index] + value));
  }
}

function traitAmount(traits, id) {
  if (traits?.[id]?.enabled === false) return 0;
  return Math.max(0, Math.min(1, traits?.[id]?.amount || 0));
}

function traitCurve(traits, id) {
  const amount = traitAmount(traits, id);
  if (id === 'wobble') return Math.pow(amount, 0.72);
  if (id === 'space') return Math.pow(amount, 0.5);
  return Math.pow(amount, 0.68);
}

function hasToneTraits(traits = {}) {
  return ['crush', 'echo', 'space', 'wobble', 'drive', 'noise'].some(id => traitAmount(traits, id) > 0);
}

function hasSnippetTone(snippet, fallbackTraits = {}) {
  return hasToneTraits(fallbackTraits)
    || hasToneTraits(snippet?.soundTraits)
    || (snippet?.notes || []).some(note => hasToneTraits(note.soundTraits))
    || (snippet?.hits || []).some(hit => hasToneTraits(hit.soundTraits));
}

function applyToneTraits(input, traits = {}) {
  if (!hasToneTraits(traits)) return input;
  const out = new Float32Array(input);

  const noise = traitCurve(traits, 'noise');
  if (noise > 0) {
    const drive = traitCurve(traits, 'drive');
    const driveDucking = Math.pow(1 - drive * 0.78, 2);
    let last = 0;
    for (let i = 0; i < out.length; i++) {
      last = last * 0.72 + (Math.random() * 2 - 1) * 0.28;
      const envelope = Math.min(1, Math.abs(out[i]) * 8);
      out[i] += last * envelope * noise * 0.18 * driveDucking;
    }
  }

  const wobble = traitCurve(traits, 'wobble');
  if (wobble > 0) {
    let low = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      const lfo = Math.sin(TWO_PI * (0.35 + wobble * 4.2) * t);
      const cutoff = clamp(1100 + (1 - wobble) * 5200 + lfo * (180 + wobble * 1300), 500, 12000);
      const alpha = clamp((TWO_PI * cutoff) / (TWO_PI * cutoff + SAMPLE_RATE), 0.001, 0.99);
      low += (out[i] - low) * alpha;
      out[i] = low;
    }
  }

  const drive = traitCurve(traits, 'drive');
  if (drive > 0) {
    const k = 1 + drive * 24;
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.tanh(out[i] * k) / Math.tanh(k);
    }
  }

  const crush = traitCurve(traits, 'crush');
  if (crush > 0) {
    const steps = Math.max(2, Math.round(72 - crush * 70));
    const hold = Math.max(1, Math.round(1 + crush * 28));
    let held = 0;
    for (let i = 0; i < out.length; i++) {
      if (i % hold === 0) held = Math.round(out[i] * steps) / steps;
      out[i] = held;
    }
  }

  const echo = traitCurve(traits, 'echo');
  if (echo > 0) {
    const delay = Math.floor((0.12 + echo * 0.38) * SAMPLE_RATE);
    const feedback = 0.18 + echo * 0.42;
    const wet = 0.08 + echo * 0.48;
    const cutoff = 4200 - echo * 1500;
    const alpha = clamp((TWO_PI * cutoff) / (TWO_PI * cutoff + SAMPLE_RATE), 0.001, 0.99);
    let fbLow = 0;
    for (let i = delay; i < out.length; i++) {
      fbLow += (out[i - delay] - fbLow) * alpha;
      out[i] += fbLow * feedback * wet;
    }
  }

  const space = traitCurve(traits, 'space');
  if (space > 0) {
    const taps = [
      [0.023, 0.18],
      [0.041, 0.14],
      [0.067, 0.12],
      [0.109, 0.09],
      [0.163, 0.07],
      [0.251, 0.05],
      [0.377, 0.035],
      [0.521, 0.025],
    ];
    let tail = 0;
    for (const [sec, gain] of taps) {
      const delay = Math.floor(sec * SAMPLE_RATE);
      for (let i = delay; i < out.length; i++) {
        tail = tail * (0.72 + space * 0.08) + out[i - delay] * gain;
        out[i] += tail * (0.7 + space * 1.25);
      }
    }
  }

  return out;
}

function clampGain(value, fallback = 1) {
  const gain = Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1.5, gain));
}

function mixBuffer(target, source, startSec = 0, gain = 1) {
  const offset = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  for (let i = 0; i < source.length; i++) {
    mixSample(target, offset + i, source[i] * gain);
  }
}

function renderPatchTone(buffer, startSec, durationSec, midi, velocity = 0.8, patchInput = null) {
  const patch = normalizeExportPatch(patchInput || PRESETS.chip_lead || DEFAULT_EXPORT_PATCH);
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const release = Math.max(0.02, patch.envelope.release || 0.02);
  const end = Math.min(buffer.length, Math.ceil((startSec + durationSec + release + 0.02) * SAMPLE_RATE));
  const baseFreq = midiToFreq(midi);
  const amp = 0.58 * clamp(velocity, 0, 1.25) * clamp(patch.gain ?? 0.5, 0, 1.5);
  const unison = patch.unison || {};
  const unisonVoices = clamp(Math.round(unison.voices || 1), 1, 5);
  const spread = clamp(unison.spread || 0, 0, 40);
  const osc2Gain = patch.oscillator2 ? clamp(patch.oscillator2.gain ?? 0.35, 0, 1.5) : 0;
  const filterState = { low: 0, band: 0 };
  const phases = Array.from({ length: unisonVoices }, () => 0);
  const phases2 = Array.from({ length: unisonVoices }, () => 0);

  for (let i = start; i < end; i++) {
    const n = i - start;
    const t = n / SAMPLE_RATE;
    const vibrato = patch.vibrato && t >= (patch.vibrato.delay || 0)
      ? Math.sin(TWO_PI * (patch.vibrato.rate || 5.5) * (t - (patch.vibrato.delay || 0))) * (patch.vibrato.depth || 0)
      : 0;
    let primaryWave = 0;
    let secondaryWave = 0;
    for (let v = 0; v < unisonVoices; v++) {
      const spreadOffset = unisonVoices === 1 ? 0 : ((v / (unisonVoices - 1)) - 0.5) * spread;
      const cents = (patch.oscillator.detune || 0) + spreadOffset + vibrato;
      const freq = baseFreq * Math.pow(2, cents / 1200);
      phases[v] += freq / SAMPLE_RATE;
      primaryWave += oscillatorValue(patch.oscillator.type, phases[v]);
      if (patch.oscillator2) {
        const cents2 = (patch.oscillator2.detune || 0) + spreadOffset + vibrato;
        const freq2 = baseFreq * Math.pow(2, cents2 / 1200);
        phases2[v] += freq2 / SAMPLE_RATE;
        secondaryWave += oscillatorValue(patch.oscillator2.type || patch.oscillator.type, phases2[v]);
      }
    }
    let wave = (primaryWave / unisonVoices) + (secondaryWave / unisonVoices) * osc2Gain;
    wave = driveSample(wave, velocityAdjustedDrive(patch.drive || 0, velocity, patch.velocityResponse));
    const cutoff = filterFrequencyForPatch(patch, midi, t, velocity);
    const filtered = filterStep(wave, filterState, patch.filter.type, cutoff);
    mixSample(buffer, i, filtered * amp * envelopeValue(t, durationSec, patch.envelope));
  }
}

function renderTone(buffer, startSec, durationSec, midi, velocity = 0.8) {
  renderPatchTone(buffer, startSec, durationSec, midi, velocity, PRESETS.chip_lead);
}

function renderKick(buffer, startSec, velocity = 0.9, params = null) {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const decay = params?.decay || 0.42;
  const len = Math.floor(decay * SAMPLE_RATE);
  const freq0 = params?.freq0 || 140;
  const freq1 = params?.freq1 || 45;
  const vol = params?.vol || 0.9;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * (4.5 / Math.max(0.08, decay)));
    const freq = freq1 + (freq0 - freq1) * Math.exp(-t * 22);
    mixSample(buffer, start + i, Math.sin(2 * Math.PI * freq * t) * env * vol * velocity);
  }
}

function renderNoiseHit(buffer, startSec, kind = 'snare', velocity = 0.75, params = null) {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const lenSec = params?.decay || params?.noiseDecay || (kind === 'hihat' ? 0.11 : kind === 'cymbal' ? 0.45 : 0.22);
  const len = Math.floor(lenSec * SAMPLE_RATE);
  let last = 0;
  const vol = params?.vol || 0.75;
  const bodyFreq = params?.bodyFreq || params?.rimFreq || 190;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * (kind === 'cymbal' ? 7 : 16));
    const noise = (Math.random() * 2 - 1);
    last = kind === 'snare' || kind === 'clap' ? (last * 0.55 + noise * 0.45) : noise;
    const body = kind === 'snare' || kind === 'rim' ? Math.sin(2 * Math.PI * bodyFreq * t) * 0.25 : 0;
    mixSample(buffer, start + i, (last * 0.55 + body) * env * vol * velocity);
  }
}

function renderHit(buffer, hit, startSec, secPerTick, kitId = 'classic') {
  const time = startSec + (hit.startTick || 0) * secPerTick;
  const velocity = hit.velocity || 0.8;
  const kit = DRUM_KITS[kitId] || DRUM_KITS.classic;
  const params = kit.sounds?.[hit.type] || null;
  if (hit.type === 'kick' || hit.type === 'tomlo' || hit.type === 'tommid' || hit.type === 'tomhi') renderKick(buffer, time, velocity, params);
  else renderNoiseHit(buffer, time, hit.type || 'snare', velocity, params);
}

function renderSnippetEvents(buffer, snippet, startSec, bpm, options = {}) {
  const sourceBpm = options.useSnippetBpm === false ? bpm : (snippet.bpm || bpm);
  const secPerTick = secondsPerTickFor(snippet, sourceBpm);
  const timeScale = normalizeClipTimeScale(options.timeScale);
  const gain = clampGain(options.gain);
  if (options.includeMidi !== false) {
    for (const note of snippet.notes || []) {
      renderTone(
        buffer,
        startSec + (note.startTick || 0) * secPerTick * timeScale,
        Math.max(secPerTick, (note.durationTick || TICKS_PER_BEAT) * secPerTick * timeScale),
        note.pitch || 60,
        (note.velocity || 0.8) * gain,
      );
    }
  }
  if (options.includeDrums !== false) {
    const hasClipTraits = hasToneTraits(options.toneTraits);
    for (const hit of snippet.hits || []) {
      const hitWithGain = { ...hit, velocity: (hit.velocity || 0.8) * gain };
      const traits = hasClipTraits ? options.toneTraits : (hit.soundTraits || options.toneTraits || snippet.soundTraits);
      if (hasToneTraits(traits)) {
        const hitSamples = ensureLength(null, buffer.length / SAMPLE_RATE);
        renderHit(hitSamples, { ...hitWithGain, startTick: (hitWithGain.startTick || 0) * timeScale }, startSec, secPerTick, options.kitId);
        mixBuffer(buffer, applyToneTraits(hitSamples, traits));
      } else {
        renderHit(buffer, { ...hitWithGain, startTick: (hitWithGain.startTick || 0) * timeScale }, startSec, secPerTick, options.kitId);
      }
    }
  }
}

function renderMidiWithTone(target, snippet, startSec, bpm, baseTraits = {}, gain = 1, options = {}) {
  const sourceBpm = options.useSnippetBpm === false ? bpm : (snippet.bpm || bpm);
  const secPerTick = secondsPerTickFor(snippet, sourceBpm);
  const timeScale = normalizeClipTimeScale(options.timeScale);
  const renderGain = clampGain(gain);
  const patch = normalizeExportPatch(options.patch || PRESETS.chip_lead);
  const hasClipTraits = hasToneTraits(baseTraits);
  for (const note of snippet.notes || []) {
    const noteTraits = hasClipTraits ? baseTraits : (note.soundTraits || baseTraits);
    const noteSamples = ensureLength(null, target.length / SAMPLE_RATE);
    renderPatchTone(
      noteSamples,
      startSec + (note.startTick || 0) * secPerTick * timeScale,
      Math.max(secPerTick, (note.durationTick || TICKS_PER_BEAT) * secPerTick * timeScale),
      note.pitch || 60,
      (note.velocity || 0.8) * renderGain,
      patch,
    );
    mixBuffer(target, applyToneTraits(noteSamples, noteTraits));
  }
}

function patchForSnippetExport(snippet, options = {}) {
  if (options.patch) return options.patch;
  if (snippet?.patchRecorded?.patchSnapshot) return snippet.patchRecorded.patchSnapshot;
  const recordedId = snippet?.patchRecorded?.instrumentId || snippet?.instrumentId || snippet?.patchId;
  return PRESETS[recordedId] || PRESETS.chip_lead;
}

function audioSource(snippet) {
  return snippet?.audioDataUrl || snippet?.audioUrl || '';
}

async function decodeAudioSnippet(snippet, options = {}) {
  const source = audioSource(snippet);
  if (!source && !snippet?.audioAssetId) {
    if (options.stats) options.stats.skippedAudio = (options.stats.skippedAudio || 0) + 1;
    return null;
  }
  try {
    let arrayBuffer = null;
    if (options.store?.audioSnippetToArrayBuffer) {
      arrayBuffer = await options.store.audioSnippetToArrayBuffer(snippet);
    } else if (source && !source.startsWith('blob:')) {
      const response = await fetch(source);
      arrayBuffer = await response.arrayBuffer();
    }
    if (!arrayBuffer) {
      if (options.stats) options.stats.skippedAudio = (options.stats.skippedAudio || 0) + 1;
      return null;
    }
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Ctx(1, 1, SAMPLE_RATE);
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch (err) {
    console.warn('[WavExporter] Skipping unavailable audio snippet:', snippet?.name || snippet?.id, err);
    if (options.stats) options.stats.skippedAudio = (options.stats.skippedAudio || 0) + 1;
    return null;
  }
}

function mixAudioBuffer(target, decoded, startSec, gain = 1, timeScale = 1) {
  if (!decoded) return;
  const offset = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const channels = decoded.numberOfChannels || 1;
  const renderGain = clampGain(gain);
  const scale = normalizeClipTimeScale(timeScale);
  const outputLength = Math.max(1, Math.floor(decoded.length * scale * (SAMPLE_RATE / decoded.sampleRate)));
  for (let ch = 0; ch < channels; ch++) {
    const data = decoded.getChannelData(ch);
    const channelGain = (0.7 * renderGain) / channels;
    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = (i / scale) * (decoded.sampleRate / SAMPLE_RATE);
      const i0 = Math.floor(sourceIndex);
      if (i0 >= data.length) break;
      const i1 = Math.min(data.length - 1, i0 + 1);
      const frac = sourceIndex - i0;
      const sample = (data[i0] || 0) * (1 - frac) + (data[i1] || 0) * frac;
      mixSample(target, offset + i, sample * channelGain);
    }
  }
}

async function decodeCustomInstrument(instrument, options = {}) {
  if (!instrument?.audioAssetId || !options.store?.getAudioAssetBlob) return null;
  try {
    const blob = await options.store.getAudioAssetBlob(instrument.audioAssetId);
    if (!blob) return null;
    const arrayBuffer = await blob.arrayBuffer();
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Ctx(1, 1, SAMPLE_RATE);
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch (err) {
    console.warn('[WavExporter] Custom instrument decode failed:', instrument?.name || instrument?.id, err);
    return null;
  }
}

function customInstrumentForTrack(project, track) {
  const id = track?.instrumentId || '';
  if (!id.startsWith('custom:')) return null;
  return (project?.settings?.customInstruments || [])
    .find(instrument => instrument.id === id.slice(7) && instrument.type === 'patch') || null;
}

function sampleAt(decoded, sourceIndex) {
  if (!decoded) return 0;
  const channels = decoded.numberOfChannels || 1;
  const i0 = Math.floor(sourceIndex);
  const i1 = Math.min(decoded.length - 1, i0 + 1);
  const frac = sourceIndex - i0;
  let value = 0;
  for (let ch = 0; ch < channels; ch++) {
    const data = decoded.getChannelData(ch);
    value += (data[i0] || 0) * (1 - frac) + (data[i1] || 0) * frac;
  }
  return value / channels;
}

function renderSampleNote(target, decoded, instrument, note, startSec, bpm, gain = 1, options = {}) {
  if (!decoded) return;
  const secPerTick = secondsPerTickFor(options.meterSource || {}, bpm);
  const timeScale = normalizeClipTimeScale(options.timeScale);
  const noteStart = startSec + (note.startTick || 0) * secPerTick * timeScale;
  const rate = Math.pow(2, ((note.pitch || 60) - (instrument.rootMidi ?? 60)) / 12);
  const durationSec = instrument.playbackMode === 'oneShot'
    ? decoded.duration / Math.max(0.01, rate)
    : Math.max(secPerTick, (note.durationTick || TICKS_PER_BEAT) * secPerTick * timeScale) + 0.18;
  const start = Math.max(0, Math.floor(noteStart * SAMPLE_RATE));
  const len = Math.max(1, Math.floor(durationSec * SAMPLE_RATE));
  const attack = Math.max(1, Math.floor((instrument.attack ?? 0.005) * SAMPLE_RATE));
  const release = Math.max(1, Math.floor((instrument.release ?? 0.18) * SAMPLE_RATE));
  const renderGain = clampGain((note.velocity || 0.8) * (instrument.gain ?? 0.55) * gain);
  const brightness = instrument.brightness ?? 0.7;
  const samplePatch = normalizeExportPatch({
    filter: {
      type: instrument.filter?.type || 'lowpass',
      frequency: instrument.filter?.frequency || (900 + brightness * 9200),
      Q: instrument.filter?.Q || 1,
    },
    filterEnv: instrument.filterEnv || null,
    keyTrack: instrument.keyTrack || 0,
    velocityResponse: instrument.velocityResponse || null,
  });
  const filterState = { low: 0, band: 0 };

  for (let i = 0; i < len; i++) {
    const targetIndex = start + i;
    if (targetIndex >= target.length) break;
    const sourceIndex = i * rate * (decoded.sampleRate / SAMPLE_RATE);
    if (sourceIndex >= decoded.length) break;
    const a = Math.min(1, i / attack);
    const r = i < len - release ? 1 : Math.max(0, (len - i) / release);
    let sample = sampleAt(decoded, sourceIndex);
    const cutoff = filterFrequencyForPatch(
      samplePatch,
      note.pitch || instrument.rootMidi || 60,
      i / SAMPLE_RATE,
      note.velocity || 0.8,
    );
    sample = filterStep(sample, filterState, samplePatch.filter.type, cutoff);
    mixSample(target, targetIndex, sample * renderGain * a * r);
  }
}

function renderMidiWithCustomInstrument(target, snippet, decoded, instrument, startSec, bpm, gain = 1, options = {}) {
  for (const note of snippet.notes || []) {
    renderSampleNote(target, decoded, instrument, note, startSec, bpm, gain, options);
  }
}

function normalize(buffer) {
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i]));
  if (peak <= 0.98) return buffer;
  const gain = 0.98 / peak;
  for (let i = 0; i < buffer.length; i++) buffer[i] *= gain;
  return buffer;
}

function encodeWav(samples) {
  normalize(samples);
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;
  const writeString = (s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };

  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true); offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint32(offset, SAMPLE_RATE, true); offset += 4;
  view.setUint32(offset, SAMPLE_RATE * blockAlign, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString('data');
  view.setUint32(offset, dataSize, true); offset += 4;

  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export async function snippetToWavBlob(snippet, project = {}, options = {}) {
  const bpm = snippet?.bpm || project?.bpm || 120;
  const traits = snippet?.soundTraits || project?.settings?.soundTraits || {};
  const toneTail = (snippet?.type === 'midi' || snippet?.type === 'drum') && hasSnippetTone(snippet, traits) ? 3 : 0.75;
  let durationSec = Math.max(1, (snippet?.durationTicks || ticksPerBar(snippet)) * secondsPerTickFor(snippet, bpm)) + toneTail;
  let decoded = null;
  if (snippet?.type === 'audio') {
    decoded = await decodeAudioSnippet(snippet, options);
    if (!decoded) throw new Error('Audio recording is unavailable');
    durationSec = Math.max(durationSec, decoded?.duration || 0);
  }
  const samples = ensureLength(null, durationSec);
  if (decoded) mixAudioBuffer(samples, decoded, 0);
  else if (snippet?.type === 'midi') {
    renderMidiWithTone(samples, snippet || {}, 0, bpm, traits, 1, { patch: patchForSnippetExport(snippet, options) });
  } else {
    renderSnippetEvents(samples, snippet || {}, 0, bpm, { toneTraits: traits });
  }
  return encodeWav(samples);
}

export function debugRenderBuiltInPatchWav(presetId = 'chip_lead', options = {}) {
  const patch = PRESETS[presetId] || PRESETS.chip_lead;
  const midi = options.midi || 60;
  const durationSec = options.durationSec || 1.5;
  const traits = options.traits || {};
  const samples = ensureLength(null, durationSec + 2.2);
  renderPatchTone(samples, 0, durationSec, midi, options.velocity || 0.85, patch);
  return encodeWav(applyToneTraits(samples, traits));
}

export function debugRenderAllBuiltInPatchWavs(options = {}) {
  return Object.fromEntries(
    Object.keys(PRESETS).map(id => [id, debugRenderBuiltInPatchWav(id, options)])
  );
}

export async function projectToWavBlob(project, options = {}) {
  const bpm = project?.bpm || 120;
  const secPerTick = secondsPerTickFor(project, bpm);
  const barTicks = ticksPerBar(project);
  const hasSolo = (project?.tracks || []).some(track => track.solo);
  const audibleTracks = (project?.tracks || []).filter(track => !track.muted && (!hasSolo || track.solo));
  const jobs = [];
  let maxSec = barTicks * secPerTick;

  for (const track of audibleTracks) {
    const trackType = track.type || (track.instrumentId === 'kit' || DRUM_KITS[track.instrumentId] ? 'drum' : 'midi');
    const kitId = trackType === 'drum' && DRUM_KITS[track.instrumentId] ? track.instrumentId : 'classic';
    const gain = clampGain(track.volume, 1);
    for (const clip of track.clips || []) {
      const snippet = clip.snippet;
      if (!snippet) continue;
      if (trackType === 'audio' && snippet.type !== 'audio') {
        if (options.stats) options.stats.skippedMismatchedClips = (options.stats.skippedMismatchedClips || 0) + 1;
        continue;
      }
      if (trackType === 'drum' && snippet.type !== 'drum') {
        if (options.stats) options.stats.skippedMismatchedClips = (options.stats.skippedMismatchedClips || 0) + 1;
        continue;
      }
      if (trackType === 'midi' && snippet.type !== 'midi') {
        if (options.stats) options.stats.skippedMismatchedClips = (options.stats.skippedMismatchedClips || 0) + 1;
        continue;
      }

      const startSec = (clip.startBar || 0) * barTicks * secPerTick;
      const timeScale = normalizeClipTimeScale(clip.timeScale);
      const durationSec = (snippet.durationTicks || barTicks) * secPerTick * timeScale;
      const traits = clip.soundTraits || snippet.soundTraits || project?.settings?.soundTraits || {};
      const customInstrument = trackType === 'midi' ? customInstrumentForTrack(project, track) : null;
      const patch = trackType === 'midi' && !customInstrument ? (PRESETS[track.instrumentId] || PRESETS.chip_lead) : null;
      const job = { trackType, snippet, startSec, durationSec, gain, traits, customInstrument, patch, kitId, timeScale };

      if (snippet.type === 'audio') {
        job.decoded = await decodeAudioSnippet(snippet, options);
        if (!job.decoded) continue;
        job.durationSec = Math.max(durationSec, (job.decoded.duration || 0) * timeScale);
      }
      if (customInstrument) {
        job.customDecoded = await decodeCustomInstrument(customInstrument, options);
        if (job.customDecoded) {
          job.durationSec = Math.max(job.durationSec, durationSec + Math.min(8, job.customDecoded.duration * 2));
        }
      }

      jobs.push(job);
      maxSec = Math.max(maxSec, startSec + job.durationSec);
    }
  }

  const hasAnyClipTone = jobs.some(job => hasSnippetTone(job.snippet, job.traits));
  const samples = ensureLength(null, maxSec + (hasAnyClipTone ? 3 : 1));
  if (options.stats) options.stats.renderedClips = jobs.length;

  for (const job of jobs) {
    const { trackType, snippet, startSec, gain, traits } = job;
    if (snippet.type === 'audio') {
      mixAudioBuffer(samples, job.decoded, startSec, gain, job.timeScale);
    } else if (trackType === 'midi' && snippet.type === 'midi') {
      if (job.customInstrument && job.customDecoded) {
        if (hasToneTraits(traits)) {
          const toneLayer = ensureLength(null, samples.length / SAMPLE_RATE);
          renderMidiWithCustomInstrument(toneLayer, snippet, job.customDecoded, job.customInstrument, startSec, bpm, gain, { useSnippetBpm: false, meterSource: project, timeScale: job.timeScale });
          mixBuffer(samples, applyToneTraits(toneLayer, traits));
        } else {
          renderMidiWithCustomInstrument(samples, snippet, job.customDecoded, job.customInstrument, startSec, bpm, gain, { useSnippetBpm: false, meterSource: project, timeScale: job.timeScale });
        }
      } else {
        renderMidiWithTone(samples, snippet, startSec, bpm, traits, gain, { useSnippetBpm: false, patch: job.patch, timeScale: job.timeScale });
      }
    } else {
      renderSnippetEvents(samples, snippet, startSec, bpm, { includeMidi: false, toneTraits: traits, gain, useSnippetBpm: false, kitId: job.kitId, timeScale: job.timeScale });
    }
  }

  return encodeWav(samples);
}
