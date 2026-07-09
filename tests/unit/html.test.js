import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeAttr, escapeHtml } from '../../src/utils/html.js';

test('escapeHtml makes template-interpolated names render as text', () => {
  assert.equal(
    escapeHtml('\"><span data-test="marker">Name & note</span>'),
    '&quot;&gt;&lt;span data-test=&quot;marker&quot;&gt;Name &amp; note&lt;/span&gt;',
  );
});

test('escapeAttr handles nullish values and both quote styles', () => {
  assert.equal(escapeAttr(null), '');
  assert.equal(escapeAttr(`a'b"c`), 'a&#39;b&quot;c');
});
