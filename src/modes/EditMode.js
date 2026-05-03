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

export class EditMode {
  constructor(transport, undoManager, store, project) {
    this.transport = transport;
    this.undoManager = undoManager;
    this.store = store;
    this.project = project;
    this.el = null;

    this.onSnippetRenamed = null;

    this._snippet = null;
    this._clipId = null;

    this._selectedNoteIdx = null;

    this._gridSize = 480;

    this._noteHeight = DEFAULT_NOTE_HEIGHT;
    this._pitchMin = 36;
    this._pitchMax = 84;

    this._splitMode = false;

    this._panes = [];
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
    this._snippet = snippet;
    this._clipId = clipId;
    this._selectedNoteIdx = null;

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
    this.el.innerHTML = `
      <div class="edit-audio">
        <div class="edit-audio__header">
          <span class="edit-audio__title">🎤 ${this._snippet.name || 'Audio'}</span>
        </div>
        <div class="edit-audio__body">
          <audio class="edit-audio__player" controls src="${this._snippet.audioUrl || ''}"></audio>
          <p class="edit-audio__meta">
            BPM: ${this._snippet.bpm} · 
            Duration: ${(this._snippet.durationTicks / 480).toFixed(1)} beats
          </p>
        </div>
      </div>
    `;
  }

  _renderEmpty() {
    this.el.innerHTML = `
      <div class="edit-empty">
        <div class="edit-empty__icon">✏️</div>
        <h2 class="edit-empty__title">Inspect</h2>
        <p class="edit-empty__desc">Select a MIDI snippet to view and edit its notes in the piano roll.</p>
      </div>
    `;
  }

  _renderEditor() {
    this._panes = [];

    const toolbar = document.createElement('div');
    toolbar.className = 'edit-toolbar';
    const noteCount = (this._snippet.notes?.length || 0) + (this._snippet.hits?.length || 0);
    toolbar.innerHTML = this._buildToolbarHTML(noteCount);
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

  _buildToolbarHTML(noteCount) {
    const pitchMinOct = Math.floor(this._pitchMin / 12) - 1;
    const pitchMaxOct = Math.floor(this._pitchMax / 12) - 1;

    return `
      <div class="edit-toolbar__group">
        <input type="text" class="edit-toolbar__name-input" id="edit-snippet-name" value="${this._snippet.name || 'Snippet'}" placeholder="Snippet name" title="Edit snippet name" style="background:var(--surface-2);color:var(--text-primary);border:1px solid var(--surface-3);border-radius:4px;padding:2px 6px;font-size:var(--font-size-sm);font-weight:var(--font-weight-medium);outline:none;max-width:120px;" />
        <span class="edit-toolbar__value">${noteCount} notes</span>
      </div>
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Grid</span>
        <select class="edit-toolbar__select" id="edit-grid-select" aria-label="Grid size">
          <option value="480" ${this._gridSize === 480 ? 'selected' : ''}>1/4</option>
          <option value="240" ${this._gridSize === 240 ? 'selected' : ''}>1/8</option>
          <option value="120" ${this._gridSize === 120 ? 'selected' : ''}>1/16</option>
          <option value="960" ${this._gridSize === 960 ? 'selected' : ''}>1/2</option>
        </select>
      </div>
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Zoom</span>
        <button class="btn btn--ghost" id="edit-zoom-out" style="min-height:26px;padding:0 6px;font-size:0.7rem;" title="Vertical zoom out">-</button>
        <button class="btn btn--ghost" id="edit-zoom-in" style="min-height:26px;padding:0 6px;font-size:0.7rem;" title="Vertical zoom in">+</button>
      </div>
      <div class="edit-toolbar__group">
        <span class="edit-toolbar__label">Range</span>
        <select class="edit-toolbar__select" id="edit-oct-low" aria-label="Low octave">
          ${[1,2,3,4,5].map(o => `<option value="${o}" ${pitchMinOct === o ? 'selected' : ''}>C${o}</option>`).join('')}
        </select>
        <span style="font-size:0.7rem;color:var(--text-tertiary);">to</span>
        <select class="edit-toolbar__select" id="edit-oct-high" aria-label="High octave">
          ${[2,3,4,5,6].map(o => `<option value="${o}" ${pitchMaxOct === o ? 'selected' : ''}>C${o}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn--ghost${this._splitMode ? ' is-active' : ''}" id="edit-split-btn" style="font-size:0.7rem;min-height:26px;padding:2px 8px;" title="Split view">Split</button>
      <div class="edit-toolbar__spacer"></div>
      <div class="edit-toolbar__group">
        <button class="btn btn--ghost" id="edit-delete-btn" style="font-size:0.7rem;min-height:26px;padding:2px 8px;">Delete Note</button>
      </div>
    `;
  }

  _renderRollPane(pitchMin, pitchMax, paneId) {
    const pitchRange = pitchMax - pitchMin;

    const paneEl = document.createElement('div');
    paneEl.className = 'piano-roll-pane';
    paneEl.dataset.pane = paneId;

    const keysEl = this._renderKeysForRange(pitchMin, pitchMax);
    keysEl.dataset.pane = paneId;
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
      el: paneEl,
      paneId,
      pitchMin,
      pitchMax,
      pitchRange,
      keysEl,
      gridContainer,
      gridEl,
    };

    requestAnimationFrame(() => {
      const midScroll = (pitchRange * this._noteHeight) / 2 - gridContainer.clientHeight / 2;
      gridContainer.scrollTop = Math.max(0, midScroll);
      keysEl.scrollTop = gridContainer.scrollTop;
    });

    return result;
  }

  _renderKeysForRange(pitchMin, pitchMax) {
    const el = document.createElement('div');
    el.className = 'piano-roll__keys';

    let html = '';
    for (let pitch = pitchMax - 1; pitch >= pitchMin; pitch--) {
      const info = midiToNoteName(pitch);
      const isBlack = info.name.includes('#');
      const isC = info.name === 'C';
      const cls = isBlack ? 'piano-roll__key--black' : 'piano-roll__key--white';
      const cCls = isC ? ' piano-roll__key--c' : '';
      html += `<div class="piano-roll__key ${cls}${cCls}" data-pitch="${pitch}">${info.display}</div>`;
    }
    el.innerHTML = html;
    return el;
  }

  _renderRuler() {
    const el = document.createElement('div');
    el.className = 'piano-roll__ruler';

    const duration = this._snippet.durationTicks || (480 * 4);
    const width = duration * TICK_WIDTH;
    el.style.width = `${width}px`;
    el.style.minWidth = '100%';

    const ticksPerBeat = 480;
    let html = '';
    for (let tick = 0; tick < duration; tick += ticksPerBeat) {
      const x = tick * TICK_WIDTH;
      const beat = tick / ticksPerBeat;
      const bar = Math.floor(beat / 4) + 1;
      const beatInBar = (beat % 4) + 1;
      const label = beatInBar === 1 ? `${bar}` : `${bar}.${beatInBar}`;
      html += `<span class="piano-roll__ruler-label" style="left:${x}px">${label}</span>`;
    }
    el.innerHTML = html;
    return el;
  }

  _renderGridForRange(pitchMin, pitchMax, paneId) {
    const duration = this._snippet.durationTicks || (480 * 4);
    const width = duration * TICK_WIDTH;
    const pitchRange = pitchMax - pitchMin;
    const height = pitchRange * this._noteHeight;

    const grid = document.createElement('div');
    grid.className = 'piano-roll__grid';
    grid.style.width = `${width}px`;
    grid.style.height = `${height}px`;
    grid.style.position = 'relative';
    grid.dataset.pane = paneId;
    grid.dataset.pitchMin = pitchMin;
    grid.dataset.pitchMax = pitchMax;

    let rowsHtml = '';
    for (let pitch = pitchMax - 1; pitch >= pitchMin; pitch--) {
      const info = midiToNoteName(pitch);
      const isBlack = info.name.includes('#');
      const isC = info.name === 'C';
      const cls = isBlack ? ' piano-roll__row--black' : '';
      const cCls = isC ? ' piano-roll__row--c' : '';
      rowsHtml += `<div class="piano-roll__row${cls}${cCls}"></div>`;
    }
    const bgEl = document.createElement('div');
    bgEl.className = 'piano-roll__grid-bg';
    bgEl.innerHTML = rowsHtml;
    grid.appendChild(bgEl);

    const ticksPerBeat = 480;
    for (let tick = 0; tick <= duration; tick += this._gridSize) {
      const x = tick * TICK_WIDTH;
      const line = document.createElement('div');
      line.className = 'piano-roll__beat-line';
      if (tick % (ticksPerBeat * 4) === 0) {
        line.classList.add('piano-roll__beat-line--bar');
      } else if (tick % ticksPerBeat !== 0) {
        line.classList.add('piano-roll__beat-line--sub');
      }
      line.style.left = `${x}px`;
      grid.appendChild(line);
    }

    this._renderNotesForPane(grid, pitchMin, pitchMax);

    return grid;
  }

  _renderNotesForPane(grid, pitchMin, pitchMax) {
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
      this._selectNote(idx);
      this._startNoteDrag(e, note, idx, el);
    });

    const resizeHandle = el.querySelector('.piano-roll__note-resize');
    resizeHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this._startNoteResize(e, note, idx, el);
    });

    return el;
  }

  _createHitElementForPane(hit, idx, pitchMax) {
    const pitchMap = { kick: 36, snare: 40, clap: 40, hihat: 44, cymbal: 46 };
    const pitch = pitchMap[hit.type] || 38;
    const x = hit.startTick * TICK_WIDTH;
    const y = (pitchMax - 1 - pitch) * this._noteHeight;

    const el = document.createElement('div');
    el.className = 'piano-roll__note piano-roll__note--drum';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${this._noteHeight - 2}px`;
    el.title = hit.type;

    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });

    return el;
  }

  _selectNote(idx) {
    this._selectedNoteIdx = idx;
    this.el.querySelectorAll('.piano-roll__note').forEach(n => {
      n.classList.toggle('is-selected', parseInt(n.dataset.noteIdx) === idx);
    });
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
        this._onEdit('Move note');
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  _startNoteResize(e, note, idx, el) {
    const startX = e.clientX;
    const origDuration = note.durationTick;

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
        this._onEdit('Resize note');
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

    this._panes.forEach(pane => {
      pane.gridContainer.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.piano-roll__note')) return;

        const rect = pane.gridEl.getBoundingClientRect();
        const x = e.clientX - rect.left + pane.gridContainer.scrollLeft;
        const y = e.clientY - rect.top + pane.gridContainer.scrollTop;

        const tick = Math.round(x / TICK_WIDTH / this._gridSize) * this._gridSize;
        const pitch = pane.pitchMax - 1 - Math.floor(y / this._noteHeight);

        if (pitch >= pane.pitchMin && pitch < pane.pitchMax && tick >= 0) {
          this._addNote(tick, pitch);
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

    const note = {
      pitch,
      startTick,
      durationTick: this._gridSize,
      velocity: 0.8,
    };

    this._snippet.notes.push(note);
    this._selectedNoteIdx = this._snippet.notes.length - 1;
    this._onEdit('Add note');
    showToast(`Added ${midiToNoteName(pitch).display}`);
  }

  _deleteSelectedNote() {
    if (this._selectedNoteIdx === null || !this._snippet?.notes) return;
    if (this._selectedNoteIdx >= this._snippet.notes.length) return;

    this._snippet.notes.splice(this._selectedNoteIdx, 1);
    this._selectedNoteIdx = null;
    this._onEdit('Delete note');
    showToast('Note deleted');
  }

  _onEdit(description) {
    this._rebuildGrids();

    const countEl = this.el.querySelector('.edit-toolbar__value');
    if (countEl) {
      const count = (this._snippet.notes?.length || 0) + (this._snippet.hits?.length || 0);
      countEl.textContent = `${count} notes`;
    }

    this.store?.scheduleAutoSave(this.project);
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
