/**
 * creativeController — CreativeMode feature extracted for size; composed back onto
 * CreativeMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { controllerTargetLabel } from '../ui/ControllerMapperPopover.js';
import { showToast } from '../ui/Toast.js';
import { INSTRUMENTS, CONTROLLER_MODIFIER_BUTTONS } from './creativeConstants.js';

export const CreativeControllerMixin = {
  handlesPerformanceKey(code) {
    return this.performanceInput?.handlesPerformanceKey(code) || false;
  },

  _handleControllerButtonDown(index) {
    if (!this._isCreativeActive() || this.controllerMapper?.isOpen()) return;
    if (this.activeInstrument === INSTRUMENTS.SCALEBOARD && this.scaleBoard?.padMode === 'voices') return;
    if (CONTROLLER_MODIFIER_BUTTONS.has(index)) return;
    const binding = this._controllerBinding(index);
    if (binding) {
      this._playControllerBinding(index, binding);
      return;
    }
    this._playControllerFallbackDown(index);
  },

  _handleControllerButtonUp(index) {
    if (CONTROLLER_MODIFIER_BUTTONS.has(index)) return;
    this._releaseControllerBinding(index);
    this._playControllerFallbackUp(index);
  },

  _ensureControllerBindings() {
    if (!this.project.settings) this.project.settings = {};
    if (!this.project.settings.controllerBindings || Array.isArray(this.project.settings.controllerBindings)) {
      this.project.settings.controllerBindings = {};
    }
    return this.project.settings.controllerBindings;
  },

  _ensureControllerBindingPresets() {
    if (!this.project.settings) this.project.settings = {};
    if (!Array.isArray(this.project.settings.controllerBindingPresets)) {
      this.project.settings.controllerBindingPresets = [];
    }
    return this.project.settings.controllerBindingPresets;
  },

  _onControllerBindingsChanged() {
    this.store?.scheduleAutoSave(this.project);
    this.controllerMode?.refreshBindings?.();
  },

  _controllerBinding(index) {
    return this._ensureControllerBindings()[String(index)] || null;
  },

  _playControllerBinding(index, binding) {
    this.ensureAudioReady();
    if (binding.type === 'drum' && binding.padId) {
      this.sketchKit.triggerPad(binding.padId);
      return;
    }
    if (binding.type === 'scalePad' && Number.isFinite(binding.padIndex)) {
      if (this.scaleBoard?.padMode === 'voices') return;
      if (this._heldControllerPads.has(index)) return;
      const bindingKey = `controller-${index}`;
      const rootMidi = this.scaleBoard?._notes?.[binding.padIndex] ?? binding.midi;
      const modifiedMidis = this.controllerMode?.modifiedMidisForRoot?.(rootMidi);
      const played = this.scaleBoard.pressControllerPadBinding(bindingKey, {
        ...binding,
        midis: modifiedMidis || undefined,
      });
      if (!played) {
        showToast(`${controllerTargetLabel(binding)} is not available in the current Pads layout`);
        return;
      }
      this._heldControllerPads.set(index, bindingKey);
      return;
    }
    if (binding.type === 'midi' && Number.isFinite(binding.midi)) {
      if (this._heldControllerMidis.has(index)) return;
      const source = `controller-${index}`;
      const midis = this.controllerMode?.modifiedMidisForRoot?.(binding.midi) || [binding.midi];
      midis.forEach(midi => this.microPiano.pressControllerMidi(midi, 0.8, { source }));
      this._heldControllerMidis.set(index, { midis, source });
    }
  },

  _releaseControllerBinding(index) {
    if (this._heldControllerPads.has(index)) {
      const bindingKey = this._heldControllerPads.get(index);
      this.scaleBoard.releaseControllerPadBinding(bindingKey);
      this._heldControllerPads.delete(index);
      return;
    }
    if (!this._heldControllerMidis.has(index)) return;
    const held = this._heldControllerMidis.get(index);
    const midis = Array.isArray(held) ? held : (held?.midis || [held]);
    const source = held?.source || 'controller';
    midis.forEach(midi => this.microPiano.releaseControllerMidi(midi, { source }));
    this._heldControllerMidis.delete(index);
  },

  _playControllerFallbackDown(index) {
    const degreeMap = { 12: 0, 13: 1, 14: 2, 15: 3, 0: 4, 1: 5, 2: 6, 3: 0 };
    if (CONTROLLER_MODIFIER_BUTTONS.has(index)) return;

    const degree = degreeMap[index];
    if (degree === undefined) return;
    this.ensureAudioReady();

    if (this.activeInstrument === INSTRUMENTS.SCALEBOARD && degree < this.scaleBoard._notes.length) {
      if (this.scaleBoard?.padMode === 'step') {
        this.scaleBoard.triggerStepPlay();
        return;
      }
      const bindingKey = `fallback-${index}`;
      const midi = this.scaleBoard._notes[degree];
      const modifiedMidis = this.controllerMode?.modifiedMidisForRoot?.(midi);
      const played = this.scaleBoard.pressControllerPadBinding(bindingKey, {
        type: 'scalePad',
        padIndex: degree,
        midi,
        padMode: this.scaleBoard.padMode,
        padAction: this.scaleBoard._padActionForIndex?.(degree) || 'single',
        midis: modifiedMidis || undefined,
      });
      if (played) this._heldControllerFallback.set(index, { type: 'scale', value: bindingKey });
    } else if (this.activeInstrument === INSTRUMENTS.PIANO && degree < this.microPiano.visibleMidis().length) {
      const midi = this.microPiano.visibleMidis()[degree];
      const midis = this.controllerMode?.modifiedMidisForRoot?.(midi) || [midi];
      const source = `fallback-${index}`;
      midis.forEach(m => this.microPiano.pressControllerMidi(m, 0.8, { source }));
      this._heldControllerFallback.set(index, { type: 'piano', value: { midis, source } });
    } else if (this.activeInstrument === INSTRUMENTS.KIT && degree < this.sketchKit.visiblePadIds().length) {
      this.sketchKit.triggerVisiblePad(degree);
    } else if (this.activeInstrument === INSTRUMENTS.CONTROLLER) {
      this._heldControllerFallback.set(index, { type: 'controller', value: index });
      this.controllerMode.handleFallbackButtonDown(index);
    }
  },

  _playControllerFallbackUp(index) {
    const held = this._heldControllerFallback.get(index);
    if (!held) return;
    if (held.type === 'scale') this.scaleBoard.releaseControllerPadBinding(held.value);
    else if (held.type === 'piano') {
      const midis = held.value?.midis || [];
      const source = held.value?.source || `fallback-${index}`;
      midis.forEach(midi => this.microPiano.releaseControllerMidi(midi, { source }));
    }
    else if (held.type === 'controller') this.controllerMode.handleFallbackButtonUp(held.value);
    this._heldControllerFallback.delete(index);
  },

  _syncControllerMapperButtonVisibility() {
    const patchBtn = this.el?.querySelector('#controller-map-button');
    if (patchBtn) {
      const show = this.activeInstrument === INSTRUMENTS.SCALEBOARD
        || this.activeInstrument === INSTRUMENTS.PIANO
        || this.activeInstrument === INSTRUMENTS.CONTROLLER;
      const hiddenForVoice = this.activeInstrument === INSTRUMENTS.SCALEBOARD
        && this.scaleBoard?.padMode === 'voices';
      patchBtn.style.display = show && !hiddenForVoice ? '' : 'none';
      if (!show || hiddenForVoice) this._closeControllerMapperPopover();
    }
  },

  _toggleControllerMapperPopover(anchor, buttonEl) {
    if (this.controllerMapper?.isOpen()) {
      this._closeControllerMapperPopover();
      return;
    }
    this._closeTonePopover();
    this._closePadsPopover();
    this._closeKeysPopover();
    this._closeAISeedPopover();
    this.controllerMapper.open(anchor, buttonEl);
  },

  _refreshControllerMapperStatus() {
    this.controllerMapper?.refreshStatus();
  },

  _handleControllerLearnTarget(target) {
    return this.controllerMapper?.handleLearnTarget(target) || false;
  },

  _closeControllerMapperPopover() {
    this.controllerMapper?.close();
  },
};
