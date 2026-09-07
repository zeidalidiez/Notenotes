/**
 * Canonical instrument identity shared by Create, Inspect, Canvas, live
 * playback, and export. Runtime audio buffers remain in their owning loaders;
 * this module only resolves serializable identity and metadata.
 */

import samplePackIndex from '../data/samplePackIndex.json' with { type: 'json' };
import { DRUM_KITS } from '../instruments/drumKits.js';
import { PRESETS } from '../instruments/synthPresets.js';

export const SAMPLE_PACK_INDEX = Object.freeze(
  samplePackIndex.map(metadata => Object.freeze({ ...metadata }))
);

const presetDefinitions = Object.fromEntries(
  Object.entries(PRESETS).map(([id, patch]) => [id, Object.freeze({
    id,
    name: patch.name || id,
    type: 'synth',
    kind: 'preset',
    preset: id,
    family: patch.family || 'chip',
  })])
);

const builtinSampleDefinitions = Object.fromEntries(
  SAMPLE_PACK_INDEX.map(metadata => {
    const id = `builtin:${metadata.id}`;
    return [id, Object.freeze({
      id,
      name: metadata.name || metadata.id,
      type: 'synth',
      kind: 'builtin-sample',
      family: 'sample',
      samplePackId: metadata.id,
      metadata: Object.freeze({ ...metadata }),
    })];
  })
);

/** Available non-custom instruments for track assignment. */
export const TRACK_INSTRUMENTS = Object.freeze({
  ...presetDefinitions,
  ...builtinSampleDefinitions,
  kit: Object.freeze({
    id: 'kit',
    name: DRUM_KITS.classic.name,
    type: 'kit',
    kind: 'kit',
    kitId: 'classic',
  }),
});

export const BUILTIN_SAMPLE_INSTRUMENTS = Object.freeze(
  Object.values(builtinSampleDefinitions)
);

export function recordedInstrumentId(snippet, fallback = null) {
  if (!snippet) return fallback;
  if (snippet.type === 'drum') {
    return snippet.kitRecorded?.instrumentId
      || snippet.instrumentId
      || snippet.kitId
      || fallback;
  }
  return snippet.patchRecorded?.instrumentId
    || snippet.instrumentId
    || snippet.patchId
    || fallback;
}

/**
 * Resolve built-in, sample-pack, drum, and project-local custom identities.
 * Unknown ids return null rather than silently selecting another sound.
 */
export function resolveInstrumentDefinition(instrumentId, project = null) {
  const id = instrumentId || '';
  if (id === 'kit') return TRACK_INSTRUMENTS.kit;
  if (DRUM_KITS[id]) {
    return {
      id,
      name: DRUM_KITS[id].name,
      type: 'kit',
      kind: 'kit',
      kitId: id,
    };
  }
  if (id.startsWith('custom:')) {
    const customInstrument = (project?.settings?.customInstruments || [])
      .find(item => item.id === id.slice(7));
    if (!customInstrument) return null;
    const isKit = customInstrument.type === 'kit';
    return {
      id,
      name: customInstrument.name || 'Custom instrument',
      type: isKit ? 'kit' : 'synth',
      kind: isKit ? 'custom-kit' : 'custom-sample',
      kitId: isKit ? id : null,
      customInstrument,
    };
  }
  return TRACK_INSTRUMENTS[id] || null;
}

export function snapshotForInstrument(instrumentId) {
  const patch = PRESETS[instrumentId];
  return patch ? JSON.parse(JSON.stringify(patch)) : null;
}

export function isInstrumentAvailable(instrumentId, project = null, type = null) {
  const definition = resolveInstrumentDefinition(instrumentId, project);
  return !!definition && (!type || definition.type === type);
}
