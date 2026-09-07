/**
 * instrumentGroups — Shared instrument-list builders.
 *
 * Single source of truth for the MIDI patch list and the drum kit list
 * that the picker UI surfaces in Canvas (track instruments) and Inspect
 * (snippet patch / kit). Both surfaces read from these helpers so the
 * list, ordering, and labels cannot drift between the two.
 *
 * Output shape matches what `src/ui/ChoicePicker.js` expects:
 *   { id, label, items: [ { value, label, kicker, description, tags } ] }
 */

import { DRUM_KITS } from '../instruments/SketchKit.js';
import { PRESETS } from '../instruments/WebAudioSynth.js';
import {
  BUILTIN_SAMPLE_INSTRUMENTS,
  resolveInstrumentDefinition,
} from '../engine/InstrumentRegistry.js';

/** Built-in MIDI patches and sample-based custom patch instruments. */
export function midiInstrumentGroups(project = null) {
  const presets = Object.entries(PRESETS);
  const itemForPreset = ([id, patch]) => {
    return {
      value: id,
      label: patch.name || id,
      kicker: patch.family === 'fm'
        ? 'FM synth track'
        : patch.family === 'modern'
          ? 'Modern synth track'
          : 'Chip synth track',
      description: describePatch(patch),
      tags: [patch.family, patch.oscillator?.type, patch.filter?.type, patch.name].filter(Boolean),
    };
  };
  const chip = presets.filter(([, patch]) => (patch.family || 'chip') === 'chip').map(itemForPreset);
  const modern = presets.filter(([, patch]) => patch.family === 'modern').map(itemForPreset);
  const fm = presets.filter(([, patch]) => patch.family === 'fm').map(itemForPreset);
  const groups = [
    { id: 'chip', label: 'Chip presets', items: chip },
    { id: 'modern', label: 'Modern presets', items: modern },
  ];
  if (fm.length) groups.push({ id: 'fm', label: 'FM synths (2-operator)', items: fm });
  if (BUILTIN_SAMPLE_INSTRUMENTS.length) {
    groups.push({
      id: 'builtin-sample',
      label: 'Sample instruments',
      items: BUILTIN_SAMPLE_INSTRUMENTS.map(inst => ({
        value: inst.id,
        label: inst.name,
        kicker: inst.metadata.category ? `${inst.metadata.category} - CC0 sample` : 'CC0 sample',
        description: inst.metadata.range
          ? `Sampled ${inst.metadata.range} - notes outside this range fold in by octave`
          : 'Multi-sampled real instrument (downloads on first use)',
        tags: ['sample', inst.metadata.category, inst.metadata.range, inst.name].filter(Boolean),
      })),
    });
  }
  const custom = (project?.settings?.customInstruments || [])
    .filter(instrument => instrument.type === 'patch')
    .map(instrument => ({
      value: `custom:${instrument.id}`,
      label: instrument.name || 'Untitled instrument',
      kicker: 'Custom sample patch',
      description: instrument.playbackMode === 'oneShot' ? 'One-shot sample instrument' : 'Gated sample instrument',
      tags: ['custom', 'sample', instrument.name],
    }));
  if (custom.length) groups.push({ id: 'custom', label: 'Custom instruments', items: custom });
  return groups;
}

/** Built-in drum kits available across Canvas and Inspect. */
export function drumInstrumentGroups() {
  const builtIns = Object.entries(DRUM_KITS).map(([id, kit]) => ({
    value: id,
    label: kit.name,
    kicker: 'Drum kit',
    description: `${Object.keys(kit.sounds || {}).length} synthesized sounds`,
    tags: ['drum', 'kit', kit.name],
  }));
  return [{ id: 'drum', label: 'Drum kits', items: builtIns }];
}

/**
 * Resolve the display label for an instrument id. Used by Inspect to show
 * the current patch on the toolbar button, and to look up the chosen
 * value after a pick.
 *
 * @param {string} instrumentId
 * @param {object} [project]
 * @returns {string} Human-readable label, or the raw id if unknown.
 */
export function labelForInstrument(instrumentId, project = null) {
  if (!instrumentId) return 'Default';
  return resolveInstrumentDefinition(instrumentId, project)?.name || instrumentId;
}

function describePatch(patch = {}) {
  const bits = [];
  if (patch.type === 'fm') bits.push('2-op FM');
  else if (patch.oscillator?.type) bits.push(patch.oscillator.type);
  if (patch.unison?.voices) bits.push(`${patch.unison.voices}-voice unison`);
  if (patch.filterEnv) bits.push('filter motion');
  if (patch.vibrato) bits.push('vibrato');
  if (patch.drive) bits.push('drive');
  return bits.join(' - ') || 'Synth patch';
}
