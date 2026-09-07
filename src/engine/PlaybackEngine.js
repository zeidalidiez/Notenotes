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
import {
  recordedInstrumentId,
  resolveInstrumentDefinition,
} from './InstrumentRegistry.js';
import { loadSampleInstrument, loadedSampleInstrument } from '../instruments/SamplePack.js';

function normalizeTrackVolume(value, fallback = 1) {
  const numeric = Number(value);
  return Math.max(0, Math.min(1.5, Number.isFinite(numeric) ? numeric : fallback));
}

// Re-exported for existing Canvas consumers; the canonical registry lives in
// InstrumentRegistry so every surface enumerates the same instrument families.
export { TRACK_INSTRUMENTS } from './InstrumentRegistry.js';

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
    this._audioBufferLoads = new Map();
    this._activeAudioSources = new Set();
    this._trackAudioBuses = new Map();
    this._customSampleBuffers = new Map();
    this._customSampleLoads = new Map();
    this._builtinSamplePatches = new Map();
    this._builtinSampleLoads = new Map();
    this._engine = AudioEngine.getInstance();
    this._lastModIdx = new Map();   // snippetId → last modulation index processed
    this._lastClipLocalTick = new Map();
    this._clipEventIndexes = new WeakMap();
    this._inspectEventIndex = null;
    this._toneTraitsHandler = null;
    this._audioAssetsHandler = null;
    this._unsubscribers = [];
  }

  /**
   * Initialize audio nodes. Must be called after AudioEngine.init().
   */
  init() {
    if (this._initialized) return;

    // Subscribe to transport tick events
    this._unsubscribers.push(this.transport.onTick((tick, nextTickTime) => {
      this._processTick(tick, nextTickTime);
    }));

    // On stop, release all active notes
    this._unsubscribers.push(this.transport.onStateChange((state) => {
      if (state === TransportState.STOPPED) {
        this._allNotesOff();
        this._allInspectNotesOff();
        this._lastProcessedTick = -1;
        this._lastModIdx.clear();
        this._lastClipLocalTick.clear();
        this._lastInspectLocalTick = null;
      }
    }));

    this._unsubscribers.push(this.transport.onLoop((tick, audioTime) => {
      this._releaseActiveNotes(audioTime);
      this._stopAudioSources(audioTime);
      this._lastModIdx.clear();
      this._lastClipLocalTick.clear();
    }));

    this._toneTraitsHandler = () => this._applySoundTraitsToTrackSynths();
    window.addEventListener('project-sound-traits-changed', this._toneTraitsHandler);
    this._audioAssetsHandler = () => {
      this.invalidateSchedule();
      void this.prepareAudioAssets();
    };
    window.addEventListener('project-snippets-changed', this._audioAssetsHandler);

    for (const track of this.project?.tracks || []) {
      const instDef = this._instrumentDef(track.instrumentId);
      this._prepareInstrumentDefinition(instDef);
    }

    void this.prepareAudioAssets();

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
      entry.synth.setTrackVolume?.(normalizeTrackVolume(track.volume));
      return entry.synth;
    }
    if (entry) {
      entry.synth.destroy?.();
      this._trackSynths.delete(track.id);
      entry = null;
    }

    let patch = null;
    if (instDef.customInstrument) {
      const buffer = this._customSampleBuffers.get(instDef.customInstrument.id);
      if (!buffer) {
        void this._prepareCustomInstrument(instDef.customInstrument);
        return null;
      }
      patch = this._samplePatchFromInstrument(instDef.customInstrument, buffer);
    } else if (instDef.samplePackId) {
      patch = this._builtinSamplePatches.get(instDef.samplePackId) || loadedSampleInstrument(instDef.samplePackId);
      if (!patch) {
        void this._prepareBuiltinInstrument(instDef.samplePackId);
        return null;
      }
    } else {
      patch = PRESETS[instDef.preset];
    }

    // Create the graph only after any asynchronous sample asset is available;
    // otherwise every scheduler tick would leak an unused track bus while load
    // is pending.
    const synth = new WebAudioSynth();
    synth.init();
    if (patch) synth.loadPatch(patch);
    synth.setSoundTraits(this.project?.settings?.soundTraits);
    synth.setPan?.(normalizeTrackPan(track.pan));
    synth.setTrackVolume?.(normalizeTrackVolume(track.volume));

    this._trackSynths.set(track.id, { synth, instrumentId: instId });
    return synth;
  }

  _getKitForTrack(track, kitId = 'classic') {
    const id = kitId || 'classic';
    let entry = this._trackKits.get(track.id);
    if (!entry || entry.kitId !== id) {
      entry?.kit.destroy?.();
      const kit = new SketchKit();
      kit.init();
      kit.loadKit(id);
      kit.setSoundTraits(this.project?.settings?.soundTraits);
      entry = { kit, kitId: id };
      this._trackKits.set(track.id, entry);
    }
    entry.kit.setPan?.(normalizeTrackPan(track.pan));
    entry.kit.setTrackVolume?.(normalizeTrackVolume(track.volume));
    return entry.kit;
  }

  _instrumentDef(instId) {
    return resolveInstrumentDefinition(instId, this.project);
  }

  _prepareInstrumentDefinition(instDef) {
    if (instDef?.customInstrument) return this._prepareCustomInstrument(instDef.customInstrument);
    if (instDef?.samplePackId) return this._prepareBuiltinInstrument(instDef.samplePackId);
    return Promise.resolve(null);
  }

  _prepareBuiltinInstrument(id) {
    if (!id || !this._engine.ctx) return Promise.resolve(null);
    const alreadyLoaded = loadedSampleInstrument(id);
    if (alreadyLoaded) {
      this._builtinSamplePatches.set(id, alreadyLoaded);
      return Promise.resolve(alreadyLoaded);
    }
    if (this._builtinSamplePatches.has(id)) return Promise.resolve(this._builtinSamplePatches.get(id));
    if (this._builtinSampleLoads.has(id)) return this._builtinSampleLoads.get(id);
    const load = loadSampleInstrument(id)
      .then(patch => {
        this._builtinSamplePatches.set(id, patch);
        return patch;
      })
      .catch(err => {
        console.warn('[PlaybackEngine] Built-in sample instrument load failed:', id, err);
        return null;
      })
      .finally(() => this._builtinSampleLoads.delete(id));
    this._builtinSampleLoads.set(id, load);
    return load;
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
    if (!instrument?.audioAssetId || !this.store?.getAudioAssetBlob || !this._engine.ctx) return Promise.resolve(null);
    if (this._customSampleBuffers.has(instrument.id)) return Promise.resolve(this._customSampleBuffers.get(instrument.id));
    if (this._customSampleLoads.has(instrument.id)) return this._customSampleLoads.get(instrument.id);

    const load = (async () => {
      try {
        const blob = await this.store.getAudioAssetBlob(instrument.audioAssetId);
        if (!blob) throw new Error('Sample audio is unavailable');
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = await this._engine.ctx.decodeAudioData(arrayBuffer.slice(0));
        this._customSampleBuffers.set(instrument.id, buffer);
        return buffer;
      } catch (err) {
        console.warn('[PlaybackEngine] Custom instrument load failed:', instrument.name, err);
        return null;
      } finally {
        this._customSampleLoads.delete(instrument.id);
      }
    })();
    this._customSampleLoads.set(instrument.id, load);
    return load;
  }

  async preparePlaybackAssets() {
    const loads = [this.prepareAudioAssets()];
    for (const track of this.project?.tracks || []) {
      loads.push(this._prepareInstrumentDefinition(this._instrumentDef(track.instrumentId)));
    }
    return Promise.allSettled(loads);
  }

  async prepareInspectSource(snippet = this._inspectSource) {
    if (!snippet || snippet.type !== 'midi') return null;
    if (snippet.patchRecorded?.patchSnapshot) return snippet.patchRecorded.patchSnapshot;
    const definition = this._instrumentDef(recordedInstrumentId(snippet, 'modern_keys'));
    return this._prepareInstrumentDefinition(definition);
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
   *
   * The Inspect patch picker mutates the snippet in place and calls
   * `setInspectSource` again with the *same* object reference, so the
   * reference-equality check at the top is followed by a per-channel
   * instrument-id check. If the resolved instrument changed, the
   * matching cache is dropped even though the reference is unchanged.
   * @param {object|null} snippet
   */
  setInspectSource(snippet) {
    const next = snippet || null;

    // Resolve the snippet's intended instrument up front. We need this
    // even on the same-reference path so the cache-drop branch can run
    // when the picker mutates `snippet.instrumentId` in place.
    const midiId = next?.type === 'midi' ? recordedInstrumentId(next, 'modern_keys') : null;
    const kitId = next?.type === 'drum' ? recordedInstrumentId(next, 'classic') : null;

    if (this._inspectSource === next) {
      // Same snippet reference — but the picker may have just mutated
      // its `instrumentId` / `patchRecorded` / `kitRecorded`. Drop the
      // matching cached synth/kit so the next Play auditions under the
      // new patch/kit. No transport reset is needed: the user is
      // changing the patch while paused or browsing, not while a note
      // is ringing.
      if (midiId && this._inspectSynthInstrumentId && this._inspectSynthInstrumentId !== midiId) {
        this._dropInspectSynth();
      }
      if (kitId && this._inspectKitInstrumentId && this._inspectKitInstrumentId !== kitId) {
        this._dropInspectKit();
      }
      return;
    }

    this._allInspectNotesOff();
    this._inspectSource = next;
    this._inspectEventIndex = null;
    this._lastProcessedTick = -1;
    this._lastInspectLocalTick = null;

    if (!next) {
      // Returning to Canvas playback — release the cached synth/kit so
      // the next inspect source starts from a clean slate.
      this._dropInspectSynth();
      this._dropInspectKit();
      this._inspectSynthInstrumentId = null;
      this._inspectKitInstrumentId = null;
      return;
    }

    // New snippet reference — drop the cached synth/kit so the next
    // `_getInspectSynth` / `_getInspectKit` rebuilds them with the new
    // preset. We don't rebuild eagerly here because no audio is playing
    // yet (the play button hasn't been pressed) — building on demand
    // keeps idle state cheap.
    if (midiId && this._inspectSynthInstrumentId && this._inspectSynthInstrumentId !== midiId) {
      this._dropInspectSynth();
    }
    if (kitId && this._inspectKitInstrumentId && this._inspectKitInstrumentId !== kitId) {
      this._dropInspectKit();
    }
  }

  _getInspectSynth() {
    if (!this._inspectSynth) {
      // Prefer the snippet's recorded instrument; fall back to a sensible
      // default so an unrecorded/blank snippet still has something to
      // audition with.
      const instrumentId = recordedInstrumentId(this._inspectSource, 'modern_keys');
      const snapshot = this._inspectSource?.patchRecorded?.patchSnapshot;
      const instDef = this._instrumentDef(instrumentId);
      let patch = snapshot || null;
      if (!snapshot && instDef?.customInstrument) {
        const buffer = this._customSampleBuffers.get(instDef.customInstrument.id);
        if (!buffer) {
          void this._prepareCustomInstrument(instDef.customInstrument);
          return null;
        }
        patch = this._samplePatchFromInstrument(instDef.customInstrument, buffer);
      } else if (!snapshot && instDef?.samplePackId) {
        patch = this._builtinSamplePatches.get(instDef.samplePackId) || loadedSampleInstrument(instDef.samplePackId);
        if (!patch) {
          void this._prepareBuiltinInstrument(instDef.samplePackId);
          return null;
        }
      } else if (!snapshot) {
        patch = PRESETS[instDef?.preset] || PRESETS.modern_keys || PRESETS.chip_lead;
      }
      const synth = new WebAudioSynth();
      synth.init();
      synth.loadPatch(patch);
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
      const instrumentId = recordedInstrumentId(this._inspectSource, 'classic');
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

  _dropInspectSynth() {
    this._inspectSynth?.destroy?.();
    this._inspectSynth = null;
  }

  _dropInspectKit() {
    this._inspectKit?.destroy?.();
    this._inspectKit = null;
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

    const events = this._inspectEvents(snippet);

    // MIDI notes
    const notesAtTick = events.notes.get(localTick) || [];
    if (notesAtTick.length) {
      const synth = this._getInspectSynth();
      if (synth) {
        for (const note of notesAtTick) {
          synth.setSoundTraits(note.soundTraits || snippet.soundTraits || this.project?.settings?.soundTraits);
          synth.noteOn(note.pitch, note.velocity ?? 0.8, nextTickTime);
          this._inspectActiveNotes.set(`midi-${note.pitch}-${localTick}-${Math.random().toString(36).slice(2, 7)}`, {
            synth,
            pitch: note.pitch,
            endLocal: localTick + (note.durationTick ?? 240),
          });
        }
      }
    }

    // Drum hits
    const hitsAtTick = events.hits.get(localTick) || [];
    if (hitsAtTick.length) {
      const kit = this._getInspectKit();
      if (kit) {
        for (const hit of hitsAtTick) {
          kit.setSoundTraits(hit.soundTraits || snippet.soundTraits || this.project?.settings?.soundTraits);
          kit._triggerSound(hit.type || 'kick', nextTickTime, hit.velocity ?? 0.8);
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
      const instDef = trackType === 'audio' ? null : this._instrumentDef(instId);
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
        const events = this._clipEvents(clip, snippet, timeScale);
        const clipKey = clip.id || `${track.id}-${clip.snippetId}-${clipStartTick}`;
        const lastLocalTick = this._lastClipLocalTick.get(clipKey);
        if (lastLocalTick !== undefined && localTick < lastLocalTick) {
          this._lastModIdx.delete(clipKey);
        }
        this._lastClipLocalTick.set(clipKey, localTick);

        // Play melodic notes
        const synth = instDef?.type === 'synth' ? this._getSynthForTrack(track) : null;
        if (instDef?.type === 'synth' && synth) {
          for (const note of events.notes.get(timelineLocalTick) || []) {
            synth.setSoundTraits(clip.soundTraits || note.soundTraits || snippet.soundTraits || this.project?.settings?.soundTraits);
            synth.noteOn(note.pitch, note.velocity ?? 0.8, nextTickTime);
            const noteOffTick = tick + Math.max(1, Math.round((note.durationTick ?? 240) * timeScale));
            const key = `${track.id}-${note.pitch}`;
            this._activeNotes.set(key, { synth, pitch: note.pitch, noteOffTick });
          }
        }

        // Play drum hits
        if (instDef?.type === 'kit') {
          const kit = this._getKitForTrack(track, instDef.kitId || 'classic');
          for (const hit of events.hits.get(timelineLocalTick) || []) {
            kit.setSoundTraits(clip.soundTraits || hit.soundTraits || snippet.soundTraits || this.project?.settings?.soundTraits);
            kit._triggerSound(hit.type || 'kick', nextTickTime, hit.velocity ?? 0.8);
          }
        }

        // Play audio snippets
        if (snippet.type === 'audio' && this._hasAudioSource(snippet) && timelineLocalTick === 0) {
          this._playAudioClip(snippet, nextTickTime, timeScale, track);
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

  invalidateSchedule() {
    this._clipEventIndexes = new WeakMap();
    this._inspectEventIndex = null;
  }

  _eventMap(items = [], scale = 1) {
    const map = new Map();
    for (const item of items) {
      const tick = Math.round((item.startTick ?? 0) * scale);
      const bucket = map.get(tick) || [];
      bucket.push(item);
      map.set(tick, bucket);
    }
    return map;
  }

  _clipEvents(clip, snippet, timeScale) {
    const cached = this._clipEventIndexes.get(clip);
    if (cached && cached.snippet === snippet && cached.timeScale === timeScale) return cached;
    const index = {
      snippet,
      timeScale,
      notes: this._eventMap(snippet.notes, timeScale),
      hits: this._eventMap(snippet.hits, timeScale),
    };
    this._clipEventIndexes.set(clip, index);
    return index;
  }

  _inspectEvents(snippet) {
    if (this._inspectEventIndex?.snippet === snippet) return this._inspectEventIndex;
    this._inspectEventIndex = {
      snippet,
      notes: this._eventMap(snippet.notes),
      hits: this._eventMap(snippet.hits),
    };
    return this._inspectEventIndex;
  }

  /**
   * Release all currently active notes.
   */
  _allNotesOff() {
    this._releaseActiveNotes();
    this._stopAudioSources();

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
    this._stopAudioSources();
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
      entry.synth.destroy?.();
      this._trackSynths.delete(trackId);
    }
    const kitEntry = this._trackKits.get(trackId);
    if (kitEntry) {
      kitEntry.kit.destroy?.();
      this._trackKits.delete(trackId);
    }
    const track = this.project?.tracks?.find(item => item.id === trackId);
    const instDef = this._instrumentDef(track?.instrumentId);
    this._prepareInstrumentDefinition(instDef);
  }

  onTrackMixChanged(trackId) {
    const track = this.project?.tracks?.find(item => item.id === trackId);
    if (!track) return;
    this._trackSynths.get(trackId)?.synth.setPan?.(normalizeTrackPan(track.pan));
    this._trackSynths.get(trackId)?.synth.setTrackVolume?.(normalizeTrackVolume(track.volume));
    this._trackKits.get(trackId)?.kit.setPan?.(normalizeTrackPan(track.pan));
    this._trackKits.get(trackId)?.kit.setTrackVolume?.(normalizeTrackVolume(track.volume));
    const audioBus = this._trackAudioBuses.get(trackId);
    if (audioBus) {
      this._engine.setTrackBusPan?.(audioBus, normalizeTrackPan(track.pan));
      this._engine.setTrackBusVolume?.(audioBus, normalizeTrackVolume(track.volume));
    }
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
        entry.synth.destroy?.();
        this._trackSynths.delete(trackId);
      }
    }

    for (const [trackId, entry] of this._trackKits) {
      if (!customRef || entry.kitId === customRef) {
        entry.kit.destroy?.();
        this._trackKits.delete(trackId);
      }
    }

    for (const track of this.project?.tracks || []) {
      if (track.instrumentId?.startsWith?.('custom:')) {
        const instDef = this._instrumentDef(track.instrumentId);
        this._prepareInstrumentDefinition(instDef);
      }
    }
  }

  /**
   * Decode all audio snippets referenced by the current project before their
   * scheduled start. This is safe to call repeatedly; loads and decoded buffers
   * are deduplicated by asset identity.
   */
  async prepareAudioAssets() {
    const snippets = new Map();
    for (const snippet of this.project?.snippets || []) {
      if (snippet?.type === 'audio' && this._hasAudioSource(snippet)) {
        snippets.set(this._audioBufferKey(snippet), snippet);
      }
    }
    for (const track of this.project?.tracks || []) {
      for (const clip of track.clips || []) {
        const snippet = clip?.snippet;
        if (snippet?.type === 'audio' && this._hasAudioSource(snippet)) {
          snippets.set(this._audioBufferKey(snippet), snippet);
        }
      }
    }
    return Promise.allSettled([...snippets.values()].map(snippet => this._prepareAudioBuffer(snippet)));
  }

  _playAudioClip(snippet, audioTime = null, timeScale = 1, track = null) {
    const ctx = this._engine.ctx;
    if (!ctx || !this._hasAudioSource(snippet)) return;

    try {
      const key = this._audioBufferKey(snippet);
      const buffer = this._audioBuffers.get(key);
      if (!buffer) {
        // Never await storage or decoding from the scheduled onset. Starting
        // after that await would put the source in the past and make the clip
        // audibly late. Cache it for the next play/loop instead.
        void this._prepareAudioBuffer(snippet);
        return;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 1 / Math.max(0.01, normalizeClipTimeScale(timeScale));
      const bus = this._getAudioBusForTrack(track);
      source.connect(bus);
      const entry = { source };
      const cleanup = () => {
        this._activeAudioSources.delete(entry);
        try { source.disconnect(); } catch (_) {}
      };
      source.addEventListener('ended', cleanup, { once: true });
      this._activeAudioSources.add(entry);
      source.start(audioTime ?? ctx.currentTime);
      return source;
    } catch (err) {
      console.warn('[PlaybackEngine] Audio playback failed:', err);
      return null;
    }
  }

  _getAudioBusForTrack(track = null) {
    const key = track?.id || '__preview-audio__';
    let bus = this._trackAudioBuses.get(key);
    if (!bus) {
      bus = this._engine.createTrackBus();
      bus.gain.value = 0.7;
      this._trackAudioBuses.set(key, bus);
    }
    this._engine.setTrackBusPan?.(bus, normalizeTrackPan(track?.pan));
    this._engine.setTrackBusVolume?.(bus, normalizeTrackVolume(track?.volume));
    return bus;
  }

  _stopAudioSources(audioTime = null) {
    const now = this._engine.ctx?.currentTime ?? 0;
    const stopAt = audioTime ?? now;
    for (const entry of [...this._activeAudioSources]) {
      try { entry.source.stop(stopAt); } catch (_) {}
      if (stopAt <= now) {
        this._activeAudioSources.delete(entry);
        try { entry.source.disconnect(); } catch (_) {}
      }
    }
  }

  _audioBufferKey(snippet) {
    return snippet?.audioAssetId || snippet?.id || this._audioSource(snippet);
  }

  _prepareAudioBuffer(snippet) {
    const ctx = this._engine.ctx;
    const key = this._audioBufferKey(snippet);
    if (!ctx || !key || !this._hasAudioSource(snippet)) return Promise.resolve(null);
    if (this._audioBuffers.has(key)) return Promise.resolve(this._audioBuffers.get(key));
    if (this._audioBufferLoads.has(key)) return this._audioBufferLoads.get(key);

    const load = (async () => {
      try {
        const arrayBuffer = this.store?.audioSnippetToArrayBuffer
          ? await this.store.audioSnippetToArrayBuffer(snippet)
          : await this._legacyAudioArrayBuffer(snippet);
        if (!arrayBuffer) {
          snippet.audioUnavailable = true;
          snippet.audioUnavailableReason ||= 'Audio data is not available in browser storage.';
          return null;
        }
        const buffer = await ctx.decodeAudioData(arrayBuffer.slice?.(0) || arrayBuffer);
        this._audioBuffers.set(key, buffer);
        return buffer;
      } catch (err) {
        console.warn('[PlaybackEngine] Audio preload failed:', snippet?.name || snippet?.id, err);
        return null;
      } finally {
        this._audioBufferLoads.delete(key);
      }
    })();
    this._audioBufferLoads.set(key, load);
    return load;
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
    for (const unsubscribe of this._unsubscribers.splice(0)) unsubscribe?.();
    if (this._toneTraitsHandler) {
      window.removeEventListener('project-sound-traits-changed', this._toneTraitsHandler);
      this._toneTraitsHandler = null;
    }
    if (this._audioAssetsHandler) {
      window.removeEventListener('project-snippets-changed', this._audioAssetsHandler);
      this._audioAssetsHandler = null;
    }
    for (const entry of this._trackSynths.values()) entry.synth.destroy?.();
    for (const entry of this._trackKits.values()) entry.kit.destroy?.();
    this._trackSynths.clear();
    this._trackKits.clear();
    for (const bus of this._trackAudioBuses.values()) this._engine.destroyTrackBus?.(bus);
    this._trackAudioBuses.clear();
    this._audioBufferLoads.clear();
    this.invalidateSchedule();
    // Release the dedicated inspect synth/kit references so their audio
    // resources can be garbage-collected, matching how the per-track
    // synths/kit entries are cleared above.
    this._dropInspectSynth();
    this._dropInspectKit();
    this._inspectActiveNotes.clear();
    this._lastInspectLocalTick = null;
    this._inspectSource = null;
    this._initialized = false;
  }
}
