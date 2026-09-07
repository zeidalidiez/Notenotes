/**
 * Transport — Play/pause/stop/loop state machine.
 * Manages BPM, time signature, position tracking, and the scheduling clock.
 * 
 * Uses a lookahead scheduler pattern for rock-solid timing:
 * - A JS timer fires frequently (25ms)
 * - Schedules audio events slightly ahead (100ms lookahead)
 * - This decouples timing accuracy from the main thread
 */

import { AudioEngine } from './AudioEngine.js';
import { meterToTimeSignature, normalizeMeter, pulseForTick, pulseTicksForMeter, secondsPerTickForMeter, ticksPerBarForMeter } from './Meter.js';

/** Transport states */
export const TransportState = {
  STOPPED: 'stopped',
  PLAYING: 'playing',
  RECORDING: 'recording'
};

export class Transport {
  constructor() {
    this.engine = AudioEngine.getInstance();

    // Tempo & time signature
    this._bpm = 120;
    this._meter = normalizeMeter('4/4');
    this._timeSignature = meterToTimeSignature(this._meter); // legacy mirror

    // Transport state
    this.state = TransportState.STOPPED;

    // Position (in ticks — 480 ticks per quarter note, standard MIDI resolution)
    this.ticksPerBeat = 480;
    this._currentTick = 0;
    this._startTime = 0; // AudioContext time when playback started
    this._startTick = 0; // Tick position when playback started
    this._tempoSegments = [];

    // Loop
    this.loopEnabled = true;
    this.loopStartBar = 0;
    this.loopEndBar = 4;   // Default: 4-bar loop

    // Timeline limit: 10 minutes
    this._maxDurationSeconds = 600;

    // Scheduler
    this._scheduleAheadTime = 0.1;  // 100ms lookahead
    this._schedulerInterval = 25;    // 25ms timer interval
    this._schedulerTimerId = null;
    this._nextTickTime = 0;
    this._nextRawTick = 0;
    this._lastLoopCycle = 0;

    // Callbacks
    this._onTick = [];
    this._onBeat = [];
    this._onBar = [];
    this._onStateChange = [];
    this._onLoop = [];
  }

  // --- Properties ---

  get bpm() { return this._bpm; }
  set bpm(value) {
    const next = Math.max(40, Math.min(240, Math.round(value)));
    if (next === this._bpm) return;
    this._changeClockRate(() => { this._bpm = next; });
  }

  get timeSignature() { return this._timeSignature; }
  set timeSignature(ts) {
    this.meter = normalizeMeter(ts);
  }

  get meter() { return this._meter; }
  set meter(value) {
    const next = normalizeMeter(value);
    const same = this._meter?.id === next.id
      && JSON.stringify(this._meter?.grouping || []) === JSON.stringify(next.grouping || []);
    if (same) return;
    this._changeClockRate(() => {
      this._meter = next;
      this._timeSignature = meterToTimeSignature(this._meter);
    });
  }

  /** Ticks per bar based on current time signature */
  get ticksPerBar() {
    return ticksPerBarForMeter(this._meter, this.ticksPerBeat);
  }

  get pulseCount() {
    return pulseTicksForMeter(this._meter, this.ticksPerBeat).length;
  }

  get pulseTicks() {
    return pulseTicksForMeter(this._meter, this.ticksPerBeat);
  }

  get ticksPerPulse() {
    const pulses = Math.max(1, this.pulseCount);
    return this.ticksPerBar / pulses;
  }

  /** Current tick position */
  get currentTick() {
    if (this.state === TransportState.STOPPED) return this._currentTick;
    return this._normalizeTick(this._rawTickAtTime(this.engine.currentTime));
  }

  /** Current unlooped tick position, useful for long recordings */
  get currentRawTick() {
    if (this.state === TransportState.STOPPED) return this._currentTick;
    return Math.max(0, this._rawTickAtTime(this.engine.currentTime));
  }

  /** Current beat (0-indexed within bar) */
  get currentBeat() {
    return pulseForTick(this._meter, this.currentTick, this.ticksPerBeat);
  }

  /** Current bar (0-indexed) */
  get currentBar() {
    return Math.floor(this.currentTick / this.ticksPerBar);
  }

  /** Current position as fraction of a beat (for sub-beat precision) */
  get currentBeatFraction() {
    return (this.currentTick % this.ticksPerBeat) / this.ticksPerBeat;
  }

  /** Seconds per beat */
  get secondsPerBeat() {
    return 60 / this._bpm;
  }

  /** Seconds per tick */
  get secondsPerTick() {
    return secondsPerTickForMeter(this._meter, this._bpm, this.ticksPerBeat);
  }

  /** Maximum bars (derived from 10-minute limit) */
  get maxBars() {
    const secondsPerBar = this.secondsPerTick * this.ticksPerBar;
    return Math.floor(this._maxDurationSeconds / secondsPerBar);
  }

  /** Loop start in ticks */
  get loopStartTick() {
    return this.loopStartBar * this.ticksPerBar;
  }

  /** Loop end in ticks */
  get loopEndTick() {
    return this.loopEndBar * this.ticksPerBar;
  }

  // --- Event Registration ---

  onTick(fn) { this._onTick.push(fn); return () => this._off(this._onTick, fn); }
  onBeat(fn) { this._onBeat.push(fn); return () => this._off(this._onBeat, fn); }
  onBar(fn) { this._onBar.push(fn); return () => this._off(this._onBar, fn); }
  onStateChange(fn) { this._onStateChange.push(fn); return () => this._off(this._onStateChange, fn); }
  onLoop(fn) { this._onLoop.push(fn); return () => this._off(this._onLoop, fn); }

  _off(arr, fn) {
    const idx = arr.indexOf(fn);
    if (idx !== -1) arr.splice(idx, 1);
  }

  _emit(arr, ...args) {
    for (const fn of arr) fn(...args);
  }

  // --- Controls ---

  play() {
    if (this.state === TransportState.PLAYING) return;
    this.engine.resume();

    this._startTime = this.engine.currentTime;
    this._startTick = this._currentTick;
    this._nextRawTick = this._startTick;
    this._nextTickTime = this.engine.currentTime;
    this._lastLoopCycle = this._loopCycleForRawTick(this._startTick);
    this._resetTempoSegments();

    this.state = TransportState.PLAYING;
    this._emit(this._onStateChange, this.state);
    this._startScheduler();
  }

  record() {
    if (this.state === TransportState.RECORDING) return;
    this.engine.resume();

    this._startTime = this.engine.currentTime;
    this._startTick = this._currentTick;
    this._nextRawTick = this._startTick;
    this._nextTickTime = this.engine.currentTime;
    this._lastLoopCycle = this._loopCycleForRawTick(this._startTick);
    this._resetTempoSegments();

    this.state = TransportState.RECORDING;
    this._emit(this._onStateChange, this.state);
    this._startScheduler();
  }

  pause() {
    if (this.state === TransportState.STOPPED) return;
    const stoppedAtTick = this.currentTick;
    const stoppedAtRawTick = this.currentRawTick;
    this._currentTick = stoppedAtTick;
    this.state = TransportState.STOPPED;
    this._stopScheduler();
    this._emit(this._onStateChange, this.state, { tick: stoppedAtTick, rawTick: stoppedAtRawTick });
  }

  stop() {
    const stoppedAtTick = this.currentTick;
    const stoppedAtRawTick = this.currentRawTick;
    this.state = TransportState.STOPPED;
    this._currentTick = this.loopEnabled ? this.loopStartTick : 0;
    this._lastLoopCycle = 0;
    this._stopScheduler();
    this._emit(this._onStateChange, this.state, { tick: stoppedAtTick, rawTick: stoppedAtRawTick });
  }

  /** Toggle play/pause */
  toggle() {
    if (this.state === TransportState.STOPPED) {
      this.play();
    } else {
      this.pause();
    }
  }

  /** Set position to a specific bar */
  seekToBar(bar) {
    const wasStopped = this.state === TransportState.STOPPED;
    if (!wasStopped) this.pause();
    this._currentTick = Math.max(0, bar) * this.ticksPerBar;
    if (!wasStopped) this.play();
  }

  /** Set loop region */
  setLoop(startBar, endBar) {
    this.loopStartBar = Math.max(0, startBar);
    this.loopEndBar = Math.min(this.maxBars, Math.max(this.loopStartBar + 1, endBar));
  }

  _resetTempoSegments() {
    this._tempoSegments = [{
      audioTime: this._startTime,
      tick: this._startTick,
      secondsPerTick: this.secondsPerTick,
    }];
  }

  _changeClockRate(applyChange) {
    if (this.state === TransportState.STOPPED || !this.engine.ctx) {
      applyChange();
      this._tempoSegments = [];
      return;
    }

    // Audio already emitted inside the lookahead window cannot be unscheduled.
    // Make the new rate effective at the first unscheduled audio time, with an
    // exact tick anchor computed under the old rate. Current position therefore
    // remains continuous and scheduled events never overlap or disappear.
    const effectiveTime = Math.max(this.engine.currentTime, this._nextTickTime);
    const anchorTick = this._rawTickFloatAtTime(effectiveTime);
    applyChange();
    this._tempoSegments = this._tempoSegments.filter(segment => segment.audioTime < effectiveTime);
    this._tempoSegments.push({
      audioTime: effectiveTime,
      tick: anchorTick,
      secondsPerTick: this.secondsPerTick,
    });
  }

  _rawTickFloatAtTime(audioTime) {
    if (!this._tempoSegments.length) {
      const elapsed = audioTime - this._startTime;
      return this._startTick + elapsed / this.secondsPerTick;
    }
    let segment = this._tempoSegments[0];
    for (const candidate of this._tempoSegments) {
      if (candidate.audioTime > audioTime) break;
      segment = candidate;
    }
    return segment.tick + (audioTime - segment.audioTime) / segment.secondsPerTick;
  }

  _rawTickAtTime(audioTime) {
    return Math.floor(this._rawTickFloatAtTime(audioTime) + 1e-7);
  }

  _audioTimeForRawTick(tick) {
    let segment = this._tempoSegments[0];
    for (const candidate of this._tempoSegments) {
      if (candidate.tick > tick) break;
      segment = candidate;
    }
    return segment.audioTime + (tick - segment.tick) * segment.secondsPerTick;
  }

  _normalizeTick(rawTick, loopStart = this.loopStartTick, loopEnd = this.loopEndTick) {
    if (!this.loopEnabled) return Math.max(0, rawTick);

    const loopLength = loopEnd - loopStart;
    if (loopLength <= 0 || rawTick < loopEnd) return Math.max(0, rawTick);

    return loopStart + ((rawTick - loopStart) % loopLength);
  }

  _loopCycleForRawTick(rawTick, loopStart = this.loopStartTick, loopEnd = this.loopEndTick) {
    if (!this.loopEnabled) return 0;

    const loopLength = loopEnd - loopStart;
    if (loopLength <= 0 || rawTick < loopEnd) return 0;

    return Math.floor((rawTick - loopStart) / loopLength);
  }

  // --- Internal Scheduler ---

  _startScheduler() {
    this._stopScheduler();
    this._schedulerTimerId = setInterval(() => this._schedulerTick(), this._schedulerInterval);
  }

  _stopScheduler() {
    if (this._schedulerTimerId !== null) {
      clearInterval(this._schedulerTimerId);
      this._schedulerTimerId = null;
    }
  }

  _schedulerTick() {
    const lookAheadEnd = this.engine.currentTime + this._scheduleAheadTime;
    const ticksPerBar = this.ticksPerBar;
    const loopStart = this.loopStartBar * ticksPerBar;
    const loopEnd = this.loopEndBar * ticksPerBar;
    const pulseStarts = [];
    let pulseCursor = 0;
    for (const pulseTicks of this.pulseTicks) {
      pulseStarts.push(pulseCursor);
      pulseCursor += pulseTicks;
    }

    while (this.state !== TransportState.STOPPED && this._nextTickTime < lookAheadEnd) {
      // Count musical ticks exactly. Derive each timestamp from a tempo anchor;
      // accumulated floating-point seconds must never choose which tick fires.
      const rawTick = this._nextRawTick;
      const loopCycle = this._loopCycleForRawTick(rawTick, loopStart, loopEnd);
      const tick = this._normalizeTick(rawTick, loopStart, loopEnd);

      // Handle looping
      if (loopCycle > this._lastLoopCycle) {
        this._lastLoopCycle = loopCycle;
        this._emit(this._onLoop, tick, this._nextTickTime);
      }

      // Store current tick
      this._currentTick = tick;

      // Fire tick callbacks
      this._emit(this._onTick, tick, this._nextTickTime);

      // Check for pulse boundary
      const barRelativeTick = ((tick % ticksPerBar) + ticksPerBar) % ticksPerBar;
      if (pulseStarts.includes(barRelativeTick)) {
        const beat = pulseStarts.indexOf(barRelativeTick);
        this._emit(this._onBeat, beat, this._nextTickTime);

        // Check for bar boundary
        if (beat === 0) {
          const bar = Math.floor(tick / ticksPerBar);
          this._emit(this._onBar, bar, this._nextTickTime);
        }
      }

      this._nextRawTick += 1;
      this._nextTickTime = this._audioTimeForRawTick(this._nextRawTick);
    }
  }
}
