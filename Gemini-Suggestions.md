# Gemini Evaluation: AI.MD vs. Codebase Reality

This document outlines the critical discrepancies between the `AI.MD` documentation and the actual implementation in the Notenotes codebase. These differences are dangerous because they can lead future AI models to make incorrect assumptions, resulting in bugs, timing issues, or data loss.

### 1. The "Ticks per Bar" Formula is Mathematically Wrong in AI.MD
* **What `AI.MD` says:** Under *MIDI Resolution*, it explicitly states: `Bar = ticksPerBeat × timeSignature.beats = 1920 ticks in 4/4`.
* **What the Code does:** In `Meter.js`, `ticksPerBarForMeter()` calculates `beatUnitTicks * numerator` (where `beatUnitTicks` adjusts for the denominator: `480 * (4 / denominator)`). 
* **The Danger:** `AI.MD`'s formula only works for `/4` time signatures. If an AI tries to calculate the length of a 6/8 bar using `AI.MD`'s logic, it will do `480 * 6 = 2880 ticks`. However, the actual code correctly calculates it as `240 * 6 = 1440 ticks`. An AI relying on the `AI.MD` formula will write loops and MIDI events that are exactly twice as long as they should be.

### 2. The `meter` Object is Missing from the Data Model
* **What `AI.MD` says:** The JSON Data Model block explicitly documents `timeSignature: { beats: 4, subdivision: 4 }` for both the project and snippets.
* **What the Code does:** The app migrated to a much more complex `meter` object (containing `numerator`, `denominator`, `pulse`, `pulseCount`, and `grouping` arrays for asymmetric meters). `ProjectStore.js` actively normalizes this via `_normalizeProjectMeter()`, keeping `timeSignature` around merely as a legacy mirror.
* **The Danger:** Because `project.meter` and `snippet.meter` are entirely absent from the `AI.MD` Data Model schema, an AI writing a new mode or exporter will rely on `timeSignature` as the source of truth, ignoring custom groupings (e.g., `[2, 3]` for 5/8 time) entirely.

### 3. The Dual-Store Audio Architecture is Undocumented
* **What `AI.MD` says:** The Data Model block lists how MIDI and Drum snippets are structured (notes, hits, soundTraits), but provides zero schema for Audio snippets.
* **What the Code does:** `ProjectStore.js` employs a sophisticated dual-store architecture. It actively strips out Base64 data (`_sanitizeProjectForStorage` deletes `audioDataUrl`) and saves heavy blobs into a separate IndexedDB table called `STORE_AUDIO_ASSETS`, leaving only an `audioAssetId` in the project JSON.
* **The Danger:** If an AI is tasked with building a new audio sampling feature, it will look at `AI.MD`, see no rules about audio storage, and will likely shove massive Base64 strings directly into the `project.snippets` array. This will bypass the sanitization logic, bloat the JSON, and cause massive memory leaks when `JSON.stringify` runs on the IndexedDB transaction.

### 4. Curated Chords vs. Tertian Stacking
* **What `AI.MD` says:** It mentions that `ScaleBoard` handles chords and references `MusicTheory.js`, but it doesn't explain how non-Western chords are constructed.
* **What the Code does:** While standard scales use simple index stacking (`midis.push(this._fullScaleNotes[startIndex + 2])`), the app actually has a dedicated file (`src/engine/ScaleChords.js`) containing hardcoded semitone recipes (`SCALE_CHORDS`) for scales like `hirajoshi` and `hungarianMinor`, which `ScaleBoard._getChordMidis()` intercepts.
* **The Danger:** If an AI is tasked with adding a new scale or an arpeggiator feature, it won't know `ScaleChords.js` exists because `AI.MD` doesn't mention it. It will assume all chords can be generated via simple index math (`1-3-5`), ruining the curated harmony built for Eastern scales.

---
**Recommendation:** Update `AI.MD` to include the `meter` object in the data model, explain the `STORE_AUDIO_ASSETS` split, add a pointer to `ScaleChords.js`, and fix the `ticksPerBar` formula so future agents have accurate context.
