import test from 'node:test';
import assert from 'node:assert/strict';

import { snippetColor } from '../../src/engine/Synesthesia.js';
import { normalizeDegreeHighlighting } from '../../src/engine/MusicTheory.js';

const C = { root: 'C', scale: 'major' };
const COLORS = normalizeDegreeHighlighting({ palette: 'default' }).colors;

test('snippetColor picks the color of the dominant scale degree', () => {
  // Tonic (C) sounds far longer than the others -> interval 0 color.
  const tonicHeavy = { notes: [
    { pitch: 60, durationTick: 960 },
    { pitch: 64, durationTick: 120 },
    { pitch: 67, durationTick: 120 },
  ] };
  assert.equal(snippetColor(tonicHeavy, C, COLORS), COLORS[0]);

  // Dominant (G = interval 7) is the longest -> interval 7 color.
  const domHeavy = { notes: [
    { pitch: 67, durationTick: 960 },
    { pitch: 60, durationTick: 120 },
  ] };
  assert.equal(snippetColor(domHeavy, C, COLORS), COLORS[7]);
});

test('snippetColor follows the project key', () => {
  // In G major, a G-rooted clip maps to the tonic (interval 0) color.
  const g = { notes: [{ pitch: 67, durationTick: 480 }] };
  assert.equal(snippetColor(g, { root: 'G', scale: 'major' }, COLORS), COLORS[0]);
  // The same clip in C major is the dominant (interval 7).
  assert.equal(snippetColor(g, C, COLORS), COLORS[7]);
});

test('snippetColor returns null when there is nothing pitched to color', () => {
  assert.equal(snippetColor({ hits: [{ type: 'kick' }], notes: [] }, C, COLORS), null);
  assert.equal(snippetColor({ type: 'audio' }, C, COLORS), null);
  assert.equal(snippetColor({ notes: [{ pitch: 60 }] }, C, null), null); // no palette
  assert.equal(snippetColor(null, C, COLORS), null);
});

test('snippetColor weights by duration and breaks ties toward the root', () => {
  // Equal total time on tonic (0) and dominant (7) -> lower interval wins.
  const tie = { notes: [
    { pitch: 60, durationTick: 480 },
    { pitch: 67, durationTick: 480 },
  ] };
  assert.equal(snippetColor(tie, C, COLORS), COLORS[0]);
});
