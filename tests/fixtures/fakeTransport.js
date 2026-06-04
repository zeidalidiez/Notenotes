/**
 * Minimal fake Transport for driving PlaybackEngine and RecordingManager
 * without the real lookahead scheduler. Exposes exactly the surface those
 * consumers read (discovered by grepping src/engine/PlaybackEngine.js and
 * RecordingManager.js): state, ticksPerBar, bpm/meter/timeSignature, the raw/
 * normalized tick getters, and onStateChange registration.
 */

import { TransportState } from '../../src/engine/Transport.js';

export function makeFakeTransport(opts = {}) {
  const stateListeners = [];
  const t = {
    state: opts.state ?? TransportState.PLAYING,
    ticksPerBar: opts.ticksPerBar ?? 1920,
    bpm: opts.bpm ?? 120,
    meter: opts.meter ?? { id: '4/4', beats: 4, division: 4 },
    timeSignature: opts.timeSignature ?? { beats: 4, subdivision: 4 },
    currentTick: opts.currentTick ?? 0,
    currentRawTick: opts.currentRawTick ?? 0,
    onStateChange(fn) {
      stateListeners.push(fn);
      return () => {
        const i = stateListeners.indexOf(fn);
        if (i !== -1) stateListeners.splice(i, 1);
      };
    },
    /** Test helper: set the position both transport getters report. */
    seek(tick) { this.currentTick = tick; this.currentRawTick = tick; },
    /** Test helper: emit a state change to RecordingManager's listener. */
    emitState(state, meta = {}) {
      this.state = state;
      for (const fn of [...stateListeners]) fn(state, meta);
    },
  };
  return t;
}
