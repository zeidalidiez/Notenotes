# Notenotes roadmap

This is a direction list for a free, local-first pre-DAW, not a release promise.
The app has no hosted account service, server database, or private-data backend to
grow. Work should improve making, keeping, understanding, or exporting a musical
idea without turning Notenotes into a production DAW.

The public feature checklist and longer-term vision remain in the
[`README`](../README.md). This file records the most credible next seams found in
the code and older planning notes.

## Near-term: make the existing app dependable

- Run and maintain the [`manual QA pass`](manual-qa.md) across desktop Chrome and
  iOS Safari/Chrome, especially audio wake, recording, restore, backup, and export.
- Add focused regressions when a reproducible bug is found; keep audio-device,
  touch, PWA-install, and permission behavior in manual QA where simulation lies.
- Keep README claims, project defaults, migrations, live playback, and exports in
  sync whenever an existing feature is extended.

## Instrument character without an effects rack

- Explore a Karplus–Strong plucked voice with live/offline-render parity.
- Explore cached additive `PeriodicWave` recipes for organ, reed, and glass colors.
- Improve layered drum character and widen narrow CC0 sample ranges where source
  material and bundle size make that worthwhile.
- Evaluate friendly sound-shaping concepts from the
  [`sound-design idea bank`](ideas/sound-design.md), starting with a small user
  outcome rather than exposing a modulation matrix.

The 2-operator FM family and Height Velocity across Pads, Piano, and Kit are
already shipped; old documents that list them as unfinished are archived.

## Accessibility and alternate ways to play

- Evaluate a low-stimulation profile that consistently reduces decorative motion,
  pulsing, and high-energy visuals across every mode.
- Add non-color cues where degree, beat, and velocity meaning currently depends on
  color alone.
- Prototype haptic metronome/feedback only behind capability detection and an
  explicit opt-in.
- Explore sticky/latching modifiers for players who cannot comfortably hold two
  controls at once.

Tremor Filter, Dwell Play, URL-enabled profiles, Step Play, reduced-motion handling,
and accessible palettes already exist. Extend those paths instead of rebuilding
parallel versions.

## Deliberately later

- MP3 export needs a reliable, appropriately licensed browser encoder path.
- Stage video/GIF capture needs audio synchronization and predictable performance.
- Microtonal modes and changing meter mid-song both affect editing, controllers,
  labels, AI context, and exports; they need complete designs rather than isolated
  UI switches.

## Product guardrails

- Prefer local files, browser storage, share links, and optional local folders over
  accounts or a hosted sync service.
- Prefer sketching and handoff features over mixing/mastering depth.
- Do not add runtime dependencies on proprietary or unclearly licensed audio.
- Promote an idea into active work only with a bounded user story and a parity/test
  plan. Move finished implementation plans into `docs/archive/`.
