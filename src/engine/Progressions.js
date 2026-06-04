/**
 * Progressions - project-level harmonic context helpers.
 *
 * A progression is stored as scale degrees, not absolute notes. Resolution
 * happens against the current project key/scale so old snippets and clips keep
 * their own notes while new visual layers can ask "what chord is hot now?"
 */

import {
  SCALES,
  getScaleNotes,
  noteNameToMidi,
  normalizeMusicalContext,
} from './MusicTheory.js';
import { scaleChordRecipes } from './ScaleChords.js';

export const PROGRESSION_ADVANCE_MODES = {
  manual: 'manual',
  strict: 'strict',
};

export const PROGRESSION_CHORD_TYPES = {
  triad: 'triad',
  seventh: 'seventh',
};

export const DEFAULT_PROGRESSION_CONTEXT = {
  enabled: false,
  id: 'off',
  name: 'Off',
  advance: PROGRESSION_ADVANCE_MODES.manual,
  chordType: PROGRESSION_CHORD_TYPES.triad,
  activeStepIndex: 0,
  steps: [],
};

export const DEFAULT_PROGRESSION_GLOW = {
  enabled: true,
  intensity: 0.28,
};

export const PROGRESSION_PRESETS = {
  axis: {
    id: 'axis',
    name: 'The Axis',
    description: 'I-V-vi-IV pop movement.',
    steps: progressionSteps(['I', 'V', 'vi', 'IV']),
  },
  dooWop: {
    id: 'dooWop',
    name: 'Doo-wop',
    description: 'I-vi-IV-V classic loop.',
    steps: progressionSteps(['I', 'vi', 'IV', 'V']),
  },
  sadHopeful: {
    id: 'sadHopeful',
    name: 'Sad but hopeful',
    description: 'vi-IV-I-V emotional pop loop.',
    steps: progressionSteps(['vi', 'IV', 'I', 'V']),
  },
  jazzTurnaround: {
    id: 'jazzTurnaround',
    name: 'Jazz turnaround',
    description: 'ii-V-I, best with sevenths.',
    chordType: PROGRESSION_CHORD_TYPES.seventh,
    steps: progressionSteps(['ii', 'V', 'I']),
  },
  threeChord: {
    id: 'threeChord',
    name: 'Three-chord',
    description: 'I-IV-V home base.',
    steps: progressionSteps(['I', 'IV', 'V']),
  },
  mixolydianRock: {
    id: 'mixolydianRock',
    name: 'Mixolydian rock',
    description: 'I-bVII-IV rock color.',
    steps: progressionSteps(['I', 'bVII', 'IV']),
  },
  twelveBarBlues: {
    id: 'twelveBarBlues',
    name: '12-bar blues',
    description: 'A simple I/IV/V blues map.',
    steps: progressionSteps(['I', 'I', 'I', 'I', 'IV', 'IV', 'I', 'I', 'V', 'IV', 'I', 'V']),
  },
};

export function progressionLabel(value = null) {
  const context = normalizeProgressionContext(value);
  return context.enabled ? context.name : 'Off';
}

export function progressionChoiceGroups(context = null) {
  const musicalContext = context ? normalizeMusicalContext(context) : null;
  const visiblePresetItem = (id) => {
    if (musicalContext && !progressionFitsContext(progressionPreset(id), musicalContext)) return null;
    return presetItem(id);
  };
  const visiblePresetItems = (ids) => ids.map(visiblePresetItem).filter(Boolean);

  return [
    {
      id: 'basic',
      label: 'Basic',
      items: [
        {
          value: 'off',
          label: 'Off',
          kicker: 'No changes',
          description: 'No progression context. Notes and clips behave normally.',
          tags: ['none', 'silent', 'default'],
        },
        ...visiblePresetItems(['axis', 'dooWop', 'sadHopeful', 'threeChord']),
      ],
    },
    {
      id: 'color',
      label: 'Color',
      items: visiblePresetItems(['jazzTurnaround', 'mixolydianRock', 'twelveBarBlues']),
    },
  ].filter(group => group.items.length);
}

const ROMAN_DEGREES = {
  i: 0,
  ii: 1,
  iii: 2,
  iv: 3,
  v: 4,
  vi: 5,
  vii: 6,
};

const MAJOR_DEGREE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

function progressionSteps(degrees) {
  return degrees.map(degree => ({ degree, durationBars: 1 }));
}

function presetItem(id) {
  const preset = PROGRESSION_PRESETS[id];
  return {
    value: id,
    label: preset.name,
    kicker: preset.steps.map(step => step.degree).join(' - '),
    description: preset.description || '',
    tags: [id, preset.chordType || PROGRESSION_CHORD_TYPES.triad],
  };
}

function cloneSteps(steps) {
  return (Array.isArray(steps) ? steps : [])
    .map(step => ({ ...step }));
}

export function progressionPreset(id) {
  const preset = PROGRESSION_PRESETS[id];
  if (!preset) return null;
  return {
    ...preset,
    enabled: true,
    // Presets follow playback by default: selecting Changes should make the
    // chord-tone glow walk the progression bar by bar. `manual` stays a valid
    // stored mode so old projects (and a future explicit step-control UI) keep
    // their frozen active step.
    advance: PROGRESSION_ADVANCE_MODES.strict,
    chordType: preset.chordType || PROGRESSION_CHORD_TYPES.triad,
    activeStepIndex: 0,
    steps: cloneSteps(preset.steps),
  };
}

export function normalizeProgressionContext(value = {}) {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PROGRESSION_CONTEXT, steps: [] };

  const preset = typeof value.id === 'string' && value.id !== 'off' ? progressionPreset(value.id) : null;
  const raw = preset ? { ...preset, ...value } : value;
  const steps = normalizeProgressionSteps(raw.steps);
  const activeStepIndex = Math.max(0, Math.min(
    Math.max(0, steps.length - 1),
    Number.isInteger(raw.activeStepIndex) ? raw.activeStepIndex : 0
  ));

  return {
    enabled: !!raw.enabled && steps.length > 0,
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : DEFAULT_PROGRESSION_CONTEXT.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : DEFAULT_PROGRESSION_CONTEXT.name,
    advance: Object.values(PROGRESSION_ADVANCE_MODES).includes(raw.advance)
      ? raw.advance
      : DEFAULT_PROGRESSION_CONTEXT.advance,
    chordType: Object.values(PROGRESSION_CHORD_TYPES).includes(raw.chordType)
      ? raw.chordType
      : DEFAULT_PROGRESSION_CONTEXT.chordType,
    activeStepIndex,
    steps,
  };
}

export function normalizeProgressionSteps(steps = []) {
  if (!Array.isArray(steps)) return [];
  return steps
    .map(step => normalizeProgressionStep(step))
    .filter(Boolean);
}

export function normalizeProgressionStep(step = {}) {
  const degree = normalizeDegreeToken(step?.degree);
  if (!degree) return null;
  const duration = Number(step.durationBars);
  return {
    degree,
    durationBars: Number.isFinite(duration) ? Math.max(0.25, Math.min(16, duration)) : 1,
  };
}

export function normalizeDegreeToken(value) {
  const degree = typeof value === 'string' ? value.trim() : '';
  if (!degree) return '';
  const parsed = parseDegreeToken(degree);
  return parsed ? parsed.normalized : '';
}

export function parseDegreeToken(value) {
  const degree = typeof value === 'string' ? value.trim() : '';
  const match = degree.match(/^([b#]*)([ivIV]+)([+°ø]?)$/);
  if (!match) return null;
  const [, accidentalText, romanText, suffix] = match;
  const romanKey = romanText.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(ROMAN_DEGREES, romanKey)) return null;

  let accidental = 0;
  for (const char of accidentalText) accidental += char === '#' ? 1 : -1;

  return {
    normalized: `${accidentalText}${romanText}${suffix || ''}`,
    roman: romanText,
    degreeIndex: ROMAN_DEGREES[romanKey],
    accidental,
    suffix: suffix || '',
  };
}

export function resolveProgressionStep(step, context = {}, options = {}) {
  const normalizedStep = normalizeProgressionStep(step);
  if (!normalizedStep) return null;

  const musicalContext = normalizeMusicalContext(context);
  const chordType = Object.values(PROGRESSION_CHORD_TYPES).includes(options.chordType)
    ? options.chordType
    : PROGRESSION_CHORD_TYPES.triad;

  const curated = resolveCuratedStep(normalizedStep, musicalContext);
  const midis = curated?.midis || resolveStackedScaleStep(normalizedStep, musicalContext, chordType);
  if (!midis.length) return null;

  return {
    degree: normalizedStep.degree,
    durationBars: normalizedStep.durationBars,
    chordType,
    midis,
    pitchClasses: midis.map(midi => ((midi % 12) + 12) % 12),
    label: curated?.label || normalizedStep.degree,
    name: curated?.name || normalizedStep.degree,
  };
}

export function activeProgressionResolution(progression = {}, context = {}) {
  const normalized = normalizeProgressionContext(progression);
  if (!normalized.enabled || !normalized.steps.length) return null;
  const step = normalized.steps[normalized.activeStepIndex] || normalized.steps[0];
  return resolveProgressionStep(step, context, { chordType: normalized.chordType });
}

/**
 * Total length of one pass through the progression, in bars. Honors each
 * step's `durationBars`. Returns 0 when the progression has no usable steps.
 */
export function progressionTotalBars(progression = {}) {
  const normalized = normalizeProgressionContext(progression);
  return normalized.steps.reduce((sum, step) => sum + step.durationBars, 0);
}

/**
 * Which step index is active at an absolute (0-based) bar position, looping
 * the progression over its total length and honoring per-step `durationBars`.
 * This is the pure core of "advance through the progression" bar-following.
 * Returns 0 for empty/invalid progressions so callers can glow the tonic.
 */
export function progressionStepIndexForBar(progression = {}, bar = 0) {
  const normalized = normalizeProgressionContext(progression);
  const steps = normalized.steps;
  if (!steps.length) return 0;

  const total = steps.reduce((sum, step) => sum + step.durationBars, 0);
  if (!(total > 0)) return 0;

  const safeBar = Number.isFinite(bar) ? bar : 0;
  let pos = safeBar % total;
  if (pos < 0) pos += total;

  let cursor = 0;
  for (let i = 0; i < steps.length; i++) {
    cursor += steps[i].durationBars;
    if (pos < cursor) return i;
  }
  return steps.length - 1;
}

/**
 * Manual next/prev for the active step. Returns a normalized progression with
 * `activeStepIndex` nudged by `delta` and wrapped within the step list. Used by
 * explicit step controls and tests; bar-following uses the index helper above.
 */
export function advanceProgressionContext(progression = {}, delta = 1) {
  const normalized = normalizeProgressionContext(progression);
  const len = normalized.steps.length;
  if (!len) return normalized;
  const step = Number.isInteger(delta) ? delta : Math.trunc(delta) || 1;
  const next = (((normalized.activeStepIndex + step) % len) + len) % len;
  return { ...normalized, activeStepIndex: next };
}

export function progressionFitsContext(progression = {}, context = {}) {
  const normalized = normalizeProgressionContext(progression);
  if (!normalized.enabled) return true;
  return normalized.steps.every(step =>
    !!resolveProgressionStep(step, context, { chordType: normalized.chordType })
  );
}

export function normalizeProgressionGlow(value = {}) {
  const intensity = Number(value?.intensity);
  return {
    enabled: value?.enabled !== false,
    intensity: Number.isFinite(intensity)
      ? Math.max(0.08, Math.min(0.85, intensity))
      : DEFAULT_PROGRESSION_GLOW.intensity,
  };
}

function resolveCuratedStep(step, context) {
  const recipes = scaleChordRecipes(context.scale);
  if (!recipes) return null;
  const recipe = recipes.find(item => item.label === step.degree);
  if (!recipe) return null;
  const rootMidi = noteNameToMidi(context.root, 4);
  return {
    label: recipe.label,
    name: recipe.name,
    midis: recipe.semitones.map(offset => rootMidi + offset),
  };
}

function resolveStackedScaleStep(step, context, chordType) {
  const parsed = parseDegreeToken(step.degree);
  const scale = SCALES[context.scale] || SCALES.major;
  if (!parsed || !scale?.intervals?.length) return [];

  const rootMidi = noteNameToMidi(context.root, 4);
  const targetInterval = modulo12(MAJOR_DEGREE_INTERVALS[parsed.degreeIndex] + parsed.accidental);
  const desiredPitchClass = modulo12(rootMidi + targetInterval);
  const scaleNotes = getScaleNotes(context.scale, context.root, 4, 48);
  const rootIndex = scaleNotes.findIndex(midi => midi >= rootMidi && modulo12(midi) === desiredPitchClass);
  if (rootIndex < 0) return [];

  const chordSize = chordType === PROGRESSION_CHORD_TYPES.seventh ? 4 : 3;
  const midis = [];
  for (let i = 0; i < chordSize; i++) {
    const midi = scaleNotes[rootIndex + i * 2];
    if (Number.isFinite(midi)) midis.push(midi);
  }
  return midis;
}

function modulo12(value) {
  return ((value % 12) + 12) % 12;
}
