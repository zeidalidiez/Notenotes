/**
 * settingsShared — Small pure helpers and constants shared across the
 * SettingsPanel tab modules.
 */

export const BACKUP_CONTENT_OPTIONS = [
  { id: 'current', label: 'Current workspace' },
  { id: 'milestones', label: 'Workspace + milestones' },
  { id: 'archive', label: 'Full archive' },
];

export function byteLength(text = '') {
  return new TextEncoder().encode(text).length;
}

export function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function percent(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}
