# Inspect Mode Revamp — Implementation Handoff

**Repo:** `zeidalidiez/Notenotes`
**Audience:** the next coding agent (Claude Code) implementing this feature.
**Status:** spec ready to implement. No code has been written yet.

This document is self-contained. Read §0–§2 first for the mental model, then implement features A–D (§3–§6) in order. Every file path and symbol below was verified against the current source.

---

## 0. What we're building (the "why")

Right now **Inspect** is a secondary tab you land in only after picking a snippet, and you pick that snippet from a cramped native `<select>` dropdown. We want Inspect to become the **home base** for browsing and auditioning your material:

1. **Inspect is the default mode on load** (today it's Create).
2. **When no clip is open, Inspect is a file-explorer–style browser** of all snippets and `.wav` files — sortable, filterable, searchable, with previews. This replaces the dropdown.
3. **An open clip gets a Close button** that returns you to that browser.
4. **The play button, while in Inspect, plays only the clip being inspected** (not the Canvas arrangement). Entering or leaving Inspect stops playback.

This aligns with an existing, explicit project preference (see `Handoff.MD`): *"Avoid huge native dropdowns… Pickers and mobile modal behavior are preferred for large lists."*

---

## 1. Architecture you must respect

From `ArchitecturalLogic.md` and `Handoff.MD` — do not violate these:

- **Vanilla JS, no framework.** Each component is an ES module class that owns its DOM element (`this.el`), builds it in a `render()` method, and wires its own listeners. No React/Vue/virtual DOM. No new runtime/CDN dependencies. Offline-first, mobile/PWA-friendly.
- **State lives in one `project` object.** `project.snippets` is the array of clips. Components receive `this.project` top-down from `main.js`. Mutations are in-place and shared by reference; persistence is a debounced `this.store.scheduleAutoSave(this.project)`.
- **Schema changes must be additive.** Old projects and old snippets must keep loading. Never rename/remove existing snippet fields.
- **Two clocks.** Audio scheduling is the lookahead scheduler in `Transport.js`; visuals run on `requestAnimationFrame`. Keep audio logic in `engine/`, UI in `ui/`/`modes/`.
- **`main.js` is the orchestrator / wiring hub.** There is no event bus; `main.js` manually connects components via setters and callbacks.
- **Docs:** update `AI.MD` (concise note of the logic change) and `README.md` (user-facing behavior, preserve the author's voice) when done.
- **iOS audio unlock is fragile** — don't touch the `AudioEngine`/gesture unlock path.

---

## 2. Mental model & glossary

- **Modes** (`src/ui/ModeTabs.js`): three tabs.
  - `Modes.CREATIVE` = "Create" 🎹
  - `Modes.CANVAS` = "Canvas" 🎼
  - `Modes.PIANOROLL` = "Inspect" ✏️ — **this is Inspect.** The internal key is `pianoroll`; the implementing class is `EditMode`.
- **`EditMode`** (`src/modes/EditMode.js`) — the Inspect screen. Composed from mixins:
  `editAudioPlayer.js`, `editRoll.js`, `editNotes.js`, `editRhythmFit.js`, `editEvents.js`.
- **Snippet** = one clip in `project.snippets`. Shape (relevant fields):
  ```
  {
    id, createdAt, name,
    type: 'midi' | 'drum' | 'audio',   // 'audio' === a recorded .wav
    notes: [{ pitch, startTick, durationTick, velocity }],   // midi
    hits:  [{ type, startTick, ... }],                        // drum
    durationTicks, bpm, meter, timeSignature,
    // audio-only:
    audioAssetId, audioDataUrl, audioUrl, audioPeaks, audioUnavailable, audioUnavailableReason,
    // optional:
    aiSeeded, aiPrompt
  }
  ```
- **"Canvas playback"** = the global `Transport` drives `PlaybackEngine`, which reads **Canvas tracks** (`project.tracks`) and plays them. This is what the play button does today, in every mode.
- **"Inspect playback"** (new) = while in Inspect with a clip open, the play button plays only that one clip.

### Files you will touch

| File | Why |
|---|---|
| `src/ui/ModeTabs.js` | Default mode → Inspect. |
| `src/main.js` | Default active view; mode-change stop logic; inspect-playback routing; close wiring. |
| `src/modes/EditMode.js` | Replace empty-state dropdown with the browser; close handling; `refreshSnippetList()` rework. |
| `src/modes/editRoll.js` | Remove Load dropdown from MIDI/drum toolbar; add Close button. |
| `src/modes/editAudioPlayer.js` | Remove Load dropdown from audio toolbar; add Close button; expose audio play/pause/stop helpers. |
| `src/modes/editEvents.js` | Remove the `#edit-load-clip-select` listener. |
| `src/modes/edit.css` | Styles for the browser + close button. |
| `src/engine/PlaybackEngine.js` | Add an "inspect source" so playback can target a single snippet instead of Canvas tracks. |
| `src/ui/TransportBar.js` | Add an `onPlayToggle` seam so the play button can be intercepted in Inspect. |
| **NEW** `src/ui/snippetPreview.js` | Shared mini-preview SVG (extracted from `SnippetTray`) reused by the browser. |
| `README.md`, `AI.MD` | Docs. |

---

## 3. Feature A — Inspect is the default mode

### Current behavior
- `src/ui/ModeTabs.js`: `this.activeMode = Modes.CREATIVE;` (constructor).
- `src/main.js` (`_buildLayout`, ~line 749): `creativeView` is created with class `mode-view is-active`; the pianoroll view is created inactive via `_createModeView(Modes.PIANOROLL, false)` (~line 762).

### Change
1. In `ModeTabs` constructor: `this.activeMode = Modes.PIANOROLL;`
2. In `main.js`, make Inspect the initially visible view. The robust way (avoids hard-coding `is-active` in two places) is, **after the project loads and `editMode` is mounted and all wiring is done**, to explicitly select Inspect:
   ```js
   this.modeTabs.setActive(Modes.PIANOROLL);
   this._switchMode(Modes.PIANOROLL);
   ```
   Do this at the end of the init sequence (after the block around `main.js` ~line 152–192 that creates `editMode`, wires snippet selection, and loads snippets into the tray). Also remove the hard-coded `is-active` from `creativeView` (or let `_switchMode` correct it — `_switchMode` already toggles `is-active` on every `.mode-view`).
3. `EditMode.render()` already calls `_renderEmpty()` when no snippet is loaded, so on a fresh load the user lands in the new browser (Feature B).

### Watch-outs / regressions
- **Create mode must still fully initialize even though it's no longer the first active tab.** Instruments, synth, `PlaybackEngine`, recording, and Stage are all constructed in `main.js` init regardless of the active view (the view is just CSS visibility), so this should be safe — **verify** that Create still works after switching to it (pads/piano/kit render, audio plays).
- Audio unlock is gesture-based and independent of the active tab — don't change it.
- The existing SnippetTray "tap → inspect" flow (`main.js` ~line 168) must still work.

### Acceptance criteria
- Fresh load (and reload) shows the Inspect tab active with the file browser.
- Tapping Create / Canvas still switches correctly; Create is fully functional.

---

## 4. Feature B — File-explorer snippet/wav browser (replaces the dropdown)

This replaces the body of **`EditMode._renderEmpty()`** (`src/modes/EditMode.js`, ~lines 105–143). Today that method renders a `<select id="edit-empty-select">` plus "New MIDI/Drum Clip" buttons. Replace the `<select>` with a browser.

### Data source
`this.project.snippets` (may be empty). Each item is midi/drum/audio per §2.

### Layout (build in vanilla JS, append to `this.el`)
A toolbar + a scrollable item container:

- **Toolbar row** (compact, mobile-safe — no giant native multiselect):
  - **Search**: text `<input>` filtering by `name` (case-insensitive; also match auto-labels).
  - **Type filter**: segmented control / pills — `All · MIDI · Drum · Audio`. (For mobile, you may reuse the existing **`src/ui/ChoicePicker.js`** component rather than a native `<select>`.)
  - **Sort**: `Newest · Oldest · Name A–Z · Type · Longest · Most used`.
    - Newest/Oldest → `createdAt`.
    - Name → `name || autoLabel`.
    - Type → group by `type`.
    - Longest → `durationTicks`.
    - Most used → usage count (see usage provider below).
  - **View toggle**: `List` ⟷ `Grid` (file-explorer style; grid = preview-forward cards, list = compact rows).
  - **New clip actions**: keep `New MIDI Clip` and `New Drum Clip` (reuse existing `#edit-new-midi`/`#edit-new-drum` handlers → `_createBlankSnippet('midi'|'drum')`). Recording new audio stays in Create mode (out of scope).
- **Item container**: `.edit-browser__items` with one element per filtered+sorted snippet.

### Each item shows
- **Mini preview** (waveform for audio, note blocks for midi, hit dots for drum) — **reuse the SVG logic** currently in `SnippetTray._renderMiniPreview()` (`src/ui/SnippetTray.js` ~lines 195–254). To avoid divergence, **extract it** into a new shared module `src/ui/snippetPreview.js`:
  ```js
  // src/ui/snippetPreview.js
  export function renderSnippetPreviewSVG(snippet, { width = 80, height = 28 } = {}) { /* moved from SnippetTray */ }
  ```
  Then import it in **both** `SnippetTray` (replace the inline method) and the new browser. Keep the existing visual output identical so the tray is unchanged.
- **Type badge**: `MIDI` / `DRUM` / `AUDIO` (mirror `SnippetTray` icon strings).
- **Name** + **meta**: e.g. `12 notes · 2 bars`, or `Audio · 3.4s`. Reuse the bar math: `Math.ceil(s.durationTicks / ticksPerBarForMeter(s.meter || s.timeSignature, 480))` (import `ticksPerBarForMeter` from `src/engine/Meter.js`).
- **`createdAt`** as a short date.
- **AI badge** when `s.aiSeeded` (tooltip = `s.aiPrompt`), matching the tray.
- **Usage badge** ("in N tracks" / "unused"): reuse the **usage provider** pattern the tray already uses (`SnippetTray.setSnippetUsageProvider`, fed in `main.js`). Wire the same provider into the browser so "Most used" sort and the badge work. If wiring the provider is non-trivial, ship the badge as a follow-up but keep the sort option behind the same data.
- **Actions**: click/tap the item → **open it** (`this.loadSnippet(snippet)`); a **delete** (✕) control reusing the existing deletion path (confirm dialog + `project-snippets-changed` event + `scheduleAutoSave`, mirroring `SnippetTray.removeSnippet`). Don't duplicate deletion logic divergently — factor a shared helper or dispatch the same event `main.js` already listens for (`main.js` ~line 176).

### Interactions & state
- Clicking an item calls `this.loadSnippet(snippet)`; `EditMode` already renders the note editor or the audio player based on `snippet.type`.
- Implement filter/sort/search in-memory; re-render only `.edit-browser__items` on control change (don't rebuild the whole toolbar — keep focus in the search box).
- **Persist the user's last sort/filter/view** additively, e.g. `project.settings.inspectBrowser = { sort, filter, view }` (create if missing; default sensibly). This is additive schema — safe. (localStorage is an acceptable alternative if you'd rather not touch `project`.)
- **Empty state** (zero snippets): a friendly message + the New MIDI/Drum buttons (don't show an empty grid).

### CSS
Add `.edit-browser`, `.edit-browser__toolbar`, `.edit-browser__items`, `.edit-browser__item`, `--grid`/`--list` modifiers to `src/modes/edit.css`. Use existing design tokens (`var(--surface-*)`, `var(--space-*)`, `var(--accent*)`, `var(--font-size-*)`). Make the grid responsive (`grid-template-columns: repeat(auto-fill, minmax(...))`) and the container scrollable. Mobile: items should be tap-friendly; toolbar controls wrap.

### Acceptance criteria
- With ≥1 snippet, Inspect (no clip open) shows a browsable, scrollable library with working search, type filter, sort, and list/grid toggle.
- Clicking an item opens it in the editor/audio player.
- New MIDI/Drum buttons still create and open a blank clip.
- The Create-mode `SnippetTray` looks and behaves exactly as before (after the preview extraction).

---

## 5. Feature C — Close button on an open clip (and remove the Load dropdown)

### Add a Close button
When a clip is open, show a **Close** control (e.g. `✕ Close` or `‹ Library`) in the editor toolbar. It must exist in **both** toolbars:
- MIDI/drum editor toolbar — built in `src/modes/editRoll.js` `_renderEditor()` (~lines 13–150).
- Audio toolbar — built in `src/modes/editAudioPlayer.js` `_buildAudioToolbarHTML()` (~lines 35–76).

Behavior on click:
```js
this._stopInspectPlayback();   // see Feature D
this.loadSnippet(null);        // re-renders _renderEmpty() === the browser
```
`loadSnippet(null)` already routes to `_renderEmpty()` (`EditMode.loadSnippet`, ~lines 62–79), so the browser returns automatically. Bind the close handler where the other toolbar buttons are wired (MIDI/drum: `editEvents.js`; audio: `editAudioPlayer.js._bindAudioPlayerEvents`).

### Remove the Load dropdown entirely
The browser is now the **single** way to choose a clip; the in-editor Load `<select>` is redundant and should be **deleted**:
- Remove the Load `<div class="edit-toolbar__group">…<select id="edit-load-clip-select">…</select></div>` from **`editRoll.js`** (~lines 87–92) and **`editAudioPlayer.js`** (~lines 38–43).
- Remove the change-listeners for `#edit-load-clip-select` in **`editEvents.js`** (~line 21) and **`editAudioPlayer.js`** (~line 97).
- **Repurpose `EditMode.refreshSnippetList()`** (`EditMode.js` ~lines 81–96): it currently rebuilds the `<select>` options. Keep only its guard — if the open snippet was deleted elsewhere, call `this.loadSnippet(null)` (returns to browser); otherwise no-op (or refresh the browser list if the browser is showing). Remove the `#edit-load-clip-select` manipulation.
- **`_renderClipOptions()`** (`editRoll.js` ~line 154) becomes unused — delete it (and any now-dead imports).

### Acceptance criteria
- Opening any clip (midi/drum/audio) shows a Close button; clicking it returns to the browser with playback stopped.
- No Load dropdown remains anywhere in Inspect.
- Deleting the currently-open snippet (from the browser or tray) cleanly returns to the browser (no stale editor).

---

## 6. Feature D — Inspect-scoped playback + stop on navigation

**Goal:** in Inspect with a clip open, the play button plays **only that clip**; outside Inspect it plays the **Canvas** exactly as today; switching into or out of Inspect stops playback.

### How playback works today
- `src/ui/TransportBar.js` `_bindEvents()` (~line 156): the play button handler calls `this.transport.toggle()` directly. Stop calls `this.transport.stop()`.
- `src/main.js` `_bindKeyboard()`: **Space** → `this.transport.toggle()`, **Enter** → `this.transport.stop()`.
- `src/engine/PlaybackEngine.js` `init()` subscribes to `transport.onTick(...)` → `_processTick(tick, nextTickTime)`, which reads **Canvas tracks** (`project.tracks`) and triggers the per-track synths/kits.
- Audio snippets are previewed via a native `<audio class="edit-audio__player" controls>` element (`editAudioPlayer.js`) — **not** through the transport/PlaybackEngine.

### Design (recommended)

**1) Add an "inspect source" to `PlaybackEngine` (handles MIDI & drum clips).**
- New state + setter:
  ```js
  // PlaybackEngine
  setInspectSource(snippet /* or null */) {
    this._inspectSource = snippet || null;
    this._lastProcessedTick = -1;            // reset scheduling cursor
  }
  ```
- At the **top of `_processTick(tick, nextTickTime)`**, branch:
  ```js
  if (this._inspectSource) {
    this._processInspectTick(tick, nextTickTime); // schedule ONLY this snippet
    return;                                        // skip Canvas tracks entirely
  }
  // …existing Canvas-track scheduling unchanged…
  ```
- `_processInspectTick` schedules the snippet's `notes`/`hits` on a dedicated synth/kit (you can reuse a single instrument, e.g. a default synth for midi and the drum kit for drum), starting at tick 0. **Loop** the clip over `snippet.durationTicks` (the inspected clip loops while playing — wrap the local tick: `localTick = tick % snippet.durationTicks`). Reuse the existing note-trigger helpers in `PlaybackEngine` so timing/note-off logic matches Canvas playback. (Alternative: play once and auto-stop at `durationTicks` — see §8 Open decisions. Default is loop.)

**2) Add an interception seam on the play control.**
Add an optional callback to `TransportBar`:
```js
// TransportBar._bindEvents(), play handler:
this.el.querySelector('#btn-play').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (this.onPlayToggle) this.onPlayToggle();
  else this.transport.toggle();
});
```
In `main.js`, set `this.transportBar.onPlayToggle = () => this._handlePlayToggle();` and route **Space** through the same method (replace the direct `this.transport.toggle()` in `_bindKeyboard`).

**3) Centralize the branch in `main.js._handlePlayToggle()`:**
```js
_handlePlayToggle() {
  const inInspect = this.modeTabs.activeMode === Modes.PIANOROLL;
  const snippet = inInspect ? this.editMode?._snippet : null;
  if (inInspect && snippet) {
    if (snippet.type === 'audio') {
      this.editMode.toggleAudioPlayback();      // drive the <audio> element
    } else {
      this.playbackEngine.setInspectSource(snippet); // midi/drum
      this.transport.toggle();
    }
    return;
  }
  // default: Canvas playback (unchanged)
  this.playbackEngine.setInspectSource(null);
  this.transport.toggle();
}
```
Add small helpers to the audio mixin (`editAudioPlayer.js`): `toggleAudioPlayback()`, `pauseAudioPlayback()`, and `stopAudioPlayback()` that operate on `this.el.querySelector('.edit-audio__player')` (play/pause + reset `currentTime = 0` on stop).

**4) Stop playback when entering OR leaving Inspect.**
In `main.js`, the mode-change handler is `this.modeTabs.onChange((mode) => { this._switchMode(mode); … })` (~line 774). `_switchMode` only toggles CSS today. Add stop logic on every transition involving Inspect:
```js
this.modeTabs.onChange((mode) => {
  // stop any playback when crossing the Inspect boundary
  this.transport.stop();
  this.playbackEngine.setInspectSource(null);
  this.editMode?.stopAudioPlayback?.();
  this._switchMode(mode);
  if (mode === Modes.CANVAS && this.canvasMode) this.canvasMode.refresh();
});
```
(If you want to stop only when Inspect is involved, gate on `prevMode === PIANOROLL || mode === PIANOROLL`; stopping unconditionally on tab change is simpler and acceptable.)

**5) Stop on close and on switching clips.**
- Close button (Feature C) calls `_stopInspectPlayback()` before `loadSnippet(null)`.
- `loadSnippet(snippet)` should stop current inspect playback before swapping (`this.transport.stop()` + clear/replace source + reset `<audio>`), so audio doesn't bleed across clips. Expose a small `EditMode._stopInspectPlayback()` that main can also call, or have `loadSnippet` emit a callback `this.onInspectSnippetChanged?.(snippet)` that `main.js` uses to update `playbackEngine.setInspectSource(...)` and stop the transport. **Wiring via a callback from `EditMode` → `main.js` is preferred** (keeps `EditMode` UI-only and `PlaybackEngine` access in the orchestrator).

### Edge cases
- Opening Inspect while Canvas is playing → entering Inspect stops it (rule 4).
- Switching clips while playing → stop, then load (rule 5).
- Deleting the open snippet → `refreshSnippetList()` → `loadSnippet(null)` → also stop playback.
- Audio unavailable (`audioUnavailable` / missing asset) → play is a no-op with the existing status text; don't start the transport.
- Don't leak transport tick subscriptions: use the existing single `_processTick` subscription and the `_inspectSource` flag rather than subscribing/unsubscribing per clip.

### Acceptance criteria
- In Inspect with a MIDI or drum clip open, play plays **only** that clip (Canvas tracks are silent), and it loops; stop/Enter stops it.
- In Inspect with an audio clip open, play/pause drives that clip's audio; stop resets it.
- In Create/Canvas, play still plays the Canvas arrangement, unchanged.
- Switching tabs (either direction) and closing a clip both stop playback immediately.

---

## 7. Regression guardrails (must remain true)

- Old projects and old snippets still load; no snippet field renamed/removed; new fields are additive (`project.settings.inspectBrowser`).
- No framework, no new runtime dependency; offline/PWA still works.
- `SnippetTray` (Create mode) visually/behaviorally unchanged after the preview extraction.
- iOS audio unlock path untouched.
- Create mode fully functional despite no longer being the landing tab.
- Existing "tap a tray snippet → opens in Inspect" still works (now lands on the editor with a Close button).

---

## 8. Open decisions (defaults chosen — change if you disagree)

- **Loop vs one-shot:** the inspected clip **loops** while playing (chosen). One-shot (auto-stop at `durationTicks`) is a one-line change in `_processInspectTick`.
- **Browser-pref persistence:** stored in `project.settings.inspectBrowser` (additive). localStorage is acceptable instead.
- **Usage badge / "Most used" sort:** depends on wiring the existing usage provider into the browser; if it slips, ship sort+badge as a fast follow without blocking A–D.

---

## 9. Suggested commit breakdown

Use descriptive messages that explain *why* and what was QA'd (project convention).

1. `refactor(ui): extract snippet mini-preview into src/ui/snippetPreview.js` (no behavior change; SnippetTray imports it).
2. `feat(inspect): default to Inspect mode on load` (Feature A).
3. `feat(inspect): file-explorer snippet/wav browser replacing the empty-state dropdown` (Feature B).
4. `feat(inspect): close button + remove in-editor Load dropdown` (Feature C).
5. `feat(playback): inspect-scoped playback and stop-on-navigation` (Feature D).
6. `docs: update AI.MD and README.md for Inspect revamp`.

---

## 10. Verification

Per `Handoff.MD`:

```bash
npm.cmd run test:smoke
npm.cmd run build
git diff --check
```

**Manual QA:**
1. Reload → land in Inspect showing the browser. Search/filter/sort/grid-list all work.
2. Open a MIDI clip → Close returns to browser. Repeat for drum and audio.
3. Confirm no Load dropdown anywhere in Inspect.
4. In Inspect, play a MIDI/drum clip → only that clip sounds and it loops; stop works.
5. In Inspect, play an audio clip → its audio plays/pauses; stop resets.
6. Switch Inspect↔Canvas↔Create while playing → playback stops on every switch.
7. In Canvas, play → the arrangement plays as before.
8. Create mode: pads/piano/kit render and sound; recording still captures snippets that appear in the browser.
9. Load an **old** project → snippets still appear and open.
10. Delete the open snippet → returns to browser, no errors.

---

## 11. Quick reference — verified anchors

- `ModeTabs`: `Modes` enum + `activeMode` default — `src/ui/ModeTabs.js` (~line 7, ~line 13).
- Empty-state dropdown to replace — `EditMode._renderEmpty()` `src/modes/EditMode.js` (~lines 105–143).
- `loadSnippet(snippet|null)` — `src/modes/EditMode.js` (~lines 62–79).
- `refreshSnippetList()` (rework) — `src/modes/EditMode.js` (~lines 81–96).
- MIDI/drum toolbar + Load `<select>` + `_renderClipOptions()` — `src/modes/editRoll.js` (~lines 13–150, 154).
- Audio toolbar + Load `<select>` + audio `<audio>` element — `src/modes/editAudioPlayer.js` (~lines 35–129).
- `#edit-load-clip-select` listeners — `src/modes/editEvents.js` (~line 21), `src/modes/editAudioPlayer.js` (~line 97).
- Mini preview to extract — `SnippetTray._renderMiniPreview()` `src/ui/SnippetTray.js` (~lines 195–254); usage provider `setSnippetUsageProvider` (~line 32).
- Play button handler — `src/ui/TransportBar.js` `_bindEvents()` (~line 156); stop (~line 162).
- Space/Enter shortcuts — `src/main.js` `_bindKeyboard()` (~lines 952, 960).
- PlaybackEngine tick subscription + `_processTick` — `src/engine/PlaybackEngine.js` `init()` (~line 72).
- Mode init / default view / mode-change handler — `src/main.js` (`_buildLayout` ~line 749; `editMode` mount + snippet wiring ~lines 152–192; `modeTabs.onChange` ~line 774; `_switchMode` ~line 842).
