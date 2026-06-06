/**
 * CreativeMode — The Jam Space.
 * Instrument switcher + active instrument view + synth patch selector.
 * Now with loop progress, punch-in recording, and snippet tray.
 */

import '../modes/creative.css';
import '../ui/AISeedPanel.css';
import { WebAudioSynth, PRESETS } from '../instruments/WebAudioSynth.js';
import { loadSampleIndex } from '../instruments/SamplePack.js';
import { normalizeDegreeHighlighting, normalizeMusicalContext, SCALES } from '../engine/MusicTheory.js';
import { droneNotesForContext, normalizeDroneSettings } from '../engine/Drone.js';
import { ScaleBoard } from '../instruments/ScaleBoard.js';
import { MicroPiano } from '../instruments/MicroPiano.js';
import { SketchKit } from '../instruments/SketchKit.js';
import { MicRecorder } from '../instruments/MicRecorder.js';
import { ControllerMode } from '../instruments/ControllerMode.js';
import { RecordingManager } from '../engine/RecordingManager.js';
import { SnippetTray } from '../ui/SnippetTray.js';
import { AISeedPopover } from '../ui/AISeedPopover.js';
import { AIController } from '../ai/AIController.js';
import { VoiceEngine } from '../instruments/voice/VoiceEngine.js';
import { LoopProgress } from '../ui/LoopProgress.js';
import { TransportState } from '../engine/Transport.js';
import { ArpeggioManager, ARP_MODES } from '../engine/ArpeggioManager.js';
import { GamepadInputManager } from '../engine/GamepadInputManager.js';
import { PerformanceInputRouter } from './input/PerformanceInputRouter.js';
import { ControllerMapperPopover } from '../ui/ControllerMapperPopover.js';
import { CreateLayoutPopover } from '../ui/CreateLayoutPopover.js';
import { CreateInstrumentPopover } from '../ui/CreateInstrumentPopover.js';
import { showToast } from '../ui/Toast.js';
import { StageEventStream } from '../stage/StageEventStream.js';
import { peaksFromBlob } from '../utils/audioPeaks.js';
import englishBaseVoice from '../instruments/voice/voices/english-base.json';
import { INSTRUMENTS } from './creativeConstants.js';
import { CreativeInstrumentsMixin } from './creativeInstruments.js';
import { CreativeControllerMixin } from './creativeController.js';
import { CreativeStageOverlayMixin } from './creativeStageOverlay.js';
import { CreativeAiSeedMixin } from './creativeAiSeed.js';
import { CreativeToneMixin } from './creativeTone.js';

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
        const audioPeaks = await peaksFromBlob(blob);
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

  /**
   * Audition a chord (a short, non-recorded preview) for the Suggest-next-chord
   * hints. This is a discrete UI gesture like tapping a pad, not transport-synced
   * playback, so it does not touch recording, snippets, or the scheduler.
   */
  previewChord(midis = []) {
    if (!Array.isArray(midis) || !midis.length || !this.synth) return;
    this.ensureAudioReady();
    for (const midi of midis) {
      if (Number.isFinite(midi)) this.synth.noteOn(midi, 0.6);
    }
    clearTimeout(this._previewChordTimer);
    this._previewChordTimer = setTimeout(() => {
      for (const midi of midis) {
        if (Number.isFinite(midi)) this.synth.noteOff(midi);
      }
    }, 850);
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
    // Keep the Labs > Sound tab in sync with the new key (Correction, etc).
    this.controllerMode?.refreshSoundTab?.();
  }

  /** Whether the drone anchor is currently sounding. */
  get droneEnabled() {
    return !!this._droneSettings.enabled;
  }

  /** Project progression, normalized. Used by the Labs > Sound tab. */
  getProjectProgression() {
    return this.project?.progression;
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
    this.controllerMode?.refreshSoundTab?.();
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
  /**
   * Open or close the AI seed popover.
   *
   * @param {HTMLElement} anchor      - Container element for the popover.
   *   Patch-selector for Scale/Piano, sk-kit-selector for Kit.
   * @param {HTMLElement} [buttonEl]  - The button element that opens the
   *   popover. Used for aria-expanded and to suppress the click-outside
   *   handler when re-clicking the button itself.
   */
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

  panic() {
    this.synth?.panic?.();
    this.sketchKit?.panic?.();
    this.voiceEngine?.allNotesOff?.();
    this.stageEvents?.clear?.();
    this._stageHeldNotes?.clear?.();
    this.arpManager?.setMode?.(ARP_MODES.OFF);
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

  _togglePadsPopover(anchor, buttonEl) {
    this.layoutPopover?.togglePads(anchor, buttonEl);
  }

  _toggleKeysPopover(anchor, buttonEl) {
    this.layoutPopover?.toggleKeys(anchor, buttonEl);
  }

  _closePadsPopover() {
    this.layoutPopover?.closePads();
  }

  _closeKeysPopover() {
    this.layoutPopover?.closeKeys();
  }
}

Object.assign(
  CreativeMode.prototype,
  CreativeInstrumentsMixin,
  CreativeControllerMixin,
  CreativeStageOverlayMixin,
  CreativeAiSeedMixin,
  CreativeToneMixin,
);
