/**
 * SketchKit — Synthesized drum kit with selectable kits.
 * All sounds generated via Web Audio. Settings-driven pad count.
 * Supports multiple drum kit presets (Classic, 808, Electronic, Acoustic).
 */

import { AudioEngine } from '../engine/AudioEngine.js';
import { SOUND_TRAITS, normalizeSoundTraits } from './WebAudioSynth.js';
import { showToast } from '../ui/Toast.js';

export const DRUM_KITS = {
  classic: {
    name: 'Classic',
    sounds: {
      kick:    { osc: 'sine',  freq0: 150, freq1: 40,  decay: 0.4,  vol: 1.0, clicks: false },
      snare:   { osc: 'triangle', noiseHp: 1000, bodyFreq: 200, bodyDecay: 0.12, noiseDecay: 0.15, vol: 0.8, clicks: false },
      clap:    { bpFreq: 2000, bpQ: 3, vol: 0.8, decay: 0.08, clicks: false },
      hihat:   { hpFreq: 7000, vol: 0.5, decay: 0.06, clicks: false },
      cymbal:  { hpFreq: 5000, vol: 0.4, decay: 0.4, clicks: false },
      tomlo:   { osc: 'triangle', freq0: 96, freq1: 48,  decay: 0.35, vol: 0.8, clicks: false },
      tommid:  { osc: 'triangle', freq0: 168, freq1: 84,  decay: 0.35, vol: 0.8, clicks: false },
      tomhi:   { osc: 'triangle', freq0: 264, freq1: 132,  decay: 0.3,  vol: 0.75, clicks: false },
      rim:     { bpFreq: 4000, bpQ: 8, rimFreq: 800, rimDecay: 0.03, noiseDecay: 0.08, vol: 0.9, clicks: true },
      shaker:  { hpFreq: 8000, vol: 0.25, decay: 0.2, steps: 8, clicks: false },
    }
  },
  eight08: {
    name: '808',
    sounds: {
      kick:    { osc: 'sine',  freq0: 56,  freq1: 28,  decay: 0.55, vol: 1.0, clicks: true },
      snare:   { osc: 'triangle', noiseHp: 1500, bodyFreq: 250, bodyDecay: 0.08, noiseDecay: 0.18, vol: 0.9, clicks: false },
      clap:    { bpFreq: 1800, bpQ: 4, vol: 0.9, decay: 0.1, clicks: true },
      hihat:   { hpFreq: 9000, vol: 0.4, decay: 0.04, clicks: false },
      cymbal:  { hpFreq: 6000, vol: 0.35, decay: 0.5, clicks: false },
      tomlo:   { osc: 'sine',  freq0: 75,  freq1: 38,  decay: 0.4,  vol: 0.85, clicks: true },
      tommid:  { osc: 'sine',  freq0: 130, freq1: 65,  decay: 0.35, vol: 0.85, clicks: true },
      tomhi:   { osc: 'sine',  freq0: 200, freq1: 110,  decay: 0.3,  vol: 0.8, clicks: true },
      rim:     { bpFreq: 3500, bpQ: 10, rimFreq: 1000, rimDecay: 0.02, noiseDecay: 0.06, vol: 0.95, clicks: true },
      shaker:  { hpFreq: 9000, vol: 0.2, decay: 0.15, steps: 10, clicks: false },
    }
  },
  electronic: {
    name: 'Electronic',
    sounds: {
      kick:    { osc: 'sawtooth', freq0: 120, freq1: 30,  decay: 0.3,  vol: 0.9, clicks: true },
      snare:   { osc: 'square', noiseHp: 2000, bodyFreq: 300, bodyDecay: 0.1, noiseDecay: 0.12, vol: 0.85, clicks: true },
      clap:    { bpFreq: 2500, bpQ: 6, vol: 0.85, decay: 0.06, clicks: true },
      hihat:   { hpFreq: 10000, vol: 0.4, decay: 0.03, clicks: true },
      cymbal:  { hpFreq: 7000, vol: 0.35, decay: 0.35, clicks: false },
      tomlo:   { osc: 'square', freq0: 90,  freq1: 40,  decay: 0.3,  vol: 0.8, clicks: true },
      tommid:  { osc: 'square', freq0: 160, freq1: 80,  decay: 0.28, vol: 0.75, clicks: true },
      tomhi:   { osc: 'square', freq0: 250, freq1: 120,  decay: 0.25, vol: 0.7, clicks: true },
      rim:     { bpFreq: 5000, bpQ: 12, rimFreq: 1200, rimDecay: 0.02, noiseDecay: 0.05, vol: 0.9, clicks: true },
      shaker:  { hpFreq: 10000, vol: 0.2, decay: 0.12, steps: 12, clicks: true },
    }
  },
  acoustic: {
    name: 'Acoustic',
    sounds: {
      kick:    { osc: 'sine',  freq0: 130, freq1: 35,  decay: 0.5,  vol: 1.0, clicks: false },
      snare:   { osc: 'triangle', noiseHp: 800, bodyFreq: 180, bodyDecay: 0.15, noiseDecay: 0.2, vol: 0.85, clicks: false },
      clap:    { bpFreq: 1500, bpQ: 2, vol: 0.75, decay: 0.1, clicks: false },
      hihat:   { hpFreq: 6000, vol: 0.35, decay: 0.08, clicks: false },
      cymbal:  { hpFreq: 4000, vol: 0.3, decay: 0.5, clicks: false },
      tomlo:   { osc: 'triangle', freq0: 100, freq1: 50,  decay: 0.4,  vol: 0.85, clicks: false },
      tommid:  { osc: 'triangle', freq0: 155, freq1: 77,  decay: 0.35, vol: 0.85, clicks: false },
      tomhi:   { osc: 'triangle', freq0: 230, freq1: 115,  decay: 0.3,  vol: 0.8, clicks: false },
      rim:     { bpFreq: 3000, bpQ: 6, rimFreq: 700, rimDecay: 0.04, noiseDecay: 0.1, vol: 0.9, clicks: true },
      shaker:  { hpFreq: 7000, vol: 0.2, decay: 0.25, steps: 7, clicks: false },
    }
  },
};

const SOUNDS = [
  { id: 'kick',    icon: '💥', label: 'KICK' },
  { id: 'snare',   icon: '🥁', label: 'SNARE' },
  { id: 'clap',    icon: '👏', label: 'CLAP' },
  { id: 'hihat',   icon: '🔔', label: 'HI-HAT' },
  { id: 'cymbal',  icon: '✨', label: 'CYMBAL' },
  { id: 'tomlo',   icon: '🪘', label: 'TOM LO' },
  { id: 'tommid',  icon: '🪘', label: 'TOM MID' },
  { id: 'tomhi',   icon: '🪘', label: 'TOM HI' },
  { id: 'rim',     icon: '🥢', label: 'RIM' },
  { id: 'shaker',  icon: '🪇', label: 'SHAKER' },
];

export class SketchKit {
  constructor(project) {
    this.engine = AudioEngine.getInstance();
    this._project = project;
    this.el = null;
    this._output = null;
    this._toneInput = null;
    this._effectNodes = [];
    this._lfo = null;
    this._lfoGain = null;
    this.soundTraits = normalizeSoundTraits();
    this._kitId = 'classic';
    this._onHit = null;
    this.onSoundTraitsChanged = null;
    this.onKitChanged = null;
    this.onCreateInstrument = null;
    this.onDeleteInstrument = null;
    this._activePadTimers = new Map();

    window.addEventListener('settings-pads-changed', () => {
      if (this.el) this._refreshPads();
    });
    window.addEventListener('project-tone-presets-changed', () => this._refreshTonePresetControls());
  }

  set project(p) {
    this._project = p;
    if (this.el) this._refreshPads();
  }
  get project() { return this._project; }

  loadKit(kitId) {
    if (DRUM_KITS[kitId] || this._customKitInstruments().some(instrument => `custom:${instrument.id}` === kitId)) {
      this._kitId = kitId;
      this._refreshKitSelector();
    }
  }

  get _activeKit() { return DRUM_KITS[this._kitId] || DRUM_KITS.classic; }
  get selectedKitId() { return this._kitId; }
  get selectedCustomInstrumentId() {
    return this._kitId?.startsWith?.('custom:') ? this._kitId.slice(7) : null;
  }

  setHitCallback(onHit) { this._onHit = onHit; }

  init() {
    this._output = this.engine.createTrackBus();
    this._output.gain.value = 0.7;
    this._toneInput = this.engine.ctx.createGain();
    this._rebuildEffects();
  }

  setSoundTraits(traits = {}) {
    this.soundTraits = normalizeSoundTraits(traits);
    if (this._toneInput && this._output) this._rebuildEffects();
    this._syncToneSliders();
  }

  get _padCount() {
    return Math.min(this.project?.settings?.drumPads || 10, SOUNDS.length);
  }

  _visibleSounds() {
    return SOUNDS.slice(0, this._padCount);
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'sketchkit';
    this.el.id = 'sketchkit';

    this.el.innerHTML = `
      <div class="sk-kit-selector" id="sk-kit-selector">
        <label class="sk-kit-selector__label">Kit</label>
        <select class="sk-kit-selector__select" id="sk-kit-select" aria-label="Drum kit">
          ${this._renderKitOptions()}
        </select>
        <button class="tone-button" id="sk-create-instrument-button" type="button">${this.selectedCustomInstrumentId ? 'Edit Instrument' : 'Create Instrument'}</button>
        <button class="tone-button" id="sk-delete-instrument-button" type="button">Delete</button>
        <button class="tone-button" id="sk-tone-button" type="button" aria-expanded="false" aria-controls="sk-tone-popover">Tone</button>
      </div>
      <div class="sketchkit__pads" id="sk-pads" style="grid-template-columns:${this._gridColumns()};">
        ${this._renderPads()}
      </div>
    `;

    this._bindEvents();
    return this.el;
  }

  _gridColumns() {
    const cols = Math.ceil(Math.sqrt(this._padCount));
    return `repeat(${cols}, 1fr)`;
  }

  _renderPads() {
    return this._visibleSounds().map((s, i) => {
      const padClass = `sketchkit__pad--${s.id}`;
      return `
        <button class="sketchkit__pad ${padClass}" data-pad="${s.id}" data-index="${i}"
                aria-label="${s.label}">
          <span class="sketchkit__pad-icon">${s.icon}</span>
          <span class="sketchkit__pad-label">${s.label}</span>
        </button>
      `;
    }).join('');
  }

  _refreshPads() {
    const container = this.el.querySelector('#sk-pads');
    if (!container) return;
    container.style.gridTemplateColumns = this._gridColumns();
    container.innerHTML = this._renderPads();
    this._bindPadEvents();
  }

  _bindEvents() {
    this.el.querySelector('#sk-kit-select')?.addEventListener('change', (e) => {
      this.loadKit(e.target.value);
      if (this.selectedCustomInstrumentId) showToast('Custom Kit playback is the next wiring step');
      if (this.onKitChanged) this.onKitChanged(this._kitId);
      this._syncInstrumentButtons();
    });
    this.el.querySelector('#sk-create-instrument-button')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.onCreateInstrument) this.onCreateInstrument(this.el.querySelector('#sk-kit-selector'));
    });
    this.el.querySelector('#sk-delete-instrument-button')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.onDeleteInstrument) this.onDeleteInstrument();
    });
    this.el.querySelector('#sk-tone-button')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._toggleTonePopover();
    });
    this._syncInstrumentButtons();
    this._bindPadEvents();
  }

  _customKitInstruments() {
    return (this.project?.settings?.customInstruments || []).filter(instrument => instrument.type === 'kit');
  }

  _renderKitOptions() {
    const builtIns = Object.entries(DRUM_KITS).map(([key, k]) =>
      `<option value="${key}" ${key === this._kitId ? 'selected' : ''}>${k.name}</option>`
    ).join('');
    const custom = this._customKitInstruments().map(instrument => {
      const id = `custom:${instrument.id}`;
      return `<option value="${id}" ${id === this._kitId ? 'selected' : ''}>${instrument.name}</option>`;
    }).join('');
    return `
      <optgroup label="Drum kits">${builtIns}</optgroup>
      ${custom ? `<optgroup label="Custom instruments">${custom}</optgroup>` : ''}
    `;
  }

  refreshKitSelector() {
    this._refreshKitSelector();
  }

  _refreshKitSelector() {
    const select = this.el?.querySelector('#sk-kit-select');
    if (!select) return;
    select.innerHTML = this._renderKitOptions();
    if ([...select.options].some(option => option.value === this._kitId)) {
      select.value = this._kitId;
    } else {
      this._kitId = 'classic';
      select.value = this._kitId;
    }
    this._syncInstrumentButtons();
  }

  _syncInstrumentButtons() {
    const isCustom = !!this.selectedCustomInstrumentId;
    const createBtn = this.el?.querySelector('#sk-create-instrument-button');
    const deleteBtn = this.el?.querySelector('#sk-delete-instrument-button');
    if (createBtn) createBtn.textContent = isCustom ? 'Edit Instrument' : 'Create Instrument';
    if (deleteBtn) deleteBtn.hidden = !isCustom;
  }

  _bindPadEvents() {
    this.el.querySelectorAll('.sketchkit__pad').forEach(pad => {
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const sid = pad.dataset.pad;
        this.triggerPad(sid);
      });
    });
  }

  visiblePadIds() {
    return [...(this.el?.querySelectorAll('.sketchkit__pad') || [])]
      .map(pad => pad.dataset.pad)
      .filter(Boolean);
  }

  triggerVisiblePad(index) {
    const sid = this.visiblePadIds()[index];
    if (sid) this.triggerPad(sid);
  }

  triggerPad(sid) {
    const pad = this.el?.querySelector(`.sketchkit__pad[data-pad="${sid}"]`);
    this._triggerSound(sid);
    if (pad) {
      pad.classList.add('is-active');
      const oldTimer = this._activePadTimers.get(sid);
      if (oldTimer) clearTimeout(oldTimer);
      const timer = setTimeout(() => {
        pad.classList.remove('is-active');
        this._activePadTimers.delete(sid);
      }, 120);
      this._activePadTimers.set(sid, timer);
    }
    if (this._onHit) this._onHit(sid);
  }

  _triggerSound(sid, atTime) {
    const ctx = this.engine.ctx;
    if (!ctx || !this._output) return;
    const t = atTime !== undefined ? atTime : ctx.currentTime;
    const p = this._activeKit.sounds[sid];
    if (!p) return;

    switch (sid) {
      case 'kick':
      case 'tomlo':
      case 'tommid':
      case 'tomhi':
        this._synthTone(ctx, t, p); break;
      case 'snare':
        this._synthSnare(ctx, t, p); break;
      case 'clap':
        this._synthClap(ctx, t, p); break;
      case 'hihat':
      case 'cymbal':
        this._synthHiHat(ctx, t, p, sid === 'cymbal'); break;
      case 'rim':
        this._synthRim(ctx, t, p); break;
      case 'shaker':
        this._synthShaker(ctx, t, p); break;
    }
  }

  _synthTone(ctx, t, p) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = p.osc;
    o.frequency.setValueAtTime(p.freq0, t);
    o.frequency.exponentialRampToValueAtTime(p.freq1, t + p.decay * 0.35);
    g.gain.setValueAtTime(p.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + p.decay);
    o.connect(g); g.connect(this._drumOutput());
    o.start(t); o.stop(t + p.decay);
    if (p.clicks) {
      const cO = ctx.createOscillator(), cG = ctx.createGain();
      cO.type = 'square'; cO.frequency.value = 800;
      cG.gain.setValueAtTime(p.vol * 0.4, t);
      cG.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
      cO.connect(cG); cG.connect(this._drumOutput());
      cO.start(t); cO.stop(t + 0.01);
    }
  }

  _synthSnare(ctx, t, p) {
    const noiselen = p.noiseDecay, bs = ctx.sampleRate * noiselen;
    const buf = ctx.createBuffer(1, bs, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bs; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource(); n.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = p.noiseHp;
    const g = ctx.createGain(); g.gain.setValueAtTime(p.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + noiselen);
    n.connect(f); f.connect(g); g.connect(this._drumOutput()); n.start(t);

    const o = ctx.createOscillator(); o.type = p.osc;
    o.frequency.setValueAtTime(p.bodyFreq, t);
    o.frequency.exponentialRampToValueAtTime(p.bodyFreq * 0.4, t + p.bodyDecay * 0.5);
    const bg = ctx.createGain(); bg.gain.setValueAtTime(p.vol * 0.7, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + p.bodyDecay);
    o.connect(bg); bg.connect(this._drumOutput()); o.start(t); o.stop(t + p.bodyDecay);
  }

  _synthClap(ctx, t, p) {
    for (let i = 0; i < 3; i++) {
      const off = t + i * 0.012, bs = ctx.sampleRate * 0.04;
      const buf = ctx.createBuffer(1, bs, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < bs; j++) d[j] = Math.random() * 2 - 1;
      const n = ctx.createBufferSource(); n.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.value = p.bpFreq; f.Q.value = p.bpQ;
      const g = ctx.createGain(); g.gain.setValueAtTime(p.vol, off);
      g.gain.exponentialRampToValueAtTime(0.001, off + p.decay);
      n.connect(f); f.connect(g); g.connect(this._drumOutput()); n.start(off);
    }
  }

  _synthHiHat(ctx, t, p, long) {
    const dur = long ? p.decay : (p.decay || 0.06);
    const bs = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bs, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bs; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource(); n.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = p.hpFreq;
    const g = ctx.createGain(); g.gain.setValueAtTime(p.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this._drumOutput()); n.start(t);
  }

  _synthRim(ctx, t, p) {
    const noiselen = p.noiseDecay, bs = ctx.sampleRate * noiselen;
    const buf = ctx.createBuffer(1, bs, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bs; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource(); n.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = p.bpFreq; f.Q.value = p.bpQ;
    const g = ctx.createGain(); g.gain.setValueAtTime(p.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + noiselen);
    n.connect(f); f.connect(g); g.connect(this._drumOutput()); n.start(t);

    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(p.rimFreq, t);
    o.frequency.exponentialRampToValueAtTime(p.rimFreq * 0.25, t + p.rimDecay);
    const rg = ctx.createGain(); rg.gain.setValueAtTime(p.vol * 0.5, t);
    rg.gain.exponentialRampToValueAtTime(0.001, t + p.rimDecay * 2);
    o.connect(rg); rg.connect(this._drumOutput()); o.start(t); o.stop(t + p.rimDecay * 2);
  }

  _synthShaker(ctx, t, p) {
    const dur = p.decay, steps = p.steps;
    for (let i = 0; i < steps; i++) {
      const off = t + i * (dur / steps);
      const bs = ctx.sampleRate * 0.015;
      const buf = ctx.createBuffer(1, bs, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < bs; j++) d[j] = Math.random() * 2 - 1;
      const n = ctx.createBufferSource(); n.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = p.hpFreq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(p.vol * (1 - i / steps), off);
      g.gain.exponentialRampToValueAtTime(0.001, off + 0.025);
      n.connect(f); f.connect(g); g.connect(this._drumOutput()); n.start(off);
    }
  }

  _drumOutput() {
    return this._toneInput || this._output;
  }

  _traitAmount(id) {
    const trait = this.soundTraits?.[id];
    return Math.max(0, Math.min(1, trait?.amount ?? 0));
  }

  _traitCurve(id) {
    const amount = this._traitAmount(id);
    if (id === 'wobble') return Math.pow(amount, 0.55);
    if (id === 'space') return Math.pow(amount, 0.5);
    return Math.pow(amount, 0.68);
  }

  _toggleTonePopover() {
    const existing = this.el?.querySelector('#sk-tone-popover');
    if (existing) {
      this._closeTonePopover();
      return;
    }
    const anchor = this.el?.querySelector('#sk-kit-selector');
    if (!anchor) return;
    const popover = document.createElement('div');
    popover.className = 'tone-popover sk-tone-popover';
    popover.id = 'sk-tone-popover';
    popover.innerHTML = `
      <div class="tone-popover__header">
        <span>Tone</span>
        <button class="tone-popover__close" type="button" aria-label="Close tone">x</button>
      </div>
      ${this._renderTonePresetControls()}
      <div class="tone-popover__list">
        ${Object.values(SOUND_TRAITS).map(trait => {
          const amount = Math.round((this.soundTraits?.[trait.id]?.amount || 0) * 100);
          return `
            <div class="tone-row" title="${trait.hint}">
              <label class="tone-row__name" for="sk-tone-${trait.id}">${trait.name}</label>
              <input class="tone-row__slider" id="sk-tone-${trait.id}" type="range" min="0" max="100" value="${amount}" data-sk-tone-amount="${trait.id}" aria-label="${trait.name} intensity">
              <span class="tone-row__value">${amount}%</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
    anchor.appendChild(popover);
    this.el.querySelector('#sk-tone-button')?.setAttribute('aria-expanded', 'true');
    popover.querySelector('.tone-popover__close')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._closeTonePopover();
    });
    popover.querySelectorAll('[data-sk-tone-amount]').forEach(slider => {
      const update = () => this._setToneTraitAmount(slider.dataset.skToneAmount, Number(slider.value) / 100, slider);
      slider.addEventListener('input', update);
      slider.addEventListener('change', update);
    });
    this._bindTonePresetControls(popover);
  }

  _renderTonePresetControls() {
    const presets = this._tonePresets();
    return `
      <div class="tone-preset">
        <div class="tone-preset__row tone-preset__row--manage">
          <select class="tone-preset__select" id="sk-tone-preset-select" aria-label="Tone preset">
            <option value="">Preset...</option>
            ${presets.map(preset => `<option value="${preset.id}">${preset.name}</option>`).join('')}
          </select>
          <button class="btn btn--ghost" id="sk-tone-preset-apply" type="button">Apply</button>
          <button class="btn btn--ghost" id="sk-tone-preset-delete" type="button">Delete</button>
        </div>
        <div class="tone-preset__row">
          <input class="tone-preset__input" id="sk-tone-preset-name" type="text" placeholder="Preset name" aria-label="Tone preset name">
          <button class="btn btn--ghost" id="sk-tone-preset-save" type="button">Save</button>
        </div>
      </div>
    `;
  }

  _bindTonePresetControls(popover = this.el?.querySelector('#sk-tone-popover')) {
    if (!popover) return;
    popover.querySelector('#sk-tone-preset-apply')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const preset = this._selectedTonePreset(popover);
      if (!preset) return showToast('Choose a Tone preset first');
      this.setSoundTraits(preset.soundTraits);
      if (this.onSoundTraitsChanged) this.onSoundTraitsChanged(this.soundTraits);
      showToast(`Tone preset applied: ${preset.name}`);
    });

    popover.querySelector('#sk-tone-preset-delete')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const preset = this._selectedTonePreset(popover);
      if (!preset) return showToast('Choose a Tone preset first');
      if (!confirm(`Delete Tone preset "${preset.name}"?`)) return;
      this._deleteTonePreset(preset.id);
      this._refreshTonePresetControls();
      showToast(`Tone preset deleted: ${preset.name}`);
    });

    popover.querySelector('#sk-tone-preset-save')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const input = popover.querySelector('#sk-tone-preset-name');
      const name = input?.value?.trim();
      if (!name) return showToast('Name the Tone preset first');
      this._saveTonePreset(name);
      if (input) input.value = '';
      this._refreshTonePresetControls();
      showToast(`Tone preset saved: ${name}`);
    });
  }

  _tonePresets() {
    if (!this.project?.settings) return [];
    if (!Array.isArray(this.project.settings.tonePresets)) this.project.settings.tonePresets = [];
    return this.project.settings.tonePresets;
  }

  _selectedTonePreset(root) {
    const id = root?.querySelector('#sk-tone-preset-select')?.value;
    return this._tonePresets().find(preset => preset.id === id) || null;
  }

  _saveTonePreset(name) {
    const presets = this._tonePresets();
    const existing = presets.find(p => p.name.toLowerCase() === name.toLowerCase());
    const preset = {
      id: existing?.id || crypto.randomUUID(),
      name,
      soundTraits: normalizeSoundTraits(this.soundTraits),
      updatedAt: Date.now(),
    };
    if (existing) Object.assign(existing, preset);
    else presets.push(preset);
    presets.sort((a, b) => a.name.localeCompare(b.name));
    window.dispatchEvent(new CustomEvent('project-tone-presets-changed'));
    if (this.onSoundTraitsChanged) this.onSoundTraitsChanged(this.soundTraits);
  }

  _deleteTonePreset(id) {
    if (!this.project?.settings || !id) return;
    this.project.settings.tonePresets = this._tonePresets().filter(preset => preset.id !== id);
    window.dispatchEvent(new CustomEvent('project-tone-presets-changed'));
    if (this.onSoundTraitsChanged) this.onSoundTraitsChanged(this.soundTraits);
  }

  _refreshTonePresetControls() {
    const popover = this.el?.querySelector('#sk-tone-popover');
    if (!popover) return;
    const old = popover.querySelector('.tone-preset');
    old?.insertAdjacentHTML('beforebegin', this._renderTonePresetControls());
    old?.remove();
    this._bindTonePresetControls(popover);
  }

  _closeTonePopover() {
    this.el?.querySelector('#sk-tone-popover')?.remove();
    this.el?.querySelector('#sk-tone-button')?.setAttribute('aria-expanded', 'false');
  }

  _setToneTraitAmount(id, amount, slider = null) {
    if (!id || !SOUND_TRAITS[id]) return;
    const traits = normalizeSoundTraits(this.soundTraits);
    traits[id] = { amount: Math.max(0, Math.min(1, Number(amount) || 0)) };
    this.setSoundTraits(traits);
    const rounded = Math.round(traits[id].amount * 100);
    if (slider) {
      slider.value = String(rounded);
      const value = slider.closest('.tone-row')?.querySelector('.tone-row__value');
      if (value) value.textContent = `${rounded}%`;
    }
    if (this.onSoundTraitsChanged) this.onSoundTraitsChanged(traits);
  }

  _syncToneSliders() {
    this.el?.querySelectorAll('[data-sk-tone-amount]').forEach(slider => {
      const id = slider.dataset.skToneAmount;
      const amount = Math.round((this.soundTraits?.[id]?.amount || 0) * 100);
      slider.value = String(amount);
      const value = slider.closest('.tone-row')?.querySelector('.tone-row__value');
      if (value) value.textContent = `${amount}%`;
    });
  }

  _rebuildEffects() {
    const ctx = this.engine.ctx;
    if (!ctx || !this._toneInput || !this._output) return;

    try { this._toneInput.disconnect(); } catch (_) {}
    for (const node of this._effectNodes) {
      try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
      try { node.disconnect(); } catch (_) {}
    }
    if (this._lfo) {
      try { this._lfo.stop(); } catch (_) {}
      try { this._lfo.disconnect(); } catch (_) {}
    }
    if (this._lfoGain) {
      try { this._lfoGain.disconnect(); } catch (_) {}
    }
    this._effectNodes = [];
    this._lfo = null;
    this._lfoGain = null;

    let current = this._toneInput;

    const crushAmount = this._traitCurve('crush');
    if (crushAmount > 0) {
      const crush = ctx.createWaveShaper();
      crush.curve = this._makeCrushCurve(crushAmount);
      current.connect(crush);
      current = crush;
      this._effectNodes.push(crush);
    }

    const driveAmount = this._traitCurve('drive');
    if (driveAmount > 0) {
      const drive = ctx.createWaveShaper();
      drive.curve = this._makeDriveCurve(driveAmount * 1.4);
      drive.oversample = '2x';
      current.connect(drive);
      current = drive;
      this._effectNodes.push(drive);
    }

    const wobbleAmount = this._traitCurve('wobble');
    if (wobbleAmount > 0) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(520 + (1 - wobbleAmount) * 7800, ctx.currentTime);
      filter.Q.setValueAtTime(1 + wobbleAmount * 12, ctx.currentTime);
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.8 + wobbleAmount * 7;
      lfoGain.gain.value = 650 + wobbleAmount * 3600;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();
      current.connect(filter);
      current = filter;
      this._lfo = lfo;
      this._lfoGain = lfoGain;
      this._effectNodes.push(filter);
    }

    const dryOut = ctx.createGain();
    dryOut.gain.value = 1;
    current.connect(dryOut);
    dryOut.connect(this._output);
    this._effectNodes.push(dryOut);

    const echoAmount = this._traitCurve('echo');
    if (echoAmount > 0) {
      const delay = ctx.createDelay(1.2);
      const feedback = ctx.createGain();
      const wet = ctx.createGain();
      delay.delayTime.value = 0.09 + echoAmount * 0.42;
      feedback.gain.value = 0.28 + echoAmount * 0.58;
      wet.gain.value = 0.12 + echoAmount * 0.72;
      current.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(this._output);
      this._effectNodes.push(delay, feedback, wet);
    }

    const spaceAmount = this._traitCurve('space');
    if (spaceAmount > 0) {
      const convolver = ctx.createConvolver();
      const wet = ctx.createGain();
      convolver.buffer = this._makeImpulse(0.8 + spaceAmount * 3.4, 0.9 + spaceAmount * 2.1);
      wet.gain.value = 0.18 + spaceAmount * 0.74;
      current.connect(convolver);
      convolver.connect(wet);
      wet.connect(this._output);
      this._effectNodes.push(convolver, wet);
    }

    const noiseAmount = this._traitCurve('noise');
    if (noiseAmount > 0) {
      const noiseGain = ctx.createGain();
      const noiseFilter = ctx.createBiquadFilter();
      const source = this._noiseSource(0.5);
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.value = 900 + noiseAmount * 4200;
      noiseGain.gain.value = 0.04 + noiseAmount * 0.22;
      current.connect(noiseGain);
      source.connect(noiseFilter);
      noiseFilter.connect(noiseGain.gain);
      noiseGain.connect(this._output);
      source.start();
      this._effectNodes.push(source, noiseFilter, noiseGain);
    }
  }

  _makeCrushCurve(amount) {
    const samples = 256;
    const curve = new Float32Array(samples);
    const steps = Math.max(2, Math.round(64 - amount * 61));
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
  }

  _makeDriveCurve(amount) {
    const samples = 256;
    const curve = new Float32Array(samples);
    const k = Math.max(0, amount) * 90;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  _makeImpulse(duration, decay) {
    const ctx = this.engine.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }

  _noiseSource(seconds = 0.5) {
    const ctx = this.engine.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = last * 0.5 + (Math.random() * 2 - 1) * 0.5;
      data[i] = last;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }
}
