import test from 'node:test';
import assert from 'node:assert/strict';

import { RecordingManager } from '../../src/engine/RecordingManager.js';
import { Quantizer, QuantizeGrid } from '../../src/engine/Quantizer.js';
import { makeFakeTransport } from '../fixtures/fakeTransport.js';

function setup({ grid = QuantizeGrid.OFF } = {}) {
  const transport = makeFakeTransport({ ticksPerBar: 1920, bpm: 120 });
  const quantizer = new Quantizer(480);
  quantizer.setGrid(grid);
  const rm = new RecordingManager(transport, quantizer);
  rm.init();
  let snippet = null;
  rm.onSnippetCreated((s) => { snippet = s; });
  return { transport, quantizer, rm, getSnippet: () => snippet };
}

test('captures a note from noteOn/noteOff with correct duration', () => {
  const { transport, rm } = setup();
  rm.setArmed(true);

  transport.seek(0);
  rm.noteOn(60, 0.9);
  transport.seek(240);
  rm.noteOff(60);

  assert.equal(rm._capturedNotes.length, 1);
  const note = rm._capturedNotes[0];
  assert.equal(note.pitch, 60);
  assert.equal(note.startTick, 0);
  assert.equal(note.durationTick, 240);
  assert.equal(note.velocity, 0.9);
});

test('trims leading empty ticks so the snippet starts at the first event', () => {
  const { transport, rm, getSnippet } = setup();
  rm.setArmed(true);

  transport.seek(480);
  rm.noteOn(60, 0.8);
  transport.seek(720);
  rm.noteOff(60);

  rm._finalizeSnippet();
  const snippet = getSnippet();
  assert.equal(snippet.notes[0].startTick, 0, 'first note slid back to tick 0');
  assert.equal(snippet.notes[0].durationTick, 240);
});

test('finalizes held notes when recording stops via transport state change', () => {
  const { transport, rm, getSnippet } = setup();
  rm.setArmed(true);

  transport.seek(0);
  rm.noteOn(64, 0.7);
  // never call noteOff — note is still held when transport stops
  transport.emitState('stopped', { rawTick: 360 });

  const snippet = getSnippet();
  assert.ok(snippet, 'a snippet was created on stop');
  assert.equal(snippet.notes.length, 1, 'held note was finalized');
  assert.equal(snippet.notes[0].durationTick, 360, 'held duration uses the stop tick');
  assert.equal(rm.armed, false, 'recording disarmed after stop');
});

test('drum hits are captured as instant events and classify the snippet as drum', () => {
  const { transport, rm, getSnippet } = setup();
  rm.setArmed(true);

  transport.seek(0);
  rm.drumHit('kick');
  transport.seek(480);
  rm.drumHit('snare');

  rm._finalizeSnippet();
  const snippet = getSnippet();
  assert.equal(snippet.type, 'drum', 'hits-only snippet is a drum snippet');
  assert.equal(snippet.hits.length, 2);
  assert.deepEqual(snippet.hits.map(h => h.type), ['kick', 'snare']);
});

test('mixed notes and hits classify the snippet as midi', () => {
  const { transport, rm, getSnippet } = setup();
  rm.setArmed(true);

  transport.seek(0);
  rm.noteOn(60, 0.8);
  transport.seek(120);
  rm.noteOff(60);
  rm.drumHit('kick');

  rm._finalizeSnippet();
  assert.equal(getSnippet().type, 'midi', 'presence of melodic notes makes it a midi snippet');
});

test('events captured while disarmed are ignored', () => {
  const { transport, rm } = setup();
  // not armed
  transport.seek(0);
  rm.noteOn(60, 0.8);
  rm.drumHit('kick');
  assert.equal(rm._capturedNotes.length, 0);
  assert.equal(rm._capturedHits.length, 0);
});

test('quantization snaps captured note start ticks to the grid', () => {
  const { transport, rm } = setup({ grid: QuantizeGrid.QUARTER }); // 480-tick grid
  rm.setArmed(true);

  transport.seek(70); // closer to 0 than to 480
  rm.noteOn(60, 0.8);
  transport.seek(560); // closer to 480
  rm.noteOff(60);

  const note = rm._capturedNotes[0];
  assert.equal(note.startTick, 0, 'start snapped to nearest quarter');
});
