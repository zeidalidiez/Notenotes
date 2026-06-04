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
3. Click `Check latest` and confirm GitHub comparison treats numeric patch versions correctly; for example, `0.1.105` must be newer than `0.1.99`, and `0.2.0` must be newer than any `0.1.x` build.
4. Turn on Debug logs if you are investigating a failure.
5. Make one small project with at least one MIDI track, one drum track, and one audio track.

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
- On iOS Safari, if pads stay silent until Mic In permission is granted, the first sound-producing gesture or the `Tap to allow iOS sound` prompt may show Safari's microphone permission dialog. Grant it, then confirm Notenotes immediately plays pads/keys/kit without starting an Audio In recording.
- The audio prompt remains visible until the iOS media route is primed; it should not disappear merely because `AudioContext.state` reports `running`.
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

### 1.3 Saved Output Volumes Apply On Wake

Steps:

1. Open Settings.
2. Set Master volume to 0 and Metronome volume to 0.
3. Reload the page.
4. Tap a Pads pad.
5. Turn Master volume up and tap the pad again.
6. Turn on the metronome and move Metronome volume from 0 upward.

Expected:

- The first pad tap after reload is silent while Master volume is still 0.
- Moving Master volume upward immediately restores instrument sound.
- The metronome stays silent while its volume is 0, then becomes audible as soon as the slider is raised.
- The sliders and live audio agree before and after the audio engine wakes.

### 1.4 Master Glue Live / Export Check

Steps:

1. Create a short MIDI snippet with a Modern preset and several medium-to-loud notes.
2. Play it live, then export the snippet as WAV.
3. Put the same snippet on Canvas with a panned MIDI track and export the Canvas as Stereo WAV.
4. Repeat once with a drum snippet.

Expected:

- Live playback and WAV exports have the same gentle output character: peaks feel controlled, not louder or obviously distorted.
- Stereo Canvas WAV still preserves track pan.
- Quiet notes and drum tails are still audible; the master stage should not act like a hard gate.
- Short notes speak promptly, while pad/keys releases feel smoother than an abrupt straight-line fade.

### 1.5 Pads Degree Labels

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

### 1.5b Degree Color Palettes

Steps:

1. Go to Pads in C Major, open Layout, and turn on Highlight scale degrees.
2. In the Palette picker, switch between Vivid, Color-blind safe, and Brightness ramp.
3. After each, look at the pads and the degree swatches.
4. Hand-edit one swatch with the color picker, then reload the project.
5. Open Piano and confirm degree colors match the chosen palette there too.

Expected:

- Each palette immediately recolors both the pads and the swatch row.
- Color-blind safe avoids hard red/green pairings; Brightness ramp gets steadily lighter from the root upward.
- A hand-edited swatch overrides just that degree and survives reload; the chosen palette is also remembered across reload.
- Pads and Piano agree on the degree colors.
- Existing projects with no palette set still show the original Vivid colors.

### 1.5 Scale Picker Families

Steps:

1. Open the top-bar Scale picker.
2. Confirm scales are grouped by family and can be searched by name, family, interval pattern, or alias.
3. Switch through one scale from each visible family.
4. Open Pads and confirm pad count follows the selected scale.
5. Switch to Chords mode on Hungarian Minor, Phrygian Dominant, and Hirajoshi.
6. Open AI Seed on Pads and generate a short mock sequence.

Expected:

- The picker opens as a categorized panel instead of a long native dropdown.
- The picker groups Western, Pentatonic / East Asian, Hungarian / Klezmer, Maqam-inspired, and Raga-inspired scale entries.
- Long scale names do not overflow the top bar; the selected scale label truncates cleanly if space is tight.
- New scales load without resetting the project root.
- Pentatonic scales show five pads without Extensions and ten pads with Extensions.
- Seven-note scales show seven pads without Extensions and thirteen pads with Extensions.
- Chords mode shows named curated chord pads for scales that need them instead of numbered degree-triad pads.
- Extensions is hidden in Chords mode when the selected scale uses curated chord pads.
- AI Seed still generates valid pad indexes for the selected scale.

### 1.6 Pads Compass Mode

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

### 1.7 Patch Picker

Steps:

1. Go to Pads or Piano.
2. Open the Patch picker.
3. Search for `Modern`, choose Modern Keys, then play a note.
4. Reopen the picker, switch to Chip presets, choose Chip Bass, then play a note.
5. If a custom patch instrument exists, confirm it appears under Custom instruments.
6. Switch to Kit and confirm the Patch picker is hidden while Kit's own selector remains available.

Expected:

- Patch selection opens as a categorized searchable panel, not a long native dropdown.
- Chip, Modern, and Custom instruments are separated into clear groups.
- Selecting a patch updates the toolbar label and changes the live synth sound.
- Long custom instrument names truncate cleanly in the toolbar instead of stretching it.
- Kit mode keeps its kit-specific selector and does not show the synth Patch picker.

### 1.8 Tone Preset Picker

Steps:

1. Open Tone from Pads or Piano.
2. Move a few Tone sliders, name the preset, and Save as new.
3. Open the Tone preset picker, search for the preset, select it, then Apply.
4. Rename the preset by changing the name field and pressing Save.
5. Switch to Kit, open Tone, and confirm the same picker can apply the saved preset.
6. Select a MIDI or drum clip on Canvas, choose the same Tone preset from the Canvas picker, and Apply to Clip.

Expected:

- Tone presets use a searchable picker instead of a long native dropdown in Create, Kit, and Canvas.
- The selected preset name appears in the Tone panel after choosing it.
- Apply, Delete, Save, Save as new, and Reset still work.
- Canvas disables the Tone preset picker for audio clips and empty selection.

### 1.8 Picker Close Behavior

Steps:

1. Open the Scale, Patch, Tone preset, and Canvas track instrument pickers.
2. Close each picker by clicking outside it.
3. Reopen each picker and close it with Escape.
4. Reopen each picker and close it by selecting an item.

Expected:

- Pickers do not show a visible X/close button.
- Outside-click, Escape, and item selection all close the picker.
- Closing a picker without selecting does not change the current value.

### 1.9 Accessibility Profiles

Steps:

1. Open the app with `?tremor=1`.
2. Open Settings > Accessibility and confirm Tremor Filter is enabled.
3. On Pads, Piano, and Kit, rapidly retrigger the same target and confirm obvious double-bounces are ignored.
4. Open the app with `?dwell=1`.
5. Open Settings > Accessibility and confirm Dwell Play is enabled with the default timer.
6. Hover over a Pads target, a Piano key, and a Kit pad until the dwell fill completes.
7. Adjust the dwell time slider and retry one target.

Expected:

- URL profiles persist into project settings and can be turned off.
- Tremor Filter only suppresses repeated hits on the same target, not normal movement across different targets.
- Dwell Play fires large playable targets after the configured dwell time.
- Pads and Piano release when the pointer leaves after a dwell-triggered note; Kit fires once.

### 1.10 Keyboard And MIDI Performance Input

Steps:

1. Open Create > Pads.
2. Press keys across `1-=`, `Q-]`, `A-'`, and `Z-/`.
3. Confirm `1` plays pad 1, `2` plays pad 2, and `Q` continues after the number row on extended Pad layouts.
4. Switch to Piano and confirm `1` plays the highest visible key and later keys move downward through visible keys.
5. Switch to Kit and confirm the same keyboard rows trigger visible kit pads in pad order.
6. While viewing Piano, hold `M` and `R` as performance keys.
7. Confirm `M` does not toggle the metronome and `R` does not start recording. Space and Enter should still control transport.
8. In the top bar, leave Correction set to Off and confirm Piano can play out-of-key black keys normally.
9. Set Correction to Closest in C Major. Press C# on Piano and confirm D sounds/records; set Up and Down and confirm C# resolves to D and C respectively.
10. Connect a MIDI keyboard in a browser that supports Web MIDI.
11. Play MIDI notes while viewing Pads, Piano, and Kit. In Piano, repeat the Correction checks with external MIDI note C#.
12. Switch between Pads, Piano, Kit, and Controller while holding a keyboard or MIDI note.
13. Return to Pads, set Pad Mode to Step Play, and confirm the octave controls are hidden.
14. Open Edit Sequence, add notes from the note row, use the arrow buttons to move between octave rows, and save a short sequence.
15. Press the Step button, then press a few computer keyboard performance keys, then press a few MIDI notes.
16. Switch to a pentatonic scale, edit the Step Play sequence, use the right arrow to reach the next octave row, and add its first note.
17. Reopen Edit Sequence, click a sequence chip to remove it, then add it back.
18. Use a chip's Alt button, pick a different note from the note row, save, and step through the sequence twice.
19. Change the project key and scale, then return to Step Play.
20. Open Layout, enable Highlight scale degrees, return to Step Play, and reopen Edit Sequence.
21. Add and remove a few chips, press Undo, then tap outside the editor backdrop and press Escape.

Expected:

- Computer keyboard input plays the active Create surface instead of only triggering global shortcuts.
- Pads and Piano keyboard notes hold until keyup; Kit hits fire immediately.
- Kit pads show the keyboard key that triggers each visible pad.
- MIDI notes route through the active surface: nearest visible Pads target, exact Piano MIDI, and Kit drum mapping.
- Piano/MIDI Correction defaults to Off. Closest, Up, and Down affect only Piano and external MIDI routed to Piano; Pads, Kit, and exact controller note bindings keep their own behavior.
- Held keyboard, MIDI, and controller notes release cleanly when switching surfaces; no stuck notes remain.
- Step Play uses chips in the modal instead of manual text entry; clicking a sequence chip removes it.
- Step Play's editor note row moves through app octaves 1-6 only. It should never show extremely high note names such as D10, D11, or D12.
- Step Play chips and editor note buttons use the same degree colors as Pads when Highlight scale degrees is enabled.
- Undo restores recent editor chip changes. Outside taps and Escape do not close the editor; Save or Cancel is required.
- Step Play advances one note per Step button press, keyboard keydown, or MIDI note-on, resolves picked degrees into fixed saved MIDI notes, and records the user's timing when recording is armed.
- Changing key, scale, or Pad octave after saving Step Play does not change the saved notes. Notes outside the current scale continue playing and show a red `OUT` badge with a black outline.
- A step with an alternate plays the normal note on the first pass through the sequence, the alternate note on the second pass, and alternates on later passes.
- Global pitch/mod digit shortcuts still work when the active Create surface does not claim that key.

### 1.11 Stage Visual Layer

Steps:

1. Open Create > Pads and click Stage.
2. Play several pads, including held notes and quick taps.
3. Switch to Piano, open Stage, and play visible keys.
4. Set Piano to its maximum key count, reopen Stage, and confirm each visible key gets a distinct lane/pill instead of sharing with another key.
5. Switch to Kit, open Stage, and hit several drum pads.
6. In Kit Stage, switch between Trace, Thread, Pulse, Halo, and Pocket while hitting Kick, Snare, Hi-hat, and Shaker.
7. On a phone-width viewport, confirm Kit Stage lane pills use short readable labels and do not overlap.
8. Create a MIDI snippet, a drum snippet, and an Audio In snippet, then place them on separate Canvas tracks with different track colors.
9. Open Canvas and click Stage.
10. Press Play and watch the Canvas Stage lanes while clips pass the playhead.
11. Close Stage and confirm normal app controls are usable again.
12. With many held notes or a dense Canvas arrangement, confirm Stage remains responsive and glow/detail pull back rather than stuttering badly.
13. If the browser/OS reduced-motion setting is enabled, reopen Stage and confirm trails/glow are visibly calmer.

Expected:

- Stage opens as a full-screen visual layer with a labeled Close Stage button, not a small corner X.
- Create Stage shows lane activity while playing, whether or not recording is armed.
- On mobile/touch, the Stage lane pill strip plays the active surface even when no controller is connected.
- Pads/Piano lanes use degree colors when degree highlighting is enabled; otherwise they use the surface fallback colors.
- Kit hits appear as short lane bursts.
- Kit does not show the generic Patch toolbar above its own Kit toolbar.
- Kit Thread uses the full vertical field rather than bunching all hits at the bottom.
- Kit Halo reacts to drum hits even though drum recording/export still stores drum hit types, not melodic notes.
- Pocket shows hits as timing pips and held notes as arcs around the current pulse clock. Holding a pad/key should visibly grow the arc instead of leaving a fixed sliver. Kit patterns should read as repeated clock placements, not as random lane flashes.
- Canvas Stage uses a horizontal track map rather than the Create highway.
- Canvas Stage respects muted/soloed tracks, caps to the audible lane set, keeps track colors, and shows audio clips as sustained blocks instead of omitting them.
- Multiple notes or drum sounds inside the same Canvas track appear on separate internal sublanes. A chord should not collapse into one undifferentiated block.
- MIDI labels in Canvas Stage show real note names, not `undefined`.
- Dense Stage scenes reduce expensive glow/trail detail before audio or input behavior is affected.
- Reduced-motion environments keep Stage readable with shorter trails and less glow.
- Stage does not start, stop, or alter audio playback. It only mirrors input and transport state.

### 1.12 Mobile Create Layout

Steps:

1. Open Create on an iPhone 15-width viewport.
2. Confirm the Patch picker gets a full-width readable row, with Create/Edit Instrument, Tone, AI, Controller, Layout, and Stage arranged as compact action buttons below it.
3. Open Pads, enable Extensions, and confirm all 13 pads can be reached without the snippets tray permanently hiding the final row.
4. Drag vertically inside the pad grid and horizontally through the instrument tabs/snippet tray.
5. Open Tone, AI, Controller, Layout, Stage, and Create/Edit Instrument from the mobile action row.

Expected:

- No Create toolbar action balloons into a full-width accidental button while another action is clipped.
- Pad Mode gets a readable row, while octave and Extensions share the next mobile control row cleanly.
- Pad hotkey badges remain hidden on phone layouts.
- Mobile toolbar panels open as modal-style overlays instead of pushing the page down.
- Dragging inside scrollable mobile areas scrolls the intended area instead of immediately activating unrelated controls.

## 2. Audio In Recording

### 2.1 Audio In Creates A Snippet

Steps:

1. Go to Audio In.
2. Select the intended input device if more than one exists.
3. Set Channels to `Auto`.
4. Press record.
5. Speak or make a short sound.
6. Stop recording.
7. Repeat with Channels set to `Mono`.
8. If the browser/device allows it, repeat with Channels set to `Stereo`.

Expected:

- The input meter moves while recording.
- A new audio snippet appears in the snippet tray.
- A toast confirms the audio snippet was captured.
- Mono/Stereo are treated as capture preferences; if a browser falls back to one channel, recording still succeeds.
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
4. Export Snippet WAV with `Auto`.
5. Export Snippet WAV again with `Mono`.
6. Export Snippet WAV again with `Stereo`.
7. Play the exported WAV files.

Expected:

- WAV export succeeds.
- The exported WAV contains the recorded sound.
- Auto keeps the source's natural channel shape where the browser captured one.
- Mono and Stereo force the expected centered mono or two-channel file.
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

### 3.3 Mobile Canvas Touch

Steps:

1. On iPhone 15 or mobile emulation, place several snippets in the Canvas snippet dock.
2. Drag horizontally across the snippet dock.
3. Drag one dock snippet upward into a matching track.
4. Touch and drag an already-placed Canvas clip left/right.
5. Drag empty timeline space left/right and up/down.
6. Long-press an already-placed Canvas clip, cancel the delete prompt, then long-press again and confirm.
7. Tap a track delete button and cancel the confirmation.
8. Tap it again and confirm.

Expected:

- The dock scrolls horizontally without accidentally starting a drag.
- Dragging upward from a dock snippet still places the clip on a matching track.
- Existing Canvas clips move when held and dragged.
- Empty Canvas space pans the timeline without needing a scrollbar.
- Long-pressing a placed clip gives mobile users a delete path.
- Track delete buttons are visible on mobile and require one clear confirmation.

### 3.4 Canvas WAV With Mixed Tracks

Steps:

1. Place one MIDI clip, one drum clip, and one audio clip on matching tracks.
2. Put at least one clip after bar 1.
3. Set the MIDI track pan hard left, the drum track pan hard right, and leave the audio track centered.
4. Press Play and listen on headphones or speakers with stereo separation.
5. Open Settings, then Export.
6. Export Canvas WAV with `Stereo (pan)`.
7. Play the exported WAV.
8. Export Canvas WAV again with `Mono`.
9. Play the second exported WAV.

Expected:

- WAV export succeeds.
- MIDI, drum, and audio content are audible.
- Clips placed after bar 1 are heard at the correct time.
- Track pan is audible in live Canvas playback and the stereo exported WAV.
- The mono exported WAV is centered and still contains all audible clips.
- MIDI export is not expected to preserve pan yet; this check is Canvas playback/WAV only.

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

### 4.4 Sheet Music Preview Has No Parser Errors

Steps:

1. Create or load a MIDI snippet.
2. Open Settings, then Export.
3. Select the snippet in Sheet Music.
4. Export SVG and ABC.

Expected:

- The preview renders notation instead of red parser text such as `pitch is undefined`.
- SVG export does not include parser error text.
- ABC export contains note/rest text only, not abcjs error output.

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

### 5.3 Tap Tempo

Steps:

1. In the top transport bar, note the BPM value.
2. Tap the **Tap** button roughly four times at a steady, moderate beat.
3. Watch the BPM field while tapping.
4. Stop, wait a few seconds, then tap a clearly slower beat several times.
5. On a phone-width viewport, confirm the Tap button is still reachable next to the BPM button.

Expected:

- After the second tap, the BPM updates to match your tapping speed and keeps tracking as you continue.
- The Tap button gives a brief visual pulse on each tap.
- Faster tapping raises the BPM and slower tapping lowers it, clamped to the 40–240 range.
- After a long pause, the next taps start a fresh tempo instead of blending with the old one.
- The chosen BPM persists after reload (it is saved with the project, like the number input).

### 5.4 Drone Mode

Steps:

1. In Create, set the project key to C Major.
2. Click the **Drone** toggle in the top bar.
3. Listen, then play some pads over the held drone.
4. Change the project key (e.g. to G), then to a different scale.
5. Click **Drone** again to turn it off.
6. Arm recording, play a short phrase with the drone on, stop, and inspect the snippet.

Expected:

- Turning Drone on sustains a low root note (C in C Major) and the button shows an active state.
- Pads/keys still play normally on top of the held drone.
- Changing the key re-pitches the drone to the new root without an audible click or gap; changing scale keeps the root anchor.
- Turning Drone off stops the held note immediately.
- The recorded snippet contains only the notes you played — the drone is a live anchor and is not recorded or exported.

## 6. Backups And Restore

### 6.0 Storage Status

Steps:

1. Open Settings, then Save.
2. Check the Storage group.
3. Save a workspace backup.
4. Make a small edit, such as renaming the project or adding a snippet.
5. Return to Settings, then Save.
6. Click Check Storage Health.

Expected:

- Browser storage shows Persistent, Best effort, Unknown, or an honest failure state.
- Storage Health reports the number of audio clips, custom samples, referenced audio assets, orphaned local audio assets, and whether any audio is missing.
- Storage Health does not delete or repair anything just by running the check.
- Workspace backup status says there is no workspace backup before the first backup.
- The top backup status shortcut opens Settings directly to the Save tab.
- After saving a workspace backup, the status shows the latest backup time.
- The top backup status shortcut changes to the backed-up state after saving a workspace backup.
- After a later edit, the status says the workspace changed since the last backup.
- The top backup status shortcut changes to a due/no-backup state after a later edit.
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

### 6.5 Local Backup Folder

Steps:

1. Use desktop Chrome or Edge.
2. Open Settings, then Save.
3. Click Connect Folder and pick a real folder.
4. Click Save To Folder.
5. Check the selected folder on disk.
6. Make a small edit after the manual folder save.
7. Wait about 10 seconds, or leave the tab to trigger the visibility backup path.
8. Check the selected folder again.
9. Disconnect the folder.

Expected:

- Unsupported browsers show folder backup as unavailable and leave the manual Save Backup path usable.
- The connected folder status shows the folder name when permission is available.
- The top backup shortcut turns blue and says `Auto backup` when the connected folder permission is granted.
- After a browser reload, if Chrome keeps the folder handle but drops write permission, the top backup shortcut says `Grant folder`, requests folder access when clicked, then opens Save.
- If permission is restored from the top shortcut, a current-workspace folder backup is written immediately and the shortcut returns to blue `Auto backup`.
- The Save folder row says auto folder backups are active when permission is granted and shows the last workspace backup age when one exists.
- Save To Folder writes a timestamped workspace JSON backup into the selected folder.
- After later edits, a connected folder with granted permission receives a current-workspace backup automatically within about 10 seconds when no cooldown is active, or within about 1 minute of the previous folder backup.
- Auto folder backup does not open permission prompts. If permission is no longer granted, it silently skips until the user uses Save To Folder or reconnects.
- The normal backup status updates after the folder save.
- Disconnect removes the app connection but does not delete any backup files.

### 6.6 Newer Backup Rejection

Steps:

1. Use a JSON backup from a newer app version, or manually duplicate a backup and change `appVersion` to a clearly newer value such as `99.0.0`.
2. Try importing it.

Expected:

- Import is rejected with a clear message that a newer Notenotes version is needed.
- Existing project data is not changed.

### 6.7 Inspect Audio Creation Flow

Steps:

1. Create or load an audio recording.
2. Open it in Inspect.
3. Click New MIDI.
4. Return to the audio recording in the Load dropdown.
5. Click New Drum.

Expected:

- Audio Inspect uses the same toolbar order and styling as MIDI/drum Inspect.
- Audio-only unavailable tools such as Grid, Shadow, Velocity, Split, Quantize all, and Delete are visible but disabled.
- New MIDI creates a blank MIDI clip and loads it in Inspect.
- New Drum creates a blank drum clip and loads it in Inspect.
- The original audio recording remains available in the Load dropdown.
- The snippet tray updates without needing a reload.

### 6.8 Inspect Fit Rhythm

Steps:

1. Record or create a MIDI snippet with at least three unevenly timed notes.
2. Open it in Inspect and click Fit Rhythm.
3. Set Fit to `1 bar`, Grid to `1/8`, leave Even spacing off, and move the slider near Keep my feel. Click Preview.
4. Change the slider toward Make it clean and click Preview again.
5. Click Cancel and confirm the original timing returns.
6. Open Fit Rhythm again, enable Even spacing, click Preview, then Apply.
7. Undo the edit.
8. Repeat the basic Preview/Apply flow with a drum snippet.

Expected:

- Fit Rhythm is available for MIDI and drum snippets, not audio snippets.
- Preview redraws the piano roll/drum grid without committing an undo entry.
- Cancel restores the original timing.
- Apply preserves event count, order, pitch/drum type, velocity, and Tone metadata while changing only timing and optional note lengths.
- Even spacing distributes events evenly inside the selected target length.
- After applying to `1 bar`, the Inspect ruler/grid shows the fitted snippet length instead of several empty bars.
- Undo restores the pre-fit snippet.

### 6.9 Meter Top-Bar Phase 1

Steps:

1. Load an existing project that was saved before the top-bar meter selector.
2. Confirm the top bar shows meter next to key and scale.
3. Switch between 2/4, 3/4, 4/4, and 5/4 from the top bar.
4. Open Settings.
5. Place clips on the Canvas before and after a meter change.
6. Save, reload, and confirm the selected meter is still shown.

Expected:

- Old projects load with their original meter.
- Settings no longer has a duplicate Time Signature selector.
- The beat dots and Canvas ruler update to the selected meter.
- Existing Canvas clips keep their absolute tick positions when the meter changes.
- Reload preserves both `project.meter` and legacy `project.timeSignature` behavior.

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

### 7.4 Tone Badges Stay Visible

Steps:

1. Record a MIDI or drum snippet while all six Tone effects have non-zero amounts.
2. Check the snippet tray before dragging the snippet to Canvas.
3. Drag the snippet to Canvas.
4. Open the snippet or placed clip in Inspect.
5. Apply a different six-effect Tone preset directly to the Canvas clip and re-check Canvas and Inspect.

Expected:

- The snippet tray shows Tone badges for every active effect.
- Canvas clips show all active Tone badges, not just the first three.
- Inspect shows the same Tone badges in the toolbar for the loaded snippet or clip.
- Clip-level Tone overrides are reflected in Canvas and Inspect without changing unrelated snippets.

### 7.5 Drive And Noise Stay Usable Together

Steps:

1. Go to Pads or Piano.
2. Open Tone.
3. Set Drive and Noise to moderate and then high values.
4. Try the same Tone settings on Kit.
5. Export a short WAV with the same Tone settings.

Expected:

- Noise adds texture but does not explode into constant static as Drive increases.
- Live playback and WAV export both keep the reduced-noise behavior.

### 7.6 Drum Noise Shaping

Steps:

1. Go to Kit.
2. Tap Snare, Clap, Hi-hat, Rim, and Shaker in the Classic kit.
3. Switch to 808, Electronic, and Acoustic and repeat.
4. Record a short drum snippet with Snare, Hi-hat, and Clap.
5. Export the snippet as WAV.

Expected:

- Noise-based drums still sound synthetic and responsive, but less like raw white noise.
- Snare and Clap keep body; Hi-hat and Shaker stay bright without turning into static.
- The exported WAV has the same general drum character as live playback.

### 7.7 Modern Presets Sound Fuller But Still Speak On Short Taps

Steps:

1. Select Soft Pad, Shimmer Lead, Lo-fi Keys, Warm Bass, Organ, and Modern Pad.
2. Tap short notes on Pads and Piano.
3. Hold longer notes to confirm the smoother modern character still exists.
4. Export a short WAV from at least one older Modern preset such as Soft Pad or Organ.
5. If a velocity-sensitive MIDI keyboard is available, play the same Modern preset softly and hard.
6. Listen on headphones and compare a Modern preset to a Chip preset.

Expected:

- Short taps produce audible sound.
- Held notes feel fuller than chip presets, with mild width/motion instead of a bone-dry single oscillator.
- Harder MIDI notes are a little brighter/more present; QWERTY and pad taps still behave as before.
- Modern presets have tasteful stereo width live and in WAV export; Chip presets remain focused and centered.
- WAV export sounds recognizably like the selected Modern preset.

## 8. Controller

### 8.0 Controller Mapper Bindings

Steps:

1. Open the Controller mapper.
2. Hold a bindable gamepad button and press Set.
3. Click a Pads target.
4. Open List Current Bindings.
5. Switch Pads to Custom, set one pad to Chord, and bind that pad too.
6. Bind one Piano key and one Kit pad.
7. Try holding LB, LT, RB, and RT in the mapper.

Expected:

- The mapper stays open after Set long enough for the next Pads/Piano/Kit click to bind.
- LB, LT, RB, and RT are not offered as bindable buttons; they are reserved for held modifiers.
- Pads bindings show as Pads/Chord/Root targets, not just fixed note names.
- Pads bindings keep the learned action. A button learned from Single stays a single note after switching Pads to Chords.
- A binding learned from a pad that no longer exists shows a clear toast instead of silently doing nothing.
- A learned Custom chord pad plays as a chord from the controller.
- Piano bindings still play exact notes.
- Piano bindings light visible keys while they are held.
- Kit bindings still play exact drum sounds.
- Save Current creates a named controller preset, Load restores it, and Delete removes it.

### 8.1 Held Modifiers On Pads And Piano

Steps:

1. Go to Labs.
2. Assign LT to Triad and RT to 7th chord.
3. Go to Pads in Single mode.
4. Hold LT and strike an unbound fallback controller button.
5. Hold RT and strike the same button.
6. Bind a Piano key in the Controller mapper, then hold LT and press that learned button.

Expected:

- The modifier behavior only applies when the shoulder/trigger is held before striking the note.
- LT turns the single note into a triad; RT turns it into a four-note seventh chord.
- Learned Piano note bindings also expand through the held modifier.
- The active modifier indicator matches the held slot.

### 8.2 Extended Modifier Choices

Steps:

1. In Labs, assign each slot a different choice: Sus2, Sus4, Power, and 9th.
2. Hold each slot one at a time and press a learned Pads or Piano button.
3. Switch key/scale and repeat with a fallback Pads button.

Expected:

- Sus2, Sus4, and Power use their interval shapes from the struck note.
- 9th and other extended choices follow the current scale when the struck note is in-scale.
- If the struck Piano note is out of the scale, the modifier still plays a sensible interval fallback instead of failing.

### 8.3 Tone Is Not A Controller Modifier

Steps:

1. Open Labs.
2. Open all four modifier dropdowns.
3. Record a MIDI snippet while holding a modifier on some notes.
4. Export the snippet as MIDI.

Expected:

- Tone traits such as Drive, Echo, Space, and Noise are not present in the modifier dropdowns.
- Recorded controller modifiers become normal MIDI notes/chords, not effect hotswitch metadata.
- Drum bindings ignore note modifiers and still trigger the exact drum sound.

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

### 9.3 Mobile Create Layout

Steps:

1. On iPhone 15, open Create > Pads.
2. Tap the BPM value in the transport, change it with the modal +/- buttons, and save.
3. Drag horizontally across the instrument tab row.
4. Drag horizontally across the Patch/Tone/AI/Controller/Layout row.
5. Open the Patch picker or Scale picker and drag vertically through its list before choosing an item.
6. Enable Extensions and confirm Pad Mode, Octave, and Extensions share the control area without Extensions taking a full row by itself.
7. Tap the Snippets header/count to collapse and expand the snippet tray.

Expected:

- BPM is readable as a touch target and opens a modal editor instead of relying on tiny number steppers.
- Horizontal dragging scrolls the instrument and toolbar rows without immediately firing the first touched button.
- Picker lists scroll with finger drags and only select on a deliberate tap.
- Mobile control buttons stay compact; action buttons should not stretch into giant blocks.
- Keyboard hotkey hint labels are hidden on phone layouts.

### 9.4 Mobile Create Toolbar Panels

Steps:

1. On iPhone 15 or mobile emulation, open Create > Pads.
2. Tap Create Instrument, Tone, AI, Controller, and Layout one at a time.
3. Scroll inside any panel that is taller than the viewport.
4. Close each panel by tapping outside or using its own action flow.

Expected:

- Each toolbar panel opens as a fixed viewport modal instead of pushing the page downward.
- Panels stay above the Create toolbar and remain visible within the iOS browser viewport.
- Tone and Layout controls can be adjusted without horizontal toolbar scrolling interfering.
- The snippet tray collapses to its header/count and expands again without losing snippets.
- Patch, Pad Mode, and the main pad grid remain usable without pinch-zooming.

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

### 11.0 Automated Pure Smoke

Steps:

1. Run `npm run test:smoke`.

Expected:

- Meter math, backup validation, and pure storage-audit tests pass.
- These tests do not require a browser, Web Audio, IndexedDB, or network access.

### 11.1 Manual App Smoke

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

## 12. Meter And Settings

### 12.1 Settings Beat Colors Stay In Sync

Steps:

1. Open Settings.
2. Leave Settings open on the Settings tab.
3. Change the top-bar Meter dropdown to `6/8`.
4. Look at Time Signature Visualizer -> Beat Colors.
5. Change Meter to `9/8`, then `12/8`, then back to `4/4`.

Expected:

- `6/8` shows 2 beat color pickers.
- `9/8` shows 3 beat color pickers.
- `12/8` shows 4 beat color pickers.
- `4/4` shows 4 beat color pickers.
- Settings does not need to be closed and reopened for this to update.

### 12.2 Settings No Longer Owns Transport Controls

Steps:

1. Open Settings.
2. Review the Project, Metronome, Master, and Time Signature Visualizer sections.

Expected:

- BPM is not editable in Settings. BPM lives in the top transport bar.
- Drum pad count is not editable in Settings. Drum layout controls live in the Create layout panel.
- Time signature is not editable in Settings. Meter lives in the top transport bar.

### 12.3 Compound Meter Pulse Behavior

Use a phone stopwatch or wall clock with second precision. Tolerance: +/-0.3 seconds for a 4-bar run. Anything +/-0.5 seconds or more is real drift.

Steps:

1. Open a fresh project.
2. Use the BPM input to set BPM. Use the top-bar Meter dropdown to set meter.
3. Turn on the metronome.
4. Press Play. Start the stopwatch when the playhead crosses bar 1.
5. Stop the stopwatch when the playhead crosses the start of bar 5 after 4 full bars have played.
6. Compare to the expected duration in the table.

Expected 4-bar wall-clock time:

| Meter | 60 BPM | 120 BPM | 240 BPM | Pulses/bar |
|---|---:|---:|---:|---:|
| `2/4` | 8.0 s | 4.0 s | 2.0 s | 2 |
| `3/4` | 12.0 s | 6.0 s | 3.0 s | 3 |
| `4/4` | 16.0 s | 8.0 s | 4.0 s | 4 |
| `5/4` | 20.0 s | 10.0 s | 5.0 s | 5 |
| `6/8` | 8.0 s | 4.0 s | 2.0 s | 2 |
| `9/8` | 12.0 s | 6.0 s | 3.0 s | 3 |
| `12/8` | 16.0 s | 8.0 s | 4.0 s | 4 |
| `5/8` | 8.0 s | 4.0 s | 2.0 s | 2 |
| `7/8` | 12.0 s | 6.0 s | 3.0 s | 3 |

Pair-up invariant:

- At any BPM, `2/4` and `6/8` must match each other.
- At any BPM, `2/4` and `5/8` must match each other.
- At any BPM, `3/4` and `9/8` must match each other.
- At any BPM, `3/4` and `7/8` must match each other.
- At any BPM, `4/4` and `12/8` must match each other.

Linearity invariant:

- Bar duration at 60 BPM divided by bar duration at 120 BPM should be 2.0 within +/-5%.
- Bar duration at 120 BPM divided by bar duration at 240 BPM should be 2.0 within +/-5%.
- Canvas ruler and lane grid show the big pulses with faint sub-beat divisions.
- Beat dots match the felt pulse count for each meter.
- `5/8` exposes grouping choices `2+3` and `3+2`; switching grouping changes the ruler/grid accents but does not move clips.
- `7/8` exposes grouping choices `2+2+3`, `2+3+2`, and `3+2+2`; switching grouping changes the ruler/grid accents but does not move clips.

Cross-check:

1. In `6/8` at `120 BPM`, record an 8-bar MIDI snippet.
2. Export that snippet as MIDI and WAV.
3. Compare the live playback duration to both exports.

Expected:

- MIDI and WAV export duration match live playback closely enough that no tempo difference is audible.
- If either export plays noticeably faster or slower than live playback, compound meter tempo parity is broken.

### 12.4 Diagnostics Panel (Developer)

Steps:

1. Open the app with `?debug=1` appended to the URL.
2. Open Settings.
3. Confirm the Diagnostics tab is visible.
4. Open Diagnostics.
5. Confirm Live Timing readouts are populated.
6. Change BPM and Meter in the top bar.
7. Click Check meter math.
8. Click Check meter matrix.
9. Click Measure live tempo.
10. Remove `?debug=1`, reload, and open Settings.

Expected:

- Diagnostics appears only with `?debug=1`.
- Live Timing numbers match the top bar and update without starting playback.
- Check meter math reports PASS for supported meters.
- Check meter matrix reports PASS for all supported meter/BPM cells, pair-up checks, and linearity checks.
- Measure live tempo starts an isolated silent transport, reports expected vs measured duration, and does not start the app's active transport, play clips, play the metronome, or mutate the current project.
- In `5/8`, `2+3` should report alternating short-long pulse gaps and `3+2` should report long-short pulse gaps. Pair-up checks mean total bar duration only, not identical pulse feel.

### 12.5 Canvas Time Scale

Steps:

1. Record or create a short MIDI clip with at least two notes.
2. Drag it onto a MIDI Canvas track.
3. Add a second clip later on the same track.
4. Click **Time**, then click the first clip.
5. Choose **Half-time**.
6. Play the Canvas, export Canvas WAV, and export Canvas MIDI.
7. Undo, then repeat with **Double-time**.
8. Repeat once with an audio clip.

Expected:

- The first clip start does not move.
- Half-time doubles the clip's visible length and pushes later clips on that track to the right.
- Double-time shortens the clip without pulling later clips left.
- The original snippet in Inspect is unchanged.
- A Time badge appears on scaled clips.
- Live playback, WAV export, MIDI export, and Canvas Stage all use the scaled timing.
- Audio clips use tape-style speed: half-time is lower/slower, double-time is higher/faster.
- `Alt+drag` no longer resizes Canvas clips.
