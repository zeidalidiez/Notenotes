# MIDI Note Lyrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace snippet-level lyric block authoring with MIDI note-attached lyric annotations that inherit timing from the note.

**Architecture:** Store lyric text directly on MIDI note objects as `note.lyric`. Keep pure helpers in `src/engine/Lyrics.js` for sanitization and karaoke-readable derived blocks. Repurpose the existing `EditLyricsMixin` into selected-note lyric controls and remove the separate lyrics ribbon from the render path.

**Tech Stack:** Vanilla JavaScript modules, Node test runner, existing EditMode mixins, existing CSS.

---

## File Structure

- Modify `src/engine/Lyrics.js`: add note lyric sanitization, note patching, and derived lyric block helpers while preserving legacy block normalizers for compatibility.
- Modify `src/modes/editLyrics.js`: remove the separate lane UI and implement selected-note lyric input behavior.
- Modify `src/modes/editRoll.js`: render the lyric input in the MIDI toolbar and draw lyric markers/previews inside note elements.
- Modify `src/modes/editNotes.js`: sync the lyric control when note selection changes and keep undo through existing snippet snapshots.
- Modify `src/modes/edit.css`: style toolbar lyric input, note lyric marker, and clipped preview.
- Modify `tests/unit/lyrics.test.js`: cover note-attached lyric helpers.
- Replace `tests/unit/editLyricsMixin.test.js`: cover selected-note lyric editing instead of snippet lyric blocks.
- Modify `README.md`, `AI.MD`, and `Manual QA.md`: document note-attached lyric behavior.
- Modify `src/version.js`, `package.json`, and `package-lock.json`: bump the app version.

### Task 1: Engine Helpers

**Files:**
- Modify: `src/engine/Lyrics.js`
- Test: `tests/unit/lyrics.test.js`

- [ ] **Step 1: Write failing engine tests**

Add tests for `cleanNoteLyricText`, `setNoteLyric`, `lyricBlocksFromNotes`, and `lyricTimelineForSnippet`.

- [ ] **Step 2: Run focused engine tests**

Run: `node --import ./tests/fixtures/register-loader.mjs --test tests/unit/lyrics.test.js`

Expected: FAIL because the note-attached helper exports do not exist.

- [ ] **Step 3: Implement note lyric helpers**

Add pure helpers that sanitize note lyric text, set/remove `note.lyric`, derive blocks from MIDI notes, ignore drum snippets, and fall back to legacy `snippet.lyrics[]` only when no note lyrics exist.

- [ ] **Step 4: Re-run focused engine tests**

Run: `node --import ./tests/fixtures/register-loader.mjs --test tests/unit/lyrics.test.js`

Expected: PASS.

### Task 2: Selected-Note Lyric Editor

**Files:**
- Modify: `src/modes/editRoll.js`
- Modify: `src/modes/editLyrics.js`
- Modify: `src/modes/editNotes.js`
- Test: `tests/unit/editLyricsMixin.test.js`

- [ ] **Step 1: Write failing mixin tests**

Replace snippet-block tests with selected MIDI note tests:

- the lyric input is disabled when no note is selected
- selecting a note loads its lyric
- committing text writes `note.lyric`
- committing blank text removes `note.lyric`
- undo snapshots include lyric changes through existing note cloning

- [ ] **Step 2: Run focused mixin tests**

Run: `node --import ./tests/fixtures/register-loader.mjs --test tests/unit/editLyricsMixin.test.js`

Expected: FAIL because the selected-note lyric input path does not exist yet.

- [ ] **Step 3: Implement selected-note lyric controls**

Add a MIDI-only toolbar input. Bind Enter, blur, and selection changes. Use the engine helper to sanitize and apply text to the selected note. Commit changes through `_onEdit('Edit note lyric', beforeState)`.

- [ ] **Step 4: Remove separate lane render**

Change `_renderLyricsLane()` so it no longer appends a standalone lane. Keep highlight/read helpers only if they consume the derived note lyric timeline.

- [ ] **Step 5: Re-run focused mixin tests**

Run: `node --import ./tests/fixtures/register-loader.mjs --test tests/unit/editLyricsMixin.test.js`

Expected: PASS.

### Task 3: Roll Marker And Preview

**Files:**
- Modify: `src/modes/editRoll.js`
- Modify: `src/modes/edit.css`

- [ ] **Step 1: Render note lyric marker**

Update `_createNoteElementForPane()` so notes with `note.lyric` receive a class and contain a clipped preview element. The note title should include the full lyric.

- [ ] **Step 2: Add CSS**

Add styles that keep the marker and preview inside the note rectangle. Long text must be `overflow: hidden`, single-line, and non-layout-shifting.

- [ ] **Step 3: Verify manually by DOM behavior**

Run focused tests and inspect generated note element HTML in existing unit harnesses where practical.

### Task 4: Docs, Version, And Cleanup

**Files:**
- Modify: `README.md`
- Modify: `AI.MD`
- Modify: `Manual QA.md`
- Modify: `src/version.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Update docs**

Document that lyrics attach to selected MIDI notes and inherit note timing. Remove claims that users author independent lyric timing blocks.

- [ ] **Step 2: Update version**

Bump `0.1.125` to `0.1.126`.

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
```

Expected: tests pass, build succeeds, and no dev server is listening on port `5173`.

- [ ] **Step 4: Commit and push**

Commit all scoped files and push `codex/note-attached-lyrics`, then open a PR against `main`.
