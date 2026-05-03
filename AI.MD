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
      notes: [
        { pitch: 60, startTick: 0, durationTick: 480, velocity: 0.8 }
      ],
      hits: [
        { type: "kick", startTick: 0, velocity: 1.0 }
      ],
    }
  ],
  settings: {
    quantize: 0,              // QuantizeGrid enum value
    metronomeOn: false,
    metronomeVolume: 0.5,
    loopBars: 4,
    masterVolume: 0.8,
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
- **Mic audio integration** — MicRecorder captures audio blobs, but they aren't stored as snippets or playable in the Canvas. Need to convert audio blobs to AudioBuffers and create an audio-type snippet.
- **MIDI input** — No Web MIDI API integration yet. Could map MIDI keyboard input to the synth.
- **Overdubbing** — Record additional notes on top of an existing snippet.
- **Mobile touch optimization** — Touch events work but multi-touch (e.g., piano chords) needs testing.
- **Export to MIDI file** — ABC export works, but .mid file export is not implemented.

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
9. **IndexedDB auto-saves** — call `store.scheduleAutoSave(project)` after any project mutation
10. **Dev server**: `npm run dev` → runs on `http://localhost:5173/`
