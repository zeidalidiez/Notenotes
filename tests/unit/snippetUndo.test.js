import test from 'node:test';
import assert from 'node:assert/strict';
import { UndoManager } from '../../src/data/UndoManager.js';
import { EditNotesMixin } from '../../src/modes/editNotes.js';

test('undo and redo retain the edited snippet after another snippet is opened', () => {
  const a = { id: 'a', name: 'A', notes: [{ pitch: 60 }], durationTicks: 480 };
  const b = { id: 'b', name: 'B', notes: [{ pitch: 72 }], durationTicks: 480 };
  const undoManager = new UndoManager();
  const operations = [];
  undoManager.onChange(operation => operations.push(operation));
  let rebuilds = 0;
  const editor = Object.assign({}, EditNotesMixin, {
    _snippet: a, undoManager, el: { querySelector: () => null },
    _updateSnippetDuration() {}, _rebuildGrids() {}, _syncVelocityControl() {},
    _rebuildAll() { rebuilds++; },
  });
  const before = editor._snapshotSnippetState();
  a.notes[0].pitch = 61;
  editor._onEdit('Move note', before);
  editor._snippet = b;

  undoManager.undo();
  assert.equal(a.notes[0].pitch, 60);
  assert.equal(b.notes[0].pitch, 72);
  assert.equal(b.name, 'B');
  undoManager.redo();
  assert.equal(a.notes[0].pitch, 61);
  assert.equal(b.notes[0].pitch, 72);
  assert.equal(rebuilds, 0, 'replaying an edit does not rebuild a different open editor');
  assert.deepEqual(operations, ['push', 'undo', 'redo']);
});
