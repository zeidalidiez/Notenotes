import test from 'node:test';
import assert from 'node:assert/strict';

import { EditLyricsMixin } from '../../src/modes/editLyrics.js';
import { EditNotesMixin } from '../../src/modes/editNotes.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeField(value = '') {
  return {
    value: String(value),
    disabled: false,
    textContent: '',
    listeners: new Map(),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    blur() {
      this.blurred = true;
    },
  };
}

function makeHarness(snippet) {
  const lyricInput = makeField('');
  const fields = new Map([
    ['#edit-note-lyric', lyricInput],
  ]);

  return {
    _snippet: snippet,
    _selectedNoteIdx: null,
    el: {
      querySelector(selector) {
        return fields.get(selector) || null;
      },
      querySelectorAll() {
        return [];
      },
    },
    fields,
    undoEntries: [],
    undoManager: {
      owner: null,
      push(entry) {
        this.owner.undoEntries.push(entry);
      },
    },
    saveCount: 0,
    store: {
      owner: null,
      scheduleAutoSave() {
        this.owner.saveCount += 1;
      },
    },
    rebuildCount: 0,
    _updateSnippetDuration() {},
    _rebuildGrids() {
      this.rebuildCount += 1;
    },
    _rebuildAll() {
      this.rebuildCount += 1;
    },
    _snapshotSnippetState() {
      return clone({
        name: this._snippet.name,
        notes: this._snippet.notes || [],
        hits: this._snippet.hits || [],
        lyrics: this._snippet.lyrics || [],
        modulation: this._snippet.modulation || [],
        durationTicks: this._snippet.durationTicks,
      });
    },
    _restoreSnippetState(state) {
      this._snippet.name = state.name;
      this._snippet.notes = clone(state.notes || []);
      this._snippet.hits = clone(state.hits || []);
      this._snippet.lyrics = clone(state.lyrics || []);
      this._snippet.modulation = clone(state.modulation || []);
      this._snippet.durationTicks = state.durationTicks;
      this._selectedNoteIdx = null;
    },
  };
}

function wireHarness(harness) {
  harness.undoManager.owner = harness;
  harness.store.owner = harness;
  Object.assign(harness, EditLyricsMixin, EditNotesMixin);
  return harness;
}

test('EditLyricsMixin disables selected-note lyric input until a MIDI note is selected', () => {
  const harness = wireHarness(makeHarness({
    type: 'midi',
    durationTicks: 960,
    notes: [{ pitch: 60, startTick: 0, durationTick: 120 }],
  }));

  harness._syncNoteLyricControl();

  const input = harness.fields.get('#edit-note-lyric');
  assert.equal(input.disabled, true);
  assert.equal(input.value, '');
});

test('EditLyricsMixin loads the selected MIDI note lyric into the toolbar input', () => {
  const harness = wireHarness(makeHarness({
    type: 'midi',
    durationTicks: 960,
    notes: [
      { pitch: 60, startTick: 0, durationTick: 120 },
      { pitch: 64, startTick: 240, durationTick: 120, lyric: 'take me away' },
    ],
  }));

  harness._selectNote(1);

  const input = harness.fields.get('#edit-note-lyric');
  assert.equal(input.disabled, false);
  assert.equal(input.value, 'take me away');
});

test('EditLyricsMixin commits lyric text to the selected MIDI note with undo support', () => {
  const snippet = {
    name: 'lyric snippet',
    type: 'midi',
    durationTicks: 960,
    notes: [{ pitch: 60, startTick: 0, durationTick: 120 }],
    hits: [],
    lyrics: [{ text: 'legacy', startTick: 0, durationTick: 120 }],
  };
  const harness = wireHarness(makeHarness(snippet));
  harness._selectNote(0);
  harness.fields.get('#edit-note-lyric').value = '<b>take</b> "away"';

  harness._commitSelectedNoteLyric();

  assert.equal(snippet.notes[0].lyric, 'btake/b away');
  assert.deepEqual(snippet.lyrics, [{ text: 'legacy', startTick: 0, durationTick: 120 }]);
  assert.equal(harness.undoEntries.at(-1)?.description, 'Edit note lyric');
  assert.equal(harness.saveCount, 1);
  assert.equal(harness.rebuildCount, 1);

  harness.undoEntries.at(-1).undo();
  assert.equal(snippet.notes[0].lyric, undefined);

  harness.undoEntries.at(-1).redo();
  assert.equal(snippet.notes[0].lyric, 'btake/b away');
});

test('EditLyricsMixin removes selected note lyric when committed text is blank', () => {
  const snippet = {
    type: 'midi',
    durationTicks: 960,
    notes: [{ pitch: 60, startTick: 0, durationTick: 120, lyric: 'old lyric' }],
  };
  const harness = wireHarness(makeHarness(snippet));
  harness._selectNote(0);
  harness.fields.get('#edit-note-lyric').value = '   ';

  harness._commitSelectedNoteLyric();

  assert.equal(Object.hasOwn(snippet.notes[0], 'lyric'), false);
  assert.equal(harness.undoEntries.at(-1)?.description, 'Edit note lyric');
});

test('EditLyricsMixin ignores lyric commits for drum snippets', () => {
  const snippet = {
    type: 'drum',
    durationTicks: 960,
    hits: [{ type: 'kick', startTick: 0 }],
    notes: [{ pitch: 60, startTick: 0, durationTick: 120 }],
  };
  const harness = wireHarness(makeHarness(snippet));
  harness._selectedNoteIdx = 0;
  harness.fields.get('#edit-note-lyric').value = 'ignored';

  harness._commitSelectedNoteLyric();

  assert.equal(snippet.notes[0].lyric, undefined);
  assert.equal(harness.undoEntries.length, 0);
});

test('EditLyricsMixin does not attach lyrics when a MIDI-roll hit is selected', () => {
  const snippet = {
    type: 'midi',
    durationTicks: 960,
    notes: [{ pitch: 60, startTick: 0, durationTick: 120 }],
    hits: [{ type: 'kick', startTick: 0 }],
  };
  const harness = wireHarness(makeHarness(snippet));
  harness._selectedNoteIdx = 0;
  harness._selectedEventKind = 'hit';
  harness.fields.get('#edit-note-lyric').value = 'should not attach';

  harness._syncNoteLyricControl();
  harness._commitSelectedNoteLyric();

  assert.equal(harness.fields.get('#edit-note-lyric').disabled, true);
  assert.equal(snippet.notes[0].lyric, undefined);
  assert.equal(harness.undoEntries.length, 0);
});
