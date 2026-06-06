/**
 * editNotes — EditMode feature extracted for size; composed back onto
 * EditMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { midiToNoteName } from '../engine/MusicTheory.js';
import { showToast } from '../ui/Toast.js';
import { TICK_WIDTH, DRUM_TYPES } from './editConstants.js';

export const EditNotesMixin = {
  _selectNote(idx) {
    this._selectedNoteIdx = idx;
    this.el.querySelectorAll('.piano-roll__note').forEach(n => {
      const isSel = n.dataset.noteIdx == idx || n.dataset.hitIdx == idx;
      n.classList.toggle('is-selected', isSel);
    });
    this._syncVelocityControl();
  },

  _selectedEditableEvent() {
    if (this._selectedNoteIdx === null || !this._snippet) return null;
    if (this._snippet.type === 'drum') {
      return this._snippet.hits?.[this._selectedNoteIdx] || null;
    }
    return this._snippet.notes?.[this._selectedNoteIdx] || null;
  },

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
  },

  _normalizedVelocity(value) {
    return Math.max(0.01, Math.min(1, Number.isFinite(value) ? value : 0.8));
  },

  _velocityPercent(value) {
    return Math.round(this._normalizedVelocity(value) * 100);
  },

  _deleteSelectedHit() {
    if (this._selectedNoteIdx === null || !this._snippet?.hits) return;
    const hits = this._snippet.hits;
    if (this._selectedNoteIdx >= hits.length) return;
    const beforeState = this._snapshotSnippetState();
    hits.splice(this._selectedNoteIdx, 1);
    this._selectedNoteIdx = null;
    this._onEdit('Delete hit', beforeState);
    showToast('Hit deleted');
  },

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

      // Tick (horizontal) movement applies to both drum and MIDI-roll hits; the
      // type (vertical) change is drum-only. Without the tick update outside the
      // isDrum guard, dragging a hit on a MIDI roll moved visually but was lost
      // on the next rebuild.
      let changed = newTick !== origTick;
      if (newTick !== origTick) hit.startTick = Math.max(0, newTick);

      if (isDrum) {
        const finalTop = parseFloat(el.style.top);
        const finalPct = finalTop / (100 / DRUM_TYPES.length);
        const newTypeIdx = DRUM_TYPES.length - 1 - Math.round(finalPct);
        const newType = DRUM_TYPES[Math.max(0, Math.min(DRUM_TYPES.length - 1, newTypeIdx))];
        if (newType && newType.id !== hit.type) {
          changed = true;
          hit.type = newType.id;
          el.title = newType.id;
        }
      }

      if (changed) {
        this._onEdit('Move hit', beforeState);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  },

  _paneForPitch(pitch) {
    for (const pane of this._panes) {
      if (pitch >= pane.pitchMin && pitch < pane.pitchMax) return pane;
    }
    return this._panes[0];
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  _cloneForUndo(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  },

  _snapshotSnippetState() {
    if (!this._snippet) return null;
    return {
      name: this._snippet.name,
      notes: this._cloneForUndo(this._snippet.notes || []),
      hits: this._cloneForUndo(this._snippet.hits || []),
      modulation: this._cloneForUndo(this._snippet.modulation || []),
      durationTicks: this._snippet.durationTicks,
    };
  },

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
  },
};
