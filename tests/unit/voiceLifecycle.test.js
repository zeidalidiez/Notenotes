import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/engine/AudioEngine.js';
import { WebAudioSynth, PRESETS } from '../../src/instruments/WebAudioSynth.js';

function freshEngine() {
  const engine = AudioEngine.getInstance();
  engine._initialized = false;
  engine.ctx = null;
  engine.initSync();
  return { engine, ctx: globalThis.__lastAudioContext };
}

function sampleSynth(ctx, { durationSec = 0.4, playbackMode = 'gated' } = {}) {
  const sampleBuffer = ctx.createBuffer(2, Math.floor(durationSec * ctx.sampleRate), ctx.sampleRate);
  const synth = new WebAudioSynth();
  synth.init();
  synth.loadPatch({ type: 'sample', name: 'CC0', sampleBuffer, rootMidi: 60, playbackMode, gain: 0.55 });
  return synth;
}

test('sample voice disposes its nodes once the buffer plays to its natural end', () => {
  const { ctx } = freshEngine();
  const synth = sampleSynth(ctx, { durationSec: 0.3 });

  synth.noteOn(60, 0.8, ctx.currentTime);
  assert.equal(ctx.liveSourceCount('BufferSource'), 1, 'one source live immediately after trigger');
  assert.equal(synth._voices.size, 1);

  ctx.advance(0.4);
  assert.equal(ctx.liveSourceCount('BufferSource'), 0, 'source ended after its duration elapsed');
  assert.equal(synth._voices.size, 0, 'voice removed from map on ended');
  assert.ok(ctx.disconnectCount() > 0, 'disposed nodes were disconnected, not left to GC');
});

test('a single sample played and allowed to finish leaves zero live nodes', () => {
  const { ctx } = freshEngine();
  const synth = sampleSynth(ctx, { durationSec: 0.2 });

  synth.noteOn(64, 0.8, ctx.currentTime);
  ctx.advance(1.0);

  assert.equal(ctx.liveSourceCount('BufferSource'), 0);
  assert.equal(synth._voices.size, 0);
});

test('rapid sample triggers all dispose once the clock passes their durations', () => {
  const { ctx } = freshEngine();
  const synth = sampleSynth(ctx, { durationSec: 0.25 });

  for (let i = 0; i < 64; i++) {
    synth.noteOn(48 + (i % 24), 0.8, ctx.currentTime);
    ctx.advance(0.002);
  }
  ctx.advance(2.0);

  assert.equal(ctx.liveSourceCount('BufferSource'), 0, 'every burst source eventually disposed');
  assert.equal(synth._voices.size, 0);
});

// --- CRASH REPRO (intentionally red): the node-pileup the code comments fear ---
//
// "Windows Chrome crashes when sample pads are hit too fast." These two tests
// pin the actual defect: during a rapid burst, the number of *concurrently live*
// AudioBufferSourceNodes is NOT bounded by the polyphony cap. _voices stays at or
// below MAX_VOICES (8), giving a false sense of safety, but every retrigger
// schedules the previous source's stop() in the FUTURE (now + release + 0.1),
// so the audio renderer keeps hundreds of sources live simultaneously — which is
// exactly what exhausts the tab.
//
// Suspected defect: WebAudioSynth.noteOn sample path (src/instruments/WebAudioSynth.js:499-565)
// + noteOff scheduling a future stop (src/instruments/WebAudioSynth.js:651-652).
// The polyphony guard caps the _voices MAP, not concurrently-live nodes.
//
// Do NOT weaken these assertions to make them pass. They are red on purpose and
// turn green only when the sample path bounds live node count under burst.

const VOICE_CAP = 8; // MAX_VOICES in WebAudioSynth.js

test('CRASH REPRO: spamming ONE sample pad keeps live BufferSource count at the voice cap', () => {
  const { ctx } = freshEngine();
  const synth = sampleSynth(ctx, { durationSec: 0.4 });

  for (let i = 0; i < 100; i++) {
    synth.noteOn(60, 0.8, ctx.currentTime);
    ctx.advance(0.002); // 2ms between hits — far faster than the 400ms sample
  }

  const live = ctx.liveSourceCount('BufferSource');
  assert.ok(
    live <= VOICE_CAP,
    `live BufferSource count should stay <= ${VOICE_CAP} under single-pad spam, got ${live} ` +
    `(voices map reports ${synth._voices.size}). Node pileup → tab crash.`
  );
});

test('CRASH REPRO: rapid rotating sample triggers keep live BufferSource count bounded', () => {
  const { ctx } = freshEngine();
  const synth = sampleSynth(ctx, { durationSec: 0.4 });

  for (let i = 0; i < 200; i++) {
    synth.noteOn(48 + (i % 24), 0.8, ctx.currentTime);
    ctx.advance(0.001);
  }

  const live = ctx.liveSourceCount('BufferSource');
  assert.ok(
    live <= VOICE_CAP,
    `live BufferSource count should stay <= ${VOICE_CAP} during a 200-trigger burst, got ${live}. ` +
    `Concurrent live nodes are unbounded even though _voices is capped at ${synth._voices.size}.`
  );
});

// --- ENVELOPE OVERLAP REPRO: adjacent value curves throw NotSupportedError ---
//
// In real Chrome, _scheduleAmpEnvelope / _scheduleFilterEnvelope issued two
// back-to-back setValueCurveAtTime calls on a fresh gain/filter param. Chrome
// quantizes automation times to render frames; for many `now` values the decay
// curve's start frame landed on the attack curve's end frame, so Chrome rejected
// the second curve as overlapping (NotSupportedError) on ~20-26% of triggers.
// FakeAudioParam now models that rule, so the single-combined-curve fix is the
// only shape that survives this burst headlessly.

test('rapid sample retrigger never throws NotSupportedError from the envelope schedule', () => {
  const { ctx } = freshEngine();
  const synth = sampleSynth(ctx, { durationSec: 0.4 });
  synth.loadPatch({
    type: 'sample',
    name: 'CC0',
    sampleBuffer: ctx.createBuffer(2, Math.floor(0.4 * ctx.sampleRate), ctx.sampleRate),
    rootMidi: 60,
    playbackMode: 'gated',
    gain: 0.55,
    filterEnv: { attack: 0.01, decay: 0.3, sustain: 0.5, depth: 0.4 },
  });

  assert.doesNotThrow(() => {
    for (let i = 0; i < 200; i++) {
      synth.noteOn(48 + (i % 24), 0.8, ctx.currentTime + i * 0.0011);
    }
  }, 'combined attack+decay curve must not produce overlapping setValueCurveAtTime ranges');
});

test('synth note schedule never throws NotSupportedError under fast retrigger', () => {
  const { ctx } = freshEngine();
  const synth = new WebAudioSynth();
  synth.init();
  synth.loadPatch(PRESETS.modern_keys);

  assert.doesNotThrow(() => {
    for (let i = 0; i < 200; i++) {
      synth.noteOn(60, 0.8, ctx.currentTime + i * 0.0011);
    }
  });
});

// --- synth (oscillator) voice path ---

test('a single synth note holds its oscillators live until noteOff', () => {
  const { ctx } = freshEngine();
  const synth = new WebAudioSynth();
  synth.init();
  synth.loadPatch(PRESETS.chip_lead);

  synth.noteOn(60, 0.8, ctx.currentTime);
  const liveDuringHold = ctx.liveSourceCount('Oscillator');
  assert.ok(liveDuringHold >= 1, 'gated synth note keeps oscillators running while held');
  assert.equal(synth._voices.size, 1);

  synth.noteOff(60, ctx.currentTime);
  ctx.advance(2.0);
  assert.equal(ctx.liveSourceCount('Oscillator'), 0, 'oscillators stop and dispose after release');
  assert.equal(synth._voices.size, 0);
});

test('synth voice stealing keeps the held-voice map at the polyphony cap', () => {
  const { ctx } = freshEngine();
  const synth = new WebAudioSynth();
  synth.init();
  synth.loadPatch(PRESETS.chip_lead);

  for (let i = 0; i < 20; i++) {
    synth.noteOn(40 + i, 0.8, ctx.currentTime);
    ctx.advance(0.01);
  }
  assert.ok(synth._voices.size <= VOICE_CAP, `held voices map capped at ${VOICE_CAP}, got ${synth._voices.size}`);
});

test('panic() clears the voice map and stops every source immediately', () => {
  const { ctx } = freshEngine();
  const synth = new WebAudioSynth();
  synth.init();
  synth.loadPatch(PRESETS.modern_keys);

  for (let i = 0; i < 6; i++) synth.noteOn(50 + i, 0.8, ctx.currentTime);
  assert.ok(synth._voices.size > 0);

  synth.panic();
  assert.equal(synth._voices.size, 0, 'panic empties the voice map');
  ctx.advance(0.05);
  assert.equal(ctx.liveSourceCount('Oscillator'), 0, 'panic stops oscillators at currentTime');
});
