/**
 * RecordingManager — Captures MIDI note events during recording.
 * Creates Snippets from recorded notes when a loop cycle completes.
 */

export class RecordingManager {
  /**
   * @param {Transport} transport
   * @param {Quantizer} quantizer
   */
  constructor(transport, quantizer) {
    this.transport = transport;
    this.quantizer = quantizer;

    /** Whether recording is armed */
    this.armed = false;

    /** Notes currently being held down (midi → { startTick, velocity }) */
    this._heldNotes = new Map();

    /** Completed notes captured in the current recording pass */
    this._capturedNotes = [];

    /** Drum hits captured (no duration, instant) */
    this._capturedHits = [];

    /** Modulation automation captured */
    this._capturedMod = [];
    this._lastModTick = -480;

    /** Reference to mod manager for capturing values */
    this._modManager = null;

    /** Callback when a snippet is created */
    this._onSnippetCreated = null;
    this._toneProvider = null;
    this._baseToneProvider = null;
    this._capturedToneSnapshot = null;
    this._recordStartTick = 0;

    /** Loop subscription cleanup */
    this._unsubLoop = null;
    this._unsubState = null;
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._unsubState = this.transport.onStateChange((state, meta = {}) => {
      if (state === 'stopped' && this.armed) {
        const endTick = this._getRelativeTick(meta.rawTick);
        for (const [midi, noteData] of this._heldNotes.entries()) {
          this._capturedNotes.push({
            pitch: midi,
            startTick: noteData.startTick,
            durationTick: Math.max(1, endTick - noteData.startTick),
            velocity: noteData.velocity,
            soundTraits: noteData.soundTraits,
            ...(noteData.voice ? { voice: { ...noteData.voice } } : {}),
          });
        }
        this._heldNotes.clear();
        if (this._capturedNotes.length + this._capturedHits.length > 0) {
          this._finalizeSnippet();
        }
        this.armed = false;
      }
    });
  }

  onSnippetCreated(fn) {
    this._onSnippetCreated = fn;
  }

  setModManager(mm) {
    this._modManager = mm;
  }

  setToneProvider(fn) {
    this._toneProvider = fn;
  }

  setBaseToneProvider(fn) {
    this._baseToneProvider = fn;
  }

  _captureBaseToneSnapshot() {
    const provider = this._baseToneProvider || this._toneProvider;
    if (!provider) return;
    this._capturedToneSnapshot = provider();
  }

  _currentToneSnapshot() {
    return this._toneProvider ? this._toneProvider() : this._capturedToneSnapshot;
  }

  captureModulation() {
    if (!this.armed || !this._modManager) return;
    const tick = this._getRelativeTick();
    if (tick - this._lastModTick < 120) return;
    this._lastModTick = tick;
    this._capturedMod.push({
      tick,
      pitchBend: this._modManager.pitchBend,
      modulation: this._modManager.modulation,
    });
  }

  /**
   * Arm/disarm recording.
   */
  setArmed(armed) {
    if (armed && !this.armed) {
      this._capturedNotes = [];
      this._capturedHits = [];
      this._capturedMod = [];
      this._heldNotes.clear();
      this._lastModTick = -480;
      this._recordStartTick = this._absoluteRecordingTick();
    }
    this.armed = armed;
    if (armed) {
      this._captureBaseToneSnapshot();
    }
    if (!armed) {
      const endTick = this._getRelativeTick();
      for (const [midi, noteData] of this._heldNotes.entries()) {
        this._capturedNotes.push({
          pitch: midi,
          startTick: noteData.startTick,
          durationTick: Math.max(1, endTick - noteData.startTick),
          velocity: noteData.velocity,
          soundTraits: noteData.soundTraits,
          ...(noteData.voice ? { voice: { ...noteData.voice } } : {}),
        });
      }
      this._heldNotes.clear();
    }
  }

  /**
   * Called when a note starts playing (note on).
   * @param {number} midi - MIDI note number
   * @param {number} velocity - 0-1
   * @param {Object} meta - optional per-note metadata
   */
  noteOn(midi, velocity = 0.8, meta = {}) {
    if (!this.armed) return;
    const tick = this._getRelativeTick();
    this._heldNotes.set(midi, {
      startTick: tick,
      velocity,
      soundTraits: this._currentToneSnapshot(),
      voice: meta.voice ? { ...meta.voice } : null,
    });
  }

  /**
   * Called when a note stops playing (note off).
   * @param {number} midi
   */
  noteOff(midi) {
    if (!this.armed) return;
    const noteData = this._heldNotes.get(midi);
    if (!noteData) return;

    const endTick = this._getRelativeTick();
    let note = {
      pitch: midi,
      startTick: noteData.startTick,
      durationTick: Math.max(1, endTick - noteData.startTick),
      velocity: noteData.velocity,
      soundTraits: noteData.soundTraits,
      ...(noteData.voice ? { voice: { ...noteData.voice } } : {}),
    };

    // Apply quantization if enabled
    note = this.quantizer.quantizeNote(note);

    this._capturedNotes.push(note);
    this._heldNotes.delete(midi);
  }

  /**
   * Called when a drum hit occurs (instant event, no duration).
   * @param {string} drumName - e.g. 'kick', 'snare', 'hihat'
   */
  drumHit(drumName) {
    if (!this.armed) return;
    let tick = this._getRelativeTick();
    tick = this.quantizer.quantize(tick);

    this._capturedHits.push({
      type: drumName,
      startTick: tick,
      velocity: 0.8,
      soundTraits: this._currentToneSnapshot(),
    });
  }

  /**
   * Get the current tick position relative to the loop start.
   * @returns {number}
   */
  _getRelativeTick(currentTick = null) {
    const current = currentTick ?? this._absoluteRecordingTick();
    return Math.max(0, current - this._recordStartTick);
  }

  _absoluteRecordingTick() {
    return this.transport.currentRawTick ?? this.transport.currentTick ?? 0;
  }

  /**
   * Finalize captured notes into a Snippet.
   */
  _finalizeSnippet() {
    const noteCount = this._capturedNotes.length + this._capturedHits.length;
    this._trimLeadingEmptyTicks();

    let maxEndTick = 480;
    for (const n of this._capturedNotes) {
      const end = n.startTick + n.durationTick;
      if (end > maxEndTick) maxEndTick = end;
    }
    for (const h of this._capturedHits) {
      if (h.startTick > maxEndTick) maxEndTick = h.startTick;
    }
    const contentTicks = Math.ceil((maxEndTick + 480) / 480) * 480;

    const snippet = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      type: this._capturedHits.length > 0 && this._capturedNotes.length === 0 ? 'drum' : 'midi',
      name: `${noteCount} notes`,
      notes: [...this._capturedNotes],
      hits: [...this._capturedHits],
      modulation: [...this._capturedMod],
      durationTicks: contentTicks,
      bpm: this.transport.bpm,
      timeSignature: { ...this.transport.timeSignature },
    };
    if (snippet.type === 'midi' && this._toneProvider) {
      snippet.soundTraits = this._capturedToneSnapshot || this._currentToneSnapshot();
    }
    if (snippet.type === 'drum' && this._toneProvider) {
      snippet.soundTraits = this._capturedToneSnapshot || this._currentToneSnapshot();
    }

    this._capturedNotes = [];
    this._capturedHits = [];
    this._capturedMod = [];
    this._capturedToneSnapshot = null;
    this._recordStartTick = 0;

    console.log('[RecordingManager] Snippet created:', snippet.id,
      `${snippet.notes.length} notes, ${snippet.hits.length} hits`);

    if (this._onSnippetCreated) {
      this._onSnippetCreated(snippet);
    }
  }

  _trimLeadingEmptyTicks() {
    const starts = [
      ...this._capturedNotes.map(note => note.startTick),
      ...this._capturedHits.map(hit => hit.startTick),
    ].filter(tick => Number.isFinite(tick) && tick > 0);
    if (starts.length === 0) return;

    const firstTick = Math.min(...starts);
    if (firstTick <= 0) return;

    for (const note of this._capturedNotes) {
      note.startTick = Math.max(0, note.startTick - firstTick);
    }
    for (const hit of this._capturedHits) {
      hit.startTick = Math.max(0, hit.startTick - firstTick);
    }
    for (const mod of this._capturedMod) {
      mod.tick = Math.max(0, mod.tick - firstTick);
    }
  }

  destroy() {
    if (this._unsubLoop) this._unsubLoop();
    if (this._unsubState) this._unsubState();
  }
}
