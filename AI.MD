# AI.MD — Notenotes AI Agent Context

> **Purpose**: This file provides structured context for AI agents working on the Notenotes codebase. It documents architecture decisions, established patterns, known constraints, and areas requiring care. This is a living document — update it when making significant changes.

---

## 🧭 Project Overview

**Notenotes** is a browser-based PWA for rapid musical idea capture. Users jam on virtual instruments, record MIDI loops, arrange them on a timeline, fine-tune in a piano roll, and export as sheet music. Everything runs client-side with zero backend.

**Core Constraint**: This is a **real-time audio application**. Timing precision is non-negotiable. All architectural decisions prioritize low-latency, deterministic audio scheduling over developer convenience.

---

## 🏛️ Architecture

### Module Graph (dependency flow)

```
main.js (orchestrator)
├── engine/AudioEngine.js      ← Web Audio singleton
├── engine/Transport.js        ← Scheduler clock (depends on AudioEngine)
├── engine/Metronome.js        ← Uses Transport callbacks
├── engine/Quantizer.js        ← Stateless grid math
├── engine/RecordingManager.js ← Uses Transport for tick positions
├── engine/MusicTheory.js      ← Pure utility functions
│
├── instruments/WebAudioSynth.js  ← Creates OscillatorNodes via AudioEngine
├── instruments/ScaleBoard.js     ← Uses WebAudioSynth + MusicTheory
├── instruments/MicroPiano.js     ← Uses WebAudioSynth
├── instruments/SketchKit.js      ← Creates its own synthesis nodes
├── instruments/MicRecorder.js    ← Uses MediaRecorder API
│
├── modes/CreativeMode.js    ← Composes instruments + RecordingManager + SnippetTray
├── modes/CanvasMode.js      ← Reads project.tracks[] + project.snippets[]
├── modes/EditMode.js        ← Mutates snippet.notes[] directly
│
├── ui/TransportBar.js       ← Controls Transport state
├── ui/ModeTabs.js           ← Mode switching
├── ui/SnippetTray.js        ← Displays project.snippets[]
├── ui/LoopProgress.js       ← Animates from Transport position
├── ui/SettingsPanel.js      ← Reads/writes project.settings
├── ui/Toast.js              ← Fire-and-forget notifications
│
├── data/ProjectStore.js     ← IndexedDB CRUD
├── data/UndoManager.js      ← Command pattern stack
│
└── export/ABCConverter.js   ← MIDI → ABC text
    export/SheetMusicView.js ← abcjs rendering + download
```

### Key Principle: No Framework
This project uses **vanilla JavaScript with ES Modules**. There is no React, Vue, Svelte, or other framework. DOM manipulation is explicit. This is intentional:
- Web Audio scheduling requires predictable timing — framework re-renders add jitter
- The app is small enough (~30 files) that component-level state management is sufficient
- Each "component" is a class that owns its DOM element (`this.el`) and exposes a `render()` method

---

## ⏱️ Audio Timing — Critical Context

### The Lookahead Scheduler Pattern
`Transport.js` uses a **lookahead scheduler** — the most important pattern in this codebase:

```
setInterval (25ms) → checks if events need scheduling in next 100ms → schedules via AudioContext.currentTime
```

- **Never use `setTimeout` or `setInterval` for audio timing.** They are not precise enough.
- **Always schedule audio events against `AudioContext.currentTime`.** This is the only reliable clock.
- The Transport fires callbacks (`onTick`, `onBeat`, `onBar`, `onLoop`) during the scheduler tick. These callbacks receive both the tick number AND the scheduled `audioTime`.
- Visual updates (beat dots, progress bars) run on `requestAnimationFrame`, NOT on audio callbacks.

### MIDI Resolution
- **480 ticks per beat** (quarter note) — standard MIDI resolution
- Ticks are the universal time unit for all note data
- Bar = `ticksPerBeat × timeSignature.beats` = 1920 ticks in 4/4
- All snippet data stores positions as tick values

---

## 📦 Data Model

### Project (stored in IndexedDB)
```javascript
{
  id: "uuid",
  name: "My Sketch",
  bpm: 120,
  timeSignature: { beats: 4, subdivision: 4 },
  createdAt: timestamp,
  updatedAt: timestamp,
  tracks: [
    {
      id: "uuid",
      name: "Melody",
      type: "midi",
      instrumentId: "synth",
      clips: [
        {
          id: "uuid",
          snippetId: "uuid",
          snippet: { ...snippetData },
          startBar: 0,         // Position on timeline
          durationBars: 4,
        }
      ],
      muted: false,
      solo: false,
      volume: 0.8,
    }
  ],
  snippets: [
    {
      id: "uuid",
      type: "midi" | "drum" | "audio",
      bpm: 120,
      timeSignature: { beats: 4, subdivision: 4 },
      durationTicks: 7680,     // Total length in ticks
      soundTraits: {
        crush: { amount: 0 },
        echo: { amount: 0 },
        space: { amount: 0 },
        wobble: { amount: 0 },
        drive: { amount: 0 },
        noise: { amount: 0 },
      },
      notes: [
        { pitch: 60, startTick: 0, durationTick: 480, velocity: 0.8, soundTraits: { ...optionalPerNoteTone } }
      ],
      hits: [
        { type: "kick", startTick: 0, velocity: 1.0, soundTraits: { ...optionalPerHitTone } }
      ],
    }
  ],
  settings: {
    quantize: 0,              // QuantizeGrid enum value
    metronomeOn: false,
    metronomeVolume: 0.5,
    loopBars: 4,
    masterVolume: 0.8,
    soundTraits: {
      crush: { amount: 0 },
      echo: { amount: 0 },
      space: { amount: 0 },
      wobble: { amount: 0 },
      drive: { amount: 0 },
      noise: { amount: 0 },
    },
    controllerToneAssignments: {
      leftTrigger: "none",
      rightTrigger: "none"
    },
  }
}
```

### Important: Snippets are Shared References
When a snippet is placed on a track as a clip, the `clip.snippet` property holds a **reference** to the same object in `project.snippets[]`. Edits in the Piano Roll mutate `snippet.notes[]` in place, which affects all clips referencing that snippet. This is intentional — it's non-destructive editing of source material.

---

## 🧩 Established Patterns

### Component Pattern
Every UI component follows this structure:
```javascript
export class MyComponent {
  constructor(deps) {
    this.el = null;
    // store dependencies
  }
  
  render() {
    this.el = document.createElement('div');
    this.el.className = 'my-component';
    // build DOM, bind events
    return this.el;
  }
  
  destroy() {
    // cleanup: remove listeners, cancel animations
  }
}
```

### Event Wiring
- Parent components wire child callbacks in `main.js` after all components are constructed
- One-to-many events use arrays of callbacks (Transport's `onTick`, `onBeat`, etc.)
- One-to-one events use single callback properties (`snippetTray.onSnippetSelected`)

### CSS Conventions
- BEM-ish naming: `.component__element--modifier`
- State classes: `.is-active`, `.is-selected`, `.is-recording`, `.is-dragging`
- CSS custom properties defined in `style.css` (design tokens)
- Component-specific CSS lives alongside its JS file in the same directory

### Toast Notifications
```javascript
import { showToast } from '../ui/Toast.js';
showToast('Your message here');
```

### Auto-Save
```javascript
this.store.scheduleAutoSave(this.project);  // 2-second debounce
```
This also creates a version history snapshot. Max 5 versions kept per project.

---

## ⚠️ Known Issues & Constraints

### Browser Audio Policy
- `AudioContext` cannot be created/resumed without a user gesture
- `main.js` sets up a one-time click/touch/keydown handler to call `engine.init()` and `creativeMode.init()`
- If you add new audio features, ensure they don't try to play sound before this initialization

### vite-plugin-pwa Peer Dependency
- `vite-plugin-pwa@1.2.0` has a peer dependency conflict with Vite 8.x
- Use `npm install --legacy-peer-deps` when installing dependencies
- This does not affect functionality

### IndexedDB + Hot Module Reload
- HMR can cause the app to re-initialize, which may create duplicate DB connections
- The `ProjectStore` handles this gracefully, but you may see "Auto-saved" logs appearing during development
- Full page reload (`Ctrl+Shift+R`) is cleaner than HMR for testing persistence

### SnippetTray Callback
- `onSnippetSelected` only supports a single callback (not an array)
- If multiple consumers need snippet selection events, refactor to an array pattern like Transport uses

### Canvas Mode Clip Rendering
- Clips are rendered as DOM elements, not `<canvas>` — this is fine up to ~100 clips
- For very large arrangements, consider switching to canvas-based rendering

### Quantizer Default
- Quantization defaults to **OFF** (free timing) per user preference
- The setting is stored in `project.settings.quantize` and persists across sessions

---

## 🎨 Design Tokens Quick Reference

```css
/* Colors */
--surface-0: #0d0d0f     /* Background */
--surface-1: #141416     /* Panels */
--surface-2: #1a1a1e     /* Cards */
--surface-3: #222228     /* Borders, dividers */
--accent:    silver gradient
--accent-light: #d0d0d0

/* Typography */
--font-family: 'Inter', sans-serif
--font-size-xs: 0.6875rem (11px)
--font-size-sm: 0.8125rem (13px)
--font-size-md: 0.9375rem (15px)

/* Spacing */
--space-xs: 0.375rem
--space-sm: 0.625rem
--space-md: 1rem
--space-lg: 1.5rem

/* Animation */
--duration-fast: 120ms
--duration-normal: 250ms
--ease-out: cubic-bezier(0.16, 1, 0.3, 1)
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)
```

---

## 🗺️ Roadmap / Open Work

### Not Yet Implemented
- **Deeper Audio In editing** — Audio In creates playable audio snippets, but there is no destructive trim, normalize, waveform analysis, or per-clip gain UI yet.
- **MIDI input** — No Web MIDI API integration yet. Could map MIDI keyboard input to the synth.
- **Overdubbing** — Record additional notes on top of an existing snippet.
- **Mobile touch optimization** — Touch events work but multi-touch (e.g., piano chords) needs testing.
- **MP3 export** — MIDI and WAV export exist. MP3 still needs a reliable browser encoder path.

### Polish Items
- Loading spinner during project load
- Empty state illustrations for Canvas and Edit modes
- Onboarding tooltip for first-time users
- Keyboard shortcut help overlay (`?` key)

---

## 📝 For AI Agents: How to Work on This Project

1. **Always check `package.json`** for current dependencies before suggesting new ones
2. **Use `--legacy-peer-deps`** when running `npm install`
3. **Test in browser** — this is a visual/audio app; code changes need browser verification
4. **Don't add a framework** — the vanilla JS architecture is intentional and should be preserved
5. **Respect the audio timing model** — never use `setTimeout` for audio scheduling
6. **Update this file** when making significant architectural changes
7. **The design system is in `src/style.css`** — use existing CSS custom properties, don't invent new colors
8. **Snippet data is mutable** — Piano Roll edits mutate notes in place; be careful with references
10. **Dev server**: `npm run dev` → runs on `http://localhost:5173/`

<!-- --- NEW CONTEXT ADDED DURING RECENT UI SYNCHRONIZATION EFFORTS --- -->

## 🔄 UI Synchronization & State Management

**Initialization Order Gotcha**
- Components (like `CreativeMode`, `ScaleBoard`, `LoopProgress`) are instantiated in `main.js` constructor **before** the project is loaded from IndexedDB.
- `main.js` initially passes `null` for the project.
- Once the project loads (`_loadOrCreateProject()`), `main.js` injects the project reference via setters (e.g., `this.creativeMode.project = this.project`).
- **CRITICAL**: Sub-components MUST implement `set project(p)` setters to re-calculate state (e.g., `_updateNotes()`) and re-render. If a component just does `this.project = project` in its constructor, it will be permanently stuck with `null` defaults!

**Global Visual Effects & CSS Variables**
- The app background color is controlled via the `--surface-0` CSS variable defined in `:root` in `style.css`.
- Some full-screen panels (like `.edit-mode`) explicitly set `background: var(--surface-0)`.
- If you want to create a global background effect (e.g., the time signature visualizer pulsing on beats), **do not** use `document.body.style.backgroundColor`. Instead, use `document.documentElement.style.setProperty('--surface-0', color)`. This ensures seamless updates across all UI layers.

**Music Theory Note Generation**
- `MusicTheory.js` > `getScaleNotes` generates 32 notes by default (spanning multiple octaves). This allows dynamic UI components (like a 16-pad ScaleBoard) to receive enough notes. If you add new instruments, you can leverage this to get extended scale ranges instantly.

<!-- --- NEW CONTEXT ADDED DURING SESSION 2026-05-03 --- -->

## 🎛️ ScaleBoard Enhancements

**Balanced Grid Layout**
- Pads use a computed balanced grid: `grid-template-columns: repeat(ceil(sqrt(padCount)), 1fr)`. This replaces the old `auto-fit` approach. 7 pads → 3 cols, 16 pads → 4 cols.
- Grid also respects container width: `maxCols = floor((width - 4) / 72)`, ensuring minimum 72px column width for touch targets on mobile.
- `_refreshPads()` updates both `gridTemplateColumns` and `gridTemplateGap` dynamically.
- Window `resize` listener recalculates columns on orientation change or window resize.

**Pad Count Logic**
- `root` pad mode hides the Scale selector, shows the existing Root dropdown as `Root Note`, renders 12 chromatic pads for the current octave, and each pad plays a dyad: the pad note plus the selected root note in the octave nearest to that pad. Example: with root `C`, the `B4` pad plays `B4 + C5`, while the `D4` pad plays `D4 + C4`.
- In `single`/`chords` pad modes, pad count equals the scale's interval count (`SCALES[name].intervals.length`): Major → 7, Pentatonic → 5, Blues → 6.
- App version `0.1.3` adds an `Extensions` toggle for `single` and `chords` pad modes. When enabled, ScaleBoard continues the current scale naturally instead of stopping after the scale's first octave. Seven-note scales show degrees 1-13; five-note scales such as Pentatonic show 10 pads; six-note scales such as Blues show 12 pads. This is not a modifier/chord-color system: pad 9 is a real higher scale-degree pad, not a hold/toggle that changes another pad.
- The Extensions toast should report the actual rendered pad count (`Extensions: 10 scale pads`, `12 scale pads`, or `13 scale pads`) instead of hard-coding `1-13`.
- In Chords mode with Extensions enabled, extended pads are chord roots in the continued scale. Example in C major: pad 2 plays a D chord; pad 9 plays a D chord one octave higher. This keeps mouse/touch use direct and avoids hidden "current chord" state.
- The persisted setting is `project.settings.scaleExtensionsEnabled`. `CreativeMode` schedules autosave through `scaleBoard.onExtensionsChanged`.
- Keyboard mapping for Scale pads now supports up to 13 visible pads with `1-9`, `0`, `-`, `=`, and `` ` `` left-to-right. The mapping still ignores pads that are not currently visible.
- In `custom` pad mode, pad count comes from Settings → `scalePadsCount` slider (1–16).
- Changing scale or root recalculates pad count accordingly. `customPadTypes` array is trimmed to match current pad count.

**Custom Mode Clarity**
- Renamed the "Mode" label to "Pad Mode" to avoid confusion with musical modes.
- Pad type labels ("Note"/"Chord") are always visible in custom mode, not just during editing.
- Toast appears when switching to Custom: "Tap 'Edit Layout' to set each pad to Note or Chord."
- `.is-editing` CSS class adds dashed border + accent hover for layout editing state.

**Pad Sizing**
- Removed `aspect-ratio: 1` — pads now use `min-height: 56px` with `grid-auto-rows: minmax(56px, 1fr)` to fill vertical space.
- `align-content: start` + `overflow-y: auto` for graceful scrolling when pads overflow.

---

## 🎹 MicroPiano — Settings-Driven Dual Keyboard

**Settings Integration**
- Settings → Piano: **Pianos** dropdown (1 or 2), **Keys** slider (10–32 per keyboard).
- Defaults: `pianoCount: 1, pianoKeys: 12` in `ProjectStore.js`.
- Dispatches `settings-piano-changed` custom event on change. MicroPiano listens and re-renders.

**Dual Keyboard Layout**
- When `pianoCount === 2`: two `.micropiano__keyboard` elements stacked vertically inside `.micropiano__boards`.
- Piano A covers lower octave range, Piano B covers the next contiguous range (starts at `baseMidi + pianoKeys`).
- Octave ▼/▲ shifts both keyboards together. Display shows `A: Oct 3 · B: Oct 4`.
- `_maxBaseOctave()` ensures the total key range doesn't exceed MIDI 108 (C8): `max(1, floor((97 - totalKeys) / 12))`.

**CSS**
- `.micropiano__boards` uses `flex-direction: column` with `gap` for stacked keyboards.
- White key `min-height` reduced from 180px to 80px, black from 120px to 50px — flexible for many keys on mobile.
- Old `.micropiano--multi` and `_resizeObserver` auto-fit removed; layout is now settings-driven.

---

## 🥁 SketchKit — Expanded Drum Kit with Presets

**10 Drum Sounds** (up from 5)
- Original: Kick, Snare, Clap, Hi-Hat, Cymbal.
- New: **Tom Low**, **Tom Mid**, **Tom High**, **Rim**, **Shaker** — all synthesized.
- Sounds defined in `SOUNDS` array with `{ id, icon, label }`.

**Grid Layout**
- Same balanced grid as ScaleBoard: `grid-template-columns: repeat(ceil(sqrt(count)), 1fr)`.
- Settings → Drum Kit: **Number of Pads** slider (1–10). Dispatches `settings-pads-changed`.
- CSS uses `display: grid` with `grid-auto-rows: minmax(64px, 1fr)` and `align-content: center`.

**Drum Kit Presets** (`DRUM_KITS` export)
- **Classic** — balanced general-purpose sounds (sine/triangle oscillators).
- **808** — deep electronic TR-style (sine with click attacks, longer decays).
- **Electronic** — aggressive sawtooth/square (bright, glitchy).
- **Acoustic** — warm natural sounds (triangle oscillators, softer filters).
- Each kit parameterizes: oscillator type, frequency start/end, filter cutoff/Q, decay time, volume, optional click attack.
- Synthesis methods (`_synthTone`, `_synthSnare`, etc.) read from `this._activeKit.sounds[sid]`.
- Kit selector dropdown (`#sk-kit-select`) rendered inside the SketchKit component (not the global patch selector).
- Swap buttons (⇄) removed — each sound is now its own pad.

**CSS**
- `.sk-kit-selector` at top of SketchKit with label + styled select.
- Each pad type has a distinct active color via `.sketchkit__pad--{type}.is-active`.
- Removed old `.sketchkit__pad-wrapper` and `.sketchkit__swap-btn` styles.

---

## ♫ Arpeggio & Hold System

**ArpeggioManager** (`src/engine/ArpeggioManager.js`)
- Three modes cycling via transport bar button: **OFF → HLD → ARP → OFF**.
- **OFF**: Normal playback — synth passes through unmodified.
- **HLD** (Hold): Notes latch on first press, release on second press. Auto-release after configurable `holdDuration` (default 3s, slider 1–30s in Settings). Uses `setTimeout` per latched note.
- **ARP** (Arpeggio): Holds trigger repeated strikes at configurable rate. 15ms grouping window detects chords vs single notes. Single notes repeat the same pitch at the arp rate. Chords arpeggiate through individual notes in the selected pattern.

**Settings → Arpeggio**
- **Rate**: 1/4, 1/8, 1/16, 1/32.
- **Chord Type**: Major, Minor, Diminished, Augmented, Suspended, Major 7th, Minor 7th, Dominant 7th, Half dim/Min 7b5, Fully dim 7th. Each defines `semitones` array for chord generation.
- **Pattern**: Up, Down, Up/Down, Random.
- **Hold Duration**: 1–30s slider (stored as milliseconds in `holdDuration`).

**Architecture — Synth Wrapping**
- `ArpeggioManager.wrapSynth(synth)` overrides `synth.noteOn`/`synth.noteOff` in place.
- Instrument classes (ScaleBoard, MicroPiano) call `synth.noteOn` as normal — arpeggio manager intercepts.
- **Drum kit is NOT affected** — SketchKit calls `this._triggerSound()` directly, bypassing the synth wrapper.
- All `_real*` calls guarded via `_safeNoteOn`/`_safeNoteOff`/`_safeAllOff` that silently no-op if synth hasn't been wrapped yet (prevents crashes before audio init).
- ARP stepping uses `setTimeout` at BPM-timed intervals. Each step plays for ~55% of the interval, then releases for ~45% silence — creating distinct audible strikes.

**Transport Bar Toggle**
- Button `#btn-arp` between BPM and spacer. Cycles through OFF/HLD/ARP.
- `setArpLabel(mode)` updates text: "OFF", "HLD" (accent color), "ARP" (red glow).
- Wired via `transportBar.onArpClick` in `main.js`.

---

## 🎤 Mic Recording & Audio Playback

**Mic — Transport Integration**
- Mic recording now starts/stops with the transport record button (when Mic instrument is active).
- Transport state change handler: `RECORDING + MIC → _startRecording()`, `!RECORDING + _isRecording → _stopRecording()`.
- Manual Mic button still works independently for quick captures.

**Audio Snippet Creation**
- `_startTime` timestamp tracked inside `MicRecorder._startRecording()` itself.
- Snippet duration calculated from `Date.now() - _startTime` → converted to ticks using current BPM.
- Snippets created as `type: 'audio'` with `audioUrl` (blob URL).
- Old `_micElapsed`/`_micStartTime` approach removed — start time now always set regardless of how recording is triggered.

**Audio Playback** (`PlaybackEngine.js`)
- Audio snippets decoded via `fetch` + `AudioContext.decodeAudioData`, cached in `_audioBuffers` Map by snippet ID.
- Playback uses `AudioBufferSourceNode` connected through master gain.
- Fires when `localTick === 0` for the clip (plays once at clip start).

**Audio in Inspect Panel**
- Clicking audio snippet opens Inspect with `<audio controls>` HTML5 player, showing BPM and beat duration.
- Audio snippets skip the piano roll editor entirely (`loadSnippet` checks `snippet.type === 'audio'`).
- Empty state text updated: "Select a MIDI snippet to view and edit its notes in the piano roll."

**Canvas Integration**
- Tracks with audio clips hide the instrument dropdown, showing a "LINE Audio" label instead.
- Check: `track.clips.some(c => c.snippet?.type === 'audio')`.

---

## ✂️ Trim Empty Space

**Canvas Trim Button**
- **✂️ Trim** button in Canvas toolbar (next to zoom buttons).
- `_trimEmptySpace()` method:
  1. Scans all snippets for `minTick` (earliest note start) and `maxTick` (latest note end).
  2. Shifts all notes/hits so earliest starts at tick 0.
  3. Truncates `durationTicks` to actual content length (rounded up to nearest beat).
  4. Updates all clips' `durationBars` to match new `durationTicks`.
  5. Calls `_autoSetLoopFromClips()` to recalculate loop region.
- Shows toast: "Trimmed empty space" or "Nothing to trim".

---

## 🔁 Loop Auto-Calculation

**Loop Bars Dropdown Removed**
- The "Loop length" dropdown (1/2/4/8 bars) removed from TransportBar.
- Loop region now auto-derived from clips on the timeline.

**`_autoSetLoopFromClips()`** in CanvasMode.js
- Iterates all tracks' clips to find `max(startBar + durationBars)`.
- Defaults to 4 bars minimum when timeline is empty.
- Called after every clip mutation: drop, move, delete, plus initial render and refresh.
- Calls `transport.setLoop(0, maxEndBar)`.

---

## ✏️ EditMode → Inspect

**Tab Renamed**
- ModeTabs: "Edit" → "Inspect" (bottom tab label and empty state).
- Empty state message: "Select a MIDI snippet to view and edit its notes in the piano roll."

**Piano Roll Enhancements**
- Vertical zoom: `+`/`-` buttons adjust `_noteHeight` (8–24px). CSS var `--note-height` updates dynamically.
- Octave range: Two dropdowns (Low/High octave: C1–C6) replace hardcoded `PITCH_MIN=36, PITCH_MAX=84`.
- Split view: "Split" button toggles dual vertically-stacked piano rolls, each with independent octave range and key sidebar. Notes render in whichever pane's range they fall into. Mobile-friendly vertical stacking.
- All rendering refactored into `_renderRollPane()`, `_renderKeysForRange()`, `_renderGridForRange()`, `_renderNotesForPane()`, `_createNoteElementForPane()`.

---

## 📋 Snippet Renaming

**Name Propagation**
- `SnippetTray._renderSnippets()` now displays `s.name` if set, falling back to `"N notes · M bars"`.
- `EditMode._bindEvents()` fires `onSnippetRenamed` callback after name save.
- `main.js` wires it: `editMode.onSnippetRenamed = () => snippetTray._renderSnippets()`.
- `RecordingManager._finalizeSnippet()` auto-generates `name: "N notes"` on snippet creation.

**Recording Duration**
- `_finalizeSnippet()` no longer uses `loopLengthTicks`. Instead scans captured notes for `maxEndTick`, rounds up to nearest beat. Snippets end where the last note ends, not where the loop does.

---

## 🎼 Sheet Music — Percussion & Filtering

**Audio Filtering**
- Sheet music dropdown filters out `type: 'audio'` snippets. Only MIDI and drum appear.
- Selection now uses snippet IDs instead of array indices — robust against filtering and reordering.
- First MIDI snippet auto-selected on panel open.
- Exported SVG filenames use the snippet name.

**Percussion Notation**
- Drum snippets render with `clef=perc` in ABC output.
- Each drum type mapped to standard percussion staff position: kick→B,,, snare→D,, hi-hat→^F,, toms→C,/F,/G,, etc.
- ABC title includes "(Drums)" suffix.
- Dropdown shows 🥁 prefix for drum snippets: `🥁 My Beat (8 events)`.

---

## 🎨 UI/UX Changes

**Transport Bar**
- BPM input widened from 48px to 56px (no more cut-off text).
- Hold/Arp toggle button (`#btn-arp`) between BPM and spacer. Styles: `.arp-toggle.is-hold` (accent), `.arp-toggle.is-arp` (record red glow).
- Loop length dropdown removed.

**Settings Panel**
- Piano section: Pianos (1–2 dropdown) + Keys (10–32 slider).
- Drum Kit section: Number of Pads (1–10 slider).
- Arpeggio section: Rate (dropdown), Chord Type (dropdown), Pattern (dropdown), Hold Duration (1–30s slider with live display).
- All `display` spans update live as sliders move.

**ProjectStore Defaults**
- Added: `pianoCount: 1, pianoKeys: 12, drumPads: 10, arpRate: '1/8', arpChordType: 'major', arpPattern: 'up', holdDuration: 3000`.

**CSS**
- Canvas: `.canvas-lane__inst-label` for "LINE Audio" instrument display on audio tracks.
- Edit/Inspect: `.piano-roll-pane` for split view, `.edit-audio` for audio player, `.edit-toolbar .btn.is-active` for split button state.

<!-- --- NEW CONTEXT ADDED 2026-05-03 (SESSION 2) --- -->

## ⏱️ Duration Logic Consistency

**Problem**: Canvas clips used `Math.ceil(durationTicks / ticksPerBar)` for `durationBars`, rounding to whole bars. A 5-beat clip displayed as 2 bars wide on Canvas but only showed content through beat 2.1 in Inspect. Same data, conflicting visual representations.

**Decision**: All time representation should be consistent across views. The data model uses ticks (480/beat) as the canonical unit — tempo-relative, correct for sheet music and clip arrangement. The fix was to make Canvas and Inspect agree on the visual interpretation.

**Fix**:
- **`clip.durationBars` is now a float**: `snippet.durationTicks / ticksPerBar` (e.g., 1.25 for 5 beats in 4/4). No `Math.ceil` rounding. Clip pixel width = `durationBars * barWidth` — exact content width.
- **Canvas ruler matches Inspect**: Shows `1.1, 1.2, 1.3, 1.4, 2.1, 2.2...` (bar.beat format) instead of whole bar numbers. Bar boundaries (beat 1) are bold/accent, other beats subtle. Same labels in both views — no mental translation.
- **All `durationBars` setters updated**: Drop handler, touch drag handler, and `_trimEmptySpace` all use float division. `_autoSetLoopFromClips` still works correctly with float addition.
- **Why not pure seconds/milliseconds?** Switching would require rewriting the transport scheduler, recording system, ABC export, PlaybackEngine, and data model — all built on 480 ticks/beat. Ticks are tempo-relative: the same tick count means the same musical duration regardless of BPM. This is what sheet music and clip arrangement need.

**Ruler CSS**: Added `.canvas-ruler__beat` class (8px font, centered) alongside existing `.canvas-ruler__bar`. Beat markers are narrower, bar-number markers get inline bold styling.

---

## 📱 iOS / Mobile Fixes

**AudioContext — Synchronous Init**
- iOS Safari requires `AudioContext` creation AND `resume()` in the same synchronous call stack as the user gesture. Using `async/await` in the event handler broke this — Chrome rejected the `resume()` because the gesture context expired during the `await`.
- **Fix**: Added `AudioEngine.initSync()` — creates context and calls `resume()` immediately. Also plays a 10ms silent oscillator burst (gain 0.001) because iOS requires actual AudioContext *usage* (e.g., `createOscillator` + `start`), not just `resume()`.
- Event handler now uses synchronous `initAudio()` instead of `async`. Catches init failures and falls through.
- **Persistent resume**: A handler on `pointerdown`/`keydown`/`touchstart`/`touchend` calls `ctx.resume()` every touch until the context is running. Added `touchend` specifically because iOS prefers it for audio gestures.
- **Visibility change**: Resumes context when page becomes visible again (iOS suspends on background).

**Touch Drag-and-Drop for Canvas Dock**
- iOS Safari doesn't support HTML5 `dragstart`/`dragover`/`drop` events with touch.
- **Fix**: Added `touchstart`/`touchmove`/`touchend` handlers to canvas dock items. Creates a floating clone on drag, drops onto the lane under the finger via `document.elementFromPoint()`. Minimum drag threshold of 10px to distinguish from tap. Works alongside existing desktop drag events.

**Pinch/Zoom Prevention**
- **CSS**: `touch-action: manipulation` on `html` and `body` — prevents double-tap zoom and pinch gesture.
- `user-select: none` on everything except form inputs.
- `overscroll-behavior: none` — prevents pull-to-refresh.

**Mobile Transport Bar Dropdown**
- On screens ≤560px, the right-side items (ARP toggle, Pitch/Mod display, metronome, keys help, settings) collapse into a `⋯` dropdown button.
- **CSS**: `.transport-bar__more` hidden by default in mobile, shown when `.is-open` class toggled via the `#tb-more-btn` click. Positioned absolutely below the transport bar with `top: 100%` (adapts to bar height). `z-index: 100` with shadow.
- **ARP toggle moved into the dropdown** — was previously outside `.transport-bar__more`, pushing the ⋯ button off-screen on iPhone 15 (393px).
- Breakpoint: `@media (max-width: 560px)`.

---

## 🔍 Inspect Mode — Empty State Dropdown

- When no snippet is loaded, Inspect's empty state now shows a `<select>` listing all non-audio snippets with icons: `🎵 Melody (15 notes)` or `🥁 Drums (8 hits)`.
- Selecting a snippet loads it directly into the editor.
- CSS: `.edit-empty__select` styled to match the app design system.

---

## 🏷️ Auto-Updating Snippet Names

- Auto-generated names matching `/^\d+\s+(notes|hits)$/` (e.g., "20 notes") are now dynamically updated when the note count changes via editing.
- `_onEdit()` checks the pattern and updates `this._snippet.name` and the name input field.
- Custom-named snippets are left unchanged.

---

## 🛑 Recording Stability

**No More Loop Auto-Finalize**
- Removed the `onLoop` subscription in `RecordingManager.init()`. Previously, every loop wrap finalized a snippet, cutting recordings at the loop boundary (default 4 bars).
- Now recordings only finalize when the user hits Stop — record as long as you want.

**Duplicate Subscription Guard**
- Added `_initialized` flag to `RecordingManager.init()` — prevents duplicate transport state subscriptions if init is called multiple times.
- `setArmed(false)` now finalizes held notes (not just clears them) to prevent losing notes on transport state transitions.

**Missing Methods Restored**
- `onSnippetCreated()`, `setModManager()`, `captureModulation()` were accidentally lost in a file edit. All three restored.

---

## ✂️ Canvas Clip Controls

**Modifier Key Actions** (matching Inspect):
- **Ctrl+click** (Cmd on Mac) on a clip → delete it instantly.
- **Alt+drag** the right edge → resize (shrink only), erasing notes that fall past the new end.
- **Regular drag** → move the clip (unchanged).

**Alt+drag resize details**:
- Snaps to 1/4 beats via `this.beatWidth` (not whole bars).
- `Math.min(startWidth, startWidth + dx)` ensures clips can only shrink, never extend.
- Filters out `notes` and `hits` with `startTick >= newEndTick`.
- Updates `snippet.durationTicks` and saves.

---

## 🎮 Controller Mode — Octave Release

- `_releaseAllNotes()` fires before changing octaves via bumpers. Prevents stuck notes when holding a button while shifting octaves.

---

## 📈 Modulation Playback & Visual Indicators

**Playback Formula Fixed**
- `PlaybackEngine._applyModulation()` now uses the same filter formula as `ModulationManager._applyMod()`: `400 + (modulation / 2) * 7600` Hz.
- Previously used `8000 + modulation * 1000` which produced a much narrower, less audible range.

**Visual Modulation/Pitch Lines on Clips**
- Each Canvas clip now renders a thin 10px SVG overlay when its snippet has `modulation[]` data.
- **Orange path** = pitch bend (height scales with absolute bend value).
- **Pink path** = modulation (height scales with modulation level).
- Transparent when values are 0, becomes visible when there's activity.
- `_renderModOverlay()` creates the SVG inline; `.canvas-clip` CSS changed to `overflow: visible`.

---

## ⚙️ GitHub Pages Deploy Configuration

**Workflow Fix** (`deploy.yml`):
- `node-version` bumped from `18` to `22` (Vite 8.x requires Node 20.19+).
- `npm install --legacy-peer-deps` added (vite-plugin-pwa@1.2.0 doesn't declare Vite 8.x compatibility but works fine).

**Vite Config**:
- `base: '/Notenotes/'` added so assets load from the correct subdirectory on GitHub Pages.
- PWA `start_url` changed to `/Notenotes/`.

**README**:
- Node.js prerequisite updated from 18+ to 20+.

<!-- --- NEW CONTEXT ADDED 2026-05-03 (CODEX TIMING REVIEW) --- -->

## ⏱️ Transport Visual Timing vs Scheduler Lookahead

**Problem**: The Transport scheduler used to reset `_startTime` / `_startTick` inside `_schedulerTick()` when it saw a loop boundary inside the 100ms lookahead window. Because Canvas playhead and LoopProgress read `transport.currentTick` on `requestAnimationFrame`, visuals could wrap early, before the scheduled audio actually reached the loop boundary.

**Fix**:
- Scheduler lookahead no longer mutates playback start anchors.
- `currentTick` is now the loop-normalized tick for visuals/playback.
- `currentRawTick` is the unlooped tick for long recordings.
- Loop callbacks are emitted by comparing raw loop-cycle numbers and receive the scheduled `audioTime`.

**Important Pattern**: Do not use scheduler lookahead state as visual clock state. Visuals should derive from `AudioContext.currentTime` and stable playback anchors, then normalize into the active loop only at read time.

**Recording Note**: MIDI recording uses `currentRawTick` so recordings can continue past loop boundaries. Stop/pause state-change callbacks receive `{ tick, rawTick }` metadata so held notes can finalize before the transport rewinds visually.

<!-- --- NEW CONTEXT ADDED 2026-05-03 (PROJECT TIME SIGNATURES) --- -->

## 🎼 Project-Level Time Signatures

**Supported Scope**: Notenotes supports one project-level time signature at a time: 2/4, 3/4, 4/4, or 5/4. These are intentionally quarter-note pulse meters. Do not add timeline meter changes yet without introducing a proper meter map.

**Conversion Rule**: Changing the project time signature preserves absolute tick positions. Clips store visual placement as `startBar` / `durationBars`, so `SettingsPanel._setProjectTimeSignature()` converts existing clips through absolute ticks:
- old `startTick = clip.startBar * oldTicksPerBar`
- old `durationTicks = clip.snippet.durationTicks`
- new `clip.startBar = startTick / newTicksPerBar`
- new `clip.durationBars = durationTicks / newTicksPerBar`

This means the music sounds at the same tick positions, while the bar lines and bar.beat labels move around it. A 4/4 clip can therefore become a fractional number of bars in 3/4 or 5/4.

**Known Boundary**: Avoid 6/8, 7/8, 12/8, and mid-song meter changes until the app has explicit UX and engine support for denominator/pulse semantics. The current transport treats `timeSignature.beats` as the beat count and keeps one beat equal to 480 ticks.

### Future Non-x/4 Time Signatures

Supporting denominators other than `4` is feasible, but it is not just adding more dropdown rows.

Current behavior:

- `Transport.ticksPerBeat` is always `480`.
- `Transport.secondsPerBeat` is always `60 / bpm`.
- `Transport.ticksPerBar` is currently `ticksPerBeat * timeSignature.beats`.
- Canvas and Inspect rulers use `timeSignature.beats` as "visible beats per bar."
- Quantizer names such as `1/4`, `1/8`, and `1/16` are relative to the quarter-note beat model.
- `timeSignature.subdivision` is stored but mostly not used for timing math.

This means a stored `{ beats: 6, subdivision: 8 }` would not crash, but it would be musically wrong: the app would treat it like six quarter-note pulses per bar, not six eighth-note pulses per bar.

Use these definitions before expanding support:

```js
const QUARTER_TICKS = 480;
const beatUnitTicks = QUARTER_TICKS * (4 / timeSignature.subdivision);
const ticksPerBar = beatUnitTicks * timeSignature.beats;
```

Examples:

- `4/4`: beat unit = quarter note = `480` ticks, bar = `1920` ticks.
- `3/4`: beat unit = quarter note = `480` ticks, bar = `1440` ticks.
- `6/8`: beat unit = eighth note = `240` ticks, bar = `1440` ticks.
- `12/8`: beat unit = eighth note = `240` ticks, bar = `2880` ticks.

The hard UX/music question is BPM meaning:

- For simple meters like `3/4` and `4/4`, BPM usually means quarter notes per minute.
- For `6/8`, users often feel two big dotted-quarter pulses per bar, even though the notation has six eighth notes.
- If Notenotes shows `120 BPM` in `6/8`, we must decide whether that means 120 eighth-note pulses, 120 quarter-note pulses, or 120 dotted-quarter felt beats. Each choice changes playback speed or user expectations.

Recommendation:

- Keep current public support limited to `x/4` for beta.
- When adding `x/8`, add an explicit internal concept of `beatUnitTicks` and do not reuse `ticksPerBeat` ambiguously.
- In UI, consider labeling these as meter presets with plain names, for example `6/8 - rolling two-feel`, rather than exposing arbitrary numerator/denominator inputs.
- Do not add free-form custom denominators until the app has a tested meter helper module and export behavior.

Clip conversion rule should stay based on absolute ticks:

- Notes, hits, and audio snippets keep their `startTick`, `durationTick`, and `durationTicks`.
- When changing project meter, convert Canvas placement through absolute ticks:
  - `startTick = clip.startBar * oldTicksPerBar`
  - `newStartBar = startTick / newTicksPerBar`
  - `durationBars = snippet.durationTicks / newTicksPerBar`
- This preserves how the music sounds in time. Only bar lines and labels move.

What not to do:

- Do not "stretch" notes when switching from `4/4` to `6/8` unless the user explicitly asks for a separate rhythmic reinterpretation feature.
- Do not make old clips conform to whole bars automatically. Fractional bars are acceptable and honest.
- Do not support meter changes inside one Canvas arrangement without a meter map. A single `project.timeSignature` cannot represent "intro in 4/4, bridge in 6/8."

Safer staged plan:

1. Extract meter math into a small helper module, e.g. `Meter.js`.
2. Add tests for `ticksPerBar`, ruler labels, clip placement conversion, and duration conversion across `2/4`, `3/4`, `4/4`, `5/4`, `6/8`, and `12/8`.
3. Update Transport, Canvas, Inspect, RecordingManager, Quantizer labels, MIDI export, WAV export, and sheet music export to use the helper.
4. Add only a few curated `x/8` meters first, probably `6/8` and `12/8`.
5. Keep project-level meter only. Revisit per-section meter maps later.

### Time Signature Product Boundary

Use curated meter presets, not arbitrary custom time signature inputs.

Supported for beta:

- `2/4`
- `3/4`
- `4/4`
- `5/4`

Reason:

These are simple quarter-note pulse meters. They fit the current engine model, visual beat dots, Canvas ruler, quantizer labels, recording logic, and export paths without introducing a second concept of "felt beat."

Reasonable next expansion:

- `6/8`
- `9/8`
- `12/8`
- possibly `2/2`, if the UI explains its pulse clearly

Do not treat these as plain numerator/denominator math only. They need musical grouping/felt-pulse metadata.

Examples:

```js
{
  beats: 9,
  subdivision: 8,
  grouping: [3, 3, 3],
  feltBeats: 3
}
```

For `9/8`, users usually feel three large pulses, each split into three eighth notes. Showing nine identical beat dots or treating BPM as nine equal main beats is likely confusing. The UI should make the grouping visible, or Notenotes should not expose the meter yet.

`2/2` is mathematically easy but musically/UX-sensitive. If BPM is literal, `120 BPM` in `2/2` means 120 half-note pulses per minute, not the same thing as `4/4` at 120. Do not add it unless the app can label the pulse clearly.

Avoid for now:

- free-form custom meters
- arbitrary denominators such as `/16`
- advanced odd meters such as `11/16`, `13/8`, or `7/16`
- mixed meter inside one Canvas
- automatic rhythmic reinterpretation when changing meter

Policy:

If a meter cannot be represented honestly with the current UI, do not expose it. Notenotes should prefer fewer clearly understood meter choices over a long dropdown that gives users mathematically valid but musically misleading results.

<!-- --- NEW CONTEXT ADDED 2026-05-04 (AUDIO IN + KEYBOARD PERFORMANCE) --- -->

## 🎹 Hardware Keyboard Performance & Audio In

**Creative Mode mappings**:
- Scale Board: number row `1`–`9`, `0` hold visible scale pads 1–10.
- SketchKit: number row `1`–`9`, `0` trigger visible drum pads 1–10.
- MicroPiano: `` ` 1 2 3 4 5 6 7 8 9 0 - = `` hold visible piano keys left-to-right.
- `ArrowUp` / `ArrowDown` shift octave only for the currently active Scale Board, MicroPiano, or Controller screen. Kit and Audio In ignore octave arrows.
- These mappings are scoped to Creative Mode and the active instrument. They run in capture phase so they can override global pitch/mod shortcuts when appropriate.

**Input method pattern**:
- `ScaleBoard.pressPad()` / `releasePad()` and `MicroPiano.pressMidi()` / `releaseMidi()` are the canonical methods for both pointer and keyboard input.
- `SketchKit.triggerPad()` is the canonical method for pointer and keyboard drum hits.

**Audio In**:
- The former Mic tab is labeled **Audio In**.
- `MicRecorder` now includes an audio input selector. Browser device labels usually appear only after the first successful `getUserMedia()` permission grant.
- Recording MIME type uses `MediaRecorder.isTypeSupported()` fallback (`audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`, `audio/aac`) instead of assuming WebM, which is important for Safari/iOS.
- The live meter uses time-domain RMS with a small silence gate. This avoids showing misleading frequency-bin movement from noise floor or stale analyser data on quiet/disconnected inputs.

**Canvas / Controller visuals**:
- Audio snippets render a deterministic lightweight bar waveform preview in Canvas. It is intentionally a visual presence indicator, not decoded waveform analysis.
- Controller Mode uses `public/controller.png` as the base controller art with absolute-positioned highlight overlays for D-pad, face buttons, bumpers, and sticks.

<!-- --- NEW CONTEXT ADDED 2026-05-04 (INITIAL TIMING SYNC + INSPECT QUANTIZE) --- -->

## ⏱️ Initial Timing UI Sync

- `TransportBar.render()` runs before the saved project is loaded, so it initially draws beat dots from the default `4/4` transport.
- After loading a project, `main.js` must call `transportBar.syncFromTransport()` after assigning `transport.bpm` and `transport.timeSignature`. This keeps the BPM input and beat-dot count correct for saved projects such as `5/4`.
- Settings changes still use the `project-time-signature-changed` event path for live updates.

## ✏️ Inspect Quantize All

- Inspect's `Quantize all` button appears to the right of `Split` for MIDI-note snippets only.
- It sets every note's `durationTick` to the current Inspect grid size (`1/2`, `1/4`, `1/8`, or `1/16`) without changing `startTick` or pitch.
- It affects only the currently loaded snippet/clip in Inspect. Drum snippets are excluded because drum hits do not have note durations.

<!-- --- NEW CONTEXT ADDED 2026-05-04 (TONE / FRIENDLY SOUND EFFECTS) --- -->

## Tone / Friendly Sound Effects

Tone is the current lightweight sound-shaping layer. It is intentionally simple sliders, not a full DAW effects rack.

### Supported Tone Options

The shared trait ids live in `src/instruments/WebAudioSynth.js`:

```js
crush, echo, space, wobble, drive, noise
```

Canonical shape:

```js
soundTraits: {
  crush: { amount: 0 },
  echo: { amount: 0 },
  space: { amount: 0 },
  wobble: { amount: 0 },
  drive: { amount: 0 },
  noise: { amount: 0 },
}
```

Rules:

- `amount` is normalized from `0` to `1`.
- `0` means off. There is no separate enabled checkbox.
- Use `normalizeSoundTraits()` before storing, comparing, or applying Tone state.
- Older `{ enabled: false }` shapes are still tolerated by normalizers and WAV export helpers.

### Current Tone vs Recorded Tone

`project.settings.soundTraits` is the current/default Tone state used by Create mode.

MIDI and drum snippets can store a base snapshot:

```js
snippet.soundTraits
```

Individual MIDI notes and drum hits can also store per-event Tone:

```js
note.soundTraits
hit.soundTraits
```

This matters for controller triggers. LT/RT are hotswitches, so a trigger effect should apply to the note/hit played while the trigger is active, not the whole clip.

### Controller Trigger Assignments

Controller trigger assignments are project settings:

```js
project.settings.controllerToneAssignments = {
  leftTrigger: "none",
  rightTrigger: "none",
}
```

`ControllerMode.currentSoundTraits(baseTraits)` overlays active trigger pressure on top of the base Tone. It must not write trigger pressure back into `project.settings.soundTraits`.

The UI shows green `LT`, `RT`, or `LT/RT` beside the main `Tone` button while a trigger override is active.

### Live Audio Routing

`WebAudioSynth` owns the synth Tone chain:

- voices connect into `_toneInput`
- `_rebuildEffects()` builds Crush, Drive, Wobble, Echo, Space, and Noise behavior
- `setSoundTraits()` rebuilds the chain

`SketchKit` owns a parallel drum Tone chain:

- drum voices connect into `_toneInput`
- the Kit screen has its own `Tone` button next to the kit dropdown
- Kit Tone writes through the same project `soundTraits` path for consistency

`CreativeMode._applyProjectSoundTraits()` is the main bridge that writes project state and applies it to both synth and kit.

### Recording

`RecordingManager` has two Tone providers:

- `setBaseToneProvider()` captures the base snippet Tone
- `setToneProvider()` captures the current live Tone, including temporary trigger overrides

On MIDI note-on, the current live Tone is copied to `note.soundTraits`.
On drum hit, the current live Tone is copied to `hit.soundTraits`.
On snippet finalize, the base Tone is copied to `snippet.soundTraits`.

Do not change this back to "one snapshot at the end of recording" because that makes one trigger press smear across the entire clip.

### Playback And Export

Playback priority:

```js
note.soundTraits || hit.soundTraits || snippet.soundTraits || project.settings.soundTraits
```

WAV export mirrors this logic in `src/export/WavExporter.js`.

MIDI export cannot carry Notenotes Tone in a reliable standard way. MIDI export should preserve notes, hits, and timing only. If Tone data matters, the project/snippet JSON backup is the canonical format.

---

## Backup Audio Portability

Workspace and snippet JSON backups are meant to be portable across browsers/devices. When an audio snippet in a backup includes `audioDataUrl`, `ProjectStore.migrateSnippetsAudioAssets()` must treat that embedded data as authoritative and save it as a local IndexedDB audio asset, even if the snippet also has an old `audioAssetId`.

Reason:

- `audioAssetId` only points to the original browser's IndexedDB audio asset store.
- A different browser/device will not have that asset id.
- If import kept the old id and later sanitized `audioDataUrl`, the recording could become unavailable.

Rule:

On import/migration, embedded `audioDataUrl` should always be converted into a fresh local audio asset before storage. Temporary `blob:` URLs are still unrecoverable after reload and should be marked unavailable.

---

## App Versioning

Current App Version: `0.1.13`

The visible app version is displayed in Settings. Bump it for meaningful user-facing changes or architecture/storage changes, especially when AI.MD is updated for completed work.

Keep these in sync:

- `src/version.js`
- `package.json`
- `package-lock.json`
- this section of `AI.MD`

---

## Canvas, Inspect, and Save Cleanup

App version `0.0.42` addresses a QA pass around Canvas arrangement safety, audio snippet naming, Inspect shadows, and cleanup of local save data.

### Audio clip playback

- `PlaybackEngine._processTick()` now treats audio tracks as first-class audio tracks instead of trying to read `instDef.type` from an undefined instrument definition.
- Audio clips on Canvas call `_playAudioClip(snippet, nextTickTime)` so they start on the scheduler's audio clock instead of `ctx.currentTime`.
- The track/type guards are still strict: audio snippets only play on audio tracks, drum snippets only on drum tracks, and MIDI snippets only on MIDI tracks.

### Inspect audio naming

- Audio snippets in Inspect now render an editable `.edit-audio__name-input`.
- Blur or Enter commits the name back to `snippet.name`, schedules autosave, fires `onSnippetRenamed`, and updates the snippet tray through the existing callback path.
- Audio Inspect remains preview-only beyond naming. Destructive audio trim/normalize/gain editing is still future work.

### Inspect shadow parity

- Drum Inspect can now choose either drum or MIDI snippets in the one-clip `Shadow` dropdown.
- Drum shadows still render as red hit references. MIDI shadows inside the drum editor render as green reference blocks, mapped roughly from pitch range 36-84 onto the visible drum rows.
- This MIDI-on-drum shadow is only an alignment guide. It does not imply that a MIDI pitch maps to a specific kit sound, and it is not exported or persisted.

### Canvas overlap prevention

- Canvas clip placement now resolves through `_resolveClipStart(track, clip, desiredStartBar, durationBars)`.
- New drops, touch drops, and clip drags refuse overlapping final positions.
- When a dragged/dropped clip approaches another clip edge, the resolver snaps it to the nearest legal before/after edge. If no legal position exists, the clip is not added and the user sees `No room for that clip on this track`.
- `Alt+drag` clip resize remains shrink-only, but it now caps against the next clip so trimming cannot create overlap.

### Drum track selector parity

- Drum Canvas tracks now render the same compact track instrument `<select>` shape as MIDI tracks.
- The only built-in option today is `Drum Kit`, but this keeps the UI ready for custom kit-style instruments without changing the track header again.

### History and milestone cleanup

- Workspace import now replaces both snapshot stores even when a backup does not include milestones or versions. This intentionally clears stale local version history/milestones when restoring a workspace-only backup.
- `ProjectStore` exposes `deleteVersion`, `clearVersions`, `deleteMilestone`, and `clearMilestones`.
- Settings -> Save now has per-entry Delete buttons and Clear buttons for Version History and Milestones. All destructive actions use `confirm()` before deleting.
- After snapshot deletes, `garbageCollectAudioAssets()` runs so audio assets that are only referenced by deleted snapshots can be cleaned up.

### QA note wording

The old manual QA wording "decoded duration differs from stored snippet duration" was removed because it asked the tester to reason about browser internals. The current QA wording is a plain listening test: record real Audio In, place it on Canvas, export/play it, and confirm the audible length sounds like what was recorded without surprise leading silence, cutoff, or a long empty tail.

### Version history limit behavior

- App version `0.0.44` changes Settings -> Save -> Version History -> Keep so it calls `ProjectStore.pruneVersions(project)` immediately.
- The project is saved, old version snapshots beyond the selected limit are deleted, the history list is reloaded, and storage status refreshes in the same interaction.
- Do not rely on a later autosave or page refresh to make the selected limit visible.

---

## Canvas Drum Kit Parity

App version `0.0.43` makes Canvas drum tracks use the same kit list as the Kit playing screen.

- `CanvasMode` imports `DRUM_KITS` from `SketchKit` and renders built-in kit options (`Classic`, `808`, `Electronic`, `Acoustic`) in the drum track instrument dropdown.
- Drum tracks now store the selected built-in kit id directly, such as `classic` or `eight08`. Legacy `kit` still aliases to `classic`.
- `_normalizeTrackType()` treats `kit`, built-in drum kit ids, and custom kit ids as drum instruments so older projects and newer selected-kit tracks keep their lane type.
- `PlaybackEngine` recognizes built-in drum kit ids as `type: 'kit'` instrument definitions and calls `SketchKit.loadKit()` before firing hits for that drum track.
- Canvas WAV export passes the selected built-in kit id into the offline drum renderer so exported Canvas WAVs roughly follow the selected kit instead of always sounding like Classic.
- Export job objects carry `kitId`; do not read `track.instrumentId` inside the final jobs render loop because that loop only has queued `job` data.
- MIDI export only needs to know the track is a drum track, so it now also recognizes built-in kit ids for type detection. MIDI cannot encode Notenotes kit sound design itself.
- Custom kit instruments still appear in the Kit screen's selector, but the sample-based custom kit playback path remains scaffolded. Do not promise custom kit sound parity in Canvas until `SketchKit._activeKit` can render those sample instruments.

---

## Audio Upgrade Milestone 0.1.0

App version `0.1.0` starts the audio/export upgrade plan with no new dependencies, no WAV impulse assets, no AudioWorklet, and no OfflineAudioContext rewrite. The design goal is audible trust: Canvas WAV export should sound like the patch and Tone choices the user heard in the app, even if live and procedural export are not bit-identical.

### Patch-aware Canvas WAV export

- `src/export/WavExporter.js` now imports `PRESETS` and renders MIDI notes through `renderPatchTone()` instead of the old fixed sine-plus-square fallback.
- `projectToWavBlob()` attaches the MIDI track's built-in synth patch to each export job and passes that patch into `renderMidiWithTone()`.
- The procedural export renderer supports the existing v1 patch shape: primary oscillator type/detune, optional `oscillator2` type/detune/gain, ADSR envelope, filter type/frequency/Q, patch gain, and drive.
- Individual snippet WAV export still has no durable built-in patch identity unless a caller provides `options.patch`. It defaults to `chip_lead`. This is intentional for now because snippets historically stored notes, not which synth preset happened to be selected when they were recorded.
- Custom sample instruments still use `renderMidiWithCustomInstrument()` and are not routed through `renderPatchTone()`.

### Schema-v2 synth motion fields

`WebAudioSynth` now accepts these optional patch fields:

- `schemaVersion`: currently `1` for legacy patches and `2` for patches that deliberately use new motion fields.
- `family`: `chip` or `modern`, used for UI grouping.
- `filterEnv`: optional filter frequency envelope `{ attack, decay, sustain, depth }`.
- `vibrato`: optional per-voice LFO `{ rate, depth, delay }`, with depth in cents.
- `unison`: optional oscillator stack `{ voices, spread }`, clamped to 1-5 voices and 0-40 cents spread.
- `keyTrack`: optional 0-1 amount that raises filter frequency on higher MIDI notes and lowers it on lower MIDI notes.

Missing fields preserve old behavior. Existing presets remain valid. Sample instruments get key-tracked/filter-envelope filtering, but unison and vibrato are intentionally conservative on samples for now.

The procedural exporter mirrors these fields in `renderPatchTone()` so the new Modern presets survive Canvas WAV export. This is a practical approximation of the Web Audio graph, not a sample-for-sample clone.

### Tone Trait parity pass

- Live synth Echo and Sketch Kit Echo now use a low-pass filter in the feedback loop before the delayed signal re-enters the delay. Export Echo uses a matching regenerative filtered delay loop.
- Live synth Space and Sketch Kit Space now generate a stereo-decorrelated impulse with pre-delay, early reflections, a darker tail, and different left/right timing. Export Space uses a longer multi-tap tail that follows the same practical target without adding bundled IR WAVs.
- Crush remains vanilla/procedural. Export still has sample-hold behavior; live Crush remains waveshaper-based for now. Do not add AudioWorklet until there is a clear reason.
- Drive, Wobble, and Noise remain on the existing curves with small export/live differences. Treat this as a first parity milestone, not the end of the audio work.

### Preset families

- Built-in synth presets are now grouped as Chip and Modern in Create and Canvas MIDI track selectors.
- Four new Modern presets were added: `modern_keys`, `modern_pad`, `modern_bass`, and `modern_pluck`.
- `TRACK_INSTRUMENTS` includes these new presets so Canvas MIDI tracks can select them and Canvas WAV export can render them with their patch motion.

### Follow-up testing

- In dev builds, `src/main.js` exposes `window.notenotesAudioParity` from `src/dev/AudioParityHarness.js`.
- Useful console calls: `notenotesAudioParity.presetIds()`, `notenotesAudioParity.playPatch('modern_pad')`, and `notenotesAudioParity.renderAll({ traits })`.
- The harness renders procedural WAV blobs through `WavExporter`; it is for quick export-side listening and patch-difference checks, not a full automated live-vs-export diff runner.
- Manual QA should compare live playback and Canvas WAV export for at least `chip_lead`, `bliff`, `lofi_keys`, `modern_keys`, `modern_pad`, and `modern_bass`.
- Test Tone at 0%, 50%, and 100% for Echo and Space on both MIDI and drum clips. The target is "recognizably the same effect", not bit-identical output.
- Keep future audio work additive. If a patch starts using new fields, set `schemaVersion: 2`; do not mutate old saved patches in place unless a user action explicitly saves them.

---

## Audio Upgrade Milestone 0.1.1

App version `0.1.1` is a tightening pass after the first audio upgrade. It focuses on places where QA showed live sound, Tone presets, and WAV export could still feel inconsistent.

### Recorded patch identity

- New MIDI snippets created by `RecordingManager` are stamped in `CreativeMode._stampRecordedPatch(snippet)`.
- The snippet receives:
  - `instrumentId`: the active patch id at record time, such as `modern_pad`.
  - `patchRecorded`: `{ instrumentId, patchSnapshot, capturedAt }`.
  - `schemaVersion`: at least `2`.
- For built-in synth presets, `patchSnapshot` is a JSON copy of the selected preset. Custom sample instruments currently store the selected id but do not embed sample data in the snippet.
- Canvas track instrument selection still overrides the recorded patch during Canvas playback/export. The recorded patch is only the standalone snippet fallback.
- `WavExporter.snippetToWavBlob()` now resolves MIDI snippet export patch in this order:
  1. explicit `options.patch`
  2. `snippet.patchRecorded.patchSnapshot`
  3. `snippet.patchRecorded.instrumentId`, `snippet.instrumentId`, or `snippet.patchId`
  4. `PRESETS.chip_lead`

### Canvas Tone override behavior

- Canvas clip `soundTraits` now deliberately override per-note/per-hit `soundTraits`.
- This fixes the QA case where applying a Tone preset to a MIDI clip seemed partial or missing because recorded notes already carried their own Tone snapshots.
- Playback order is now `clip.soundTraits || note.soundTraits || snippet.soundTraits || project.settings.soundTraits` for MIDI, and the same shape for drum hits.
- WAV export mirrors this by checking whether the clip/base Tone has active traits before falling back to note/hit traits.

### Tone preset controls

- Create Tone and Kit Tone now include a `Reset` button that sets every Tone amount back to `0`.
- Selecting a Tone preset fills the preset name field.
- `Save` updates the selected preset, including renaming it. If nothing is selected, it updates by matching name or creates a new preset.
- `Save as new` always creates a separate preset.
- Delete remains destructive with confirmation.

### Panic / kill audio tails

- Double-pressing Stop within 650ms calls a panic handler.
- `TransportBar` exposes `onPanicClick`; `main.js` wires it to `creativeMode.panic()` and `playbackEngine.panic()`.
- `WebAudioSynth.panic()` immediately stops active sources/oscillators/noise/vibrato, clears voice state, and rebuilds the Tone chain so delay/reverb tails are cut.
- `SketchKit.panic()` rebuilds the Tone chain to cut kit effect tails.
- `PlaybackEngine.panic()` releases active track notes, panics cached track synths, and panics the shared kit.

### Tone tail safety and parity

- Live synth, live kit, and export Echo feedback/wet amounts were reduced so high Echo settings do not run away as easily.
- Export Wobble now follows the live synth's cutoff/rate target more closely: `0.8 + amount * 6.5` Hz and a cutoff centered around `650 + (1 - amount) * 6800` with LFO depth `450 + amount * 2700`.
- Export unison normalization now matches the live formulation: the primary oscillator group is normalized by voice count, and the secondary oscillator group is normalized separately then multiplied by `oscillator2.gain`.
- Custom sample instrument export now applies key-tracked/filter-envelope style filtering when those optional fields exist on an instrument. Vibrato and unison remain intentionally skipped for sample export in this pass.

### QA notes

- The direct "apply Tone preset from snippet library" checklist item was inaccurate. The current mechanism applies Tone to a selected Canvas clip. A future direct snippet edit belongs in Inspect, not the tray.
- The next manual QA pass should include:
  - Record with `modern_pad`, export the standalone snippet WAV, confirm it does not fall back to Chip Lead.
  - Apply Echo/Space Tone preset to a one-note MIDI clip at bar start and confirm it is audible.
  - Apply the same Tone preset to a drum clip and confirm it still works.
  - Set Echo high, trigger a note or drum hit, press Stop twice, confirm ringing tails are killed.
  - Select a Tone preset, rename it through the name field, save, close/reopen Tone, and confirm the new name persists.

---

## Audio / Instrument Polish 0.1.2

App version `0.1.2` is a small polish pass after the audio upgrade. It does not change project storage schema, but it changes how users manage custom sample instruments and how the Wobble Tone trait behaves.

### Custom instrument edit flow

- The Create/Edit Instrument popover now has an `Instrument` selector when custom instruments exist.
- `New instrument` clears the form and saves a separate custom instrument.
- Choosing an existing Patch or Kit instrument loads that instrument into the form and sets `data-editing-id` on `.custom-instrument-form`.
- `CreativeMode._saveCustomInstrument(root)` now uses that form `data-editing-id` instead of assuming the currently selected patch/kit behind the popover is what the user meant to edit.
- This keeps the old behavior available while making the hidden state explicit. Editing an existing instrument still preserves its `audioAssetId` when the user does not pick a new snippet or file.
- Type changes are still blocked when the instrument is already used by tracks/snippets, using the existing `_customInstrumentUsage()` guard.

### Wobble retune

- Wobble remains the user-facing name, but internally it should be treated as smooth filter motion, not an extreme resonant special effect.
- Live synth Wobble now uses a gentler curve and filter target:
  - trait curve: `amount ** 0.72`
  - cutoff center: `1100 + (1 - amount) * 5200`
  - Q: `0.7 + amount * 3.2`
  - LFO rate: `0.35 + amount * 4.2`
  - LFO depth: `180 + amount * 1300`
- Live kit Wobble uses the same curve with a slightly safer drum target:
  - cutoff center: `1300 + (1 - amount) * 4800`
  - Q: `0.7 + amount * 2.8`
  - LFO rate: `0.45 + amount * 4.5`
  - LFO depth: `160 + amount * 1150`
- WAV export Wobble mirrors the synth target with a procedural one-pole low-pass approximation. Export parity remains "audibly trustworthy", not bit-identical.
- The old Wobble settings pushed a resonant low-pass too hard into low cutoffs, which could become crackly or brittle on sustained sounds and mobile speakers. Future Tone work should prefer musical movement over dramatic resonance unless it is a separate, clearly named trait.

### Audio asset policy

- Built-in audible assets must not create obligations for users who export music from Notenotes.
- Preferred asset licenses are CC0 / public domain. MIT/BSD/Apache-style permissive licenses are acceptable for code libraries, but audio assets need per-asset legal review before bundling.
- Do not bundle CC-BY, CC-BY-SA, CC-BY-NC, "royalty free" packs with unclear terms, or anything that requires attribution/share-alike/noncommercial restrictions on exported user WAV/MP3 files.
- No runtime CDN audio assets. Offline-first PWA behavior remains non-negotiable.
- If future audio assets are bundled, add a `CREDITS.md` entry with source URL, author, exact license, license URL, modifications, and date added even when attribution is not required.

---

## Canvas / iOS Audio Polish 0.1.4

App version `0.1.4` addresses a small Canvas interaction pass and another iOS audio-unlock hardening pass.

### Canvas ruler seeking

- Canvas ruler beat cells now include `data-seek-bar`.
- Clicking/tapping a ruler number calls `transport.seekToBar(bar)` and immediately updates the Canvas playhead.
- A manually moved playhead can be shown while transport is stopped. The playhead animation still follows `transport.currentTick` during playback.
- `.canvas-ruler__beat` has pointer affordance styling; keep the ruler as the canonical place for timeline seek gestures.

### Audio clip preview

- Canvas audio clips no longer render a fake seeded waveform with tall random bars.
- The preview is now a neutral content indicator: a center line, a low rounded band, and small ticks. This intentionally says "audio lives here" without pretending to show real amplitude.
- If an audio snippet has no durable audio source (`audioAssetId`, `audioUrl`, or `audioDataUrl`), the preview uses a dashed band.
- Do not reintroduce fake amplitude unless real decoded peak data is generated and stored.

### iOS unlock hardening

- `AudioEngine.unlockGesture()` is a repeat-safe helper that resumes a suspended context and plays a one-sample silent buffer nudge.
- `AudioEngine.initSync()` now calls `unlockGesture()`.
- `WebAudioSynth.noteOn()` ensures its graph exists and calls `engine.unlockGesture()` right before scheduling a note. This gives iOS WebKit another same-gesture opportunity when the user presses a pad/key.
- `SketchKit.triggerPad()` does the same for drum hits.
- `WebAudioSynth.init()` and `SketchKit.init()` are idempotent, so these defensive calls do not rebuild already-live graphs.
- If iOS still makes chords sound like a single voice, suspect context unlock timing first, then inspect device CPU/polyphony pressure. There is no intentional iOS-specific monophonic path.

---

## Inspect Clip Flow / Mobile Creation Guard 0.1.5

App version `0.1.5` fixes two Inspect workflow gaps and one iOS touch interaction problem.

### Inspect clip switching

- `EditMode` now treats Inspect as a place where the user can switch clips directly, including audio clips.
- The empty Inspect state lists MIDI, drum, and audio snippets instead of filtering audio out.
- The normal Inspect toolbar uses `_renderClipOptions()` instead of the old MIDI/drum-only option renderer.
- Audio Inspect now includes the same `#edit-load-clip-select` selector next to the audio name field, so the user can move from an audio preview to any other clip without returning to Create.
- `_loadSnippetById(id)` is the shared switch path for empty state, MIDI/drum toolbar, and audio preview. It calls `loadSnippet(snippet)` and lets the clip type decide whether to render the piano roll, drum roll, or audio preview.
- `refreshSnippetList()` refreshes any visible `#edit-load-clip-select` in place. If Inspect is empty, it rerenders the empty selector.

### Snippet list refresh after recording

- `CreativeMode` dispatches `project-snippets-changed` after MIDI/drum capture, Audio In capture, and AI-generated snippet creation.
- `main.js` listens for `project-snippets-changed` and calls `editMode.refreshSnippetList()`.
- This is intentionally lightweight: recording a new snippet should update Inspect selectors immediately without forcing the user to refresh the app or leave the current mode.

### Mobile accidental creation guard

- Inspect's New MIDI and New Drum buttons now use `click` instead of `pointerdown`.
- The old `pointerdown` handlers fired immediately when the user touched the horizontally scrollable toolbar on iOS, so dragging across the toolbar could accidentally create a blank clip.
- `click` keeps tap behavior but gives mobile browsers a chance to cancel the activation during a scroll gesture.
- `.edit-toolbar` now has `touch-action: pan-x` and `-webkit-overflow-scrolling: touch` to make its horizontal overflow row behave more naturally on iOS.

---

## Canvas / Inspect Touch and Instrument Fixes 0.1.6

App version `0.1.6` addresses a QA pass around Canvas clip placement, recorded instrument intent, Android pad holds, and touch editing in Inspect.

### Canvas edge snapping for fractional audio clips

- Audio snippets can have fractional `durationBars` because their duration comes from real recorded time converted to ticks, not necessarily a clean bar or beat boundary.
- `_resolveClipStart()` previously rounded every candidate start back to the beat grid, including candidates derived from another clip's exact end edge.
- That meant an audio clip ending at a fractional bar could not always be followed flush by another audio clip; the "magnetic" edge candidate was rounded forward to the grid and left a small visible gap.
- Edge candidates from neighboring clips now preserve their exact fractional start instead of being grid-rounded. Free placement still snaps to the grid.
- `_clipOverlapsAt()` uses a slightly larger epsilon (`0.001` bars) so exact edge-to-edge placement does not get rejected as overlap because of floating-point noise.

### Recorded instrument intent on Canvas

- MIDI snippets already store `instrumentId` / `patchRecorded.instrumentId` when recorded.
- Canvas now reads that metadata when a MIDI snippet is placed on a MIDI track and changes the track's `instrumentId` to the recorded instrument automatically.
- This is track-level on purpose: the Canvas track dropdown remains the source of truth after placement, so the user can still change the whole track instrument from there.
- The track instrument change participates in undo/redo together with the clip add. Undoing the add restores the previous track instrument.
- Drum hook support is present through `kitRecorded` / `kitId` if future drum recording starts stamping kit identity.

### Inspect touch placement

- Inspect background grid note/hit creation now waits until pointer release and cancels if the pointer moves more than 8px.
- This prevents mobile drag/pan gestures from placing unwanted notes while still allowing normal tap-to-add behavior.

### Drum split guard

- Drum Inspect turns split view off when a drum snippet is loaded.
- The Split button remains visible but disabled for drum snippets because split view is a MIDI note-range tool. This avoids the broken dual-pane drum labels.

### Android pad holds

- `.scaleboard__pad` now uses `touch-action: none`.
- Android Chrome could interpret a held pad as a possible scroll/gesture and fire `pointercancel`, which made some held notes turn into tiny short notes. The pad itself should own the touch gesture while pressed.

---

## Audio Clip Peaks / Disabled Split UI 0.1.7

App version `0.1.7` fixes a visual communication issue in Canvas audio clips and makes disabled Inspect controls read as disabled.

### Real audio peak previews

- Canvas audio clips now render from `snippet.audioPeaks` when peak data is available.
- Audio In recording creation computes `audioPeaks` from the captured blob with `decodeAudioData`, using 48 normalized RMS bins. The data is intentionally lightweight and suitable for project JSON/backups.
- `CanvasMode._ensureAudioPeaks(snippet)` backfills peak data for older audio snippets when the snippet has a durable source (`audioAssetId`, `audioDataUrl`, or fetchable `audioUrl`). It reads audio bytes through `ProjectStore.audioSnippetToArrayBuffer`, decodes them, stores `snippet.audioPeaks`, schedules autosave, and rerenders tracks.
- The preview is not meant to be a full waveform editor. It is a compact content map so silence stays visibly low and loud moments, such as a cough halfway through a clip, appear where they occur.
- If audio exists but peaks are not ready yet, Canvas shows a subdued "analyzing" placeholder. If audio is unavailable, it keeps the dashed unavailable indicator.
- Do not go back to fake sine/random markers for audio clips. If the app cannot derive real peaks, show a pending/unavailable state instead.

### Disabled Inspect buttons

- `.edit-toolbar__btn:disabled` now has explicit disabled styling: lower opacity, tertiary text, not-allowed cursor, and muted surface background.
- Drum Inspect still disables Split because split view is for MIDI note ranges. With the new button styling this should read as unavailable rather than broken.

---

## Snippet Delete Cleanup / Clip Type Badges 0.1.8

App version `0.1.8` fixes stale snippet references after deletion and makes Canvas/Tray clip types easier to distinguish.

### Snippet deletion cleanup

- Deleting a snippet from `SnippetTray` now removes that snippet from `project.snippets`, removes matching Canvas clips, refreshes Inspect, dispatches `project-snippets-changed`, schedules autosave, and then lets audio asset garbage collection run.
- `CanvasMode.removeSnippetReferences(snippetId)` removes clips where either `clip.snippetId` or `clip.snippet.id` matches the deleted snippet. This matters because Canvas clips can hold a nested snippet object even after the library entry is removed.
- If the deleted clip was selected, Canvas clears the selection and syncs the clip toolbar state.
- `EditMode.refreshSnippetList()` now unloads the current Inspect clip if that snippet no longer exists in `project.snippets`. This prevents Inspect from showing a deleted clip and a stale load dropdown.
- The intended rule is: deleting a snippet from the library deletes placements of that snippet from Canvas. Canvas should not preserve orphaned clip objects unless a future explicit "detach clip from library" feature is designed.

### Type badges instead of note/mic confusion

- Canvas clips now show a small type badge in the label row: `MIDI`, `DRUM`, or `LINE`.
- The Canvas snippet dock uses the same text badges instead of emoji icons.
- `SnippetTray` also uses text type badges. Audio snippets use `LINE` to imply line/audio input rather than a microphone, and to avoid making audio and MIDI both look like generic musical notes.
- Audio tray mini-previews render `audioPeaks` when available. Without peaks, they show a flat line with a `LINE` label.

---

## MIDI Export Trust Rules

Canvas MIDI export should mirror Canvas playback expectations where standard MIDI allows it:

- respect track mute/solo state
- skip audio tracks
- only export MIDI snippets from MIDI tracks
- only export drum snippets from drum tracks
- count rendered note/hit events and refuse tempo-only downloads when there is nothing musical to export

Snippet MIDI export should also refuse tempo-only downloads when the selected snippet has no notes or drum hits.

---

## Tone Preset Management

Tone presets live in `project.settings.tonePresets` and are shared between the synth Tone popover, kit Tone popover, and Canvas clip Tone picker.

Rules:

- Saving a preset with the same name updates that preset.
- Deleting a preset asks for confirmation, then removes it from the shared preset list and dispatches `project-tone-presets-changed`.
- Canvas listens for `project-tone-presets-changed` and refreshes the clip Tone picker.
- Deleting a preset does not remove Tone already saved on snippets, notes, hits, or Canvas clips.

---

## iOS Audio In Stability

iPhone Chrome uses WebKit audio/media behavior, so treat it like Safari for audio unlock and recording.

Rules:

- Do not remove global audio unlock listeners after the first pointer/key/touch event unless `AudioContext.state === 'running'`.
- Some iOS gestures can create/init the context but leave it suspended; the next valid touch should still be able to resume it.
- `MicRecorder` should call `MediaRecorder.start(timeslice)` instead of bare `start()` so iOS emits chunks during recording.
- On stop, call `requestData()` before `stop()` when possible.
- Reject zero-byte recording blobs and show a clear failure message instead of creating an unusable audio snippet.
- Wrap the Audio In snippet creation path in `try/catch`; IndexedDB/audio asset save failures should surface as a toast rather than silently losing the recording.
- Store audio assets as `ArrayBuffer` bytes plus MIME metadata, not raw `Blob` / `File` objects. iOS WebKit can throw "error preparing Blob/File data to be stored in object store" when IndexedDB is asked to persist recorder blobs directly.
- `getAudioAssetBlob()` reconstructs a `Blob` for playback/export. Keep the legacy `record.blob` fallback so older desktop-created assets still play.

---

## Mobile Menu And Debug Logs

- `TransportBar.closeMore()` is the canonical way to close the mobile `...` dropdown.
- Tapping Settings from the mobile dropdown closes the dropdown before opening Settings.
- Tapping `...` while Settings is open closes Settings and opens the dropdown.
- `project.settings.debugLogging` controls the Settings debug log switch. When enabled, Settings prints a structured `[Notenotes Debug]` snapshot to the browser console on enable and each Settings open.
- Keep debug output console-only unless the user asks for an in-app diagnostics surface.

---

## Canvas Loop Toggle

- `project.settings.canvasLoopEnabled` controls the Canvas toolbar Loop button.
- When off, transport looping is disabled for Canvas playback.
- When on, Canvas sets `transport.loopEnabled = true` and sets the loop range from bar 0 to the latest clip end across all tracks.
- Moving, resizing, adding, deleting, quantizing, trimming, undoing, or re-rendering tracks should call `_autoSetLoopFromClips()` / `_syncCanvasLoopRegion()` so the loop endpoint follows the arrangement.
- If there are no clips, Canvas loop is turned off and the user is prompted to add a clip before enabling it.

---

## Live Recording Timing

- MIDI/drum recording must use a recording-pass origin, not the absolute transport position. `RecordingManager.setArmed(true)` resets captured events and stores `_recordStartTick`.
- Captured notes, drum hits, and modulation are stored relative to `_recordStartTick`.
- Finalizing a snippet trims leading empty ticks so the snippet begins at the first captured note or hit. Users can add intentional space later by placing the snippet on Canvas.
- This protects live recording from creating snippets with unexpected leading blank space when the transport was paused at a later position, when recording starts from a non-zero playhead, or when the user waits briefly after pressing record.

---

## Custom Instrument Foundations

Custom instruments are beginning as project-scoped saved instruments built from one audio source.

Current data shape:

```js
project.settings.customInstruments = [
  {
    id,
    name,
    type: "patch" | "kit",
    audioAssetId,
    audioMimeType,
    audioSize,
    rootMidi,
    playbackMode: "gated" | "oneShot",
    brightness,
    gain,
    createdAt,
    updatedAt,
  }
]
```

Current behavior:

- Create mode has a `Create Instrument` flow near the Patch selector.
- Users can name an instrument, choose Patch or Kit, choose an Audio In snippet or audio file, adjust basic controls, save it, and delete custom melodic patches.
- When a custom Patch is selected, the flow changes to `Edit Instrument` and updates the saved instrument instead of creating a duplicate.
- The Kit screen also exposes Create/Edit/Delete instrument controls and lists saved custom Kit instruments in the Kit dropdown.
- Creative Mode refreshes project-bound Patch and Kit selectors after the project is loaded. This matters because Creative Mode renders before IndexedDB load completes, so custom instruments must be refreshed once real project data arrives.
- When an instrument is created from an audio snippet, `sourceSnippetId` is saved. Older instruments without `sourceSnippetId` are still treated as using a snippet when their `audioAssetId` matches that snippet.
- Source snippets used by custom instruments get an `Instrument` badge in the snippet tray. Deleting those snippets is blocked so users do not accidentally remove the visible source for an instrument.
- Root note is required for melodic sample patches because it defines the unshifted pitch of the original sample; other keys calculate playback-rate shift relative to that MIDI note.
- Custom melodic Patch instruments are immediately playable live from Scale, Piano, and Controller through `WebAudioSynth` sample playback.
- Canvas MIDI track instrument dropdowns include custom Patch instruments.
- `PlaybackEngine` can preload/decode custom Patch samples and play MIDI clips through them.
- Canvas WAV export can render custom Patch instruments by resampling the source audio according to note pitch.
- Editing or deleting custom instruments dispatches `project-custom-instruments-changed` so Canvas refreshes and PlaybackEngine invalidates stale sample buffers.
- Custom instrument create, edit, and delete use an immediate project save plus version snapshot instead of waiting for the 2 second debounced autosave. This keeps asset-backed instruments from disappearing if the user reloads or changes context right after saving.
- Deleting a custom instrument is blocked while Canvas tracks, clips, or snippets reference it. Users should switch those references before deleting so old projects do not silently lose an instrument.
- Changing an existing custom instrument from Patch to Kit, or Kit to Patch, is blocked while it is referenced. Type changes alter how the saved sample is interpreted, so references need to be moved first.
- `WebAudioSynth` supports sample patches by decoding the stored audio asset into an `AudioBuffer` and using `playbackRate = 2 ** ((targetMidi - rootMidi) / 12)`.
- Kit-type custom instruments can be selected and managed from the Kit screen, but live Kit playback generation from one sample source still needs its own wiring.

Storage and backup:

- Custom instrument source audio uses the same IndexedDB audio asset store as Audio In recordings.
- `ProjectStore._collectAudioAssetIdsFromValue()` must include custom instrument `audioAssetId`s so garbage collection does not delete sample sources.
- `embedAudioForBackup()` embeds custom instrument audio as `audioDataUrl` so workspace and snippet backups can carry instrument samples.
- `migrateProjectAudioAssets()` migrates custom instrument embedded audio into local audio assets on import.

Known next steps:

- Wire Kit-type custom instruments so one source sample can generate percussive pad variations.


## Voice Sketch (Scale Board Experimental Voice Mode)

The Scale Board exposes a fourth Pad Mode called **Voice Sketch** alongside Single, Chords, and Custom. Voice Sketch is an experimental robot-voice mode: each pad triggers a supported voice token from a typed phrase at the pad's scale-locked pitch. Pure formant synthesis using Web Audio. No samples, no ML, no external dependencies. Do not describe this as Vocaloid-quality until recording, playback, export, multiple voices, and intelligible voice banks are real.

The architecture is deliberately data-driven. Voices live in `src/instruments/voice/voices/*.json`. The engine reads those JSON files; nobody has to touch engine code to add a new voice, language, or register. Contribution surface is documented in `src/instruments/voice/README.md`.

### Files

- `src/instruments/voice/VoiceEngine.js` — Web Audio formant-synth engine. Drives a sawtooth oscillator (voiced source) plus pink-ish noise (unvoiced source) through three peaking biquad filters in series. Uses `AudioParam.linearRampToValueAtTime` to interpolate between syllable keyframes.
- `src/instruments/voice/voices/english-base.json` — v1 syllable bank: `ah eh ee oh oo ai oi au ei h n m l s t la lee lo ma mee mo na no ha sa ta`.
- `src/instruments/voice/syllabify.js` — Greedy bank-based splitter. No npm dependency. As voices add syllables, the splitter recognizes them automatically.
- `src/instruments/voice/README.md` — Schema documentation and contribution guide.

### Syllable JSON schema (v1)

```json
{
  "id": "han",
  "duration": 0.6,
  "frames": [
    { "t": 0.00, "voicing": "off",    "amp": 0.0 },
    { "t": 0.05, "voicing": "noise",  "amp": 0.5 },
    { "t": 0.15, "voicing": "voiced", "amp": 1.0,
      "formants": [{ "hz": 730, "q": 8, "gain": 14 }, ...] },
    { "t": 1.00, "voicing": "off",    "amp": 0.0 }
  ]
}
```

Frames are keyframes in normalized time `0..1`. `voicing` switches discretely at each frame. `amp` and `formants` interpolate linearly between frames. Three formant slots per syllable (`F1`, `F2`, `F3`).

### Wiring

- `CreativeMode` instantiates `VoiceEngine` alongside `WebAudioSynth` and loads `english-base.json`.
- After `synth.init()`, CreativeMode calls `voiceEngine.setDestination(synth.getSynthInput())`. Voice output flows through the synth's tone input, so Crush/Echo/Wobble/Drive/Space/Noise apply to voices the same way they apply to other instruments.
- `ScaleBoard` accepts an optional `voiceEngine` constructor argument. When present, the Pad Mode dropdown shows the Voices option. When absent, Voices is hidden and existing modes work unchanged.
- `WebAudioSynth.getSynthInput()` is the public accessor for the tone input. The `_toneInput` GainNode is created during `synth.init()`. Always-routed; safe to share across instruments.

### Pitch + formant separation

The voiced source's frequency = `midiToFreq(midi)`. Formant frequencies stay where the JSON says, regardless of pitch. This is why a low and a high voice singing "ah" both still sound like "ah," instead of pitch-shifting like a chipmunk. Octave shifts on the Scale Board work in voice mode without retuning the syllable bank.

### Phrase persistence

The user's typed phrase persists in `project.settings.voicePhrase`. `ScaleBoard.onVoicePhraseChanged` lets CreativeMode schedule autosave when the phrase changes. Empty phrase = pads sing `"ah"` by default (so users get sound immediately without needing to type first). The phrase pointer (next-token index) is in-memory only; resets to 0 on app load.

### Phrase input UX

- Regular `<input type="text">` with debounced (60 ms) syllabification.
- Display row below the input shows tokens. Valid tokens have accent border. Invalid tokens have red strikethrough. The current pointer position highlights with a filled background.
- Input validation rejects non-ASCII characters at the keystroke level via `sanitizePhraseInput`. Non-Latin scripts and emoji are silently stripped on paste.
- A `↻` rewind button resets the phrase pointer to the start.

The display sits below the input rather than inline-tokenizing the input itself. Inline-tokenized contenteditable was considered but rejected for v1 — cross-browser cursor behavior is too fragile for the value it adds. Display-below ships in 1-2 days; inline tokenization could be a polish pass later.

### v1 scaffold limitations (intentional)

- Voice mode uses live synthesis during Create mode. Recorded Voice Sketch notes now carry `note.voice = { mode: "voice-sketch", voiceId, syllableId }` so the performance intent is not thrown away when a snippet is captured.
- `PlaybackEngine`, Canvas, Inspect, and WAV export do not yet render `note.voice` through `VoiceEngine`; they still play standard synth until the voice playback/export router is added.
- Custom mode does not yet allow per-pad selection of "voice" (alongside "single" / "chord"). The mode dropdown's Voices entry is the only entry point. A Custom-mode extension would let users mix voice with note/chord pads on the same layout.
- One voice ships in v1 (`english-base.json`), now with a small starter set of consonant-vowel test syllables for phrases. Multiple voices, registers, and languages are added by adding JSON files; the picker UI for choosing among voices is not yet built (the active voice is hard-loaded in `CreativeMode`).
- No saved phrase library. Phrases are project-scoped only; no global library.
- `english-base.json` formant values are textbook approximations. They will sound plausibly robotic but probably need ear-tuning to feel right. Adjustments are JSON-only — see `voices/README.md`.

### How to add a new voice

1. Author a JSON file in `src/instruments/voice/voices/`.
2. Match the schema in `voices/README.md`.
3. Manually update the `import` in `CreativeMode.js` to load it (until the picker UI is built).

### How to extend an existing voice

Edit the JSON. Add or modify entries in the `syllables` array. Reload the page. Done. No code path changes.

## AI Seed Snippets

A new "AI Seed" panel above the snippet tray lets the user ask an LLM (or a local Mock provider) to generate a snippet. The AI is treated as one of the user's instruments — it produces raw musical material the user keeps, refines, or discards. The user remains the composer.

The feature is BYO-key: the user pastes their own provider API key, the request goes directly from the browser to the provider, and Notenotes never sees, logs, or relays the prompt or the output.

### Files

- `src/ai/sequence-schema.js` — Single source of truth for the shape an AI emits. Exports `AI_INSTRUMENTS`, `KIT_DRUMS`, `getSequenceSchemaForInstrument(id)`, and `getSubmitSequenceTool(id)`. Used by validator, executor, prompt builder, and the LLM tool surface.
- `src/ai/SequenceValidator.js` — Pure `validateSequence(sequence, context)` that rejects malformed AI output before it touches the project.
- `src/ai/SequenceExecutor.js` — `buildSnippetFromSequence(sequence, context)` constructs a snippet directly compatible with `project.snippets[]` from a validated sequence. No transport coordination, no real-time playback.
- `src/ai/PromptBuilder.js` — Builds the system prompt, tool definition, and user prompt.
- `src/ai/AIProvider.js` — Base interface for LLM providers.
- `src/ai/MockProvider.js` — Canned-pattern provider for offline testing without a key.
- `src/ai/OpenAIProvider.js` — OpenAI Chat Completions with tool calling. Reused for Ollama by passing a custom `baseUrl`.
- `src/ai/AnthropicProvider.js` — Anthropic Messages API with tool use.
- `src/ai/AIController.js` — Top-level facade that orchestrates resolve-provider → build-prompt → call → validate → build-snippet.
- `src/ai/aiSettings.js` — Helpers for reading/writing AI config. API keys live in localStorage; non-secret config (provider id, model, ollama URL, disclaimer accepted) lives in `project.settings.aiSettings`.
- `src/ui/AISeedPanel.js` + `.css` — Collapsible inline panel above the snippet tray.
- `docs/AI_INTERFACE.md` — Human-readable description of the AI's contract; companion to the runtime tool schema.

### Architecture

The AI emits a *sequence* — a flat list of events with positions in beats. Notenotes never plays the sequence in real time. The pipeline is:

```
prompt
  → AIController.seed()
  → PromptBuilder.buildSystemPrompt + buildToolDefinition
  → provider.generate()                       // LLM call
  → SequenceValidator.validateSequence()      // rejects garbage
  → SequenceExecutor.buildSnippetFromSequence()  // builds snippet object
  → CreativeMode._onAISnippetCreated()        // adds to tray + project
```

Building a snippet directly (rather than driving the transport) means generation is instant and atomic. The user previews the result by tapping the new snippet in the tray.

### Sequence shape

A sequence is `{ instrument, lengthBars, events[] }`. Three event shapes by instrument:

- `scaleboard`: `{ beat, type: "padPress", padIndex, durationBeats?, velocity? }` — `padIndex` indexes the current scale, not raw MIDI. Scale-locked.
- `piano`: `{ beat, type: "noteOn", midi, durationBeats?, velocity? }` — chromatic.
- `kit`: `{ beat, type: "drumHit", drum, velocity? }` — drum name from a fixed enum.

Beats are floats from 0. The executor multiplies by 480 (TICKS_PER_BEAT) when constructing snippet notes/hits. The user's tempo and meter (in `transport.timeSignature.beats`) define how many beats per bar.

### What the AI is and isn't allowed to do

The action surface is one tool: `submitSequence`. The provider is told (in the system prompt and via tool_choice) to call it exactly once and not produce free-text commentary.

Things the AI CANNOT do, by construction:

- Set or change BPM, time signature, scale, root, octave, master volume, Tone Traits, or any project setting.
- Touch the canvas, mute/solo tracks, edit existing snippets, export, save milestones, etc.
- Refuse the tool call — that's a generation failure surfaced to the user.

These constraints are enforced at the tool surface; there is no other tool surface to expand.

### Snippet shape additions

AI-seeded snippets are normal MIDI/drum snippets with extra metadata fields:

```js
{
  ...standardSnippetFields,
  aiSeeded: true,
  aiPrompt: "first 240 chars of user prompt",
  aiProvider: "openai" | "anthropic" | "ollama" | "mock",
  aiInstrument: "scaleboard" | "piano" | "kit",
  aiLengthBars: 1 | 2 | 4 | 8,
  name: "AI N notes" | "AI N hits",
}
```

`SnippetTray` looks for `aiSeeded` and renders an `AI` badge with the original prompt as the hover title.

The AI metadata travels with the snippet through workspace backups and is preserved across export/import.

### Settings storage

**API keys are session-only.** `aiSettings.js` holds them in a module-scoped Map; nothing ever writes them to localStorage, IndexedDB, cookies, or the project JSON. On page reload, the Map is empty and the user re-enters their key. This is intentional — the project does not want to be in the business of storing user credentials.

Non-secret config (provider id, model id, Ollama base URL, disclaimer-accepted flag, default length-bars) lives in `project.settings.aiSettings`. That makes the picked model and provider part of the project — useful for "what model was I using when I made this?" reproducibility — and travels with workspace backups. No credentials are ever included in those backups.

`hasApiKey(providerId)` is the safe way to check whether a key is staged for the current session without leaking the value. The Settings panel uses it to show "Key staged for this session" vs "No key staged" without rendering the key text.

### UI placement

The AI Seed feature is a popover anchored to a small toolbar row above the snippet tray. The row (and the button it contains) is **only visible on Scale Board, Piano, and Sketch Kit** — the three instruments whose primitives the AI can write events for. Mic (audio recording) and Controller (deliberately scoped out per user) hide the row entirely. Switching instruments while the popover is open closes it.

The popover renders the `AISeedPanel` component on demand (constructed when the user clicks the button, destroyed when the popover closes). All event handlers bind at construction time, so there is no "click around to wake it up" state — the popover is fully interactive the moment it appears. Click-outside closes it; Escape closes it; clicking the AI Seed button again closes it.

### Provider billing

App version `0.0.41` removed AI Seed cost estimation entirely. Notenotes still warns that provider billing may apply, but it does not show estimated dollars, token counts, or running totals. Provider prices and token accounting change too often for a FOSS client app to maintain honestly.

### Provider quirks

- **OpenAI**: standard Chat Completions with `tools` + `tool_choice: { type: 'function', function: { name } }`. Force-pinning the tool stops the model from refusing or talking back.
- **Anthropic**: Messages API with `system` as a top-level field (not a message), `tools` with `input_schema`, and `tool_choice: { type: 'tool', name }`. Requires `anthropic-dangerous-direct-browser-access: true` for in-browser usage.
- **Ollama**: served via the OpenAIProvider with a custom `baseUrl` (default `http://localhost:11434/v1`). Model ids are user-installed (`llama3.1:8b`, `qwen2.5:7b`, etc.). Tool calling support varies by model — Llama 3.1, Qwen 2.5, and Mistral generally work; older models may not respect the schema.
- **Mock**: returns canned-but-musical patterns for 1/2/4/8 bars, on each instrument. No network. Default provider on first run so the user can validate the pipeline before committing to a key.

### v1 limitations (intentional, not bugs)

- **No reference snippet picker.** The pipeline supports a `referencedSnippet` context field, but the UI does not yet expose a way to attach one. Add a "+ Reference snippet" picker in a follow-up.
- **No cost estimates or counters.** Provider billing may apply, but Notenotes does not attempt to price individual generations.
- **No rate limiting / per-session budget cap.** A user could spam Generate. Acceptable for v1; surfaced as a future "max $X per session" setting.
- **Prompt is single-shot.** No retry on validator failure with a self-correction message. If the LLM returns garbage, the user sees the error and can refine their prompt.
- **No streaming.** Sequences come back atomically. With small JSON outputs this isn't a UX problem.
- **No multi-tool conversations.** One tool, one call, one snippet.

## Canvas Toolbar Polish

App version `0.0.33` cleaned up the Canvas toolbar as the second frontend-design pass. App version `0.0.34` extended this by making selected-clip tools visually honest.

### What changed

- The Canvas toolbar no longer uses one-off inline styles for its main controls. Track add buttons, zoom buttons, Trim, Loop, and Apply to Clip now share `.canvas-toolbar__btn` / `.canvas-toolbar__btn--icon`.
- Inline divider `<div style="...">` elements were replaced with `.canvas-toolbar__divider`.
- Zoom buttons now render as simple `-` and `+` controls with explicit `aria-label`s instead of emoji/text hybrids. This keeps the toolbar calmer and avoids inconsistent emoji rendering across mobile browsers.
- Mobile toolbar touch targets are slightly taller at the `640px` breakpoint, while preserving the horizontal scrolling behavior needed for the full control strip.
- `#canvas-tone-preset` and `#canvas-tone-apply` are disabled until a MIDI or drum clip is selected. Audio clips keep these controls disabled because Tone presets do not apply to audio clips.
- Clicking empty timeline space clears the selected clip and disables selected-clip tools. `_syncClipTools()` is the canonical helper for keeping these toolbar controls aligned with `_selectedClip`.
- App version `0.0.35` removed the non-functional `Bar 1.1` label from the right side of the Canvas toolbar. The ruler already communicates bar/beat position, and the playhead handles motion during playback. Do not reintroduce a static position label unless it is tied to a real cursor/playhead behavior.

### Design intent

The Canvas toolbar is an editing surface, not a marketing strip. Keep it compact, grouped, and predictable:

- track creation controls first
- timeline zoom next
- edit/loop tools next
- selected-clip Tone tools last
- avoid per-button inline styles so future polish can happen from CSS

---

## Inspect Blank Clip Creation

App version `0.0.35` adds a direct writing path for users who do not want to record live. App version `0.0.36` fixes Inspect click-to-place coordinate math. App version `0.0.37` cleans up the Inspect toolbar styling. App version `0.0.38` adds a one-clip Shadow reference in Inspect. App version `0.0.39` adds active clip loading, velocity editing, duplicate-add prevention, and a clearer four-bar minimum ruler/grid display. App version `0.0.40` makes velocity easier to read directly on notes and shadows.

### What changed

- `EditMode` exposes `New MIDI Clip` and `New Drum Clip` actions in the empty Inspect state.
- The active Inspect toolbar also exposes compact `New MIDI` and `New Drum` buttons so users can start another clip without returning to Create.
- Blank snippets are added to `project.snippets`, auto-saved, surfaced in `SnippetTray` via `EditMode.onSnippetCreated`, and immediately loaded into Inspect.
- New MIDI snippets start with `{ type: 'midi', notes: [], hits: [] }`; new drum snippets start with `{ type: 'drum', notes: [], hits: [] }`.
- `durationTicks` defaults to the current project bar length (`transport.ticksPerBar`) so the blank clip aligns with the current meter from the start.
- New note/hit placement uses the clicked grid cell's start via `Math.floor(...)`, not `Math.round(...)`. This means clicking anywhere inside a 1/4, 1/8, 1/16, etc. grid block places in that block rather than jumping to the next block when clicking the right half.
- Pointer coordinates are measured against `pane.gridEl.getBoundingClientRect()` without adding `gridContainer.scrollLeft/scrollTop`. The grid element's rect is already shifted by scroll, so adding scroll again caused notes to be placed down and to the right after scrolling.
- Inspect toolbar controls now use `.edit-toolbar__btn`, `.edit-toolbar__btn--compact`, `.edit-toolbar__btn--tiny`, `.edit-toolbar__btn--danger`, `.edit-toolbar__name-input`, and `.edit-toolbar__range-separator` instead of inline per-button styles.
- The toolbar now allows horizontal overflow, with taller touch targets under `640px`, matching the Canvas toolbar approach.
- The Inspect toolbar's `Shadow` select is intentionally immediate-use UI state only. `EditMode._shadowSnippetId` is not persisted to the project, milestones, backups, or exports.
- Shadow clips render as `.piano-roll__shadow-note` elements before editable notes, so they sit behind the active clip and never intercept pointer events. MIDI shadows are green translucent blocks. Drum shadows are red translucent hits.
- MIDI Inspect can shadow MIDI or drum snippets. Drum hits are mapped onto approximate MIDI pitches for melody alignment. Drum Inspect only lists drum snippets because melody notes do not map cleanly to drum rows.
- The active Inspect toolbar now has a `Load` select for switching between editable MIDI/drum snippets without going back to the empty Inspect screen or snippet tray.
- Selected notes/hits expose a `Velocity` slider. Velocity is stored back onto the selected note/hit as `0.01` to `1.0`, and the existing mini velocity strip remains the visual hint inside each note.
- Exact duplicate note/hit creation is blocked when clicking the same pitch/type at the same start tick. Duplicates can make notes look brighter and can also stack playback voices, so new accidental duplicates should not be created.
- `_displayDurationTicks()` keeps the Inspect ruler and grid visually extended to at least four bars, while `_updateSnippetDuration()` still keeps the actual snippet duration based on content.
- Velocity is now represented by three cues on active notes: block opacity, a left-side vertical meter scaled by `--note-velocity`, and a small percentage label on MIDI notes when there is room. Shadow notes/hits also use velocity-scaled opacity and a left meter so reference clips do not all read as the same strength.

### Design intent

Create remains the performance-first path, but Inspect now supports note-by-note composition from nothing. This matters for users who think by clicking notes onto a grid rather than recording a live take.

---

## Popover Close Language

App version `0.0.35` removes the small `x` close buttons from Tone, AI Seed, and Create/Edit Instrument popovers.

### What changed

- Tone popovers in `CreativeMode` and `SketchKit` close by clicking the Tone button again or clicking outside the popover.
- Create/Edit Instrument closes by clicking the Create/Edit Instrument button again or clicking outside the popover.
- AI Seed already supported opener-toggle and click-outside; its internal header close button was removed to match the rest of the app.
- `tone-popover__close` and `ai-seed-panel__close` CSS is now unused/removed.

### Design intent

Short-lived popovers should feel like tool flyouts, not modal windows. Tool flyouts close through their trigger or outside-click. Keep visible close buttons for drawers/modals like Settings where the panel is large and persistent.

---

## Build Verification / dist Tracking

App version `0.0.34` also fixed the recurring `dist/` build-noise problem.

### What changed

- `dist/` was already listed in `.gitignore`, but old generated build artifacts were still tracked by git.
- Those tracked `dist/` files have been removed from the git index with `git rm -r --cached dist`.
- The files remain on disk locally, but future `npm run build` runs should no longer dirty tracked `dist` assets.
- GitHub Pages does not need committed `dist/` files because `.github/workflows/deploy.yml` installs dependencies, runs `npm run build`, uploads `./dist`, and deploys the generated artifact.

### Agent workflow

- Do run `npm run build` for verification after source changes.
- Do not restore `dist/` after every build; it is intentionally ignored and untracked.
- If deployment strategy changes away from the current Pages workflow, revisit whether `dist/` should stay ignored.

---

## Mobile Transport Menu Polish

App version `0.0.32` tightened the narrow-screen transport dropdown as a first frontend-design pass.

### What changed

- `TransportBar` still renders the same desktop controls, but mobile now treats the collapsed `...` area as a labeled control tray instead of a cluster of icon-only buttons.
- ARP/Hold, Metronome, Keyboard Controls, and Settings now carry `.transport-bar__menu-label` text. The labels are hidden on desktop and shown in the mobile dropdown.
- The dropdown rows are full-width, 44px-tall touch targets with a fixed icon column and a text column. This specifically fixes the iPhone issue where the metronome icon looked off-center because it was being centered as a standalone round icon inside a vertical menu.
- `#tb-more-btn` now tracks `.is-active` and `aria-expanded`, and `TransportBar.closeMore()` clears both. If future code closes the menu, use `closeMore()` so CSS state and ARIA state stay in sync.
- The duplicate `touchend` listener was removed from the `...` button. Pointer events already cover touch on modern mobile browsers, and having both could double-toggle the menu on some devices.

### Design intent

The mobile transport should feel like a compact hardware control surface:

- top row keeps the immediate transport actions visible: stop, play, record, beats, BPM, more
- secondary controls live in the `...` tray
- tray controls should be readable by name, not just by icon
- Settings and the `...` tray should not visually stack as two open menus

---

### Adding a new provider

1. Subclass `AIProvider`. Implement `generate({systemPrompt, userPrompt, tool, model, signal})`.
2. Add the provider to `AIController._resolveProvider`.
3. Add an option to the Settings AI section's provider dropdown (in `SettingsPanel._renderAISection`) and a `case` in `providerModelsForUi`.
4. If credentials are required, read them via `readApiKey('<providerId>')`. Keys live in the in-memory Map only — do not write a custom credential store, and do not persist them.

---

## Snippet Delete Confirmation / Track Colors / Version Check 0.1.9

App version `0.1.9` is a small safety and polish pass after the snippet cleanup work.

### Snippet deletion

- `SnippetTray.removeSnippet(id)` now asks for browser confirmation before deleting a snippet.
- The confirmation message explicitly says the delete also removes the snippet from Canvas. This matches `App._handleSnippetDeleted()` plus `CanvasMode.removeSnippetReferences(snippetId)`, which clears any placed clips that reference the deleted snippet.
- The existing custom-instrument usage blocker still runs before the confirmation. If a snippet is backing a custom instrument, deletion remains blocked with the existing blocked-use path.

### Canvas track colors

- Canvas tracks now expose a native color input in each lane header.
- The selected color is stored as `track.color` using a `#rrggbb` hex value. Invalid or missing values fall back to the rotating `LANE_COLORS` palette.
- `CanvasMode._trackColor(track, idx)` is the single resolver for user-set colors versus fallback colors.
- `hexToRgba(hex, alpha)` converts the stored hex into the translucent lane/clip color already used by `_renderClipsForTrack(content, track, color)`, so changing a track color changes both the lane accent and the snippets shown on that track.
- Color changes schedule autosave and rerender Canvas immediately. No migration is needed because `track.color` is additive.

### AI label cleanup

- The AI Seed toolbar buttons, snippet badge, generated snippet default names, and seeded-snippet toast no longer use the robot emoji. This keeps AI controls consistent with the rest of the app's plainer icon/text language.
- `AISeedPanel` no longer renders the header robot icon. The unused `.ai-seed-panel__icon` CSS can be removed later if desired, but it is harmless.

### GitHub latest-version check

- Settings now shows the local `APP_VERSION` with a `Check latest` button.
- `SettingsPanel._checkLatestVersion()` fetches `https://raw.githubusercontent.com/zeidalidiez/Notenotes/main/package.json` with `cache: 'no-store'`, reads the `version` field, compares it to the local app version, and displays one of three states:
  - newer GitHub version exists: tells the user to clear cache or press `Ctrl+Shift+R`
  - same version: confirms the browser is on the latest public version
  - local is newer than GitHub: useful while testing local builds before the repo is updated
- If the fetch fails, Settings tells the user the GitHub check could not run and still gives the stale-cache advice. This preserves offline-first behavior; the app does not require the network to run.

---

## Arm Recording / Local Create Controls 0.1.10

App version `0.1.10` moves more creation-specific controls out of Settings and adds an armed recording flow for users who want recording to begin with their first played sound.

### Arm to record

- `TransportBar` now renders a separate `Arm` button next to the normal Record button.
- `TransportBar.onArmRecordClick(armed)` is wired in `main.js` to `CreativeMode.setRecordArmed(armed)`, and `CreativeMode.onRecordArmChanged` pushes the state back to `TransportBar.setRecordArmed(armed)`.
- Arm is not a transport state. It is a Creative Mode pre-record flag. The app remains stopped or playing until the user plays a note or drum hit.
- To ensure the first sound is included, instruments now expose pre-sound callbacks:
  - `ScaleBoard.setBeforeNoteCallback(fn)`
  - `MicroPiano.setBeforeNoteCallback(fn)`
  - `ControllerMode.setBeforeNoteCallback(fn)`
  - `SketchKit.setBeforeHitCallback(fn)`
- Those callbacks call `CreativeMode._beginArmedRecordingIfNeeded()` before the synth/drum sound is fired. That method clears the arm flag, starts `transport.record()`, and lets the normal `RecordingManager.noteOn()` / `drumHit()` callbacks capture the first event at the start of the recording.
- Pressing the normal Record button or Stop clears the armed state. Entering actual `TransportState.RECORDING` also clears the arm UI.

### Pads and Keys moved out of Settings

- The old Settings Quantization Grid row was removed. It was the legacy global recording quantizer and was easy to confuse with the active grid controls in Inspect/Canvas.
- `main.js` now resets the recording `Quantizer` to `OFF` when loading a project and clears `project.settings.quantize` to `0` for older workspaces. This prevents an old hidden Settings value from silently quantizing new recordings after the UI has been removed.
- Scale Board pad count was removed from Settings. It now lives behind a `Pads` button in the Create toolbar, shown only when Scale Board is in Custom mode because `project.settings.scalePadsCount` only affects Custom pad layouts.
- Piano count/key count were removed from Settings. They now live behind a `Keys` button in the Create toolbar when Piano is active.
- The new popovers are lightweight `tone-popover` siblings, not modal settings drawers. They write the same existing project settings:
  - `project.settings.scalePadsCount`
  - `project.settings.pianoCount`
  - `project.settings.pianoKeys`
- The same existing events are dispatched after changes:
  - `settings-pads-changed`
  - `settings-piano-changed`

### Settings version row

- `.settings-row--version` now aligns its label and value/button group on the same center line. The GitHub status message remains a separate help line below the row.

---

## AI Provider Shortcut / Drum Inspect Blocks 0.1.11

App version `0.1.11` is a small usability pass around the AI Seed panel and drum editing in Inspect.

### AI provider shortcut

- `AISeedPanel` now accepts an optional `onOpenSettings` callback.
- The provider label chip in the AI Seed panel is now a real button instead of a read-only span. It keeps the same compact chip styling, but uses `.ai-seed-panel__chip--action` so it reads as clickable.
- `CreativeMode._toggleAISeedPopover()` closes the AI popover and dispatches `notenotes-open-settings` with `{ section: 'settings', focus: 'ai' }` when the provider chip is clicked.
- `main.js` listens for `notenotes-open-settings`, closes the transport `...` menu if it is open, and calls `SettingsPanel.openTo(...)`.
- `SettingsPanel.openTo(section, options)` opens the drawer to the requested tab. When `options.focus === 'ai'`, it scrolls and focuses `#setting-ai-provider` after the Settings body has rendered.
- This does not change AI provider persistence. Provider/model settings still live in the project settings, while API keys remain session-memory only.

### Drum Inspect visual model

- Drum snippets still store hits as instantaneous events at `hit.startTick`; the timing model did not change.
- The Inspect drum editor now draws each drum hit as a grid-width block using `EditMode._drumHitVisualWidth()` instead of an 8px vertical pill.
- The width follows the current Inspect grid size (`1/2`, `1/4`, `1/8`, `1/16`) and has an 18px minimum so tiny grids remain touchable and visible.
- Drum shadow hits use the same width rule, so a shadow drum clip and the edited drum clip speak the same visual language.
- CSS changed `.piano-roll__note--drum` and `.piano-roll__shadow-note--drum` from rounded dots/pills to 4px-radius rectangular blocks with a subtle inset edge.
- The intent is user-facing clarity: clicking a drum cell should visually produce a block in that cell, closer to MIDI note rectangles, while playback/export still treat the event as a drum hit at the block's left edge.

---

## Inspect Drum Consistency 0.1.12

App version `0.1.12` tightens the Inspect drum editor so it follows the same broad mental model as MIDI Inspect.

### Toolbar order

- `EditMode._buildToolbarHTML()` now puts the Load selector first, followed by the snippet name/count/length controls.
- New MIDI/New Drum, Grid/Shadow, Velocity, Split, Quantize all, and Delete follow after that.
- Drum snippets still disable Split because split view is a MIDI note-range tool. The button remains visible and disabled so the user can see that the feature exists but does not apply to drums.
- Range, vertical zoom, and Quantize all remain MIDI-only because they operate on pitches and note durations, not drum rows or instantaneous hits.

### Drum ruler and clip length

- `EditMode._renderRollPane()` now renders the timeline ruler for drum snippets too. MIDI and drum Inspect both show the same bar/beat labels above the grid.
- Drum hit placement now contributes `hit.startTick + currentGridSize` when `_updateSnippetDuration()` calculates snippet length.
- This matches the new block-style drum hit visual: a hit at the edge of the current clip grows the editable grid by the visible cell, instead of only considering the hit's left edge.
- When an edit changes `durationTicks`, `_onEdit()` rebuilds the full editor instead of only rebuilding the grid. That keeps the ruler width, scrollable grid width, and toolbar state in sync.

### Snippet tray and Canvas freshness

- Inspect edit operations now dispatch `project-snippets-changed` with `{ action: 'updated' }` after autosave scheduling.
- Blank Inspect-created snippets dispatch the same event with `{ action: 'created' }` after `onSnippetCreated`.
- `main.js` now responds to `project-snippets-changed` by rerendering the snippet tray, refreshing Canvas, and refreshing Inspect's load selectors.
- This fixes the stale-preview problem where a newly edited drum clip could look blank in Create until another clip forced the tray to rerender, even though the actual snippet data was already present and could play from Canvas.

### Drum labels

- Drum add toasts now call `EditMode._drumLabel(id)` instead of showing raw ids.
- Raw ids such as `tommid` remain the stored data model, but UI messages show readable labels such as `Tom Mid`.

---

## Global Controller Bindings 0.1.13

App version `0.1.13` begins the controller redesign without deleting the existing Controller screen. The important design rule is that learned controller bindings are **sound targets**, not screen targets.

### Shared gamepad input

- New file: `src/engine/GamepadInputManager.js`.
- `GamepadInputManager` owns Web Gamepad API polling at the old 30ms cadence and emits:
  - `state`
  - `buttonDown`
  - `buttonUp`
  - `buttons`
  - `triggers`
  - `axes`
- `BINDABLE_GAMEPAD_BUTTONS` intentionally excludes LT/RT. Triggers stay reserved for Tone / Trigger Note behavior, and analog sticks stay reserved for pitch/modulation.
- `gamepadButtonInfo(index)` is the shared display-label resolver for mapper UI and Controller screen status.

### Controller screen role

- `ControllerMode` now receives the shared `GamepadInputManager`.
- It no longer owns polling as the primary source of truth. It subscribes to the shared manager for connection state, button highlights, trigger values, and stick movement.
- The old top-left note list has been replaced with a current bindings/fallback panel:
  - if bindings exist, it lists button -> target
  - if no bindings exist, it shows the old fallback scale shape
- The Controller tab remains available as a setup/status surface. It is no longer the only way controller input can make sound.

### Binding storage

Controller bindings live in project settings:

```js
project.settings.controllerBindings = {
  "0": {
    type: "midi",
    midi: 60,
    label: "C4",
    source: "piano"
  },
  "1": {
    type: "drum",
    padId: "kick",
    gmNote: 36,
    label: "Kick",
    source: "kit"
  }
}
```

- This is additive and defaults to `{}` in `createProject()`.
- Existing projects without the field keep working. Unbound buttons use fallback behavior.
- Do not collapse this back to `{ buttonIndex: midi }`; the richer object is needed so drum sounds, labels, source, and future metadata can survive backups and reloads.

### Learn hooks

Three instruments now expose controller-learn hooks:

- `ScaleBoard.setControllerLearnCallback(fn)`
- `MicroPiano.setControllerLearnCallback(fn)`
- `SketchKit.setControllerLearnCallback(fn)`

When the mapper is waiting for a target:

- Scale Board reports `{ type: "midi", midi, label, source: "scale", padIndex }`.
- MicroPiano reports `{ type: "midi", midi, label, source: "piano" }`.
- SketchKit reports `{ type: "drum", padId, gmNote, label, source: "kit" }`.
- Voice Sketch mode reports no target. The mapper button is hidden while Scale Board is in Voice Sketch.
- Returning `true` from the callback means the note/pad press was consumed for learning and should not play.

### Mapper UI

- Creative Mode now renders a `Controller` button near `AI` in the synth toolbar.
- SketchKit renders the same button next to its AI button.
- The mapper is a compact `tone-popover` sibling, not a full Settings drawer.
- Learn flow:
  1. hold a bindable controller button
  2. click `Set`
  3. click a Scale pad, Piano key, or Kit pad
  4. binding is saved and the modal stays open
- The list view supports per-binding `Unbind` and `Clear All Bindings`.

### Playback routing

- Global controller playback is active only while Create Mode is active.
- Bound MIDI targets play through the current synth patch and current Tone settings, even if the visible Create tab is Kit.
- Bound drum targets call `SketchKit.triggerPad(padId)`, so they use the currently selected kit and current Tone settings, even if the visible Create tab is Scale/Piano/Controller.
- MIDI bindings call `RecordingManager.noteOn/noteOff` so Create recording captures them as normal notes.
- Drum bindings call the existing `SketchKit.triggerPad()` path, so drum recording captures them through the normal hit callback.
- Unbound buttons use fallback behavior based on the currently visible Create tab:
  - Scale: old degree-style pad mapping
  - Piano: visible-key mapping
  - Kit: visible-pad mapping
  - Controller: old Controller Mode scale/chord fallback via `handleFallbackButtonDown/Up`
- Canvas has no controller mapper or controller playback in this version by design.

## Project Key / Scale And Degree Highlighting Milestone 0.1.14

This build introduces a shared project-level musical context so Scale, Piano, Controller fallback, AI context, and theory coloring stop drifting away from each other.

### Project musical context

- New projects now include:

```js
project.musicalContext = {
  root: "C",
  scale: "major"
}
```

- `MusicTheory.normalizeMusicalContext(context)` is the canonical normalizer. It falls back to `C major` if a loaded project is missing the field or contains an unknown root/scale.
- `App._ensureProjectMusicalContext()` normalizes older projects after load.
- `TransportBar` owns only the UI controls and exposes `onProjectKeyChange`. It does not own project state.
- `App._setProjectMusicalContext(context)` is the central write path:
  - normalizes the root/scale
  - writes `project.musicalContext`
  - syncs the top-bar selects
  - calls `CreativeMode.applyProjectMusicalContext()`
  - schedules autosave
  - dispatches `project-musical-context-changed`
- `ScaleBoard` and `ControllerMode` still show their local Root/Scale selects, but changing either now routes through CreativeMode and updates the shared project context.
- `MicroPiano` remains chromatic. It does not change its notes when project scale changes, but it can color keys by the shared scale.

### Transport UI

- The top transport bar now has compact `Key` controls between BPM and the overflow/menu area.
- On narrow/mobile layouts the key controls wrap to a second row instead of crowding the Stop/Play/Record controls.

### Degree highlighting settings

New projects now include:

```js
project.settings.degreeHighlighting = {
  enabled: false,
  showLabels: false,
  colors: {
    0: "#ff6b6b",
    1: "#ff8a5c",
    2: "#f7b267",
    3: "#d16fcb",
    4: "#7bd88f",
    5: "#5bd6d6",
    6: "#6fb4ff",
    7: "#7d8cff",
    8: "#a884ff",
    9: "#d783ff",
    10: "#ff77c8",
    11: "#f05d8e"
  }
}
```

- `MusicTheory.normalizeDegreeHighlighting(value)` is the canonical normalizer.
- Colors are keyed by semitone interval from root, not by a hardcoded 1-7 degree index. This matters for minor, pentatonic, blues, Dorian, and Mixolydian.
- `MusicTheory.degreeForMidi(midi, context)` returns `null` when the MIDI note is outside the current project scale. It returns `{ interval, label, name }` when the note belongs to the scale.
- Labels intentionally use compact interval names:
  - `Root`, `b2`, `2`, `b3`, `3`, `4`, `b5`, `5`, `b6`, `6`, `b7`, `7`
  - This avoids telling users a minor third is a "Major 3rd" or a Mixolydian seventh is a "Major 7th".

### Pads and Keys panels

- The `Pads` button is now visible whenever Scale Board is active, not only in Custom mode.
- In Custom mode, Pads still shows the custom pad-count slider.
- Outside Custom mode, Pads shows a short hint instead of the count slider, then the shared Degree Colors controls.
- The Piano `Keys` panel now includes the same Degree Colors controls under the existing piano count/key count controls.
- Degree settings include:
  - `Highlight scale degrees`
  - `Show degree labels`
  - current-scale color swatches
  - `Reset`
- The swatch list follows the current project scale. Major shows seven colors, pentatonic shows five, blues shows six, etc.

### Rendering behavior

- Scale Board pads:
  - use `degreeForMidi()` against `project.musicalContext`
  - tint the pad when highlighting is enabled
  - optionally show compact interval labels when `showLabels` is enabled
  - do not apply degree labels/colors in Voice Sketch mode, because voice syllable labels already compete for that space
- MicroPiano:
  - stays chromatic
  - colors only keys that belong to the current project scale
  - optionally shows compact interval labels above matching keys

### Controller screen cleanup

- The Controller tab no longer labels fallback rows as if they were saved bindings.
- When no custom bindings exist it now says `Custom bindings / None set`, shows `No custom bindings yet`, then shows the fallback scale rows under a separate `Fallback scale` heading.
- Controller fallback root/scale now syncs to `project.musicalContext`.

## Toolbar Cleanup Milestone 0.1.15

This is a UI correction pass after the shared project key/scale landed.

### Project key is the only key selector

- Removed the duplicate Root/Scale controls from `ScaleBoard`.
- Removed the duplicate Root/Scale controls from `ControllerMode`.
- Scale Board and Controller fallback still read `project.musicalContext`; they just no longer present local controls that imply they can diverge from the project key.
- Root Mode on Scale Board now uses the top-bar project root. If future UX needs a temporary per-instrument root, it should be designed as an explicit override rather than quietly reintroducing a second root selector.

### Stable Layout button

- The Create toolbar now uses one stable `Layout` button instead of separately showing/hiding `Pads` and `Keys`.
- On Scale Board it is labeled `Pads` and opens the Pads layout / Degree Colors popover.
- On MicroPiano it is labeled `Keys` and opens the Keys layout / Degree Colors popover.
- On Controller and other unsupported surfaces it remains visible as `Layout` but is disabled. This keeps the toolbar from visually jumping between instruments.

### AI button on Controller

- The patch toolbar now keeps the `AI` button visible on the Controller tab, but disabled.
- Clicking disabled AI does nothing.
- The disabled tooltip explains that AI Seed is not available from Controller setup.
- This follows the agreed pattern: keep toolbar affordances visible where they help orientation, but disable them when the active surface cannot use them.

### Controller helper copy

- Controller fallback text no longer says `near AI`.
- It now says to use the Controller button in the upper app toolbar. This avoids referencing another button that may be disabled or unavailable in that context.

### Kit toolbar row

- `SketchKit`'s selector row now uses the same surface background and bottom border treatment as the synth toolbar row.
- This keeps Kit from looking like its kit dropdown / Tone / AI / Controller controls are floating loose under the tab bar.

## Layout Button Label Cleanup 0.1.16

- The Create toolbar `Layout` button now always says `Layout`.
- It no longer changes its visible label to `Pads` on Scale Board or `Keys` on MicroPiano.
- Behavior remains context-aware:
  - Scale Board opens the Pads layout / Degree Colors popover.
  - MicroPiano opens the Keys layout / Degree Colors popover.
  - Unsupported Create surfaces show the same button disabled.
- Reason: changing the button text per instrument made the toolbar feel visually unstable. Consistent labeling is preferred even if the panel contents differ by active instrument.

## Degree Highlighting / Octave Cleanup 0.1.17

- Degree highlighting now has a separate `intensity` value:

```js
project.settings.degreeHighlighting = {
  enabled: false,
  showLabels: false,
  intensity: 0.22,
  colors: { ... }
}
```

- `normalizeDegreeHighlighting()` clamps intensity between `0.05` and `0.75`.
- The Layout panel renders a `Color intensity` slider from 5% to 75%.
- Degree labels and color highlighting are independent:
  - `showLabels: true` can show labels without `enabled: true`.
  - Label-only mode does not add the colored piano key outline or Scale Board color tint.
  - When color highlighting is enabled, labels use the degree color.
  - When color highlighting is disabled, labels use normal key/pad readable text colors.
- CSS classes are intentionally split:
  - `scaleboard__pad--degree-color`
  - `scaleboard__pad--degree-label`
  - `micropiano__key--degree-color`
  - `micropiano__key--degree-label`
- Scale Board and Controller octave floors now match Piano's lower practical octave:
  - old clamp: `2..6`
  - new clamp: `1..6`
- There was no hard audio limitation behind the old C2-ish floor. It was an old guardrail. C1 is allowed now; C0 remains avoided because it is mostly sub-bass rumble on normal speakers and is less useful for this app's default playing surface.
