# MIDI Note Lyrics Design

## Goal

Lyrics should be authored as annotations on MIDI notes. A lyric does not create timing of its own: the selected note's `startTick` and `durationTick` are the timing anchor that future karaoke display reads.

## Problem

The existing lyrics editor stores `snippet.lyrics[]` blocks and asks users to type tick values. That produces data that can be read by playback, but the authoring model is wrong for musicians. Users already place and resize MIDI notes visually; lyrics should follow those same note events instead of requiring a separate lyric timing lane.

## Data Model

New lyric text is stored on MIDI note objects:

```js
{
  pitch: 60,
  startTick: 480,
  durationTick: 240,
  velocity: 0.8,
  lyric: 'take me away'
}
```

`note.lyric` is optional. Empty or whitespace-only text removes the property. Sanitization strips control characters and markup-breaking characters before storage.

Drum hits do not support lyrics. Drum-only snippets remain unchanged.

Legacy `snippet.lyrics[]` data may still exist in old projects. The editor should no longer create or edit `snippet.lyrics[]`. Engine helpers can derive karaoke-readable lyric blocks from note lyrics first, and fall back to `snippet.lyrics[]` only when a snippet has no note lyrics.

## Authoring UX

Lyrics are edited through the selected MIDI note.

1. User opens a MIDI snippet in Inspect.
2. User selects a note in the piano roll.
3. Toolbar shows a `Lyric` text input enabled for the selected note.
4. User types any phrase for that note and commits with Enter or blur.
5. The selected note receives `note.lyric`.
6. Moving the note moves the lyric because the note's `startTick` changes.
7. Resizing the note changes the lyric's duration because the note's `durationTick` changes.
8. Deleting the note deletes the lyric with it.

No separate lyrics lane is rendered for MIDI snippets. Audio and drum snippets do not show the lyric editor.

## Visual Treatment

The roll should remain readable even when lyric text is long.

- A note with lyric text gets a compact visual marker.
- If the note is wide enough, the note can show a clipped one-line lyric preview.
- The preview must use overflow clipping and ellipsis/fade behavior so it never expands or overlaps neighboring notes.
- Hovering or selecting the note exposes the full lyric via the note title and the toolbar input.
- The selected-note input is the full editing surface; the roll is only a compact preview.

## Playback And Karaoke Read Path

Future karaoke mode should consume a derived timeline:

```js
[
  { text: 'take me away', startTick: 480, durationTick: 240, noteIndex: 3 }
]
```

For note lyrics, the timeline is derived by sorting lyric-bearing MIDI notes by `startTick`, then by original note index. `startTick` and `durationTick` come from the note. The lyric reader does not mutate notes and does not affect MIDI playback.

## Migration

This change should not attempt a destructive automatic migration. Old `snippet.lyrics[]` blocks can remain in project data. The UI should stop editing them. The read helper can preserve compatibility by returning note-attached lyrics when present, otherwise returning normalized legacy lyric blocks.

## Testing

Unit coverage should prove:

- lyric text sanitizes and empty text removes `note.lyric`
- derived lyric blocks come from MIDI note timing
- derived lyric blocks ignore drums
- note-attached lyrics take precedence over legacy `snippet.lyrics[]`
- selected-note lyric editing updates the note and undo restores it
- note lyric UI is disabled when no note is selected

Manual QA should verify:

- selecting a MIDI note enables the lyric input
- entering a phrase marks the note
- moving and resizing the note changes the lyric timing without extra fields
- long lyric text does not overlap adjacent notes
- drum snippets do not expose lyric editing
