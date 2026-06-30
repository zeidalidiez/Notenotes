/**
 * editLyrics — EditMode feature: attach timed lyric blocks to a snippet and
 * show, in the Inspector, when each phrase comes in and how long it lasts.
 * Composed onto EditMode.prototype via Object.assign.
 *
 * Each lyric entry is an independent timeline block. The ribbon positions
 * blocks by startTick/durationTick, and the block currently sounding highlights
 * during playback.
 */

// `activeLyricIndex` is intentionally NOT imported: the per-frame highlight
// scans the already-normalized `_lyricsCache` directly (below) to avoid
// re-normalizing the lyrics array on every animation frame.
import {
  normalizeLyricBlocks,
  ensureLyricBlockIds,
  createLyricBlock,
  updateLyricBlock,
  removeLyricBlock,
  lyricBlockIndexById,
} from '../engine/Lyrics.js';
import { showToast } from '../ui/Toast.js';
import { TICK_WIDTH } from './editConstants.js';

const escHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escHtml(s).replace(/"/g, '&quot;');
const int = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : fallback);

export const EditLyricsMixin = {
  _renderLyricsLane() {
    // Drop references to the previous lane so a detached ribbon node can be
    // garbage-collected (loadSnippet wipes the DOM) and the highlight loop has
    // nothing to touch until the new lane is built.
    this._lyricsRibbonEl = null;
    this._lyricsCache = null;
    this._lyricsActiveIdx = -1;
    if (typeof this._lyricsSelectedId !== 'string') this._lyricsSelectedId = '';
    // Lyrics belong to pitched/drum snippets in the roll editor, not the audio
    // player view.
    if (!this._snippet || this._snippet.type === 'audio') return;

    const selected = this._selectedLyricBlock();
    const defaultDuration = this._gridSize || this.transport?.ticksPerBeat || 480;
    const lane = document.createElement('div');
    lane.className = 'edit-lyrics';
    lane.innerHTML = `
      <div class="edit-lyrics__row edit-lyrics__row--editor">
        <label class="edit-lyrics__label" for="edit-lyrics-input">Lyrics</label>
        <input type="text" id="edit-lyrics-input" class="edit-lyrics__input"
          placeholder="Lyric phrase"
          value="${escAttr(selected?.text || '')}" />
        <label class="edit-lyrics__field">
          <span>Start</span>
          <input type="number" id="edit-lyrics-start" class="edit-lyrics__number"
            min="0" step="${this._gridSize || 120}" value="${selected?.startTick ?? 0}" />
        </label>
        <label class="edit-lyrics__field">
          <span>Length</span>
          <input type="number" id="edit-lyrics-duration" class="edit-lyrics__number"
            min="1" step="${this._gridSize || 120}" value="${selected?.durationTick ?? defaultDuration}" />
        </label>
        <button class="btn btn--ghost edit-toolbar__btn" id="edit-lyrics-save" type="button">${selected ? 'Update' : 'Add'}</button>
        <button class="btn btn--ghost edit-toolbar__btn" id="edit-lyrics-clear" type="button">Clear</button>
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--danger" id="edit-lyrics-delete" type="button" ${selected ? '' : 'disabled'}>Delete</button>
      </div>
      <div class="edit-lyrics__ribbon-scroll">
        <div class="edit-lyrics__ribbon" id="edit-lyrics-ribbon" aria-label="Lyric timing"></div>
      </div>
    `;
    this.el.appendChild(lane);
    this._lyricsRibbonEl = lane.querySelector('#edit-lyrics-ribbon');

    const input = lane.querySelector('#edit-lyrics-input');
    lane.querySelector('#edit-lyrics-save')?.addEventListener('click', () => this._saveLyricBlockFromForm());
    lane.querySelector('#edit-lyrics-clear')?.addEventListener('click', () => this._clearLyricForm());
    lane.querySelector('#edit-lyrics-delete')?.addEventListener('click', () => this._deleteSelectedLyricBlock());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._saveLyricBlockFromForm(); }
    });

    this._renderLyricRibbon();
  },

  _ensureSnippetLyricsWithIds() {
    if (!this._snippet || !Array.isArray(this._snippet.lyrics)) return [];
    const lyrics = ensureLyricBlockIds(this._snippet.lyrics, this._snippet);
    this._snippet.lyrics = lyrics;
    if (this._lyricsSelectedId && lyricBlockIndexById(lyrics, this._lyricsSelectedId, this._snippet) === -1) {
      this._lyricsSelectedId = '';
    }
    return lyrics;
  },

  _selectedLyricBlock() {
    const lyrics = this._ensureSnippetLyricsWithIds();
    const idx = lyricBlockIndexById(lyrics, this._lyricsSelectedId, this._snippet);
    return idx >= 0 ? lyrics[idx] : null;
  },

  _lyricFormValues() {
    const text = this.el?.querySelector('#edit-lyrics-input')?.value || '';
    const startTick = int(this.el?.querySelector('#edit-lyrics-start')?.value, 0);
    const durationTick = int(this.el?.querySelector('#edit-lyrics-duration')?.value, this._gridSize || 480);
    return { text, startTick, durationTick };
  },

  _saveLyricBlockFromForm() {
    if (!this._snippet) return;
    const beforeState = this._snapshotSnippetState();
    const lyrics = this._ensureSnippetLyricsWithIds();
    const selectedIdx = lyricBlockIndexById(lyrics, this._lyricsSelectedId, this._snippet);
    const formValues = this._lyricFormValues();
    const candidate = createLyricBlock({
      ...formValues,
      id: selectedIdx >= 0 ? this._lyricsSelectedId : undefined,
    }, this._snippet);
    if (!candidate) {
      showToast('Type lyric text first');
      return;
    }
    let next;
    let savedBlock = candidate;
    let description = 'Add lyric';
    let addedBlock = true;

    if (selectedIdx >= 0 && selectedIdx < lyrics.length) {
      next = updateLyricBlock(lyrics, selectedIdx, formValues, this._snippet);
      savedBlock = next[lyricBlockIndexById(next, candidate.id, this._snippet)] || candidate;
      description = 'Edit lyric';
      addedBlock = false;
    } else {
      next = normalizeLyricBlocks([...lyrics, savedBlock], this._snippet);
    }

    this._snippet.lyrics = ensureLyricBlockIds(next, this._snippet);
    if (addedBlock) {
      this._lyricsSelectedId = '';
    } else {
      this._lyricsSelectedId = savedBlock && lyricBlockIndexById(this._snippet.lyrics, savedBlock.id, this._snippet) >= 0
        ? savedBlock.id
        : '';
    }
    this._commitLyricEdit(description, beforeState);
    if (addedBlock) this._prepareLyricFormForNextBlock(savedBlock);
    else this._syncLyricFormToSelection();
    showToast(description === 'Add lyric' ? 'Lyric added' : 'Lyric updated');
  },

  _prepareLyricFormForNextBlock(block) {
    const fallbackDuration = this._gridSize || this.transport?.ticksPerBeat || 480;
    const durationTick = Math.max(1, int(block?.durationTick, fallbackDuration));
    const rawNextStart = Math.max(0, int(block?.startTick, 0) + durationTick);
    const snippetDuration = Number(this._snippet?.durationTicks);
    const nextStart = Number.isFinite(snippetDuration) && snippetDuration > 0
      ? Math.min(rawNextStart, Math.max(0, snippetDuration - 1))
      : rawNextStart;
    const text = this.el?.querySelector('#edit-lyrics-input');
    const start = this.el?.querySelector('#edit-lyrics-start');
    const duration = this.el?.querySelector('#edit-lyrics-duration');
    if (text) text.value = '';
    if (start) start.value = String(nextStart);
    if (duration) duration.value = String(durationTick);
    this._syncLyricFormButtons(null);
    this._syncLyricSelectionClass();
  },

  _deleteSelectedLyricBlock() {
    if (!this._snippet || !this._lyricsSelectedId) return;
    const lyrics = this._ensureSnippetLyricsWithIds();
    const selectedIdx = lyricBlockIndexById(lyrics, this._lyricsSelectedId, this._snippet);
    if (selectedIdx < 0) return;
    const beforeState = this._snapshotSnippetState();
    this._snippet.lyrics = removeLyricBlock(lyrics, selectedIdx, this._snippet);
    this._lyricsSelectedId = '';
    this._commitLyricEdit('Delete lyric', beforeState);
    this._syncLyricFormToSelection();
    showToast('Lyric deleted');
  },

  _commitLyricEdit(description, beforeState) {
    const afterState = this._snapshotSnippetState();
    if (beforeState && afterState && JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      this.undoManager?.push({
        type: 'editSnippet',
        description,
        undo: () => this._restoreSnippetState(beforeState),
        redo: () => this._restoreSnippetState(afterState),
      });
    }
    this._renderLyricRibbon();
    this.store?.scheduleAutoSave(this.project);
    window.dispatchEvent(new CustomEvent('project-snippets-changed', {
      detail: { snippetId: this._snippet?.id, action: 'updated' },
    }));
  },

  _selectLyricBlock(idx) {
    const lyrics = this._ensureSnippetLyricsWithIds();
    this._lyricsSelectedId = lyrics[idx]?.id || '';
    this._syncLyricFormToSelection();
    this._syncLyricSelectionClass();
  },

  _clearLyricForm() {
    this._lyricsSelectedId = '';
    const defaultDuration = this._gridSize || this.transport?.ticksPerBeat || 480;
    const text = this.el?.querySelector('#edit-lyrics-input');
    const start = this.el?.querySelector('#edit-lyrics-start');
    const duration = this.el?.querySelector('#edit-lyrics-duration');
    if (text) text.value = '';
    if (start) start.value = '0';
    if (duration) duration.value = String(defaultDuration);
    this._syncLyricFormButtons(null);
    this._syncLyricSelectionClass();
  },

  _syncLyricFormToSelection() {
    const selected = this._selectedLyricBlock();
    const defaultDuration = this._gridSize || this.transport?.ticksPerBeat || 480;
    const text = this.el?.querySelector('#edit-lyrics-input');
    const start = this.el?.querySelector('#edit-lyrics-start');
    const duration = this.el?.querySelector('#edit-lyrics-duration');
    if (text) text.value = selected?.text || '';
    if (start) start.value = String(selected?.startTick ?? 0);
    if (duration) duration.value = String(selected?.durationTick ?? defaultDuration);
    this._syncLyricFormButtons(selected);
  },

  _syncLyricFormButtons(selected) {
    const save = this.el?.querySelector('#edit-lyrics-save');
    const del = this.el?.querySelector('#edit-lyrics-delete');
    if (save) save.textContent = selected ? 'Update' : 'Add';
    if (del) del.disabled = !selected;
  },

  _renderLyricRibbon() {
    if (!this._lyricsRibbonEl) return;
    const lyrics = this._ensureSnippetLyricsWithIds();
    this._lyricsCache = lyrics;        // reused per-frame by the highlight loop
    this._lyricsActiveIdx = -1;
    if (this._lyricsSelectedId && lyricBlockIndexById(lyrics, this._lyricsSelectedId, this._snippet) === -1) {
      this._lyricsSelectedId = '';
    }
    const duration = Math.max(1, this._displayDurationTicks?.() || this._snippet?.durationTicks || 1);
    this._lyricsRibbonEl.style.width = `${Math.max(320, duration * TICK_WIDTH)}px`;
    if (!lyrics.length) {
      this._lyricsRibbonEl.innerHTML = '<span class="edit-lyrics__empty">No lyrics yet</span>';
      return;
    }
    const tpb = this.transport?.ticksPerBar || 1920;
    this._lyricsRibbonEl.innerHTML = lyrics.map((l, i) => {
      const bar = (l.startTick / tpb) + 1;
      const x = Math.max(0, l.startTick) * TICK_WIDTH;
      const w = Math.max(28, l.durationTick * TICK_WIDTH);
      const selected = l.id === this._lyricsSelectedId ? ' is-selected' : '';
      return `<button class="edit-lyric${selected}" type="button" data-lyric-index="${i}" data-lyric-id="${escAttr(l.id || '')}" style="left:${x}px;width:${w}px"`
        + ` title="starts at bar ${bar.toFixed(2)}, lasts ${l.durationTick} ticks">${escHtml(l.text)}</button>`;
    }).join('');
    this._lyricsRibbonEl.querySelectorAll('.edit-lyric').forEach(el => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._selectLyricBlock(Number(el.dataset.lyricIndex));
      });
    });
  },

  _syncLyricSelectionClass() {
    if (!this._lyricsRibbonEl) return;
    this._lyricsRibbonEl.querySelectorAll('.edit-lyric').forEach(el => {
      el.classList.toggle('is-selected', el.dataset.lyricId === this._lyricsSelectedId);
    });
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
