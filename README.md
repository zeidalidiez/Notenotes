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

It's a Progressive Web App. In Chrome, use the three-dot menu, then Cast, save, and share, then Install page as app. In Edge, use Apps, then Install this site as an app. In Safari, use Share, then Add to Home Screen. The current app version is shown in Settings, and Settings checks the app's public version file on GitHub so it can tell you when your browser is hanging onto an old cached build.

---

##  A quick tour

### Create - the jam space

![Create mode - Pads with numbered, scale-locked pads](scale.gif)

Pick a scale. Mash the pads. Switch instruments mid-loop. Press record, jam, press stop - your loop becomes a snippet.

### Controller - your gamepad is an instrument

![Controller mode - gamepad as a scale-locked instrument](controller.gif)

<sub>Controller artwork by [nicefrog](https://opengameart.org/users/nicefrog) - [Generic Gamepad Template](https://opengameart.org/content/generic-gamepad-template), released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Thank you, nicefrog.</sub>

Plug in any USB or Bluetooth controller. D-pad and face buttons map to the scale by default, or you can teach buttons to trigger exact notes and drum sounds. Learned buttons are global in Create, so a Kick button can still fire while you are looking at Piano, and a C4 button can still fire while you are looking at Kit. Analog sticks bend pitch and add modulation. Shoulders and triggers are held musical modifiers: make the next button a Triad, 7th, Sus2, Power chord, 9th, 11th, 13th, or octave jump without turning effects on and off mid-take. Pass the controller to a friend who's never touched a keyboard - watch what happens.

### Canvas - composition as collage

![Canvas mode - dragging snippets onto a multi-track timeline](canvas.gif)

Drag your captured snippets onto typed tracks. MIDI goes on MIDI tracks, drums go on drum tracks, and audio goes on audio tracks. Move them, mute them, pan them, layer them, or use the Time tool to flip a clip into half-time or double-time without rewriting the original snippet. Hit play and listen to the song you didn't know you were writing.

### Inspect - when you're ready for detail

![Inspect mode - piano roll editor for refining notes](inspect.gif)

Open any snippet in a piano roll for fine edits. Click to add notes, drag to move them. Or skip this entirely - Notenotes works without it.

---

## What it is right now

### Instruments

| Instrument | What it is |
|---|---|
| **Pads** | Pads locked to the project key and scale (Major, Minor, Pentatonic, Blues, Dorian, Mixolydian, Chromatic). Pad count follows the scale, Extensions can continue it into the next octave, Layout can switch between responsive pad templates, Compass gives you a circle-of-fifths chord surface, and Step Play works as a one-trigger sequencer. |
| **Labs** | Experimental and assistive setup surfaces. The first Lab is Controller: connection state, four held shoulder/trigger modifier slots, current bindings, fallback notes, and saved binding presets. The shoulder/trigger slots open the same modal picker language as the larger creative lists instead of giant native dropdowns. The toolbar **Controller** button still opens the learnable mapper. Pads bindings remember whether they were learned as notes, chords, or Root pads. |
| **Micro Piano** | Configurable chromatic keyboard (1 or 2 stacked, 10–32 keys each) with octave shifting. Optional degree colors can mark which keys belong to the project key. |
| **Sketch Kit** | 10-pad synthesized drum kit. Four kit presets (Classic, 808, Electronic, Acoustic), keyboard labels on every pad, and the same Tone controls as the synth side. Drum noise is still generated in-browser, but it is shaped before filtering so snares, claps, hats, rims, and shakers hit with less raw static. |
| **Audio In** | Record from any input device with a live waveform. Choose Auto, Mono, or Stereo capture when the browser supports it. New audio snippets are saved with durable audio data so backups can actually bring them back. |

Plus: **16 synth presets** split into Chip and Modern families, picked from the same searchable library pattern as scales. Chip stays punchy and direct; Modern is voiced fuller with supporting oscillators, light unison, curved envelopes, filter movement, key tracking, restrained patch drive, velocity-aware brightness, tasteful stereo spread, and a subtle master glue stage so harder MIDI notes speak with a little more bite and held notes do not sit dead-center. **Tone** controls shape sound without becoming a full DAW, and the entire instrument layer is [pluggable](#-build-your-own-instrument).

### For someone who wants a different perspective into the world of music.

- **Scale-locked pads** - every press is in key. You can't pick a wrong note. Turn on **Extensions** to keep the scale going into the next octave without turning it into a theory quiz. The old dead-end Custom mode is gone; Layout now starts the cleaner modular-pad direction with balanced equal-pad templates like Fit, Compact, and Rows, plus more expressive templates like Big Tonic and Thumb-friendly, while keeping the pads as real buttons.
- **Step Play** - a Pads mode for one-switch or one-key playing. Pick notes from the current scale in the chip editor, then hit the large Step button, any performance key, or a MIDI note to advance through them while Notenotes records your timing. The picker stays scale-aware, but saved steps are fixed notes, so changing key, scale, or Pad octave later does not rewrite your little sequence. The note picker has its own sane octave carousel from 1 to 6 instead of inheriting the Pads octave or wandering into unusable ranges. If a saved note falls outside the current scale, it keeps playing and gets a red `OUT` badge instead of silently changing. Individual steps can also carry an alternate note that plays every other pass through the loop. When degree colors are enabled, Step Play uses the same colors as the other pad surfaces, and the editor has Undo plus explicit Save/Cancel actions so a stray outside tap does not throw away work. Pair it with Inspect's **Fit Rhythm** tool when you want the pitches you entered to land cleanly in a bar.
- **Stage view** - a full-screen performance visual layer. Open **Stage** from Create to switch between the neon **Trace** highway, **Thread** pitch-contour ribbons, **Pulse** radial rhythm energy, **Halo**, a circle-of-fifths bloom for pitch classes and harmony, and **Pocket**, a groove clock where hits land as pips and held notes grow into arcs inside the current pulse. Use the view selector, arrow buttons, or a left/right swipe on the Stage field to move between live views. Thread trails now linger longer so phrases travel across the whole screen instead of vanishing halfway through, while dense scenes and reduced-motion settings automatically pull back glow, shadows, and decorative detail so the view stays light. On touch screens, Stage includes its own lane pills so you can play without a connected controller; max-key Piano layouts keep distinct lanes, and Kit labels stay compact on phone screens. Kit hits carry drum pitch metadata for Stage only, so Thread and Halo can react to drums without changing recording or playback. Open **Stage** from Canvas to get a horizontal track map: each track becomes a row, and notes, drums, and audio clips move through internal sublanes instead of collapsing into one vague strip. This is intentionally Canvas 2D for now so mobile stays light, but the event model is clean enough for a future Three.js version.
- **Project key, scale, and changes** - set the shared root and scale in the top bar. The scale picker is now a searchable family picker instead of a tiny dropdown, with Western modes, pentatonic colors, Hungarian/Klezmer colors, and honest 12-TET maqam/raga-inspired approximations grouped where they belong. The top bar also has a compact **Changes: Off** picker for degree-based progressions like The Axis, Doo-wop, ii-V-I, and 12-bar blues; the picker list itself stays plain, hides progressions that do not fit the current scale, and turns Changes off if a later scale switch makes the current progression impossible. When selected, Changes can give Pads and Piano a visual chord-tone halo without changing what notes play; Layout has a checkbox and intensity slider so it can sit politely beside degree colors. Optional Piano/MIDI **Correction**: Off keeps chromatic play, Closest / Up / Down nudge out-of-key Piano and external MIDI notes into the project scale. Pads, Controller fallback, AI context, and the optional Piano/Pad degree colors all read from the same place instead of each feature guessing on its own. The old duplicate Root/Scale controls are intentionally gone from Pads and Ctrl.
- **Curated chord pads** - Chords mode still stacks scale degrees for familiar Western scales, but uses hand-picked chord pads for scales where plain tertian stacking would feel wrong, such as Hirajoshi, Hungarian Minor, Double Harmonic, and Phrygian Dominant.
- **Beat colors** - set a different color for each beat. The background pulses in time so you can *see* the meter.
- **Degree colors** - the Layout panel can turn on shared degree highlighting, adjust color intensity, or show degree labels without the colored outlines. It is off by default. Pads use plain function names like Tonic and Dominant, while Piano keeps compact shorthand badges like b3 and 5.
- **Hold & arpeggio modes** - latch notes, auto-arpeggiate chords across **10 chord types**, **4 patterns**, and **4 rates**. Or sustain a drone while you explore.
- **Tone** - simple sliders for Crush, Echo, Space, Wobble, Drive, and Noise. They work on synths and the drum kit, can be saved as searchable presets, reset back to zero, and are meant to be fast and playful rather than a wall of studio knobs. Echo and Space have been tightened so live playback and WAV export are chasing the same sound instead of two separate guesses. Noise now ducks hard when Drive is high so texture does not turn into a static wall.
- **Output volume that stays honest.** Master and metronome volume are saved with the project and restored when the browser wakes audio, so a slider at zero really means silent after reload instead of just looking silent.
- **Controller held modifiers** - assign LB, LT, RB, and RT to musical transforms like Triad, 7th, Sus2, Sus4, Power, Add 9, 9th, 11th, 13th, or octave jumps. Hold the modifier before striking a learned button or fallback button and the note expands musically; drums stay drums. Tone is deliberately not a controller modifier, because effects cutting in and out mid-take sound rough and do not survive MIDI export cleanly. Regular controller buttons can still be learned to Pads slots as notes, chords, or Root pads, exact Piano notes, or Kit sounds, then saved as controller presets. Sticks stay pitch/mod expression.
- **Keyboard and MIDI as instruments** - in Create, the active surface owns your input. `1-=`, `Q-]`, `A-'`, and `Z-/` play Pads, Piano, or Kit depending on what you are looking at. Pads map `1` to pad 1 and keep counting forward into `Q` for bigger layouts; Piano maps the same keys high-to-low so the computer keyboard feels more like a compact piano; Kit pads show the matching key label. `M` and `R` are playable keys, not global metronome/record shortcuts; Space and Enter still control transport. A connected MIDI keyboard routes the same way: Pads play the nearest visible pad through the current Pad Mode, Piano plays exact MIDI notes, Kit uses drum-note mappings, and Step Play advances one step per note-on.
- **Pitch & mod via QWERTY** - Korg K25-style mod (1/4/7) and pitch (3/6/9) when those keys are not being used by the active Create surface.
- **Mobile and desktop focus, including iOS Safari** - touch drag-and-drop everywhere, a cleaner labeled transport menu on narrow screens, a tap-friendly BPM editor, a collapsible snippets tray, denser Pads spacing so more notes fit without clipping, balanced pad packing so 13 notes do not strand one lonely tile on wide screens, a full-width mobile Patch picker with compact action rows so buttons do not balloon or get chopped, mobile toolbar panels that open as fixed modals instead of fragile tiny popovers, picker lists that allow finger-drag scrolling, hidden keyboard-hint badges on phone layouts, a **Labs** top-level tab for lower-frequency performance tools, and an explicit audio prompt when the browser has not actually opened a usable sound route yet. On some iOS builds that route is only unlocked through Safari's microphone permission path; Notenotes asks from a user gesture, stops the temporary stream immediately, and does not record unless you are actually in Audio In.

### Three modes

- **Create: playing and capturing.** 16 synth presets, 4 drum kits, scale-locked or chromatic, hold and arpeggio modes. Chip, Modern, and Custom patch instruments are chosen from a searchable picker so the list can grow without turning into a scroll trap. Chip presets stay punchy and retro, while every Modern preset uses richer synth motion like a supporting oscillator, light unison, curved attack/decay envelopes, stereo spread, filter movement, vibrato or key tracking, restrained drive, and velocity response without making quick taps disappear.
- **Canvas: arranging.** Typed MIDI, drum, and audio tracks with drag-and-drop, per-track mute / solo / pan, user-set track colors, searchable track instrument pickers, drum tracks that can pick the same built-in kits as the Kit screen, a cleaner toolbar for adding tracks and shaping selected clips, a one-click **Trim** to clean empty space, a **Time** tool for non-destructive half-time / double-time clip timing, and an auto-calculated loop region. Click the ruler numbers to move the playhead. Clips will not stack on top of each other by accident. When you drag near another clip, they snap edge to edge instead of silently overlapping; when Time makes a clip grow, later clips on that track are pushed right so the clip start stays put. Track pan opens from each lane and is heard in live Canvas playback and stereo Canvas WAV export. On touch screens, drag empty Canvas space to pan the timeline, drag Canvas clips to move them, long-press a clip to delete it, and scroll the snippet dock horizontally unless you drag a snippet upward into a track. Dropping a recorded MIDI clip onto a MIDI track also brings over the instrument it was recorded with, then you can change the track from there. Audio clips use a LINE badge and show a lightweight real peak preview when the app has the audio bytes, so quiet space and loud moments are easier to see. Recorded **pitch-bend**, **modulation**, and Tone badges ride on clips and snippets, while Time badges appear on arranged clips so you can see what has movement, timing changes, or effects before and after arranging.
- **Inspect: refining.** Tap-to-add piano roll. Rename Audio In recordings from the audio preview, switch between MIDI, drum, and audio clips without leaving Inspect, edit selected-note velocity with clearer note-level velocity meters, use vertical zoom, set the octave range (C1-C6), split MIDI view, use **2x** / **1/2** snippet length buttons, snap an entire snippet with **Quantize all**, and use **Fit Rhythm** to stretch MIDI notes or drum hits into 1, 2, or 4 bars with a Keep-my-feel to Make-it-clean slider, optional even spacing, and preview before apply. The Inspect ruler follows the snippet/content length instead of forcing a long empty timeline. Turn on a one-clip **Shadow** view so you can line up a melody against another MIDI or drum idea without merging anything. Drum Inspect now has the same timeline ruler and left-to-right clip growth as MIDI, and drum hits draw as grid blocks so they read more like intentional steps instead of dots floating away from where you clicked. Drum clips can shadow MIDI too, as a rough timing guide.

You never have to leave Create to make a song. The other modes are there when you want them.

Inspect also lets you make a blank MIDI or drum clip directly, even while you are previewing an audio recording, so you do not have to leave the editor or record live just to start writing notes. Audio previews use the same Inspect toolbar as MIDI and drum clips: load, rename, and create controls stay in the same place, while note-only tools stay visible but disabled.

### Local, fast, free.

- **Local-first.** IndexedDB storage. No accounts, no cloud sync, no telemetry.
- **PWA.** Installable, works offline, lives on your home screen.
- **Auto-save history is adjustable** - keep 5, 10, 25, or 50 versions, restore from history when you need to, and delete individual entries or clear the list when it gets in your way.
- **Milestones and backups.** Save named checkpoints in the app, load them later, delete the ones you no longer need, export a full workspace JSON backup, export just your snippet library, or connect a local backup folder on desktop Chrome/Edge so browser storage is not the only copy. Once a folder is connected, Notenotes quietly writes current-workspace backup JSON files there shortly after edits, without asking again unless the browser needs permission. The top backup shortcut turns blue when folder auto-backup is active; if the browser forgets folder permission after a reload, the shortcut turns into `Grant folder` and asks for access directly before opening Save. The Save tab shows whether browser storage is persistent or best effort, estimates local usage, checks storage health for missing or orphaned audio assets, and tells you whether the workspace has changed since the last workspace backup. Backup files include the app version that created them. Older backups can move forward into newer Notenotes versions, but newer backups are blocked from importing into older builds.
- **Customizable everywhere.** 2/4, 3/4, 4/4, 5/4, 6/8, 9/8, 12/8, 5/8, and 7/8 meters, with meter living in the top bar beside key and scale. Custom beat colors for the background visualizer. The Create toolbar has a stable Layout button for Pads and Piano layout controls. Pads get responsive layout templates; both Pads and Piano edit the same optional degree colors and chord-tone glow controls.
- **Accessibility profiles.** The Accessibility tab keeps input helpers separate from normal music settings. Tremor Filter ignores accidental rapid re-triggers of the same pad, key, or drum sound. Dwell Play lets a user hover over a playable target until a configurable timer fires it, which helps head trackers, eye trackers, and users who can aim more easily than click. Shared links can enable profiles immediately with `?tremor=1` or `?dwell=1`, then the user can tune or disable them in the app.
- **AI seed is optional and direct.** The AI panel can run in Mock mode without a key, or use your own provider key for the current browser session. Clicking the provider name in the AI panel opens Settings right to the provider controls.
- **Snippets are nameable** - and auto-named ones update themselves as you edit. Deleting a snippet asks first, because it also clears that snippet from the Canvas. You can arm recording before you play, then the first note or drum hit starts the recording instead of making you race the record button.
- **Exports.** Sheet music as **SVG** or **ABC**, with a **percussion clef** for drum snippets. Export the whole Canvas or individual snippets as **MIDI** or **WAV**. Canvas WAV export now respects the MIDI track's synth patch instead of turning every preset into the same generic tone, and it defaults to stereo so track pan, Modern preset width, and the same subtle master glue heard live survive the trip out of the browser; choose mono when you want a smaller centered file. New MIDI snippets also remember the patch they were recorded with, so a standalone snippet WAV has a sane sound even before you put it on the Canvas. Snippet WAV export defaults to Auto, with Mono and Stereo available when you want to force the channel count. WAV export renders Tone; MIDI export keeps the notes and timing but not the Notenotes-specific sound shaping. Empty or unavailable exports now fail clearly instead of handing you a misleading silent or tempo-only file. MP3 is still on the [roadmap](#future-vision).

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

The app opens at [http://localhost:5173/](http://localhost:5173/). Click any pad to wake the audio engine - browsers require a user gesture before they'll make sound. On iOS, use the **Tap to allow iOS sound** prompt if Safari claims Web Audio is running but the app is still silent. Safari may show a microphone permission dialog for this route primer; Notenotes stops that temporary stream immediately and does not record unless you choose Audio In.

### Build for production

```bash
npm run test:smoke # quick pure-logic checks for timing, backups, and storage audit
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
- [x] **Color-blind safe palettes** as a first-class option. The Layout degree-color panel has a **Palette** picker: Vivid (the original), Color-blind safe (distinct for red-green and blue-yellow vision), and a Brightness ramp whose lightness increases by degree so the colors stay orderable for any vision. You can still hand-tweak individual degree colors after picking a palette.
- [ ] **Synesthesia mode** - clips on the Canvas glow their note color as they play.
- [ ] **Color-strip notation** as an alternative to the piano roll.

### Safety nets for those who need them
- [x] **Scale lock** on the pads.
- [ ] **Progression / chord context** - the project now has a quiet, backward-compatible degree-based progression model, a compact Changes picker in the top bar, compatible-scale filtering, and adjustable chord-tone glow on Pads and Piano. The next step is making that context advance through the progression instead of staying on the selected active step.
- [ ] **Microtonal Pads mode** - true quarter-tone maqam/raga support needs a deliberate pitch-label, MIDI-export, ABC-export, AI-schema, and controller-binding design instead of being slipped in as float scale intervals.
- [x] **Drone mode** - a **Drone** toggle in the top bar sustains the root of your key in the background as a tonal anchor. It follows key changes and sits low under the pads; it is a live anchor, never recorded or exported.
- [ ] **Suggest-next-chord** - gentle prompts when you want them, invisible when you don't.

### Rhythm and meter
- [x] **Meter belongs with key and scale** - the top bar now holds the project meter as a first-class project setting.
- [x] **Simple project meters** - 2/4, 3/4, 4/4, and 5/4 are supported as project-level timing.
- [x] **Compound meter presets** - 6/8, 9/8, and 12/8 are supported with felt pulses, grouped canvas lines, matching beat dots, and export timing that does not pretend they are just longer 4/4.
- [x] **Asymmetric meter presets** - 5/8 and 7/8 are supported with visible grouping choices, so 7/8 can be 2+2+3, 2+3+2, or 3+2+2 instead of one vague uneven bar.
- [x] **Clear pulse behavior** - in compound meters, BPM means the big felt pulse. 6/8 at 120 BPM means two dotted-quarter pulses per bar, not six frantic eighth-note clicks.
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

For a deeper reference - including a synthesized drum sound built from oscillators and noise - read [`src/instruments/SketchKit.js`](src/instruments/SketchKit.js). It's heavily commented and uses every Web Audio primitive worth knowing. Current architectural context, audio-scheduling rules, and the data model live in [`AI.MD`](./AI.MD).

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `Enter` | Stop (rewind to loop start) |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| Pads `1`-`=`, `Q`-`]`, `A`-`'`, `Z`-`/` | Hold visible pads; in Step Play, advance the sequence |
| Kit `1`-`=`, `Q`-`]`, `A`-`'`, `Z`-`/` | Trigger visible drum pads |
| Piano `` ` ``–`=` | Hold piano keys left to right |
| `ArrowUp` / `ArrowDown` | Octave shift (Pads, Micro Piano, Controller) |
| `Delete` / `Backspace` | Delete selected note or clip |
| `Ctrl+click` | Delete a note (Inspect) or clip (Canvas) |
| `Alt+drag` | Resize note (Inspect) |
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

Developer timing diagnostics exist for QA without living in the normal UI. Open the app with `?debug=1`, then Settings -> Diagnostics, to inspect meter timing, run the meter math matrix, and measure live tempo with an isolated silent transport. The diagnostics panel is URL-only, so it does not hang around for regular users after QA.

### For AI agents working on this codebase

If you're an AI agent assisting with this project, **read [`AI.MD`](./AI.MD) first.** It contains architectural context, audio-scheduling gotchas, and the exact state shape of the IndexedDB store. Keep it current when you make meaningful changes: remove stale claims, update the canonical sections, and do not leave contradictory old notes behind.

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
