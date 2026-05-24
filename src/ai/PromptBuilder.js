/**
 * PromptBuilder — Compose the structured request handed to an LLM provider.
 *
 * The system prompt establishes:
 *   - What Notenotes is (positioning).
 *   - That the AI is an instrument, not the artist.
 *   - The active musical context (scale, key, BPM, instrument).
 *   - The exact tool the AI is allowed to call (submitSequence) and its shape.
 *   - Constraints derived from the instrument (pad count, drum names, etc.).
 *   - What the AI should NOT do (no commentary, no other tools, no repetition).
 *
 * The user prompt is the user's free-text description ("a moody half-time
 * hip-hop beat", "an 8-bar melodic hook in D minor", etc.).
 *
 * The result is provider-agnostic. OpenAIProvider and AnthropicProvider
 * adapt the same structure to their respective APIs.
 */

import {
  AI_INSTRUMENTS,
  KIT_DRUMS,
  ALLOWED_LENGTHS_BARS,
  getSubmitSequenceTool,
} from './sequence-schema.js';
import { SCALES, scaleDescription } from '../engine/MusicTheory.js';

/**
 * @typedef {object} PromptContext
 * @property {string} instrument        - 'scaleboard' | 'piano' | 'kit'
 * @property {number} lengthBars        - 1, 2, 4, or 8
 * @property {number} bpm
 * @property {object} [meter]           - normalized project meter
 * @property {object} timeSignature     - legacy { beats, subdivision }
 * @property {number} [beatsPerBar]     - felt pulses per bar
 * @property {string} [scaleName]       - 'major', 'minor', etc. (scaleboard only)
 * @property {string} [rootNote]
 * @property {number} [padCount]        - number of pads in active scale
 * @property {object} [referencedSnippet] - optional, single snippet's summary
 */

/**
 * Build the system prompt. Static enough to be deterministic across runs;
 * varies only by the active instrument and project context.
 *
 * @param {PromptContext} ctx
 * @returns {string}
 */
export function buildSystemPrompt(ctx) {
  const inst = AI_INSTRUMENTS[ctx.instrument];
  if (!inst) throw new Error(`Unknown instrument: ${ctx.instrument}`);

  const beatsPerBar = ctx.beatsPerBar || ctx.meter?.pulseCount || ctx.timeSignature?.beats || 4;
  const totalBeats = (ctx.lengthBars || 4) * beatsPerBar;
  const meter = `${ctx.timeSignature?.beats || 4}/${ctx.timeSignature?.subdivision || 4}`;
  const pulseText = ctx.meter?.pulse === 'dotted-quarter'
    ? 'BPM counts dotted-quarter pulses'
    : ctx.meter?.pulse === 'eighth'
      ? 'BPM counts eighth-note pulses'
      : 'BPM counts quarter-note pulses';

  const lines = [];
  lines.push(`You are a sequencing assistant inside Notenotes, a free, open-source pre-DAW musical sketchpad.`);
  lines.push('');
  lines.push(`Your role: when the user describes a musical idea, plan a short sequence of events the user will play and refine. You are an instrument they are using, not the composer. The user is the composer.`);
  lines.push('');
  lines.push(`Hard constraints:`);
  lines.push(`- The user controls all structural settings: tempo, time signature, scale, key, instrument selection.`);
  lines.push(`- You only fill in the events. Do not attempt to change tempo, meter, or instrument.`);
  lines.push(`- Submit your sequence by calling the submitSequence tool exactly once. Do not call any other tool. Do not produce free-text commentary.`);
  lines.push('');
  lines.push(`Current musical context:`);
  lines.push(`- Active instrument: ${inst.label} (${inst.id}). ${inst.description}`);
  lines.push(`- Time signature: ${meter}. Use ${beatsPerBar} felt beat${beatsPerBar === 1 ? '' : 's'} per bar for event beat positions.`);
  lines.push(`- Tempo: ${ctx.bpm || 120} BPM (${pulseText}).`);
  if (ctx.instrument === 'scaleboard') {
    const scale = SCALES[ctx.scaleName] || SCALES.major;
    const scaleContext = scaleDescription(ctx.scaleName || 'major');
    lines.push(`- Scale: ${scale.name || ctx.scaleName || 'Major'} in ${ctx.rootNote || 'C'}. ${ctx.padCount || 7} pads available (padIndex 0..${(ctx.padCount || 7) - 1}). The pads are scale-locked; you cannot play out-of-key notes.`);
    if (scaleContext) lines.push(`- Scale color: ${scaleContext}`);
  } else if (ctx.instrument === 'piano') {
    lines.push(`- Free chromatic. You can use any MIDI note 24..96. The user has not constrained you to a key, but tasteful key choices respect the project's overall scale (${ctx.scaleName || 'major'} in ${ctx.rootNote || 'C'}).`);
  } else if (ctx.instrument === 'kit') {
    lines.push(`- Drums: ${KIT_DRUMS.join(', ')}. No pitch.`);
  }
  lines.push(`- Sequence length: ${ctx.lengthBars} bars (${totalBeats} beats total). All events must fall within beat 0 to ${totalBeats - 0.001}.`);
  lines.push('');

  if (ctx.referencedSnippet) {
    lines.push(`Reference material the user attached:`);
    lines.push(referencedSnippetSummary(ctx.referencedSnippet));
    lines.push('');
    lines.push(`Use this reference as inspiration. You may pattern-match its rhythm, density, or note relationships. Do not copy it literally.`);
    lines.push('');
  }

  lines.push(`Style guidance:`);
  lines.push(`- Aim for musical coherence, not maximum density. Whitespace is part of the composition.`);
  lines.push(`- Match the energy the user describes. "Chill" means fewer events; "frantic" means more.`);
  lines.push(`- Prefer recognizable patterns (4-on-the-floor, syncopated melodies, call-and-response) over random noodling.`);
  lines.push(`- Stay within the bar boundaries. Don't start at beat 0.0 only to dump everything in the last bar.`);
  lines.push('');
  lines.push(`Output format:`);
  lines.push(`- Call the submitSequence tool exactly once.`);
  lines.push(`- The tool's input schema describes the exact event shape. Follow it precisely.`);
  lines.push(`- Sort events by beat ascending.`);
  lines.push(`- Produce between 1 and 256 events.`);
  return lines.join('\n');
}

function referencedSnippetSummary(snippet) {
  const noteCount = (snippet.notes?.length || 0);
  const hitCount = (snippet.hits?.length || 0);
  const lines = [];
  lines.push(`- Reference snippet: ${snippet.name || `${noteCount + hitCount} events`}`);
  lines.push(`  type=${snippet.type}, ${noteCount} notes, ${hitCount} hits, durationTicks=${snippet.durationTicks}, bpm=${snippet.bpm || 'unknown'}`);
  if (noteCount > 0) {
    const pitches = snippet.notes.slice(0, 12).map(n => `${n.pitch}@beat${(n.startTick / 480).toFixed(2)}`).join(', ');
    lines.push(`  first notes: ${pitches}`);
  }
  if (hitCount > 0) {
    const drumHits = snippet.hits.slice(0, 12).map(h => `${h.type}@beat${(h.startTick / 480).toFixed(2)}`).join(', ');
    lines.push(`  first hits: ${drumHits}`);
  }
  return lines.join('\n');
}

/**
 * Build the user prompt. Trimmed and capped to keep tokens predictable.
 * Free text from the user; no parsing, no structure.
 *
 * @param {string} userText
 * @returns {string}
 */
export function buildUserPrompt(userText) {
  const max = 1500;
  const text = String(userText || '').trim().slice(0, max);
  if (!text) {
    return 'Generate a short, musically interesting sequence appropriate to the active instrument.';
  }
  return text;
}

/**
 * The tool definition the AI is allowed to call. Single tool, narrow scope.
 *
 * @param {string} instrumentId
 * @returns {{ name: string, description: string, input_schema: object }}
 */
export function buildToolDefinition(instrumentId) {
  return getSubmitSequenceTool(instrumentId);
}

export { ALLOWED_LENGTHS_BARS };
