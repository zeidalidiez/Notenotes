/**
 * sequence-schema — The shape an AI emits when seeding a snippet.
 *
 * The same definitions are used by:
 *   - SequenceValidator.js (rejects malformed AI output before execution)
 *   - SequenceExecutor.js (translates valid sequences into snippet objects)
 *   - PromptBuilder.js (advertises the shape to LLMs as a tool schema)
 *
 * Keeping all three downstream consumers off a single source of truth here
 * means the AI's contract is documented once and cannot drift.
 *
 * Sequences use BEATS, not ticks. LLMs reason about musical time better in
 * beats than in 480-tick ticks. The executor converts beats -> ticks at the
 * boundary using the project's tempo/meter.
 */

export const TICKS_PER_BEAT = 480;

/**
 * Instruments the AI can play. The active instrument is set by the user before
 * generation; the AI emits events compatible with that instrument's event type.
 */
export const AI_INSTRUMENTS = Object.freeze({
  scaleboard: {
    id: 'scaleboard',
    label: 'Scale Board',
    eventType: 'padPress',
    description: 'Scale-locked pads. Pad indexes are positions in the current scale (0 = root, 1 = next scale degree, etc.). Cannot play out-of-key notes.',
  },
  piano: {
    id: 'piano',
    label: 'Micro Piano',
    eventType: 'noteOn',
    description: 'Chromatic keyboard. Use raw MIDI numbers (0-127). Free to play any pitch including out-of-key.',
  },
  kit: {
    id: 'kit',
    label: 'Sketch Kit',
    eventType: 'drumHit',
    description: 'Drum kit. Use named drums; no pitch.',
  },
});

/**
 * The canonical drum names the kit understands. Anything else gets rejected
 * by the validator. Matches the SketchKit's SOUNDS list.
 */
export const KIT_DRUMS = Object.freeze([
  'kick',
  'snare',
  'clap',
  'hihat',
  'cymbal',
  'tomLow',
  'tomMid',
  'tomHigh',
  'rim',
  'shaker',
]);

export const ALLOWED_LENGTHS_BARS = Object.freeze([1, 2, 4, 8]);
export const MAX_EVENTS_PER_SEQUENCE = 256;
export const MIN_EVENTS_PER_SEQUENCE = 1;
export const MAX_PAD_INDEX = 15;     // Scale Board / Controller maxes at 16 pads
export const MIDI_MIN = 24;          // C1
export const MIDI_MAX = 96;          // C7
export const MIN_DURATION_BEATS = 0.0625; // 1/64 note
export const MAX_DURATION_BEATS = 16;     // two whole 4/4 bars

/**
 * The JSON Schema-ish description used by the prompt builder to teach LLMs
 * what to emit. We keep it as a plain object so providers can format it
 * however their tool-calling API expects (OpenAI/Anthropic differ slightly).
 */
export function getSequenceSchemaForInstrument(instrumentId) {
  const inst = AI_INSTRUMENTS[instrumentId];
  if (!inst) throw new Error(`Unknown instrument: ${instrumentId}`);

  const eventSchemas = {
    padPress: {
      type: 'object',
      required: ['beat', 'type', 'padIndex'],
      properties: {
        beat: { type: 'number', description: 'Beat position from sequence start. 0 = first beat of bar 1. A 4/4, 4-bar sequence runs from beat 0 to beat 15.999.', minimum: 0 },
        type: { const: 'padPress', description: 'Always "padPress" for the Scale Board.' },
        padIndex: {
          type: 'integer',
          description: 'Index into the current scale\'s pad layout. 0 = root, 1 = scale degree 2, etc. Bounded by the user\'s active scale (typically 7 pads for major/minor; 5 for pentatonic).',
          minimum: 0,
          maximum: MAX_PAD_INDEX,
        },
        durationBeats: {
          type: 'number',
          description: 'How long the pad is held, in beats. Defaults to 0.5 if omitted. Use 0.25 for sixteenth notes, 0.5 for eighths, 1 for quarters.',
          minimum: MIN_DURATION_BEATS,
          maximum: MAX_DURATION_BEATS,
        },
        velocity: {
          type: 'number',
          description: 'Optional velocity 0-1. Defaults to 0.85.',
          minimum: 0,
          maximum: 1,
        },
      },
    },
    noteOn: {
      type: 'object',
      required: ['beat', 'type', 'midi'],
      properties: {
        beat: { type: 'number', description: 'Beat position from sequence start.', minimum: 0 },
        type: { const: 'noteOn', description: 'Always "noteOn" for the piano.' },
        midi: {
          type: 'integer',
          description: 'MIDI note number. Middle C is 60. Stay between 24 (C1) and 96 (C7).',
          minimum: MIDI_MIN,
          maximum: MIDI_MAX,
        },
        durationBeats: {
          type: 'number',
          description: 'Hold duration in beats. Default 0.5.',
          minimum: MIN_DURATION_BEATS,
          maximum: MAX_DURATION_BEATS,
        },
        velocity: { type: 'number', description: 'Velocity 0-1, default 0.85.', minimum: 0, maximum: 1 },
      },
    },
    drumHit: {
      type: 'object',
      required: ['beat', 'type', 'drum'],
      properties: {
        beat: { type: 'number', description: 'Beat position from sequence start.', minimum: 0 },
        type: { const: 'drumHit', description: 'Always "drumHit" for the kit.' },
        drum: {
          type: 'string',
          description: `One of: ${KIT_DRUMS.join(', ')}. Names are case-sensitive.`,
          enum: [...KIT_DRUMS],
        },
        velocity: { type: 'number', description: 'Hit hardness 0-1, default 1.', minimum: 0, maximum: 1 },
      },
    },
  };

  return {
    type: 'object',
    description: 'A pre-planned sequence of musical events to be played by Notenotes and captured as a snippet. The user controls all structural settings (tempo, meter, scale). The AI only fills in the events.',
    required: ['instrument', 'lengthBars', 'events'],
    additionalProperties: false,
    properties: {
      instrument: {
        const: inst.id,
        description: `Active instrument. Always "${inst.id}" for this generation.`,
      },
      lengthBars: {
        type: 'integer',
        description: 'Total length of the sequence in bars. Must match the user-selected length.',
        enum: [...ALLOWED_LENGTHS_BARS],
      },
      events: {
        type: 'array',
        description: `Ordered list of musical events. ${MIN_EVENTS_PER_SEQUENCE}-${MAX_EVENTS_PER_SEQUENCE} entries. Sort by beat ascending.`,
        minItems: MIN_EVENTS_PER_SEQUENCE,
        maxItems: MAX_EVENTS_PER_SEQUENCE,
        items: eventSchemas[inst.eventType],
      },
    },
  };
}

/**
 * Tool definition used in the LLM provider request. Notenotes only ever
 * exposes ONE writing tool: submitSequence. Read-only context (current scale,
 * BPM, etc.) is in the system prompt, not as a tool call.
 *
 * @param {string} instrumentId
 * @returns {{ name: string, description: string, input_schema: object }}
 */
export function getSubmitSequenceTool(instrumentId) {
  return {
    name: 'submitSequence',
    description: 'Submit the planned sequence for Notenotes to capture as a snippet. Call this exactly once with your complete sequence. Do not call any other tools.',
    input_schema: getSequenceSchemaForInstrument(instrumentId),
  };
}
