/**
 * Drone - a sustained tonal anchor on the root of the project key.
 *
 * The note math is pure: given the musical context and drone settings, it
 * returns the MIDI notes to hold. The root sits low (default octave 3) so it
 * anchors underneath the pads/keys rather than competing with them, and an
 * optional perfect fifth turns it into a fuller open-fifth drone.
 *
 * This module computes notes only. Starting/stopping the held voices and
 * re-pitching on key changes is the instrument layer's job. The drone is a live
 * performance anchor, not recorded or exported.
 */

import { noteNameToMidi, normalizeMusicalContext } from './MusicTheory.js';

export const DRONE_MIN_OCTAVE = 1;
export const DRONE_MAX_OCTAVE = 6;
export const DEFAULT_DRONE_OCTAVE = 3;

export const DEFAULT_DRONE_SETTINGS = {
  enabled: false,
  octave: DEFAULT_DRONE_OCTAVE,
  addFifth: false,
};

export function normalizeDroneSettings(value = {}) {
  const octaveRaw = Number(value?.octave);
  const octave = Number.isFinite(octaveRaw)
    ? Math.max(DRONE_MIN_OCTAVE, Math.min(DRONE_MAX_OCTAVE, Math.round(octaveRaw)))
    : DEFAULT_DRONE_OCTAVE;
  return {
    enabled: !!value?.enabled,
    octave,
    addFifth: !!value?.addFifth,
  };
}

/**
 * MIDI notes to hold for the drone: the root at the chosen octave, plus the
 * perfect fifth above when `addFifth` is on. Returns [] when disabled.
 */
export function droneNotesForContext(context = {}, settings = {}) {
  const drone = normalizeDroneSettings(settings);
  if (!drone.enabled) return [];
  const musical = normalizeMusicalContext(context);
  const root = noteNameToMidi(musical.root, drone.octave);
  if (!Number.isFinite(root)) return [];
  const notes = [root];
  if (drone.addFifth) notes.push(root + 7);
  return notes;
}
