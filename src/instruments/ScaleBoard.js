/**
 * ScaleBoard — Scale-locked pad instrument.
 *
 * Pad Mode dropdown options:
 *   - "single": each pad plays a single note from the scale.
 *   - "chords": each pad plays a triad rooted on its scale degree.
 *     The Extensions toggle continues normal chord layouts up to degree 13.
 *     Scales with curated chord recipes show named harmonic pads instead.
 *   - "root": chromatic pads; each pad plays itself plus the selected root
 *             note in the octave nearest the pad note.
 *   - "step": one trigger advances through a typed sequence of pad numbers.
 *   - "voices": each pad sings a syllable from a typed phrase, at the pad's pitch.
 *               Requires a VoiceEngine to be passed in. Phrase is persisted in
 *               project.settings.voicePhrase.
 *   - "custom": per-pad type selection (single/chord) editable via "Edit Layout".
 *
 * Octave shifts apply uniformly across modes. In voices mode, octave shifts move
 * the voiced source's pitch but leave the syllable's formants alone — that's how
 * a low and a high voice singing "ah" both sound like "ah."
 */

import {
  CIRCLE_OF_FIFTHS,
  degreeForMidi,
  getScaleNotes,
  midiToNoteName,
  normalizeDegreeHighlighting,
  normalizeMusicalContext,
  noteNameToMidi,
  SCALES,
  NOTE_NAMES
} from '../engine/MusicTheory.js';
import { scaleChordRecipes } from '../engine/ScaleChords.js';
import { showToast } from '../ui/Toast.js';
import { syllabify, extractPlayableSyllables, sanitizePhraseInput } from './voice/syllabify.js';
import { dwellSettings, tremorAllows } from '../ui/AccessibilityProfiles.js';

const STEP_PLAY_DEFAULT_OCTAVE = 4;
const STEP_PLAY_MIN_OCTAVE = 1;
const STEP_PLAY_MAX_OCTAVE = 6;

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
    this.padMode = 'single'; // 'single', 'chords', 'root', 'compass', 'step', 'voices', 'custom'
    this.extensionsEnabled = false;
    this.isEditingLayout = false;
    this.customPadTypes = []; // 'single' or 'chord'
    this._stepPointer = 0;
    this._stepReleaseTimer = null;
    this._activeStepMidis = [];
    this._stepEditorOverlay = null;
    this._stepEditorOctave = 0;
    this._stepEditorKeyHandler = null;
    this._stepEditorSequence = [];
    this._stepEditorAltTarget = null;
    this._stepEditorUndoStack = [];
    this._stepLoopIndex = 0;

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
    this.onStepPlayChanged = null;

    this._notes = [];
    this._fullScaleNotes = [];
    this._activePads = new Set();
    this._activeChords = new Map(); // padIndex -> array of midis
    this._activeRootDyads = new Map(); // padIndex -> [pad midi, nearest root midi]
    this._activeCompassChords = new Map(); // segmentId -> array of midis
    this._activeControllerPadBindings = new Map(); // bindingKey -> { index, midis }
    this._activePadIndexes = new Set();
    this._dwellTimers = new Map();
    this._dwellActivePads = new Set();

    // Callbacks for note recording
    this._onNoteOn = null;
    this._onNoteOff = null;
    this._onBeforeNoteOn = null;
    this._onControllerLearnTarget = null;

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
    const context = normalizeMusicalContext(p?.musicalContext);
    this.rootNote = context.root;
    this.scaleName = context.scale;
    this.extensionsEnabled = !!p?.settings?.scaleExtensionsEnabled;
    this._updateNotes();
    this._upgradeStepPlayPattern();
    this._loadVoiceStateFromProject();
    if (this.el) {
      this._refreshPads();
      this._refreshVoiceUi();
    }
  }

  get project() {
    return this._project;
  }

  setProjectKey(context) {
    const next = normalizeMusicalContext(context);
    if (this.rootNote === next.root && this.scaleName === next.scale) {
      if (this.el) this._refreshPads();
      return;
    }
    this.releaseAllPads();
    this.rootNote = next.root;
    this.scaleName = next.scale;
    if (this.el) this._refreshLayout();
    else this._updateNotes();
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

  setBeforeNoteCallback(fn) {
    this._onBeforeNoteOn = fn;
  }

  setControllerLearnCallback(fn) {
    this._onControllerLearnTarget = fn;
  }

  /** Recalculate scale notes */
  _updateNotes(overrideCount) {
    this._fullScaleNotes = getScaleNotes(this.scaleName, this.rootNote, this.octave);

    if (this.padMode === 'root') {
      this._notes = NOTE_NAMES.map(note => noteNameToMidi(note, this.octave));
    } else if (this.padMode === 'chords' && this._curatedChordRecipes()) {
      const rootMidi = noteNameToMidi(this.rootNote, this.octave);
      this._notes = this._curatedChordRecipes().map(recipe => rootMidi + (recipe.semitones?.[0] || 0));
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
          <label class="scaleboard__label">Pad Mode</label>
          <select class="scaleboard__select" id="sb-pad-mode" aria-label="Pad mode">
            <option value="single" ${this.padMode === 'single' ? 'selected' : ''}>Single</option>
            <option value="chords" ${this.padMode === 'chords' ? 'selected' : ''}>Chords</option>
            <option value="root" ${this.padMode === 'root' ? 'selected' : ''}>Root</option>
            <option value="compass" ${this.padMode === 'compass' ? 'selected' : ''}>Compass</option>
            <option value="step" ${this.padMode === 'step' ? 'selected' : ''}>Step Play</option>
            ${this.voiceEngine ? `<option value="voices" ${this.padMode === 'voices' ? 'selected' : ''}>Voice Sketch</option>` : ''}
            <option value="custom" ${this.padMode === 'custom' ? 'selected' : ''}>Custom</option>
          </select>
        </div>
        ${this.padMode !== 'step' ? `<div class="scaleboard__octave">
          <button class="btn btn--icon btn--ghost scaleboard__oct-btn" id="sb-oct-down" aria-label="Octave down">▼</button>
          <span class="scaleboard__oct-display" id="sb-oct-display">Oct ${this.octave}</span>
          <button class="btn btn--icon btn--ghost scaleboard__oct-btn" id="sb-oct-up" aria-label="Octave up">▲</button>
        </div>` : '<div class="scaleboard__octave scaleboard__octave--hidden" aria-hidden="true"></div>'}
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
      ${this.padMode === 'compass'
        ? this._renderCompass()
        : this.padMode === 'step'
          ? this._renderStepPlay()
        : `<div class="scaleboard__pads" id="sb-pads" style="grid-template-columns: ${this._gridColumns()}; gap: ${this._gridGap()};">
            ${this._renderPads()}
          </div>`}
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
    return this.padMode === 'single' || (this.padMode === 'chords' && !this._curatedChordRecipes());
  }

  _usesExtensions() {
    return this.extensionsEnabled && this._canUseExtensions();
  }

  _curatedChordRecipes() {
    return scaleChordRecipes(this.scaleName);
  }

  _curatedChordRecipe(index) {
    const recipes = this.padMode === 'chords' ? this._curatedChordRecipes() : null;
    return recipes?.[index] || null;
  }

  _circleRoots() {
    const startIdx = CIRCLE_OF_FIFTHS.indexOf(this.rootNote);
    if (startIdx < 0) return CIRCLE_OF_FIFTHS;
    return [
      ...CIRCLE_OF_FIFTHS.slice(startIdx),
      ...CIRCLE_OF_FIFTHS.slice(0, startIdx),
    ];
  }

  _renderCompass() {
    const roots = this._circleRoots();
    const isMajorContext = this.scaleName === 'major';
    const outerDiatonic = new Set([0, 1, 11]);
    const innerDiatonic = new Set([0, 1, 11]);
    const buttons = [];

    roots.forEach((root, i) => {
      const angle = -90 + i * 30;
      const outer = this._compassPoint(angle, 43);
      const inner = this._compassPoint(angle, 30);
      const minorRoot = NOTE_NAMES[(NOTE_NAMES.indexOf(root) + 9) % 12];
      const outerClass = isMajorContext && outerDiatonic.has(i) ? ' is-diatonic' : '';
      const innerClass = isMajorContext && innerDiatonic.has(i) ? ' is-diatonic' : '';
      const homeClass = i === 0 ? ' is-home' : '';

      buttons.push(`
        <button class="tonal-compass__segment tonal-compass__segment--outer${outerClass}${homeClass}"
                style="left:${outer.x}%; top:${outer.y}%;"
                data-compass-id="outer-${i}" data-compass-index="${i}" data-compass-quality="major"
                aria-label="${root} major chord">
          <span class="tonal-compass__chord">${root}</span>
          <span class="tonal-compass__quality">maj</span>
        </button>
      `);
      buttons.push(`
        <button class="tonal-compass__segment tonal-compass__segment--inner${innerClass}${homeClass}"
                style="left:${inner.x}%; top:${inner.y}%;"
                data-compass-id="inner-${i}" data-compass-index="${i}" data-compass-quality="minor"
                aria-label="${minorRoot} minor chord, relative minor of ${root}">
          <span class="tonal-compass__chord">${minorRoot}</span>
          <span class="tonal-compass__quality">min</span>
        </button>
      `);
    });

    return `
      <div class="tonal-compass" id="sb-compass">
        <div class="tonal-compass__stage" aria-label="Tonal Compass circle of fifths chord surface">
          <div class="tonal-compass__ring tonal-compass__ring--outer"></div>
          <div class="tonal-compass__ring tonal-compass__ring--inner"></div>
          ${buttons.join('')}
          <div class="tonal-compass__center">
            <span class="tonal-compass__key">${this.rootNote}</span>
            <span class="tonal-compass__hint">${isMajorContext ? 'home chord' : 'circle of fifths'}</span>
          </div>
        </div>
        <p class="tonal-compass__caption">
          Outer ring plays major chords. Inner ring plays each relative minor. In Major keys, the bright arc marks the closest in-key chord family.
        </p>
      </div>
    `;
  }

  _compassPoint(angleDeg, radiusPercent) {
    const rad = angleDeg * Math.PI / 180;
    return {
      x: 50 + Math.cos(rad) * radiusPercent,
      y: 50 + Math.sin(rad) * radiusPercent,
    };
  }

  _renderPads() {
    return this._notes.map((midi, i) => {
      const noteInfo = midiToNoteName(midi);
      const curatedChord = this._curatedChordRecipe(i);
      const isRootMode = this.padMode === 'root';
      const rootMidi = isRootMode ? this._rootMidiNear(midi) : midi;
      const rootInfo = midiToNoteName(rootMidi);
      let isChord = this.padMode === 'chords' || (this.padMode === 'custom' && this.customPadTypes[i] === 'chord');
      const degree = i + 1;
      let typeLabel = isRootMode ? `+ ${rootInfo.display}` : (curatedChord?.name || (isChord ? 'Chord' : 'Note'));
      const isVoice = this.padMode === 'voices';
      const voiceLabel = isVoice ? this._previewSyllableForPad(i) : null;
      const voiceClass = isVoice ? ' scaleboard__pad--voice' : '';
      const degreeMeta = this._degreeMetaForMidi(midi);
      const degreeClass = degreeMeta
        ? `${degreeMeta.colorEnabled ? ' scaleboard__pad--degree-color' : ''}${degreeMeta.functionName ? ' scaleboard__pad--degree-label' : ''}`
        : '';
      const degreeStyle = degreeMeta ? ` style="--degree-color: ${this._escapeAttr(degreeMeta.color)}; --degree-intensity: ${this._escapeAttr(degreeMeta.intensityPercent)};"` : '';
      const degreeLabel = degreeMeta?.functionName || '';
      const theoryLabel = degreeMeta?.functionName
        ? `, ${degreeMeta.functionName}${degreeMeta.shorthand ? ` (${degreeMeta.shorthand})` : ''}`
        : '';
      return `
        <button class="scaleboard__pad${voiceClass}${degreeClass} ${this.isEditingLayout ? 'is-editing' : ''}"${degreeStyle} data-index="${i}" data-midi="${midi}"
                aria-label="${isRootMode ? `${noteInfo.display} plus nearest ${this.rootNote}, ${rootInfo.display}` : curatedChord ? `${curatedChord.label} chord, ${curatedChord.name}` : `Scale degree ${degree}, ${noteInfo.display}`}${theoryLabel}${voiceLabel ? ', sings ' + voiceLabel : ''}">
          <span class="scaleboard__pad-degree">${isRootMode ? noteInfo.name : (curatedChord?.label || degree)}</span>
          <span class="scaleboard__pad-note">${noteInfo.display}</span>
          ${degreeLabel ? `<span class="scaleboard__pad-degree-name">${this._escapeHtml(degreeLabel)}</span>` : ''}
          ${(this.padMode === 'custom' || isRootMode || curatedChord) ? `<span class="scaleboard__pad-type">${this._escapeHtml(typeLabel)}</span>` : ''}
          ${isVoice && voiceLabel ? `<span class="scaleboard__pad-syllable">${this._escapeHtml(voiceLabel)}</span>` : ''}
        </button>
      `;
    }).join('');
  }

  _degreeMetaForMidi(midi, options = {}) {
    if (this.padMode === 'voices') return null;
    const degree = normalizeDegreeHighlighting(this.project?.settings?.degreeHighlighting);
    if (!options.includeOutOfScale && !degree.enabled && !degree.showLabels) return null;
    const context = normalizeMusicalContext({ root: this.rootNote, scale: this.scaleName });
    const meta = degreeForMidi(midi, context);
    if (!meta) return options.includeOutOfScale ? { inScale: false } : null;
    return {
      inScale: true,
      color: degree.colors[meta.interval],
      colorEnabled: degree.enabled,
      intensityPercent: `${Math.round((degree.intensity ?? 0.22) * 100)}%`,
      functionName: degree.showLabels ? (meta.functionName || meta.name || meta.label) : '',
      shorthand: meta.label || ''
    };
  }

  _stepSequenceString() {
    return this._stepEntries().map(entry => midiToNoteName(entry.midi).display).join(' ');
  }

  _scaleDegreeCount() {
    return SCALES[this.scaleName]?.intervals?.length || 7;
  }

  _normalizeStepDegree(degree) {
    const parsed = parseInt(degree, 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 64 ? parsed : null;
  }

  _normalizeStepMidi(midi) {
    const parsed = parseInt(midi, 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 127 ? parsed : null;
  }

  _entryForStepDegree(degree) {
    const normalized = this._normalizeStepDegree(degree);
    if (!normalized) return null;
    const midi = this._midiForStepDegree(normalized);
    if (!Number.isInteger(midi)) return null;
    return { degree: normalized, midi };
  }

  _defaultStepEntries() {
    return Array.from({ length: this._scaleDegreeCount() }, (_, index) => this._entryForStepDegree(index + 1)).filter(Boolean);
  }

  _entriesFromDegreeString(value) {
    const degrees = (String(value || '').match(/\d+/g) || [])
      .map(token => parseInt(token, 10))
      .filter(degree => Number.isInteger(degree) && degree > 0 && degree <= 64);
    return degrees.map(degree => this._entryForStepDegree(degree)).filter(Boolean);
  }

  _normalizeStepEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.map(entry => {
      const degree = this._normalizeStepDegree(entry?.degree ?? entry);
      const midi = this._normalizeStepMidi(entry?.midi);
      const resolvedMidi = midi ?? (degree ? this._midiForStepDegree(degree) : null);
      if (!Number.isInteger(resolvedMidi)) return null;
      const normalized = { midi: resolvedMidi };
      if (degree) normalized.degree = degree;

      const alternateDegree = this._normalizeStepDegree(entry?.alternateDegree);
      const alternateMidi = this._normalizeStepMidi(entry?.alternateMidi);
      const resolvedAlternateMidi = alternateMidi ?? (alternateDegree ? this._midiForStepDegree(alternateDegree) : null);
      if (Number.isInteger(resolvedAlternateMidi)) {
        normalized.alternateMidi = resolvedAlternateMidi;
        if (alternateDegree) normalized.alternateDegree = alternateDegree;
      }
      return normalized;
    }).filter(Boolean);
  }

  _upgradeStepPlayPattern() {
    const settings = this.project?.settings;
    if (!settings) return;
    const hasPattern = Array.isArray(settings.stepPlayPattern) && settings.stepPlayPattern.length > 0;
    const hasLegacySequence = typeof settings.stepPlaySequence === 'string' && settings.stepPlaySequence.trim().length > 0;
    const needsMidi = hasPattern && settings.stepPlayPattern.some(entry => !Number.isInteger(this._normalizeStepMidi(entry?.midi)));
    if (!hasPattern && !hasLegacySequence) return;
    if (hasPattern && !needsMidi) return;

    const source = hasPattern
      ? settings.stepPlayPattern
      : this._entriesFromDegreeString(settings.stepPlaySequence);
    const upgraded = this._normalizeStepEntries(source);
    if (!upgraded.length) return;
    settings.stepPlayPattern = upgraded.map(entry => ({ ...entry }));
    settings.stepPlaySequence = upgraded
      .map(entry => entry.degree ? String(entry.degree) : midiToNoteName(entry.midi).display)
      .join(' ');
  }

  _stepEntries() {
    const pattern = this._normalizeStepEntries(this.project?.settings?.stepPlayPattern);
    if (pattern.length) return pattern;
    const legacy = this._entriesFromDegreeString(this.project?.settings?.stepPlaySequence);
    return legacy.length ? legacy : this._defaultStepEntries();
  }

  _stepScaleNotes(requiredCount = 32) {
    return getScaleNotes(this.scaleName, this.rootNote, STEP_PLAY_DEFAULT_OCTAVE, Math.max(32, requiredCount));
  }

  _midiForStepDegree(degree) {
    const notes = this._stepScaleNotes(degree);
    return notes[degree - 1];
  }

  _stepLabel(degree) {
    const midi = this._midiForStepDegree(degree);
    const note = midiToNoteName(midi);
    return { degree, midi, note };
  }

  _entryForStepMidi(midi, degree = null) {
    const normalizedMidi = this._normalizeStepMidi(midi);
    if (!Number.isInteger(normalizedMidi)) return null;
    const normalized = { midi: normalizedMidi };
    const normalizedDegree = this._normalizeStepDegree(degree);
    if (normalizedDegree) normalized.degree = normalizedDegree;
    return normalized;
  }

  _stepEntryLabel(entry) {
    const normalized = this._normalizeStepEntries([entry])[0] || this._entryForStepDegree(1);
    const midi = normalized?.midi ?? 60;
    return {
      ...normalized,
      note: midiToNoteName(midi),
      outOfScale: !this._degreeMetaForMidi(midi, { includeOutOfScale: true })?.inScale,
    };
  }

  _persistStepEntries(entries) {
    if (!this.project) return;
    if (!this.project.settings) this.project.settings = {};
    const normalized = this._normalizeStepEntries(entries);
    const next = normalized.length ? normalized : this._defaultStepEntries();
    this.project.settings.stepPlayPattern = next.map(entry => ({ ...entry }));
    this.project.settings.stepPlaySequence = next
      .map(entry => entry.degree ? String(entry.degree) : midiToNoteName(entry.midi).display)
      .join(' ');
    this._stepPointer = 0;
    this._stepLoopIndex = 0;
    if (this.onStepPlayChanged) this.onStepPlayChanged(this.project.settings.stepPlaySequence);
  }

  _persistStepSequence(value) {
    this._persistStepEntries(this._entriesFromDegreeString(value));
  }

  _renderStepPlay() {
    const chips = this._renderStepChips();
    return `
      <div class="step-play" id="sb-step-play">
        <div class="step-play__main">
          <button class="step-play__trigger" id="sb-step-trigger" type="button" aria-label="Play next step">
            <span class="step-play__trigger-label">Step</span>
            <span class="step-play__trigger-sub">Press any keyboard key or MIDI note to advance</span>
          </button>
          <div class="step-play__sequence" id="sb-step-sequence" aria-live="polite">${chips}</div>
        </div>
        <div class="step-play__actions">
          <button class="btn btn--sm btn--ghost" id="sb-step-edit" type="button">Edit Sequence</button>
          <button class="btn btn--sm btn--ghost" id="sb-step-reset" type="button">Reset</button>
        </div>
      </div>
    `;
  }

  _renderStepChips() {
    const sequence = this._stepEntries();
    return sequence.map((entry, step) => {
      const label = this._stepEntryLabel(entry);
      const { midi, note } = label;
      const alternate = entry.alternateMidi ? this._stepEntryLabel({ midi: entry.alternateMidi, degree: entry.alternateDegree }) : null;
      const isCurrent = step === (this._stepPointer % Math.max(1, sequence.length));
      const degreeMeta = this._degreeMetaForMidi(midi);
      const degreeClass = degreeMeta?.colorEnabled ? ' step-play__chip--degree-color' : '';
      const outClass = label.outOfScale ? ' step-play__chip--out' : '';
      const degreeStyle = degreeMeta?.colorEnabled
        ? ` style="--degree-color: ${this._escapeAttr(degreeMeta.color)}; --degree-intensity: ${this._escapeAttr(degreeMeta.intensityPercent)};"`
        : '';
      return `
        <span class="step-play__chip${degreeClass}${outClass}${isCurrent ? ' is-current' : ''}"${degreeStyle} data-step-chip="${step}">
          <span>${step + 1}</span>
          <small>${this._escapeHtml(note.display)}</small>
          ${label.outOfScale ? '<b class="step-play__out-badge">OUT</b>' : ''}
          ${alternate ? `<em>⇄ ${this._escapeHtml(alternate.note.display)}${alternate.outOfScale ? ' <b class="step-play__out-badge">OUT</b>' : ''}</em>` : ''}
        </span>
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
    if (this.padMode === 'compass' || this.padMode === 'step') {
      this._refreshLayout();
      return;
    }
    this._updateNotes();
    const padsContainer = this.el.querySelector('#sb-pads');
    if (!padsContainer) return;
    padsContainer.style.gridTemplateColumns = this._gridColumns();
    padsContainer.innerHTML = this._renderPads();
    this._bindPadEvents();
  }

  _bindEvents() {
    // Octave controls
    this.el.querySelector('#sb-oct-down')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.shiftOctave(-1);
    });

    this.el.querySelector('#sb-oct-up')?.addEventListener('pointerdown', (e) => {
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
      } else if (this.padMode === 'compass') {
        showToast('Compass: major chords outside, relative minors inside');
      } else if (this.padMode === 'step') {
        showToast('Step Play: one trigger advances through the sequence');
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
      showToast(this.extensionsEnabled ? `Extensions: ${this._notes.length} scale pads` : 'Extensions off');
      if (this.onExtensionsChanged) this.onExtensionsChanged(this.extensionsEnabled);
    });

    // Edit Layout toggle
    this.el.querySelector('#sb-edit-layout')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.isEditingLayout = !this.isEditingLayout;
      this._refreshLayout();
    });

    this._bindVoiceEvents();
    this._bindStepPlayEvents();
    this._bindCompassEvents();
    this._bindPadEvents();
  }

  _bindStepPlayEvents() {
    if (this.padMode !== 'step') return;
    const trigger = this.el.querySelector('#sb-step-trigger');
    trigger?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.triggerStepPlay();
    });
    this.el.querySelector('#sb-step-edit')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._openStepEditor();
    });
    this.el.querySelector('#sb-step-reset')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._persistStepEntries(this._defaultStepEntries());
      this._refreshStepSequenceUi();
      showToast('Step Play sequence reset');
    });
  }

  _refreshStepSequenceUi() {
    if (this.padMode !== 'step') return;
    const sequence = this.el?.querySelector('#sb-step-sequence');
    if (!sequence) return;
    const active = this.el?.querySelector('#sb-step-trigger')?.classList.contains('is-active');
    sequence.innerHTML = this._renderStepChips();
    if (active) this.el?.querySelector('#sb-step-trigger')?.classList.add('is-active');
  }

  _openStepEditor() {
    this._closeStepEditor();
    this._stepEditorOctave = STEP_PLAY_DEFAULT_OCTAVE;
    this._stepEditorSequence = this._stepEntries().map(entry => ({ ...entry }));
    this._stepEditorAltTarget = null;
    this._stepEditorUndoStack = [];
    const overlay = document.createElement('div');
    overlay.className = 'step-editor-backdrop';
    overlay.innerHTML = this._renderStepEditor();
    document.body.appendChild(overlay);
    this._stepEditorOverlay = overlay;
    this._bindStepEditorEvents();
  }

  _closeStepEditor() {
    if (this._stepEditorKeyHandler) {
      document.removeEventListener('keydown', this._stepEditorKeyHandler, true);
      this._stepEditorKeyHandler = null;
    }
    this._stepEditorOverlay?.remove();
    this._stepEditorOverlay = null;
    this._stepEditorSequence = [];
    this._stepEditorAltTarget = null;
    this._stepEditorUndoStack = [];
  }

  _renderStepEditor() {
    return `
      <div class="step-editor" role="dialog" aria-modal="true" aria-label="Edit Step Play sequence">
        <div class="step-editor__header">
          <h2>Edit Sequence</h2>
          <p>Tap notes from the current scale to add them. Saved steps keep their exact pitch even if key, scale, or Pads octave changes later.</p>
        </div>
        <div class="step-editor__palette">
          <button class="btn btn--icon btn--ghost" id="step-editor-oct-down" type="button" aria-label="Lower note row">◀</button>
          <div class="step-editor__notes" id="step-editor-notes">${this._renderStepEditorNotes()}</div>
          <button class="btn btn--icon btn--ghost" id="step-editor-oct-up" type="button" aria-label="Higher note row">▶</button>
        </div>
        <div class="step-editor__sequence" id="step-editor-sequence">${this._renderStepEditorSequence()}</div>
        <div class="step-editor__actions">
          <button class="btn btn--ghost" id="step-editor-undo" type="button" disabled>Undo</button>
          <button class="btn btn--ghost" id="step-editor-clear" type="button">Clear</button>
          <button class="btn btn--ghost" id="step-editor-cancel" type="button">Cancel</button>
          <button class="btn btn--primary" id="step-editor-save" type="button">Save</button>
        </div>
      </div>
    `;
  }

  _renderStepEditorNotes() {
    const degreeCount = this._scaleDegreeCount();
    const notes = getScaleNotes(this.scaleName, this.rootNote, this._stepEditorOctave, degreeCount);
    return Array.from({ length: degreeCount }, (_, index) => {
      const degree = index + 1;
      const midi = notes[index];
      const note = midiToNoteName(midi);
      const degreeMeta = this._degreeMetaForMidi(midi);
      const degreeClass = degreeMeta?.colorEnabled ? ' step-editor__note--degree-color' : '';
      const degreeStyle = degreeMeta?.colorEnabled
        ? ` style="--degree-color: ${this._escapeAttr(degreeMeta.color)}; --degree-intensity: ${this._escapeAttr(degreeMeta.intensityPercent)};"`
        : '';
      return `
        <button class="step-editor__note${degreeClass}"${degreeStyle} type="button" data-degree="${degree}" data-midi="${midi}">
          <span>${this._escapeHtml(note.display)}</span>
          <small>${degree}</small>
        </button>
      `;
    }).join('');
  }

  _renderStepEditorSequence() {
    const entries = this._stepEditorSequence || [];
    if (!entries.length) return '<p class="step-editor__empty">Tap notes above to build the sequence.</p>';
    return entries.map((entry, index) => {
      const label = this._stepEntryLabel(entry);
      const { midi, note } = label;
      const alternate = entry.alternateMidi ? this._stepEntryLabel({ midi: entry.alternateMidi, degree: entry.alternateDegree }) : null;
      const pickingAlt = this._stepEditorAltTarget === index;
      const degreeMeta = this._degreeMetaForMidi(midi);
      const degreeClass = degreeMeta?.colorEnabled ? ' step-editor__seq-chip--degree-color' : '';
      const outClass = label.outOfScale ? ' step-editor__seq-chip--out' : '';
      const degreeStyle = degreeMeta?.colorEnabled
        ? ` style="--degree-color: ${this._escapeAttr(degreeMeta.color)}; --degree-intensity: ${this._escapeAttr(degreeMeta.intensityPercent)};"`
        : '';
      return `
        <div class="step-editor__seq-item${pickingAlt ? ' is-picking-alt' : ''}">
          <button class="step-editor__seq-chip${degreeClass}${outClass}"${degreeStyle} type="button" data-remove-step="${index}" title="Remove ${note.display}">
            <span>${index + 1}</span>
            <small>${this._escapeHtml(note.display)}</small>
            ${label.outOfScale ? '<b class="step-play__out-badge">OUT</b>' : ''}
            ${alternate ? `<em>⇄ ${this._escapeHtml(alternate.note.display)}${alternate.outOfScale ? ' <b class="step-play__out-badge">OUT</b>' : ''}</em>` : ''}
          </button>
          <button class="step-editor__seq-alt" type="button" data-alt-step="${index}">
            ${pickingAlt ? 'Pick note' : alternate ? 'Change alt' : 'Alt'}
          </button>
          ${alternate ? `<button class="step-editor__seq-clear-alt" type="button" data-clear-alt="${index}" aria-label="Clear alternate">Clear</button>` : ''}
        </div>
      `;
    }).join('');
  }

  _bindStepEditorEvents() {
    const overlay = this._stepEditorOverlay;
    if (!overlay) return;
    const syncSequence = () => this._refreshStepEditorSequence();
    overlay.querySelector('#step-editor-cancel')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._closeStepEditor();
    });
    overlay.querySelector('#step-editor-undo')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._undoStepEditor();
    });
    overlay.querySelector('#step-editor-save')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._persistStepEntries(this._stepEditorSequence);
      this._refreshStepSequenceUi();
      this._closeStepEditor();
      showToast('Step Play sequence updated');
    });
    overlay.querySelector('#step-editor-clear')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._pushStepEditorUndo();
      this._stepEditorSequence = [];
      this._stepEditorAltTarget = null;
      syncSequence();
    });
    overlay.querySelector('#step-editor-oct-down')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._stepEditorOctave = Math.max(STEP_PLAY_MIN_OCTAVE, this._stepEditorOctave - 1);
      overlay.querySelector('#step-editor-notes').innerHTML = this._renderStepEditorNotes();
      this._bindStepEditorNoteEvents();
    });
    overlay.querySelector('#step-editor-oct-up')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._stepEditorOctave = Math.min(STEP_PLAY_MAX_OCTAVE, this._stepEditorOctave + 1);
      overlay.querySelector('#step-editor-notes').innerHTML = this._renderStepEditorNotes();
      this._bindStepEditorNoteEvents();
    });
    const esc = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
      }
    };
    this._stepEditorKeyHandler = esc;
    document.addEventListener('keydown', this._stepEditorKeyHandler, true);
    this._bindStepEditorNoteEvents();
    this._bindStepEditorRemoveEvents();
    this._syncStepEditorUndoButton();
  }

  _refreshStepEditorSequence() {
    const target = this._stepEditorOverlay?.querySelector('#step-editor-sequence');
    if (!target) return;
    target.innerHTML = this._renderStepEditorSequence();
    this._bindStepEditorRemoveEvents();
    this._syncStepEditorUndoButton();
  }

  _pushStepEditorUndo() {
    const snapshot = {
      sequence: this._stepEditorSequence.map(entry => ({ ...entry })),
      altTarget: this._stepEditorAltTarget,
    };
    this._stepEditorUndoStack.push(snapshot);
    if (this._stepEditorUndoStack.length > 10) this._stepEditorUndoStack.shift();
    this._syncStepEditorUndoButton();
  }

  _undoStepEditor() {
    const previous = this._stepEditorUndoStack.pop();
    if (!previous) return;
    this._stepEditorSequence = previous.sequence.map(entry => ({ ...entry }));
    this._stepEditorAltTarget = previous.altTarget;
    this._refreshStepEditorSequence();
  }

  _syncStepEditorUndoButton() {
    const button = this._stepEditorOverlay?.querySelector('#step-editor-undo');
    if (button) button.disabled = this._stepEditorUndoStack.length === 0;
  }

  _bindStepEditorNoteEvents() {
    const overlay = this._stepEditorOverlay;
    if (!overlay) return;
    overlay.querySelectorAll('[data-degree]').forEach(button => {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const degree = this._normalizeStepDegree(button.dataset.degree);
        if (!degree) return;
        const nextEntry = this._entryForStepMidi(button.dataset.midi, degree);
        if (!nextEntry) return;
        this._pushStepEditorUndo();
        if (Number.isInteger(this._stepEditorAltTarget) && this._stepEditorSequence[this._stepEditorAltTarget]) {
          this._stepEditorSequence[this._stepEditorAltTarget].alternateDegree = nextEntry.degree;
          this._stepEditorSequence[this._stepEditorAltTarget].alternateMidi = nextEntry.midi;
          this._stepEditorAltTarget = null;
        } else {
          this._stepEditorSequence.push(nextEntry);
        }
        this._refreshStepEditorSequence();
      });
    });
  }

  _bindStepEditorRemoveEvents() {
    const overlay = this._stepEditorOverlay;
    if (!overlay) return;
    overlay.querySelectorAll('[data-remove-step]').forEach(button => {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const removeIndex = parseInt(button.dataset.removeStep, 10);
        this._pushStepEditorUndo();
        this._stepEditorSequence.splice(removeIndex, 1);
        if (this._stepEditorAltTarget === removeIndex) this._stepEditorAltTarget = null;
        else if (this._stepEditorAltTarget > removeIndex) this._stepEditorAltTarget -= 1;
        this._refreshStepEditorSequence();
      });
    });
    overlay.querySelectorAll('[data-alt-step]').forEach(button => {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(button.dataset.altStep, 10);
        this._stepEditorAltTarget = this._stepEditorAltTarget === index ? null : index;
        this._refreshStepEditorSequence();
      });
    });
    overlay.querySelectorAll('[data-clear-alt]').forEach(button => {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(button.dataset.clearAlt, 10);
        this._pushStepEditorUndo();
        if (this._stepEditorSequence[index]) delete this._stepEditorSequence[index].alternateDegree;
        if (this._stepEditorAltTarget === index) this._stepEditorAltTarget = null;
        this._refreshStepEditorSequence();
      });
    });
  }

  _bindCompassEvents() {
    if (this.padMode !== 'compass') return;
    const segments = this.el.querySelectorAll('.tonal-compass__segment');
    segments.forEach(segment => {
      const id = segment.dataset.compassId;
      const index = parseInt(segment.dataset.compassIndex, 10);
      const quality = segment.dataset.compassQuality;
      segment.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        segment.setPointerCapture(e.pointerId);
        this.pressCompassSegment(id, index, quality);
      });
      const release = (e) => {
        e.preventDefault();
        this.releaseCompassSegment(id);
      };
      segment.addEventListener('pointerup', release);
      segment.addEventListener('pointercancel', release);
      segment.addEventListener('pointerleave', release);
    });
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
    const recipe = this._curatedChordRecipe(startIndex);
    if (recipe) {
      const rootMidi = noteNameToMidi(this.rootNote, this.octave);
      return recipe.semitones.map(offset => rootMidi + offset);
    }

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
        this._cancelDwell(`pad:${i}`);
        
        if (this.isEditingLayout) {
          // Toggle custom type
          this.customPadTypes[i] = this.customPadTypes[i] === 'single' ? 'chord' : 'single';
          this._refreshPads();
          return;
        }

        const learnTarget = this._controllerLearnTargetForPad(i, midi);
        if (learnTarget && this._onControllerLearnTarget?.(learnTarget)) return;
        if (!tremorAllows(this.project, `scale:${this.padMode}:${i}`)) return;

        pad.setPointerCapture(e.pointerId);
        this.pressPad(i);
      });

      pad.addEventListener('pointerenter', () => {
        this._startDwell(`pad:${i}`, pad, () => {
          if (this.isEditingLayout) return;
          if (!tremorAllows(this.project, `scale:${this.padMode}:${i}`)) return;
          this._dwellActivePads.add(i);
          this.pressPad(i);
        });
      });

      pad.addEventListener('pointerleave', () => {
        this._cancelDwell(`pad:${i}`);
        if (this._dwellActivePads.has(i)) this.releasePad(i);
      });

      const handleRelease = (e) => {
        e.preventDefault();
        if (this.isEditingLayout) return;

        this.releasePad(i);
        this._dwellActivePads.delete(i);
      };

      // Pointer up → note off
      pad.addEventListener('pointerup', handleRelease);

      // Pointer cancel/leave → note off
      pad.addEventListener('pointercancel', handleRelease);
    });
  }

  _startDwell(key, el, onComplete) {
    const settings = dwellSettings(this.project);
    if (!settings.enabled) return;
    this._cancelDwell(key);
    el.classList.add('is-dwelling');
    el.style.setProperty('--dwell-ms', `${settings.thresholdMs}ms`);
    const timer = setTimeout(() => {
      this._dwellTimers.delete(key);
      el.classList.remove('is-dwelling');
      onComplete?.();
    }, settings.thresholdMs);
    this._dwellTimers.set(key, { timer, el });
  }

  _cancelDwell(key) {
    const entry = this._dwellTimers.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.el?.classList.remove('is-dwelling');
    this._dwellTimers.delete(key);
  }

  pressCompassSegment(id, index, quality) {
    if (!id || this._activeCompassChords.has(id)) return;
    const segment = this.el?.querySelector(`.tonal-compass__segment[data-compass-id="${id}"]`);
    const roots = this._circleRoots();
    const rootName = roots[index];
    if (!segment || !rootName) return;

    const rootMidi = quality === 'minor'
      ? noteNameToMidi(NOTE_NAMES[(NOTE_NAMES.indexOf(rootName) + 9) % 12], this.octave)
      : noteNameToMidi(rootName, this.octave);
    const midis = quality === 'minor'
      ? [rootMidi, rootMidi + 3, rootMidi + 7]
      : [rootMidi, rootMidi + 4, rootMidi + 7];

    segment.classList.add('is-active');
    this._activeCompassChords.set(id, midis);
    midis.forEach(midi => this._noteOn(midi));
  }

  releaseCompassSegment(id) {
    if (!id || !this._activeCompassChords.has(id)) return;
    const segment = this.el?.querySelector(`.tonal-compass__segment[data-compass-id="${id}"]`);
    if (segment) segment.classList.remove('is-active');
    const midis = this._activeCompassChords.get(id) || [];
    midis.forEach(midi => this._noteOff(midi));
    this._activeCompassChords.delete(id);
  }

  pressPad(index) {
    if (this.padMode === 'step') {
      this.triggerStepPlay();
      return;
    }
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

  pressControllerPadBinding(bindingKey, binding = {}) {
    if (!bindingKey || this._activeControllerPadBindings.has(bindingKey)) return true;
    if (this.padMode === 'voices') return false;
    const index = Number(binding.padIndex);
    const pad = this.el?.querySelector(`.scaleboard__pad[data-index="${index}"]`);
    const midi = this._notes[index];
    if (!pad || midi === undefined) return false;

    const action = binding.padAction || this._padActionFromMode(binding.padMode);
    let midis;
    if (action === 'chord') {
      midis = this._getChordMidis(index);
    } else if (action === 'root') {
      const rootMidi = this._rootMidiNear(midi);
      midis = rootMidi === midi ? [midi] : [midi, rootMidi];
    } else {
      midis = [midi];
    }

    pad.classList.add('is-active', `is-controller-${action}`);
    this._activeControllerPadBindings.set(bindingKey, { index, midis, action });
    midis.forEach(m => this._noteOn(m));
    return true;
  }

  releaseControllerPadBinding(bindingKey) {
    const active = this._activeControllerPadBindings.get(bindingKey);
    if (!active) return;
    active.midis.forEach(m => this._noteOff(m));
    this._activeControllerPadBindings.delete(bindingKey);
    const pad = this.el?.querySelector(`.scaleboard__pad[data-index="${active.index}"]`);
    pad?.classList.remove('is-controller-single', 'is-controller-chord', 'is-controller-root');
    if (!this._activePadIndexes.has(active.index) && !this._hasActiveControllerPadIndex(active.index)) {
      pad?.classList.remove('is-active');
    }
  }

  pressMidiInput(midi, bindingKey = `midi-${midi}`) {
    if (this.padMode === 'voices') return false;
    if (this.padMode === 'step') {
      this.triggerStepPlay();
      return false;
    }
    const index = this._nearestPadIndexForMidi(midi);
    if (index < 0) return false;
    const padMidi = this._notes[index];
    return this.pressControllerPadBinding(bindingKey, {
      type: 'scalePad',
      padIndex: index,
      midi: padMidi,
      padMode: this.padMode,
      padAction: this._padActionForIndex(index),
    });
  }

  _nearestPadIndexForMidi(midi) {
    if (!this._notes.length || !Number.isFinite(midi)) return -1;
    let bestIndex = 0;
    let bestDistance = Infinity;
    this._notes.forEach((padMidi, index) => {
      const distance = Math.abs(padMidi - midi);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  _controllerLearnTargetForPad(index, midi) {
    if (this.padMode === 'voices') return null;
    const padAction = this._padActionForIndex(index);
    const isChord = padAction === 'chord';
    const isRootMode = padAction === 'root';
    const kind = isChord ? 'Chord' : isRootMode ? 'Root' : 'Pad';
    return {
      type: 'scalePad',
      padIndex: index,
      midi,
      padMode: this.padMode,
      padAction,
      label: `${kind} ${index + 1}`,
      source: 'scale',
    };
  }

  _padActionForIndex(index) {
    if (this.padMode === 'chords' || (this.padMode === 'custom' && this.customPadTypes[index] === 'chord')) return 'chord';
    if (this.padMode === 'root') return 'root';
    return 'single';
  }

  _padActionFromMode(mode) {
    if (mode === 'chords') return 'chord';
    if (mode === 'root') return 'root';
    return 'single';
  }

  _hasActiveControllerPadIndex(index) {
    for (const active of this._activeControllerPadBindings.values()) {
      if (active.index === index) return true;
    }
    return false;
  }

  releasePad(index) {
    if (this.padMode === 'step') return;
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
      if (this._onBeforeNoteOn) this._onBeforeNoteOn();
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
    for (const key of [...this._dwellTimers.keys()]) this._cancelDwell(key);
    this._dwellActivePads.clear();
    this._releaseStepPlay();
    [...this._activePadIndexes].forEach(index => this.releasePad(index));
    [...this._activeCompassChords.keys()].forEach(id => this.releaseCompassSegment(id));
    if (this.voiceEngine) {
      // Defensive: stop anything still ringing in voice engine.
      this.voiceEngine.releaseAll();
      this._lastVoiceMidiByPad.clear();
    }
  }

  triggerStepPlay() {
    if (this.padMode !== 'step') return false;
    const sequence = this._stepEntries();
    if (!sequence.length) return false;
    const step = this._stepPointer % sequence.length;
    const entry = sequence[step];
    const useAlternate = this._stepLoopIndex % 2 === 1 && Number.isInteger(entry.alternateMidi);
    const midi = useAlternate ? entry.alternateMidi : entry.midi;
    if (midi === undefined) return false;

    this._releaseStepPlay();
    if (step >= sequence.length - 1) {
      this._stepPointer = 0;
      this._stepLoopIndex += 1;
    } else {
      this._stepPointer = step + 1;
    }
    this._activeStepMidis = [midi];
    this.el?.querySelector('#sb-step-trigger')?.classList.add('is-active');
    this._noteOn(midi);
    this._refreshStepSequenceUi();

    this._stepReleaseTimer = setTimeout(() => {
      this._releaseStepPlay();
      this._refreshStepSequenceUi();
    }, 420);
    return true;
  }

  _releaseStepPlay() {
    if (this._stepReleaseTimer) {
      clearTimeout(this._stepReleaseTimer);
      this._stepReleaseTimer = null;
    }
    if (this._activeStepMidis.length) {
      this._activeStepMidis.forEach(midi => this._noteOff(midi));
      this._activeStepMidis = [];
    }
    this.el?.querySelector('#sb-step-trigger')?.classList.remove('is-active');
  }

  shiftOctave(delta) {
    const next = Math.max(1, Math.min(6, this.octave + delta));
    if (next === this.octave) return;
    this.releaseAllPads();
    this.octave = next;
    this.el?.querySelector('#sb-oct-display')?.replaceChildren(`Oct ${this.octave}`);
    if (this.el) this._refreshPads();
  }

  _noteOn(midi) {
    if (this._onBeforeNoteOn) this._onBeforeNoteOn();
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
