/**
 * FakeAudioContext — an instrumented, headless stand-in for the browser
 * AudioContext that the Notenotes audio path drives.
 *
 * It implements the surface the app actually touches (discovered by grepping
 * src/ for `.create*`, AudioParam methods, and node wiring) and — crucially —
 * instruments node lifecycle. Every node created, every start/stop, every
 * connect/disconnect is recorded against a shared registry so a test can ask
 * "how many AudioBufferSourceNodes are live right now?" and turn the Windows
 * Chrome "rapid sample triggers crash the tab" report into a deterministic,
 * headless assertion.
 *
 * The clock is manual: `currentTime` only advances when the test calls
 * `advance(seconds)` or sets `ctx.currentTime`. Scheduler logic that reads
 * `currentTime` therefore becomes fully deterministic.
 *
 * Lifecycle model (faithful to the audio renderer, not the JS object):
 *  - A source node (BufferSource/Oscillator) becomes "live" at start(t) and
 *    "dead" when the clock reaches its scheduled stop time, OR when stop() is
 *    called with a time <= currentTime. On crossing its stop time it fires a
 *    one-shot `ended` event, exactly as a real source does. This is what the
 *    app's voice-disposal `ended` listeners hang off of.
 *  - A source with no scheduled stop and a buffer plays to the end of the
 *    buffer's duration (scaled by playbackRate) and then fires `ended` — this
 *    mirrors a gated one-shot sample that is never explicitly stopped.
 *  - disconnect() is tracked so a test can assert the app frees nodes promptly
 *    instead of leaning on GC.
 *
 * Counters are keyed by constructor name (`BufferSource`, `Oscillator`,
 * `Gain`, `BiquadFilter`, `WaveShaper`, `StereoPanner`, `DynamicsCompressor`,
 * `Delay`, `Convolver`, `Analyser`).
 */

/** @typedef {'BufferSource'|'Oscillator'|'Gain'|'BiquadFilter'|'WaveShaper'|'StereoPanner'|'DynamicsCompressor'|'Delay'|'Convolver'|'Analyser'} NodeKind */

let nodeSeq = 0;

class Registry {
  constructor() {
    /** @type {Set<FakeAudioNode>} */
    this.all = new Set();
    /** @type {Map<NodeKind, number>} */
    this.created = new Map();
    this.connects = 0;
    this.disconnects = 0;
    this.starts = 0;
    this.stops = 0;
    this.endedFired = 0;
  }

  track(node) {
    this.all.add(node);
    this.created.set(node.kind, (this.created.get(node.kind) || 0) + 1);
  }

  /** Sources that have started and not yet reached their stop time. */
  liveSources(currentTime) {
    let n = 0;
    for (const node of this.all) {
      if (!node._isSource) continue;
      if (node._started && !node._ended) {
        if (node._scheduledStop === null || node._scheduledStop > currentTime) n++;
      }
    }
    return n;
  }

  liveSourcesOfKind(kind, currentTime) {
    let n = 0;
    for (const node of this.all) {
      if (node.kind !== kind || !node._isSource) continue;
      if (node._started && !node._ended) {
        if (node._scheduledStop === null || node._scheduledStop > currentTime) n++;
      }
    }
    return n;
  }

  /** Every node still wired into the graph (connected, not disconnected). */
  connectedNodeCount() {
    let n = 0;
    for (const node of this.all) if (node._connections.size > 0) n++;
    return n;
  }
}

/** Mirrors the DOMException Chrome throws when two value curves overlap. */
function overlapError(t, dur, other) {
  const err = new Error(
    `Failed to execute 'setValueCurveAtTime' on 'AudioParam': setValueCurveAtTime([...], ${t}, ${dur}) ` +
    `overlaps setValueCurveAtTime([...], ${other.start}, ${other.end - other.start})`
  );
  err.name = 'NotSupportedError';
  return err;
}

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    /** @type {Array<{op: string, args: number[]}>} */
    this.automation = [];
    /** Active value-curve ranges [start, end]; Chrome forbids any overlap. */
    this._curves = [];
  }
  setValueAtTime(v, t) { this.value = v; this.automation.push({ op: 'setValueAtTime', args: [v, t] }); return this; }
  linearRampToValueAtTime(v, t) { this.value = v; this.automation.push({ op: 'linearRampToValueAtTime', args: [v, t] }); return this; }
  exponentialRampToValueAtTime(v, t) { this.value = v; this.automation.push({ op: 'exponentialRampToValueAtTime', args: [v, t] }); return this; }
  setTargetAtTime(v, t, tc) { this.value = v; this.automation.push({ op: 'setTargetAtTime', args: [v, t, tc] }); return this; }
  setValueCurveAtTime(curve, t, dur) {
    const start = t;
    const end = t + dur;
    // Real Chrome rejects a new curve whose [start, end] touches or overlaps an
    // existing one — including the back-to-back case where one curve's end
    // equals the next curve's start after render-frame quantization.
    for (const c of this._curves) {
      if (start <= c.end && end >= c.start) throw overlapError(t, dur, c);
    }
    this._curves.push({ start, end });
    if (curve && curve.length) this.value = curve[curve.length - 1];
    this.automation.push({ op: 'setValueCurveAtTime', args: [t, dur] });
    return this;
  }
  cancelScheduledValues(t) {
    this._curves = this._curves.filter(c => c.end < t);
    this.automation.push({ op: 'cancelScheduledValues', args: [t] });
    return this;
  }
  cancelAndHoldAtTime(t) { this.automation.push({ op: 'cancelAndHoldAtTime', args: [t] }); return this; }
}

class FakeAudioNode {
  /**
   * @param {FakeAudioContext} ctx
   * @param {NodeKind} kind
   * @param {boolean} isSource
   */
  constructor(ctx, kind, isSource = false) {
    this.id = ++nodeSeq;
    this.ctx = ctx;
    this.kind = kind;
    this._isSource = isSource;
    /** @type {Set<FakeAudioNode|FakeAudioParam>} */
    this._connections = new Set();
    this._listeners = new Map();
    this._started = false;
    this._ended = false;
    this._startTime = null;
    this._scheduledStop = null; // seconds, or null
    ctx._registry.track(this);
  }

  connect(target) {
    this._connections.add(target);
    this.ctx._registry.connects++;
    return target;
  }

  disconnect(target) {
    if (target) this._connections.delete(target);
    else this._connections.clear();
    this.ctx._registry.disconnects++;
  }

  addEventListener(type, fn, opts) {
    const once = !!(opts && opts.once);
    let arr = this._listeners.get(type);
    if (!arr) { arr = []; this._listeners.set(type, arr); }
    arr.push({ fn, once });
  }

  removeEventListener(type, fn) {
    const arr = this._listeners.get(type);
    if (!arr) return;
    this._listeners.set(type, arr.filter(l => l.fn !== fn));
  }

  _fire(type, evt = {}) {
    const arr = this._listeners.get(type);
    if (!arr || !arr.length) return;
    const survivors = [];
    for (const l of arr) {
      l.fn(evt);
      if (!l.once) survivors.push(l);
    }
    this._listeners.set(type, survivors);
  }
}

class FakeBufferSource extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'BufferSource', true);
    this.buffer = null;
    this.loop = false;
    this.playbackRate = new FakeAudioParam(1);
    this.detune = new FakeAudioParam(0);
    this.onended = null;
  }
  start(when = this.ctx.currentTime) {
    this._started = true;
    this._startTime = when;
    this.ctx._registry.starts++;
    // A gated/unstopped buffer plays to its natural end, then fires `ended`.
    if (this._scheduledStop === null && this.buffer && !this.loop) {
      const rate = this.playbackRate.value || 1;
      this._scheduledStop = when + (this.buffer.duration / rate);
    }
    this.ctx._registerSource(this);
  }
  stop(when = this.ctx.currentTime) {
    this.ctx._registry.stops++;
    if (this._scheduledStop === null || when < this._scheduledStop) this._scheduledStop = when;
    this.ctx._registerSource(this);
  }
  addEventListener(type, fn, opts) {
    super.addEventListener(type, fn, opts);
    if (type === 'ended') this.onended = fn;
  }
}

class FakeOscillator extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'Oscillator', true);
    this.type = 'sine';
    this.frequency = new FakeAudioParam(440);
    this.detune = new FakeAudioParam(0);
    this.onended = null;
  }
  start(when = this.ctx.currentTime) {
    this._started = true;
    this._startTime = when;
    this.ctx._registry.starts++;
    this.ctx._registerSource(this);
  }
  stop(when = this.ctx.currentTime) {
    this.ctx._registry.stops++;
    if (this._scheduledStop === null || when < this._scheduledStop) this._scheduledStop = when;
    this.ctx._registerSource(this);
  }
  addEventListener(type, fn, opts) {
    super.addEventListener(type, fn, opts);
    if (type === 'ended') this.onended = fn;
  }
}

class FakeGain extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'Gain'); this.gain = new FakeAudioParam(1); }
}
class FakeBiquadFilter extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'BiquadFilter');
    this.type = 'lowpass';
    this.frequency = new FakeAudioParam(350);
    this.Q = new FakeAudioParam(1);
    this.gain = new FakeAudioParam(0);
    this.detune = new FakeAudioParam(0);
  }
}
class FakeWaveShaper extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'WaveShaper'); this.curve = null; this.oversample = 'none'; }
}
class FakeStereoPanner extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'StereoPanner'); this.pan = new FakeAudioParam(0); }
}
class FakeDelay extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'Delay'); this.delayTime = new FakeAudioParam(0); }
}
class FakeConvolver extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'Convolver'); this.buffer = null; this.normalize = true; }
}
class FakeAnalyser extends FakeAudioNode {
  constructor(ctx) { super(ctx, 'Analyser'); this.fftSize = 2048; this.frequencyBinCount = 1024; }
  getByteFrequencyData() {}
  getByteTimeDomainData() {}
  getFloatTimeDomainData() {}
}
class FakeCompressor extends FakeAudioNode {
  constructor(ctx) {
    super(ctx, 'DynamicsCompressor');
    this.threshold = new FakeAudioParam(-24);
    this.knee = new FakeAudioParam(30);
    this.ratio = new FakeAudioParam(12);
    this.attack = new FakeAudioParam(0.003);
    this.release = new FakeAudioParam(0.25);
    this.reduction = 0;
  }
}

class FakeAudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(i) { return this._channels[i]; }
  copyToChannel(src, ch) { this._channels[ch].set(src); }
  copyFromChannel(dst, ch) { dst.set(this._channels[ch].subarray(0, dst.length)); }
}

export class FakeAudioContext {
  /**
   * @param {object} [opts]
   * @param {number} [opts.sampleRate=44100]
   */
  constructor(opts = {}) {
    this.sampleRate = opts.sampleRate || 44100;
    this.state = 'running';
    this._currentTime = 0;
    this._registry = new Registry();
    /** @type {Set<FakeAudioNode>} sources awaiting their stop time */
    this._pendingSources = new Set();
    this.destination = new FakeAudioNode(this, 'Destination');
    this.destination._isSource = false;
  }

  get currentTime() { return this._currentTime; }
  set currentTime(v) { this._setTime(v); }

  /** Advance the manual clock, firing any source `ended` events crossed. */
  advance(seconds) { this._setTime(this._currentTime + seconds); }

  _setTime(t) {
    if (t < this._currentTime) { this._currentTime = t; return; }
    this._currentTime = t;
    this._flushEnded();
  }

  _registerSource(node) {
    if (node._ended) return;
    this._pendingSources.add(node);
    this._flushEnded();
  }

  _flushEnded() {
    for (const node of [...this._pendingSources]) {
      if (node._scheduledStop !== null && node._scheduledStop <= this._currentTime) {
        node._ended = true;
        this._pendingSources.delete(node);
        this._registry.endedFired++;
        node._fire('ended', { target: node });
      }
    }
  }

  // --- factory methods (the surface the app uses) ---
  createBufferSource() { return new FakeBufferSource(this); }
  createOscillator() { return new FakeOscillator(this); }
  createGain() { return new FakeGain(this); }
  createBiquadFilter() { return new FakeBiquadFilter(this); }
  createWaveShaper() { return new FakeWaveShaper(this); }
  createStereoPanner() { return new FakeStereoPanner(this); }
  createDelay() { return new FakeDelay(this); }
  createConvolver() { return new FakeConvolver(this); }
  createAnalyser() { return new FakeAnalyser(this); }
  createDynamicsCompressor() { return new FakeCompressor(this); }
  createMediaStreamSource() { return new FakeAudioNode(this, 'MediaStreamSource', true); }

  createBuffer(channels, length, sampleRate) {
    return new FakeAudioBuffer(channels, length, sampleRate || this.sampleRate);
  }

  decodeAudioData(arrayBuffer) {
    const bytes = arrayBuffer?.byteLength || 0;
    const length = Math.max(1, Math.floor((bytes / 4) || this.sampleRate));
    return Promise.resolve(new FakeAudioBuffer(2, length, this.sampleRate));
  }

  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }

  // --- inspectors (the instrument) ---

  /** Live source nodes (started, not yet past their stop time). */
  liveNodeCount() { return this._registry.liveSources(this._currentTime); }
  /** Live source nodes of a given kind, e.g. 'BufferSource'. */
  liveSourceCount(kind) { return this._registry.liveSourcesOfKind(kind, this._currentTime); }
  /** Total nodes ever created of a given kind. */
  createdCount(kind) { return this._registry.created.get(kind) || 0; }
  /** Total nodes ever created across all kinds. */
  totalCreated() { let n = 0; for (const v of this._registry.created.values()) n += v; return n; }
  startCount() { return this._registry.starts; }
  stopCount() { return this._registry.stops; }
  connectCount() { return this._registry.connects; }
  disconnectCount() { return this._registry.disconnects; }
  endedCount() { return this._registry.endedFired; }
  /** Nodes still wired into the graph (have >0 outgoing connections). */
  connectedNodeCount() { return this._registry._registry?.connectedNodeCount?.() ?? this._registry.connectedNodeCount(); }
}

export { FakeAudioBuffer, FakeAudioParam };
