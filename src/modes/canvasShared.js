/**
 * canvasShared — Shared constants and helpers for CanvasMode and its feature mixins.
 */

/** Pixels per bar at default zoom */
export const DEFAULT_BAR_WIDTH = 120;
export const LANE_COLORS = ['#6a8caf', '#8a6aaf', '#af8a6a', '#6aaf8a', '#af6a8a', '#8aaf6a'];

export function hexToRgba(hex, alpha = 0.35) {
  const clean = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#6a8caf';
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
