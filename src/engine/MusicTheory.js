/**
 * MusicTheory — Scale definitions, note names, and MIDI utilities.
 */

/** MIDI note number for C4 (middle C) */
export const MIDDLE_C = 60;

/** All 12 note names */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Scale interval patterns (semitones from root) */
export const SCALES = {
  major:       { name: 'Major',       intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor:       { name: 'Minor',       intervals: [0, 2, 3, 5, 7, 8, 10] },
  pentatonic:  { name: 'Pentatonic',  intervals: [0, 2, 4, 7, 9] },
  pentatonicMinor: { name: 'Pent. Minor', intervals: [0, 3, 5, 7, 10] },
  blues:       { name: 'Blues',        intervals: [0, 3, 5, 6, 7, 10] },
  dorian:      { name: 'Dorian',       intervals: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian:  { name: 'Mixolydian',   intervals: [0, 2, 4, 5, 7, 9, 10] },
  chromatic:   { name: 'Chromatic',    intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
};

export const DEFAULT_MUSICAL_CONTEXT = {
  root: 'C',
  scale: 'major'
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

export function normalizeMusicalContext(context = {}) {
  const root = NOTE_NAMES.includes(context?.root) ? context.root : DEFAULT_MUSICAL_CONTEXT.root;
  const scale = SCALES[context?.scale] ? context.scale : DEFAULT_MUSICAL_CONTEXT.scale;
  return { root, scale };
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
    name: INTERVAL_NAMES[interval] || `Interval ${interval}`
  };
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

/**
 * Get scale degree label (1–7) for display.
 * @param {number} index - 0-indexed scale degree
 * @param {object} scale - Scale definition from SCALES
 * @returns {string}
 */
export function getScaleDegreeLabel(index, scaleName) {
  const scale = SCALES[scaleName];
  if (!scale) return String(index + 1);
  const labels = ['1', '2', '3', '4', '5', '6', '7'];
  return labels[index % labels.length] || String(index + 1);
}
