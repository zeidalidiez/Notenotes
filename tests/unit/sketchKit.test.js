import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/engine/AudioEngine.js';
import { drumVelocityGain, SketchKit } from '../../src/instruments/SketchKit.js';

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

test('drum velocity keeps the legacy 0.8 level neutral and scales accents', () => {
  assert.equal(drumVelocityGain(0.8), 1);
  assert.equal(drumVelocityGain(0.2), 0.25);
  assert.ok(drumVelocityGain(0.99) > 1, 'top-zone accents are louder than the legacy hit');
});

test('MIDI drum input forwards note velocity to the visible pad', () => {
  const kit = new SketchKit();
  kit.visiblePadIds = () => ['kick'];
  let triggered = null;
  kit.triggerPad = (soundId, velocity) => { triggered = { soundId, velocity }; };

  kit.triggerMidiInput(36, 0.35);

  assert.deepEqual(triggered, { soundId: 'kick', velocity: 0.35 });
});

test('unfinished custom kits stay out of the playable kit surface', () => {
  const kit = new SketchKit({
    settings: {
      customInstruments: [{ id: 'saved-kit', name: 'Saved Kit', type: 'kit' }],
    },
  });

  kit.loadKit('custom:saved-kit');

  assert.equal(kit.selectedKitId, 'classic');
  assert.doesNotMatch(kit._renderKitOptions(), /Saved Kit|custom:saved-kit/);
});

test('setting identical Tone traits keeps the drum effect graph intact', () => {
  const { ctx, kit } = freshKit();
  assert.equal(kit.setSoundTraits({ space: { amount: 0.45 }, drive: { amount: 0.2 } }), true);
  const created = ctx.totalCreated();
  const disconnects = ctx.disconnectCount();

  assert.equal(kit.setSoundTraits({ space: { amount: 0.45 }, drive: { amount: 0.2 } }), false);
  assert.equal(ctx.totalCreated(), created);
  assert.equal(ctx.disconnectCount(), disconnects);
});

test('zero-velocity hits stay silent and panic stops every scheduled drum source', () => {
  const { ctx, kit } = freshKit();
  const createdBefore = ctx.totalCreated();
  kit._triggerSound('kick', ctx.currentTime, 0);
  assert.equal(ctx.totalCreated(), createdBefore, 'zero velocity allocates no audio graph');

  kit._triggerSound('cymbal', ctx.currentTime, 0.8);
  assert.ok(kit._liveSources.size > 0);
  kit.panic();
  assert.equal(kit._liveSources.size, 0);
  ctx.advance(0.01);
  assert.equal(ctx.liveSourceCount(), 0);
});
