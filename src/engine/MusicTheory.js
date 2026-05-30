/**
 * MusicTheory — Scale definitions, note names, and MIDI utilities.
 */

/** MIDI note number for C4 (middle C) */
export const MIDDLE_C = 60;

/** All 12 note names */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Circle of fifths order, each step clockwise is +7 semitones. */
export const CIRCLE_OF_FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];

export const SCALE_FAMILIES = {
  western: 'Western',
  pentatonic: 'Pentatonic / East Asian',
  easternEuropean: 'Hungarian / Klezmer',
  maqamInspired: 'Maqam-inspired',
  ragaInspired: 'Raga-inspired',
  utility: 'Utility'
};

/** Scale interval patterns (semitones from root) */
export const SCALES = {
  major:       { name: 'Major',       family: 'western', intervals: [0, 2, 4, 5, 7, 9, 11], degreePattern: '1 2 3 4 5 6 7', description: 'Bright seven-note major scale.' },
  minor:       { name: 'Minor',       family: 'western', intervals: [0, 2, 3, 5, 7, 8, 10], degreePattern: '1 2 b3 4 5 b6 b7', description: 'Natural minor scale.' },
  dorian:      { name: 'Dorian',      family: 'western', intervals: [0, 2, 3, 5, 7, 9, 10], degreePattern: '1 2 b3 4 5 6 b7', description: 'Minor color with a raised 6.' },
  phrygian:    { name: 'Phrygian',    family: 'western', intervals: [0, 1, 3, 5, 7, 8, 10], degreePattern: '1 b2 b3 4 5 b6 b7', description: 'Dark minor mode with a flat 2.' },
  lydian:      { name: 'Lydian',      family: 'western', intervals: [0, 2, 4, 6, 7, 9, 11], degreePattern: '1 2 3 #4 5 6 7', description: 'Major color with a raised 4.' },
  mixolydian:  { name: 'Mixolydian',  family: 'western', intervals: [0, 2, 4, 5, 7, 9, 10], degreePattern: '1 2 3 4 5 6 b7', description: 'Major color with a flat 7.' },
  locrian:     { name: 'Locrian',     family: 'western', intervals: [0, 1, 3, 5, 6, 8, 10], degreePattern: '1 b2 b3 4 b5 b6 b7', description: 'Unstable diminished mode.' },
  harmonicMinor: { name: 'Harmonic Minor', family: 'western', intervals: [0, 2, 3, 5, 7, 8, 11], degreePattern: '1 2 b3 4 5 b6 7', description: 'Minor scale with a leading tone.' },
  melodicMinor: { name: 'Melodic Minor', family: 'western', intervals: [0, 2, 3, 5, 7, 9, 11], degreePattern: '1 2 b3 4 5 6 7', description: 'Ascending melodic minor / jazz minor.' },
  pentatonic:  { name: 'Pentatonic',  family: 'pentatonic', intervals: [0, 2, 4, 7, 9], degreePattern: '1 2 3 5 6', description: 'Open major pentatonic shape.' },
  pentatonicMinor: { name: 'Pent. Minor', family: 'pentatonic', intervals: [0, 3, 5, 7, 10], degreePattern: '1 b3 4 5 b7', description: 'Open minor pentatonic shape.' },
  blues:       { name: 'Blues',       family: 'pentatonic', intervals: [0, 3, 5, 6, 7, 10], degreePattern: '1 b3 4 b5 5 b7', description: 'Minor pentatonic plus the blue note.' },
  hirajoshi:   { name: 'Hirajoshi',   family: 'pentatonic', intervals: [0, 2, 3, 7, 8], degreePattern: '1 2 b3 5 b6', description: 'Japanese koto-derived pentatonic color.' },
  inScale:     { name: 'In',          family: 'pentatonic', intervals: [0, 1, 5, 7, 8], degreePattern: '1 b2 4 5 b6', description: 'Japanese pentatonic color with a close flat 2.' },
  yo:          { name: 'Yo',          family: 'pentatonic', intervals: [0, 2, 5, 7, 9], degreePattern: '1 2 4 5 6', description: 'Bright Japanese pentatonic color.' },
  iwato:       { name: 'Iwato',       family: 'pentatonic', intervals: [0, 1, 5, 6, 10], degreePattern: '1 b2 4 b5 b7', description: 'Sparse Japanese pentatonic color with a tritone.' },
  hungarianMinor: { name: 'Hungarian Minor', family: 'easternEuropean', intervals: [0, 2, 3, 6, 7, 8, 11], degreePattern: '1 2 b3 #4 5 b6 7', description: 'Eastern European minor color with augmented-second tension.' },
  hungarianMajor: { name: 'Hungarian Major', family: 'easternEuropean', intervals: [0, 3, 4, 6, 7, 9, 10], degreePattern: '1 #2 3 #4 5 6 b7', description: 'Bright Hungarian color with a raised 2 and raised 4.' },
  romanianMinor: { name: 'Romanian Minor', family: 'easternEuropean', intervals: [0, 2, 3, 6, 7, 9, 10], degreePattern: '1 2 b3 #4 5 6 b7', description: 'Also called Ukrainian Dorian; minor with raised 4 and 6.' },
  doubleHarmonic: { name: 'Double Harmonic', family: 'maqamInspired', intervals: [0, 1, 4, 5, 7, 8, 11], degreePattern: '1 b2 3 4 5 b6 7', description: '12-TET shape also associated with Byzantine / Hijaz Kar / Bhairav.' },
  phrygianDominant: { name: 'Phrygian Dominant', family: 'maqamInspired', intervals: [0, 1, 4, 5, 7, 8, 10], degreePattern: '1 b2 3 4 5 b6 b7', aliases: ['Freygish', 'Hijaz approx.'], description: 'Spanish/Klezmer/Hijaz-inspired dominant color in 12-TET.' },
  neapolitanMinor: { name: 'Neapolitan Minor', family: 'maqamInspired', intervals: [0, 1, 3, 5, 7, 8, 11], degreePattern: '1 b2 b3 4 5 b6 7', description: 'Minor color with flat 2 and leading tone.' },
  marwa:       { name: 'Marwa Approx.', family: 'ragaInspired', intervals: [0, 1, 4, 6, 7, 9, 11], degreePattern: '1 b2 3 #4 5 6 7', description: '12-TET raga-inspired pitch collection; not a full raga rule set.' },
  purvi:       { name: 'Purvi Approx.', family: 'ragaInspired', intervals: [0, 1, 4, 6, 7, 8, 11], degreePattern: '1 b2 3 #4 5 b6 7', description: '12-TET raga-inspired pitch collection; not a full raga rule set.' },
  todi:        { name: 'Todi Approx.', family: 'ragaInspired', intervals: [0, 1, 3, 6, 7, 8, 11], degreePattern: '1 b2 b3 #4 5 b6 7', description: '12-TET raga-inspired pitch collection; true Todi intonation is microtonal.' },
  chromatic:   { name: 'Chromatic',    family: 'utility', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], degreePattern: 'all 12 semitones', description: 'All twelve notes.' }
};

export const DEFAULT_MUSICAL_CONTEXT = {
  root: 'C',
  scale: 'major',
  correction: 'off'
};

export const NOTE_CORRECTION_MODES = {
  off: { id: 'off', label: 'Off' },
  closest: { id: 'closest', label: 'Closest' },
  up: { id: 'up', label: 'Up' },
  down: { id: 'down', label: 'Down' }
};

export const DEFAULT_DEGREE_COLORS = {
  0: '#ff6b6b',
  1: '#ff8a5c',
  2: '#f7b267',
  3: '#d16fcb',
  4: '#7bd88f',
  5: '#5bd6d6',
  6: '#6fb4ff',
  7: '#7d8cff',
  8: '#a884ff',
  9: '#d783ff',
  10: '#ff77c8',
  11: '#f05d8e'
};

export const DEFAULT_DEGREE_HIGHLIGHTING = {
  enabled: false,
  showLabels: false,
  intensity: 0.22,
  colors: DEFAULT_DEGREE_COLORS
};

export const INTERVAL_LABELS = {
  0: 'Root',
  1: 'b2',
  2: '2',
  3: 'b3',
  4: '3',
  5: '4',
  6: 'b5',
  7: '5',
  8: 'b6',
  9: '6',
  10: 'b7',
  11: '7'
};

export const INTERVAL_NAMES = {
  0: 'Root',
  1: 'Flat 2',
  2: '2nd',
  3: 'Flat 3',
  4: '3rd',
  5: '4th',
  6: 'Flat 5',
  7: '5th',
  8: 'Flat 6',
  9: '6th',
  10: 'Flat 7',
  11: '7th'
};

/**
 * Classical function names keyed by chromatic interval from the project root.
 *
 * Pads use these because they explain what the played note is doing in the key.
 * Piano keeps the compact INTERVAL_LABELS shorthand because it has much less
 * visual room and players often want quick interval symbols there.
 */
export const CLASSICAL_FUNCTION_NAMES = {
  0: 'Tonic',
  1: 'Lowered Supertonic',
  2: 'Supertonic',
  3: 'Mediant',
  4: 'Mediant',
  5: 'Subdominant',
  6: 'Tritone',
  7: 'Dominant',
  8: 'Submediant',
  9: 'Submediant',
  10: 'Subtonic',
  11: 'Leading Tone'
};

export function normalizeMusicalContext(context = {}) {
  const root = NOTE_NAMES.includes(context?.root) ? context.root : DEFAULT_MUSICAL_CONTEXT.root;
  const scale = SCALES[context?.scale] ? context.scale : DEFAULT_MUSICAL_CONTEXT.scale;
  const correction = normalizeNoteCorrectionMode(context?.correction);
  return { root, scale, correction };
}

export function normalizeNoteCorrectionMode(mode = DEFAULT_MUSICAL_CONTEXT.correction) {
  return NOTE_CORRECTION_MODES[mode] ? mode : DEFAULT_MUSICAL_CONTEXT.correction;
}

export function normalizeDegreeHighlighting(value = {}) {
  const colors = { ...DEFAULT_DEGREE_COLORS, ...(value?.colors || {}) };
  const intensity = Number(value?.intensity);
  return {
    enabled: !!value?.enabled,
    showLabels: !!value?.showLabels,
    intensity: Number.isFinite(intensity) ? Math.max(0.05, Math.min(0.75, intensity)) : DEFAULT_DEGREE_HIGHLIGHTING.intensity,
    colors
  };
}

export function scaleFamilyLabel(family) {
  return SCALE_FAMILIES[family] || SCALE_FAMILIES.western;
}

export function scaleDescription(scaleName) {
  const scale = SCALES[scaleName];
  if (!scale) return '';
  const bits = [];
  if (scale.degreePattern) bits.push(scale.degreePattern);
  if (scale.description) bits.push(scale.description);
  if (Array.isArray(scale.aliases) && scale.aliases.length) bits.push(`Aliases: ${scale.aliases.join(', ')}`);
  return bits.join(' - ');
}

export function intervalFromRoot(midi, rootNote) {
  const root = noteNameToMidi(rootNote, Math.floor(midi / 12) - 1);
  return ((midi - root) % 12 + 12) % 12;
}

export function degreeForMidi(midi, context = DEFAULT_MUSICAL_CONTEXT) {
  const normalized = normalizeMusicalContext(context);
  const scale = SCALES[normalized.scale];
  if (!scale) return null;
  const interval = intervalFromRoot(midi, normalized.root);
  if (!scale.intervals.includes(interval)) return null;
  return {
    interval,
    label: INTERVAL_LABELS[interval] || String(interval),
    name: INTERVAL_NAMES[interval] || `Interval ${interval}`,
    functionName: CLASSICAL_FUNCTION_NAMES[interval] || ''
  };
}

export function correctMidiToScale(midi, context = DEFAULT_MUSICAL_CONTEXT, mode = null) {
  const note = Math.round(Number(midi));
  if (!Number.isFinite(note)) return midi;
  const normalized = normalizeMusicalContext(context);
  const correction = normalizeNoteCorrectionMode(mode ?? normalized.correction);
  if (correction === 'off') return note;

  const scale = SCALES[normalized.scale] || SCALES[DEFAULT_MUSICAL_CONTEXT.scale];
  const intervals = scale?.intervals || SCALES.major.intervals;
  if (intervals.length >= 12) return note;

  const inScale = (candidate) => (
    candidate >= 0
    && candidate <= 127
    && intervals.includes(intervalFromRoot(candidate, normalized.root))
  );

  if (inScale(note)) return note;

  if (correction === 'up') {
    for (let offset = 1; offset <= 12; offset++) {
      const candidate = note + offset;
      if (inScale(candidate)) return candidate;
    }
  }

  if (correction === 'down') {
    for (let offset = 1; offset <= 12; offset++) {
      const candidate = note - offset;
      if (inScale(candidate)) return candidate;
    }
  }

  if (correction === 'closest') {
    for (let offset = 1; offset <= 12; offset++) {
      const up = note + offset;
      if (inScale(up)) return up;
      const down = note - offset;
      if (inScale(down)) return down;
    }
  }

  return Math.max(0, Math.min(127, note));
}

/**
 * Convert a MIDI note number to a frequency in Hz.
 * @param {number} midi - MIDI note number (0–127)
 * @returns {number} Frequency in Hz
 */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Get the note name and octave from a MIDI number.
 * @param {number} midi
 * @returns {{ name: string, octave: number, display: string }}
 */
export function midiToNoteName(midi) {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { name, octave, display: `${name}${octave}` };
}

/**
 * Get the root MIDI note for a given note name and octave.
 * @param {string} noteName - e.g. 'C', 'F#'
 * @param {number} octave - e.g. 4
 * @returns {number} MIDI note number
 */
export function noteNameToMidi(noteName, octave = 4) {
  const idx = NOTE_NAMES.indexOf(noteName);
  if (idx === -1) return MIDDLE_C;
  return (octave + 1) * 12 + idx;
}

/**
 * Generate MIDI notes for a scale at a given root and octave.
 * @param {string} scaleName - Key in SCALES object
 * @param {string} rootNote - Note name, e.g. 'C'
 * @param {number} octave - Base octave
 * @returns {number[]} Array of MIDI note numbers
 */
export function getScaleNotes(scaleName, rootNote, octave = 4, count = 32) {
  const scale = SCALES[scaleName];
  if (!scale) return [];
  const rootMidi = noteNameToMidi(rootNote, octave);
  const notes = [];
  let currentOctaveOffset = 0;
  while (notes.length < count) {
    for (let i = 0; i < scale.intervals.length && notes.length < count; i++) {
      notes.push(rootMidi + currentOctaveOffset + scale.intervals[i]);
    }
    currentOctaveOffset += 12;
  }
  return notes;
}
