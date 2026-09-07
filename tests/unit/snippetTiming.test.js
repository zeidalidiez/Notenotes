import test from 'node:test';
import assert from 'node:assert/strict';
import { snippetContentEndTick } from '../../src/engine/SnippetTiming.js';

test('large imported event collections do not overflow function argument limits', () => {
  const snippet = {
    notes: Array(100_000).fill({ startTick: 0, durationTick: 480 }),
    hits: Array(100_000).fill({ startTick: 480 }),
  };
  assert.equal(snippetContentEndTick(snippet, 120), 600);
});
