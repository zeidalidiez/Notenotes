# AI.MD - Notenotes Agent Context

This file is the current working architecture guide for AI agents editing
Notenotes. It is no longer append-only. Keep it accurate, remove stale claims,
and update it whenever code changes in a meaningful way.

## Product Shape

Notenotes is a browser-based, local-first PWA for sketching musical ideas before
they become DAW sessions. The app has no backend, no account system, and no
runtime network dependency for normal use. Users play scale-locked pads, piano,
drums, microphone/audio-in, controller bindings, and AI-seeded snippets, then
arrange clips on a Canvas, refine snippets in Inspect, and export MIDI, WAV, ABC,
or sheet music where supported.

The core design rule is "pre-DAW, not mini-DAW." Prefer direct musical controls,
small curated choices, and fast capture over open-ended professional mixing or
notation surfaces.

## Stack And Style

- Vanilla JavaScript ES modules, Vite, Web Audio API.
- No framework. UI components are classes that own `this.el` and return DOM from
  `render()`.
- Use explicit DOM updates. Avoid large rerenders during audio playback.
- CSS lives in `src/style.css`, `src/modes/*.css`, `src/instruments/*.css`, and
  focused UI CSS files.
- Use BEM-ish classes and state classes such as `.is-active`, `.is-selected`,
  `.is-disabled`, `.is-recording`.
- No new runtime dependency unless it preserves PWA/offline behavior, iOS audio
  unlock, exports, backups, and local-first storage.

## App Versioning

`src/version.js` is the canonical public app version. Settings shows
`APP_VERSION` from that file and checks GitHub by fetching raw `src/version.js`
from `main`, then parsing the exported constant with
`latestVersionFromSourceText()` in `src/utils/AppVersion.js`.

Do not point the version checker at `package.json`. Package metadata can lag or
serve tooling needs, while `APP_VERSION` is what users see and what backups
record. Keep `package.json`/`package-lock.json` aligned when doing version-fix
slices so local build output is not misleading, but do not make the runtime
checker depend on package metadata.

Use `compareAppVersions()` for version ordering. It compares numeric semver
parts, so `0.1.105` is newer than `0.1.99`, and `0.2.0` is newer than every
`0.1.x` build.

## Current Module Map

```text
src/main.js
  engine/
    AudioEngine.js          Web Audio context, master output, panic/kill audio
    DrumSynthesis.js        shared procedural drum noise/envelope helpers
    OutputVolume.js         master/metronome volume normalization
    Transport.js            lookahead scheduler and project meter timing
    Meter.js                canonical meter math and display presets
    Metronome.js            click scheduling from Transport callbacks
    Quantizer.js            grid math
    RecordingManager.js     converts live events into snippets
    MusicTheory.js          notes, scales, degree metadata
    ScaleChords.js          curated chord recipes for non-tertian scales
    Progressions.js         degree-stored harmonic context + chord resolver
    PadLayout.js            modular pad layout schema/templates/packing
    ControllerModifiers.js  pure controller modifier recipes and picker groups
    GamepadInputManager.js  gamepad polling and bindable buttons
  ai/
    AIController.js         constrained snippet-generation orchestration
    AIInstrumentContext.js  Create-surface to AI-surface mapping helpers
    aiSettings.js           non-secret project AI settings + live-only keys
    PromptBuilder.js        prompt contract and allowed AI sequence lengths
    SequenceValidator.js    schema/range checks before execution
    SequenceExecutor.js     converts validated AI events into snippets
  instruments/
    WebAudioSynth.js        synth patches, Tone chain, sample branch
    ScaleBoard.js           Pads, Root, Chords, Voice Sketch, Compass
    MicroPiano.js           piano UI and note triggering
    SketchKit.js            synthesized drum kit and kit Tone
    ControllerMode.js       controller state, bindings, presets
    MicRecorder.js          microphone capture
    voice/VoiceEngine.js    formant voice engine
  modes/
    CreativeMode.js         Create mode composition and recording
    input/
      PerformanceInputRouter.js keyboard, MIDI, and gamepad event routing
    CanvasMode.js           timeline/arrangement
    EditMode.js             Inspect mode for MIDI, drum, audio snippets
  ui/
    TransportBar.js         top bar transport, key/scale/correction/meter
    ChoicePicker.js         shared categorized picker for large creative lists
    AISeedPopover.js        AI Seed popover lifecycle around AISeedPanel
    ControllerMapperPopover.js controller learn/list/preset popover UI
    CreateLayoutPopover.js  Pads/Keys Layout popover and degree controls
    CreateInstrumentPopover.js Create/Edit Instrument popover UI
    SettingsPanel.js        settings, export, backup, milestones, diagnostics
    SnippetTray.js          snippet strip
    Toast.js                notifications
  utils/
    AppVersion.js          app-version parsing/comparison for Settings checker
    BackupStatus.js        backup age/status text helpers
    FolderBackup.js        File System Access folder backup helpers
  stage/
    StageEventStream.js     renderer-agnostic live/visual performance events
    StageModel.js           Stage lane limits, intensity tiers, track mapping
    StagePocketModel.js     Pocket groove-clock timing helpers
    StageRenderQuality.js   Stage render budget for blur, trails, motion
    StageViews.js           Stage view registry and mode filtering
  data/
    ProjectStore.js         IndexedDB, audio assets, backup, history
  export/
    WavExporter.js          procedural WAV renderer
    MidiExporter.js         MIDI renderer
    ABCConverter.js         ABC notation conversion
    SheetMusicView.js       abcjs preview/download
```

## Audio Timing Rules

Transport uses a lookahead scheduler:

```text
setInterval scheduler -> schedule ahead against AudioContext.currentTime
```

Do not schedule musical audio with `setTimeout`, `setInterval`, or animation
frame time. Use the `audioTime` supplied by Transport callbacks or
`AudioContext.currentTime`.

Visual updates may use `requestAnimationFrame`; audio scheduling may not depend
on visual frame timing.

### Output Volume State

Project output volume lives in `project.settings.masterVolume` and
`project.settings.metronomeVolume`. A saved value of `0` is intentional and must
not be treated as missing.

- `src/engine/OutputVolume.js` normalizes/clamps both settings and preserves
  zero values.
- `AudioEngine.setVolume()` stores the desired master volume even before
  `AudioContext`/`masterGain` exist. `AudioEngine.initSync()` initializes
  `masterGain.gain.value` from that stored value instead of hardcoding the
  default 0.8.
- `src/main.js` calls `_applyProjectOutputVolumes()` immediately after project
  load and again after audio wake, so persisted sliders and live gain nodes stay
  in sync whether settings are changed before or after browser audio unlock.
- `SettingsPanel` must call `metronome.setVolume()` and `engine.setVolume()`;
  assigning `metronome.volume` or writing `engine.masterGain` directly bypasses
  the pre-init memory path and can make the UI lie after reload.
- `Metronome.init()` is idempotent. Do not remove the guard unless a future
  lifecycle rewrite also prevents duplicate beat subscriptions.

### Browser Audio Unlock

Web Audio must be created or resumed from a user gesture, and iOS Safari can
still leave app output silent even after `AudioContext.state` reports
`running`. On affected iOS builds, opening the system media route through
`getUserMedia({ audio: true })` is the same action that makes Mic In unblock
sound. This is not recording; it is a user-gesture permission primer.

`src/main.js` owns the global unlock path:

- `_initializeAudioFromGesture()` creates/resumes `AudioEngine`, initializes the
  metronome, Creative mode, and Canvas playback engine, then calls
  `AudioEngine.unlockGesture()` before and after resume. On likely iOS devices
  it also starts `AudioEngine.primeMediaRoute()` before `AudioContext` setup
  and before the first awaited resume when route priming is requested, so Safari
  receives the media request directly inside the user's tap.
- `_buildAudioUnlockPrompt()` adds the floating `Tap to enable sound` prompt.
  It stays visible while the app has not initialized audio, while
  `engine.ctx.state !== 'running'`, or while iOS still has not primed the media
  route. On iOS it tells the user Safari may ask for microphone access and that
  Notenotes will not record from this unlock path. The prompt itself counts as
  an iOS route-prime target and listens to pointerdown, touchend, and click so
  WebKit has multiple valid gesture hooks; keep this broad unless device QA
  proves it causes duplicate permission prompts.
- `_bindAudioContextState()` and the `notenotes-audio-state-changed` event keep
  the prompt synced when instruments attempt their own unlocks.
- `CreativeMode.ensureAudioReady()` still retries from actual instrument
  touches, then emits `notenotes-audio-state-changed` so the shell prompt does
  not get stale.
- `MicRecorder._openStream()` calls `AudioEngine.markMediaRoutePrimed()` after
  a successful stream open so using Audio In also satisfies the same iOS route
  requirement.
- `AudioEngine.primeMediaRoute()` immediately stops every track from the
  temporary stream. Do not connect this stream to the graph or keep it alive
  unless a future iOS regression proves that stopping it is insufficient.

This is intentionally a visible user-gesture affordance instead of an automatic
page-load permission request. Page-load audio starts are blocked by browsers,
and a surprise microphone prompt would break the app's trust model. The primer
may run from the first sound-producing gesture on iOS because the prompt is
already visible and the platform has proven that Web Audio alone is not enough.

### Ticks And Meter

- The project uses 480 PPQ (`ticksPerBeat` means ticks per quarter note).
- Snippet events store `startTick` and `durationTick`.
- `src/engine/Meter.js` is the canonical source for bar/tick math.
- Do not calculate bar length as `480 * beats` except for simple `/4` meters.

Correct current formula:

```js
beatUnitTicks = ticksPerQuarter * (4 / meter.denominator);
ticksPerBar = beatUnitTicks * meter.numerator;
```

Examples at 480 PPQ:

- `4/4` = `480 * 4 = 1920` ticks.
- `6/8` = `(480 * 4 / 8) * 6 = 1440` ticks.
- `7/8` = `(480 * 4 / 8) * 7 = 1680` ticks.

BPM means felt pulse per minute, not always quarter notes per minute. For
compound and asymmetric meters, `secondsPerTickForMeter()` derives the constant
tick rate from bar duration and ticks per bar. MIDI export uses
`quarterBpmForMeter()` so external MIDI players preserve wall-clock duration.

## Meter Model

`project.meter` is the source of truth. `project.timeSignature` remains as a
legacy mirror for older import/export paths.

```js
{
  type: 'metered',
  id: '7/8',
  numerator: 7,
  denominator: 8,
  pulse: 'eighth',
  pulseCount: 3,
  grouping: [2, 2, 3],
  feelName: 'Asymmetric'
}
```

Supported picker meters are defined in `METER_PICKER_IDS`: `2/4`, `3/4`, `4/4`,
`5/4`, `6/8`, `9/8`, `12/8`, `5/8`, and `7/8`. `free` exists in the helper
module but is not exposed yet.

Grouping choices live in `ALLOWED_GROUPINGS`. For `5/8` and `7/8`, changing the
grouping changes the Canvas grid and metronome feel but must not move existing
notes or clips.

When creating or normalizing projects/snippets, write both:

```js
meter: normalizeMeter(...),
timeSignature: meterToTimeSignature(...)
```

### Tap Tempo

`src/engine/TapTempo.js` derives a BPM from the timing of repeated taps. The
math is pure and clock-free: the caller passes each tap's timestamp in
milliseconds (the UI uses `performance.now()`), so it is deterministic to test.

- `TapTempo.tap(now)` records a tap and returns the current BPM, or `null` until
  there are at least two taps. A gap longer than `resetMs` (2000ms) restarts the
  count so an abandoned tap never blends into a new tempo; non-monotonic
  timestamps are ignored. Intervals are kept in a rolling window and averaged.
- `bpmFromIntervals()` and `clampBpm()` are the pure helpers; BPM is clamped to
  the same `40–240` range Transport accepts.
- `TransportBar` owns one `TapTempo` instance and a `#bpm-tap-button`. Each tap
  routes through `_setBpm()`, so it persists via `onBpmChange` exactly like the
  number input and the mobile BPM modal. Do not write `transport.bpm` directly
  from the tap path; keep it going through `_setBpm()`.

## Data Model

Project sketch:

```js
{
  id,
  name,
  bpm,
  meter,              // canonical
  timeSignature,      // legacy mirror
  musicalContext: { root: 'C', scale: 'major', correction: 'off' },
  progression: {
    enabled: false,
    id: 'off',
    name: 'Off',
    advance: 'manual',
    chordType: 'triad',
    activeStepIndex: 0,
    steps: []
  },
  tracks: [],
  snippets: [],
  settings: {
    soundTraits: {},
    tonePresets: [],
    customInstruments: [],
    controllerBindings: {},
    controllerBindingPresets: [],
    controllerModifierAssignments: {
      leftBumper: 'octaveDown',
      leftTrigger: 'none',
      rightBumper: 'octaveUp',
      rightTrigger: 'none'
    },
    controllerToneAssignments: { leftTrigger: 'none', rightTrigger: 'none' }, // legacy migration input only
    degreeHighlighting: {},
    backupContents: 'current',
    versionHistoryLimit: 5,
    aiSettings: {}
  }
}
```

Track sketch:

```js
{
  id,
  name,
  type: 'midi' | 'drum' | 'audio',
  instrumentId,
  clips: [
    {
      id,
      snippetId,
      snippet,       // embedded/current snippet object used by the Canvas
      startTick,
      durationTicks,
      soundTraits
    }
  ],
  muted,
  solo,
  volume,
  color
}
```

Snippet sketch:

```js
{
  id,
  type: 'midi' | 'drum' | 'audio',
  name,
  bpm,
  meter,
  timeSignature,
  durationTicks,
  soundTraits,
  notes: [
    { pitch, startTick, durationTick, velocity, soundTraits }
  ],
  hits: [
    { type, startTick, velocity, soundTraits }
  ],
  patchRecorded,
  kitRecorded,
  audioAssetId,
  audioUrl,
  audioMimeType,
  audioSize,
  audioPeaks
}
```

Snippets are reused by clips. Editing a source snippet affects every clip that
references or embeds it unless code intentionally clones it.

## Progression Context

`src/engine/Progressions.js` is the foundation slice for project-level harmonic
context. The current shipped behavior is visual-only: selecting Changes can
highlight current chord tones on Pads and Piano, but it does not change
playback, recording, export, or snippets.

Rules:

- `project.progression` is additive and normalized on project create/load/save.
  Old projects without the field become `{ enabled: false, id: 'off', steps: [] }`
  and must keep playing/exporting exactly as they did before.
- Progression steps store scale degrees such as `I`, `V`, `vi`, `bVII`, not
  absolute notes. This lets a future Progression/Changes selector transpose
  with `project.musicalContext`.
- `normalizeProgressionContext()` clamps unknown/malformed data into a safe
  inactive shape. Invalid steps are dropped; `activeStepIndex` is clamped to the
  remaining step list.
- `resolveProgressionStep(step, musicalContext, { chordType })` resolves a
  single degree step into MIDI notes and pitch classes for future glow/playback
  consumers. It first honors exact labels in `ScaleChords.js` for curated
  non-tertian scales, then falls back to stacked scale-thirds from
  `MusicTheory.getScaleNotes()`.
- `chordType` currently supports `triad` and `seventh` only. Add extensions
  deliberately once the UI has a real need.
- `progressionFitsContext(progression, musicalContext)` is the guard for
  scale compatibility. `progressionChoiceGroups(context)` filters out presets
  that cannot resolve every step in the current scale, so a scale such as Todi
  Approx. does not offer progressions whose degrees would produce no glow.
  `NotenotesApp._setProjectMusicalContext()` also turns the current Changes
  setting off if a scale switch makes the selected progression invalid.
- `TransportBar` renders a compact top-bar `Changes: ...` picker using
  `progressionChoiceGroups()`. The closed button carries the noun for
  visibility (`Changes: Off`, `Changes: The Axis`), while the modal rows stay
  plain (`Off`, `The Axis`, etc.) so picker content does not become noisy.
  Selecting `Off` writes the inactive default; selecting a preset writes a
  normalized `project.progression` and dispatches `project-progression-changed`.
- `project.settings.progressionGlow` is an additive visual preference normalized
  by `normalizeProgressionGlow()`: `{ enabled: true, intensity: 0.28 }` by
  default. Layout renders a "Chord tone glow" checkbox and intensity slider in
  both Pads and Keys popovers; changing it refreshes ScaleBoard and MicroPiano.
- `ScaleBoard` listens for `project-progression-changed` and refreshes Pads.
  `_progressionMetaForMidi()` calls `activeProgressionResolution()` and adds
  `.scaleboard__pad--progression-hot` to pads whose pitch class is in the
  current active chord. This is a halo/outline emphasis channel, not a fill
  color, so it can layer over degree colors.
- `MicroPiano` uses the same `activeProgressionResolution()` and
  `progressionGlow` settings for `.micropiano__key--progression-hot`, so Piano
  and Pads agree about which pitch classes belong to the active Changes chord.
- Progression glow means "current chord tones are hot", not "notes are in
  scale." In-scale identity already belongs to degree colors.
- The active step advances with playback when `progression.advance === 'strict'`,
  which is the default for any preset selected from the Changes picker.
  `progressionStepIndexForBar(progression, bar)` is the pure bar-following core:
  it loops the progression over its total length and honors each step's
  `durationBars`. `progressionTotalBars()` reports that loop length, and
  `advanceProgressionContext(progression, delta)` is the pure manual next/prev
  nudge (wraps within the step list) for a future explicit step-control UI.
  `manual` stays a valid stored mode; old saved projects stored `advance:
  'manual'` explicitly, so their active step stays frozen exactly as before.
- `main.js` subscribes to `transport.onBar` and calls `_followProgressionToBar()`,
  which updates `activeStepIndex` in place and dispatches
  `project-progression-changed` so ScaleBoard/MicroPiano glow follows. It also
  re-syncs on the transport `stopped` state so the glow returns with the
  playhead. This is glow-only: it never autosaves per bar and never touches
  playback, recording, export, or snippets.
- Do not mutate snippets to add progression data. Snippets remain portable
  note/hit/audio objects; if a progression is unavailable in an old project,
  only the future glow/context layer should be absent.

## IndexedDB And Audio Assets

`ProjectStore.js` owns persistence. The IndexedDB stores are:

- `projects`
- `versions`
- `milestones`
- `audioAssets`
- `localSettings`

Audio snippets and custom sample instruments must not store large Base64/audio
payloads directly in project JSON. Heavy bytes go in `STORE_AUDIO_ASSETS`.
Project/snippet JSON keeps `audioAssetId` plus lightweight metadata and optional
object URLs for the current session.

Important helpers:

- `saveAudioAsset(blob, meta)`
- `getAudioAssetBlob(audioAssetId)`
- `getAudioAssetObjectUrl(audioAssetId)`
- `audioSnippetToArrayBuffer(snippet)`
- `embedAudioForBackup(value)`
- `migrateSnippetsAudioAssets(value)`

Backups may embed audio as `audioDataUrl` for portability. On import, embedded
audio data should be migrated back into `audioAssets`. Do not introduce new
features that put durable audio bytes directly in `project.snippets`.

## Autosave, Backups, And Folder Backup

Use:

```js
this.store.scheduleAutoSave(this.project);
```

for ordinary edits. The debounce is intentionally short. `ProjectStore.save()`
updates edit/backup status events so the top backup pill can refresh.

Folder backup uses the File System Access API where available. Browser sessions
may lose the folder handle permission after reload; the UI must surface a grant
action instead of pretending auto-save is still protected. Manual JSON backup
remains the universal fallback.

## Audio Engine And Export Parity

Live playback and WAV export are separate engines that must stay musically
aligned:

- Live synth: `WebAudioSynth.js`
- Live drums: `SketchKit.js`
- WAV export: `WavExporter.js`
- MIDI export: `MidiExporter.js`

If a sound change is audible live, mirror it in `WavExporter` or explicitly
document why export cannot represent it.

Patch-aware synth export uses procedural rendering. Do not replace it with a
large library or OfflineAudioContext rewrite without a focused design pass.

Tone traits:

- `crush`
- `echo`
- `space`
- `wobble`
- `drive`
- `noise`

Use `normalizeSoundTraits()` before storing or applying Tone. Noise is ducked
when Drive is high to avoid static walls. Echo/Space/Wobble have parity-sensitive
math, so update live and export together.

### Procedural Drum Noise Shaping 0.1.101

SketchKit remains fully synthesized and asset-free. The noise-based drums share
a small procedural shaping layer between live playback and WAV export:

- `src/engine/DrumSynthesis.js` contains `shapedDrumNoiseSample()`,
  `drumTransientEnvelope()`, and state/profile helpers for snare, clap, hi-hat,
  cymbal, rim, and shaker.
- `SketchKit._drumNoiseBuffer()` fills Web Audio buffers with shaped procedural
  noise before the existing Biquad filters and gain envelopes. This keeps the
  existing kit presets and Tone routing intact while reducing raw white-noise
  hash.
- `WavExporter.renderNoiseHit()` uses the same helper and transient envelope so
  exported drum snippets follow the same character as live Kit playback.
- Kick and toms are unchanged in this slice; they are oscillator/body sounds and
  should get separate treatment if a future slice adds pitch/envelope punch.

Do not replace this with bundled samples without a separate licensing/storage
plan and live/export parity design.

### Kit Stage View Fix 0.1.102

Kit owns its own toolbar (`.sk-kit-selector`) because it needs kit selection,
Kit Tone, Kit AI, Controller, and Stage controls. The generic Create patch
toolbar (`#patch-selector`) is for Pads, Piano, and Labs only. Keep
`CreativeMode._syncPatchToolbarVisibility()` as the single owner of that
visibility, and call it both during initial render and instrument switches; if
Kit shows both toolbars, this is the first place to inspect.

Live Stage drum events now carry GM-ish `pitch` metadata:

```text
kick 36, snare 38, clap 39, hihat 42, toms 45/47/50, cymbal 49,
rim 37, shaker 82
```

This pitch is visual metadata for Stage Thread/Halo only. It must not change
RecordingManager drum hits, MIDI export semantics, or Kit playback. Thread no
longer forces all hit events into a tiny strip at the bottom; events without
pitch still spread by lane across the full field.

## Instruments

### Drone

`src/engine/Drone.js` is the pure note layer for the sustained tonal anchor.
`droneNotesForContext(context, settings)` returns the root MIDI note at the
chosen octave (default 3, so it anchors below the pads), plus the perfect fifth
when `addFifth` is set; it returns `[]` when disabled.
`normalizeDroneSettings()` clamps the octave to 1–6.

`CreativeMode` owns the live drone: `setDrone(enabled)` holds/releases the notes
through the shared synth, `_applyDrone()` diffs the wanted notes against the
held ones (so a key change re-pitches without clicking), and
`applyProjectMusicalContext()` re-applies it on key changes. Drone state is
runtime-only — it is never recorded, exported, or auto-started on load (audio
needs a user gesture). `TransportBar` owns the `Drone` toggle and reflects state
with `setDroneActive()`; `main.js` routes `onDroneToggle` to `setDrone()`.

### Pads / ScaleBoard

ScaleBoard reads `project.musicalContext` for root and scale. It supports:

- Single notes
- Chords
- Root mode
- Voice Sketch
- Compass
- Step Play

Pad count follows the current scale unless a mode overrides it. Extensions
continue scale degrees into the next octave for Single and normal Chords modes.
The old `custom` pad mode was removed from the UI because it only duplicated a
random-note grid without durable musical control. Any legacy `custom` pad mode
state should normalize to `single` via `normalizePadMode()` instead of throwing
or reviving the old editor.

`src/engine/PadLayout.js` owns the first modular-pad foundation. Layouts
are additive settings in `project.settings.padLayout` with relative size tokens
(`small`, `medium`, `large`, `wide`) and templates (`even` / Fit, `compact`,
`rows`, `bigTonic`, `thumb`). `recommendedPadColumns()` balances equal-size
templates so wide boards avoid orphan final rows when space allows; 13 pads
should prefer a balanced split such as 7/6 over `4/4/4/1`. Do not store pixel
coordinates. `ScaleBoard` keeps real `<button>`
pads and adds `data-size` per pad; CSS Grid uses `grid-auto-flow: dense` and
container-aware `--pad-cols` variables. Narrow/compact boards force every pad
back to 1x1 so phone portrait layouts do not become giant unusable blocks.
`project.settings.scalePadsCount` remains dormant plumbing for a future
full-custom surface and should not be deleted from user data.

Step Play is a Pads mode, not a top-level instrument. It renders a dedicated
one-trigger surface plus a saved note sequence. The editor's palette is
scale-aware, but saved sequence steps are stable MIDI notes in
`project.settings.stepPlayPattern`, not live degree formulas. Changing the
project key, scale, or Pads octave must not rewrite a saved Step Play
composition. If a saved MIDI note no longer belongs to the current scale, the UI
marks it with an `OUT` badge and still plays the original note. Each trigger
plays one single note for a short fixed gate, advances the pointer, and records
the user's timing through the normal note callbacks.

Scale definitions live in `MusicTheory.js`. They include family metadata,
intervals, degree patterns, descriptions, and optional aliases. `chromatic`
exists as a utility scale but is hidden from the normal top-bar scale picker.

### Curated Chord Pads

Do not assume every Chords-mode pad is built by stacking scale degrees. For
several non-Western or non-tertian scale colors, `ScaleBoard._getChordMidis()`
uses `src/engine/ScaleChords.js`.

`ScaleChords.js` stores root-relative semitone recipes for scales where plain
`1-3-5` stacking sounds misleading, including Hirajoshi, Hungarian Minor, Double
Harmonic, Phrygian Dominant, and related 12-TET approximations. If adding a new
scale with unusual harmony, decide whether it needs a curated recipe.

### Piano / MicroPiano

Piano is chromatic, but optional degree labels and colors read the project
musical context. Pads use classical function labels when enabled; Piano uses
compact interval shorthand because space is tight.

### SketchKit

SketchKit is a synthesized drum kit with built-in kits and shared Tone controls.
Canvas drum tracks can pick built-in kits. Drum export is procedural and separate
from live synthesis.

### Controller

Controller bindings are global in Create. A learned controller button can target
Pads, Piano notes, or Kit sounds regardless of which Create tab is visible.
LB, LT, RB, RT, and analog sticks are reserved and are not bindable as regular
buttons. Analog sticks remain continuous expression (`left stick = modulation`,
`right stick = pitch bend`). LB/LT/RB/RT are held musical modifier slots stored
in `project.settings.controllerModifierAssignments`.

Do not reintroduce Tone traits as held controller modifiers. Cutting effects in
and out during a single recording encourages ugly audio and creates misleading
MIDI exports, because MIDI cannot represent Notenotes Tone. Users can still
record separate snippets with different Tone settings when they want contrast.

Current controller modifiers are note/chord transforms: octave down/up, Triad,
7th, Sus2, Sus4, Power, Add 9, 9th, 11th, and 13th. Diatonic modifiers stack
through the current project scale when the struck note exists in that scale;
if the root is chromatic/out-of-scale, they fall back to interval recipes so
exact Piano bindings remain playable instead of failing.

Controller modifier slots use compact buttons plus `ChoicePicker`, not native
select menus. The option list is long enough that native dropdowns become ugly
and hard to scan on mobile. Modifier recipes and picker groups live in the pure
`src/engine/ControllerModifiers.js` helper so smoke tests can verify that
Tone/effect modifiers remain absent without importing DOM/CSS UI code.

Bindings store target kind/mode details, not only a MIDI number, so Pads bindings
can remember Single/Chord/Root behavior. If a bound target no longer exists
because the scale/pad layout changed, fail gracefully with a toast rather than
silently triggering the wrong thing.

### AI Seed

AI Seed is an instrument-like helper. It may generate snippet events through the
sequence tool, but it must not change project structure such as tempo, meter,
scale, key, instrument selection, or settings. Credentials are memory-only and
must not be written into backups or IndexedDB.

## Pickers And Large Lists

Native `<select>` remains fine for short mechanical controls. Large or growing
creative libraries should use `src/ui/ChoicePicker.js`.

Current intended picker targets:

- Scale picker: implemented through `ChoicePicker`.
- Patch/instrument picker: implemented for Create mode synth patches. Built-in
  Chip and Modern patches plus Custom patch instruments use the shared picker;
  Kit keeps its own Create-mode kit selector because four built-in kits are still
  a small native list, but Canvas track instruments use the picker for MIDI and
  drum tracks so custom instruments do not create long lane dropdowns.
- Tone preset picker: implemented for Create synth Tone, Kit Tone, and Canvas
  Apply-to-Clip. Saved Tone presets still live in
  `project.settings.tonePresets`; the picker only changes selection UI.
- Tone badges: `src/ui/ToneBadges.js` is the shared renderer for the compact
  two-letter Tone markers (`CR`, `EC`, `SP`, `WB`, `DR`, `NO`). It is used by
  Canvas clips, the snippet tray, and Inspect. Do not cap the list unless the
  visual language changes; users need to see all six active traits when a
  recorded or clip-level Tone stack uses them.

ChoicePicker is category-first, searchable, mobile-friendly, and DOM-native. It
closes by outside-click, Escape, or selecting an item; do not add visible close
buttons unless the rest of the app's modal language changes. Do not build another
one-off long dropdown for creative libraries.

## Accessibility Profiles

Accessibility input helpers live in `src/ui/AccessibilityProfiles.js` and are
stored at `project.settings.accessibility`. Keep this modular: new accessibility
helpers should normalize through this module, expose controls in the Settings
panel's Accessibility tab, and avoid scattering one-off flags across instruments.

Current helpers:

- Tremor Filter: ignores repeated triggers of the same target within
  `thresholdMs`. Pads, Piano, and Kit call `tremorAllows(project, targetKey)`
  before pointer or dwell-triggered playback. It filters same-target bounce
  without blocking intentional movement across different targets.
- Dwell Play: lets large playable targets fire after hover/aim dwell. Pads and
  Piano hold the note while the pointer remains over the target after the dwell
  completes; Kit fires the drum sound once. The visual dwell fill is CSS-driven
  via `.is-dwelling` and `--dwell-ms`.

URL profiles are applied in `main.js` after project load. `?tremor=1` enables
Tremor Filter, and `?dwell=1` enables Dwell Play, then the normalized settings
are saved. This is intentionally not a separate build; a helper link can make
Notenotes playable before a user has to navigate Settings.

### Degree Color Palettes

`src/engine/DegreePalettes.js` is the single source of degree-color truth (keyed
by chromatic interval 0..11). It is pure data + helpers with no other engine
imports, so `MusicTheory.js` imports it (not the reverse) and
`DEFAULT_DEGREE_COLORS` is `degreeColorsForPalette('default')`.

- Palettes: `default` (vivid rainbow), `cbSafe` (Okabe-Ito/Tol CVD-safe), and
  `viridis` (a monotonic-lightness ramp, orderable for any color vision).
- `normalizeDegreeHighlighting()` stores a `palette` id and uses that palette as
  the base `colors`, with explicit per-degree overrides layered on top.
- The Layout degree panel (`CreateLayoutPopover`) has a Palette `<select>`.
  Choosing a palette writes its colors into `degreeHighlighting.colors` (and
  records the id), so the swatch pickers can still tweak individual degrees
  afterward. ScaleBoard/MicroPiano read `colors` exactly as before — no consumer
  changes were needed.
- `relativeLuminance()` / `contrastRatio()` are WCAG helpers used to keep the
  ramp honest (guarded by a smoke test asserting viridis luminance increases).

Step Play now lives in the Pads mode dropdown. It gives switch-style users a
large single trigger while still working for keyboard and MIDI input. Any
performance key or MIDI note-on advances the sequence; keyup/note-off do not
release because Step Play uses its own short note gate. Text editing is kept in
the Step Play editor modal so the main performance surface can claim keyboard
input without accidentally typing into a field.

## Keyboard And MIDI Input

Create-mode performance input is surface-routed. The active Create surface owns
the input meaning:

- Computer keyboard uses `PERFORMANCE_KEYS` from `src/ui/PerformanceKeys.js`:
  `1-=`, `Q-]`, `A-'`, `Z-/`. Pads map forward so `1` triggers pad 1, `2`
  triggers pad 2, and `Q` continues after the number row for extended layouts.
  Piano reverse-maps the same list so `1` is the highest visible note and later
  keys move downward, which feels closer to a small computer-keyboard piano. Kit
  maps forward through visible drum pads because drums are not pitch-ordered. Kit
  pads display the matching `PERFORMANCE_KEY_LABELS` value so the playable
  shortcut is visible on the only pad surface that is not pitch-numbered.
- Global digit modulation shortcuts must yield when the active Create surface
  can play that key. `main.js` asks `creativeMode.handlesPerformanceKey(code)`
  before starting pitch/mod ramps.
- Global single-key transport shortcuts are intentionally narrow. Space toggles
  play/pause and Enter stops, but `M` and `R` are not global metronome/record
  commands because they are part of `PERFORMANCE_KEYS` and must be safe to hold
  while playing Piano, Pads, Kit, or Step Play. Record/metronome remain available
  through the visible transport controls.
- Web MIDI input is requested when Creative audio initializes. Incoming MIDI is
  routed to the active Create surface: Pads map the MIDI note to the nearest
  visible pad and then play the current Pad Mode action, Piano plays the exact
  MIDI note, and Kit prefers General MIDI drum notes with a visible-pad fallback.
  In Step Play mode, any MIDI note-on advances the Step sequence and note-off is
  ignored.
- `project.musicalContext.correction` is the optional top-bar Piano/MIDI note
  correction mode. It is additive and defaults to `off`. `off` preserves current
  chromatic Micro Piano behavior. `closest`, `up`, and `down` only affect Micro
  Piano pointer/QWERTY input and external Web MIDI routed to Piano; Pads remain
  scale-locked through their own pad logic, Kit remains drum-mapped, and learned
  controller MIDI bindings stay exact. `correctMidiToScale()` in
  `MusicTheory.js` is the pure helper: in-scale notes pass unchanged, chromatic
  scale passes unchanged, and `closest` resolves equal-distance ties upward.

Keep computer-keyboard, MIDI, and controller routing conceptually aligned: the
active surface decides what the input does. If the performance key layout ever
changes, update `PerformanceKeys.js` instead of duplicating labels in individual
instruments.

`src/modes/input/PerformanceInputRouter.js` owns the Create-mode keyboard,
Web MIDI, and gamepad listener wiring. `CreativeMode` still owns instruments,
recording state, controller binding storage, snippets, AI, and project
persistence. Keep that boundary: route raw performance input in the router, but
do not let the router mutate project data or render controller/settings UI.

`src/ui/ControllerMapperPopover.js` owns the Controller Mapper popover view
state, learn/list screens, preset list controls, and pure controller binding
label/normalization helpers. It receives explicit getters/setters from
`CreativeMode`; it should not know about project save mechanics, recording, or
instrument construction. `CreativeMode` remains the adapter that schedules saves
and refreshes `ControllerMode` after bindings change.

The old top-level `Ctrl` tab is now labeled `Labs`. Labs renders a focused
`ControllerMode` panel that, in this slice, only shows the four held modifier
slots (`LB`, `LT`, `RB`, `RT`) and the active modifier help/status lines. The
old Pad Mode selector, Octave buttons, fallback scale list, custom bindings
list, preset list, and controller artwork were removed because they duplicated
surfaces the user can already reach through the `Controller` popover. The
Create toolbar `Controller` button remains the global Controller Mapper entry
point for learning/clearing bindings, loading/saving/deleting presets, and
seeing the live gamepad connection status. Do not bury the mapper inside Labs
unless product direction changes.

### Controller button availability (Create mode)

The Create toolbar `Controller` button (`ControllerMapperPopover`) is the
single entry point for gamepad binding and preset management. It must be
reachable from every Create surface except `Mic`:

- **Pads, Piano, Labs** — exposed by the global `.patch-selector` toolbar,
  guarded by `CreativeMode._syncPatchToolbarVisibility()` so it shows only on
  those three instruments. Pads has an additional
  `_syncControllerMapperButtonVisibility()` guard that hides the button while
  `scaleBoard.padMode === 'voices'` because the Voice Sketch instrument does
  not consume gamepad bindings.
- **Kit** — exposed by the Kit-owned `.sk-kit-selector` toolbar
  (`#sk-controller-map-button`) alongside kit picker, Create/Edit, Delete,
  Tone, AI, and Stage. The Kit toolbar is always shown when Kit is active.
- **Mic** — no Controller button. The Mic surface records user audio and does
  not consume gamepad bindings, so the mapper is intentionally hidden here.
  Mic also has no `.patch-selector` or `.sk-kit-selector` toolbar of its own.
- **Canvas and Inspect** — outside the Create mode toolbar model. They do not
  consume gamepad bindings; the global gamepad poll still fires so any
  learned modifier slot still affects the next time Create is opened.

If a future Create surface needs the mapper, add it to the relevant toolbar
and extend `_syncPatchToolbarVisibility()` (or its surface-specific
equivalent) instead of opening a new entry point.

`src/ui/CreateLayoutPopover.js` owns the Create toolbar Layout popover for Pads
and Piano. Pads now expose a `Pad template` selector backed by
`project.settings.padLayout`; the old custom pad-count slider is hidden because
the old Custom mode is retired. Piano still exposes piano count/key sliders, and
both Pads/Piano expose degree-color and chord-tone glow controls. The popover
receives explicit callbacks from `CreativeMode` for project access, autosave
scheduling, and event dispatch; it may update `project.settings.padLayout`,
`pianoCount`, `pianoKeys`, `degreeHighlighting`, and `progressionGlow`, but it
must not construct instruments, change the active surface, or own persistence.
Keep shared clamp/layout helpers pure so `tests/smoke.mjs` can guard supported
ranges without a DOM.

Settings drawer layout stability matters because Save/backup status text
updates asynchronously after the panel opens. `src/ui/settings.css` reserves a
stable scrollbar gutter on `.settings-panel__body` and minimum widths for
dynamic `.settings-value` cells so storage and backup status updates do not make
the text column shift while checks resolve.

`src/ui/CreateInstrumentPopover.js` owns the Create/Edit Instrument popover DOM,
including the existing-instrument selector, file/snippet source fields, root
note options, Patch/Kit visibility toggles, and brightness/gain live labels.
`CreativeMode` still owns the actual save operation, audio asset persistence,
custom instrument list mutation, patch/kit selection, and all toasts. Keep that
division intact: the popover gathers form input and calls `onSave(popover)`,
while CreativeMode decides what the form means for project data.

## Stage / Performance Visual Foundation

Stage is the full-screen visual performance layer for live Create input and
Canvas playback. Keep it renderer-agnostic. The current shipped surface uses a
Canvas 2D renderer for footprint/mobile safety, but the event/model contract is
kept separate so a later Three.js renderer can replace the drawing layer without
moving musical input or transport logic.

- `src/stage/StageEventStream.js` is a small pub/sub stream for live visual
  events. `beginNote()` emits a note start and stores the active line,
  `endNote()` completes it with `durationTick`, `hit()` emits drum/instant
  events, and `activeEvents()` returns cloned active events. This stream is
  intentionally independent of `RecordingManager` so Stage can visualize play
  while idle, armed, or actively recording.
- `src/stage/StageModel.js` holds pure visual-model helpers. Canvas and live
  Stage have separate limits: `STAGE_CANVAS_TRACK_LIMIT` is 20 audible Canvas
  tracks, while `STAGE_LIVE_LANE_LIMIT` is 64 live Create lanes so maximum Piano
  layouts do not alias two playable keys into the same visual lane. The legacy
  `STAGE_TRACK_LIMIT` export aliases the Canvas limit for older helper callers.
  `stageTracksForCanvas()` filters muted tracks, honors solo, caps lanes, and
  preserves track color/type, while `stageIntensityForUnits()` maps contextual
  length units into `spark`, `solid`, `bright`, and `sustain` tiers.
  `stageEventsForCanvasTracks()` maps Canvas clips into absolute tick events per
  lane. MIDI notes keep their pitch labels, drum hits become short lane events,
  and audio clips become sustained blocks so Canvas Stage does not silently omit
  recordings. Events also carry `subLane` and `subLaneCount`; MIDI tracks get
  stable pitch sublanes sorted low-to-high, drum tracks get stable hit sublanes,
  and audio clips get their own block lane. This is what lets Canvas Stage show
  what is happening inside a track instead of only showing that the track exists.
  Future Free mode can feed seconds as units; metered mode can feed pulse/beat
  units.
- `src/stage/CanvasStageRenderer.js` owns the current visual layer. It renders a
  fixed full-screen overlay with a design-language-friendly Close Stage button,
  not a corner X. It reads `src/stage/StageViews.js` for the mode-safe view list
  and persists the chosen view in `localStorage` per Stage mode. In `live` mode
  the default `trace` view renders the Create performance highway, `thread`
  renders pitch-contour ribbons where sustain is literal line length and chords
  appear as parallel strands, `pulse` renders radial lane energy for recent
  rhythm/velocity hits, `halo` renders circle-of-fifths pitch-class energy so
  chords bloom as connected tones, and `pocket` renders a groove-clock view
  where one revolution equals the current Stage timing unit. Live Stage keeps a
  longer recent-event tail than the first Stage slice so Thread phrases can
  travel across the full field instead of disappearing around mid-screen. The
  Stage view selector is a native
  `<select>` for footprint/accessibility, but its closed control and option rows
  are explicitly dark-styled because platform defaults can otherwise render a
  white popup against the black Stage chrome. Live mode also has previous/next
  arrow buttons and left/right swipe on the canvas field. Those controls must use
  `stageViewNeighbor()` so navigation wraps within the current mode and never
  exposes live-only views in Canvas Stage. All live views subscribe to
  `StageEventStream` so idle playing, armed recording, and active recording
  visualize the same way. In `canvas` mode it switches to a horizontal track map
  rather than the highway:
  each audible Canvas track is a row, internal sublanes show individual notes or
  drum sounds, audio clips render as sustained blocks, and a vertical playhead
  anchors the motion. Keep this split unless a later Three.js renderer can show
  dense Canvas detail without turning into track-level visual noise.
- `src/stage/StagePocketModel.js` owns Pocket's pure clock math.
  `pocketEventPhase(event, { nowTick, unitTicks })` maps an event start into
  the current Stage unit from `0..1`, wrapping safely for old/recent events.
  `pocketActiveSpan(event, { currentMs, unitMs })` maps a held or recently
  released note into an arc length, using the real Stage unit duration supplied
  by `CreativeMode`/`CanvasMode` (`unitTicks * transport.secondsPerTick`).
  Held notes must visibly grow around the clock while the user holds them;
  fixed fallback slivers make Pocket read as broken. `pocketLaneAngle()` exists
  for stable lane-angle math and smoke coverage. The renderer uses these helpers
  so Pocket remains a visual guide only: it does not quantize, score, or mutate
  notes. If a future slice adds early/late judgment, keep that as a separate
  visual layer and never feed it back into playback.
- `src/stage/StageRenderQuality.js` is the pure render-budget helper for Stage.
  It never touches audio or transport. `stageRenderQuality()` takes event count,
  lane count, and `prefers-reduced-motion`, then returns a detail tier plus
  shadow/trail scales. `CanvasStageRenderer` uses it to reduce expensive
  `shadowBlur`, shorten live trails under load, and skip nonessential decorative
  detail in minimal mode. This is the required guardrail before adding more
  Stage views: dense scenes should degrade glow/detail first, not input/audio.
  Smoke tests cover this helper because it is pure logic and should stay
  independent of Canvas DOM APIs.
- `CanvasStageRenderer` caches stable background/field gradients per
  canvas-size/mode/view. Do not cache per-event gradients unless the key includes
  the changing color/position data; note shapes are intentionally still created
  per draw because their geometry and colors are event-specific.
- `stageEventsForCanvasTracks()` must support both historical/manual note fields
  (`midi`, `durationTicks`) and the current recording/export schema
  (`pitch`, `durationTick`). If Canvas Stage shows `undefined` labels, this is
  the first place to check. Labels should be derived from the resolved pitch,
  not from one schema spelling.
- Live Stage has a touch input strip rendered by `CanvasStageRenderer` in
  `live` mode. `CreativeMode` supplies lane labels/colors and maps strip
  pointer events back to the active surface (`ScaleBoard.pressPad/releasePad`,
  `MicroPiano.pressVisibleKey/releaseVisibleKey`, or `SketchKit.triggerVisiblePad`).
  This is required because the full-screen Stage overlay covers the underlying
  pads on mobile; do not remove it unless another mobile input surface replaces
  it. Kit input-strip labels are deliberately shortened (`HAT`, `TOM M`, `CYM`,
  etc.) and CSS-truncated on narrow screens so drum names do not wrap into each
  other.
- `CreativeMode` owns Create Stage wiring. Scale/Piano/Controller note callbacks
  now emit Stage note start/end events before they pass through the existing
  recording manager; Sketch Kit hit callbacks emit Stage hit events before drum
  recording capture. This does not change recording ownership. Stage only sees
  mirrored event data.
- `CanvasMode` owns Canvas Stage wiring. The Canvas toolbar has a Stage button
  that opens a bird's-eye track overlay. The renderer reads `project.tracks`,
  track mute/solo/color state, `transport.ticksPerBar`, and
  `transport.currentTick`; it does not mutate clips and does not drive playback.
- Create Stage opens from the Stage toolbar button in Pads, Piano, Labs, and
  Kit. Labs is the renamed home for the old Controller screen; it is not the
  Controller Mapper popover.
- Do not let Stage drive audio. Stage renderers may read transport time and
  consume events, but audio remains scheduled by existing Web Audio/Transport
  paths. If Three.js is added, it should sit behind the same Stage event/model
  API rather than replacing the musical routing.

Mobile toolbar panels: Create toolbar controls (`Tone`, `Controller`, `Layout`,
`Create/Edit Instrument`, and AI Seed) are desktop popovers but become fixed
viewport modals under 700px wide. The mobile CSS lives in
`src/instruments/instruments.css` for `.tone-popover` descendants and
`src/ui/AISeedPanel.css` for `.ai-seed-popover`. This avoids the iOS failure
mode where an anchored popover inside the horizontally scrolling Create toolbar
pushes the page or renders outside the visible viewport.

The Create toolbar itself also switches from loose flex wrapping to an explicit
grid under 700px. Keep `Patch` label + picker on the first row and action
buttons on compact follow-up rows. This is intentional: flex wrapping allowed a
single action such as Tone to balloon across the screen while adjacent actions
were clipped on iPhone-width layouts. Pads also use denser mobile row heights
and contained scrolling so 13-pad Extensions layouts can be reached without the
snippets tray covering the final row.

## AI Seed Boundaries

AI Seed is intentionally narrow. `AIController` builds a snippet through the
validated sequence contract only; it must not change project key, scale, meter,
tempo, instrument definitions, backups, or transport state. Provider API keys
remain live-only in `aiSettings.js` and must never be written to IndexedDB,
project JSON, backups, or logs. Non-secret settings, including provider/model
selection and default length in bars, live in `project.settings.aiSettings` and
must be saved when changed.

`src/ai/AIInstrumentContext.js` is the pure mapping layer between Create-mode
surfaces and the smaller AI instrument vocabulary. Controller maps to
`scaleboard`, Piano maps to `piano`, Kit maps to `kit`, and Mic intentionally
falls back to `scaleboard` because AI Seed does not generate audio recordings.
`src/ui/AISeedPopover.js` owns popover open/close/click-outside behavior around
`AISeedPanel`; `CreativeMode` remains responsible for adding seeded snippets to
the project and scheduling saves.

`referencedSnippet` plumbing exists in the AI prompt/controller layer, but there
is no current user-facing UI that supplies it. Treat it as dormant/deferred
context support, not an active feature. If a future UI exposes it, document the
calling surface and keep the user in control of which snippet is referenced.

## Storage Health Audit

`ProjectStore.auditProjectAudioAssets(project, storedAssets)` is a pure,
non-mutating audit helper. The instance method `getAudioStorageAudit(project)`
feeds it real `audioAssets` records from IndexedDB. The Settings Save tab uses
this to report:

- audio snippets and custom instrument samples that reference stored audio;
- referenced audio assets missing from browser storage;
- snippets already marked unavailable;
- orphaned stored audio assets and their estimated byte cost;
- whether the current workspace is ready for a complete audio-bearing backup.

The audit is diagnostic by default. Do not delete, repair, or rewrite assets
from the health check unless a separate explicit user action is added.

## Smoke Tests

`npm run test:smoke` runs `tests/smoke.mjs` with Node and no extra test
dependency. Keep this harness focused on pure module logic that does not need a
browser, IndexedDB, Web Audio, or DOM rendering. It currently guards meter math,
backup validation, AI settings persistence helpers, AI instrument-context
mapping, controller binding helper normalization, and the pure audio storage
audit. Browser-only behavior still belongs in Manual QA until a browser test
harness exists.

## Mobile Create Layout Hardening 0.1.54

Create mode gained a first responsive hardening pass for iPhone-sized screens:

- `TransportBar` renders a mobile-only BPM button next to the desktop number
  input. On narrow screens CSS hides the input and shows the button. Pressing it
  opens a small modal with numeric entry, `-10`, `-1`, `+1`, `+10`, Cancel, and
  Save. `TransportBar.onBpmChange` lets `main.js` persist the chosen BPM back to
  `project.bpm`.
- `SnippetTray` has a collapsed state. It defaults collapsed on `max-width:
  700px`, the header is a real button with `aria-expanded`, and collapse only
  hides the list. It never removes snippets.
- Create's instrument tab row and patch/action toolbar use `_bindToolbarTap()`
  so controls activate on pointer-up only if the pointer did not move more than
  10px. This keeps horizontal dragging from immediately opening Pads, AI,
  Controller, Layout, or other toolbar actions.
- Mobile CSS turns the instrument switcher into a horizontal, touch-scrollable
  row and makes the patch selector a two-row grid: label + high-priority patch
  picker first, action buttons second. This is deliberately a layout pass only;
  it does not change instrument, Tone, AI, or controller behavior.

Future mobile work should still test on real iPhone Chrome/Safari. The current
pass makes controls reachable and less hostile to touch, but browser chrome,
safe-area height, and drag-and-drop still need device QA.

## Mobile Create Layout Refinement 0.1.95

The Create mobile grid was tightened again after iPhone 15 QA showed the Patch
picker and toolbar actions still competing for width and height:

- Under 700px, `.patch-selector` is now a six-column grid. The Patch label is
  visually hidden on mobile and the searchable Patch picker occupies the full
  first row. Create/Edit spans three columns, Delete/Tone/AI use compact single
  cells, and Controller/Layout/Stage occupy the second action row. This keeps
  Patch readable without letting Tone or Layout balloon into oversized blocks.
- The instrument switcher tabs use smaller phone-width minimums so the active
  instrument row consumes less vertical space before the pads.
- Pads controls now use a mobile two-row structure: Pad Mode gets the readable
  first row, while octave and Extensions share the next row. This avoids the
  earlier state where Extensions could sit alone as a large row and push the pad
  grid down.
- Keyboard hint labels remain hidden on mobile. They are useful on desktop, but
  on phones they reduce the available note area while offering no touch value.

This is CSS-only responsive hardening. It does not change Pad Mode, Patch,
Tone, Controller, AI, Stage, BPM, snippet, or audio behavior.

## Rhythm Fit / Always-In-Time 0.1.96

Inspect gained a first "always-in-time" assist for MIDI and drum snippets. The
goal is the timing twin of always-in-scale: keep the user's notes, drum sounds,
order, count, velocity, and Tone metadata, but help their timing land inside a
clean musical length.

Core module:

- `src/engine/RhythmFit.js` exports `fitRhythmEvents()`,
  `RHYTHM_FIT_MODES`, `RHYTHM_FIT_TARGETS`, and `RHYTHM_FIT_GRIDS`.
- `fitRhythmEvents(events, options)` is pure and non-mutating. It sorts events
  by `startTick` while preserving stable order for ties, then returns cloned
  events plus `durationTicks`.
- Feel mode maps the first onset to `0` and the last onset to
  `targetTicks - tailTicks`, where `tailTicks` is the selected grid or a small
  fallback. This is intentional: fitting to one bar should not place the final
  onset exactly on the next bar and then silently grow the snippet.
- The strength slider blends each proportional-fit onset toward its nearest
  grid position: `lerp(proportional, snapped, strength)`. Strength `0` keeps the
  user's relative timing after resizing; strength `1` lands fully on the grid.
- Even mode is separate from the slider. It spaces events by
  `targetTicks / eventCount`, keeping count and order but ignoring source
  timing. This is the maximum-assist path for users who can choose notes but
  cannot reliably tap rhythm.
- `quantizeDurations` only affects events with `durationTick` (MIDI notes). Drum
  hits remain instant events. When duration fitting is enabled, note lengths are
  scaled and capped to the next onset; the final note gets a playable grid-sized
  tail.

Inspect UI:

- `EditMode` adds a `Fit Rhythm` button for MIDI and drum snippets only. Audio
  snippets are deliberately excluded; audio onset detection is a separate,
  harder feature and should not be faked.
- The modal offers target length (`1 bar`, `2 bars`, `4 bars` using the current
  transport/meter `ticksPerBar`), grid (`1/4`, `1/8`, `1/16`, `1/8 triplet`), a
  Keep-my-feel to Make-it-clean slider, `Even spacing`, and `Fit note lengths`.
- Preview temporarily applies the fitted events to the loaded snippet and
  re-renders Inspect. Cancel restores the original in-memory state without
  writing an undo entry. Apply recomputes from the original state, commits the
  fitted events, pushes one undo entry, schedules autosave, and dispatches the
  normal `project-snippets-changed` event.
- Do not route this through `EditMode._onEdit()`. `_onEdit()` auto-expands
  snippet duration based on the maximum event end plus an extra beat, which is
  right for free piano-roll edits but wrong for a tool whose point is an exact
  target length.

Future hooks:

- Step Play can use this as the rhythm-completion half of the accessibility
  story: Step Play chooses stable pitches, Fit Rhythm places them cleanly in
  time after recording.
- Tremor filtering already prevents rapid duplicate triggers at input time.
  A later Rhythm Fit pass could add an explicit "merge accidental doubles"
  preprocessing option, but v1 keeps count immutable.
- Audio support should wait for real onset detection and preview. Do not apply
  MIDI/drum onset math to waveforms.

## Step Play Stable Notes 0.1.52

Step Play pattern storage moved from "degree formulas that re-resolve every time
the musical context changes" to "fixed MIDI notes picked from a scale-aware
palette." The important details:

- `project.settings.stepPlayPattern` entries now normalize to
  `{ midi, degree? }` plus optional `{ alternateMidi, alternateDegree? }`.
- `degree` and `alternateDegree` are source metadata for labels/history. They
  are not the playback source once `midi` / `alternateMidi` exists.
- Legacy `stepPlayPattern` entries without `midi`, and legacy
  `stepPlaySequence` strings, are upgraded once by `_upgradeStepPlayPattern()`
  using the current key/scale/octave at project load. After that, changing
  key/scale/octave does not move those notes.
- The editor palette still uses `_stepLabel(degree)` so users can keep picking
  by scale degree for legacy/default conversion. The live editor palette itself
  uses absolute octave rows from 1 through 6 and appends `{ degree, midi }` from
  the clicked note button; setting an alternate writes `{ alternateDegree,
  alternateMidi }`.
- Playback in `triggerStepPlay()` reads `entry.midi` or `entry.alternateMidi`
  directly. Do not reintroduce `_midiForStepDegree()` in the playback path.
- Step chips render by sequence order (`1`, `2`, `3`, ...), not by scale degree,
  because saved notes may be out of current degree order after musical-context
  changes.
- `_degreeMetaForMidi(midi, { includeOutOfScale: true })` is used to detect
  whether a saved MIDI note belongs to the current key/scale. Out-of-scale notes
  render with the red `OUT` badge and black badge outline but remain playable.

Keep this distinction clear in future work: the palette is scale-aware; the
composition is note-stable.

## Step Play Editor Octave Clamp 0.1.53

The 0.1.52 stable-note change exposed an older editor-range bug: the Step Play
editor treated its arrow buttons as unbounded degree-page offsets and allowed
pages like D11-C#12. That range is outside the rest of Notenotes and makes saved
Step Play sequences feel broken.

The editor palette now uses an independent absolute octave row:

- `STEP_PLAY_DEFAULT_OCTAVE = 4`
- `STEP_PLAY_MIN_OCTAVE = 1`
- `STEP_PLAY_MAX_OCTAVE = 6`

`_stepEditorOctave` is now the actual octave shown by the palette. The left and
right arrow buttons clamp to octaves 1-6. `_renderStepEditorNotes()` calls
`getScaleNotes(scaleName, rootNote, this._stepEditorOctave, degreeCount)` and
puts the resolved MIDI note on `data-midi`. Clicking a note button appends
`_entryForStepMidi(button.dataset.midi, degree)`.

Legacy/default degree conversion still uses `_midiForStepDegree()`, but that
helper now starts from `STEP_PLAY_DEFAULT_OCTAVE` instead of `this.octave`, so
Step Play no longer inherits whatever octave the user last selected in another
Pads mode. Do not make Step Play palette range depend on global Pads octave
again; Step Play is its own composition surface.

## Canvas

Canvas stores clips on tracks with absolute tick positions. Meter changes should
preserve musical/time placement intentionally; do not casually reinterpret clip
positions by a different bar length.

Audio clips are time-based but represented on the tick timeline for Canvas
placement. Audio clips use `audioPeaks` when available so visual previews show
actual sound activity rather than placeholder lines.

MIDI clips may carry recorded patch identity. Dropping a recorded MIDI clip onto
a MIDI track may update the track instrument to match the recorded patch, after
which the user can change the track instrument.

## Inspect

Inspect edits MIDI, drum, and audio snippets. MIDI and drum Inspect share the
toolbar/ruler design language. Disabled mode-inappropriate actions should look
disabled or explain themselves with a toast; do not make controls silently fail.

Drum hits draw as blocks in the grid. Split view is for MIDI and should be
disabled clearly for drums.

Inspect timeline display is intentionally separate from persisted snippet
duration. `src/engine/SnippetTiming.js` owns this display-only math:

- `snippetContentEndTick(snippet, fallbackEventTicks)` finds the last visible
  note/hit end. Drum hits do not store duration, so the current edit grid size
  is used as their visual width.
- `inspectDisplayDurationTicks(snippet, { ticksPerBar, gridTicks })` returns the
  ruler/grid span. It floors at one current-meter bar, then grows to the larger
  of stored `durationTicks` or actual content end, snapping up to the edit grid.

Do not reintroduce the old four-bar Inspect floor. It made short snippets and
Rhythm Fit results look like they contained late empty notes, especially in
non-4/4 meters. This helper only controls how much grid Inspect draws; it must
not mutate snippet timing.

## Exports

- WAV export should render Notenotes-specific sound and Tone where supported.
- MIDI export preserves notes/hits/timing and standard meter/tempo metadata, not
  Notenotes-specific Tone.
- ABC/sheet export is notation-oriented and does not support audio snippets.
- Free mode is not exposed yet; if it is added later, sheet/ABC export needs a
  clear disabled state.

`ABCConverter` should read meter via helpers and emit normal time signatures for
metered projects/snippets. Avoid old `timeSignature.beats` assumptions.

## Diagnostics

Diagnostics are developer-only and gated by `?debug=1` or explicit localStorage
debug state. Do not expose diagnostics as ordinary user UI.

The Diagnostics panel separates:

- meter helper math checks
- live runtime tempo measurement

Math checks are useful but not a substitute for runtime scheduler checks.

## Documentation Policy

Keep this file current. Remove stale architecture claims when the implementation
changes. `README.md` should be updated when user-visible behavior changes and
should keep the author's direct, non-corporate voice.

## Current Boundaries / Do Not Accidentally Add

- No arbitrary custom meter box. Add curated meters only when Canvas, Transport,
  metronome, export, and QA can represent them honestly.
- No real microtonal mode by slipping fractional intervals into existing scales.
  A true microtonal Pads mode needs a separate design for labels, controller
  bindings, AI schema, MIDI export policy, and ABC/sheet behavior.
- No runtime CDNs.
- No storing API keys in project data, backups, or IndexedDB.
- No large bundled sample libraries without a bundle/licensing design pass.

## Step Play And Kit Key Labels 0.1.48

This release makes two Create-mode performance-input changes.

- `src/ui/PerformanceKeys.js` is now the shared source of truth for computer keyboard performance codes and display labels. `CreativeMode` imports `PERFORMANCE_KEYS` for routing, and `SketchKit` imports `performanceKeyLabel()` so drum pads can show the key that triggers each visible pad. Keep future keyboard-label UI wired to this module instead of duplicating the layout.
- Kit keyboard mapping remains forward through visible drum pads. The label is visual/accessibility context only; it does not change `SketchKit.triggerVisiblePad()` or GM drum-note MIDI routing.
- ScaleBoard gained `padMode === 'step'`. The renderer replaces the normal pad grid with a Step Play surface: one large trigger, a chip list for the active sequence, Edit Sequence, and Reset. Current storage lives in `project.settings.stepPlayPattern`; older `stepPlaySequence` strings are legacy import/migration input.
- Step Play sanitizes by normalizing saved MIDI notes and legacy degree entries. If the saved sequence is empty or invalid, playback falls back to the current scale's first octave. Saved MIDI notes stay stable across key/scale/octave changes.
- Step Play always plays single notes for now. It uses a short fixed gate and releases the previous step before firing the next one, so one switch/key/MIDI note-on can advance the phrase while recording captures the user's rhythm through the normal note callbacks.
- Creative keyboard routing treats any performance key as a Step Play trigger while Pads are in Step Play mode. Web MIDI note-on does the same; note-off is ignored because Step Play is not a held-note surface. Pointer clicks on the Step button use the same `triggerStepPlay()` path.

## Step Play Editor 0.1.49

Step Play was tightened after QA showed that the inline sequence input stole
computer-keyboard performance events. The main Step Play surface is now play
first: it contains the Step trigger, wrapping sequence chips, Reset, and an Edit
Sequence button. The Pad octave controls are hidden in Step Play mode because
the editor palette, not the global Pads octave controls, chooses which notes get
saved into the Step Play composition.

The editor is a modal with no visible X button, matching the app's newer picker
language. It offers a row of scale-degree note buttons plus left/right arrows to
move that row through higher scale octaves. Tapping a note appends that degree to
the editor sequence; sequence chips inside the modal can remove individual
steps. Current Save writes stable MIDI note entries to
`project.settings.stepPlayPattern` and keeps `stepPlaySequence` only as a legacy
mirror.

Historical note: 0.1.49 introduced degree continuation in the palette, where
pentatonic `6` resolves to the next octave's first scale note and major `8`
resolves to the next octave tonic. As of 0.1.52 this degree continuation remains
the picker behavior only. Once picked, a step stores the resolved MIDI note so
later key/scale/octave changes do not rewrite the composition.

## Step Play Chip Editor And Alternates 0.1.50

Step Play no longer exposes a manual text input in the editor. The modal keeps an in-memory `this._stepEditorSequence` array while open, renders each step as a removable chip, and only writes project settings when Save is clicked. This fixes the earlier state bug where editing the text field and then clicking note pills could rebuild the chip list from stale text.

Persistence is now additive:

- `project.settings.stepPlayPattern` is the richer source of truth when present. As of 0.1.52 it normalizes to `{ midi, degree? }` plus optional `{ alternateMidi, alternateDegree? }`.
- `project.settings.stepPlaySequence` is still written as a plain legacy mirror for backward compatibility and simple inspection.
- Old projects that only have `stepPlaySequence` are still parsed by `_entriesFromDegreeString()`.

Alternate-step behavior is deliberately small: one optional alternate per sequence step. During playback, `_stepLoopIndex` starts at `0`; even-numbered passes play `midi`, odd-numbered passes play `alternateMidi` when present, then return to the primary note on the next pass. This gives first-pass/second-pass variation without introducing a full pattern language yet.

Editor interaction rules:

- Clicking a note in the available-note row appends a new primary `{ degree, midi }` step unless an Alt target is active.
- Clicking a sequence chip removes that step.
- Clicking a chip's Alt button arms that chip; the next available-note click sets or replaces its `alternateDegree` and `alternateMidi`.
- Clear removes the in-modal sequence only; saving an empty sequence falls back to the current scale's first octave through `_persistStepEntries()`.

## Step Play Degree Colors And Safer Editor 0.1.51

Step Play now participates in the shared degree-color system. The main Step Play
chips, the editor's available-note buttons, and the editor's sequence chips all
call `ScaleBoard._degreeMetaForMidi(midi)` and apply `--degree-color` /
`--degree-intensity` CSS variables when `degreeHighlighting.enabled` is true.
This keeps Step Play visually aligned with Pads and Piano instead of becoming a
separate uncolored sequence surface.

Editor safety rules changed after mobile QA showed accidental outside taps could
discard in-progress work. The Step Play editor no longer closes on backdrop
clicks or Escape. It requires explicit Save or Cancel. Escape is swallowed while
the editor is open so it does not close the modal through browser or higher-level
handlers.

The editor also keeps a bounded undo stack:

- `this._stepEditorUndoStack` stores up to 10 snapshots.
- A snapshot contains a shallow copy of `this._stepEditorSequence` plus the
  current alternate-target index.
- Appending a note, removing a chip, clearing the sequence, setting an alternate,
  and clearing an alternate all push a snapshot before mutating the in-memory
  sequence.
- Undo only affects the open editor state. Project settings are still written
  only when Save calls `_persistStepEntries()`.

Do not reintroduce manual text entry on the performance surface. The whole point
of this Step Play shape is that keyboard/MIDI/controller input can always mean
"play" on the main surface, while editing stays inside the explicit modal.

## Mobile Create Layout Tightening 0.1.55

This pass fixes three mobile regressions found on iPhone-class viewports:

1. The Create patch picker was truncating to `C...` even when room existed.
2. Pads felt clipped because desktop spacing consumed too much vertical space.
3. Keyboard hotkey hint badges added visual noise on touch-first layouts.

### Patch row behavior

`src/instruments/instruments.css` mobile (`@media (max-width: 700px)`) now
forces a stable two-column patch row:

- `.patch-selector` uses `grid-template-columns: 56px minmax(180px, 1fr)`.
- Horizontal overflow/drag behavior was removed for this row
  (`overflow-x: visible`, `touch-action: auto`) so the picker can own real
  width instead of collapsing.
- `.patch-selector__picker` now has `min-width: 180px` on mobile.
- `.patch-selector .tone-button` keeps `min-width: 0` to prevent button tracks
  from pushing the picker narrower than intended.

Result: the patch control stays readable first, action buttons wrap beneath it.

### Pads density on mobile

The ScaleBoard surface is compacted on mobile:

- `.scaleboard` padding/gap reduced from desktop spacing.
- `.scaleboard__controls` gap tightened.
- `.scaleboard__pads` uses an explicit small gap and
  `grid-auto-rows: minmax(48px, 1fr)`.
- `.scaleboard__pad` minimum height reduced with tighter internal gap.
- Degree and note typography slightly reduced for fit.

This keeps more pads visible in the same viewport height while preserving
tap targets.

### Keyboard hint labels on touch layouts

Hotkey badge labels are hidden at `max-width: 700px`:

- `.micropiano__key-label { display: none; }`
- `.sketchkit__key-label { display: none; }`

Important: keyboard and MIDI input routing still works. Only the visual hint
badges are hidden on small screens.

## Mobile Create Layout Rebalance 0.1.56

The first mobile layout tightening made the Patch picker readable, but the grid
layout produced oversized implicit columns for the action buttons. On iPhone 15
portrait this made `Create Instrument`, `Tone`, `AI`, `Controller`, and
`Layout` look comically large and stole vertical space from the pads.

### Patch selector

`src/instruments/instruments.css` mobile rules now use wrapping flex for
`.patch-selector`:

- The `Patch` label keeps a small fixed lane.
- `.patch-selector__picker` claims the rest of the first row with a `220px`
  minimum.
- Action buttons wrap below at their natural compact width.
- The row allows horizontal pan gestures again (`touch-action: pan-x`) instead
  of acting like a static grid.

This keeps the patch name readable without turning the action buttons into
giant columns.

### ScaleBoard mobile controls and pads

The ScaleBoard control row is now explicitly compact on phones:

- `.scaleboard__controls` uses three compact columns so Pad Mode, Octave, and
  Extensions can share the same row when possible.
- The Pad Mode group stacks its label above the select on mobile, reducing
  horizontal pressure.
- Octave buttons/display and the Extensions button use smaller mobile heights.
- Pad tiles use smaller gaps, `42px` minimum row height, thinner borders, and
  smaller degree/note typography.

The goal is not to make every 13-pad extension layout fully visible on every
browser chrome combination, but to stop the controls from consuming the whole
screen before the pad grid gets a fair chance.

### ChoicePicker mobile scrolling

`src/ui/ChoicePicker.js` no longer selects options or group tabs on
`pointerdown`. It now uses a small tap helper:

- remember pointer-down coordinates
- ignore the action if pointer-up moved more than 10px
- support Enter/Space for keyboard activation

This lets finger drags scroll instrument/scale/tone picker lists on mobile
instead of accidentally selecting the item touched at the start of the drag.

## Canvas Touch Hardening 0.1.57

Mobile QA found three Canvas touch problems:

1. Clips already on the Canvas were hard to move by touch.
2. The Canvas snippet dock was difficult to scroll horizontally.
3. Track delete could take one or two taps depending on hover/visibility state.

### Existing Canvas clips

`CanvasMode._startClipDrag()` and `_startClipResize()` now call
`preventDefault()`, capture the initiating pointer, ignore other pointers, and
release capture on pointer up/cancel. `.canvas-clip` also uses
`touch-action: none`.

This makes the intended gesture explicit: touch and drag the clip itself to move
it, without browser scrolling or text selection stealing the drag.

### Canvas snippet dock

The snippet dock now separates horizontal scroll from vertical drag:

- `touchstart` stores a pending touch drag.
- `touchmove` stays pending until movement crosses 10px.
- If horizontal movement wins, the mode becomes `scroll` and no
  `preventDefault()` happens.
- If vertical movement wins, the mode becomes `drag`, `preventDefault()` starts,
  and the floating clone follows the finger into the track area.

CSS sets `touch-action: pan-x` on `.canvas-snippet-dock` and dock items so the
browser is allowed to handle horizontal scrolling naturally.

### Track delete

Track remove buttons are visible on mobile (`max-width: 640px`) instead of
depending on hover. `_removeTrack()` now asks for confirmation before deleting a
track, including clip count when the track contains clips. This matches the
existing "confirm before destructive snippet delete" direction and avoids
ambiguous double-tap behavior.

## Canvas Pan And Clip Long-Press 0.1.58

Mobile QA then showed two remaining Canvas gesture gaps:

1. Dragging empty Canvas timeline space did not reliably pan left/right.
2. Mobile users still had no direct way to delete an individual placed clip.

### Empty timeline panning

`CanvasMode` already had a drag-to-pan handler on `.canvas-tracks`, but mobile
browsers could still claim the gesture. The handler now:

- calls `preventDefault()` when a pan starts outside clips/track headers/buttons
- captures the initiating pointer
- ignores unrelated pointers
- updates both `scrollLeft` and `scrollTop`
- cleans up on pointer up/cancel

`.canvas-tracks` now uses `touch-action: none` so this custom pan path is the
owner of empty-timeline dragging. Clip drags still opt out because the pan
handler ignores `.canvas-clip` targets.

### Clip long-press delete

Touching a Canvas clip no longer immediately starts a drag. It enters
`_startTouchClipIntent()`:

- if the finger moves more than 8px, the hold timer is cancelled and the normal
  clip drag starts
- if the finger stays still for 650ms, Notenotes prompts to delete that clip
- pointer up/cancel clears the timer with no destructive action

Mouse and trackpad behavior stays immediate: pointer down on a clip still starts
dragging, and modifier-key delete/resize behavior is unchanged.

## iOS Media Route Primer 0.1.76

iOS QA showed a stricter failure than a suspended `AudioContext`: pads could make
the bottom audio prompt disappear, `AudioContext.state` could report `running`,
and the app still remained silent until the user visited Audio In and granted
Safari microphone permission. That means the readiness signal is not only Web
Audio state on iOS; the system media route can also need to be opened.

The unlock path now tracks this separately:

- `AudioEngine.mediaRoutePrimed` records whether the page has successfully
  opened the system media route.
- `AudioEngine.primeMediaRoute()` calls `getUserMedia({ audio: true })`, then
  immediately stops every returned track. It does not connect the stream to the
  audio graph and does not start a recording.
- `main.js` only requests this primer on likely iOS devices, and only from the
  explicit audio prompt or a sound-producing target such as Pads, Step Play,
  Tonal Compass, Piano keys, Kit pads, or Stage lanes. Generic page taps should
  still initialize/resume Web Audio without surprising the user with a mic
  permission dialog.
- `_syncAudioUnlockPrompt()` keeps the prompt visible while iOS still needs the
  media route, even if the context itself is already `running`.
- `MicRecorder._openStream()` calls `markMediaRoutePrimed()` so the real Audio
  In permission path satisfies the same route state.

If future iOS testing proves that stopping the temporary stream is not enough,
the next escalation is to keep a clearly documented muted primer stream alive
for the session. Do not do that preemptively; it is a larger privacy tradeoff.

## Controller Labs Modifier Slots 0.1.77

Controller Labs no longer uses the large controller artwork as its main surface.
It now shows setup/status panels: current custom bindings, fallback scale notes,
and four held modifier dropdowns for `LB`, `LT`, `RB`, and `RT`.

Implementation details:

- `GamepadInputManager.BINDABLE_GAMEPAD_BUTTONS` excludes buttons `4`, `5`,
  `6`, and `7`. Those physical controls are reserved modifier slots and cannot
  be learned in the Controller Mapper.
- `GamepadInputManager` emits trigger/axis state before button down/up events
  each poll. This matters when a user presses a modifier and note button in the
  same frame; the modifier state must be visible before the note routes.
- `ControllerMode` stores the new assignments in
  `project.settings.controllerModifierAssignments`. When loading old projects,
  legacy `controllerToneAssignments` values migrate only if they were old
  `note:*` trigger-note choices; old Tone trait assignments normalize to
  `none`.
- `ControllerMode.modifiedMidisForRoot(rootMidi)` is the public adapter used by
  `CreativeMode` when routing learned MIDI bindings, learned Pads bindings,
  fallback Pads buttons, and fallback Piano buttons. Drum bindings ignore note
  modifiers.
- `ScaleBoard.pressControllerPadBinding()` accepts an optional `binding.midis`
  array. This lets global controller modifiers transform a Pads binding without
  changing the stored binding target or the user's project key/scale behavior.
- `MicroPiano.pressControllerMidi()` receives a per-button source key such as
  `controller-0` or `fallback-12` when a modifier expands one input into
  several notes, so release can cleanly stop the exact notes that were started.

Tone is intentionally not part of these modifier slots. Keep effect punching in
Tone recording workflows, not held controller modifiers.

## Canvas Clip Time Scale 0.1.88

Canvas no longer uses the old `Alt+drag` clip resize path. That path mutated the
shared snippet by deleting notes/hits outside the resized range, which made
Canvas behave like a destructive editor. Inspect remains the place to remove or
shorten notes. Canvas now treats clip timing as an arrangement-level lens.

### Data model

- Clips may carry `clip.timeScale`.
- Missing, malformed, or unsupported values normalize to `1`.
- Supported v1 values live in `src/engine/ClipTimeScale.js`:
  - `0.5` = **Double-time**. The clip is half as long.
  - `1` = **Normal**.
  - `2` = **Half-time**. The clip is twice as long.
- The original snippet is never mutated by Canvas Time. `clip.durationBars`
  stores the visible arrangement length, but the source duration still comes
  from `clip.snippet.durationTicks` when available.

### Canvas UI and collision policy

`CanvasMode` exposes a **Time** toolbar button. When active, clicking a clip
opens a modal with the supported timing presets. There is no close-X pattern;
the modal uses the app's normal Cancel button shape.

Applying a timing preset:

- keeps `clip.startBar` fixed
- grows or shrinks to the right
- pushes every later clip on the same track by the growth amount when the clip
  gets longer, preserving downstream spacing
- does not pull later clips left when shrinking
- writes one undo entry covering the edited clip and all shifted clip starts

This means Canvas Time behaves like inserting more/less time into one track,
not like trimming the underlying snippet.

### Playback and export parity

Every live/export path must apply the same lens:

- Live `PlaybackEngine` schedules note/hit event starts at
  `clipStartTick + event.startTick * clip.timeScale`.
- MIDI note durations scale by `clip.timeScale`.
- Recorded modulation reads the source-local tick as
  `(timelineTick - clipStartTick) / clip.timeScale`.
- Audio clips use tape-style vari-speed:
  `BufferSource.playbackRate = 1 / clip.timeScale`. Pitch follows timing by
  design; there is no pitch-preserving time stretch in this version.
- `WavExporter` mirrors MIDI/drum timing math and resamples audio snippets with
  linear interpolation for the same tape-style behavior.
- `MidiExporter` applies the same scaled starts/durations for Canvas MIDI
  export. Standalone snippet MIDI export remains unscaled because snippets do
  not own arrangement-level clip lenses.
- `StageModel` applies the same timing scale so Canvas Stage lanes stay aligned
  with what the Canvas plays.

Use `clipTimeScaleBadgeItem()` with the existing Tone badge renderer when a
clip's timing is not normal. This intentionally places Time beside Tone so users
can see both "this clip has effects" and "this clip has arrangement timing."

## Fuller Modern Preset Floor 0.1.89

The first sound-upgrade slice is intentionally conservative: no sampler, no
AudioWorklet, no bundled IR files, and no renderer unification. It revoices the
older Modern-family synth presets so the whole family has a produced synth floor
instead of mixing rich v0.1.x presets with older single-oscillator patches.

Affected presets in `src/instruments/WebAudioSynth.js`:

- `soft_pad`
- `shimmer_lead`
- `lofi_keys`
- `warm_bass`
- `organ`

Each now has:

- `schemaVersion: 2`
- a supporting `oscillator2`
- at least light `unison`
- explicit `keyTrack`
- a small nonzero patch `drive`
- restrained filter envelope and/or vibrato where it fits the patch

This keeps the Chip family punchy and direct while making every Modern preset
less dry/flat by default. The values are patch data only, so the existing live
engine and `WavExporter.renderPatchTone()` both pick them up through the
already-supported oscillator2/unison/filterEnv/vibrato/keyTrack/drive fields.

The smoke test `modern synth presets keep a richer produced-voice floor` guards
the new Modern-family minimum. If a future Modern preset is deliberately sparse,
either move it out of the `modern` family or update the test and document the
exception here. Do not silently add bone-dry single-oscillator patches back into
Modern.

## Expressive Velocity Response 0.1.90

Velocity now has an optional patch-level timbre response in addition to normal
gain scaling. This is deliberately additive and quiet by default:

```js
velocityResponse: {
  filter: 0.34, // 0-1: harder notes brighten cutoff, soft notes darken it
  drive: 0.015  // 0-0.3: harder notes add a small amount of patch drive
}
```

Legacy patches and custom patches without `velocityResponse` behave exactly as
before. `DEFAULT_PATCH.velocityResponse` and `DEFAULT_EXPORT_PATCH` are `null`;
`normalizeVelocityResponse()` clamps fields and returns zero-response defaults
when callers pass nothing.

The shared math lives in `src/engine/VelocityResponse.js`:

- `velocityAdjustedFilterFrequency(baseFrequency, velocity, response)` applies
  a bounded multiplier after key tracking and before any filter envelope opens
  the cutoff.
- `velocityAdjustedDrive(baseDrive, velocity, response)` only increases drive
  on harder hits; soft notes do not subtract from the patch's base drive.

Live/export parity:

- `WebAudioSynth._filterBaseFrequency(midi, velocity)` now runs key tracking and
  velocity brightness through the shared helper.
- Synth patch drive in `WebAudioSynth.noteOn()` is computed with
  `velocityAdjustedDrive()` before creating the per-voice waveshaper.
- `WavExporter.renderPatchTone()` uses the same filter and drive helpers so
  snippet and Canvas WAV export keeps the same expressive response.
- Sample patch export passes `instrument.velocityResponse` through the same
  filter helper if a custom patch ever provides it.

All built-in Modern-family presets opt in with restrained values. Chip presets
stay direct and old-school for now. The smoke tests now guard both halves:
`modern synth presets keep a richer produced-voice floor` requires Modern
patches to expose filter velocity response, and
`velocity response changes timbre without changing legacy patches` confirms
that null response remains a no-op.

## Modern Stereo Width 0.1.91

Modern-family synth patches now have a restrained `stereoWidth` field:

```js
stereoWidth: 0.3 // 0-1, additive patch data; legacy default is 0
```

This is intentionally patch-level, not a global widening effect. Chip presets
stay centered and direct. Old/custom patches without the field remain mono.

Shared math lives in `src/engine/StereoWidth.js`:

- `normalizeStereoWidth(width)` clamps to `0..1`.
- `panForVoice(index, voiceCount, width, layerOffset)` spreads unison voices
  across the stereo field while keeping one-voice patches centered.
- `stereoGainsForPan(pan)` returns equal-power left/right gains for export.

Live path:

- `WebAudioSynth.loadPatch()` normalizes `stereoWidth`.
- `_createOscillatorStack()` inserts a `StereoPannerNode` per unison voice when
  the patch asks for width and the browser supports it.
- Primary and secondary oscillator layers can use a small offset so supporting
  oscillators do not sit exactly on top of the main layer. The result is width
  from the voice graph itself, not a master-bus effect that would smear drums or
  Tone globally.

Export path:

- `WavExporter.encodeWav()` now supports mono or stereo buffers.
- Export buffers remain mono unless the selected MIDI patch/custom instrument
  has nonzero `stereoWidth`; this avoids doubling file size for ordinary mono
  sketches.
- `renderPatchTone()` uses the same `panForVoice()` and equal-power gains as the
  live synth. Tone traits can process stereo buffers channel-by-channel.
- Audio clips, drums, and custom samples without width mix to the center when
  the containing export is stereo.

The smoke test `stereo width helper keeps center stable and spreads unison
voices` guards the shared math, and the Modern preset floor test now requires
Modern patches to include nonzero `stereoWidth`. If a future Modern patch is
intentionally narrow, document the exception instead of silently weakening the
family baseline.

## Canvas Track Pan 0.1.92

Canvas tracks now have an additive `track.pan` field:

```js
track.pan = 0 // -1 hard left, 0 center, 1 hard right
```

Legacy tracks without the field normalize to center via
`normalizeTrackPan()` in `src/engine/StereoWidth.js`. This helper is shared by
the live engine, the Canvas UI, and WAV export so all callers clamp the same
way.

### Canvas UI

`CanvasMode` renders a small Pan button beside each track's M/S buttons. The
button shows `C`, `L50`, `R100`, etc. and opens a modal with a slider plus
Hard L / Center / Hard R presets. Saving mutates only `track.pan`, schedules an
autosave, pushes an undo entry, rerenders lanes, and calls
`onTrackMixChanged(track.id)`.

The Pan modal intentionally has no top-right X, matching the rest of the app's
modal language. Cancel leaves the track unchanged.

### Live playback

Canvas playback applies pan at the track bus level:

- `AudioEngine.setTrackBusPan(gain, pan)` inserts a `StereoPannerNode` between a
  track output gain and the master bus when the browser supports it.
- `WebAudioSynth.setPan()` and `SketchKit.setPan()` route their per-track output
  gains through that helper.
- `PlaybackEngine` now keeps one `SketchKit` instance per drum track rather
  than one shared kit, so two drum tracks can pan independently.
- Audio clips use a per-source `StereoPannerNode` before the playback gain
  reaches the master bus.

`PlaybackEngine.onTrackMixChanged(trackId)` updates cached synth/kit buses
without forcing users to stop playback or reload the Canvas.

### WAV export

Canvas WAV export is now stereo by design. `WavExporter.projectToWavBlob()`
passes each track's pan into MIDI synth rendering, drum hit rendering, custom
sample rendering, and audio-buffer mixing. Existing standalone snippet WAVs
remain source-aware: they stay mono unless the selected patch/custom instrument
has stereo width or a caller explicitly asks for pan.

`mixBuffer()` and `mixSample()` can mix mono or stereo sources into stereo
targets. When a stereo source is panned, it is intentionally folded to mono
before equal-power pan is applied, so track pan behaves as a position control
instead of stacking source width and track position in a surprising way.

MIDI export does not write CC10 pan yet. That should be treated as a later
metadata/export slice if users need DAW pan automation or track setup in MIDI
files.

### Internal audio storage note

Internal Audio In recordings still use the existing browser-decoded asset flow
and are not migrated away from WAV in this slice. A future storage slice can add
an additive audio asset shape such as `audioAsset.format` and store WebM/Opus or
AAC where browsers support recording it, while continuing to import/play legacy
WAV/data URL assets and keeping WAV as an explicit export format. Do not remove
legacy WAV support; old projects must always move forward.

## WAV Channel Export Choices 0.1.93

WAV export now separates "what channel count should this exported file have?"
from internal audio storage. Internal Audio In assets are still stored through
the existing audio asset path; this slice only changes rendered export output.

Shared export choice normalization lives in `src/export/WavChannelMode.js`:

```js
normalizeWavChannelMode('auto' | 'mono' | 'stereo')
```

Keep this helper browser-free so smoke tests can import it without loading
`WavExporter.js`, which depends on browser-oriented instrument modules.

### Settings UI

The Settings > Export Audio section now exposes:

- Canvas WAV channels: `Stereo (pan)` or `Mono`. Stereo remains the default
  because Canvas track pan and Modern preset width are user-visible mix choices.
- Snippet WAV channels: `Auto`, `Mono`, or `Stereo`. Auto remains the default so
  snippets do not double file size unless the source/render path is actually
  stereo.

### Export renderer

`WavExporter.withWavChannelMode()` runs immediately before `encodeWav()`:

- `auto` preserves the render buffer chosen by the export path.
- `mono` folds stereo buffers down by averaging left/right.
- `stereo` duplicates mono buffers into left/right channels.

Snippet Auto now chooses stereo when a MIDI patch has `stereoWidth`, when the
decoded Audio In source has more than one channel, or when a caller explicitly
passes a nonzero pan. Otherwise it stays mono. Stereo Audio In snippets are
preserved in Auto/Stereo when pan is center; if a track or caller pans a stereo
source, the exporter folds it before applying equal-power pan so "track pan" is
a clear position control.

Canvas WAV defaults to stereo and passes the selected `channelMode` through
`projectToWavBlob()`. Choosing Mono intentionally removes track pan from the
exported file while keeping all audible clips present.

## Audio In Channel Preference 0.1.94

Audio In now exposes a capture channel preference in the Audio In surface:

- `Auto`
- `Mono`
- `Stereo`

This is a recording-time preference, separate from WAV export channel choices.
It uses `navigator.mediaDevices.getUserMedia()` channel constraints only as
`ideal`, never `exact`, so unsupported stereo/mono requests should fall back
instead of failing the recording. Keep that behavior: mobile browsers and input
hardware vary too much to treat channel count as a hard requirement.

Shared pure helpers live in `src/engine/AudioInputChannelMode.js`:

```js
normalizeAudioInputChannelMode(mode)
audioInputConstraints(deviceId, channelMode)
```

`audioInputConstraints()` returns `{ audio: true }` for Auto unless a device ID
or channel preference needs an object. Device IDs still use `{ exact: id }`,
matching the older behavior for a user-selected input device. Mono adds
`channelCount: { ideal: 1 }`; Stereo adds `channelCount: { ideal: 2 }`.

## Master Glue Output Stage 0.1.98

The next sound-upgrade slice adds a subtle fixed master-output glue stage. This
is deliberately not a user-facing Tone control yet; it is a hidden, conservative
voicing pass so the app can sound a little more finished without adding another
knob or saving new project data.

Shared DSP lives in `src/engine/MasterGlue.js`:

```js
MASTER_GLUE_DEFAULTS = {
  enabled: true,
  drive: 0.055,
  inputGain: 1,
  outputGain: 0.9,
}

masterGlueSample(sample, options)
createMasterGlueCurve(length, options)
applyMasterGlue(buffer, options)
```

The curve is intentionally gentle: silence remains silence, quiet material stays
close to its source level, and loud peaks are rounded before final limiting or
WAV normalization. Do not treat it as a loudness maximizer. If users want a
visible "Warmth" or "Presence" control later, build that as an additive setting
on top of this helper instead of hand-rolling a second saturator.

Live path:

- `AudioEngine.initSync()` now routes
  `masterGain -> masterGlue WaveShaperNode -> limiter -> destination`.
- The WaveShaper curve comes from `createMasterGlueCurve(2048)` with `2x`
  oversampling. All instruments, Canvas playback, metronome, and audio clips
  flow through the same output stage because they already connect to
  `AudioEngine.masterGain`.

Export path:

- `WavExporter.encodeWav()` calls `applyMasterGlue(samples)` before the existing
  peak normalization. This means standalone snippet WAVs and Canvas WAVs get the
  same output rounding heard live.
- MIDI export remains unchanged because MIDI cannot represent Notenotes output
  processing.

Smoke tests:

- `master glue gently shapes peaks while preserving silence`
- `master glue applies equally to mono and stereo buffers`

## Curved Synth Envelopes 0.1.99

Synth amplitude and filter envelopes now use shared curved segments instead of
straight `linearRampToValueAtTime()` ramps. This is another procedural fullness
slice: it makes quick notes speak sooner and lets decay/release fall more
naturally without adding UI, sample assets, or new patch schema.

Shared math lives in `src/engine/EnvelopeCurves.js`:

```js
ENVELOPE_CURVE_DEFAULTS = {
  attackShape: 0.62,
  decayShape: 1.9,
  releaseShape: 2.2,
  curvePoints: 48,
}

envelopeSegmentProgress(progress, 'attack' | 'decay' | 'release')
createEnvelopeParamCurve(from, to, segment, points)
adsrEnvelopeValueAt(t, durationSec, env, velocity)
```

Design intent:

- Attack uses an ease-out curve, so the sound reaches useful level earlier than
  a straight line while preserving each patch's saved attack time.
- Decay and release move quickly at first and settle more gently, closer to how
  users expect synth envelopes to feel.
- Existing `envelope.attack/decay/sustain/release` fields are unchanged. Old and
  custom patches load normally; only the interpolation shape changes.

Live path:

- `WebAudioSynth._scheduleAmpEnvelope()` schedules attack and decay with
  `AudioParam.setValueCurveAtTime()` using `createEnvelopeParamCurve()`.
- `_scheduleFilterEnvelope()` uses the same helper for filter attack/decay
  movement, so filter-envelope patches avoid the old stiff straight-line sweep.
- `_envelopeLevelAt()` uses `adsrEnvelopeValueAt()` so note-off release begins
  from the same curved level the live attack/decay scheduling intended.
- Release still uses `setTargetAtTime(0, release / 3)` to avoid clicks when
  users release a note mid-curve.

Export path:

- `WavExporter.envelopeValue()` delegates to `adsrEnvelopeValueAt()`.
- `WavExporter.filterFrequencyForPatch()` uses `envelopeSegmentProgress()` for
  filter attack and decay, mirroring the live filter movement.

Smoke tests:

- `envelope curves make attacks speak sooner and decay more naturally`
- `envelope param curves include exact endpoints for live scheduling`

`MicRecorder` owns the UI and stream reopening:

- Changing Input or Channels reopens the stream when permission is already
  granted.
- Input and Channels selects are disabled while recording so a user cannot
  reopen the stream mid-take.
- The level meter continues to read from the active stream.
- `recordingMetadata()` exposes `inputChannelMode` plus the actual
  `inputChannelCount` reported by the audio track's `getSettings()` when the
  browser provides it.

`CreativeMode` stores that metadata on new audio snippets:

```js
audioInputChannelMode
audioInputChannelCount
```

`ProjectStore.saveAudioAsset()` mirrors the same metadata onto the audio asset
record. Old audio snippets/assets do not have these fields and remain valid.

## Kit Toolbar Visibility 0.1.107

`CreativeMode` renders a global `.patch-selector` toolbar for synth-like Create
surfaces, while `SketchKit` renders its own Kit toolbar inside
`src/instruments/SketchKit.js`. Kit must not show the synth Patch picker row.

The visibility guard is `CreativeMode._syncPatchToolbarVisibility()`:

```js
const showToolbar = activeInstrument is Pads, Piano, or Labs;
patchSel.hidden = !showToolbar;
patchSel.style.display = showToolbar ? '' : 'none';
```

The explicit `style.display` is required because the authored
`.patch-selector { display: flex; }` rule can override the browser's default
hidden styling. Without it, Kit appears to have two menu bars: a stale synth
Patch row plus the real Kit row. Keep the Kit-specific controls in
`SketchKit.render()` and the synth patch controls in `CreativeMode`; do not
merge the two toolbars unless the whole Create toolbar architecture is being
intentionally redesigned.

## Labs Controller Cleanup 0.1.108

`ControllerMode` no longer renders a duplicate controller screen. The visible
Labs `Controller` panel now contains only the four held modifier slot pickers
(`LB`, `LT`, `RB`, `RT`) and the live modifier help/status lines. Everything
else that used to live here moved to the `Controller` popover
(`ControllerMapperPopover`), which is the single global surface for gamepad
bindings, presets, and connection status.

Removed from `ControllerMode.render()`:

- Pad Mode selector (Single / Chords). Pad Mode already lives on ScaleBoard;
  the controller surface is no longer a playable pad screen.
- Octave up / down buttons. Octave belongs to the active surface (Pads or
  Piano); it should not be duplicated in Labs. The runtime
  `controllerMode.shiftOctave()` is kept because the active Create surface
  still routes keyboard arrows through it when Labs is the active tab, and
  the controller's internal `octave` still drives fallback-button routing.
- Custom bindings list. The bindings list was redundant with the
  `Controller` popover, which is where users actually create, learn, and
  clear bindings.
- Fallback scale / unbound-button list. The fallback behavior is automatic
  and lives in `handleFallbackButtonDown`/`Up`; showing a static copy of the
  scale here was misleading.
- Preset list. Saved presets are visible and editable only from the
  `Controller` popover. Labs has nothing to display here.
- Controller artwork, hotspots, and stick overlays. These were the
  pre-Labs controller diagram; the renamed Labs surface is setup space, not
  a diagram of the physical controller.
- Gamepad status line. The `Controller` popover already shows the live
  connection label; reading it from the popover is the single source of
  truth.

Visible Labs panel now contains:

- A header with the `Labs` eyebrow, a `Controller` title, and a lede that
  points the user to the toolbar `Controller` button for bindings and
  presets.
- A single modifiers section with the four shoulder/trigger slot pickers,
  the held-modifier help line, and the live active-trigger status line.

The runtime gamepad layer is intentionally unchanged:

- `controllerMode.modifiedMidisForRoot()` still transforms the active root
  note for Pads bindings, fallback Pads buttons, fallback Piano buttons, and
  learned MIDI bindings.
- `controllerMode.handleFallbackButtonDown`/`Up` still route unbound face
  buttons and d-pad into the ScaleBoard fallback pad action.
- `controllerMode.shiftOctave()` still updates the controller's internal
  octave (used by fallback routing) when the user changes the active
  surface via keyboard arrows on the Labs tab.
- `project.settings.controllerModifierAssignments`,
  `controllerBindings`, and `controllerBindingPresets` are all unchanged
  data shapes; old projects and old snippets keep loading.
- The `Controller` popover is unchanged. It still owns learn flow, clear
  flow, preset save/load/delete, and live gamepad status.

Dead display code removed alongside the markup:

- `ControllerMode._renderBindings`, `_customBindingsCountLabel`,
  `_renderPresets`, `_presetsCountLabel`, `refreshPresets`,
  `_bindingLabel`, and the `#ct-status` writes inside
  `_attachGamepadInput`. The `_attachGamepadInput` subscription no longer
  listens for the `state` event because the status line is gone.
- The unused `gamepadButtonInfo` and `midiToNoteName` imports.
- `CreativeMode._onControllerBindingsChanged` no longer calls
  `controllerMode.refreshPresets()` (the method is gone).

`instruments.css` drops the corresponding dead rules: the lab header card,
control group, select, octave label, body, controller, modifier panel,
binding head/row/button/target/note, fallback row, trigger assignments,
trigger select, art, image, hotspot, stick, all the `#ct-*` position
rules, the guide row, and the mobile media queries for those classes. The
remaining controller-mode block is now a focused header plus a four-cell
modifier grid.

`refreshBindings()` is intentionally kept as a documented no-op so the
existing CreativeMode wiring (`controllerMode?.refreshBindings?.()`) does
not need to change. Future work that wants to surface bindings inside Labs
can give it real behavior again.

## Labs Tab Structure 0.1.110

The visible Labs panel is a small tabbed surface so it can host more
than one lab without rendering every lab's UI at once. The tab
definitions live in the `TABS` constant at the top of
`src/instruments/ControllerMode.js`:

- **Controller** — enabled. The four held modifier slot pickers
  (`LB`, `LT`, `RB`, `RT`), the held-modifier help line, and the live
  active-trigger status line. This is the only tab with rendered content
  in this slice.
- **Accessibility** — disabled stub. Reserved for Tremor filter, Dwell
  play, and other input helpers. The runtime helpers
  (`tremorAllows`, `dwellSettings`) already read from
  `project.settings.accessibility`, so they function regardless of whether
  this tab is active.
- **Seed** — disabled stub. Reserved for AI Seed defaults
  (provider, model, default snippet length). The interactive seed prompt
  and generation surface stay in the AI Seed popover; this tab is the
  config home.
- **Custom** — disabled stub. Reserved for the future Custom Instrument
  editor. Custom instruments are not yet shipped, so this tab is a
  placeholder.

### Visible layout

The visible Labs layout is intentionally minimal:

1. A single `Labs` title card at the top. No eyebrow, no active tab
   name, no lede.
2. A row of blank tab pills (no visible text). The active tab is filled
   with the accent color; disabled tabs are outlined with `--surface-4`
   at 40% opacity. The tab name lives in the `aria-label` and `title`
   attributes only.
3. A single panel that shows the active tab's body. For the Controller
   tab, the panel leads with a `.ctrlmode__tab-content-desc` card
   (the description moved from the old header lede), followed by the
   modifier grid, then the green help and status lines.

### Tab schema

```js
{
  id,      // stable id; data-tab attribute, localStorage value
  label,   // human-readable name; aria-label, title, placeholder tooltip
  enabled, // true = interactive, false = disabled "Future" placeholder
  body,    // HTML description shown at the top of an enabled tab's panel
           //   (only Controller ships a body in this slice)
}
```

The `TABS` constant carries this schema as a comment block at the top
of `ControllerMode.js`. To add a new tab, append an entry with
`enabled: false`, render its body in `_renderActiveTabBody()`, then flip
`enabled: true` when the lab ships.

### Placeholder for disabled tabs

Disabled tabs render a generic `Future` card with a single description:
"This lab slot is reserved for a future Notenotes feature." The
per-tab identity (Accessibility, Seed, Custom) lives only in the
`aria-label` and `title` attribute of the tab button, not in the visible
placeholder. This keeps the three disabled slots visually identical and
unambiguous: they are all "Future" labs, distinguished only by tooltip
and order.

### Runtime behavior across tab switches

Each tab's runtime state continues to function when its tab is not
active:

- Modifier slot assignments, gamepad polling, and any future
  accessibility/AI/Custom state all read from their own data sources
  (`project.settings.*`, the gamepad input manager, etc.) independent
  of the rendered DOM.
- `_attachGamepadInput()` is idempotent and subscribes only when the
  Controller tab is the active tab at render time, so background trigger
  polling does not double-bind when the user navigates Create > Canvas
  > Create > Labs.
- When the user returns to the Controller tab via `_setActiveTab()`,
  the modifier pickers' event handlers are re-bound to the freshly
  rendered DOM nodes, and the live "Active: ..." status line is
  refreshed so it picks up the current modifier state.

### Persistence

Active tab state persists in `localStorage` under
`notenotes.labs.activeTab`. Only enabled tabs are restored, so flipping
a stub to `enabled: true` later does not auto-promote a stale saved
value until the user actually clicks that tab. Reads and writes are
wrapped in `try/catch` so private mode and locked-down iframes do not
break the constructor or the tab switcher.

### Trigger text centering

The green "Held modifiers" and "Active: ..." text below the modifier
grid is centered both inside the `<p>` and inside the panel. Two CSS
properties are needed for this to work on a max-width-constrained
element inside a grid panel:

- `text-align: center` centers the inline text content inside the
  `<p>`.
- `justify-self: center` centers the `<p>` element itself inside its
  grid cell. Without this, the `max-width: min(100%, 640px)` constraint
  on the help element left the 640px-wide block anchored to the left of
  the panel, and only the text within the block was centered. The
  result read as "off to the left" rather than "centered".

Both rules have explanatory comments in `instruments.css`.

### Removed CSS

- `.ctrlmode__eyebrow` and `.ctrlmode__lede` were used only by the
  removed header eyebrow and lede. The rules are kept (harmless) for
  potential future surface headers, but no current code path renders
  them inside Labs.
- `.ctrlmode__placeholder-eyebrow` (the small "Coming soon" uppercase
  label) is no longer used because the placeholder now leads with a
  larger "Future" title.

## FM Synth Voices 0.1.113

Cherry-picked from the `opus/crash-fix-and-section-a-voices` branch
(Section A FM work) without bringing the rest of that branch (Karplus-Strong
pluck, additive harmonics, the rapid-retrigger crash fixes, or the
crash-breadcrumb logger). Only the 2-operator FM voice type and its four
presets landed on main.

### Voice model

2-operator FM: a sine modulator drives the carrier oscillator's
instantaneous frequency, with the modulation index decaying exponentially
from `index` toward `index * indexSustain` over `fm.decay` seconds. The
fast index decay is what makes the attack clangy and the body mellow. The
carrier inherits the patch's normal filter and amp envelope so FM presets
read like the rest of the synth family.

The live path (`WebAudioSynth.noteOn` for `p.type === 'fm'`) builds:
- a sine `mod` oscillator at `carrierFreq * fm.ratio`,
- a `modGain` whose `.gain` is `setValueAtTime(peakDev, now)` then
  `setTargetAtTime(peakDev * indexSustain, now, fm.decay)` — the same
  curve the offline renderer uses,
- the carrier (sine by default, or whatever `patch.oscillator.type`
  is for patches that want a non-sine carrier),
- the existing per-voice `filter` and `env` GainNodes, and
- the same `vibrato` LFO the regular synth path uses.

The voice record is `{ oscillators: [carrier], fmMod: mod, fmModGain:
modGain, vibrato, filter, env, midi, startTime, velocity, kind: 'fm' }`.
`noteOff`, `panic`, and `_disposeVoiceNodes` all know to stop and drop
`voice.fmMod` / `voice.fmModGain`. The `kind: 'fm'` tag exists for future
inspection (`audioVoiceStress` on the opus branch asserts the same).

### Offline parity

`WavExporter.renderPatchTone` short-circuits to a new `renderFmTone`
function when `patch.type === 'fm'`. The function steps the carrier phase
with the same instantaneous-frequency math the live setTargetAtTime
produces, applies the patch's filter and amp envelope, and mixes into
the buffer with the same pan path. Result: live and WAV export match,
just like the existing chip and modern paths.

### Presets

Four built-in FM presets ship in `PRESETS`:

- `fm_epiano` — ratio 1, index 2.6, indexSustain 0.12, decay 0.22, lowpass
  9000 Hz, mild velocity filter brightening.
- `fm_bell` — ratio 1.41 (slightly inharmonic), index 4.2, indexSustain
  0.4, decay 1.1, long ringing tail.
- `fm_glass_bass` — ratio 0.5 (sub-octave modulator), index 1.6, fast
  decay, dark lowpass.
- `fm_mallet` — ratio 3.5 (high modulator), index 3.2, no sustain,
  very short decay. Classic "ting" attack.

All four have `family: 'fm'` and `type: 'fm'`. Picker UI in
`CreativeMode._patchGroups()` filters by `p.family === 'fm'` and shows
them in their own "FM synths (2-operator)" group with the kicker "FM
synth" and a description like "2-op FM - ratio 1.41" when the ratio
isn't 1.

### Boundaries

- Do not add `fm.ratio` values that depend on a default of `2`. The
  clamp to `Math.max(0.01, ratio)` guards against divide-by-zero, but
  ratio 0 collapses the modulator to DC and the carrier math goes
  silent. The default `?? 2` is a safety net for malformed patches.
- `indexSustain` is clamped to `[0, 1]`. Values outside the range are
  clamped; do not rely on the Web Audio setTargetAtTime validator
  catching them first.
- FM is a synth voice, not a sample or kit voice. Tone Trait
  processing (Crush, Echo, Space, Wobble, Drive, Noise) is shared
  through the existing master chain and applies to FM the same way as
  chip / modern presets.
- Custom instruments built from FM presets inherit `type: 'fm'`;
  the `Create/Edit Instrument` flow already routes them through the
  FM renderer on export.
