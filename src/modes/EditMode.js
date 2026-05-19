/**
 * EditMode — Live Edit / Piano Roll.
 * Per-clip note editor for fine-tuning pitch, timing, duration, and velocity.
 * Supports click-to-add, drag-to-move, resize, delete, velocity editing,
 * vertical zoom, custom octave range, and split dual-pane view.
 */

import './edit.css';
import { NOTE_NAMES, midiToNoteName } from '../engine/MusicTheory.js';
import { showToast } from '../ui/Toast.js';

const TICK_WIDTH = 0.15;
const DEFAULT_NOTE_HEIGHT = 16;
const MIN_NOTE_HEIGHT = 8;
const MAX_NOTE_HEIGHT = 24;
const MIN_PIANO_OCTAVE = 1;
const MAX_PIANO_OCTAVE = 6;

const DRUM_TYPES = [
  { id: 'kick',   label: 'KICK' },
  { id: 'snare',  label: 'SNARE' },
  { id: 'clap',   label: 'CLAP' },
  { id: 'hihat',  label: 'HI-HAT' },
  { id: 'cymbal', label: 'CYMBAL' },
  { id: 'tomlo',  label: 'TOM LO' },
  { id: 'tommid', label: 'TOM MID' },
  { id: 'tomhi',  label: 'TOM HI' },
  { id: 'rim',    label: 'RIM' },
  { id: 'shaker', label: 'SHAKER' },
];

export class EditMode {
  constructor(transport, undoManager, store, project) {
    this.transport = transport;
    this.undoManager = undoManager;
    this.store = store;
    this.project = project;
    this.el = null;

    this.onSnippetRenamed = null;
    this.onSnippetCreated = null;

    this._snippet = null;
    this._clipId = null;

    this._selectedNoteIdx = null;

    this._gridSize = 480;

    this._noteHeight = DEFAULT_NOTE_HEIGHT;
    this._pitchMin = 36;
    this._pitchMax = 84;
    this._pitchRangeInitialized = false;

    this._splitMode = false;

    this._panes = [];
    this._shadowSnippetId = '';
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'edit-mode';
    this.el.style.setProperty('--note-height', `${this._noteHeight}px`);

    if (!this._snippet) {
      this._renderEmpty();
    } else {
      this._renderEditor();
    }

    return this.el;
  }

  loadSnippet(snippet, clipId = null) {
    const snippetChanged = this._snippet?.id !== snippet?.id;
    this._snippet = snippet;
    this._clipId = clipId;
    this._selectedNoteIdx = null;
    if (snippetChanged) this._pitchRangeInitialized = false;

    this.el.innerHTML = '';
    if (this._snippet) {
      if (this._snippet.type === 'audio') {
        this._renderAudioPlayer();
      } else {
        this._renderEditor();
      }
    } else {
      this._renderEmpty();
    }
  }

  _renderAudioPlayer() {
    const immediateSource = this._snippet.audioDataUrl || this._snippet.audioUrl || '';
    const unavailable = this._snippet.audioUnavailable || (!immediateSource && !this._snippet.audioAssetId);
    this.el.innerHTML = `
      <div class="edit-audio">
        <div class="edit-audio__header">
          <span class="edit-audio__title">🎤 ${this._snippet.name || 'Audio'}</span>
        </div>
        <div class="edit-audio__body">
          <audio class="edit-audio__player" controls src="${immediateSource}"></audio>
          <p class="edit-audio__status">${unavailable ? (this._snippet.audioUnavailableReason || 'Audio data unavailable') : ''}</p>
          <p class="edit-audio__meta">
            BPM: ${this._snippet.bpm} · 
            Duration: ${(this._snippet.durationTicks / 480).toFixed(1)} beats
          </p>
        </div>
      </div>
    `;
    this._resolveAudioPlayerSource();
  }

  async _resolveAudioPlayerSource() {
    if (!this._snippet?.audioAssetId || !this.store?.getAudioAssetObjectUrl) return;
    const player = this.el.querySelector('.edit-audio__player');
    const status = this.el.querySelector('.edit-audio__status');
    try {
      const url = await this.store.getAudioAssetObjectUrl(this._snippet.audioAssetId);
      if (!url) {
        if (status) status.textContent = 'Audio data unavailable';
        this._snippet.audioUnavailable = true;
        return;
      }
      if (player && this._snippet?.audioAssetId) {
        player.src = url;
        if (status) status.textContent = '';
      }
    } catch (err) {
      console.warn('[EditMode] Audio preview failed:', err);
      if (status) status.textContent = 'Audio preview failed';
    }
  }

  _renderEmpty() {
    const snippets = (this.project?.snippets || []).filter(s => s.type !== 'audio');
    const options = snippets.length === 0
      ? '<option value="">No snippets yet</option>'
      : '<option value="">Select a snippet...</option>' +
        snippets.map(s => {
          const count = (s.notes?.length || 0) + (s.hits?.length || 0);
          const icon = s.type === 'drum' ? '🥁' : '🎵';
          const label = s.name || `${count} ${s.type === 'drum' ? 'hits' : 'notes'}`;
          return `<option value="${s.id}">${icon} ${label}</option>`;
        }).join('');

    this.el.innerHTML = `
      <div class="edit-empty">
        <div class="edit-empty__icon">✏️</div>
        <h2 class="edit-empty__title">Inspect</h2>
        <p class="edit-empty__desc">Select a snippet to view or edit its notes, or make a blank one here.</p>
        <div class="edit-empty__actions">
          <button class="btn btn--ghost edit-toolbar__btn" id="edit-new-midi" type="button">New MIDI Clip</button>
          <button class="btn btn--ghost edit-toolbar__btn" id="edit-new-drum" type="button">New Drum Clip</button>
        </div>
        <select class="edit-empty__select" id="edit-empty-select" aria-label="Select snippet">
          ${options}
        </select>
      </div>
    `;

    this.el.querySelector('#edit-empty-select')?.addEventListener('change', (e) => {
      const id = e.target.value;
      if (!id) return;
      const snippet = this.project?.snippets?.find(s => s.id === id);
      if (snippet) this.loadSnippet(snippet);
    });
    this.el.querySelector('#edit-new-midi')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._createBlankSnippet('midi');
    });
    this.el.querySelector('#edit-new-drum')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._createBlankSnippet('drum');
    });
  }

  _createBlankSnippet(type = 'midi') {
    if (!this.project) return;
    if (!Array.isArray(this.project.snippets)) this.project.snippets = [];
    const isDrum = type === 'drum';
    const snippet = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      type: isDrum ? 'drum' : 'midi',
      name: isDrum ? 'New Drum Clip' : 'New MIDI Clip',
      notes: [],
      hits: [],
      durationTicks: this.transport?.ticksPerBar || ((this.transport?.ticksPerBeat || 480) * (this.transport?.timeSignature?.beats || 4)),
      bpm: this.transport?.bpm || this.project.bpm || 120,
      timeSignature: { ...(this.transport?.timeSignature || this.project.timeSignature || { beats: 4, subdivision: 4 }) },
    };
    this.project.snippets.push(snippet);
    this.store?.scheduleAutoSave(this.project);
    this.onSnippetCreated?.(snippet);
    this.loadSnippet(snippet);
    showToast(`${isDrum ? 'Drum' : 'MIDI'} clip created`);
  }

  _renderEditor() {
    this._panes = [];
    const isDrum = this._snippet.type === 'drum';
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
  }

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

    return `
      <div class="edit-toolbar__group">
        <input type="text" class="edit-toolbar__name-input" id="edit-snippet-name" value="${this._snippet.name || 'Snippet'}" placeholder="Snippet name" title="Edit snippet name" />
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--tiny" id="edit-double-btn" title="Double snippet length">2x</button>
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--tiny" id="edit-half-btn" title="Halve snippet length">1/2</button>
        <span class="edit-toolbar__value">${noteCount} ${isDrum ? 'hits' : 'notes'}</span>
      </div>
      <div class="edit-toolbar__group">
        <button class="btn btn--ghost edit-toolbar__btn" id="edit-new-midi-toolbar" type="button">New MIDI</button>
        <button class="btn btn--ghost edit-toolbar__btn" id="edit-new-drum-toolbar" type="button">New Drum</button>
      </div>
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Load</span>
        <select class="edit-toolbar__select edit-toolbar__select--clip" id="edit-load-clip-select" aria-label="Load editable clip">
          ${this._renderEditableClipOptions()}
        </select>
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
      <button class="btn btn--ghost edit-toolbar__btn${this._splitMode ? ' is-active' : ''}" id="edit-split-btn" title="Split view">Split</button>
      ${quantizeAllHTML}
      <div class="edit-toolbar__spacer"></div>
      <div class="edit-toolbar__group">
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--danger" id="edit-delete-btn">Delete ${isDrum ? 'Hit' : 'Note'}</button>
      </div>
    `;
  }

  _renderEditableClipOptions() {
    const snippets = (this.project?.snippets || []).filter(s => s?.type === 'midi' || s?.type === 'drum');
    if (!snippets.length) return '<option value="">No editable clips</option>';
    return snippets.map(s => {
      const count = (s.notes?.length || 0) + (s.hits?.length || 0);
      const type = s.type === 'drum' ? 'Drum' : 'MIDI';
      const label = s.name || `${type} clip`;
      const selected = s.id === this._snippet?.id ? 'selected' : '';
      return `<option value="${s.id}" ${selected}>${type}: ${label} (${count})</option>`;
    }).join('');
  }

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
  }

  _shadowCandidates(isDrum = this._snippet?.type === 'drum') {
    const snippets = (this.project?.snippets || []).filter(s => {
      if (!s || s.id === this._snippet?.id || s.type === 'audio') return false;
      if (isDrum) return s.type === 'drum';
      return s.type === 'midi' || s.type === 'drum';
    });
    return snippets;
  }

  _selectedShadowSnippet() {
    if (!this._shadowSnippetId || !this.project?.snippets) return null;
    if (this._shadowSnippetId === this._snippet?.id) return null;
    const shadow = this.project.snippets.find(s => s.id === this._shadowSnippetId);
    if (!shadow || shadow.type === 'audio') return null;
    if (this._snippet?.type === 'drum' && shadow.type !== 'drum') return null;
    return shadow;
  }

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

    if (!isDrum) {
      const ruler = this._renderRuler();
      gridWrapper.appendChild(ruler);
    }

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
  }

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
  }

  _renderRuler() {
    const el = document.createElement('div');
    el.className = 'piano-roll__ruler';

    const duration = this._displayDurationTicks();
    const width = duration * TICK_WIDTH;
    el.style.width = `${width}px`;
    el.style.minWidth = '100%';

    const ticksPerBeat = 480;
    const beatsPerBar = this._beatsPerBar();
    let html = '';
    for (let tick = 0; tick < duration; tick += ticksPerBeat) {
      const x = tick * TICK_WIDTH;
      const beat = tick / ticksPerBeat;
      const bar = Math.floor(beat / beatsPerBar) + 1;
      const beatInBar = (beat % beatsPerBar) + 1;
      const label = beatInBar === 1 ? `${bar}` : `${bar}.${beatInBar}`;
      html += `<span class="piano-roll__ruler-label" style="left:${x}px">${label}</span>`;
    }
    el.innerHTML = html;
    return el;
  }

  _displayDurationTicks() {
    const ticksPerBeat = this.transport?.ticksPerBeat || 480;
    const beatsPerBar = this._beatsPerBar();
    const minimumTicks = ticksPerBeat * beatsPerBar * 4;
    return Math.max(this._snippet?.durationTicks || ticksPerBeat * beatsPerBar, minimumTicks);
  }

  _beatsPerBar() {
    return Math.max(
      1,
      this._snippet?.timeSignature?.beats ||
      this.transport?.timeSignature?.beats ||
      this.project?.timeSignature?.beats ||
      4
    );
  }

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
    const ticksPerBar = ticksPerBeat * this._beatsPerBar();
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
  }

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
      if (note.pitch >= pitchMin && note.pitch < pitchMax) {
        grid.appendChild(this._createShadowNoteElementForPane(note, pitchMax));
      }
    });
  }

  _createShadowNoteElementForPane(note, pitchMax) {
    const x = note.startTick * TICK_WIDTH;
    const w = Math.max(6, (note.durationTick || this._gridSize) * TICK_WIDTH);
    const y = (pitchMax - 1 - note.pitch) * this._noteHeight;

    const el = document.createElement('div');
    el.className = 'piano-roll__shadow-note piano-roll__shadow-note--midi';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.title = 'Shadow MIDI note';
    return el;
  }

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
      width = '10px';
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
    el.style.left = `${hit.startTick * TICK_WIDTH}px`;
    el.style.top = y;
    el.style.height = h;
    el.style.width = width;
    el.title = `Shadow ${hit.type}`;
    return el;
  }

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
  }

  _createNoteElementForPane(note, idx, pitchMax) {
    const x = note.startTick * TICK_WIDTH;
    const w = Math.max(6, note.durationTick * TICK_WIDTH);
    const y = (pitchMax - 1 - note.pitch) * this._noteHeight;

    const el = document.createElement('div');
    el.className = 'piano-roll__note piano-roll__note--midi';
    if (idx === this._selectedNoteIdx) el.classList.add('is-selected');
    el.dataset.noteIdx = idx;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;

    const velHeight = Math.max(1, (note.velocity || 0.8) * 2);
    el.innerHTML = `
      <div class="piano-roll__note-velocity" style="height:${velHeight}px;"></div>
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
  }

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
    el.dataset.hitIdx = idx;
    el.style.left = `${x}px`;
    el.style.top = y;
    el.style.height = h;
    el.style.width = isDrum ? '8px' : `${this._noteHeight - 2}px`;
    el.style.borderRadius = isDrum ? '4px' : '';
    el.title = hit.type;

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
  }

  _selectNote(idx) {
    this._selectedNoteIdx = idx;
    this.el.querySelectorAll('.piano-roll__note').forEach(n => {
      const isSel = n.dataset.noteIdx == idx || n.dataset.hitIdx == idx;
      n.classList.toggle('is-selected', isSel);
    });
    this._syncVelocityControl();
  }

  _selectedEditableEvent() {
    if (this._selectedNoteIdx === null || !this._snippet) return null;
    if (this._snippet.type === 'drum') {
      return this._snippet.hits?.[this._selectedNoteIdx] || null;
    }
    return this._snippet.notes?.[this._selectedNoteIdx] || null;
  }

  _syncVelocityControl() {
    const range = this.el?.querySelector('#edit-velocity-range');
    const value = this.el?.querySelector('#edit-velocity-value');
    if (!range || !value) return;
    const event = this._selectedEditableEvent();
    if (!event) {
      range.disabled = true;
      value.textContent = '--';
      return;
    }
    const velocity = Math.round(Math.max(0.01, Math.min(1, event.velocity ?? 0.8)) * 100);
    range.disabled = false;
    range.value = String(velocity);
    value.textContent = String(velocity);
  }

  _deleteSelectedHit() {
    if (this._selectedNoteIdx === null || !this._snippet?.hits) return;
    const hits = this._snippet.hits;
    if (this._selectedNoteIdx >= hits.length) return;
    const beforeState = this._snapshotSnippetState();
    hits.splice(this._selectedNoteIdx, 1);
    this._selectedNoteIdx = null;
    this._onEdit('Delete hit', beforeState);
    showToast('Hit deleted');
  }

  _startHitDrag(e, hit, idx, el) {
    const startX = e.clientX;
    const startY = e.clientY;
    const origTick = hit.startTick;
    const beforeState = this._snapshotSnippetState();
    const isDrum = this._snippet?.type === 'drum';
    const origTypeIdx = isDrum ? DRUM_TYPES.findIndex(d => d.id === hit.type) : 0;
    const rowH = isDrum ? (el.closest('.piano-roll__grid-container')?.clientHeight || 400) / DRUM_TYPES.length : this._noteHeight;

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      const deltaTick = Math.round(dx / TICK_WIDTH / this._gridSize) * this._gridSize;
      const newTick = Math.max(0, origTick + deltaTick);
      el.style.left = `${newTick * TICK_WIDTH}px`;
      if (isDrum) {
        const deltaRow = Math.round(dy / rowH);
        const newTypeIdx = Math.max(0, Math.min(DRUM_TYPES.length - 1, origTypeIdx - deltaRow));
        el.style.top = `${(DRUM_TYPES.length - 1 - newTypeIdx) * (100 / DRUM_TYPES.length)}%`;
      }
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const finalLeft = parseFloat(el.style.left);
      const newTick = Math.round(finalLeft / TICK_WIDTH / this._gridSize) * this._gridSize;

      if (isDrum) {
        const finalTop = parseFloat(el.style.top);
        const finalPct = finalTop / (100 / DRUM_TYPES.length);
        const newTypeIdx = DRUM_TYPES.length - 1 - Math.round(finalPct);
        const newType = DRUM_TYPES[Math.max(0, Math.min(DRUM_TYPES.length - 1, newTypeIdx))];
        const changed = newTick !== origTick || (newType && newType.id !== hit.type);
        if (newTick !== origTick) hit.startTick = Math.max(0, newTick);
        if (newType && newType.id !== hit.type) {
          hit.type = newType.id;
          el.title = newType.id;
        }
        if (changed) {
          this._onEdit('Move hit', beforeState);
        }
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  _paneForPitch(pitch) {
    for (const pane of this._panes) {
      if (pitch >= pane.pitchMin && pitch < pane.pitchMax) return pane;
    }
    return this._panes[0];
  }

  _startNoteDrag(e, note, idx, el) {
    const startX = e.clientX;
    const startY = e.clientY;
    const origTick = note.startTick;
    const origPitch = note.pitch;
    const beforeState = this._snapshotSnippetState();

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;

      const deltaTick = Math.round(dx / TICK_WIDTH / this._gridSize) * this._gridSize;
      const deltaPitch = -Math.round(dy / this._noteHeight);

      const newTick = Math.max(0, origTick + deltaTick);
      const newPitch = Math.max(this._pitchMin, Math.min(this._pitchMax - 1, origPitch + deltaPitch));

      el.style.left = `${newTick * TICK_WIDTH}px`;
      el.style.top = `${(this._pitchMax - 1 - newPitch) * this._noteHeight}px`;
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const finalLeft = parseFloat(el.style.left);
      const finalTop = parseFloat(el.style.top);
      const newTick = Math.round(finalLeft / TICK_WIDTH / this._gridSize) * this._gridSize;
      const newPitch = this._pitchMax - 1 - Math.round(finalTop / this._noteHeight);

      if (newTick !== origTick || newPitch !== origPitch) {
        note.startTick = Math.max(0, newTick);
        note.pitch = Math.max(this._pitchMin, Math.min(this._pitchMax - 1, newPitch));
        this._onEdit('Move note', beforeState);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  _startNoteResize(e, note, idx, el) {
    const startX = e.clientX;
    const origDuration = note.durationTick;
    const beforeState = this._snapshotSnippetState();

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const deltaTick = Math.round(dx / TICK_WIDTH / this._gridSize) * this._gridSize;
      const newDuration = Math.max(this._gridSize, origDuration + deltaTick);
      el.style.width = `${newDuration * TICK_WIDTH}px`;
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const finalWidth = parseFloat(el.style.width);
      const newDuration = Math.max(this._gridSize, Math.round(finalWidth / TICK_WIDTH / this._gridSize) * this._gridSize);

      if (newDuration !== origDuration) {
        note.durationTick = newDuration;
        this._onEdit('Resize note', beforeState);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  _bindEvents(toolbar) {
    toolbar.querySelector('#edit-grid-select')?.addEventListener('change', (e) => {
      this._gridSize = parseInt(e.target.value, 10);
      this._rebuildGrids();
    });

    toolbar.querySelector('#edit-shadow-select')?.addEventListener('change', (e) => {
      this._shadowSnippetId = e.target.value || '';
      this._rebuildGrids();
    });

    toolbar.querySelector('#edit-load-clip-select')?.addEventListener('change', (e) => {
      const id = e.target.value;
      if (!id || id === this._snippet?.id) return;
      const snippet = this.project?.snippets?.find(s => s.id === id && (s.type === 'midi' || s.type === 'drum'));
      if (!snippet) return;
      this.loadSnippet(snippet);
      showToast('Loaded clip in Inspect');
    });

    toolbar.querySelector('#edit-velocity-range')?.addEventListener('input', (e) => {
      const event = this._selectedEditableEvent();
      if (!event) return;
      const velocity = Math.max(0.01, Math.min(1, Number(e.target.value) / 100));
      event.velocity = velocity;
      const value = toolbar.querySelector('#edit-velocity-value');
      if (value) value.textContent = e.target.value;
      this._rebuildGrids();
      this.store?.scheduleAutoSave(this.project);
    });

    const nameInput = toolbar.querySelector('#edit-snippet-name');
    if (nameInput) {
      const saveName = () => {
        const newName = nameInput.value.trim() || 'Snippet';
        if (this._snippet && this._snippet.name !== newName) {
          this._snippet.name = newName;
          this.store?.scheduleAutoSave(this.project);
          if (this.onSnippetRenamed) this.onSnippetRenamed(this._snippet);
          showToast('Snippet renamed');
        }
      };
      nameInput.addEventListener('blur', saveName);
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          nameInput.blur();
        }
      });
    }

    toolbar.querySelector('#edit-delete-btn')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._deleteSelectedNote();
    });

    toolbar.querySelector('#edit-new-midi-toolbar')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._createBlankSnippet('midi');
    });

    toolbar.querySelector('#edit-new-drum-toolbar')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._createBlankSnippet('drum');
    });

    toolbar.querySelector('#edit-double-btn')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._setDuration(this._snippet ? this._snippet.durationTicks * 2 : 1920);
    });

    toolbar.querySelector('#edit-half-btn')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._setDuration(this._snippet ? Math.max(480, Math.floor(this._snippet.durationTicks / 2)) : 960);
    });

    toolbar.querySelector('#edit-zoom-out')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this._noteHeight > MIN_NOTE_HEIGHT) {
        this._noteHeight -= 4;
        this.el.style.setProperty('--note-height', `${this._noteHeight}px`);
        this._rebuildAll();
      }
    });

    toolbar.querySelector('#edit-zoom-in')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this._noteHeight < MAX_NOTE_HEIGHT) {
        this._noteHeight += 4;
        this.el.style.setProperty('--note-height', `${this._noteHeight}px`);
        this._rebuildAll();
      }
    });

    toolbar.querySelector('#edit-oct-low')?.addEventListener('change', (e) => {
      const oct = parseInt(e.target.value, 10);
      const newMin = (oct + 1) * 12;
      if (newMin < this._pitchMax) {
        this._pitchMin = newMin;
        this._rebuildAll();
      }
    });

    toolbar.querySelector('#edit-oct-high')?.addEventListener('change', (e) => {
      const oct = parseInt(e.target.value, 10);
      const newMax = (oct + 1) * 12;
      if (newMax > this._pitchMin) {
        this._pitchMax = newMax;
        this._rebuildAll();
      }
    });

    toolbar.querySelector('#edit-split-btn')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._splitMode = !this._splitMode;
      const btn = toolbar.querySelector('#edit-split-btn');
      btn.classList.toggle('is-active', this._splitMode);
      showToast(this._splitMode ? 'Split view enabled' : 'Split view disabled');
      this._rebuildAll();
    });

    toolbar.querySelector('#edit-quantize-all-btn')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._quantizeAllNoteDurations();
    });

    this._panes.forEach(pane => {
      pane.gridContainer.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.piano-roll__note')) return;

        const rect = pane.gridEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const tick = Math.floor(x / TICK_WIDTH / this._gridSize) * this._gridSize;
        const isDrum = this._snippet?.type === 'drum';
        let pitch;
        if (isDrum) {
          const rowH = pane.gridContainer.clientHeight / DRUM_TYPES.length;
          pitch = pane.pitchMax - 1 - Math.floor(y / rowH);
        } else {
          pitch = pane.pitchMax - 1 - Math.floor(y / this._noteHeight);
        }

        if (pitch >= pane.pitchMin && pitch < pane.pitchMax && tick >= 0) {
          if (this._snippet?.type === 'drum') {
            const drumType = DRUM_TYPES[pitch];
            if (drumType) this._addHit(tick, drumType.id);
          } else {
            this._addNote(tick, pitch);
          }
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if ((e.code === 'Delete' || e.code === 'Backspace') && this._selectedNoteIdx !== null) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (this.el.closest('.mode-view.is-active')) {
          e.preventDefault();
          this._deleteSelectedNote();
        }
      }
    });
  }

  _addNote(startTick, pitch) {
    if (!this._snippet) return;
    if (!this._snippet.notes) this._snippet.notes = [];
    const existingIdx = this._snippet.notes.findIndex(n => n.startTick === startTick && n.pitch === pitch);
    if (existingIdx >= 0) {
      this._selectNote(existingIdx);
      showToast('Note already exists there');
      return;
    }
    const beforeState = this._snapshotSnippetState();

    const note = {
      pitch,
      startTick,
      durationTick: this._gridSize,
      velocity: 0.8,
    };

    this._snippet.notes.push(note);
    this._selectedNoteIdx = this._snippet.notes.length - 1;
    this._onEdit('Add note', beforeState);
    showToast(`Added ${midiToNoteName(pitch).display}`);
  }

  _addHit(startTick, drumType) {
    if (!this._snippet) return;
    if (!this._snippet.hits) this._snippet.hits = [];
    const existingIdx = this._snippet.hits.findIndex(h => h.startTick === startTick && h.type === drumType);
    if (existingIdx >= 0) {
      this._selectNote(existingIdx);
      showToast('Hit already exists there');
      return;
    }
    const beforeState = this._snapshotSnippetState();

    const hit = {
      type: drumType,
      startTick,
      velocity: 0.8,
    };

    this._snippet.hits.push(hit);
    this._selectedNoteIdx = this._snippet.hits.length - 1;
    this._onEdit('Add hit', beforeState);
    showToast(`Added ${drumType}`);
  }

  _deleteSelectedNote() {
    if (this._selectedNoteIdx === null || !this._snippet) return;
    if (this._snippet.type === 'drum') {
      this._deleteSelectedHit();
      return;
    }
    if (!this._snippet.notes) return;
    if (this._selectedNoteIdx >= this._snippet.notes.length) return;

    const beforeState = this._snapshotSnippetState();
    this._snippet.notes.splice(this._selectedNoteIdx, 1);
    this._selectedNoteIdx = null;
    this._onEdit('Delete note', beforeState);
    showToast('Note deleted');
  }

  _quantizeAllNoteDurations() {
    const notes = this._snippet?.notes || [];
    if (notes.length === 0) {
      showToast('No notes to quantize');
      return;
    }

    const beforeState = this._snapshotSnippetState();
    let changed = 0;
    for (const note of notes) {
      if (note.durationTick !== this._gridSize) {
        note.durationTick = this._gridSize;
        changed++;
      }
    }

    if (changed === 0) {
      showToast('Notes already match grid');
      return;
    }

    this._onEdit('Quantize all note durations', beforeState);
    showToast(`Quantized ${notes.length} notes to ${this._gridLabel()}`);
  }

  _gridLabel() {
    const labels = new Map([
      [960, '1/2'],
      [480, '1/4'],
      [240, '1/8'],
      [120, '1/16'],
    ]);
    return labels.get(this._gridSize) || `${this._gridSize} ticks`;
  }

  adjustVisibleKeyCount(direction) {
    if (!this._snippet || this._snippet.type === 'drum' || this._snippet.type === 'audio') return false;

    let lowOct = Math.floor(this._pitchMin / 12) - 1;
    let highOct = Math.floor(this._pitchMax / 12) - 1;
    const currentSpan = highOct - lowOct;

    if (direction > 0) {
      if (highOct < MAX_PIANO_OCTAVE) {
        highOct += 1;
      } else if (lowOct > MIN_PIANO_OCTAVE) {
        lowOct -= 1;
      } else {
        showToast('Piano range maxed');
        return false;
      }
    } else if (currentSpan > 1) {
      highOct -= 1;
    } else {
      showToast('Piano range minimum');
      return false;
    }

    this._pitchMin = (lowOct + 1) * 12;
    this._pitchMax = (highOct + 1) * 12;
    this._pitchRangeInitialized = true;
    this._rebuildAll();
    showToast(`Piano range C${lowOct} to C${highOct}`);
    return true;
  }

  _cloneForUndo(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  _snapshotSnippetState() {
    if (!this._snippet) return null;
    return {
      name: this._snippet.name,
      notes: this._cloneForUndo(this._snippet.notes || []),
      hits: this._cloneForUndo(this._snippet.hits || []),
      modulation: this._cloneForUndo(this._snippet.modulation || []),
      durationTicks: this._snippet.durationTicks,
    };
  }

  _restoreSnippetState(state) {
    if (!this._snippet || !state) return;
    this._snippet.name = state.name;
    this._snippet.notes = this._cloneForUndo(state.notes || []);
    this._snippet.hits = this._cloneForUndo(state.hits || []);
    this._snippet.modulation = this._cloneForUndo(state.modulation || []);
    this._snippet.durationTicks = state.durationTicks;
    this._selectedNoteIdx = null;
    this._rebuildAll();
    this.store?.scheduleAutoSave(this.project);
    if (this.onSnippetRenamed) this.onSnippetRenamed(this._snippet);
  }

  _onEdit(description, beforeState = null) {
    this._updateSnippetDuration();
    const afterState = this._snapshotSnippetState();

    if (beforeState && afterState && JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      this.undoManager?.push({
        type: 'editSnippet',
        description,
        undo: () => this._restoreSnippetState(beforeState),
        redo: () => this._restoreSnippetState(afterState),
      });
    }

    this._rebuildGrids();

    const count = (this._snippet.notes?.length || 0) + (this._snippet.hits?.length || 0);
    const isDrum = this._snippet?.type === 'drum';

    const countEl = this.el.querySelector('.edit-toolbar__value');
    if (countEl) {
      countEl.textContent = `${count} ${isDrum ? 'hits' : 'notes'}`;
    }

    if (this._snippet?.name && /^\d+\s+(notes|hits)$/.test(this._snippet.name)) {
      this._snippet.name = `${count} ${isDrum ? 'hits' : 'notes'}`;
      const nameInput = this.el.querySelector('#edit-snippet-name');
      if (nameInput) nameInput.value = this._snippet.name;
    }

    this.store?.scheduleAutoSave(this.project);
  }

  _updateSnippetDuration() {
    if (!this._snippet) return;
    let maxEnd = 480;
    for (const n of (this._snippet.notes || [])) {
      const end = n.startTick + n.durationTick;
      if (end > maxEnd) maxEnd = end;
    }
    for (const h of (this._snippet.hits || [])) {
      if (h.startTick > maxEnd) maxEnd = h.startTick;
    }
    const ticksPerBeat = 480;
    this._snippet.durationTicks = Math.ceil((maxEnd + ticksPerBeat) / ticksPerBeat) * ticksPerBeat;
  }

  _setDuration(newDuration) {
    if (!this._snippet) return;
    const beforeState = this._snapshotSnippetState();
    const beats = this.transport?.ticksPerBeat || 480;
    const durationTicks = Math.max(480, Math.ceil(newDuration / beats) * beats);
    this._snippet.durationTicks = durationTicks;

    const removed = [];
    if (this._snippet.notes) {
      this._snippet.notes = this._snippet.notes.filter(n => {
        if (n.startTick >= durationTicks) { removed.push('note'); return false; }
        return true;
      });
    }
    if (this._snippet.hits) {
      this._snippet.hits = this._snippet.hits.filter(h => {
        if (h.startTick >= durationTicks) { removed.push('hit'); return false; }
        return true;
      });
    }
    if (this._selectedNoteIdx !== null && this._selectedNoteIdx >= (this._snippet.notes?.length || 0) + (this._snippet.hits?.length || 0)) {
      this._selectedNoteIdx = null;
    }

    const afterState = this._snapshotSnippetState();
    if (beforeState && afterState && JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      this.undoManager?.push({
        type: 'setSnippetDuration',
        description: 'Set snippet duration',
        undo: () => this._restoreSnippetState(beforeState),
        redo: () => this._restoreSnippetState(afterState),
      });
    }

    this._rebuildAll();
    this.store?.scheduleAutoSave(this.project);
    const msg = removed.length ? `${(this._snippet.durationTicks / 480).toFixed(0)} beats · removed ${removed.length}` : `${(this._snippet.durationTicks / 480).toFixed(0)} beats`;
    showToast(msg);
  }

  _rebuildGrids() {
    this._panes.forEach(pane => {
      const newGrid = this._renderGridForRange(pane.pitchMin, pane.pitchMax, pane.paneId);
      pane.gridContainer.replaceChild(newGrid, pane.gridEl);
      pane.gridEl = newGrid;
    });
  }

  _rebuildAll() {
    this.el.innerHTML = '';
    this._renderEditor();
  }
}
