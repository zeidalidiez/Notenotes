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

    /** Callback when a snippet is created */
    this._onSnippetCreated = null;

    /** Loop subscription cleanup */
    this._unsubLoop = null;
    this._unsubState = null;
  }

  /**
   * Set callback for when a snippet is created.
   * @param {Function} fn - Called with (snippet)
   */
  onSnippetCreated(fn) {
    this._onSnippetCreated = fn;
  }

  /**
   * Start listening for loop events to finalize recordings.
   */
  init() {
    // When the loop wraps, finalize any recorded notes
    this._unsubLoop = this.transport.onLoop(() => {
      if (this.armed && this._capturedNotes.length + this._capturedHits.length > 0) {
        this._finalizeSnippet();
      }
    });

    // When transport stops, also finalize
    this._unsubState = this.transport.onStateChange((state) => {
      if (state === 'stopped' && this.armed) {
        // Release any held notes
        for (const [midi, noteData] of this._heldNotes.entries()) {
          const endTick = this.transport.currentTick;
          this._capturedNotes.push({
            pitch: midi,
            startTick: noteData.startTick,
            durationTick: Math.max(1, endTick - noteData.startTick),
            velocity: noteData.velocity,
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

  /**
   * Arm/disarm recording.
   */
  setArmed(armed) {
    this.armed = armed;
    if (!armed) {
      // Release held notes
      this._heldNotes.clear();
    }
  }

  /**
   * Called when a note starts playing (note on).
   * @param {number} midi - MIDI note number
   * @param {number} velocity - 0–1
   */
  noteOn(midi, velocity = 0.8) {
    if (!this.armed) return;
    const tick = this._getRelativeTick();
    this._heldNotes.set(midi, {
      startTick: tick,
      velocity,
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
    });
  }

  /**
   * Get the current tick position relative to the loop start.
   * @returns {number}
   */
  _getRelativeTick() {
    const current = this.transport.currentTick;
    const loopStart = this.transport.loopStartTick;
    return current - loopStart;
  }

  /**
   * Finalize captured notes into a Snippet.
   */
  _finalizeSnippet() {
    const loopLengthTicks = this.transport.loopEndTick - this.transport.loopStartTick;
    const noteCount = this._capturedNotes.length + this._capturedHits.length;

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
      durationTicks: contentTicks,
      bpm: this.transport.bpm,
      timeSignature: { ...this.transport.timeSignature },
    };

    // Clear buffers
    this._capturedNotes = [];
    this._capturedHits = [];

    console.log('[RecordingManager] Snippet created:', snippet.id,
      `${snippet.notes.length} notes, ${snippet.hits.length} hits`);

    if (this._onSnippetCreated) {
      this._onSnippetCreated(snippet);
    }
  }

  destroy() {
    if (this._unsubLoop) this._unsubLoop();
    if (this._unsubState) this._unsubState();
  }
}
