/**
 * editEvents — EditMode feature extracted for size; composed back onto
 * EditMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { showToast } from '../ui/Toast.js';
import { TICK_WIDTH, MIN_NOTE_HEIGHT, MAX_NOTE_HEIGHT, DRUM_TYPES } from './editConstants.js';

export const EditEventsMixin = {
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

    // _bindEvents runs on every _rebuildAll, so remove any previously-registered
    // handler before re-adding — otherwise document keydown listeners accumulate.
    if (this._documentKeydownHandler) {
      document.removeEventListener('keydown', this._documentKeydownHandler);
    }
    this._documentKeydownHandler = (e) => {
      if ((e.code === 'Delete' || e.code === 'Backspace') && this._selectedNoteIdx !== null) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (this.el.closest('.mode-view.is-active')) {
          e.preventDefault();
          this._deleteSelectedNote();
        }
      }
    };
    document.addEventListener('keydown', this._documentKeydownHandler);
  },
};
