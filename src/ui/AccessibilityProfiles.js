export const ACCESSIBILITY_DEFAULTS = {
  tremorFilter: {
    enabled: false,
    thresholdMs: 180,
  },
  dwellPlay: {
    enabled: false,
    thresholdMs: 450,
  },
};

const TREMOR_LAST_TRIGGER = new Map();

export function normalizeAccessibilitySettings(settings = {}) {
  return {
    tremorFilter: {
      enabled: !!settings?.tremorFilter?.enabled,
      thresholdMs: clampMs(settings?.tremorFilter?.thresholdMs, 60, 1000, ACCESSIBILITY_DEFAULTS.tremorFilter.thresholdMs),
    },
    dwellPlay: {
      enabled: !!settings?.dwellPlay?.enabled,
      thresholdMs: clampMs(settings?.dwellPlay?.thresholdMs, 150, 2000, ACCESSIBILITY_DEFAULTS.dwellPlay.thresholdMs),
    },
  };
}

export function ensureAccessibilitySettings(project) {
  if (!project) return normalizeAccessibilitySettings();
  project.settings ||= {};
  project.settings.accessibility = normalizeAccessibilitySettings(project.settings.accessibility);
  return project.settings.accessibility;
}

export function applyAccessibilityProfilesFromUrl(project, search = typeof window !== 'undefined' ? window.location.search : '') {
  if (!project) return [];
  const params = new URLSearchParams(search);
  const accessibility = ensureAccessibilitySettings(project);
  const enabled = [];

  if (params.has('tremor')) {
    accessibility.tremorFilter.enabled = true;
    enabled.push('Tremor filter');
  }

  if (params.has('dwell')) {
    accessibility.dwellPlay.enabled = true;
    enabled.push('Dwell play');
  }

  return enabled;
}

export function tremorAllows(project, targetKey) {
  const accessibility = normalizeAccessibilitySettings(project?.settings?.accessibility);
  if (!accessibility.tremorFilter.enabled) return true;

  const key = `${project?.id || 'global'}:${targetKey}`;
  const now = performance.now();
  const last = TREMOR_LAST_TRIGGER.get(key) || 0;
  if (now - last < accessibility.tremorFilter.thresholdMs) return false;
  TREMOR_LAST_TRIGGER.set(key, now);
  return true;
}

export function dwellSettings(project) {
  const accessibility = normalizeAccessibilitySettings(project?.settings?.accessibility);
  return accessibility.dwellPlay;
}

function clampMs(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
