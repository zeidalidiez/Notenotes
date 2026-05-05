# Work In Progress

This file is the current short roadmap for Notenotes. Keep it focused on what still needs decisions or implementation. Details about how the current code works belong in `AI.MD` unless they directly affect a planned change.

## Current Recommendation

Move next to **Google Drive Backup** only if local backup/export testing feels solid. Otherwise spend a short manual QA pass on export, backup import, Tone presets, and controller triggers first.

Why:

- Export trust matters for beta.
- Durable audio storage is now in place.
- Typed Canvas tracks are already in place.
- Users need confidence that what they arrange can leave the app intact.

## 1. WAV Export Hardening

Goal:

Make snippet and Canvas WAV export feel reliable enough for real users.

Current status:

- Canvas WAV export sizes the render after audio clips are decoded, so long recordings are not cut off by stale tick durations.
- Canvas WAV export uses the project tempo for Canvas timing, matching playback.
- Track mute/solo and track volume are honored in Canvas WAV export.
- Mismatched clips and unavailable audio are skipped defensively and summarized to the user.
- Canvas WAV export no longer downloads a silent file when there are no audible/renderable Canvas clips.
- Snippet WAV export now fails clearly if the selected Audio In recording is unavailable instead of downloading silence.
- Canvas MIDI export respects typed tracks plus mute/solo state, and no longer downloads a misleading file when there are no MIDI/drum events to export.
- Snippet MIDI export no longer downloads a tempo-only file when the selected snippet has no MIDI/drum events.

Needs testing or follow-up:

- Smoke test snippet WAV export for MIDI, drum, audio, and Tone.
- Smoke test Canvas WAV export with mixed MIDI, drum, and audio tracks.
- Test clips that start after bar 1.
- Test non-4/4 time signatures.
- Test real Audio In recordings whose stored snippet duration differs from decoded audio duration.

Code note:

WAV export already has paths for MIDI, drum, audio, Tone rendering, and asset-backed audio. This is mainly a trust pass and bug-fix pass, not a new exporter.

Expected scope:

Small to medium.

## 2. Backup Options and History Limits

Goal:

Give users clearer control over how much history and backup data they keep.

Current status:

- Version history depth is selectable per project: `5`, `10`, `25`, or `50`.
- Workspace backups can be saved as current workspace only, workspace plus milestones, or full archive with milestones plus version history.
- Workspace backup import restores included milestones and version history when the backup file contains them.
- Backup size estimate now reacts to the selected backup contents.
- Embedded audio in imported backups is re-saved as fresh local audio assets, so workspace/snippet backup files remain portable across browsers and devices.
- Workspace and snippet backup JSON now records the app version that created the file.
- Backup import accepts older/matching app versions, but rejects backups created by a newer Notenotes version or newer backup schema.

Recommended settings:

- Version history depth: `5`, `10`, `25`, `50`.
- Workspace backup contents: current workspace only.
- Expanded backup contents: workspace plus milestones.
- Full archive backup contents: workspace plus milestones plus version history.

Needed UX:

- Explain that browser/PWA storage is local to that browser/device.
- Explain that exported backup files are the user's portable copy.
- Show a rough backup size estimate before export when possible.

Still needs testing:

- Export and import a workspace-only backup.
- Export and import a milestones backup.
- Export and import a full archive backup.
- Confirm older workspace and snippet backups still import correctly.

Expected scope:

Mostly manual testing now.

## 3. Tone Presets and Clip Tone Editing

Goal:

Let users save and reuse Tone settings without turning the Canvas into a full mixer.

Current status:

- Users can save named Tone presets from the Create Tone popover.
- Users can apply a Tone preset to live playing from the Create Tone popover.
- Canvas has a compact Tone preset picker that applies the preset to the selected MIDI or drum clip.
- Clip-level Tone presets do not mutate the original snippet, so repeated uses of one snippet can have different Tone.
- Playback and WAV export prefer clip Tone, then per-note/per-hit Tone, then snippet/project Tone.
- Canvas Tone badges now work for drum clips too.

Recommended model:

- Users can save named Tone presets.
- Users can apply a preset to live playing.
- Users can apply a preset to a snippet.
- Users can apply a preset to a selected Canvas clip.
- Recorded notes and drum hits keep the Tone that was active when they were played.

Canvas visual:

- Keep small Tone badges on clips with active Tone.
- Add Tone badges to drum clips too.
- Keep pitch/modulation lines separate from Tone badges.
- Do not build full automation lanes yet.

Export and backup logic:

- WAV export should render Tone.
- Notenotes JSON backups should preserve Tone.
- MIDI export should not be expected to preserve Tone because standard MIDI does not reliably carry Notenotes sound-design data.

Expected scope:

Mostly manual testing now. A later polish pass can add preset delete/rename and direct snippet-library application.

## 4. Controller Trigger Polish

Goal:

Make trigger behavior obvious and consistent for users who do not already think like musicians.

Current status:

- Trigger helper copy is shorter and explains the hold-trigger-first behavior for Trigger Notes.
- Tone trigger helper copy explains that Tone is recorded only into notes played while the trigger is held.
- Controller layout now stacks and scrolls on narrower screens instead of forcing the controller art, dropdowns, and helper text into a cramped side-by-side view.

Possible follow-up:

- Re-check trigger helper text on mobile.
- Confirm Trigger Notes feel clear in single-note mode and chord mode.
- Decide whether the Trigger Notes list should stay as-is or be simplified after testing.
- Confirm real controller trigger pressure maps cleanly on desktop Chrome and mobile browsers where gamepads are supported.

Expected scope:

Small.

## 5. Google Drive Backup

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

Do not start this until local backups, storage clarity, and export reliability feel solid. This is useful, but it adds account permissions, cloud failures, and support burden.

Expected scope:

Large.

## 6. Optional Later: Audio File Import

Goal:

Let users import audio files as audio snippets, not only record from Audio In.

Why it fits:

Audio assets now exist, so imported files can use the same storage path as recordings.

Questions before building:

- Do we allow any audio file the browser can decode?
- Do we auto-trim silence?
- Do we ask for BPM or treat imported files as free audio?

Expected scope:

Small to medium.

## Parking Lot

These are worth remembering but should not block beta:

- Snippet dock icon polish for audio snippets.
- Full Tone automation editor.
- MP3 export with an optional encoder.
- Better chunking/code splitting if the Vite bundle warning becomes a practical problem.
