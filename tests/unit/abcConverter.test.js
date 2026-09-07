import test from 'node:test';
import assert from 'node:assert/strict';
import abcjs from 'abcjs';
import { snippetToABC, projectToABC } from '../../src/export/ABCConverter.js';

function score(notes, options = {}) {
  const abc = snippetToABC({ type: 'midi', bpm: 120, durationTicks: 3840, notes, ...options });
  const tune = abcjs.parseOnly(abc)[0];
  assert.equal(tune.warnings, undefined, 'abcjs accepts the notation');
  const voices = [];
  for (const line of tune.lines) for (const staff of line.staff || []) {
    staff.voices.forEach((elements, index) => {
      voices[index] ||= [];
      let timing = voices[index].reduce((sum, event) => sum + event.duration, 0);
      let multiplier = 1;
      for (const element of elements) {
        if (element.el_type !== 'note') continue;
        if (element.startTriplet) multiplier = element.tripletMultiplier;
        const duration = element.duration * multiplier;
        voices[index].push({ ...element, timing, duration });
        timing += duration;
        if (element.endTriplet) multiplier = 1;
      }
    });
  }
  return { abc, voices };
}

test('ABC preserves simultaneous chords and independently overlapping note lengths', () => {
  const { voices } = score([
    ...[60, 64, 67].map(pitch => ({ pitch, startTick: 0, durationTick: 480 })),
    { pitch: 72, startTick: 240, durationTick: 960 },
  ]);
  assert.equal(voices.length, 2);
  assert.equal(voices[0][0].pitches.length, 3);
  assert.equal(voices[0][0].duration * 1920, 480);
  const overlap = voices[1].find(event => event.pitches?.length);
  assert.equal(overlap.timing * 1920, 240);
  assert.equal(overlap.duration * 1920, 960);
});

test('ABC splits sustained notes and rests at bars, ties notes, and retains fractional rhythms', () => {
  const { abc, voices } = score([
    { pitch: 60, startTick: 1800, durationTick: 200 },
    { pitch: 62, startTick: 2080, durationTick: 80 },
  ]);
  assert.match(abc, /C1\/2- \| \(3:2:1C1\/2/);
  const note = voices[0].find(event => event.pitches?.[0]?.name === 'D');
  assert.ok(Math.abs(note.timing * 1920 - 2080) < 1e-8);
  assert.ok(Math.abs(note.duration * 1920 - 80) < 1e-8);
  const total = voices[0].reduce((sum, event) => sum + event.duration, 0);
  assert.ok(Math.abs(total * 1920 - 3840) < 1e-8);
});

test('ABC resets chromatic accidentals and supports the complete MIDI octave range', () => {
  const { abc } = score([61, 60, 0, 127].map((pitch, i) => ({ pitch, startTick: i * 480, durationTick: 480 })));
  assert.match(abc, /\^C2 =C2/);
  assert.match(abc, /C,,,,,2/);
  assert.match(abc, /g''''2/);
});

test('drum notation groups simultaneous hits without shifting later beats', () => {
  const { voices, abc } = score([], { type: 'drum', meter: '6/8', bpm: 120, hits: [
    { type: 'kick', startTick: 0 }, { type: 'hihat', startTick: 0 }, { type: 'snare', startTick: 720 },
  ] });
  assert.match(abc, /M:6\/8/);
  assert.match(abc, /Q:1\/4=180/);
  assert.equal(voices[0][0].pitches.length, 2);
  assert.equal(voices[0].filter(event => event.pitches).at(-1).timing * 1920, 720);
  assert.equal(abcjs.parseOnly(projectToABC({ name: 'P', snippets: [{ notes: [] }, { notes: [] }] })).length, 2);
});
