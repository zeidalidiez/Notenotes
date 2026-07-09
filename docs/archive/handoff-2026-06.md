# Notenotes Handoff

> Archived handoff from June 2026. See [`../../AI.MD`](../../AI.MD),
> [`../architecture.md`](../architecture.md), and [`../roadmap.md`](../roadmap.md)
> for current guidance.

This file is for the next non-Codex agent working on Notenotes. It is intentionally practical rather than historical.

## Project Shape

Notenotes is a vanilla JS, Vite, Web Audio API app. There is no framework, no AudioWorklet, no WASM, and no runtime CDN dependency. Keep it offline-first and mobile/PWA-friendly. The user cares deeply about a pre-DAW feel: fast sketching, playful instruments, and minimal friction, not a full production DAW.

Primary areas:

- `src/modes/CreativeMode.js` coordinates Create mode: Pads, Labs, Piano, Kit, Audio In, snippets, recording, controller routing, Stage, AI Seed, and many popovers.
- `src/instruments/ScaleBoard.js` owns Pads modes, including Single, Chords, Compass, Step Play, degree visuals, and extensions.
- `src/instruments/MicroPiano.js` owns Piano.
- `src/instruments/SketchKit.js` owns Kit and its own Kit toolbar.
- `src/modes/CanvasMode.js` owns timeline arranging, track pan, clip movement, time tools, and Canvas Stage.
- `src/modes/EditMode.js` owns Inspect.
- `src/stage/` owns Stage models, views, and canvas rendering.
- `src/engine/` owns transport, meter, recording, playback, synthesis helpers, storage-adjacent logic, and audio utilities.

## Current Rules That Matter

- Update `AI.MD` for meaningful code changes so future agents understand the logic. Keep it concise when the change is a tiny bug fix.
- Update `README.md` when behavior or features change. Preserve the author's direct, personal voice.
- `src/version.js` is the canonical public app version. `package.json` and `package-lock.json` should stay aligned, but Settings checks GitHub's raw `src/version.js`, not package metadata.
- Old projects and old snippets must keep loading. Schema changes should be additive.
- Anything audible live should have an export path in `src/export/WavExporter.js` where relevant.
- Avoid broad refactors of `CreativeMode.js` unless you can keep behavior stable and test keyboard, MIDI, controller, snippets, recording, and Stage afterward.

## Recent Fix Context

The Kit screen previously showed two toolbar rows: the global synth Patch toolbar and the Kit toolbar. The root cause was that `CreativeMode._syncPatchToolbarVisibility()` only set the `hidden` attribute on `.patch-selector`, while the authored `.patch-selector { display: flex; }` CSS overrode browser hidden styling. The fix explicitly sets `patchSel.style.display = 'none'` when the active Create surface is Kit, Mic, or any other surface that should not show the synth toolbar.

Kit should show only its own `SketchKit` toolbar:

- Kit picker
- Create/Edit Instrument
- Delete only for custom kits
- Tone
- AI
- Controller
- Stage

It should not show the synth Patch picker row.

## Known Sensitive Areas

- iOS audio unlock is fragile. Some iOS Safari builds only open a usable sound route after microphone permission is requested from a user gesture. Do not remove the AudioEngine/iOS unlock path without testing on actual iOS.
- Stage is evolving quickly. Live Stage should react to Pads, Piano, Kit, controller bindings, and touch lane pills. Canvas Stage should show internal events, not only track occupancy.
- Mobile layout is a recurring pain point. Avoid huge native dropdowns, giant buttons, and popovers that render offscreen. Pickers and mobile modal behavior are preferred for large lists.
- Controller Labs is not meant to be the main star of Labs. It should eventually live inside a tabbed Labs structure. WIP also says to remove octave from Controller Labs and remove redundant fallback/unbound lists.
- The user dislikes encouraging effect toggling as performance modifiers. Tone changes should not be promoted as controller modifiers because they sound bad mid-take and do not export cleanly to MIDI.
- Step Play saves fixed MIDI notes. Changing key, scale, or pad octave must not rewrite a Step Play composition. Out-of-scale saved notes should keep playing and show an `OUT` badge.
- Audio asset durability matters. Browser storage is risky, and connected local-folder backup should be treated as an important safety path.

## Verification Expectations

At minimum after code changes:

```bash
npm.cmd run test:smoke
npm.cmd run build
git diff --check
```

For UI changes, manually inspect the affected mode. For Kit toolbar changes specifically:

1. Open Create.
2. Switch to Kit.
3. Confirm only one toolbar row appears below the instrument tabs.
4. Confirm no synth Patch picker is visible on Kit.
5. Switch back to Pads and Piano.
6. Confirm the Patch toolbar returns there.

## Commit Style

Use real commit descriptions. Explain why the change exists, what source of truth or behavior changed, and what QA was run. The user values clear commit history more than tiny one-line commits.
