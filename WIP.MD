# Work In Progress

This file is the current short roadmap for Notenotes. Keep it focused on what still needs decisions, testing, or implementation. Completed technical details belong in `AI.MD`.

## Current Recommendation

Stay in beta-hardening mode first. Local export, local backup, Tone presets, and controller triggers should feel boring and reliable before adding cloud backup or large new surfaces.

After that, the next visible work should be:

1. Pre-DAW positioning pass.
2. Track View prototype.
3. Google Drive Backup.

Release/deploy strategy is worth doing before a true `1.0.0`, but it does not need to block the beta hardening work unless accidental GitHub Pages deploys become a real problem.

## 1. Manual QA: Local Export And Backup

Goal:

Prove that users can get their work out of Notenotes safely.

Checklist:

- Snippet WAV export for MIDI, drum, audio, and Tone.
- Canvas WAV export with mixed MIDI, drum, and audio tracks.
- Canvas WAV export with clips that start after bar 1.
- Canvas WAV export in 2/4, 3/4, 4/4, and 5/4.
- Canvas and snippet MIDI export with normal MIDI and drum content.
- MIDI export with muted tracks.
- MIDI export with soloed tracks.
- MIDI export with empty Canvas or empty selected snippet.
- MIDI export with mismatched clips if any older project can still produce them.
- Real Audio In recording export after reload.
- Real Audio In recording whose decoded duration differs from stored snippet duration.
- Workspace-only backup export/import.
- Workspace plus milestones export/import.
- Full archive export/import.
- Snippet backup export/import, including audio snippets.
- Older backup import into current app.
- Newer backup import rejection message.

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
- Confirm preset deletion asks before deleting.
- Apply Tone preset to a selected MIDI clip.
- Apply Tone preset to a selected drum clip.
- Confirm deleting a preset does not remove Tone already saved on clips, snippets, notes, or hits.
- Confirm WAV export renders clip Tone, per-note Tone, and per-hit Tone.

Later polish:

- Rename Tone preset.
- Apply Tone preset directly to a snippet from the snippet library.

## 3. Manual QA: Controller Trigger Polish

Goal:

Make trigger behavior obvious and consistent for users who do not already think like musicians.

Checklist:

- Trigger Notes in single-note mode.
- Trigger Notes in chord mode.
- Tone trigger hotswitch behavior while recording.
- Helper text on mobile.
- Real controller trigger pressure on desktop Chrome.
- Real controller trigger behavior on mobile browsers where gamepads are supported.

Decisions to revisit:

- Whether the Trigger Notes list should stay as-is or be simplified after testing.
- Whether README copy should better explain that LT and RT are independent slots, so each trigger can be Tone, Trigger Note, or None.
- Whether Create mode needs a small always-visible trigger assignment reminder.

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

## 5. Pre-DAW Positioning Pass

Goal:

Try "Pre-DAW" as the short positioning phrase without losing the friendly "musical post-it note" language.

Plan:

- Lead the README with "pre-DAW" or test it close to the top.
- Define it gently for people who do not know what a DAW is.
- Reuse the phrase in future Reddit/LinkedIn posts if it feels right.
- Keep a deeper `PHILOSOPHY.md` for later.

Expected scope:

Small writing pass.

## 6. Track View Prototype

Goal:

A secondary Canvas view that renders snippets as Guitar Hero / Synthesia-style scrolling lanes during playback.

Why it fits:

- It supports color over notation.
- It pairs naturally with controller mode.
- It is more readable for people who do not read staff notation or piano roll.
- It can use the same note/hit data without changing the data model.

Prototype notes:

- Lives inside Canvas as a toggle or split view, not a new top-level mode.
- Render to canvas and animate with `requestAnimationFrame`.
- Audio scheduling stays untouched.
- Pick lanes by pitch class, scale degree, or pad during prototype.
- Do not ship it under a trademarked name.

Expected scope:

Medium. Likely 2-3 day prototype plus polish.

## 7. Google Drive Backup

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

## 8. Optional Later: Audio File Import

Goal:

Let users import audio files as audio snippets, not only record from Audio In.

Questions before building:

- Do we allow any audio file the browser can decode?
- Do we auto-trim silence?
- Do we ask for BPM or treat imported files as free audio?

Expected scope:

Small to medium.

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

## Open Strategic Topics

These are worth keeping visible, but they should not block beta.

### Bundle Format v1 Spec

The current workspace/snippet backup format is already close to a v1 bundle: project JSON, snippets, audio assets, milestones, version history, and app version. Formalizing it later means documenting what is already shipped before redesigning anything.

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

## Parking Lot

- Snippet dock icon polish for audio snippets.
- Full Tone automation editor.
- MP3 export with an optional encoder.
- Better chunking/code splitting if the Vite bundle warning becomes a practical problem.
- Fix any stale README anchors after positioning changes.
