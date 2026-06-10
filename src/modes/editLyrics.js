/**
 * editLyrics — EditMode feature: attach lyrics to a snippet and show, in the
 * Inspector, when each word comes in and how long it lasts. Composed onto
 * EditMode.prototype via Object.assign.
 *
 * Typing a line distributes the words across the snippet's notes (see
 * engine/Lyrics.js). The words render as a proportional ribbon under the
 * toolbar, and the word currently sounding highlights during playback.
 */

// `activeLyricIndex` is intentionally NOT imported: the per-frame highlight
// scans the already-normalized `_lyricsCache` directly (below) to avoid
// re-normalizing the lyrics array on every animation frame.
import { normalizeLyrics, lyricsFromText, lyricsToText } from '../engine/Lyrics.js';

const escHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escHtml(s).replace(/"/g, '&quot;');

export const EditLyricsMixin = {
  _renderLyricsLane() {
    // Drop references to the previous lane so a detached ribbon node can be
    // garbage-collected (loadSnippet wipes the DOM) and the highlight loop has
    // nothing to touch until the new lane is built.
    this._lyricsRibbonEl = null;
    this._lyricsCache = null;
    this._lyricsActiveIdx = -1;
    // Lyrics belong to pitched/drum snippets in the roll editor, not the audio
    // player view.
    if (!this._snippet || this._snippet.type === 'audio') return;

    const lane = document.createElement('div');
    lane.className = 'edit-lyrics';
    lane.innerHTML = `
      <div class="edit-lyrics__row">
        <label class="edit-lyrics__label" for="edit-lyrics-input">Lyrics</label>
        <input type="text" id="edit-lyrics-input" class="edit-lyrics__input"
          placeholder="Type a line - words snap to your notes"
          value="${escAttr(lyricsToText(this._snippet.lyrics))}" />
      </div>
      <div class="edit-lyrics__ribbon" id="edit-lyrics-ribbon" aria-label="Lyric timing"></div>
    `;
    this.el.appendChild(lane);
    this._lyricsRibbonEl = lane.querySelector('#edit-lyrics-ribbon');

    const input = lane.querySelector('#edit-lyrics-input');
    input.addEventListener('change', () => this._setLyricsFromInput(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._setLyricsFromInput(input.value); input.blur(); }
    });

    this._renderLyricRibbon();
  },

  _setLyricsFromInput(text) {
    if (!this._snippet) return;
    this._snippet.lyrics = lyricsFromText(text, this._snippet);
    this._renderLyricRibbon();
    this.store?.scheduleAutoSave(this.project);
  },

  _renderLyricRibbon() {
    if (!this._lyricsRibbonEl) return;
    const lyrics = normalizeLyrics(this._snippet?.lyrics);
    this._lyricsCache = lyrics;        // reused per-frame by the highlight loop
    this._lyricsActiveIdx = -1;
    if (!lyrics.length) {
      this._lyricsRibbonEl.innerHTML = '<span class="edit-lyrics__empty">No lyrics yet - type a line above</span>';
      return;
    }
    const tpb = this.transport?.ticksPerBar || 1920;
    this._lyricsRibbonEl.innerHTML = lyrics.map((l, i) => {
      const bar = (l.startTick / tpb) + 1;
      return `<span class="edit-lyric" data-lyric-index="${i}" style="flex:${Math.max(1, l.durationTick)}"`
        + ` title="comes in at bar ${bar.toFixed(2)}">${escHtml(l.text)}</span>`;
    }).join('');
  },

  /** Highlight the word sounding at `tick` (or clear when tick < 0). */
  _updateLyricHighlight(tick) {
    if (!this._lyricsRibbonEl || !this._lyricsCache?.length) return;
    let idx = -1;
    if (tick >= 0) {
      for (let i = 0; i < this._lyricsCache.length; i++) {
        const l = this._lyricsCache[i];
        if (tick >= l.startTick && tick < l.startTick + l.durationTick) { idx = i; break; }
      }
    }
    if (idx === this._lyricsActiveIdx) return;   // only touch the DOM on change
    this._lyricsActiveIdx = idx;
    const chips = this._lyricsRibbonEl.children;
    for (let i = 0; i < chips.length; i++) chips[i].classList.toggle('is-active', i === idx);
  },
};
