# Voices — How to Author a New Voice

This folder contains JSON definitions of "voices" used by the Notenotes voice synth. Each file in `voices/` defines a voice — a bank of syllables (vowels, consonants, diphthongs) that the engine can sing at any pitch.

If you want to add support for a new accent, register, or language: add a JSON file. No engine code changes required.

---

## How a voice is structured

```json
{
  "id": "english-base",
  "name": "English (base)",
  "description": "First-pass English vowel + consonant set.",
  "version": 1,
  "syllables": [ /* ... */ ]
}
```

| Field | Meaning |
|---|---|
| `id` | Unique identifier. ASCII, no spaces. Used as the JSON filename without extension and as the value persisted in projects. |
| `name` | Display name shown in the Voice picker UI. |
| `description` | Short description of the voice's character or scope. Optional. |
| `version` | Schema version. Bump when you change the format. Currently `1`. |
| `syllables` | Array of syllable definitions (see below). |

---

## How a syllable is structured

Each syllable is a **time-varying parameter sequence** — a series of keyframes describing how the voice sounds across the syllable's duration. The engine interpolates between keyframes using Web Audio's parameter scheduling.

```json
{
  "id": "han",
  "label": "han",
  "duration": 0.6,
  "frames": [
    { "t": 0.00, "voicing": "off",    "amp": 0.0 },
    { "t": 0.05, "voicing": "noise",  "amp": 0.5 },
    { "t": 0.15, "voicing": "voiced", "amp": 1.0,
      "formants": [{ "hz": 730, "q": 8, "gain": 14 },
                   { "hz": 1090, "q": 7, "gain": 12 },
                   { "hz": 2440, "q": 6, "gain": 10 }] },
    { "t": 0.85, "voicing": "voiced", "amp": 0.7,
      "formants": [{ "hz": 480, "q": 12, "gain": 14 },
                   { "hz": 1340, "q": 10, "gain": 8 },
                   { "hz": 2440, "q": 6, "gain": 4 }] },
    { "t": 1.00, "voicing": "off",    "amp": 0.0 }
  ]
}
```

### Field reference

| Field | Meaning |
|---|---|
| `id` | The syllable ID. Lowercase ASCII letters, hyphens, apostrophes. This is what the syllabifier matches against typed input. |
| `label` | Optional display label if `id` and label should differ. Defaults to `id`. |
| `duration` | Natural duration in **seconds**. The engine can override this when triggering rhythmically; the default is what plays when the user just presses a pad without rhythmic context. |
| `frames` | Ordered keyframes. Each describes the voice's state at a fraction of duration. Always include `t: 0` and `t: 1` frames at minimum. |

### Frame fields

| Field | Meaning |
|---|---|
| `t` | Normalized time, `0` (start) to `1` (end). Frames must be sorted by `t`. |
| `voicing` | One of `"voiced"` (pitched, oscillator), `"noise"` (unpitched, noise source), `"off"` (silent). Switches discretely at this frame. |
| `amp` | Amplitude `0.0` to `1.0`. Interpolates linearly between frames. |
| `formants` | Optional array of formant filter peaks. Each is `{ hz, q, gain }`. `hz` is the formant frequency in Hz; `q` is filter sharpness (5–15 typical); `gain` is boost in dB (8–15 typical). The engine has 3 formant slots — provide 3 entries when you want full vowel character. |

### Notes on choosing values

- **F1** (first formant, ~250–800 Hz) controls vowel "openness." Low F1 = closed vowels (`ee`, `oo`). High F1 = open vowels (`ah`).
- **F2** (~800–2400 Hz) controls tongue position. Low F2 = back vowels (`oo`, `oh`). High F2 = front vowels (`ee`, `eh`).
- **F3** (~2200–3500 Hz) controls brightness and character. Important for some vowel distinctions.
- **Q** of 5–10 = "soft" formant boost. Q of 12–18 = sharper, more characteristic.
- **Gain** of 10–15 dB = audible formant. Lower = more neutral.
- For nasals (`m`, `n`), narrow Q (12–14) and lower amplitude (~0.7–0.85) work well.
- For unvoiced consonants (`s`, `t`, `h`), formants matter less. You can either provide a sketchy filter set or omit `formants` and the engine leaves previous values in place.

### Diphthongs

Diphthongs (`ai`, `oi`, `au`, `ei`) are syllables whose formants slide from one vowel toward another. Add a midpoint frame around `t: 0.5` with the target vowel's formants:

```json
{ "t": 0.04, "voicing": "voiced", "amp": 1.0,
  "formants": [/* starting vowel formants */] },
{ "t": 0.55, "voicing": "voiced", "amp": 0.95,
  "formants": [/* target vowel formants */] },
{ "t": 0.90, "voicing": "voiced", "amp": 0.7,
  "formants": [/* target vowel formants */] }
```

The engine linear-ramps each formant frequency between frames, which produces the gliding sound naturally.

---

## How to test your voice

1. Drop your JSON file into `src/instruments/voice/voices/`.
2. Run the app (`npm run dev`).
3. In the Scale Board, set Pad Mode to **Voices** and select your voice from the picker (when added).
4. Press pads to hear each syllable at the pad's pitch.
5. Type a phrase using your syllable IDs separated by spaces (e.g., `"ah ee oh"`); pad presses advance through the phrase.
6. Sit with each syllable for ~30 seconds. If a vowel sounds muddy or thin, adjust formant frequencies in 50–100 Hz increments. If consonants are too quiet, raise their `amp` slightly. If transitions click, smooth amplitude across more frames.

Voices are added by editing JSON. There is no live editor in the app — iterate by editing the file and reloading the page.

---

## What makes a "good" contribution

- **Syllables that fill gaps in existing voices.** If `english-base.json` is missing common phonemes, propose additions.
- **New languages or accents.** A `japanese-base.json` with Japanese vowel formants. A `castilian.json` with Spanish-specific consonants. A `gospel-low.json` that's English with deeper formants for a lower register.
- **Tuning fixes.** If a vowel in `english-base.json` sounds wrong, send a PR with corrected formant values and a one-line note about what felt off.

Bad contributions:
- A voice with 200 syllables. Keep banks small and high-quality.
- A voice that depends on engine changes. The format must be self-contained.
- A voice using non-ASCII syllable IDs. The syllabifier and the input validator both assume ASCII.

---

## File checklist

When submitting a new voice file:

- [ ] Filename is `<voice-id>.json` and matches the `id` field inside.
- [ ] `version` is `1`.
- [ ] Each syllable's `frames` array starts at `t: 0` with `voicing: "off"` and ends at `t: 1.0` with `voicing: "off"` and `amp: 0`.
- [ ] All syllable IDs are lowercase ASCII.
- [ ] You've listened to each syllable at multiple pitches (low MIDI 36, mid 60, high 84) and confirmed it doesn't crackle, click, or sound nothing like its label.
- [ ] You've tested at least one short phrase using your syllables.

---

## Engine internals (for the curious)

`VoiceEngine.js` does the heavy lifting. For each press:

1. Looks up the syllable by ID.
2. Builds a Web Audio graph: sawtooth oscillator (voiced source), buffer source with pink-ish noise (unvoiced source), 3 peaking biquad filters in series (formants), gain node (output envelope).
3. Schedules `linearRampToValueAtTime` and `setValueAtTime` calls for each frame to drive amplitude, voicing gates, and formant frequencies.
4. The sawtooth oscillator runs at the user's MIDI pitch; formants stay where the JSON says regardless of pitch — that's why a low and a high voice both sound like the same vowel, instead of pitch-shifting like a chipmunk.
5. Output routes through the synth's `_toneInput`, so Tone Traits (Crush, Echo, Wobble, etc.) process voices the same way they process other instruments.

Releasing a held syllable applies a short fade on the output gain (~80 ms) to avoid clicks. The natural-duration cleanup runs on a `setTimeout` for the duration plus a small grace period.

The full v1 engine is around 250 lines of plain JavaScript. The complexity is in the data, not the code.
