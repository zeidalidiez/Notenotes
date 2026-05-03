# 🎵 Notenotes

**A rapid-capture musical sketchpad PWA.** Jam, record, arrange, edit, and export — all in the browser, zero backend required.

Notenotes is designed for musicians, producers, and anyone who wants a zero-friction way to capture musical ideas on any device. It runs entirely in the browser using the Web Audio API, stores everything locally via IndexedDB, and works offline as a Progressive Web App.

---

## ✨ Features

### 🎹 Creative Mode — The Jam Space
- **Scale Board** — Dynamic multi-pad controller (up to 16 pads) locked to any scale (Major, Minor, Pentatonic, Blues, Dorian, Mixolydian, Chromatic)
- **Micro Piano** — Full chromatic 12-key keyboard with octave shifting
- **Sketch Kit** — 5-pad synthesized drum kit (Kick, Snare, Clap, Hi-Hat, Cymbal)
- **Mic Recorder** — Record audio from your microphone with live waveform visualization
- **8 Synth Presets** — Retro (Chip Lead, Warm Pad), Modern (Glass Pluck, Sub Bass, Bright Lead), Lo-fi (Tape Keys, Dusty Organ, Vinyl Strings)
- **Loop Recording** — Punch-in recording with automatic snippet capture on loop wrap

### 🎼 Canvas Mode — The Arranger
- Multi-track horizontal timeline with bar/beat grid
- Drag snippets from the dock onto track lanes
- Move, resize, and delete clips with full undo/redo
- Per-track Mute/Solo controls
- Animated playhead synchronized to transport

### ✏️ Edit Mode — Piano Roll
- Click-to-add notes on a pitch/time grid
- Drag notes to move (pitch + time), resize for duration
- Velocity editing via dedicated lane at the bottom
- Configurable grid quantization (1/4, 1/8, 1/16, 1/2)
- Delete notes via keyboard or button

### ⚙️ Settings & Export
- **Sheet Music Export** — Render snippets as sheet music via [abcjs](https://paulrosen.github.io/abcjs/), export as SVG or ABC text
- **Project Settings** — Name, BPM, quantization grid, Scale Board pad counts, Time Signature background visualizer (custom beat colors), metronome volume, master volume
- **Version History** — Auto-saves up to 5 snapshots; restore any previous version
- **Metronome** — Available in every mode, with accent on beat 1

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+ (LTS recommended)
- **npm** (comes with Node.js)

### Install & Run

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/Notenotes.git
cd Notenotes

# 2. Install dependencies
npm install --legacy-peer-deps

# 3. Start the development server
npm run dev
```

The app will open at **http://localhost:5173/** — click any instrument pad to initialize audio (browser requires a user gesture to start AudioContext).

### Build for Production

```bash
npm run build
npm run preview   # Preview the production build locally
```

The production build outputs to `dist/` and is PWA-ready with a service worker for offline use.

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| **Build** | [Vite](https://vitejs.dev/) 8.x |
| **Audio** | Web Audio API (AudioContext, OscillatorNode, GainNode, BiquadFilterNode) |
| **Persistence** | IndexedDB via [idb](https://github.com/nicolo-ribaudo/idb) |
| **Sheet Music** | [abcjs](https://paulrosen.github.io/abcjs/) (ABC notation → SVG rendering) |
| **PWA** | [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) (Service Worker, Manifest) |
| **Styling** | Vanilla CSS with custom design system (charcoal/silver palette) |
| **Framework** | None — pure vanilla JavaScript (ES Modules) |

### Why No Framework?
Notenotes is intentionally framework-free. Web Audio applications demand precise control over timing, memory, and DOM updates. A framework's virtual DOM reconciliation would add unpredictable latency to audio scheduling. Every DOM update is manual and optimized for the specific use case.

---

## 📁 Project Structure

```
Notenotes/
├── index.html                 # PWA entry point
├── vite.config.js             # Vite + PWA plugin config
├── package.json
│
├── public/                    # Static assets (icons, manifest)
│
└── src/
    ├── main.js                # App bootstrap, mode orchestration
    ├── style.css              # Design system + global styles
    │
    ├── engine/                # Audio & timing core
    │   ├── AudioEngine.js     # Web Audio singleton (master gain, compressor)
    │   ├── Transport.js       # Play/stop/record, BPM, lookahead scheduler
    │   ├── Metronome.js       # Click track (oscillator-based)
    │   ├── Quantizer.js       # Grid quantization logic
    │   ├── RecordingManager.js# MIDI event capture during loops
    │   └── MusicTheory.js     # Scales, note names, MIDI utilities
    │
    ├── instruments/           # Sound generators
    │   ├── WebAudioSynth.js   # 8-voice polyphonic synth (ADSR, filter, 8 presets)
    │   ├── ScaleBoard.js      # Scale-locked 7-pad controller
    │   ├── MicroPiano.js      # Chromatic 12-key keyboard
    │   ├── SketchKit.js       # Synthesized 5-pad drum kit
    │   ├── MicRecorder.js     # MediaRecorder + live visualizer
    │   └── instruments.css    # Instrument-specific styles
    │
    ├── modes/                 # App modes (views)
    │   ├── CreativeMode.js    # Jam space (instrument switcher + recording)
    │   ├── CanvasMode.js      # Multi-track arranger timeline
    │   ├── EditMode.js        # Piano roll note editor
    │   ├── creative.css
    │   ├── canvas.css
    │   └── edit.css
    │
    ├── ui/                    # Shared UI components
    │   ├── TransportBar.js    # Top control bar (play, stop, record, BPM)
    │   ├── ModeTabs.js        # Bottom navigation tabs
    │   ├── SnippetTray.js     # Captured snippet list with SVG previews
    │   ├── LoopProgress.js    # Animated loop position bar
    │   ├── SettingsPanel.js   # Slide-out settings drawer
    │   ├── Toast.js           # Notification toasts
    │   └── settings.css
    │
    ├── data/                  # Persistence layer
    │   ├── ProjectStore.js    # IndexedDB CRUD + version history
    │   └── UndoManager.js     # Command-pattern undo/redo stack
    │
    └── export/                # Export & conversion
        ├── ABCConverter.js    # MIDI snippet → ABC notation
        └── SheetMusicView.js  # abcjs renderer + SVG/ABC download
```

---

## 🎨 Design System

The UI uses a **charcoal + silver** palette with glass-effect surfaces:

| Token | Value | Usage |
|---|---|---|
| `--surface-0` | `#0d0d0f` | App background |
| `--surface-1` | `#141416` | Cards, panels |
| `--accent` | `#a0a0a0` → silver gradient | Interactive highlights |
| `--accent-light` | `#d0d0d0` | Active states |
| Font | [Inter](https://fonts.google.com/specimen/Inter) | All text |

---

## 🎯 How It Was Made

Notenotes was built in 6 iterative phases using AI-assisted pair programming:

1. **Phase 1 — Foundation**: Audio engine singleton, lookahead transport scheduler, IndexedDB persistence with auto-save, undo/redo manager, and the UI shell (transport bar + mode tabs)
2. **Phase 2 — Instruments**: Polyphonic Web Audio synth with 8 presets, 4 instrument UIs (Scale Board, Micro Piano, Sketch Kit, Mic Recorder), and the Creative Mode orchestrator
3. **Phase 3 — Recording**: Loop-based punch-in recording, MIDI event capture, automatic snippet generation on loop wrap, and the Snippet Tray UI with SVG previews
4. **Phase 4 — Arranger**: Canvas Mode with horizontal scrollable timeline, track lanes, drag-and-drop clip placement from snippet dock, mute/solo, and animated playhead
5. **Phase 5 — Piano Roll**: Per-clip note editor with click-to-add, drag-to-move/resize, velocity editing, and grid quantization
6. **Phase 6 — Export & Polish**: ABC notation converter, abcjs sheet music rendering, SVG/ABC file export, settings panel, and version history with restore

Each phase was built iteratively — code first, then browser testing with screenshots to verify, then fixes and refinements.

---

## 📋 Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `Enter` | Stop (rewind to loop start) |
| `R` | Toggle recording |
| `M` | Toggle metronome |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Delete` / `Backspace` | Delete selected note or clip |

---

## 📄 License

MIT

---

## 🤖 For AI Developers

If you are an AI agent or LLM assisting with this project, **you must read the `AI.MD` file before making structural changes.** 

`AI.MD` is a living context document that contains:
- Architectural overviews and the dependency graph.
- Critical context regarding the Web Audio lookahead scheduler (e.g., why you should never use `setTimeout` for audio).
- The exact state shape of projects and snippets in the IndexedDB store.
- Common "gotchas" such as UI component initialization and project loading lifecycle.

**How to use `AI.MD`:**
1. Read it first when starting a new session.
2. If you solve a complex architectural bug or establish a new UI pattern, **append your findings** to `AI.MD` as comments or new sections at the bottom. **Never delete** existing context unless explicitly told it is deprecated.
