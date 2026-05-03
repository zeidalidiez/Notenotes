/**
 * EditMode — Live Edit / Piano Roll.
 * Per-clip note editor for fine-tuning pitch, timing, duration, and velocity.
 * Supports click-to-add, drag-to-move, resize, delete, and velocity editing.
 */

import './edit.css';
import { NOTE_NAMES, midiToNoteName } from '../engine/MusicTheory.js';
import { showToast } from '../ui/Toast.js';

/** Configuration */
const NOTE_HEIGHT = 16;      // px per semitone row
const TICK_WIDTH = 0.15;     // px per tick (adjustable zoom)
const PITCH_MIN = 36;        // C2
const PITCH_MAX = 84;        // C6 (4 octaves)
const PITCH_RANGE = PITCH_MAX - PITCH_MIN;

export class EditMode {
  /**
   * @param {Transport} transport
   * @param {UndoManager} undoManager
   * @param {ProjectStore} store
   * @param {object} project
   */
  constructor(transport, undoManager, store, project) {
    this.transport = transport;
    this.undoManager = undoManager;
    this.store = store;
    this.project = project;
    this.el = null;

    /** Currently editing snippet (reference) */
    this._snippet = null;
    this._clipId = null;

    /** Selected note index */
    this._selectedNoteIdx = null;

    /** Grid subdivision: ticks per grid line */
    this._gridSize = 480; // Default: quarter note

    /** Piano roll elements */
    this._gridContainer = null;
    this._gridEl = null;
    this._keysEl = null;
    this._velocityLane = null;
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'edit-mode';
    this.el.style.setProperty('--note-height', `${NOTE_HEIGHT}px`);

    // Show empty state if no clip loaded
    if (!this._snippet) {
      this._renderEmpty();
    } else {
      this._renderEditor();
    }

    return this.el;
  }

  /** Load a snippet for editing */
  loadSnippet(snippet, clipId = null) {
    this._snippet = snippet;
    this._clipId = clipId;
    this._selectedNoteIdx = null;

    // Re-render
    this.el.innerHTML = '';
    if (this._snippet) {
      this._renderEditor();
    } else {
      this._renderEmpty();
    }
  }

  _renderEmpty() {
    this.el.innerHTML = `
      <div class="edit-empty">
        <div class="edit-empty__icon">✏️</div>
        <h2 class="edit-empty__title">Live Edit</h2>
        <p class="edit-empty__desc">Select a snippet from the Snippet Tray or a clip from the Canvas to edit its notes here.</p>
      </div>
    `;
  }

  _renderEditor() {
    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'edit-toolbar';
    const noteCount = (this._snippet.notes?.length || 0) + (this._snippet.hits?.length || 0);
    toolbar.innerHTML = `
      <div class="edit-toolbar__group">
        <input type="text" class="edit-toolbar__name-input" id="edit-snippet-name" value="${this._snippet.name || 'Snippet'}" placeholder="Snippet name" title="Edit snippet name" style="background:var(--surface-2); color:var(--text-primary); border:1px solid var(--surface-3); border-radius:4px; padding:2px 6px; font-size:var(--font-size-sm); font-weight:var(--font-weight-medium); outline:none; max-width:150px;" />
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
      <div class="edit-toolbar__spacer"></div>
      <div class="edit-toolbar__group">
        <button class="btn btn--ghost" id="edit-delete-btn" style="font-size:0.7rem;min-height:26px;padding:2px 8px;">Delete Note</button>
      </div>
    `;
    this.el.appendChild(toolbar);

    // Piano roll container
    const rollContainer = document.createElement('div');
    rollContainer.className = 'piano-roll';

    // Piano keys
    this._keysEl = this._renderKeys();
    rollContainer.appendChild(this._keysEl);

    // Grid area
    const gridWrapper = document.createElement('div');
    gridWrapper.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

    // Mini ruler
    const ruler = this._renderRuler();
    gridWrapper.appendChild(ruler);

    // Grid
    this._gridContainer = document.createElement('div');
    this._gridContainer.className = 'piano-roll__grid-container';
    this._gridContainer.id = 'piano-roll-grid-container';

    this._gridEl = this._renderGrid();
    this._gridContainer.appendChild(this._gridEl);
    gridWrapper.appendChild(this._gridContainer);

    rollContainer.appendChild(gridWrapper);
    this.el.appendChild(rollContainer);

    // Velocity lane
    this._velocityLane = this._renderVelocityLane();
    this.el.appendChild(this._velocityLane);

    // Sync piano keys scroll with grid scroll
    this._gridContainer.addEventListener('scroll', () => {
      this._keysEl.scrollTop = this._gridContainer.scrollTop;
    });

    // Bind events
    this._bindEvents(toolbar);

    // Scroll to middle of pitch range
    requestAnimationFrame(() => {
      const midScroll = (PITCH_RANGE * NOTE_HEIGHT) / 2 - this._gridContainer.clientHeight / 2;
      this._gridContainer.scrollTop = midScroll;
      this._keysEl.scrollTop = midScroll;
    });
  }

  /** Render the piano keys sidebar */
  _renderKeys() {
    const el = document.createElement('div');
    el.className = 'piano-roll__keys';

    let html = '';
    for (let pitch = PITCH_MAX; pitch >= PITCH_MIN; pitch--) {
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

  /** Render the mini time ruler */
  _renderRuler() {
    const el = document.createElement('div');
    el.className = 'piano-roll__ruler';

    const duration = this._snippet.durationTicks || (480 * 4);
    const width = duration * TICK_WIDTH;
    el.style.width = `${width}px`;
    el.style.minWidth = '100%';

    // Add beat markers
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

  /** Render the note grid */
  _renderGrid() {
    const duration = this._snippet.durationTicks || (480 * 4);
    const width = duration * TICK_WIDTH;
    const height = PITCH_RANGE * NOTE_HEIGHT;

    const grid = document.createElement('div');
    grid.className = 'piano-roll__grid';
    grid.style.width = `${width}px`;
    grid.style.height = `${height}px`;
    grid.style.position = 'relative';

    // Background rows
    let rowsHtml = '';
    for (let pitch = PITCH_MAX; pitch >= PITCH_MIN; pitch--) {
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

    // Beat lines
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

    // Render notes
    this._renderNotes(grid);

    return grid;
  }

  /** Render note blocks on the grid */
  _renderNotes(grid) {
    const notes = this._snippet.notes || [];
    notes.forEach((note, idx) => {
      const el = this._createNoteElement(note, idx);
      grid.appendChild(el);
    });

    // Render drum hits as dots
    const hits = this._snippet.hits || [];
    hits.forEach((hit, idx) => {
      const el = this._createHitElement(hit, idx);
      grid.appendChild(el);
    });
  }

  /** Create a note DOM element */
  _createNoteElement(note, idx) {
    const x = note.startTick * TICK_WIDTH;
    const w = Math.max(6, note.durationTick * TICK_WIDTH);
    const y = (PITCH_MAX - note.pitch) * NOTE_HEIGHT;

    const el = document.createElement('div');
    el.className = 'piano-roll__note piano-roll__note--midi';
    if (idx === this._selectedNoteIdx) el.classList.add('is-selected');
    el.dataset.noteIdx = idx;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;

    // Velocity indicator
    const velHeight = Math.max(1, (note.velocity || 0.8) * 2);
    el.innerHTML = `
      <div class="piano-roll__note-velocity" style="height:${velHeight}px;"></div>
      <div class="piano-roll__note-resize"></div>
    `;

    // Click to select
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this._selectNote(idx);
      this._startNoteDrag(e, note, idx, el);
    });

    // Resize handle
    const resizeHandle = el.querySelector('.piano-roll__note-resize');
    resizeHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this._startNoteResize(e, note, idx, el);
    });

    return el;
  }

  /** Create a drum hit element */
  _createHitElement(hit, idx) {
    // Map drum hits to a pitch-like position
    const pitchMap = { kick: 36, snare: 40, clap: 40, hihat: 44, cymbal: 46 };
    const pitch = pitchMap[hit.type] || 38;
    const x = hit.startTick * TICK_WIDTH;
    const y = (PITCH_MAX - pitch) * NOTE_HEIGHT;

    const el = document.createElement('div');
    el.className = 'piano-roll__note piano-roll__note--drum';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${NOTE_HEIGHT - 2}px`;
    el.title = hit.type;

    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });

    return el;
  }

  /** Render the velocity lane */
  _renderVelocityLane() {
    const el = document.createElement('div');
    el.className = 'velocity-lane';
    el.id = 'velocity-lane';

    const notes = this._snippet.notes || [];
    const duration = this._snippet.durationTicks || (480 * 4);

    notes.forEach((note, idx) => {
      const x = note.startTick * TICK_WIDTH;
      const h = Math.max(4, (note.velocity || 0.8) * 44);
      const bar = document.createElement('div');
      bar.className = 'velocity-lane__bar';
      if (idx === this._selectedNoteIdx) bar.classList.add('is-selected');
      bar.dataset.noteIdx = idx;
      bar.style.left = `${x}px`;
      bar.style.height = `${h}px`;

      // Drag to change velocity
      bar.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._startVelocityDrag(e, note, idx, bar);
      });

      el.appendChild(bar);
    });

    return el;
  }

  /** Select a note */
  _selectNote(idx) {
    this._selectedNoteIdx = idx;
    // Update visual selection
    this._gridEl?.querySelectorAll('.piano-roll__note').forEach(n => {
      n.classList.toggle('is-selected', parseInt(n.dataset.noteIdx) === idx);
    });
    this._velocityLane?.querySelectorAll('.velocity-lane__bar').forEach(b => {
      b.classList.toggle('is-selected', parseInt(b.dataset.noteIdx) === idx);
    });
  }

  /** Start dragging a note to move it */
  _startNoteDrag(e, note, idx, el) {
    const startX = e.clientX;
    const startY = e.clientY;
    const origTick = note.startTick;
    const origPitch = note.pitch;

    const onMove = (me) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;

      // Quantize movement to grid
      const deltaTick = Math.round(dx / TICK_WIDTH / this._gridSize) * this._gridSize;
      const deltaPitch = -Math.round(dy / NOTE_HEIGHT);

      const newTick = Math.max(0, origTick + deltaTick);
      const newPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, origPitch + deltaPitch));

      el.style.left = `${newTick * TICK_WIDTH}px`;
      el.style.top = `${(PITCH_MAX - newPitch) * NOTE_HEIGHT}px`;
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const finalLeft = parseFloat(el.style.left);
      const finalTop = parseFloat(el.style.top);
      const newTick = Math.round(finalLeft / TICK_WIDTH / this._gridSize) * this._gridSize;
      const newPitch = PITCH_MAX - Math.round(finalTop / NOTE_HEIGHT);

      if (newTick !== origTick || newPitch !== origPitch) {
        note.startTick = Math.max(0, newTick);
        note.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, newPitch));
        this._onEdit('Move note');
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /** Start resizing a note (change duration) */
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

  /** Start dragging a velocity bar */
  _startVelocityDrag(e, note, idx, bar) {
    const startY = e.clientY;
    const origVel = note.velocity || 0.8;
    const laneHeight = 44;

    const onMove = (me) => {
      const dy = startY - me.clientY;
      const deltaVel = dy / laneHeight;
      const newVel = Math.max(0.05, Math.min(1.0, origVel + deltaVel));
      bar.style.height = `${Math.max(4, newVel * laneHeight)}px`;
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);

      const finalHeight = parseFloat(bar.style.height);
      const newVel = Math.max(0.05, Math.min(1.0, finalHeight / laneHeight));
      note.velocity = Math.round(newVel * 100) / 100;
      this._onEdit('Change velocity');
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /** Bind toolbar events */
  _bindEvents(toolbar) {
    // Grid size selector
    toolbar.querySelector('#edit-grid-select')?.addEventListener('change', (e) => {
      this._gridSize = parseInt(e.target.value, 10);
      this._refreshGrid();
    });

    // Snippet name input
    const nameInput = toolbar.querySelector('#edit-snippet-name');
    if (nameInput) {
      const saveName = () => {
        const newName = nameInput.value.trim() || 'Snippet';
        if (this._snippet && this._snippet.name !== newName) {
          this._snippet.name = newName;
          this.store?.scheduleAutoSave(this.project);
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

    // Delete note button
    toolbar.querySelector('#edit-delete-btn')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._deleteSelectedNote();
    });

    // Click on empty grid to add a note
    this._gridContainer?.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.piano-roll__note')) return;

      const rect = this._gridEl.getBoundingClientRect();
      const x = e.clientX - rect.left + this._gridContainer.scrollLeft;
      const y = e.clientY - rect.top + this._gridContainer.scrollTop;

      const tick = Math.round(x / TICK_WIDTH / this._gridSize) * this._gridSize;
      const pitch = PITCH_MAX - Math.floor(y / NOTE_HEIGHT);

      if (pitch >= PITCH_MIN && pitch <= PITCH_MAX && tick >= 0) {
        this._addNote(tick, pitch);
      }
    });

    // Delete with keyboard
    document.addEventListener('keydown', (e) => {
      if ((e.code === 'Delete' || e.code === 'Backspace') && this._selectedNoteIdx !== null) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        // Only handle if Edit mode is visible
        if (this.el.closest('.mode-view.is-active')) {
          e.preventDefault();
          this._deleteSelectedNote();
        }
      }
    });
  }

  /** Add a new note at the given position */
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

  /** Delete the selected note */
  _deleteSelectedNote() {
    if (this._selectedNoteIdx === null || !this._snippet?.notes) return;
    if (this._selectedNoteIdx >= this._snippet.notes.length) return;

    this._snippet.notes.splice(this._selectedNoteIdx, 1);
    this._selectedNoteIdx = null;
    this._onEdit('Delete note');
    showToast('Note deleted');
  }

  /** Called after any edit — refresh UI and save */
  _onEdit(description) {
    this._refreshGrid();
    this._refreshVelocityLane();

    // Update toolbar note count
    const countEl = this.el.querySelector('.edit-toolbar__value');
    if (countEl) {
      const count = (this._snippet.notes?.length || 0) + (this._snippet.hits?.length || 0);
      countEl.textContent = `${count} notes`;
    }

    // Save
    this.store?.scheduleAutoSave(this.project);
  }

  /** Refresh just the grid (notes) */
  _refreshGrid() {
    if (!this._gridContainer || !this._snippet) return;
    const newGrid = this._renderGrid();
    this._gridContainer.replaceChild(newGrid, this._gridEl);
    this._gridEl = newGrid;
  }

  /** Refresh the velocity lane */
  _refreshVelocityLane() {
    if (!this._velocityLane || !this._snippet) return;
    const newLane = this._renderVelocityLane();
    this._velocityLane.replaceWith(newLane);
    this._velocityLane = newLane;
  }
}
