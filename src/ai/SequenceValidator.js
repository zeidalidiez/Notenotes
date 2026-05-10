/**
 * SequenceValidator — Reject malformed or out-of-bounds sequences before
 * they touch the project.
 *
 * The LLM may return sequences that look schema-valid but violate runtime
 * constraints (e.g., padIndex past the current scale's pad count, beat
 * positions past lengthBars, drum names with typos). This validator catches
 * those and produces actionable error messages so the user can either retry
 * or surface the failure clearly.
 *
 * Pure function. No side effects. Single source of truth for "is this
 * sequence safe to execute."
 */

import {
  AI_INSTRUMENTS,
  ALLOWED_LENGTHS_BARS,
  KIT_DRUMS,
  MAX_DURATION_BEATS,
  MAX_EVENTS_PER_SEQUENCE,
  MAX_PAD_INDEX,
  MIDI_MAX,
  MIDI_MIN,
  MIN_DURATION_BEATS,
  MIN_EVENTS_PER_SEQUENCE,
} from './sequence-schema.js';

/**
 * @param {object} sequence - Untrusted, potentially LLM-emitted.
 * @param {object} context
 * @param {string} context.instrument - Expected instrument id.
 * @param {number} context.lengthBars - User-selected length; sequence must match.
 * @param {number} context.beatsPerBar - From transport.timeSignature.beats.
 * @param {number} [context.padCount] - For scaleboard: how many pads exist in
 *   the current scale. Events with padIndex >= padCount are rejected.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateSequence(sequence, context) {
  const errors = [];
  const warnings = [];

  if (!sequence || typeof sequence !== 'object') {
    return { valid: false, errors: ['Sequence is missing or not an object.'], warnings };
  }
  if (!context || !context.instrument || !AI_INSTRUMENTS[context.instrument]) {
    return { valid: false, errors: [`Validator context has an unknown instrument "${context?.instrument}".`], warnings };
  }
  const expectedInst = AI_INSTRUMENTS[context.instrument];

  if (sequence.instrument !== expectedInst.id) {
    errors.push(`Sequence instrument "${sequence.instrument}" does not match the active instrument "${expectedInst.id}".`);
  }

  if (!ALLOWED_LENGTHS_BARS.includes(sequence.lengthBars)) {
    errors.push(`lengthBars must be one of ${ALLOWED_LENGTHS_BARS.join(', ')}; got ${sequence.lengthBars}.`);
  }
  if (typeof context.lengthBars === 'number' && sequence.lengthBars !== context.lengthBars) {
    errors.push(`Sequence lengthBars (${sequence.lengthBars}) does not match the user-selected length (${context.lengthBars}).`);
  }

  if (!Array.isArray(sequence.events)) {
    errors.push('events is missing or not an array.');
    return { valid: false, errors, warnings };
  }
  if (sequence.events.length < MIN_EVENTS_PER_SEQUENCE) {
    errors.push(`Sequence has no events. Minimum ${MIN_EVENTS_PER_SEQUENCE}.`);
  }
  if (sequence.events.length > MAX_EVENTS_PER_SEQUENCE) {
    errors.push(`Sequence has too many events (${sequence.events.length}). Maximum ${MAX_EVENTS_PER_SEQUENCE}.`);
  }

  const beatsPerBar = Number(context.beatsPerBar) > 0 ? Number(context.beatsPerBar) : 4;
  const totalBeats = (Number(sequence.lengthBars) || 0) * beatsPerBar;

  // Per-event checks. We accumulate errors but cap to the first ~12 to keep
  // the error string readable in the toast.
  const ERROR_CAP = 12;
  for (let i = 0; i < sequence.events.length; i++) {
    if (errors.length >= ERROR_CAP) {
      errors.push(`(stopping at first ${ERROR_CAP} issues; fix these and re-validate)`);
      break;
    }
    const ev = sequence.events[i];
    const where = `events[${i}]`;
    if (!ev || typeof ev !== 'object') {
      errors.push(`${where}: not an object.`);
      continue;
    }
    if (typeof ev.beat !== 'number' || !Number.isFinite(ev.beat) || ev.beat < 0) {
      errors.push(`${where}: beat must be a non-negative number; got ${JSON.stringify(ev.beat)}.`);
    } else if (totalBeats > 0 && ev.beat >= totalBeats) {
      errors.push(`${where}: beat ${ev.beat} is past the end of the sequence (${totalBeats} beats).`);
    }
    if (ev.type !== expectedInst.eventType) {
      errors.push(`${where}: type "${ev.type}" is not allowed for ${expectedInst.id}; expected "${expectedInst.eventType}".`);
      continue;
    }
    switch (ev.type) {
      case 'padPress':
        validatePadPress(ev, where, errors, context);
        break;
      case 'noteOn':
        validateNoteOn(ev, where, errors);
        break;
      case 'drumHit':
        validateDrumHit(ev, where, errors);
        break;
      default:
        errors.push(`${where}: unknown event type "${ev.type}".`);
    }
  }

  // Soft warnings for things that are odd but not invalid.
  if (sequence.events.length > 0 && totalBeats > 0) {
    const firstBeat = sequence.events.reduce((min, ev) => Math.min(min, Number(ev.beat) || Infinity), Infinity);
    if (Number.isFinite(firstBeat) && firstBeat >= beatsPerBar) {
      warnings.push(`First event starts at beat ${firstBeat.toFixed(2)} (after the first bar). The snippet may sound like it begins late.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validatePadPress(ev, where, errors, context) {
  if (!Number.isInteger(ev.padIndex)) {
    errors.push(`${where}: padIndex must be an integer; got ${JSON.stringify(ev.padIndex)}.`);
    return;
  }
  if (ev.padIndex < 0 || ev.padIndex > MAX_PAD_INDEX) {
    errors.push(`${where}: padIndex ${ev.padIndex} is out of range 0..${MAX_PAD_INDEX}.`);
    return;
  }
  if (typeof context.padCount === 'number' && ev.padIndex >= context.padCount) {
    errors.push(`${where}: padIndex ${ev.padIndex} exceeds the active scale's pad count (${context.padCount}).`);
  }
  validateOptionalDuration(ev, where, errors);
  validateOptionalVelocity(ev, where, errors);
}

function validateNoteOn(ev, where, errors) {
  if (!Number.isInteger(ev.midi)) {
    errors.push(`${where}: midi must be an integer; got ${JSON.stringify(ev.midi)}.`);
    return;
  }
  if (ev.midi < MIDI_MIN || ev.midi > MIDI_MAX) {
    errors.push(`${where}: midi ${ev.midi} is out of range ${MIDI_MIN}..${MIDI_MAX}.`);
  }
  validateOptionalDuration(ev, where, errors);
  validateOptionalVelocity(ev, where, errors);
}

function validateDrumHit(ev, where, errors) {
  if (typeof ev.drum !== 'string') {
    errors.push(`${where}: drum must be a string; got ${JSON.stringify(ev.drum)}.`);
    return;
  }
  if (!KIT_DRUMS.includes(ev.drum)) {
    errors.push(`${where}: drum "${ev.drum}" is not a known kit voice (allowed: ${KIT_DRUMS.join(', ')}).`);
  }
  validateOptionalVelocity(ev, where, errors);
}

function validateOptionalDuration(ev, where, errors) {
  if (ev.durationBeats === undefined) return;
  if (typeof ev.durationBeats !== 'number' || !Number.isFinite(ev.durationBeats)) {
    errors.push(`${where}: durationBeats must be a number when present; got ${JSON.stringify(ev.durationBeats)}.`);
    return;
  }
  if (ev.durationBeats < MIN_DURATION_BEATS) {
    errors.push(`${where}: durationBeats ${ev.durationBeats} is too small (min ${MIN_DURATION_BEATS}).`);
  }
  if (ev.durationBeats > MAX_DURATION_BEATS) {
    errors.push(`${where}: durationBeats ${ev.durationBeats} is too long (max ${MAX_DURATION_BEATS}).`);
  }
}

function validateOptionalVelocity(ev, where, errors) {
  if (ev.velocity === undefined) return;
  if (typeof ev.velocity !== 'number' || !Number.isFinite(ev.velocity) || ev.velocity < 0 || ev.velocity > 1) {
    errors.push(`${where}: velocity must be a number 0..1 when present; got ${JSON.stringify(ev.velocity)}.`);
  }
}
