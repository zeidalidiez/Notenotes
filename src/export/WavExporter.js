const TICKS_PER_BEAT = 480;
const SAMPLE_RATE = 44100;

function secondsPerTick(bpm = 120) {
  return 60 / Math.max(1, bpm) / TICKS_PER_BEAT;
}

function ticksPerBar(projectOrSnippet = {}) {
  const sig = projectOrSnippet.timeSignature || { beats: 4, subdivision: 4 };
  return TICKS_PER_BEAT * (sig.beats || 4);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
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
  if (id === 'wobble') return Math.pow(amount, 0.55);
  if (id === 'space') return Math.pow(amount, 0.5);
  return Math.pow(amount, 0.68);
}

function hasToneTraits(traits = {}) {
  return ['crush', 'echo', 'space', 'wobble', 'drive', 'noise'].some(id => traitAmount(traits, id) > 0);
}

function hasSnippetTone(snippet, fallbackTraits = {}) {
  return hasToneTraits(snippet?.soundTraits || fallbackTraits)
    || (snippet?.notes || []).some(note => hasToneTraits(note.soundTraits))
    || (snippet?.hits || []).some(hit => hasToneTraits(hit.soundTraits));
}

function applyToneTraits(input, traits = {}) {
  if (!hasToneTraits(traits)) return input;
  const out = new Float32Array(input);

  const noise = traitCurve(traits, 'noise');
  if (noise > 0) {
    let last = 0;
    for (let i = 0; i < out.length; i++) {
      last = last * 0.72 + (Math.random() * 2 - 1) * 0.28;
      const envelope = Math.min(1, Math.abs(out[i]) * 8);
      out[i] += last * envelope * noise * 0.32;
    }
  }

  const wobble = traitCurve(traits, 'wobble');
  if (wobble > 0) {
    let low = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      const lfo = (Math.sin(2 * Math.PI * (1.2 + wobble * 5) * t) + 1) / 2;
      const alpha = 0.012 + (1 - wobble) * 0.24 + lfo * wobble * 0.18;
      low += (out[i] - low) * alpha;
      out[i] = low * (0.65 + lfo * wobble * 0.55);
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
    const feedback = 0.24 + echo * 0.54;
    const wet = 0.1 + echo * 0.68;
    for (let i = delay; i < out.length; i++) {
      out[i] += out[i - delay] * feedback * wet;
    }
  }

  const space = traitCurve(traits, 'space');
  if (space > 0) {
    const taps = [
      [0.045, 0.22],
      [0.083, 0.16],
      [0.137, 0.11],
      [0.211, 0.08],
    ];
    for (const [sec, gain] of taps) {
      const delay = Math.floor(sec * SAMPLE_RATE);
      for (let i = delay; i < out.length; i++) {
        out[i] += out[i - delay] * gain * (0.75 + space * 1.65);
      }
    }
  }

  return out;
}

function mixBuffer(target, source, startSec = 0) {
  const offset = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  for (let i = 0; i < source.length; i++) {
    mixSample(target, offset + i, source[i]);
  }
}

function renderTone(buffer, startSec, durationSec, midi, velocity = 0.8) {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const end = Math.min(buffer.length, Math.ceil((startSec + durationSec + 0.18) * SAMPLE_RATE));
  const freq = midiToFreq(midi);
  const amp = 0.22 * velocity;
  const attack = Math.max(1, Math.floor(0.008 * SAMPLE_RATE));
  const release = Math.max(1, Math.floor(0.12 * SAMPLE_RATE));
  const noteSamples = Math.max(1, Math.floor(durationSec * SAMPLE_RATE));

  for (let i = start; i < end; i++) {
    const n = i - start;
    const phase = (n / SAMPLE_RATE) * freq;
    const wave = Math.sin(phase * Math.PI * 2) * 0.65 + Math.sign(Math.sin(phase * Math.PI * 4)) * 0.18;
    const attackGain = Math.min(1, n / attack);
    const releaseStart = noteSamples;
    const releaseGain = n <= releaseStart ? 1 : Math.max(0, 1 - ((n - releaseStart) / release));
    mixSample(buffer, i, wave * amp * attackGain * releaseGain);
  }
}

function renderKick(buffer, startSec, velocity = 0.9) {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const len = Math.floor(0.42 * SAMPLE_RATE);
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 9);
    const freq = 45 + 95 * Math.exp(-t * 22);
    mixSample(buffer, start + i, Math.sin(2 * Math.PI * freq * t) * env * 0.9 * velocity);
  }
}

function renderNoiseHit(buffer, startSec, kind = 'snare', velocity = 0.75) {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const lenSec = kind === 'hihat' ? 0.11 : kind === 'cymbal' ? 0.45 : 0.22;
  const len = Math.floor(lenSec * SAMPLE_RATE);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * (kind === 'cymbal' ? 7 : 16));
    const noise = (Math.random() * 2 - 1);
    last = kind === 'snare' || kind === 'clap' ? (last * 0.55 + noise * 0.45) : noise;
    const body = kind === 'snare' ? Math.sin(2 * Math.PI * 190 * t) * 0.25 : 0;
    mixSample(buffer, start + i, (last * 0.55 + body) * env * velocity);
  }
}

function renderHit(buffer, hit, startSec, secPerTick) {
  const time = startSec + (hit.startTick || 0) * secPerTick;
  const velocity = hit.velocity || 0.8;
  if (hit.type === 'kick') renderKick(buffer, time, velocity);
  else renderNoiseHit(buffer, time, hit.type || 'snare', velocity);
}

function renderSnippetEvents(buffer, snippet, startSec, bpm, options = {}) {
  const secPerTick = secondsPerTick(snippet.bpm || bpm);
  if (options.includeMidi !== false) {
    for (const note of snippet.notes || []) {
      renderTone(
        buffer,
        startSec + (note.startTick || 0) * secPerTick,
        Math.max(secPerTick, (note.durationTick || TICKS_PER_BEAT) * secPerTick),
        note.pitch || 60,
        note.velocity || 0.8,
      );
    }
  }
  if (options.includeDrums !== false) {
    for (const hit of snippet.hits || []) {
      const traits = hit.soundTraits || options.toneTraits || snippet.soundTraits;
      if (hasToneTraits(traits)) {
        const hitSamples = ensureLength(null, buffer.length / SAMPLE_RATE);
        renderHit(hitSamples, hit, startSec, secPerTick);
        mixBuffer(buffer, applyToneTraits(hitSamples, traits));
      } else {
        renderHit(buffer, hit, startSec, secPerTick);
      }
    }
  }
}

function renderMidiWithTone(target, snippet, startSec, bpm, baseTraits = {}) {
  const secPerTick = secondsPerTick(snippet.bpm || bpm);
  for (const note of snippet.notes || []) {
    const noteTraits = note.soundTraits || baseTraits;
    const noteSamples = ensureLength(null, target.length / SAMPLE_RATE);
    renderTone(
      noteSamples,
      startSec + (note.startTick || 0) * secPerTick,
      Math.max(secPerTick, (note.durationTick || TICKS_PER_BEAT) * secPerTick),
      note.pitch || 60,
      note.velocity || 0.8,
    );
    mixBuffer(target, applyToneTraits(noteSamples, noteTraits));
  }
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

function mixAudioBuffer(target, decoded, startSec) {
  if (!decoded) return;
  const offset = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const channels = decoded.numberOfChannels || 1;
  for (let ch = 0; ch < channels; ch++) {
    const data = decoded.getChannelData(ch);
    const gain = 0.7 / channels;
    for (let i = 0; i < data.length; i++) {
      mixSample(target, offset + i, data[i] * gain);
    }
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
  let durationSec = Math.max(1, (snippet?.durationTicks || ticksPerBar(snippet)) * secondsPerTick(bpm)) + toneTail;
  let decoded = null;
  if (snippet?.type === 'audio') {
    decoded = await decodeAudioSnippet(snippet, options);
    durationSec = Math.max(durationSec, decoded?.duration || 0);
  }
  const samples = ensureLength(null, durationSec);
  if (decoded) mixAudioBuffer(samples, decoded, 0);
  else if (snippet?.type === 'midi') {
    renderMidiWithTone(samples, snippet || {}, 0, bpm, traits);
  } else {
    renderSnippetEvents(samples, snippet || {}, 0, bpm, { toneTraits: traits });
  }
  return encodeWav(samples);
}

export async function projectToWavBlob(project, options = {}) {
  const bpm = project?.bpm || 120;
  const secPerTick = secondsPerTick(bpm);
  const barTicks = ticksPerBar(project);
  const hasSolo = (project?.tracks || []).some(track => track.solo);
  const audibleTracks = (project?.tracks || []).filter(track => !track.muted && (!hasSolo || track.solo));
  let maxTick = barTicks;
  for (const track of audibleTracks) {
    for (const clip of track.clips || []) {
      const snippet = clip.snippet;
      if (!snippet) continue;
      maxTick = Math.max(maxTick, (clip.startBar || 0) * barTicks + (snippet.durationTicks || barTicks));
    }
  }

  const hasAnyClipTone = audibleTracks.some(track =>
    (track.clips || []).some(clip => hasSnippetTone(clip.snippet, project?.settings?.soundTraits || {}))
  );
  const samples = ensureLength(null, maxTick * secPerTick + (hasAnyClipTone ? 3 : 1));
  const audioMixes = [];
  for (const track of audibleTracks) {
    const trackType = track.type || (track.instrumentId === 'kit' ? 'drum' : 'midi');
    for (const clip of track.clips || []) {
      const snippet = clip.snippet;
      if (!snippet) continue;
      if (trackType === 'audio' && snippet.type !== 'audio') continue;
      if (trackType === 'drum' && snippet.type !== 'drum') continue;
      if (trackType === 'midi' && snippet.type !== 'midi') continue;
      const startSec = (clip.startBar || 0) * barTicks * secPerTick;
      if (snippet.type === 'audio') {
        audioMixes.push(decodeAudioSnippet(snippet, options).then(decoded => mixAudioBuffer(samples, decoded, startSec)));
      } else if (trackType === 'midi' && snippet.type === 'midi') {
        const traits = snippet.soundTraits || project?.settings?.soundTraits || {};
        renderMidiWithTone(samples, snippet, startSec, bpm, traits);
      } else {
        const traits = snippet.soundTraits || project?.settings?.soundTraits || {};
        renderSnippetEvents(samples, snippet, startSec, bpm, { includeMidi: false, toneTraits: traits });
      }
    }
  }
  await Promise.all(audioMixes);
  return encodeWav(samples);
}
