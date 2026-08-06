export function editableCustomPatches(instruments = []) {
  return Array.isArray(instruments)
    ? instruments.filter(instrument => instrument?.type === 'patch')
    : [];
}

export function rootNoteOptions(selectedMidi = 60) {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const options = [];
  for (let octave = 1; octave <= 6; octave++) {
    for (let i = 0; i < notes.length; i++) {
      const midi = (octave + 1) * 12 + i;
      options.push(`<option value="${midi}" ${midi === selectedMidi ? 'selected' : ''}>${notes[i]}${octave}</option>`);
    }
  }
  return options.join('');
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value = '') {
  return escapeHtml(value);
}

export class CreateInstrumentPopover {
  constructor({
    getProject,
    getCustomInstruments,
    getSelectedInstrument,
    onBeforeOpen,
    onSave,
  } = {}) {
    this.getProject = getProject;
    this.getCustomInstruments = getCustomInstruments;
    this.getSelectedInstrument = getSelectedInstrument;
    this.onBeforeOpen = onBeforeOpen;
    this.onSave = onSave;
    this._popover = null;
    this._clickOutsideHandler = null;
    this._anchor = null;
  }

  toggle(anchor) {
    if (this._popover) {
      this.close();
      return;
    }
    this.onBeforeOpen?.();
    this._open(anchor);
  }

  close() {
    if (this._clickOutsideHandler) {
      document.removeEventListener('pointerdown', this._clickOutsideHandler, true);
      this._clickOutsideHandler = null;
    }
    this._popover?.remove();
    this._popover = null;
    this._anchor = null;
  }

  _open(anchor) {
    const customInstruments = editableCustomPatches(this.getCustomInstruments?.());
    const selectedInstrument = this.getSelectedInstrument?.() || null;
    const editingInstrument = selectedInstrument?.type === 'patch' ? selectedInstrument : null;
    const audioSnippets = (this.getProject?.()?.snippets || [])
      .filter(snippet => snippet.type === 'audio' && snippet.audioAssetId);
    const popover = document.createElement('div');
    popover.className = 'tone-popover custom-instrument-popover';
    popover.id = 'custom-instrument-popover';
    popover.innerHTML = this._render({ customInstruments, editingInstrument, audioSnippets });

    anchor.appendChild(popover);
    this._popover = popover;
    this._anchor = anchor;

    this._bind(popover, customInstruments);

    const handleOutside = (event) => {
      if (!this._popover) return;
      if (this._popover.contains(event.target)) return;
      if (anchor.contains(event.target)) return;
      this.close();
    };
    queueMicrotask(() => document.addEventListener('pointerdown', handleOutside, true));
    this._clickOutsideHandler = handleOutside;
  }

  _render({ customInstruments, editingInstrument, audioSnippets }) {
    return `
      <div class="tone-popover__header">
        <span id="ci-title">${editingInstrument ? 'Edit Instrument' : 'Create Instrument'}</span>
      </div>
      <div class="custom-instrument-form" data-editing-id="${escapeAttr(editingInstrument?.id || '')}">
        ${customInstruments.length ? `
          <label class="custom-instrument-field">
            <span>Instrument</span>
            <select id="ci-existing" aria-label="Instrument to edit">
              <option value="">New instrument</option>
              ${customInstruments.map(instrument => `
                <option value="${escapeAttr(instrument.id)}" ${instrument.id === editingInstrument?.id ? 'selected' : ''}>
                  ${escapeHtml(instrument.name || 'Untitled')}
                </option>
              `).join('')}
            </select>
          </label>
        ` : ''}
        <label class="custom-instrument-field">
          <span>Name</span>
          <input id="ci-name" type="text" placeholder="My sample patch" value="${escapeAttr(editingInstrument?.name || '')}" aria-label="Instrument name">
        </label>
        <label class="custom-instrument-field">
          <span>Audio snippet</span>
          <select id="ci-snippet" aria-label="Audio snippet source">
            <option value="">Use imported file...</option>
            ${audioSnippets.map(snippet => `<option value="${escapeAttr(snippet.id)}">${escapeHtml(snippet.name || 'Audio in recording')}</option>`).join('')}
          </select>
        </label>
        <label class="custom-instrument-field">
          <span>Audio file</span>
          <input id="ci-file" type="file" accept="audio/*" aria-label="Audio file source">
        </label>
        <label class="custom-instrument-field">
          <span>Root note</span>
          <select id="ci-root" aria-label="Root note">
            ${rootNoteOptions(editingInstrument?.rootMidi ?? 60)}
          </select>
          <small>The note your original sample already sounds like. That note plays unshifted; other notes pitch it up or down.</small>
        </label>
        <label class="custom-instrument-field">
          <span>Playback</span>
          <select id="ci-playback" aria-label="Playback mode">
            <option value="gated" ${editingInstrument?.playbackMode !== 'oneShot' ? 'selected' : ''}>Gated</option>
            <option value="oneShot" ${editingInstrument?.playbackMode === 'oneShot' ? 'selected' : ''}>One-shot</option>
          </select>
        </label>
        <label class="custom-instrument-field">
          <span>Brightness <b id="ci-brightness-value">${Math.round((editingInstrument?.brightness ?? 0.7) * 100)}%</b></span>
          <input id="ci-brightness" type="range" min="0" max="100" value="${Math.round((editingInstrument?.brightness ?? 0.7) * 100)}" aria-label="Brightness">
        </label>
        <label class="custom-instrument-field">
          <span>Gain <b id="ci-gain-value">${Math.round((editingInstrument?.gain ?? 0.55) * 100)}%</b></span>
          <input id="ci-gain" type="range" min="10" max="100" value="${Math.round((editingInstrument?.gain ?? 0.55) * 100)}" aria-label="Gain">
        </label>
        <div class="tone-preset__row">
          <button class="btn btn--ghost" id="ci-save" type="button">${editingInstrument ? 'Update Instrument' : 'Save Instrument'}</button>
        </div>
      </div>
    `;
  }

  _bind(popover, customInstruments) {
    const syncSlider = (id) => {
      const slider = popover.querySelector(`#ci-${id}`);
      const label = popover.querySelector(`#ci-${id}-value`);
      if (slider && label) label.textContent = `${slider.value}%`;
    };
    const loadInstrumentIntoForm = (instrument) => {
      const form = popover.querySelector('.custom-instrument-form');
      if (form) form.dataset.editingId = instrument?.id || '';
      const title = popover.querySelector('#ci-title');
      if (title) title.textContent = instrument ? 'Edit Instrument' : 'Create Instrument';
      const save = popover.querySelector('#ci-save');
      if (save) save.textContent = instrument ? 'Update Instrument' : 'Save Instrument';
      const name = popover.querySelector('#ci-name');
      if (name) name.value = instrument?.name || '';
      const snippet = popover.querySelector('#ci-snippet');
      if (snippet) snippet.value = instrument?.sourceSnippetId || '';
      const file = popover.querySelector('#ci-file');
      if (file) file.value = '';
      const root = popover.querySelector('#ci-root');
      if (root) root.value = String(instrument?.rootMidi ?? 60);
      const playback = popover.querySelector('#ci-playback');
      if (playback) playback.value = instrument?.playbackMode || 'gated';
      const brightness = popover.querySelector('#ci-brightness');
      if (brightness) brightness.value = String(Math.round((instrument?.brightness ?? 0.7) * 100));
      const gain = popover.querySelector('#ci-gain');
      if (gain) gain.value = String(Math.round((instrument?.gain ?? 0.55) * 100));
      syncSlider('brightness');
      syncSlider('gain');
    };

    popover.querySelector('#ci-existing')?.addEventListener('change', (event) => {
      const instrument = customInstruments.find(item => item.id === event.target.value) || null;
      loadInstrumentIntoForm(instrument);
    });
    popover.querySelector('#ci-brightness')?.addEventListener('input', () => syncSlider('brightness'));
    popover.querySelector('#ci-gain')?.addEventListener('input', () => syncSlider('gain'));
    popover.querySelector('#ci-save')?.addEventListener('pointerdown', async (event) => {
      event.preventDefault();
      await this.onSave?.(popover);
    });
  }
}
