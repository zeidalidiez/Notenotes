/**
 * TapTempo - derive a BPM from the timing of repeated taps.
 *
 * The math is pure: the caller supplies each tap's timestamp (milliseconds,
 * e.g. from `performance.now()`), so this module has no clock of its own and is
 * fully deterministic to test. A gap longer than `resetMs` starts a fresh
 * count, so an old, abandoned tap never blends into a new tempo. Intervals are
 * kept in a small rolling window and averaged, then clamped to the same BPM
 * range the transport accepts.
 */

export const TAP_RESET_MS = 2000;   // a gap longer than this restarts counting
export const TAP_MIN_BPM = 40;      // matches Transport's bpm clamp
export const TAP_MAX_BPM = 240;
export const TAP_MAX_SAMPLES = 8;    // rolling window of recent intervals
export const TAP_MIN_TAPS = 2;       // need at least two taps for one interval

export function clampBpm(value, min = TAP_MIN_BPM, max = TAP_MAX_BPM) {
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Average a list of inter-tap intervals (ms) into a BPM. Returns null for an
 * empty/invalid list so callers can keep the current tempo until enough taps
 * land.
 */
export function bpmFromIntervals(intervals, { minBpm = TAP_MIN_BPM, maxBpm = TAP_MAX_BPM } = {}) {
  if (!Array.isArray(intervals) || !intervals.length) return null;
  const usable = intervals.filter(ms => Number.isFinite(ms) && ms > 0);
  if (!usable.length) return null;
  const avg = usable.reduce((sum, ms) => sum + ms, 0) / usable.length;
  if (!(avg > 0)) return null;
  return clampBpm(60000 / avg, minBpm, maxBpm);
}

export class TapTempo {
  constructor(options = {}) {
    this.resetMs = options.resetMs ?? TAP_RESET_MS;
    this.minBpm = options.minBpm ?? TAP_MIN_BPM;
    this.maxBpm = options.maxBpm ?? TAP_MAX_BPM;
    this.maxSamples = options.maxSamples ?? TAP_MAX_SAMPLES;
    this.reset();
  }

  reset() {
    this._lastTime = null;
    this._intervals = [];
  }

  /** Taps registered in the current (un-reset) run. */
  get tapCount() {
    return this._intervals.length + (this._lastTime != null ? 1 : 0);
  }

  /** Current derived BPM, or null until there are enough taps. */
  get bpm() {
    return bpmFromIntervals(this._intervals, { minBpm: this.minBpm, maxBpm: this.maxBpm });
  }

  /**
   * Register a tap at time `now` (ms) and return the current BPM (or null when
   * a tempo can't be derived yet). A non-monotonic timestamp is ignored; a gap
   * beyond `resetMs` restarts the count from this tap.
   */
  tap(now) {
    if (!Number.isFinite(now)) return this.bpm;

    if (this._lastTime == null) {
      this._lastTime = now;
      return this.bpm;
    }

    const delta = now - this._lastTime;
    if (delta <= 0) {
      // Ignore duplicate/out-of-order timestamps but keep the latest reference.
      this._lastTime = now;
      return this.bpm;
    }

    if (delta > this.resetMs) {
      this._intervals = [];
    } else {
      this._intervals.push(delta);
      if (this._intervals.length > this.maxSamples) this._intervals.shift();
    }
    this._lastTime = now;
    return this.bpm;
  }
}
