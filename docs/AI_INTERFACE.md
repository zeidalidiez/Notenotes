# Notenotes AI Interface Spec (v1)

This document describes the contract Notenotes establishes with an LLM when the user asks the app to seed a snippet. It is the human-readable companion to the runtime tool schema in `src/ai/sequence-schema.js`.

## Position

Notenotes is a creation tool, not a distribution tool. The user is the composer. The AI is one of the user's instruments — like the gamepad, the microphone, or the keyboard. It exists to produce raw musical material the user will keep, refine, or discard.

The AI never:

- Plays music in real time. It plans a sequence; Notenotes builds a snippet from it; the user previews it.
- Modifies an existing snippet. It only creates new ones.
- Changes tempo, time signature, scale, instrument, master volume, Tone, or any other structural setting. The user owns those.
- Touches the canvas, exports anything, opens files, persists settings, or interacts with the project beyond emitting one sequence.

These constraints are enforced at the tool surface — `submitSequence` is the only writing tool. There is no other.

## Action surface

A single tool: `submitSequence`. Call it exactly once with a complete sequence. Producing free-text commentary, calling other tools, or refusing to call this tool will fail the request.

```
submitSequence({
  instrument: <string>,         // 'scaleboard' | 'piano' | 'kit'
  lengthBars: <number>,         // 1 | 2 | 4 | 8
  events: [<Event>, ...]
})
```

The `instrument` value is fixed per request — the user picked it before invoking the AI. Do not attempt to change it.

`lengthBars` must match what the user requested (the system prompt states the value).

`events[]` is sorted by `beat`. 1 to 256 entries.

## Events by instrument

Each instrument has exactly one valid event shape. Mismatched events are rejected.

### Scale Board (`instrument: "scaleboard"`)

```
{
  beat: <number>,              // 0..(lengthBars * beatsPerBar)
  type: "padPress",
  padIndex: <integer>,         // 0..padCount-1, set by user's active scale
  durationBeats?: <number>,    // default 0.5
  velocity?: <number>          // 0..1, default 0.85
}
```

`padIndex` indexes the *current scale*, not raw MIDI. `padIndex: 0` is the root. The instrument is scale-locked — you cannot play out-of-key notes. Use this to stay musical without a key/scale lookup.

### Micro Piano (`instrument: "piano"`)

```
{
  beat: <number>,
  type: "noteOn",
  midi: <integer>,             // 24 (C1) .. 96 (C7)
  durationBeats?: <number>,
  velocity?: <number>
}
```

Free chromatic. Out-of-key notes are valid here. Tasteful key choices respect the project's overall scale (described in the system prompt).

### Sketch Kit (`instrument: "kit"`)

```
{
  beat: <number>,
  type: "drumHit",
  drum: <"kick"|"snare"|"clap"|"hihat"|"cymbal"|"tomLow"|"tomMid"|"tomHigh"|"rim"|"shaker">,
  velocity?: <number>
}
```

No pitch. Drum names are case-sensitive and must come from the enum above.

## Constraints

- `beat` is strictly less than `lengthBars * beatsPerBar`. (`beatsPerBar` is in the system prompt.)
- All beat positions are in beats from the start of the sequence. Beat 0 is bar 1, beat 1, the literal downbeat.
- `durationBeats` must be at least 1/64 (0.0625) and at most 16 (two whole bars in 4/4).
- `velocity` is 0 to 1; defaults are reasonable — prefer omitting unless you have a reason.
- Sort events by `beat` ascending. Repeated beats are fine (chords on Scale Board, layered drum hits).

## Style guidance

- Match the user's described energy. "Chill" means fewer events; "frantic" means more.
- Prefer recognizable musical patterns (4-on-the-floor, syncopated melodies, call-and-response) over random noodling.
- Whitespace is part of the composition. A 4-bar pattern with 8 well-placed notes can read better than 32 dense ones.
- Don't start at beat 0 only to dump everything at the end. Spread the material across the bars.
- One sequence per call. If the user wants more, they will press the button again.

## Pricing and cost

Notenotes is BYO-key. The user pays your provider directly. We never see, log, or relay your output. The user has accepted a disclaimer that explicitly states they are responsible for incurred costs.

## Security and privacy

- API keys are stored in the user's browser localStorage and sent only to the provider URL the user configured.
- Notenotes does not telemetrize, does not retain prompt or response data, does not have any backend that sees this traffic.
- Self-hosted users can point Ollama at a local URL; in that case the request never leaves their machine.

## Schema reference

The authoritative source-of-truth for the sequence shape lives in:

- `src/ai/sequence-schema.js` — `getSequenceSchemaForInstrument(instrumentId)` and `getSubmitSequenceTool(instrumentId)`.

If this document and that file disagree, the file wins.
