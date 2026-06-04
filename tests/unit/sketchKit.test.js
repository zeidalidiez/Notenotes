import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/engine/AudioEngine.js';
import { SketchKit } from '../../src/instruments/SketchKit.js';

function freshKit() {
  const engine = AudioEngine.getInstance();
  engine._initialized = false;
  engine.ctx = null;
  engine.initSync();
  const ctx = globalThis.__lastAudioContext;
  const kit = new SketchKit();
  kit.init();
  kit.loadKit('classic');
  return { ctx, kit };
}

test('a single drum hit schedules a near-future stop and self-terminates', () => {
  const { ctx, kit } = freshKit();
  kit._triggerSound('kick', ctx.currentTime);
  assert.ok(ctx.liveSourceCount('Oscillator') >= 1, 'kick oscillator live right after trigger');

  ctx.advance(2.0);
  assert.equal(ctx.liveSourceCount('Oscillator'), 0, 'drum voice stops itself — no held node');
});

// This is the structural contrast with the WebAudioSynth sample path: drums bound
// their concurrently-live node count because EVERY hit schedules its own stop() at
// trigger time. Spamming a drum pad is safe; spamming a sample pad is not (see
// voiceLifecycle.test.js CRASH REPRO).
test('spamming a drum pad keeps the live oscillator count bounded as voices expire', () => {
  const { ctx, kit } = freshKit();

  for (let i = 0; i < 100; i++) {
    kit._triggerSound('kick', ctx.currentTime);
    ctx.advance(0.05); // 50ms apart — longer than a kick body, so they expire as we go
  }

  assert.ok(
    ctx.liveSourceCount('Oscillator') <= 8,
    `drum hits expire on schedule, live oscillators stay low, got ${ctx.liveSourceCount('Oscillator')}`
  );

  ctx.advance(2.0);
  assert.equal(ctx.liveSourceCount('Oscillator'), 0, 'every drum voice eventually stopped');
});

test('different drum sounds in a kit each trigger without error', () => {
  const { ctx, kit } = freshKit();
  for (const sound of ['kick', 'snare', 'hihat']) {
    assert.doesNotThrow(() => kit._triggerSound(sound, ctx.currentTime));
  }
  assert.ok(ctx.totalCreated() > 0, 'nodes were created for the drum voices');
});
