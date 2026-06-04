import test from 'node:test';
import assert from 'node:assert/strict';

import {
  correctMidiToScale,
  degreeForMidi,
  getScaleNotes,
  midiToFreq,
  midiToNoteName,
  normalizeMusicalContext,
  noteNameToMidi,
} from '../../src/engine/MusicTheory.js';
import {
  resolveProgressionStep,
  activeProgressionResolution,
  normalizeProgressionContext,
} from '../../src/engine/Progressions.js';

test('getScaleNotes walks a major scale by semitone pattern', () => {
  assert.deepEqual(getScaleNotes('major', 'C', 4, 8), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.deepEqual(getScaleNotes('minor', 'A', 4, 7), [69, 71, 72, 74, 76, 77, 79]);
});

test('degreeForMidi names scale degrees relative to the root', () => {
  const cMajor = normalizeMusicalContext({ root: 'C', scale: 'major' });
  assert.equal(degreeForMidi(60, cMajor).interval, 0);
  assert.equal(degreeForMidi(60, cMajor).functionName, 'Tonic');
  assert.equal(degreeForMidi(67, cMajor).interval, 7);
  assert.equal(degreeForMidi(72, cMajor).interval, 0, 'octave folds back to the root degree');
});

test('correctMidiToScale snaps off-scale notes only when enabled', () => {
  const cMajor = normalizeMusicalContext({ root: 'C', scale: 'major' });
  assert.equal(correctMidiToScale(61, cMajor, 'off'), 61, 'off leaves notes untouched');
  assert.equal(correctMidiToScale(61, cMajor, 'closest'), 62, 'C# snaps up to D (nearer)');
  assert.equal(correctMidiToScale(66, cMajor, 'up'), 67, 'F# snaps up to G');
  assert.equal(correctMidiToScale(66, cMajor, 'down'), 65, 'F# snaps down to F');
  assert.equal(correctMidiToScale(64, cMajor, 'closest'), 64, 'in-scale notes are unchanged');
});

test('chromatic scale never corrects', () => {
  const chromatic = { root: 'C', scale: 'chromatic' };
  assert.equal(correctMidiToScale(61, chromatic, 'closest'), 61);
  assert.equal(correctMidiToScale(66, chromatic, 'down'), 66);
});

test('midi/frequency and note-name round trips are stable', () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(60) - 261.6256) < 0.001);
  assert.equal(midiToNoteName(60).display, 'C4');
  assert.equal(noteNameToMidi('C', 4), 60);
  assert.equal(noteNameToMidi('A', 4), 69);
});

test('progression resolver stores degrees but voices them against the current key', () => {
  const cI = resolveProgressionStep({ degree: 'I' }, { root: 'C', scale: 'major' });
  assert.deepEqual(cI.midis, [60, 64, 67]);

  const gI = resolveProgressionStep({ degree: 'I' }, { root: 'G', scale: 'major' });
  assert.deepEqual(gI.midis, [67, 71, 74], 'same degree, transposed to G');

  const cMinorBVII = resolveProgressionStep({ degree: 'bVII' }, { root: 'C', scale: 'minor' });
  assert.deepEqual(cMinorBVII.midis, [70, 74, 77]);
});

test('progression resolver builds seventh chords when requested', () => {
  const cV7 = resolveProgressionStep({ degree: 'V' }, { root: 'C', scale: 'major' }, { chordType: 'seventh' });
  assert.deepEqual(cV7.midis, [67, 71, 74, 77], 'G dominant seventh');
});

test('active progression resolution returns the current chord only when enabled', () => {
  const progression = normalizeProgressionContext({
    enabled: true, chordType: 'triad', activeStepIndex: 1,
    steps: [{ degree: 'I' }, { degree: 'V' }],
  });
  const active = activeProgressionResolution(progression, { root: 'C', scale: 'major' });
  assert.deepEqual(active.midis, [67, 71, 74]);

  const off = activeProgressionResolution({ ...progression, enabled: false }, { root: 'C', scale: 'major' });
  assert.equal(off, null);
});
