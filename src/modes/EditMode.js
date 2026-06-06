/**
 * EditMode — Live Edit / Piano Roll.
 * Per-clip note editor for fine-tuning pitch, timing, duration, and velocity.
 * Supports click-to-add, drag-to-move, resize, delete, velocity editing,
 * vertical zoom, custom octave range, and split dual-pane view.
 */

import './edit.css';
import { pulseCountForMeter, ticksPerBarForMeter } from '../engine/Meter.js';
import { showToast } from '../ui/Toast.js';
import { DEFAULT_NOTE_HEIGHT, MIN_PIANO_OCTAVE, MAX_PIANO_OCTAVE } from './editConstants.js';
import { EditAudioPlayerMixin } from './editAudioPlayer.js';
import { EditRollMixin } from './editRoll.js';
import { EditNotesMixin } from './editNotes.js';
import { EditRhythmFitMixin } from './editRhythmFit.js';
import { EditEventsMixin } from './editEvents.js';

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


  _escapeAttr(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
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

  _loadSnippetById(id) {
    if (!id || id === this._snippet?.id) return;
    const snippet = this.project?.snippets?.find(s => s.id === id);
    if (!snippet) return;
    this.loadSnippet(snippet);
    showToast(snippet.type === 'audio' ? 'Audio preview' : 'Loaded clip in Inspect');
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

Object.assign(
  EditMode.prototype,
  EditAudioPlayerMixin,
  EditRollMixin,
  EditNotesMixin,
  EditRhythmFitMixin,
  EditEventsMixin,
);
