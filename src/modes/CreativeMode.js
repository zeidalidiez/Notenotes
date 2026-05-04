/**
 * CreativeMode — The Jam Space.
 * Instrument switcher + active instrument view + synth patch selector.
 * Now with loop progress, punch-in recording, and snippet tray.
 */

import '../modes/creative.css';
import { WebAudioSynth, PRESETS } from '../instruments/WebAudioSynth.js';
import { ScaleBoard } from '../instruments/ScaleBoard.js';
import { MicroPiano } from '../instruments/MicroPiano.js';
import { SketchKit } from '../instruments/SketchKit.js';
import { MicRecorder } from '../instruments/MicRecorder.js';
import { ControllerMode } from '../instruments/ControllerMode.js';
import { RecordingManager } from '../engine/RecordingManager.js';
import { SnippetTray } from '../ui/SnippetTray.js';
import { LoopProgress } from '../ui/LoopProgress.js';
import { TransportState } from '../engine/Transport.js';
import { ArpeggioManager, ARP_MODES } from '../engine/ArpeggioManager.js';
import { showToast } from '../ui/Toast.js';

const INSTRUMENTS = {
  SCALEBOARD: 'scaleboard',
  PIANO: 'piano',
  KIT: 'kit',
  MIC: 'mic',
  CONTROLLER: 'controller',
};

const SCALE_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
const PIANO_KEYS = ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
const KIT_KEYS = SCALE_KEYS;

export class CreativeMode {
  constructor(engine, transport, quantizer, store, project, modManager) {
    this.engine = engine;
    this.transport = transport;
    this.quantizer = quantizer;
    this.store = store;
    this.project = project;
    this._modManager = modManager;
    this.el = null;
    this.activeInstrument = INSTRUMENTS.SCALEBOARD;

    // Synth (shared between Scale Board and Micro Piano)
    this.synth = new WebAudioSynth();

    // Instruments
    this.scaleBoard = new ScaleBoard(this.synth, this.project);
    this.microPiano = new MicroPiano(this.synth, this.project);
    this.sketchKit = new SketchKit(this.project);
    this.micRecorder = new MicRecorder();
    this.controllerMode = new ControllerMode(this.synth, this.project, modManager);

    // Recording
    this.recordingManager = new RecordingManager(transport, quantizer);

    // Arpeggio
    this.arpManager = new ArpeggioManager(transport, project);

    // UI
    this.snippetTray = new SnippetTray();
    this.loopProgress = new LoopProgress(transport, project);

    this._initialized = false;
    this._heldScaleKeyPads = new Map();
    this._heldPianoKeyIndexes = new Map();
  }

  set project(p) {
    this._project = p;
    if (this.scaleBoard) this.scaleBoard.project = p;
    if (this.microPiano) this.microPiano.project = p;
    if (this.sketchKit) this.sketchKit.project = p;
    if (this.controllerMode) this.controllerMode.project = p;
    if (this.arpManager) this.arpManager.project = p;
    if (this.loopProgress) this.loopProgress.project = p;
  }

  get project() {
    return this._project;
  }

  /**
   * Initialize audio nodes and recording hooks.
   */
  init() {
    if (this._initialized) return;

    this.synth.init();
    this.synth.loadPatch(PRESETS.chip_lead);
    this.sketchKit.init();
    this.recordingManager.init();

    if (this._modManager) {
      this._modManager._synth = this.synth;
    }

    // Wire modulation capture
    this.recordingManager.setModManager(this._modManager);
    this.transport.onTick(() => {
      this.recordingManager.captureModulation();
    });

    // Wrap synth with arpeggio manager (routes noteOn/noteOff through arp logic)
    this.arpManager.wrapSynth(this.synth);

    // Wire up note callbacks for recording
    const noteOn = (midi, vel) => this.recordingManager.noteOn(midi, vel);
    const noteOff = (midi) => this.recordingManager.noteOff(midi);
    this.scaleBoard.setNoteCallbacks(noteOn, noteOff);
    this.microPiano.setNoteCallbacks(noteOn, noteOff);
    this.controllerMode.setNoteCallbacks(noteOn, noteOff);
    this.sketchKit.setHitCallback((drumName) => this.recordingManager.drumHit(drumName));

    // When snippets are created
    this.recordingManager.onSnippetCreated((snippet) => {
      this.snippetTray.addSnippet(snippet);

      // Also save to project
      if (this.project) {
        this.project.snippets.push(snippet);
        this.store?.scheduleAutoSave(this.project);
      }

      showToast(`Snippet captured! (${(snippet.notes?.length || 0) + (snippet.hits?.length || 0)} events)`);
    });

    // Arm recording when transport enters recording state
    this.transport.onStateChange((state) => {
      this.recordingManager.setArmed(state === TransportState.RECORDING);
      if (state === TransportState.RECORDING && this.activeInstrument === INSTRUMENTS.MIC) {
        this.micRecorder._startRecording();
      }
      if (state !== TransportState.RECORDING && this.micRecorder._isRecording) {
        this.micRecorder._stopRecording();
      }
    });

    // Wire mic audio blob → create audio snippet
    this.micRecorder.setRecordingCallback((blob) => {
      const url = URL.createObjectURL(blob);
      const elapsedMs = this.micRecorder._startTime ? Date.now() - this.micRecorder._startTime : 8000;
      const beats = this.transport.bpm / 60;
      const ticksPerBeat = this.transport.ticksPerBeat;
      const durationTicks = Math.max(480, Math.round((elapsedMs / 1000) * beats * ticksPerBeat));
      const snippet = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        type: 'audio',
        name: 'Audio in recording',
        notes: [],
        hits: [],
        durationTicks,
        bpm: this.transport.bpm,
        timeSignature: { ...this.transport.timeSignature },
        audioUrl: url,
      };
      this.snippetTray.addSnippet(snippet);
      if (this.project) {
        this.project.snippets.push(snippet);
        this.store?.scheduleAutoSave(this.project);
      }
      showToast('Audio snippet captured!');
    });

    this._initialized = true;
  }

  ensureAudioReady() {
    try {
      if (!this.engine._initialized) {
        this.engine.initSync();
      }
      if (!this._initialized) {
        this.init();
      }
      if (this.engine.ctx?.state === 'suspended') {
        this.engine.ctx.resume().catch(() => {});
      }
      return true;
    } catch (err) {
      console.warn('[CreativeMode] Audio unlock failed:', err);
      return false;
    }
  }

  /**
   * Render the Creative Mode view.
   * @returns {HTMLElement}
   */
  render() {
    this.el = document.createElement('div');
    this.el.className = 'creative-mode';
    this.el.style.cssText = 'display:flex;flex-direction:column;height:100%;';
    this.el.addEventListener('pointerdown', () => this.ensureAudioReady(), { capture: true });
    this.el.addEventListener('touchstart', () => this.ensureAudioReady(), { capture: true, passive: true });

    // Loop progress bar (top of creative mode)
    this.el.appendChild(this.loopProgress.render());

    // Instrument switcher tabs
    const switcher = document.createElement('div');
    switcher.className = 'instrument-switcher';
    switcher.id = 'instrument-switcher';
    const tabs = [
      { id: INSTRUMENTS.SCALEBOARD, icon: '🎹', label: 'Scale' },
      { id: INSTRUMENTS.CONTROLLER, icon: '🎮', label: 'Ctrl' },
      { id: INSTRUMENTS.PIANO, icon: '🎵', label: 'Piano' },
      { id: INSTRUMENTS.KIT, icon: '🥁', label: 'Kit' },
      { id: INSTRUMENTS.MIC, icon: '🎤', label: 'Audio In' },
    ];
    tabs.forEach(t => {
      const btn = document.createElement('button');
      btn.className = `instrument-switcher__tab${t.id === this.activeInstrument ? ' is-active' : ''}`;
      btn.dataset.instrument = t.id;
      btn.innerHTML = `<span>${t.icon}</span><span>${t.label}</span>`;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._switchInstrument(t.id);
      });
      switcher.appendChild(btn);
    });
    this.el.appendChild(switcher);

    // Patch selector (visible for synth instruments)
    const patchSel = document.createElement('div');
    patchSel.className = 'patch-selector';
    patchSel.id = 'patch-selector';
    patchSel.innerHTML = `
      <span class="patch-selector__label">Patch</span>
      <select id="patch-select" aria-label="Synth patch">
        ${Object.entries(PRESETS).map(([key, p]) =>
          `<option value="${key}">${p.name}</option>`
        ).join('')}
      </select>
    `;
    patchSel.querySelector('#patch-select').addEventListener('change', (e) => {
      const patch = PRESETS[e.target.value];
      if (patch) this.synth.loadPatch(patch);
    });
    this.el.appendChild(patchSel);

    // Instrument views container
    const container = document.createElement('div');
    container.className = 'instrument-container';

    const views = [
      { id: INSTRUMENTS.SCALEBOARD, content: this.scaleBoard.render() },
      { id: INSTRUMENTS.PIANO, content: this.microPiano.render() },
      { id: INSTRUMENTS.KIT, content: this.sketchKit.render() },
      { id: INSTRUMENTS.MIC, content: this.micRecorder.render() },
      { id: INSTRUMENTS.CONTROLLER, content: this.controllerMode.render() },
    ];

    views.forEach(v => {
      const wrapper = document.createElement('div');
      wrapper.className = `instrument-view${v.id === this.activeInstrument ? ' is-active' : ''}`;
      wrapper.id = `instrument-${v.id}`;
      wrapper.appendChild(v.content);
      container.appendChild(wrapper);
    });

    this.el.appendChild(container);

    // Snippet tray (bottom)
    this.el.appendChild(this.snippetTray.render());
    this._bindKeyboardPerformance();

    return this.el;
  }

  _bindKeyboardPerformance() {
    if (this._keyboardBound) return;
    this._keyboardBound = true;

    document.addEventListener('keydown', (e) => {
      if (!this._isCreativeActive() || this._isTextInput(e.target) || e.repeat) return;

      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        if (this._shiftActiveInstrumentOctave(e.code === 'ArrowUp' ? 1 : -1)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (this.activeInstrument === INSTRUMENTS.SCALEBOARD) {
        const idx = SCALE_KEYS.indexOf(e.code);
        if (idx === -1) return;
        if (idx >= this.scaleBoard._notes.length) return;

        e.preventDefault();
        e.stopPropagation();
        this.ensureAudioReady();
        this._heldScaleKeyPads.set(e.code, idx);
        this.scaleBoard.pressPad(idx);
        return;
      }

      if (this.activeInstrument === INSTRUMENTS.PIANO) {
        const idx = PIANO_KEYS.indexOf(e.code);
        if (idx === -1) return;
        if (idx >= this.microPiano.visibleMidis().length) return;

        e.preventDefault();
        e.stopPropagation();
        this.ensureAudioReady();
        this._heldPianoKeyIndexes.set(e.code, idx);
        this.microPiano.pressVisibleKey(idx);
        return;
      }

      if (this.activeInstrument === INSTRUMENTS.KIT) {
        const idx = KIT_KEYS.indexOf(e.code);
        if (idx === -1) return;
        if (idx >= this.sketchKit.visiblePadIds().length) return;

        e.preventDefault();
        e.stopPropagation();
        this.ensureAudioReady();
        this.sketchKit.triggerVisiblePad(idx);
      }
    }, true);

    document.addEventListener('keyup', (e) => {
      if (this._heldScaleKeyPads.has(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        const idx = this._heldScaleKeyPads.get(e.code);
        this.scaleBoard.releasePad(idx);
        this._heldScaleKeyPads.delete(e.code);
        return;
      }

      if (this._heldPianoKeyIndexes.has(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        const idx = this._heldPianoKeyIndexes.get(e.code);
        this.microPiano.releaseVisibleKey(idx);
        this._heldPianoKeyIndexes.delete(e.code);
      }
    }, true);
  }

  _isCreativeActive() {
    return !!this.el?.closest('.mode-view.is-active');
  }

  _isTextInput(target) {
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;
  }

  _shiftActiveInstrumentOctave(delta) {
    if (this.activeInstrument === INSTRUMENTS.SCALEBOARD) {
      this.scaleBoard.shiftOctave(delta);
      return true;
    }
    if (this.activeInstrument === INSTRUMENTS.PIANO) {
      this.microPiano.shiftOctave(delta);
      return true;
    }
    if (this.activeInstrument === INSTRUMENTS.CONTROLLER) {
      this.controllerMode.shiftOctave(delta);
      return true;
    }
    return false;
  }

  _switchInstrument(id) {
    if (id === this.activeInstrument) return;
    this._releaseKeyboardPerformance();
    this.synth.allNotesOff();
    this.arpManager.setMode(ARP_MODES.OFF);
    this.activeInstrument = id;

    this.el.querySelectorAll('.instrument-switcher__tab').forEach(tab => {
      tab.classList.toggle('is-active', tab.dataset.instrument === id);
    });

    this.el.querySelectorAll('.instrument-view').forEach(view => {
      view.classList.toggle('is-active', view.id === `instrument-${id}`);
    });

    const patchSel = this.el.querySelector('#patch-selector');
    const isSynth = id === INSTRUMENTS.SCALEBOARD || id === INSTRUMENTS.PIANO || id === INSTRUMENTS.CONTROLLER;
    patchSel.style.display = isSynth ? 'flex' : 'none';
  }

  _releaseKeyboardPerformance() {
    for (const idx of this._heldScaleKeyPads.values()) {
      this.scaleBoard.releasePad(idx);
    }
    for (const idx of this._heldPianoKeyIndexes.values()) {
      this.microPiano.releaseVisibleKey(idx);
    }
    this._heldScaleKeyPads.clear();
    this._heldPianoKeyIndexes.clear();
  }
}
