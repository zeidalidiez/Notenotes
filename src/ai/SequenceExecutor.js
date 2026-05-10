/**
 * SequenceExecutor — Convert a validated sequence into a snippet.
 *
 * This does NOT drive the audio engine in real time. Instead, it constructs
 * a snippet object that matches the shape RecordingManager produces. The
 * resulting snippet is added to the project just like any human-recorded
 * one; the user previews it by tapping the tray.
 *
 * Why not drive the transport in real time:
 *   - It would force the user to wait `lengthBars * (beat / BPM)` seconds
 *     per generation. A 4-bar 80 BPM sequence is 12 seconds.
 *   - It races with whatever the user is currently doing in the transport.
 *   - It's harder to make atomic — a half-played sequence is a half-baked
 *     snippet that's awkward to clean up.
 *
 * Building the snippet directly is instant, atomic, and side-effect-free.
 */

import { TICKS_PER_BEAT } from './sequence-schema.js';
import { getScaleNotes } from '../engine/MusicTheory.js';

const DEFAULT_PAD_DURATION_BEATS = 0.5;
const DEFAULT_NOTE_VELOCITY = 0.85;
const DEFAULT_DRUM_VELOCITY = 1;

/**
 * Build a snippet object from a validated sequence.
 *
 * @param {object} sequence - Already validated by SequenceValidator.
 * @param {object} context
 * @param {object} context.transport - Provides bpm + timeSignature.
 * @param {string} [context.scaleName='major'] - Scale name (for scaleboard).
 * @param {string} [context.rootNote='C']
 * @param {number} [context.octave=4]
 * @param {string} [context.prompt] - Original user prompt; preserved on the snippet.
 * @param {string} [context.providerId] - Which provider generated this; preserved on snippet.
 * @returns {object} snippet
 */
export function buildSnippetFromSequence(sequence, context) {
  if (!sequence || !context || !context.transport) {
    throw new Error('buildSnippetFromSequence requires sequence and context.transport.');
  }
  const transport = context.transport;
  const beatsPerBar = transport.timeSignature?.beats || 4;
  const ticksPerBar = TICKS_PER_BEAT * beatsPerBar;

  const notes = [];
  const hits = [];
  let maxEndTick = 0;

  // For scaleboard, build the scale once so each padIndex resolves identically.
  let padToMidi = null;
  if (sequence.instrument === 'scaleboard') {
    const scaleNotes = getScaleNotes(
      context.scaleName || 'major',
      context.rootNote || 'C',
      context.octave || 4,
    );
    padToMidi = scaleNotes;
  }

  for (const ev of sequence.events) {
    const beat = Number(ev.beat) || 0;
    const startTick = Math.round(beat * TICKS_PER_BEAT);

    if (ev.type === 'padPress') {
      const midi = padToMidi?.[ev.padIndex];
      if (midi === undefined) continue; // skip if pad is somehow out of range
      const durationBeats = typeof ev.durationBeats === 'number' ? ev.durationBeats : DEFAULT_PAD_DURATION_BEATS;
      const durationTick = Math.max(1, Math.round(durationBeats * TICKS_PER_BEAT));
      notes.push({
        pitch: midi,
        startTick,
        durationTick,
        velocity: typeof ev.velocity === 'number' ? ev.velocity : DEFAULT_NOTE_VELOCITY,
      });
      maxEndTick = Math.max(maxEndTick, startTick + durationTick);
    } else if (ev.type === 'noteOn') {
      const durationBeats = typeof ev.durationBeats === 'number' ? ev.durationBeats : DEFAULT_PAD_DURATION_BEATS;
      const durationTick = Math.max(1, Math.round(durationBeats * TICKS_PER_BEAT));
      notes.push({
        pitch: ev.midi,
        startTick,
        durationTick,
        velocity: typeof ev.velocity === 'number' ? ev.velocity : DEFAULT_NOTE_VELOCITY,
      });
      maxEndTick = Math.max(maxEndTick, startTick + durationTick);
    } else if (ev.type === 'drumHit') {
      hits.push({
        type: ev.drum,
        startTick,
        velocity: typeof ev.velocity === 'number' ? ev.velocity : DEFAULT_DRUM_VELOCITY,
      });
      maxEndTick = Math.max(maxEndTick, startTick);
    }
  }

  // Sort by startTick so playback is deterministic.
  notes.sort((a, b) => a.startTick - b.startTick);
  hits.sort((a, b) => a.startTick - b.startTick);

  // Snippet duration is exactly the user-requested length. Validator already
  // rejected anything past that bound. We do NOT pad past the requested
  // length even if content "wants" a beat of breathing room — the user asked
  // for 4 bars, they get 4 bars.
  const durationTicks = sequence.lengthBars * ticksPerBar;

  const snippetType = hits.length > 0 && notes.length === 0 ? 'drum' : 'midi';
  const totalEvents = notes.length + hits.length;

  const snippet = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    type: snippetType,
    name: defaultSnippetName(sequence.instrument, totalEvents),
    notes,
    hits,
    modulation: [],
    durationTicks,
    bpm: transport.bpm,
    timeSignature: { ...(transport.timeSignature || { beats: 4, subdivision: 4 }) },
    aiSeeded: true,
    aiPrompt: typeof context.prompt === 'string' ? context.prompt.slice(0, 240) : '',
    aiProvider: context.providerId || 'unknown',
    aiInstrument: sequence.instrument,
    aiLengthBars: sequence.lengthBars,
  };

  return snippet;
}

function defaultSnippetName(instrumentId, eventCount) {
  const prefix = '🤖';
  switch (instrumentId) {
    case 'kit':
      return `${prefix} ${eventCount} hit${eventCount === 1 ? '' : 's'}`;
    case 'piano':
    case 'scaleboard':
    default:
      return `${prefix} ${eventCount} note${eventCount === 1 ? '' : 's'}`;
  }
}
