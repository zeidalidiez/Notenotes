/**
 * editRhythmFit — EditMode feature extracted for size; composed back onto
 * EditMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { ticksPerBarForMeter } from '../engine/Meter.js';
import { fitRhythmEvents, RHYTHM_FIT_MODES } from '../engine/RhythmFit.js';
import { showToast } from '../ui/Toast.js';

export const EditRhythmFitMixin = {
  _rhythmFitEvents() {
    if (this._snippet?.type === 'drum') return this._snippet.hits || [];
    if (this._snippet?.type === 'midi') return this._snippet.notes || [];
    return [];
  },

  _rhythmFitTargetOptions() {
    const barTicks = this.transport?.ticksPerBar || ticksPerBarForMeter(this._meterSource(), 480) || 1920;
    return [
      { value: barTicks, label: '1 bar' },
      { value: barTicks * 2, label: '2 bars' },
      { value: barTicks * 4, label: '4 bars' },
    ];
  },

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
  },

  _restoreSnippetStateQuiet(state) {
    if (!this._snippet || !state) return;
    this._snippet.name = state.name;
    this._snippet.notes = this._cloneForUndo(state.notes || []);
    this._snippet.hits = this._cloneForUndo(state.hits || []);
    this._snippet.modulation = this._cloneForUndo(state.modulation || []);
    this._snippet.durationTicks = state.durationTicks;
    this._selectedNoteIdx = null;
    this._rebuildAll();
  },

  _applyRhythmFitToSnippet(options, _commit = false) {
    const isDrum = this._snippet?.type === 'drum';
    const events = isDrum ? (this._snippet.hits || []) : (this._snippet.notes || []);
    const result = fitRhythmEvents(events, options);
    if (isDrum) this._snippet.hits = result.events;
    else this._snippet.notes = result.events;
    this._snippet.durationTicks = result.durationTicks;
    this._selectedNoteIdx = null;
    this._rebuildAll();
    return result;
  },

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
  },
};
