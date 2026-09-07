import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  drumInstrumentGroups,
  labelForInstrument,
  midiInstrumentGroups,
} from '../../src/modes/instrumentGroups.js';
import { CanvasClipsMixin } from '../../src/modes/canvasClips.js';
import { CreativeInstrumentsMixin } from '../../src/modes/creativeInstruments.js';

test('bundled and public sample-pack catalogs stay in sync', async () => {
  const [bundled, published] = await Promise.all([
    readFile(new URL('../../src/data/samplePackIndex.json', import.meta.url), 'utf8'),
    readFile(new URL('../../public/packs/index.json', import.meta.url), 'utf8'),
  ]);

  assert.deepEqual(JSON.parse(bundled), JSON.parse(published));
});

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
  assert.ok(midiValues.includes('fm_epiano'), 'FM patches are available beyond Create mode');
  assert.ok(midiValues.includes('builtin:grand-piano'), 'CC0 sample packs are available beyond Create mode');
  assert.equal(drumValues.includes('custom:kit-1'), false);
  assert.equal(labelForInstrument('custom:kit-1', project), 'Saved Kit', 'legacy data still resolves by name');
  assert.equal(labelForInstrument('builtin:grand-piano', project), 'Grand Piano');
  assert.equal(project.settings.customInstruments.length, 2, 'hiding the option does not mutate saved data');
});

test('Canvas carries every playable recorded MIDI instrument family onto a track', () => {
  const context = { project: { settings: { customInstruments: [] } } };
  const recorded = CanvasClipsMixin._recordedInstrumentForSnippet;

  assert.equal(recorded.call(context, {
    type: 'midi',
    patchRecorded: { instrumentId: 'fm_epiano' },
  }), 'fm_epiano');
  assert.equal(recorded.call(context, {
    type: 'midi',
    patchRecorded: { instrumentId: 'builtin:grand-piano' },
  }), 'builtin:grand-piano');
});

test('Create keeps the audible patch identity when an optional sample cannot load', async () => {
  const context = {
    _activePatchId: 'chip_lead',
    _loadBuiltinSamplePatch: async () => false,
    _setLiveSoundTraits() {},
    _ensureSoundTraits: () => ({}),
    controllerMode: null,
  };

  const selected = await CreativeInstrumentsMixin._selectPatch.call(context, 'builtin:grand-piano');

  assert.equal(selected, false);
  assert.equal(context._activePatchId, 'chip_lead');
});
