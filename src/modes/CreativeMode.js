/**
 * CreativeMode — The Jam Space.
 * Instrument switcher + active instrument view + synth patch selector.
 * Now with loop progress, punch-in recording, and snippet tray.
 */

import '../modes/creative.css';
import { WebAudioSynth, PRESETS, SOUND_TRAITS, normalizeSoundTraits } from '../instruments/WebAudioSynth.js';
import {
  DEFAULT_DEGREE_COLORS,
  degreeForMidi,
  midiToNoteName,
  normalizeDegreeHighlighting,
  normalizeMusicalContext,
  SCALES
} from '../engine/MusicTheory.js';
import { ScaleBoard } from '../instruments/ScaleBoard.js';
import { MicroPiano } from '../instruments/MicroPiano.js';
import { SketchKit } from '../instruments/SketchKit.js';
import { MicRecorder } from '../instruments/MicRecorder.js';
import { ControllerMode } from '../instruments/ControllerMode.js';
import { RecordingManager } from '../engine/RecordingManager.js';
import { SnippetTray } from '../ui/SnippetTray.js';
import { AISeedPanel } from '../ui/AISeedPanel.js';
import '../ui/AISeedPanel.css';
import { AIController } from '../ai/AIController.js';
import { VoiceEngine } from '../instruments/voice/VoiceEngine.js';
import englishBaseVoice from '../instruments/voice/voices/english-base.json';
import { LoopProgress } from '../ui/LoopProgress.js';
import { TransportState } from '../engine/Transport.js';
import { ArpeggioManager, ARP_MODES } from '../engine/ArpeggioManager.js';
import { BINDABLE_GAMEPAD_BUTTONS, GamepadInputManager, gamepadButtonInfo } from '../engine/GamepadInputManager.js';
import { showToast } from '../ui/Toast.js';

const INSTRUMENTS = {
  SCALEBOARD: 'scaleboard',
  PIANO: 'piano',
  KIT: 'kit',
  MIC: 'mic',
  CONTROLLER: 'controller',
};

const SCALE_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal', 'Backquote'];
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
    this.gamepadInput = new GamepadInputManager();
    this.el = null;
    this.activeInstrument = INSTRUMENTS.SCALEBOARD;

    // Synth (shared between Scale Board and Micro Piano)
    this.synth = new WebAudioSynth();

    // Voice engine — formant-synthesized vocal instrument used by Scale
    // Board's "Voice Sketch" pad mode. Routes through the synth's tone
    // input so it inherits the same Tone Traits chain. MUST be instantiated
    // BEFORE ScaleBoard, because ScaleBoard's renderer reads `this.voiceEngine`
    // to decide whether to surface the Voice Sketch option in the Pad Mode
    // dropdown.
    this.voiceEngine = new VoiceEngine(engine);
    this.voiceEngine.loadVoice(englishBaseVoice);

    // Instruments
    this.scaleBoard = new ScaleBoard(this.synth, this.project, this.voiceEngine);
    this.scaleBoard.onVoicePhraseChanged = () => this.store?.scheduleAutoSave(this.project);
    this.scaleBoard.onExtensionsChanged = () => this.store?.scheduleAutoSave(this.project);
    // When Scale Board switches into/out of Voice Sketch mode, refresh any
    // open AI Seed popover. AI can't generate voice phrases, so the panel
    // disables itself with "Unavailable in Voice Sketch mode" instead of
    // hiding the button entirely (the user might want to see the AI button
    // is there, just not usable right now).
    this.scaleBoard.onPadModeChange = () => {
      this._aiSeedPanelInstance?.refresh();
      this._syncCreateToolbarButtons();
    };
    this.microPiano = new MicroPiano(this.synth, this.project);
    this.sketchKit = new SketchKit(this.project);
    this.sketchKit.onSoundTraitsChanged = (traits) => this._applyProjectSoundTraits(traits);
    this.sketchKit.onCreateInstrument = (anchor) => this._toggleCreateInstrumentPopover(anchor);
    this.sketchKit.onDeleteInstrument = () => this._deleteSelectedCustomInstrument();
    this.sketchKit.onKitChanged = () => this.store?.scheduleAutoSave(this.project);
    this.sketchKit.onAISeedClick = (anchor, buttonEl) => this._toggleAISeedPopover(anchor, buttonEl);
    this.sketchKit.onControllerMapperClick = (anchor, buttonEl) => this._toggleControllerMapperPopover(anchor, buttonEl);
    this.micRecorder = new MicRecorder();
    this.controllerMode = new ControllerMode(this.synth, this.project, modManager, this.gamepadInput);
    this.controllerMode.onToneAssignmentChanged = () => this.store?.scheduleAutoSave(this.project);
    this.controllerMode.onToneOverrideChanged = (traits, labels = []) => {
      this._setLiveSoundTraits(traits);
      this._updateToneTriggerIndicator(labels);
    };

    // Recording
    this.recordingManager = new RecordingManager(transport, quantizer);

    // Arpeggio
    this.arpManager = new ArpeggioManager(transport, project);

    // UI
    this.snippetTray = new SnippetTray();
    this.snippetTray.setSnippetUsageProvider((snippetId) => this._snippetInstrumentUsage(snippetId));
    this.loopProgress = new LoopProgress(transport, project);

    // AI Seed: gives the user a way to ask an LLM (or local Mock) to seed a
    // snippet. Scope is constrained: AI can only build a snippet via the
    // submitSequence tool. It can't change tempo, meter, instrument, or
    // anything structural. The user is the composer; AI is an instrument.
    //
    // The controller is always live; the panel is rendered on demand inside
    // a popover triggered by the AI Seed button. The button itself is only
    // visible when the active instrument is something the AI can play
    // (Scale Board / Piano / Sketch Kit).
    this.aiController = new AIController({
      transport,
      getProject: () => this.project,
      getActiveInstrumentInfo: () => this._buildAIInstrumentInfo(),
    });
    this._aiSeedPopover = null;
    this._aiSeedPanelInstance = null;

    this._initialized = false;
    this._heldScaleKeyPads = new Map();
    this._heldPianoKeyIndexes = new Map();
    this._tonePopover = null;
    this._toneClickOutsideHandler = null;
    this._instrumentPopover = null;
    this._instrumentClickOutsideHandler = null;
    this._padsPopover = null;
    this._padsClickOutsideHandler = null;
    this._keysPopover = null;
    this._keysClickOutsideHandler = null;
    this._controllerMapperPopover = null;
    this._controllerMapperClickOutsideHandler = null;
    this._controllerMapperView = 'learn';
    this._controllerLearningButton = null;
    this._heldControllerMidis = new Map();
    this._heldControllerFallback = new Map();
    this._recordArmed = false;
    this.onRecordArmChanged = null;
    this._activePatchId = 'chip_lead';
    this._currentToneTraits = this._currentToneTraits || null;
    this.onProjectKeyChange = null;
  }

  set project(p) {
    this._project = p;
    if (this.scaleBoard) this.scaleBoard.project = p;
    if (this.microPiano) this.microPiano.project = p;
    if (this.sketchKit) this.sketchKit.project = p;
    if (this.controllerMode) this.controllerMode.project = p;
    if (this.arpManager) this.arpManager.project = p;
    if (this.loopProgress) this.loopProgress.project = p;
    this._currentToneTraits = this._normalizeProjectSoundTraits(p);
    this._ensureDegreeHighlighting();
    if (this.synth) this._setLiveSoundTraits(this._currentToneTraits);
    this.refreshProjectBoundUi();
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
    // Connect the voice engine to the synth's tone input so voices route
    // through the same Tone Traits chain as the rest of the synth output.
    if (this.voiceEngine) {
      this.voiceEngine.setDestination(this.synth.getSynthInput());
    }
    this._applyProjectSoundTraits(this._ensureSoundTraits(), { save: false, notify: false });
    this.sketchKit.init();
    this.sketchKit.setSoundTraits(this._currentToneTraits || this._ensureSoundTraits());
    this.recordingManager.init();

    if (this._modManager) {
      this._modManager._synth = this.synth;
    }

    // Wire modulation capture
    this.recordingManager.setModManager(this._modManager);
    this.recordingManager.setBaseToneProvider(() => this._baseSoundTraitsSnapshot());
    this.recordingManager.setToneProvider(() => this._currentSoundTraitsSnapshot());
    this.transport.onTick(() => {
      this.recordingManager.captureModulation();
    });

    // Wrap synth with arpeggio manager (routes noteOn/noteOff through arp logic)
    this.arpManager.wrapSynth(this.synth);

    // Wire up note callbacks for recording
    const noteOn = (midi, vel, meta) => this.recordingManager.noteOn(midi, vel, meta);
    const noteOff = (midi) => this.recordingManager.noteOff(midi);
    this.scaleBoard.setNoteCallbacks(noteOn, noteOff);
    this.microPiano.setNoteCallbacks(noteOn, noteOff);
    this.controllerMode.setNoteCallbacks(noteOn, noteOff);
    const startArmedRecording = () => this._beginArmedRecordingIfNeeded();
    this.scaleBoard.setBeforeNoteCallback(startArmedRecording);
    this.microPiano.setBeforeNoteCallback(startArmedRecording);
    this.controllerMode.setBeforeNoteCallback(startArmedRecording);
    this.sketchKit.setBeforeHitCallback(startArmedRecording);
    this.sketchKit.setHitCallback((drumName) => this.recordingManager.drumHit(drumName));
    this.scaleBoard.setControllerLearnCallback((target) => this._handleControllerLearnTarget(target));
    this.microPiano.setControllerLearnCallback((target) => this._handleControllerLearnTarget(target));
    this.sketchKit.setControllerLearnCallback((target) => this._handleControllerLearnTarget(target));
    this._bindGamepadInput();
    this.gamepadInput.start();

    // When snippets are created
    this.recordingManager.onSnippetCreated((snippet) => {
      this._stampRecordedPatch(snippet);
      this.snippetTray.addSnippet(snippet);

      // Also save to project
      if (this.project) {
        this.project.snippets.push(snippet);
        this.store?.scheduleAutoSave(this.project);
      }
      window.dispatchEvent(new CustomEvent('project-snippets-changed', { detail: { snippetId: snippet.id, action: 'created' } }));

      showToast(`Snippet captured! (${(snippet.notes?.length || 0) + (snippet.hits?.length || 0)} events)`);
    });

    // Arm recording when transport enters recording state
    this.transport.onStateChange((state) => {
      this.recordingManager.setArmed(state === TransportState.RECORDING);
      if (state === TransportState.RECORDING) this.setRecordArmed(false, { silent: true });
      if (state === TransportState.RECORDING && this.activeInstrument === INSTRUMENTS.MIC) {
        this.micRecorder._startRecording();
      }
      if (state !== TransportState.RECORDING && this.micRecorder._isRecording) {
        this.micRecorder._stopRecording();
      }
    });

    // Wire mic audio blob → create audio snippet
    this.micRecorder.setRecordingCallback(async (blob) => {
      try {
        if (!blob?.size) throw new Error('No audio was captured');
        const record = await this.store?.saveAudioAsset(blob, {
          mimeType: blob.type || 'audio/webm',
          size: blob.size,
          createdAt: Date.now(),
        });
        const url = URL.createObjectURL(blob);
        const elapsedMs = this.micRecorder._startTime ? Date.now() - this.micRecorder._startTime : 8000;
        const beats = this.transport.bpm / 60;
        const ticksPerBeat = this.transport.ticksPerBeat;
        const durationTicks = Math.max(480, Math.round((elapsedMs / 1000) * beats * ticksPerBeat));
        const audioPeaks = await this._audioPeaksFromBlob(blob);
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
          audioAssetId: record?.audioAssetId || null,
          audioUrl: url,
          audioMimeType: blob.type || 'audio/webm',
          audioSize: blob.size,
          audioPeaks,
        };
        this.snippetTray.addSnippet(snippet);
        if (this.project) {
          this.project.snippets.push(snippet);
          this.store?.scheduleAutoSave(this.project);
        }
        window.dispatchEvent(new CustomEvent('project-snippets-changed', { detail: { snippetId: snippet.id, action: 'created' } }));
        showToast('Audio snippet captured!');
      } catch (err) {
        console.warn('[CreativeMode] Audio snippet capture failed:', err);
        showToast(err?.message || 'Audio snippet capture failed');
      }
    });

    this._initialized = true;
  }

  async _audioPeaksFromBlob(blob, bins = 48) {
    if (!blob?.size) return [];
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return [];
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      await ctx.close?.();
      return this._audioPeaksFromBuffer(decoded, bins);
    } catch (err) {
      console.warn('[CreativeMode] Audio peak analysis failed:', err);
      return [];
    }
  }

  _audioPeaksFromBuffer(buffer, bins = 48) {
    const length = buffer?.length || 0;
    if (!length) return [];
    const channels = Math.max(1, buffer.numberOfChannels || 1);
    const blockSize = Math.max(1, Math.floor(length / bins));
    const peaks = [];
    for (let i = 0; i < bins; i++) {
      const start = i * blockSize;
      const end = i === bins - 1 ? length : Math.min(length, start + blockSize);
      let sum = 0;
      let count = 0;
      for (let ch = 0; ch < channels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let j = start; j < end; j++) {
          const sample = data[j] || 0;
          sum += sample * sample;
          count++;
        }
      }
      peaks.push(count ? Math.sqrt(sum / count) : 0);
    }
    const max = Math.max(...peaks, 0.0001);
    return peaks.map(value => Math.round((value / max) * 100) / 100);
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
      <span class="patch-selector__label" id="patch-selector-label">Patch</span>
      <select id="patch-select" aria-label="Synth patch">
        ${this._renderPatchOptions()}
      </select>
      <button class="tone-button" id="create-instrument-button" type="button">${this._activePatchId.startsWith('custom:') ? 'Edit Instrument' : 'Create Instrument'}</button>
      <button class="tone-button" id="delete-instrument-button" type="button">Delete</button>
      <button class="tone-button" id="tone-button" type="button" aria-expanded="false" aria-controls="tone-popover">Tone</button>
      <button class="tone-button ai-seed-button" id="ai-seed-button" type="button" aria-expanded="false" aria-controls="ai-seed-popover" title="Seed a snippet with AI">AI</button>
      <button class="tone-button controller-map-button" id="controller-map-button" type="button" aria-expanded="false" aria-controls="controller-map-popover" title="Learn gamepad bindings">Controller</button>
      <button class="tone-button" id="layout-button" type="button" aria-expanded="false" aria-controls="layout-popover">Layout</button>
      <span class="tone-trigger-indicator" id="tone-trigger-indicator" aria-live="polite"></span>
    `;
    patchSel.querySelector('#patch-select').addEventListener('change', async (e) => {
      await this._selectPatch(e.target.value);
      this._syncInstrumentButtons();
    });
    patchSel.querySelector('#create-instrument-button').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._toggleCreateInstrumentPopover(patchSel);
    });
    patchSel.querySelector('#delete-instrument-button').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._deleteSelectedCustomInstrument();
    });
    patchSel.querySelector('#tone-button').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._toggleTonePopover(patchSel);
    });
    patchSel.querySelector('#ai-seed-button').addEventListener('click', (e) => {
      e.preventDefault();
      this._toggleAISeedPopover(patchSel, patchSel.querySelector('#ai-seed-button'));
    });
    patchSel.querySelector('#controller-map-button').addEventListener('click', (e) => {
      e.preventDefault();
      this._toggleControllerMapperPopover(patchSel, patchSel.querySelector('#controller-map-button'));
    });
    patchSel.querySelector('#layout-button').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (e.currentTarget.disabled) return;
      if (this.activeInstrument === INSTRUMENTS.SCALEBOARD) this._togglePadsPopover(patchSel, e.currentTarget);
      else if (this.activeInstrument === INSTRUMENTS.PIANO) this._toggleKeysPopover(patchSel, e.currentTarget);
    });
    this.el.appendChild(patchSel);
    this._syncInstrumentButtons();

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

    // Sync context-specific toolbar buttons once the instruments exist.
    this._syncCreateToolbarButtons();
    this._bindKeyboardPerformance();

    return this.el;
  }

  _renderPatchOptions() {
    const custom = this._customInstruments().filter(instrument => instrument.type === 'patch');
    const chipPresets = Object.entries(PRESETS).filter(([, p]) => (p.family || 'chip') === 'chip');
    const modernPresets = Object.entries(PRESETS).filter(([, p]) => p.family === 'modern');
    const renderOptions = entries => entries.map(([key, p]) =>
      `<option value="${key}" ${key === this._activePatchId ? 'selected' : ''}>${p.name}</option>`
    ).join('');
    return `
      <optgroup label="Chip presets">${renderOptions(chipPresets)}</optgroup>
      <optgroup label="Modern presets">${renderOptions(modernPresets)}</optgroup>
      ${custom.length ? `
        <optgroup label="Custom instruments">
          ${custom.map(instrument =>
            `<option value="custom:${instrument.id}" ${`custom:${instrument.id}` === this._activePatchId ? 'selected' : ''}>${instrument.name}</option>`
          ).join('')}
        </optgroup>
      ` : ''}
    `;
  }

  _refreshPatchSelector() {
    const select = this.el?.querySelector('#patch-select');
    if (!select) return;
    select.innerHTML = this._renderPatchOptions();
    if ([...select.options].some(option => option.value === this._activePatchId)) {
      select.value = this._activePatchId;
    }
    this._syncInstrumentButtons();
  }

  refreshProjectBoundUi() {
    if (!this.el) return;
    this._refreshPatchSelector();
    this.scaleBoard?.setProjectKey?.(this._ensureMusicalContext());
    this.microPiano?.refreshDegreeHighlights?.();
    this.sketchKit?.refreshKitSelector?.();
    this.snippetTray?._renderSnippets?.();
  }

  _ensureMusicalContext() {
    if (!this.project) return normalizeMusicalContext();
    const context = normalizeMusicalContext(this.project.musicalContext);
    this.project.musicalContext = context;
    return context;
  }

  applyProjectMusicalContext(context) {
    if (!this.project) return;
    const next = normalizeMusicalContext(context);
    this.project.musicalContext = next;
    this.scaleBoard?.setProjectKey?.(next);
    this.controllerMode?.setProjectKey?.(next);
    this.microPiano?.refreshDegreeHighlights?.();
    this._aiSeedPanelInstance?.refresh?.();
  }

  _emitProjectKeyChange(context) {
    const next = normalizeMusicalContext(context);
    if (this.onProjectKeyChange) {
      this.onProjectKeyChange(next);
      return;
    }
    if (this.project) {
      this.project.musicalContext = next;
      this.store?.scheduleAutoSave(this.project);
      this.applyProjectMusicalContext(next);
      window.dispatchEvent(new CustomEvent('project-musical-context-changed', { detail: next }));
    }
  }

  _ensureDegreeHighlighting() {
    if (!this.project) return normalizeDegreeHighlighting();
    this.project.settings ||= {};
    this.project.settings.degreeHighlighting = normalizeDegreeHighlighting(this.project.settings.degreeHighlighting);
    return this.project.settings.degreeHighlighting;
  }

  _activeScaleIntervals() {
    const context = this._ensureMusicalContext();
    return SCALES[context.scale]?.intervals || SCALES.major.intervals;
  }

  _syncInstrumentButtons() {
    const isCustom = this._activePatchId?.startsWith('custom:');
    const createBtn = this.el?.querySelector('#create-instrument-button');
    const deleteBtn = this.el?.querySelector('#delete-instrument-button');
    const patchLabel = this.el?.querySelector('#patch-selector-label');
    const patchSelect = this.el?.querySelector('#patch-select');
    const toneBtn = this.el?.querySelector('#tone-button');
    const isKit = this.activeInstrument === INSTRUMENTS.KIT;
    if (patchLabel) patchLabel.hidden = isKit;
    if (patchSelect) patchSelect.hidden = isKit;
    if (toneBtn) toneBtn.hidden = isKit;
    if (createBtn) createBtn.textContent = isCustom ? 'Edit Instrument' : 'Create Instrument';
    if (deleteBtn) deleteBtn.hidden = !isCustom;
  }

  _customInstruments() {
    if (!this.project?.settings) return [];
    if (!Array.isArray(this.project.settings.customInstruments)) {
      this.project.settings.customInstruments = [];
    }
    return this.project.settings.customInstruments;
  }

  async _selectPatch(id = 'chip_lead') {
    this._activePatchId = id;
    if (id.startsWith('custom:')) {
      const instrument = this._customInstruments().find(item => item.id === id.slice(7));
      if (!instrument) {
        showToast('Custom instrument is missing');
        return;
      }
      await this._loadSamplePatch(instrument);
    } else {
      const patch = PRESETS[id];
      if (patch) this.synth.loadPatch(patch);
    }
    this._setLiveSoundTraits(this.controllerMode?.currentSoundTraits(this._currentToneTraits || this._ensureSoundTraits()));
  }

  async _loadSamplePatch(instrument) {
    if (!instrument?.audioAssetId || !this.store?.getAudioAssetBlob) {
      showToast('Sample audio is missing');
      return;
    }
    try {
      const blob = await this.store.getAudioAssetBlob(instrument.audioAssetId);
      if (!blob) throw new Error('Sample audio is unavailable');
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = await this.engine.ctx.decodeAudioData(arrayBuffer.slice(0));
      this.synth.loadPatch({
        type: 'sample',
        name: instrument.name,
        sampleBuffer: buffer,
        rootMidi: instrument.rootMidi ?? 60,
        playbackMode: instrument.playbackMode || 'gated',
        envelope: {
          attack: instrument.attack ?? 0.005,
          decay: instrument.decay ?? 0.08,
          sustain: instrument.sustain ?? 0.8,
          release: instrument.release ?? 0.18,
        },
        filter: {
          type: 'lowpass',
          frequency: instrument.brightness ? 1200 + instrument.brightness * 10800 : 9000,
          Q: 0.8,
        },
        gain: instrument.gain ?? 0.55,
      });
      showToast(`Instrument loaded: ${instrument.name}`);
    } catch (err) {
      console.warn('[CreativeMode] Custom instrument load failed:', err);
      showToast(err?.message || 'Custom instrument failed to load');
    }
  }

  _toggleCreateInstrumentPopover(anchor) {
    if (this._instrumentPopover) {
      this._closeCreateInstrumentPopover();
      return;
    }

    const customInstruments = this._customInstruments();
    const editingInstrument = this._selectedCustomInstrument();
    const defaultType = editingInstrument?.type || (this.activeInstrument === INSTRUMENTS.KIT ? 'kit' : 'patch');
    const audioSnippets = (this.project?.snippets || []).filter(snippet => snippet.type === 'audio' && snippet.audioAssetId);
    const popover = document.createElement('div');
    popover.className = 'tone-popover custom-instrument-popover';
    popover.id = 'custom-instrument-popover';
    popover.innerHTML = `
      <div class="tone-popover__header">
        <span id="ci-title">${editingInstrument ? 'Edit Instrument' : 'Create Instrument'}</span>
      </div>
      <div class="custom-instrument-form" data-editing-id="${this._escapeAttr(editingInstrument?.id || '')}">
        ${customInstruments.length ? `
          <label class="custom-instrument-field">
            <span>Instrument</span>
            <select id="ci-existing" aria-label="Instrument to edit">
              <option value="">New instrument</option>
              ${customInstruments.map(instrument => `
                <option value="${this._escapeAttr(instrument.id)}" ${instrument.id === editingInstrument?.id ? 'selected' : ''}>
                  ${this._escapeHtml(instrument.type === 'kit' ? 'Kit' : 'Patch')}: ${this._escapeHtml(instrument.name || 'Untitled')}
                </option>
              `).join('')}
            </select>
          </label>
        ` : ''}
        <label class="custom-instrument-field">
          <span>Name</span>
          <input id="ci-name" type="text" placeholder="My sample patch" value="${this._escapeAttr(editingInstrument?.name || '')}" aria-label="Instrument name">
        </label>
        <label class="custom-instrument-field">
          <span>Type</span>
          <select id="ci-type" aria-label="Instrument type">
            <option value="patch" ${defaultType !== 'kit' ? 'selected' : ''}>Patch</option>
            <option value="kit" ${defaultType === 'kit' ? 'selected' : ''}>Kit</option>
          </select>
        </label>
        <label class="custom-instrument-field">
          <span>Audio snippet</span>
          <select id="ci-snippet" aria-label="Audio snippet source">
            <option value="">Use imported file...</option>
            ${audioSnippets.map(snippet => `<option value="${snippet.id}">${snippet.name || 'Audio in recording'}</option>`).join('')}
          </select>
        </label>
        <label class="custom-instrument-field">
          <span>Audio file</span>
          <input id="ci-file" type="file" accept="audio/*" aria-label="Audio file source">
        </label>
        <label class="custom-instrument-field ci-patch-only">
          <span>Root note</span>
          <select id="ci-root" aria-label="Root note">
            ${this._rootNoteOptions(editingInstrument?.rootMidi ?? 60)}
          </select>
          <small>The note your original sample already sounds like. That note plays unshifted; other notes pitch it up or down.</small>
        </label>
        <label class="custom-instrument-field ci-patch-only">
          <span>Playback</span>
          <select id="ci-playback" aria-label="Playback mode">
            <option value="gated" ${editingInstrument?.playbackMode !== 'oneShot' ? 'selected' : ''}>Gated</option>
            <option value="oneShot" ${editingInstrument?.playbackMode === 'oneShot' ? 'selected' : ''}>One-shot</option>
          </select>
        </label>
        <label class="custom-instrument-field">
          <span>Brightness <b id="ci-brightness-value">${Math.round((editingInstrument?.brightness ?? 0.7) * 100)}%</b></span>
          <input id="ci-brightness" type="range" min="0" max="100" value="${Math.round((editingInstrument?.brightness ?? 0.7) * 100)}" aria-label="Brightness">
        </label>
        <label class="custom-instrument-field">
          <span>Gain <b id="ci-gain-value">${Math.round((editingInstrument?.gain ?? 0.55) * 100)}%</b></span>
          <input id="ci-gain" type="range" min="10" max="100" value="${Math.round((editingInstrument?.gain ?? 0.55) * 100)}" aria-label="Gain">
        </label>
        <p class="custom-instrument-note" id="ci-kit-note" hidden>Kit instruments are saved now; live Kit playback is the next wiring step.</p>
        <div class="tone-preset__row">
          <button class="btn btn--ghost" id="ci-save" type="button">${editingInstrument ? 'Update Instrument' : 'Save Instrument'}</button>
        </div>
      </div>
    `;

    anchor.appendChild(popover);
    this._instrumentPopover = popover;

    const syncType = () => {
      const isKit = popover.querySelector('#ci-type')?.value === 'kit';
      popover.querySelectorAll('.ci-patch-only').forEach(el => { el.hidden = isKit; });
      const note = popover.querySelector('#ci-kit-note');
      if (note) note.hidden = !isKit;
    };
    const syncSlider = (id) => {
      const slider = popover.querySelector(`#ci-${id}`);
      const label = popover.querySelector(`#ci-${id}-value`);
      if (slider && label) label.textContent = `${slider.value}%`;
    };
    const loadInstrumentIntoForm = (instrument) => {
      const form = popover.querySelector('.custom-instrument-form');
      if (form) form.dataset.editingId = instrument?.id || '';
      const title = popover.querySelector('#ci-title');
      if (title) title.textContent = instrument ? 'Edit Instrument' : 'Create Instrument';
      const save = popover.querySelector('#ci-save');
      if (save) save.textContent = instrument ? 'Update Instrument' : 'Save Instrument';
      const name = popover.querySelector('#ci-name');
      if (name) name.value = instrument?.name || '';
      const type = popover.querySelector('#ci-type');
      if (type) type.value = instrument?.type || (this.activeInstrument === INSTRUMENTS.KIT ? 'kit' : 'patch');
      const snippet = popover.querySelector('#ci-snippet');
      if (snippet) snippet.value = instrument?.sourceSnippetId || '';
      const file = popover.querySelector('#ci-file');
      if (file) file.value = '';
      const root = popover.querySelector('#ci-root');
      if (root) root.value = String(instrument?.rootMidi ?? 60);
      const playback = popover.querySelector('#ci-playback');
      if (playback) playback.value = instrument?.playbackMode || 'gated';
      const brightness = popover.querySelector('#ci-brightness');
      if (brightness) brightness.value = String(Math.round((instrument?.brightness ?? 0.7) * 100));
      const gain = popover.querySelector('#ci-gain');
      if (gain) gain.value = String(Math.round((instrument?.gain ?? 0.55) * 100));
      syncType();
      syncSlider('brightness');
      syncSlider('gain');
    };

    const handleOutside = (e) => {
      if (!this._instrumentPopover) return;
      if (this._instrumentPopover.contains(e.target)) return;
      if (anchor.contains(e.target)) return;
      this._closeCreateInstrumentPopover();
    };
    queueMicrotask(() => document.addEventListener('pointerdown', handleOutside, true));
    this._instrumentClickOutsideHandler = handleOutside;
    popover.querySelector('#ci-existing')?.addEventListener('change', (event) => {
      const instrument = customInstruments.find(item => item.id === event.target.value) || null;
      loadInstrumentIntoForm(instrument);
    });
    popover.querySelector('#ci-type')?.addEventListener('change', syncType);
    popover.querySelector('#ci-brightness')?.addEventListener('input', () => syncSlider('brightness'));
    popover.querySelector('#ci-gain')?.addEventListener('input', () => syncSlider('gain'));
    popover.querySelector('#ci-save')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      await this._saveCustomInstrument(popover);
    });
    syncType();
  }

  _rootNoteOptions(selectedMidi = 60) {
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const options = [];
    for (let octave = 1; octave <= 6; octave++) {
      for (let i = 0; i < notes.length; i++) {
        const midi = (octave + 1) * 12 + i;
        options.push(`<option value="${midi}" ${midi === selectedMidi ? 'selected' : ''}>${notes[i]}${octave}</option>`);
      }
    }
    return options.join('');
  }

  async _saveCustomInstrument(root) {
    try {
      if (!this.project || !this.store) return;
      const name = root.querySelector('#ci-name')?.value?.trim();
      if (!name) return showToast('Name the instrument first');

      const type = root.querySelector('#ci-type')?.value || 'patch';
      const snippetId = root.querySelector('#ci-snippet')?.value;
      const file = root.querySelector('#ci-file')?.files?.[0];
      let audioAssetId = null;
      let audioMimeType = '';
      let audioSize = 0;

      const editingId = root.querySelector('.custom-instrument-form')?.dataset.editingId || '';
      const editingInstrument = editingId
        ? this._customInstruments().find(item => item.id === editingId) || null
        : null;
      if (editingInstrument && editingInstrument.type !== type) {
        const usage = this._customInstrumentUsage(editingInstrument.id);
        if (usage.count > 0) {
          showToast(`Switch ${usage.summary} before changing this instrument type`);
          return;
        }
      }

      if (file) {
        const record = await this.store.saveAudioAsset(file, {
          mimeType: file.type || 'audio/*',
          size: file.size,
          createdAt: Date.now(),
        });
        audioAssetId = record.audioAssetId;
        audioMimeType = record.mimeType;
        audioSize = record.size;
    } else if (snippetId) {
      const snippet = (this.project.snippets || []).find(item => item.id === snippetId);
      if (!snippet?.audioAssetId) return showToast('Choose an audio source first');
      audioAssetId = snippet.audioAssetId;
      audioMimeType = snippet.audioMimeType || '';
      audioSize = snippet.audioSize || 0;
      } else if (editingInstrument?.audioAssetId) {
        audioAssetId = editingInstrument.audioAssetId;
        audioMimeType = editingInstrument.audioMimeType || '';
        audioSize = editingInstrument.audioSize || 0;
      } else {
        return showToast('Choose an audio source first');
      }

      const instrument = {
        id: editingInstrument?.id || crypto.randomUUID(),
        name,
        type,
        audioAssetId,
        audioMimeType,
        audioSize,
        sourceSnippetId: snippetId || (file ? null : editingInstrument?.sourceSnippetId) || null,
        rootMidi: parseInt(root.querySelector('#ci-root')?.value, 10) || 60,
        playbackMode: root.querySelector('#ci-playback')?.value || 'gated',
        brightness: (parseInt(root.querySelector('#ci-brightness')?.value, 10) || 70) / 100,
        gain: (parseInt(root.querySelector('#ci-gain')?.value, 10) || 55) / 100,
        createdAt: editingInstrument?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      if (editingInstrument) Object.assign(editingInstrument, instrument);
      else this._customInstruments().push(instrument);
      this._customInstruments().sort((a, b) => a.name.localeCompare(b.name));
      await this._saveInstrumentChangeNow();
      window.dispatchEvent(new CustomEvent('project-custom-instruments-changed', {
        detail: { instrumentId: instrument.id, action: editingInstrument ? 'updated' : 'created' },
      }));
      this.sketchKit?.refreshKitSelector?.();
      this._refreshPatchSelector();
      this.snippetTray?._renderSnippets?.();
      if (type === 'patch') {
        await this._selectPatch(`custom:${instrument.id}`);
        this._refreshPatchSelector();
      } else if (this._activePatchId === `custom:${instrument.id}`) {
        await this._selectPatch('chip_lead');
        this._refreshPatchSelector();
      } else if (type === 'kit') {
        this.sketchKit?.loadKit?.(`custom:${instrument.id}`);
      }
      this._closeCreateInstrumentPopover();
      showToast(`${editingInstrument ? 'Instrument updated' : 'Instrument saved'}: ${name}`);
    } catch (err) {
      console.warn('[CreativeMode] Custom instrument save failed:', err);
      showToast(err?.message || 'Instrument save failed');
    }
  }

  _selectedCustomInstrument() {
    const selected = this.activeInstrument === INSTRUMENTS.KIT
      ? (this.sketchKit?.selectedKitId || '')
      : (this._activePatchId || this.el?.querySelector('#patch-select')?.value || '');
    if (!selected.startsWith('custom:')) return null;
    return this._customInstruments().find(item => item.id === selected.slice(7)) || null;
  }

  _escapeAttr(value = '') {
    return this._escapeHtml(value).replace(/"/g, '&quot;');
  }

  _escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async _deleteSelectedCustomInstrument() {
    const selected = this.activeInstrument === INSTRUMENTS.KIT
      ? (this.sketchKit?.selectedKitId || '')
      : (this.el?.querySelector('#patch-select')?.value || '');
    if (!selected.startsWith('custom:')) {
      showToast('Choose a custom instrument to delete');
      return;
    }
    const id = selected.slice(7);
    const instrument = this._customInstruments().find(item => item.id === id);
    if (!instrument) return;
    const usage = this._customInstrumentUsage(id);
    if (usage.count > 0) {
      showToast(`Used by ${usage.summary}; switch those tracks first`);
      return;
    }
    if (!confirm(`Delete custom instrument "${instrument.name}"?`)) return;
    this.project.settings.customInstruments = this._customInstruments().filter(item => item.id !== id);
    if (instrument.type === 'kit') {
      this.sketchKit?.loadKit?.('classic');
      this.sketchKit?.refreshKitSelector?.();
    } else {
      this._activePatchId = 'chip_lead';
      this.synth.loadPatch(PRESETS.chip_lead);
    }
    await this._saveInstrumentChangeNow();
    window.dispatchEvent(new CustomEvent('project-custom-instruments-changed', {
      detail: { instrumentId: id, action: 'deleted' },
    }));
    this.sketchKit?.refreshKitSelector?.();
    this._refreshPatchSelector();
    this.snippetTray?._renderSnippets?.();
    showToast(`Instrument deleted: ${instrument.name}`);
  }

  _snippetInstrumentUsage(snippetId) {
    const snippet = (this.project?.snippets || []).find(item => item.id === snippetId);
    const instruments = this._customInstruments().filter(instrument =>
      instrument.sourceSnippetId === snippetId ||
      (!!snippet?.audioAssetId && instrument.audioAssetId === snippet.audioAssetId)
    );
    if (!instruments.length) return null;

    const names = instruments.map(instrument => instrument.name).join(', ');
    return {
      blocked: true,
      label: instruments.length === 1 ? 'Instrument' : `${instruments.length} instruments`,
      title: `Used by custom instrument${instruments.length === 1 ? '' : 's'}: ${names}`,
      onBlocked: () => showToast(`Used by instrument: ${names}`),
    };
  }

  async _saveInstrumentChangeNow() {
    if (!this.store || !this.project) return;
    await this.store.save(this.project);
    await this.store.saveVersion?.(this.project);
  }

  /**
   * Map CreativeMode's instrument enum to the AI's smaller surface.
   * Controller is treated as scaleboard for AI purposes — it uses the same
   * scale-locked pad primitive. Mic returns null because the AI does not
   * generate audio (intentional scope limit).
   */
  _mapInstrumentToAi(creativeInstrumentId) {
    switch (creativeInstrumentId) {
      case 'scaleboard':
      case 'controller':
        return 'scaleboard';
      case 'piano':
        return 'piano';
      case 'kit':
        return 'kit';
      case 'mic':
      default:
        return 'scaleboard';
    }
  }

  /**
   * Tell the AIController what instrument it should write events for, plus
   * the runtime context the prompt needs (scale, root, pad count for scale-
   * locked, etc.).
   */
  _buildAIInstrumentInfo() {
    const aiInstrument = this._mapInstrumentToAi(this.activeInstrument);
    const info = {
      instrument: aiInstrument,
      scaleName: this.scaleBoard?.scaleName || 'major',
      rootNote: this.scaleBoard?.rootNote || 'C',
      octave: this.scaleBoard?.octave || 4,
    };
    if (aiInstrument === 'scaleboard') {
      info.padCount = this.scaleBoard?._notes?.length || 7;
    }
    return info;
  }

  /**
   * Handle an AI-seeded snippet. Mirrors the post-recording flow but tags
   * the snippet for the tray badge and uses an AI-flavored toast.
   */
  _onAISnippetCreated(snippet) {
    if (!snippet) return;
    this.snippetTray.addSnippet(snippet);
    if (this.project) {
      if (!Array.isArray(this.project.snippets)) this.project.snippets = [];
      this.project.snippets.push(snippet);
      this.store?.scheduleAutoSave(this.project);
    }
    window.dispatchEvent(new CustomEvent('project-snippets-changed', { detail: { snippetId: snippet.id, action: 'created' } }));
    const eventCount = (snippet.notes?.length || 0) + (snippet.hits?.length || 0);
    showToast(`Snippet seeded (${eventCount} event${eventCount === 1 ? '' : 's'})`);
  }

  _customInstrumentUsage(id) {
    const ref = `custom:${id}`;
    const trackNames = [];
    let clipCount = 0;
    let snippetCount = 0;

    for (const track of this.project?.tracks || []) {
      if (track.instrumentId === ref) trackNames.push(track.name || 'Untitled track');
      for (const clip of track.clips || []) {
        if (clip.instrumentId === ref || clip.snippet?.instrumentId === ref || clip.snippet?.patchId === ref) {
          clipCount++;
        }
      }
    }

    for (const snippet of this.project?.snippets || []) {
      if (snippet.instrumentId === ref || snippet.patchId === ref) snippetCount++;
    }

    const parts = [];
    if (trackNames.length) {
      const preview = trackNames.slice(0, 2).join(', ');
      const extra = trackNames.length > 2 ? ` and ${trackNames.length - 2} more` : '';
      parts.push(`${trackNames.length} track${trackNames.length === 1 ? '' : 's'} (${preview}${extra})`);
    }
    if (clipCount) parts.push(`${clipCount} clip${clipCount === 1 ? '' : 's'}`);
    if (snippetCount) parts.push(`${snippetCount} snippet${snippetCount === 1 ? '' : 's'}`);

    return {
      count: trackNames.length + clipCount + snippetCount,
      summary: parts.join(', ') || '0 places',
    };
  }

  _closeCreateInstrumentPopover() {
    if (this._instrumentClickOutsideHandler) {
      document.removeEventListener('pointerdown', this._instrumentClickOutsideHandler, true);
      this._instrumentClickOutsideHandler = null;
    }
    this._instrumentPopover?.remove();
    this._instrumentPopover = null;
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

  _bindGamepadInput() {
    if (this._gamepadInputBound) return;
    this._gamepadInputBound = true;
    this.gamepadInput.on('buttonDown', ({ index, bindable }) => {
      if (!bindable) return;
      this._refreshControllerMapperStatus();
      this._handleControllerButtonDown(index);
    });
    this.gamepadInput.on('buttonUp', ({ index, bindable }) => {
      if (!bindable) return;
      this._refreshControllerMapperStatus();
      this._handleControllerButtonUp(index);
    });
    this.gamepadInput.on('buttons', () => this._refreshControllerMapperStatus());
    this.gamepadInput.on('state', () => this._refreshControllerMapperStatus());
  }

  _handleControllerButtonDown(index) {
    if (!this._isCreativeActive() || this._controllerMapperPopover) return;
    if (this.activeInstrument === INSTRUMENTS.SCALEBOARD && this.scaleBoard?.padMode === 'voices') return;
    const binding = this._controllerBinding(index);
    if (binding) {
      this._playControllerBinding(index, binding);
      return;
    }
    this._playControllerFallbackDown(index);
  }

  _handleControllerButtonUp(index) {
    this._releaseControllerBinding(index);
    this._playControllerFallbackUp(index);
  }

  _ensureControllerBindings() {
    if (!this.project.settings) this.project.settings = {};
    if (!this.project.settings.controllerBindings || Array.isArray(this.project.settings.controllerBindings)) {
      this.project.settings.controllerBindings = {};
    }
    return this.project.settings.controllerBindings;
  }

  _controllerBinding(index) {
    return this._ensureControllerBindings()[String(index)] || null;
  }

  _playControllerBinding(index, binding) {
    this.ensureAudioReady();
    if (binding.type === 'drum' && binding.padId) {
      this.sketchKit.triggerPad(binding.padId);
      return;
    }
    if (binding.type === 'midi' && Number.isFinite(binding.midi)) {
      if (this._heldControllerMidis.has(index)) return;
      this._beginArmedRecordingIfNeeded();
      this.synth.noteOn(binding.midi, 0.8);
      this.recordingManager.noteOn(binding.midi, 0.8, { controllerBinding: true });
      this._heldControllerMidis.set(index, binding.midi);
    }
  }

  _releaseControllerBinding(index) {
    if (!this._heldControllerMidis.has(index)) return;
    const midi = this._heldControllerMidis.get(index);
    this.synth.noteOff(midi);
    this.recordingManager.noteOff(midi);
    this._heldControllerMidis.delete(index);
  }

  _playControllerFallbackDown(index) {
    const degreeMap = { 12: 0, 13: 1, 14: 2, 15: 3, 0: 4, 1: 5, 2: 6, 3: 0 };
    if (index === 4 || index === 5) {
      this._shiftActiveInstrumentOctave(index === 5 ? 1 : -1);
      return;
    }

    const degree = degreeMap[index];
    if (degree === undefined) return;
    this.ensureAudioReady();

    if (this.activeInstrument === INSTRUMENTS.SCALEBOARD && degree < this.scaleBoard._notes.length) {
      this._heldControllerFallback.set(index, { type: 'scale', value: degree });
      this.scaleBoard.pressPad(degree);
    } else if (this.activeInstrument === INSTRUMENTS.PIANO && degree < this.microPiano.visibleMidis().length) {
      this._heldControllerFallback.set(index, { type: 'piano', value: degree });
      this.microPiano.pressVisibleKey(degree);
    } else if (this.activeInstrument === INSTRUMENTS.KIT && degree < this.sketchKit.visiblePadIds().length) {
      this.sketchKit.triggerVisiblePad(degree);
    } else if (this.activeInstrument === INSTRUMENTS.CONTROLLER) {
      this._heldControllerFallback.set(index, { type: 'controller', value: index });
      this.controllerMode.handleFallbackButtonDown(index);
    }
  }

  _playControllerFallbackUp(index) {
    const held = this._heldControllerFallback.get(index);
    if (!held) return;
    if (held.type === 'scale') this.scaleBoard.releasePad(held.value);
    else if (held.type === 'piano') this.microPiano.releaseVisibleKey(held.value);
    else if (held.type === 'controller') this.controllerMode.handleFallbackButtonUp(held.value);
    this._heldControllerFallback.delete(index);
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
    const showToolbar = id === INSTRUMENTS.SCALEBOARD || id === INSTRUMENTS.PIANO || id === INSTRUMENTS.CONTROLLER;
    patchSel.style.display = showToolbar ? 'flex' : 'none';
    if (!showToolbar) {
      this._closeTonePopover();
      this._closePadsPopover();
      this._closeKeysPopover();
    }
    this._closeControllerMapperPopover();
    this._syncInstrumentButtons();

    // AI Seed: visible only on Scale Board / Piano / Sketch Kit. Close the
    // popover when leaving a supported instrument so it doesn't linger over
    // a context the AI can't write for. If the popover is open and the new
    // instrument is supported, refresh it so the suggestion chips and the
    // active-instrument label update.
    this._syncCreateToolbarButtons();
    if (!this._aiCanGenerateForInstrument(id)) {
      this._closeAISeedPopover();
    } else {
      // The popover is anchored to whichever button was clicked. When the
      // user switches to a different instrument while it's open, close it —
      // the previous anchor may not be visible anymore. Re-opening the
      // popover from the new instrument's button gives a fresh, correctly-
      // positioned popover.
      this._closeAISeedPopover();
    }
  }

  /**
   * Show the AI Seed button only on instruments the AI can play.
   * - Scale Board / Piano: button lives in the patch-selector next to Tone.
   * - Sketch Kit: button lives in the Kit's own toolbar (next to its Tone
   *   button), surfaced by SketchKit. We only need to control the
   *   patch-selector copy here.
   * - Controller: AI scope explicitly excludes it (per user). Hide the
   *   patch-selector AI button when Controller is active.
   * - Mic: patch-selector is hidden anyway, so nothing to do.
   */
  _syncAISeedButtonVisibility() {
    const btn = this.el?.querySelector('#ai-seed-button');
    if (!btn) return;
    const id = this.activeInstrument;
    const showInPatchSelector =
      id === INSTRUMENTS.SCALEBOARD || id === INSTRUMENTS.PIANO || id === INSTRUMENTS.CONTROLLER;
    const disabled = id === INSTRUMENTS.CONTROLLER;
    btn.style.display = showInPatchSelector ? '' : 'none';
    btn.disabled = disabled;
    btn.title = disabled ? 'AI Seed is not available from Controller setup' : 'Seed a snippet with AI';
    btn.setAttribute('aria-disabled', String(disabled));
  }

  _syncCreateToolbarButtons() {
    this._syncAISeedButtonVisibility();
    this._syncControllerMapperButtonVisibility();
    const layoutBtn = this.el?.querySelector('#layout-button');
    if (layoutBtn) {
      const isScale = this.activeInstrument === INSTRUMENTS.SCALEBOARD;
      const isPiano = this.activeInstrument === INSTRUMENTS.PIANO;
      layoutBtn.style.display = '';
      layoutBtn.textContent = 'Layout';
      layoutBtn.disabled = !(isScale || isPiano);
      layoutBtn.setAttribute('aria-disabled', String(layoutBtn.disabled));
      layoutBtn.title = isScale ? 'Pad layout and degree colors' : (isPiano ? 'Keyboard layout and degree colors' : 'Layout controls are available on Scale and Piano');
      if (!isScale) this._closePadsPopover();
      if (!isPiano) this._closeKeysPopover();
    }
  }

  _syncControllerMapperButtonVisibility() {
    const patchBtn = this.el?.querySelector('#controller-map-button');
    if (patchBtn) {
      const show = this.activeInstrument === INSTRUMENTS.SCALEBOARD
        || this.activeInstrument === INSTRUMENTS.PIANO
        || this.activeInstrument === INSTRUMENTS.CONTROLLER;
      const hiddenForVoice = this.activeInstrument === INSTRUMENTS.SCALEBOARD
        && this.scaleBoard?.padMode === 'voices';
      patchBtn.style.display = show && !hiddenForVoice ? '' : 'none';
      if (!show || hiddenForVoice) this._closeControllerMapperPopover();
    }
  }

  setRecordArmed(armed, options = {}) {
    const next = !!armed;
    if (next && this.transport.state === TransportState.RECORDING) return;
    this._recordArmed = next;
    if (!options.silent) {
      showToast(next ? 'Recording armed. Play a note or drum hit to start.' : 'Recording arm off');
    }
    if (this.onRecordArmChanged) this.onRecordArmChanged(this._recordArmed);
  }

  _beginArmedRecordingIfNeeded() {
    if (!this._recordArmed || this.transport.state === TransportState.RECORDING) return;
    this._recordArmed = false;
    if (this.onRecordArmChanged) this.onRecordArmChanged(false);
    this.transport.record();
  }

  /**
   * Whether AI generation is currently available, given the active
   * instrument and (for Scale Board) its pad mode. The AI Seed Panel
   * uses this to decide between the normal generation UI and a disabled
   * "Unavailable in Voice Sketch mode" state.
   */
  _isAISeedAvailable() {
    const id = this.activeInstrument;
    if (id === INSTRUMENTS.SCALEBOARD && this.scaleBoard?.padMode === 'voices') {
      return { available: false, reason: 'voices-mode' };
    }
    if (!this._aiCanGenerateForInstrument(id)) {
      return { available: false, reason: 'unsupported-instrument' };
    }
    return { available: true };
  }

  _aiCanGenerateForInstrument(creativeInstrumentId) {
    return creativeInstrumentId === INSTRUMENTS.SCALEBOARD
      || creativeInstrumentId === INSTRUMENTS.PIANO
      || creativeInstrumentId === INSTRUMENTS.KIT;
  }

  /**
   * Open or close the AI seed popover.
   *
   * @param {HTMLElement} anchor      - Container element for the popover.
   *   Patch-selector for Scale/Piano, sk-kit-selector for Kit.
   * @param {HTMLElement} [buttonEl]  - The button element that opens the
   *   popover. Used for aria-expanded and to suppress the click-outside
   *   handler when re-clicking the button itself.
   */
  _toggleAISeedPopover(anchor, buttonEl = null) {
    if (buttonEl?.disabled) return;
    if (this._aiSeedPopover) {
      this._closeAISeedPopover();
      return;
    }

    const popover = document.createElement('div');
    popover.className = 'ai-seed-popover';
    popover.id = 'ai-seed-popover';

    this._aiSeedPanelInstance = new AISeedPanel({
      controller: this.aiController,
      getProject: () => this.project,
      getActiveInstrumentId: () => this._mapInstrumentToAi(this.activeInstrument),
      getAvailability: () => this._isAISeedAvailable(),
      onSnippetCreated: (snippet) => this._onAISnippetCreated(snippet),
      onClose: () => this._closeAISeedPopover(),
      onOpenSettings: () => {
        this._closeAISeedPopover();
        window.dispatchEvent(new CustomEvent('notenotes-open-settings', {
          detail: { section: 'settings', focus: 'ai' },
        }));
      },
    });
    popover.appendChild(this._aiSeedPanelInstance.render());

    anchor.appendChild(popover);
    if (buttonEl) buttonEl.setAttribute('aria-expanded', 'true');
    this._aiSeedPopover = popover;
    this._aiSeedAnchorButton = buttonEl;

    // Click-outside to close. Listen on capture so we beat the popover's
    // own click handlers. Bound on next microtask so the click that opened
    // the popover doesn't immediately close it.
    const handlePointer = (e) => {
      if (!this._aiSeedPopover) return;
      if (this._aiSeedPopover.contains(e.target)) return;
      if (buttonEl && buttonEl.contains(e.target)) return;
      this._closeAISeedPopover();
    };
    queueMicrotask(() => {
      document.addEventListener('pointerdown', handlePointer, true);
    });
    this._aiSeedClickOutsideHandler = handlePointer;
  }

  _closeAISeedPopover() {
    if (this._aiSeedClickOutsideHandler) {
      document.removeEventListener('pointerdown', this._aiSeedClickOutsideHandler, true);
      this._aiSeedClickOutsideHandler = null;
    }
    if (this._aiSeedPanelInstance) {
      this._aiSeedPanelInstance.destroy();
      this._aiSeedPanelInstance = null;
    }
    if (this._aiSeedPopover) {
      this._aiSeedPopover.remove();
      this._aiSeedPopover = null;
    }
    if (this._aiSeedAnchorButton) {
      this._aiSeedAnchorButton.setAttribute('aria-expanded', 'false');
      this._aiSeedAnchorButton = null;
    }
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
    for (const index of [...this._heldControllerMidis.keys()]) this._releaseControllerBinding(index);
    for (const index of [...this._heldControllerFallback.keys()]) this._playControllerFallbackUp(index);
  }

  _ensureSoundTraits() {
    if (!this.project) return normalizeSoundTraits(this._currentToneTraits);
    if (!this.project.settings) this.project.settings = {};
    this.project.settings.soundTraits = this._normalizeProjectSoundTraits(this.project);
    this._currentToneTraits = this.project.settings.soundTraits;
    return this.project.settings.soundTraits;
  }

  _normalizeProjectSoundTraits(project) {
    return normalizeSoundTraits(project?.settings?.soundTraits || this._currentToneTraits || {});
  }

  _applyProjectSoundTraits(traits, { save = true, notify = true } = {}) {
    const normalized = normalizeSoundTraits(traits);
    this._currentToneTraits = normalized;
    if (this.project) {
      if (!this.project.settings) this.project.settings = {};
      this.project.settings.soundTraits = JSON.parse(JSON.stringify(normalized));
    }
    this.sketchKit?.setSoundTraits(normalized);
    this._setLiveSoundTraits(this.controllerMode?.currentSoundTraits(normalized) || normalized);
    if (save) this.store?.scheduleAutoSave(this.project);
    if (notify) {
      window.dispatchEvent(new CustomEvent('project-sound-traits-changed', { detail: { soundTraits: normalized } }));
    }
    return normalized;
  }

  _setLiveSoundTraits(traits) {
    this.synth?.setSoundTraits(traits || this._currentToneTraits || {});
  }

  panic() {
    this.synth?.panic?.();
    this.sketchKit?.panic?.();
    this.voiceEngine?.allNotesOff?.();
    this.arpManager?.setMode?.(ARP_MODES.OFF);
  }

  _currentSoundTraitsSnapshot() {
    const traits = this.controllerMode?.currentSoundTraits(this._currentToneTraits || this._ensureSoundTraits())
      || this.synth.soundTraits
      || this._ensureSoundTraits();
    return JSON.parse(JSON.stringify(normalizeSoundTraits(traits)));
  }

  _baseSoundTraitsSnapshot() {
    return JSON.parse(JSON.stringify(normalizeSoundTraits(this._currentToneTraits || this._ensureSoundTraits())));
  }

  _stampRecordedPatch(snippet) {
    if (!snippet || snippet.type !== 'midi') return;
    const instrumentId = this._activePatchId || 'chip_lead';
    const patch = PRESETS[instrumentId] ? JSON.parse(JSON.stringify(PRESETS[instrumentId])) : null;
    snippet.instrumentId = instrumentId;
    snippet.patchRecorded = {
      instrumentId,
      patchSnapshot: patch,
      capturedAt: Date.now(),
    };
    snippet.schemaVersion = Math.max(snippet.schemaVersion || 1, 2);
  }

  _updateToneTriggerIndicator(labels = []) {
    const indicator = this.el?.querySelector('#tone-trigger-indicator');
    if (!indicator) return;
    indicator.textContent = labels.join('/');
    indicator.classList.toggle('is-active', labels.length > 0);
  }

  _toggleControllerMapperPopover(anchor, buttonEl) {
    if (this._controllerMapperPopover) {
      this._closeControllerMapperPopover();
      return;
    }
    this._closeTonePopover();
    this._closePadsPopover();
    this._closeKeysPopover();
    this._closeAISeedPopover();

    this._controllerMapperView = 'learn';
    this._controllerLearningButton = null;
    const popover = document.createElement('div');
    popover.className = 'tone-popover controller-map-popover';
    popover.id = 'controller-map-popover';
    popover.innerHTML = this._renderControllerMapper();
    anchor.appendChild(popover);
    buttonEl?.setAttribute('aria-expanded', 'true');
    this._controllerMapperPopover = popover;
    this._controllerMapperAnchorButton = buttonEl;
    this._bindControllerMapperEvents();
    this._refreshControllerMapperStatus();

    const handleOutside = (e) => {
      if (!this._controllerMapperPopover) return;
      if (this._controllerMapperPopover.contains(e.target)) return;
      if (buttonEl && buttonEl.contains(e.target)) return;
      this._closeControllerMapperPopover();
    };
    queueMicrotask(() => document.addEventListener('pointerdown', handleOutside, true));
    this._controllerMapperClickOutsideHandler = handleOutside;
  }

  _renderControllerMapper() {
    if (this._controllerMapperView === 'list') return this._renderControllerBindingList();
    const held = this.gamepadInput.heldBindableButton();
    const info = held === null ? null : gamepadButtonInfo(held);
    const learning = this._controllerLearningButton !== null ? gamepadButtonInfo(this._controllerLearningButton) : null;
    return `
      <div class="tone-popover__header">
        <span>Controller Mapper</span>
      </div>
      <div class="controller-map">
        <p class="controller-map__headline">${learning ? 'Now click any note, pad, or key' : 'Hold any button on your gamepad'}</p>
        <p class="controller-map__status" id="controller-map-status">
          Currently holding: ${info ? `<strong>${this._escapeHtml(info.label)}</strong> (${this._escapeHtml(info.detail)})` : 'None'}
        </p>
        <p class="controller-map__hint">${learning ? `${this._escapeHtml(learning.label)} is waiting for a sound target. The next Scale, Piano, or Kit press will bind instead of play.` : 'Triggers and analog sticks stay reserved for Tone, trigger notes, pitch, and modulation.'}</p>
        <div class="controller-map__actions">
          <button class="btn btn--primary controller-map__set" id="controller-map-set" type="button" ${held === null ? 'disabled' : ''}>Set</button>
          <button class="btn btn--ghost" id="controller-map-list" type="button">List Current Bindings</button>
        </div>
      </div>
    `;
  }

  _renderControllerBindingList() {
    const bindings = this._ensureControllerBindings();
    const entries = Object.entries(bindings).filter(([, binding]) => binding).sort(([a], [b]) => Number(a) - Number(b));
    return `
      <div class="tone-popover__header">
        <span>Controller Bindings</span>
      </div>
      <div class="controller-map controller-map--list">
        ${entries.length ? entries.map(([index, binding]) => {
          const info = gamepadButtonInfo(Number(index));
          return `
            <div class="controller-map__binding">
              <span class="controller-map__button">${this._escapeHtml(info.label)}</span>
              <span class="controller-map__arrow">to</span>
              <span class="controller-map__target">${this._escapeHtml(binding.label || this._controllerTargetLabel(binding))}</span>
              <button class="btn btn--ghost btn--sm" data-controller-unbind="${index}" type="button">Unbind</button>
            </div>
          `;
        }).join('') : '<p class="controller-map__empty">No custom bindings yet. Unbound buttons use the fallback scale layout.</p>'}
        <div class="controller-map__actions">
          <button class="btn btn--ghost" id="controller-map-back" type="button">Back</button>
          <button class="btn btn--ghost" id="controller-map-clear-all" type="button" ${entries.length ? '' : 'disabled'}>Clear All Bindings</button>
        </div>
      </div>
    `;
  }

  _bindControllerMapperEvents() {
    const popover = this._controllerMapperPopover;
    if (!popover) return;
    popover.querySelector('#controller-map-set')?.addEventListener('click', (e) => {
      e.preventDefault();
      const held = this.gamepadInput.heldBindableButton();
      if (held === null || !BINDABLE_GAMEPAD_BUTTONS.has(held)) return;
      this._controllerLearningButton = held;
      this._refreshControllerMapper();
    });
    popover.querySelector('#controller-map-list')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._controllerMapperView = 'list';
      this._controllerLearningButton = null;
      this._refreshControllerMapper();
    });
    popover.querySelector('#controller-map-back')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._controllerMapperView = 'learn';
      this._refreshControllerMapper();
    });
    popover.querySelector('#controller-map-clear-all')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!window.confirm('Clear all controller bindings?')) return;
      this.project.settings.controllerBindings = {};
      this.store?.scheduleAutoSave(this.project);
      this.controllerMode?.refreshBindings?.();
      this._refreshControllerMapper();
      showToast('Controller bindings cleared');
    });
    popover.querySelectorAll('[data-controller-unbind]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const index = btn.dataset.controllerUnbind;
        delete this._ensureControllerBindings()[index];
        this.store?.scheduleAutoSave(this.project);
        this.controllerMode?.refreshBindings?.();
        this._refreshControllerMapper();
        showToast('Controller binding cleared');
      });
    });
  }

  _refreshControllerMapper() {
    if (!this._controllerMapperPopover) return;
    this._controllerMapperPopover.innerHTML = this._renderControllerMapper();
    this._bindControllerMapperEvents();
    this._refreshControllerMapperStatus();
  }

  _refreshControllerMapperStatus() {
    const popover = this._controllerMapperPopover;
    if (!popover || this._controllerMapperView !== 'learn' || this._controllerLearningButton !== null) return;
    const held = this.gamepadInput.heldBindableButton();
    const info = held === null ? null : gamepadButtonInfo(held);
    const status = popover.querySelector('#controller-map-status');
    if (status) status.innerHTML = `Currently holding: ${info ? `<strong>${this._escapeHtml(info.label)}</strong> (${this._escapeHtml(info.detail)})` : 'None'}`;
    const set = popover.querySelector('#controller-map-set');
    if (set) set.disabled = held === null;
  }

  _handleControllerLearnTarget(target) {
    if (this._controllerLearningButton === null || !target || !this._controllerMapperPopover) return false;
    const index = String(this._controllerLearningButton);
    const button = gamepadButtonInfo(this._controllerLearningButton);
    const binding = this._normalizeControllerTarget(target);
    this._ensureControllerBindings()[index] = binding;
    this._controllerLearningButton = null;
    this.store?.scheduleAutoSave(this.project);
    this.controllerMode?.refreshBindings?.();
    this._refreshControllerMapper();
    showToast(`${button.short} to ${binding.label} bound`);
    return true;
  }

  _normalizeControllerTarget(target) {
    if (target.type === 'drum') {
      return {
        type: 'drum',
        padId: target.padId,
        gmNote: target.gmNote || null,
        label: target.label || target.padId || 'Drum',
        source: target.source || 'kit',
      };
    }
    return {
      type: 'midi',
      midi: Number(target.midi),
      label: target.label || midiToNoteName(Number(target.midi)).display,
      source: target.source || 'midi',
    };
  }

  _controllerTargetLabel(binding) {
    if (binding?.type === 'drum') return binding.padId || 'Drum';
    if (binding?.type === 'midi' && Number.isFinite(binding.midi)) return midiToNoteName(binding.midi).display;
    return 'Unknown';
  }

  _closeControllerMapperPopover() {
    if (this._controllerMapperClickOutsideHandler) {
      document.removeEventListener('pointerdown', this._controllerMapperClickOutsideHandler, true);
      this._controllerMapperClickOutsideHandler = null;
    }
    this._controllerMapperPopover?.remove();
    this._controllerMapperPopover = null;
    this._controllerLearningButton = null;
    if (this._controllerMapperAnchorButton) {
      this._controllerMapperAnchorButton.setAttribute('aria-expanded', 'false');
      this._controllerMapperAnchorButton = null;
    }
  }

  _toggleTonePopover(anchor) {
    if (this._tonePopover) {
      this._closeTonePopover();
      return;
    }
    this._closeControllerMapperPopover();

    const traits = this._ensureSoundTraits();
    const popover = document.createElement('div');
    popover.className = 'tone-popover';
    popover.id = 'tone-popover';
    popover.innerHTML = `
      <div class="tone-popover__header">
        <span>Tone</span>
      </div>
      ${this._renderTonePresetControls()}
      <div class="tone-popover__list">
        ${Object.values(SOUND_TRAITS).map(trait => {
          const state = traits[trait.id] || { amount: 0 };
          const amount = Math.round((state.amount ?? 0) * 100);
          return `
            <div class="tone-row" title="${trait.hint}">
              <label class="tone-row__name" for="tone-${trait.id}">${trait.name}</label>
              <input class="tone-row__slider" type="range" min="0" max="100" value="${amount}" data-tone-amount="${trait.id}" aria-label="${trait.name} intensity">
              <span class="tone-row__value">${amount}%</span>
            </div>
          `;
        }).join('')}
      </div>
    `;

    anchor.appendChild(popover);
    anchor.querySelector('#tone-button')?.setAttribute('aria-expanded', 'true');
    this._tonePopover = popover;

    const handleOutside = (e) => {
      if (!this._tonePopover) return;
      if (this._tonePopover.contains(e.target)) return;
      if (anchor.contains(e.target)) return;
      this._closeTonePopover();
    };
    queueMicrotask(() => document.addEventListener('pointerdown', handleOutside, true));
    this._toneClickOutsideHandler = handleOutside;

    popover.querySelectorAll('[data-tone-amount]').forEach(slider => {
      const update = () => this._setToneTraitAmount(slider.dataset.toneAmount, Number(slider.value) / 100, slider);
      slider.addEventListener('input', update);
      slider.addEventListener('change', update);
    });

    this._bindTonePresetControls();
  }

  _togglePadsPopover(anchor, buttonEl) {
    if (this._padsPopover) {
      this._closePadsPopover();
      return;
    }
    this._closeTonePopover();
    this._closeKeysPopover();
    this._closeControllerMapperPopover();

    const count = this.project?.settings?.scalePadsCount || 7;
    const showCustomCount = this.scaleBoard?.padMode === 'custom';
    const popover = document.createElement('div');
    popover.className = 'tone-popover create-control-popover';
    popover.id = 'pads-popover';
    popover.innerHTML = `
      <div class="tone-popover__header">
        <span>Pads</span>
      </div>
      ${showCustomCount ? `
      <label class="create-control-popover__row create-control-popover__row--slider">
        <span>Custom pad count</span>
        <span class="create-control-popover__value" id="pads-count-value">${count}</span>
        <input class="tone-row__slider" id="pads-count-slider" type="range" min="1" max="16" value="${count}" aria-label="Custom pad count">
      </label>
      <p class="create-control-popover__hint">Used by Scale Board Custom mode.</p>
      ` : `<p class="create-control-popover__hint">Custom pad count appears here in Custom mode.</p>`}
      ${this._renderDegreeControls()}
    `;

    anchor.appendChild(popover);
    buttonEl?.setAttribute('aria-expanded', 'true');
    this._padsPopover = popover;

    const slider = popover.querySelector('#pads-count-slider');
    slider?.addEventListener('input', (e) => {
      const value = Math.max(1, Math.min(16, parseInt(e.target.value, 10) || 7));
      this.project.settings ||= {};
      this.project.settings.scalePadsCount = value;
      popover.querySelector('#pads-count-value')?.replaceChildren(String(value));
      this.store?.scheduleAutoSave(this.project);
      window.dispatchEvent(new CustomEvent('settings-pads-changed', { detail: { count: value } }));
    });
    this._bindDegreeControls(popover);

    const handleOutside = (e) => {
      if (!this._padsPopover) return;
      if (this._padsPopover.contains(e.target)) return;
      if (buttonEl?.contains(e.target)) return;
      this._closePadsPopover();
    };
    queueMicrotask(() => document.addEventListener('pointerdown', handleOutside, true));
    this._padsClickOutsideHandler = handleOutside;
  }

  _toggleKeysPopover(anchor, buttonEl) {
    if (this._keysPopover) {
      this._closeKeysPopover();
      return;
    }
    this._closeTonePopover();
    this._closePadsPopover();
    this._closeControllerMapperPopover();

    const count = this.project?.settings?.pianoCount || 1;
    const keys = this.project?.settings?.pianoKeys || 12;
    const popover = document.createElement('div');
    popover.className = 'tone-popover create-control-popover';
    popover.id = 'keys-popover';
    popover.innerHTML = `
      <div class="tone-popover__header">
        <span>Keys</span>
      </div>
      <label class="create-control-popover__row">
        <span>Pianos</span>
        <select class="create-control-popover__select" id="keys-piano-count" aria-label="Number of pianos">
          <option value="1" ${count === 1 ? 'selected' : ''}>1</option>
          <option value="2" ${count === 2 ? 'selected' : ''}>2</option>
        </select>
      </label>
      <label class="create-control-popover__row create-control-popover__row--slider">
        <span>Keys</span>
        <span class="create-control-popover__value" id="keys-count-value">${keys}</span>
        <input class="tone-row__slider" id="keys-count-slider" type="range" min="10" max="32" value="${keys}" aria-label="Piano key count">
      </label>
      ${this._renderDegreeControls()}
    `;

    anchor.appendChild(popover);
    buttonEl?.setAttribute('aria-expanded', 'true');
    this._keysPopover = popover;

    popover.querySelector('#keys-piano-count')?.addEventListener('change', (e) => {
      this.project.settings ||= {};
      this.project.settings.pianoCount = parseInt(e.target.value, 10) || 1;
      this.store?.scheduleAutoSave(this.project);
      window.dispatchEvent(new CustomEvent('settings-piano-changed'));
    });
    popover.querySelector('#keys-count-slider')?.addEventListener('input', (e) => {
      const value = Math.max(10, Math.min(32, parseInt(e.target.value, 10) || 12));
      this.project.settings ||= {};
      this.project.settings.pianoKeys = value;
      popover.querySelector('#keys-count-value')?.replaceChildren(String(value));
      this.store?.scheduleAutoSave(this.project);
      window.dispatchEvent(new CustomEvent('settings-piano-changed'));
    });
    this._bindDegreeControls(popover);

    const handleOutside = (e) => {
      if (!this._keysPopover) return;
      if (this._keysPopover.contains(e.target)) return;
      if (buttonEl?.contains(e.target)) return;
      this._closeKeysPopover();
    };
    queueMicrotask(() => document.addEventListener('pointerdown', handleOutside, true));
    this._keysClickOutsideHandler = handleOutside;
  }

  _renderDegreeControls() {
    const degree = this._ensureDegreeHighlighting();
    const intervals = this._activeScaleIntervals();
    const context = this._ensureMusicalContext();
    return `
      <div class="degree-controls" data-degree-controls>
        <div class="degree-controls__head">
          <span>Degree colors</span>
          <button class="btn btn--ghost btn--sm" type="button" data-degree-reset>Reset</button>
        </div>
        <label class="degree-controls__check">
          <input type="checkbox" data-degree-enabled ${degree.enabled ? 'checked' : ''}>
          <span>Highlight scale degrees</span>
        </label>
        <label class="degree-controls__check">
          <input type="checkbox" data-degree-labels ${degree.showLabels ? 'checked' : ''}>
          <span>Show degree labels</span>
        </label>
        <label class="create-control-popover__row create-control-popover__row--slider">
          <span>Color intensity</span>
          <span class="create-control-popover__value" data-degree-intensity-value>${Math.round((degree.intensity ?? 0.22) * 100)}%</span>
          <input class="tone-row__slider" type="range" min="5" max="75" value="${Math.round((degree.intensity ?? 0.22) * 100)}" data-degree-intensity aria-label="Degree color intensity">
        </label>
        <div class="degree-controls__swatches" aria-label="Degree colors for ${context.root} ${SCALES[context.scale]?.name || 'Major'}">
          ${intervals.map(interval => {
            const meta = degreeForMidi(60 + interval, { root: 'C', scale: 'chromatic' });
            const label = meta?.label || String(interval);
            const name = meta?.name || `Interval ${interval}`;
            const color = degree.colors[interval] || DEFAULT_DEGREE_COLORS[interval];
            return `
              <label class="degree-controls__swatch" title="${this._escapeAttr(name)}">
                <span>${this._escapeHtml(label)}</span>
                <input type="color" value="${this._escapeAttr(color)}" data-degree-color="${interval}" aria-label="${this._escapeAttr(name)} color">
              </label>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  _bindDegreeControls(popover) {
    if (!popover) return;
    const notify = () => {
      this.store?.scheduleAutoSave(this.project);
      this.scaleBoard?._refreshPads?.();
      this.microPiano?.refreshDegreeHighlights?.();
      window.dispatchEvent(new CustomEvent('project-degree-highlighting-changed'));
    };
    popover.querySelector('[data-degree-enabled]')?.addEventListener('change', (event) => {
      this._ensureDegreeHighlighting().enabled = !!event.target.checked;
      notify();
    });
    popover.querySelector('[data-degree-labels]')?.addEventListener('change', (event) => {
      this._ensureDegreeHighlighting().showLabels = !!event.target.checked;
      notify();
    });
    popover.querySelector('[data-degree-intensity]')?.addEventListener('input', (event) => {
      const degree = this._ensureDegreeHighlighting();
      degree.intensity = Math.max(0.05, Math.min(0.75, Number(event.target.value) / 100));
      popover.querySelector('[data-degree-intensity-value]')?.replaceChildren(`${Math.round(degree.intensity * 100)}%`);
      notify();
    });
    popover.querySelectorAll('[data-degree-color]').forEach(input => {
      input.addEventListener('input', (event) => {
        const interval = Number(event.target.dataset.degreeColor);
        const degree = this._ensureDegreeHighlighting();
        degree.colors[interval] = event.target.value;
        notify();
      });
    });
    popover.querySelector('[data-degree-reset]')?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const degree = this._ensureDegreeHighlighting();
      degree.colors = { ...DEFAULT_DEGREE_COLORS };
      notify();
      const parent = popover.parentElement;
      const isPads = popover.id === 'pads-popover';
      if (isPads) {
        this._closePadsPopover();
        this._togglePadsPopover(parent, parent?.querySelector('#layout-button'));
      } else {
        this._closeKeysPopover();
        this._toggleKeysPopover(parent, parent?.querySelector('#layout-button'));
      }
    });
  }

  _bindTonePresetControls() {
    const popover = this._tonePopover;
    if (!popover) return;
    popover.querySelector('#tone-preset-apply')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const preset = this._selectedTonePreset(popover);
      if (!preset) return showToast('Choose a Tone preset first');
      this._applyProjectSoundTraits(preset.soundTraits);
      this._syncTonePopover();
      showToast(`Tone preset applied: ${preset.name}`);
    });

    popover.querySelector('#tone-preset-delete')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const preset = this._selectedTonePreset(popover);
      if (!preset) return showToast('Choose a Tone preset first');
      if (!confirm(`Delete Tone preset "${preset.name}"?`)) return;
      this._deleteTonePreset(preset.id);
      this._refreshTonePresetControls();
      showToast(`Tone preset deleted: ${preset.name}`);
    });

    popover.querySelector('#tone-preset-select')?.addEventListener('change', () => {
      const preset = this._selectedTonePreset(popover);
      const input = popover.querySelector('#tone-preset-name');
      if (input) input.value = preset?.name || '';
    });

    popover.querySelector('#tone-reset')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._applyProjectSoundTraits(normalizeSoundTraits({}));
      this._syncTonePopover();
      showToast('Tone reset');
    });

    popover.querySelector('#tone-preset-save')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const input = popover.querySelector('#tone-preset-name');
      const name = input?.value?.trim();
      if (!name) return showToast('Name the Tone preset first');
      const selected = this._selectedTonePreset(popover);
      this._saveTonePreset(name, { id: selected?.id });
      this._refreshTonePresetControls();
      showToast(`Tone preset saved: ${name}`);
    });

    popover.querySelector('#tone-preset-save-new')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const input = popover.querySelector('#tone-preset-name');
      const name = input?.value?.trim();
      if (!name) return showToast('Name the Tone preset first');
      this._saveTonePreset(name, { forceNew: true });
      this._refreshTonePresetControls();
      showToast(`Tone preset saved: ${name}`);
    });
  }

  _renderTonePresetControls() {
    const presets = this._tonePresets();
    return `
      <div class="tone-preset">
        <div class="tone-preset__row tone-preset__row--manage">
          <select class="tone-preset__select" id="tone-preset-select" aria-label="Tone preset">
            <option value="">Preset...</option>
            ${presets.map(preset => `<option value="${preset.id}">${preset.name}</option>`).join('')}
          </select>
          <button class="btn btn--ghost" id="tone-preset-apply" type="button">Apply</button>
          <button class="btn btn--ghost" id="tone-preset-delete" type="button">Delete</button>
          <button class="btn btn--ghost" id="tone-reset" type="button">Reset</button>
        </div>
        <div class="tone-preset__row">
          <input class="tone-preset__input" id="tone-preset-name" type="text" placeholder="Preset name" aria-label="Tone preset name">
          <button class="btn btn--ghost" id="tone-preset-save" type="button">Save</button>
          <button class="btn btn--ghost" id="tone-preset-save-new" type="button">Save as new</button>
        </div>
      </div>
    `;
  }

  _tonePresets() {
    if (!this.project?.settings) return [];
    if (!Array.isArray(this.project.settings.tonePresets)) this.project.settings.tonePresets = [];
    return this.project.settings.tonePresets;
  }

  _selectedTonePreset(root = this._tonePopover) {
    const id = root?.querySelector('#tone-preset-select')?.value;
    return this._tonePresets().find(preset => preset.id === id) || null;
  }

  _saveTonePreset(name, { id = null, forceNew = false } = {}) {
    const presets = this._tonePresets();
    const existing = !forceNew && (presets.find(p => p.id === id) || presets.find(p => p.name.toLowerCase() === name.toLowerCase()));
    const preset = {
      id: existing?.id || crypto.randomUUID(),
      name,
      soundTraits: this._baseSoundTraitsSnapshot(),
      updatedAt: Date.now(),
    };
    if (existing) Object.assign(existing, preset);
    else presets.push(preset);
    presets.sort((a, b) => a.name.localeCompare(b.name));
    this.store?.scheduleAutoSave(this.project);
    window.dispatchEvent(new CustomEvent('project-tone-presets-changed'));
  }

  _deleteTonePreset(id) {
    if (!this.project?.settings || !id) return;
    this.project.settings.tonePresets = this._tonePresets().filter(preset => preset.id !== id);
    this.store?.scheduleAutoSave(this.project);
    window.dispatchEvent(new CustomEvent('project-tone-presets-changed'));
  }

  _refreshTonePresetControls() {
    if (!this._tonePopover) return;
    const old = this._tonePopover.querySelector('.tone-preset');
    old?.insertAdjacentHTML('beforebegin', this._renderTonePresetControls());
    old?.remove();
    this._bindTonePresetControls();
  }

  _syncTonePopover() {
    const traits = this._ensureSoundTraits();
    this._tonePopover?.querySelectorAll('[data-tone-amount]').forEach(slider => {
      const id = slider.dataset.toneAmount;
      const amount = Math.round((traits[id]?.amount || 0) * 100);
      slider.value = String(amount);
      const value = slider.closest('.tone-row')?.querySelector('.tone-row__value');
      if (value) value.textContent = `${amount}%`;
    });
  }

  _handleToneInput(e) {
    const slider = e.target.closest('[data-tone-amount]');
    if (!slider) return;
    this._setToneTraitAmount(slider.dataset.toneAmount, Number(slider.value) / 100, slider);
  }

  _setToneTraitAmount(id, amount, slider = null) {
    if (!id || !SOUND_TRAITS[id]) return;
    const traits = normalizeSoundTraits(this._ensureSoundTraits());
    traits[id] = { amount: Math.max(0, Math.min(1, Number(amount) || 0)) };
    const rounded = Math.round(traits[id].amount * 100);
    if (slider) {
      slider.value = String(rounded);
      const value = slider.closest('.tone-row')?.querySelector('.tone-row__value');
      if (value) value.textContent = `${rounded}%`;
    }
    this._applyProjectSoundTraits(traits);
  }

  _closeTonePopover() {
    if (this._toneClickOutsideHandler) {
      document.removeEventListener('pointerdown', this._toneClickOutsideHandler, true);
      this._toneClickOutsideHandler = null;
    }
    this._tonePopover?.remove();
    this._tonePopover = null;
    this.el?.querySelector('#tone-button')?.setAttribute('aria-expanded', 'false');
  }

  _closePadsPopover() {
    if (this._padsClickOutsideHandler) {
      document.removeEventListener('pointerdown', this._padsClickOutsideHandler, true);
      this._padsClickOutsideHandler = null;
    }
    this._padsPopover?.remove();
    this._padsPopover = null;
    this.el?.querySelector('#layout-button')?.setAttribute('aria-expanded', 'false');
  }

  _closeKeysPopover() {
    if (this._keysClickOutsideHandler) {
      document.removeEventListener('pointerdown', this._keysClickOutsideHandler, true);
      this._keysClickOutsideHandler = null;
    }
    this._keysPopover?.remove();
    this._keysPopover = null;
    this.el?.querySelector('#layout-button')?.setAttribute('aria-expanded', 'false');
  }
}
