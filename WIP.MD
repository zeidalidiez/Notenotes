# Work In Progress

This file is the current short roadmap for Notenotes. Keep it focused on what still needs decisions, testing, or implementation. Completed technical details belong in `AI.MD`.

## Current Recommendation

Stay in beta-hardening mode before Google Drive Backup.

Why:

- Export trust matters for beta.
- Durable audio storage and typed Canvas tracks are in place.
- Local backup/export behavior should feel boring and reliable before adding cloud auth and sync failure modes.

## 1. Local Export And Backup QA

Goal:

Prove that users can get their work out of Notenotes safely.

Needs testing:

- Snippet WAV export for MIDI, drum, audio, and Tone.
- Canvas WAV export with mixed MIDI, drum, and audio tracks.
- Canvas and snippet MIDI export with muted, soloed, empty, and mismatched tracks.
- Clips that start after bar 1.
- Non-4/4 time signatures.
- Real Audio In recordings whose stored snippet duration differs from decoded audio duration.
- Workspace-only backup export/import.
- Workspace plus milestones export/import.
- Full archive export/import.
- Snippet backup export/import, including audio snippets.
- Older backup import into current app.
- Newer backup import rejection message.

## 2. Tone Presets And Clip Tone Editing

Goal:

Make Tone presets useful without turning Canvas into a full mixer.

Still worth testing:

- Save, apply, overwrite, and delete Tone presets from synth Tone.
- Save, apply, overwrite, and delete Tone presets from Kit Tone.
- Apply Tone preset to a selected MIDI clip.
- Apply Tone preset to a selected drum clip.
- Confirm deleting a preset does not remove Tone already saved on clips, snippets, notes, or hits.
- Confirm WAV export renders clip Tone, per-note Tone, and per-hit Tone.

Later polish:

- Rename Tone preset.
- Apply Tone preset directly to a snippet from the snippet library.

## 3. Controller Trigger Polish

Goal:

Make trigger behavior obvious and consistent for users who do not already think like musicians.

Still worth testing:

- Trigger Notes in single-note mode.
- Trigger Notes in chord mode.
- Tone trigger hotswitch behavior while recording.
- Helper text on mobile.
- Real controller trigger pressure on desktop Chrome and mobile browsers where gamepads are supported.

Decision to revisit:

- Whether the Trigger Notes list should stay as-is or be simplified after testing.

## 4. Google Drive Backup

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

## 5. Optional Later: Audio File Import

Goal:

Let users import audio files as audio snippets, not only record from Audio In.

Questions before building:

- Do we allow any audio file the browser can decode?
- Do we auto-trim silence?
- Do we ask for BPM or treat imported files as free audio?

Expected scope:

Small to medium.

## Parking Lot

- Snippet dock icon polish for audio snippets.
- Full Tone automation editor.
- MP3 export with an optional encoder.
- Better chunking/code splitting if the Vite bundle warning becomes a practical problem.
