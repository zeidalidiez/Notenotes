import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/engine/AudioEngine.js';
import { PlaybackEngine } from '../../src/engine/PlaybackEngine.js';
import { makeFakeTransport } from '../fixtures/fakeTransport.js';

function freshEngine() {
  const engine = AudioEngine.getInstance();
  engine._initialized = false;
  engine.ctx = null;
  engine.initSync();
  return globalThis.__lastAudioContext;
}

function midiTrackProject({ timeScale = 1, startBar = 0, notes, durationTicks = 3840 }) {
  return {
    settings: { soundTraits: {} },
    tracks: [{
      id: 't1', type: 'midi', instrumentId: 'modern_keys',
      clips: [{ id: 'c1', startBar, timeScale, snippet: { id: 's1', type: 'midi', durationTicks, notes } }],
    }],
  };
}

/** Drive ticks [0, lastTick) and record (pitch, tick) of every noteOn. */
function captureNoteOns(pe, project, ctx, lastTick) {
  const synth = pe._getSynthForTrack(project.tracks[0]);
  pe._trackSynths.set('t1', { synth, instrumentId: 'modern_keys' });
  const events = [];
  const orig = synth.noteOn.bind(synth);
  synth.noteOn = (pitch, vel, time) => { events.push({ pitch, time }); return orig(pitch, vel, time); };
  for (let tick = 0; tick < lastTick; tick++) pe._processTick(tick, ctx.currentTime + tick * 0.001);
  return events;
}

test('each note fires exactly once at its start tick (timeScale 1)', () => {
  const ctx = freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = midiTrackProject({
    notes: [
      { pitch: 60, startTick: 0, durationTick: 120, velocity: 0.8 },
      { pitch: 62, startTick: 480, durationTick: 120, velocity: 0.8 },
      { pitch: 64, startTick: 960, durationTick: 120, velocity: 0.8 },
    ],
  });
  const pe = new PlaybackEngine(transport, project);
  const events = captureNoteOns(pe, project, ctx, 1920);

  assert.equal(events.length, 3, 'three notes, three triggers — none dropped, none doubled');
  assert.deepEqual(events.map(e => e.pitch), [60, 62, 64]);
});

test('a note before the clip start (negative offset) never triggers', () => {
  const ctx = freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = midiTrackProject({
    startBar: 1,
    notes: [{ pitch: 60, startTick: 0, durationTick: 120, velocity: 0.8 }],
  });
  const pe = new PlaybackEngine(transport, project);
  // Only drive ticks within the first bar — the clip starts at bar 1 (tick 1920).
  const synth = pe._getSynthForTrack(project.tracks[0]);
  pe._trackSynths.set('t1', { synth, instrumentId: 'modern_keys' });
  let count = 0;
  const orig = synth.noteOn.bind(synth);
  synth.noteOn = (...a) => { count++; return orig(...a); };
  for (let tick = 0; tick < 1920; tick++) pe._processTick(tick, ctx.currentTime);
  assert.equal(count, 0, 'note in a later-starting clip is silent during the first bar');
});

test('half-time clip (timeScale 0.5) compresses note start ticks and still fires each note', () => {
  const ctx = freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = midiTrackProject({
    timeScale: 0.5,
    notes: [
      { pitch: 60, startTick: 0, durationTick: 120 },
      { pitch: 62, startTick: 480, durationTick: 120 },
      { pitch: 64, startTick: 960, durationTick: 120 },
    ],
  });
  const pe = new PlaybackEngine(transport, project);
  const events = captureNoteOns(pe, project, ctx, 1920);

  // startTick * 0.5 → 0, 240, 480
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(e => e.pitch), [60, 62, 64]);
});

test('double-time clip (timeScale 2) spreads note start ticks across the timeline', () => {
  const ctx = freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = midiTrackProject({
    timeScale: 2,
    notes: [
      { pitch: 60, startTick: 0, durationTick: 120 },
      { pitch: 64, startTick: 480, durationTick: 120 },
    ],
  });
  const pe = new PlaybackEngine(transport, project);
  const events = captureNoteOns(pe, project, ctx, 3840);

  // startTick * 2 → 0, 960
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(e => e.pitch), [60, 64]);
});

test('scheduled noteOff fires after the note duration elapses', () => {
  const ctx = freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = midiTrackProject({
    notes: [{ pitch: 60, startTick: 0, durationTick: 240, velocity: 0.8 }],
  });
  const pe = new PlaybackEngine(transport, project);
  const synth = pe._getSynthForTrack(project.tracks[0]);
  pe._trackSynths.set('t1', { synth, instrumentId: 'modern_keys' });
  let offs = 0;
  const origOff = synth.noteOff.bind(synth);
  synth.noteOff = (...a) => { offs++; return origOff(...a); };

  for (let tick = 0; tick <= 300; tick++) pe._processTick(tick, ctx.currentTime + tick * 0.001);
  assert.equal(offs, 1, 'note released once its duration (240 ticks) elapsed');
});

// --- BUG (intentionally red): recorded modulation is silently dropped on modern voices ---
//
// PlaybackEngine._applyModulation (src/engine/PlaybackEngine.js:483-506) reaches for
// `voice.osc.detune` and `voice.filter.frequency`. But multi-oscillator voices —
// which every modern/unison preset produces — store `oscillators[]`/`oscillators2[]`
// and have NO `voice.osc` (src/instruments/WebAudioSynth.js:611). `voice.osc` is
// undefined, `.detune` throws, and the surrounding `try/catch (e) { /* ignore */ }`
// swallows it. So the documented "recorded modulation rides on clips" feature does
// nothing on any modern instrument.
//
// This test asserts the modulation DID reach the oscillators. It is red until
// PlaybackEngine applies modulation against the real voice structure.

test('BUG: recorded modulation reaches a modern voice oscillators (currently swallowed)', () => {
  const ctx = freshEngine();
  const transport = makeFakeTransport({ ticksPerBar: 1920 });
  const project = midiTrackProject({
    notes: [{ pitch: 60, startTick: 0, durationTick: 1920, velocity: 0.8 }],
    durationTicks: 1920,
  });
  project.tracks[0].clips[0].snippet.modulation = [
    { tick: 0, pitchBend: 0.5, modulation: 0.5 },
    { tick: 240, pitchBend: -0.5, modulation: 0.2 },
  ];

  const pe = new PlaybackEngine(transport, project);
  const synth = pe._getSynthForTrack(project.tracks[0]);
  pe._trackSynths.set('t1', { synth, instrumentId: 'modern_keys' });

  for (let tick = 0; tick <= 300; tick++) pe._processTick(tick, ctx.currentTime + tick * 0.001);

  const voice = [...synth._voices.values()][0];
  assert.ok(voice, 'a voice is live');
  assert.equal(voice.osc, undefined, 'modern voice has no single .osc — it stores oscillators[]');

  const detuneWrites = (voice.oscillators || [])
    .reduce((n, o) => n + o.detune.automation.filter(a => a.op === 'setTargetAtTime').length, 0);
  assert.ok(
    detuneWrites > 0,
    'modulation should write detune on the voice oscillators, but _applyModulation reached ' +
    'voice.osc (undefined) and the throw was swallowed — modulation never applied'
  );
});
