import test from 'node:test';
import assert from 'node:assert/strict';

import { TICK_WIDTH } from '../../src/modes/editConstants.js';
import { EditRollMixin } from '../../src/modes/editRoll.js';

/**
 * Bind the mixin's pure helper so the test can call it without spinning
 * up a full EditMode instance.
 */
const leftFor = EditRollMixin._playheadLeftForTick.bind({});

test('playhead left = tick * TICK_WIDTH when tick is within the clip', () => {
  assert.equal(leftFor(0, 1920), 0);
  assert.equal(leftFor(480, 1920), 480 * TICK_WIDTH);
  assert.equal(leftFor(1920, 1920), 0, 'exact wrap returns to 0');
});

test('playhead left wraps the clip over durationTicks (loops with inspect playback)', () => {
  // 1920 ticks at TICK_WIDTH=0.15 = 288px. Going past 1920 wraps.
  assert.equal(leftFor(1921, 1920), 1 * TICK_WIDTH);
  assert.equal(leftFor(2400, 1920), 480 * TICK_WIDTH);
  assert.equal(leftFor(3839, 1920), 1919 * TICK_WIDTH);
});

test('playhead left is monotonic within one loop', () => {
  let last = -1;
  for (let tick = 0; tick < 1920; tick += 1) {
    const x = leftFor(tick, 1920);
    assert.ok(x >= last, `tick=${tick} went backwards (x=${x}, last=${last})`);
    last = x;
  }
});

test('playhead left handles a zero-duration clip without NaN', () => {
  // Defensive fallback: with no duration, the playhead just tracks
  // `tick * TICK_WIDTH` so the user still sees motion rather than
  // `NaN`. Production code reaches this branch only when an empty
  // clip somehow reaches the editor; we want it to look
  // broken-pretty, not crash-pretty.
  assert.equal(Number.isFinite(leftFor(0, 0)), true);
  assert.equal(Number.isFinite(leftFor(100, 0)), true);
  assert.equal(leftFor(0, 0), 0);
});

test('playhead left rejects negative or non-finite ticks', () => {
  assert.equal(leftFor(-5, 1920), 0);
  assert.equal(leftFor(Number.NaN, 1920), 0);
  assert.equal(leftFor(Number.POSITIVE_INFINITY, 1920), 0);
});
