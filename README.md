# 🎵 Notenotes

**A rapid-capture musical sketchpad PWA.** Jam, record, arrange, edit, and export — all in the browser, zero backend required.

Notenotes is designed for musicians, producers, and anyone who wants a zero-friction way to capture musical ideas on any device. It runs entirely in the browser using the Web Audio API, stores everything locally via IndexedDB, and works offline as a Progressive Web App.

---

## ✨ Features

### 🎹 Creative Mode — The Jam Space
- **Scale Board** — Dynamic multi-pad controller (up to 16 pads) locked to any scale (Major, Minor, Pentatonic, Blues, Dorian, Mixolydian, Chromatic). Pad count follows scale degrees in Single/Chords mode; fully configurable in Custom mode.
- **Micro Piano** — Configurable chromatic keyboard (1 or 2 stacked, 10–32 keys each) with octave shifting
- **Sketch Kit** — 10-pad synthesized drum kit (Kick, Snare, Clap, Hi-Hat, Cymbal, Toms, Rim, Shaker), 4 selectable kits (Classic, 808, Electronic, Acoustic), configurable pad count
- **Mic Recorder** — Record audio from your microphone with live waveform visualization. Audio snippets save as playable clips on the timeline.
- **Arpeggio / Hold** — Toggle Normal / Hold (latch notes) / Arpeggio (repeat strikes). 10 chord types, 4 patterns, 4 rates. Drums not affected.
- **8 Synth Presets** — Retro (Chip Lead, Warm Pad), Modern (Glass Pluck, Sub Bass, Bright Lead), Lo-fi (Tape Keys, Dusty Organ, Vinyl Strings)
- **Loop Recording** — Punch-in recording with automatic snippet capture on loop wrap

### 🎼 Canvas Mode — The Arranger
- Multi-track horizontal timeline with bar/beat grid
- Drag snippets from the dock onto track lanes (MIDI, drum, and audio clips)
- Move, resize, and delete clips with full undo/redo
- **✂️ Trim** button — remove empty space at start/end of all snippets
- Per-track Mute/Solo controls
- Loop region auto-calculated from clip positions (no manual bar selection needed)
- Animated playhead synchronized to transport
- Audio tracks auto-hide instrument selector, showing "🎤 Audio"

### ✏️ Inspect Mode — Piano Roll & Audio
- Click-to-add notes on a pitch/time grid
- Drag notes to move (pitch + time), resize for duration
- Vertical zoom (+/−) and configurable octave range (C1–C6)
- **Split view** — dual stacked piano rolls for separate octave ranges
- Configurable grid quantization (1/4, 1/8, 1/16, 1/2)
- Delete notes via keyboard or button
- **Audio snippets** open an audio player with controls and metadata

### ⚙️ Settings & Export
- **Sheet Music Export** — Render snippets as sheet music via [abcjs](https://paulrosen.github.io/abcjs/). Drum snippets use percussion clef. Export as SVG or ABC text.
- **Project Settings** — Name, BPM, quantization grid, metronome volume, master volume, Time Signature background visualizer with custom beat colors
- **Instrument Settings** — Scale Board pad count, Piano count/keys, Drum Kit pad count
- **Arpeggio Settings** — Rate, chord type, pattern, hold duration
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
    │   ├── ArpeggioManager.js # Hold/arp modes, chord types, patterns
    │   ├── PlaybackEngine.js  # Canvas clip playback (synth, drums, audio)
    │   └── MusicTheory.js     # Scales, note names, MIDI utilities
    │
    ├── instruments/           # Sound generators
    │   ├── WebAudioSynth.js   # 8-voice polyphonic synth (ADSR, filter, 8 presets)
    │   ├── ScaleBoard.js      # Scale-locked multi-pad controller
    │   ├── MicroPiano.js      # Chromatic keyboard (1-2 stacked, 10-32 keys)
    │   ├── SketchKit.js       # 10-pad synth drum kit with 4 presets
    │   ├── MicRecorder.js     # MediaRecorder + live visualizer
    │   └── instruments.css    # Instrument-specific styles
    │
    ├── modes/                 # App modes (views)
    │   ├── CreativeMode.js    # Jam space (instrument switcher + recording + arp)
    │   ├── CanvasMode.js      # Multi-track arranger timeline + trim
    │   ├── EditMode.js        # Piano roll editor + audio player (Inspect tab)
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

## 🛠️ Creating Custom Instruments

Notenotes instruments are vanilla JavaScript classes that follow a consistent pattern. You can add new sounds or entire instruments by creating a file in `src/instruments/`.

### Instrument Pattern

Every instrument implements this interface:

```js
export class MyInstrument {
  constructor(synth, project) {
    // Store dependencies
    // this.el = null — DOM will be created in render()
  }

  // Optional: called once after audio engine is ready
  init() {}

  // Required: return the instrument's DOM element
  render() {
    this.el = document.createElement('div');
    this.el.className = 'my-instrument';
    // Build DOM, bind events
    return this.el;
  }

  // Optional: callback wiring for recording
  setHitCallback(onHit) {}       // for drum/percussion
  setNoteCallbacks(onNoteOn, onNoteOff) {} // for pitched instruments
}
```

### Wiring It In

1. **Create your instrument file** in `src/instruments/MyInstrument.js`
2. **Import it in `CreativeMode.js`**:
   ```js
   import { MyInstrument } from '../instruments/MyInstrument.js';
   ```
3. **Instantiate it** in the constructor:
   ```js
   this.myInstrument = new MyInstrument(this.synth, this.project);
   ```
4. **Pass the project reference** in the `set project(p)` setter:
   ```js
   if (this.myInstrument) this.myInstrument.project = p;
   ```
5. **Add it to the render** in the `views` array inside `render()`:
   ```js
   { id: 'myinstrument', content: this.myInstrument.render() }
   ```
6. **Add a tab** in the instrument switcher:
   ```js
   { id: 'myinstrument', icon: '🎸', label: 'MyInstr' }
   ```
7. **Wire recording callbacks** in `init()`:
   ```js
   this.myInstrument.setNoteCallbacks(noteOn, noteOff);
   ```

### Audio Example: Synthesized Drum Sound

All drum sounds in SketchKit are synthesized from oscillators and noise:

```js
_synthMyDrum(ctx, t) {
  // White noise burst through a bandpass filter
  const len = 0.1, bs = ctx.sampleRate * len;
  const buf = ctx.createBuffer(1, bs, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bs; i++) d[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource(); noise.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass'; filter.frequency.value = 2000; filter.Q.value = 5;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.8, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + len);

  noise.connect(filter); filter.connect(gain); gain.connect(this._output);
  noise.start(t);
}
```

Key techniques:
- `ctx.createOscillator()` + frequency ramp → tone-based sounds (kick, toms)
- `ctx.createBuffer()` with random samples + filter → noise-based sounds (snare, hi-hat, shaker)
- `gain.exponentialRampToValueAtTime()` → natural decay envelope
- Layer multiple sources for richer sounds (snare = noise + tone body)

### CSS

Add styles in `src/instruments/instruments.css` following BEM conventions:
```css
.my-instrument { /* container layout */ }
.my-instrument__pad { /* interactive element */ }
.my-instrument__pad.is-active { /* pressed state */ }
```

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
| `Click HLD/ARP button` | Cycle between Normal / Hold / Arpeggio modes |

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
