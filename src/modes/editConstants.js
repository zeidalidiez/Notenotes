/**
 * editConstants — Shared constants for EditMode and its feature mixins
 * (geometry, note-height bounds, octave range, drum types).
 */

export const TICK_WIDTH = 0.15;
export const DEFAULT_NOTE_HEIGHT = 16;
export const MIN_NOTE_HEIGHT = 8;
export const MAX_NOTE_HEIGHT = 24;
export const MIN_PIANO_OCTAVE = 1;
export const MAX_PIANO_OCTAVE = 6;

export const DRUM_TYPES = [
  { id: 'kick',   label: 'KICK' },
  { id: 'snare',  label: 'SNARE' },
  { id: 'clap',   label: 'CLAP' },
  { id: 'hihat',  label: 'HI-HAT' },
  { id: 'cymbal', label: 'CYMBAL' },
  { id: 'tomlo',  label: 'TOM LO' },
  { id: 'tommid', label: 'TOM MID' },
  { id: 'tomhi',  label: 'TOM HI' },
  { id: 'rim',    label: 'RIM' },
  { id: 'shaker', label: 'SHAKER' },
];
