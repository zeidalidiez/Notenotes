/**
 * creativeTone — CreativeMode feature extracted for size; composed back onto
 * CreativeMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { SOUND_TRAITS, normalizeSoundTraits } from '../instruments/WebAudioSynth.js';
import { ChoicePicker } from '../ui/ChoicePicker.js';
import { showToast } from '../ui/Toast.js';

export const CreativeToneMixin = {
  _ensureSoundTraits() {
    if (!this.project) return normalizeSoundTraits(this._currentToneTraits);
    if (!this.project.settings) this.project.settings = {};
    this.project.settings.soundTraits = this._normalizeProjectSoundTraits(this.project);
    this._currentToneTraits = this.project.settings.soundTraits;
    return this.project.settings.soundTraits;
  },

  _normalizeProjectSoundTraits(project) {
    return normalizeSoundTraits(project?.settings?.soundTraits || this._currentToneTraits || {});
  },

  _applyProjectSoundTraits(traits, { save = true, notify = true } = {}) {
    const normalized = normalizeSoundTraits(traits);
    this._currentToneTraits = normalized;
    if (this.project) {
      if (!this.project.settings) this.project.settings = {};
      this.project.settings.soundTraits = JSON.parse(JSON.stringify(normalized));
    }
    this.sketchKit?.setSoundTraits(normalized);
    this._setLiveSoundTraits(this.controllerMode?.currentSoundTraits(normalized) || normalized);
    if (save) this.store?.scheduleAutoSave(this.project);
    if (notify) {
      window.dispatchEvent(new CustomEvent('project-sound-traits-changed', { detail: { soundTraits: normalized } }));
    }
    return normalized;
  },

  _setLiveSoundTraits(traits) {
    this.synth?.setSoundTraits(traits || this._currentToneTraits || {});
  },

  _currentSoundTraitsSnapshot() {
    const traits = this.controllerMode?.currentSoundTraits(this._currentToneTraits || this._ensureSoundTraits())
      || this.synth.soundTraits
      || this._ensureSoundTraits();
    return JSON.parse(JSON.stringify(normalizeSoundTraits(traits)));
  },

  _baseSoundTraitsSnapshot() {
    return JSON.parse(JSON.stringify(normalizeSoundTraits(this._currentToneTraits || this._ensureSoundTraits())));
  },

  _updateToneTriggerIndicator(labels = []) {
    const indicator = this.el?.querySelector('#tone-trigger-indicator');
    if (!indicator) return;
    indicator.textContent = labels.join('/');
    indicator.classList.toggle('is-active', labels.length > 0);
  },

  _toggleTonePopover(anchor) {
    if (this._tonePopover) {
      this._closeTonePopover();
      return;
    }
    this._closeControllerMapperPopover();

    const traits = this._ensureSoundTraits();
    const popover = document.createElement('div');
    popover.className = 'tone-popover';
    popover.id = 'tone-popover';
    popover.innerHTML = `
      <div class="tone-popover__header">
        <span>Tone</span>
      </div>
      ${this._renderTonePresetControls()}
      <div class="tone-popover__list">
        ${Object.values(SOUND_TRAITS).map(trait => {
          const state = traits[trait.id] || { amount: 0 };
          const amount = Math.round((state.amount ?? 0) * 100);
          return `
            <div class="tone-row" title="${trait.hint}">
              <label class="tone-row__name" for="tone-${trait.id}">${trait.name}</label>
              <input class="tone-row__slider" type="range" min="0" max="100" value="${amount}" data-tone-amount="${trait.id}" aria-label="${trait.name} intensity">
              <span class="tone-row__value">${amount}%</span>
            </div>
          `;
        }).join('')}
      </div>
    `;

    anchor.appendChild(popover);
    anchor.querySelector('#tone-button')?.setAttribute('aria-expanded', 'true');
    this._tonePopover = popover;

    const handleOutside = (e) => {
      if (!this._tonePopover) return;
      if (this._tonePopover.contains(e.target)) return;
      if (e.target.closest?.('.choice-picker, .choice-picker-backdrop')) return;
      if (anchor.contains(e.target)) return;
      this._closeTonePopover();
    };
    queueMicrotask(() => document.addEventListener('pointerdown', handleOutside, true));
    this._toneClickOutsideHandler = handleOutside;

    popover.querySelectorAll('[data-tone-amount]').forEach(slider => {
      const update = () => this._setToneTraitAmount(slider.dataset.toneAmount, Number(slider.value) / 100, slider);
      slider.addEventListener('input', update);
      slider.addEventListener('change', update);
    });

    this._bindTonePresetControls();
  },

  _bindTonePresetControls() {
    const popover = this._tonePopover;
    if (!popover) return;
    popover.querySelector('#tone-preset-apply')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const preset = this._selectedTonePreset(popover);
      if (!preset) return showToast('Choose a Tone preset first');
      this._applyProjectSoundTraits(preset.soundTraits);
      this._syncTonePopover();
      showToast(`Tone preset applied: ${preset.name}`);
    });

    popover.querySelector('#tone-preset-delete')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const preset = this._selectedTonePreset(popover);
      if (!preset) return showToast('Choose a Tone preset first');
      if (!confirm(`Delete Tone preset "${preset.name}"?`)) return;
      this._deleteTonePreset(preset.id);
      this._refreshTonePresetControls();
      showToast(`Tone preset deleted: ${preset.name}`);
    });

    popover.querySelector('#tone-preset-picker')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._openTonePresetPicker(e.currentTarget, popover);
    });

    popover.querySelector('#tone-reset')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._applyProjectSoundTraits(normalizeSoundTraits({}));
      this._syncTonePopover();
      showToast('Tone reset');
    });

    popover.querySelector('#tone-preset-save')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const input = popover.querySelector('#tone-preset-name');
      const name = input?.value?.trim();
      if (!name) return showToast('Name the Tone preset first');
      const selected = this._selectedTonePreset(popover);
      this._saveTonePreset(name, { id: selected?.id });
      this._refreshTonePresetControls();
      showToast(`Tone preset saved: ${name}`);
    });

    popover.querySelector('#tone-preset-save-new')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const input = popover.querySelector('#tone-preset-name');
      const name = input?.value?.trim();
      if (!name) return showToast('Name the Tone preset first');
      this._saveTonePreset(name, { forceNew: true });
      this._refreshTonePresetControls();
      showToast(`Tone preset saved: ${name}`);
    });
  },

  _renderTonePresetControls() {
    return `
      <div class="tone-preset" data-selected-tone-preset="">
        <div class="tone-preset__row tone-preset__row--manage">
          <button class="choice-picker-button tone-preset__picker" id="tone-preset-picker" type="button" aria-label="Tone preset" aria-haspopup="dialog">
            <span class="choice-picker-button__label" id="tone-preset-label">Preset...</span>
            <span class="choice-picker-button__chevron" aria-hidden="true">▼</span>
          </button>
          <button class="btn btn--ghost" id="tone-preset-apply" type="button">Apply</button>
          <button class="btn btn--ghost" id="tone-preset-delete" type="button">Delete</button>
          <button class="btn btn--ghost" id="tone-reset" type="button">Reset</button>
        </div>
        <div class="tone-preset__row">
          <input class="tone-preset__input" id="tone-preset-name" type="text" placeholder="Preset name" aria-label="Tone preset name">
          <button class="btn btn--ghost" id="tone-preset-save" type="button">Save</button>
          <button class="btn btn--ghost" id="tone-preset-save-new" type="button">Save as new</button>
        </div>
      </div>
    `;
  },

  _tonePresets() {
    if (!this.project?.settings) return [];
    if (!Array.isArray(this.project.settings.tonePresets)) this.project.settings.tonePresets = [];
    return this.project.settings.tonePresets;
  },

  _selectedTonePreset(root = this._tonePopover) {
    const id = root?.querySelector('.tone-preset')?.dataset.selectedTonePreset || '';
    return this._tonePresets().find(preset => preset.id === id) || null;
  },

  _tonePresetGroups() {
    return [{
      id: 'saved',
      label: 'Saved Tone presets',
      items: this._tonePresets().map(preset => ({
        value: preset.id,
        label: preset.name || 'Untitled Tone',
        kicker: this._tonePresetSummary(preset.soundTraits),
        description: preset.updatedAt ? `Updated ${new Date(preset.updatedAt).toLocaleDateString()}` : '',
        tags: [preset.name, this._tonePresetSummary(preset.soundTraits)],
      })),
    }];
  },

  _tonePresetSummary(traits = {}) {
    const normalized = normalizeSoundTraits(traits);
    const active = Object.values(SOUND_TRAITS)
      .filter(trait => (normalized[trait.id]?.amount || 0) > 0.03)
      .map(trait => `${trait.name} ${Math.round((normalized[trait.id]?.amount || 0) * 100)}%`);
    return active.length ? active.join(' - ') : 'No Tone';
  },

  _setSelectedTonePreset(root, preset) {
    const wrap = root?.querySelector('.tone-preset');
    if (wrap) wrap.dataset.selectedTonePreset = preset?.id || '';
    const label = root?.querySelector('#tone-preset-label');
    if (label) label.textContent = preset?.name || 'Preset...';
    const input = root?.querySelector('#tone-preset-name');
    if (input && preset) input.value = preset.name || '';
  },

  _openTonePresetPicker(anchor, root = this._tonePopover) {
    const picker = new ChoicePicker({
      title: 'Choose Tone Preset',
      groups: this._tonePresetGroups(),
      selectedValue: root?.querySelector('.tone-preset')?.dataset.selectedTonePreset || '',
      searchPlaceholder: 'Search Tone presets...',
      onSelect: (value) => {
        this._setSelectedTonePreset(root, this._tonePresets().find(preset => preset.id === value) || null);
      },
    });
    picker.open(anchor);
  },

  _saveTonePreset(name, { id = null, forceNew = false } = {}) {
    const presets = this._tonePresets();
    const existing = !forceNew && (presets.find(p => p.id === id) || presets.find(p => p.name.toLowerCase() === name.toLowerCase()));
    const preset = {
      id: existing?.id || crypto.randomUUID(),
      name,
      soundTraits: this._baseSoundTraitsSnapshot(),
      updatedAt: Date.now(),
    };
    if (existing) Object.assign(existing, preset);
    else presets.push(preset);
    presets.sort((a, b) => a.name.localeCompare(b.name));
    this.store?.scheduleAutoSave(this.project);
    window.dispatchEvent(new CustomEvent('project-tone-presets-changed'));
  },

  _deleteTonePreset(id) {
    if (!this.project?.settings || !id) return;
    this.project.settings.tonePresets = this._tonePresets().filter(preset => preset.id !== id);
    this.store?.scheduleAutoSave(this.project);
    window.dispatchEvent(new CustomEvent('project-tone-presets-changed'));
  },

  _refreshTonePresetControls() {
    if (!this._tonePopover) return;
    const old = this._tonePopover.querySelector('.tone-preset');
    const selectedId = old?.dataset.selectedTonePreset || '';
    old?.insertAdjacentHTML('beforebegin', this._renderTonePresetControls());
    old?.remove();
    this._bindTonePresetControls();
    const preset = this._tonePresets().find(item => item.id === selectedId) || null;
    this._setSelectedTonePreset(this._tonePopover, preset);
  },

  _syncTonePopover() {
    const traits = this._ensureSoundTraits();
    this._tonePopover?.querySelectorAll('[data-tone-amount]').forEach(slider => {
      const id = slider.dataset.toneAmount;
      const amount = Math.round((traits[id]?.amount || 0) * 100);
      slider.value = String(amount);
      const value = slider.closest('.tone-row')?.querySelector('.tone-row__value');
      if (value) value.textContent = `${amount}%`;
    });
  },

  _handleToneInput(e) {
    const slider = e.target.closest('[data-tone-amount]');
    if (!slider) return;
    this._setToneTraitAmount(slider.dataset.toneAmount, Number(slider.value) / 100, slider);
  },

  _setToneTraitAmount(id, amount, slider = null) {
    if (!id || !SOUND_TRAITS[id]) return;
    const traits = normalizeSoundTraits(this._ensureSoundTraits());
    traits[id] = { amount: Math.max(0, Math.min(1, Number(amount) || 0)) };
    const rounded = Math.round(traits[id].amount * 100);
    if (slider) {
      slider.value = String(rounded);
      const value = slider.closest('.tone-row')?.querySelector('.tone-row__value');
      if (value) value.textContent = `${rounded}%`;
    }
    this._applyProjectSoundTraits(traits);
  },

  _closeTonePopover() {
    if (this._toneClickOutsideHandler) {
      document.removeEventListener('pointerdown', this._toneClickOutsideHandler, true);
      this._toneClickOutsideHandler = null;
    }
    this._tonePopover?.remove();
    this._tonePopover = null;
    this.el?.querySelector('#tone-button')?.setAttribute('aria-expanded', 'false');
  },
};
