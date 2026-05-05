/**
 * PlaybackEngine — Reads clips from Canvas tracks and plays them
 * through the appropriate instruments during Transport playback.
 *
 * Subscribes to Transport tick events and triggers noteOn/noteOff
 * on the correct instrument for each track's clips.
 */

import { WebAudioSynth, PRESETS } from '../instruments/WebAudioSynth.js';
import { SketchKit } from '../instruments/SketchKit.js';
import { AudioEngine } from './AudioEngine.js';
import { TransportState } from './Transport.js';

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
    /** Shared drum kit for all kit tracks */
    this._kit = null;
    /** Currently active notes (for noteOff scheduling) */
    this._activeNotes = new Map(); // key: `${trackId}-${pitch}`, value: { synth, noteOffTick }

    this._initialized = false;
    this._lastProcessedTick = -1;
    this._audioBuffers = new Map();
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

    // Create shared drum kit
    this._kit = new SketchKit();
    this._kit.init();
    this._kit.setSoundTraits(this.project?.settings?.soundTraits);

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
    const instDef = TRACK_INSTRUMENTS[instId];

    if (!instDef || instDef.type === 'kit') return null;

    // Check if we already have a synth for this track
    let entry = this._trackSynths.get(track.id);
    if (entry && entry.instrumentId === instId) {
      return entry.synth;
    }

    // Create new synth for this track
    const synth = new WebAudioSynth();
    synth.init();

    // Load the appropriate preset
    const preset = PRESETS[instDef.preset];
    if (preset) synth.loadPatch(preset);
    synth.setSoundTraits(this.project?.settings?.soundTraits);

    this._trackSynths.set(track.id, { synth, instrumentId: instId });
    return synth;
  }

  _applySoundTraitsToTrackSynths() {
    for (const [, entry] of this._trackSynths) {
      entry.synth.setSoundTraits(this.project?.settings?.soundTraits);
    }
    this._kit?.setSoundTraits(this.project?.settings?.soundTraits);
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

      const trackType = track.type || (track.instrumentId === 'kit' ? 'drum' : 'midi');
      const instId = trackType === 'drum' ? 'kit' : (track.instrumentId || 'chip_lead');
      const instDef = TRACK_INSTRUMENTS[instId];
      if (trackType !== 'audio' && !instDef) continue;

      // Check each clip on this track
      for (const clip of (track.clips || [])) {
        const snippet = clip.snippet;
        if (!snippet) continue;
        if (trackType === 'audio' && snippet.type !== 'audio') continue;
        if (trackType === 'drum' && snippet.type !== 'drum') continue;
        if (trackType === 'midi' && snippet.type !== 'midi') continue;

        const clipStartTick = (clip.startBar || 0) * ticksPerBar;
        const clipEndTick = clipStartTick + (snippet.durationTicks || ticksPerBar);

        // Is the current tick within this clip's range?
        if (tick < clipStartTick || tick >= clipEndTick) continue;

        const localTick = tick - clipStartTick;
        const clipKey = clip.id || `${track.id}-${clip.snippetId}-${clipStartTick}`;
        const lastLocalTick = this._lastClipLocalTick.get(clipKey);
        if (lastLocalTick !== undefined && localTick < lastLocalTick) {
          this._lastModIdx.delete(clipKey);
        }
        this._lastClipLocalTick.set(clipKey, localTick);

        // Play melodic notes
        const synth = instDef.type === 'synth' ? this._getSynthForTrack(track) : null;
        if (instDef.type === 'synth' && synth && snippet.notes) {
          for (const note of snippet.notes) {
            if (note.startTick === localTick) {
              synth.setSoundTraits(note.soundTraits || clip.soundTraits || snippet.soundTraits || this.project?.settings?.soundTraits);
              synth.noteOn(note.pitch, note.velocity || 0.8, nextTickTime);
              const noteOffTick = tick + (note.durationTick || 240);
              const key = `${track.id}-${note.pitch}`;
              this._activeNotes.set(key, { synth, pitch: note.pitch, noteOffTick });
            }
          }
        }

        // Play drum hits
        if (instDef.type === 'kit' && snippet.hits && this._kit) {
          for (const hit of snippet.hits) {
            if (hit.startTick === localTick) {
              this._kit.setSoundTraits(hit.soundTraits || clip.soundTraits || snippet.soundTraits || this.project?.settings?.soundTraits);
              this._kit._triggerSound(hit.type || 'kick', nextTickTime);
            }
          }
        }

        // Play audio snippets
        if (snippet.type === 'audio' && this._hasAudioSource(snippet) && localTick === 0) {
          this._playAudioClip(snippet);
        }

        // Apply recorded modulation
        if (snippet.modulation?.length && instDef.type === 'synth') {
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
  }

  async _playAudioClip(snippet) {
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
      const gain = ctx.createGain();
      gain.gain.value = 0.7;
      source.connect(gain);
      gain.connect(this._engine.masterGain || ctx.destination);
      source.start(ctx.currentTime);
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
          voice.osc.detune.setTargetAtTime(pt.pitchBend * 200, time, 0.02);
          const modFreq = 400 + (pt.modulation / 2) * 7600;
          voice.filter.frequency.setTargetAtTime(modFreq, time, 0.05);
        } catch (e) { /* ignore */ }
      }
    }
  }

  destroy() {
    this._allNotesOff();
    this._trackSynths.clear();
  }
}
