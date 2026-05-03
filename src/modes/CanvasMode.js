/**
 * CanvasMode — The Macro Arranger.
 * Horizontal timeline with track lanes for arranging snippets.
 * Supports clip placement, drag-to-move, playhead, and track management.
 */

import './canvas.css';
import { TransportState } from '../engine/Transport.js';
import { TRACK_INSTRUMENTS } from '../engine/PlaybackEngine.js';
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
    this.beatWidth = DEFAULT_BAR_WIDTH / 4;
    this._selectedClip = null;
    this._playheadEl = null;
    this._animFrame = null;
    this._tracksContainer = null;
    this._rulerEl = null;

    /** Called when a track's instrument changes */
    this.onTrackInstrumentChanged = null;
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'canvas-mode';

    // Set CSS custom properties for grid
    this.el.style.setProperty('--bar-width', `${this.barWidth}px`);
    this.el.style.setProperty('--beat-width', `${this.beatWidth}px`);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'canvas-toolbar';
    toolbar.innerHTML = `
      <div class="canvas-toolbar__group">
        <button class="btn btn--ghost" id="canvas-add-track-btn" style="font-size:0.75rem;min-height:28px;padding:2px 10px;">+ Track</button>
        <div style="width: 1px; height: 16px; background: var(--surface-3); margin: 0 4px;"></div>
        <button class="btn btn--ghost" id="canvas-zoom-out-btn" style="font-size:0.75rem;min-height:28px;padding:2px 8px;" title="Zoom Out (1/2x)">🔍-</button>
        <button class="btn btn--ghost" id="canvas-zoom-in-btn" style="font-size:0.75rem;min-height:28px;padding:2px 8px;" title="Zoom In (2x)">🔍+</button>
      </div>
      <div class="canvas-toolbar__spacer"></div>
      <div class="canvas-toolbar__group">
        <span class="canvas-toolbar__label" id="canvas-bar-display">Bar 1</span>
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

    return this.el;
  }

  /** Ensure the project has at least 2 default tracks */
  _ensureDefaultTracks() {
    if (!this.project) return;
    if (!this.project.tracks || this.project.tracks.length === 0) {
      this.project.tracks = [
        { id: crypto.randomUUID(), name: 'Melody', type: 'midi', instrumentId: 'chip_lead', clips: [], muted: false, solo: false, volume: 0.8 },
        { id: crypto.randomUUID(), name: 'Drums', type: 'midi', instrumentId: 'kit', clips: [], muted: false, solo: false, volume: 0.8 },
      ];
    }
  }

  /** Render the time ruler (bar numbers) */
  _renderRuler() {
    if (!this._rulerEl) return;
    const totalBars = Math.min(this.transport.maxBars, 80); // Show up to 80 bars
    let html = '';
    // Offset for track header width
    html += `<div class="canvas-ruler__bar" style="width:140px;flex-shrink:0;border-right:1px solid var(--surface-4);"></div>`;
    for (let i = 1; i <= totalBars; i++) {
      html += `<div class="canvas-ruler__bar" style="width:${this.barWidth}px;">${i}</div>`;
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
      const instOptions = Object.values(TRACK_INSTRUMENTS).map(inst => {
        const selected = (track.instrumentId === inst.id) ? 'selected' : '';
        return `<option value="${inst.id}" ${selected}>${inst.name}</option>`;
      }).join('');

      header.innerHTML = `
        <div class="canvas-lane__name-row">
          <span class="canvas-lane__name" data-track-id="${track.id}" title="Double-click to rename">${track.name}</span>
          <button class="canvas-lane__remove-btn" data-remove-track="${track.id}" title="Remove track" aria-label="Remove track">✕</button>
        </div>
        <select class="canvas-lane__instrument" data-track-inst="${track.id}" aria-label="Track instrument">
          ${instOptions}
        </select>
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

    // Add track button
    const addBtn = document.createElement('button');
    addBtn.className = 'canvas-add-track';
    addBtn.id = 'canvas-add-track';
    addBtn.textContent = '+ Add Track';
    addBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._addTrack();
    });
    inner.appendChild(addBtn);
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
      <span class="canvas-clip__label">${snippetName}</span>
      <div class="canvas-clip__preview">${this._renderClipPreview(clip, w)}</div>
    `;

    // Click to select
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this._selectClip(clip.id, el);

      // Drag to move
      this._startClipDrag(e, clip, el);
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

      // Calculate bar position from drop point
      const rect = contentEl.getBoundingClientRect();
      const offsetX = e.clientX - rect.left + contentEl.parentElement?.closest('.canvas-tracks')?.scrollLeft || 0;
      const startBar = Math.max(0, Math.floor(offsetX / this.barWidth));
      const durationBars = Math.ceil(snippet.durationTicks / this.transport.ticksPerBar) || 1;

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
      showToast(`Clip added to ${track.name}`);
    });
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

      const newBar = Math.max(0, Math.round(parseInt(el.style.left, 10) / this.barWidth));
      if (newBar !== originalBar) {
        clip.startBar = newBar;
        el.style.left = `${newBar * this.barWidth}px`;
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
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/snippet-id', item.dataset.snippetId);
        item.classList.add('is-dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('is-dragging');
      });
    });
  }

  /** Add a new track */
  _addTrack() {
    if (!this.project) return;
    const trackNum = this.project.tracks.length + 1;
    const track = {
      id: crypto.randomUUID(),
      name: `Track ${trackNum}`,
      type: 'midi',
      instrumentId: 'chip_lead',
      clips: [],
      muted: false,
      solo: false,
      volume: 0.8,
    };
    this.project.tracks.push(track);
    this.store?.scheduleAutoSave(this.project);
    this._renderTracks();
    showToast(`Added Track ${trackNum}`);
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
    // Add track
    this.el.querySelector('#canvas-add-track-btn')?.addEventListener('click', () => {
      this._addTrack();
    });

    // Zoom In
    this.el.querySelector('#canvas-zoom-in-btn')?.addEventListener('click', () => {
      this._setZoom(this._zoomLevel * 2);
    });

    // Zoom Out
    this.el.querySelector('#canvas-zoom-out-btn')?.addEventListener('click', () => {
      this._setZoom(this._zoomLevel / 2);
    });

    // Delegated events on the canvas element
    this.el.addEventListener('pointerdown', (e) => {
      // Mute/Solo buttons
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
        return;
      }

      this._playheadEl.style.display = 'block';
      const tick = this.transport.currentTick;
      const ticksPerBar = this.transport.ticksPerBar;
      const barPosition = tick / ticksPerBar;
      const x = 140 + barPosition * this.barWidth; // 140px offset for track headers
      this._playheadEl.style.left = `${x}px`;

      // Update bar display
      const barDisplay = this.el.querySelector('#canvas-bar-display');
      if (barDisplay) {
        barDisplay.textContent = `Bar ${Math.floor(barPosition) + 1}`;
      }
    };
    animate();
  }

  /** Refresh the view (call after project changes) */
  refresh() {
    this._renderRuler();
    this._renderTracks();
    this._renderSnippetDock();
  }

  /** Set the zoom level for the canvas timeline */
  _setZoom(level) {
    this._zoomLevel = Math.max(0.125, Math.min(8, level));
    this.barWidth = DEFAULT_BAR_WIDTH * this._zoomLevel;
    this.beatWidth = this.barWidth / 4;
    
    if (this.el) {
      this.el.style.setProperty('--bar-width', `${this.barWidth}px`);
      this.el.style.setProperty('--beat-width', `${this.beatWidth}px`);
      
      const scrollRatio = this._tracksContainer.scrollLeft / this._tracksContainer.scrollWidth || 0;
      
      this._renderRuler();
      this._renderTracks();
      
      if (this._tracksContainer.scrollWidth > 0) {
         this._tracksContainer.scrollLeft = scrollRatio * this._tracksContainer.scrollWidth;
      }
    }
  }

  destroy() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
  }
}
