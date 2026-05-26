/**
 * CanvasMode — The Macro Arranger.
 * Horizontal timeline with track lanes for arranging snippets.
 * Supports clip placement, drag-to-move, playhead, and track management.
 */

import './canvas.css';
import { TransportState } from '../engine/Transport.js';
import { TRACK_INSTRUMENTS } from '../engine/PlaybackEngine.js';
import { DRUM_KITS } from '../instruments/SketchKit.js';
import { PRESETS, normalizeSoundTraits } from '../instruments/WebAudioSynth.js';
import { normalizeMeter, pulseCountForMeter, subBeatsForPulse } from '../engine/Meter.js';
import { showToast } from '../ui/Toast.js';
import { ChoicePicker } from '../ui/ChoicePicker.js';

/** Pixels per bar at default zoom */
const DEFAULT_BAR_WIDTH = 120;
const LANE_COLORS = ['#6a8caf', '#8a6aaf', '#af8a6a', '#6aaf8a', '#af6a8a', '#8aaf6a'];

function hexToRgba(hex, alpha = 0.35) {
  const clean = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#6a8caf';
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

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

    /** Called when a track's instrument changes */
    this.onTrackInstrumentChanged = null;

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

  render() {
    this.el = document.createElement('div');
    this.el.className = 'canvas-mode';
    this._syncTimelineMetrics();

    // Set CSS custom properties for grid
    this.el.style.setProperty('--bar-width', `${this.barWidth}px`);
    this.el.style.setProperty('--beat-width', `${this.beatWidth}px`);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'canvas-toolbar';
    toolbar.innerHTML = `
      <div class="canvas-toolbar__group">
        <button class="btn btn--ghost canvas-toolbar__btn" data-add-track-type="midi">+ MIDI Track</button>
        <button class="btn btn--ghost canvas-toolbar__btn" data-add-track-type="drum">+ Drum Track</button>
        <button class="btn btn--ghost canvas-toolbar__btn" data-add-track-type="audio">+ Audio Track</button>
        <div class="canvas-toolbar__divider"></div>
        <button class="btn btn--ghost canvas-toolbar__btn canvas-toolbar__btn--icon" id="canvas-zoom-out-btn" title="Zoom Out (1/2x)" aria-label="Zoom out">-</button>
        <button class="btn btn--ghost canvas-toolbar__btn canvas-toolbar__btn--icon" id="canvas-zoom-in-btn" title="Zoom In (2x)" aria-label="Zoom in">+</button>
        <div class="canvas-toolbar__divider"></div>
        <button class="btn btn--ghost canvas-toolbar__btn" id="canvas-trim-btn" title="Trim empty space from all snippets">Trim</button>
        <button class="btn btn--ghost canvas-loop-toggle" id="canvas-loop-toggle" type="button" aria-pressed="${this._canvasLoopEnabled() ? 'true' : 'false'}" title="Loop Canvas from the start to the latest clip">Loop</button>
        <div class="canvas-toolbar__divider"></div>
        <button class="choice-picker-button canvas-toolbar__select" id="canvas-tone-preset" type="button" aria-label="Tone preset for selected clip" aria-haspopup="dialog" disabled data-selected-tone-preset="">
          <span class="choice-picker-button__label" id="canvas-tone-preset-label">Tone preset...</span>
          <span class="choice-picker-button__chevron" aria-hidden="true">▼</span>
        </button>
        <button class="btn btn--ghost canvas-toolbar__btn" id="canvas-tone-apply" title="Select a MIDI or drum clip first" disabled>Apply to Clip</button>
      </div>
    `;
    this.el.appendChild(toolbar);

    // Timeline container
    const timeline = document.createElement('div');
    timeline.className = 'canvas-timeline';

    // Ruler
    this._rulerEl = document.createElement('div');
    this._rulerEl.className = 'canvas-ruler';
    this._rulerEl.id = 'canvas-ruler';
    timeline.appendChild(this._rulerEl);

    // Tracks area (scrollable)
    this._tracksContainer = document.createElement('div');
    this._tracksContainer.className = 'canvas-tracks';
    this._tracksContainer.id = 'canvas-tracks';

    const inner = document.createElement('div');
    inner.className = 'canvas-tracks__inner';
    inner.id = 'canvas-tracks-inner';

    // Playhead
    this._playheadEl = document.createElement('div');
    this._playheadEl.className = 'canvas-playhead';
    this._playheadEl.id = 'canvas-playhead';
    this._playheadEl.style.left = '140px'; // offset for track headers
    inner.appendChild(this._playheadEl);

    this._tracksContainer.appendChild(inner);
    timeline.appendChild(this._tracksContainer);
    this.el.appendChild(timeline);

    // Snippet dock (shows available snippets for dragging onto tracks)
    const dock = document.createElement('div');
    dock.className = 'canvas-snippet-dock';
    dock.id = 'canvas-snippet-dock';
    this.el.appendChild(dock);

    // Initialize
    this._ensureDefaultTracks();
    this._renderRuler();
    this._renderTracks();
    this._renderSnippetDock();
    this._bindEvents();
    this._startPlayheadAnimation();
    this._syncCanvasLoopRegion();

    return this.el;
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
    if (!Array.isArray(track.clips)) track.clips = [];
    return track;
  }

  _customPatchInstruments() {
    return (this.project?.settings?.customInstruments || []).filter(instrument => instrument.type === 'patch');
  }

  _customKitInstruments() {
    return (this.project?.settings?.customInstruments || []).filter(instrument => instrument.type === 'kit');
  }

  _isDrumInstrumentId(instrumentId) {
    return instrumentId === 'kit'
      || !!DRUM_KITS[instrumentId]
      || this._customKitInstruments().some(instrument => `custom:${instrument.id}` === instrumentId);
  }

  _midiInstrumentGroups() {
    const builtIns = Object.values(TRACK_INSTRUMENTS).filter(inst => inst.type === 'synth');
    const itemForBuiltIn = inst => {
      const patch = PRESETS[inst.preset] || PRESETS[inst.id] || {};
      return {
        value: inst.id,
        label: inst.name,
        kicker: (patch.family || 'chip') === 'modern' ? 'Modern synth track' : 'Chip synth track',
        description: this._instrumentDescription(patch),
        tags: [patch.family, patch.oscillator?.type, patch.filter?.type, inst.name].filter(Boolean),
      };
    };
    const chip = builtIns.filter(inst => (PRESETS[inst.preset]?.family || 'chip') === 'chip').map(itemForBuiltIn);
    const modern = builtIns.filter(inst => PRESETS[inst.preset]?.family === 'modern').map(itemForBuiltIn);
    const groups = [
      { id: 'chip', label: 'Chip presets', items: chip },
      { id: 'modern', label: 'Modern presets', items: modern },
    ];
    const custom = this._customPatchInstruments().map(instrument => ({
      value: `custom:${instrument.id}`,
      label: instrument.name || 'Untitled instrument',
      kicker: 'Custom sample patch',
      description: instrument.playbackMode === 'oneShot' ? 'One-shot sample instrument' : 'Gated sample instrument',
      tags: ['custom', 'sample', instrument.name],
    }));
    if (custom.length) groups.push({ id: 'custom', label: 'Custom instruments', items: custom });
    return groups;
  }

  _drumInstrumentGroups() {
    const builtIns = Object.entries(DRUM_KITS).map(([id, kit]) => ({
      value: id,
      label: kit.name,
      kicker: 'Drum kit',
      description: `${Object.keys(kit.sounds || {}).length} synthesized sounds`,
      tags: ['drum', 'kit', kit.name],
    }));
    const groups = [{ id: 'drum', label: 'Drum kits', items: builtIns }];
    const custom = this._customKitInstruments().map(instrument => ({
      value: `custom:${instrument.id}`,
      label: instrument.name || 'Untitled kit',
      kicker: 'Custom kit',
      description: 'Custom drum instrument',
      tags: ['custom', 'kit', instrument.name],
    }));
    if (custom.length) groups.push({ id: 'custom', label: 'Custom instruments', items: custom });
    return groups;
  }

  _instrumentDescription(patch = {}) {
    const bits = [];
    if (patch.oscillator?.type) bits.push(patch.oscillator.type);
    if (patch.unison?.voices) bits.push(`${patch.unison.voices}-voice unison`);
    if (patch.filterEnv) bits.push('filter motion');
    if (patch.vibrato) bits.push('vibrato');
    if (patch.drive) bits.push('drive');
    return bits.join(' - ') || 'Synth patch';
  }

  _trackInstrumentGroups(track) {
    if (track?.type === 'drum') return this._drumInstrumentGroups();
    return this._midiInstrumentGroups();
  }

  _instrumentName(instrumentId) {
    if (instrumentId?.startsWith?.('custom:')) {
      const id = instrumentId.slice(7);
      return this._customPatchInstruments().find(instrument => instrument.id === id)?.name
        || this._customKitInstruments().find(instrument => instrument.id === id)?.name
        || 'Custom instrument';
    }
    if (instrumentId === 'kit') return DRUM_KITS.classic.name;
    if (DRUM_KITS[instrumentId]) return DRUM_KITS[instrumentId].name;
    return TRACK_INSTRUMENTS[instrumentId]?.name || instrumentId;
  }

  _trackColor(track, idx = 0) {
    return /^#[0-9a-f]{6}$/i.test(track?.color || '') ? track.color : LANE_COLORS[idx % LANE_COLORS.length];
  }

  /** Render the time ruler (bar numbers) */
  _renderRuler() {
    if (!this._rulerEl) return;
    const totalBars = Math.min(this.transport.maxBars, 80);
    const meter = this._meter();
    const groups = this._pulseGroups();
    const totalSubBeats = groups.reduce((sum, value) => sum + value, 0) || groups.length;
    let html = '';
    html += `<div class="canvas-ruler__bar" style="width:140px;flex-shrink:0;border-right:1px solid var(--surface-4);"></div>`;
    for (let bar = 0; bar < totalBars; bar += 1) {
      let cursor = 0;
      for (let pulse = 0; pulse < groups.length; pulse += 1) {
        const label = pulse === 0 ? `${bar + 1}` : `${bar + 1}.${pulse + 1}`;
        const width = (groups[pulse] / totalSubBeats) * this.barWidth;
        const seek = bar + (cursor / totalSubBeats);
        const isBar = pulse === 0;
        const title = groups[pulse] > 1
          ? `Move playhead to ${label} (${groups[pulse]} sub-beats)`
          : `Move playhead to ${label}`;
        html += `<div class="canvas-ruler__beat" data-seek-bar="${seek.toFixed(6)}" title="${title}" style="width:${width}px;${isBar ? 'font-weight:var(--font-weight-semibold);color:var(--accent-light);' : ''}">${label}</div>`;
        cursor += groups[pulse];
      }
    }
    this._rulerEl.innerHTML = html;
  }

  _renderMeterGrid(totalBars) {
    const groups = this._pulseGroups();
    const totalSubBeats = groups.reduce((sum, value) => sum + value, 0) || groups.length;
    let html = '<div class="canvas-lane__meter-grid" aria-hidden="true">';
    for (let bar = 0; bar < totalBars; bar += 1) {
      const barX = bar * this.barWidth;
      html += `<span class="canvas-lane__meter-line canvas-lane__meter-line--bar" style="left:${barX}px"></span>`;
      let cursor = 0;
      for (const group of groups) {
        const pulseX = barX + (cursor / totalSubBeats) * this.barWidth;
        if (cursor > 0) {
          html += `<span class="canvas-lane__meter-line canvas-lane__meter-line--pulse" style="left:${pulseX}px"></span>`;
        }
        for (let sub = 1; sub < group; sub += 1) {
          const subX = barX + ((cursor + sub) / totalSubBeats) * this.barWidth;
          html += `<span class="canvas-lane__meter-line canvas-lane__meter-line--subbeat" style="left:${subX}px"></span>`;
        }
        cursor += group;
      }
    }
    html += '</div>';
    return html;
  }

  /** Render all track lanes */
  _renderTracks() {
    if (!this.project || !this._tracksContainer) return;
    const inner = this._tracksContainer.querySelector('#canvas-tracks-inner');
    // Remove existing lanes (keep playhead)
    inner.querySelectorAll('.canvas-lane, .canvas-add-track').forEach(el => el.remove());

    const totalBars = Math.min(this.transport.maxBars, 80);
    const contentWidth = totalBars * this.barWidth;

    this.project.tracks.forEach((track, idx) => {
      const lane = document.createElement('div');
      lane.className = 'canvas-lane';
      lane.dataset.trackId = track.id;

      // Header
      const header = document.createElement('div');
      header.className = 'canvas-lane__header';
      const trackColor = this._trackColor(track, idx);
      const color = hexToRgba(trackColor, 0.35);
      header.style.borderLeft = `3px solid ${hexToRgba(trackColor, 0.8)}`;

      this._normalizeTrackType(track);
      const trackTypeLabel = this._trackTypeLabel(track.type);
      const instSelect = track.type === 'drum' || track.type === 'midi'
        ? `<button class="canvas-lane__instrument" data-track-inst="${track.id}" type="button" aria-label="Track instrument" title="${this._instrumentName(track.instrumentId)}">${this._instrumentName(track.instrumentId)}</button>`
        : track.type !== 'midi'
        ? `<span class="canvas-lane__inst-label">LINE Audio</span>`
        : '';

      header.innerHTML = `
        <div class="canvas-lane__name-row">
          <span class="canvas-lane__name" data-track-id="${track.id}" title="Double-click to rename">${track.name}</span>
          <span class="canvas-lane__type">${trackTypeLabel}</span>
          <input class="canvas-lane__color" type="color" value="${trackColor}" data-track-color="${track.id}" title="Track color" aria-label="Track color" />
          <button class="canvas-lane__remove-btn" data-remove-track="${track.id}" title="Remove track" aria-label="Remove track">✕</button>
        </div>
        ${instSelect}
        <div class="canvas-lane__controls">
          <button class="canvas-lane__ctrl-btn ${track.muted ? 'is-muted' : ''}" data-action="mute" data-track="${track.id}">M</button>
          <button class="canvas-lane__ctrl-btn ${track.solo ? 'is-solo' : ''}" data-action="solo" data-track="${track.id}">S</button>
        </div>
      `;
      lane.appendChild(header);

      // Content area (clips go here)
      const content = document.createElement('div');
      content.className = 'canvas-lane__content';
      content.dataset.trackId = track.id;
      content.style.width = `${contentWidth}px`;
      content.innerHTML = this._renderMeterGrid(totalBars);

      // Render clips
      this._renderClipsForTrack(content, track, color);

      // Drop zone for snippets
      this._setupDropZone(content, track);

      lane.appendChild(content);
      inner.appendChild(lane);
    });

    // Add typed track row
    const addRow = document.createElement('div');
    addRow.className = 'canvas-add-track';
    addRow.id = 'canvas-add-track';
    addRow.innerHTML = `
      <button class="canvas-add-track__btn" data-add-track-type="midi">+ Add MIDI</button>
      <button class="canvas-add-track__btn" data-add-track-type="drum">+ Add Drum</button>
      <button class="canvas-add-track__btn" data-add-track-type="audio">+ Add Audio</button>
    `;
    inner.appendChild(addRow);
    this._syncCanvasLoopRegion();
    this._syncClipTools();
  }

  /** Render clips within a track's content area */
  _renderClipsForTrack(contentEl, track, color) {
    if (!track.clips) return;
    track.clips.forEach(clip => {
      const clipEl = this._createClipElement(clip, color);
      contentEl.appendChild(clipEl);
    });
  }

  /** Create a clip DOM element */
  _createClipElement(clip, color) {
    const x = (clip.startBar || 0) * this.barWidth;
    const w = (clip.durationBars || 1) * this.barWidth;

    const el = document.createElement('div');
    el.className = 'canvas-clip';
    el.dataset.clipId = clip.id;
    if (clip.id === this._selectedClip) el.classList.add('is-selected');
    el.style.left = `${x}px`;
    el.style.width = `${w}px`;
    el.style.background = color;

    const noteCount = (clip.snippet?.notes?.length || 0) + (clip.snippet?.hits?.length || 0);
    const snippetName = clip.snippet?.name || `${noteCount} notes`;
    const typeBadge = clip.snippet?.type === 'audio' ? 'LINE' : clip.snippet?.type === 'drum' ? 'DRUM' : 'MIDI';
    el.innerHTML = `
      <div class="canvas-clip__label-row">
        <span class="canvas-clip__type-badge canvas-clip__type-badge--${clip.snippet?.type || 'midi'}">${typeBadge}</span>
        <span class="canvas-clip__label">${snippetName}</span>
        ${this._renderToneBadges(clip)}
      </div>
      <div class="canvas-clip__preview">${this._renderClipPreview(clip, w)}</div>
      ${this._renderModOverlay(clip, w)}
    `;

    // Click to select
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this._selectClip(clip.id, el);

      if (e.ctrlKey || e.metaKey) {
        this._deleteSelectedClip();
        return;
      }

      if (e.altKey) {
        this._startClipResize(e, clip, el);
      } else {
        this._startClipDrag(e, clip, el);
      }
    });

    return el;
  }

  /** Render mini SVG preview for a clip */
  _renderClipPreview(clip, width) {
    const height = 40;
    const snippet = clip.snippet;
    if (!snippet) return '';

    const notes = snippet.notes || [];
    const hits = snippet.hits || [];
    if (snippet.type === 'audio') return this._renderAudioClipPreview(snippet, width, height);
    if (notes.length === 0 && hits.length === 0) return '';

    let svgContent = '';
    const duration = snippet.durationTicks || 1;

    if (notes.length > 0) {
      const pitches = notes.map(n => n.pitch);
      const minP = Math.min(...pitches), maxP = Math.max(...pitches);
      const range = Math.max(1, maxP - minP);
      notes.forEach(n => {
        const nx = (n.startTick / duration) * width;
        const nw = Math.max(2, (n.durationTick / duration) * width);
        const ny = height - ((n.pitch - minP) / range) * (height - 4) - 2;
        svgContent += `<rect x="${nx}" y="${ny}" width="${nw}" height="3" rx="1" fill="rgba(255,255,255,0.6)"/>`;
      });
    }

    if (hits.length > 0) {
      hits.forEach(h => {
        const hx = (h.startTick / duration) * width;
        const hy = h.type === 'kick' ? height - 6 : h.type === 'snare' || h.type === 'clap' ? height / 2 : 4;
        svgContent += `<circle cx="${hx}" cy="${hy}" r="2" fill="rgba(255,255,255,0.5)"/>`;
      });
    }

    return `<svg width="${width - 4}" height="${height}" style="display:block;">${svgContent}</svg>`;
  }

  _renderAudioClipPreview(snippet, width, height) {
    const svgWidth = Math.max(24, width - 4);
    const center = height / 2;
    const hasAudio = !!(snippet.audioAssetId || snippet.audioUrl || snippet.audioDataUrl);
    const peaks = Array.isArray(snippet.audioPeaks) ? snippet.audioPeaks : [];
    let svgContent = `<line x1="0" y1="${center}" x2="${svgWidth}" y2="${center}" stroke="rgba(255,255,255,0.24)" stroke-width="1"/>`;

    if (!hasAudio) {
      svgContent += `<rect x="1" y="${center - 6}" width="${Math.max(2, svgWidth - 2)}" height="12" rx="6" fill="none" stroke="rgba(255,255,255,0.34)" stroke-width="1" stroke-dasharray="4 4"/>`;
      return `<svg width="${svgWidth}" height="${height}" class="canvas-clip__audio-preview" style="display:block;">${svgContent}</svg>`;
    }

    if (!peaks.length) {
      this._ensureAudioPeaks(snippet);
      svgContent += `<rect x="1" y="${center - 6}" width="${Math.max(2, svgWidth - 2)}" height="12" rx="6" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.20)" stroke-width="1"/>`;
      svgContent += `<text x="${svgWidth / 2}" y="${center + 4}" text-anchor="middle" font-size="8" fill="rgba(255,255,255,0.36)">analyzing</text>`;
      return `<svg width="${svgWidth}" height="${height}" class="canvas-clip__audio-preview" style="display:block;">${svgContent}</svg>`;
    }

    svgContent += `<rect x="1" y="${center - 13}" width="${Math.max(2, svgWidth - 2)}" height="26" rx="5" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>`;
    const barGap = 1.5;
    const barWidth = Math.max(1.5, (svgWidth - 8) / peaks.length - barGap);
    peaks.forEach((peak, i) => {
      const amount = Math.max(0, Math.min(1, peak || 0));
      const markerHeight = Math.max(1, amount * (height - 12));
      const x = 4 + i * (barWidth + barGap);
      const y = center - markerHeight / 2;
      const alpha = 0.28 + amount * 0.55;
      svgContent += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${markerHeight.toFixed(1)}" rx="1" fill="rgba(255,255,255,${alpha.toFixed(2)})"/>`;
    });

    return `<svg width="${svgWidth}" height="${height}" class="canvas-clip__audio-preview" style="display:block;">${svgContent}</svg>`;
  }

  _ensureAudioPeaks(snippet) {
    if (!snippet?.id || snippet.audioPeaks?.length || !this.store?.audioSnippetToArrayBuffer) return;
    if (this._audioPeakLoads.has(snippet.id)) return;
    this._audioPeakLoads.add(snippet.id);
    this.store.audioSnippetToArrayBuffer(snippet)
      .then(arrayBuffer => this._audioPeaksFromArrayBuffer(arrayBuffer))
      .then(peaks => {
        if (peaks?.length) {
          snippet.audioPeaks = peaks;
          this.store?.scheduleAutoSave(this.project);
          this._renderTracks();
        }
      })
      .catch(err => console.warn('[CanvasMode] Audio peak analysis failed:', err))
      .finally(() => this._audioPeakLoads.delete(snippet.id));
  }

  async _audioPeaksFromArrayBuffer(arrayBuffer, bins = 48) {
    if (!arrayBuffer) return [];
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return [];
    const ctx = new AudioCtx();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const length = decoded.length || 0;
      if (!length) return [];
      const channels = Math.max(1, decoded.numberOfChannels || 1);
      const blockSize = Math.max(1, Math.floor(length / bins));
      const peaks = [];
      for (let i = 0; i < bins; i++) {
        const start = i * blockSize;
        const end = i === bins - 1 ? length : Math.min(length, start + blockSize);
        let sum = 0;
        let count = 0;
        for (let ch = 0; ch < channels; ch++) {
          const data = decoded.getChannelData(ch);
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
    } finally {
      await ctx.close?.();
    }
  }

  _renderToneBadges(clip) {
    const labels = {
      crush: 'CR',
      echo: 'EC',
      space: 'SP',
      wobble: 'WB',
      drive: 'DR',
      noise: 'NO',
    };
    const sources = [
      clip.soundTraits || clip.snippet?.soundTraits || {},
      ...(clip.snippet?.notes || []).map(note => note.soundTraits || {}),
      ...(clip.snippet?.hits || []).map(hit => hit.soundTraits || {}),
    ];
    const active = Object.entries(labels)
      .filter(([id]) => sources.some(traits => traits[id]?.enabled !== false && (traits[id]?.amount || 0) > 0))
      .slice(0, 3);
    if (active.length === 0) return '';
    return `<span class="canvas-clip__tone-badges">${active.map(([id, label]) => `<span title="${id}">${label}</span>`).join('')}</span>`;
  }

  _tonePresets() {
    return Array.isArray(this.project?.settings?.tonePresets) ? this.project.settings.tonePresets : [];
  }

  _refreshTonePresetSelect() {
    const picker = this.el?.querySelector('#canvas-tone-preset');
    if (!picker) return;
    const selectedId = picker.dataset.selectedTonePreset || '';
    const preset = this._tonePresets().find(p => p.id === selectedId) || null;
    this._setSelectedTonePreset(preset);
    this._syncClipTools();
  }

  _tonePresetSummary(traits = {}) {
    const normalized = normalizeSoundTraits(traits);
    const labels = {
      crush: 'Crush',
      echo: 'Echo',
      space: 'Space',
      wobble: 'Wobble',
      drive: 'Drive',
      noise: 'Noise',
    };
    const active = Object.entries(labels)
      .filter(([id]) => (normalized[id]?.amount || 0) > 0.03)
      .map(([id, label]) => `${label} ${Math.round((normalized[id]?.amount || 0) * 100)}%`);
    return active.length ? active.join(' - ') : 'No Tone';
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

  _setSelectedTonePreset(preset) {
    const picker = this.el?.querySelector('#canvas-tone-preset');
    const label = this.el?.querySelector('#canvas-tone-preset-label');
    if (picker) picker.dataset.selectedTonePreset = preset?.id || '';
    if (label) label.textContent = preset?.name || 'Tone preset...';
  }

  _openTrackInstrumentPicker(anchor) {
    const trackId = anchor?.dataset.trackInst;
    const track = this.project?.tracks.find(t => t.id === trackId);
    if (!track || track.type === 'audio') return;
    const picker = new ChoicePicker({
      title: track.type === 'drum' ? 'Choose Drum Kit' : 'Choose Track Instrument',
      groups: this._trackInstrumentGroups(track),
      selectedValue: track.instrumentId === 'kit' ? 'classic' : track.instrumentId,
      searchPlaceholder: 'Search instruments...',
      onSelect: (value) => this._setTrackInstrument(trackId, value),
    });
    picker.open(anchor);
  }

  _setTrackInstrument(trackId, instrumentId) {
    const track = this.project?.tracks.find(t => t.id === trackId);
    if (!track) return;
    track.instrumentId = instrumentId;
    this.store?.scheduleAutoSave(this.project);

    if (this.onTrackInstrumentChanged) {
      this.onTrackInstrumentChanged(trackId);
    }

    const instName = this._instrumentName(instrumentId);
    this._renderTracks();
    showToast(`${track.name}: ${instName}`);
  }

  _openTonePresetPicker(anchor) {
    if (anchor?.disabled) return;
    this._tonePicker?.close();
    this._tonePicker = new ChoicePicker({
      title: 'Choose Tone Preset',
      groups: this._tonePresetGroups(),
      selectedValue: anchor?.dataset.selectedTonePreset || '',
      searchPlaceholder: 'Search Tone presets...',
      onSelect: (value) => {
        this._setSelectedTonePreset(this._tonePresets().find(preset => preset.id === value) || null);
      },
    });
    this._tonePicker.open(anchor);
  }

  _findClip(clipId = this._selectedClip) {
    if (!clipId) return null;
    for (const track of this.project?.tracks || []) {
      const clip = (track.clips || []).find(c => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  }

  _applyTonePresetToSelectedClip() {
    const presetId = this.el?.querySelector('#canvas-tone-preset')?.dataset.selectedTonePreset || '';
    const preset = this._tonePresets().find(p => p.id === presetId);
    if (!preset) return showToast('Choose a Tone preset first');
    const clip = this._findClip();
    if (!clip) return showToast('Select a clip first');
    if (clip.snippet?.type === 'audio') return showToast('Tone presets work on MIDI and drum clips');
    clip.soundTraits = normalizeSoundTraits(preset.soundTraits);
    this.store?.scheduleAutoSave(this.project);
    this._renderTracks();
    showToast(`Tone preset applied: ${preset.name}`);
  }

  _syncClipTools() {
    const select = this.el?.querySelector('#canvas-tone-preset');
    const applyBtn = this.el?.querySelector('#canvas-tone-apply');
    if (!select || !applyBtn) return;
    const clip = this._findClip();
    const canApplyTone = !!clip && clip.snippet?.type !== 'audio';
    select.disabled = !canApplyTone;
    applyBtn.disabled = !canApplyTone;
    const title = !clip
      ? 'Select a MIDI or drum clip first'
      : clip.snippet?.type === 'audio'
        ? 'Tone presets work on MIDI and drum clips'
        : 'Apply Tone preset to selected clip';
    select.title = title;
    applyBtn.title = title;
  }

  _renderModOverlay(clip, clipWidth) {
    const mod = clip.snippet?.modulation;
    if (!mod || mod.length < 2) return '';

    const h = 10;
    const duration = clip.snippet.durationTicks || 1;
    let pitchPath = '';
    let modPath = '';

    for (let i = 0; i < mod.length; i++) {
      const x = (mod[i].tick / duration) * clipWidth;
      const py = h - Math.abs(mod[i].pitchBend) * h;
      const my = h - (mod[i].modulation / 2) * h;
      const cmd = i === 0 ? 'M' : 'L';
      pitchPath += `${cmd}${x.toFixed(1)},${py.toFixed(1)} `;
      modPath += `${cmd}${x.toFixed(1)},${my.toFixed(1)} `;
    }

    return `
      <svg class="canvas-clip__mod" width="${clipWidth}" height="${h}" style="position:absolute;bottom:2px;left:0;opacity:0.85;pointer-events:none;">
        <path d="${pitchPath}" fill="none" stroke="#f0a060" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="${modPath}" fill="none" stroke="#f060a0" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`;
  }

  _trackForClip(clip) {
    return this.project?.tracks?.find(track => (track.clips || []).some(c => c.id === clip?.id));
  }

  _clipEndBar(clip, startBar = clip?.startBar, durationBars = clip?.durationBars) {
    return (startBar || 0) + Math.max(1 / this._beatsPerBar(), durationBars || 1);
  }

  _clipOverlapsAt(track, clip, startBar, durationBars = clip?.durationBars || 1) {
    if (!track) return false;
    const epsilon = 0.001;
    const endBar = this._clipEndBar(clip, startBar, durationBars);
    return (track.clips || []).some(other => {
      if (other.id === clip?.id) return false;
      const otherStart = other.startBar || 0;
      const otherEnd = this._clipEndBar(other);
      return startBar < otherEnd - epsilon && endBar > otherStart + epsilon;
    });
  }

  _resolveClipStart(track, clip, desiredStartBar, durationBars = clip?.durationBars || 1) {
    const minStep = 1 / this._beatsPerBar();
    const desired = Math.max(0, Math.round((desiredStartBar || 0) / minStep) * minStep);
    const otherClips = (track?.clips || [])
      .filter(other => other.id !== clip?.id)
      .sort((a, b) => (a.startBar || 0) - (b.startBar || 0));
    const snapDistance = Math.max(minStep, 18 / this.barWidth);
    const candidates = [{ start: desired, snapToGrid: true }];

    for (const other of otherClips) {
      const before = Math.max(0, (other.startBar || 0) - durationBars);
      const after = this._clipEndBar(other);
      if (Math.abs(desired - before) <= snapDistance) candidates.unshift({ start: before, snapToGrid: false });
      if (Math.abs(desired - after) <= snapDistance) candidates.unshift({ start: after, snapToGrid: false });
      candidates.push({ start: before, snapToGrid: false }, { start: after, snapToGrid: false });
    }

    let best = null;
    for (const candidate of candidates) {
      const rawStart = typeof candidate === 'number' ? candidate : candidate.start;
      const shouldSnap = typeof candidate === 'number' ? true : candidate.snapToGrid;
      const start = Math.max(0, shouldSnap ? Math.round(rawStart / minStep) * minStep : rawStart);
      if (this._clipOverlapsAt(track, clip, start, durationBars)) continue;
      const distance = Math.abs(start - desired);
      if (!best || distance < best.distance) best = { start, distance };
    }

    return best ? best.start : null;
  }

  _recordedInstrumentForSnippet(snippet) {
    if (!snippet) return null;
    if (snippet.type === 'midi') {
      const id = snippet.patchRecorded?.instrumentId || snippet.instrumentId || snippet.patchId;
      if (id?.startsWith?.('custom:')) return id;
      if (TRACK_INSTRUMENTS[id]) return id;
    }
    if (snippet.type === 'drum') {
      const id = snippet.kitRecorded?.instrumentId || snippet.instrumentId || snippet.kitId;
      if (id?.startsWith?.('custom:')) return id;
      if (this._isDrumInstrumentId(id)) return id;
    }
    return null;
  }

  _applyRecordedInstrumentToTrack(track, snippet) {
    const instrumentId = this._recordedInstrumentForSnippet(snippet);
    if (!track || !instrumentId) return null;
    if (track.type === 'midi' && snippet.type !== 'midi') return null;
    if (track.type === 'drum' && snippet.type !== 'drum') return null;
    if (track.instrumentId === instrumentId) return null;
    const previousInstrumentId = track.instrumentId;
    track.instrumentId = instrumentId;
    this.onTrackInstrumentChanged?.(track.id);
    return previousInstrumentId;
  }

  _maxDurationForClip(track, clip) {
    const start = clip.startBar || 0;
    const next = (track?.clips || [])
      .filter(other => other.id !== clip.id && (other.startBar || 0) >= start)
      .sort((a, b) => (a.startBar || 0) - (b.startBar || 0))[0];
    return next ? Math.max(1 / this._beatsPerBar(), (next.startBar || 0) - start) : Infinity;
  }

  /** Set up drop zone for drag-and-drop from snippet dock */
  _setupDropZone(contentEl, track) {
    contentEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      contentEl.classList.add('is-drop-target');
    });

    contentEl.addEventListener('dragleave', () => {
      contentEl.classList.remove('is-drop-target');
    });

    contentEl.addEventListener('drop', (e) => {
      e.preventDefault();
      contentEl.classList.remove('is-drop-target');

      const snippetId = e.dataTransfer.getData('text/snippet-id');
      if (!snippetId || !this.project) return;

      const snippet = this.project.snippets.find(s => s.id === snippetId);
      if (!snippet) return;
      if (!this._trackAcceptsSnippet(track, snippet)) {
        showToast(`${this._snippetTypeLabel(snippet)} snippets need a ${this._trackTypeLabel(this._snippetTrackType(snippet))} track`);
        return;
      }

      // Calculate bar position from drop point
      const rect = contentEl.getBoundingClientRect();
      const scrollLeft = contentEl.parentElement?.closest('.canvas-tracks')?.scrollLeft || 0;
      const offsetX = e.clientX - rect.left + scrollLeft;
      const durationBars = snippet.durationTicks / this.transport.ticksPerBar || 1;
      const desiredStartBar = this._barPositionFromPixels(offsetX, 'floor');

      const clip = {
        id: crypto.randomUUID(),
        snippetId: snippet.id,
        snippet: snippet,
        startBar: desiredStartBar,
        durationBars,
      };
      const startBar = this._resolveClipStart(track, clip, desiredStartBar, durationBars);
      if (startBar === null) {
        showToast('No room for that clip on this track');
        return;
      }
      clip.startBar = startBar;

      const previousInstrumentId = this._applyRecordedInstrumentToTrack(track, snippet);

      // Add to track
      track.clips.push(clip);
      this.store?.scheduleAutoSave(this.project);

      // Add to undo stack
      this.undoManager?.push({
        type: 'addClip',
        description: `Add clip to ${track.name}`,
        undo: () => {
          track.clips = track.clips.filter(c => c.id !== clip.id);
          if (previousInstrumentId !== null) {
            track.instrumentId = previousInstrumentId;
            this.onTrackInstrumentChanged?.(track.id);
          }
          this._renderTracks();
        },
        redo: () => {
          this._applyRecordedInstrumentToTrack(track, snippet);
          track.clips.push(clip);
          this._renderTracks();
        }
      });

      this._renderTracks();
      this._autoSetLoopFromClips();
      showToast(`Clip added to ${track.name}`);
    });
  }

  _snippetTrackType(snippet) {
    if (snippet?.type === 'audio') return 'audio';
    if (snippet?.type === 'drum') return 'drum';
    return 'midi';
  }

  _trackAcceptsSnippet(track, snippet) {
    return (track?.type || 'midi') === this._snippetTrackType(snippet);
  }

  _trackTypeLabel(type) {
    return type === 'audio' ? 'Audio' : type === 'drum' ? 'Drum' : 'MIDI';
  }

  _snippetTypeLabel(snippet) {
    return this._trackTypeLabel(this._snippetTrackType(snippet));
  }

  /** Handle clip selection */
  _selectClip(clipId, el) {
    // Deselect previous
    this.el.querySelectorAll('.canvas-clip.is-selected').forEach(c => c.classList.remove('is-selected'));
    el.classList.add('is-selected');
    this._selectedClip = clipId;
    this._syncClipTools();
  }

  _clearClipSelection() {
    this.el?.querySelectorAll('.canvas-clip.is-selected').forEach(c => c.classList.remove('is-selected'));
    this._selectedClip = null;
    this._syncClipTools();
  }

  removeSnippetReferences(snippetId) {
    if (!snippetId || !this.project?.tracks) return;
    let removedSelected = false;
    let changed = false;
    for (const track of this.project.tracks) {
      const before = track.clips?.length || 0;
      track.clips = (track.clips || []).filter(clip => {
        const keep = clip.snippetId !== snippetId && clip.snippet?.id !== snippetId;
        if (!keep && clip.id === this._selectedClip) removedSelected = true;
        return keep;
      });
      if ((track.clips?.length || 0) !== before) changed = true;
    }
    if (!changed) return;
    if (removedSelected) this._selectedClip = null;
    this.store?.scheduleAutoSave(this.project);
    this._renderTracks();
    this._renderSnippetDock();
    this._autoSetLoopFromClips();
    this._syncClipTools();
  }

  /** Handle clip drag-to-move */
  _startClipDrag(e, clip, el) {
    const startX = e.clientX;
    const startLeft = parseInt(el.style.left, 10) || 0;
    const originalBar = clip.startBar;
    const track = this._trackForClip(clip);

    el.classList.add('is-dragging');

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const newLeft = Math.max(0, startLeft + dx);
      const desiredBar = this._barPositionFromPixels(newLeft, 'round');
      const resolvedBar = this._resolveClipStart(track, clip, desiredBar, clip.durationBars);
      el.style.left = `${(resolvedBar ?? desiredBar) * this.barWidth}px`;
    };

    const onUp = () => {
      el.classList.remove('is-dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const desiredBar = this._barPositionFromPixels(parseInt(el.style.left, 10), 'round');
      const newBar = this._resolveClipStart(track, clip, desiredBar, clip.durationBars);
      if (newBar === null) {
        el.style.left = `${originalBar * this.barWidth}px`;
        return;
      }
      if (newBar !== originalBar) {
        clip.startBar = newBar;
        el.style.left = `${newBar * this.barWidth}px`;
        this._autoSetLoopFromClips();
        this.store?.scheduleAutoSave(this.project);

        this.undoManager?.push({
          type: 'moveClip',
          description: 'Move clip',
          undo: () => { clip.startBar = originalBar; this._renderTracks(); },
          redo: () => { clip.startBar = newBar; this._renderTracks(); },
        });
      } else {
        el.style.left = `${originalBar * this.barWidth}px`;
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  _startClipResize(e, clip, el) {
    const startX = e.clientX;
    const startWidth = parseInt(el.style.width, 10) || clip.durationBars * this.barWidth;
    const originalBars = clip.durationBars;
    const track = this._trackForClip(clip);
    const maxBars = this._maxDurationForClip(track, clip);

    el.classList.add('is-dragging');

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const maxWidth = Number.isFinite(maxBars) ? maxBars * this.barWidth : startWidth;
      const newWidth = Math.max(this.beatWidth, Math.min(startWidth, maxWidth, startWidth + dx));
      el.style.width = `${newWidth}px`;
    };

    const onUp = () => {
      el.classList.remove('is-dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const finalWidth = parseInt(el.style.width, 10);
      const newBeats = Math.max(1, Math.round(finalWidth / this.beatWidth));
      const newBars = Math.min(maxBars, newBeats / this._beatsPerBar());
      if (newBars !== originalBars) {
        clip.durationBars = newBars;
        el.style.width = `${newBars * this.barWidth}px`;
        const snip = clip.snippet;
        if (snip) {
          const maxTick = Math.ceil(newBars * this.transport.ticksPerBar);
          if (snip.notes) snip.notes = snip.notes.filter(n => n.startTick < maxTick);
          if (snip.hits) snip.hits = snip.hits.filter(h => h.startTick < maxTick);
          snip.durationTicks = maxTick;
        }
        this.store?.scheduleAutoSave(this.project);
        this._renderTracks();
        this._autoSetLoopFromClips();
      } else {
        el.style.width = `${originalBars * this.barWidth}px`;
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /** Render the snippet dock at the bottom */
  _renderSnippetDock() {
    const dock = this.el.querySelector('#canvas-snippet-dock');
    if (!dock || !this.project) return;

    const snippets = this.project.snippets || [];
    if (snippets.length === 0) {
      dock.innerHTML = `<span class="canvas-snippet-dock__empty">Record snippets in Creative Mode to place them here</span>`;
      return;
    }

    dock.innerHTML = snippets.map(s => {
      const count = (s.notes?.length || 0) + (s.hits?.length || 0);
      const name = s.name || `${count} notes`;
      const icon = s.type === 'drum' ? 'DRUM' : s.type === 'audio' ? 'LINE' : 'MIDI';
      return `<div class="canvas-snippet-dock__item" draggable="true" data-snippet-id="${s.id}">
        <span class="canvas-snippet-dock__type canvas-snippet-dock__type--${s.type || 'midi'}">${icon}</span> ${name}
      </div>`;
    }).join('');

    // Make items draggable
    dock.querySelectorAll('.canvas-snippet-dock__item').forEach(item => {
      // Desktop drag
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/snippet-id', item.dataset.snippetId);
        item.classList.add('is-dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('is-dragging');
      });

      // iOS touch drag
      item.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        this._touchDrag = {
          snippetId: item.dataset.snippetId,
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          el: item,
        };
      }, { passive: true });

      item.addEventListener('touchmove', (e) => {
        if (!this._touchDrag) return;
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - this._touchDrag.startX;
        const dy = t.clientY - this._touchDrag.startY;
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (!this._touchDrag.clone) {
          this._touchDrag.clone = item.cloneNode(true);
          this._touchDrag.clone.style.cssText = 'position:fixed;z-index:999;opacity:0.8;pointer-events:none;';
          document.body.appendChild(this._touchDrag.clone);
        }
        this._touchDrag.clone.style.left = `${t.clientX - 40}px`;
        this._touchDrag.clone.style.top = `${t.clientY - 10}px`;
      });

      item.addEventListener('touchend', (e) => {
        if (!this._touchDrag) return;
        if (this._touchDrag.clone) {
          this._touchDrag.clone.remove();
          const t = e.changedTouches[0];
          const el = document.elementFromPoint(t.clientX, t.clientY);
          const lane = el?.closest('.canvas-lane__content');
          if (lane) {
            const trackId = lane.dataset.trackId;
            const track = this.project?.tracks?.find(tr => tr.id === trackId);
            const snippet = this.project?.snippets?.find(s => s.id === this._touchDrag.snippetId);
            if (track && snippet) {
              if (!this._trackAcceptsSnippet(track, snippet)) {
                showToast(`${this._snippetTypeLabel(snippet)} snippets need a ${this._trackTypeLabel(this._snippetTrackType(snippet))} track`);
                this._touchDrag = null;
                return;
              }
              const rect = lane.getBoundingClientRect();
              const scrollLeft = lane.parentElement?.closest('.canvas-tracks')?.scrollLeft || 0;
              const offsetX = t.clientX - rect.left + scrollLeft;
              const durationBars = snippet.durationTicks / this.transport.ticksPerBar || 1;
              const desiredStartBar = this._barPositionFromPixels(offsetX, 'floor');
              const clip = {
                id: crypto.randomUUID(),
                snippetId: snippet.id,
                snippet: snippet,
                startBar: desiredStartBar,
                durationBars,
              };
              const startBar = this._resolveClipStart(track, clip, desiredStartBar, durationBars);
              if (startBar === null) {
                showToast('No room for that clip on this track');
                this._touchDrag = null;
                return;
              }
              const previousInstrumentId = this._applyRecordedInstrumentToTrack(track, snippet);
              clip.startBar = startBar;
              track.clips.push(clip);
              this.store?.scheduleAutoSave(this.project);
              this.undoManager?.push({
                type: 'addClip',
                description: `Add clip to ${track.name}`,
                undo: () => {
                  track.clips = track.clips.filter(c => c.id !== clip.id);
                  if (previousInstrumentId !== null) {
                    track.instrumentId = previousInstrumentId;
                    this.onTrackInstrumentChanged?.(track.id);
                  }
                  this._renderTracks();
                },
                redo: () => {
                  this._applyRecordedInstrumentToTrack(track, snippet);
                  track.clips.push(clip);
                  this._renderTracks();
                },
              });
              this._renderTracks();
              this._autoSetLoopFromClips();
              showToast(`Clip added to ${track.name}`);
            }
          }
        }
        this._touchDrag = null;
      });
    });
  }

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

  _bindEvents() {
    // Zoom In
    this.el.querySelector('#canvas-zoom-in-btn')?.addEventListener('click', () => {
      this._setZoom(this._zoomLevel * 2);
    });

    // Zoom Out
    this.el.querySelector('#canvas-zoom-out-btn')?.addEventListener('click', () => {
      this._setZoom(this._zoomLevel / 2);
    });

    // Trim empty space
    this.el.querySelector('#canvas-trim-btn')?.addEventListener('click', () => {
      this._trimEmptySpace();
    });

    this.el.querySelector('#canvas-loop-toggle')?.addEventListener('click', () => {
      this._setCanvasLoopEnabled(!this._canvasLoopEnabled());
    });

    this.el.querySelector('#canvas-tone-apply')?.addEventListener('click', () => {
      this._applyTonePresetToSelectedClip();
    });

    this.el.querySelector('#canvas-tone-preset')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._openTonePresetPicker(e.currentTarget);
    });

    // Delegated events on the canvas element
    this.el.addEventListener('pointerdown', (e) => {
      // Mute/Solo buttons
      const addTrackBtn = e.target.closest('[data-add-track-type]');
      if (addTrackBtn) {
        e.preventDefault();
        this._addTrack(addTrackBtn.dataset.addTrackType || 'midi');
        return;
      }

      const instBtn = e.target.closest('[data-track-inst]');
      if (instBtn) {
        e.preventDefault();
        this._openTrackInstrumentPicker(instBtn);
        return;
      }

      const btn = e.target.closest('[data-action]');
      if (btn) {
        const action = btn.dataset.action;
        const trackId = btn.dataset.track;
        const track = this.project?.tracks.find(t => t.id === trackId);
        if (!track) return;

        if (action === 'mute') {
          track.muted = !track.muted;
          btn.classList.toggle('is-muted', track.muted);
        } else if (action === 'solo') {
          track.solo = !track.solo;
          btn.classList.toggle('is-solo', track.solo);
        }
        return;
      }

      // Remove track button
      const removeBtn = e.target.closest('[data-remove-track]');
      if (removeBtn) {
        e.preventDefault();
        const trackId = removeBtn.dataset.removeTrack;
        this._removeTrack(trackId);
        return;
      }
    });

    // Instrument selector change (event delegation)
    this.el.addEventListener('change', (e) => {
      const colorInput = e.target.closest('[data-track-color]');
      if (colorInput) {
        const trackId = colorInput.dataset.trackColor;
        const track = this.project?.tracks.find(t => t.id === trackId);
        if (!track) return;

        track.color = /^#[0-9a-f]{6}$/i.test(colorInput.value) ? colorInput.value : this._trackColor(track);
        this.store?.scheduleAutoSave(this.project);
        this._renderTracks();
        showToast(`${track.name}: color updated`);
        return;
      }

    });

    this._rulerEl?.addEventListener('pointerdown', (e) => {
      const beatEl = e.target.closest('.canvas-ruler__beat');
      if (!beatEl?.dataset.seekBar) return;
      e.preventDefault();
      const bar = parseFloat(beatEl.dataset.seekBar);
      if (!Number.isFinite(bar)) return;
      this.transport.seekToBar(bar);
      this._manualPlayheadVisible = true;
      this._updatePlayheadPosition(true);
    });

    // Double-click to rename track
    this.el.addEventListener('dblclick', (e) => {
      const nameEl = e.target.closest('.canvas-lane__name');
      if (!nameEl) return;

      const trackId = nameEl.dataset.trackId;
      const track = this.project?.tracks.find(t => t.id === trackId);
      if (!track) return;

      // Replace span with input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'canvas-lane__name-input';
      input.value = track.name;
      input.setAttribute('aria-label', 'Track name');

      nameEl.replaceWith(input);
      input.focus();
      input.select();

      const commit = () => {
        const newName = input.value.trim() || track.name;
        track.name = newName;
        this.store?.scheduleAutoSave(this.project);

        const span = document.createElement('span');
        span.className = 'canvas-lane__name';
        span.dataset.trackId = trackId;
        span.title = 'Double-click to rename';
        span.textContent = newName;
        input.replaceWith(span);
      };

      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
        if (ke.key === 'Escape') { input.value = track.name; input.blur(); }
      });
    });

    // Delete selected clip with Delete/Backspace key
    document.addEventListener('keydown', (e) => {
      if ((e.code === 'Delete' || e.code === 'Backspace') && this._selectedClip) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        this._deleteSelectedClip();
      }
    });

    // Sync scroll between ruler and tracks
    this._tracksContainer?.addEventListener('scroll', () => {
      if (this._rulerEl) {
        this._rulerEl.scrollLeft = this._tracksContainer.scrollLeft;
      }
    });

    // Drag-to-pan timeline
    this._tracksContainer?.addEventListener('pointerdown', (e) => {
      // Ignore if clicking on a clip, track header, or scrollbar
      if (e.target.closest('.canvas-clip') || e.target.closest('.canvas-lane__header')) return;
      if (e.target.closest('button') || e.target.closest('select')) return;
      this._clearClipSelection();

      const startX = e.clientX;
      const startY = e.clientY;
      const startScrollLeft = this._tracksContainer.scrollLeft;
      const startScrollTop = this._tracksContainer.scrollTop;
      
      this._tracksContainer.style.cursor = 'grabbing';
      this._tracksContainer.style.userSelect = 'none';

      const onMove = (me) => {
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        this._tracksContainer.scrollLeft = startScrollLeft - dx;
        this._tracksContainer.scrollTop = startScrollTop - dy;
      };

      const onUp = () => {
        this._tracksContainer.style.cursor = '';
        this._tracksContainer.style.userSelect = '';
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  /** Delete the currently selected clip */
  _deleteSelectedClip() {
    if (!this._selectedClip || !this.project) return;
    for (const track of this.project.tracks) {
      const idx = track.clips.findIndex(c => c.id === this._selectedClip);
      if (idx !== -1) {
        const removed = track.clips.splice(idx, 1)[0];
        this._selectedClip = null;
        this.store?.scheduleAutoSave(this.project);
        this.undoManager?.push({
          type: 'deleteClip',
          description: 'Delete clip',
          undo: () => { track.clips.push(removed); this._renderTracks(); },
          redo: () => { track.clips = track.clips.filter(c => c.id !== removed.id); this._renderTracks(); },
        });
        this._renderTracks();
        this._autoSetLoopFromClips();
        showToast('Clip deleted');
        return;
      }
    }
  }

  /** Animate the playhead position */
  _startPlayheadAnimation() {
    const animate = () => {
      this._animFrame = requestAnimationFrame(animate);
      this._updatePlayheadPosition();
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
            clip.durationBars = clip.snippet.durationTicks / this.transport.ticksPerBar || 1;
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

  destroy() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
  }
}
