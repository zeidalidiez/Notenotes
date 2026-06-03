/**
 * DegreePalettes - selectable color palettes for the degree-coloring system.
 *
 * Degree colors are keyed by chromatic interval from the root (0..11). The
 * default palette is the original vivid rainbow. The others are chosen to stay
 * distinguishable for people with color-vision deficiency (CVD):
 *
 * - `cbSafe`: a curated set drawn from the Okabe-Ito and Paul Tol CVD-safe
 *   palettes, spread across hue and lightness so adjacent degrees don't collide
 *   for deuteranopia/protanopia/tritanopia.
 * - `viridis`: a perceptually-uniform ramp whose lightness increases
 *   monotonically, so degrees stay orderable even with full color blindness.
 *
 * This module is pure data + helpers (no DOM, no other engine imports), so it
 * can be the single source of degree-color truth and is easy to test.
 */

export const DEFAULT_DEGREE_PALETTE_ID = 'default';

export const DEGREE_PALETTES = {
  default: {
    id: 'default',
    name: 'Vivid',
    description: 'The original bright rainbow.',
    colors: {
      0: '#ff6b6b', 1: '#ff8a5c', 2: '#f7b267', 3: '#d16fcb',
      4: '#7bd88f', 5: '#5bd6d6', 6: '#6fb4ff', 7: '#7d8cff',
      8: '#a884ff', 9: '#d783ff', 10: '#ff77c8', 11: '#f05d8e',
    },
  },
  cbSafe: {
    id: 'cbSafe',
    name: 'Color-blind safe',
    description: 'Distinct for red-green and blue-yellow color vision.',
    colors: {
      0: '#0072b2', 1: '#56b4e9', 2: '#009e73', 3: '#66c2a5',
      4: '#f0e442', 5: '#e69f00', 6: '#d55e00', 7: '#cc79a7',
      8: '#999999', 9: '#117733', 10: '#882255', 11: '#ddcc77',
    },
  },
  viridis: {
    id: 'viridis',
    name: 'Brightness ramp',
    description: 'Lightness increases by degree — orderable for any color vision.',
    colors: {
      0: '#440154', 1: '#481668', 2: '#472d7b', 3: '#414487',
      4: '#355f8d', 5: '#2a768e', 6: '#21918c', 7: '#22a884',
      8: '#44bf70', 9: '#7ad151', 10: '#bddf26', 11: '#fde725',
    },
  },
};

export function normalizeDegreePaletteId(id) {
  return (typeof id === 'string' && DEGREE_PALETTES[id]) ? id : DEFAULT_DEGREE_PALETTE_ID;
}

/** A fresh copy of a palette's 12 interval colors (safe to mutate). */
export function degreeColorsForPalette(id) {
  const palette = DEGREE_PALETTES[normalizeDegreePaletteId(id)];
  return { ...palette.colors };
}

/** Options for a palette picker: [{ value, label, description }]. */
export function degreePaletteOptions() {
  return Object.values(DEGREE_PALETTES).map(p => ({
    value: p.id,
    label: p.name,
    description: p.description,
  }));
}

/** Relative luminance (WCAG) of a #rrggbb color, 0 (black) .. 1 (white). */
export function relativeLuminance(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex).trim());
  if (!m) return 0;
  const channel = (v) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [channel(m[1]), channel(m[2]), channel(m[3])];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1 .. 21). */
export function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}
