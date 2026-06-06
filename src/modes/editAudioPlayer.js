/**
 * editAudioPlayer — EditMode feature extracted for size; composed back onto
 * EditMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { showToast } from '../ui/Toast.js';

export const EditAudioPlayerMixin = {
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
  },

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
  },

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
  },

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
  },
};
