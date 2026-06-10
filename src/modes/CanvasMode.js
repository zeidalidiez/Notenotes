/**
 * CanvasMode — The Macro Arranger.
 * Horizontal timeline with track lanes for arranging snippets.
 * Supports clip placement, drag-to-move, playhead, and track management.
 */

import './canvas.css';
import { TransportState } from '../engine/Transport.js';
import { normalizeMeter, pulseCountForMeter, subBeatsForPulse } from '../engine/Meter.js';
import { clipVisualDurationBars } from '../engine/ClipTimeScale.js';
import { normalizeTrackPan } from '../engine/StereoWidth.js';
import { showToast } from '../ui/Toast.js';
import { CanvasStageRenderer } from '../stage/CanvasStageRenderer.js';
import { STAGE_CANVAS_TRACK_LIMIT, stageEventsForCanvasTracks, stageTracksForCanvas, stageUnitTicksForMeter } from '../stage/StageModel.js';
import { DEFAULT_BAR_WIDTH } from './canvasShared.js';
import { CanvasRenderMixin } from './canvasRender.js';
import { CanvasClipsMixin } from './canvasClips.js';
import { CanvasTracksMixin } from './canvasTracks.js';
import { CanvasEventsMixin } from './canvasEvents.js';

export class CanvasMode {
  /**
   * @param {Transport} transport
   * @param {object} project - Project data (tracks, snippets)
   * @param {UndoManager} undoManager
   * @param {ProjectStore} store
   */
  constructor(transport, project, undoManager, store) {
    this.transport = transport;
    this.project = project;
    this.undoManager = undoManager;
    this.store = store;
    this.el = null;

    this._zoomLevel = 1;
    this.barWidth = DEFAULT_BAR_WIDTH;
    this.beatWidth = DEFAULT_BAR_WIDTH / this._beatsPerBar();
    this._selectedClip = null;
    this._playheadEl = null;
    this._manualPlayheadVisible = false;
    this._animFrame = null;
    this._tracksContainer = null;
    this._rulerEl = null;
    this._audioPeakLoads = new Set();
    this._tonePicker = null;
    this._stageOverlay = null;
    this._timeToolActive = false;

    /** Called when a track's instrument changes */
    this.onTrackInstrumentChanged = null;
    this.onTrackMixChanged = null;

    window.addEventListener('project-tone-presets-changed', () => this._refreshTonePresetSelect());
  }

  _beatsPerBar() {
    return Math.max(1, pulseCountForMeter(this.transport?.meter || this.transport?.timeSignature));
  }

  _meter() {
    return normalizeMeter(this.transport?.meter || this.project?.meter || this.transport?.timeSignature || this.project?.timeSignature);
  }

  _syncTimelineMetrics() {
    this.barWidth = DEFAULT_BAR_WIDTH * this._zoomLevel;
    this.beatWidth = this.barWidth / this._beatsPerBar();
    const subBeatWidth = this.beatWidth / Math.max(1, subBeatsForPulse(this._meter(), 0) || 1);

    if (this.el) {
      this.el.style.setProperty('--bar-width', `${this.barWidth}px`);
      this.el.style.setProperty('--beat-width', `${this.beatWidth}px`);
      this.el.style.setProperty('--subbeat-width', `${subBeatWidth}px`);
    }
  }

  _barPositionFromPixels(px, snap = 'floor') {
    const groups = this._pulseGroups();
    const total = groups.reduce((sum, value) => sum + value, 0) || this._beatsPerBar();
    const bar = Math.max(0, Math.floor(px / this.barWidth));
    const offset = Math.max(0, px - bar * this.barWidth);
    const boundaries = [0];
    let cursor = 0;
    for (const group of groups) {
      cursor += group;
      boundaries.push((cursor / total) * this.barWidth);
    }
    const boundary = snap === 'round'
      ? boundaries.reduce((best, value) => Math.abs(value - offset) < Math.abs(best - offset) ? value : best, boundaries[0])
      : boundaries.reduce((best, value) => value <= offset ? value : best, boundaries[0]);
    const clampedBoundary = Math.min(this.barWidth, boundary);
    return Math.max(0, bar + (clampedBoundary / this.barWidth));
  }

  _pulseGroups() {
    const meter = this._meter();
    if (meter.type === 'metered' && Array.isArray(meter.grouping) && meter.grouping.length) {
      return meter.grouping;
    }
    return Array.from({ length: this._beatsPerBar() }, () => 1);
  }

  _autoSetLoopFromClips() {
    this._syncCanvasLoopRegion();
  }

  _canvasLoopEnabled() {
    return !!this.project?.settings?.canvasLoopEnabled;
  }

  _latestClipEndBar() {
    if (!this.project?.tracks) return 0;
    let maxEndBar = 0;
    for (const track of this.project.tracks) {
      for (const clip of (track.clips || [])) {
        const endBar = (clip.startBar || 0) + (clip.durationBars || 1);
        if (endBar > maxEndBar) maxEndBar = endBar;
      }
    }
    return maxEndBar;
  }

  _syncCanvasLoopRegion() {
    let enabled = this._canvasLoopEnabled();
    if (enabled && this._latestClipEndBar() <= 0 && this.project?.settings) {
      this.project.settings.canvasLoopEnabled = false;
      enabled = false;
    }
    this.transport.loopEnabled = enabled;
    if (enabled) {
      this.transport.setLoop(0, Math.max(1, this._latestClipEndBar()));
    }
    this._syncLoopButton();
  }

  _setCanvasLoopEnabled(enabled) {
    if (!this.project?.settings) return;
    if (enabled && this._latestClipEndBar() <= 0) {
      showToast('Add a clip before turning on Canvas loop');
      enabled = false;
    }
    this.project.settings.canvasLoopEnabled = !!enabled;
    this._syncCanvasLoopRegion();
    this.store?.scheduleAutoSave(this.project);
    showToast(enabled ? 'Canvas loop on' : 'Canvas loop off');
  }

  _syncLoopButton() {
    const btn = this.el?.querySelector('#canvas-loop-toggle');
    if (!btn) return;
    const enabled = this._canvasLoopEnabled();
    const end = this._latestClipEndBar();
    btn.classList.toggle('is-active', enabled);
    btn.setAttribute('aria-pressed', String(enabled));
    btn.title = enabled
      ? `Looping Canvas from start to bar ${Math.max(1, end).toFixed(end % 1 ? 2 : 0)}`
      : 'Loop Canvas from the start to the latest clip';
  }

  // --- Synesthesia: clips glow their note color as they play ---

  _synesthesiaEnabled() {
    return !!this.project?.settings?.synesthesia;
  }

  _setSynesthesiaEnabled(enabled) {
    if (!this.project) return;
    this.project.settings ||= {};
    this.project.settings.synesthesia = !!enabled;
    this._renderTracks();            // re-render so clips pick up / drop their glow color
    this._syncSynesthesiaButton();
    this.store?.scheduleAutoSave(this.project);
    showToast(enabled ? 'Synesthesia on - clips glow as they play' : 'Synesthesia off');
  }

  _syncSynesthesiaButton() {
    const btn = this.el?.querySelector('#canvas-synesthesia-toggle');
    if (!btn) return;
    const enabled = this._synesthesiaEnabled();
    btn.classList.toggle('is-active', enabled);
    btn.setAttribute('aria-pressed', String(enabled));
  }

  /** Per-frame: glow the clips the playhead is currently inside. */
  _updateSynesthesiaGlow() {
    if (!this.el) return;
    const clips = this.el.querySelectorAll('.canvas-clip[data-glow-color]');
    if (!clips.length) return;
    const playing = this.transport.state !== TransportState.STOPPED;
    if (!this._synesthesiaEnabled() || !playing) {
      clips.forEach(el => el.classList.remove('canvas-clip--glowing'));
      return;
    }
    const barPosition = this.transport.currentTick / this.transport.ticksPerBar;
    clips.forEach(el => {
      const start = parseFloat(el.dataset.startBar);
      const end = parseFloat(el.dataset.endBar);
      el.classList.toggle('canvas-clip--glowing', barPosition >= start && barPosition < end);
    });
  }

  /** Ensure the project has at least 2 default tracks */
  _ensureDefaultTracks() {
    if (!this.project) return;
    if (!this.project.tracks || this.project.tracks.length === 0) {
      this.project.tracks = [
        { id: crypto.randomUUID(), name: 'Melody', type: 'midi', instrumentId: 'chip_lead', clips: [], muted: false, solo: false, volume: 0.8 },
        { id: crypto.randomUUID(), name: 'Drums', type: 'drum', instrumentId: 'kit', clips: [], muted: false, solo: false, volume: 0.8 },
      ];
    }
    this.project.tracks.forEach(track => this._normalizeTrackType(track));
  }

  _normalizeTrackType(track) {
    const clips = track.clips || [];
    if (clips.some(c => c.snippet?.type === 'audio')) track.type = 'audio';
    else if (this._isDrumInstrumentId(track.instrumentId) && !clips.some(c => c.snippet?.type === 'midi')) track.type = 'drum';
    else if (!track.type) {
      if (clips.some(c => c.snippet?.type === 'drum')) track.type = 'drum';
      else track.type = 'midi';
    }
    if (track.type === 'drum' && !this._isDrumInstrumentId(track.instrumentId)) track.instrumentId = 'classic';
    if (track.type === 'audio') track.instrumentId = 'audio';
    if (track.type === 'midi' && (!track.instrumentId || this._isDrumInstrumentId(track.instrumentId) || track.instrumentId === 'audio')) {
      track.instrumentId = 'chip_lead';
    }
    track.pan = normalizeTrackPan(track.pan);
    if (!Array.isArray(track.clips)) track.clips = [];
    return track;
  }

  /** Render the time ruler (bar numbers) */
  /** Render all track lanes */
  /** Render clips within a track's content area */
  /** Create a clip DOM element */
  /** Render mini SVG preview for a clip */
  /** Set up drop zone for drag-and-drop from snippet dock */
  /** Handle clip selection */
  /** Handle clip drag-to-move */
  /** Render the snippet dock at the bottom */
  /** Add a new track */
  _addTrack(type = 'midi') {
    if (!this.project) return;
    const trackNum = this.project.tracks.length + 1;
    const typeLabel = this._trackTypeLabel(type);
    const track = {
      id: crypto.randomUUID(),
      name: `${typeLabel} ${trackNum}`,
      type,
      instrumentId: type === 'drum' ? 'classic' : type === 'audio' ? 'audio' : 'chip_lead',
      clips: [],
      muted: false,
      solo: false,
      volume: 0.8,
    };
    this.project.tracks.push(track);
    this.store?.scheduleAutoSave(this.project);
    this._renderTracks();
    showToast(`Added ${typeLabel} track`);
  }

  /** Remove a track by ID */
  _removeTrack(trackId) {
    if (!this.project) return;
    if (this.project.tracks.length <= 1) {
      showToast('Must have at least one track');
      return;
    }

    const idx = this.project.tracks.findIndex(t => t.id === trackId);
    if (idx === -1) return;

    const track = this.project.tracks[idx];
    const clipCount = track.clips?.length || 0;
    const message = clipCount
      ? `Delete "${track.name}" and its ${clipCount} clip${clipCount === 1 ? '' : 's'}?`
      : `Delete "${track.name}"?`;
    if (!window.confirm(message)) return;

    const removed = this.project.tracks.splice(idx, 1)[0];
    this.store?.scheduleAutoSave(this.project);
    this.undoManager?.push({
      type: 'removeTrack',
      description: `Remove track "${removed.name}"`,
      undo: () => { this.project.tracks.splice(idx, 0, removed); this._renderTracks(); },
      redo: () => { this.project.tracks = this.project.tracks.filter(t => t.id !== trackId); this._renderTracks(); },
    });
    this._renderTracks();
    showToast(`Removed "${removed.name}"`);
  }

  /** Delete the currently selected clip */
  /** Animate the playhead position */
  _startPlayheadAnimation() {
    const animate = () => {
      this._animFrame = requestAnimationFrame(animate);
      this._updatePlayheadPosition();
      this._updateSynesthesiaGlow();
    };
    animate();
  }

  _updatePlayheadPosition(force = false) {
    if (!this._playheadEl) return;

    if (this.transport.state === TransportState.STOPPED && !force && !this._manualPlayheadVisible) {
      this._playheadEl.style.display = 'none';
      return;
    }

    this._playheadEl.style.display = 'block';
    const tick = this.transport.currentTick;
    const ticksPerBar = this.transport.ticksPerBar;
    const barPosition = tick / ticksPerBar;
    const x = 140 + barPosition * this.barWidth; // 140px offset for track headers
    this._playheadEl.style.left = `${x}px`;
  }

  /** Refresh the view (call after project changes) */
  refresh() {
    this._syncTimelineMetrics();
    this._renderRuler();
    this._renderTracks();
    this._renderSnippetDock();
    this._autoSetLoopFromClips();
  }

  _trimEmptySpace() {
    if (!this.project?.snippets) return;
    let changed = false;
    const ticksPerBeat = this.transport.ticksPerBeat;

    for (const snippet of this.project.snippets) {
      const notes = snippet.notes || [];
      const hits = snippet.hits || [];
      if (notes.length === 0 && hits.length === 0) continue;

      let minTick = Infinity;
      let maxTick = 0;

      for (const n of notes) {
        if (n.startTick < minTick) minTick = n.startTick;
        const end = n.startTick + n.durationTick;
        if (end > maxTick) maxTick = end;
      }
      for (const h of hits) {
        if (h.startTick < minTick) minTick = h.startTick;
        if (h.startTick > maxTick) maxTick = h.startTick;
      }

      if (minTick === Infinity) continue;

      const contentTicks = Math.ceil((maxTick - minTick + ticksPerBeat) / ticksPerBeat) * ticksPerBeat;

      if (minTick > 0) {
        for (const n of notes) n.startTick -= minTick;
        for (const h of hits) h.startTick -= minTick;
        changed = true;
      }
      if (contentTicks !== snippet.durationTicks) {
        snippet.durationTicks = contentTicks;
        changed = true;
      }
    }

    if (changed) {
      for (const track of (this.project.tracks || [])) {
        for (const clip of (track.clips || [])) {
          if (clip.snippet) {
            clip.durationBars = clipVisualDurationBars(clip, this.transport.ticksPerBar);
          }
        }
      }
      this.store?.scheduleAutoSave(this.project);
      this.refresh();
      this._autoSetLoopFromClips();
      showToast('Trimmed empty space');
    } else {
      showToast('Nothing to trim');
    }
  }

  /** Set the zoom level for the canvas timeline */
  _setZoom(level) {
    this._zoomLevel = Math.max(0.125, Math.min(8, level));
    this._syncTimelineMetrics();
    
    if (this.el) {
      const scrollRatio = this._tracksContainer.scrollLeft / this._tracksContainer.scrollWidth || 0;
      
      this._renderRuler();
      this._renderTracks();
      
      if (this._tracksContainer.scrollWidth > 0) {
         this._tracksContainer.scrollLeft = scrollRatio * this._tracksContainer.scrollWidth;
      }
    }
  }

  zoomBy(factor) {
    this._setZoom(this._zoomLevel * factor);
    showToast(`Canvas zoom ${Math.round(this._zoomLevel * 100)}%`);
  }

  _canvasStageTracks() {
    return stageTracksForCanvas(this.project?.tracks || []);
  }

  _toggleStageOverlay() {
    if (this._stageOverlay) {
      this._stageOverlay.close();
      return;
    }
    this._stageOverlay = new CanvasStageRenderer({
      title: 'Canvas Stage',
      subtitle: "A bird's-eye performance view of audible canvas tracks.",
      mode: 'canvas',
      maxLanes: STAGE_CANVAS_TRACK_LIMIT,
      getLaneCount: () => this._canvasStageTracks().length || 1,
      getLaneLabel: (index) => this._canvasStageTracks()[index]?.name || `Track ${index + 1}`,
      getNowTick: () => this.transport?.currentTick || 0,
      getUnitTicks: () => stageUnitTicksForMeter(this.transport),
      getUnitSeconds: () => stageUnitTicksForMeter(this.transport) * (this.transport?.secondsPerTick || 0),
      getEvents: () => stageEventsForCanvasTracks(this.project?.tracks || [], {
        maxTracks: STAGE_CANVAS_TRACK_LIMIT,
        ticksPerBar: this.transport?.ticksPerBar || 1920,
        unitTicks: stageUnitTicksForMeter(this.transport),
      }),
      onClose: () => {
        this._stageOverlay = null;
        this._syncStageButton();
      },
    });
    this._stageOverlay.open();
    this._syncStageButton();
  }

  _syncStageButton() {
    const btn = this.el?.querySelector('#canvas-stage-button');
    if (!btn) return;
    btn.classList.toggle('is-active', !!this._stageOverlay);
    btn.setAttribute('aria-pressed', String(!!this._stageOverlay));
  }

  destroy() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    if (this._documentKeydownHandler) {
      document.removeEventListener('keydown', this._documentKeydownHandler);
      this._documentKeydownHandler = null;
    }
    this._stageOverlay?.close({ silent: true });
    this._stageOverlay = null;
  }
}

Object.assign(
  CanvasMode.prototype,
  CanvasRenderMixin,
  CanvasClipsMixin,
  CanvasTracksMixin,
  CanvasEventsMixin,
);
