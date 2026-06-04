# WIP — Opus (instrument character roadmap)

Working notes for the "instruments with character" effort: what shipped, what's
left to pick up, and the gotchas worth remembering. Pick up from "To do".

---

## ✅ Shipped (on `main`)

**PR #4** — Built-in sample instruments + Height Velocity
- 10 CC0 (VCSL) multi-sampled instruments under the picker's "Sample instruments"
  group: grand/upright piano, marimba, vibraphone, glockenspiel, xylophone,
  kalimba, concert harp, strumstick, tubular bells.
- Multi-zone playback (nearest-zone pick + pitch-shift), lazy-loaded + Cache-Storage
  cached, MP3, WAV-export parity, octave-fold for full-range playability.
- Height Velocity (Labs → Dynamics tab) + tall "Velocity" pad layout. Strike higher
  = louder, 4 zones, gridlines. Opt-in, default off.
- Robustness: rapid-retrigger crash fix (voice-node disposal), loader resilience
  (retry + concurrency cap + superseded-load guard).

**PR #5** — Synthesis character, increment 1
- `Humanize.js`: subtle per-note pitch drift + level variation (synth voices) and
  per-hit pitch/level/decay variation (drums). Kills the "machine-gun" sameness.
  Live-only nuance; deterministic WAV export stays clean.
- Metallic hi-hats/cymbals: 6 inharmonic square partials (TR-808 style) + a little
  shaped noise.
- Sample instruments show their sampled range in the picker (e.g. "Sampled G5–C8").

---

## 🔨 To do (pick up here)

### A. New synth voice types — the big timbre wins
Each needs a matching render path in `WavExporter.js` so exports match live audio.

1. **2-operator FM voice** (`type: 'fm'`)
   - Modulator osc → gain (the "index", enveloped) → carrier.frequency. Native Web Audio.
   - Presets: electric piano (DX-style), bell, glassy bass, mallet.
   - Sketch: `mod.connect(modGain); modGain.connect(carrier.frequency);` with a fast
     decay on `modGain` for the clangy-attack-to-mellow motion.

2. **Karplus–Strong pluck voice** (`type: 'pluck'`)
   - 20 ms noise burst → tuned feedback `DelayNode` (delayTime = 1/freq) + lowpass in
     the loop. ~20 lines, no samples. Presets: nylon guitar, harp, koto, kalimba.
   - DelayNode timing quantises at high pitch; move the loop to an AudioWorklet for
     precise tuning if needed.

3. **Additive `PeriodicWave` oscillator** (`oscillator.type: 'custom'`)
   - `ctx.createPeriodicWave(real, imag)` from harmonic-amplitude recipes; cache one
     wave per timbre. Handle 'custom' in `_createOscillatorStack` (call
     `osc.setPeriodicWave(...)` instead of setting `osc.type`).
   - Recipes: organ drawbars `[1,.6,.8,.4,0,.3,0,.2]`, Rhodes `[1,0,0,.45,0,.2,...]`,
     clarinet (odd harmonics) `[1,0,.5,0,.33,0,.25]`, reed, glass. Add to `PRESETS`.

### B. Further advisory ideas
- **Velocity → timbre** (not just level): map velocity to osc2 gain / brightness /
  a brighter wave so hard notes are genuinely brighter. `velocityResponse` already
  maps filter+drive — extend it.
- **Shared room/reverb send**: one small convolver send shared across voices so a
  kit/patch sits in a single space. Reuse `_makeImpulse`. Keep subtle (sketchpad).
- **Layered drum design**: punchier kick (sub + click + body), snare with two body
  modes, etc. (DrumSynthesis + SketchKit).
- **Widen sampled range** for narrow instruments (glockenspiel, kalimba, tubular
  bells) where VCSL has more octaves, to reduce reliance on octave-folding.
- **Drum Height Velocity**: extend the Labs height-velocity input to SketchKit pads
  (currently pads + piano only).

---

## ⚠️ Gotchas (don't relearn these the hard way)

- **Audio format MUST be MP3**, not AAC. `decodeAudioData` in open-source Chromium
  (Linux) can't decode AAC; MP3 decodes on every browser incl. iOS Safari.
- **Binaries can't be committed via the GitHub API tool.** Audio is added manually or
  regenerated via `scripts/build-sample-packs.mjs` (needs Node 18+, curl, ffmpeg).
- **VCSL octave labels are inconsistent**: `octaveShift` is +12 for most instruments,
  `0` for concert harp. Verified by autocorrelation pitch analysis. Get this wrong and
  everything is an octave off.
- **Humanization is live-only**; WAV export stays deterministic. Any synthesis change
  that alters sound needs a matching `WavExporter` path:
  samples → `decodeBuiltinInstrument`/`renderSampleNote`; synth → `renderMidiWithTone`.
- **Voice cleanup is load-bearing**: every voice gets an identity-guarded `'ended'`
  handler + `_disposeVoiceNodes()`. Without it, fast retriggering crashes the tab
  (STATUS_BREAKPOINT / OOM). Don't remove it.
- **Octave-fold** (`sampleZone.playableMidi`) makes narrow instruments collapse their
  low octaves onto the same in-range note — intended; the picker range label explains it.
- **Service worker (PWA)** can intercept/cache fetches in `preview`/deployed builds;
  use plain `npm run dev` (no SW) when debugging pack loading.

---

## 🗂 Key files
- `src/instruments/WebAudioSynth.js` — synth voices, sample playback, humanization.
- `src/instruments/SketchKit.js` — procedural drums, metallic hat, humanization.
- `src/engine/Humanize.js` · `HeightVelocity.js` · `src/instruments/sampleZone.js` — helpers.
- `src/instruments/SamplePack.js` — lazy sample loader (retry + concurrency + cache).
- `src/export/WavExporter.js` — offline render; keep parity with live.
- `src/modes/CreativeMode.js` — instrument picker + selection.
- `src/instruments/ControllerMode.js` — Labs tabs (Controller / Dynamics).
- `scripts/build-sample-packs.mjs` — CC0 VCSL → small MP3 packs + manifests.
- `public/packs/` — instrument audio, per-instrument `manifest.json`, `index.json`.

_Original full advisory (the "why" + code recipes) was delivered alongside this work._
