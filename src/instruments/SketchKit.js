/**
 * SketchKit — Simplified drum interface.
 * 3 pads: Kick, Snare/Clap, Hi-Hat/Cymbal.
 * All sounds synthesized via Web Audio.
 */

import { AudioEngine } from '../engine/AudioEngine.js';

export class SketchKit {
  constructor() {
    this.engine = AudioEngine.getInstance();
    this.el = null;
    this._output = null;
    this._padModes = { kick: 'kick', snare: 'snare', hihat: 'hihat' };
    this._onHit = null;
  }

  setHitCallback(onHit) { this._onHit = onHit; }

  init() {
    this._output = this.engine.createTrackBus();
    this._output.gain.value = 0.7;
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'sketchkit';
    this.el.id = 'sketchkit';
    this.el.innerHTML = `
      <div class="sketchkit__pads">
        <div class="sketchkit__pad-wrapper">
          <button class="sketchkit__pad sketchkit__pad--kick" data-pad="kick" aria-label="Kick">
            <span class="sketchkit__pad-icon">💥</span>
            <span class="sketchkit__pad-label" id="sk-label-kick">KICK</span>
          </button>
        </div>
        <div class="sketchkit__pad-wrapper">
          <button class="sketchkit__pad sketchkit__pad--snare" data-pad="snare" aria-label="Snare">
            <span class="sketchkit__pad-icon">🥁</span>
            <span class="sketchkit__pad-label" id="sk-label-snare">SNARE</span>
          </button>
          <button class="sketchkit__swap-btn" data-swap="snare" aria-label="Toggle snare/clap">⇄</button>
        </div>
        <div class="sketchkit__pad-wrapper">
          <button class="sketchkit__pad sketchkit__pad--hihat" data-pad="hihat" aria-label="Hi-Hat">
            <span class="sketchkit__pad-icon">🔔</span>
            <span class="sketchkit__pad-label" id="sk-label-hihat">HI-HAT</span>
          </button>
          <button class="sketchkit__swap-btn" data-swap="hihat" aria-label="Toggle hi-hat/cymbal">⇄</button>
        </div>
      </div>`;
    this._bindEvents();
    return this.el;
  }

  _bindEvents() {
    this.el.querySelectorAll('.sketchkit__pad').forEach(pad => {
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const mode = this._padModes[pad.dataset.pad];
        this._triggerSound(mode);
        pad.classList.add('is-active');
        if (this._onHit) this._onHit(mode);
        setTimeout(() => pad.classList.remove('is-active'), 120);
      });
    });
    this.el.querySelectorAll('.sketchkit__swap-btn').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const p = btn.dataset.swap;
        if (p === 'snare') {
          this._padModes.snare = this._padModes.snare === 'snare' ? 'clap' : 'snare';
          this.el.querySelector('#sk-label-snare').textContent = this._padModes.snare.toUpperCase();
        } else if (p === 'hihat') {
          this._padModes.hihat = this._padModes.hihat === 'hihat' ? 'cymbal' : 'hihat';
          this.el.querySelector('#sk-label-hihat').textContent = this._padModes.hihat.toUpperCase();
        }
      });
    });
  }

  _triggerSound(sound, atTime) {
    const ctx = this.engine.ctx;
    if (!ctx || !this._output) return;
    const now = atTime !== undefined ? atTime : ctx.currentTime;
    switch (sound) {
      case 'kick': this._synthKick(ctx, now); break;
      case 'snare': this._synthSnare(ctx, now); break;
      case 'clap': this._synthClap(ctx, now); break;
      case 'hihat': this._synthHiHat(ctx, now, false); break;
      case 'cymbal': this._synthHiHat(ctx, now, true); break;
    }
  }

  _synthKick(ctx, t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(this._output);
    o.start(t); o.stop(t + 0.4);
  }

  _synthSnare(ctx, t) {
    const len = 0.15, bs = ctx.sampleRate * len;
    const buf = ctx.createBuffer(1, bs, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bs; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource(); n.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1000;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(f); f.connect(g); g.connect(this._output); n.start(t);
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.06);
    const bg = ctx.createGain(); bg.gain.setValueAtTime(0.7, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(bg); bg.connect(this._output); o.start(t); o.stop(t + 0.12);
  }

  _synthClap(ctx, t) {
    for (let i = 0; i < 3; i++) {
      const off = t + i * 0.012, bs = ctx.sampleRate * 0.04;
      const buf = ctx.createBuffer(1, bs, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < bs; j++) d[j] = Math.random() * 2 - 1;
      const n = ctx.createBufferSource(); n.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 3;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.8, off);
      g.gain.exponentialRampToValueAtTime(0.001, off + 0.08);
      n.connect(f); f.connect(g); g.connect(this._output); n.start(off);
    }
  }

  _synthHiHat(ctx, t, long) {
    const dur = long ? 0.4 : 0.06, bs = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bs, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bs; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource(); n.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = long ? 5000 : 7000;
    const g = ctx.createGain(); g.gain.setValueAtTime(long ? 0.4 : 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this._output); n.start(t);
  }
}
