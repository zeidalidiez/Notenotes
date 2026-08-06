# Notenotes roadmap

This is a short direction map for a free, local-first pre-DAW, not a release
promise or task tracker. Actionable work belongs in
[GitHub Issues](https://github.com/zeidalidiez/Notenotes/issues) once it has a
bounded user story and acceptance criteria.

## First: make the existing app dependable

- Gate production deployment on the automated tests and production build.
- Keep inactive modes, panels, and instruments out of the keyboard tab order and
  accessibility tree; give modal surfaces complete focus behavior.
- Flush pending autosaves on lifecycle boundaries and validate imported backups
  against bounded, known schemas.
- Do not expose a custom instrument type until playback, persistence, and
  relevant export paths all honor it.
- Record desktop Chrome and iOS Safari release results with the concise
  [`manual QA checklist`](manual-qa.md).

## Then: reduce cross-surface drift

- Establish a clearer contract between live synthesis and offline WAV rendering
  before adding more synthesis families.
- Add focused parity tests for patch identity, velocity response, Tone, pan,
  channel count, and drum-kit behavior.
- Make note spelling and ABC key output aware of project context instead of
  always emitting sharp names under `K:C`.
- Keep defaults, migrations, history, backup, sharing, Stage, and exports aligned
  whenever project or snippet state changes.

## Accessible ways to play

Candidates for bounded design work:

- a consistent low-stimulation profile;
- non-color cues for degree, beat, and velocity meaning;
- sticky or latching alternatives to held modifiers;
- explicit adaptive-switch and foot-pedal mapping on top of existing Gamepad and
  Step Play paths;
- opt-in haptics behind capability detection.

Webcam/Wiimote motion, accelerometer input, color-strip notation, and body
percussion recognition remain discussion-stage ideas rather than commitments.

## Instrument character

After renderer parity is better defined:

- prototype a Karplus-Strong plucked voice;
- prototype cached additive `PeriodicWave` recipes for organ, reed, and glass
  colors;
- improve layered drum character and widen narrow CC0 sample ranges where source
  material and bundle size justify it;
- prefer a small musical outcome over exposing a conventional effects rack.

The FM family, four-zone Height Velocity, Tone controls, custom melodic patches,
instrument picker, and four synthesized drum kits are already shipped.

## Deliberately later

- MP3 export needs a reliable, appropriately licensed browser encoder.
- Stage video/GIF capture needs audio synchronization and predictable mobile
  performance.
- True microtonality affects pitch labels, input, editing, AI context, MIDI, ABC,
  and WAV output and needs one complete design.
- Meter maps affect every timing and editing surface and should not begin as an
  isolated selector.

## Guardrails

- Prefer local files, browser storage, share links, and optional local folders
  over accounts or hosted sync.
- Prefer sketching and handoff over mixing and mastering depth.
- Do not add runtime dependencies on proprietary or unclearly licensed audio.
- Do not use this file as a checkbox ledger. Close shipped work in its issue or
  PR and keep only the remaining strategic direction here.
