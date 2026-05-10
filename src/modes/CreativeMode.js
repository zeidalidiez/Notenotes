/**
 * CreativeMode — The Jam Space.
 * Instrument switcher + active instrument view + synth patch selector.
 * Now with loop progress, punch-in recording, and snippet tray.
 */

import '../modes/creative.css';
import { WebAudioSynth, PRESETS, SOUND_TRAITS, normalizeSoundTraits } from '../instruments/WebAudioSynth.js';
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
    this.sketchKit.onSoundTraitsChanged = (traits) => this._applyProjectSoundTraits(traits);
    this.sketchKit.onCreateInstrument = (anchor) => this._toggleCreateInstrumentPopover(anchor);
    this.sketchKit.onDeleteInstrument = () => this._deleteSelectedCustomInstrument();
    this.sketchKit.onKitChanged = () => this.store?.scheduleAutoSave(this.project);
    this.micRecorder = new MicRecorder();
    this.controllerMode = new ControllerMode(this.synth, this.project, modManager);
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
    this._instrumentPopover = null;
    this._activePatchId = 'chip_lead';
    this._currentToneTraits = this._currentToneTraits || null;
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
        };
        this.snippetTray.addSnippet(snippet);
        if (this.project) {
          this.project.snippets.push(snippet);
          this.store?.scheduleAutoSave(this.project);
        }
        showToast('Audio snippet captured!');
      } catch (err) {
        console.warn('[CreativeMode] Audio snippet capture failed:', err);
        showToast(err?.message || 'Audio snippet capture failed');
      }
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
        ${this._renderPatchOptions()}
      </select>
      <button class="tone-button" id="create-instrument-button" type="button">${this._activePatchId.startsWith('custom:') ? 'Edit Instrument' : 'Create Instrument'}</button>
      <button class="tone-button" id="delete-instrument-button" type="button">Delete</button>
      <button class="tone-button" id="tone-button" type="button" aria-expanded="false" aria-controls="tone-popover">Tone</button>
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

    // AI Seed toolbar row sits above the snippet tray. Hidden when the
    // active instrument is one the AI can't play (Mic / Controller).
    const aiRow = document.createElement('div');
    aiRow.className = 'ai-seed-row';
    aiRow.id = 'ai-seed-row';
    aiRow.innerHTML = `
      <button class="ai-seed-button" id="ai-seed-button" type="button" aria-expanded="false" aria-controls="ai-seed-popover">
        <span aria-hidden="true">🤖</span>
        <span>AI seed</span>
      </button>
    `;
    aiRow.querySelector('#ai-seed-button').addEventListener('click', (e) => {
      e.preventDefault();
      this._toggleAISeedPopover(aiRow);
    });
    this.el.appendChild(aiRow);
    // Hidden by default until we know which instrument is active.
    this._syncAISeedRowVisibility();

    // Snippet tray (bottom)
    this.el.appendChild(this.snippetTray.render());
    this._bindKeyboardPerformance();

    return this.el;
  }

  _renderPatchOptions() {
    const custom = this._customInstruments().filter(instrument => instrument.type === 'patch');
    return `
      <optgroup label="Synth presets">
        ${Object.entries(PRESETS).map(([key, p]) =>
          `<option value="${key}" ${key === this._activePatchId ? 'selected' : ''}>${p.name}</option>`
        ).join('')}
      </optgroup>
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
    this.sketchKit?.refreshKitSelector?.();
    this.snippetTray?._renderSnippets?.();
  }

  _syncInstrumentButtons() {
    const isCustom = this._activePatchId?.startsWith('custom:');
    const createBtn = this.el?.querySelector('#create-instrument-button');
    const deleteBtn = this.el?.querySelector('#delete-instrument-button');
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

    const editingInstrument = this._selectedCustomInstrument();
    const defaultType = editingInstrument?.type || (this.activeInstrument === INSTRUMENTS.KIT ? 'kit' : 'patch');
    const audioSnippets = (this.project?.snippets || []).filter(snippet => snippet.type === 'audio' && snippet.audioAssetId);
    const popover = document.createElement('div');
    popover.className = 'tone-popover custom-instrument-popover';
    popover.id = 'custom-instrument-popover';
    popover.innerHTML = `
      <div class="tone-popover__header">
        <span>${editingInstrument ? 'Edit Instrument' : 'Create Instrument'}</span>
        <button class="tone-popover__close" type="button" aria-label="Close create instrument">x</button>
      </div>
      <div class="custom-instrument-form">
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

    popover.querySelector('.tone-popover__close')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._closeCreateInstrumentPopover();
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

      const editingInstrument = this._selectedCustomInstrument();
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
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
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
    const eventCount = (snippet.notes?.length || 0) + (snippet.hits?.length || 0);
    showToast(`🤖 Snippet seeded (${eventCount} event${eventCount === 1 ? '' : 's'})`);
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
    if (!isSynth) this._closeTonePopover();

    // AI Seed: visible only on Scale Board / Piano / Sketch Kit. Close the
    // popover when leaving a supported instrument so it doesn't linger over
    // a context the AI can't write for. If the popover is open and the new
    // instrument is supported, refresh it so the suggestion chips and the
    // active-instrument label update.
    this._syncAISeedRowVisibility();
    if (!this._aiCanGenerateForInstrument(id)) {
      this._closeAISeedPopover();
    } else {
      this._aiSeedPanelInstance?.refresh();
    }
  }

  /**
   * Show the AI Seed toolbar row only on instruments the AI can play.
   * Controller and Mic don't qualify — Controller because it duplicates
   * Scale Board's primitives and the user wanted it scoped out, Mic
   * because the AI doesn't generate audio.
   */
  _syncAISeedRowVisibility() {
    const row = this.el?.querySelector('#ai-seed-row');
    if (!row) return;
    row.style.display = this._aiCanGenerateForInstrument(this.activeInstrument) ? 'flex' : 'none';
  }

  _aiCanGenerateForInstrument(creativeInstrumentId) {
    return creativeInstrumentId === INSTRUMENTS.SCALEBOARD
      || creativeInstrumentId === INSTRUMENTS.PIANO
      || creativeInstrumentId === INSTRUMENTS.KIT;
  }

  /**
   * Open or close the AI seed popover. Anchors the popover to the toolbar
   * row so it floats above the row (using bottom-anchoring CSS) without
   * being clipped by the snippet tray.
   */
  _toggleAISeedPopover(anchor) {
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
      onSnippetCreated: (snippet) => this._onAISnippetCreated(snippet),
      onClose: () => this._closeAISeedPopover(),
    });
    popover.appendChild(this._aiSeedPanelInstance.render());

    anchor.appendChild(popover);
    anchor.querySelector('#ai-seed-button')?.setAttribute('aria-expanded', 'true');
    this._aiSeedPopover = popover;

    // Click-outside to close. Listen on capture so we beat the popover's
    // own click handlers. Bound on next microtask so the click that opened
    // the popover doesn't immediately close it.
    const handlePointer = (e) => {
      if (!this._aiSeedPopover) return;
      const aiBtn = anchor.querySelector('#ai-seed-button');
      if (this._aiSeedPopover.contains(e.target)) return;
      if (aiBtn && aiBtn.contains(e.target)) return;
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
    this.el?.querySelector('#ai-seed-button')?.setAttribute('aria-expanded', 'false');
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

  _currentSoundTraitsSnapshot() {
    const traits = this.controllerMode?.currentSoundTraits(this._currentToneTraits || this._ensureSoundTraits())
      || this.synth.soundTraits
      || this._ensureSoundTraits();
    return JSON.parse(JSON.stringify(normalizeSoundTraits(traits)));
  }

  _baseSoundTraitsSnapshot() {
    return JSON.parse(JSON.stringify(normalizeSoundTraits(this._currentToneTraits || this._ensureSoundTraits())));
  }

  _updateToneTriggerIndicator(labels = []) {
    const indicator = this.el?.querySelector('#tone-trigger-indicator');
    if (!indicator) return;
    indicator.textContent = labels.join('/');
    indicator.classList.toggle('is-active', labels.length > 0);
  }

  _toggleTonePopover(anchor) {
    if (this._tonePopover) {
      this._closeTonePopover();
      return;
    }

    const traits = this._ensureSoundTraits();
    const popover = document.createElement('div');
    popover.className = 'tone-popover';
    popover.id = 'tone-popover';
    popover.innerHTML = `
      <div class="tone-popover__header">
        <span>Tone</span>
        <button class="tone-popover__close" type="button" aria-label="Close tone">x</button>
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

    popover.querySelector('.tone-popover__close')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._closeTonePopover();
    });

    popover.querySelectorAll('[data-tone-amount]').forEach(slider => {
      const update = () => this._setToneTraitAmount(slider.dataset.toneAmount, Number(slider.value) / 100, slider);
      slider.addEventListener('input', update);
      slider.addEventListener('change', update);
    });

    this._bindTonePresetControls();
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

    popover.querySelector('#tone-preset-save')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const input = popover.querySelector('#tone-preset-name');
      const name = input?.value?.trim();
      if (!name) return showToast('Name the Tone preset first');
      this._saveTonePreset(name);
      if (input) input.value = '';
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
        </div>
        <div class="tone-preset__row">
          <input class="tone-preset__input" id="tone-preset-name" type="text" placeholder="Preset name" aria-label="Tone preset name">
          <button class="btn btn--ghost" id="tone-preset-save" type="button">Save</button>
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

  _saveTonePreset(name) {
    const presets = this._tonePresets();
    const existing = presets.find(p => p.name.toLowerCase() === name.toLowerCase());
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
    this._tonePopover?.remove();
    this._tonePopover = null;
    this.el?.querySelector('#tone-button')?.setAttribute('aria-expanded', 'false');
  }
}
