/**
 * Notenotes — Main Application Entry Point
 * Initializes the audio engine, transport, data layer, and UI shell.
 */

import './style.css';
import './instruments/instruments.css';
import './ui/settings.css';

import { AudioEngine } from './engine/AudioEngine.js';
import { Transport } from './engine/Transport.js';
import { Metronome } from './engine/Metronome.js';
import { Quantizer } from './engine/Quantizer.js';
import { ProjectStore, createProject } from './data/ProjectStore.js';
import { UndoManager } from './data/UndoManager.js';
import { TransportBar } from './ui/TransportBar.js';
import { ModeTabs, Modes } from './ui/ModeTabs.js';
import { showToast } from './ui/Toast.js';
import { CreativeMode } from './modes/CreativeMode.js';
import { CanvasMode } from './modes/CanvasMode.js';
import { EditMode } from './modes/EditMode.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import { PlaybackEngine } from './engine/PlaybackEngine.js';

class App {
  constructor() {
    this.engine = AudioEngine.getInstance();
    this.transport = new Transport();
    this.metronome = new Metronome(this.transport);
    this.quantizer = new Quantizer(this.transport.ticksPerBeat);
    this.store = new ProjectStore();
    this.undoManager = new UndoManager();
    this.project = null;

    // UI components
    this.transportBar = new TransportBar(this.transport, this.metronome);
    this.modeTabs = new ModeTabs();
    this.creativeMode = new CreativeMode(this.engine, this.transport, this.quantizer, this.store, null);
    this.canvasMode = null; // Created after project load
    this.editMode = null;   // Created after project load
    this.settingsPanel = null; // Created after project load
    this.playbackEngine = null; // Created after project load

    this._initialized = false;
  }

  /**
   * Boot the application.
   */
  async init() {
    // Initialize data layer
    await this.store.init();

    // Build UI shell
    this._buildUI();

    // Bind keyboard shortcuts
    this._bindKeyboard();

    // Load or create project
    await this._loadOrCreateProject();

    // Pass project reference to creative mode
    this.creativeMode.project = this.project;

    // Create and render Canvas Mode (needs project)
    this.canvasMode = new CanvasMode(this.transport, this.project, this.undoManager, this.store);
    const canvasView = document.getElementById(`view-${Modes.CANVAS}`);
    if (canvasView) {
      canvasView.appendChild(this.canvasMode.render());
    }

    // Create PlaybackEngine (plays clips from Canvas tracks)
    this.playbackEngine = new PlaybackEngine(this.transport, this.project);

    // Wire instrument changes from Canvas → PlaybackEngine
    this.canvasMode.onTrackInstrumentChanged = (trackId) => {
      this.playbackEngine?.onTrackInstrumentChanged(trackId);
    };

    // Create and render Edit Mode (needs project)
    this.editMode = new EditMode(this.transport, this.undoManager, this.store, this.project);
    const editView = document.getElementById(`view-${Modes.PIANOROLL}`);
    if (editView) {
      editView.innerHTML = '';
      editView.appendChild(this.editMode.render());
    }

    // Wire snippet selection: SnippetTray → EditMode
    this.creativeMode.snippetTray.onSnippetSelected((snippet) => {
      this.editMode.loadSnippet(snippet);
      this.modeTabs.setActive(Modes.PIANOROLL);
      this._switchMode(Modes.PIANOROLL);
      showToast('Editing snippet');
    });

    // Wire snippet deletion: SnippetTray → Project
    this.creativeMode.snippetTray.onSnippetDeleted((id) => {
      if (this.project && this.project.snippets) {
        this.project.snippets = this.project.snippets.filter(s => s.id !== id);
        this.store?.scheduleAutoSave(this.project);
      }
    });

    // Load existing snippets into SnippetTray
    if (this.project && this.project.snippets) {
      this.project.snippets.forEach(snippet => {
        this.creativeMode.snippetTray.addSnippet(snippet);
      });
    }

    // Create and render Settings Panel (needs project)
    this.settingsPanel = new SettingsPanel({
      transport: this.transport,
      metronome: this.metronome,
      quantizer: this.quantizer,
      store: this.store,
      project: this.project,
    });
    document.body.appendChild(this.settingsPanel.render());

    // Wire metronome button to also show settings on long-press
    this.transportBar.onSettingsClick = () => this.settingsPanel.toggle();

    // First user interaction will init audio
    this._setupAudioInit();

    console.log('[App] Notenotes ready.');
  }

  /**
   * Build the main UI structure.
   */
  _buildUI() {
    const app = document.getElementById('app');
    app.innerHTML = '';

    // Transport bar (top)
    app.appendChild(this.transportBar.render());

    // Main content area
    const main = document.createElement('main');
    main.className = 'main-content';
    main.id = 'main-content';

    // Mode views
    // Creative mode uses real instrument UI
    const creativeView = document.createElement('div');
    creativeView.className = 'mode-view is-active';
    creativeView.id = `view-${Modes.CREATIVE}`;
    creativeView.setAttribute('role', 'tabpanel');
    creativeView.appendChild(this.creativeMode.render());

    // Canvas mode uses real arranger UI
    const canvasView = document.createElement('div');
    canvasView.className = 'mode-view';
    canvasView.id = `view-${Modes.CANVAS}`;
    canvasView.setAttribute('role', 'tabpanel');
    // CanvasMode rendered after project load

    const pianoRollView = this._createModeView(Modes.PIANOROLL, false);

    main.appendChild(creativeView);
    main.appendChild(canvasView);
    main.appendChild(pianoRollView);

    app.appendChild(main);

    // Mode tabs (bottom)
    app.appendChild(this.modeTabs.render());

    // Mode switching
    this.modeTabs.onChange((mode) => {
      this._switchMode(mode);
      // Refresh canvas when switching to it
      if (mode === Modes.CANVAS && this.canvasMode) {
        this.canvasMode.refresh();
      }
    });
  }

  /**
   * Create a mode view placeholder.
   */
  _createModeView(mode, active) {
    const view = document.createElement('div');
    view.className = `mode-view${active ? ' is-active' : ''}`;
    view.id = `view-${mode}`;
    view.setAttribute('role', 'tabpanel');

    // Placeholder content for each mode
    const content = this._getModeContent(mode);
    view.innerHTML = content;

    return view;
  }

  _getModeContent(mode) {
    switch (mode) {
      case Modes.CREATIVE:
        return `
          <div class="empty-state" id="creative-content">
            <div class="empty-state__icon">🎹</div>
            <h1 class="empty-state__title">Creative Mode</h1>
            <p class="empty-state__desc">Your jam space. Play instruments, loop ideas, and capture snippets on the fly.</p>
            <p class="empty-state__desc" style="color: var(--accent-dim); font-size: var(--font-size-sm);">
              Instruments loading in Phase 2...
            </p>
          </div>
        `;
      case Modes.CANVAS:
        return `
          <div class="empty-state" id="canvas-content">
            <div class="empty-state__icon">🎼</div>
            <h1 class="empty-state__title">Canvas Mode</h1>
            <p class="empty-state__desc">Arrange your snippets into a full track. Drag, drop, and paint your ideas across the timeline.</p>
            <p class="empty-state__desc" style="color: var(--accent-dim); font-size: var(--font-size-sm);">
              Arranger loading in Phase 4...
            </p>
          </div>
        `;
      case Modes.PIANOROLL:
        return `
          <div class="empty-state" id="pianoroll-content">
            <div class="empty-state__icon">✏️</div>
            <h1 class="empty-state__title">Live Edit</h1>
            <p class="empty-state__desc">Zoom into any clip to edit notes, adjust timing, and fine-tune your sketch.</p>
            <p class="empty-state__desc" style="color: var(--accent-dim); font-size: var(--font-size-sm);">
              Piano roll loading in Phase 5...
            </p>
          </div>
        `;
      default:
        return '';
    }
  }

  /**
   * Switch the active mode view.
   */
  _switchMode(mode) {
    const views = document.querySelectorAll('.mode-view');
    views.forEach(v => {
      v.classList.toggle('is-active', v.id === `view-${mode}`);
    });
  }

  /**
   * Set up audio initialization on first user interaction.
   * Required by browser autoplay policies.
   */
  _setupAudioInit() {
    const initAudio = async () => {
      if (this._initialized) return;
      await this.engine.init();
      this.metronome.init();
      this.creativeMode.init();
      this.playbackEngine?.init();
      this._initialized = true;
      showToast('Audio engine ready');
      console.log('[App] Audio initialized on user gesture.');
    };

    // Listen for first interaction
    const events = ['pointerdown', 'keydown', 'touchstart'];
    const handler = () => {
      initAudio();
      events.forEach(e => document.removeEventListener(e, handler));
    };
    events.forEach(e => document.addEventListener(e, handler, { once: false }));
  }

  /**
   * Load the most recent project, or create a new one.
   */
  async _loadOrCreateProject() {
    const projects = await this.store.listAll();
    if (projects.length > 0) {
      this.project = await this.store.load(projects[0].id);
      if (this.project) {
        this.transport.bpm = this.project.bpm;
        this.transport.timeSignature = this.project.timeSignature;
        this.quantizer.setGrid(this.project.settings.quantize || 0);
        this.metronome.enabled = this.project.settings.metronomeOn || false;
        console.log('[App] Loaded project:', this.project.name);
        return;
      }
    }

    // No projects — create a new one
    this.project = createProject('My First Sketch');
    await this.store.save(this.project);
    console.log('[App] Created new project:', this.project.name);
  }

  /**
   * Bind global keyboard shortcuts.
   */
  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't capture when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Space → Play/Pause
      if (e.code === 'Space') {
        e.preventDefault();
        if (this._initialized) {
          this.transport.toggle();
        }
      }

      // Ctrl+Z → Undo
      if (e.ctrlKey && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault();
        if (this.undoManager.undo()) {
          showToast(`Undo: ${this.undoManager.redoDescription}`);
        }
      }

      // Ctrl+Shift+Z → Redo
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault();
        if (this.undoManager.redo()) {
          showToast(`Redo: ${this.undoManager.undoDescription}`);
        }
      }

      // Ctrl+S → Save
      if (e.ctrlKey && e.code === 'KeyS') {
        e.preventDefault();
        if (this.project) {
          this.store.save(this.project);
          this.store.saveVersion(this.project);
          showToast('Project saved');
        }
      }

      // M → Toggle metronome
      if (e.code === 'KeyM' && !e.ctrlKey) {
        const active = this.metronome.toggle();
        document.querySelector('#metronome-toggle')?.classList.toggle('is-active', active);
        showToast(active ? 'Metronome on' : 'Metronome off');
      }
    });
  }
}

// --- Boot ---
const app = new App();
app.init().catch(err => {
  console.error('[App] Failed to initialize:', err);
});

// Expose for debugging
window.__notenotes = app;
