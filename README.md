<div align="center">

# Notenotes

**A free, open-source pre-DAW. A way into music for people who have never found a way in, and a way out of your usual patterns for musicians.**

[**Try it now**](https://zeidalidiez.github.io/Notenotes/) | [Report an idea](https://github.com/zeidalidiez/Notenotes/issues/new) | [Contribute](#-contributing)

![Notenotes - Pads view](labels.png)

</div>

---

## What is it and why does it exist?

Notenotes is a pre-DAW. Think of it as the napkin sketch before you sit down at a recording studio. It uses unconventional inputs (a gamepad, a microphone to make instruments, scale-locked pads, color-coded beats) to make music feel like something you can just do, not a language you have to learn first. Capture an idea here, then take it to whatever you normally use to finish songs.

I built this app primarily to experiment with music myself, and to understand ways to think about music outside of the constraints of what I've learned in music theory. I am a long time musician who has trouble putting ideas into a DAW, so I needed a noodling board of sorts. This is not ever meant to replace a DAW, and as such I don't want to focus on production and effects. In my head you come up with a hook on Notenotes and then you build it into a song elsewhere. 


**Color over notation** Beats can be colors. Pads can be colors (this is in progress). I want people to read songs in different ways.

**Unconventional instruments** Plug in a controller - the buttons become your scale. Extremely intuitive, easy to pick up.

**Always in scale** Lock the pads to a key to narrow your options to the notes you need to see. 

**Songs canvas** Drag blocks of sound onto a simplified, minimalistic canvas grid.
 
**Local, offline** Runs in your computer and does not require anything, not even an online connection.


---

##  Try it in 10 seconds

> **Live app:** [zeidalidiez.github.io/Notenotes](https://zeidalidiez.github.io/Notenotes/)

No install. Click a pad. You're making music.

It's a Progressive Web App. In Chrome, use the three-dot menu, then Cast, save, and share, then Install page as app. In Edge, use Apps, then Install this site as an app. In Safari, use Share, then Add to Home Screen. The current app version is shown in Settings, and Settings can check GitHub for the newest public version if your browser is hanging onto an old cached build.

---

##  A quick tour

### Create - the jam space

![Create mode - Pads with numbered, scale-locked pads](scale.gif)

Pick a scale. Mash the pads. Switch instruments mid-loop. Press record, jam, press stop - your loop becomes a snippet.

### Controller - your gamepad is an instrument

![Controller mode - gamepad as a scale-locked instrument](controller.gif)

<sub>Controller artwork by [nicefrog](https://opengameart.org/users/nicefrog) - [Generic Gamepad Template](https://opengameart.org/content/generic-gamepad-template), released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Thank you, nicefrog.</sub>

Plug in any USB or Bluetooth controller. D-pad and face buttons map to the scale by default, or you can teach buttons to trigger exact notes and drum sounds. Learned buttons are global in Create, so a Kick button can still fire while you are looking at Piano, and a C4 button can still fire while you are looking at Kit. Analog sticks bend pitch and add modulation. Triggers can punch in Tone effects, or turn the next note into a 7th, 9th, octave jump, and other related-note choices. Pass the controller to a friend who's never touched a keyboard - watch what happens.

### Canvas - composition as collage

![Canvas mode - dragging snippets onto a multi-track timeline](canvas.gif)

Drag your captured snippets onto typed tracks. MIDI goes on MIDI tracks, drums go on drum tracks, and audio goes on audio tracks. Stretch them, mute them, layer them. Hit play and listen to the song you didn't know you were writing.

### Inspect - when you're ready for detail

![Inspect mode - piano roll editor for refining notes](inspect.gif)

Open any snippet in a piano roll for fine edits. Click to add notes, drag to move them. Or skip this entirely - Notenotes works without it.

---

## What it is right now

### Instruments

| Instrument | What it is |
|---|---|
| **Pads** | Pads locked to the project key and scale (Major, Minor, Pentatonic, Blues, Dorian, Mixolydian, Chromatic). Pad count follows the scale, Extensions can continue it into the next octave, go fully custom, or switch into Compass for a circle-of-fifths chord surface. |
| **Controller** | Gamepad-as-instrument via the Web Gamepad API. The Controller button near AI opens a learnable mapper, while the Controller screen shows connection state, trigger assignments, live highlights, current bindings, and saved binding presets. Pads bindings remember whether they were learned as notes, chords, or Root pads. |
| **Micro Piano** | Configurable chromatic keyboard (1 or 2 stacked, 10–32 keys each) with octave shifting. Optional degree colors can mark which keys belong to the project key. |
| **Sketch Kit** | 10-pad synthesized drum kit. Four kit presets (Classic, 808, Electronic, Acoustic), with the same Tone controls as the synth side. |
| **Audio In** | Record from any input device with a live waveform. New audio snippets are saved with durable audio data so backups can actually bring them back. |

Plus: **16 synth presets** split into Chip and Modern families, **Tone** controls for shaping sound without becoming a full DAW, and the entire instrument layer is [pluggable](#-build-your-own-instrument).

### For someone who wants a different perspective into the world of music.

- **Scale-locked pads** - every press is in key. You can't pick a wrong note. Turn on **Extensions** to keep the scale going into the next octave without turning it into a theory quiz.
- **Project key and scale** - set the shared root and scale in the top bar. Pads, Controller fallback, AI context, and the optional Piano/Pad degree colors all read from the same place instead of each feature guessing on its own. The old duplicate Root/Scale controls are intentionally gone from Pads and Ctrl.
- **Beat colors** - set a different color for each beat. The background pulses in time so you can *see* the meter.
- **Degree colors** - the Layout panel can turn on shared degree highlighting, adjust color intensity, or show degree labels without the colored outlines. It is off by default. Pads use plain function names like Tonic and Dominant, while Piano keeps compact shorthand badges like b3 and 5.
- **Hold & arpeggio modes** - latch notes, auto-arpeggiate chords across **10 chord types**, **4 patterns**, and **4 rates**. Or sustain a drone while you explore.
- **Tone** - simple sliders for Crush, Echo, Space, Wobble, Drive, and Noise. They work on synths and the drum kit, can be saved as presets, reset back to zero, and are meant to be fast and playful rather than a wall of studio knobs. Echo and Space have been tightened so live playback and WAV export are chasing the same sound instead of two separate guesses. Noise now backs off when Drive is high so texture does not turn into a static wall.
- **Controller triggers as sound switches or note switches** - assign LT and RT to Tone, or use them to reach related notes like 7ths and 9ths by holding the trigger before you strike the pad. Regular controller buttons can also be learned to Pads slots as notes, chords, or Root pads, exact Piano notes, or Kit sounds, then saved as controller presets. Triggers and sticks stay reserved for expression.
- **Keyboard shortcuts as instrument** - number row triggers pads, letter row triggers piano keys, `ArrowUp`/`ArrowDown` shift octave.
- **Pitch & mod via QWERTY** - Korg K25-style mod (1/4/7) and pitch (3/6/9) when keys aren't in use.
- **Mobile and desktop focus, including iOS Safari** - touch drag-and-drop everywhere, a cleaner labeled transport menu on narrow screens, and extra audio unlock nudges when a real note or drum hit happens.

### Three modes

- **Create: playing and capturing.** 16 synth presets, 4 drum kits, scale-locked or chromatic, hold and arpeggio modes. Chip presets stay punchy and retro, while Modern presets use richer synth motion like filter movement, vibrato, unison, and key tracking without making quick taps disappear.
- **Canvas: arranging.** Typed MIDI, drum, and audio tracks with drag-and-drop, per-track mute / solo, user-set track colors, compact track instrument dropdowns, drum tracks that can pick the same built-in kits as the Kit screen, a cleaner toolbar for adding tracks and shaping selected clips, a one-click **Trim** to clean empty space, and an auto-calculated loop region. Click the ruler numbers to move the playhead. Clips will not stack on top of each other by accident. When you drag near another clip, they snap edge to edge instead of silently overlapping. Dropping a recorded MIDI clip onto a MIDI track also brings over the instrument it was recorded with, then you can change the track from there. Audio clips use a LINE badge and show a lightweight real peak preview when the app has the audio bytes, so quiet space and loud moments are easier to see. Recorded **pitch-bend**, **modulation**, and Tone badges ride on clips so you can see what has movement or effects.
- **Inspect: refining.** Tap-to-add piano roll. Rename Audio In recordings from the audio preview, switch between MIDI, drum, and audio clips without leaving Inspect, edit selected-note velocity with clearer note-level velocity meters, use vertical zoom, set the octave range (C1-C6), split MIDI view, use **2x** / **1/2** snippet length buttons, snap an entire snippet with **Quantize all**, and turn on a one-clip **Shadow** view so you can line up a melody against another MIDI or drum idea without merging anything. Drum Inspect now has the same timeline ruler and left-to-right clip growth as MIDI, and drum hits draw as grid blocks so they read more like intentional steps instead of dots floating away from where you clicked. Drum clips can shadow MIDI too, as a rough timing guide.

You never have to leave Create to make a song. The other modes are there when you want them.

Inspect also lets you make a blank MIDI or drum clip directly, so you do not have to record live just to start writing notes.

### Local, fast, free.

- **Local-first.** IndexedDB storage. No accounts, no cloud sync, no telemetry.
- **PWA.** Installable, works offline, lives on your home screen.
- **Auto-save history is adjustable** - keep 5, 10, 25, or 50 versions, restore from history when you need to, and delete individual entries or clear the list when it gets in your way.
- **Milestones and backups.** Save named checkpoints in the app, load them later, delete the ones you no longer need, export a full workspace JSON backup, or export just your snippet library so browser storage is not the only copy. The Save tab shows whether browser storage is persistent or best effort, estimates local usage, and tells you whether the workspace has changed since the last workspace backup. The top controls also show a small backup status shortcut so Save is not buried when the project needs a fresh backup. Backup files include the app version that created them. Older backups can move forward into newer Notenotes versions, but newer backups are blocked from importing into older builds.
- **Customizable everywhere.** 2/4, 3/4, 4/4, and 5/4 time signatures for now. Custom beat colors for the background visualizer. The top bar has the shared project key and scale, and the Create toolbar has a stable Layout button for Pads and Piano layout controls. Both edit the same optional degree colors. Drum count still lives in Settings for now.
- **AI seed is optional and direct.** The AI panel can run in Mock mode without a key, or use your own provider key for the current browser session. Clicking the provider name in the AI panel opens Settings right to the provider controls.
- **Snippets are nameable** - and auto-named ones update themselves as you edit. Deleting a snippet asks first, because it also clears that snippet from the Canvas. You can arm recording before you play, then the first note or drum hit starts the recording instead of making you race the record button.
- **Exports.** Sheet music as **SVG** or **ABC**, with a **percussion clef** for drum snippets. Export the whole Canvas or individual snippets as **MIDI** or **WAV**. Canvas WAV export now respects the MIDI track's synth patch instead of turning every preset into the same generic tone. New MIDI snippets also remember the patch they were recorded with, so a standalone snippet WAV has a sane sound even before you put it on the Canvas. WAV export renders Tone; MIDI export keeps the notes and timing but not the Notenotes-specific sound shaping. Empty or unavailable exports now fail clearly instead of handing you a misleading silent or tempo-only file. MP3 is still on the [roadmap](#future-vision).

---

##  Run it locally

### Prerequisites
- **Node.js 20+** (LTS recommended)
- **npm**

### Install & run

```bash
git clone https://github.com/zeidalidiez/Notenotes.git
cd Notenotes
npm install --legacy-peer-deps
npm run dev
```

The app opens at [http://localhost:5173/](http://localhost:5173/). Click any pad to wake the audio engine - browsers require a user gesture before they'll make sound.

### Build for production

```bash
npm run build      # outputs to dist/, PWA-ready
npm run preview    # serve the production build locally
```

---

## Future vision
These are the ideas that drive the project. Some are coded, some are sketches, some are wild - **all of them are conversations open for contribution.** If something here sparks you, [open an issue](https://github.com/zeidalidiez/Notenotes/issues/new) or [a discussion](https://github.com/zeidalidiez/Notenotes/discussions). Help wanted.

### More ways to create
- [ ] **Mic-to-midi** - Sound into the mic, the app transcribes it as MIDI you can edit.
- [ ] **Tap-to-rhythm** - clap or tap to set tempo and seed a beat.
- [ ] **MIDI device support** - bring your own keyboard, pad controller, or wind instrument.
- [ ] **Webcam/Wiimote motion controls** - Movement to modulate, other potential uses.
- [ ] **Touch + accelerometer** - on mobile, tilt for modulation, tap velocity for dynamics.
- [ ] **Foot pedals & accessibility switches** - every input becomes an instrument.
- [ ] **Lyric notepad** - write words next to the notes they fit.


###  Sound and color
- [x] **Per-beat colors** in the background visualizer.
- [ ] **Per-pad colors** - paint Pads however helps you remember.
- [ ] **Color-blind safe palettes** as a first-class option.
- [ ] **Synesthesia mode** - clips on the Canvas glow their note color as they play.
- [ ] **Color-strip notation** as an alternative to the piano roll.

### Safety nets for those who need them
- [x] **Scale lock** on the pads.
- [ ] **Chord lock** - only chords that fit the song's key are reachable.
- [ ] **Drone mode** - sustain the root of your key in the background as a tonal anchor.
- [ ] **Suggest-next-chord** - gentle prompts when you want them, invisible when you don't.

### Rhythm and meter
- [x] **Simple project time signatures** - 2/4, 3/4, 4/4, and 5/4 are supported as project-level timing.
- [ ] **Compound meter presets** - 6/8, 9/8, and 12/8 are planned, but only once the app can show their grouping honestly instead of pretending they are just longer 4/4.
- [ ] **Clear pulse labels** - meters like 2/2 and 9/8 need the app to explain what the beat means, because BPM can mean different felt pulses depending on the meter.
- [ ] **No random time-signature soup** - I do not want a giant custom meter box that technically works but teaches the wrong idea. Fewer choices that feel right beats a dropdown full of confusing math.
- [ ] **Meter maps later** - one Canvas has one project timing for now. Changing meter mid-song is a real feature, but it needs a proper design instead of a rushed checkbox.

### Sharing
- [x] **MIDI and WAV export** alongside ABC and sheet music.
- [ ] **MP3 export** once there is a reliable browser encoder path.



### Expanding sound
- [ ] **Found-sound recorder** - sample your environment, drop it into the kit.
- [ ] **Body percussion** - claps and snaps recognized via mic become a drum lane.
- [ ] **User samples** - drag-and-drop your own audio as instruments.
- [ ] **More synth presets and kits** - community-contributed.

If your idea isn't here, **add it.** This list is the project.

---

##  Build your own instrument

Notenotes' instruments are vanilla JavaScript classes. There's no framework to fight. If you can write a class with a `render()` method, you can ship a new instrument.

### Pattern

```js
export class MyInstrument {
  constructor(synth, project) {
    // Store dependencies
  }

  init() {}                   // Optional: post-audio-engine setup

  render() {                  // Required: return DOM element
    this.el = document.createElement('div');
    this.el.className = 'my-instrument';
    return this.el;
  }

  setHitCallback(onHit) {}                  // For drum-style triggers
  setNoteCallbacks(onNoteOn, onNoteOff) {}  // For pitched notes
}
```

### Wiring it in (6 lines, ish)

1. Create `src/instruments/MyInstrument.js`
2. Import it in `src/modes/CreativeMode.js`
3. Instantiate in the constructor
4. Pass `project` in the `set project(p)` setter
5. Add it to the `views` array in `render()`
6. Add a tab to the instrument switcher

For a deeper reference - including a synthesized drum sound built from oscillators and noise - read [`src/instruments/SketchKit.js`](src/instruments/SketchKit.js). It's heavily commented and uses every Web Audio primitive worth knowing. Architectural context, audio-scheduling rules, and the data model live in [`AI.MD`](./AI.MD).

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `Enter` | Stop (rewind to loop start) |
| `R` | Toggle recording |
| `M` | Toggle metronome |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| Pads `1`–`9`, `0` | Hold visible pads |
| Kit `1`–`9`, `0` | Trigger drum pads |
| Piano `` ` ``–`=` | Hold piano keys left to right |
| `ArrowUp` / `ArrowDown` | Octave shift (Pads, Micro Piano, Controller) |
| `Delete` / `Backspace` | Delete selected note or clip |
| `Ctrl+click` | Delete a note (Inspect) or clip (Canvas) |
| `Alt+drag` | Resize note (Inspect) or clip (Canvas, shrink) |
| Hold `1` / `4` / `7` | Modulation down / reset / up (when not in use) |
| Hold `3` / `6` / `9` | Pitch bend down / reset / up (when not in use) |

---

##  Tech stack

| Layer | Technology |
|---|---|
| **Build** | [Vite](https://vitejs.dev/) 8.x |
| **Audio** | Web Audio API - AudioContext, OscillatorNode, BiquadFilterNode |
| **Persistence** | IndexedDB via [idb](https://github.com/jakearchibald/idb) |
| **Sheet music** | [abcjs](https://paulrosen.github.io/abcjs/) |
| **PWA** | [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) |
| **Framework** | None. Pure vanilla ES Modules. |

### Why no framework?

Web Audio is allergic to surprise. A virtual DOM diff at the wrong moment is a click in your loop. Every DOM update in Notenotes is intentional and audio-aware - and the codebase stays small enough to read in an afternoon.

---

## Project structure

```
Notenotes/
├── index.html                 # PWA entry point
├── vite.config.js             # Vite + PWA config
├── public/                    # Icons, manifest
└── src/
    ├── main.js                # App bootstrap
    ├── style.css              # Design system
    ├── engine/                # Audio core (transport, scheduler, theory, recording)
    ├── instruments/           # Sound generators (Pads/ScaleBoard, Piano, Kit, Mic, Synth)
    ├── modes/                 # Create, Canvas, Inspect views
    ├── ui/                    # Transport bar, tabs, settings drawer, snippet tray
    ├── data/                  # IndexedDB persistence + undo manager
    └── export/                # ABC notation + sheet music renderer
```

---

## Improving the GIFs

The clips above were captured by hand and they're meant to evolve. If you want to refresh them, demonstrate a feature better, or contribute alternate captures, here's the recipe:

1. **Tool to install:** [Kap](https://getkap.co) (Mac), [ScreenToGif](https://www.screentogif.com) (Windows), or [Peek](https://github.com/phw/peek) (Linux). All free.
2. **Aspect:** record the browser window at ~1280×720 for sharp playback in the README.
3. **Export:** GIF or short MP4. Keep clips **5–10 seconds**, **under 5MB**.
4. **Replace** `scale.gif`, `controller.gif`, `canvas.gif`, or `inspect.gif` in the repo root with your new capture.

>  The most compelling clips show **a real interaction**: pressing pads, dragging clips, switching instruments. Avoid showing menus - show *making music*.

---

## Contributing

Notenotes is built in the open and grows with its community. Whether you're filing a bug, sketching a feature, or adding an instrument:

1. **[Browse open issues](https://github.com/zeidalidiez/Notenotes/issues)** - `good first issue` is a real label here.
2. **[Open a discussion](https://github.com/zeidalidiez/Notenotes/discussions)** for ideas that don't fit a single ticket.
3. **Fork → branch → PR.** Keep PRs small and focused; describe the user-facing change.
4. **Music tests welcome.** A 10-second clip of "this used to break and now it doesn't" is a perfectly good test.

### For AI agents working on this codebase

If you're an AI agent assisting with this project, **read [`AI.MD`](./AI.MD) first.** It contains architectural context, audio-scheduling gotchas, and the exact state shape of the IndexedDB store. When you solve a non-obvious problem, append your findings to the bottom of `AI.MD` rather than deleting existing context.

---

##  Credits & acknowledgments

Notenotes stands on the shoulders of generous people who share their work freely.

- **Controller artwork** - [Generic Gamepad Template](https://opengameart.org/content/generic-gamepad-template) by [**nicefrog**](https://opengameart.org/users/nicefrog), released as **CC0 (public domain)** via [OpenGameArt.org](https://opengameart.org). Attribution wasn't required, but nicefrog made this app nicer and froggier.
- **[abcjs](https://paulrosen.github.io/abcjs/)** - ABC notation rendering for the sheet music export.
- **[idb](https://github.com/jakearchibald/idb)** - the friendliest possible wrapper around IndexedDB.
- **[vite-plugin-pwa](https://vite-pwa-org.netlify.app/)** - making Notenotes installable and offline-ready with one config block.

If you spot anything in this repo that's missing a credit it deserves, please [open an issue](https://github.com/zeidalidiez/Notenotes/issues/new) - we'll fix it fast.

### Audio asset rule

Anything bundled into Notenotes that can end up in a user's exported audio needs to be obligation-free for the user. CC0 / public domain is the cleanest fit. MIT-style permissive code is fine for libraries, but audio samples, impulse responses, voice data, and textures need extra care. No CC-BY, no CC-BY-SA, no noncommercial assets, no "free but unclear" packs, and no runtime CDN sounds. I want people to make things without wondering what they owe anyone afterward.

---

## License

[MIT](./LICENSE) - Do what you wish to do with this, I suggest we improve it for the sake of anyone it might help.

---

<div align="center">
[Open Notenotes](https://zeidalidiez.github.io/Notenotes/) | [Star on GitHub](https://github.com/zeidalidiez/Notenotes)
</div>
