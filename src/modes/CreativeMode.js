/**
 * CreativeMode — The Jam Space.
 * Instrument switcher + active instrument view + synth patch selector.
 * Now with loop progress, punch-in recording, and snippet tray.
 */

import '../modes/creative.css';
import { WebAudioSynth, PRESETS, SOUND_TRAITS, normalizeSoundTraits } from '../instruments/WebAudioSynth.js';
import { loadSampleIndex, loadSampleInstrument } from '../instruments/SamplePack.js';
import {
  degreeForMidi,
  midiToNoteName,
  normalizeDegreeHighlighting,
  normalizeMusicalContext,
  SCALES
} from '../engine/MusicTheory.js';
import { droneNotesForContext, normalizeDroneSettings } from '../engine/Drone.js';
import { ScaleBoard } from '../instruments/ScaleBoard.js';
import { MicroPiano } from '../instruments/MicroPiano.js';
import { SketchKit } from '../instruments/SketchKit.js';
import { MicRecorder } from '../instruments/MicRecorder.js';
import { ControllerMode } from '../instruments/ControllerMode.js';
import { RecordingManager } from '../engine/RecordingManager.js';
import { SnippetTray } from '../ui/SnippetTray.js';
import { AISeedPopover } from '../ui/AISeedPopover.js';
import '../ui/AISeedPanel.css';
import { ChoicePicker } from '../ui/ChoicePicker.js';
import { AIController } from '../ai/AIController.js';
import { buildAIInstrumentInfo, mapCreativeInstrumentToAi } from '../ai/AIInstrumentContext.js';
import { VoiceEngine } from '../instruments/voice/VoiceEngine.js';
import englishBaseVoice from '../instruments/voice/voices/english-base.json';
import { LoopProgress } from '../ui/LoopProgress.js';
import { TransportState } from '../engine/Transport.js';
import { ArpeggioManager, ARP_MODES } from '../engine/ArpeggioManager.js';
import { GamepadInputManager } from '../engine/GamepadInputManager.js';
import { PerformanceInputRouter } from './input/PerformanceInputRouter.js';
import { ControllerMapperPopover, controllerTargetLabel } from '../ui/ControllerMapperPopover.js';
import { CreateLayoutPopover } from '../ui/CreateLayoutPopover.js';
import { CreateInstrumentPopover } from '../ui/CreateInstrumentPopover.js';
import { showToast } from '../ui/Toast.js';
import { StageEventStream } from '../stage/StageEventStream.js';
import { CanvasStageRenderer } from '../stage/CanvasStageRenderer.js';
import { STAGE_LIVE_LANE_LIMIT, stageUnitTicksForMeter } from '../stage/StageModel.js';

const INSTRUMENTS = {
  SCALEBOARD: 'scaleboard',
  PIANO: 'piano',
  KIT: 'kit',
  MIC: 'mic',
  CONTROLLER: 'controller',
};

const CONTROLLER_MODIFIER_BUTTONS = new Set([4, 5, 6, 7]);

const STAGE_DRUM_PITCHES = {
  kick: 36,
  snare: 38,
  clap: 39,
  hihat: 42,
  cymbal: 49,
  tomlo: 45,
  tommid: 47,
  tomhi: 50,
  rim: 37,
  shaker: 82,
};

export class CreativeMode {
  constructor(engine, transport, quantizer, store, project, modManager) {
    this.engine = engine;
    this.transport = transport;
    this.quantizer = quantizer;
    this.store = store;
    this.project = project;
    this._modManager = modManager;
    this.gamepadInput = new GamepadInputManager();
    this.stageEvents = new StageEventStream();
    this.el = null;
    this.activeInstrument = INSTRUMENTS.SCALEBOARD;

    // Synth (shared between Scale Board and Micro Piano)
    this.synth = new WebAudioSynth();

    // Drone: a sustained tonal anchor on the project root. Runtime-only live
    // state (not recorded/exported); the held MIDI notes are tracked so a key
    // change can re-pitch them.
    this._droneSettings = normalizeDroneSettings({ enabled: false });
    this._droneNotes = [];

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
    this.scaleBoard.onStepPlayChanged = () => this.store?.scheduleAutoSave(this.project);
    // When Scale Board switches into/out of Voice Sketch mode, refresh any
    // open AI Seed popover. AI can't generate voice phrases, so the panel
    // disables itself with "Unavailable in Voice Sketch mode" instead of
    // hiding the button entirely (the user might want to see the AI button
    // is there, just not usable right now).
    this.scaleBoard.onPadModeChange = () => {
      this.aiSeedPopover?.refresh();
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
    this.sketchKit.onStageClick = () => this._toggleStageOverlay();
    this.micRecorder = new MicRecorder();
    this.controllerMode = new ControllerMode(this.synth, this.project, modManager, this.gamepadInput);
    this.controllerMode.onToneAssignmentChanged = () => this.store?.scheduleAutoSave(this.project);
    this.controllerMode.onLabsChanged = () => this.store?.scheduleAutoSave(this.project);
    this.controllerMode.onToneOverrideChanged = (traits, labels = []) => {
      this._setLiveSoundTraits(traits);
      this._updateToneTriggerIndicator(labels);
    };
    this.performanceInput = new PerformanceInputRouter({
      gamepadInput: this.gamepadInput,
      instrumentIds: INSTRUMENTS,
      getActiveInstrument: () => this.activeInstrument,
      getScaleBoard: () => this.scaleBoard,
      getMicroPiano: () => this.microPiano,
      getSketchKit: () => this.sketchKit,
      getControllerMode: () => this.controllerMode,
      isCreativeActive: () => this._isCreativeActive(),
      isControllerMapperOpen: () => !!this.controllerMapper?.isOpen(),
      ensureAudioReady: () => this.ensureAudioReady(),
      shiftActiveInstrumentOctave: (delta) => this._shiftActiveInstrumentOctave(delta),
      refreshControllerMapperStatus: () => this._refreshControllerMapperStatus(),
      handleControllerButtonDown: (index) => this._handleControllerButtonDown(index),
      handleControllerButtonUp: (index) => this._handleControllerButtonUp(index),
    });
    this.controllerMapper = new ControllerMapperPopover({
      gamepadInput: this.gamepadInput,
      getBindings: () => this._ensureControllerBindings(),
      setBindings: (bindings) => {
        this.project.settings.controllerBindings = bindings;
      },
      getPresets: () => this._ensureControllerBindingPresets(),
      setPresets: (presets) => {
        this.project.settings.controllerBindingPresets = presets;
      },
      onBindingsChanged: () => this._onControllerBindingsChanged(),
    });
    this.layoutPopover = new CreateLayoutPopover({
      getProject: () => this.project,
      getScaleBoard: () => this.scaleBoard,
      getMicroPiano: () => this.microPiano,
      getMusicalContext: () => this._ensureMusicalContext(),
      getScaleIntervals: () => this._activeScaleIntervals(),
      ensureDegreeHighlighting: () => this._ensureDegreeHighlighting(),
      onBeforeOpen: () => {
        this._closeTonePopover();
        this._closeControllerMapperPopover();
        this._closeAISeedPopover();
      },
      onScheduleSave: () => this.store?.scheduleAutoSave(this.project),
      onPadsChanged: (count) => {
        window.dispatchEvent(new CustomEvent('settings-pads-changed', { detail: { count } }));
      },
      onPianoChanged: () => {
        window.dispatchEvent(new CustomEvent('settings-piano-changed'));
      },
      onDegreeChanged: () => {
        window.dispatchEvent(new CustomEvent('project-degree-highlighting-changed'));
      },
    });
    this.createInstrumentPopover = new CreateInstrumentPopover({
      getProject: () => this.project,
      getCustomInstruments: () => this._customInstruments(),
      getSelectedInstrument: () => this._selectedCustomInstrument(),
      getDefaultType: () => this.activeInstrument === INSTRUMENTS.KIT ? 'kit' : 'patch',
      onBeforeOpen: () => {
        this._closeTonePopover();
        this._closePadsPopover();
        this._closeKeysPopover();
        this._closeControllerMapperPopover();
        this._closeAISeedPopover();
      },
      onSave: (popover) => this._saveCustomInstrument(popover),
    });

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
    this.aiSeedPopover = new AISeedPopover({
      controller: this.aiController,
      getProject: () => this.project,
      getActiveInstrumentId: () => this._mapInstrumentToAi(this.activeInstrument),
      getAvailability: () => this._isAISeedAvailable(),
      onSnippetCreated: (snippet) => this._onAISnippetCreated(snippet),
      onOpenSettings: () => {
        window.dispatchEvent(new CustomEvent('notenotes-open-settings', {
          detail: { section: 'settings', focus: 'ai' },
        }));
      },
      onSettingsChanged: () => this.store?.scheduleAutoSave(this.project),
    });

    this._initialized = false;
    this._tonePopover = null;
    this._toneClickOutsideHandler = null;
    this._patchPicker = null;
    this._heldControllerMidis = new Map();
    this._heldControllerPads = new Map();
    this._heldControllerFallback = new Map();
    this._recordArmed = false;
    this.onRecordArmChanged = null;
    this._activePatchId = 'chip_lead';
    this._sampleIndex = null;
    loadSampleIndex().then((idx) => { this._sampleIndex = idx; }).catch(() => {});
    this._currentToneTraits = this._currentToneTraits || null;
    this._stageOverlay = null;
    this._stageHeldNotes = new Map();
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
    const noteOn = (midi, vel, meta) => {
      this._stageNoteOn(midi, vel, meta);
      this.recordingManager.noteOn(midi, vel, meta);
    };
    const noteOff = (midi) => {
      this._stageNoteOff(midi);
      this.recordingManager.noteOff(midi);
    };
    this.scaleBoard.setNoteCallbacks(noteOn, noteOff);
    this.microPiano.setNoteCallbacks(noteOn, noteOff);
    this.controllerMode.setNoteCallbacks(noteOn, noteOff);
    const startArmedRecording = () => this._beginArmedRecordingIfNeeded();
    this.scaleBoard.setBeforeNoteCallback(startArmedRecording);
    this.microPiano.setBeforeNoteCallback(startArmedRecording);
    this.controllerMode.setBeforeNoteCallback(startArmedRecording);
    this.sketchKit.setBeforeHitCallback(startArmedRecording);
    this.sketchKit.setHitCallback((drumName) => {
      this._stageDrumHit(drumName);
      this.recordingManager.drumHit(drumName);
    });
    this.scaleBoard.setControllerLearnCallback((target) => this._handleControllerLearnTarget(target));
    this.microPiano.setControllerLearnCallback((target) => this._handleControllerLearnTarget(target));
    this.sketchKit.setControllerLearnCallback((target) => this._handleControllerLearnTarget(target));
    this.performanceInput.startGamepad();
    this.performanceInput.initMidiInput();

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
    this.micRecorder.setRecordingCallback(async (blob, micMeta = {}) => {
      try {
        if (!blob?.size) throw new Error('No audio was captured');
        const record = await this.store?.saveAudioAsset(blob, {
          mimeType: blob.type || 'audio/webm',
          size: blob.size,
          createdAt: Date.now(),
          inputChannelMode: micMeta.inputChannelMode || 'auto',
          inputChannelCount: micMeta.inputChannelCount || null,
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
          meter: { ...this.transport.meter },
          timeSignature: { ...this.transport.timeSignature },
          audioAssetId: record?.audioAssetId || null,
          audioUrl: url,
          audioMimeType: blob.type || 'audio/webm',
          audioSize: blob.size,
          audioInputChannelMode: micMeta.inputChannelMode || 'auto',
          audioInputChannelCount: micMeta.inputChannelCount || null,
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
      const notifyAudioState = () => window.dispatchEvent(new CustomEvent('notenotes-audio-state-changed', {
        detail: { state: this.engine.ctx?.state || 'unknown' },
      }));
      if (this.engine.ctx?.state === 'suspended') {
        this.engine.ctx.resume().catch(() => {}).finally(notifyAudioState);
      } else {
        notifyAudioState();
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
      { id: INSTRUMENTS.SCALEBOARD, icon: '🎹', label: 'Pads' },
      { id: INSTRUMENTS.CONTROLLER, icon: '⚗', label: 'Labs' },
      { id: INSTRUMENTS.PIANO, icon: '🎵', label: 'Piano' },
      { id: INSTRUMENTS.KIT, icon: '🥁', label: 'Kit' },
      { id: INSTRUMENTS.MIC, icon: '🎤', label: 'Audio In' },
    ];
    tabs.forEach(t => {
      const btn = document.createElement('button');
      btn.className = `instrument-switcher__tab${t.id === this.activeInstrument ? ' is-active' : ''}`;
      btn.dataset.instrument = t.id;
      btn.innerHTML = `<span>${t.icon}</span><span>${t.label}</span>`;
      this._bindToolbarTap(btn, () => {
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
      <button class="choice-picker-button patch-selector__picker" id="patch-picker-button" type="button" aria-label="Synth patch" aria-haspopup="dialog">
        <span class="choice-picker-button__label" id="patch-picker-label">${this._patchDisplayName(this._activePatchId)}</span>
        <span class="choice-picker-button__chevron" aria-hidden="true">▼</span>
      </button>
      <button class="tone-button" id="create-instrument-button" type="button">${this._activePatchId.startsWith('custom:') ? 'Edit Instrument' : 'Create Instrument'}</button>
      <button class="tone-button" id="delete-instrument-button" type="button">Delete</button>
      <button class="tone-button" id="tone-button" type="button" aria-expanded="false" aria-controls="tone-popover">Tone</button>
      <button class="tone-button ai-seed-button" id="ai-seed-button" type="button" aria-expanded="false" aria-controls="ai-seed-popover" title="Seed a snippet with AI">AI</button>
      <button class="tone-button controller-map-button" id="controller-map-button" type="button" aria-expanded="false" aria-controls="controller-map-popover" title="Learn gamepad bindings">Controller</button>
      <button class="tone-button" id="layout-button" type="button" aria-expanded="false" aria-controls="layout-popover">Layout</button>
      <button class="tone-button stage-button" id="stage-button" type="button" aria-pressed="false" title="Open the performance visual layer">Stage</button>
      <span class="tone-trigger-indicator" id="tone-trigger-indicator" aria-live="polite"></span>
    `;
    this._bindToolbarTap(patchSel.querySelector('#patch-picker-button'), (button) => {
      this._openPatchPicker(button);
      this._syncInstrumentButtons();
    });
    this._bindToolbarTap(patchSel.querySelector('#create-instrument-button'), () => {
      this._toggleCreateInstrumentPopover(patchSel);
    });
    this._bindToolbarTap(patchSel.querySelector('#delete-instrument-button'), () => {
      this._deleteSelectedCustomInstrument();
    });
    this._bindToolbarTap(patchSel.querySelector('#tone-button'), () => {
      this._toggleTonePopover(patchSel);
    });
    this._bindToolbarTap(patchSel.querySelector('#ai-seed-button'), () => {
      this._toggleAISeedPopover(patchSel, patchSel.querySelector('#ai-seed-button'));
    });
    this._bindToolbarTap(patchSel.querySelector('#controller-map-button'), () => {
      this._toggleControllerMapperPopover(patchSel, patchSel.querySelector('#controller-map-button'));
    });
    this._bindToolbarTap(patchSel.querySelector('#layout-button'), (button) => {
      if (button.disabled) return;
      if (this.activeInstrument === INSTRUMENTS.SCALEBOARD) this._togglePadsPopover(patchSel, button);
      else if (this.activeInstrument === INSTRUMENTS.PIANO) this._toggleKeysPopover(patchSel, button);
    });
    this._bindToolbarTap(patchSel.querySelector('#stage-button'), () => {
      this._toggleStageOverlay();
    });
    this.el.appendChild(patchSel);
    this._syncPatchToolbarVisibility();
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
    this.performanceInput.bindKeyboardPerformance();

    return this.el;
  }

  _bindToolbarTap(button, fn) {
    if (!button) return;
    let startX = 0;
    let startY = 0;
    let pointerId = null;
    button.addEventListener('pointerdown', (e) => {
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
    });
    button.addEventListener('pointerup', (e) => {
      if (pointerId !== null && e.pointerId !== pointerId) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      pointerId = null;
      if (dx > 10 || dy > 10) return;
      e.preventDefault();
      fn(button, e);
    });
    button.addEventListener('pointercancel', () => {
      pointerId = null;
    });
    button.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      fn(button, e);
    });
  }

  _patchDisplayName(id = this._activePatchId) {
    if (id?.startsWith?.('custom:')) {
      const instrument = this._customInstruments().find(item => item.id === id.slice(7));
      return instrument?.name || 'Custom instrument';
    }
    if (id?.startsWith?.('builtin:')) {
      const inst = (this._sampleIndex || []).find(item => item.id === id.slice(8));
      return inst?.name || 'Sample instrument';
    }
    return PRESETS[id]?.name || PRESETS.chip_lead.name;
  }

  _patchGroups() {
    const custom = this._customInstruments().filter(instrument => instrument.type === 'patch');
    const chipPresets = Object.entries(PRESETS).filter(([, p]) => (p.family || 'chip') === 'chip');
    const modernPresets = Object.entries(PRESETS).filter(([, p]) => p.family === 'modern');
    const fmPresets = Object.entries(PRESETS).filter(([, p]) => p.family === 'fm');
    const familyKicker = (p) => {
      switch (p.family) {
        case 'fm': return 'FM synth';
        case 'modern': return 'Modern synth';
        default: return 'Chip synth';
      }
    };
    const presetItem = ([key, patch]) => ({
      value: key,
      label: patch.name,
      kicker: familyKicker(patch),
      description: this._patchDescription(patch),
      tags: [patch.oscillator?.type, patch.filter?.type, patch.family].filter(Boolean),
    });
    const groups = [
      { id: 'chip', label: 'Chip presets', items: chipPresets.map(presetItem) },
      { id: 'modern', label: 'Modern presets', items: modernPresets.map(presetItem) },
    ];
    if (fmPresets.length) {
      groups.push({ id: 'fm', label: 'FM synths (2-operator)', items: fmPresets.map(presetItem) });
    }
    const builtinSamples = this._sampleIndex || [];
    if (builtinSamples.length) {
      groups.push({
        id: 'builtin-sample',
        label: 'Sample instruments',
        items: builtinSamples.map(inst => ({
          value: `builtin:${inst.id}`,
          label: inst.name,
          kicker: inst.category ? `${inst.category} - CC0 sample` : 'CC0 sample',
          description: inst.range
            ? `Sampled ${inst.range} - notes outside this range fold in by octave`
            : 'Multi-sampled real instrument (loads on first use)',
          tags: ['sample', inst.category, inst.range, inst.name].filter(Boolean),
        })),
      });
    }
    if (custom.length) {
      groups.push({
        id: 'custom',
        label: 'Custom instruments',
        items: custom.map(instrument => ({
          value: `custom:${instrument.id}`,
          label: instrument.name || 'Untitled instrument',
          kicker: 'Sample patch',
          description: instrument.playbackMode === 'oneShot' ? 'One-shot sample instrument' : 'Gated sample instrument',
          tags: ['custom', 'sample', instrument.name],
        })),
      });
    }
    return groups;
  }

  _patchDescription(patch = {}) {
    const bits = [];
    if (patch.type === 'fm') {
      bits.push('2-op FM');
      const fm = patch.fm || {};
      if (Number.isFinite(fm.ratio) && fm.ratio !== 1) bits.push(`ratio ${fm.ratio}`);
    } else if (patch.oscillator?.type) {
      bits.push(patch.oscillator.type);
    }
    if (patch.unison?.voices) bits.push(`${patch.unison.voices}-voice unison`);
    if (patch.filterEnv) bits.push('filter motion');
    if (patch.vibrato) bits.push('vibrato');
    if (patch.drive) bits.push('drive');
    return bits.join(' - ') || 'Simple synth patch';
  }

  async _openPatchPicker(anchor) {
    if (this.activeInstrument === INSTRUMENTS.KIT) return;
    if (!this._sampleIndex) { try { this._sampleIndex = await loadSampleIndex(); } catch (_) {} }
    this._patchPicker?.close();
    this._patchPicker = new ChoicePicker({
      title: 'Choose Instrument',
      groups: this._patchGroups(),
      selectedValue: this._activePatchId,
      searchPlaceholder: 'Search instruments...',
      onSelect: async (value) => {
        await this._selectPatch(value);
        this._refreshPatchSelector();
        this._syncInstrumentButtons();
      },
    });
    this._patchPicker.open(anchor);
  }

  _refreshPatchSelector() {
    const label = this.el?.querySelector('#patch-picker-label');
    const button = this.el?.querySelector('#patch-picker-button');
    if (label) label.textContent = this._patchDisplayName(this._activePatchId);
    if (button) {
      button.title = this._patchDisplayName(this._activePatchId);
      button.setAttribute('aria-label', `Synth patch: ${this._patchDisplayName(this._activePatchId)}`);
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
    this.aiSeedPopover?.refresh?.();
    // Re-pitch a running drone so the anchor follows the new key.
    if (this._droneSettings.enabled) this._applyDrone();
  }

  /** Whether the drone anchor is currently sounding. */
  get droneEnabled() {
    return !!this._droneSettings.enabled;
  }

  /**
   * Toggle (or set) the sustained root drone. Enabling it holds the root of the
   * project key until it is turned off; it follows key changes and is never
   * recorded.
   */
  setDrone(enabled) {
    const next = enabled === undefined ? !this._droneSettings.enabled : !!enabled;
    this._droneSettings = normalizeDroneSettings({ ...this._droneSettings, enabled: next });
    if (next) {
      this.ensureAudioReady();
      this._applyDrone();
    } else {
      this._stopDrone();
    }
    return next;
  }

  _applyDrone() {
    if (!this.synth) return;
    const wanted = droneNotesForContext(this.project?.musicalContext, this._droneSettings);
    // Release notes no longer wanted, then hold any new ones. Diffing avoids a
    // click from stopping and restarting an unchanged note.
    for (const midi of this._droneNotes) {
      if (!wanted.includes(midi)) this.synth.noteOff(midi);
    }
    for (const midi of wanted) {
      if (!this._droneNotes.includes(midi)) this.synth.noteOn(midi, 0.5);
    }
    this._droneNotes = wanted;
  }

  _stopDrone() {
    if (this.synth) {
      for (const midi of this._droneNotes) this.synth.noteOff(midi);
    }
    this._droneNotes = [];
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
    const patchPicker = this.el?.querySelector('#patch-picker-button');
    const toneBtn = this.el?.querySelector('#tone-button');
    const isKit = this.activeInstrument === INSTRUMENTS.KIT;
    if (patchLabel) patchLabel.hidden = isKit;
    if (patchPicker) patchPicker.hidden = isKit;
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
    } else if (id.startsWith('builtin:')) {
      await this._loadBuiltinSamplePatch(id.slice(8));
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

  async _loadBuiltinSamplePatch(id) {
    try {
      if (!this.engine?.ctx) this.engine?.initSync?.();
      const patch = await loadSampleInstrument(id);
      if (this._activePatchId !== `builtin:${id}`) return; // a newer selection superseded this load
      this.synth.loadPatch(patch);
      showToast(`Instrument loaded: ${patch.name}`);
    } catch (err) {
      console.warn('[CreativeMode] Built-in sample load failed:', err);
      showToast('Sample instrument failed to load');
    }
  }

  _toggleCreateInstrumentPopover(anchor) {
    this.createInstrumentPopover?.toggle(anchor);
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
      : (this._activePatchId || '');
    if (!selected.startsWith('custom:')) return null;
    return this._customInstruments().find(item => item.id === selected.slice(7)) || null;
  }

  async _deleteSelectedCustomInstrument() {
    const selected = this.activeInstrument === INSTRUMENTS.KIT
      ? (this.sketchKit?.selectedKitId || '')
      : (this._activePatchId || '');
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
    return mapCreativeInstrumentToAi(creativeInstrumentId);
  }

  /**
   * Tell the AIController what instrument it should write events for, plus
   * the runtime context the prompt needs (scale, root, pad count for scale-
   * locked, etc.).
   */
  _buildAIInstrumentInfo() {
    return buildAIInstrumentInfo(this.activeInstrument, { scaleBoard: this.scaleBoard });
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
    this.createInstrumentPopover?.close();
  }

  handlesPerformanceKey(code) {
    return this.performanceInput?.handlesPerformanceKey(code) || false;
  }

  _handleControllerButtonDown(index) {
    if (!this._isCreativeActive() || this.controllerMapper?.isOpen()) return;
    if (this.activeInstrument === INSTRUMENTS.SCALEBOARD && this.scaleBoard?.padMode === 'voices') return;
    if (CONTROLLER_MODIFIER_BUTTONS.has(index)) return;
    const binding = this._controllerBinding(index);
    if (binding) {
      this._playControllerBinding(index, binding);
      return;
    }
    this._playControllerFallbackDown(index);
  }

  _handleControllerButtonUp(index) {
    if (CONTROLLER_MODIFIER_BUTTONS.has(index)) return;
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

  _ensureControllerBindingPresets() {
    if (!this.project.settings) this.project.settings = {};
    if (!Array.isArray(this.project.settings.controllerBindingPresets)) {
      this.project.settings.controllerBindingPresets = [];
    }
    return this.project.settings.controllerBindingPresets;
  }

  _onControllerBindingsChanged() {
    this.store?.scheduleAutoSave(this.project);
    this.controllerMode?.refreshBindings?.();
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
    if (binding.type === 'scalePad' && Number.isFinite(binding.padIndex)) {
      if (this.scaleBoard?.padMode === 'voices') return;
      if (this._heldControllerPads.has(index)) return;
      const bindingKey = `controller-${index}`;
      const rootMidi = this.scaleBoard?._notes?.[binding.padIndex] ?? binding.midi;
      const modifiedMidis = this.controllerMode?.modifiedMidisForRoot?.(rootMidi);
      const played = this.scaleBoard.pressControllerPadBinding(bindingKey, {
        ...binding,
        midis: modifiedMidis || undefined,
      });
      if (!played) {
        showToast(`${controllerTargetLabel(binding)} is not available in the current Pads layout`);
        return;
      }
      this._heldControllerPads.set(index, bindingKey);
      return;
    }
    if (binding.type === 'midi' && Number.isFinite(binding.midi)) {
      if (this._heldControllerMidis.has(index)) return;
      const source = `controller-${index}`;
      const midis = this.controllerMode?.modifiedMidisForRoot?.(binding.midi) || [binding.midi];
      midis.forEach(midi => this.microPiano.pressControllerMidi(midi, 0.8, { source }));
      this._heldControllerMidis.set(index, { midis, source });
    }
  }

  _releaseControllerBinding(index) {
    if (this._heldControllerPads.has(index)) {
      const bindingKey = this._heldControllerPads.get(index);
      this.scaleBoard.releaseControllerPadBinding(bindingKey);
      this._heldControllerPads.delete(index);
      return;
    }
    if (!this._heldControllerMidis.has(index)) return;
    const held = this._heldControllerMidis.get(index);
    const midis = Array.isArray(held) ? held : (held?.midis || [held]);
    const source = held?.source || 'controller';
    midis.forEach(midi => this.microPiano.releaseControllerMidi(midi, { source }));
    this._heldControllerMidis.delete(index);
  }

  _playControllerFallbackDown(index) {
    const degreeMap = { 12: 0, 13: 1, 14: 2, 15: 3, 0: 4, 1: 5, 2: 6, 3: 0 };
    if (CONTROLLER_MODIFIER_BUTTONS.has(index)) return;

    const degree = degreeMap[index];
    if (degree === undefined) return;
    this.ensureAudioReady();

    if (this.activeInstrument === INSTRUMENTS.SCALEBOARD && degree < this.scaleBoard._notes.length) {
      if (this.scaleBoard?.padMode === 'step') {
        this.scaleBoard.triggerStepPlay();
        return;
      }
      const bindingKey = `fallback-${index}`;
      const midi = this.scaleBoard._notes[degree];
      const modifiedMidis = this.controllerMode?.modifiedMidisForRoot?.(midi);
      const played = this.scaleBoard.pressControllerPadBinding(bindingKey, {
        type: 'scalePad',
        padIndex: degree,
        midi,
        padMode: this.scaleBoard.padMode,
        padAction: this.scaleBoard._padActionForIndex?.(degree) || 'single',
        midis: modifiedMidis || undefined,
      });
      if (played) this._heldControllerFallback.set(index, { type: 'scale', value: bindingKey });
    } else if (this.activeInstrument === INSTRUMENTS.PIANO && degree < this.microPiano.visibleMidis().length) {
      const midi = this.microPiano.visibleMidis()[degree];
      const midis = this.controllerMode?.modifiedMidisForRoot?.(midi) || [midi];
      const source = `fallback-${index}`;
      midis.forEach(m => this.microPiano.pressControllerMidi(m, 0.8, { source }));
      this._heldControllerFallback.set(index, { type: 'piano', value: { midis, source } });
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
    if (held.type === 'scale') this.scaleBoard.releaseControllerPadBinding(held.value);
    else if (held.type === 'piano') {
      const midis = held.value?.midis || [];
      const source = held.value?.source || `fallback-${index}`;
      midis.forEach(midi => this.microPiano.releaseControllerMidi(midi, { source }));
    }
    else if (held.type === 'controller') this.controllerMode.handleFallbackButtonUp(held.value);
    this._heldControllerFallback.delete(index);
  }

  _isCreativeActive() {
    return !!this.el?.closest('.mode-view.is-active');
  }

  _shiftActiveInstrumentOctave(delta) {
    if (this.activeInstrument === INSTRUMENTS.SCALEBOARD) {
      if (this.scaleBoard?.padMode === 'step') return false;
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

  _stageLaneCount() {
    if (this.activeInstrument === INSTRUMENTS.PIANO) {
      return Math.max(1, Math.min(STAGE_LIVE_LANE_LIMIT, this.microPiano?.visibleMidis?.().length || 12));
    }
    if (this.activeInstrument === INSTRUMENTS.KIT) {
      return Math.max(1, Math.min(10, this.sketchKit?._visibleSounds?.().length || 10));
    }
    if (this.activeInstrument === INSTRUMENTS.MIC) return 1;
    return Math.max(1, Math.min(16, this.scaleBoard?._notes?.length || 8));
  }

  _stageLaneLabel(index) {
    if (this.activeInstrument === INSTRUMENTS.PIANO) {
      const midi = this.microPiano?.visibleMidis?.()[index];
      return midiToNoteName(midi)?.display || String(index + 1);
    }
    if (this.activeInstrument === INSTRUMENTS.KIT) {
      return this.sketchKit?._visibleSounds?.()[index]?.label || String(index + 1);
    }
    const midi = this.scaleBoard?._notes?.[index];
    return midiToNoteName(midi)?.display || String(index + 1);
  }

  _stageInputItems() {
    return Array.from({ length: this._stageLaneCount() }, (_, index) => {
      const label = this._stageLaneLabel(index);
      if (this.activeInstrument === INSTRUMENTS.KIT) {
        const drum = this.sketchKit?._visibleSounds?.()[index];
        return { label: this._stageKitInputLabel(drum, label), color: this._stageColorForDrum(drum?.id || label) };
      }
      const midi = this.activeInstrument === INSTRUMENTS.PIANO
        ? this.microPiano?.visibleMidis?.()[index]
        : this.scaleBoard?._notes?.[index];
      return { label, color: Number.isFinite(midi) ? this._stageColorForMidi(midi) : '#7bd88f' };
    });
  }

  _stageInputNotice() {
    return this.gamepadInput?.state?.().connected
      ? 'Controller connected. Tap lanes too.'
      : 'No controller detected. Tap lanes here.';
  }

  _stageKitInputLabel(drum = {}, fallback = '') {
    const labels = {
      kick: 'KICK',
      snare: 'SNARE',
      clap: 'CLAP',
      hihat: 'HAT',
      cymbal: 'CYM',
      tomlo: 'TOM L',
      tommid: 'TOM M',
      tomhi: 'TOM H',
      rim: 'RIM',
      shaker: 'SHAKE',
    };
    return labels[drum?.id] || String(drum?.label || fallback || '').toUpperCase();
  }

  _stageInputDown(index) {
    if (this.activeInstrument === INSTRUMENTS.PIANO) {
      this.microPiano?.pressVisibleKey?.(index);
      return;
    }
    if (this.activeInstrument === INSTRUMENTS.KIT) {
      this.sketchKit?.triggerVisiblePad?.(index);
      return;
    }
    this.scaleBoard?.pressPad?.(index);
  }

  _stageInputUp(index) {
    if (this.activeInstrument === INSTRUMENTS.PIANO) {
      this.microPiano?.releaseVisibleKey?.(index);
      return;
    }
    if (this.activeInstrument === INSTRUMENTS.KIT) return;
    this.scaleBoard?.releasePad?.(index);
  }

  _stageLaneForMidi(midi) {
    if (this.activeInstrument === INSTRUMENTS.PIANO) {
      const visible = this.microPiano?.visibleMidis?.() || [];
      const exact = visible.indexOf(midi);
      if (exact >= 0) return exact;
      if (visible.length) {
        return visible.reduce((best, value, index) => (
          Math.abs(value - midi) < Math.abs(visible[best] - midi) ? index : best
        ), 0);
      }
    }
    const notes = this.scaleBoard?._notes || [];
    const exact = notes.indexOf(midi);
    if (exact >= 0) return exact;
    if (notes.length) {
      return notes.reduce((best, value, index) => (
        Math.abs(value - midi) < Math.abs(notes[best] - midi) ? index : best
      ), 0);
    }
    return 0;
  }

  _stageColorForMidi(midi) {
    const degree = this._ensureDegreeHighlighting();
    if (degree?.enabled) {
      const meta = degreeForMidi(midi, this._ensureMusicalContext());
      if (meta && degree.colors?.[meta.interval]) return degree.colors[meta.interval];
    }
    if (this.activeInstrument === INSTRUMENTS.PIANO) return '#7d8cff';
    if (this.activeInstrument === INSTRUMENTS.CONTROLLER) return '#d783ff';
    return '#7bd88f';
  }

  _stageColorForDrum(drumName) {
    const sounds = this.sketchKit?._visibleSounds?.() || [];
    const index = Math.max(0, sounds.findIndex(sound => sound.id === drumName));
    const palette = ['#ff6b6b', '#f7b267', '#7bd88f', '#5bd6d6', '#7d8cff', '#d783ff', '#ff77c8', '#f05d8e', '#ff8a5c', '#6fb4ff'];
    return palette[index % palette.length];
  }

  _stageNoteOn(midi, velocity = 0.8, meta = {}) {
    const key = `${this.activeInstrument}:${midi}`;
    if (this._stageHeldNotes.has(key)) return;
    const note = midiToNoteName(midi)?.display || String(midi);
    const id = this.stageEvents.beginNote({
      source: this.activeInstrument,
      pitch: midi,
      lane: this._stageLaneForMidi(midi),
      startTick: this.transport?.currentTick || 0,
      velocity,
      color: this._stageColorForMidi(midi),
      label: note,
      meta,
    });
    this._stageHeldNotes.set(key, id);
  }

  _stageNoteOff(midi) {
    const key = `${this.activeInstrument}:${midi}`;
    const id = this._stageHeldNotes.get(key);
    if (!id) return;
    this.stageEvents.endNote(id, { endTick: this.transport?.currentTick || 0 });
    this._stageHeldNotes.delete(key);
  }

  _stageDrumHit(drumName) {
    const sounds = this.sketchKit?._visibleSounds?.() || [];
    const index = Math.max(0, sounds.findIndex(sound => sound.id === drumName));
    this.stageEvents.hit({
      source: INSTRUMENTS.KIT,
      drum: drumName,
      pitch: STAGE_DRUM_PITCHES[drumName] || (36 + index * 3),
      lane: index,
      startTick: this.transport?.currentTick || 0,
      color: this._stageColorForDrum(drumName),
      label: sounds[index]?.label || drumName,
    });
  }

  _toggleStageOverlay() {
    if (this._stageOverlay) {
      this._stageOverlay.close();
      return;
    }
    const title = this.activeInstrument === INSTRUMENTS.KIT
      ? 'Kit Stage'
      : (this.activeInstrument === INSTRUMENTS.PIANO ? 'Piano Stage' : 'Pad Stage');
    this._stageOverlay = new CanvasStageRenderer({
      title,
      subtitle: 'A first-pass performance highway for the active Create surface.',
      mode: 'live',
      eventStream: this.stageEvents,
      getLaneCount: () => this._stageLaneCount(),
      getLaneLabel: (index) => this._stageLaneLabel(index),
      maxLanes: STAGE_LIVE_LANE_LIMIT,
      getNowTick: () => this.transport?.currentTick || 0,
      getUnitTicks: () => stageUnitTicksForMeter(this.transport),
      getUnitSeconds: () => stageUnitTicksForMeter(this.transport) * (this.transport?.secondsPerTick || 0),
      getInputItems: () => this._stageInputItems(),
      getInputNotice: () => this._stageInputNotice(),
      onInputDown: (index) => this._stageInputDown(index),
      onInputUp: (index) => this._stageInputUp(index),
      onClose: () => {
        this._stageOverlay = null;
        this._syncStageButton();
      },
    });
    this._stageOverlay.open();
    this._syncStageButton();
  }

  _syncStageButton() {
    this.el?.querySelectorAll('.stage-button').forEach(btn => {
      btn.classList.toggle('is-active', !!this._stageOverlay);
      btn.setAttribute('aria-pressed', String(!!this._stageOverlay));
    });
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

    this._syncPatchToolbarVisibility();
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
    this._syncPatchToolbarVisibility();
    this._syncAISeedButtonVisibility();
    this._syncControllerMapperButtonVisibility();
    this._syncStageButton();
    const layoutBtn = this.el?.querySelector('#layout-button');
    if (layoutBtn) {
      const isScale = this.activeInstrument === INSTRUMENTS.SCALEBOARD;
      const isPiano = this.activeInstrument === INSTRUMENTS.PIANO;
      layoutBtn.style.display = '';
      layoutBtn.textContent = 'Layout';
      layoutBtn.disabled = !(isScale || isPiano);
      layoutBtn.setAttribute('aria-disabled', String(layoutBtn.disabled));
      layoutBtn.title = isScale ? 'Pad layout and degree colors' : (isPiano ? 'Keyboard layout and degree colors' : 'Layout controls are available on Pads and Piano');
      if (!isScale) this._closePadsPopover();
      if (!isPiano) this._closeKeysPopover();
    }
  }

  _syncPatchToolbarVisibility() {
    const patchSel = this.el?.querySelector('#patch-selector');
    if (!patchSel) return false;
    const showToolbar = this.activeInstrument === INSTRUMENTS.SCALEBOARD
      || this.activeInstrument === INSTRUMENTS.PIANO
      || this.activeInstrument === INSTRUMENTS.CONTROLLER;
    patchSel.hidden = !showToolbar;
    patchSel.style.display = showToolbar ? '' : 'none';
    if (!showToolbar) {
      this._closeTonePopover();
      this._closePadsPopover();
      this._closeKeysPopover();
    }
    return showToolbar;
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
    this.aiSeedPopover?.toggle(anchor, buttonEl);
  }

  _closeAISeedPopover() {
    this.aiSeedPopover?.close();
  }

  _releaseKeyboardPerformance() {
    this.performanceInput?.releaseAll({
      releaseControllerBinding: () => {
        for (const index of [...this._heldControllerMidis.keys()]) this._releaseControllerBinding(index);
        for (const index of [...this._heldControllerPads.keys()]) this._releaseControllerBinding(index);
      },
      releaseControllerFallback: () => {
        for (const index of [...this._heldControllerFallback.keys()]) this._playControllerFallbackUp(index);
      },
    });
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
    this.stageEvents?.clear?.();
    this._stageHeldNotes?.clear?.();
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
    if (this.controllerMapper?.isOpen()) {
      this._closeControllerMapperPopover();
      return;
    }
    this._closeTonePopover();
    this._closePadsPopover();
    this._closeKeysPopover();
    this._closeAISeedPopover();
    this.controllerMapper.open(anchor, buttonEl);
  }

  _refreshControllerMapperStatus() {
    this.controllerMapper?.refreshStatus();
  }

  _handleControllerLearnTarget(target) {
    return this.controllerMapper?.handleLearnTarget(target) || false;
  }

  _closeControllerMapperPopover() {
    this.controllerMapper?.close();
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
      if (e.target.closest?.('.choice-picker, .choice-picker-backdrop')) return;
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
    this.layoutPopover?.togglePads(anchor, buttonEl);
  }

  _toggleKeysPopover(anchor, buttonEl) {
    this.layoutPopover?.toggleKeys(anchor, buttonEl);
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

    popover.querySelector('#tone-preset-picker')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._openTonePresetPicker(e.currentTarget, popover);
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
    return `
      <div class="tone-preset" data-selected-tone-preset="">
        <div class="tone-preset__row tone-preset__row--manage">
          <button class="choice-picker-button tone-preset__picker" id="tone-preset-picker" type="button" aria-label="Tone preset" aria-haspopup="dialog">
            <span class="choice-picker-button__label" id="tone-preset-label">Preset...</span>
            <span class="choice-picker-button__chevron" aria-hidden="true">▼</span>
          </button>
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
    const id = root?.querySelector('.tone-preset')?.dataset.selectedTonePreset || '';
    return this._tonePresets().find(preset => preset.id === id) || null;
  }

  _tonePresetGroups() {
    return [{
      id: 'saved',
      label: 'Saved Tone presets',
      items: this._tonePresets().map(preset => ({
        value: preset.id,
        label: preset.name || 'Untitled Tone',
        kicker: this._tonePresetSummary(preset.soundTraits),
        description: preset.updatedAt ? `Updated ${new Date(preset.updatedAt).toLocaleDateString()}` : '',
        tags: [preset.name, this._tonePresetSummary(preset.soundTraits)],
      })),
    }];
  }

  _tonePresetSummary(traits = {}) {
    const normalized = normalizeSoundTraits(traits);
    const active = Object.values(SOUND_TRAITS)
      .filter(trait => (normalized[trait.id]?.amount || 0) > 0.03)
      .map(trait => `${trait.name} ${Math.round((normalized[trait.id]?.amount || 0) * 100)}%`);
    return active.length ? active.join(' - ') : 'No Tone';
  }

  _setSelectedTonePreset(root, preset) {
    const wrap = root?.querySelector('.tone-preset');
    if (wrap) wrap.dataset.selectedTonePreset = preset?.id || '';
    const label = root?.querySelector('#tone-preset-label');
    if (label) label.textContent = preset?.name || 'Preset...';
    const input = root?.querySelector('#tone-preset-name');
    if (input && preset) input.value = preset.name || '';
  }

  _openTonePresetPicker(anchor, root = this._tonePopover) {
    const picker = new ChoicePicker({
      title: 'Choose Tone Preset',
      groups: this._tonePresetGroups(),
      selectedValue: root?.querySelector('.tone-preset')?.dataset.selectedTonePreset || '',
      searchPlaceholder: 'Search Tone presets...',
      onSelect: (value) => {
        this._setSelectedTonePreset(root, this._tonePresets().find(preset => preset.id === value) || null);
      },
    });
    picker.open(anchor);
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
    const selectedId = old?.dataset.selectedTonePreset || '';
    old?.insertAdjacentHTML('beforebegin', this._renderTonePresetControls());
    old?.remove();
    this._bindTonePresetControls();
    const preset = this._tonePresets().find(item => item.id === selectedId) || null;
    this._setSelectedTonePreset(this._tonePopover, preset);
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
    this.layoutPopover?.closePads();
  }

  _closeKeysPopover() {
    this.layoutPopover?.closeKeys();
  }
}
