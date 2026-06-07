import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/engine/AudioEngine.js';
import { PlaybackEngine } from '../../src/engine/PlaybackEngine.js';
import { makeFakeTransport } from '../fixtures/fakeTransport.js';

/**
 * The Inspect Patch picker (see `EditMode._setSnippetInstrument`) writes
 * a new `instrumentId` to the snippet and fires `onInspectPatchChanged`,
 * which `main.js` wires to `playbackEngine.setInspectSource(snippet)`.
 * The engine must drop its cached inspect synth/kit so the next press
 * of Play auditions under the new patch/kit.
 *
 * These tests exercise that contract at the engine level, without
 * needing the full EditMode + ChoicePicker wiring.
 */

function freshEngine() {
  const engine = AudioEngine.getInstance();
  engine._initialized = false;
  engine.ctx = null;
  engine.initSync();
  return globalThis.__lastAudioContext;
}

function midiSnippet(instrumentId) {
  return {
    id: 's1',
    type: 'midi',
    name: 'Test',
    notes: [],
    hits: [],
    durationTicks: 480,
    instrumentId,
    patchRecorded: { instrumentId, patchSnapshot: null, capturedAt: 0 },
  };
}

function drumSnippet(instrumentId) {
  return {
    id: 's2',
    type: 'drum',
    name: 'Test',
    notes: [],
    hits: [],
    durationTicks: 480,
    instrumentId,
    kitRecorded: { instrumentId, capturedAt: 0 },
  };
}

test('setInspectSource on a MIDI snippet builds the synth with the snippet instrument', () => {
  freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = { tracks: [], settings: {} };
  const pe = new PlaybackEngine(transport, project);

  pe.setInspectSource(midiSnippet('heartbound'));
  const synth = pe._getInspectSynth();
  assert.ok(synth, 'synth is created lazily on first read');
  assert.equal(pe._inspectSynthInstrumentId, 'heartbound');
});

test('changing the MIDI snippet\'s instrument drops the cached synth', () => {
  freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = { tracks: [], settings: {} };
  const pe = new PlaybackEngine(transport, project);

  pe.setInspectSource(midiSnippet('heartbound'));
  const first = pe._getInspectSynth();
  assert.equal(pe._inspectSynthInstrumentId, 'heartbound');

  // User picks a different patch in the Inspect toolbar.
  pe.setInspectSource(midiSnippet('modern_keys'));
  // The engine should have dropped the cached synth so the next read
  // builds a fresh one with the new preset.
  assert.equal(pe._inspectSynth, null, 'cached synth is dropped on instrument change');
  const second = pe._getInspectSynth();
  assert.notEqual(second, first, 'second read produces a new instance');
  assert.equal(pe._inspectSynthInstrumentId, 'modern_keys');
});

test('setInspectSource with the same snippet instance is a no-op (no rebuild)', () => {
  freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = { tracks: [], settings: {} };
  const pe = new PlaybackEngine(transport, project);

  const snippet = midiSnippet('heartbound');
  pe.setInspectSource(snippet);
  const first = pe._getInspectSynth();
  // Same snippet reference → setInspectSource returns early.
  pe.setInspectSource(snippet);
  assert.equal(pe._getInspectSynth(), first, 'synth instance is preserved');
});

test('setInspectSource(null) drops both cached synth and kit', () => {
  freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = { tracks: [], settings: {} };
  const pe = new PlaybackEngine(transport, project);

  pe.setInspectSource(midiSnippet('heartbound'));
  pe._getInspectSynth();
  assert.equal(pe._inspectSynthInstrumentId, 'heartbound');

  pe.setInspectSource(null);
  assert.equal(pe._inspectSynth, null);
  assert.equal(pe._inspectKit, null);
  assert.equal(pe._inspectSynthInstrumentId, null);
  assert.equal(pe._inspectKitInstrumentId, null);
});

test('changing a drum snippet\'s kit drops the cached kit', () => {
  freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = { tracks: [], settings: {} };
  const pe = new PlaybackEngine(transport, project);

  pe.setInspectSource(drumSnippet('classic'));
  pe._getInspectKit();
  assert.equal(pe._inspectKitInstrumentId, 'classic');

  pe.setInspectSource(drumSnippet('808'));
  assert.equal(pe._inspectKit, null, 'cached kit is dropped on instrument change');
  pe._getInspectKit();
  assert.equal(pe._inspectKitInstrumentId, '808');
});

test('MIDI and drum instruments are tracked independently', () => {
  // A snippet can be MIDI in one moment and a different drum snippet in
  // the next. The synth and kit caches are tracked separately so changing
  // one does not affect the other.
  freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = { tracks: [], settings: {} };
  const pe = new PlaybackEngine(transport, project);

  pe.setInspectSource(midiSnippet('heartbound'));
  pe._getInspectSynth();
  assert.equal(pe._inspectSynthInstrumentId, 'heartbound');

  pe.setInspectSource(drumSnippet('classic'));
  // The MIDI synth is still cached — we did not touch it.
  assert.ok(pe._inspectSynth, 'MIDI synth is untouched by drum snippet swap');
  assert.equal(pe._inspectSynthInstrumentId, 'heartbound');
  // The drum kit is now built lazily on first read.
  assert.equal(pe._inspectKit, null);
  pe._getInspectKit();
  assert.equal(pe._inspectKitInstrumentId, 'classic');
});

test('in-place mutation of a snippet\'s instrument re-arms the cached synth', () => {
  // The Inspect patch picker mutates `snippet.instrumentId` in place
  // via `EditMode._setSnippetInstrument` and then calls
  // `setInspectSource(snippet)` with the SAME object reference. The
  // engine must detect the instrument change and drop the cached synth
  // so the next press of Play auditions under the new patch.
  freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = { tracks: [], settings: {} };
  const pe = new PlaybackEngine(transport, project);

  const snippet = midiSnippet('heartbound');
  pe.setInspectSource(snippet);
  const first = pe._getInspectSynth();
  assert.equal(pe._inspectSynthInstrumentId, 'heartbound');

  // The picker mutates in place and re-fires with the same reference.
  snippet.instrumentId = 'modern_keys';
  snippet.patchRecorded = {
    instrumentId: 'modern_keys',
    patchSnapshot: null,
    capturedAt: Date.now(),
  };
  pe.setInspectSource(snippet);

  // Even though the reference is unchanged, the resolved instrument
  // moved, so the synth must be dropped and rebuilt.
  assert.equal(pe._inspectSynth, null, 'cached synth is dropped on in-place instrument change');
  const second = pe._getInspectSynth();
  assert.notEqual(second, first, 'second read produces a new instance');
  assert.equal(pe._inspectSynthInstrumentId, 'modern_keys');
});

test('in-place mutation with the same instrument id is a no-op (no rebuild)', () => {
  // Setting `instrumentId` to its current value (e.g. the picker re-
  // selecting the active option) must not churn the cached synth.
  freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = { tracks: [], settings: {} };
  const pe = new PlaybackEngine(transport, project);

  const snippet = midiSnippet('heartbound');
  pe.setInspectSource(snippet);
  const first = pe._getInspectSynth();
  assert.equal(pe._inspectSynthInstrumentId, 'heartbound');

  // Re-select the same id. Resolved instrument is unchanged, so the
  // synth must be preserved.
  pe.setInspectSource(snippet);
  assert.equal(pe._inspectSynth, first, 'synth instance is preserved');
  assert.equal(pe._inspectSynthInstrumentId, 'heartbound');
});
