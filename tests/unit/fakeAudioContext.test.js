import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeAudioContext } from '../fixtures/FakeAudioContext.js';

// The FakeAudioContext is the instrument the crash hunt depends on. If its
// lifecycle accounting is wrong, every voice-lifecycle assertion is worthless —
// so it gets its own tests.

test('clock is manual: currentTime only moves when advanced', () => {
  const ctx = new FakeAudioContext();
  assert.equal(ctx.currentTime, 0);
  ctx.advance(0.5);
  assert.equal(ctx.currentTime, 0.5);
  ctx.currentTime = 2;
  assert.equal(ctx.currentTime, 2);
});

test('a started source is live until its scheduled stop time is crossed', () => {
  const ctx = new FakeAudioContext();
  const osc = ctx.createOscillator();
  osc.start(0);
  osc.stop(1);
  assert.equal(ctx.liveNodeCount(), 1, 'live while playing');
  ctx.advance(0.5);
  assert.equal(ctx.liveNodeCount(), 1, 'still live before stop time');
  ctx.advance(1.0);
  assert.equal(ctx.liveNodeCount(), 0, 'dead once stop time passed');
});

test('a buffer source with no explicit stop ends at its buffer duration', () => {
  const ctx = new FakeAudioContext();
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); // 1 second
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.start(0);
  assert.equal(ctx.liveSourceCount('BufferSource'), 1);
  ctx.advance(0.9);
  assert.equal(ctx.liveSourceCount('BufferSource'), 1, 'still within buffer duration');
  ctx.advance(0.2);
  assert.equal(ctx.liveSourceCount('BufferSource'), 0, 'ended at buffer duration');
});

test('playbackRate shortens a buffer source lifetime (pitched-up sample)', () => {
  const ctx = new FakeAudioContext();
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); // 1s at rate 1
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 2; // plays twice as fast → 0.5s
  src.start(0);
  ctx.advance(0.6);
  assert.equal(ctx.liveSourceCount('BufferSource'), 0, 'pitched-up sample ends sooner');
});

test('ended fires exactly once when the stop time is crossed', () => {
  const ctx = new FakeAudioContext();
  const osc = ctx.createOscillator();
  let fired = 0;
  osc.addEventListener('ended', () => { fired++; }, { once: true });
  osc.start(0);
  osc.stop(0.5);
  ctx.advance(0.4);
  assert.equal(fired, 0);
  ctx.advance(0.2);
  assert.equal(fired, 1);
  ctx.advance(1.0);
  assert.equal(fired, 1, 'ended is one-shot');
});

test('created/connect/disconnect counters track graph activity', () => {
  const ctx = new FakeAudioContext();
  const a = ctx.createGain();
  const b = ctx.createBiquadFilter();
  a.connect(b);
  b.connect(ctx.destination);
  assert.equal(ctx.createdCount('Gain'), 1);
  assert.equal(ctx.createdCount('BiquadFilter'), 1);
  assert.equal(ctx.connectCount(), 2);
  a.disconnect();
  assert.equal(ctx.disconnectCount(), 1);
});

test('AudioParam automation is recorded and the value tracks the last write', () => {
  const ctx = new FakeAudioContext();
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(1, 0.1);
  assert.equal(gain.gain.value, 1);
  assert.equal(gain.gain.automation.length, 2);
  assert.equal(gain.gain.automation[1].op, 'linearRampToValueAtTime');
});
