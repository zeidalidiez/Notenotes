import assert from 'node:assert/strict';

import { validateBackup, workspaceBackup } from '../src/export/BackupExporter.js';
import { readAiSettings, writeAiSettings } from '../src/ai/aiSettings.js';
import { buildAIInstrumentInfo, mapCreativeInstrumentToAi } from '../src/ai/AIInstrumentContext.js';
import {
  cloneControllerBindings,
  controllerTargetLabel,
  normalizeControllerTarget,
} from '../src/ui/ControllerMapperPopover.js';
import { padPerformanceIndex, pianoPerformanceIndex } from '../src/modes/input/PerformanceInputRouter.js';
import {
  normalizeMeter,
  pulseCountForMeter,
  quarterBpmForMeter,
  secondsPerTickForMeter,
  ticksPerBarForMeter,
} from '../src/engine/Meter.js';
import { auditProjectAudioAssets } from '../src/data/ProjectStore.js';

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

test('compound and asymmetric meter math keeps bar durations pulse-based', () => {
  const cases = [
    ['4/4', 120, 1920, 2],
    ['6/8', 120, 1440, 1],
    ['7/8', 120, 1680, 1.5],
  ];

  for (const [id, bpm, expectedTicks, expectedSeconds] of cases) {
    const meter = normalizeMeter(id);
    assert.equal(ticksPerBarForMeter(meter), expectedTicks);
    const seconds = ticksPerBarForMeter(meter) * secondsPerTickForMeter(meter, bpm);
    assert.ok(Math.abs(seconds - expectedSeconds) < 0.000001, `${id} bar duration`);
  }

  assert.equal(pulseCountForMeter('7/8'), 3);
  assert.equal(Math.round(quarterBpmForMeter('7/8', 120)), 140);
});

test('backup validation accepts current workspace backups and rejects newer app versions', () => {
  const project = { id: 'project-1', name: 'Smoke', snippets: [], tracks: [], settings: {} };
  const backup = workspaceBackup(project);
  assert.equal(validateBackup(backup), 'workspace');

  assert.throws(
    () => validateBackup({ ...backup, appVersion: '99.0.0' }),
    /newer app version/
  );
});

test('AI non-secret settings persist on the project object', () => {
  const project = { settings: {} };
  writeAiSettings(project, { defaultLengthBars: 8, provider: 'mock' });
  assert.equal(readAiSettings(project).defaultLengthBars, 8);
  assert.equal(project.settings.aiSettings.defaultLengthBars, 8);
});

test('AI instrument context maps Create surfaces without exposing unsupported audio', () => {
  assert.equal(mapCreativeInstrumentToAi('scaleboard'), 'scaleboard');
  assert.equal(mapCreativeInstrumentToAi('controller'), 'scaleboard');
  assert.equal(mapCreativeInstrumentToAi('piano'), 'piano');
  assert.equal(mapCreativeInstrumentToAi('kit'), 'kit');
  assert.equal(mapCreativeInstrumentToAi('mic'), 'scaleboard');

  const info = buildAIInstrumentInfo('scaleboard', {
    scaleBoard: { scaleName: 'minor', rootNote: 'D', octave: 3, _notes: [1, 2, 3, 4, 5] },
  });
  assert.deepEqual(info, {
    instrument: 'scaleboard',
    scaleName: 'minor',
    rootNote: 'D',
    octave: 3,
    padCount: 5,
  });
});

test('performance keyboard maps Pads forward and Piano high-to-low', () => {
  assert.equal(padPerformanceIndex('Digit1', 13), 0);
  assert.equal(padPerformanceIndex('Equal', 13), 11);
  assert.equal(padPerformanceIndex('KeyQ', 13), 12);
  assert.equal(pianoPerformanceIndex('Digit1', 22), 21);
  assert.equal(pianoPerformanceIndex('KeyQ', 22), 9);
});

test('controller mapper helpers normalize targets without sharing preset references', () => {
  const scale = normalizeControllerTarget({
    type: 'scalePad',
    padIndex: 8,
    padAction: 'chord',
    midi: 64,
  });
  assert.equal(scale.label, 'Chord 9');
  assert.equal(controllerTargetLabel(scale), 'Chord 9');
  assert.equal(controllerTargetLabel({ type: 'midi', midi: 61 }), 'C#4');

  const original = { 0: { type: 'midi', midi: 60, nested: { ok: true } } };
  const cloned = cloneControllerBindings(original);
  cloned[0].nested.ok = false;
  assert.equal(original[0].nested.ok, true);
});

test('audio audit reports missing, orphaned, and backup readiness without mutating project', () => {
  const project = {
    snippets: [
      { id: 'audio-1', type: 'audio', audioAssetId: 'asset-present' },
      { id: 'audio-2', type: 'audio', audioAssetId: 'asset-missing' },
      { id: 'audio-3', type: 'audio', audioUnavailable: true },
    ],
    tracks: [
      { clips: [{ snippet: { id: 'clip-audio', type: 'audio', audioAssetId: 'asset-present' } }] },
    ],
    settings: {
      customInstruments: [{ id: 'sampler-1', audioAssetId: 'instrument-present' }],
    },
  };
  const original = JSON.stringify(project);
  const audit = auditProjectAudioAssets(project, [
    { audioAssetId: 'asset-present', size: 100 },
    { audioAssetId: 'instrument-present', arrayBuffer: new ArrayBuffer(50) },
    { audioAssetId: 'asset-orphan', size: 200 },
  ]);

  assert.equal(JSON.stringify(project), original);
  assert.equal(audit.audioSnippetCount, 4);
  assert.equal(audit.customInstrumentSampleCount, 1);
  assert.equal(audit.referencedAssetCount, 3);
  assert.equal(audit.storedAssetCount, 3);
  assert.equal(audit.missingAssetCount, 2);
  assert.equal(audit.orphanedAssetCount, 1);
  assert.equal(audit.bytesReferenced, 150);
  assert.equal(audit.bytesOrphaned, 200);
  assert.equal(audit.backupReady, false);
});
