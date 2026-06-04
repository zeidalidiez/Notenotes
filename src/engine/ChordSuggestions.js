/**
 * ChordSuggestions - gentle "where could this go next?" harmony hints.
 *
 * The suggestions are derived from functional harmony: each diatonic degree has
 * a short, ranked list of chords it most often moves to. Suggestions resolve
 * against the current project key/scale (reusing the progression resolver), so
 * the note names and chord qualities are always correct for the active scale,
 * and any degree that can't form a chord in the current scale is dropped.
 *
 * This is a context layer only: it never changes what notes play, record, or
 * export. It just answers "what chord might come next?" when the user asks.
 */

import { midiToNoteName, normalizeMusicalContext } from './MusicTheory.js';
import { normalizeProgressionContext, parseDegreeToken, resolveProgressionStep } from './Progressions.js';

const ROMAN_UPPER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// Functional successors by diatonic degree index (0..6), strongest move first.
// Quality (major/minor/dim) comes from the scale at resolve time; this is just
// the harmonic "where does this want to go" skeleton.
const DEGREE_SUCCESSORS = {
  0: [3, 4, 5, 1], // I  -> IV, V, vi, ii
  1: [4, 6, 3],    // ii -> V, vii, IV
  2: [5, 3, 0],    // iii-> vi, IV, I
  3: [4, 0, 1],    // IV -> V, I, ii
  4: [0, 5, 3],    // V  -> I, vi, IV
  5: [3, 1, 4],    // vi -> IV, ii, V
  6: [0, 2],       // vii-> I, iii
};

// When nothing has been played yet, suggest strong, common openers.
const DEFAULT_OPENERS = [0, 4, 3, 5];

export const MAX_CHORD_SUGGESTIONS = 4;

export function clampDegreeIndex(value) {
  if (!Number.isInteger(value)) return null;
  const wrapped = ((value % 7) + 7) % 7;
  return wrapped;
}

function triadQuality(midis) {
  if (!Array.isArray(midis) || midis.length < 3) return 'other';
  const third = (((midis[1] - midis[0]) % 12) + 12) % 12;
  const fifth = (((midis[2] - midis[0]) % 12) + 12) % 12;
  if (third === 4 && fifth === 7) return 'major';
  if (third === 3 && fifth === 7) return 'minor';
  if (third === 3 && fifth === 6) return 'diminished';
  if (third === 4 && fifth === 8) return 'augmented';
  return 'other';
}

export function romanForQuality(index, quality) {
  const base = ROMAN_UPPER[index];
  if (!base) return '';
  if (quality === 'minor') return base.toLowerCase();
  if (quality === 'diminished') return `${base.toLowerCase()}°`;
  if (quality === 'augmented') return `${base}+`;
  return base;
}

function resolveDegreeIndex(index, context, reason) {
  const token = ROMAN_UPPER[index];
  if (!token) return null;
  const resolved = resolveProgressionStep({ degree: token }, context, { chordType: 'triad' });
  if (!resolved || !resolved.midis.length) return null;
  const quality = triadQuality(resolved.midis);
  return {
    degreeIndex: index,
    roman: romanForQuality(index, quality),
    quality,
    midis: resolved.midis,
    pitchClasses: resolved.pitchClasses,
    noteNames: resolved.midis.map(midi => midiToNoteName(midi).name),
    reason: reason || 'common move',
  };
}

/**
 * The next chord in an active progression (the step after `activeStepIndex`,
 * wrapping), or null when no progression is active / it can't resolve.
 */
export function progressionNextSuggestion(progression = {}, context = {}) {
  const normalized = normalizeProgressionContext(progression);
  if (!normalized.enabled || normalized.steps.length < 2) return null;
  const musical = normalizeMusicalContext(context);
  const nextIndex = (normalized.activeStepIndex + 1) % normalized.steps.length;
  const step = normalized.steps[nextIndex];
  const resolved = resolveProgressionStep(step, musical, { chordType: normalized.chordType });
  if (!resolved) return null;
  const parsed = parseDegreeToken(resolved.degree);
  return {
    degree: resolved.degree,
    degreeIndex: parsed ? parsed.degreeIndex : null,
    roman: resolved.label || resolved.degree,
    quality: triadQuality(resolved.midis),
    midis: resolved.midis,
    pitchClasses: resolved.pitchClasses,
    noteNames: resolved.midis.map(midi => midiToNoteName(midi).name),
    reason: 'next in your changes',
    fromProgression: true,
  };
}

/**
 * Ranked next-chord suggestions for the current key/scale.
 *
 * @param {object} context  musical context ({ root, scale })
 * @param {object} options
 *   - currentDegreeIndex: diatonic index (0..6) of the chord just played, or null
 *   - progression:        active progression; if enabled, its upcoming step leads
 *   - limit:              max suggestions (default MAX_CHORD_SUGGESTIONS)
 * @returns {Array} suggestion objects, deduped by degree, resolvable-only
 */
export function suggestNextChords(context = {}, options = {}) {
  const musical = normalizeMusicalContext(context);
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? options.limit
    : MAX_CHORD_SUGGESTIONS;
  const current = clampDegreeIndex(options.currentDegreeIndex);

  const suggestions = [];
  const seen = new Set();
  const pushIndex = (index, reason) => {
    if (index == null || seen.has(index) || index === current) return;
    const resolved = resolveDegreeIndex(index, musical, reason);
    if (!resolved) return;
    seen.add(index);
    suggestions.push(resolved);
  };

  // Lead with the active progression's next step when there is one.
  const fromProgression = progressionNextSuggestion(options.progression, musical);
  if (fromProgression && !seen.has(fromProgression.degreeIndex)) {
    suggestions.push(fromProgression);
    if (Number.isInteger(fromProgression.degreeIndex)) seen.add(fromProgression.degreeIndex);
  }

  const order = current == null ? DEFAULT_OPENERS : (DEGREE_SUCCESSORS[current] || DEFAULT_OPENERS);
  for (const index of order) pushIndex(index, current == null ? 'a strong place to start' : 'common move');

  // Backfill from the tonic family if functional moves didn't fill the list.
  if (suggestions.length < limit) {
    for (const index of DEFAULT_OPENERS) pushIndex(index, 'common move');
  }

  return suggestions.slice(0, limit);
}
