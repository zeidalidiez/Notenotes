export const ENVELOPE_CURVE_DEFAULTS = Object.freeze({
  attackShape: 0.62,
  decayShape: 1.9,
  releaseShape: 2.2,
  curvePoints: 48,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(Number(value) || 0, 0, 1);
}

export function envelopeSegmentProgress(progress, segment = 'attack') {
  const p = clamp01(progress);
  if (segment === 'attack') return Math.pow(p, ENVELOPE_CURVE_DEFAULTS.attackShape);
  if (segment === 'release') return 1 - Math.pow(1 - p, ENVELOPE_CURVE_DEFAULTS.releaseShape);
  return 1 - Math.pow(1 - p, ENVELOPE_CURVE_DEFAULTS.decayShape);
}

export function createEnvelopeParamCurve(from, to, segment = 'attack', points = ENVELOPE_CURVE_DEFAULTS.curvePoints) {
  const length = Math.max(2, Math.round(points));
  const curve = new Float32Array(length);
  const start = Number(from) || 0;
  const end = Number(to) || 0;
  for (let i = 0; i < length; i += 1) {
    const p = i / (length - 1);
    curve[i] = start + (end - start) * envelopeSegmentProgress(p, segment);
  }
  curve[0] = start;
  curve[length - 1] = end;
  return curve;
}

/**
 * Build a single curve spanning attack then decay over one continuous timeline,
 * sampled so the attack/decay shapes are identical to issuing two separate
 * `createEnvelopeParamCurve` calls — but as ONE `setValueCurveAtTime`, which
 * avoids the adjacent-curve overlap Chrome rejects when the decay's quantized
 * start frame lands at-or-before the attack's quantized end frame.
 *
 * Points are split proportional to each segment's duration so a short attack
 * is not stretched across half the array. The join sample is the shared
 * mid value (attack end === decay start).
 *
 * @param {number} from - Start value at t=0.
 * @param {number} mid - Value at the attack→decay join (attack peak).
 * @param {number} to - Final value at the end of decay.
 * @param {number} attackSec - Attack duration in seconds.
 * @param {number} decaySec - Decay duration in seconds.
 * @param {number} [points=ENVELOPE_CURVE_DEFAULTS.curvePoints] - Total sample budget.
 * @returns {Float32Array}
 */
export function createAttackDecayCurve(from, mid, to, attackSec, decaySec, points = ENVELOPE_CURVE_DEFAULTS.curvePoints) {
  const total = Math.max(2, Math.round(points));
  const attack = Math.max(0, Number(attackSec) || 0);
  const decay = Math.max(0, Number(decaySec) || 0);
  const span = attack + decay;
  let attackPoints = span > 0 ? Math.round((total - 1) * (attack / span)) : Math.floor((total - 1) / 2);
  attackPoints = Math.max(1, Math.min(total - 1, attackPoints));
  const decayPoints = total - attackPoints;
  const attackCurve = createEnvelopeParamCurve(from, mid, 'attack', attackPoints + 1);
  const decayCurve = createEnvelopeParamCurve(mid, to, 'decay', decayPoints);
  const combined = new Float32Array(total);
  combined.set(attackCurve.subarray(0, attackPoints), 0);
  combined.set(decayCurve, attackPoints);
  return combined;
}

export function adsrEnvelopeValueAt(t, durationSec, env = {}, velocity = 1) {
  const attack = Math.max(0.001, env.attack || 0.001);
  const decay = Math.max(0.001, env.decay || 0.001);
  const sustain = clamp(env.sustain ?? 0.6, 0, 1);
  const release = Math.max(0.001, env.release || 0.001);
  const elapsed = Math.max(0, Number(t) || 0);
  const level = clamp(Number(velocity) || 0, 0, 1.25);
  if (elapsed < attack) {
    return level * envelopeSegmentProgress(elapsed / attack, 'attack');
  }
  if (elapsed < attack + decay) {
    const progress = envelopeSegmentProgress((elapsed - attack) / decay, 'decay');
    return level * (1 + (sustain - 1) * progress);
  }
  if (elapsed <= durationSec) return level * sustain;
  const releaseProgress = envelopeSegmentProgress((elapsed - durationSec) / release, 'release');
  return Math.max(0, level * sustain * (1 - releaseProgress));
}
