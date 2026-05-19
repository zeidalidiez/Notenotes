/**
 * ScaleBoard — Scale-locked pad instrument.
 *
 * Pad Mode dropdown options:
 *   - "single": each pad plays a single note from the scale.
 *   - "chords": each pad plays a triad rooted on its scale degree.
 *     The Extensions toggle continues single/chord layouts up to degree 13.
 *   - "root": chromatic pads; each pad plays itself plus the selected root
 *             note in the octave nearest the pad note.
 *   - "voices": each pad sings a syllable from a typed phrase, at the pad's pitch.
 *               Requires a VoiceEngine to be passed in. Phrase is persisted in
 *               project.settings.voicePhrase.
 *   - "custom": per-pad type selection (single/chord) editable via "Edit Layout".
 *
 * Octave shifts apply uniformly across modes. In voices mode, octave shifts move
 * the voiced source's pitch but leave the syllable's formants alone — that's how
 * a low and a high voice singing "ah" both sound like "ah."
 */

import { getScaleNotes, midiToNoteName, noteNameToMidi, SCALES, NOTE_NAMES } from '../engine/MusicTheory.js';
import { showToast } from '../ui/Toast.js';
import { syllabify, extractPlayableSyllables, sanitizePhraseInput } from './voice/syllabify.js';

export class ScaleBoard {
  /**
   * @param {WebAudioSynth} synth - The synth engine to play through
   * @param {Object} project - The project to read settings from
   * @param {VoiceEngine|null} voiceEngine - Optional. If provided, "voices" pad mode is enabled.
   */
  constructor(synth, project, voiceEngine = null) {
    this.synth = synth;
    this.voiceEngine = voiceEngine;
    this.el = null;

    // State
    this.scaleName = 'major';
    this.rootNote = 'C';
    this.octave = 4;
    this.padMode = 'single'; // 'single', 'chords', 'root', 'voices', 'custom'
    this.extensionsEnabled = false;
    this.isEditingLayout = false;
    this.customPadTypes = []; // 'single' or 'chord'

    // Voice mode state
    this._voicePhrase = '';        // raw user-typed string
    this._voiceTokens = [];        // syllabify() output for the current phrase
    this._playableSyllables = [];  // valid syllable IDs in order
    this._phrasePointer = 0;       // next syllable index to sing on pressPad
    this._voiceInputDebounce = null;
    this._lastVoiceMidiByPad = new Map(); // padIndex -> last midi sung (for release)
    this.onVoicePhraseChanged = null;
    this.onPadModeChange = null;
    this.onExtensionsChanged = null;

    this._notes = [];
    this._fullScaleNotes = [];
    this._activePads = new Set();
    this._activeChords = new Map(); // padIndex -> array of midis
    this._activeRootDyads = new Map(); // padIndex -> [pad midi, nearest root midi]
    this._activePadIndexes = new Set();

    // Callbacks for note recording
    this._onNoteOn = null;
    this._onNoteOff = null;

    this._onResize = () => {
      if (this.el) {
        const container = this.el.querySelector('#sb-pads');
        if (container) {
          container.style.gridTemplateColumns = this._gridColumns();
        }
      }
    };
    
    // Now that state is initialized, set the project to trigger updates
    this.project = project;

    window.addEventListener('settings-pads-changed', (e) => {
      if (e.detail && e.detail.count) {
        this._updateNotes(e.detail.count);
      } else {
        this._updateNotes();
      }
      this._refreshPads();
    });
  }

  set project(p) {
    this._project = p;
    this.extensionsEnabled = !!p?.settings?.scaleExtensionsEnabled;
    this._updateNotes();
    this._loadVoiceStateFromProject();
    if (this.el) {
      this._refreshPads();
      this._refreshVoiceUi();
    }
  }

  get project() {
    return this._project;
  }

  /**
   * Set the VoiceEngine instance. May be called after construction once
   * the AudioEngine has initialized and the synth's tone input exists.
   */
  setVoiceEngine(voiceEngine) {
    this.voiceEngine = voiceEngine;
    if (this.el) this._refreshVoiceUi();
  }

  _loadVoiceStateFromProject() {
    const phrase = (this._project?.settings?.voicePhrase ?? '');
    this._voicePhrase = typeof phrase === 'string' ? phrase : '';
    this._recomputeVoiceTokens();
  }

  _persistVoicePhrase() {
    if (!this._project) return;
    if (!this._project.settings) this._project.settings = {};
    this._project.settings.voicePhrase = this._voicePhrase;
    if (this.onVoicePhraseChanged) this.onVoicePhraseChanged(this._voicePhrase);
  }

  _recomputeVoiceTokens() {
    if (!this.voiceEngine) {
      this._voiceTokens = [];
      this._playableSyllables = [];
      this._phrasePointer = 0;
      return;
    }
    const ids = this.voiceEngine.getAvailableSyllableIds();
    const bank = new Set(ids);
    this._voiceTokens = syllabify(this._voicePhrase, bank);
    this._playableSyllables = extractPlayableSyllables(this._voiceTokens);
    if (this._phrasePointer >= this._playableSyllables.length) {
      this._phrasePointer = 0;
    }
  }

  /** Set callbacks for note events (used by recording system) */
  setNoteCallbacks(onNoteOn, onNoteOff) {
    this._onNoteOn = onNoteOn;
    this._onNoteOff = onNoteOff;
  }

  /** Recalculate scale notes */
  _updateNotes(overrideCount) {
    this._fullScaleNotes = getScaleNotes(this.scaleName, this.rootNote, this.octave);

    if (this.padMode === 'root') {
      this._notes = NOTE_NAMES.map(note => noteNameToMidi(note, this.octave));
    } else if (this.padMode === 'custom') {
      const count = overrideCount || this.project?.settings?.scalePadsCount || 7;
      this._notes = this._fullScaleNotes.slice(0, Math.min(count, this._fullScaleNotes.length));
    } else {
      const scaleDef = SCALES[this.scaleName];
      const degreeCount = scaleDef ? scaleDef.intervals.length : 7;
      const count = this._usesExtensions()
        ? (degreeCount === 7 ? 13 : degreeCount * 2)
        : degreeCount;
      this._notes = this._fullScaleNotes.slice(0, Math.min(count, this._fullScaleNotes.length));
    }

    const noteCount = this._notes.length;
    while (this.customPadTypes.length < noteCount) {
      this.customPadTypes.push('single');
    }
    this.customPadTypes.length = noteCount;
  }

  /**
   * Render the Scale Board UI.
   * @returns {HTMLElement}
   */
  render() {
    this._updateNotes();

    this.el = document.createElement('div');
    this.el.className = 'scaleboard';
    this.el.id = 'scaleboard';

    this.el.innerHTML = `
      <div class="scaleboard__controls">
        <div class="scaleboard__control-group">
          <label class="scaleboard__label">${this.padMode === 'root' ? 'Root Note' : 'Root'}</label>
          <select class="scaleboard__select" id="sb-root" aria-label="Root note">
            ${NOTE_NAMES.map(n => `<option value="${n}" ${n === this.rootNote ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        ${this.padMode !== 'root' ? `
        <div class="scaleboard__control-group">
          <label class="scaleboard__label">Scale</label>
          <select class="scaleboard__select" id="sb-scale" aria-label="Scale type">
            ${Object.entries(SCALES).filter(([k]) => k !== 'chromatic').map(([key, s]) =>
              `<option value="${key}" ${key === this.scaleName ? 'selected' : ''}>${s.name}</option>`
            ).join('')}
          </select>
        </div>
        ` : ''}
        <div class="scaleboard__control-group">
          <label class="scaleboard__label">Pad Mode</label>
          <select class="scaleboard__select" id="sb-pad-mode" aria-label="Pad mode">
            <option value="single" ${this.padMode === 'single' ? 'selected' : ''}>Single</option>
            <option value="chords" ${this.padMode === 'chords' ? 'selected' : ''}>Chords</option>
            <option value="root" ${this.padMode === 'root' ? 'selected' : ''}>Root</option>
            ${this.voiceEngine ? `<option value="voices" ${this.padMode === 'voices' ? 'selected' : ''}>Voice Sketch</option>` : ''}
            <option value="custom" ${this.padMode === 'custom' ? 'selected' : ''}>Custom</option>
          </select>
        </div>
        <div class="scaleboard__octave">
          <button class="btn btn--icon btn--ghost scaleboard__oct-btn" id="sb-oct-down" aria-label="Octave down">▼</button>
          <span class="scaleboard__oct-display" id="sb-oct-display">Oct ${this.octave}</span>
          <button class="btn btn--icon btn--ghost scaleboard__oct-btn" id="sb-oct-up" aria-label="Octave up">▲</button>
        </div>
        ${this.padMode === 'custom' ? `
        <div class="scaleboard__control-group">
          <button class="btn btn--sm ${this.isEditingLayout ? 'btn--primary' : 'btn--ghost'}" id="sb-edit-layout">
            ${this.isEditingLayout ? 'Done' : 'Edit Layout'}
          </button>
        </div>
        ` : ''}
        ${this._canUseExtensions() ? `
        <div class="scaleboard__control-group">
          <button class="btn btn--sm ${this.extensionsEnabled ? 'btn--primary' : 'btn--ghost'} scaleboard__extensions-btn" id="sb-extensions" type="button" aria-pressed="${this.extensionsEnabled ? 'true' : 'false'}" title="Show scale degrees 1 through 13">
            Extensions
          </button>
        </div>
        ` : ''}
      </div>
      ${this._renderVoiceRow()}
      <div class="scaleboard__pads" id="sb-pads" style="grid-template-columns: ${this._gridColumns()}; gap: ${this._gridGap()};">
        ${this._renderPads()}
      </div>
    `;

    this._bindEvents();
    window.addEventListener('resize', this._onResize);
    return this.el;
  }

  _gridColumns() {
    const idealCols = Math.ceil(Math.sqrt(this._notes.length));
    const container = this.el?.querySelector('#sb-pads');
    const width = container?.clientWidth || 360;
    const maxCols = Math.max(1, Math.floor((width - 4) / 72));
    const cols = Math.min(idealCols, maxCols);
    return `repeat(${cols}, 1fr)`;
  }

  _gridGap() {
    return this._notes.length > 9 ? '6px' : 'var(--space-md)';
  }

  _canUseExtensions() {
    return this.padMode === 'single' || this.padMode === 'chords';
  }

  _usesExtensions() {
    return this.extensionsEnabled && this._canUseExtensions();
  }

  _renderPads() {
    return this._notes.map((midi, i) => {
      const noteInfo = midiToNoteName(midi);
      const isRootMode = this.padMode === 'root';
      const rootMidi = isRootMode ? this._rootMidiNear(midi) : midi;
      const rootInfo = midiToNoteName(rootMidi);
      let isChord = this.padMode === 'chords' || (this.padMode === 'custom' && this.customPadTypes[i] === 'chord');
      const degree = i + 1;
      let typeLabel = isRootMode ? `+ ${rootInfo.display}` : (isChord ? 'Chord' : 'Note');
      const isVoice = this.padMode === 'voices';
      const voiceLabel = isVoice ? this._previewSyllableForPad(i) : null;
      const voiceClass = isVoice ? ' scaleboard__pad--voice' : '';
      return `
        <button class="scaleboard__pad${voiceClass} ${this.isEditingLayout ? 'is-editing' : ''}" data-index="${i}" data-midi="${midi}"
                aria-label="${isRootMode ? `${noteInfo.display} plus nearest ${this.rootNote}, ${rootInfo.display}` : `Scale degree ${degree}, ${noteInfo.display}`}${voiceLabel ? ', sings ' + voiceLabel : ''}">
          <span class="scaleboard__pad-degree">${isRootMode ? noteInfo.name : degree}</span>
          <span class="scaleboard__pad-note">${noteInfo.display}</span>
          ${(this.padMode === 'custom' || isRootMode) ? `<span class="scaleboard__pad-type">${typeLabel}</span>` : ''}
          ${isVoice && voiceLabel ? `<span class="scaleboard__pad-syllable">${this._escapeHtml(voiceLabel)}</span>` : ''}
        </button>
      `;
    }).join('');
  }

  _renderVoiceRow() {
    if (this.padMode !== 'voices' || !this.voiceEngine) return '';
    const pointerHint = this._playableSyllables.length === 0
      ? 'Experimental robot voice. Type supported sounds below. Empty phrase = pads sing "ah".'
      : `Experimental robot voice: pads advance through ${this._playableSyllables.length} token${this._playableSyllables.length === 1 ? '' : 's'}.`;
    const tokensHtml = this._renderVoiceTokens();
    return `
      <div class="scaleboard__voice-row" id="sb-voice-row">
        <div class="scaleboard__voice-input-wrap">
          <label class="scaleboard__label" for="sb-voice-phrase">Phrase</label>
          <input
            class="scaleboard__voice-input"
            id="sb-voice-phrase"
            type="text"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            placeholder="supported sounds: ah eh ee oh oo ai oi au ei h n m l s t la lee lo ma mee mo na no ha sa ta"
            value="${this._escapeAttr(this._voicePhrase || '')}"
            aria-label="Voice phrase"
          />
          <button class="btn btn--sm btn--ghost scaleboard__voice-rewind" id="sb-voice-rewind" aria-label="Rewind phrase to start" title="Rewind to start">↻</button>
        </div>
        <div class="scaleboard__voice-tokens" id="sb-voice-tokens" aria-live="polite">${tokensHtml}</div>
        <div class="scaleboard__voice-hint">${pointerHint}</div>
      </div>
    `;
  }

  _renderVoiceTokens() {
    if (!this._voiceTokens || this._voiceTokens.length === 0) {
      if (!this.voiceEngine) return '';
      // Show a default-cycle hint when phrase is empty.
      return '<span class="voice-token voice-token--hint">(experimental robot voice — empty phrase sings "ah")</span>';
    }
    let validIndex = 0;
    const parts = this._voiceTokens.map((tok) => {
      if (tok.isWhitespace) return `<span class="voice-token-gap">·</span>`;
      const isCurrent = tok.valid && validIndex === this._phrasePointer;
      const cls = [
        'voice-token',
        tok.valid ? 'voice-token--valid' : 'voice-token--invalid',
        isCurrent ? 'is-current' : '',
      ].filter(Boolean).join(' ');
      const html = `<span class="${cls}" title="${tok.valid ? 'Will play: ' + this._escapeAttr(tok.text) : 'No match: ' + this._escapeAttr(tok.text) + '. Add a space or change the spelling.'}">${this._escapeHtml(tok.text)}</span>`;
      if (tok.valid) validIndex++;
      return html;
    });
    return parts.join('');
  }

  /** What syllable would the next pad press sing? */
  _previewSyllableForPad(_padIndex) {
    if (!this.voiceEngine) return null;
    if (this._playableSyllables.length === 0) return 'ah';
    const idx = this._phrasePointer % this._playableSyllables.length;
    return this._playableSyllables[idx];
  }

  _refreshVoiceUi() {
    if (!this.el) return;
    const row = this.el.querySelector('#sb-voice-row');
    if (this.padMode === 'voices') {
      if (!row) {
        // Re-render entire layout to insert the row
        this._refreshLayout();
        return;
      }
      const tokens = row.querySelector('#sb-voice-tokens');
      if (tokens) tokens.innerHTML = this._renderVoiceTokens();
      const hint = row.querySelector('.scaleboard__voice-hint');
      if (hint) {
        hint.textContent = this._playableSyllables.length === 0
          ? 'Experimental robot voice. Type supported sounds below. Empty phrase = pads sing "ah".'
          : `Experimental robot voice: pads advance through ${this._playableSyllables.length} token${this._playableSyllables.length === 1 ? '' : 's'}.`;
      }
    } else if (row) {
      row.remove();
    }
  }

  _escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  _escapeAttr(str) {
    return this._escapeHtml(str);
  }

  _refreshLayout() {
    const parent = this.el.parentNode;
    const oldEl = this.el;
    if (parent) {
      const newEl = this.render();
      parent.replaceChild(newEl, oldEl);
    } else {
      this._refreshPads();
    }
  }

  _refreshPads() {
    this._updateNotes();
    const padsContainer = this.el.querySelector('#sb-pads');
    padsContainer.style.gridTemplateColumns = this._gridColumns();
    padsContainer.innerHTML = this._renderPads();
    this._bindPadEvents();
  }

  _bindEvents() {
    // Root note selector
    this.el.querySelector('#sb-root').addEventListener('change', (e) => {
      this.rootNote = e.target.value;
      this._refreshPads();
    });

    // Scale selector
    this.el.querySelector('#sb-scale')?.addEventListener('change', (e) => {
      this.scaleName = e.target.value;
      this._refreshPads();
    });

    // Octave controls
    this.el.querySelector('#sb-oct-down').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.shiftOctave(-1);
    });

    this.el.querySelector('#sb-oct-up').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.shiftOctave(1);
    });

    // Mode selector
    this.el.querySelector('#sb-pad-mode')?.addEventListener('change', (e) => {
      this.releaseAllPads();
      this.padMode = e.target.value;
      if (this.padMode !== 'custom') this.isEditingLayout = false;
      // When entering voices mode, ensure tokens reflect the latest bank/phrase.
      if (this.padMode === 'voices') {
        this._recomputeVoiceTokens();
      }
      this._refreshLayout();
      if (this.padMode === 'custom') {
        showToast('Tap "Edit Layout" to set each pad to Note or Chord');
      } else if (this.padMode === 'root') {
        showToast('Root Mode: each note also plays the nearest root');
      } else if (this.padMode === 'voices') {
        showToast('Voice Sketch: experimental robot voice tokens');
      }
      // Notify host (CreativeMode) so it can sync the AI Seed button:
      // AI is hidden in Voices mode because the AI emits MIDI/drum events,
      // not vocal-phrase events.
      if (this.onPadModeChange) this.onPadModeChange(this.padMode);
    });

    this.el.querySelector('#sb-extensions')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.releaseAllPads();
      this.extensionsEnabled = !this.extensionsEnabled;
      if (this._project) {
        if (!this._project.settings) this._project.settings = {};
        this._project.settings.scaleExtensionsEnabled = this.extensionsEnabled;
      }
      this._refreshLayout();
      showToast(this.extensionsEnabled ? 'Extensions: scale degrees 1-13' : 'Extensions off');
      if (this.onExtensionsChanged) this.onExtensionsChanged(this.extensionsEnabled);
    });

    // Edit Layout toggle
    this.el.querySelector('#sb-edit-layout')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.isEditingLayout = !this.isEditingLayout;
      this._refreshLayout();
    });

    this._bindVoiceEvents();
    this._bindPadEvents();
  }

  _bindVoiceEvents() {
    if (this.padMode !== 'voices') return;
    const input = this.el.querySelector('#sb-voice-phrase');
    if (input) {
      input.addEventListener('input', (e) => {
        // Sanitize to ASCII letters/spaces/apostrophes/hyphens.
        const sanitized = sanitizePhraseInput(e.target.value);
        if (sanitized !== e.target.value) {
          // Preserve cursor position approximately.
          const pos = input.selectionStart;
          input.value = sanitized;
          if (typeof pos === 'number') {
            const next = Math.max(0, Math.min(sanitized.length, pos - (e.target.value.length - sanitized.length)));
            try { input.setSelectionRange(next, next); } catch (_) {}
          }
        }
        this._voicePhrase = sanitized;
        this._phrasePointer = 0;

        // Debounce token recomputation.
        if (this._voiceInputDebounce) clearTimeout(this._voiceInputDebounce);
        this._voiceInputDebounce = setTimeout(() => {
          this._recomputeVoiceTokens();
          this._persistVoicePhrase();
          this._refreshVoiceUi();
          this._refreshPadsSoft();
        }, 60);
      });
    }
    const rewind = this.el.querySelector('#sb-voice-rewind');
    if (rewind) {
      rewind.addEventListener('click', (e) => {
        e.preventDefault();
        this._phrasePointer = 0;
        this._refreshVoiceUi();
        this._refreshPadsSoft();
      });
    }
  }

  /** Update pad text without rebuilding event handlers (cheap re-render). */
  _refreshPadsSoft() {
    if (!this.el) return;
    if (this.padMode !== 'voices') return;
    const pads = this.el.querySelectorAll('.scaleboard__pad');
    const next = this._previewSyllableForPad(0);
    pads.forEach((pad) => {
      const slot = pad.querySelector('.scaleboard__pad-syllable');
      if (slot) slot.textContent = next || '';
    });
  }

  _getChordMidis(startIndex) {
    // A simple triad (1st, 3rd, 5th in the scale)
    const midis = [];
    const maxIdx = this._fullScaleNotes.length - 1;
    midis.push(this._fullScaleNotes[startIndex]); // root
    midis.push(this._fullScaleNotes[Math.min(startIndex + 2, maxIdx)]); // third
    midis.push(this._fullScaleNotes[Math.min(startIndex + 4, maxIdx)]); // fifth
    return midis;
  }

  _rootMidiNear(referenceMidi) {
    const rootClass = noteNameToMidi(this.rootNote, 0) % 12;
    let best = rootClass;
    while (best < referenceMidi - 6) best += 12;
    while (best > referenceMidi + 6) best -= 12;
    return Math.max(0, Math.min(127, best));
  }

  _bindPadEvents() {
    const pads = this.el.querySelectorAll('.scaleboard__pad');
    pads.forEach(pad => {
      const i = parseInt(pad.dataset.index, 10);
      const midi = parseInt(pad.dataset.midi, 10);

      // Pointer down → note on / edit toggle
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        
        if (this.isEditingLayout) {
          // Toggle custom type
          this.customPadTypes[i] = this.customPadTypes[i] === 'single' ? 'chord' : 'single';
          this._refreshPads();
          return;
        }

        pad.setPointerCapture(e.pointerId);
        this.pressPad(i);
      });

      const handleRelease = (e) => {
        e.preventDefault();
        if (this.isEditingLayout) return;

        this.releasePad(i);
      };

      // Pointer up → note off
      pad.addEventListener('pointerup', handleRelease);

      // Pointer cancel/leave → note off
      pad.addEventListener('pointercancel', handleRelease);
    });
  }

  pressPad(index) {
    if (this.isEditingLayout || this._activePadIndexes.has(index)) return;
    const pad = this.el?.querySelector(`.scaleboard__pad[data-index="${index}"]`);
    const midi = this._notes[index];
    if (!pad || midi === undefined) return;

    pad.classList.add('is-active');
    this._activePadIndexes.add(index);

    if (this.padMode === 'voices' && this.voiceEngine) {
      this._pressVoicePad(index, midi);
      return;
    }

    if (this.padMode === 'root') {
      const rootMidi = this._rootMidiNear(midi);
      const midis = rootMidi === midi ? [midi] : [midi, rootMidi];
      this._activeRootDyads.set(index, midis);
      midis.forEach(m => this._noteOn(m));
      return;
    }

    const isChord = this.padMode === 'chords' || (this.padMode === 'custom' && this.customPadTypes[index] === 'chord');
    if (isChord) {
      const chordMidis = this._getChordMidis(index);
      this._activeChords.set(index, chordMidis);
      chordMidis.forEach(m => this._noteOn(m));
    } else {
      this._noteOn(midi);
    }
  }

  releasePad(index) {
    if (!this._activePadIndexes.has(index)) return;
    const pad = this.el?.querySelector(`.scaleboard__pad[data-index="${index}"]`);
    const midi = this._notes[index];
    if (pad) pad.classList.remove('is-active');

    if (this.padMode === 'voices' && this.voiceEngine) {
      this._releaseVoicePad(index);
      this._activePadIndexes.delete(index);
      return;
    }

    if (this._activeRootDyads.has(index)) {
      const midis = this._activeRootDyads.get(index) || [];
      midis.forEach(m => this._noteOff(m));
      this._activeRootDyads.delete(index);
      this._activePadIndexes.delete(index);
      return;
    }

    if (this._activeChords.has(index)) {
      const chordMidis = this._activeChords.get(index) || [];
      chordMidis.forEach(m => this._noteOff(m));
      this._activeChords.delete(index);
    } else if (midi !== undefined) {
      this._noteOff(midi);
    }

    this._activePadIndexes.delete(index);
  }

  _pressVoicePad(index, midi) {
    // Choose syllable: from the parsed phrase, or fall back to "ah" when phrase
    // is empty / has no playable syllables. Empty-phrase fallback gives users
    // immediate feedback without forcing them to type first.
    let syllable;
    if (this._playableSyllables.length === 0) {
      syllable = this.voiceEngine.hasSyllable('ah') ? 'ah' : (this.voiceEngine.getAvailableSyllableIds()[0] || null);
    } else {
      const ptr = this._phrasePointer % this._playableSyllables.length;
      syllable = this._playableSyllables[ptr];
      this._phrasePointer = (ptr + 1) % this._playableSyllables.length;
    }
    if (syllable) {
      this.voiceEngine.singSyllable(syllable, midi, 0.85);
      this._lastVoiceMidiByPad.set(index, midi);
      // Preserve voice intent for recorded snippets; playback/export routing is
      // a follow-up so old synth playback still has a clean data path.
      const voiceInfo = this.voiceEngine.getVoiceInfo?.();
      if (this._onNoteOn) {
        this._onNoteOn(midi, 0.85, {
          voice: {
            mode: 'voice-sketch',
            voiceId: voiceInfo?.id || this.project?.settings?.voiceId || 'english-base',
            syllableId: syllable,
          },
        });
      }
    }
    // Update token highlight + pad preview.
    this._refreshVoiceUi();
    this._refreshPadsSoft();
  }

  _releaseVoicePad(index) {
    const midi = this._lastVoiceMidiByPad.get(index);
    if (midi !== undefined && this.voiceEngine) {
      this.voiceEngine.releaseSyllable(midi);
      if (this._onNoteOff) this._onNoteOff(midi);
      this._lastVoiceMidiByPad.delete(index);
    }
  }

  releaseAllPads() {
    [...this._activePadIndexes].forEach(index => this.releasePad(index));
    if (this.voiceEngine) {
      // Defensive: stop anything still ringing in voice engine.
      this.voiceEngine.releaseAll();
      this._lastVoiceMidiByPad.clear();
    }
  }

  shiftOctave(delta) {
    const next = Math.max(2, Math.min(6, this.octave + delta));
    if (next === this.octave) return;
    this.releaseAllPads();
    this.octave = next;
    this.el?.querySelector('#sb-oct-display')?.replaceChildren(`Oct ${this.octave}`);
    if (this.el) this._refreshPads();
  }

  _noteOn(midi) {
    this.synth.noteOn(midi);
    this._activePads.add(midi);
    if (this._onNoteOn) this._onNoteOn(midi, 0.8);
  }

  _noteOff(midi) {
    this.synth.noteOff(midi);
    this._activePads.delete(midi);
    if (this._onNoteOff) this._onNoteOff(midi);
  }
}
