import test from 'node:test';
import assert from 'node:assert/strict';

import {
  drumInstrumentGroups,
  labelForInstrument,
  midiInstrumentGroups,
} from '../../src/modes/instrumentGroups.js';

test('instrument pickers expose custom patches but not unfinished custom kits', () => {
  const project = {
    settings: {
      customInstruments: [
        { id: 'patch-1', name: 'Playable Patch', type: 'patch' },
        { id: 'kit-1', name: 'Saved Kit', type: 'kit' },
      ],
    },
  };

  const midiValues = midiInstrumentGroups(project).flatMap(group => group.items.map(item => item.value));
  const drumValues = drumInstrumentGroups(project).flatMap(group => group.items.map(item => item.value));

  assert.ok(midiValues.includes('custom:patch-1'));
  assert.equal(drumValues.includes('custom:kit-1'), false);
  assert.equal(labelForInstrument('custom:kit-1', project), 'Saved Kit', 'legacy data still resolves by name');
  assert.equal(project.settings.customInstruments.length, 2, 'hiding the option does not mutate saved data');
});
