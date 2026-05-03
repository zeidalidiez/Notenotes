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
import { RecordingManager } from '../engine/RecordingManager.js';
import { SnippetTray } from '../ui/SnippetTray.js';
import { LoopProgress } from '../ui/LoopProgress.js';
import { TransportState } from '../engine/Transport.js';
import { showToast } from '../ui/Toast.js';

const INSTRUMENTS = {
  SCALEBOARD: 'scaleboard',
  PIANO: 'piano',
  KIT: 'kit',
  MIC: 'mic',
};

export class CreativeMode {
  constructor(engine, transport, quantizer, store, project) {
    this.engine = engine;
    this.transport = transport;
    this.quantizer = quantizer;
    this.store = store;
    this.project = project;
    this.el = null;
    this.activeInstrument = INSTRUMENTS.SCALEBOARD;

    // Synth (shared between Scale Board and Micro Piano)
    this.synth = new WebAudioSynth();

    // Instruments
    this.scaleBoard = new ScaleBoard(this.synth, this.project);
    this.microPiano = new MicroPiano(this.synth);
    this.sketchKit = new SketchKit();
    this.micRecorder = new MicRecorder();

    // Recording
    this.recordingManager = new RecordingManager(transport, quantizer);

    // UI
    this.snippetTray = new SnippetTray();
    this.loopProgress = new LoopProgress(transport, project);

    this._initialized = false;
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

    // Wire up note callbacks for recording
    const noteOn = (midi, vel) => this.recordingManager.noteOn(midi, vel);
    const noteOff = (midi) => this.recordingManager.noteOff(midi);
    this.scaleBoard.setNoteCallbacks(noteOn, noteOff);
    this.microPiano.setNoteCallbacks(noteOn, noteOff);
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
    });

    this._initialized = true;
  }

  /**
   * Render the Creative Mode view.
   * @returns {HTMLElement}
   */
  render() {
    this.el = document.createElement('div');
    this.el.className = 'creative-mode';
    this.el.style.cssText = 'display:flex;flex-direction:column;height:100%;';

    // Loop progress bar (top of creative mode)
    this.el.appendChild(this.loopProgress.render());

    // Instrument switcher tabs
    const switcher = document.createElement('div');
    switcher.className = 'instrument-switcher';
    switcher.id = 'instrument-switcher';
    const tabs = [
      { id: INSTRUMENTS.SCALEBOARD, icon: '🎹', label: 'Scale' },
      { id: INSTRUMENTS.PIANO, icon: '🎵', label: 'Piano' },
      { id: INSTRUMENTS.KIT, icon: '🥁', label: 'Kit' },
      { id: INSTRUMENTS.MIC, icon: '🎤', label: 'Mic' },
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

    return this.el;
  }

  _switchInstrument(id) {
    if (id === this.activeInstrument) return;
    this.synth.allNotesOff();
    this.activeInstrument = id;

    this.el.querySelectorAll('.instrument-switcher__tab').forEach(tab => {
      tab.classList.toggle('is-active', tab.dataset.instrument === id);
    });

    this.el.querySelectorAll('.instrument-view').forEach(view => {
      view.classList.toggle('is-active', view.id === `instrument-${id}`);
    });

    const patchSel = this.el.querySelector('#patch-selector');
    const isSynth = id === INSTRUMENTS.SCALEBOARD || id === INSTRUMENTS.PIANO;
    patchSel.style.display = isSynth ? 'flex' : 'none';
  }
}
