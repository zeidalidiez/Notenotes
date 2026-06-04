/**
 * PlaybackEngine — Reads clips from Canvas tracks and plays them
 * through the appropriate instruments during Transport playback.
 *
 * Subscribes to Transport tick events and triggers noteOn/noteOff
 * on the correct instrument for each track's clips.
 */

import { WebAudioSynth, PRESETS } from '../instruments/WebAudioSynth.js';
import { DRUM_KITS, SketchKit } from '../instruments/SketchKit.js';
import { AudioEngine } from './AudioEngine.js';
import { TransportState } from './Transport.js';
import { normalizeClipTimeScale } from './ClipTimeScale.js';
import { normalizeTrackPan } from './StereoWidth.js';

/** Available instruments for track assignment */
export const TRACK_INSTRUMENTS = {
  chip_lead:    { id: 'chip_lead',    name: 'Chip Lead',    type: 'synth', preset: 'chip_lead' },
  chip_bass:    { id: 'chip_bass',    name: 'Chip Bass',    type: 'synth', preset: 'chip_bass' },
  cyber_secks:  { id: 'cyber_secks',  name: 'Cyber Secks',  type: 'synth', preset: 'cyber_secks' },
  heartbound:   { id: 'heartbound',   name: 'Heartbound',   type: 'synth', preset: 'heartbound' },
  triforce:     { id: 'triforce',     name: 'Triforce',     type: 'synth', preset: 'triforce' },
  bliff:        { id: 'bliff',        name: 'Bliff',        type: 'synth', preset: 'bliff' },
  soft_pad:     { id: 'soft_pad',     name: 'Soft Pad',     type: 'synth', preset: 'soft_pad' },
  shimmer_lead: { id: 'shimmer_lead', name: 'Shimmer Lead', type: 'synth', preset: 'shimmer_lead' },
  lofi_keys:    { id: 'lofi_keys',    name: 'Lo-fi Keys',   type: 'synth', preset: 'lofi_keys' },
  warm_bass:    { id: 'warm_bass',    name: 'Warm Bass',    type: 'synth', preset: 'warm_bass' },
  pluck:        { id: 'pluck',        name: 'Pluck',        type: 'synth', preset: 'pluck' },
  organ:        { id: 'organ',        name: 'Organ',        type: 'synth', preset: 'organ' },
  modern_keys:  { id: 'modern_keys',  name: 'Modern Keys',  type: 'synth', preset: 'modern_keys' },
  modern_pad:   { id: 'modern_pad',   name: 'Modern Pad',   type: 'synth', preset: 'modern_pad' },
  modern_bass:  { id: 'modern_bass',  name: 'Modern Bass',  type: 'synth', preset: 'modern_bass' },
  modern_pluck: { id: 'modern_pluck', name: 'Modern Pluck', type: 'synth', preset: 'modern_pluck' },
  kit:          { id: 'kit',          name: 'Drum Kit',     type: 'kit',   preset: null },
};

export class PlaybackEngine {
  /**
   * @param {Transport} transport
   * @param {object} project - Project data with tracks[]
   */
  constructor(transport, project, store = null) {
    this.transport = transport;
    this.project = project;
    this.store = store;

    /** One synth instance per track (keyed by track ID) */
    this._trackSynths = new Map();
    /** One drum kit instance per track so track pan remains independent */
    this._trackKits = new Map();
    /** Currently active notes (for noteOff scheduling) */
    this._activeNotes = new Map(); // key: `${trackId}-${pitch}`, value: { synth, noteOffTick }

    this._initialized = false;
    this._lastProcessedTick = -1;
    this._audioBuffers = new Map();
    this._customSampleBuffers = new Map();
    this._customSampleLoads = new Map();
    this._engine = AudioEngine.getInstance();
    this._lastModIdx = new Map();   // snippetId → last modulation index processed
    this._lastClipLocalTick = new Map();
    this._toneTraitsHandler = null;
  }

  /**
   * Initialize audio nodes. Must be called after AudioEngine.init().
   */
  init() {
    if (this._initialized) return;

    // Subscribe to transport tick events
    this.transport.onTick((tick, nextTickTime) => {
      this._processTick(tick, nextTickTime);
    });

    // On stop, release all active notes
    this.transport.onStateChange((state) => {
      if (state === TransportState.STOPPED) {
        this._allNotesOff();
        this._lastProcessedTick = -1;
        this._lastModIdx.clear();
        this._lastClipLocalTick.clear();
      }
    });

    this.transport.onLoop((tick, audioTime) => {
      this._releaseActiveNotes(audioTime);
      this._lastModIdx.clear();
      this._lastClipLocalTick.clear();
    });

    this._toneTraitsHandler = () => this._applySoundTraitsToTrackSynths();
    window.addEventListener('project-sound-traits-changed', this._toneTraitsHandler);

    for (const track of this.project?.tracks || []) {
      const instDef = this._instrumentDef(track.instrumentId);
      if (instDef?.customInstrument) this._prepareCustomInstrument(instDef.customInstrument);
    }

    this._initialized = true;
  }

  /**
   * Get or create a synth instance for a track.
   * Each track gets its own synth with its own patch.
   * @param {object} track
   * @returns {WebAudioSynth|null}
   */
  _getSynthForTrack(track) {
    const instId = track.instrumentId || 'chip_lead';
    const instDef = this._instrumentDef(instId);

    if (!instDef || instDef.type === 'kit') return null;

    // Check if we already have a synth for this track
    let entry = this._trackSynths.get(track.id);
    if (entry && entry.instrumentId === instId) {
      entry.synth.setPan?.(normalizeTrackPan(track.pan));
      return entry.synth;
    }

    // Create new synth for this track
    const synth = new WebAudioSynth();
    synth.init();

    if (instDef.customInstrument) {
      const buffer = this._customSampleBuffers.get(instDef.customInstrument.id);
      if (!buffer) {
        this._prepareCustomInstrument(instDef.customInstrument);
        return null;
      }
      synth.loadPatch(this._samplePatchFromInstrument(instDef.customInstrument, buffer));
    } else {
      const preset = PRESETS[instDef.preset];
      if (preset) synth.loadPatch(preset);
    }
    synth.setSoundTraits(this.project?.settings?.soundTraits);
    synth.setPan?.(normalizeTrackPan(track.pan));

    this._trackSynths.set(track.id, { synth, instrumentId: instId });
    return synth;
  }

  _getKitForTrack(track, kitId = 'classic') {
    const id = kitId || 'classic';
    let entry = this._trackKits.get(track.id);
    if (!entry || entry.kitId !== id) {
      entry?.kit.panic?.();
      const kit = new SketchKit();
      kit.init();
      kit.loadKit(id);
      kit.setSoundTraits(this.project?.settings?.soundTraits);
      entry = { kit, kitId: id };
      this._trackKits.set(track.id, entry);
    }
    entry.kit.setPan?.(normalizeTrackPan(track.pan));
    return entry.kit;
  }

  _instrumentDef(instId) {
    if (instId === 'kit') {
      return { id: 'classic', name: DRUM_KITS.classic.name, type: 'kit', kitId: 'classic' };
    }
    if (DRUM_KITS[instId]) {
      return { id: instId, name: DRUM_KITS[instId].name, type: 'kit', kitId: instId };
    }
    if (instId?.startsWith?.('custom:')) {
      const instrument = (this.project?.settings?.customInstruments || [])
        .find(item => item.id === instId.slice(7));
      if (instrument?.type === 'kit') {
        return {
          id: instId,
          name: instrument.name,
          type: 'kit',
          kitId: instId,
          customInstrument: instrument,
        };
      }
      return instrument ? {
        id: instId,
        name: instrument.name,
        type: 'synth',
        customInstrument: instrument,
      } : null;
    }
    return TRACK_INSTRUMENTS[instId];
  }

  _samplePatchFromInstrument(instrument, buffer) {
    return {
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
    };
  }

  _prepareCustomInstrument(instrument) {
    if (!instrument?.audioAssetId || !this.store?.getAudioAssetBlob || !this._engine.ctx) return null;
    if (this._customSampleBuffers.has(instrument.id)) return this._customSampleBuffers.get(instrument.id);
    if (this._customSampleLoads.has(instrument.id)) return null;

    const load = (async () => {
      try {
        const blob = await this.store.getAudioAssetBlob(instrument.audioAssetId);
        if (!blob) throw new Error('Sample audio is unavailable');
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = await this._engine.ctx.decodeAudioData(arrayBuffer.slice(0));
        this._customSampleBuffers.set(instrument.id, buffer);
      } catch (err) {
        console.warn('[PlaybackEngine] Custom instrument load failed:', instrument.name, err);
      } finally {
        this._customSampleLoads.delete(instrument.id);
      }
    })();
    this._customSampleLoads.set(instrument.id, load);
    return null;
  }

  _applySoundTraitsToTrackSynths() {
    for (const [, entry] of this._trackSynths) {
      entry.synth.setSoundTraits(this.project?.settings?.soundTraits);
    }
    for (const [, entry] of this._trackKits) {
      entry.kit.setSoundTraits(this.project?.settings?.soundTraits);
    }
  }

  /**
   * Process a transport tick — check all tracks for notes to play.
   * @param {number} tick - Current transport tick
   * @param {number} nextTickTime - AudioContext time this tick occurs
   */
  _processTick(tick, nextTickTime) {
    if (!this.project?.tracks) return;
    if (this.transport.state === TransportState.STOPPED) return;

    const ticksPerBar = this.transport.ticksPerBar;

    // Determine which tracks should be audible (mute/solo logic)
    const hasSolo = this.project.tracks.some(t => t.solo);

    for (const track of this.project.tracks) {
      // Skip muted tracks; if any track is soloed, only play soloed tracks
      if (track.muted) continue;
      if (hasSolo && !track.solo) continue;

      const trackType = track.type || (track.instrumentId === 'kit' || DRUM_KITS[track.instrumentId] ? 'drum' : 'midi');
      const instId = trackType === 'drum' ? (track.instrumentId || 'classic') : (track.instrumentId || 'chip_lead');
      const instDef = this._instrumentDef(instId);
      if (trackType !== 'audio' && !instDef) continue;

      // Check each clip on this track
      for (const clip of (track.clips || [])) {
        const snippet = clip.snippet;
        if (!snippet) continue;
        if (trackType === 'audio' && snippet.type !== 'audio') continue;
        if (trackType === 'drum' && snippet.type !== 'drum') continue;
        if (trackType === 'midi' && snippet.type !== 'midi') continue;

        const timeScale = normalizeClipTimeScale(clip.timeScale);
        const clipStartTick = Math.round((clip.startBar || 0) * ticksPerBar);
        const clipEndTick = clipStartTick + Math.max(1, Math.round((snippet.durationTicks || ticksPerBar) * timeScale));

        // Is the current tick within this clip's range?
        if (tick < clipStartTick || tick >= clipEndTick) continue;

        const timelineLocalTick = tick - clipStartTick;
        const localTick = timelineLocalTick / timeScale;
        const clipKey = clip.id || `${track.id}-${clip.snippetId}-${clipStartTick}`;
        const lastLocalTick = this._lastClipLocalTick.get(clipKey);
        if (lastLocalTick !== undefined && localTick < lastLocalTick) {
          this._lastModIdx.delete(clipKey);
        }
        this._lastClipLocalTick.set(clipKey, localTick);

        // Play melodic notes
        const synth = instDef?.type === 'synth' ? this._getSynthForTrack(track) : null;
        if (instDef?.type === 'synth' && synth && snippet.notes) {
          for (const note of snippet.notes) {
            const noteStartTick = clipStartTick + Math.round((note.startTick || 0) * timeScale);
            if (noteStartTick === tick) {
              synth.setSoundTraits(clip.soundTraits || note.soundTraits || snippet.soundTraits || this.project?.settings?.soundTraits);
              synth.noteOn(note.pitch, note.velocity || 0.8, nextTickTime);
              const noteOffTick = tick + Math.max(1, Math.round((note.durationTick || 240) * timeScale));
              const key = `${track.id}-${note.pitch}`;
              this._activeNotes.set(key, { synth, pitch: note.pitch, noteOffTick });
            }
          }
        }

        // Play drum hits
        if (instDef?.type === 'kit' && snippet.hits) {
          const kit = this._getKitForTrack(track, instDef.kitId || 'classic');
          for (const hit of snippet.hits) {
            const hitStartTick = clipStartTick + Math.round((hit.startTick || 0) * timeScale);
            if (hitStartTick === tick) {
              kit.setSoundTraits(clip.soundTraits || hit.soundTraits || snippet.soundTraits || this.project?.settings?.soundTraits);
              kit._triggerSound(hit.type || 'kick', nextTickTime);
            }
          }
        }

        // Play audio snippets
        if (snippet.type === 'audio' && this._hasAudioSource(snippet) && timelineLocalTick === 0) {
          this._playAudioClip(snippet, nextTickTime, timeScale, normalizeTrackPan(track.pan));
        }

        // Apply recorded modulation
        if (snippet.modulation?.length && instDef?.type === 'synth') {
          this._applyModulation(snippet, synth, localTick, clipKey, nextTickTime);
        }
      }
    }

    // Process scheduled noteOffs
    for (const [key, entry] of this._activeNotes) {
      if (tick >= entry.noteOffTick) {
        entry.synth.noteOff(entry.pitch, nextTickTime);
        this._activeNotes.delete(key);
      }
    }

    this._lastProcessedTick = tick;
  }

  /**
   * Release all currently active notes.
   */
  _allNotesOff() {
    this._releaseActiveNotes();

    // Also stop all track synths
    for (const [, entry] of this._trackSynths) {
      entry.synth.allNotesOff();
    }
    for (const [, entry] of this._trackKits) {
      entry.kit.panic?.();
    }
  }

  panic() {
    this._releaseActiveNotes();
    for (const [, entry] of this._trackSynths) {
      entry.synth.panic?.();
    }
    for (const [, entry] of this._trackKits) entry.kit.panic?.();
  }

  _releaseActiveNotes(time = null) {
    for (const [key, entry] of this._activeNotes) {
      entry.synth.noteOff(entry.pitch, time ?? undefined);
    }
    this._activeNotes.clear();
  }

  /**
   * Called when a track's instrument changes — invalidate its cached synth.
   * @param {string} trackId
   */
  onTrackInstrumentChanged(trackId) {
    const entry = this._trackSynths.get(trackId);
    if (entry) {
      entry.synth.allNotesOff();
      this._trackSynths.delete(trackId);
    }
    const kitEntry = this._trackKits.get(trackId);
    if (kitEntry) {
      kitEntry.kit.panic?.();
      this._trackKits.delete(trackId);
    }
    const track = this.project?.tracks?.find(item => item.id === trackId);
    const instDef = this._instrumentDef(track?.instrumentId);
    if (instDef?.customInstrument) this._prepareCustomInstrument(instDef.customInstrument);
  }

  onTrackMixChanged(trackId) {
    const track = this.project?.tracks?.find(item => item.id === trackId);
    if (!track) return;
    this._trackSynths.get(trackId)?.synth.setPan?.(normalizeTrackPan(track.pan));
    this._trackKits.get(trackId)?.kit.setPan?.(normalizeTrackPan(track.pan));
  }

  onCustomInstrumentsChanged(instrumentId = null) {
    if (instrumentId) {
      this._customSampleBuffers.delete(instrumentId);
      this._customSampleLoads.delete(instrumentId);
    } else {
      this._customSampleBuffers.clear();
      this._customSampleLoads.clear();
    }

    const customRef = instrumentId ? `custom:${instrumentId}` : null;
    for (const [trackId, entry] of this._trackSynths) {
      if (!customRef || entry.instrumentId === customRef) {
        entry.synth.allNotesOff();
        this._trackSynths.delete(trackId);
      }
    }

    for (const [trackId, entry] of this._trackKits) {
      if (!customRef || entry.kitId === customRef) {
        entry.kit.panic?.();
        this._trackKits.delete(trackId);
      }
    }

    for (const track of this.project?.tracks || []) {
      if (track.instrumentId?.startsWith?.('custom:')) {
        const instDef = this._instrumentDef(track.instrumentId);
        if (instDef?.customInstrument) this._prepareCustomInstrument(instDef.customInstrument);
      }
    }
  }

  async _playAudioClip(snippet, audioTime = null, timeScale = 1, pan = 0) {
    const ctx = this._engine.ctx;
    if (!ctx || !this._hasAudioSource(snippet)) return;

    try {
      let buffer = this._audioBuffers.get(snippet.id);
      if (!buffer) {
        const arrayBuffer = this.store
          ? await this.store.audioSnippetToArrayBuffer(snippet)
          : await this._legacyAudioArrayBuffer(snippet);
        if (!arrayBuffer) {
          snippet.audioUnavailable = true;
          snippet.audioUnavailableReason ||= 'Audio data is not available in browser storage.';
          return;
        }
        buffer = await ctx.decodeAudioData(arrayBuffer);
        this._audioBuffers.set(snippet.id, buffer);
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 1 / Math.max(0.01, normalizeClipTimeScale(timeScale));
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      gain.gain.value = 0.7;
      source.connect(gain);
      if (panner) {
        panner.pan.setValueAtTime(normalizeTrackPan(pan), audioTime ?? ctx.currentTime);
        gain.connect(panner);
        panner.connect(this._engine.masterGain || ctx.destination);
      } else {
        gain.connect(this._engine.masterGain || ctx.destination);
      }
      source.start(audioTime ?? ctx.currentTime);
    } catch (err) {
      console.warn('[PlaybackEngine] Audio playback failed:', err);
    }
  }

  _audioSource(snippet) {
    return snippet?.audioDataUrl || snippet?.audioUrl || '';
  }

  _hasAudioSource(snippet) {
    return !!(snippet?.audioAssetId || this._audioSource(snippet));
  }

  async _legacyAudioArrayBuffer(snippet) {
    const source = this._audioSource(snippet);
    if (!source || source.startsWith('blob:')) return null;
    const response = await fetch(source);
    return response.arrayBuffer();
  }

  _applyModulation(snippet, synth, localTick, clipKey, audioTime = null) {
    if (!synth?._voices || !snippet.modulation) return;
    const key = clipKey || snippet.id;
    let idx = this._lastModIdx.get(key) || 0;
    const mod = snippet.modulation;

    while (idx < mod.length && mod[idx].tick <= localTick) {
      idx++;
    }
    idx = Math.max(0, idx - 1);

    if (idx < mod.length && idx !== this._lastModIdx.get(key)) {
      this._lastModIdx.set(key, idx);
      const pt = mod[idx];
      for (const [, voice] of synth._voices) {
        try {
          const time = audioTime ?? this._engine.ctx.currentTime;
          const detune = pt.pitchBend * 200;
          const oscs = [
            ...(voice.oscillators || []),
            ...(voice.oscillators2 || []),
            voice.osc,
            voice.osc2,
          ];
          for (const osc of oscs) osc?.detune?.setTargetAtTime(detune, time, 0.02);
          const modFreq = 400 + (pt.modulation / 2) * 7600;
          voice.filter?.frequency.setTargetAtTime(modFreq, time, 0.05);
        } catch (e) { /* ignore */ }
      }
    }
  }

  destroy() {
    this._allNotesOff();
    this._trackSynths.clear();
  }
}
