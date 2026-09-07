/**
 * AudioEngine — Singleton managing the master AudioContext.
 * All audio routing flows through here.
 */

import { createMasterGlueCurve } from './MasterGlue.js';
import { DEFAULT_MASTER_VOLUME, normalizeVolume } from './OutputVolume.js';

let instance = null;

export class AudioEngine {
  constructor() {
    if (instance) return instance;
    instance = this;

    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {GainNode|null} */
    this.masterGain = null;
    /** @type {WaveShaperNode|null} */
    this.masterGlue = null;
    /** @type {DynamicsCompressorNode|null} */
    this.limiter = null;
    this._initialized = false;
    this._mediaRoutePrimed = false;
    this._mediaRoutePrimePromise = null;
    this._volume = DEFAULT_MASTER_VOLUME;
    this._gesturePrimed = false;
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
      latencyHint: 'interactive'
    });
    this._gesturePrimed = false;

    // Immediately resume if suspended
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.unlockGesture();

    // Master output chain: source → masterGain → subtle glue → limiter → destination
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._volume;

    this.masterGlue = this.ctx.createWaveShaper();
    this.masterGlue.curve = createMasterGlueCurve(2048);
    this.masterGlue.oversample = '2x';

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;

    this.masterGain.connect(this.masterGlue);
    this.masterGlue.connect(this.limiter);
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
    if (this._gesturePrimed && this.ctx.state === 'running') return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    try {
      const source = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;
      source.frequency.value = 440;
      gain.gain.setValueAtTime(0.00001, now);
      gain.gain.exponentialRampToValueAtTime(0.000001, now + 0.04);
      source.connect(gain);
      gain.connect(this.ctx.destination);
      source.start(now);
      source.stop(now + 0.04);
      this._gesturePrimed = true;
    } catch (e) { /* non-critical unlock nudge */ }
  }

  get mediaRoutePrimed() {
    return this._mediaRoutePrimed;
  }

  markMediaRoutePrimed() {
    this._mediaRoutePrimed = true;
  }

  /**
   * iOS Safari can report a running AudioContext while still muting app audio
   * until the page has opened the system media route. This intentionally uses
   * the same user-permission path as Mic In, then closes the stream immediately.
   */
  async primeMediaRoute() {
    if (this._mediaRoutePrimed) return true;
    if (this._mediaRoutePrimePromise) return this._mediaRoutePrimePromise;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }

    this._mediaRoutePrimePromise = navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        this._mediaRoutePrimed = true;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('notenotes-audio-state-changed', {
            detail: { state: this.ctx?.state || 'unknown', mediaRoutePrimed: true },
          }));
        }
        return true;
      })
      .finally(() => {
        this._mediaRoutePrimePromise = null;
      });

    return this._mediaRoutePrimePromise;
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
    this._volume = normalizeVolume(value, DEFAULT_MASTER_VOLUME);
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this._volume,
        this.ctx.currentTime,
        0.01
      );
    }
  }

  /**
   * Create a fresh track bus connected to master.
   *
   * The returned node remains a GainNode for compatibility with instruments:
   * its gain is the instrument/patch level. A second, private gain stage owns
   * the Canvas track volume, followed by an optional stereo panner. Keeping
   * those stages separate prevents a track-volume update from overwriting a
   * preset's carefully tuned output gain.
   * @returns {GainNode}
   */
  createTrackBus() {
    const input = this.ctx.createGain();
    const level = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    input.connect(level);
    if (panner) {
      level.connect(panner);
      panner.connect(this.masterGain);
    } else {
      level.connect(this.masterGain);
    }
    input._notenotesBus = { level, panner };
    return input;
  }

  setTrackBusPan(input, pan = 0) {
    const panner = input?._notenotesBus?.panner;
    if (!panner || !this.ctx) return;
    const numeric = Number(pan);
    const value = Math.max(-1, Math.min(1, Number.isFinite(numeric) ? numeric : 0));
    panner.pan.setTargetAtTime(value, this.currentTime, 0.01);
  }

  setTrackBusVolume(input, volume = 1) {
    const level = input?._notenotesBus?.level;
    if (!level || !this.ctx) return;
    const numeric = Number(volume);
    const value = Math.max(0, Math.min(1.5, Number.isFinite(numeric) ? numeric : 1));
    level.gain.setTargetAtTime(value, this.currentTime, 0.01);
  }

  destroyTrackBus(input) {
    if (!input) return;
    const { level, panner } = input._notenotesBus || {};
    try { input.disconnect(); } catch (_) {}
    try { level?.disconnect(); } catch (_) {}
    try { panner?.disconnect(); } catch (_) {}
    try { delete input._notenotesBus; } catch (_) {}
  }
}
