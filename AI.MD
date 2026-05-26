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

## Current Module Map

```text
src/main.js
  engine/
    AudioEngine.js          Web Audio context, master output, panic/kill audio
    Transport.js            lookahead scheduler and project meter timing
    Meter.js                canonical meter math and display presets
    Metronome.js            click scheduling from Transport callbacks
    Quantizer.js            grid math
    RecordingManager.js     converts live events into snippets
    MusicTheory.js          notes, scales, degree metadata
    ScaleChords.js          curated chord recipes for non-tertian scales
    GamepadInputManager.js  gamepad polling and bindable buttons
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
    CanvasMode.js           timeline/arrangement
    EditMode.js             Inspect mode for MIDI, drum, audio snippets
  ui/
    TransportBar.js         top bar transport, key/scale/meter
    ChoicePicker.js         shared categorized picker for large creative lists
    SettingsPanel.js        settings, export, backup, milestones, diagnostics
    SnippetTray.js          snippet strip
    Toast.js                notifications
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

## Data Model

Project sketch:

```js
{
  id,
  name,
  bpm,
  meter,              // canonical
  timeSignature,      // legacy mirror
  musicalContext: { root: 'C', scale: 'major' },
  tracks: [],
  snippets: [],
  settings: {
    soundTraits: {},
    tonePresets: [],
    customInstruments: [],
    controllerBindings: {},
    controllerBindingPresets: [],
    controllerToneAssignments: { leftTrigger: 'none', rightTrigger: 'none' },
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

## Instruments

### Pads / ScaleBoard

ScaleBoard reads `project.musicalContext` for root and scale. It supports:

- Single notes
- Chords
- Root mode
- Custom pads
- Voice Sketch
- Compass

Pad count follows the current scale unless a mode overrides it. Extensions
continue scale degrees into the next octave for Single and normal Chords modes.

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
Triggers and analog sticks are reserved for expression/Tone functions and are
not bindable as regular buttons.

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

Step Play is planned as a Pads mode, not a separate top-level instrument, because
"instrument" already means synth/custom patch elsewhere. It should behave like a
one-button performance surface: each trigger advances through a user-entered
sequence while recording captures the user's timing.

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
