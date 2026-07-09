/**
 * Height Velocity (Labs) — derive a discrete velocity from WHERE on a pad/key the
 * pointer strikes. Higher strike = louder, matching the visual shading on the
 * playable surfaces.
 *
 * Four snap levels keep dynamics repeatable (a reliable ghost note vs. accent) and
 * make them legible via gridlines. This is PURE geometry (getBoundingClientRect),
 * so it behaves identically on mouse, touch, and Safari/iOS — no PointerEvent.pressure,
 * which is unreliable for finger touch on every modern browser.
 *
 * The underlying value stays a continuous 0..1, so a future "continuous" mode is trivial.
 */

/** Four levels, soft → loud. Top band = loudest. */
export const HEIGHT_VELOCITY_LEVELS = [0.2, 0.4, 0.7, 0.99];
export const HEIGHT_VELOCITY_ZONES = HEIGHT_VELOCITY_LEVELS.length;

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/** Map a vertical fraction (0 = top of element) to a snapped velocity. Top is loudest. */
export function velocityForFraction(fractionFromTop) {
  // fractionFromTop is 0 at the top of the pad/key, 1 at the bottom. Striking HIGHER
  // (toward the top) plays louder, so velocity rises as fractionFromTop decreases.
  const fromTop = 1 - clamp01(fractionFromTop);
  const idx = Math.min(HEIGHT_VELOCITY_ZONES - 1, Math.floor(fromTop * HEIGHT_VELOCITY_ZONES));
  return HEIGHT_VELOCITY_LEVELS[idx];
}

/** Band index from the TOP (0 = top band) — used for gridline/active-zone highlighting. */
export function zoneIndexFromTop(fractionFromTop) {
  return Math.min(HEIGHT_VELOCITY_ZONES - 1, Math.floor(clamp01(fractionFromTop) * HEIGHT_VELOCITY_ZONES));
}

/**
 * Compute a snapped velocity from a pointer event over an element.
 * Returns null when geometry is unavailable (caller should fall back to its default).
 */
export function velocityFromPointer(event, el) {
  if (!event || !el || typeof el.getBoundingClientRect !== 'function') return null;
  const rect = el.getBoundingClientRect();
  if (!rect.height) return null;
  const y = (event.clientY ?? rect.top) - rect.top;
  return velocityForFraction(y / rect.height);
}
