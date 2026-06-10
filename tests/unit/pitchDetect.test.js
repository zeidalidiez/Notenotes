import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectPitchHz,
  hzToMidi,
  midiToHz,
  transcribeSamplesToNotes,
} from '../../src/engine/PitchDetect.js';

const SR = 44100;

function tone(midi, seconds, amp = 0.6) {
  const hz = midiToHz(midi);
  const n = Math.floor(seconds * SR);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return a;
}
function silence(seconds) {
  return new Float32Array(Math.floor(seconds * SR));
}
function concat(arrs) {
  const n = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

test('hz/midi conversions round-trip at A4 and octaves', () => {
  assert.equal(Math.round(hzToMidi(440)), 69);
  assert.equal(Math.round(hzToMidi(220)), 57);
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-6);
  assert.ok(Math.abs(midiToHz(60) - 261.6256) < 0.01);
  assert.equal(hzToMidi(0), null);
});

test('detectPitchHz identifies clean tones across the range (incl. low C2)', () => {
  // Includes midi 36 (~C2, near the minHz boundary) and 40 to guard the
  // descend-then-first-peak picker against the minLag false-peak and the
  // maxLag boundary case.
  for (const midi of [36, 40, 48, 55, 60, 64, 67, 69, 72, 84]) {
    // A longer frame gives the low notes enough periods to lock onto.
    const p = detectPitchHz(tone(midi, 0.12).subarray(0, 4096), SR);
    assert.ok(p, `expected a pitch for midi ${midi}`);
    assert.equal(Math.round(hzToMidi(p.hz)), midi, `midi ${midi} detected as ${hzToMidi(p.hz)}`);
    assert.ok(p.clarity > 0.9);
  }
});

test('detectPitchHz finds a tone sitting right at the minHz boundary', () => {
  // 80 Hz with minHz=80 puts the period exactly at maxLag - the case that used
  // to fall off the end of the scan and return null.
  const hz = 80;
  const n = Math.floor(0.12 * SR);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 0.6 * Math.sin((2 * Math.PI * hz * i) / SR);
  const p = detectPitchHz(a.subarray(0, 4096), SR, { minHz: 80 });
  assert.ok(p, 'expected a boundary tone to be detected');
  assert.ok(Math.abs(p.hz - 80) < 3, `detected ${p.hz}, expected ~80`);
});

test('detectPitchHz returns null for silence and low-level noise', () => {
  assert.equal(detectPitchHz(silence(0.1).subarray(0, 2048), SR), null);
  // Tiny-amplitude tone falls under the level gate -> unvoiced.
  assert.equal(detectPitchHz(tone(60, 0.1, 0.001).subarray(0, 2048), SR), null);
});

test('transcribeSamplesToNotes turns a sung line into MIDI notes', () => {
  const melody = concat([
    tone(60, 0.4), silence(0.06),
    tone(64, 0.4), silence(0.06),
    tone(67, 0.4), silence(0.06),
    tone(72, 0.4),
  ]);
  const { notes, durationTicks } = transcribeSamplesToNotes(melody, SR, { bpm: 120 });
  assert.deepEqual(notes.map(n => n.pitch), [60, 64, 67, 72]);
  // Notes advance in time and have positive duration.
  for (let i = 0; i < notes.length; i++) {
    assert.ok(notes[i].durationTick > 0);
    if (i > 0) assert.ok(notes[i].startTick > notes[i - 1].startTick);
    assert.ok(notes[i].velocity > 0 && notes[i].velocity <= 1);
  }
  assert.ok(durationTicks >= 480);
});

test('transcribeSamplesToNotes returns nothing for silence or too-short input', () => {
  assert.deepEqual(transcribeSamplesToNotes(silence(1), SR, { bpm: 120 }).notes, []);
  assert.deepEqual(transcribeSamplesToNotes(new Float32Array(100), SR, { bpm: 120 }).notes, []);
  assert.deepEqual(transcribeSamplesToNotes(null, SR).notes, []);
});

test('tempo affects tick placement (faster bpm -> later ticks for same audio)', () => {
  const melody = concat([tone(60, 0.5), silence(0.05), tone(62, 0.5)]);
  const slow = transcribeSamplesToNotes(melody, SR, { bpm: 60 });
  const fast = transcribeSamplesToNotes(melody, SR, { bpm: 180 });
  assert.deepEqual(slow.notes.map(n => n.pitch), [60, 62]);
  assert.deepEqual(fast.notes.map(n => n.pitch), [60, 62]);
  // Same wall-clock onset, more ticks/second at higher bpm.
  assert.ok(fast.notes[1].startTick > slow.notes[1].startTick);
});
