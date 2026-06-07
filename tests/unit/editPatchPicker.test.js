import test from 'node:test';
import assert from 'node:assert/strict';

import { EditMode } from '../../src/modes/EditMode.js';
import { EditRollMixin } from '../../src/modes/editRoll.js';

/**
 * Bind the pure helper so the test can call it without spinning up a
 * full EditMode. `_setSnippetInstrument` only mutates the snippet it is
 * handed and reads from a passed-in shape, so it has no other deps.
 */
const setInstrument = EditMode.prototype._setSnippetInstrument;

function makeMidiSnippet(overrides = {}) {
  return {
    id: 's1',
    type: 'midi',
    name: 'Test MIDI',
    notes: [],
    hits: [],
    schemaVersion: 1,
    ...overrides,
  };
}

function makeDrumSnippet(overrides = {}) {
  return {
    id: 's2',
    type: 'drum',
    name: 'Test Drum',
    notes: [],
    hits: [],
    schemaVersion: 1,
    ...overrides,
  };
}

test('MIDI: writes instrumentId and patchRecorded with deep-cloned preset', () => {
  const snippet = makeMidiSnippet();
  const ok = setInstrument.call({}, snippet, 'heartbound');
  assert.equal(ok, true);
  assert.equal(snippet.instrumentId, 'heartbound');
  assert.equal(snippet.patchRecorded.instrumentId, 'heartbound');
  // The snapshot is a deep clone, not a reference to PRESETS, so a
  // future tweak to the live preset does not silently rewrite the
  // recorded sound.
  assert.ok(snippet.patchRecorded.patchSnapshot, 'snapshot is captured');
  assert.equal(typeof snippet.patchRecorded.patchSnapshot, 'object');
  assert.notEqual(snippet.patchRecorded.patchSnapshot.name, undefined,
    'snapshot has the preset metadata');
  assert.ok(snippet.patchRecorded.capturedAt > 0, 'capturedAt is a timestamp');

  // A second call on a fresh snippet captures a fresh object (not the
  // same reference), so two snippets don't share snapshot state.
  const snippet2 = makeMidiSnippet();
  setInstrument.call({}, snippet2, 'heartbound');
  assert.notEqual(
    snippet.patchRecorded.patchSnapshot,
    snippet2.patchRecorded.patchSnapshot,
    'each snippet captures its own deep clone'
  );
});

test('MIDI: bumps schemaVersion to at least 2', () => {
  const snippet = makeMidiSnippet({ schemaVersion: 1 });
  setInstrument.call({}, snippet, 'modern_keys');
  assert.equal(snippet.schemaVersion, 2);
  // Bumping a higher version is a no-op (we never lower).
  const snippetHigh = makeMidiSnippet({ schemaVersion: 5 });
  setInstrument.call({}, snippetHigh, 'modern_keys');
  assert.equal(snippetHigh.schemaVersion, 5);
});

test('MIDI: writing the same value is a no-op (returns false)', () => {
  const snippet = makeMidiSnippet();
  setInstrument.call({}, snippet, 'heartbound');
  const before = JSON.stringify(snippet);
  const ok = setInstrument.call({}, snippet, 'heartbound');
  const after = JSON.stringify(snippet);
  assert.equal(ok, false, 'returns false when value is unchanged');
  assert.equal(before, after, 'snippet state is byte-identical');
});

test('MIDI: missing preset falls back to null snapshot without throwing', () => {
  // Unknown instrument id — the WAV-export pipeline reads the preset
  // by id and falls back to chip_lead there, so a null snapshot here
  // is acceptable (the export path already handles it).
  const snippet = makeMidiSnippet();
  const ok = setInstrument.call({}, snippet, 'not-a-real-preset');
  assert.equal(ok, true);
  assert.equal(snippet.instrumentId, 'not-a-real-preset');
  assert.equal(snippet.patchRecorded.instrumentId, 'not-a-real-preset');
  assert.equal(snippet.patchRecorded.patchSnapshot, null);
});

test('Drum: writes instrumentId and kitRecorded (no snapshot)', () => {
  const snippet = makeDrumSnippet();
  const ok = setInstrument.call({}, snippet, 'classic');
  assert.equal(ok, true);
  assert.equal(snippet.instrumentId, 'classic');
  assert.equal(snippet.kitRecorded.instrumentId, 'classic');
  assert.ok(snippet.kitRecorded.capturedAt > 0);
  // Drum snippets do NOT carry a patch snapshot — only MIDI does.
  assert.equal(snippet.patchRecorded, undefined);
});

test('Drum: bumps schemaVersion to at least 2', () => {
  const snippet = makeDrumSnippet({ schemaVersion: 1 });
  setInstrument.call({}, snippet, 'classic');
  assert.equal(snippet.schemaVersion, 2);
});

test('returns false (no-op) for a missing snippet or instrumentId', () => {
  const snippet = makeMidiSnippet();
  assert.equal(setInstrument.call({}, null, 'modern_keys'), false);
  assert.equal(setInstrument.call({}, snippet, ''), false);
  assert.equal(setInstrument.call({}, snippet, null), false);
});

test('MIDI: existing patchRecorded is replaced (not merged) on a new pick', () => {
  const snippet = makeMidiSnippet();
  setInstrument.call({}, snippet, 'heartbound');
  const firstCapturedAt = snippet.patchRecorded.capturedAt;
  // Wait at least 1ms so the timestamp is different.
  const ok = setInstrument.call({}, snippet, 'modern_keys');
  assert.equal(ok, true);
  assert.equal(snippet.patchRecorded.instrumentId, 'modern_keys');
  assert.ok(snippet.patchRecorded.capturedAt >= firstCapturedAt);
});

/**
 * The EditMode constructor expects transport / undoManager / store /
 * project. We don't call any of them in these pure-helper tests, but
 * the import is here so the test file fails fast if the path moves.
 */
test('EditMode still imports the helpers used by _openPatchPicker', () => {
  assert.equal(typeof EditMode.prototype._setSnippetInstrument, 'function');
  assert.equal(typeof EditRollMixin._renderPatchGroup, 'function');
});
