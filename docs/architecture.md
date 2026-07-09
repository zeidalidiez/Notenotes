# Notenotes architecture

This is the short architectural map for contributors. [`AI.MD`](../AI.MD) is
the detailed, canonical implementation guide and should be read before a
meaningful code change.

## Design boundaries

Notenotes is a local-first, browser-only music sketchpad built with vanilla ES
modules. The framework choice keeps the runtime small and makes ownership of DOM,
audio, and persistence work explicit. Audio stability comes from scheduling
against the Web Audio clock; it does not depend on the absence of a UI framework.

The main source areas are:

- `src/engine/` — timing, playback, recording, theory, and reusable audio logic.
- `src/instruments/` — playable surfaces and live sound generators.
- `src/modes/` — Create, Canvas, and Inspect orchestration.
- `src/ui/` — reusable interface components and popovers.
- `src/data/` — IndexedDB persistence, migrations, history, and backups.
- `src/export/` — MIDI, WAV, ABC, and sheet-music export paths.
- `src/stage/` — live performance visualizations.
- `src/main.js` — application bootstrap and cross-mode wiring.

UI classes usually own an element, render their own markup, and expose callbacks.
Modes connect those components to the shared project and services. Keep pure math
and scheduling out of DOM handlers when a small engine helper can express it.

## Project state and persistence

The serializable `project` object is the shared source of truth for settings,
snippets, tracks, milestones, and related workspace state. Components receive the
current project through explicit setters or constructor wiring. Mutations that
should persist must schedule the normal debounced save through `ProjectStore`;
do not invent a second store or write directly to IndexedDB from a feature.

Large audio payloads have their own durable asset path and are reconnected to
their lightweight project metadata when loaded. Backups, migrations, undo/history,
and new-project defaults all need to agree when the state shape changes.

## Audio and visual clocks

`Transport` uses a short look-ahead loop but schedules actual sound against
`AudioContext.currentTime`. Playback code should schedule a little ahead and must
not use animation frames as an audio clock.

Visual playheads and meters use `requestAnimationFrame` and read current transport
state. They may redraw late without moving already-scheduled audio. Preserve this
separation when adding a visualization or playback mode.

## Input and output parity

Create-mode keyboard, Web MIDI, and gamepad events enter through
`PerformanceInputRouter`; the active surface decides what a press means. Pointer
input stays with the owning instrument. Once an event becomes a note or drum hit,
its pitch, timing, and velocity should survive recording, playback, Stage, and the
relevant export formats.

Live synthesis and offline WAV rendering are separate implementations. Any new
patch type or sound-shaping behavior needs an explicit export-parity decision and,
normally, a matching `WavExporter` path.

## Testing changes

Put pure behavior under `tests/unit/`, keep the quick application contract in the
smoke suite, and use [`manual-qa.md`](manual-qa.md) for browser, audio-device,
touch, PWA, and platform checks that cannot be made trustworthy in Node.

Before a PR, run:

```bash
npm test
npm run build
```

Update [`README.md`](../README.md) for user-visible behavior and `AI.MD` for any
implementation detail another contributor would otherwise have to rediscover.
