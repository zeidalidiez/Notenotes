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

import { TRACK_INSTRUMENTS } from '../engine/PlaybackEngine.js';
import { DRUM_KITS } from '../instruments/SketchKit.js';
import { PRESETS } from '../instruments/WebAudioSynth.js';

/** Built-in MIDI patches and sample-based custom patch instruments. */
export function midiInstrumentGroups(project = null) {
  const builtIns = Object.values(TRACK_INSTRUMENTS).filter(inst => inst.type === 'synth');
  const itemForBuiltIn = inst => {
    const patch = PRESETS[inst.preset] || PRESETS[inst.id] || {};
    return {
      value: inst.id,
      label: inst.name,
      kicker: (patch.family || 'chip') === 'modern' ? 'Modern synth track' : 'Chip synth track',
      description: describePatch(patch),
      tags: [patch.family, patch.oscillator?.type, patch.filter?.type, inst.name].filter(Boolean),
    };
  };
  const chip = builtIns.filter(inst => (PRESETS[inst.preset]?.family || 'chip') === 'chip').map(itemForBuiltIn);
  const modern = builtIns.filter(inst => PRESETS[inst.preset]?.family === 'modern').map(itemForBuiltIn);
  const groups = [
    { id: 'chip', label: 'Chip presets', items: chip },
    { id: 'modern', label: 'Modern presets', items: modern },
  ];
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

/** Built-in drum kits and sample-based custom kit instruments. */
export function drumInstrumentGroups(project = null) {
  const builtIns = Object.entries(DRUM_KITS).map(([id, kit]) => ({
    value: id,
    label: kit.name,
    kicker: 'Drum kit',
    description: `${Object.keys(kit.sounds || {}).length} synthesized sounds`,
    tags: ['drum', 'kit', kit.name],
  }));
  const groups = [{ id: 'drum', label: 'Drum kits', items: builtIns }];
  const custom = (project?.settings?.customInstruments || [])
    .filter(instrument => instrument.type === 'kit')
    .map(instrument => ({
      value: `custom:${instrument.id}`,
      label: instrument.name || 'Untitled kit',
      kicker: 'Custom kit',
      description: 'Custom drum instrument',
      tags: ['custom', 'kit', instrument.name],
    }));
  if (custom.length) groups.push({ id: 'custom', label: 'Custom instruments', items: custom });
  return groups;
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
  if (instrumentId.startsWith('custom:')) {
    const custom = (project?.settings?.customInstruments || []).find(
      inst => inst.id === instrumentId.slice(7)
    );
    return custom?.name || instrumentId;
  }
  const trackInst = TRACK_INSTRUMENTS[instrumentId];
  if (trackInst?.name) return trackInst.name;
  const kit = DRUM_KITS[instrumentId];
  if (kit?.name) return kit.name;
  const preset = PRESETS[instrumentId];
  if (preset?.name) return preset.name;
  return instrumentId;
}

function describePatch(patch = {}) {
  const bits = [];
  if (patch.oscillator?.type) bits.push(patch.oscillator.type);
  if (patch.unison?.voices) bits.push(`${patch.unison.voices}-voice unison`);
  if (patch.filterEnv) bits.push('filter motion');
  if (patch.vibrato) bits.push('vibrato');
  if (patch.drive) bits.push('drive');
  return bits.join(' - ') || 'Synth patch';
}
