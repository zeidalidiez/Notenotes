/**
 * EditMode — Live Edit / Piano Roll.
 * Per-clip note editor for fine-tuning pitch, timing, duration, and velocity.
 * Supports click-to-add, drag-to-move, resize, delete, velocity editing,
 * vertical zoom, custom octave range, and split dual-pane view.
 */

import './edit.css';
import { NOTE_NAMES, midiToNoteName } from '../engine/MusicTheory.js';
import { pulseCountForMeter, pulseTicksForMeter, ticksPerBarForMeter } from '../engine/Meter.js';
import { fitRhythmEvents, RHYTHM_FIT_MODES } from '../engine/RhythmFit.js';
import { showToast } from '../ui/Toast.js';
import { renderToneBadges, toneBadgeItemsFromSources } from '../ui/ToneBadges.js';

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
    this._rhythmFitPreviewState = null;
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

  refreshSnippetList() {
    if (!this.el) return;
    if (this._snippet && !this.project?.snippets?.some(s => s.id === this._snippet?.id)) {
      this.loadSnippet(null);
      return;
    }
    if (!this._snippet) {
      this._renderEmpty();
      return;
    }
    const select = this.el.querySelector('#edit-load-clip-select');
    if (select) {
      select.innerHTML = this._renderClipOptions();
      select.value = this._snippet.id || '';
    }
  }

  _renderAudioPlayer() {
    this._panes = [];
    const immediateSource = this._snippet.audioDataUrl || this._snippet.audioUrl || '';
    const unavailable = this._snippet.audioUnavailable || (!immediateSource && !this._snippet.audioAssetId);
    const toolbar = document.createElement('div');
    toolbar.className = 'edit-toolbar';
    toolbar.innerHTML = this._buildAudioToolbarHTML();
    this.el.appendChild(toolbar);

    const audioEl = document.createElement('div');
    audioEl.className = 'edit-audio';
    audioEl.innerHTML = `
      <div class="edit-audio__body">
        <audio class="edit-audio__player" controls src="${immediateSource}"></audio>
        <p class="edit-audio__status">${unavailable ? (this._snippet.audioUnavailableReason || 'Audio data unavailable') : ''}</p>
        <p class="edit-audio__meta">
          BPM: ${this._snippet.bpm} ·
          Duration: ${(this._snippet.durationTicks / 480).toFixed(1)} beats
        </p>
      </div>
    `;
    this.el.appendChild(audioEl);
    this._bindAudioPlayerEvents(toolbar);
    this._resolveAudioPlayerSource();
  }

  _buildAudioToolbarHTML() {
    const name = this._escapeAttr(this._snippet.name || 'Audio');
    return `
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Load</span>
        <select class="edit-toolbar__select edit-toolbar__select--clip" id="edit-load-clip-select" aria-label="Load clip">
          ${this._renderClipOptions()}
        </select>
      </div>
      <div class="edit-toolbar__group">
        <input type="text" class="edit-toolbar__name-input" id="edit-snippet-name" value="${name}" placeholder="Audio clip name" title="Edit audio clip name" />
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--tiny" type="button" title="Audio length is set by the recording" disabled>2x</button>
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--tiny" type="button" title="Audio length is set by the recording" disabled>1/2</button>
        <span class="edit-toolbar__value">Audio</span>
      </div>
      <div class="edit-toolbar__group">
        <button class="btn btn--ghost edit-toolbar__btn" id="edit-new-midi-toolbar" type="button">New MIDI</button>
        <button class="btn btn--ghost edit-toolbar__btn" id="edit-new-drum-toolbar" type="button">New Drum</button>
      </div>
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Grid</span>
        <select class="edit-toolbar__select" aria-label="Grid size unavailable for audio" disabled>
          <option>Audio</option>
        </select>
        <span class="edit-toolbar__label">Shadow</span>
        <select class="edit-toolbar__select edit-toolbar__select--shadow" aria-label="Shadow unavailable for audio" disabled>
          <option>Off</option>
        </select>
      </div>
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Velocity</span>
        <input class="edit-toolbar__velocity" type="range" min="1" max="100" value="0" aria-label="Velocity unavailable for audio" disabled />
        <span class="edit-toolbar__velocity-value">--</span>
      </div>
      <button class="btn btn--ghost edit-toolbar__btn" type="button" title="Split view is for MIDI note ranges" disabled>Split</button>
      <button class="btn btn--ghost edit-toolbar__btn" type="button" title="Quantize all is for MIDI notes" disabled>Quantize all</button>
      <div class="edit-toolbar__spacer"></div>
      <div class="edit-toolbar__group">
        <button class="btn btn--ghost edit-toolbar__btn edit-toolbar__btn--danger" type="button" title="Select a MIDI note or drum hit to delete" disabled>Delete Event</button>
      </div>
    `;
  }

  _bindAudioPlayerEvents(toolbar = this.el) {
    const input = toolbar.querySelector('#edit-snippet-name');
    if (input) {
      const saveName = () => {
        const name = input.value.trim() || 'Audio';
        if (!this._snippet || this._snippet.name === name) return;
        this._snippet.name = name;
        this.store?.scheduleAutoSave(this.project);
        this.onSnippetRenamed?.(this._snippet);
        showToast('Audio clip renamed');
      };
      input.addEventListener('blur', saveName);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    }
    toolbar.querySelector('#edit-load-clip-select')?.addEventListener('change', (e) => {
      this._loadSnippetById(e.target.value);
    });
    toolbar.querySelector('#edit-new-midi-toolbar')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._createBlankSnippet('midi');
    });
    toolbar.querySelector('#edit-new-drum-toolbar')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._createBlankSnippet('drum');
    });
  }


  _escapeAttr(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
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
    const snippets = (this.project?.snippets || []);
    const options = snippets.length === 0
      ? '<option value="">No snippets yet</option>'
      : '<option value="">Select a snippet...</option>' +
        snippets.map(s => {
          const count = (s.notes?.length || 0) + (s.hits?.length || 0);
          const icon = s.type === 'drum' ? '🥁' : '🎵';
          const label = s.name || `${count} ${s.type === 'drum' ? 'hits' : 'notes'}`;
          return `<option value="${s.id}">${s.type === 'audio' ? 'Audio' : icon} ${s.type === 'audio' ? (s.name || 'Audio clip') : label}</option>`;
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
      this._loadSnippetById(e.target.value);
    });
    this.el.querySelector('#edit-new-midi')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._createBlankSnippet('midi');
    });
    this.el.querySelector('#edit-new-drum')?.addEventListener('click', (e) => {
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
      meter: { ...(this.transport?.meter || this.project.meter || { type: 'metered', id: '4/4', numerator: 4, denominator: 4, pulse: 'quarter', pulseCount: 4, grouping: [1, 1, 1, 1], feelName: 'Standard' }) },
      timeSignature: { ...(this.transport?.timeSignature || this.project.timeSignature || { beats: 4, subdivision: 4 }) },
    };
    this.project.snippets.push(snippet);
    this.store?.scheduleAutoSave(this.project);
    this.onSnippetCreated?.(snippet);
    window.dispatchEvent(new CustomEvent('project-snippets-changed', {
      detail: { snippetId: snippet.id, action: 'created' },
    }));
    this.loadSnippet(snippet);
    showToast(`${isDrum ? 'Drum' : 'MIDI'} clip created`);
  }

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
  }

  _renderToneBadges() {
    const clip = this._findLoadedClip();
    const snippet = this._snippet;
    const items = toneBadgeItemsFromSources([
      clip?.soundTraits || snippet?.soundTraits || {},
      ...(snippet?.notes || []).map(note => note.soundTraits || {}),
      ...(snippet?.hits || []).map(hit => hit.soundTraits || {}),
    ]);
    return renderToneBadges(items, 'edit-toolbar__tone-badges tone-badges');
  }

  _findLoadedClip() {
    if (!this._clipId) return null;
    for (const track of this.project?.tracks || []) {
      const clip = (track.clips || []).find(item => item.id === this._clipId);
      if (clip) return clip;
    }
    return null;
  }

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
  }

  _loadSnippetById(id) {
    if (!id || id === this._snippet?.id) return;
    const snippet = this.project?.snippets?.find(s => s.id === id);
    if (!snippet) return;
    this.loadSnippet(snippet);
    showToast(snippet.type === 'audio' ? 'Audio preview' : 'Loaded clip in Inspect');
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
      if (isDrum) return s.type === 'midi' || s.type === 'drum';
      return s.type === 'midi' || s.type === 'drum';
    });
    return snippets;
  }

  _selectedShadowSnippet() {
    if (!this._shadowSnippetId || !this.project?.snippets) return null;
    if (this._shadowSnippetId === this._snippet?.id) return null;
    const shadow = this.project.snippets.find(s => s.id === this._shadowSnippetId);
    if (!shadow || shadow.type === 'audio') return null;
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
  }

  _displayDurationTicks() {
    const ticksPerBeat = this.transport?.ticksPerBeat || 480;
    const ticksPerBar = this._ticksPerBar();
    const minimumTicks = ticksPerBar * 4;
    return Math.max(this._snippet?.durationTicks || ticksPerBar, minimumTicks);
  }

  _beatsPerBar() {
    return Math.max(1, pulseCountForMeter(this._meterSource()));
  }

  _ticksPerBar() {
    return ticksPerBarForMeter(this._meterSource(), this.transport?.ticksPerBeat || 480);
  }

  _meterSource() {
    return this._snippet?.meter || this.transport?.meter || this.project?.meter || this._snippet?.timeSignature || this.transport?.timeSignature || this.project?.timeSignature;
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
      if (isDrumEditor) {
        const el = this._createShadowMidiOnDrumElement(note, pitchMin, pitchMax);
        if (el) grid.appendChild(el);
      } else if (note.pitch >= pitchMin && note.pitch < pitchMax) {
        grid.appendChild(this._createShadowNoteElementForPane(note, pitchMax));
      }
    });
  }

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
  }

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
  }

  _drumHitVisualWidth() {
    return Math.max(18, this._gridSize * TICK_WIDTH - 2);
  }

  _normalizedVelocity(value) {
    return Math.max(0.01, Math.min(1, Number.isFinite(value) ? value : 0.8));
  }

  _velocityPercent(value) {
    return Math.round(this._normalizedVelocity(value) * 100);
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
      this._loadSnippetById(e.target.value);
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

    toolbar.querySelector('#edit-new-midi-toolbar')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._createBlankSnippet('midi');
    });

    toolbar.querySelector('#edit-new-drum-toolbar')?.addEventListener('click', (e) => {
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
      if (this._snippet?.type === 'drum') return;
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

    toolbar.querySelector('#edit-rhythm-fit-btn')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._openRhythmFitModal();
    });

    this._panes.forEach(pane => {
      pane.gridContainer.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.piano-roll__note')) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const pointerId = e.pointerId;
        let dragged = false;

        const onMove = (me) => {
          if (me.pointerId !== pointerId) return;
          if (Math.hypot(me.clientX - startX, me.clientY - startY) > 8) {
            dragged = true;
          }
        };

        const onUp = (ue) => {
          if (ue.pointerId !== pointerId) return;
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onCancel);
          if (dragged) return;

          const rect = pane.gridEl.getBoundingClientRect();
          const x = startX - rect.left;
          const y = startY - rect.top;

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
        };

        const onCancel = (ce) => {
          if (ce.pointerId !== pointerId) return;
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onCancel);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onCancel);
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
    showToast(`Added ${this._drumLabel(drumType)}`);
  }

  _drumLabel(drumType) {
    const label = DRUM_TYPES.find(d => d.id === drumType)?.label || drumType;
    return label
      .toLowerCase()
      .replace(/\b\w/g, char => char.toUpperCase());
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

  _rhythmFitEvents() {
    if (this._snippet?.type === 'drum') return this._snippet.hits || [];
    if (this._snippet?.type === 'midi') return this._snippet.notes || [];
    return [];
  }

  _rhythmFitTargetOptions() {
    const barTicks = this.transport?.ticksPerBar || ticksPerBarForMeter(this._meterSource(), 480) || 1920;
    return [
      { value: barTicks, label: '1 bar' },
      { value: barTicks * 2, label: '2 bars' },
      { value: barTicks * 4, label: '4 bars' },
    ];
  }

  _openRhythmFitModal() {
    if (!this._snippet || this._snippet.type === 'audio') return;
    const events = this._rhythmFitEvents();
    if (!events.length) {
      showToast('No events to fit');
      return;
    }

    const targetOptions = this._rhythmFitTargetOptions();
    const currentDuration = Number(this._snippet.durationTicks) || targetOptions[0].value;
    const closestTarget = targetOptions.reduce((best, option) =>
      Math.abs(option.value - currentDuration) < Math.abs(best.value - currentDuration) ? option : best
    , targetOptions[0]);
    const overlay = document.createElement('div');
    overlay.className = 'rhythm-fit-backdrop';
    overlay.innerHTML = `
      <div class="rhythm-fit-modal" role="dialog" aria-modal="true" aria-label="Fit Rhythm">
        <div class="rhythm-fit-modal__header">
          <span class="rhythm-fit-modal__kicker">Always in time</span>
          <strong>Fit Rhythm</strong>
          <p>Resize the timing you played into clean bars without changing notes, drum sounds, velocity, or Tone.</p>
        </div>
        <div class="rhythm-fit-modal__grid">
          <label class="rhythm-fit-modal__field">
            <span>Fit to</span>
            <select id="rhythm-fit-target">
              ${targetOptions.map(option => `<option value="${option.value}" ${option.value === closestTarget.value ? 'selected' : ''}>${option.label}</option>`).join('')}
            </select>
          </label>
          <label class="rhythm-fit-modal__field">
            <span>Grid</span>
            <select id="rhythm-fit-grid">
              <option value="480">1/4</option>
              <option value="240" selected>1/8</option>
              <option value="120">1/16</option>
              <option value="160">1/8 triplet</option>
            </select>
          </label>
          <label class="rhythm-fit-modal__field rhythm-fit-modal__field--wide">
            <span>Keep my feel <b id="rhythm-fit-strength-label">50%</b> Make it clean</span>
            <input id="rhythm-fit-strength" type="range" min="0" max="100" step="5" value="50" />
          </label>
          <label class="rhythm-fit-modal__check">
            <input id="rhythm-fit-even" type="checkbox" />
            <span>Even spacing</span>
          </label>
          <label class="rhythm-fit-modal__check">
            <input id="rhythm-fit-duration" type="checkbox" checked />
            <span>Fit note lengths</span>
          </label>
        </div>
        <p class="rhythm-fit-modal__status" id="rhythm-fit-status">${events.length} ${this._snippet.type === 'drum' ? 'hits' : 'notes'} ready.</p>
        <div class="rhythm-fit-modal__actions">
          <button class="btn btn--ghost" id="rhythm-fit-preview" type="button">Preview</button>
          <button class="btn btn--ghost" id="rhythm-fit-cancel" type="button">Cancel</button>
          <button class="btn btn--primary" id="rhythm-fit-apply" type="button">Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const readOptions = () => ({
      targetTicks: Number(overlay.querySelector('#rhythm-fit-target')?.value) || targetOptions[0].value,
      gridTicks: Number(overlay.querySelector('#rhythm-fit-grid')?.value) || 240,
      strength: (Number(overlay.querySelector('#rhythm-fit-strength')?.value) || 0) / 100,
      mode: overlay.querySelector('#rhythm-fit-even')?.checked ? RHYTHM_FIT_MODES.EVEN : RHYTHM_FIT_MODES.FEEL,
      quantizeDurations: !!overlay.querySelector('#rhythm-fit-duration')?.checked,
    });
    const status = overlay.querySelector('#rhythm-fit-status');
    const strength = overlay.querySelector('#rhythm-fit-strength');
    const strengthLabel = overlay.querySelector('#rhythm-fit-strength-label');
    strength?.addEventListener('input', () => {
      if (strengthLabel) strengthLabel.textContent = `${strength.value}%`;
    });

    const restorePreview = () => {
      if (!this._rhythmFitPreviewState) return;
      this._restoreSnippetStateQuiet(this._rhythmFitPreviewState);
      this._rhythmFitPreviewState = null;
    };
    const close = () => {
      restorePreview();
      overlay.remove();
    };
    const preview = () => {
      if (!this._rhythmFitPreviewState) this._rhythmFitPreviewState = this._snapshotSnippetState();
      else this._restoreSnippetStateQuiet(this._rhythmFitPreviewState);
      const result = this._applyRhythmFitToSnippet(readOptions(), false);
      if (status) status.textContent = result.changed ? `Previewing ${result.events.length} fitted events.` : 'Already fits those settings.';
    };

    overlay.querySelector('#rhythm-fit-preview')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      preview();
    });
    overlay.querySelector('#rhythm-fit-cancel')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      close();
    });
    overlay.querySelector('#rhythm-fit-apply')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const beforeState = this._rhythmFitPreviewState || this._snapshotSnippetState();
      if (this._rhythmFitPreviewState) {
        this._restoreSnippetStateQuiet(this._rhythmFitPreviewState);
        this._rhythmFitPreviewState = null;
      }
      this._applyRhythmFitToSnippet(readOptions(), false);
      overlay.remove();
      this._commitRhythmFit(beforeState);
    });
  }

  _restoreSnippetStateQuiet(state) {
    if (!this._snippet || !state) return;
    this._snippet.name = state.name;
    this._snippet.notes = this._cloneForUndo(state.notes || []);
    this._snippet.hits = this._cloneForUndo(state.hits || []);
    this._snippet.modulation = this._cloneForUndo(state.modulation || []);
    this._snippet.durationTicks = state.durationTicks;
    this._selectedNoteIdx = null;
    this._rebuildAll();
  }

  _applyRhythmFitToSnippet(options) {
    const isDrum = this._snippet?.type === 'drum';
    const events = isDrum ? (this._snippet.hits || []) : (this._snippet.notes || []);
    const result = fitRhythmEvents(events, options);
    if (isDrum) this._snippet.hits = result.events;
    else this._snippet.notes = result.events;
    this._snippet.durationTicks = result.durationTicks;
    this._selectedNoteIdx = null;
    this._rebuildAll();
    return result;
  }

  _commitRhythmFit(beforeState) {
    const afterState = this._snapshotSnippetState();
    if (beforeState && afterState && JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      this.undoManager?.push({
        type: 'fitRhythm',
        description: 'Fit rhythm',
        undo: () => this._restoreSnippetState(beforeState),
        redo: () => this._restoreSnippetState(afterState),
      });
      this.store?.scheduleAutoSave(this.project);
      window.dispatchEvent(new CustomEvent('project-snippets-changed', {
        detail: { snippetId: this._snippet?.id, action: 'updated' },
      }));
      showToast('Rhythm fitted');
    } else {
      showToast('Rhythm already fits');
    }
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
    const durationChanged = beforeState?.durationTicks !== afterState?.durationTicks;

    if (beforeState && afterState && JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      this.undoManager?.push({
        type: 'editSnippet',
        description,
        undo: () => this._restoreSnippetState(beforeState),
        redo: () => this._restoreSnippetState(afterState),
      });
    }

    if (durationChanged) this._rebuildAll();
    else this._rebuildGrids();

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
    window.dispatchEvent(new CustomEvent('project-snippets-changed', {
      detail: { snippetId: this._snippet?.id, action: 'updated' },
    }));
  }

  _updateSnippetDuration() {
    if (!this._snippet) return;
    let maxEnd = 480;
    for (const n of (this._snippet.notes || [])) {
      const end = n.startTick + n.durationTick;
      if (end > maxEnd) maxEnd = end;
    }
    for (const h of (this._snippet.hits || [])) {
      const end = h.startTick + this._gridSize;
      if (end > maxEnd) maxEnd = end;
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
