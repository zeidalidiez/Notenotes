/**
 * canvasTracks — CanvasMode feature extracted for size; composed back onto
 * CanvasMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { TRACK_INSTRUMENTS } from '../engine/PlaybackEngine.js';
import { DRUM_KITS } from '../instruments/SketchKit.js';
import { PRESETS, normalizeSoundTraits } from '../instruments/WebAudioSynth.js';
import { CLIP_TIME_SCALE_PRESETS, clipVisualDurationBars, normalizeClipTimeScale, pushClipsRightForTimeScale } from '../engine/ClipTimeScale.js';
import { normalizeTrackPan } from '../engine/StereoWidth.js';
import { showToast } from '../ui/Toast.js';
import { ChoicePicker } from '../ui/ChoicePicker.js';

export const CanvasTracksMixin = {
  _customPatchInstruments() {
    return (this.project?.settings?.customInstruments || []).filter(instrument => instrument.type === 'patch');
  },

  _customKitInstruments() {
    return (this.project?.settings?.customInstruments || []).filter(instrument => instrument.type === 'kit');
  },

  _isDrumInstrumentId(instrumentId) {
    return instrumentId === 'kit'
      || !!DRUM_KITS[instrumentId]
      || this._customKitInstruments().some(instrument => `custom:${instrument.id}` === instrumentId);
  },

  _midiInstrumentGroups() {
    const builtIns = Object.values(TRACK_INSTRUMENTS).filter(inst => inst.type === 'synth');
    const itemForBuiltIn = inst => {
      const patch = PRESETS[inst.preset] || PRESETS[inst.id] || {};
      return {
        value: inst.id,
        label: inst.name,
        kicker: (patch.family || 'chip') === 'modern' ? 'Modern synth track' : 'Chip synth track',
        description: this._instrumentDescription(patch),
        tags: [patch.family, patch.oscillator?.type, patch.filter?.type, inst.name].filter(Boolean),
      };
    };
    const chip = builtIns.filter(inst => (PRESETS[inst.preset]?.family || 'chip') === 'chip').map(itemForBuiltIn);
    const modern = builtIns.filter(inst => PRESETS[inst.preset]?.family === 'modern').map(itemForBuiltIn);
    const groups = [
      { id: 'chip', label: 'Chip presets', items: chip },
      { id: 'modern', label: 'Modern presets', items: modern },
    ];
    const custom = this._customPatchInstruments().map(instrument => ({
      value: `custom:${instrument.id}`,
      label: instrument.name || 'Untitled instrument',
      kicker: 'Custom sample patch',
      description: instrument.playbackMode === 'oneShot' ? 'One-shot sample instrument' : 'Gated sample instrument',
      tags: ['custom', 'sample', instrument.name],
    }));
    if (custom.length) groups.push({ id: 'custom', label: 'Custom instruments', items: custom });
    return groups;
  },

  _drumInstrumentGroups() {
    const builtIns = Object.entries(DRUM_KITS).map(([id, kit]) => ({
      value: id,
      label: kit.name,
      kicker: 'Drum kit',
      description: `${Object.keys(kit.sounds || {}).length} synthesized sounds`,
      tags: ['drum', 'kit', kit.name],
    }));
    const groups = [{ id: 'drum', label: 'Drum kits', items: builtIns }];
    const custom = this._customKitInstruments().map(instrument => ({
      value: `custom:${instrument.id}`,
      label: instrument.name || 'Untitled kit',
      kicker: 'Custom kit',
      description: 'Custom drum instrument',
      tags: ['custom', 'kit', instrument.name],
    }));
    if (custom.length) groups.push({ id: 'custom', label: 'Custom instruments', items: custom });
    return groups;
  },

  _instrumentDescription(patch = {}) {
    const bits = [];
    if (patch.oscillator?.type) bits.push(patch.oscillator.type);
    if (patch.unison?.voices) bits.push(`${patch.unison.voices}-voice unison`);
    if (patch.filterEnv) bits.push('filter motion');
    if (patch.vibrato) bits.push('vibrato');
    if (patch.drive) bits.push('drive');
    return bits.join(' - ') || 'Synth patch';
  },

  _trackInstrumentGroups(track) {
    if (track?.type === 'drum') return this._drumInstrumentGroups();
    return this._midiInstrumentGroups();
  },

  _instrumentName(instrumentId) {
    if (instrumentId?.startsWith?.('custom:')) {
      const id = instrumentId.slice(7);
      return this._customPatchInstruments().find(instrument => instrument.id === id)?.name
        || this._customKitInstruments().find(instrument => instrument.id === id)?.name
        || 'Custom instrument';
    }
    if (instrumentId === 'kit') return DRUM_KITS.classic.name;
    if (DRUM_KITS[instrumentId]) return DRUM_KITS[instrumentId].name;
    return TRACK_INSTRUMENTS[instrumentId]?.name || instrumentId;
  },

  _tonePresets() {
    return Array.isArray(this.project?.settings?.tonePresets) ? this.project.settings.tonePresets : [];
  },

  _refreshTonePresetSelect() {
    const picker = this.el?.querySelector('#canvas-tone-preset');
    if (!picker) return;
    const selectedId = picker.dataset.selectedTonePreset || '';
    const preset = this._tonePresets().find(p => p.id === selectedId) || null;
    this._setSelectedTonePreset(preset);
    this._syncClipTools();
  },

  _tonePresetSummary(traits = {}) {
    const normalized = normalizeSoundTraits(traits);
    const labels = {
      crush: 'Crush',
      echo: 'Echo',
      space: 'Space',
      wobble: 'Wobble',
      drive: 'Drive',
      noise: 'Noise',
    };
    const active = Object.entries(labels)
      .filter(([id]) => (normalized[id]?.amount || 0) > 0.03)
      .map(([id, label]) => `${label} ${Math.round((normalized[id]?.amount || 0) * 100)}%`);
    return active.length ? active.join(' - ') : 'No Tone';
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

  _setSelectedTonePreset(preset) {
    const picker = this.el?.querySelector('#canvas-tone-preset');
    const label = this.el?.querySelector('#canvas-tone-preset-label');
    if (picker) picker.dataset.selectedTonePreset = preset?.id || '';
    if (label) label.textContent = preset?.name || 'Tone preset...';
  },

  _openTrackInstrumentPicker(anchor) {
    const trackId = anchor?.dataset.trackInst;
    const track = this.project?.tracks.find(t => t.id === trackId);
    if (!track || track.type === 'audio') return;
    const picker = new ChoicePicker({
      title: track.type === 'drum' ? 'Choose Drum Kit' : 'Choose Track Instrument',
      groups: this._trackInstrumentGroups(track),
      selectedValue: track.instrumentId === 'kit' ? 'classic' : track.instrumentId,
      searchPlaceholder: 'Search instruments...',
      onSelect: (value) => this._setTrackInstrument(trackId, value),
    });
    picker.open(anchor);
  },

  _setTrackInstrument(trackId, instrumentId) {
    const track = this.project?.tracks.find(t => t.id === trackId);
    if (!track) return;
    track.instrumentId = instrumentId;
    this.store?.scheduleAutoSave(this.project);

    if (this.onTrackInstrumentChanged) {
      this.onTrackInstrumentChanged(trackId);
    }

    const instName = this._instrumentName(instrumentId);
    this._renderTracks();
    showToast(`${track.name}: ${instName}`);
  },

  _openTonePresetPicker(anchor) {
    if (anchor?.disabled) return;
    this._tonePicker?.close();
    this._tonePicker = new ChoicePicker({
      title: 'Choose Tone Preset',
      groups: this._tonePresetGroups(),
      selectedValue: anchor?.dataset.selectedTonePreset || '',
      searchPlaceholder: 'Search Tone presets...',
      onSelect: (value) => {
        this._setSelectedTonePreset(this._tonePresets().find(preset => preset.id === value) || null);
      },
    });
    this._tonePicker.open(anchor);
  },

  _applyTonePresetToSelectedClip() {
    const presetId = this.el?.querySelector('#canvas-tone-preset')?.dataset.selectedTonePreset || '';
    const preset = this._tonePresets().find(p => p.id === presetId);
    if (!preset) return showToast('Choose a Tone preset first');
    const clip = this._findClip();
    if (!clip) return showToast('Select a clip first');
    if (clip.snippet?.type === 'audio') return showToast('Tone presets work on MIDI and drum clips');
    clip.soundTraits = normalizeSoundTraits(preset.soundTraits);
    this.store?.scheduleAutoSave(this.project);
    this._renderTracks();
    showToast(`Tone preset applied: ${preset.name}`);
  },

  _panLabel(pan = 0) {
    const value = normalizeTrackPan(pan);
    if (Math.abs(value) < 0.01) return 'C';
    const side = value < 0 ? 'L' : 'R';
    return `${side}${Math.round(Math.abs(value) * 100)}`;
  },

  _openTrackPanModal(trackId) {
    const track = this.project?.tracks?.find(item => item.id === trackId);
    if (!track) return;
    const current = normalizeTrackPan(track.pan);
    const currentValue = Math.round(current * 100);
    const overlay = document.createElement('div');
    overlay.className = 'canvas-time-modal-backdrop';
    overlay.innerHTML = `
      <div class="canvas-time-modal canvas-pan-modal" role="dialog" aria-modal="true" aria-label="Track Pan">
        <div class="canvas-time-modal__header">
          <span class="canvas-time-modal__kicker">Track mix</span>
          <strong>Pan ${track.name}</strong>
        </div>
        <div class="canvas-pan-modal__readout" id="canvas-pan-readout">${this._panLabel(current)}</div>
        <input class="canvas-pan-modal__slider" id="canvas-pan-slider" type="range" min="-100" max="100" step="1" value="${currentValue}" aria-label="Track pan" />
        <div class="canvas-pan-modal__presets">
          <button class="canvas-time-modal__option" type="button" data-pan-preset="-100"><span>Hard L</span><small>Send this track left</small></button>
          <button class="canvas-time-modal__option" type="button" data-pan-preset="0"><span>Center</span><small>Reset to middle</small></button>
          <button class="canvas-time-modal__option" type="button" data-pan-preset="100"><span>Hard R</span><small>Send this track right</small></button>
        </div>
        <p class="canvas-time-modal__note">Canvas WAV export is stereo and keeps this track position. MIDI export ignores pan for now.</p>
        <div class="canvas-time-modal__actions">
          <button class="btn btn--ghost" id="canvas-pan-cancel" type="button">Cancel</button>
          <button class="btn" id="canvas-pan-save" type="button">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const slider = overlay.querySelector('#canvas-pan-slider');
    const readout = overlay.querySelector('#canvas-pan-readout');
    const close = () => overlay.remove();
    const updateReadout = () => {
      const next = normalizeTrackPan(Number(slider.value) / 100);
      if (readout) readout.textContent = this._panLabel(next);
    };

    overlay.querySelector('#canvas-pan-cancel')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      close();
    });
    overlay.querySelector('#canvas-pan-save')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const next = normalizeTrackPan(Number(slider.value) / 100);
      close();
      this._setTrackPan(track, next);
    });
    overlay.querySelectorAll('[data-pan-preset]').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        slider.value = btn.dataset.panPreset;
        updateReadout();
      });
    });
    slider?.addEventListener('input', updateReadout);
  },

  _setTrackPan(track, nextPan) {
    const previousPan = normalizeTrackPan(track.pan);
    const pan = normalizeTrackPan(nextPan);
    if (previousPan === pan) {
      showToast('Track pan unchanged');
      return;
    }

    track.pan = pan;
    this.store?.scheduleAutoSave(this.project);
    this.onTrackMixChanged?.(track.id);
    this._renderTracks();
    showToast(`${track.name}: pan ${this._panLabel(pan)}`);

    this.undoManager?.push({
      type: 'trackPan',
      description: 'Change track pan',
      undo: () => {
        track.pan = previousPan;
        this.store?.scheduleAutoSave(this.project);
        this.onTrackMixChanged?.(track.id);
        this._renderTracks();
      },
      redo: () => {
        track.pan = pan;
        this.store?.scheduleAutoSave(this.project);
        this.onTrackMixChanged?.(track.id);
        this._renderTracks();
      },
    });
  },

  _openTimeScaleModal(clip) {
    const track = this._trackForClip(clip);
    if (!clip || !track) return;
    const current = normalizeClipTimeScale(clip.timeScale);
    const overlay = document.createElement('div');
    overlay.className = 'canvas-time-modal-backdrop';
    overlay.innerHTML = `
      <div class="canvas-time-modal" role="dialog" aria-modal="true" aria-label="Time Scale">
        <div class="canvas-time-modal__header">
          <span class="canvas-time-modal__kicker">Clip timing</span>
          <strong>Time Scale</strong>
        </div>
        <div class="canvas-time-modal__options">
          ${CLIP_TIME_SCALE_PRESETS.map(preset => `
            <button class="canvas-time-modal__option${preset.value === current ? ' is-selected' : ''}" type="button" data-time-scale="${preset.value}">
              <span>${preset.label}</span>
              <small>${preset.description}</small>
            </button>
          `).join('')}
        </div>
        <p class="canvas-time-modal__note">Growth keeps the clip start fixed and pushes later clips on this track to the right. Audio uses tape-style speed, so pitch changes with timing.</p>
        <div class="canvas-time-modal__actions">
          <button class="btn btn--ghost" id="canvas-time-cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#canvas-time-cancel')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      close();
    });

    overlay.querySelectorAll('[data-time-scale]').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const nextScale = normalizeClipTimeScale(btn.dataset.timeScale);
        close();
        this._applyClipTimeScale(track, clip, nextScale);
      });
    });
  },

  _applyClipTimeScale(track, clip, nextScale) {
    const previousScale = normalizeClipTimeScale(clip.timeScale);
    if (previousScale === nextScale) {
      showToast('Clip timing unchanged');
      return;
    }

    const previousDuration = Number(clip.durationBars) || clipVisualDurationBars(clip, this.transport.ticksPerBar);
    const previousStarts = (track.clips || []).map(item => ({ clip: item, startBar: Number(item.startBar) || 0 }));
    const result = pushClipsRightForTimeScale(track, clip, nextScale, this.transport.ticksPerBar);
    const nextDuration = result.newDurationBars;
    const nextStarts = (track.clips || []).map(item => ({ clip: item, startBar: Number(item.startBar) || 0 }));

    this.store?.scheduleAutoSave(this.project);
    this._renderTracks();
    this._autoSetLoopFromClips();
    this._setTimeToolActive(false);

    this.undoManager?.push({
      type: 'timeScaleClip',
      description: 'Change clip timing',
      undo: () => {
        clip.timeScale = previousScale;
        clip.durationBars = previousDuration;
        previousStarts.forEach(item => { item.clip.startBar = item.startBar; });
        this._renderTracks();
        this._autoSetLoopFromClips();
      },
      redo: () => {
        clip.timeScale = nextScale;
        clip.durationBars = nextDuration;
        nextStarts.forEach(item => { item.clip.startBar = item.startBar; });
        this._renderTracks();
        this._autoSetLoopFromClips();
      },
    });

    const preset = CLIP_TIME_SCALE_PRESETS.find(item => item.value === nextScale);
    const moved = result.moved.length ? `, pushed ${result.moved.length}` : '';
    showToast(`${preset?.label || 'Time scale'} applied${moved}`);
  },
};
