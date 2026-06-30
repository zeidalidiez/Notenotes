import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureLyricBlockIds, lyricBlockIndexById } from '../../src/engine/Lyrics.js';
import { EditMode } from '../../src/modes/EditMode.js';
import { EditLyricsMixin } from '../../src/modes/editLyrics.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeField(value = '') {
  return { value: String(value), textContent: '', disabled: false };
}

function makeHarness(snippet, formValues = {}) {
  const fields = new Map([
    ['#edit-lyrics-input', makeField(formValues.text ?? '')],
    ['#edit-lyrics-start', makeField(formValues.startTick ?? 0)],
    ['#edit-lyrics-duration', makeField(formValues.durationTick ?? 480)],
    ['#edit-lyrics-save', makeField()],
    ['#edit-lyrics-delete', makeField()],
  ]);

  return {
    _snippet: snippet,
    _gridSize: 120,
    transport: { ticksPerBeat: 480, ticksPerBar: 1920 },
    project: {},
    el: {
      querySelector(selector) {
        return fields.get(selector) || null;
      },
    },
    fields,
    undoEntries: [],
    undoManager: {
      push(entry) {
        this.owner.undoEntries.push(entry);
      },
      owner: null,
    },
    saveCount: 0,
    store: {
      owner: null,
      scheduleAutoSave() {
        this.owner.saveCount += 1;
      },
    },
    renderCount: 0,
    _snapshotSnippetState() {
      return clone({
        durationTicks: this._snippet.durationTicks,
        notes: this._snippet.notes || [],
        hits: this._snippet.hits || [],
        lyrics: this._snippet.lyrics || [],
      });
    },
    _restoreSnippetState(state) {
      this._snippet.durationTicks = state.durationTicks;
      this._snippet.notes = clone(state.notes || []);
      this._snippet.hits = clone(state.hits || []);
      this._snippet.lyrics = clone(state.lyrics || []);
    },
    _renderLyricRibbon() {
      this.renderCount += 1;
    },
    _displayDurationTicks() {
      return this._snippet.durationTicks;
    },
  };
}

function wireHarness(harness) {
  harness.undoManager.owner = harness;
  harness.store.owner = harness;
  Object.assign(harness, EditLyricsMixin);
  harness._renderLyricRibbon = () => {
    harness.renderCount += 1;
  };
  return harness;
}

test('EditLyricsMixin update keeps selection on the chosen duplicate block', () => {
  const snippet = {
    id: 'lyrics-snippet',
    type: 'midi',
    durationTicks: 960,
    lyrics: ensureLyricBlockIds([
      { text: 'same', startTick: 0, durationTick: 120 },
      { text: 'other', startTick: 240, durationTick: 120 },
    ], { durationTicks: 960 }),
  };
  const duplicateId = snippet.lyrics[1].id;
  const harness = wireHarness(makeHarness(snippet, {
    text: 'same',
    startTick: 0,
    durationTick: 120,
  }));
  harness._lyricsSelectedId = duplicateId;

  harness._saveLyricBlockFromForm();

  assert.equal(harness._lyricsSelectedId, duplicateId);
  assert.equal(harness.undoEntries.at(-1)?.description, 'Edit lyric');
  assert.equal(harness.saveCount, 1);
  assert.equal(harness.renderCount, 1);
  assert.deepEqual(
    snippet.lyrics.map(({ text, startTick, durationTick }) => ({ text, startTick, durationTick })),
    [
      { text: 'same', startTick: 0, durationTick: 120 },
      { text: 'same', startTick: 0, durationTick: 120 },
    ],
  );
  assert.equal(lyricBlockIndexById(snippet.lyrics, duplicateId, snippet), 1);
});

test('EditLyricsMixin delete removes only the selected duplicate block', () => {
  const snippet = {
    id: 'lyrics-snippet',
    type: 'midi',
    durationTicks: 960,
    lyrics: ensureLyricBlockIds([
      { text: 'same', startTick: 0, durationTick: 120 },
      { text: 'same', startTick: 0, durationTick: 120 },
    ], { durationTicks: 960 }),
  };
  const keepId = snippet.lyrics[0].id;
  const deleteId = snippet.lyrics[1].id;
  const harness = wireHarness(makeHarness(snippet));
  harness._lyricsSelectedId = deleteId;

  harness._deleteSelectedLyricBlock();

  assert.equal(harness._lyricsSelectedId, '');
  assert.equal(harness.undoEntries.at(-1)?.description, 'Delete lyric');
  assert.equal(snippet.lyrics.length, 1);
  assert.equal(snippet.lyrics[0].id, keepId);
  assert.equal(lyricBlockIndexById(snippet.lyrics, deleteId, snippet), -1);
});

test('EditMode duration clamp preserves selected lyric block id', () => {
  const snippet = {
    id: 'lyrics-snippet',
    type: 'midi',
    durationTicks: 1200,
    notes: [],
    hits: [],
    lyrics: ensureLyricBlockIds([
      { text: 'early', startTick: 0, durationTick: 120 },
      { text: 'late', startTick: 900, durationTick: 300 },
    ], { durationTicks: 1200 }),
  };
  const selectedId = snippet.lyrics[1].id;
  const harness = wireHarness(makeHarness(snippet));
  harness._lyricsSelectedId = selectedId;
  harness._rebuildAll = () => { harness.rebuilt = true; };

  EditMode.prototype._setDuration.call(harness, 960);

  const selectedIdx = lyricBlockIndexById(snippet.lyrics, selectedId, snippet);
  assert.equal(harness._lyricsSelectedId, selectedId);
  assert.ok(harness.rebuilt);
  assert.equal(selectedIdx, 1);
  assert.equal(snippet.lyrics[selectedIdx].text, 'late');
  assert.equal(snippet.lyrics[selectedIdx].startTick, 900);
  assert.equal(snippet.lyrics[selectedIdx].durationTick, 60);
});
