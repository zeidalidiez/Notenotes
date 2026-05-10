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
- In `single`/`chords` pad modes, pad count equals the scale's interval count (`SCALES[name].intervals.length`): Major → 7, Pentatonic → 5, Blues → 6.
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
- Tracks with audio clips hide the instrument dropdown, showing "🎤 Audio" label instead.
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
- Canvas: `.canvas-lane__inst-label` for "🎤 Audio" instrument display on audio tracks.
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

Current App Version: `0.0.19`

The visible app version is displayed in Settings. Bump it for meaningful user-facing changes or architecture/storage changes, especially when AI.MD is updated for completed work.

Keep these in sync:

- `src/version.js`
- `package.json`
- `package-lock.json`
- this section of `AI.MD`

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


## AI Seed Snippets

A new "AI Seed" panel above the snippet tray lets the user ask an LLM (or a local Mock provider) to generate a snippet. The AI is treated as one of the user's instruments — it produces raw musical material the user keeps, refines, or discards. The user remains the composer.

The feature is BYO-key: the user pastes their own provider API key, the request goes directly from the browser to the provider, and Notenotes never sees, logs, or relays the prompt or the output.

### Files

- `src/ai/sequence-schema.js` — Single source of truth for the shape an AI emits. Exports `AI_INSTRUMENTS`, `KIT_DRUMS`, `getSequenceSchemaForInstrument(id)`, and `getSubmitSequenceTool(id)`. Used by validator, executor, prompt builder, and the LLM tool surface.
- `src/ai/SequenceValidator.js` — Pure `validateSequence(sequence, context)` that rejects malformed AI output before it touches the project.
- `src/ai/SequenceExecutor.js` — `buildSnippetFromSequence(sequence, context)` constructs a snippet directly compatible with `project.snippets[]` from a validated sequence. No transport coordination, no real-time playback.
- `src/ai/PromptBuilder.js` — Builds the system prompt, tool definition, and user prompt. Also has token/cost estimation helpers.
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
  name: "🤖 N notes" | "🤖 N hits",
}
```

`SnippetTray` looks for `aiSeeded` and renders a `🤖 AI` badge with the original prompt as the hover title.

The AI metadata travels with the snippet through workspace backups and is preserved across export/import.

### Settings storage

**API keys are session-only.** `aiSettings.js` holds them in a module-scoped Map; nothing ever writes them to localStorage, IndexedDB, cookies, or the project JSON. On page reload, the Map is empty and the user re-enters their key. This is intentional — the project does not want to be in the business of storing user credentials.

Non-secret config (provider id, model id, Ollama base URL, disclaimer-accepted flag, default length-bars) lives in `project.settings.aiSettings`. That makes the picked model and provider part of the project — useful for "what model was I using when I made this?" reproducibility — and travels with workspace backups. No credentials are ever included in those backups.

`hasApiKey(providerId)` is the safe way to check whether a key is staged for the current session without leaking the value. The Settings panel uses it to show "Key staged for this session" vs "No key staged" without rendering the key text.

### UI placement

The AI Seed feature is a popover anchored to a small toolbar row above the snippet tray. The row (and the button it contains) is **only visible on Scale Board, Piano, and Sketch Kit** — the three instruments whose primitives the AI can write events for. Mic (audio recording) and Controller (deliberately scoped out per user) hide the row entirely. Switching instruments while the popover is open closes it.

The popover renders the `AISeedPanel` component on demand (constructed when the user clicks the button, destroyed when the popover closes). All event handlers bind at construction time, so there is no "click around to wake it up" state — the popover is fully interactive the moment it appears. Click-outside closes it; Escape closes it; the X in the header closes it.

### Cost transparency

`AIController.estimateGenerationCost({ prompt })` returns an approximate USD cost based on per-million-token pricing tables in each provider class. The AI Seed Panel surfaces this estimate ("~$0.02") below the prompt textarea before the user clicks Generate.

Mock and Ollama report "$0".

### Provider quirks

- **OpenAI**: standard Chat Completions with `tools` + `tool_choice: { type: 'function', function: { name } }`. Force-pinning the tool stops the model from refusing or talking back.
- **Anthropic**: Messages API with `system` as a top-level field (not a message), `tools` with `input_schema`, and `tool_choice: { type: 'tool', name }`. Requires `anthropic-dangerous-direct-browser-access: true` for in-browser usage.
- **Ollama**: served via the OpenAIProvider with a custom `baseUrl` (default `http://localhost:11434/v1`). Model ids are user-installed (`llama3.1:8b`, `qwen2.5:7b`, etc.). Tool calling support varies by model — Llama 3.1, Qwen 2.5, and Mistral generally work; older models may not respect the schema.
- **Mock**: returns canned-but-musical patterns for 1/2/4/8 bars, on each instrument. No network. Default provider on first run so the user can validate the pipeline before committing to a key.

### v1 limitations (intentional, not bugs)

- **No reference snippet picker.** The pipeline supports a `referencedSnippet` context field, but the UI does not yet expose a way to attach one. Add a "+ Reference snippet" picker in a follow-up.
- **No running cost counter.** The per-generation estimate is shown; cumulative session/project totals are not tracked.
- **No rate limiting / per-session budget cap.** A user could spam Generate. Acceptable for v1; surfaced as a future "max $X per session" setting.
- **Prompt is single-shot.** No retry on validator failure with a self-correction message. If the LLM returns garbage, the user sees the error and can refine their prompt.
- **No streaming.** Sequences come back atomically. With small JSON outputs this isn't a UX problem.
- **No multi-tool conversations.** One tool, one call, one snippet.

### Adding a new provider

1. Subclass `AIProvider`. Implement `generate({systemPrompt, userPrompt, tool, model, signal})`.
2. Add the provider to `AIController._resolveProvider`.
3. Add an option to the Settings AI section's provider dropdown (in `SettingsPanel._renderAISection`) and a `case` in `providerModelsForUi`.
4. If the provider has its own pricing, override `getPricing(modelId)`.
5. If credentials are required, read them via `readApiKey('<providerId>')`. Keys live in the in-memory Map only — do not write a custom credential store, and do not persist them.
