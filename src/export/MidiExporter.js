import { DRUM_KITS } from '../instruments/SketchKit.js';
import { meterToTimeSignature, quarterBpmForMeter, ticksPerBarForMeter } from '../engine/Meter.js';
import { normalizeClipTimeScale } from '../engine/ClipTimeScale.js';

const PPQ = 480;
const DRUM_MIDI = {
  kick: 36,
  snare: 38,
  clap: 39,
  hihat: 42,
  cymbal: 49,
  tomlo: 45,
  tommid: 47,
  tomhi: 50,
  rim: 37,
  shaker: 82,
};

function writeAscii(text) {
  return [...text].map(ch => ch.charCodeAt(0));
}

function writeU16(value) {
  return [(value >> 8) & 0xff, value & 0xff];
}

function writeU32(value) {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function writeVarLen(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= ((value & 0x7f) | 0x80);
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function trackChunk(events) {
  events.sort((a, b) => a.tick - b.tick || (a.order || 0) - (b.order || 0));
  const data = [];
  let lastTick = 0;
  for (const event of events) {
    data.push(...writeVarLen(Math.max(0, Math.round(event.tick) - lastTick)), ...event.bytes);
    lastTick = Math.max(0, Math.round(event.tick));
  }
  data.push(0x00, 0xff, 0x2f, 0x00);
  return [...writeAscii('MTrk'), ...writeU32(data.length), ...data];
}

function noteEvents(tick, pitch, duration, velocity, channel) {
  const vel = Math.max(0, Math.min(127, Math.round((velocity ?? 0.8) * 127)));
  if (vel === 0) return [];
  const midi = Math.max(0, Math.min(127, Math.round(pitch)));
  return [
    { tick, order: 1, bytes: [0x90 | channel, midi, vel] },
    { tick: tick + Math.max(1, duration || PPQ / 2), order: 0, bytes: [0x80 | channel, midi, 0] },
  ];
}

function stats(options) {
  options.stats ||= {};
  options.stats.renderedEvents ||= 0;
  options.stats.skippedMismatchedClips ||= 0;
  return options.stats;
}

function addMidiNoteEvents(events, note, startTick, channel, exportStats, timeScale = 1) {
  if (note.velocity === 0) return;
  const scale = normalizeClipTimeScale(timeScale);
  events.push(...noteEvents(
    startTick + (note.startTick || 0) * scale,
    note.pitch,
    Math.max(1, (note.durationTick || PPQ / 2) * scale),
    note.velocity,
    channel,
  ));
  exportStats.renderedEvents += 1;
}

function addDrumHitEvents(events, hit, startTick, exportStats, timeScale = 1) {
  if (hit.velocity === 0) return;
  const scale = normalizeClipTimeScale(timeScale);
  events.push(...noteEvents(startTick + (hit.startTick || 0) * scale, DRUM_MIDI[hit.type] || 38, Math.max(1, (PPQ / 8) * scale), hit.velocity, 9));
  exportStats.renderedEvents += 1;
}

function tempoEvents(project) {
  const bpm = Math.max(1, Math.round(quarterBpmForMeter(project?.meter || project?.timeSignature, project?.bpm || 120)));
  const micros = Math.round(60000000 / bpm);
  const ts = meterToTimeSignature(project?.meter || project?.timeSignature);
  const denominatorPower = Math.max(0, Math.round(Math.log2(ts.subdivision || 4)));
  return [
    { tick: 0, order: -3, bytes: [0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff] },
    { tick: 0, order: -2, bytes: [0xff, 0x58, 0x04, ts.beats || 4, denominatorPower, 24, 8] },
  ];
}

export function projectToMidiBlob(project, options = {}) {
  const exportStats = stats(options);
  const tracks = [[textEvent(0x03, project?.name || 'Notenotes'), ...tempoEvents(project)]];
  const ticksPerBar = ticksPerBarForMeter(project?.meter || project?.timeSignature, PPQ);
  const hasSolo = (project?.tracks || []).some(track => track.solo);
  const audibleTracks = (project?.tracks || []).filter(track => !track.muted && (!hasSolo || track.solo));

  let melodicTrack = 0;
  const melodicChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  for (const track of audibleTracks) {
    const trackType = track.type || (track.instrumentId === 'kit' || DRUM_KITS[track.instrumentId] ? 'drum' : 'midi');
    if (trackType === 'audio') continue;
    const channel = trackType === 'drum' ? 9 : melodicChannels[melodicTrack++ % melodicChannels.length];
    const events = [
      textEvent(0x03, track.name || (trackType === 'drum' ? 'Drums' : 'Instrument')),
      textEvent(0x04, track.instrumentId || trackType),
      { tick: 0, order: -1, bytes: [0xb0 | channel, 7, Math.round(Math.max(0, Math.min(1, track.volume ?? 1)) * 127)] },
      { tick: 0, order: -1, bytes: [0xb0 | channel, 10, Math.round((Math.max(-1, Math.min(1, track.pan ?? 0)) + 1) * 63.5)] },
    ];
    for (const clip of (track.clips || [])) {
      const snippet = clip.snippet;
      if (!snippet) continue;
      if (trackType === 'audio') continue;
      if (trackType === 'drum' && snippet.type !== 'drum') {
        exportStats.skippedMismatchedClips += 1;
        continue;
      }
      if (trackType === 'midi' && snippet.type !== 'midi') {
        exportStats.skippedMismatchedClips += 1;
        continue;
      }

      const start = (clip.startBar || 0) * ticksPerBar;
      const timeScale = normalizeClipTimeScale(clip.timeScale);
      if (trackType === 'midi') {
        for (const note of (snippet.notes || [])) addMidiNoteEvents(events, note, start, channel, exportStats, timeScale);
      } else if (trackType === 'drum') {
        for (const hit of (snippet.hits || [])) addDrumHitEvents(events, hit, start, exportStats, timeScale);
      }
    }
    tracks.push(events);
  }

  return midiBlobFromTracks(tracks, 1);
}

export function snippetToMidiBlob(snippet, project, options = {}) {
  const exportStats = stats(options);
  const channel = snippet?.type === 'drum' ? 9 : 0;
  const events = [...tempoEvents({
    ...(project || {}),
    bpm: snippet?.bpm || project?.bpm || 120,
    meter: snippet?.meter || project?.meter,
    timeSignature: snippet?.timeSignature || project?.timeSignature,
  })];
  for (const note of (snippet?.notes || [])) {
    addMidiNoteEvents(events, note, 0, channel, exportStats);
  }
  for (const hit of (snippet?.hits || [])) {
    addDrumHitEvents(events, hit, 0, exportStats);
  }
  return midiBlobFromEvents(events);
}

function midiBlobFromEvents(events) {
  return midiBlobFromTracks([events], 0);
}

function textEvent(type, value) {
  const bytes = Array.from(new TextEncoder().encode(String(value)));
  return { tick: 0, order: -4, bytes: [0xff, type, ...writeVarLen(bytes.length), ...bytes] };
}

function midiBlobFromTracks(tracks, format) {
  const header = [...writeAscii('MThd'), ...writeU32(6), ...writeU16(format), ...writeU16(tracks.length), ...writeU16(PPQ)];
  const bytes = new Uint8Array([...header, ...tracks.flatMap(trackChunk)]);
  return new Blob([bytes], { type: 'audio/midi' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name, ext) {
  const base = (name || 'notenotes').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'notenotes';
  return `${base}.${ext}`;
}
