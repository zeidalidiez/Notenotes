/**
 * CanvasMode — The Macro Arranger.
 * Horizontal timeline with track lanes for arranging snippets.
 * Supports clip placement, drag-to-move, playhead, and track management.
 */

import './canvas.css';
import { TransportState } from '../engine/Transport.js';
import { TRACK_INSTRUMENTS } from '../engine/PlaybackEngine.js';
import { normalizeSoundTraits } from '../instruments/WebAudioSynth.js';
import { showToast } from '../ui/Toast.js';

/** Pixels per bar at default zoom */
const DEFAULT_BAR_WIDTH = 120;
const LANE_COLORS = [
  'rgba(106,140,175,0.35)', 'rgba(138,106,175,0.35)',
  'rgba(175,138,106,0.35)', 'rgba(106,175,138,0.35)',
  'rgba(175,106,138,0.35)', 'rgba(138,175,106,0.35)',
];

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
    this._animFrame = null;
    this._tracksContainer = null;
    this._rulerEl = null;

    /** Called when a track's instrument changes */
    this.onTrackInstrumentChanged = null;

    window.addEventListener('project-tone-presets-changed', () => this._refreshTonePresetSelect());
  }

  _beatsPerBar() {
    return Math.max(1, this.transport?.timeSignature?.beats || 4);
  }

  _syncTimelineMetrics() {
    this.barWidth = DEFAULT_BAR_WIDTH * this._zoomLevel;
    this.beatWidth = this.barWidth / this._beatsPerBar();

    if (this.el) {
      this.el.style.setProperty('--bar-width', `${this.barWidth}px`);
      this.el.style.setProperty('--beat-width', `${this.beatWidth}px`);
    }
  }

  _barPositionFromPixels(px, snap = 'floor') {
    const beat = px / this.beatWidth;
    const snappedBeat = snap === 'round' ? Math.round(beat) : Math.floor(beat);
    return Math.max(0, snappedBeat / this._beatsPerBar());
  }

  _formatPosition(tick = this.transport?.currentTick || 0) {
    const ticksPerBar = this.transport.ticksPerBar;
    const ticksPerBeat = this.transport.ticksPerBeat;
    const bar = Math.floor(tick / ticksPerBar) + 1;
    const beat = Math.floor((tick % ticksPerBar) / ticksPerBeat) + 1;
    return `Bar ${bar}.${beat}`;
  }

  _autoSetLoopFromClips() {
    if (!this.project?.tracks) return;
    let maxEndBar = 4;
    for (const track of this.project.tracks) {
      for (const clip of (track.clips || [])) {
        const endBar = (clip.startBar || 0) + (clip.durationBars || 1);
        if (endBar > maxEndBar) maxEndBar = endBar;
      }
    }
    this.transport.setLoop(0, maxEndBar);
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
        <button class="btn btn--ghost" data-add-track-type="midi" style="font-size:0.75rem;min-height:28px;padding:2px 10px;">+ MIDI Track</button>
        <button class="btn btn--ghost" data-add-track-type="drum" style="font-size:0.75rem;min-height:28px;padding:2px 10px;">+ Drum Track</button>
        <button class="btn btn--ghost" data-add-track-type="audio" style="font-size:0.75rem;min-height:28px;padding:2px 10px;">+ Audio Track</button>
        <div style="width: 1px; height: 16px; background: var(--surface-3); margin: 0 4px;"></div>
        <button class="btn btn--ghost" id="canvas-zoom-out-btn" style="font-size:0.75rem;min-height:28px;padding:2px 8px;" title="Zoom Out (1/2x)">🔍-</button>
        <button class="btn btn--ghost" id="canvas-zoom-in-btn" style="font-size:0.75rem;min-height:28px;padding:2px 8px;" title="Zoom In (2x)">🔍+</button>
        <div style="width: 1px; height: 16px; background: var(--surface-3); margin: 0 4px;"></div>
        <button class="btn btn--ghost" id="canvas-trim-btn" style="font-size:0.75rem;min-height:28px;padding:2px 8px;" title="Trim empty space from all snippets">✂️ Trim</button>
        <div style="width: 1px; height: 16px; background: var(--surface-3); margin: 0 4px;"></div>
        <select class="canvas-toolbar__select" id="canvas-tone-preset" aria-label="Tone preset for selected clip">
          ${this._renderTonePresetOptions()}
        </select>
        <button class="btn btn--ghost" id="canvas-tone-apply" style="font-size:0.75rem;min-height:28px;padding:2px 8px;" title="Apply Tone preset to selected clip">Apply to Clip</button>
      </div>
      <div class="canvas-toolbar__spacer"></div>
      <div class="canvas-toolbar__group">
        <span class="canvas-toolbar__label" id="canvas-bar-display">Bar 1.1</span>
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
    this._autoSetLoopFromClips();

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
    else if (track.instrumentId === 'kit' && !clips.some(c => c.snippet?.type === 'midi')) track.type = 'drum';
    else if (!track.type) {
      if (clips.some(c => c.snippet?.type === 'drum')) track.type = 'drum';
      else track.type = 'midi';
    }
    if (track.type === 'drum') track.instrumentId = 'kit';
    if (track.type === 'audio') track.instrumentId = 'audio';
    if (track.type === 'midi' && (!track.instrumentId || track.instrumentId === 'kit' || track.instrumentId === 'audio')) {
      track.instrumentId = 'chip_lead';
    }
    if (!Array.isArray(track.clips)) track.clips = [];
    return track;
  }

  /** Render the time ruler (bar numbers) */
  _renderRuler() {
    if (!this._rulerEl) return;
    const totalBars = Math.min(this.transport.maxBars, 80);
    const beatsPerBar = this._beatsPerBar();
    const totalBeats = totalBars * beatsPerBar;
    let html = '';
    html += `<div class="canvas-ruler__bar" style="width:140px;flex-shrink:0;border-right:1px solid var(--surface-4);"></div>`;
    for (let beat = 0; beat < totalBeats; beat++) {
      const bar = Math.floor(beat / beatsPerBar) + 1;
      const beatInBar = (beat % beatsPerBar) + 1;
      const label = beatInBar === 1 ? `${bar}` : `${bar}.${beatInBar}`;
      const isBar = beatInBar === 1;
      html += `<div class="canvas-ruler__beat" style="width:${this.beatWidth}px;${isBar ? 'font-weight:var(--font-weight-semibold);color:var(--accent-light);' : ''}">${label}</div>`;
    }
    this._rulerEl.innerHTML = html;
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
      const color = LANE_COLORS[idx % LANE_COLORS.length];
      header.style.borderLeft = `3px solid ${color.replace('0.35', '0.8')}`;

      // Build instrument options
      this._normalizeTrackType(track);
      const trackTypeLabel = this._trackTypeLabel(track.type);
      const instOptions = track.type === 'midi' ? Object.values(TRACK_INSTRUMENTS).filter(inst => inst.type === 'synth').map(inst => {
        const selected = (track.instrumentId === inst.id) ? 'selected' : '';
        return `<option value="${inst.id}" ${selected}>${inst.name}</option>`;
      }).join('') : '';
      const instSelect = track.type === 'drum' ? '<span class="canvas-lane__inst-label">Drum Kit</span>' : track.type !== 'midi'
        ? `<span class="canvas-lane__inst-label">🎤 Audio</span>`
        : `<select class="canvas-lane__instrument" data-track-inst="${track.id}" aria-label="Track instrument">${instOptions}</select>`;

      header.innerHTML = `
        <div class="canvas-lane__name-row">
          <span class="canvas-lane__name" data-track-id="${track.id}" title="Double-click to rename">${track.name}</span>
          <span class="canvas-lane__type">${trackTypeLabel}</span>
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
    el.style.left = `${x}px`;
    el.style.width = `${w}px`;
    el.style.background = color;

    const noteCount = (clip.snippet?.notes?.length || 0) + (clip.snippet?.hits?.length || 0);
    const snippetName = clip.snippet?.name || `${noteCount} notes`;
    el.innerHTML = `
      <div class="canvas-clip__label-row">
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
    const seed = [...(snippet.id || snippet.name || 'audio')]
      .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
    const bars = Math.max(10, Math.min(56, Math.floor(svgWidth / 5)));
    const gap = 2;
    const barWidth = Math.max(2, (svgWidth - gap * (bars - 1)) / bars);
    const center = height / 2;
    let state = seed || 1;
    let svgContent = `<line x1="0" y1="${center}" x2="${svgWidth}" y2="${center}" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>`;

    for (let i = 0; i < bars; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const noise = state / 0xffffffff;
      const envelope = Math.sin((i / Math.max(1, bars - 1)) * Math.PI);
      const barHeight = Math.max(4, (0.25 + noise * 0.55) * envelope * (height - 8));
      const x = i * (barWidth + gap);
      const y = center - barHeight / 2;
      svgContent += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="1.5" fill="rgba(255,255,255,0.58)"/>`;
    }

    return `<svg width="${svgWidth}" height="${height}" class="canvas-clip__audio-preview" style="display:block;">${svgContent}</svg>`;
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

  _renderTonePresetOptions() {
    return `<option value="">Tone preset...</option>${this._tonePresets().map(preset => `<option value="${preset.id}">${preset.name}</option>`).join('')}`;
  }

  _refreshTonePresetSelect() {
    const select = this.el?.querySelector('#canvas-tone-preset');
    if (!select) return;
    const value = select.value;
    select.innerHTML = this._renderTonePresetOptions();
    if (this._tonePresets().some(p => p.id === value)) select.value = value;
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
    const presetId = this.el?.querySelector('#canvas-tone-preset')?.value;
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
      const startBar = this._barPositionFromPixels(offsetX, 'floor');
      const durationBars = snippet.durationTicks / this.transport.ticksPerBar || 1;

      const clip = {
        id: crypto.randomUUID(),
        snippetId: snippet.id,
        snippet: snippet,
        startBar,
        durationBars,
      };

      // Add to track
      track.clips.push(clip);
      this.store?.scheduleAutoSave(this.project);

      // Add to undo stack
      this.undoManager?.push({
        type: 'addClip',
        description: `Add clip to ${track.name}`,
        undo: () => {
          track.clips = track.clips.filter(c => c.id !== clip.id);
          this._renderTracks();
        },
        redo: () => {
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
  }

  /** Handle clip drag-to-move */
  _startClipDrag(e, clip, el) {
    const startX = e.clientX;
    const startLeft = parseInt(el.style.left, 10) || 0;
    const originalBar = clip.startBar;

    el.classList.add('is-dragging');

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const newLeft = Math.max(0, startLeft + dx);
      el.style.left = `${newLeft}px`;
    };

    const onUp = () => {
      el.classList.remove('is-dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const newBar = this._barPositionFromPixels(parseInt(el.style.left, 10), 'round');
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

    el.classList.add('is-dragging');

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const newWidth = Math.max(this.beatWidth, Math.min(startWidth, startWidth + dx));
      el.style.width = `${newWidth}px`;
    };

    const onUp = () => {
      el.classList.remove('is-dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const finalWidth = parseInt(el.style.width, 10);
      const newBeats = Math.max(1, Math.round(finalWidth / this.beatWidth));
      const newBars = newBeats / this._beatsPerBar();
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
      const icon = s.type === 'drum' ? '🥁' : '🎵';
      return `<div class="canvas-snippet-dock__item" draggable="true" data-snippet-id="${s.id}">
        ${icon} ${name}
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
              const startBar = this._barPositionFromPixels(offsetX, 'floor');
              const durationBars = snippet.durationTicks / this.transport.ticksPerBar || 1;
              const clip = {
                id: crypto.randomUUID(),
                snippetId: snippet.id,
                snippet: snippet,
                startBar,
                durationBars,
              };
              track.clips.push(clip);
              this.store?.scheduleAutoSave(this.project);
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
      instrumentId: type === 'drum' ? 'kit' : type === 'audio' ? 'audio' : 'chip_lead',
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

    this.el.querySelector('#canvas-tone-apply')?.addEventListener('click', () => {
      this._applyTonePresetToSelectedClip();
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
      const select = e.target.closest('[data-track-inst]');
      if (!select) return;

      const trackId = select.dataset.trackInst;
      const track = this.project?.tracks.find(t => t.id === trackId);
      if (!track) return;

      track.instrumentId = select.value;
      this.store?.scheduleAutoSave(this.project);

      // Notify playback engine to invalidate cached synth
      if (this.onTrackInstrumentChanged) {
        this.onTrackInstrumentChanged(trackId);
      }

      const instName = TRACK_INSTRUMENTS[select.value]?.name || select.value;
      showToast(`${track.name}: ${instName}`);
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
      if (!this._playheadEl) return;

      if (this.transport.state === TransportState.STOPPED) {
        this._playheadEl.style.display = 'none';
        const barDisplay = this.el.querySelector('#canvas-bar-display');
        if (barDisplay) barDisplay.textContent = this._formatPosition(this.transport.currentTick);
        return;
      }

      this._playheadEl.style.display = 'block';
      const tick = this.transport.currentTick;
      const ticksPerBar = this.transport.ticksPerBar;
      const barPosition = tick / ticksPerBar;
      const x = 140 + barPosition * this.barWidth; // 140px offset for track headers
      this._playheadEl.style.left = `${x}px`;

      // Update position display
      const barDisplay = this.el.querySelector('#canvas-bar-display');
      if (barDisplay) {
        barDisplay.textContent = this._formatPosition(tick);
      }
    };
    animate();
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
