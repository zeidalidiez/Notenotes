/**
 * Humanize — tiny per-note / per-hit variation.
 *
 * Real players never repeat a note exactly; nudging pitch, level (and, for drums,
 * length) a hair removes the bit-identical "machine-gun" sameness that reads as
 * cheap MIDI. Ranges are deliberately small so it adds life without sounding sloppy.
 * This is performance nuance applied live; deterministic exports stay clean.
 */
export const rand = (a, b) => a + Math.random() * (b - a);
export const centsToRatio = (cents) => Math.pow(2, cents / 1200);

/** Subtle variation for a melodic synth voice. `strength` 0..1 scales it. */
export function humanize(strength = 1) {
  return {
    detuneCents: rand(-6, 6) * strength,   // analog-style pitch drift
    gainMul: 1 - rand(0, 0.16) * strength,  // each note a touch quieter sometimes
  };
}

/** Slightly stronger variation for a drum hit: pitch wobble, level, decay length. */
export function drumHumanize() {
  return {
    freqMul: centsToRatio(rand(-25, 25)),   // ±25 cents
    gainMul: 0.82 + Math.random() * 0.18,    // 0.82..1.00
    decayMul: 0.9 + Math.random() * 0.2,     // 0.90..1.10
  };
}
