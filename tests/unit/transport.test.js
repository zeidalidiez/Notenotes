import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/engine/AudioEngine.js';
import { ArpeggioManager } from '../../src/engine/ArpeggioManager.js';
import { Transport } from '../../src/engine/Transport.js';

function freshTransport() {
  const engine = AudioEngine.getInstance();
  engine._initialized = false;
  engine.ctx = null;
  engine.initSync();
  const ctx = globalThis.__lastAudioContext;
  const transport = new Transport();
  transport.loopEnabled = false;
  transport._startScheduler = () => {};
  transport._stopScheduler = () => {};
  return { ctx, transport };
}

test('changing BPM while playing preserves the current tick and anchors the new rate', () => {
  const { ctx, transport } = freshTransport();
  transport.play();
  ctx.currentTime = 2;
  assert.equal(transport.currentRawTick, 1920);

  transport._nextTickTime = 2;
  transport.bpm = 240;
  assert.equal(transport.currentRawTick, 1920, 'tempo change does not reinterpret elapsed time');

  ctx.currentTime = 2.5;
  assert.equal(transport.currentRawTick, 2880, 'subsequent ticks advance at the new tempo');
});

test('a tempo change begins after the already-scheduled lookahead horizon', () => {
  const { ctx, transport } = freshTransport();
  transport.play();
  ctx.currentTime = 2;
  transport._nextTickTime = 2.1;
  transport.bpm = 240;

  assert.equal(transport.currentRawTick, 1920);
  ctx.currentTime = 2.1;
  assert.equal(transport.currentRawTick, 2016, 'old tempo remains authoritative through emitted audio');
  ctx.currentTime = 2.6;
  assert.equal(transport.currentRawTick, 2976, 'new segment begins at the first unscheduled time');
});

test('changing meter while playing keeps the raw tick continuous', () => {
  const { ctx, transport } = freshTransport();
  transport.play();
  ctx.currentTime = 1.25;
  const before = transport.currentRawTick;
  transport._nextTickTime = ctx.currentTime;

  transport.meter = '6/8';

  assert.equal(transport.currentRawTick, before);
});

test('arpeggio steps carry explicit AudioContext times from a lookahead window', () => {
  const calls = [];
  const synth = {
    engine: { currentTime: 10 },
    noteOn(midi, velocity, audioTime) { calls.push({ type: 'on', midi, velocity, audioTime }); },
    noteOff(midi, audioTime) { calls.push({ type: 'off', midi, audioTime }); },
    allNotesOff() {},
  };
  const transport = { bpm: 120 };
  const manager = new ArpeggioManager(transport, { settings: { arpRate: '1/16', arpPattern: 'up' } });
  manager.wrapSynth(synth);
  manager._arpNotes.set(60, { notes: [60, 64, 67], velocity: 0.7 });
  manager._arpNextTime = 10.02;

  manager._scheduleArpWindow();

  assert.deepEqual(calls.map(call => call.type), ['on', 'off']);
  assert.equal(calls[0].audioTime, 10.02);
  assert.equal(calls[1].audioTime, 10.02 + 0.125 * 0.55);
  assert.ok(calls.every(call => Number.isFinite(call.audioTime)), 'musical calls are audio-clock scheduled');
});

test('held notes schedule their release on the audio clock, not from the cleanup timer', () => {
  const calls = [];
  const synth = {
    engine: { currentTime: 7 },
    noteOn(midi, velocity, audioTime) { calls.push({ type: 'on', midi, velocity, audioTime }); },
    noteOff(midi, audioTime) { calls.push({ type: 'off', midi, audioTime }); },
    cancelNote(midi, audioTime) { calls.push({ type: 'cancel', midi, audioTime }); },
    allNotesOff() {},
  };
  const manager = new ArpeggioManager({ bpm: 120 }, { settings: { holdDuration: 3000 } });
  manager.wrapSynth(synth);
  manager._mode = 'hold';

  synth.noteOn(60, 0.5);

  assert.deepEqual(calls.slice(0, 2), [
    { type: 'on', midi: 60, velocity: 0.5, audioTime: 7 },
    { type: 'off', midi: 60, audioTime: 10 },
  ]);

  synth.noteOn(60, 0.5);
  assert.deepEqual(calls[2], { type: 'cancel', midi: 60, audioTime: 7 });
  manager._releaseAll();
});
