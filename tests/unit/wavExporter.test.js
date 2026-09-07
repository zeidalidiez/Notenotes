import test from 'node:test';
import assert from 'node:assert/strict';

import { snippetToWavBlob } from '../../src/export/WavExporter.js';

async function pcm16(blob) {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const channels = view.getUint16(22, true);
  const samples = [];
  for (let offset = 44; offset + 1 < buffer.byteLength; offset += 2) {
    samples.push(view.getInt16(offset, true));
  }
  return { channels, samples };
}

function longestPeakRun(samples) {
  const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  let longest = 0;
  let run = 0;
  for (const sample of samples) {
    if (Math.abs(sample) === peak) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return { peak, longest };
}

test('dense MIDI export keeps floating-point mix headroom until the master stage', async () => {
  const notes = [48, 52, 55, 60, 64, 67, 72, 76].map(pitch => ({
    pitch,
    startTick: 0,
    durationTick: 960,
    velocity: 1,
  }));
  const blob = await snippetToWavBlob({
    id: 'dense-chord',
    type: 'midi',
    bpm: 120,
    durationTicks: 960,
    notes,
    patchRecorded: { instrumentId: 'chip_lead', patchSnapshot: null },
  });
  const { samples } = await pcm16(blob);
  const { peak, longest } = longestPeakRun(samples);

  assert.ok(peak > 0, 'render contains audio');
  assert.ok(peak <= Math.ceil(0x7fff * 0.98), 'final PCM stays under the safety peak');
  assert.ok(longest < 4, `dense chord has no baked flat-top plateau (longest run ${longest})`);
});

test('saved zero MIDI velocity remains silent in WAV export', async () => {
  const blob = await snippetToWavBlob({
    id: 'zero-velocity',
    type: 'midi',
    bpm: 120,
    durationTicks: 480,
    notes: [{ pitch: 0, startTick: 0, durationTick: 240, velocity: 0 }],
    patchRecorded: { instrumentId: 'chip_lead', patchSnapshot: null },
  });
  const { samples } = await pcm16(blob);

  assert.equal(samples.some(sample => sample !== 0), false);
});

test('procedural drum and Tone-noise exports are reproducible by default', async () => {
  const snippet = {
    id: 'deterministic-noise',
    type: 'drum',
    bpm: 120,
    durationTicks: 480,
    soundTraits: { noise: { amount: 0.35 }, space: { amount: 0.2 } },
    hits: [
      { type: 'snare', startTick: 0, velocity: 0.7 },
      { type: 'hihat', startTick: 240, velocity: 0.5 },
    ],
  };

  const first = new Uint8Array(await (await snippetToWavBlob(snippet)).arrayBuffer());
  const second = new Uint8Array(await (await snippetToWavBlob(snippet)).arrayBuffer());

  assert.deepEqual(second, first);
});
