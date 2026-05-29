import { GamepadInputManager } from '../../engine/GamepadInputManager.js';
import { showToast } from '../../ui/Toast.js';
import { PERFORMANCE_KEYS } from '../../ui/PerformanceKeys.js';

export class PerformanceInputRouter {
  constructor({
    gamepadInput = new GamepadInputManager(),
    instrumentIds,
    getActiveInstrument,
    getScaleBoard,
    getMicroPiano,
    getSketchKit,
    getControllerMode,
    isCreativeActive,
    isControllerMapperOpen,
    ensureAudioReady,
    shiftActiveInstrumentOctave,
    refreshControllerMapperStatus,
    handleControllerButtonDown,
    handleControllerButtonUp,
  }) {
    this.gamepadInput = gamepadInput;
    this.instrumentIds = instrumentIds;
    this._getActiveInstrument = getActiveInstrument;
    this._getScaleBoard = getScaleBoard;
    this._getMicroPiano = getMicroPiano;
    this._getSketchKit = getSketchKit;
    this._getControllerMode = getControllerMode;
    this._isCreativeActive = isCreativeActive;
    this._isControllerMapperOpen = isControllerMapperOpen;
    this._ensureAudioReady = ensureAudioReady;
    this._shiftActiveInstrumentOctave = shiftActiveInstrumentOctave;
    this._refreshControllerMapperStatus = refreshControllerMapperStatus;
    this._handleControllerButtonDown = handleControllerButtonDown;
    this._handleControllerButtonUp = handleControllerButtonUp;

    this._keyboardBound = false;
    this._gamepadInputBound = false;
    this._midiBound = false;
    this._midiAccess = null;
    this._heldScaleKeyPads = new Map();
    this._heldPianoKeyIndexes = new Map();
    this._activeMidiNotes = new Map();
  }

  bindKeyboardPerformance() {
    if (this._keyboardBound) return;
    this._keyboardBound = true;

    document.addEventListener('keydown', (e) => {
      if (!this._isCreativeActive() || isTextInput(e.target) || e.repeat) return;

      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        if (this._shiftActiveInstrumentOctave(e.code === 'ArrowUp' ? 1 : -1)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      const activeInstrument = this._getActiveInstrument();
      const scaleBoard = this._getScaleBoard();
      const microPiano = this._getMicroPiano();
      const sketchKit = this._getSketchKit();

      if (activeInstrument === this.instrumentIds.SCALEBOARD) {
        if (scaleBoard?.padMode === 'step') {
          if (!PERFORMANCE_KEYS.includes(e.code)) return;
          e.preventDefault();
          e.stopPropagation();
          this._ensureAudioReady();
          scaleBoard.triggerStepPlay();
          return;
        }
        const idx = padPerformanceIndex(e.code, scaleBoard?._notes?.length || 0);
        if (idx === -1) return;

        e.preventDefault();
        e.stopPropagation();
        this._ensureAudioReady();
        this._heldScaleKeyPads.set(e.code, idx);
        scaleBoard.pressPad(idx);
        return;
      }

      if (activeInstrument === this.instrumentIds.PIANO) {
        const idx = pianoPerformanceIndex(e.code, microPiano?.visibleMidis?.().length || 0);
        if (idx === -1) return;

        e.preventDefault();
        e.stopPropagation();
        this._ensureAudioReady();
        this._heldPianoKeyIndexes.set(e.code, idx);
        microPiano.pressVisibleKey(idx);
        return;
      }

      if (activeInstrument === this.instrumentIds.KIT) {
        const idx = performanceIndexForSurface(e.code, sketchKit?.visiblePadIds?.().length || 0, { reverse: false });
        if (idx === -1) return;

        e.preventDefault();
        e.stopPropagation();
        this._ensureAudioReady();
        sketchKit.triggerVisiblePad(idx);
      }
    }, true);

    document.addEventListener('keyup', (e) => {
      const scaleBoard = this._getScaleBoard();
      const microPiano = this._getMicroPiano();

      if (this._heldScaleKeyPads.has(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        const idx = this._heldScaleKeyPads.get(e.code);
        scaleBoard?.releasePad(idx);
        this._heldScaleKeyPads.delete(e.code);
        return;
      }

      if (this._heldPianoKeyIndexes.has(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        const idx = this._heldPianoKeyIndexes.get(e.code);
        microPiano?.releaseVisibleKey(idx);
        this._heldPianoKeyIndexes.delete(e.code);
      }
    }, true);
  }

  handlesPerformanceKey(code) {
    if (!this._isCreativeActive()) return false;
    const activeInstrument = this._getActiveInstrument();
    const scaleBoard = this._getScaleBoard();
    const microPiano = this._getMicroPiano();
    const sketchKit = this._getSketchKit();

    if (activeInstrument === this.instrumentIds.SCALEBOARD) {
      if (scaleBoard?.padMode === 'step') return PERFORMANCE_KEYS.includes(code);
      return padPerformanceIndex(code, scaleBoard?._notes?.length || 0) !== -1;
    }
    if (activeInstrument === this.instrumentIds.PIANO) {
      return pianoPerformanceIndex(code, microPiano?.visibleMidis?.().length || 0) !== -1;
    }
    if (activeInstrument === this.instrumentIds.KIT) {
      return performanceIndexForSurface(code, sketchKit?.visiblePadIds?.().length || 0, { reverse: false }) !== -1;
    }
    return false;
  }

  async initMidiInput() {
    if (this._midiBound || typeof navigator === 'undefined' || !navigator.requestMIDIAccess) return;
    this._midiBound = true;
    try {
      this._midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this._bindMidiInputs();
      this._midiAccess.onstatechange = () => this._bindMidiInputs();
      if (this._midiAccess.inputs.size) showToast('MIDI input ready');
    } catch (err) {
      console.warn('[PerformanceInputRouter] MIDI input unavailable:', err);
      showToast('MIDI input unavailable or blocked');
    }
  }

  _bindMidiInputs() {
    if (!this._midiAccess) return;
    for (const input of this._midiAccess.inputs.values()) {
      input.onmidimessage = (event) => this._handleMidiMessage(event);
    }
  }

  _handleMidiMessage(event) {
    if (!this._isCreativeActive() || this._isControllerMapperOpen()) return;
    const [status, note, velocity] = event.data || [];
    const command = status & 0xf0;
    if (command === 0x90 && velocity > 0) {
      this._handleMidiNoteOn(note, velocity / 127);
    } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      this._handleMidiNoteOff(note);
    }
  }

  _handleMidiNoteOn(note, velocity = 0.8) {
    if (!Number.isFinite(note) || this._activeMidiNotes.has(note)) return;
    this._ensureAudioReady();

    const activeInstrument = this._getActiveInstrument();
    const scaleBoard = this._getScaleBoard();
    const microPiano = this._getMicroPiano();
    const sketchKit = this._getSketchKit();

    if (activeInstrument === this.instrumentIds.SCALEBOARD) {
      const bindingKey = `midi-${note}`;
      if (scaleBoard?.pressMidiInput(note, bindingKey, velocity)) {
        this._activeMidiNotes.set(note, { type: 'scale', bindingKey });
      }
      return;
    }

    if (activeInstrument === this.instrumentIds.PIANO) {
      microPiano?.pressControllerMidi(note, velocity);
      this._activeMidiNotes.set(note, { type: 'piano', midi: note });
      return;
    }

    if (activeInstrument === this.instrumentIds.KIT) {
      sketchKit?.triggerMidiInput(note, velocity);
    }
  }

  _handleMidiNoteOff(note) {
    const held = this._activeMidiNotes.get(note);
    if (!held) return;
    if (held.type === 'scale') this._getScaleBoard()?.releaseControllerPadBinding(held.bindingKey);
    else if (held.type === 'piano') this._getMicroPiano()?.releaseControllerMidi(held.midi);
    this._activeMidiNotes.delete(note);
  }

  startGamepad() {
    this._bindGamepadInput();
    this.gamepadInput.start();
  }

  _bindGamepadInput() {
    if (this._gamepadInputBound) return;
    this._gamepadInputBound = true;
    this.gamepadInput.on('buttonDown', ({ index, bindable }) => {
      if (!bindable) return;
      this._refreshControllerMapperStatus();
      this._handleControllerButtonDown(index);
    });
    this.gamepadInput.on('buttonUp', ({ index, bindable }) => {
      if (!bindable) return;
      this._refreshControllerMapperStatus();
      this._handleControllerButtonUp(index);
    });
    this.gamepadInput.on('buttons', () => this._refreshControllerMapperStatus());
    this.gamepadInput.on('state', () => this._refreshControllerMapperStatus());
  }

  releaseAll({ releaseControllerBinding, releaseControllerFallback } = {}) {
    const scaleBoard = this._getScaleBoard();
    const microPiano = this._getMicroPiano();
    for (const idx of this._heldScaleKeyPads.values()) {
      scaleBoard?.releasePad(idx);
    }
    for (const idx of this._heldPianoKeyIndexes.values()) {
      microPiano?.releaseVisibleKey(idx);
    }
    this._heldScaleKeyPads.clear();
    this._heldPianoKeyIndexes.clear();
    for (const note of [...this._activeMidiNotes.keys()]) this._handleMidiNoteOff(note);
    releaseControllerBinding?.();
    releaseControllerFallback?.();
  }
}

export function performanceIndexForSurface(code, count, { reverse = false } = {}) {
  const keyIndex = PERFORMANCE_KEYS.indexOf(code);
  if (keyIndex < 0 || keyIndex >= count) return -1;
  return reverse ? count - 1 - keyIndex : keyIndex;
}

export function padPerformanceIndex(code, count) {
  return performanceIndexForSurface(code, count, { reverse: false });
}

export function pianoPerformanceIndex(code, count) {
  return performanceIndexForSurface(code, count, { reverse: true });
}

function isTextInput(target) {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;
}
