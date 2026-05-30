import assert from 'node:assert/strict';

import { validateBackup, workspaceBackup } from '../src/export/BackupExporter.js';
import { readAiSettings, writeAiSettings } from '../src/ai/aiSettings.js';
import { buildAIInstrumentInfo, mapCreativeInstrumentToAi } from '../src/ai/AIInstrumentContext.js';
import {
  cloneControllerBindings,
  controllerTargetLabel,
  normalizeControllerTarget,
} from '../src/ui/ControllerMapperPopover.js';
import {
  clampCustomPadCount,
  clampPianoKeyCount,
  normalizePianoCount,
} from '../src/ui/CreateLayoutPopover.js';
import {
  customInstrumentTypeLabel,
  rootNoteOptions,
} from '../src/ui/CreateInstrumentPopover.js';
import { padPerformanceIndex, pianoPerformanceIndex } from '../src/modes/input/PerformanceInputRouter.js';
import {
  normalizeMeter,
  pulseCountForMeter,
  quarterBpmForMeter,
  secondsPerTickForMeter,
  ticksPerBarForMeter,
} from '../src/engine/Meter.js';
import { StageEventStream } from '../src/stage/StageEventStream.js';
import {
  STAGE_TRACK_LIMIT,
  stageEventsForCanvasTracks,
  stageIntensityForUnits,
  stageTracksForCanvas,
} from '../src/stage/StageModel.js';
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

test('layout popover helpers clamp controls to supported ranges', () => {
  assert.equal(clampCustomPadCount(0), 1);
  assert.equal(clampCustomPadCount(99), 16);
  assert.equal(clampCustomPadCount('bad'), 7);
  assert.equal(clampPianoKeyCount(4), 10);
  assert.equal(clampPianoKeyCount(99), 32);
  assert.equal(clampPianoKeyCount('bad'), 12);
  assert.equal(normalizePianoCount(2), 2);
  assert.equal(normalizePianoCount(3), 1);
});

test('custom instrument popover helpers render stable labels and root options', () => {
  assert.equal(customInstrumentTypeLabel({ type: 'kit' }), 'Kit');
  assert.equal(customInstrumentTypeLabel({ type: 'patch' }), 'Patch');
  const options = rootNoteOptions(60);
  assert.ok(options.includes('value="60" selected>C4</option>'));
  assert.ok(options.includes('value="95" >B6</option>'));
  assert.equal((options.match(/<option/g) || []).length, 72);
});

test('stage event stream mirrors live notes without depending on recording', () => {
  const stream = new StageEventStream();
  const seen = [];
  const unsubscribe = stream.subscribe(event => seen.push(event));

  const id = stream.beginNote({
    source: 'pads',
    pitch: 60,
    lane: 0,
    startTick: 120,
    color: '#ff0000',
    accentColor: '#00ff00',
    label: 'C4',
  });
  assert.equal(stream.activeEvents().length, 1);
  assert.equal(stream.activeEvents()[0].endTick, null);

  const completed = stream.endNote(id, { endTick: 600 });
  assert.equal(completed.durationTick, 480);
  assert.equal(stream.activeEvents().length, 0);
  assert.equal(seen.map(event => event.kind).join(','), 'start,end');

  unsubscribe();
  stream.hit({ source: 'kit', drum: 'kick', lane: 0, startTick: 720, color: '#ffffff' });
  assert.equal(seen.length, 2);
});

test('stage model caps canvas tracks and scales intensity by musical units', () => {
  const tracks = Array.from({ length: STAGE_TRACK_LIMIT + 5 }, (_, index) => ({
    id: `track-${index}`,
    name: `Track ${index}`,
    color: index === 0 ? '#ff0000' : undefined,
    muted: index === 1,
    solo: index === 3,
  }));
  const lanes = stageTracksForCanvas(tracks);
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].id, 'track-3');

  const capped = stageTracksForCanvas(tracks.map(track => ({ ...track, solo: false })));
  assert.equal(capped.length, STAGE_TRACK_LIMIT);
  assert.equal(capped.some(track => track.id === 'track-1'), false);

  assert.deepEqual(stageIntensityForUnits(0.2).tier, 'spark');
  assert.deepEqual(stageIntensityForUnits(1).tier, 'solid');
  assert.deepEqual(stageIntensityForUnits(2.5).tier, 'bright');
  assert.deepEqual(stageIntensityForUnits(4).tier, 'sustain');
});

test('stage model maps canvas clips into absolute lane events', () => {
  const tracks = [
    {
      id: 'midi-track',
      name: 'Keys',
      color: '#44ccff',
      type: 'midi',
      clips: [
        {
          startBar: 2,
          durationBars: 1,
          snippet: {
            notes: [{ pitch: 60, startTick: 120, durationTick: 360 }],
            hits: [],
          },
        },
      ],
    },
    {
      id: 'audio-track',
      name: 'Line',
      color: '#ff8844',
      type: 'audio',
      clips: [
        {
          startBar: 0.5,
          durationBars: 1.5,
          snippet: { type: 'audio', notes: [], hits: [] },
        },
      ],
    },
  ];

  const events = stageEventsForCanvasTracks(tracks, { ticksPerBar: 1920, unitTicks: 480 });
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map(event => ({
      type: event.type,
      source: event.source,
      lane: event.lane,
      subLane: event.subLane,
      subLaneCount: event.subLaneCount,
      startTick: event.startTick,
      endTick: event.endTick,
      color: event.color,
      label: event.label,
      tier: event.intensity.tier,
    })),
    [
      {
        type: 'clip',
        source: 'audio-track',
        lane: 1,
        subLane: 0,
        subLaneCount: 1,
        startTick: 960,
        endTick: 3840,
        color: '#ff8844',
        label: 'Audio',
        tier: 'sustain',
      },
      {
        type: 'note',
        source: 'midi-track',
        lane: 0,
        subLane: 0,
        subLaneCount: 1,
        startTick: 3960,
        endTick: 4320,
        color: '#44ccff',
        label: 'C4',
        tier: 'spark',
      },
    ]
  );
});

test('stage model gives same canvas track events internal sublanes', () => {
  const tracks = [
    {
      id: 'harmony',
      color: '#aabbcc',
      type: 'midi',
      clips: [
        {
          startBar: 0,
          snippet: {
            notes: [
              { pitch: 67, startTick: 0, durationTick: 480 },
              { pitch: 60, startTick: 0, durationTick: 960 },
              { pitch: 67, startTick: 960, durationTick: 480 },
            ],
            hits: [],
          },
        },
      ],
    },
  ];

  const events = stageEventsForCanvasTracks(tracks, { ticksPerBar: 1920, unitTicks: 480 });
  assert.deepEqual(
    events.map(event => [event.label, event.subLane, event.subLaneCount]),
    [
      ['C4', 0, 2],
      ['G4', 1, 2],
      ['G4', 1, 2],
    ]
  );
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
