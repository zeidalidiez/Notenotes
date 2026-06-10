/**
 * Synesthesia - map a snippet's pitches to a single representative color so a
 * Canvas clip can glow "its note color" as it plays.
 *
 * The color comes from the same degree-color palette the pads and piano use
 * (keyed by chromatic interval from the project root), so a clip reads in the
 * same color language as the rest of the app. The dominant scale degree of the
 * clip (the pitch class that sounds for the longest total time) picks the color.
 *
 * Pure and DOM-free: it takes a snippet, a musical context, and the degree
 * color map, and returns a hex string (or null when there is nothing pitched to
 * color, e.g. drum or audio snippets).
 */

import { degreeForMidi, normalizeMusicalContext } from './MusicTheory.js';

/**
 * Representative color for a snippet, or null when it has no pitched content.
 *
 * @param {object} snippet         a snippet with `notes` (pitched events)
 * @param {object} context         musical context ({ root, scale })
 * @param {object} degreeColors    interval->hex map (12 entries; from
 *                                  normalizeDegreeHighlighting().colors)
 * @returns {string|null}
 */
export function snippetColor(snippet, context, degreeColors) {
  const notes = Array.isArray(snippet?.notes) ? snippet.notes : [];
  if (!notes.length || !degreeColors) return null;

  const musical = normalizeMusicalContext(context);
  const weightByInterval = new Map();
  for (const note of notes) {
    const midi = Number(note?.pitch);
    if (!Number.isFinite(midi)) continue;
    const meta = degreeForMidi(midi, musical);
    if (!meta || meta.interval == null) continue;
    const weight = Math.max(1, Number(note.durationTick) || 1);
    weightByInterval.set(meta.interval, (weightByInterval.get(meta.interval) || 0) + weight);
  }
  if (!weightByInterval.size) return null;

  // Dominant interval = most total sounding time. Ties resolve to the lower
  // interval (closer to the root) so the result is deterministic.
  let bestInterval = null;
  let bestWeight = -1;
  for (const [interval, weight] of weightByInterval) {
    if (weight > bestWeight || (weight === bestWeight && interval < bestInterval)) {
      bestWeight = weight;
      bestInterval = interval;
    }
  }
  return degreeColors[bestInterval] || null;
}
