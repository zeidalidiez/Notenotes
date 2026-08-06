import test from 'node:test';
import assert from 'node:assert/strict';

import { focusableElements, setSubtreeInteractive, setTabActive } from '../../src/ui/InteractionState.js';

function element(attributes = {}) {
  return {
    attributes: { ...attributes },
    disabled: false,
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    closest() {
      return null;
    },
  };
}

test('setSubtreeInteractive keeps aria-hidden and inert in sync', () => {
  const subtree = element();

  setSubtreeInteractive(subtree, false);
  assert.equal(subtree.getAttribute('aria-hidden'), 'true');
  assert.equal(subtree.getAttribute('inert'), '');

  setSubtreeInteractive(subtree, true);
  assert.equal(subtree.getAttribute('aria-hidden'), 'false');
  assert.equal(subtree.getAttribute('inert'), null);
});

test('setTabActive implements a roving tab stop', () => {
  const tab = element();

  setTabActive(tab, false);
  assert.equal(tab.getAttribute('aria-selected'), 'false');
  assert.equal(tab.getAttribute('tabindex'), '-1');

  setTabActive(tab, true);
  assert.equal(tab.getAttribute('aria-selected'), 'true');
  assert.equal(tab.getAttribute('tabindex'), '0');
});

test('focusableElements excludes disabled, hidden, and roving inactive controls', () => {
  const visible = element();
  const inactiveTab = element({ tabindex: '-1' });
  const ariaDisabled = element({ 'aria-disabled': 'true' });
  const hidden = element();
  hidden.closest = () => hidden;
  const disabled = element();
  disabled.disabled = true;

  const container = {
    querySelectorAll() {
      return [visible, inactiveTab, ariaDisabled, hidden, disabled];
    },
  };

  assert.deepEqual(focusableElements(container), [visible]);
});
