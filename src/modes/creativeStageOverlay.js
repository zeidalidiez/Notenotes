/**
 * creativeStageOverlay — CreativeMode feature extracted for size; composed back onto
 * CreativeMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { degreeForMidi, midiToNoteName } from '../engine/MusicTheory.js';
import { CanvasStageRenderer } from '../stage/CanvasStageRenderer.js';
import { STAGE_LIVE_LANE_LIMIT, stageUnitTicksForMeter } from '../stage/StageModel.js';
import { INSTRUMENTS, STAGE_DRUM_PITCHES } from './creativeConstants.js';

export const CreativeStageOverlayMixin = {
  _stageLaneCount() {
    if (this.activeInstrument === INSTRUMENTS.PIANO) {
      return Math.max(1, Math.min(STAGE_LIVE_LANE_LIMIT, this.microPiano?.visibleMidis?.().length || 12));
    }
    if (this.activeInstrument === INSTRUMENTS.KIT) {
      return Math.max(1, Math.min(10, this.sketchKit?._visibleSounds?.().length || 10));
    }
    if (this.activeInstrument === INSTRUMENTS.MIC) return 1;
    return Math.max(1, Math.min(16, this.scaleBoard?._notes?.length || 8));
  },

  _stageLaneLabel(index) {
    if (this.activeInstrument === INSTRUMENTS.PIANO) {
      const midi = this.microPiano?.visibleMidis?.()[index];
      return midiToNoteName(midi)?.display || String(index + 1);
    }
    if (this.activeInstrument === INSTRUMENTS.KIT) {
      return this.sketchKit?._visibleSounds?.()[index]?.label || String(index + 1);
    }
    const midi = this.scaleBoard?._notes?.[index];
    return midiToNoteName(midi)?.display || String(index + 1);
  },

  _stageInputItems() {
    return Array.from({ length: this._stageLaneCount() }, (_, index) => {
      const label = this._stageLaneLabel(index);
      if (this.activeInstrument === INSTRUMENTS.KIT) {
        const drum = this.sketchKit?._visibleSounds?.()[index];
        return { label: this._stageKitInputLabel(drum, label), color: this._stageColorForDrum(drum?.id || label) };
      }
      const midi = this.activeInstrument === INSTRUMENTS.PIANO
        ? this.microPiano?.visibleMidis?.()[index]
        : this.scaleBoard?._notes?.[index];
      return { label, color: Number.isFinite(midi) ? this._stageColorForMidi(midi) : '#7bd88f' };
    });
  },

  _stageInputNotice() {
    return this.gamepadInput?.state?.().connected
      ? 'Controller connected. Tap lanes too.'
      : 'No controller detected. Tap lanes here.';
  },

  _stageKitInputLabel(drum = {}, fallback = '') {
    const labels = {
      kick: 'KICK',
      snare: 'SNARE',
      clap: 'CLAP',
      hihat: 'HAT',
      cymbal: 'CYM',
      tomlo: 'TOM L',
      tommid: 'TOM M',
      tomhi: 'TOM H',
      rim: 'RIM',
      shaker: 'SHAKE',
    };
    return labels[drum?.id] || String(drum?.label || fallback || '').toUpperCase();
  },

  _stageInputDown(index) {
    if (this.activeInstrument === INSTRUMENTS.PIANO) {
      this.microPiano?.pressVisibleKey?.(index);
      return;
    }
    if (this.activeInstrument === INSTRUMENTS.KIT) {
      this.sketchKit?.triggerVisiblePad?.(index);
      return;
    }
    this.scaleBoard?.pressPad?.(index);
  },

  _stageInputUp(index) {
    if (this.activeInstrument === INSTRUMENTS.PIANO) {
      this.microPiano?.releaseVisibleKey?.(index);
      return;
    }
    if (this.activeInstrument === INSTRUMENTS.KIT) return;
    this.scaleBoard?.releasePad?.(index);
  },

  _stageLaneForMidi(midi) {
    if (this.activeInstrument === INSTRUMENTS.PIANO) {
      const visible = this.microPiano?.visibleMidis?.() || [];
      const exact = visible.indexOf(midi);
      if (exact >= 0) return exact;
      if (visible.length) {
        return visible.reduce((best, value, index) => (
          Math.abs(value - midi) < Math.abs(visible[best] - midi) ? index : best
        ), 0);
      }
    }
    const notes = this.scaleBoard?._notes || [];
    const exact = notes.indexOf(midi);
    if (exact >= 0) return exact;
    if (notes.length) {
      return notes.reduce((best, value, index) => (
        Math.abs(value - midi) < Math.abs(notes[best] - midi) ? index : best
      ), 0);
    }
    return 0;
  },

  _stageColorForMidi(midi) {
    const degree = this._ensureDegreeHighlighting();
    if (degree?.enabled) {
      const meta = degreeForMidi(midi, this._ensureMusicalContext());
      if (meta && degree.colors?.[meta.interval]) return degree.colors[meta.interval];
    }
    if (this.activeInstrument === INSTRUMENTS.PIANO) return '#7d8cff';
    if (this.activeInstrument === INSTRUMENTS.CONTROLLER) return '#d783ff';
    return '#7bd88f';
  },

  _stageColorForDrum(drumName) {
    const sounds = this.sketchKit?._visibleSounds?.() || [];
    const index = Math.max(0, sounds.findIndex(sound => sound.id === drumName));
    const palette = ['#ff6b6b', '#f7b267', '#7bd88f', '#5bd6d6', '#7d8cff', '#d783ff', '#ff77c8', '#f05d8e', '#ff8a5c', '#6fb4ff'];
    return palette[index % palette.length];
  },

  _stageNoteOn(midi, velocity = 0.8, meta = {}) {
    const key = `${this.activeInstrument}:${midi}`;
    if (this._stageHeldNotes.has(key)) return;
    const note = midiToNoteName(midi)?.display || String(midi);
    const id = this.stageEvents.beginNote({
      source: this.activeInstrument,
      pitch: midi,
      lane: this._stageLaneForMidi(midi),
      startTick: this.transport?.currentTick || 0,
      velocity,
      color: this._stageColorForMidi(midi),
      label: note,
      meta,
    });
    this._stageHeldNotes.set(key, id);
  },

  _stageNoteOff(midi) {
    const key = `${this.activeInstrument}:${midi}`;
    const id = this._stageHeldNotes.get(key);
    if (!id) return;
    this.stageEvents.endNote(id, { endTick: this.transport?.currentTick || 0 });
    this._stageHeldNotes.delete(key);
  },

  _stageDrumHit(drumName) {
    const sounds = this.sketchKit?._visibleSounds?.() || [];
    const index = Math.max(0, sounds.findIndex(sound => sound.id === drumName));
    this.stageEvents.hit({
      source: INSTRUMENTS.KIT,
      drum: drumName,
      pitch: STAGE_DRUM_PITCHES[drumName] || (36 + index * 3),
      lane: index,
      startTick: this.transport?.currentTick || 0,
      color: this._stageColorForDrum(drumName),
      label: sounds[index]?.label || drumName,
    });
  },

  _toggleStageOverlay() {
    if (this._stageOverlay) {
      this._stageOverlay.close();
      return;
    }
    const title = this.activeInstrument === INSTRUMENTS.KIT
      ? 'Kit Stage'
      : (this.activeInstrument === INSTRUMENTS.PIANO ? 'Piano Stage' : 'Pad Stage');
    this._stageOverlay = new CanvasStageRenderer({
      title,
      subtitle: 'A first-pass performance highway for the active Create surface.',
      mode: 'live',
      eventStream: this.stageEvents,
      getLaneCount: () => this._stageLaneCount(),
      getLaneLabel: (index) => this._stageLaneLabel(index),
      maxLanes: STAGE_LIVE_LANE_LIMIT,
      getNowTick: () => this.transport?.currentTick || 0,
      getUnitTicks: () => stageUnitTicksForMeter(this.transport),
      getUnitSeconds: () => stageUnitTicksForMeter(this.transport) * (this.transport?.secondsPerTick || 0),
      getInputItems: () => this._stageInputItems(),
      getInputNotice: () => this._stageInputNotice(),
      onInputDown: (index) => this._stageInputDown(index),
      onInputUp: (index) => this._stageInputUp(index),
      onClose: () => {
        this._stageOverlay = null;
        this._syncStageButton();
      },
    });
    this._stageOverlay.open();
    this._syncStageButton();
  },

  _syncStageButton() {
    this.el?.querySelectorAll('.stage-button').forEach(btn => {
      btn.classList.toggle('is-active', !!this._stageOverlay);
      btn.setAttribute('aria-pressed', String(!!this._stageOverlay));
    });
  },
};
