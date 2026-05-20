/**
 * AudioEngine — Singleton managing the master AudioContext.
 * All audio routing flows through here.
 */

let instance = null;

export class AudioEngine {
  constructor() {
    if (instance) return instance;
    instance = this;

    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {GainNode|null} */
    this.masterGain = null;
    /** @type {DynamicsCompressorNode|null} */
    this.limiter = null;
    this._initialized = false;
  }

  static getInstance() {
    if (!instance) {
      instance = new AudioEngine();
    }
    return instance;
  }

  /**
   * Initialize the AudioContext. Must be called from a user gesture.
   */
  async init() {
    if (this._initialized) return;
    this.initSync();
  }

  /**
   * Synchronous init — AudioContext must be created in the same call stack
   * as the user gesture event for Chrome's autoplay policy.
   */
  initSync() {
    if (this._initialized) return;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 44100,
      latencyHint: 'interactive'
    });

    // Immediately resume if suspended
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.unlockGesture();

    // Master output chain: source → masterGain → limiter → destination
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;

    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    this._initialized = true;
    console.log('[AudioEngine] Initialized. Sample rate:', this.ctx.sampleRate);
  }

  /**
   * Resume the AudioContext if suspended (browser autoplay policy).
   */
  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /**
   * Best-effort browser audio unlock. iOS WebKit sometimes needs real graph
   * activity on the same gesture as the user's note press, not only context
   * creation. Safe to call repeatedly from pointer/touch handlers.
   */
  unlockGesture() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    try {
      const source = this.ctx.createBufferSource();
      source.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;
      source.connect(gain);
      gain.connect(this.ctx.destination);
      source.start(0);
      source.stop(this.ctx.currentTime + 0.01);
    } catch (e) { /* non-critical unlock nudge */ }
  }

  /**
   * Get the current audio time.
   * @returns {number}
   */
  get currentTime() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Get the master output node to connect instruments to.
   * @returns {GainNode}
   */
  get output() {
    return this.masterGain;
  }

  /**
   * Set master volume (0–1).
   * @param {number} value
   */
  setVolume(value) {
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        Math.max(0, Math.min(1, value)),
        this.ctx.currentTime,
        0.01
      );
    }
  }

  /**
   * Create a fresh GainNode connected to master.
   * Used for instrument/track sub-mixes.
   * @returns {GainNode}
   */
  createTrackBus() {
    const gain = this.ctx.createGain();
    gain.connect(this.masterGain);
    return gain;
  }
}
