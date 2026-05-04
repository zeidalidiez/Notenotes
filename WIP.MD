# Work In Progress

This file is the current recommendation after auditing the codebase against the previous plan.

## Audit Summary

Some of the previous WIP list was stale. In particular, Canvas track type enforcement already exists.

## Already Exists

## Durable Audio Asset Storage

Status: implemented in the current local build.

Audio In recordings save into a dedicated IndexedDB `audioAssets` store. Projects, snippets, version history, milestones, and canvas clips reference recordings by `audioAssetId` instead of repeatedly copying the audio into every saved snapshot.

Current behavior:

- New recordings should survive reloads, browser restarts, project saves, version history, and milestones.
- Workspace and snippet JSON backups embed audio at export time so backups stay portable.
- Backup import converts embedded audio back into local audio assets.
- WAV export resolves asset-backed audio for snippet and canvas rendering.
- Existing `audioDataUrl` recordings can migrate into audio assets.
- Dead `blob:`-only recordings are marked unavailable instead of failing silently.

Important note:

The unavailable `blob:` case only applies to older or partial recordings that had no embedded audio data and no audio asset. A `blob:` URL alone is a temporary browser-session pointer and cannot be recovered after that session is gone.

## Canvas Track Type Enforcement

Status: already implemented.

Current behavior:

- Canvas top toolbar has typed add buttons:
  - `+ MIDI Track`
  - `+ Drum Track`
  - `+ Audio Track`
- Bottom add row has typed add buttons:
  - `+ Add MIDI`
  - `+ Add Drum`
  - `+ Add Audio`
- Tracks have explicit `type` values.
- MIDI tracks use synth instruments.
- Drum tracks use the kit.
- Audio tracks use audio clips.
- Desktop drag/drop rejects mismatched snippets.
- Touch drag/drop rejects mismatched snippets.
- Playback also skips mismatched clips defensively.

Small possible polish:

- Canvas snippet dock currently uses the music icon for non-drum snippets, so audio snippets may not visually read as audio there.
- Track type enforcement should still be manually smoke-tested after the audio storage change, but it does not need to be built from scratch.

## Partially Exists

## Tone Traits

Status: first useful version exists.

Current behavior:

- Project stores current Tone settings in `project.settings.soundTraits`.
- MIDI and drum recording can save Tone snapshots.
- Controller trigger assignments exist.
- Playback applies saved Tone snapshots to MIDI notes and drum hits.
- WAV export renders Tone for MIDI/drum snippets.
- Canvas shows Tone badges on MIDI clips with active Tone.

Still missing or incomplete:

- No user-saved Tone presets yet.
- No clean UI to apply a Tone preset to a selected snippet or selected Canvas clip.
- No explicit edit path for a saved snippet/clip Tone after recording.
- Tone badges currently appear for MIDI clips, not drum clips.
- No full Tone automation editor.

Recommendation:

Keep Tone presets as a later beta polish pass. Do not turn the Canvas into a full mixer yet.

## WAV Export

Status: works in important cases, but needs hardening.

Current behavior:

- Snippet WAV export exists.
- Canvas WAV export exists.
- Asset-backed audio can be resolved for export.
- MIDI/drum Tone rendering exists.

Known gaps to check or fix:

- Canvas WAV export does not appear to honor mute/solo yet.
- Missing audio assets are skipped quietly rather than summarized to the user.
- Mixed canvas export needs a deliberate smoke test with MIDI, drum, and audio tracks.
- Time signature and non-bar-one starts should be tested after the storage refactor.

Recommendation:

This is a good near-term task because export trust matters for beta.

## Local Backups

Status: basic portable backups exist.

Current behavior:

- Workspace backup exists.
- Snippet backup exists.
- Import exists.
- Audio is embedded into backup JSON during export.
- Imported audio is migrated back into local audio assets.

Still missing:

- User-selectable backup contents.
- Option to include milestones.
- Option to include version history.
- Backup size estimate.
- Clear explanation of what is local browser storage versus an owned backup file.

Recommendation:

Pair this with the storage meter instead of doing it as a separate abstract settings pass.

## Still Needs Work

## 1. Storage Meter and Backup Clarity

This is now my recommended next product-facing task.

Goal:

- Add a storage meter in Settings.
- Show estimated browser storage usage and quota with `navigator.storage.estimate()`.
- Show a warning when storage usage is getting high.
- Clarify that browser/PWA storage is local and can be cleared by browser data cleanup.
- Encourage workspace backup when recordings exist.

Suggested UI:

- Put this in Settings -> Save.
- Show:
  - `Browser storage used`
  - `Estimated storage available`
  - `Audio recordings stored`
  - `Workspace backup recommended`

Expected scope:

Small to medium.

Why this comes next:

The storage foundation is now better, but users still need to understand what is safe, what is local, and when to export a backup.

## 2. WAV Export Hardening

Goal:

Make WAV export trustworthy enough for beta users.

Checklist:

- Honor muted tracks.
- Honor soloed tracks.
- Report skipped unavailable audio clips.
- Test snippet WAV export for MIDI, drum, audio, and Tone.
- Test canvas WAV export for mixed MIDI, drum, and audio tracks.
- Test clips starting after bar 1.
- Test non-4/4 time signatures.

Expected scope:

Small to medium.

Recommendation:

Do this soon after the storage meter, or immediately if export trust feels more urgent.

## 3. Backup Options and History Limits

Goal:

Make local backup behavior clearer and configurable.

Recommended settings:

- Version history depth:
  - `5`
  - `10`
  - `25`
  - `50`
- Workspace backup contents:
  - current workspace only
  - workspace plus milestones
  - full archive: workspace plus milestones plus version history

Current code note:

Version history is currently hardcoded at 5.

Expected scope:

Medium.

## 4. Tone Presets and Clip Tone Editing

Goal:

Give users a clean way to save and reuse Tone Trait combinations without making every Canvas track a full effects mixer.

Recommended model:

- Project has current live Tone.
- Snippets store Tone snapshots recorded at capture time.
- Users can save Tone presets.
- Users can apply a Tone preset to:
  - live playing
  - a snippet
  - a selected Canvas clip

Canvas visual:

- Keep small Tone badges on clips with active Tone.
- Add drum clip Tone badges too.
- Keep pitch/modulation lines separate from Tone badges.
- Do not draw six automation lanes yet.

Export logic:

- MIDI export will not preserve Tone Traits because standard MIDI does not reliably carry this sound-design data.
- Notenotes JSON backup preserves Tone.
- WAV export should render Tone.

Expected scope:

Medium if kept to presets and badges.

## 5. Google Drive Backup

Goal:

Let users back up to a `.notenotes` folder in Google Drive with a retention setting.

Expected pieces:

- Google OAuth flow
- create/find `.notenotes` folder
- save workspace backup files
- save snippet backup files
- retention setting for how many cloud saves to keep
- restore UI
- offline/auth/quota error handling

Recommendation:

Do not start this until local backups, storage meter, and export reliability feel solid. This is useful, but it brings account permissions, cloud failures, and support burden.

## 6. Optional Later: Audio File Import

Goal:

Let users import audio files as audio snippets, not only record from Audio In.

Why it fits:

Audio assets now exist, so imported audio can use the same storage path as recordings.

Questions before building:

- Do we allow any audio file the browser can decode?
- Do we auto-trim silence?
- Do we ask for BPM or just treat it as free audio?

Expected scope:

Small to medium.

## Current Recommendation

Move next to `Storage Meter and Backup Clarity`, unless WAV export reliability feels more urgent.

Reason:

Track type enforcement already exists. The next user-facing risk is that people may trust browser/PWA storage more than they should. A visible storage meter plus clearer backup language will make the new audio storage foundation understandable and safer for beta users.
