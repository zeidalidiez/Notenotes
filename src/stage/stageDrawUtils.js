/**
 * stageDrawUtils — Pure helpers and constants shared by CanvasStageRenderer and
 * its stageDrawViews mixin (color math, pitch-class tables, event normalization).
 */

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function hexToRgb(hex = '#ffffff') {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#ffffff';
  return {
    r: parseInt(clean.slice(1, 3), 16),
    g: parseInt(clean.slice(3, 5), 16),
    b: parseInt(clean.slice(5, 7), 16),
  };
}

export function rgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const FIFTHS_PITCH_CLASSES = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export const PITCH_CLASS_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function normalizeEvent(event = {}) {
  return {
    ...event,
    lane: Math.max(0, Math.floor(Number(event.lane) || 0)),
    subLane: Math.max(0, Math.floor(Number(event.subLane) || 0)),
    subLaneCount: Math.max(1, Math.floor(Number(event.subLaneCount) || 1)),
    startTick: Math.max(0, Math.floor(Number(event.startTick) || 0)),
    endTick: event.endTick == null ? null : Math.max(0, Math.floor(Number(event.endTick) || 0)),
    durationTick: event.durationTick == null ? null : Math.max(1, Math.floor(Number(event.durationTick) || 1)),
    velocity: clamp(Number(event.velocity) || 0.8, 0, 1),
    color: event.color || '#ffffff',
    accentColor: event.accentColor || event.color || '#ffffff',
    label: event.label || event.drum || '',
  };
}
