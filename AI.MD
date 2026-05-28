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
- Step Play

Pad count follows the current scale unless a mode overrides it. Extensions
continue scale degrees into the next octave for Single and normal Chords modes.

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
  `1-=`, `Q-]`, `A-'`, `Z-/`. Pads and Piano reverse-map this list so `1` is
  the highest visible note and later keys move downward. Kit maps forward through
  visible drum pads because drums are not pitch-ordered. Kit pads display the
  matching `PERFORMANCE_KEY_LABELS` value so the playable shortcut is visible
  on the only pad surface that is not pitch-numbered.
- Global digit modulation shortcuts must yield when the active Create surface
  can play that key. `main.js` asks `creativeMode.handlesPerformanceKey(code)`
  before starting pitch/mod ramps.
- Web MIDI input is requested when Creative audio initializes. Incoming MIDI is
  routed to the active Create surface: Pads map the MIDI note to the nearest
  visible pad and then play the current Pad Mode action, Piano plays the exact
  MIDI note, and Kit prefers General MIDI drum notes with a visible-pad fallback.
  In Step Play mode, any MIDI note-on advances the Step sequence and note-off is
  ignored.

Keep computer-keyboard, MIDI, and controller routing conceptually aligned: the
active surface decides what the input does. If the performance key layout ever
changes, update `PerformanceKeys.js` instead of duplicating labels in individual
instruments.

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
