# Notenotes manual release QA

Use this checklist only for behavior that Node tests and a production build
cannot validate reliably. Record one result block per tested environment; an
unrecorded checklist is not evidence that a release was tested.

Before starting:

```bash
npm ci
npm test
npm run build
npm run preview
```

Use a disposable browser profile or export a workspace backup before destructive
restore tests.

## Result record

Copy this block into the release issue or pull request:

```text
App version / commit:
Date and tester:
Device and OS:
Browser and version:
Installed PWA or browser tab:
Input/output hardware:
Result: PASS / FAIL / BLOCKED
Failed check and evidence:
```

## Core browser smoke

- App reaches Inspect without a blank screen or error overlay.
- Create, Canvas, and Inspect switch without console errors.
- Refresh restores the same project and selected user settings.
- A new workspace can be created without contaminating the previous one.
- Settings opens and closes by button, overlay, and Escape; focus enters the
  dialog, stays inside it, returns to the opener, and never visits hidden modes.
- Keyboard-only navigation reaches every visible primary action with a visible
  focus indicator.
- Reduced-motion preference removes or reduces nonessential movement.

## Audio and Create

- The first deliberate pad/key press enables audio and produces one sound.
- Master and metronome volume, including zero, survive refresh.
- Record a MIDI phrase with different velocities; playback keeps timing, pitch,
  patch, velocity, and Tone behavior.
- Record a drum phrase; playback keeps hit choice, timing, velocity, and kit.
- Switch Pads, Piano, Kit, Audio In, and Labs; only the visible instrument is in
  the keyboard tab order.
- Computer keyboard input follows the active surface and does not double-trigger.
- Hold/Arpeggio, Step Play, chord glow, correction, and Height Velocity can each
  be enabled and disabled without changing unrelated settings.

## Canvas and Inspect

- Drop MIDI, drum, and audio snippets only onto compatible tracks.
- Move, trim, half-time/double-time, mute, solo, and pan clips; reload and confirm
  the arrangement persists.
- Overlap prevention and edge snapping remain predictable with mouse and touch.
- Inspect can create, open, rename, search, filter, sort, and delete snippets.
- Editing note pitch, timing, duration, velocity, and lyric supports undo/redo
  and survives reload.
- Fit Rhythm preview can be cancelled without mutation and applied as one undoable
  edit.
- Inspect audition stops when changing mode or returning to the library.

## Save, restore, and export

- Export a workspace containing MIDI, drums, audio, custom instruments, settings,
  milestones, and Canvas clips; import it into a disposable workspace and compare
  playback and visible state.
- A malformed, oversized, or newer-version backup is rejected with a useful
  message and does not alter the current workspace.
- Snippet-library import creates fresh IDs and does not overwrite existing work.
- A connected local folder receives an updated backup after a saved edit; revoked
  permission produces a clear recovery action.
- Close or background the page immediately after an edit, reopen it, and confirm
  the final edit persisted.
- MIDI, WAV, ABC, and SVG exports are enabled only for supported content and do
  not silently produce empty files.
- Stereo Canvas WAV preserves audible pan; mono output is centered; selected
  patch, kit, velocity, and Tone remain recognizably consistent with live play.

## Mobile and iOS

Run at minimum on a narrow Chrome viewport and a real current iPhone/iPad Safari
when release changes touch layout, audio, input, permissions, or PWA behavior.

- No page-wide horizontal overflow; intended horizontal scrollers remain usable.
- Browser chrome and safe-area insets do not cover transport, record, Settings,
  snippets, or modal actions.
- Touching controls does not also drag or scroll the surface underneath.
- Canvas clips can be moved and long-pressed without accidental page navigation.
- Audio unlock explains any iOS microphone route permission and stops the
  temporary stream immediately.
- Audio In records, plays, renames, persists, backs up, and restores a short clip.
- Background and foreground transitions neither duplicate audio nor lose the
  final edit.
- Installed PWA launch and browser-tab launch reach the same saved workspace.

## Optional hardware and capability checks

Run these only when the release touches the capability or hardware is available:

- Web MIDI permission, connect/disconnect, active-surface routing, and recording.
- Gamepad connection, learned bindings, held modifiers, sticks, and saved presets.
- Adaptive switch or pedal exposed through the Gamepad API.
- Microphone device choice plus Auto, Mono, and Stereo capture.
- File System Access folder permission, revoke, and reconnect behavior.
- Vibration or gamepad haptics, if an experimental opt-in exists.

## Offline/PWA

- Load the current production build online, then relaunch offline.
- Create, edit, play synthesized sounds, save, and export without a network.
- Previously fetched sample packs remain available offline; an unfetched optional
  pack fails clearly rather than hanging.
- Updating to a new service worker version preserves the workspace and does not
  trap the app on an older shell.

When a check fails, open one bounded issue with the environment, reproduction
steps, expected/actual result, console output where relevant, and the smallest
useful screenshot or recording. Add a regression test when the failure can be
made deterministic.
