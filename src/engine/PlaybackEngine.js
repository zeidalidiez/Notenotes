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
  constructor(transport, project) {
    this.transport = transport;
    this.project = project;

    /** One synth instance per track (keyed by track ID) */
    this._trackSynths = new Map();
    /** Shared drum kit for all kit tracks */
    this._kit = null;
    /** Currently active notes (for noteOff scheduling) */
    this._activeNotes = new Map(); // key: `${trackId}-${pitch}`, value: { synth, noteOffTick }

    this._initialized = false;
    this._lastProcessedTick = -1;
    this._audioBuffers = new Map(); // snippetId → AudioBuffer
    this._engine = AudioEngine.getInstance();
  }

  /**
   * Initialize audio nodes. Must be called after AudioEngine.init().
   */
  init() {
    if (this._initialized) return;

    // Create shared drum kit
    this._kit = new SketchKit();
    this._kit.init();

    // Subscribe to transport tick events
    this.transport.onTick((tick, nextTickTime) => {
      this._processTick(tick, nextTickTime);
    });

    // On stop, release all active notes
    this.transport.onStateChange((state) => {
      if (state === TransportState.STOPPED) {
        this._allNotesOff();
        this._lastProcessedTick = -1;
      }
    });

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

    this._trackSynths.set(track.id, { synth, instrumentId: instId });
    return synth;
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

      const instId = track.instrumentId || 'chip_lead';
      const instDef = TRACK_INSTRUMENTS[instId];
      if (!instDef) continue;

      // Check each clip on this track
      for (const clip of (track.clips || [])) {
        const snippet = clip.snippet;
        if (!snippet) continue;

        const clipStartTick = (clip.startBar || 0) * ticksPerBar;
        const clipEndTick = clipStartTick + (snippet.durationTicks || ticksPerBar);

        // Is the current tick within this clip's range?
        if (tick < clipStartTick || tick >= clipEndTick) continue;

        const localTick = tick - clipStartTick;

        // Play melodic notes
        if (instDef.type === 'synth' && snippet.notes) {
          const synth = this._getSynthForTrack(track);
          if (!synth) continue;

          for (const note of snippet.notes) {
            // Trigger noteOn at the exact start tick
            if (note.startTick === localTick) {
              synth.noteOn(note.pitch, note.velocity || 0.8, nextTickTime);

              // Schedule noteOff
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
              this._kit._triggerSound(hit.type || 'kick', nextTickTime);
            }
          }
        }

        // Play audio snippets
        if (snippet.type === 'audio' && snippet.audioUrl && localTick === 0) {
          this._playAudioClip(snippet);
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
    for (const [key, entry] of this._activeNotes) {
      entry.synth.noteOff(entry.pitch);
    }
    this._activeNotes.clear();

    // Also stop all track synths
    for (const [, entry] of this._trackSynths) {
      entry.synth.allNotesOff();
    }
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
    if (!ctx || !snippet.audioUrl) return;

    try {
      let buffer = this._audioBuffers.get(snippet.id);
      if (!buffer) {
        const response = await fetch(snippet.audioUrl);
        const arrayBuffer = await response.arrayBuffer();
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

  destroy() {
    this._allNotesOff();
    this._trackSynths.clear();
  }
}
