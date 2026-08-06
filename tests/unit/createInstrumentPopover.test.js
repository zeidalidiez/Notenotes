import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CreateInstrumentPopover,
  editableCustomPatches,
} from '../../src/ui/CreateInstrumentPopover.js';

test('custom instrument creation exposes complete sample patches only', () => {
  const saved = [
    { id: 'patch-1', name: 'Playable Patch', type: 'patch' },
    { id: 'kit-1', name: 'Saved Kit', type: 'kit' },
  ];
  const patches = editableCustomPatches(saved);
  const popover = new CreateInstrumentPopover();
  const html = popover._render({
    customInstruments: patches,
    editingInstrument: null,
    audioSnippets: [],
  });

  assert.deepEqual(patches.map(instrument => instrument.id), ['patch-1']);
  assert.match(html, /Playable Patch/);
  assert.doesNotMatch(html, /Saved Kit|id="ci-type"|value="kit"|ci-kit-note/);
  assert.equal(saved.length, 2, 'filtering does not remove dormant data from the project');
});
