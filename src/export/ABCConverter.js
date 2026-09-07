/** Exact tick-to-notation conversion shared by ABC downloads and sheet music. */
import { meterToTimeSignature, quarterBpmForMeter, ticksPerBarForMeter } from '../engine/Meter.js';
import { MAX_IMPORTED_TICKS } from '../engine/ImportLimits.js';

const PPQ = 480;
const LETTERS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const SHARPS = new Set([1, 3, 6, 8, 10]);
const DRUM_PITCHES = { kick: 35, snare: 38, clap: 40, hihat: 42, cymbal: 45, tomlo: 36, tommid: 41, tomhi: 43, rim: 37, shaker: 44 };

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function durationSuffix(ticks) {
  let a = ticks;
  let b = PPQ / 2;
  while (b) [a, b] = [b, a % b];
  const numerator = ticks / a;
  const denominator = (PPQ / 2) / a;
  return denominator === 1 ? (numerator === 1 ? '' : String(numerator)) : `${numerator}/${denominator}`;
}

// Use drawable note values and explicit tuplets before falling back to an exact
// fraction for an unquantized tick. Complex spans are tied across these values.
const DURATIONS = [1920, 960, 480, 240, 120, 60, 30, 15].flatMap(base => [
  { ticks: base, written: base, prefix: '' },
  { ticks: base * 1.5, written: base * 1.5, prefix: '' },
  { ticks: base * 1.75, written: base * 1.75, prefix: '' },
  { ticks: base * 2 / 3, written: base, prefix: '(3:2:1' },
  { ticks: base * 4 / 5, written: base, prefix: '(5:4:1' },
]).filter(value => Number.isInteger(value.ticks)).sort((a, b) => b.ticks - a.ticks);

function abcPitch(midi, accidentals) {
  const octave = Math.floor(midi / 12) - 1;
  const letter = LETTERS[midi % 12];
  const accidental = SHARPS.has(midi % 12) ? '^' : '';
  const key = `${letter}${octave}`;
  const previous = accidentals.get(key) || '';
  accidentals.set(key, accidental);
  const prefix = previous === accidental ? '' : (accidental || '=');
  return prefix + (octave >= 5 ? letter.toLowerCase() + "'".repeat(octave - 5) : letter + ','.repeat(4 - octave));
}

function snippetEvents(snippet) {
  const isDrum = snippet.type === 'drum';
  return (isDrum ? snippet.hits || [] : snippet.notes || [])
    .filter(event => event.velocity !== 0)
    .map(event => ({
      pitch: isDrum ? (DRUM_PITCHES[event.type] ?? 38) : integer(event.pitch ?? event.midi ?? event.note, -1),
      start: Math.max(0, integer(event.startTick ?? event.tick ?? event.timeTick)),
      duration: Math.max(1, integer(isDrum ? 120 : event.durationTick ?? event.durationTicks ?? event.duration, PPQ)),
    }))
    .filter(event => event.pitch >= 0 && event.pitch <= 127 && event.start + event.duration <= MAX_IMPORTED_TICKS)
    .sort((a, b) => a.start - b.start || b.duration - a.duration || a.pitch - b.pitch);
}

// Equal onsets and lengths form chords. Independent overlapping lengths need
// separate ABC voices so no note onset or release moves to fit another note.
function allocateVoices(events) {
  const groups = new Map();
  for (const event of events) {
    const key = `${event.start}:${event.duration}`;
    if (!groups.has(key)) groups.set(key, { start: event.start, end: event.start + event.duration, pitches: [] });
    groups.get(key).pitches.push(event.pitch);
  }
  const voices = [];
  for (const event of groups.values()) {
    let voice = voices.find(candidate => candidate.at(-1).end <= event.start);
    if (!voice) voices.push(voice = []);
    voice.push(event);
  }
  return voices.length ? voices : [[]];
}

function renderVoice(events, duration, ticksPerBar) {
  const tokens = [];
  const accidentals = new Map();
  let cursor = 0;
  const append = (end, pitches = []) => {
    while (cursor < end) {
      const available = Math.min(end, (Math.floor(cursor / ticksPerBar) + 1) * ticksPerBar) - cursor;
      const value = DURATIONS.find(candidate => candidate.ticks <= available)
        || { ticks: available, written: available, prefix: '' };
      const next = cursor + value.ticks;
      const names = pitches.map(pitch => abcPitch(pitch, accidentals));
      const note = names.length > 1 ? `[${names.join('')}]` : (names[0] || 'z');
      tokens.push(value.prefix + note + durationSuffix(value.written) + (pitches.length && next < end ? '-' : ''));
      cursor = next;
      if (cursor % ticksPerBar === 0) {
        tokens.push('|');
        accidentals.clear();
      }
    }
  };
  for (const event of events) {
    append(event.start);
    append(event.end, event.pitches);
  }
  append(duration);
  if (tokens.at(-1) !== '|') tokens.push('|');
  return tokens.join(' ');
}

export function snippetToABC(snippet, options = {}) {
  const meter = snippet.meter || snippet.timeSignature;
  const timeSig = meterToTimeSignature(meter);
  const ticksPerBar = ticksPerBarForMeter(meter, PPQ);
  const bpm = quarterBpmForMeter(meter, snippet.bpm || 120);
  const title = String(options.title || snippet.name || 'Notenotes Sketch').replace(/[\r\n\x00-\x1f%]/g, ' ');
  const events = snippetEvents(snippet);
  const duration = events.reduce((end, event) => Math.max(end, event.start + event.duration),
    Math.min(MAX_IMPORTED_TICKS, Math.max(1, integer(snippet.durationTicks, ticksPerBar))));
  const voices = allocateVoices(events);
  const header = [`X:${options.index || 1}`, `T:${title}`, `M:${timeSig.beats}/${timeSig.subdivision}`, 'L:1/8', `Q:1/4=${bpm}`];
  if (voices.length > 1) {
    header.push(`%%score (${voices.map((_, i) => i + 1).join(' ')})`);
    voices.forEach((_, i) => header.push(`V:${i + 1}`));
  }
  header.push(snippet.type === 'drum' ? 'K:C clef=perc' : 'K:C');
  return [...header, ...voices.map((voice, i) =>
    `${voices.length > 1 ? `[V:${i + 1}] ` : ''}${renderVoice(voice, duration, ticksPerBar)}`)].join('\n');
}

export function projectToABC(project) {
  return (project?.snippets || []).filter(snippet => snippet.type !== 'audio')
    .map((snippet, i) => snippetToABC(snippet, {
      title: `${project.name} - ${snippet.name || `Snippet ${i + 1}`}`, index: i + 1,
    })).join('\n\n');
}
