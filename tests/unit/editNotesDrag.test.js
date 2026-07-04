import test from 'node:test';
import assert from 'node:assert/strict';

import { EditNotesMixin } from '../../src/modes/editNotes.js';
import { EditRollMixin } from '../../src/modes/editRoll.js';
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

class FakeClassList {
  constructor() {
    this.items = new Set();
  }

  add(...names) {
    names.forEach(name => this.items.add(name));
  }

  remove(...names) {
    names.forEach(name => this.items.delete(name));
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.items.has(name) : !!force;
    if (shouldAdd) this.items.add(name);
    else this.items.delete(name);
    return shouldAdd;
  }

  contains(name) {
    return this.items.has(name);
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.style = {
      setProperty(name, value) {
        this[name] = String(value);
      },
    };
    this.dataset = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this._innerHTML = '';
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatchEvent(event) {
    event.target ??= this;
    let stopped = false;
    const originalStop = event.stopPropagation || (() => {});
    event.stopPropagation = () => {
      stopped = true;
      originalStop.call(event);
    };
    const handlers = this.listeners.get(event.type) || [];
    handlers.forEach(handler => handler(event));
    if (!stopped && this.parentElement) this.parentElement.dispatchEvent(event);
    return !stopped;
  }

  querySelector(selector) {
    return this._find(child => child._matches(selector));
  }

  _find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child._find(predicate);
      if (nested) return nested;
    }
    return null;
  }

  _matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    return false;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
    if (value.includes('piano-roll__note-resize')) {
      const resize = new FakeElement('div');
      resize.classList.add('piano-roll__note-resize');
      this.appendChild(resize);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

function withFakeCreateElement(fn) {
  const originalCreateElement = globalThis.document.createElement;
  globalThis.document.createElement = tag => new FakeElement(tag);
  try {
    return fn();
  } finally {
    globalThis.document.createElement = originalCreateElement;
  }
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

test('MIDI note edge click resizes only while Shift is held', () => {
  withFakeCreateElement(() => {
    const note = { pitch: 60, startTick: 0, durationTick: 480, velocity: 0.8 };
    const calls = [];
    const harness = {
      _snippet: {
        type: 'midi',
        name: 'edge resize',
        durationTicks: 960,
        notes: [note],
        hits: [],
      },
      _gridSize: 480,
      _pitchMin: 36,
      _pitchMax: 84,
      _noteHeight: 16,
      _selectedNoteIdx: null,
      _selectedEventKind: null,
      _escapeAttr(value) { return String(value ?? ''); },
      _escapeHtml(value) { return String(value ?? ''); },
    };
    Object.assign(harness, EditNotesMixin, EditRollMixin);
    harness._selectNote = (idx, kind) => {
      calls.push(`select:${kind}:${idx}`);
    };
    harness._startNoteDrag = () => {
      calls.push('drag');
    };
    harness._startNoteResize = () => {
      calls.push('resize');
    };

    const el = harness._createNoteElementForPane(note, 0, 84);
    const resizeHandle = el.querySelector('.piano-roll__note-resize');
    assert.ok(resizeHandle, 'MIDI note renders an edge handle');

    resizeHandle.dispatchEvent({
      type: 'pointerdown',
      clientX: 100,
      clientY: 100,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    assert.deepEqual(calls, ['select:note:0', 'drag']);

    calls.length = 0;
    resizeHandle.dispatchEvent({
      type: 'pointerdown',
      clientX: 100,
      clientY: 100,
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    assert.deepEqual(calls, ['select:note:0', 'resize']);
  });
});
