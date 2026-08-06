import test from 'node:test';
import assert from 'node:assert/strict';

import { SettingsPanel } from '../../src/ui/SettingsPanel.js';

function node() {
  const classes = new Set();
  return {
    attributes: {},
    isConnected: true,
    focusCount: 0,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    closest() { return null; },
    focus() { this.focusCount += 1; },
  };
}

test('settings modal makes the app inert and restores its explicit opener', async (t) => {
  const panel = new SettingsPanel({});
  const panelRoot = node();
  const closeButton = node();
  const app = node();
  const opener = node();
  panelRoot.querySelector = selector => selector === '#settings-close' ? closeButton : null;
  panel.el = panelRoot;
  panel._switchSection = () => {};
  panel._dumpDebugSnapshot = () => {};

  const originalGetElementById = document.getElementById;
  document.getElementById = id => id === 'app' ? app : null;
  t.after(() => { document.getElementById = originalGetElementById; });

  panel.openTo('settings', { returnFocus: opener });
  await new Promise(resolve => requestAnimationFrame(resolve));

  assert.equal(panelRoot.getAttribute('aria-hidden'), 'false');
  assert.equal(panelRoot.getAttribute('inert'), null);
  assert.equal(app.getAttribute('inert'), '');
  assert.equal(closeButton.focusCount, 1);

  panel.close();
  await new Promise(resolve => requestAnimationFrame(resolve));

  assert.equal(panelRoot.getAttribute('aria-hidden'), 'true');
  assert.equal(panelRoot.getAttribute('inert'), '');
  assert.equal(app.getAttribute('inert'), null);
  assert.equal(opener.focusCount, 1);
});
