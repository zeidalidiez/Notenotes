import { DRUM_KITS } from '../instruments/SketchKit.js';

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
  const vel = Math.max(1, Math.min(127, Math.round((velocity || 0.8) * 127)));
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

function addMidiNoteEvents(events, note, startTick, channel, exportStats) {
  events.push(...noteEvents(startTick + (note.startTick || 0), note.pitch, note.durationTick, note.velocity, channel));
  exportStats.renderedEvents += 1;
}

function addDrumHitEvents(events, hit, startTick, exportStats) {
  events.push(...noteEvents(startTick + (hit.startTick || 0), DRUM_MIDI[hit.type] || 38, PPQ / 8, hit.velocity, 9));
  exportStats.renderedEvents += 1;
}

function tempoEvents(project) {
  const bpm = Math.max(40, Math.min(240, Math.round(project?.bpm || 120)));
  const micros = Math.round(60000000 / bpm);
  const ts = project?.timeSignature || { beats: 4, subdivision: 4 };
  const denominatorPower = Math.max(0, Math.round(Math.log2(ts.subdivision || 4)));
  return [
    { tick: 0, order: -3, bytes: [0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff] },
    { tick: 0, order: -2, bytes: [0xff, 0x58, 0x04, ts.beats || 4, denominatorPower, 24, 8] },
  ];
}

export function projectToMidiBlob(project, options = {}) {
  const exportStats = stats(options);
  const events = [...tempoEvents(project)];
  const ticksPerBar = PPQ * (project?.timeSignature?.beats || 4);
  const hasSolo = (project?.tracks || []).some(track => track.solo);
  const audibleTracks = (project?.tracks || []).filter(track => !track.muted && (!hasSolo || track.solo));

  for (const track of audibleTracks) {
    const trackType = track.type || (track.instrumentId === 'kit' || DRUM_KITS[track.instrumentId] ? 'drum' : 'midi');
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
      if (trackType === 'midi') {
        for (const note of (snippet.notes || [])) addMidiNoteEvents(events, note, start, 0, exportStats);
      } else if (trackType === 'drum') {
        for (const hit of (snippet.hits || [])) addDrumHitEvents(events, hit, start, exportStats);
      }
    }
  }

  return midiBlobFromEvents(events);
}

export function snippetToMidiBlob(snippet, project, options = {}) {
  const exportStats = stats(options);
  const channel = snippet?.type === 'drum' ? 9 : 0;
  const events = [...tempoEvents(project)];
  for (const note of (snippet?.notes || [])) {
    addMidiNoteEvents(events, note, 0, channel, exportStats);
  }
  for (const hit of (snippet?.hits || [])) {
    addDrumHitEvents(events, hit, 0, exportStats);
  }
  return midiBlobFromEvents(events);
}

function midiBlobFromEvents(events) {
  const header = [...writeAscii('MThd'), ...writeU32(6), ...writeU16(0), ...writeU16(1), ...writeU16(PPQ)];
  const bytes = new Uint8Array([...header, ...trackChunk(events)]);
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
