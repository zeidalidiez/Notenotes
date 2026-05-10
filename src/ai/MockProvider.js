/**
 * MockProvider — Generates canned-but-musical sequences with no API call.
 *
 * Why this exists:
 *   1. Lets the user test the full pipeline without a key or network.
 *   2. Lets us validate the executor + UI without spending tokens.
 *   3. Preserves the "AI as instrument" framing without committing the
 *      project to any specific provider.
 *
 * The mock isn't trying to be smart. It picks a small set of musical
 * patterns appropriate to the active instrument and returns the one that
 * matches the user's bar length. The user prompt is echoed back as the
 * "rationale" but doesn't affect the output.
 */

import { AIProvider } from './AIProvider.js';

const KICK_SNARE_PATTERNS = {
  1: [
    { beat: 0, drum: 'kick' },
    { beat: 1, drum: 'snare' },
    { beat: 2, drum: 'kick' },
    { beat: 3, drum: 'snare' },
  ],
  2: [
    { beat: 0, drum: 'kick' },
    { beat: 1, drum: 'snare' },
    { beat: 1.75, drum: 'kick' },
    { beat: 2, drum: 'kick' },
    { beat: 3, drum: 'snare' },
    { beat: 4, drum: 'kick' },
    { beat: 5, drum: 'snare' },
    { beat: 6, drum: 'kick' },
    { beat: 6.5, drum: 'kick' },
    { beat: 7, drum: 'snare' },
  ],
  4: [
    { beat: 0, drum: 'kick' },
    { beat: 1, drum: 'snare' },
    { beat: 2, drum: 'kick' },
    { beat: 3, drum: 'snare' },
    { beat: 4, drum: 'kick' },
    { beat: 5, drum: 'snare' },
    { beat: 6, drum: 'kick' },
    { beat: 7, drum: 'snare' },
    { beat: 8, drum: 'kick' },
    { beat: 9, drum: 'snare' },
    { beat: 10, drum: 'kick' },
    { beat: 11, drum: 'snare' },
    { beat: 12, drum: 'kick' },
    { beat: 13, drum: 'snare' },
    { beat: 13.5, drum: 'kick' },
    { beat: 14, drum: 'kick' },
    { beat: 15, drum: 'snare' },
  ],
};

const SCALE_PATTERNS = {
  1: [
    { beat: 0, padIndex: 0, durationBeats: 0.5 },
    { beat: 0.5, padIndex: 2, durationBeats: 0.5 },
    { beat: 1, padIndex: 4, durationBeats: 0.5 },
    { beat: 1.5, padIndex: 2, durationBeats: 0.5 },
    { beat: 2, padIndex: 4, durationBeats: 0.5 },
    { beat: 2.5, padIndex: 6, durationBeats: 0.5 },
    { beat: 3, padIndex: 4, durationBeats: 1 },
  ],
  2: [
    { beat: 0, padIndex: 0, durationBeats: 1 },
    { beat: 1, padIndex: 4, durationBeats: 0.5 },
    { beat: 1.5, padIndex: 2, durationBeats: 0.5 },
    { beat: 2, padIndex: 4, durationBeats: 0.5 },
    { beat: 2.5, padIndex: 6, durationBeats: 1.5 },
    { beat: 4, padIndex: 4, durationBeats: 0.5 },
    { beat: 4.5, padIndex: 2, durationBeats: 0.5 },
    { beat: 5, padIndex: 0, durationBeats: 1 },
    { beat: 6, padIndex: 4, durationBeats: 1 },
    { beat: 7, padIndex: 0, durationBeats: 1 },
  ],
  4: [
    { beat: 0, padIndex: 0, durationBeats: 0.5 },
    { beat: 0.5, padIndex: 2, durationBeats: 0.5 },
    { beat: 1, padIndex: 4, durationBeats: 1 },
    { beat: 2, padIndex: 6, durationBeats: 0.5 },
    { beat: 2.5, padIndex: 4, durationBeats: 0.5 },
    { beat: 3, padIndex: 2, durationBeats: 1 },
    { beat: 4, padIndex: 0, durationBeats: 0.5 },
    { beat: 4.5, padIndex: 4, durationBeats: 0.5 },
    { beat: 5, padIndex: 2, durationBeats: 0.5 },
    { beat: 5.5, padIndex: 4, durationBeats: 0.5 },
    { beat: 6, padIndex: 6, durationBeats: 1 },
    { beat: 7, padIndex: 4, durationBeats: 1 },
    { beat: 8, padIndex: 2, durationBeats: 0.5 },
    { beat: 8.5, padIndex: 4, durationBeats: 0.5 },
    { beat: 9, padIndex: 2, durationBeats: 0.5 },
    { beat: 9.5, padIndex: 0, durationBeats: 0.5 },
    { beat: 10, padIndex: 4, durationBeats: 1 },
    { beat: 11, padIndex: 2, durationBeats: 1 },
    { beat: 12, padIndex: 0, durationBeats: 1 },
    { beat: 13, padIndex: 4, durationBeats: 0.5 },
    { beat: 13.5, padIndex: 2, durationBeats: 0.5 },
    { beat: 14, padIndex: 0, durationBeats: 2 },
  ],
};

const PIANO_PATTERNS = {
  1: [
    { beat: 0, midi: 60, durationBeats: 0.5 },
    { beat: 0.5, midi: 64, durationBeats: 0.5 },
    { beat: 1, midi: 67, durationBeats: 0.5 },
    { beat: 1.5, midi: 64, durationBeats: 0.5 },
    { beat: 2, midi: 67, durationBeats: 0.5 },
    { beat: 2.5, midi: 71, durationBeats: 0.5 },
    { beat: 3, midi: 67, durationBeats: 1 },
  ],
  2: [
    { beat: 0, midi: 60, durationBeats: 1 },
    { beat: 1, midi: 67, durationBeats: 0.5 },
    { beat: 1.5, midi: 64, durationBeats: 0.5 },
    { beat: 2, midi: 67, durationBeats: 0.5 },
    { beat: 2.5, midi: 71, durationBeats: 1.5 },
    { beat: 4, midi: 72, durationBeats: 0.5 },
    { beat: 4.5, midi: 67, durationBeats: 0.5 },
    { beat: 5, midi: 64, durationBeats: 1 },
    { beat: 6, midi: 67, durationBeats: 1 },
    { beat: 7, midi: 60, durationBeats: 1 },
  ],
  4: [
    { beat: 0, midi: 60, durationBeats: 0.5 },
    { beat: 0.5, midi: 64, durationBeats: 0.5 },
    { beat: 1, midi: 67, durationBeats: 1 },
    { beat: 2, midi: 71, durationBeats: 0.5 },
    { beat: 2.5, midi: 67, durationBeats: 0.5 },
    { beat: 3, midi: 64, durationBeats: 1 },
    { beat: 4, midi: 60, durationBeats: 0.5 },
    { beat: 4.5, midi: 67, durationBeats: 0.5 },
    { beat: 5, midi: 64, durationBeats: 0.5 },
    { beat: 5.5, midi: 67, durationBeats: 0.5 },
    { beat: 6, midi: 71, durationBeats: 1 },
    { beat: 7, midi: 67, durationBeats: 1 },
    { beat: 8, midi: 64, durationBeats: 0.5 },
    { beat: 8.5, midi: 67, durationBeats: 0.5 },
    { beat: 9, midi: 64, durationBeats: 0.5 },
    { beat: 9.5, midi: 60, durationBeats: 0.5 },
    { beat: 10, midi: 67, durationBeats: 1 },
    { beat: 11, midi: 64, durationBeats: 1 },
    { beat: 12, midi: 60, durationBeats: 1 },
    { beat: 13, midi: 67, durationBeats: 0.5 },
    { beat: 13.5, midi: 64, durationBeats: 0.5 },
    { beat: 14, midi: 60, durationBeats: 2 },
  ],
};

export class MockProvider extends AIProvider {
  constructor() {
    super({ id: 'mock', label: 'Mock (offline test)', requiresKey: false });
  }

  listModels() {
    return ['mock-canned-v1'];
  }

  getPricing() {
    return { inputPerMillion: 0, outputPerMillion: 0 };
  }

  async generate({ tool, requestedLengthBars }) {
    if (!tool || !tool.input_schema) {
      throw new Error('Mock provider expects a tool definition with input_schema.');
    }
    const instrument = tool.input_schema.properties?.instrument?.const;
    const lengthOptions = tool.input_schema.properties?.lengthBars?.enum || [4];

    // Honor the user's requested length when valid. The mock has canned
    // patterns for 1/2/4 bars; for 8 bars we tile the 4-bar pattern.
    const length = lengthOptions.includes(requestedLengthBars) ? requestedLengthBars : 4;
    const events = buildMockEvents(instrument, length);

    return {
      arguments: {
        instrument,
        lengthBars: length,
        events,
      },
      rawToolName: tool.name,
      usage: { inputTokens: 0, outputTokens: 0 },
      providerId: this.id,
      model: 'mock-canned-v1',
    };
  }
}

function basePatternsFor(instrument) {
  if (instrument === 'kit') return KICK_SNARE_PATTERNS;
  if (instrument === 'piano') return PIANO_PATTERNS;
  return SCALE_PATTERNS;
}

function tilePattern(basePattern, baseLength, requestedLength, beatsPerBar = 4) {
  // Repeat the base pattern N times across the requested length, offsetting
  // each copy by baseLength bars. Used for length=8 when we only have a
  // length=4 canned set.
  const out = [];
  const baseBeats = baseLength * beatsPerBar;
  const copies = Math.max(1, Math.round(requestedLength / baseLength));
  for (let i = 0; i < copies; i++) {
    const offset = i * baseBeats;
    for (const ev of basePattern) {
      out.push({ ...ev, beat: ev.beat + offset });
    }
  }
  // Drop anything that escaped past the requested length (defensive).
  const totalBeats = requestedLength * beatsPerBar;
  return out.filter(ev => ev.beat < totalBeats - 0.001);
}

function buildMockEvents(instrument, length) {
  const patterns = basePatternsFor(instrument);
  // If we don't have an exact pattern for the requested length, tile the
  // 4-bar pattern. This lets length=8 work without authoring more data.
  const base = patterns[length] || tilePattern(patterns[4], 4, length);
  if (instrument === 'kit') {
    return base.map(p => ({ beat: p.beat, type: 'drumHit', drum: p.drum, velocity: 1 }));
  }
  if (instrument === 'piano') {
    return base.map(p => ({ beat: p.beat, type: 'noteOn', midi: p.midi, durationBeats: p.durationBeats, velocity: 0.85 }));
  }
  return base.map(p => ({ beat: p.beat, type: 'padPress', padIndex: p.padIndex, durationBeats: p.durationBeats, velocity: 0.85 }));
}
