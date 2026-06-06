/**
 * creativeInstruments — CreativeMode feature extracted for size; composed back onto
 * CreativeMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { PRESETS } from '../instruments/WebAudioSynth.js';
import { loadSampleIndex, loadSampleInstrument } from '../instruments/SamplePack.js';
import { ChoicePicker } from '../ui/ChoicePicker.js';
import { ARP_MODES } from '../engine/ArpeggioManager.js';
import { showToast } from '../ui/Toast.js';
import { INSTRUMENTS } from './creativeConstants.js';

export const CreativeInstrumentsMixin = {
  _patchDisplayName(id = this._activePatchId) {
    if (id?.startsWith?.('custom:')) {
      const instrument = this._customInstruments().find(item => item.id === id.slice(7));
      return instrument?.name || 'Custom instrument';
    }
    if (id?.startsWith?.('builtin:')) {
      const inst = (this._sampleIndex || []).find(item => item.id === id.slice(8));
      return inst?.name || 'Sample instrument';
    }
    return PRESETS[id]?.name || PRESETS.chip_lead.name;
  },

  _patchGroups() {
    const custom = this._customInstruments().filter(instrument => instrument.type === 'patch');
    const chipPresets = Object.entries(PRESETS).filter(([, p]) => (p.family || 'chip') === 'chip');
    const modernPresets = Object.entries(PRESETS).filter(([, p]) => p.family === 'modern');
    const fmPresets = Object.entries(PRESETS).filter(([, p]) => p.family === 'fm');
    const familyKicker = (p) => {
      switch (p.family) {
        case 'fm': return 'FM synth';
        case 'modern': return 'Modern synth';
        default: return 'Chip synth';
      }
    };
    const presetItem = ([key, patch]) => ({
      value: key,
      label: patch.name,
      kicker: familyKicker(patch),
      description: this._patchDescription(patch),
      tags: [patch.oscillator?.type, patch.filter?.type, patch.family].filter(Boolean),
    });
    const groups = [
      { id: 'chip', label: 'Chip presets', items: chipPresets.map(presetItem) },
      { id: 'modern', label: 'Modern presets', items: modernPresets.map(presetItem) },
    ];
    if (fmPresets.length) {
      groups.push({ id: 'fm', label: 'FM synths (2-operator)', items: fmPresets.map(presetItem) });
    }
    const builtinSamples = this._sampleIndex || [];
    if (builtinSamples.length) {
      groups.push({
        id: 'builtin-sample',
        label: 'Sample instruments',
        items: builtinSamples.map(inst => ({
          value: `builtin:${inst.id}`,
          label: inst.name,
          kicker: inst.category ? `${inst.category} - CC0 sample` : 'CC0 sample',
          description: inst.range
            ? `Sampled ${inst.range} - notes outside this range fold in by octave`
            : 'Multi-sampled real instrument (loads on first use)',
          tags: ['sample', inst.category, inst.range, inst.name].filter(Boolean),
        })),
      });
    }
    if (custom.length) {
      groups.push({
        id: 'custom',
        label: 'Custom instruments',
        items: custom.map(instrument => ({
          value: `custom:${instrument.id}`,
          label: instrument.name || 'Untitled instrument',
          kicker: 'Sample patch',
          description: instrument.playbackMode === 'oneShot' ? 'One-shot sample instrument' : 'Gated sample instrument',
          tags: ['custom', 'sample', instrument.name],
        })),
      });
    }
    return groups;
  },

  _patchDescription(patch = {}) {
    const bits = [];
    if (patch.type === 'fm') {
      bits.push('2-op FM');
      const fm = patch.fm || {};
      if (Number.isFinite(fm.ratio) && fm.ratio !== 1) bits.push(`ratio ${fm.ratio}`);
    } else if (patch.oscillator?.type) {
      bits.push(patch.oscillator.type);
    }
    if (patch.unison?.voices) bits.push(`${patch.unison.voices}-voice unison`);
    if (patch.filterEnv) bits.push('filter motion');
    if (patch.vibrato) bits.push('vibrato');
    if (patch.drive) bits.push('drive');
    return bits.join(' - ') || 'Simple synth patch';
  },

  async _openPatchPicker(anchor) {
    if (this.activeInstrument === INSTRUMENTS.KIT) return;
    if (!this._sampleIndex) { try { this._sampleIndex = await loadSampleIndex(); } catch (_) {} }
    this._patchPicker?.close();
    this._patchPicker = new ChoicePicker({
      title: 'Choose Instrument',
      groups: this._patchGroups(),
      selectedValue: this._activePatchId,
      searchPlaceholder: 'Search instruments...',
      onSelect: async (value) => {
        await this._selectPatch(value);
        this._refreshPatchSelector();
        this._syncInstrumentButtons();
      },
    });
    this._patchPicker.open(anchor);
  },

  _refreshPatchSelector() {
    const label = this.el?.querySelector('#patch-picker-label');
    const button = this.el?.querySelector('#patch-picker-button');
    if (label) label.textContent = this._patchDisplayName(this._activePatchId);
    if (button) {
      button.title = this._patchDisplayName(this._activePatchId);
      button.setAttribute('aria-label', `Synth patch: ${this._patchDisplayName(this._activePatchId)}`);
    }
    this._syncInstrumentButtons();
  },

  _syncInstrumentButtons() {
    const isCustom = this._activePatchId?.startsWith('custom:');
    const createBtn = this.el?.querySelector('#create-instrument-button');
    const deleteBtn = this.el?.querySelector('#delete-instrument-button');
    const patchLabel = this.el?.querySelector('#patch-selector-label');
    const patchPicker = this.el?.querySelector('#patch-picker-button');
    const toneBtn = this.el?.querySelector('#tone-button');
    const isKit = this.activeInstrument === INSTRUMENTS.KIT;
    if (patchLabel) patchLabel.hidden = isKit;
    if (patchPicker) patchPicker.hidden = isKit;
    if (toneBtn) toneBtn.hidden = isKit;
    if (createBtn) createBtn.textContent = isCustom ? 'Edit Instrument' : 'Create Instrument';
    if (deleteBtn) deleteBtn.hidden = !isCustom;
  },

  _customInstruments() {
    if (!this.project?.settings) return [];
    if (!Array.isArray(this.project.settings.customInstruments)) {
      this.project.settings.customInstruments = [];
    }
    return this.project.settings.customInstruments;
  },

  async _selectPatch(id = 'chip_lead') {
    this._activePatchId = id;
    if (id.startsWith('custom:')) {
      const instrument = this._customInstruments().find(item => item.id === id.slice(7));
      if (!instrument) {
        showToast('Custom instrument is missing');
        return;
      }
      await this._loadSamplePatch(instrument);
    } else if (id.startsWith('builtin:')) {
      await this._loadBuiltinSamplePatch(id.slice(8));
    } else {
      const patch = PRESETS[id];
      if (patch) this.synth.loadPatch(patch);
    }
    this._setLiveSoundTraits(this.controllerMode?.currentSoundTraits(this._currentToneTraits || this._ensureSoundTraits()));
  },

  async _loadSamplePatch(instrument) {
    if (!instrument?.audioAssetId || !this.store?.getAudioAssetBlob) {
      showToast('Sample audio is missing');
      return;
    }
    try {
      const blob = await this.store.getAudioAssetBlob(instrument.audioAssetId);
      if (!blob) throw new Error('Sample audio is unavailable');
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = await this.engine.ctx.decodeAudioData(arrayBuffer.slice(0));
      this.synth.loadPatch({
        type: 'sample',
        name: instrument.name,
        sampleBuffer: buffer,
        rootMidi: instrument.rootMidi ?? 60,
        playbackMode: instrument.playbackMode || 'gated',
        envelope: {
          attack: instrument.attack ?? 0.005,
          decay: instrument.decay ?? 0.08,
          sustain: instrument.sustain ?? 0.8,
          release: instrument.release ?? 0.18,
        },
        filter: {
          type: 'lowpass',
          frequency: instrument.brightness ? 1200 + instrument.brightness * 10800 : 9000,
          Q: 0.8,
        },
        gain: instrument.gain ?? 0.55,
      });
      showToast(`Instrument loaded: ${instrument.name}`);
    } catch (err) {
      console.warn('[CreativeMode] Custom instrument load failed:', err);
      showToast(err?.message || 'Custom instrument failed to load');
    }
  },

  async _loadBuiltinSamplePatch(id) {
    try {
      if (!this.engine?.ctx) this.engine?.initSync?.();
      const patch = await loadSampleInstrument(id);
      if (this._activePatchId !== `builtin:${id}`) return; // a newer selection superseded this load
      this.synth.loadPatch(patch);
      showToast(`Instrument loaded: ${patch.name}`);
    } catch (err) {
      console.warn('[CreativeMode] Built-in sample load failed:', err);
      showToast('Sample instrument failed to load');
    }
  },

  _toggleCreateInstrumentPopover(anchor) {
    this.createInstrumentPopover?.toggle(anchor);
  },

  async _saveCustomInstrument(root) {
    try {
      if (!this.project || !this.store) return;
      const name = root.querySelector('#ci-name')?.value?.trim();
      if (!name) return showToast('Name the instrument first');

      const type = root.querySelector('#ci-type')?.value || 'patch';
      const snippetId = root.querySelector('#ci-snippet')?.value;
      const file = root.querySelector('#ci-file')?.files?.[0];
      let audioAssetId = null;
      let audioMimeType = '';
      let audioSize = 0;

      const editingId = root.querySelector('.custom-instrument-form')?.dataset.editingId || '';
      const editingInstrument = editingId
        ? this._customInstruments().find(item => item.id === editingId) || null
        : null;
      if (editingInstrument && editingInstrument.type !== type) {
        const usage = this._customInstrumentUsage(editingInstrument.id);
        if (usage.count > 0) {
          showToast(`Switch ${usage.summary} before changing this instrument type`);
          return;
        }
      }

      if (file) {
        const record = await this.store.saveAudioAsset(file, {
          mimeType: file.type || 'audio/*',
          size: file.size,
          createdAt: Date.now(),
        });
        audioAssetId = record.audioAssetId;
        audioMimeType = record.mimeType;
        audioSize = record.size;
    } else if (snippetId) {
      const snippet = (this.project.snippets || []).find(item => item.id === snippetId);
      if (!snippet?.audioAssetId) return showToast('Choose an audio source first');
      audioAssetId = snippet.audioAssetId;
      audioMimeType = snippet.audioMimeType || '';
      audioSize = snippet.audioSize || 0;
      } else if (editingInstrument?.audioAssetId) {
        audioAssetId = editingInstrument.audioAssetId;
        audioMimeType = editingInstrument.audioMimeType || '';
        audioSize = editingInstrument.audioSize || 0;
      } else {
        return showToast('Choose an audio source first');
      }

      const instrument = {
        id: editingInstrument?.id || crypto.randomUUID(),
        name,
        type,
        audioAssetId,
        audioMimeType,
        audioSize,
        sourceSnippetId: snippetId || (file ? null : editingInstrument?.sourceSnippetId) || null,
        rootMidi: parseInt(root.querySelector('#ci-root')?.value, 10) || 60,
        playbackMode: root.querySelector('#ci-playback')?.value || 'gated',
        brightness: (parseInt(root.querySelector('#ci-brightness')?.value, 10) || 70) / 100,
        gain: (parseInt(root.querySelector('#ci-gain')?.value, 10) || 55) / 100,
        createdAt: editingInstrument?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      if (editingInstrument) Object.assign(editingInstrument, instrument);
      else this._customInstruments().push(instrument);
      this._customInstruments().sort((a, b) => a.name.localeCompare(b.name));
      await this._saveInstrumentChangeNow();
      window.dispatchEvent(new CustomEvent('project-custom-instruments-changed', {
        detail: { instrumentId: instrument.id, action: editingInstrument ? 'updated' : 'created' },
      }));
      this.sketchKit?.refreshKitSelector?.();
      this._refreshPatchSelector();
      this.snippetTray?._renderSnippets?.();
      if (type === 'patch') {
        await this._selectPatch(`custom:${instrument.id}`);
        this._refreshPatchSelector();
      } else if (this._activePatchId === `custom:${instrument.id}`) {
        await this._selectPatch('chip_lead');
        this._refreshPatchSelector();
      } else if (type === 'kit') {
        this.sketchKit?.loadKit?.(`custom:${instrument.id}`);
      }
      this._closeCreateInstrumentPopover();
      showToast(`${editingInstrument ? 'Instrument updated' : 'Instrument saved'}: ${name}`);
    } catch (err) {
      console.warn('[CreativeMode] Custom instrument save failed:', err);
      showToast(err?.message || 'Instrument save failed');
    }
  },

  _selectedCustomInstrument() {
    const selected = this.activeInstrument === INSTRUMENTS.KIT
      ? (this.sketchKit?.selectedKitId || '')
      : (this._activePatchId || '');
    if (!selected.startsWith('custom:')) return null;
    return this._customInstruments().find(item => item.id === selected.slice(7)) || null;
  },

  async _deleteSelectedCustomInstrument() {
    const selected = this.activeInstrument === INSTRUMENTS.KIT
      ? (this.sketchKit?.selectedKitId || '')
      : (this._activePatchId || '');
    if (!selected.startsWith('custom:')) {
      showToast('Choose a custom instrument to delete');
      return;
    }
    const id = selected.slice(7);
    const instrument = this._customInstruments().find(item => item.id === id);
    if (!instrument) return;
    const usage = this._customInstrumentUsage(id);
    if (usage.count > 0) {
      showToast(`Used by ${usage.summary}; switch those tracks first`);
      return;
    }
    if (!confirm(`Delete custom instrument "${instrument.name}"?`)) return;
    this.project.settings.customInstruments = this._customInstruments().filter(item => item.id !== id);
    if (instrument.type === 'kit') {
      this.sketchKit?.loadKit?.('classic');
      this.sketchKit?.refreshKitSelector?.();
    } else {
      this._activePatchId = 'chip_lead';
      this.synth.loadPatch(PRESETS.chip_lead);
    }
    await this._saveInstrumentChangeNow();
    window.dispatchEvent(new CustomEvent('project-custom-instruments-changed', {
      detail: { instrumentId: id, action: 'deleted' },
    }));
    this.sketchKit?.refreshKitSelector?.();
    this._refreshPatchSelector();
    this.snippetTray?._renderSnippets?.();
    showToast(`Instrument deleted: ${instrument.name}`);
  },

  _snippetInstrumentUsage(snippetId) {
    const snippet = (this.project?.snippets || []).find(item => item.id === snippetId);
    const instruments = this._customInstruments().filter(instrument =>
      instrument.sourceSnippetId === snippetId ||
      (!!snippet?.audioAssetId && instrument.audioAssetId === snippet.audioAssetId)
    );
    if (!instruments.length) return null;

    const names = instruments.map(instrument => instrument.name).join(', ');
    return {
      blocked: true,
      label: instruments.length === 1 ? 'Instrument' : `${instruments.length} instruments`,
      title: `Used by custom instrument${instruments.length === 1 ? '' : 's'}: ${names}`,
      onBlocked: () => showToast(`Used by instrument: ${names}`),
    };
  },

  async _saveInstrumentChangeNow() {
    if (!this.store || !this.project) return;
    await this.store.save(this.project);
    await this.store.saveVersion?.(this.project);
  },

  _customInstrumentUsage(id) {
    const ref = `custom:${id}`;
    const trackNames = [];
    let clipCount = 0;
    let snippetCount = 0;

    for (const track of this.project?.tracks || []) {
      if (track.instrumentId === ref) trackNames.push(track.name || 'Untitled track');
      for (const clip of track.clips || []) {
        if (clip.instrumentId === ref || clip.snippet?.instrumentId === ref || clip.snippet?.patchId === ref) {
          clipCount++;
        }
      }
    }

    for (const snippet of this.project?.snippets || []) {
      if (snippet.instrumentId === ref || snippet.patchId === ref) snippetCount++;
    }

    const parts = [];
    if (trackNames.length) {
      const preview = trackNames.slice(0, 2).join(', ');
      const extra = trackNames.length > 2 ? ` and ${trackNames.length - 2} more` : '';
      parts.push(`${trackNames.length} track${trackNames.length === 1 ? '' : 's'} (${preview}${extra})`);
    }
    if (clipCount) parts.push(`${clipCount} clip${clipCount === 1 ? '' : 's'}`);
    if (snippetCount) parts.push(`${snippetCount} snippet${snippetCount === 1 ? '' : 's'}`);

    return {
      count: trackNames.length + clipCount + snippetCount,
      summary: parts.join(', ') || '0 places',
    };
  },

  _closeCreateInstrumentPopover() {
    this.createInstrumentPopover?.close();
  },

  _switchInstrument(id) {
    if (id === this.activeInstrument) return;
    this._releaseKeyboardPerformance();
    this.synth.allNotesOff();
    this.arpManager.setMode(ARP_MODES.OFF);
    this.activeInstrument = id;

    this.el.querySelectorAll('.instrument-switcher__tab').forEach(tab => {
      tab.classList.toggle('is-active', tab.dataset.instrument === id);
    });

    this.el.querySelectorAll('.instrument-view').forEach(view => {
      view.classList.toggle('is-active', view.id === `instrument-${id}`);
    });

    this._syncPatchToolbarVisibility();
    this._closeControllerMapperPopover();
    this._syncInstrumentButtons();

    // AI Seed: visible only on Scale Board / Piano / Sketch Kit. Close the
    // popover when leaving a supported instrument so it doesn't linger over
    // a context the AI can't write for. If the popover is open and the new
    // instrument is supported, refresh it so the suggestion chips and the
    // active-instrument label update.
    this._syncCreateToolbarButtons();
    if (!this._aiCanGenerateForInstrument(id)) {
      this._closeAISeedPopover();
    } else {
      // The popover is anchored to whichever button was clicked. When the
      // user switches to a different instrument while it's open, close it —
      // the previous anchor may not be visible anymore. Re-opening the
      // popover from the new instrument's button gives a fresh, correctly-
      // positioned popover.
      this._closeAISeedPopover();
    }
  },

  _syncCreateToolbarButtons() {
    this._syncPatchToolbarVisibility();
    this._syncAISeedButtonVisibility();
    this._syncControllerMapperButtonVisibility();
    this._syncStageButton();
    const layoutBtn = this.el?.querySelector('#layout-button');
    if (layoutBtn) {
      const isScale = this.activeInstrument === INSTRUMENTS.SCALEBOARD;
      const isPiano = this.activeInstrument === INSTRUMENTS.PIANO;
      layoutBtn.style.display = '';
      layoutBtn.textContent = 'Layout';
      layoutBtn.disabled = !(isScale || isPiano);
      layoutBtn.setAttribute('aria-disabled', String(layoutBtn.disabled));
      layoutBtn.title = isScale ? 'Pad layout and degree colors' : (isPiano ? 'Keyboard layout and degree colors' : 'Layout controls are available on Pads and Piano');
      if (!isScale) this._closePadsPopover();
      if (!isPiano) this._closeKeysPopover();
    }
  },

  _syncPatchToolbarVisibility() {
    const patchSel = this.el?.querySelector('#patch-selector');
    if (!patchSel) return false;
    const showToolbar = this.activeInstrument === INSTRUMENTS.SCALEBOARD
      || this.activeInstrument === INSTRUMENTS.PIANO
      || this.activeInstrument === INSTRUMENTS.CONTROLLER;
    patchSel.hidden = !showToolbar;
    patchSel.style.display = showToolbar ? '' : 'none';
    if (!showToolbar) {
      this._closeTonePopover();
      this._closePadsPopover();
      this._closeKeysPopover();
    }
    return showToolbar;
  },
};
