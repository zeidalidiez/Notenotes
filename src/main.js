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
import { ModulationManager } from './engine/ModulationManager.js';
import { normalizeMusicalContext } from './engine/MusicTheory.js';
import { meterToTimeSignature, normalizeMeter, pulseCountForMeter } from './engine/Meter.js';
import { normalizeProgressionContext, progressionFitsContext, progressionLabel, progressionStepIndexForBar, PROGRESSION_ADVANCE_MODES } from './engine/Progressions.js';
import { workspaceBackupStatus } from './utils/BackupStatus.js';
import {
  AUTO_FOLDER_BACKUP_DELAY_MS,
  AUTO_FOLDER_BACKUP_MIN_INTERVAL_MS,
  backupFolderPermission,
  getBackupFolderHandle,
  saveWorkspaceBackupToFolder,
} from './utils/FolderBackup.js';
import { applyAccessibilityProfilesFromUrl, ensureAccessibilitySettings } from './ui/AccessibilityProfiles.js';
import { projectMasterVolume, projectMetronomeVolume } from './engine/OutputVolume.js';

if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  window.__notenotesDebug = params.has('debug');
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  import('./dev/AudioParityHarness.js').then((harness) => {
    window.notenotesAudioParity = harness;
  });
}

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
    this.modManager = new ModulationManager(null);
    this.creativeMode = new CreativeMode(this.engine, this.transport, this.quantizer, this.store, null, this.modManager);
    this.canvasMode = null; // Created after project load
    this.editMode = null;   // Created after project load
    this.settingsPanel = null; // Created after project load
    this.playbackEngine = null; // Created after project load

    // UI components

    this._initialized = false;
    this._lastCtrlWheelAt = 0;
    this._folderAutoBackupTimer = null;
    this._folderAutoBackupRunning = false;
    this._audioUnlockPrompt = null;
    this._audioUnlockTitle = null;
    this._audioUnlockStatus = null;
    this._audioUnlockRequestInFlight = false;
    this._audioContextStateBound = false;
    this._audioVisibilityResumeBound = false;
  }

  /**
   * Boot the application.
   */
  async init() {
    // Initialize data layer
    await this.store.init();

    // Build UI shell
    this._buildUI();
    this._setupInstallPrompt();

    // Bind keyboard shortcuts
    this._bindKeyboard();
    this._bindWheelShortcuts();
    this._requestPersistentStorageOnFirstGesture();

    // Load or create project
    await this._loadOrCreateProject();
    this._applyProjectOutputVolumes();

    // Pass project reference to creative mode
    this._ensureProjectMusicalContext();
    this._ensureProjectMeter();
    this._ensureProjectProgression();
    this._applyAccessibilityProfiles();
    this.creativeMode.project = this.project;
    this.transportBar.setProjectKey(this.project.musicalContext);
    this.transportBar.setProjectMeter(this.project.meter);
    this.transportBar.setProjectProgression(this.project.progression);

    // Create and render Canvas Mode (needs project)
    this.canvasMode = new CanvasMode(this.transport, this.project, this.undoManager, this.store);
    const canvasView = document.getElementById(`view-${Modes.CANVAS}`);
    if (canvasView) {
      canvasView.appendChild(this.canvasMode.render());
    }

    // Create PlaybackEngine (plays clips from Canvas tracks)
    this.playbackEngine = new PlaybackEngine(this.transport, this.project, this.store);

    // Wire instrument changes from Canvas → PlaybackEngine
    this.canvasMode.onTrackInstrumentChanged = (trackId) => {
      this.playbackEngine?.onTrackInstrumentChanged(trackId);
    };
    this.canvasMode.onTrackMixChanged = (trackId) => {
      this.playbackEngine?.onTrackMixChanged(trackId);
    };

    // Create and render Edit Mode (needs project)
    this.editMode = new EditMode(this.transport, this.undoManager, this.store, this.project);
    const editView = document.getElementById(`view-${Modes.PIANOROLL}`);
    if (editView) {
      editView.innerHTML = '';
      editView.appendChild(this.editMode.render());
    }

    // Wire snippet rename: EditMode → SnippetTray
    this.editMode.onSnippetRenamed = () => {
      this.creativeMode.snippetTray._renderSnippets();
    };
    this.editMode.onSnippetCreated = (snippet) => {
      this.creativeMode.snippetTray.addSnippet(snippet);
    };

    // Wire snippet selection: SnippetTray → EditMode
    this.creativeMode.snippetTray.onSnippetSelected((snippet) => {
      this.editMode.loadSnippet(snippet);
      this.modeTabs.setActive(Modes.PIANOROLL);
      this._switchMode(Modes.PIANOROLL);
      showToast(snippet.type === 'audio' ? 'Audio preview' : 'Editing snippet');
    });

    // Wire snippet deletion: SnippetTray → Project
    this.creativeMode.snippetTray.onSnippetDeleted((id) => {
      if (this.project && this.project.snippets) {
        this.project.snippets = this.project.snippets.filter(s => s.id !== id);
        this.canvasMode?.removeSnippetReferences?.(id);
        this.editMode?.refreshSnippetList?.();
        window.dispatchEvent(new CustomEvent('project-snippets-changed', { detail: { snippetId: id, action: 'deleted' } }));
        this.store?.scheduleAutoSave(this.project);
        setTimeout(() => this.store?.garbageCollectAudioAssets?.(), 2500);
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
      store: this.store,
      project: this.project,
    });
    document.body.appendChild(this.settingsPanel.render());

    // Wire metronome button to also show settings on long-press
    this.transportBar.onSettingsClick = () => this.settingsPanel.toggle();
    this.transportBar.onBackupClick = () => this._handleBackupStatusClick();
    this.transportBar.onMoreOpen = () => this.settingsPanel.close();
    window.addEventListener('notenotes-open-settings', (event) => {
      this.transportBar.closeMore?.();
      this.settingsPanel.openTo(event.detail?.section || 'settings', event.detail || {});
    });
    window.addEventListener('notenotes-backup-status-changed', (event) => {
      this._syncBackupStatus();
      if (event.detail?.markEdit) this._scheduleFolderAutoBackup();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._runFolderAutoBackup({ reason: 'visibility' });
    });
    this._syncBackupStatus();
    this._scheduleFolderAutoBackup();

    // Wire modulation manager to creative mode synth (after synth init)
    this.modManager._synth = this.creativeMode.synth;

    // Wire pitch/mod display
    this.modManager.onChange = () => {
      this.transportBar.setModDisplay(this.modManager.pitchPercent, this.modManager.modPercent);
    };

    this.transportBar.onArpClick = () => {
      this.creativeMode.arpManager.cycleMode();
      this.transportBar.setArpLabel(this.creativeMode.arpManager.mode);
    };

    this.transportBar.onKeysClick = () => this._toggleKeysOverlay();

    this.transportBar.onModResetClick = () => {
      this.modManager.resetAll();
      this.transportBar.setModDisplay(this.modManager.pitchPercent, this.modManager.modPercent);
    };

    this.transportBar.onPanicClick = () => {
      this.creativeMode?.panic?.();
      this.playbackEngine?.panic?.();
      showToast('Audio stopped');
    };

    this.transportBar.onArmRecordClick = (armed) => {
      this.creativeMode?.setRecordArmed?.(armed);
    };
    this.transportBar.onProjectKeyChange = (context) => {
      this._setProjectMusicalContext(context, { source: 'transport' });
    };
    this.transportBar.onProjectMeterChange = (meter) => {
      this._setProjectMeter(meter);
    };
    this.transportBar.onProjectProgressionChange = (progression) => {
      this._setProjectProgression(progression);
    };
    this.transportBar.onDroneToggle = (enabled) => this.creativeMode?.setDrone(enabled);
    this.transportBar.onBpmChange = (bpm) => {
      if (!this.project) return;
      this.project.bpm = bpm;
      this.store?.scheduleAutoSave(this.project);
    };
    this.creativeMode.onProjectKeyChange = (context) => {
      this._setProjectMusicalContext(context, { source: 'creative' });
    };
    this.creativeMode.onRecordArmChanged = (armed) => {
      this.transportBar.setRecordArmed(armed);
    };

    // Advance the Changes chord-tone glow through the progression as playback
    // crosses bars. This only moves which chord is "hot"; it never touches
    // playback, recording, export, or snippets. When the transport stops it
    // resets to the bar the playhead returns to, so the glow doesn't stick.
    this.transport.onBar((bar) => this._followProgressionToBar(bar));
    this.transport.onStateChange((state) => {
      if (state === 'stopped') this._followProgressionToBar(this.transport.currentBar);
    });

    window.addEventListener('project-time-signature-changed', () => {
      this.transportBar.updateTimeSignature();
      this.transportBar.setProjectMeter(this.project?.meter || this.transport.meter);
      this.canvasMode?.refresh();
      if (this.editMode?._snippet) {
        this.editMode.loadSnippet(this.editMode._snippet, this.editMode._clipId);
      }
    });

    window.addEventListener('project-sound-traits-changed', () => {
      this.canvasMode?.refresh();
    });

    window.addEventListener('project-degree-highlighting-changed', () => {
      this.creativeMode?.refreshProjectBoundUi?.();
    });

    window.addEventListener('project-snippets-changed', () => {
      this.creativeMode?.snippetTray?._renderSnippets?.();
      this.canvasMode?.refresh?.();
      this.editMode?.refreshSnippetList?.();
    });

    window.addEventListener('project-custom-instruments-changed', (event) => {
      this.canvasMode?.refresh();
      this.playbackEngine?.onCustomInstrumentsChanged(event.detail?.instrumentId || null);
    });
    window.addEventListener('notenotes-audio-state-changed', () => this._syncAudioUnlockPrompt());

    // First user interaction will init audio
    this._setupAudioInit();
    this._bindAudioVisibilityResume();
    this._buildAudioUnlockPrompt();

    console.log('[App] Notenotes ready.');
  }

  _requestPersistentStorageOnFirstGesture() {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
    const request = async () => {
      window.removeEventListener('pointerdown', request, true);
      window.removeEventListener('keydown', request, true);
      try {
        await navigator.storage.persist();
      } catch (err) {
        console.warn('[Storage] Persistent storage request failed:', err);
      }
    };
    window.addEventListener('pointerdown', request, { once: true, capture: true });
    window.addEventListener('keydown', request, { once: true, capture: true });
  }

  async _syncBackupStatus() {
    if (!this.project || !this.transportBar) return;
    const baseStatus = workspaceBackupStatus(this.project);
    try {
      const handle = await getBackupFolderHandle(this.store);
      if (!handle) {
        this.transportBar.setBackupStatus(baseStatus);
        return;
      }
      const permission = await backupFolderPermission(handle, false);
      if (permission === 'granted') {
        this.transportBar.setBackupStatus({
          ...baseStatus,
          state: 'auto',
          label: `Auto folder backup: ${handle.name || 'connected'}`,
          shortLabel: 'Auto backup',
          advice: `Auto folder backup is connected${handle.name ? ` to ${handle.name}` : ''}. Current-workspace backups are written after edits.`,
        });
        return;
      }
      this.transportBar.setBackupStatus({
        ...baseStatus,
        state: 'permission',
        label: `Backup folder needs permission`,
        shortLabel: 'Grant folder',
        advice: 'Your backup folder is still connected, but the browser needs permission again before automatic folder backups can continue. Click to grant access.',
      });
    } catch (err) {
      console.warn('[Backup] Could not check folder backup status:', err);
      this.transportBar.setBackupStatus(baseStatus);
    }
  }

  async _handleBackupStatusClick() {
    try {
      const handle = await getBackupFolderHandle(this.store);
      if (handle) {
        const permission = await backupFolderPermission(handle, false);
        if (permission !== 'granted') {
          const requested = await backupFolderPermission(handle, true);
          if (requested === 'granted') {
            showToast('Backup folder access restored');
            await this._runFolderAutoBackup({ reason: 'permission-grant', force: true });
          } else {
            showToast('Backup folder still needs permission');
          }
          await this._syncBackupStatus();
        }
      }
    } catch (err) {
      console.warn('[Backup] Could not request backup folder permission:', err);
      showToast('Could not request backup folder access');
    } finally {
      this.settingsPanel?.openTo('history');
    }
  }

  _folderAutoBackupDue() {
    const waitMs = this._folderAutoBackupWaitMs();
    return waitMs !== null && waitMs <= 0;
  }

  _folderAutoBackupWaitMs() {
    if (!this.project?.settings) return null;
    const lastEditAt = Number(this.project.settings.lastEditAt || this.project.updatedAt || 0);
    const lastBackupAt = Number(this.project.settings.lastWorkspaceBackupAt || 0);
    if (!lastEditAt || lastBackupAt >= lastEditAt) return null;
    if (!lastBackupAt) return 0;
    return Math.max(0, AUTO_FOLDER_BACKUP_MIN_INTERVAL_MS - (Date.now() - lastBackupAt));
  }

  _scheduleFolderAutoBackup() {
    if (this._folderAutoBackupTimer) clearTimeout(this._folderAutoBackupTimer);
    const waitMs = this._folderAutoBackupWaitMs();
    if (waitMs === null) return;
    const delay = Math.max(AUTO_FOLDER_BACKUP_DELAY_MS, waitMs);
    this._folderAutoBackupTimer = setTimeout(() => {
      this._folderAutoBackupTimer = null;
      this._runFolderAutoBackup({ reason: 'timer' });
    }, delay);
  }

  async _runFolderAutoBackup({ reason = 'timer', force = false } = {}) {
    if (this._folderAutoBackupRunning || (!force && !this._folderAutoBackupDue())) return;
    this._folderAutoBackupRunning = true;
    try {
      const handle = await getBackupFolderHandle(this.store);
      if (!handle) return;
      const permission = await backupFolderPermission(handle, false);
      if (permission !== 'granted') return;
      const result = await saveWorkspaceBackupToFolder({
        store: this.store,
        project: this.project,
        handle,
        contents: 'current',
        requestPermission: false,
        saveBefore: false,
        markBackup: true,
      });
      if (result.saved) {
        console.log(`[Backup] Auto-saved workspace to folder (${reason})`);
        this._syncBackupStatus();
      }
    } catch (err) {
      console.warn('[Backup] Auto folder backup failed:', err);
    } finally {
      this._folderAutoBackupRunning = false;
    }
  }

  _ensureProjectMusicalContext() {
    if (!this.project) return normalizeMusicalContext();
    const context = normalizeMusicalContext(this.project.musicalContext);
    this.project.musicalContext = context;
    return context;
  }

  _ensureProjectMeter() {
    if (!this.project) return normalizeMeter('4/4');
    const meter = normalizeMeter(this.project.meter || this.project.timeSignature);
    this.project.meter = meter;
    this.project.timeSignature = meterToTimeSignature(meter);
    this.transport.meter = meter;
    return meter;
  }

  _ensureProjectProgression() {
    if (!this.project) return normalizeProgressionContext();
    const progression = normalizeProgressionContext(this.project.progression);
    this.project.progression = progression;
    return progression;
  }

  _applyAccessibilityProfiles() {
    if (!this.project) return;
    ensureAccessibilitySettings(this.project);
    const enabled = applyAccessibilityProfilesFromUrl(this.project, window.location.search);
    if (enabled.length) {
      this.store?.scheduleAutoSave(this.project);
      requestAnimationFrame(() => showToast(`${enabled.join(' + ')} enabled`));
    }
  }

  _setProjectMusicalContext(context, options = {}) {
    if (!this.project) return;
    const next = normalizeMusicalContext(context);
    const prev = normalizeMusicalContext(this.project.musicalContext);
    if (prev.root === next.root && prev.scale === next.scale && prev.correction === next.correction) return;
    this.project.musicalContext = next;
    const currentProgression = normalizeProgressionContext(this.project.progression);
    if (currentProgression.enabled && !progressionFitsContext(currentProgression, next)) {
      this.project.progression = normalizeProgressionContext();
      this.transportBar.setProjectProgression(this.project.progression);
      window.dispatchEvent(new CustomEvent('project-progression-changed', { detail: { ...this.project.progression } }));
      showToast('Changes turned off for this scale');
    }
    this.transportBar.setProjectKey(next);
    this.creativeMode?.applyProjectMusicalContext?.(next, { source: options.source });
    this.store?.scheduleAutoSave(this.project);
    window.dispatchEvent(new CustomEvent('project-musical-context-changed', { detail: next }));
  }

  _setProjectMeter(meter) {
    if (!this.project || !this.transport) return;
    const next = normalizeMeter(meter);
    const current = normalizeMeter(this.project.meter || this.project.timeSignature);
    const sameGrouping = JSON.stringify(current.grouping || []) === JSON.stringify(next.grouping || []);
    if (current.id === next.id && sameGrouping) return;

    const oldTicksPerBar = this.transport.ticksPerBar;
    const clipPositions = [];
    for (const track of (this.project.tracks || [])) {
      for (const clip of (track.clips || [])) {
        clipPositions.push({
          clip,
          startTick: (clip.startBar || 0) * oldTicksPerBar,
          durationTicks: clip.snippet?.durationTicks || (clip.durationBars || 1) * oldTicksPerBar,
        });
      }
    }

    this.project.meter = next;
    this.project.timeSignature = meterToTimeSignature(next);
    this.transport.meter = next;
    const newTicksPerBar = this.transport.ticksPerBar;

    for (const item of clipPositions) {
      item.clip.startBar = item.startTick / newTicksPerBar;
      item.clip.durationBars = Math.max(1 / pulseCountForMeter(next), item.durationTicks / newTicksPerBar);
    }

    this.project.settings ||= {};
    this.project.settings.beatColors = this._beatColorsForBeats(pulseCountForMeter(next));
    this.transportBar.setProjectMeter(next);
    this.canvasMode?.refresh();
    if (this.editMode?._snippet) {
      this.editMode.loadSnippet(this.editMode._snippet, this.editMode._clipId);
    }
    this.store?.scheduleAutoSave(this.project);
    window.dispatchEvent(new CustomEvent('project-time-signature-changed', {
      detail: { timeSignature: { ...this.project.timeSignature }, meter: { ...this.project.meter } },
    }));
    showToast(`Meter: ${next.id}`);
  }

  _setProjectProgression(progression) {
    if (!this.project) return;
    const next = normalizeProgressionContext(progression);
    const current = normalizeProgressionContext(this.project.progression);
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    this.project.progression = next;
    this.transportBar.setProjectProgression(next);
    this.store?.scheduleAutoSave(this.project);
    window.dispatchEvent(new CustomEvent('project-progression-changed', { detail: { ...next } }));
    showToast(`Changes: ${progressionLabel(next)}`);
  }

  _followProgressionToBar(bar) {
    if (!this.project) return;
    const progression = this.project.progression;
    if (!progression?.enabled || progression.advance !== PROGRESSION_ADVANCE_MODES.strict) return;
    const nextIndex = progressionStepIndexForBar(progression, bar);
    if (nextIndex === progression.activeStepIndex) return;
    // Active step is transient performance state: update in place and refresh
    // the glow, but don't autosave on every bar boundary.
    progression.activeStepIndex = nextIndex;
    window.dispatchEvent(new CustomEvent('project-progression-changed', { detail: { ...progression } }));
  }

  _beatColorsForBeats(beats = 4) {
    const defaults = ['#1e1e2e', '#2a2a3e', '#1e1e2e', '#2a2a3e', '#242436'];
    const existing = this.project?.settings?.beatColors || defaults;
    return Array.from({ length: beats }, (_, i) => existing[i] || defaults[i] || defaults[0]);
  }

  _setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.notenotesInstallPrompt = e;
    });

    window.addEventListener('appinstalled', () => {
      window.notenotesInstallPrompt = null;
      showToast('Notenotes installed');
    });
  }

  _buildAudioUnlockPrompt() {
    if (this._audioUnlockPrompt || typeof document === 'undefined') return;

    const prompt = document.createElement('button');
    prompt.type = 'button';
    prompt.className = 'audio-unlock-prompt';
    prompt.hidden = true;
    prompt.setAttribute('aria-live', 'polite');
    prompt.innerHTML = `
      <span class="audio-unlock-prompt__dot" aria-hidden="true"></span>
      <span class="audio-unlock-prompt__copy">
        <strong>Tap to enable sound</strong>
        <small>Starting audio...</small>
      </span>
    `;
    const requestUnlock = async (event) => {
      if (event?.cancelable) event.preventDefault();
      event?.stopPropagation?.();
      if (this._audioUnlockRequestInFlight) return;
      this._audioUnlockRequestInFlight = true;
      prompt.classList.add('is-working');
      const ready = await this._initializeAudioFromGesture({ announce: true, primeIOSMediaRoute: true });
      prompt.classList.remove('is-working');
      if (!ready) showToast('Tap again to enable audio');
      this._audioUnlockRequestInFlight = false;
    };
    ['pointerdown', 'touchend', 'click'].forEach(type => {
      prompt.addEventListener(type, requestUnlock);
    });

    document.body.appendChild(prompt);
    this._audioUnlockPrompt = prompt;
    this._audioUnlockTitle = prompt.querySelector('strong');
    this._audioUnlockStatus = prompt.querySelector('small');
    this._syncAudioUnlockPrompt();
  }

  _bindAudioContextState() {
    if (this._audioContextStateBound || !this.engine.ctx?.addEventListener) return;
    this._audioContextStateBound = true;
    this.engine.ctx.addEventListener('statechange', () => {
      window.dispatchEvent(new CustomEvent('notenotes-audio-state-changed', {
        detail: { state: this.engine.ctx?.state || 'unknown' },
      }));
    });
  }

  _bindAudioVisibilityResume() {
    if (this._audioVisibilityResumeBound) return;
    this._audioVisibilityResumeBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.engine.ctx?.state === 'suspended') {
        this.engine.ctx.resume().finally(() => this._syncAudioUnlockPrompt());
      } else {
        this._syncAudioUnlockPrompt();
      }
    });
  }

  _syncAudioUnlockPrompt() {
    if (!this._audioUnlockPrompt) return;
    const state = this.engine.ctx?.state || 'new';
    const needsMediaRoute = this._needsIOSMediaRoutePrime();
    const needsUnlock = !this._initialized || state !== 'running' || needsMediaRoute;
    this._audioUnlockPrompt.hidden = !needsUnlock;
    this._audioUnlockPrompt.classList.toggle('is-visible', needsUnlock);
    this._audioUnlockPrompt.setAttribute('aria-label', needsMediaRoute ? 'Enable iOS sound route' : (needsUnlock ? 'Enable audio engine' : 'Audio engine ready'));
    if (this._audioUnlockTitle) {
      this._audioUnlockTitle.textContent = needsMediaRoute ? 'Tap to allow iOS sound' : 'Tap to enable sound';
    }
    if (this._audioUnlockStatus) {
      this._audioUnlockStatus.textContent = needsMediaRoute
        ? 'Safari may ask for microphone access; nothing records'
        : state === 'suspended'
        ? 'Tap to resume Web Audio'
        : 'No microphone permission needed';
    }
  }

  _isLikelyIOS() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    return /iPad|iPhone|iPod/.test(ua)
      || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  _needsIOSMediaRoutePrime() {
    return this._isLikelyIOS()
      && !!navigator.mediaDevices?.getUserMedia
      && !this.engine.mediaRoutePrimed;
  }

  _isPlayableAudioTarget(target) {
    return !!target?.closest?.([
      '.scaleboard__pad',
      '.step-play__trigger',
      '.tonal-compass__segment',
      '.micropiano__key',
      '.sketchkit__pad',
      '.stage-overlay__input',
      '.audio-unlock-prompt',
    ].join(','));
  }

  async _initializeAudioFromGesture({ announce = false, primeIOSMediaRoute = false } = {}) {
    try {
      const shouldPrimeMediaRoute = primeIOSMediaRoute && this._needsIOSMediaRoutePrime();
      const mediaRoutePrime = shouldPrimeMediaRoute
        ? this.engine.primeMediaRoute().catch((err) => {
          console.warn('[App] iOS media route prime failed:', err);
          if (announce) showToast('iOS sound permission was not granted');
          return false;
        })
        : null;
      if (!this.engine._initialized) {
        this.engine.initSync();
      }
      this._bindAudioContextState();
      this.metronome.init();
      this._applyProjectOutputVolumes();
      this.creativeMode.init();
      this.playbackEngine?.init();
      this._initialized = true;
      this.engine.unlockGesture?.();
      if (this.engine.ctx?.state === 'suspended') {
        await this.engine.ctx.resume().catch(() => {});
      }
      this.engine.unlockGesture?.();
      if (mediaRoutePrime) await mediaRoutePrime;
      const ready = this.engine.ctx?.state === 'running' && !this._needsIOSMediaRoutePrime();
      this._syncAudioUnlockPrompt();
      setTimeout(() => this._syncAudioUnlockPrompt(), 120);
      if (ready && announce) showToast(this._isLikelyIOS() ? 'iOS sound route ready' : 'Audio engine ready');
      return ready;
    } catch (e) {
      console.warn('[App] Audio init failed, will retry:', e);
      this._syncAudioUnlockPrompt();
      return false;
    }
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
    const events = ['pointerdown', 'keydown', 'touchstart', 'touchend'];
    const removeUnlockListeners = (handler) => {
      events.forEach(e => document.removeEventListener(e, handler, { capture: true }));
    };

    const initAudio = async (event = null) => {
      if (this._initialized) return;
      const ready = await this._initializeAudioFromGesture({
        primeIOSMediaRoute: this._isPlayableAudioTarget(event?.target),
      });
      if (ready) {
        showToast('Audio engine ready');
        console.log('[App] Audio initialized on user gesture.');
        return;
      }
    };

    // Persistent resume handler: iOS may need multiple touches before it accepts one
    const maybeResume = async (event = null) => {
      const shouldPrimeRoute = this._isPlayableAudioTarget(event?.target);
      if (!this._initialized) {
        await initAudio(event);
        return;
      }
      const mediaRoutePrime = shouldPrimeRoute && this._needsIOSMediaRoutePrime()
        ? this.engine.primeMediaRoute().catch((err) => {
          console.warn('[App] iOS media route prime failed:', err);
          return false;
        })
        : null;
      if (this.engine.ctx?.state === 'suspended') {
        await this.engine.ctx.resume().catch(() => {});
        this.engine.unlockGesture?.();
      }
      if (mediaRoutePrime) await mediaRoutePrime;
      this._syncAudioUnlockPrompt();
    };

    // Listen for first interaction — use touchend on iOS (preferred for audio), pointerdown on desktop
    const handler = async (event) => {
      await maybeResume(event);
      if (this._initialized && this.engine.ctx?.state === 'running' && !this._needsIOSMediaRoutePrime()) {
        removeUnlockListeners(handler);
      } else {
        setTimeout(() => {
          if (this._initialized && this.engine.ctx?.state === 'running' && !this._needsIOSMediaRoutePrime()) {
            removeUnlockListeners(handler);
          }
        }, 120);
      }
    };
    events.forEach(e => document.addEventListener(e, handler, { passive: true, capture: true }));
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
        const meter = normalizeMeter(this.project.meter || this.project.timeSignature);
        this.project.meter = meter;
        this.project.timeSignature = meterToTimeSignature(meter);
        this.transport.meter = meter;
        this.quantizer.setGrid(0);
        if (this.project.settings) this.project.settings.quantize = 0;
        this.metronome.enabled = this.project.settings.metronomeOn || false;
        this.transportBar.syncFromTransport();
        console.log('[App] Loaded project:', this.project.name);
        return;
      }
    }

    // No projects — create a new one
    this.project = createProject('My First Sketch');
    await this.store.save(this.project);
    console.log('[App] Created new project:', this.project.name);
  }

  _applyProjectOutputVolumes() {
    if (!this.project) return;
    this.project.settings ||= {};
    this.engine.setVolume(projectMasterVolume(this.project));
    this.metronome.setVolume(projectMetronomeVolume(this.project));
  }

  /**
   * Bind global keyboard shortcuts.
   */
  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't capture when typing in inputs
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;

      // Space → Play/Pause
      if (e.code === 'Space') {
        e.preventDefault();
        if (this._initialized) {
          this.transport.toggle();
        }
      }

      // Enter â†’ Stop and rewind
      if (e.code === 'Enter') {
        e.preventDefault();
        if (this._initialized) {
          this.transport.stop();
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

      // 1/3/4/6/7/9 → Pitch bend / Modulation (hold to ramp)
      if (e.code.startsWith('Digit') || e.code.startsWith('Numpad')) {
        if (this.modeTabs.activeMode === Modes.CREATIVE && this.creativeMode?.handlesPerformanceKey?.(e.code)) return;
        const key = e.code.replace('Digit', '').replace('Numpad', '');
        if (['1','3','4','6','7','9'].includes(key) && !e.repeat) {
          e.preventDefault();
          const code = e.code.startsWith('Numpad') ? `Numpad${key}` : key;
          this.modManager.startRamp();
          this.modManager.handleKeyDown(code);
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.code.startsWith('Digit') || e.code.startsWith('Numpad')) {
        if (this.modeTabs.activeMode === Modes.CREATIVE && this.creativeMode?.handlesPerformanceKey?.(e.code)) return;
        const key = e.code.replace('Digit', '').replace('Numpad', '');
        if (['1','3','4','6','7','9'].includes(key)) {
          const code = e.code.startsWith('Numpad') ? `Numpad${key}` : key;
          this.modManager.handleKeyUp(code);
        }
      }
    });
  }

  _bindWheelShortcuts() {
    window.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;

      const target = e.target;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;

      const mode = this.modeTabs.activeMode;
      if (mode !== Modes.CANVAS && mode !== Modes.PIANOROLL) return;

      e.preventDefault();

      const now = performance.now();
      if (now - this._lastCtrlWheelAt < 100) return;
      this._lastCtrlWheelAt = now;

      const direction = e.deltaY < 0 ? 1 : -1;
      if (mode === Modes.CANVAS) {
        this.canvasMode?.zoomBy(direction > 0 ? 1.25 : 0.8);
      } else {
        this.editMode?.adjustVisibleKeyCount(direction);
      }
    }, { passive: false });
  }

  _toggleKeysOverlay() {
    let overlay = document.getElementById('keys-overlay');
    if (overlay) {
      overlay.remove();
      return;
    }
    overlay = document.createElement('div');
    overlay.id = 'keys-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;display:flex;align-items:center;justify-content:center;pointer-events:auto;';
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    overlay.innerHTML = `
      <div style="background:var(--surface-1);border:1px solid var(--surface-3);border-radius:8px;padding:var(--space-lg);max-width:360px;width:90%;font-family:var(--font-family);color:var(--text-primary);max-height:80vh;overflow-y:auto;" onclick="event.stopPropagation()">
        <h3 style="margin:0 0 var(--space-md) 0;font-size:var(--font-size-md);">Keyboard Shortcuts</h3>
        <table style="width:100%;font-size:var(--font-size-sm);border-collapse:collapse;">
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Space</td><td style="padding:4px 8px;color:var(--text-secondary);">Play / Pause</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Enter</td><td style="padding:4px 8px;color:var(--text-secondary);">Stop</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Ctrl+Z</td><td style="padding:4px 8px;color:var(--text-secondary);">Undo</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Ctrl+Shift+Z</td><td style="padding:4px 8px;color:var(--text-secondary);">Redo</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Ctrl+S</td><td style="padding:4px 8px;color:var(--text-secondary);">Save Project</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid var(--surface-3);margin:var(--space-sm) 0;" />
        <h4 style="margin:var(--space-sm) 0;font-size:var(--font-size-sm);">Creative Mode</h4>
        <table style="width:100%;font-size:var(--font-size-sm);border-collapse:collapse;">
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">1-=, Q-], A-', Z-/</td><td style="padding:4px 8px;color:var(--text-secondary);">Play the active Create surface. Pads map 1 to pad 1; Piano maps high to low; Kit maps through visible pads.</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">MIDI keyboard</td><td style="padding:4px 8px;color:var(--text-secondary);">Routes to the active Create surface: Pads, Piano, or Kit.</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Up / Down</td><td style="padding:4px 8px;color:var(--text-secondary);">Shift octave on active Pads, Piano, or Ctrl screen</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">1/4/7</td><td style="padding:4px 8px;color:var(--text-secondary);">Modulation down/reset/up when not playing Pads/Kit/Piano keys</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">3/6/9</td><td style="padding:4px 8px;color:var(--text-secondary);">Pitch bend down/reset/up when not playing Pads/Kit/Piano keys</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid var(--surface-3);margin:var(--space-sm) 0;" />
        <h4 style="margin:var(--space-sm) 0;font-size:var(--font-size-sm);">Inspect Mode (Piano Roll)</h4>
        <table style="width:100%;font-size:var(--font-size-sm);border-collapse:collapse;">
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Click</td><td style="padding:4px 8px;color:var(--text-secondary);">Add note / Select note</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Drag</td><td style="padding:4px 8px;color:var(--text-secondary);">Move note or hit</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Alt+drag</td><td style="padding:4px 8px;color:var(--text-secondary);">Resize note (extend/shrink)</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Ctrl+click</td><td style="padding:4px 8px;color:var(--text-secondary);">Delete note</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Click empty space</td><td style="padding:4px 8px;color:var(--text-secondary);">Add new note</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Scroll</td><td style="padding:4px 8px;color:var(--text-secondary);">Pan pitch range</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Ctrl+Wheel</td><td style="padding:4px 8px;color:var(--text-secondary);">Show more or fewer keys</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Delete</td><td style="padding:4px 8px;color:var(--text-secondary);">Delete selected note or hit</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid var(--surface-3);margin:var(--space-sm) 0;" />
        <h4 style="margin:var(--space-sm) 0;font-size:var(--font-size-sm);">Canvas Mode</h4>
        <table style="width:100%;font-size:var(--font-size-sm);border-collapse:collapse;">
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Drag clip</td><td style="padding:4px 8px;color:var(--text-secondary);">Move clip on the timeline</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Alt+drag edge</td><td style="padding:4px 8px;color:var(--text-secondary);">Shrink clip</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Ctrl+click</td><td style="padding:4px 8px;color:var(--text-secondary);">Delete clip</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Ctrl+Wheel</td><td style="padding:4px 8px;color:var(--text-secondary);">Zoom timeline in or out</td></tr>
          <tr><td style="padding:4px 8px;color:var(--accent-light);font-weight:var(--font-weight-semibold);">Delete</td><td style="padding:4px 8px;color:var(--text-secondary);">Delete selected clip</td></tr>
        </table>
      </div>
    `;
    document.body.appendChild(overlay);
  }
}

// --- Boot ---
const app = new App();
app.init().catch(err => {
  console.error('[App] Failed to initialize:', err);
});

// Expose for debugging
window.__notenotes = app;
