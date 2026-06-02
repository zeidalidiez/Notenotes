function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Computes the visual quality budget for a Stage frame.
 *
 * Stage is a mirror of musical events, not an audio path. These helpers keep
 * dense performances and reduced-motion environments from spending too much
 * frame time on glow, trails, and decorative detail.
 */
export function stageRenderQuality(options = {}) {
  const eventCount = Math.max(0, Math.floor(finiteNumber(options.eventCount, 0)));
  const laneCount = Math.max(1, Math.floor(finiteNumber(options.laneCount, 1)));
  const reducedMotion = Boolean(options.reducedMotion);

  let shadowScale = 1;
  let trailScale = 1;
  let detail = 'full';

  if (eventCount > 180 || laneCount > 34) {
    shadowScale *= 0.42;
    trailScale *= 0.62;
    detail = 'minimal';
  } else if (eventCount > 100 || laneCount > 24) {
    shadowScale *= 0.62;
    trailScale *= 0.78;
    detail = 'reduced';
  } else if (eventCount > 52 || laneCount > 16) {
    shadowScale *= 0.78;
    trailScale *= 0.9;
    detail = 'reduced';
  }

  if (reducedMotion) {
    shadowScale *= 0.28;
    trailScale *= 0.48;
    detail = 'minimal';
  }

  return {
    eventCount,
    laneCount,
    reducedMotion,
    detail,
    shadowScale,
    trailScale,
  };
}

export function stageBlur(baseBlur, quality = stageRenderQuality()) {
  const base = Math.max(0, finiteNumber(baseBlur, 0));
  return clamp(base * finiteNumber(quality.shadowScale, 1), 0, 34);
}

export function stageTrailMs(baseMs, quality = stageRenderQuality()) {
  const base = Math.max(0, finiteNumber(baseMs, 0));
  return Math.max(120, Math.round(base * finiteNumber(quality.trailScale, 1)));
}

