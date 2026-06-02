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
