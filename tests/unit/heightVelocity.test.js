import test from 'node:test';
import assert from 'node:assert/strict';

import {
  velocityForFraction,
  velocityFromPointer,
  zoneIndexFromTop,
} from '../../src/engine/HeightVelocity.js';

test('height velocity maps the top of a surface to the loudest zone', () => {
  assert.equal(velocityForFraction(0), 0.99);
  assert.equal(velocityForFraction(0.25), 0.99);
  assert.equal(velocityForFraction(0.26), 0.7);
  assert.equal(velocityForFraction(0.51), 0.4);
  assert.equal(velocityForFraction(0.76), 0.2);
  assert.equal(velocityForFraction(1), 0.2);
});

test('height velocity clamps out-of-bounds strikes and reports visual zones', () => {
  assert.equal(velocityForFraction(-1), 0.99);
  assert.equal(velocityForFraction(2), 0.2);
  assert.equal(zoneIndexFromTop(-1), 0);
  assert.equal(zoneIndexFromTop(2), 3);
});

test('pointer velocity uses element geometry and fails safely without it', () => {
  const surface = {
    getBoundingClientRect: () => ({ top: 100, height: 200 }),
  };

  assert.equal(velocityFromPointer({ clientY: 100 }, surface), 0.99);
  assert.equal(velocityFromPointer({ clientY: 300 }, surface), 0.2);
  assert.equal(velocityFromPointer({}, surface), 0.99);
  assert.equal(velocityFromPointer({}, null), null);
  assert.equal(velocityFromPointer({}, { getBoundingClientRect: () => ({ top: 0, height: 0 }) }), null);
});
