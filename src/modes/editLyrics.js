/**
 * editLyrics - EditMode feature: attach lyric text directly to selected MIDI
 * notes. The note's own startTick/durationTick is the lyric timing anchor, so
 * moving or resizing notes moves the future karaoke timing with them.
 */

import {
  cleanNoteLyricText,
  setNoteLyric,
  lyricTimelineForSnippet,
  activeLyricIndex,
} from '../engine/Lyrics.js';
import { showToast } from '../ui/Toast.js';

const NOTE_LYRIC_SELECTOR = '#edit-note-lyric';

export const EditLyricsMixin = {
  _renderLyricsLane() {
    // The rejected snippet-level lane no longer renders. Keep a derived cache so
    // playback/highlight consumers can still ask for lyrics without knowing
    // whether they came from note annotations or legacy snippet blocks.
    this._lyricsRibbonEl = null;
    this._lyricsCache = lyricTimelineForSnippet(this._snippet);
    this._lyricsActiveIdx = -1;
  },

  _selectedLyricNote() {
    if (!this._snippet || this._snippet.type !== 'midi') return null;
    if (this._selectedEventKind === 'hit') return null;
    if (this._selectedNoteIdx === null || this._selectedNoteIdx === undefined) return null;
    return this._snippet.notes?.[this._selectedNoteIdx] || null;
  },

  _bindNoteLyricControl(root = this.el) {
    const input = root?.querySelector?.(NOTE_LYRIC_SELECTOR);
    if (!input) return;

    input.addEventListener('blur', () => this._commitSelectedNoteLyric());
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this._commitSelectedNoteLyric();
      input.blur?.();
    });
    this._syncNoteLyricControl();
  },

  _syncNoteLyricControl() {
    const input = this.el?.querySelector?.(NOTE_LYRIC_SELECTOR);
    if (!input) return;
    const note = this._selectedLyricNote();
    input.disabled = !note;
    input.value = note ? cleanNoteLyricText(note.lyric) : '';
    input.placeholder = note ? 'Lyric for selected note' : 'Select a MIDI note';
  },

  _commitSelectedNoteLyric() {
    const input = this.el?.querySelector?.(NOTE_LYRIC_SELECTOR);
    const note = this._selectedLyricNote();
    if (!input || !note) return;

    const beforeState = this._snapshotSnippetState?.();
    const next = setNoteLyric(note, input.value);
    const nextLyric = next.lyric || '';
    const currentLyric = cleanNoteLyricText(note.lyric);
    input.value = nextLyric;
    if (currentLyric === nextLyric) return;

    if (nextLyric) note.lyric = nextLyric;
    else delete note.lyric;

    this._onEdit?.('Edit note lyric', beforeState);
    this._lyricsCache = lyricTimelineForSnippet(this._snippet);
    showToast(nextLyric ? 'Lyric attached to note' : 'Lyric cleared');
  },

  _lyricTimelineForSnippet() {
    this._lyricsCache = lyricTimelineForSnippet(this._snippet);
    return this._lyricsCache;
  },

  /** Track the lyric sounding at `tick`; visual karaoke rendering can read it later. */
  _updateLyricHighlight(tick) {
    const timeline = this._lyricTimelineForSnippet();
    const idx = tick >= 0 ? activeLyricIndex(timeline, tick) : -1;
    if (idx === this._lyricsActiveIdx) return;
    this._lyricsActiveIdx = idx;
  },
};
