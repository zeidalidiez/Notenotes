import test from 'node:test';
import assert from 'node:assert/strict';

import { ModeTabs, Modes } from '../../src/ui/ModeTabs.js';

function makeNode() {
  const classes = new Set();
  const node = {
    id: '',
    className: '',
    dataset: {},
    attributes: {},
    children: [],
    listeners: new Map(),
    innerHTML: '',
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'data-mode') this.dataset.mode = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelectorAll(selector) {
      return selector === '.mode-tabs__tab' ? this.children : [];
    },
    querySelector(selector) {
      const match = selector.match(/^\[data-mode="(.+)"\]$/);
      return match ? this.children.find(child => child.dataset.mode === match[1]) || null : null;
    },
    focus() {
      node.focused = true;
    },
  };
  return node;
}

test('mode tabs expose one tab stop and support arrow-key activation', (t) => {
  const originalCreateElement = document.createElement;
  document.createElement = () => makeNode();
  t.after(() => { document.createElement = originalCreateElement; });

  const modeTabs = new ModeTabs();
  const changes = [];
  modeTabs.onChange(mode => changes.push(mode));
  const nav = modeTabs.render();
  const [creative, canvas, inspect] = nav.children;

  assert.equal(inspect.getAttribute('aria-selected'), 'true');
  assert.equal(inspect.getAttribute('tabindex'), '0');
  assert.equal(creative.getAttribute('tabindex'), '-1');
  assert.equal(inspect.getAttribute('aria-controls'), 'view-pianoroll');

  creative.listeners.get('click')({});
  assert.equal(modeTabs.activeMode, Modes.CREATIVE);
  assert.equal(creative.getAttribute('aria-selected'), 'true');
  assert.equal(inspect.getAttribute('aria-selected'), 'false');

  let prevented = false;
  creative.listeners.get('keydown')({
    key: 'ArrowRight',
    preventDefault() { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.equal(modeTabs.activeMode, Modes.CANVAS);
  assert.equal(canvas.focused, true);
  assert.deepEqual(changes, [Modes.CREATIVE, Modes.CANVAS]);
});
