# Manual QA

Use this file as the beta hardening pass for Notenotes. The goal is not to test every possible musical idea. The goal is to prove that a user can make work, save it, export it, reload it, and recover it without surprises.

For each test, write down:

- Device and browser.
- App version from Settings.
- Pass or fail.
- Any console errors, especially when Debug logs are enabled.

Recommended devices:

- Desktop Chrome.
- iPhone 15 Chrome.
- iPhone 15 Safari, if available.

Before starting:

1. Open Settings.
2. Confirm the app version is visible.
3. Turn on Debug logs if you are investigating a failure.
4. Make one small project with at least one MIDI track, one drum track, and one audio track.

## 1. Fresh Load And Audio Wake

### 1.1 First Pad Starts Audio

Steps:

1. Fresh-load the app.
2. Do not tap Audio In.
3. Go to Pads.
4. Tap a visible pad.
5. Go to Piano and tap a visible key.
6. Go to Kit and tap a drum pad.

Expected:

- Sound plays from the first instrument interaction.
- No Audio In interaction is required to wake the engine.
- No console error appears.

### 1.2 Reload Keeps Audio Usable

Steps:

1. Reload the page.
2. Tap a Pads pad.
3. Tap Play on the transport.
4. Stop playback.

Expected:

- The pad makes sound.
- Transport controls still respond normally.

### 1.3 Pads Degree Labels

Steps:

1. Go to Pads.
2. Open Layout and turn on Show degree labels. Leave Highlight scale degrees off.
3. Set the project key to C and scale to Major.
4. Switch to Pentatonic, Minor, Blues, and Chromatic.
5. Go to Piano with degree labels still enabled.

Expected:

- C Major Pads show Tonic, Supertonic, Mediant, Subdominant, Dominant, Submediant, and Leading Tone.
- Pentatonic pad 4 says Dominant and pad 5 says Submediant.
- Minor pad 3 says Mediant and pad 7 says Subtonic.
- Blues pad 4 says Tritone.
- Chromatic shows function labels for all 12 pads. Lowered Supertonic may truncate visually, but the tooltip or accessibility label still has the full text.
- Piano keeps compact shorthand labels such as Root, b3, 5, and b7.

### 1.4 Pads Compass Mode

Steps:

1. Go to Pads.
2. Set the project key to C and scale to Major.
3. Change Pad Mode to Compass.
4. Press the outer C segment, then the inner C-position segment.
5. Change the project key to G.
6. Record a short Compass chord snippet.

Expected:

- C is at the top of the circle in C Major.
- The outer C segment plays C major.
- The inner C-position segment plays A minor.
- The major-key arc highlights the home chord family around C, F, G and their relative minors.
- Changing project key to G rotates the circle so G is at the top.
- The recorded snippet contains simultaneous MIDI notes for the chord.

## 2. Audio In Recording

### 2.1 Audio In Creates A Snippet

Steps:

1. Go to Audio In.
2. Select the intended input device if more than one exists.
3. Press record.
4. Speak or make a short sound.
5. Stop recording.

Expected:

- The input meter moves while recording.
- A new audio snippet appears in the snippet tray.
- A toast confirms the audio snippet was captured.
- No "Blob/File data" IndexedDB error appears.

### 2.2 Audio In Survives Reload

Steps:

1. Record an Audio In snippet.
2. Reload the app.
3. Play the snippet or place it on an audio track and play the Canvas.

Expected:

- The recording is still available.
- The snippet plays after reload.
- No unavailable audio warning appears.

### 2.3 Audio In Exports As WAV

Steps:

1. Record an Audio In snippet.
2. Open Settings, then Export.
3. Select the audio snippet in Audio Export.
4. Export Snippet WAV.
5. Play the exported WAV file.

Expected:

- WAV export succeeds.
- The exported WAV contains the recorded sound.
- The clip does not become silent after export.

### 2.4 Audio In Playback Length Matches What You Recorded

Steps:

1. Record a short Audio In snippet with an obvious start and stop, such as one spoken sentence.
2. Place it on an audio track in Canvas.
3. Play the Canvas and export the Canvas WAV.
4. Listen to the in-app playback and the exported WAV.

Expected:

- The audible recording length feels like the clip you recorded.
- The start is not padded with surprise silence.
- The export does not cut off the end or add a long empty tail.
- This is a listening test. You are checking whether playback/export sounds like the recording you made, not measuring browser audio metadata.

## 3. Canvas Tracks And Clip Placement

### 3.1 Track Type Enforcement

Steps:

1. Create or confirm one MIDI track, one drum track, and one audio track.
2. Try dragging a MIDI snippet onto the drum track.
3. Try dragging a MIDI snippet onto the audio track.
4. Try dragging a drum snippet onto the MIDI track.
5. Try dragging an audio snippet onto the MIDI track.
6. Drag each snippet type onto its matching track type.

Expected:

- Mismatched snippets are rejected.
- Matching snippets can be placed.
- No bad clip is created on the wrong track type.

### 3.2 Audio Clip Placement And Playback

Steps:

1. Place an audio snippet after bar 1.
2. Press Play.
3. Watch the playhead and listen.

Expected:

- The audio clip plays at its visible Canvas position.
- The clip is not forced to bar 1.
- The playhead and sound feel aligned.

### 3.3 Canvas WAV With Mixed Tracks

Steps:

1. Place one MIDI clip, one drum clip, and one audio clip on matching tracks.
2. Put at least one clip after bar 1.
3. Open Settings, then Export.
4. Export Canvas WAV.
5. Play the exported WAV.

Expected:

- WAV export succeeds.
- MIDI, drum, and audio content are audible.
- Clips placed after bar 1 are heard at the correct time.

## 4. MIDI Export

### 4.1 Snippet MIDI Export

Steps:

1. Create a MIDI snippet with notes.
2. Open Settings, then Export.
3. Select the snippet in MIDI Export.
4. Export Snippet MIDI.

Expected:

- MIDI file downloads.
- Export does not allow an empty tempo-only file for an empty snippet.

### 4.2 Canvas MIDI Export

Steps:

1. Place MIDI and drum clips on the Canvas.
2. Open Settings, then Export.
3. Export Canvas MIDI.

Expected:

- MIDI file downloads.
- Audio tracks are skipped.
- MIDI and drum timing are preserved.

### 4.3 Muted And Soloed MIDI Export

Steps:

1. Place at least two MIDI or drum tracks with clips.
2. Mute one track and export Canvas MIDI.
3. Solo one track and export Canvas MIDI.

Expected:

- Muted tracks are not exported.
- When a track is soloed, only soloed tracks are exported.

## 5. Time Signatures

Run these tests in `2/4`, `3/4`, `4/4`, and `5/4`.

### 5.1 Beat Dots And Ruler

Steps:

1. Open Settings.
2. Change Time Signature.
3. Close Settings.
4. Check the beat dots near BPM.
5. Check the Canvas ruler.

Expected:

- Beat dot count matches the selected time signature.
- Canvas ruler labels match the selected meter.
- Existing clips keep their musical timing even if their visual bar length changes.

### 5.2 Canvas WAV In Each Time Signature

Steps:

1. Set a time signature.
2. Place a MIDI clip, drum clip, and audio clip.
3. Export Canvas WAV.
4. Repeat for each supported time signature.

Expected:

- WAV export succeeds in all supported time signatures.
- Clip timing is sensible in each meter.

## 6. Backups And Restore

### 6.0 Storage Status

Steps:

1. Open Settings, then Save.
2. Check the Storage group.
3. Save a workspace backup.
4. Make a small edit, such as renaming the project or adding a snippet.
5. Return to Settings, then Save.

Expected:

- Browser storage shows Persistent, Best effort, Unknown, or an honest failure state.
- Workspace backup status says there is no workspace backup before the first backup.
- After saving a workspace backup, the status shows the latest backup time.
- After a later edit, the status says the workspace changed since the last backup.
- The advice text does not imply browser storage is the same thing as an external backup file.

### 6.1 Workspace Backup

Steps:

1. Create a project with MIDI, drum, and audio snippets.
2. Place clips on the Canvas.
3. Open Settings, then Save.
4. Set backup contents to Current workspace.
5. Save Workspace Backup.
6. Import that backup.

Expected:

- Backup saves as JSON.
- Import restores the workspace.
- Audio snippets are still playable after reload.

### 6.2 Workspace Plus Milestones Backup

Steps:

1. Save a milestone.
2. Set backup contents to Workspace + milestones.
3. Save Workspace Backup.
4. Import that backup.
5. Open Settings, then Save.

Expected:

- The milestone is restored.
- Current project audio still plays.

### 6.3 Full Archive Backup

Steps:

1. Make enough changes to create version history.
2. Set backup contents to Full archive.
3. Save Workspace Backup.
4. Import that backup.
5. Open Settings, then Save.

Expected:

- Milestones and version history are restored.
- Audio snippets remain playable.
- Import does not create missing audio assets.

### 6.4 Snippet Backup

Steps:

1. Create MIDI, drum, and audio snippets.
2. Save Snippets Backup.
3. Import the snippets backup into a project.
4. Reload the app.

Expected:

- Imported snippets appear in the snippet tray.
- Imported audio snippets play after reload.
- Imported snippets get fresh IDs and do not overwrite existing snippets.

### 6.5 Newer Backup Rejection

Steps:

1. Use a JSON backup from a newer app version, or manually duplicate a backup and change `appVersion` to a clearly newer value such as `99.0.0`.
2. Try importing it.

Expected:

- Import is rejected with a clear message that a newer Notenotes version is needed.
- Existing project data is not changed.

## 7. Tone Presets And Clip Tone

### 7.1 Synth Tone Preset

Steps:

1. Go to Pads or Piano.
2. Open Tone.
3. Move one or more Tone sliders.
4. Save a preset.
5. Change the sliders.
6. Apply the saved preset.
7. Delete the preset.

Expected:

- Preset saves, applies, and deletes.
- Deleting asks for confirmation.
- Deleting the preset does not remove Tone already saved on clips or snippets.

### 7.2 Kit Tone Preset

Steps:

1. Go to Kit.
2. Open Tone.
3. Save, apply, overwrite, and delete a preset.

Expected:

- Kit uses the same preset list as synth Tone.
- Preset behavior matches the synth Tone panel.

### 7.3 Clip Tone Applies To WAV

Steps:

1. Place a MIDI or drum clip on Canvas.
2. Select the clip.
3. Apply a noticeable Tone preset to the clip.
4. Export Canvas WAV.
5. Listen to the export.

Expected:

- The exported WAV includes the clip Tone.
- Tone does not apply unexpectedly to unrelated clips.

### 7.4 Drive And Noise Stay Usable Together

Steps:

1. Go to Pads or Piano.
2. Open Tone.
3. Set Drive and Noise to moderate and then high values.
4. Try the same Tone settings on Kit.
5. Export a short WAV with the same Tone settings.

Expected:

- Noise adds texture but does not explode into constant static as Drive increases.
- Live playback and WAV export both keep the reduced-noise behavior.

### 7.5 Modern Presets Speak On Short Taps

Steps:

1. Select Soft Pad and Modern Pad.
2. Tap short notes on Pads and Piano.
3. Hold longer notes to confirm the smoother pad character still exists.

Expected:

- Short taps produce audible sound.
- Held notes still feel like modern/pad instruments rather than chip plucks.

## 8. Controller Triggers

### 8.1 Trigger Notes In Single Mode

Steps:

1. Go to Controller.
2. Assign LT or RT to a Trigger Note such as 7th or 9th.
3. Hold the trigger.
4. Strike a note.

Expected:

- The trigger note behavior only applies when the trigger is held before striking the note.
- The green trigger helper text matches the selected assignment.

### 8.2 Trigger Notes In Chord Mode

Steps:

1. Set Pads mode to Chord.
2. Assign a Trigger Note.
3. Hold the trigger.
4. Strike a chord pad.

Expected:

- The chord includes the selected trigger extension.
- Helper text explains that the trigger must be held before striking.

### 8.3 Tone Trigger Hotswitch Recording

Steps:

1. Assign LT or RT to a Tone effect.
2. Record a MIDI or drum snippet.
3. Play some notes without the trigger.
4. Hold the trigger and play some notes.
5. Stop recording.
6. Play back the snippet.

Expected:

- Only notes or hits played while the trigger was active have the trigger Tone.
- The trigger Tone does not smear across the whole clip.

## 9. Mobile Menu And Settings

### 9.1 More Menu Opens And Closes

Steps:

1. On iPhone 15, tap the `...` transport button.
2. Tap it again.

Expected:

- First tap opens the dropdown.
- Second tap closes the dropdown.

### 9.2 Settings And More Menu Do Not Overlap

Steps:

1. Tap `...`.
2. Tap Settings.
3. Tap `...` again.

Expected:

- Tapping Settings closes the dropdown and opens Settings.
- Tapping `...` while Settings is open closes Settings and opens the dropdown.
- The dropdown does not remain awkwardly open behind Settings.

## 10. Debug Logs

### 10.1 Debug Snapshot

Steps:

1. Open Settings.
2. Turn on Debug logs.
3. Open the browser console if available.
4. Close and reopen Settings.

Expected:

- Console prints `[Notenotes Debug]`.
- Snapshot includes app version, project counts, audio stats, storage estimate, and backup settings.
- Turning Debug logs off prints that debug logs were disabled.

## 11. General Smoke Test

Steps:

1. Create a MIDI snippet.
2. Create a drum snippet.
3. Create an Audio In snippet.
4. Place all three on Canvas.
5. Play Canvas.
6. Export Canvas WAV.
7. Save workspace backup.
8. Reload the app.
9. Play Canvas again.

Expected:

- No data disappears.
- No audio becomes unavailable.
- Export succeeds.
- App remains usable after reload.
