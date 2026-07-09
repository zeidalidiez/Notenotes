# Work In Progress

> Archived planning snapshot from June 2026. Items may be shipped, superseded, or
> rejected. See [`../roadmap.md`](../roadmap.md) and
> [`../manual-qa.md`](../manual-qa.md) for current work.

This file is the current short roadmap for Notenotes. Keep it focused on what still needs decisions, testing, or implementation. Completed technical details belong in `AI.MD`.

## Current Recommendation

Stay in beta-hardening mode first. Local export, local backup, Tone presets, and controller triggers should feel boring and reliable before adding cloud backup or large new surfaces.

After that, the next visible work should be:

1. Mobile Create layout, BPM control, and snippets drawer hardening.
2. Pre-DAW positioning pass.
3. Stage views and modular pad surface planning.
4. Google Drive Backup.

Progression/Changes work has started as a foundation slice: the project now has
an inactive-by-default, degree-based progression context, resolver, compact
`Changes: ...` top-bar picker, scale-compatible preset filtering, and adjustable
Pads/Piano chord-tone glow. There is no playback, recording, export, or
automatic progression-advance behavior yet.

Release/deploy strategy is worth doing before a true `1.0.0`, but it does not need to block the beta hardening work unless accidental GitHub Pages deploys become a real problem.

## 1. Manual QA: Local Export And Backup

Goal:

Prove that users can get their work out of Notenotes safely.

Checklist:

<!-- - Snippet WAV export for MIDI, drum, audio, and Tone.
- Canvas WAV export with mixed MIDI, drum, and audio tracks.
- Canvas WAV export with clips that start after bar 1.
- Canvas WAV export in 2/4, 3/4, 4/4, and 5/4.
- Canvas and snippet MIDI export with normal MIDI and drum content.
- MIDI export with muted tracks.
- MIDI export with soloed tracks.
- MIDI export with empty Canvas or empty selected snippet.
- MIDI export with mismatched clips if any older project can still produce them. -->
<!-- - Real Audio In recording export after reload. -->
<!-- - Real Audio In recording whose decoded duration differs from stored snippet duration. -->
<!-- - Workspace-only backup export/import. -->
<!-- - Workspace plus milestones export/import. -->
<!-- - Full archive export/import. -->
<!-- - Snippet backup export/import, including audio snippets. -->
<!-- - Older backup import into current app. -->
<!-- - Newer backup import rejection message. -->

How the user can help:

- Test on iPhone 15 Chrome/Safari where possible.
- On iPhone 15 Chrome/Safari, fresh-load the app and confirm the first Scale/Kit/Piano pad press starts audio without touching Audio In first.
- On iPhone 15 Chrome/Safari, record Audio In, stop, and confirm a snippet is created every time.
- Record a real Audio In snippet, reload the app, then try WAV export and backup/restore.
- Save one backup file somewhere outside the repo so we can use it as a known-good restore sample later.

## 2. Manual QA: Tone Presets And Clip Tone

Goal:

Make Tone presets useful without turning Canvas into a full mixer.

Checklist:

- Save, apply, overwrite, and delete Tone presets from synth Tone.
- Save, apply, overwrite, and delete Tone presets from Kit Tone.
- Reset synth Tone and Kit Tone back to zero.
- Rename a Tone preset by selecting it, editing the name field, and saving.
- Save an existing Tone preset as a separate new preset.
- Confirm preset deletion asks before deleting.
- Apply Tone preset to a selected MIDI clip.
- Apply Tone preset to a selected drum clip.
- Confirm deleting a preset does not remove Tone already saved on clips, snippets, notes, or hits.
- Confirm WAV export renders clip Tone, per-note Tone, and per-hit Tone.

Later polish:

- Apply Tone preset directly to an editable snippet from Inspect. Do not describe this as "from the snippet library" unless the tray gains a real editing action.

## 3. Labs Controller Cleanup

Goal:

Keep controller setup useful without letting Labs become a second instrument
surface or repeating controls that already live elsewhere.

Checklist:

- Move the current controller setup into a dedicated tab or section inside Labs.
- Remove the Labs octave controls. Octave already belongs to the active surface
  and should not be duplicated in controller setup.
- Remove the fallback scale / unbound-button list from Labs. It is redundant
  with the live fallback behavior and makes the panel feel like a playable
  surface instead of setup.
- Keep learned bindings, controller presets, and held modifier slot assignment
  visible from the controller tab.
- Confirm `LB`, `LT`, `RB`, and `RT` remain reserved for held modifiers and do
  not appear in the controller button learn flow.

Decisions to revisit:

- Whether Labs should use simple tabs, an accordion, or a compact section list
  as more experimental/accessibility surfaces are added.
- Whether controller presets should be managed from the controller tab only or
  also surfaced near the global Controller button.

## 4. Migration Discipline

Goal:

Older user data should move forward safely when the user explicitly imports or opens it. Newer data should not be imported into older app versions.

Rules:

- Prefer additive data changes when possible.
- Backups from newer app versions stay blocked from older builds.
- Future breaking data-shape changes need an explicit migration path.
- Migration should be tied to a user action such as backup import or project open.
- A migration should preserve a recoverable checkpoint before further edits whenever practical.

Not in scope:

- Background migration sweeps.
- Mutating projects the user did not explicitly open or import.
- Update prompts or forced client-side app updates.

## 5. Mobile Create Layout, BPM Control, And Snippets Drawer

Goal:

Make Create mode usable on iPhone-sized screens without hiding core controls,
forcing awkward horizontal drags, or letting the snippet tray eat the playable
surface. The BPM control should become touch-friendly instead of behaving like a
tiny desktop counter.

Observed problem:

On iPhone 15-sized viewports, the transport, key/scale/meter row, instrument
tabs, Patch/Tone/AI/Controller/Layout row, Pad Mode row, pads, and snippets tray
all compete vertically. Patch can become nearly unreadable, there is wasted
space between Pad Mode and octave controls, and the snippets tray can leave the
actual pads clipped offscreen. Horizontal rows with buttons such as AI/Layout can
also feel impossible to drag because the first touch opens the button. The inline
BPM box is also too large and awkward for mobile, while still being too small to
edit comfortably with touch.

First pass:

- Convert the Create toolbar into deliberate mobile rows instead of letting the
  desktop layout squeeze itself.
- Keep the active Patch selector visible and usable on mobile, likely as a
  full-width or high-priority row.
- Make Pad Mode and octave controls share a compact row with less empty middle
  space.
- Collapse the snippets tray on narrow screens by default, with a clear
  `Snippets` header/count control to expand it when needed.
- Add or tune horizontal drag thresholds on toolbar rows so dragging the row does
  not immediately activate AI, Controller, Layout, or other buttons.
- Replace or adapt the BPM control on mobile. Preferred direction: a compact
  `120 BPM` button in the transport that opens a modal with direct numeric entry,
  small +/- controls, and clear Save/Cancel behavior instead of a cramped inline
  counter.

Acceptance notes:

- On iPhone 15 Chrome/Safari, Pads should be playable without the bottom rows
  cutting off the main pad grid.
- Patch, Pad Mode, and Snippets count should remain understandable without
  pinch-zooming.
- BPM should be readable at a glance and editable by touch without fighting the
  browser keyboard or tiny input steppers.
- Tapping a toolbar button should still open it, but horizontal dragging across
  the row should scroll rather than fire the first touched button.
- Collapsing the snippets tray should not delete or hide snippets permanently;
  it is only a workspace visibility state.

Expected scope:

Small to medium. This is a responsive-layout pass, not an audio or data-model
change.

## 6. Pre-DAW Positioning Pass

Goal:

Try "Pre-DAW" as the short positioning phrase without losing the friendly "musical post-it note" language.

Plan:

- Lead the README with "pre-DAW" or test it close to the top.
- Define it gently for people who do not know what a DAW is.
- Reuse the phrase in future Reddit/LinkedIn posts if it feels right.
- Keep a deeper `PHILOSOPHY.md` for later.

Expected scope:

Small writing pass.

## 7. Stage Views

Goal:

Turn the current Stage overlay into a small set of switchable visual views
without touching audio timing. Stage is already the shipped name for the older
"Flow" / "Performance Mode" idea; it has live Create views and Canvas track
views backed by `src/stage/`.

Shipped first slice:

- Keep Stage as a full-screen overlay. `src/stage/StageViews.js` now formalizes
  the view registry and filters views by mode.
- The current highway is the registered **Trace** view for live Create.
- **Thread** is the first alternate live view: pitch-contour ribbons where
  sustain becomes line length, velocity affects thickness, drums sit on a floor
  line, and chords read as parallel strands.
- **Pulse** is the second live Canvas2D view: a radial energy meter where recent
  hits and held notes expand colored slices by lane. It is the cheap rhythm /
  velocity counterpoint to Trace and Thread, not a WebGL commitment.
- **Halo** is the first tonal live Canvas2D view: it maps live notes onto a
  circle-of-fifths bloom so chords and pitch classes read as harmonic gravity
  instead of lane position.
- **Pocket** is the first guide-style live Canvas2D view: one clock revolution
  is the current Stage unit/pulse, lanes become concentric rings, quick hits
  become timing pips, and held notes grow into arcs using the real pulse
  duration. It is meant to make groove density and placement readable without
  quantizing or changing playback.
- Live Stage view switching now has previous/next buttons and left/right swipe
  in addition to the selector.
- Canvas Stage still uses the horizontal track map only. That view already shows
  internal note/drum/audio sublanes and should not be forced through every live
  view metaphor.
- Stage now has a render-quality budget before any new views are added:
  reusable field/background gradients are cached per canvas size/view, hot-path
  shadow blur scales down in dense scenes, and reduced-motion users get shorter
  trails plus minimal decorative detail. Stage remains read-only visual output.

Still pending:

- Lazy-load any future Three.js/WebGL view. Do not add three.js eagerly to the
  base bundle.
- Keep honoring reduced motion and the cheap Canvas 2D fallback when adding
  future views.

Viable future views from Opus/Grok review:

- **Ink/Bloom**: one organic expressive Canvas2D view merging the better parts
  of Sustain Nebula, Ripple Pond, Particle Garden, and Ink. Do not ship four
  separate "pretty particles" views.
- **Ridge**: first serious Three.js candidate. A flyover terrain where played
  notes become geography is the clearest 3D extension of the reverse-Guitar-Hero
  idea.

Open decisions:

- Whether WebGL is in scope soon or only architected-for.
- Whether each future view must support Canvas mode; default should be no unless
  it can show dense track detail better than the existing map.
- Whether Pocket should grow a stronger early/late reference layer later. The
  first version only shows placement within the current unit; it does not judge
  timing or snap anything.

Expected scope:

Medium. First slice should be a registry/refactor/perf pass, not a new visual
spectacle.

## 8. Modular Pad Surface

Goal:

Replace the equal-cell `ceil(sqrt(N))` ScaleBoard grid with a responsive,
span-based pad surface that fits better on mobile and allows future pad layout
templates without putting a framework or canvas in the note-trigger path.

Shipped first slice:

- Keep pads as native DOM `<button>` elements. Do not move playable pads to
  canvas/WebGL; accessibility, dwell play, tremor filtering, keyboard routing,
  and immediate pointer-to-sound behavior all depend on real buttons.
- `project.settings.padLayout` now exists additively with relative span sizes
  (`small`, `medium`, `large`, `wide`) and templates (`even` / Fit, `compact`,
  `rows`, `bigTonic`, `thumb`), not absolute pixel/freeform positions.
- Make the grid container-aware, with a minimum touch target and a narrow-phone
  fallback that ignores size variation and renders uniform pads.
- Equal-size templates use a balanced column helper so wide screens avoid
  orphaning one final pad when a cleaner split is available.
- The old `custom` pad mode is removed from the Pad Mode UI. Legacy `custom`
  normalizes to `single`; `scalePadsCount` remains dormant plumbing for a future
  full-custom surface.

Still pending:

- Avoid `innerHTML` rebuilds on resize or during drag/resize editing. If an
  editor is added later, move elements with transforms during drag and commit
  to the schema on drop.
- Whether cosmetic shapes ship in v1 or wait until the layout is stable.
- Whether to add a real layout editor, and where it should live.

Expected scope:

Next slices are medium to large if done properly. The shipped foundation is not
a full freeform editor.

## 9. Google Drive Backup

Goal:

Let users back up to a `.notenotes` folder in Google Drive with a retention setting.

Expected pieces:

- Google OAuth flow.
- Create or find `.notenotes` folder.
- Save workspace backup files.
- Save snippet backup files.
- Retention setting for how many cloud saves to keep.
- Restore UI.
- Offline, auth, quota, and permission error handling.

Recommendation:

Do not start this until local backups, storage clarity, and export reliability feel solid. It adds account permissions, cloud failures, and support burden.

Expected scope:

Large.

## 10. Optional Later: Audio File Import

Goal:

Let users import audio files as audio snippets, not only record from Audio In.

Questions before building:

- Do we allow any audio file the browser can decode?
- Do we auto-trim silence?
- Do we ask for BPM or treat imported files as free audio?

Expected scope:

Small to medium.

## 11. Custom Instrument Patches / Sample Instruments

Goal:

Let users turn one audio snippet or imported audio file into a playable custom instrument patch. A user should be able to record or import a sound, choose how that sound is interpreted, save it as an instrument patch, and play it from Scale, Piano, Controller, or Kit.

Why it fits:

- It keeps the app focused on playful idea capture, not studio production.
- It lets people make instruments out of their own voice, room sounds, toys, or found sounds.
- It builds on the durable audio asset storage work already done for Audio In.
- It keeps Kit included in the same sound-making philosophy as the melodic instruments.

Important boundary:

This is not an Ableton-style custom drum rack where every pad gets a separate sample. The intended first version is one source sound becoming one playable patch.

For melodic instruments:

- One source sample is pitch-shifted across notes and octaves.
- The user chooses a root note, probably defaulting to C4.

For Kit:

- The same one source sample is shaped into percussive hits across the Kit pads.
- Pads can use transformations like pitch, envelope, filter, drive, noise mix, or attack/decay changes to create a related family of drum/percussion sounds from one source.
- The model should feel closer to "turn this sound into a kit instrument" than "assign a different file to every pad."

First version:

- Add a `Create Instrument` flow.
- User names the instrument.
- User chooses instrument type: `Patch` or `Kit`.
- User chooses source: existing audio snippet or imported browser-decodable audio file.
- User adjusts controls appropriate to the selected type.
- User saves, applies, and deletes custom instruments.
- Deleting a custom instrument should ask for confirmation.
- If a custom instrument is currently used by snippets or Canvas clips, deletion should either be blocked or clearly explain what will happen before proceeding.
- Show custom melodic patches in the synth patch dropdown under a Samples or Custom heading.
- Show custom percussive patches in the Kit dropdown under a Samples or Custom heading.

Shared Create Instrument controls:

- Name.
- Type: Patch or Kit.
- Source: audio snippet or file import.
- Start/end trim.
- Normalize.
- Preview.

Patch-specific controls:

- Root note, probably defaulting to C4.
- Playback mode: one-shot or gated.
- Simple playback-rate pitch shifting: higher notes play faster/brighter, lower notes play slower/darker.
- Optional tone-shaping sliders if they map cleanly to the existing Tone system.

Kit-specific controls:

- Generate percussive pad variations from the single source using synthesis-style shaping.
- Likely sliders: attack, decay, pitch spread, filter brightness, drive, noise mix, and body/low-end.
- Preview individual pad variations before saving.
- Keep it as one source sound transformed into a kit-like instrument, not separate samples per pad.

Not first version:

- Time-stretching without pitch changes.
- Multi-sample instruments.
- Per-pad sample assignment / custom drum rack behavior.
- Velocity layers.
- Loop points with crossfades.
- Automatic pitch detection.
- Full sampler workstation UI.

Storage and backup requirements:

- Custom patches should store metadata in the project, with audio bytes stored through the existing audio asset system.
- Workspace backups must include custom instruments and the sample audio assets needed by those instruments.
- Workspace + milestones backups must include custom instruments and instrument audio assets referenced by the current workspace and milestones.
- Full archive backups must include custom instruments and instrument audio assets referenced by current workspace, milestones, and version history.
- Snippet backups need to include any custom instruments and audio assets required for the exported snippets to sound correct.
- If a backup/export path cannot include a required custom instrument, it should warn clearly instead of producing a misleading portable file.
- WAV export must render custom patches. MIDI export can preserve notes/timing only and cannot preserve the sample instrument sound.

Expected scope:

Medium. Basic playable sample patch is not hard; durable persistence, backup/restore, and WAV export make it a real feature.

## 12. Instrument Selection UX

Goal:

As built-in presets, custom sample patches, kits, and future voice instruments grow, users should not have to scroll through a long native dropdown and guess what each sound is.

Recommendation:

Build one reusable searchable instrument picker, then use it from Create, Kit, and Canvas.

Keep native selects for now as quick compact controls, but add a `Browse...` action when the list starts feeling crowded.

Picker shape:

- Opens as a popover or modal from the current patch/kit/track instrument control.
- Search field at the top.
- Category tabs or sections: Chip, Modern, Samples, Kits, Voices, Custom.
- Rows show name, family/type badge, and a tiny description where useful.
- Built-in instruments are read-only.
- Custom instruments expose Edit and Delete actions from the same row.
- Recently used instruments should float near the top once the list gets large.
- The same picker should support three contexts:
  - Create patch selection.
  - Kit selection.
  - Canvas track instrument selection.

Behavior rules:

- In Create, selecting a patch changes the live instrument immediately.
- In Canvas, selecting an instrument changes the track sound and invalidates the cached playback synth for that track.
- A MIDI track should only show MIDI-capable instruments.
- A drum track should only show kit-capable instruments.
- Audio tracks should not show the picker.
- If a snippet has `patchRecorded`, that remains a standalone snippet-export fallback; Canvas track selection still overrides it.

Expected scope:

Small for a planning/prototype pass, medium for a polished picker shared across Create and Canvas.

## Release Deploy Strategy

Deferred until closer to `1.0.0`, unless accidental public deploys become a real problem.

Sound logic from the external plan:

- GitHub Pages should eventually deploy only explicitly approved builds.
- Tag-gated deploys are safer than deploying every push to `main`.
- Cached/installed PWA users should not be nudged to update mid-project.
- A lightweight `RELEASE_NOTES.md` or GitHub Releases habit would help users and future debugging.

Not doing yet:

- Service worker update prompts.
- Client-side update polling.
- "New version available" toasts.
- A check-for-update button.

## Progression / Changes Follow-Up

Goal:

Turn the new degree-stored progression model into a useful harmonic guide
without making Notenotes feel like a rigid accompaniment generator.

Next slices:

- Add a shared progression editor/authoring surface, likely reachable from the
  selector and from Step Play, without stuffing more complexity directly into
  `ScaleBoard.js`.
- Add a progression advance model so the active step can move manually or follow
  bars. The current shipped glow only reflects `activeStepIndex`.
- Keep progression steps stored as degrees so changing project key/scale can
  re-resolve the harmonic context. Old snippets without progression data should
  continue to play normally; they simply do not get progression-aware glow.
- Consider the same noun-in-button-label pattern for other long top-bar
  controls only where it actually reduces clutter. Changes already uses
  `Changes: Off` while keeping modal/picker rows simple (`Off`, `The Axis`,
  etc.).

Open decisions:

- Final user-facing name: `Progression`, `Changes`, or something warmer.
- Default advance: manual/free first, strict bar-follow as an option, or the
  reverse.
- Whether the first visible editor supports triads only or exposes a small
  seventh toggle for progressions like ii-V-I.

## Open Strategic Topics

These are worth keeping visible, but they should not block beta.

### Bundle Format v1 Spec

The current workspace/snippet backup format is already close to a v1 bundle: project JSON, snippets, audio assets, milestones, version history, and app version. Formalizing it later means documenting what is already shipped before redesigning anything.

### Internal Audio Asset Format

Audio In recordings are still stored through the existing WAV/browser-decoded
asset path. A future storage slice should evaluate an additive
`audioAsset.format` model so new recordings can use WebM/Opus or AAC where a
browser supports it, while legacy WAV/data URL assets keep importing and playing
forever. WAV should remain an explicit export/interchange format even if the
internal storage default changes.

Recording-side channel preference is now a shipped Audio In control. Keep future
work focused on compressed internal formats and import/export bundle shape, not
on re-solving Mono/Stereo capture unless users report browser-specific issues.

### Sound Upgrade Progress

Shipped procedural fullness slices so far:

- Modern preset revoicing with richer oscillator/unison/filter/drive defaults.
- Velocity response for filter brightness and a touch of drive on harder notes.
- Modern stereo width plus Canvas track pan and stereo WAV export choices.
- Fixed master glue output stage mirrored in live playback and WAV export.
- Shared curved synth amplitude/filter envelopes mirrored in live playback and
  WAV export.

Next likely sound slices:

- Better procedural drum noise shaping/transients.
- A serious design pass for renderer unification before adding heavier DSP.

### Plugin Architecture

The README says instruments are pluggable, but today that means "fork the repo and add a class." A real plugin surface should wait until the app shape is more settled.

### WCAG Accessibility Basics

Keyboard navigation, focus rings, ARIA labels, color-blind-safe palettes, `prefers-reduced-motion`, `prefers-contrast`, and large hit target options are high-impact future work.

### Tone Glyph Visualization

A small shape next to clips/snippets showing Tone trait amounts could make "this one sounds gnarly" visually recognizable without opening settings.

### Philosophy / Contribution Guardrails

A future `PHILOSOPHY.md` and `CONTRIBUTING.md` should make the boundaries explicit: creation tool, no accounts, no telemetry, no server requirement, no social feed, no paid features, no distribution-first features.

### The Name

"Notenotes" is memorable but a little stuttery and hard to search. Rename is deferred until after the app shape is clearer.

## Backburner

### Draw To Make Music

Pitch contour drawing, rhythm painting, Tone painting, and gesture-as-modulation all fit the app's values. The simplest future version is probably scale-snapped pitch contour drawing on a grid.

### Touch Velocity Instrument

Keep ordinary touch, mouse, and QWERTY note velocity fixed for now so the core
Pads/Piano/Kit surfaces stay predictable. Consider a separate expressive
instrument or pad mode for touch/mouse users who want velocity-like control: a
string/pluck surface, elastic lane, pressure-free strum, or other gesture where
drag distance/speed naturally maps to velocity without making normal taps
erratic.

## Parking Lot

- Snippet dock icon polish for audio snippets.
- Full Tone automation editor.
- MP3 export with an optional encoder.
- Better chunking/code splitting if the Vite bundle warning becomes a practical problem.
- Fix any stale README anchors after positioning changes.
