export const RHYTHM_FIT_MODES = {
  FEEL: 'feel',
  EVEN: 'even',
};

export const RHYTHM_FIT_TARGETS = {
  ONE_BAR: 1920,
  TWO_BARS: 3840,
  FOUR_BARS: 7680,
};

export const RHYTHM_FIT_GRIDS = {
  EIGHTH: 240,
  SIXTEENTH: 120,
  EIGHTH_TRIPLET: 160,
  OFF: 0,
};

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function positiveInt(value, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sortedEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter(event => event && Number.isFinite(Number(event.startTick)))
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (Number(a.event.startTick) - Number(b.event.startTick)) || (a.index - b.index));
}

function fittedStartTicks(items, targetTicks, mode, strength, gridTicks, tailTicks) {
  if (!items.length) return [];
  if (items.length === 1) return [0];

  if (mode === RHYTHM_FIT_MODES.EVEN) {
    const step = targetTicks / Math.max(1, items.length);
    return items.map((_, index) => Math.round(step * index));
  }

  const firstTick = Number(items[0].event.startTick) || 0;
  const lastTick = Number(items[items.length - 1].event.startTick) || firstTick;
  const sourceSpan = Math.max(1, lastTick - firstTick);
  const endpoint = Math.max(0, targetTicks - Math.max(1, tailTicks));
  return items.map(({ event }, index) => {
    if (index === 0) return 0;
    if (index === items.length - 1) return endpoint;
    const proportional = ((Number(event.startTick) - firstTick) / sourceSpan) * endpoint;
    if (gridTicks <= 0 || strength <= 0) return Math.round(proportional);
    const snapped = Math.round(proportional / gridTicks) * gridTicks;
    return Math.round(proportional + ((snapped - proportional) * strength));
  });
}

function fittedDuration(event, index, starts, sourceScale, fallbackTicks, quantizeDurations) {
  if (!quantizeDurations || !Number.isFinite(Number(event.durationTick))) return event.durationTick;
  const fallback = Math.max(1, Math.round(fallbackTicks));
  const scaled = Math.max(1, Math.round(Number(event.durationTick) * sourceScale));
  const nextStart = starts[index + 1];
  const available = Number.isFinite(nextStart)
    ? Math.max(1, nextStart - starts[index])
    : fallback;
  return Math.max(1, Math.min(scaled, available));
}

export function fitRhythmEvents(events = [], options = {}) {
  const items = sortedEvents(events);
  const targetTicks = positiveInt(options.targetTicks, RHYTHM_FIT_TARGETS.ONE_BAR);
  const gridTicks = positiveInt(options.gridTicks, RHYTHM_FIT_GRIDS.SIXTEENTH);
  const mode = options.mode === RHYTHM_FIT_MODES.EVEN ? RHYTHM_FIT_MODES.EVEN : RHYTHM_FIT_MODES.FEEL;
  const strength = clamp01(options.strength);
  const quantizeDurations = !!options.quantizeDurations;
  const tailTicks = gridTicks > 0 ? gridTicks : 120;

  if (!items.length) {
    return {
      events: [],
      durationTicks: targetTicks,
      changed: false,
    };
  }

  const firstTick = Number(items[0].event.startTick) || 0;
  const lastTick = Number(items[items.length - 1].event.startTick) || firstTick;
  const endpoint = mode === RHYTHM_FIT_MODES.EVEN
    ? targetTicks
    : Math.max(1, targetTicks - tailTicks);
  const sourceScale = mode === RHYTHM_FIT_MODES.EVEN
    ? targetTicks / Math.max(1, items.length * Math.max(1, ...items.map(({ event }) => Number(event.durationTick) || 0)))
    : endpoint / Math.max(1, lastTick - firstTick);
  const durationFallbackTicks = mode === RHYTHM_FIT_MODES.EVEN
    ? targetTicks / Math.max(1, items.length)
    : tailTicks;
  const starts = fittedStartTicks(items, targetTicks, mode, strength, gridTicks, tailTicks)
    .map(tick => Math.max(0, Math.min(targetTicks, Math.round(tick))));

  const fitted = items.map(({ event }, index) => ({
    ...event,
    startTick: starts[index],
    ...(Object.prototype.hasOwnProperty.call(event, 'durationTick')
      ? { durationTick: fittedDuration(event, index, starts, sourceScale, durationFallbackTicks, quantizeDurations) }
      : {}),
  }));

  const changed = fitted.some((event, index) => {
    const original = items[index].event;
    return event.startTick !== original.startTick || event.durationTick !== original.durationTick;
  });

  return {
    events: fitted,
    durationTicks: targetTicks,
    changed,
  };
}
