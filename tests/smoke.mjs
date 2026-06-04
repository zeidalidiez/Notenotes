import assert from 'node:assert/strict';

import { validateBackup, workspaceBackup } from '../src/export/BackupExporter.js';
import { readAiSettings, writeAiSettings } from '../src/ai/aiSettings.js';
import { buildAIInstrumentInfo, mapCreativeInstrumentToAi } from '../src/ai/AIInstrumentContext.js';
import {
  cloneControllerBindings,
  controllerTargetLabel,
  normalizeControllerTarget,
} from '../src/ui/ControllerMapperPopover.js';
import { BINDABLE_GAMEPAD_BUTTONS } from '../src/engine/GamepadInputManager.js';
import { controllerModifierPickerGroups, normalizeControllerModifier } from '../src/engine/ControllerModifiers.js';
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
import { correctMidiToScale, normalizeDegreeHighlighting, normalizeMusicalContext } from '../src/engine/MusicTheory.js';
import {
  DEGREE_PALETTES,
  degreeColorsForPalette,
  degreePaletteOptions,
  normalizeDegreePaletteId,
  relativeLuminance,
  contrastRatio,
} from '../src/engine/DegreePalettes.js';
import { PRESETS } from '../src/instruments/WebAudioSynth.js';
import {
  DEFAULT_PAD_LAYOUT_TEMPLATE,
  recommendedPadColumns,
  normalizePadLayout,
  normalizePadMode,
  padLayoutForCount,
} from '../src/engine/PadLayout.js';
import {
  normalizeMeter,
  pulseCountForMeter,
  quarterBpmForMeter,
  secondsPerTickForMeter,
  ticksPerBarForMeter,
} from '../src/engine/Meter.js';
import {
  velocityAdjustedDrive,
  velocityAdjustedFilterFrequency,
} from '../src/engine/VelocityResponse.js';
import {
  adsrEnvelopeValueAt,
  envelopeSegmentProgress,
  createEnvelopeParamCurve,
} from '../src/engine/EnvelopeCurves.js';
import {
  applyMasterGlue,
  masterGlueSample,
  MASTER_GLUE_DEFAULTS,
} from '../src/engine/MasterGlue.js';
import {
  audioInputConstraints,
  normalizeAudioInputChannelMode,
} from '../src/engine/AudioInputChannelMode.js';
import { normalizeWavChannelMode } from '../src/export/WavChannelMode.js';
import {
  normalizeTrackPan,
  panForVoice,
  stereoGainsForPan,
} from '../src/engine/StereoWidth.js';
import {
  activeProgressionResolution,
  normalizeProgressionContext,
  normalizeProgressionGlow,
  progressionChoiceGroups,
  progressionFitsContext,
  progressionLabel,
  progressionPreset,
  resolveProgressionStep,
} from '../src/engine/Progressions.js';
import {
  droneNotesForContext,
  normalizeDroneSettings,
  DEFAULT_DRONE_OCTAVE,
} from '../src/engine/Drone.js';
import { StageEventStream } from '../src/stage/StageEventStream.js';
import {
  STAGE_CANVAS_TRACK_LIMIT,
  STAGE_LIVE_LANE_LIMIT,
  STAGE_TRACK_LIMIT,
  stageEventsForCanvasTracks,
  stageIntensityForUnits,
  stageTracksForCanvas,
} from '../src/stage/StageModel.js';
import {
  DEFAULT_STAGE_VIEW_ID,
  resolveStageView,
  stageViewNeighbor,
  stageViewOptionsForMode,
} from '../src/stage/StageViews.js';
import {
  stageBlur,
  stageRenderQuality,
  stageTrailMs,
} from '../src/stage/StageRenderQuality.js';
import {
  pocketActiveSpan,
  pocketEventPhase,
  pocketLaneAngle,
} from '../src/stage/StagePocketModel.js';
import {
  clipTimeScaleBadgeItem,
  clipVisualDurationBars,
  normalizeClipTimeScale,
  pushClipsRightForTimeScale,
} from '../src/engine/ClipTimeScale.js';
import {
  fitRhythmEvents,
  RHYTHM_FIT_MODES,
  RHYTHM_FIT_TARGETS,
} from '../src/engine/RhythmFit.js';
import { inspectDisplayDurationTicks } from '../src/engine/SnippetTiming.js';
import {
  normalizeVolume,
  projectMasterVolume,
  projectMetronomeVolume,
} from '../src/engine/OutputVolume.js';
import {
  compareAppVersions,
  latestVersionFromSourceText,
} from '../src/utils/AppVersion.js';
import {
  createDrumNoiseState,
  drumTransientEnvelope,
  shapedDrumNoiseSample,
} from '../src/engine/DrumSynthesis.js';
import { auditProjectAudioAssets, createProject } from '../src/data/ProjectStore.js';

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

test('output volume settings preserve zero and clamp invalid values', () => {
  assert.equal(normalizeVolume(-1, 0.8), 0);
  assert.equal(normalizeVolume(2, 0.8), 1);
  assert.equal(normalizeVolume('bad', 0.8), 0.8);
  assert.equal(projectMasterVolume({ settings: { masterVolume: 0 } }), 0);
  assert.equal(projectMasterVolume({ settings: { masterVolume: 0.25 } }), 0.25);
  assert.equal(projectMetronomeVolume({ settings: { metronomeVolume: 0 } }), 0);
  assert.equal(projectMetronomeVolume({ settings: { metronomeVolume: 1.5 } }), 1);
});

test('app version helpers compare numeric semver parts and parse source version text', () => {
  assert.ok(compareAppVersions('0.1.105', '0.1.99') > 0);
  assert.ok(compareAppVersions('0.2.0', '0.1.105') > 0);
  assert.ok(compareAppVersions('0.10.0', '0.2.9') > 0);
  assert.equal(compareAppVersions('0.1.105', '0.1.105'), 0);
  assert.equal(latestVersionFromSourceText("export const APP_VERSION = '0.1.105';"), '0.1.105');
});

test('drum noise shaping reduces raw white noise hash and keeps bounded output', () => {
  const state = createDrumNoiseState();
  const first = shapedDrumNoiseSample('snare', 1, state, 0);
  const second = shapedDrumNoiseSample('snare', -1, state, 0.002);
  assert.ok(first <= 1 && first >= -1);
  assert.ok(second <= 1 && second >= -1);
  assert.notEqual(first, 1);
  assert.ok(drumTransientEnvelope('hihat', 0, 0.06) > drumTransientEnvelope('hihat', 0.05, 0.06));
  assert.ok(drumTransientEnvelope('cymbal', 0.1, 0.4) > drumTransientEnvelope('hihat', 0.1, 0.06));
});

test('stage render quality reduces glow and trails under load and reduced motion', () => {
  const calm = stageRenderQuality({ eventCount: 8, laneCount: 8, reducedMotion: false });
  const dense = stageRenderQuality({ eventCount: 190, laneCount: 20, reducedMotion: false });
  const reduced = stageRenderQuality({ eventCount: 8, laneCount: 8, reducedMotion: true });

  assert.equal(calm.detail, 'full');
  assert.equal(dense.detail, 'minimal');
  assert.equal(reduced.detail, 'minimal');
  assert.ok(stageBlur(30, dense) < stageBlur(30, calm));
  assert.ok(stageBlur(30, reduced) < stageBlur(30, calm));
  assert.ok(stageTrailMs(6800, dense) < stageTrailMs(6800, calm));
  assert.ok(stageTrailMs(6800, reduced) < stageTrailMs(6800, calm));
  assert.equal(stageBlur(999, calm), 34);
});

test('inspect display duration follows snippet length instead of forcing four bars', () => {
  const snippet = {
    durationTicks: 1920,
    notes: [
      { startTick: 0, durationTick: 120 },
      { startTick: 480, durationTick: 120 },
    ],
  };
  assert.equal(inspectDisplayDurationTicks(snippet, { ticksPerBar: 1920, gridTicks: 120 }), 1920);
});

test('inspect display duration grows only when content exceeds the stored length', () => {
  const snippet = {
    durationTicks: 960,
    hits: [
      { startTick: 0 },
      { startTick: 2340 },
    ],
  };
  assert.equal(inspectDisplayDurationTicks(snippet, { ticksPerBar: 1920, gridTicks: 120 }), 2520);
});

test('inspect display duration uses one current-meter bar as the empty floor', () => {
  assert.equal(inspectDisplayDurationTicks({ durationTicks: 0, notes: [] }, { ticksPerBar: 2400, gridTicks: 120 }), 2400);
});

test('progression context normalizes to an inactive, backward-compatible default', () => {
  const project = createProject('Progression smoke');
  assert.equal(project.progression.enabled, false);
  assert.equal(project.progression.id, 'off');

  const normalized = normalizeProgressionContext(null);
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.activeStepIndex, 0);
  assert.deepEqual(normalized.steps, []);

  const axis = normalizeProgressionContext({
    enabled: true,
    name: 'Custom Axis',
    advance: 'strict',
    chordType: 'seventh',
    steps: [
      { degree: 'I', durationBars: 2 },
      { degree: 'bad', durationBars: -1 },
      { degree: 'vi' },
    ],
    activeStepIndex: 99,
  });
  assert.equal(axis.enabled, true);
  assert.equal(axis.name, 'Custom Axis');
  assert.equal(axis.advance, 'strict');
  assert.equal(axis.chordType, 'seventh');
  assert.deepEqual(axis.steps.map(step => [step.degree, step.durationBars]), [['I', 2], ['vi', 1]]);
  assert.equal(axis.activeStepIndex, 1);
});

test('progression resolver stores degrees but resolves against current key and scale', () => {
  const axis = progressionPreset('axis');
  assert.deepEqual(axis.steps.map(step => step.degree), ['I', 'V', 'vi', 'IV']);

  const cMajorI = resolveProgressionStep({ degree: 'I' }, { root: 'C', scale: 'major' });
  assert.deepEqual(cMajorI.midis, [60, 64, 67]);
  assert.deepEqual(cMajorI.pitchClasses, [0, 4, 7]);

  const gMajorI = resolveProgressionStep({ degree: 'I' }, { root: 'G', scale: 'major' });
  assert.deepEqual(gMajorI.midis, [67, 71, 74]);
  assert.deepEqual(gMajorI.pitchClasses, [7, 11, 2]);

  const cMajorVSeventh = resolveProgressionStep({ degree: 'V' }, { root: 'C', scale: 'major' }, { chordType: 'seventh' });
  assert.deepEqual(cMajorVSeventh.midis, [67, 71, 74, 77]);

  const cMinorVII = resolveProgressionStep({ degree: 'bVII' }, { root: 'C', scale: 'minor' });
  assert.deepEqual(cMinorVII.midis, [70, 74, 77]);
});

test('active progression resolution returns the current chord tones only when enabled', () => {
  assert.equal(activeProgressionResolution(null, { root: 'C', scale: 'major' }), null);

  const progression = normalizeProgressionContext({
    enabled: true,
    chordType: 'triad',
    activeStepIndex: 1,
    steps: [
      { degree: 'I' },
      { degree: 'V' },
    ],
  });
  const active = activeProgressionResolution(progression, { root: 'C', scale: 'major' });
  assert.deepEqual(active.midis, [67, 71, 74]);
  assert.deepEqual(active.pitchClasses, [7, 11, 2]);

  const disabled = activeProgressionResolution({ ...progression, enabled: false }, { root: 'C', scale: 'major' });
  assert.equal(disabled, null);
});

test('progression picker helpers expose a compact Off state and preset groups', () => {
  assert.equal(progressionLabel(null), 'Off');
  assert.equal(progressionLabel(progressionPreset('axis')), 'The Axis');
  const groups = progressionChoiceGroups();
  assert.equal(groups[0].id, 'basic');
  assert.equal(groups[0].items[0].value, 'off');
  assert.equal(groups.flatMap(group => group.items).some(item => item.value === 'jazzTurnaround'), true);
});

test('progression picker hides presets that cannot resolve in the current scale', () => {
  assert.equal(progressionFitsContext(progressionPreset('sadHopeful'), { root: 'C', scale: 'major' }), true);
  assert.equal(progressionFitsContext(progressionPreset('sadHopeful'), { root: 'C', scale: 'todi' }), false);
  const todiChoices = progressionChoiceGroups({ root: 'C', scale: 'todi' }).flatMap(group => group.items);
  assert.equal(todiChoices.some(item => item.value === 'off'), true);
  assert.equal(todiChoices.some(item => item.value === 'sadHopeful'), false);
});

test('progression glow settings normalize as an additive visual preference', () => {
  assert.deepEqual(normalizeProgressionGlow(), { enabled: true, intensity: 0.28 });
  assert.deepEqual(normalizeProgressionGlow({ enabled: false, intensity: 2 }), { enabled: false, intensity: 0.85 });
  assert.deepEqual(normalizeProgressionGlow({ intensity: 0.01 }), { enabled: true, intensity: 0.08 });
});

test('drone holds the root of the key and follows key changes', () => {
  // Disabled -> no notes.
  assert.deepEqual(droneNotesForContext({ root: 'C', scale: 'major' }, { enabled: false }), []);

  // Enabled -> the root at the default octave (C3 = 48), low enough to anchor.
  assert.deepEqual(droneNotesForContext({ root: 'C', scale: 'major' }, { enabled: true }), [48]);

  // Follows the project key: G major root drone is G3 = 55.
  assert.deepEqual(droneNotesForContext({ root: 'G', scale: 'major' }, { enabled: true }), [55]);

  // Optional open fifth adds the perfect fifth above.
  assert.deepEqual(droneNotesForContext({ root: 'C', scale: 'minor' }, { enabled: true, addFifth: true }), [48, 55]);

  // Octave choice transposes the anchor (C2 = 36).
  assert.deepEqual(droneNotesForContext({ root: 'C', scale: 'major' }, { enabled: true, octave: 2 }), [36]);
});

test('drone settings normalize octave and flags safely', () => {
  assert.deepEqual(normalizeDroneSettings(), { enabled: false, octave: DEFAULT_DRONE_OCTAVE, addFifth: false });
  assert.equal(normalizeDroneSettings({ octave: 99 }).octave, 6);   // clamp high
  assert.equal(normalizeDroneSettings({ octave: 0 }).octave, 1);    // clamp low
  assert.equal(normalizeDroneSettings({ octave: 'x' }).octave, DEFAULT_DRONE_OCTAVE); // invalid -> default
  assert.equal(normalizeDroneSettings({ enabled: 1, addFifth: 'yes' }).enabled, true);
  assert.equal(normalizeDroneSettings({ addFifth: 'yes' }).addFifth, true);
test('degree palettes expose 12 colors, normalize ids, and hand back copies', () => {
  // Every palette covers all 12 chromatic intervals.
  for (const palette of Object.values(DEGREE_PALETTES)) {
    for (let i = 0; i < 12; i++) {
      assert.match(palette.colors[i], /^#[0-9a-f]{6}$/i, `${palette.id} interval ${i}`);
    }
  }
  // Unknown / bad ids fall back to default.
  assert.equal(normalizeDegreePaletteId('cbSafe'), 'cbSafe');
  assert.equal(normalizeDegreePaletteId('nope'), 'default');
  assert.equal(normalizeDegreePaletteId(null), 'default');

  // degreeColorsForPalette returns a fresh, mutation-safe copy.
  const a = degreeColorsForPalette('cbSafe');
  a[0] = '#000000';
  assert.notEqual(degreeColorsForPalette('cbSafe')[0], '#000000');

  // Picker options cover every palette.
  assert.equal(degreePaletteOptions().length, Object.keys(DEGREE_PALETTES).length);
});

test('viridis palette ramps lightness so degrees stay orderable for any vision', () => {
  const colors = DEGREE_PALETTES.viridis.colors;
  let prev = -1;
  for (let i = 0; i < 12; i++) {
    const lum = relativeLuminance(colors[i]);
    assert.ok(lum > prev, `viridis luminance should increase at interval ${i}`);
    prev = lum;
  }
  // Contrast helper sanity: black vs white is the WCAG max (21:1).
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.1);
});

test('degree highlighting applies the selected palette as its base colors', () => {
  const cb = normalizeDegreeHighlighting({ enabled: true, palette: 'cbSafe' });
  assert.equal(cb.palette, 'cbSafe');
  assert.deepEqual(cb.colors, degreeColorsForPalette('cbSafe'));

  // Explicit per-degree overrides still win over the palette base.
  const tweaked = normalizeDegreeHighlighting({ palette: 'viridis', colors: { 0: '#abcdef' } });
  assert.equal(tweaked.colors[0], '#abcdef');
  assert.equal(tweaked.colors[1], degreeColorsForPalette('viridis')[1]);

  // Missing palette stays backward-compatible with the vivid default.
  assert.equal(normalizeDegreeHighlighting({}).palette, 'default');
});

test('note correction quantizes piano and MIDI notes only when enabled', () => {
  const context = normalizeMusicalContext({ root: 'C', scale: 'major' });
  assert.equal(correctMidiToScale(61, context, 'off'), 61);
  assert.equal(correctMidiToScale(64, context, 'closest'), 64);
  assert.equal(correctMidiToScale(61, context, 'closest'), 62);
  assert.equal(correctMidiToScale(61, context, 'up'), 62);
  assert.equal(correctMidiToScale(61, context, 'down'), 60);
  assert.equal(correctMidiToScale(66, { root: 'C', scale: 'chromatic' }, 'down'), 66);
});

test('modern synth presets keep a richer produced-voice floor', () => {
  const modern = Object.entries(PRESETS).filter(([, patch]) => patch.family === 'modern');
  assert.ok(modern.length >= 8);
  for (const [id, patch] of modern) {
    assert.ok(patch.oscillator2, `${id} has a supporting oscillator`);
    assert.ok((patch.unison?.voices || 0) >= 2, `${id} uses at least light unison`);
    assert.ok(Number.isFinite(patch.keyTrack), `${id} has explicit key tracking`);
    assert.ok((patch.drive || 0) > 0, `${id} has a touch of patch drive`);
    assert.ok((patch.velocityResponse?.filter || 0) > 0, `${id} responds to velocity brightness`);
    assert.ok((patch.stereoWidth || 0) > 0, `${id} has stereo width`);
  }
});

test('velocity response changes timbre without changing legacy patches', () => {
  assert.equal(velocityAdjustedFilterFrequency(2000, 1, null), 2000);
  assert.equal(velocityAdjustedDrive(0.1, 1, null), 0.1);

  const response = { filter: 0.5, drive: 0.08 };
  assert.ok(velocityAdjustedFilterFrequency(2000, 1, response) > 2000);
  assert.ok(velocityAdjustedFilterFrequency(2000, 0.2, response) < 2000);
  assert.ok(velocityAdjustedDrive(0.1, 1, response) > 0.1);
  assert.equal(velocityAdjustedDrive(0.1, 0.2, response), 0.1);
});

test('envelope curves make attacks speak sooner and decay more naturally', () => {
  const env = { attack: 0.2, decay: 0.4, sustain: 0.5, release: 0.3 };
  assert.ok(envelopeSegmentProgress(0.5, 'attack') > 0.5);
  assert.ok(envelopeSegmentProgress(0.5, 'decay') > 0.5);
  assert.ok(adsrEnvelopeValueAt(0.1, 1, env, 1) > 0.5);
  assert.ok(adsrEnvelopeValueAt(0.4, 1, env, 1) < 0.75);
  assert.ok(adsrEnvelopeValueAt(1.15, 1, env, 1) < 0.25);
});

test('envelope param curves include exact endpoints for live scheduling', () => {
  const attack = createEnvelopeParamCurve(0, 0.8, 'attack', 16);
  const decay = createEnvelopeParamCurve(0.8, 0.4, 'decay', 16);
  assert.equal(attack[0], 0);
  assert.ok(Math.abs(attack[attack.length - 1] - 0.8) < 0.000001);
  assert.ok(Math.abs(decay[0] - 0.8) < 0.000001);
  assert.ok(Math.abs(decay[decay.length - 1] - 0.4) < 0.000001);
  assert.ok(attack[8] > 0.8 * (8 / 15));
  assert.ok(decay[8] < 0.8 + (0.4 - 0.8) * (8 / 15));
});

test('master glue gently shapes peaks while preserving silence', () => {
  assert.equal(masterGlueSample(0), 0);
  const quiet = masterGlueSample(0.1);
  assert.ok(quiet > 0.08 && quiet < 0.14);
  assert.ok(Math.abs(masterGlueSample(0.95)) < 0.95);
  assert.ok(Math.abs(masterGlueSample(-0.95)) < 0.95);
  assert.ok(MASTER_GLUE_DEFAULTS.drive > 0);
});

test('master glue applies equally to mono and stereo buffers', () => {
  const mono = new Float32Array([0, 0.25, -0.75, 1]);
  const stereo = {
    left: new Float32Array([0, 0.25, -0.75, 1]),
    right: new Float32Array([0, -0.25, 0.75, -1]),
    length: 4,
  };
  applyMasterGlue(mono);
  applyMasterGlue(stereo);
  assert.equal(mono[0], 0);
  assert.equal(stereo.left[0], 0);
  assert.ok(Math.abs(mono[3]) < 1);
  assert.ok(Math.abs(stereo.left[3]) < 1);
  assert.ok(Math.abs(stereo.right[3]) < 1);
});

test('stereo width helper keeps center stable and spreads unison voices', () => {
  assert.equal(normalizeTrackPan(-2), -1);
  assert.equal(normalizeTrackPan(2), 1);
  assert.equal(normalizeTrackPan(null), 0);
  assert.equal(panForVoice(0, 1, 1), 0);
  assert.equal(panForVoice(0, 3, 0), 0);
  assert.equal(panForVoice(0, 3, 0.5), -0.5);
  assert.equal(panForVoice(2, 3, 0.5), 0.5);

  const center = stereoGainsForPan(0);
  assert.ok(Math.abs(center.left - center.right) < 0.000001);
  const left = stereoGainsForPan(-1);
  const right = stereoGainsForPan(1);
  assert.ok(left.left > left.right);
  assert.ok(right.right > right.left);
});

test('WAV channel mode normalizes export choices without changing defaults', () => {
  assert.equal(normalizeWavChannelMode('auto'), 'auto');
  assert.equal(normalizeWavChannelMode('mono'), 'mono');
  assert.equal(normalizeWavChannelMode('stereo'), 'stereo');
  assert.equal(normalizeWavChannelMode('weird'), 'auto');
  assert.equal(normalizeWavChannelMode('weird', 'stereo'), 'stereo');
});

test('audio input channel preference uses non-failing ideal constraints', () => {
  assert.equal(normalizeAudioInputChannelMode('mono'), 'mono');
  assert.equal(normalizeAudioInputChannelMode('stereo'), 'stereo');
  assert.equal(normalizeAudioInputChannelMode('bad'), 'auto');
  assert.deepEqual(audioInputConstraints('', 'auto'), { audio: true });
  assert.deepEqual(audioInputConstraints('', 'mono'), { audio: { channelCount: { ideal: 1 } } });
  assert.deepEqual(audioInputConstraints('device-1', 'stereo'), {
    audio: { deviceId: { exact: 'device-1' }, channelCount: { ideal: 2 } },
  });
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

test('pad mode normalization retires legacy custom without breaking old projects', () => {
  assert.equal(normalizePadMode('custom'), 'single');
  assert.equal(normalizePadMode('single'), 'single');
  assert.equal(normalizePadMode('voices', { voiceAvailable: false }), 'single');
  assert.equal(normalizePadMode('voices', { voiceAvailable: true }), 'voices');
  assert.equal(normalizePadMode('bad-mode'), 'single');
});

test('pad layout helpers normalize additive relative span settings', () => {
  assert.equal(DEFAULT_PAD_LAYOUT_TEMPLATE, 'even');

  const layout = normalizePadLayout({
    version: 99,
    template: 'bigTonic',
    pads: [
      { ref: 'deg:1', size: 'huge' },
      { ref: 'deg:2', size: 'wide', x: 100, y: 200 },
    ],
  }, 4);

  assert.equal(layout.version, 1);
  assert.equal(layout.template, 'bigTonic');
  assert.deepEqual(layout.pads.map(pad => [pad.ref, pad.size]), [
    ['deg:1', 'large'],
    ['deg:2', 'wide'],
    ['deg:3', 'small'],
    ['deg:4', 'small'],
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(layout.pads[1], 'x'), false);

  const thumb = padLayoutForCount(5, { template: 'thumb' });
  assert.deepEqual(thumb.pads.map(pad => pad.size), ['medium', 'small', 'small', 'medium', 'large']);
});

test('pad layout column helper avoids orphaned single pads when space allows', () => {
  assert.equal(recommendedPadColumns(13, 1800, { template: 'even' }), 7);
  assert.equal(recommendedPadColumns(12, 1800, { template: 'even' }), 6);
  assert.equal(recommendedPadColumns(7, 1800, { template: 'even' }), 4);
  assert.equal(recommendedPadColumns(5, 1800, { template: 'even' }), 3);
  assert.equal(recommendedPadColumns(13, 360, { template: 'even' }), 4);
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

test('controller modifier slots reserve shoulders and triggers from binding', () => {
  assert.equal(BINDABLE_GAMEPAD_BUTTONS.has(4), false);
  assert.equal(BINDABLE_GAMEPAD_BUTTONS.has(5), false);
  assert.equal(BINDABLE_GAMEPAD_BUTTONS.has(6), false);
  assert.equal(BINDABLE_GAMEPAD_BUTTONS.has(7), false);
  assert.equal(BINDABLE_GAMEPAD_BUTTONS.has(0), true);
  assert.equal(BINDABLE_GAMEPAD_BUTTONS.has(12), true);
  assert.equal(normalizeControllerModifier('note:seventh'), 'seventh');
  assert.equal(normalizeControllerModifier('drive'), 'none');
  assert.equal(normalizeControllerModifier('sus4'), 'sus4');

  const groups = controllerModifierPickerGroups();
  assert.deepEqual(groups.map(group => group.id), ['none', 'navigation', 'chords']);
  assert.equal(groups.flatMap(group => group.items).some(item => item.value === 'drive'), false);
  assert.equal(groups.flatMap(group => group.items).some(item => item.value === 'thirteenth'), true);
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

test('stage drum hits can carry pitch metadata for pitch-class views', () => {
  const stream = new StageEventStream();
  const seen = [];
  stream.subscribe(payload => seen.push(payload.event));
  const event = stream.hit({ source: 'kit', drum: 'snare', lane: 1, pitch: 38, startTick: 0, color: '#ffffff' });
  assert.equal(event.pitch, 38);
  assert.equal(seen[0].pitch, 38);
  assert.equal(stream.hit({ source: 'kit', drum: 'kick', lane: 0 }).pitch, null);
});

test('stage model caps canvas tracks and scales intensity by musical units', () => {
  assert.equal(STAGE_TRACK_LIMIT, STAGE_CANVAS_TRACK_LIMIT);
  assert.ok(STAGE_LIVE_LANE_LIMIT >= 32);

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

test('stage model applies clip time scale to canvas note timing', () => {
  const tracks = [
    {
      id: 'scaled',
      color: '#55ffaa',
      type: 'midi',
      clips: [
        {
          startBar: 1,
          timeScale: 2,
          durationBars: 2,
          snippet: {
            durationTicks: 1920,
            notes: [{ pitch: 60, startTick: 480, durationTick: 240 }],
            hits: [],
          },
        },
      ],
    },
  ];

  const events = stageEventsForCanvasTracks(tracks, { ticksPerBar: 1920, unitTicks: 480 });
  assert.equal(events.length, 1);
  assert.equal(events[0].startTick, 2880);
  assert.equal(events[0].durationTick, 480);
});

test('stage view registry exposes live views without leaking them into canvas stage', () => {
  assert.equal(DEFAULT_STAGE_VIEW_ID, 'trace');
  assert.equal(resolveStageView('missing').id, 'trace');
  assert.equal(resolveStageView('thread').label, 'Thread');
  assert.equal(resolveStageView('pulse').label, 'Pulse');
  assert.equal(resolveStageView('halo').label, 'Halo');
  assert.equal(resolveStageView('pocket').label, 'Pocket');

  const liveIds = stageViewOptionsForMode('live').map(view => view.id);
  assert.deepEqual(liveIds, ['trace', 'thread', 'pulse', 'halo', 'pocket']);

  const canvasIds = stageViewOptionsForMode('canvas').map(view => view.id);
  assert.deepEqual(canvasIds, ['trace']);
});

test('pocket stage model maps event timing and lanes to stable clock positions', () => {
  assert.equal(pocketEventPhase({ startTick: 0 }, { nowTick: 0, unitTicks: 480 }), 0);
  assert.equal(pocketEventPhase({ startTick: 240 }, { nowTick: 0, unitTicks: 480 }), 0.5);
  assert.equal(pocketEventPhase({ startTick: -120 }, { nowTick: 0, unitTicks: 480 }), 0.75);
  assert.equal(pocketEventPhase({ startTick: 720 }, { nowTick: 240, unitTicks: 480 }), 0);

  assert.equal(pocketLaneAngle(0, 4), -Math.PI / 2);
  assert.equal(pocketLaneAngle(1, 4), 0);
  assert.equal(pocketLaneAngle(3, 4), Math.PI);
  assert.equal(pocketActiveSpan({ startMs: 1000, currentMs: 1500 }, { unitMs: 1000 }), 0.5);
  assert.equal(pocketActiveSpan({ startMs: 1000, currentMs: 3500 }, { unitMs: 1000 }), 1);
  assert.equal(pocketActiveSpan({ startMs: 1000, endMs: 1250, currentMs: 3000 }, { unitMs: 1000 }), 0.25);
});

test('stage view navigation wraps within the current Stage mode', () => {
  assert.equal(stageViewNeighbor('trace', 'live', 1).id, 'thread');
  assert.equal(stageViewNeighbor('thread', 'live', 1).id, 'pulse');
  assert.equal(stageViewNeighbor('pulse', 'live', 1).id, 'halo');
  assert.equal(stageViewNeighbor('halo', 'live', 1).id, 'pocket');
  assert.equal(stageViewNeighbor('pocket', 'live', 1).id, 'trace');
  assert.equal(stageViewNeighbor('trace', 'live', -1).id, 'pocket');
  assert.equal(stageViewNeighbor('pulse', 'canvas', 1).id, 'trace');
});

test('clip time scale normalizes as an additive per-clip lens', () => {
  assert.equal(normalizeClipTimeScale(), 1);
  assert.equal(normalizeClipTimeScale(0.5), 0.5);
  assert.equal(normalizeClipTimeScale(2), 2);
  assert.equal(normalizeClipTimeScale(4), 1);

  const clip = { timeScale: 2, durationBars: 1, snippet: { durationTicks: 1920 } };
  assert.equal(clipVisualDurationBars(clip, 1920), 2);
  assert.deepEqual(clipTimeScaleBadgeItem({ timeScale: 0.5 }), {
    id: 'timeScale',
    label: '2x',
    title: 'Double-time',
  });
  assert.equal(clipTimeScaleBadgeItem({ timeScale: 1 }), null);
});

test('clip time scale growth pushes later clips right without changing the edited start', () => {
  const edited = { id: 'a', startBar: 1, durationBars: 1, timeScale: 1, snippet: { durationTicks: 1920 } };
  const neighbor = { id: 'b', startBar: 2.25, durationBars: 1, snippet: { durationTicks: 1920 } };
  const later = { id: 'c', startBar: 4, durationBars: 1, snippet: { durationTicks: 1920 } };
  const track = { clips: [edited, neighbor, later] };

  const result = pushClipsRightForTimeScale(track, edited, 2, 1920);

  assert.equal(edited.startBar, 1);
  assert.equal(edited.durationBars, 2);
  assert.equal(edited.timeScale, 2);
  assert.equal(neighbor.startBar, 3.25);
  assert.equal(later.startBar, 5);
  assert.deepEqual(result.moved.map(item => [item.clip.id, item.from, item.to]), [
    ['b', 2.25, 3.25],
    ['c', 4, 5],
  ]);
});

test('rhythm fit preserves relative feel when strength is zero', () => {
  const events = [
    { pitch: 60, startTick: 100, durationTick: 160, velocity: 0.7 },
    { pitch: 62, startTick: 340, durationTick: 160, velocity: 0.8 },
    { pitch: 64, startTick: 820, durationTick: 160, velocity: 0.9 },
  ];

  const result = fitRhythmEvents(events, {
    targetTicks: RHYTHM_FIT_TARGETS.ONE_BAR,
    gridTicks: 240,
    strength: 0,
    quantizeDurations: true,
  });

  assert.deepEqual(result.events.map(event => event.startTick), [0, 560, 1680]);
  assert.deepEqual(result.events.map(event => event.pitch), [60, 62, 64]);
  assert.deepEqual(result.events.map(event => event.velocity), [0.7, 0.8, 0.9]);
  assert.deepEqual(result.events.map(event => event.durationTick), [373, 373, 240]);
  assert.equal(result.durationTicks, 1920);
});

test('rhythm fit strength blends proportional timing toward the grid', () => {
  const events = [
    { type: 'kick', startTick: 0, velocity: 0.8 },
    { type: 'snare', startTick: 335, velocity: 0.8 },
    { type: 'hihat', startTick: 935, velocity: 0.8 },
  ];

  const result = fitRhythmEvents(events, {
    targetTicks: RHYTHM_FIT_TARGETS.ONE_BAR,
    gridTicks: 240,
    strength: 0.5,
  });

  assert.deepEqual(result.events.map(event => event.startTick), [0, 661, 1680]);
  assert.deepEqual(result.events.map(event => event.type), ['kick', 'snare', 'hihat']);
});

test('rhythm fit even mode spaces events without changing count or order', () => {
  const events = [
    { pitch: 72, startTick: 40, durationTick: 120 },
    { pitch: 76, startTick: 120, durationTick: 120 },
    { pitch: 79, startTick: 980, durationTick: 120 },
    { pitch: 83, startTick: 1200, durationTick: 120 },
  ];

  const result = fitRhythmEvents(events, {
    targetTicks: RHYTHM_FIT_TARGETS.TWO_BARS,
    mode: RHYTHM_FIT_MODES.EVEN,
    quantizeDurations: true,
  });

  assert.deepEqual(result.events.map(event => event.startTick), [0, 960, 1920, 2880]);
  assert.deepEqual(result.events.map(event => event.pitch), [72, 76, 79, 83]);
  assert.deepEqual(result.events.map(event => event.durationTick), [960, 960, 960, 960]);
  assert.equal(result.durationTicks, 3840);
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
