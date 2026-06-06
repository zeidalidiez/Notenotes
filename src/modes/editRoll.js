/**
 * editRoll — EditMode feature extracted for size; composed back onto
 * EditMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { midiToNoteName } from '../engine/MusicTheory.js';
import { pulseTicksForMeter } from '../engine/Meter.js';
import { inspectDisplayDurationTicks } from '../engine/SnippetTiming.js';
import { renderToneBadges, toneBadgeItemsFromSources } from '../ui/ToneBadges.js';
import { TICK_WIDTH, DEFAULT_NOTE_HEIGHT, DRUM_TYPES } from './editConstants.js';

export const EditRollMixin = {
  _renderEditor() {
    this._panes = [];
    const isDrum = this._snippet.type === 'drum';
    if (isDrum && this._splitMode) {
      this._splitMode = false;
    }
    if (isDrum) {
      this._pitchMin = 0;
      this._pitchMax = DRUM_TYPES.length;
      this._noteHeight = DEFAULT_NOTE_HEIGHT;
    } else {
      if (!this._pitchRangeInitialized) {
        this._pitchMin = 36;
        this._pitchMax = 84;
        this._pitchRangeInitialized = true;
      }
      this.el.style.setProperty('--note-height', `${this._noteHeight}px`);
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'edit-toolbar';
    const noteCount = (this._snippet.notes?.length || 0) + (this._snippet.hits?.length || 0);
    toolbar.innerHTML = this._buildToolbarHTML(noteCount, isDrum);
    this.el.appendChild(toolbar);

    if (this._splitMode) {
      const midPitch = Math.floor((this._pitchMin + this._pitchMax) / 2);
      const midC = Math.ceil(midPitch / 12) * 12;

      const paneA = this._renderRollPane(this._pitchMin, midC, 'a');
      const paneB = this._renderRollPane(midC, this._pitchMax, 'b');

      this.el.appendChild(paneA.el);
      this.el.appendChild(paneB.el);

      this._panes = [paneA, paneB];
    } else {
      const pane = this._renderRollPane(this._pitchMin, this._pitchMax, 'single');
      this.el.appendChild(pane.el);
      this._panes = [pane];
    }

    this._bindEvents(toolbar);
  },

  _buildToolbarHTML(noteCount, isDrum) {
    const pitchMinOct = Math.floor(this._pitchMin / 12) - 1;
    const pitchMaxOct = Math.floor(this._pitchMax / 12) - 1;
    const rangeHTML = isDrum ? '' : `
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Range</span>
        <select class="edit-toolbar__select" id="edit-oct-low" aria-label="Low octave">
          ${[1,2,3,4,5].map(o => `<option value="${o}" ${pitchMinOct === o ? 'selected' : ''}>C${o}</option>`).join('')}
        </select>
        <span class="edit-toolbar__range-separator">to</span>
        <select class="edit-toolbar__select" id="edit-oct-high" aria-label="High octave">
          ${[2,3,4,5,6].map(o => `<option value="${o}" ${pitchMaxOct === o ? 'selected' : ''}>C${o}</option>`).join('')}
        </select>
      </div>
    `;
    const zoomHTML = isDrum ? '' : `
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Zoom</span>
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--compact" id="edit-zoom-out" title="Vertical zoom out">-</button>
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--compact" id="edit-zoom-in" title="Vertical zoom in">+</button>
      </div>
    `;
    const quantizeAllHTML = isDrum ? '' : `
      <button class="btn btn--ghost edit-toolbar__btn" id="edit-quantize-all-btn" title="Set every note duration to the selected grid">Quantize all</button>
    `;
    const velocityValue = Math.round((this._selectedEditableEvent()?.velocity ?? 0.8) * 100);
    const toneBadges = this._renderToneBadges();

    return `
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Load</span>
        <select class="edit-toolbar__select edit-toolbar__select--clip" id="edit-load-clip-select" aria-label="Load editable clip">
          ${this._renderClipOptions()}
        </select>
      </div>
      <div class="edit-toolbar__group">
        <input type="text" class="edit-toolbar__name-input" id="edit-snippet-name" value="${this._snippet.name || 'Snippet'}" placeholder="Snippet name" title="Edit snippet name" />
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--tiny" id="edit-double-btn" title="Double snippet length">2x</button>
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--tiny" id="edit-half-btn" title="Halve snippet length">1/2</button>
        <span class="edit-toolbar__value">${noteCount} ${isDrum ? 'hits' : 'notes'}</span>
        ${toneBadges}
      </div>
      <div class="edit-toolbar__group">
        <button class="btn btn--ghost edit-toolbar__btn" id="edit-new-midi-toolbar" type="button">New MIDI</button>
        <button class="btn btn--ghost edit-toolbar__btn" id="edit-new-drum-toolbar" type="button">New Drum</button>
      </div>
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Grid</span>
        <select class="edit-toolbar__select" id="edit-grid-select" aria-label="Grid size">
          <option value="480" ${this._gridSize === 480 ? 'selected' : ''}>1/4</option>
          <option value="240" ${this._gridSize === 240 ? 'selected' : ''}>1/8</option>
          <option value="120" ${this._gridSize === 120 ? 'selected' : ''}>1/16</option>
          <option value="960" ${this._gridSize === 960 ? 'selected' : ''}>1/2</option>
        </select>
        <span class="edit-toolbar__label">Shadow</span>
        <select class="edit-toolbar__select edit-toolbar__select--shadow" id="edit-shadow-select" aria-label="Shadow clip">
          ${this._renderShadowOptions(isDrum)}
        </select>
      </div>
      ${zoomHTML}
      ${rangeHTML}
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Velocity</span>
        <input class="edit-toolbar__velocity" id="edit-velocity-range" type="range" min="1" max="100" value="${velocityValue}" aria-label="Selected note velocity" ${this._selectedNoteIdx === null ? 'disabled' : ''} />
        <span class="edit-toolbar__velocity-value" id="edit-velocity-value">${this._selectedNoteIdx === null ? '--' : velocityValue}</span>
      </div>
      <button class="btn btn--ghost edit-toolbar__btn${this._splitMode ? ' is-active' : ''}" id="edit-split-btn" title="${isDrum ? 'Split view is for MIDI note ranges' : 'Split view'}" ${isDrum ? 'disabled' : ''}>Split</button>
      <button class="btn btn--ghost edit-toolbar__btn" id="edit-rhythm-fit-btn" title="Fit this snippet rhythm to clean bars">Fit Rhythm</button>
      ${quantizeAllHTML}
      <div class="edit-toolbar__spacer"></div>
      <div class="edit-toolbar__group">
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--danger" id="edit-delete-btn">Delete ${isDrum ? 'Hit' : 'Note'}</button>
      </div>
    `;
  },

  _renderToneBadges() {
    const clip = this._findLoadedClip();
    const snippet = this._snippet;
    const items = toneBadgeItemsFromSources([
      clip?.soundTraits || snippet?.soundTraits || {},
      ...(snippet?.notes || []).map(note => note.soundTraits || {}),
      ...(snippet?.hits || []).map(hit => hit.soundTraits || {}),
    ]);
    return renderToneBadges(items, 'edit-toolbar__tone-badges tone-badges');
  },

  _findLoadedClip() {
    if (!this._clipId) return null;
    for (const track of this.project?.tracks || []) {
      const clip = (track.clips || []).find(item => item.id === this._clipId);
      if (clip) return clip;
    }
    return null;
  },

  _renderClipOptions() {
    const snippets = (this.project?.snippets || []).filter(Boolean);
    if (!snippets.length) return '<option value="">No clips</option>';
    return snippets.map(s => {
      const count = (s.notes?.length || 0) + (s.hits?.length || 0);
      const type = s.type === 'audio' ? 'Audio' : s.type === 'drum' ? 'Drum' : 'MIDI';
      const label = s.name || `${type} clip`;
      const selected = s.id === this._snippet?.id ? 'selected' : '';
      const suffix = s.type === 'audio' ? '' : ` (${count})`;
      return `<option value="${s.id}" ${selected}>${type}: ${label}${suffix}</option>`;
    }).join('');
  },

  _renderShadowOptions(isDrum) {
    const snippets = this._shadowCandidates(isDrum);
    if (!snippets.length) {
      return '<option value="">No clips</option>';
    }

    const currentSelection = snippets.some(s => s.id === this._shadowSnippetId) ? this._shadowSnippetId : '';
    return '<option value="">Off</option>' + snippets.map(s => {
      const count = (s.notes?.length || 0) + (s.hits?.length || 0);
      const type = s.type === 'drum' ? 'Drum' : 'MIDI';
      const label = s.name || `${type} clip`;
      const selected = currentSelection === s.id ? 'selected' : '';
      return `<option value="${s.id}" ${selected}>${type}: ${label} (${count})</option>`;
    }).join('');
  },

  _shadowCandidates(isDrum = this._snippet?.type === 'drum') {
    const snippets = (this.project?.snippets || []).filter(s => {
      if (!s || s.id === this._snippet?.id || s.type === 'audio') return false;
      if (isDrum) return s.type === 'midi' || s.type === 'drum';
      return s.type === 'midi' || s.type === 'drum';
    });
    return snippets;
  },

  _selectedShadowSnippet() {
    if (!this._shadowSnippetId || !this.project?.snippets) return null;
    if (this._shadowSnippetId === this._snippet?.id) return null;
    const shadow = this.project.snippets.find(s => s.id === this._shadowSnippetId);
    if (!shadow || shadow.type === 'audio') return null;
    return shadow;
  },

  _renderRollPane(pitchMin, pitchMax, paneId) {
    const pitchRange = pitchMax - pitchMin;
    const isDrum = this._snippet?.type === 'drum';

    const paneEl = document.createElement('div');
    paneEl.className = 'piano-roll-pane';
    paneEl.dataset.pane = paneId;

    const keysEl = this._renderKeysForRange(pitchMin, pitchMax);
    keysEl.dataset.pane = paneId;
    if (isDrum) {
      keysEl.style.setProperty('--note-height', `calc(100% / ${pitchRange})`);
    }
    paneEl.appendChild(keysEl);

    const gridWrapper = document.createElement('div');
    gridWrapper.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

    const ruler = this._renderRuler();
    gridWrapper.appendChild(ruler);

    const gridContainer = document.createElement('div');
    gridContainer.className = 'piano-roll__grid-container';
    gridContainer.dataset.pane = paneId;

    const gridEl = this._renderGridForRange(pitchMin, pitchMax, paneId);
    gridContainer.appendChild(gridEl);
    gridWrapper.appendChild(gridContainer);

    paneEl.appendChild(gridWrapper);

    gridContainer.addEventListener('scroll', () => {
      keysEl.scrollTop = gridContainer.scrollTop;
    });

    const result = {
      el: paneEl, paneId, pitchMin, pitchMax, pitchRange, keysEl, gridContainer, gridEl,
    };

    if (!isDrum) {
      requestAnimationFrame(() => {
        const midScroll = (pitchRange * this._noteHeight) / 2 - gridContainer.clientHeight / 2;
        gridContainer.scrollTop = Math.max(0, midScroll);
        keysEl.scrollTop = gridContainer.scrollTop;
      });
    }

    return result;
  },

  _renderKeysForRange(pitchMin, pitchMax) {
    const el = document.createElement('div');
    el.className = 'piano-roll__keys';
    const isDrum = this._snippet?.type === 'drum';

    let html = isDrum ? '' : '<div style="height:20px;flex-shrink:0;"></div>';
    for (let row = pitchMax - 1; row >= pitchMin; row--) {
      if (isDrum) {
        const dt = DRUM_TYPES[row] || { label: '?' };
        html += `<div class="piano-roll__key piano-roll__key--white piano-roll__key--drum" data-pitch="${row}">${dt.label}</div>`;
      } else {
        const info = midiToNoteName(row);
        const isBlack = info.name.includes('#');
        const isC = info.name === 'C';
        const cls = isBlack ? 'piano-roll__key--black' : 'piano-roll__key--white';
        const cCls = isC ? ' piano-roll__key--c' : '';
        html += `<div class="piano-roll__key ${cls}${cCls}" data-pitch="${row}">${info.display}</div>`;
      }
    }
    el.innerHTML = html;
    return el;
  },

  _renderRuler() {
    const el = document.createElement('div');
    el.className = 'piano-roll__ruler';

    const duration = this._displayDurationTicks();
    const width = duration * TICK_WIDTH;
    el.style.width = `${width}px`;
    el.style.minWidth = '100%';

    const ticksPerBar = this._ticksPerBar();
    const pulses = pulseTicksForMeter(this._meterSource(), this.transport?.ticksPerBeat || 480);
    let html = '';
    for (let barStart = 0; barStart < duration; barStart += ticksPerBar) {
      const bar = Math.floor(barStart / ticksPerBar) + 1;
      let cursor = 0;
      for (let pulse = 0; pulse < pulses.length; pulse += 1) {
        const tick = barStart + cursor;
        if (tick >= duration) break;
        const x = tick * TICK_WIDTH;
        const label = pulse === 0 ? `${bar}` : `${bar}.${pulse + 1}`;
        html += `<span class="piano-roll__ruler-label" style="left:${x}px">${label}</span>`;
        cursor += pulses[pulse];
      }
    }
    el.innerHTML = html;
    return el;
  },

  _displayDurationTicks() {
    return inspectDisplayDurationTicks(this._snippet, {
      ticksPerBar: this._ticksPerBar(),
      gridTicks: this._gridSize || this.transport?.ticksPerBeat || 480,
    });
  },

  _renderGridForRange(pitchMin, pitchMax, paneId) {
    const duration = this._displayDurationTicks();
    const width = duration * TICK_WIDTH;
    const pitchRange = pitchMax - pitchMin;
    const isDrum = this._snippet?.type === 'drum';
    const height = isDrum ? '100%' : `${pitchRange * this._noteHeight}px`;
    const rowHeight = isDrum ? `calc(100% / ${pitchRange})` : `${this._noteHeight}px`;

    const grid = document.createElement('div');
    grid.className = 'piano-roll__grid';
    grid.style.width = `${width}px`;
    grid.style.height = height;
    grid.style.position = 'relative';
    grid.dataset.pane = paneId;
    grid.dataset.pitchMin = pitchMin;
    grid.dataset.pitchMax = pitchMax;

    let rowsHtml = '';
    for (let row = pitchMax - 1; row >= pitchMin; row--) {
      const rowStyle = `height:${rowHeight};`;
      if (isDrum) {
        const color = row % 2 === 0 ? 'rgba(175,138,106,0.1)' : 'rgba(175,138,106,0.05)';
        rowsHtml += `<div class="piano-roll__row" style="${rowStyle}background:${color};"></div>`;
      } else {
        const info = midiToNoteName(row);
        const isBlack = info.name.includes('#');
        const isC = info.name === 'C';
        const cls = isBlack ? ' piano-roll__row--black' : '';
        const cCls = isC ? ' piano-roll__row--c' : '';
        rowsHtml += `<div class="piano-roll__row${cls}${cCls}" style="${rowStyle}"></div>`;
      }
    }
    const bgEl = document.createElement('div');
    bgEl.className = 'piano-roll__grid-bg';
    bgEl.innerHTML = rowsHtml;
    grid.appendChild(bgEl);

    const ticksPerBeat = 480;
    const ticksPerBar = this._ticksPerBar();
    for (let tick = 0; tick <= duration; tick += this._gridSize) {
      const x = tick * TICK_WIDTH;
      const line = document.createElement('div');
      line.className = 'piano-roll__beat-line';
      if (tick % ticksPerBar === 0) {
        line.classList.add('piano-roll__beat-line--bar');
      } else if (tick % ticksPerBeat !== 0) {
        line.classList.add('piano-roll__beat-line--sub');
      }
      line.style.left = `${x}px`;
      grid.appendChild(line);
    }

    this._renderShadowForPane(grid, pitchMin, pitchMax);
    this._renderNotesForPane(grid, pitchMin, pitchMax);

    return grid;
  },

  _renderShadowForPane(grid, pitchMin, pitchMax) {
    const shadow = this._selectedShadowSnippet();
    if (!shadow) return;

    const isDrumEditor = this._snippet?.type === 'drum';
    if (shadow.type === 'drum') {
      const hits = shadow.hits || [];
      hits.forEach((hit) => {
        const el = this._createShadowHitElementForPane(hit, pitchMin, pitchMax, isDrumEditor);
        if (el) grid.appendChild(el);
      });
      return;
    }

    const notes = shadow.notes || [];
    notes.forEach((note) => {
      if (isDrumEditor) {
        const el = this._createShadowMidiOnDrumElement(note, pitchMin, pitchMax);
        if (el) grid.appendChild(el);
      } else if (note.pitch >= pitchMin && note.pitch < pitchMax) {
        grid.appendChild(this._createShadowNoteElementForPane(note, pitchMax));
      }
    });
  },

  _createShadowMidiOnDrumElement(note, pitchMin, pitchMax) {
    if (pitchMin !== 0 || pitchMax !== DRUM_TYPES.length) return null;
    const normalized = Math.max(0, Math.min(1, ((note.pitch || 60) - 36) / 48));
    const row = Math.max(0, Math.min(DRUM_TYPES.length - 1, Math.round(normalized * (DRUM_TYPES.length - 1))));
    const pct = 100 / DRUM_TYPES.length;
    const velocity = this._normalizedVelocity(note.velocity);
    const velocityPct = this._velocityPercent(note.velocity);
    const el = document.createElement('div');
    el.className = 'piano-roll__shadow-note piano-roll__shadow-note--midi';
    el.style.left = `${note.startTick * TICK_WIDTH}px`;
    el.style.top = `${(DRUM_TYPES.length - 1 - row) * pct}%`;
    el.style.height = `${pct - 0.5}%`;
    el.style.width = `${Math.max(8, (note.durationTick || this._gridSize) * TICK_WIDTH)}px`;
    el.style.setProperty('--note-velocity', velocity);
    el.style.setProperty('--note-velocity-alpha', 0.22 + velocity * 0.5);
    el.title = `Shadow ${midiToNoteName(note.pitch).display} - velocity ${velocityPct}%`;
    el.innerHTML = `<div class="piano-roll__shadow-velocity"></div>`;
    return el;
  },

  _createShadowNoteElementForPane(note, pitchMax) {
    const x = note.startTick * TICK_WIDTH;
    const w = Math.max(6, (note.durationTick || this._gridSize) * TICK_WIDTH);
    const y = (pitchMax - 1 - note.pitch) * this._noteHeight;
    const velocity = this._normalizedVelocity(note.velocity);
    const velocityPct = this._velocityPercent(note.velocity);

    const el = document.createElement('div');
    el.className = 'piano-roll__shadow-note piano-roll__shadow-note--midi';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.setProperty('--note-velocity', velocity);
    el.style.setProperty('--note-velocity-alpha', 0.22 + velocity * 0.5);
    el.title = `Shadow MIDI note - velocity ${velocityPct}%`;
    el.innerHTML = `<div class="piano-roll__shadow-velocity"></div>`;
    return el;
  },

  _createShadowHitElementForPane(hit, pitchMin, pitchMax, isDrumEditor) {
    const typeIdx = DRUM_TYPES.findIndex(d => d.id === hit.type);
    if (typeIdx < 0) return null;

    let y;
    let h;
    let width;
    if (isDrumEditor) {
      if (typeIdx < pitchMin || typeIdx >= pitchMax) return null;
      const pct = 100 / DRUM_TYPES.length;
      y = `${(DRUM_TYPES.length - 1 - typeIdx) * pct}%`;
      h = `${pct - 0.5}%`;
      width = `${this._drumHitVisualWidth()}px`;
    } else {
      const pitchMap = { kick: 36, snare: 40, clap: 40, hihat: 44, cymbal: 46, tomlo: 43, tommid: 45, tomhi: 48, rim: 37, shaker: 44 };
      const pitch = pitchMap[hit.type] || 38;
      if (pitch < pitchMin || pitch >= pitchMax) return null;
      y = `${(pitchMax - 1 - pitch) * this._noteHeight}px`;
      h = `${this._noteHeight - 2}px`;
      width = `${this._noteHeight - 2}px`;
    }

    const el = document.createElement('div');
    el.className = 'piano-roll__shadow-note piano-roll__shadow-note--drum';
    const velocity = this._normalizedVelocity(hit.velocity);
    const velocityPct = this._velocityPercent(hit.velocity);
    el.style.left = `${hit.startTick * TICK_WIDTH}px`;
    el.style.top = y;
    el.style.height = h;
    el.style.width = width;
    el.style.setProperty('--note-velocity', velocity);
    el.style.setProperty('--note-velocity-alpha', 0.24 + velocity * 0.5);
    el.title = `Shadow ${hit.type} - velocity ${velocityPct}%`;
    el.innerHTML = `<div class="piano-roll__shadow-velocity"></div>`;
    return el;
  },

  _renderNotesForPane(grid, pitchMin, pitchMax) {
    const isDrum = this._snippet?.type === 'drum';

    if (isDrum) {
      const hits = this._snippet.hits || [];
      hits.forEach((hit, idx) => {
        const typeIdx = DRUM_TYPES.findIndex(d => d.id === hit.type);
        if (typeIdx >= pitchMin && typeIdx < pitchMax) {
          const el = this._createHitElementForPane(hit, idx, pitchMax);
          grid.appendChild(el);
        }
      });
      return;
    }

    const notes = this._snippet.notes || [];
    notes.forEach((note, idx) => {
      if (note.pitch >= pitchMin && note.pitch < pitchMax) {
        const el = this._createNoteElementForPane(note, idx, pitchMax);
        grid.appendChild(el);
      }
    });

    const hits = this._snippet.hits || [];
    const pitchMap = { kick: 36, snare: 40, clap: 40, hihat: 44, cymbal: 46 };
    hits.forEach((hit, idx) => {
      const pitch = pitchMap[hit.type] || 38;
      if (pitch >= pitchMin && pitch < pitchMax) {
        const el = this._createHitElementForPane(hit, idx, pitchMax);
        grid.appendChild(el);
      }
    });
  },

  _createNoteElementForPane(note, idx, pitchMax) {
    const x = note.startTick * TICK_WIDTH;
    const w = Math.max(6, note.durationTick * TICK_WIDTH);
    const y = (pitchMax - 1 - note.pitch) * this._noteHeight;
    const velocity = this._normalizedVelocity(note.velocity);
    const velocityPct = this._velocityPercent(note.velocity);

    const el = document.createElement('div');
    el.className = 'piano-roll__note piano-roll__note--midi';
    if (idx === this._selectedNoteIdx) el.classList.add('is-selected');
    el.dataset.noteIdx = idx;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.setProperty('--note-velocity', velocity);
    el.style.setProperty('--note-fill-alpha', 0.28 + velocity * 0.52);
    el.style.setProperty('--note-fill-alpha-soft', 0.18 + velocity * 0.32);
    el.style.setProperty('--note-border-alpha', 0.3 + velocity * 0.45);
    el.title = `${midiToNoteName(note.pitch).display} - velocity ${velocityPct}%`;
    el.innerHTML = `
      <div class="piano-roll__note-velocity"></div>
      <span class="piano-roll__note-velocity-label">${velocityPct}</span>
      <div class="piano-roll__note-resize"></div>
    `;

    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();

      if (e.ctrlKey || e.metaKey) {
        this._selectNote(idx);
        this._deleteSelectedNote();
        return;
      }

      this._selectNote(idx);

      if (e.altKey) {
        this._startNoteResize(e, note, idx, el);
      } else {
        this._startNoteDrag(e, note, idx, el);
      }
    });

    const resizeHandle = el.querySelector('.piano-roll__note-resize');
    resizeHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this._startNoteResize(e, note, idx, el);
    });

    return el;
  },

  _createHitElementForPane(hit, idx, pitchMax) {
    const isDrum = this._snippet?.type === 'drum';
    let y, h;
    if (isDrum) {
      const typeIdx = DRUM_TYPES.findIndex(d => d.id === hit.type);
      const pct = 100 / DRUM_TYPES.length;
      y = `${(DRUM_TYPES.length - 1 - typeIdx) * pct}%`;
      h = `${pct - 0.5}%`;
    } else {
      const pitchMap = { kick: 36, snare: 40, clap: 40, hihat: 44, cymbal: 46 };
      const pitch = pitchMap[hit.type] || 38;
      y = `${(pitchMax - 1 - pitch) * this._noteHeight}px`;
      h = `${this._noteHeight - 2}px`;
    }

    const x = hit.startTick * TICK_WIDTH;
    const el = document.createElement('div');
    el.className = 'piano-roll__note piano-roll__note--drum';
    const velocity = this._normalizedVelocity(hit.velocity);
    const velocityPct = this._velocityPercent(hit.velocity);
    el.dataset.hitIdx = idx;
    el.style.left = `${x}px`;
    el.style.top = y;
    el.style.height = h;
    el.style.width = isDrum ? `${this._drumHitVisualWidth()}px` : `${this._noteHeight - 2}px`;
    el.style.setProperty('--note-velocity', velocity);
    el.style.setProperty('--note-fill-alpha', 0.3 + velocity * 0.5);
    el.style.setProperty('--note-fill-alpha-soft', 0.2 + velocity * 0.3);
    el.style.setProperty('--note-border-alpha', 0.32 + velocity * 0.45);
    el.title = `${hit.type} - velocity ${velocityPct}%`;
    el.innerHTML = `<div class="piano-roll__note-velocity"></div>`;

    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        this._selectedNoteIdx = idx;
        this._deleteSelectedHit();
        return;
      }
      this._selectNote(idx);
      this._startHitDrag(e, hit, idx, el);
    });

    return el;
  },

  _drumHitVisualWidth() {
    return Math.max(18, this._gridSize * TICK_WIDTH - 2);
  },

  _gridLabel() {
    const labels = new Map([
      [960, '1/2'],
      [480, '1/4'],
      [240, '1/8'],
      [120, '1/16'],
    ]);
    return labels.get(this._gridSize) || `${this._gridSize} ticks`;
  },

  _drumLabel(drumType) {
    const label = DRUM_TYPES.find(d => d.id === drumType)?.label || drumType;
    return label
      .toLowerCase()
      .replace(/\b\w/g, char => char.toUpperCase());
  },
};
