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

    /** When set, `_processTick` schedules only this snippet, ignoring
     *  Canvas tracks. Set via `setInspectSource(snippet|null)`. */
    this._inspectSource = null;
    /** Local tick of the previous inspect tick — used to detect loop wrap
     *  so we can release any held notes from the previous iteration. */
    this._lastInspectLocalTick = null;
    /** Notes held during inspect playback (key → { synth, pitch, endLocal }). */
    this._inspectActiveNotes = new Map();
    /** Dedicated inspect synth (lazy-created). */
    this._inspectSynth = null;
    /** Dedicated inspect kit (lazy-created). */
    this._inspectKit = null;
    /** Instrument id used to build the current `_inspectSynth`. Compared
     *  on every `setInspectSource` so the synth is reloaded with the
     *  snippet's new patch when the user picks a different one in the
     *  Inspect toolbar. */
    this._inspectSynthInstrumentId = null;
    /** Kit id used to build the current `_inspectKit`. Same idea as
     *  `_inspectSynthInstrumentId`, but for drum snippets. */
    this._inspectKitInstrumentId = null;

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
        this._allInspectNotesOff();
        this._lastProcessedTick = -1;
        this._lastModIdx.clear();
        this._lastClipLocalTick.clear();
        this._lastInspectLocalTick = null;
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
   * Set the snippet the inspect-mode play button should audition. Pass
   * `null` to return to Canvas playback. Resets the scheduling cursor so
   * a re-armed play always starts cleanly. When the snippet's resolved
   * instrument differs from the cached inspect synth/kit, the engine
   * drops them so the next `_getInspectSynth` / `_getInspectKit` builds
   * a fresh instance with the new patch/kit loaded.
   * @param {object|null} snippet
   */
  setInspectSource(snippet) {
    const next = snippet || null;
    if (this._inspectSource === next) return;

    this._allInspectNotesOff();
    this._inspectSource = next;
    this._lastProcessedTick = -1;
    this._lastInspectLocalTick = null;

    if (!next) {
      // Returning to Canvas playback — release the cached synth/kit so
      // the next inspect source starts from a clean slate.
      this._inspectSynth = null;
      this._inspectKit = null;
      this._inspectSynthInstrumentId = null;
      this._inspectKitInstrumentId = null;
      return;
    }

    // If the snippet's instrument changed, drop the cached synth/kit so
    // the next `_getInspectSynth` / `_getInspectKit` rebuilds them with
    // the new preset. We don't rebuild eagerly here because no audio is
    // playing yet (the play button hasn't been pressed) — building on
    // demand keeps idle state cheap.
    const midiId = next.type === 'midi'
      ? (next.patchRecorded?.instrumentId || next.instrumentId || next.patchId || 'modern_keys')
      : null;
    const kitId = next.type === 'drum'
      ? (next.kitRecorded?.instrumentId || next.instrumentId || next.kitId || 'classic')
      : null;
    if (midiId && this._inspectSynthInstrumentId && this._inspectSynthInstrumentId !== midiId) {
      this._inspectSynth = null;
    }
    if (kitId && this._inspectKitInstrumentId && this._inspectKitInstrumentId !== kitId) {
      this._inspectKit = null;
    }
  }

  _getInspectSynth() {
    if (!this._inspectSynth) {
      const synth = new WebAudioSynth();
      synth.init();
      // Prefer the snippet's recorded instrument; fall back to a sensible
      // default so an unrecorded/blank snippet still has something to
      // audition with.
      const instrumentId = this._inspectSource?.patchRecorded?.instrumentId
        || this._inspectSource?.instrumentId
        || this._inspectSource?.patchId
        || 'modern_keys';
      const preset = PRESETS[instrumentId] || PRESETS.modern_keys || PRESETS.chip_lead;
      if (preset) synth.loadPatch(preset);
      synth.setSoundTraits(this.project?.settings?.soundTraits);
      this._inspectSynth = synth;
      this._inspectSynthInstrumentId = instrumentId;
    }
    return this._inspectSynth;
  }

  _getInspectKit() {
    if (!this._inspectKit) {
      const kit = new SketchKit();
      kit.init();
      const instrumentId = this._inspectSource?.kitRecorded?.instrumentId
        || this._inspectSource?.instrumentId
        || this._inspectSource?.kitId
        || 'classic';
      // SketchKit.loadKit() understands built-in kit ids and `custom:` ids.
      try { kit.loadKit(instrumentId); } catch { kit.loadKit('classic'); }
      kit.setSoundTraits(this.project?.settings?.soundTraits);
      this._inspectKit = kit;
      this._inspectKitInstrumentId = instrumentId;
    }
    return this._inspectKit;
  }

  _allInspectNotesOff() {
    if (this._inspectSynth) this._inspectSynth.allNotesOff();
    if (this._inspectKit) this._inspectKit.panic?.();
    this._inspectActiveNotes.clear();
  }

  _processInspectTick(tick, nextTickTime) {
    if (!this._inspectSource) return;
    const snippet = this._inspectSource;
    const duration = Math.max(1, snippet.durationTicks || 1);
    const localTick = tick % duration;

    // Detect loop wrap. When we cross from end-of-clip back to 0, drop
    // any still-held notes so a long note from the previous loop doesn't
    // bleed into the next.
    const prevLocal = this._lastInspectLocalTick;
    if (prevLocal !== null && localTick < prevLocal) {
      for (const [, entry] of this._inspectActiveNotes) {
        entry.synth.noteOff(entry.pitch, nextTickTime);
      }
      this._inspectActiveNotes.clear();
    }
    this._lastInspectLocalTick = localTick;

    // MIDI notes
    if (snippet.notes && snippet.notes.length) {
      const synth = this._getInspectSynth();
      if (synth) {
        for (const note of snippet.notes) {
          if (note.startTick === localTick) {
            synth.setSoundTraits(note.soundTraits || snippet.soundTraits || this.project?.settings?.soundTraits);
            synth.noteOn(note.pitch, note.velocity || 0.8, nextTickTime);
            this._inspectActiveNotes.set(`midi-${note.pitch}-${localTick}-${Math.random().toString(36).slice(2, 7)}`, {
              synth,
              pitch: note.pitch,
              endLocal: localTick + (note.durationTick || 240),
            });
          }
        }
      }
    }

    // Drum hits
    if (snippet.hits && snippet.hits.length) {
      const kit = this._getInspectKit();
      if (kit) {
        for (const hit of snippet.hits) {
          if (hit.startTick === localTick) {
            kit.setSoundTraits(hit.soundTraits || snippet.soundTraits || this.project?.settings?.soundTraits);
            kit._triggerSound(hit.type || 'kick', nextTickTime);
          }
        }
      }
    }

    // Release held notes whose duration elapsed
    for (const [key, entry] of this._inspectActiveNotes) {
      if (localTick >= entry.endLocal) {
        entry.synth.noteOff(entry.pitch, nextTickTime);
        this._inspectActiveNotes.delete(key);
      }
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

    // Inspect mode owns playback while a snippet is being inspected.
    // The browser state (no snippet open) is handled in main.js, which
    // never sets an inspect source and so this branch stays inert.
    if (this._inspectSource) {
      this._processInspectTick(tick, nextTickTime);
      return;
    }

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
    this._allInspectNotesOff();
    this._trackSynths.clear();
    this._trackKits.clear();
    // Release the dedicated inspect synth/kit references so their audio
    // resources can be garbage-collected, matching how the per-track
    // synths/kit entries are cleared above.
    this._inspectSynth = null;
    this._inspectKit = null;
    this._inspectActiveNotes.clear();
    this._lastInspectLocalTick = null;
    this._inspectSource = null;
  }
}
