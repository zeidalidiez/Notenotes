import test from 'node:test';
import assert from 'node:assert/strict';

import { EditNotesMixin } from '../../src/modes/editNotes.js';
import { TICK_WIDTH } from '../../src/modes/editConstants.js';

function installDocumentListeners() {
  const originalDocument = globalThis.document;
  const listeners = new Map();
  globalThis.document = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };
  return {
    listeners,
    restore() {
      globalThis.document = originalDocument;
    },
  };
}

test('clicking an off-grid MIDI note does not snap or move it', () => {
  const doc = installDocumentListeners();
  try {
    const note = { pitch: 60, startTick: 123, durationTick: 240, velocity: 0.8 };
    const harness = {
      _snippet: {
        type: 'midi',
        name: 'off-grid note',
        durationTicks: 960,
        notes: [note],
        hits: [],
      },
      _gridSize: 480,
      _pitchMin: 36,
      _pitchMax: 84,
      _noteHeight: 16,
      editDescriptions: [],
      _snapshotSnippetState() {
        return JSON.parse(JSON.stringify(this._snippet));
      },
      _onEdit(description) {
        this.editDescriptions.push(description);
      },
    };
    Object.assign(harness, EditNotesMixin);
    harness._onEdit = (description) => {
      harness.editDescriptions.push(description);
    };

    const el = {
      style: {
        left: `${note.startTick * TICK_WIDTH}px`,
        top: `${(harness._pitchMax - 1 - note.pitch) * harness._noteHeight}px`,
      },
    };

    harness._startNoteDrag({ clientX: 100, clientY: 100 }, note, 0, el);
    doc.listeners.get('pointerup')({ clientX: 100, clientY: 100 });

    assert.equal(note.startTick, 123);
    assert.equal(note.pitch, 60);
    assert.deepEqual(harness.editDescriptions, []);
  } finally {
    doc.restore();
  }
});
