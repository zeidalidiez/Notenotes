# Notenotes contributor guide

This guide applies to the whole repository. Keep it short and limited to durable
engineering rules; implementation details belong in code, tests, and focused
documentation.

## Product boundaries

Notenotes is a browser-based, local-first pre-DAW for quickly capturing musical
ideas. It has no hosted account service or application backend. Prefer direct
musical controls and fast capture over production-DAW depth.

- Do not add runtime CDNs or require a network connection for normal use.
- Do not store API keys in projects, backups, URLs, or IndexedDB.
- Audio assets bundled for user exports must be CC0/public domain or otherwise
  obligation-free for the user.
- Do not add a custom meter, microtonal mode, or large sample library without a
  design covering playback, editing, persistence, export, and accessibility.

## Commands

Use Node 20.19+ or 22.12+.

```bash
npm ci
npm test
npm run build
npm run dev
```

`npm test` runs the no-emoji check, smoke suite, and Node unit tests. Do not use
`--legacy-peer-deps`; dependency changes must keep the lockfile peer-clean.

## Code map

- `src/engine/` owns timing, recording, music theory, and reusable audio logic.
- `src/instruments/` owns playable surfaces and live sound generation.
- `src/modes/` orchestrates Create, Canvas, and Inspect.
- `src/ui/` contains reusable controls, pickers, and settings surfaces.
- `src/data/` owns IndexedDB persistence, migrations, history, and audio assets.
- `src/export/` owns MIDI, WAV, ABC, and sheet-music output.
- `src/stage/` owns performance visualizations and their event model.
- `src/main.js` is application bootstrap and cross-mode wiring.

UI components are vanilla ES-module classes that normally own `this.el`, render
their markup, and expose callbacks. Keep pure math and scheduling out of DOM
handlers when a focused engine helper can express them.

## Project state and persistence

The serializable `project` object is the source of truth for settings, snippets,
tracks, milestones, and workspace state. Persistent mutations must use the
normal `ProjectStore` save path; do not create a second store or write to
IndexedDB from a feature component.

Large audio data belongs in the audio-asset store, referenced by lightweight
project metadata. Never place blobs or base64 audio inside project JSON.

When the project shape changes, update all of these together:

- new-project defaults;
- load-time normalization or migration;
- history/undo behavior where relevant;
- workspace and snippet backups;
- share links where relevant;
- tests for older and current state.

A saved numeric value of zero is intentional. Use nullish checks rather than
truthiness for settings such as volume, pan, and timing values.

## Audio timing

Transport schedules ahead against `AudioContext.currentTime`. Never schedule
musical audio from `requestAnimationFrame`, or use timer callbacks as the audio
clock. Visual playheads may use animation frames and read transport state; late
visual frames must not move scheduled audio.

Web Audio initialization and resume must remain inside a user gesture. Preserve
the iOS media-route primer and do not turn that temporary permission path into
recording.

Live synthesis and offline WAV rendering are separate implementations today.
Any new patch, drum behavior, Tone control, velocity rule, or channel behavior
needs an explicit live/offline parity decision and regression coverage.

## Input, UI, and accessibility

Keyboard, Web MIDI, and gamepad input route through
`PerformanceInputRouter`; the active Create surface decides what a press means.
Pointer input stays with the owning instrument.

Hidden modes, panels, and instrument surfaces must not remain in the keyboard
tab order or accessibility tree. Pair visual state with `inert`, `aria-hidden`,
focus management, and dialog semantics where appropriate.

For a user-facing feature, consider the complete path:

1. pointer, keyboard, MIDI, gamepad, and assistive input where applicable;
2. recording and editing;
3. playback and Stage visualization;
4. persistence, migration, history, backup, and sharing;
5. MIDI, WAV, ABC, and sheet export where meaningful;
6. desktop, mobile, reduced-motion, keyboard, and screen-reader behavior;
7. automated tests plus bounded manual QA.

Do not present a partially wired feature as available. Hide it behind an
explicit experimental path until its promised playback and export behavior is
real.

## Testing

Put deterministic behavior in `tests/unit/`. Keep `tests/smoke.mjs` focused on
the fast application contract. Browser audio, permissions, touch, PWA install,
and device-specific behavior belong in `docs/manual-qa.md` unless a trustworthy
browser test exists.

Bug fixes should add the smallest regression that would have caught the issue.
Run `npm test` and `npm run build` before publishing a PR. UI changes also need a
rendered desktop check and a mobile-sized check when layout is involved.

## Versions and documentation

`src/version.js` is the canonical public app version used by Settings and
backups. Keep `package.json` and `package-lock.json` aligned when preparing a
release, but do not make runtime version checks depend on package metadata.

Update `README.md` only for durable user-facing behavior. Update
`docs/architecture.md` for structural boundaries, `docs/roadmap.md` for a small
set of strategic directions, and `docs/manual-qa.md` for repeatable release
checks. Actionable work belongs in GitHub Issues and PRs, not dated plans in the
repository.

Do not add a new planning document when an issue, test, code comment, or edit to
an existing canonical document will do.
