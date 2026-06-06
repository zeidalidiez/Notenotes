/**
 * canvasRender — CanvasMode feature extracted for size; composed back onto
 * CanvasMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { clipTimeScaleBadgeItem, clipVisualDurationBars } from '../engine/ClipTimeScale.js';
import { normalizeTrackPan } from '../engine/StereoWidth.js';
import { showToast } from '../ui/Toast.js';
import { renderToneBadges, toneBadgeItemsForClip } from '../ui/ToneBadges.js';
import { peaksFromArrayBuffer } from '../utils/audioPeaks.js';
import { LANE_COLORS, hexToRgba } from './canvasShared.js';

export const CanvasRenderMixin = {
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
        <button class="btn btn--ghost canvas-toolbar__btn canvas-time-tool" id="canvas-time-tool" type="button" aria-pressed="false" title="Pick a clip to set half-time or double-time">Time</button>
        <div class="canvas-toolbar__divider"></div>
        <button class="choice-picker-button canvas-toolbar__select" id="canvas-tone-preset" type="button" aria-label="Tone preset for selected clip" aria-haspopup="dialog" disabled data-selected-tone-preset="">
          <span class="choice-picker-button__label" id="canvas-tone-preset-label">Tone preset...</span>
          <span class="choice-picker-button__chevron" aria-hidden="true">▼</span>
        </button>
        <button class="btn btn--ghost canvas-toolbar__btn" id="canvas-tone-apply" title="Select a MIDI or drum clip first" disabled>Apply to Clip</button>
        <div class="canvas-toolbar__divider"></div>
        <button class="btn btn--ghost canvas-toolbar__btn canvas-stage-button" id="canvas-stage-button" type="button" title="Open the Canvas performance visual layer">Stage</button>
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
  },

  _trackColor(track, idx = 0) {
    return /^#[0-9a-f]{6}$/i.test(track?.color || '') ? track.color : LANE_COLORS[idx % LANE_COLORS.length];
  },

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
  },

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
  },

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
          <button class="canvas-lane__ctrl-btn canvas-lane__ctrl-btn--pan${Math.abs(normalizeTrackPan(track.pan)) > 0.01 ? ' is-panned' : ''}" data-track-pan="${track.id}" type="button" title="Track pan">${this._panLabel(track.pan)}</button>
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
  },

  _renderClipsForTrack(contentEl, track, color) {
    if (!track.clips) return;
    track.clips.forEach(clip => {
      const clipEl = this._createClipElement(clip, color);
      contentEl.appendChild(clipEl);
    });
  },

  _createClipElement(clip, color) {
    const x = (clip.startBar || 0) * this.barWidth;
    const w = clipVisualDurationBars(clip, this.transport.ticksPerBar) * this.barWidth;
    clip.durationBars = clipVisualDurationBars(clip, this.transport.ticksPerBar);

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

    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this._selectClip(clip.id, el);

      if (e.ctrlKey || e.metaKey) {
        this._deleteSelectedClip();
        return;
      }

      if (this._timeToolActive) {
        e.preventDefault();
        this._openTimeScaleModal(clip);
      } else if (e.pointerType === 'touch') {
        this._startTouchClipIntent(e, clip, el);
      } else {
        this._startClipDrag(e, clip, el);
      }
    });

    return el;
  },

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
  },

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
  },

  _ensureAudioPeaks(snippet) {
    if (!snippet?.id || snippet.audioPeaks?.length || !this.store?.audioSnippetToArrayBuffer) return;
    if (this._audioPeakLoads.has(snippet.id)) return;
    this._audioPeakLoads.add(snippet.id);
    this.store.audioSnippetToArrayBuffer(snippet)
      .then(arrayBuffer => peaksFromArrayBuffer(arrayBuffer))
      .then(peaks => {
        if (peaks?.length) {
          snippet.audioPeaks = peaks;
          this.store?.scheduleAutoSave(this.project);
          this._renderTracks();
        }
      })
      .catch(err => console.warn('[CanvasMode] Audio peak analysis failed:', err))
      .finally(() => this._audioPeakLoads.delete(snippet.id));
  },

  _renderToneBadges(clip) {
    return renderToneBadges(
      [...toneBadgeItemsForClip(clip), clipTimeScaleBadgeItem(clip)].filter(Boolean),
      'canvas-clip__tone-badges tone-badges',
    );
  },

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
  },

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
          mode: 'pending',
        };
      }, { passive: true });

      item.addEventListener('touchmove', (e) => {
        if (!this._touchDrag) return;
        const t = e.touches[0];
        const dx = t.clientX - this._touchDrag.startX;
        const dy = t.clientY - this._touchDrag.startY;
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        if (absX < 10 && absY < 10) return;
        if (this._touchDrag.mode === 'pending') {
          if (absX > absY) {
            this._touchDrag.mode = 'scroll';
            return;
          }
          this._touchDrag.mode = 'drag';
        }
        if (this._touchDrag.mode !== 'drag') return;
        e.preventDefault();
        if (!this._touchDrag.clone) {
          this._touchDrag.clone = item.cloneNode(true);
          this._touchDrag.clone.style.cssText = 'position:fixed;z-index:999;opacity:0.8;pointer-events:none;';
          document.body.appendChild(this._touchDrag.clone);
        }
        this._touchDrag.clone.style.left = `${t.clientX - 40}px`;
        this._touchDrag.clone.style.top = `${t.clientY - 10}px`;
      }, { passive: false });

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
                timeScale: 1,
              };
              const startBar = this._resolveClipStart(track, clip, desiredStartBar, durationBars);
              if (startBar === null) {
                showToast('No room for that clip on this track');
                this._touchDrag = null;
                return;
              }
              const previousInstrumentId = this._applyRecordedInstrumentToTrack(track, snippet);
              clip.startBar = startBar;
              this._commitClipAdd(track, clip, snippet, previousInstrumentId);
            }
          }
        }
        this._touchDrag = null;
      });
    });
  },
};
