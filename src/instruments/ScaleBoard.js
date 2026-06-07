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
 *
 * Octave shifts apply uniformly across modes. In voices mode, octave shifts move
 * the voiced source's pitch but leave the syllable's formants alone — that's how
 * a low and a high voice singing "ah" both sound like "ah."
 */

import { CIRCLE_OF_FIFTHS, degreeForMidi, getScaleNotes, midiToNoteName, normalizeDegreeHighlighting, normalizeMusicalContext, noteNameToMidi, SCALES, NOTE_NAMES } from '../engine/MusicTheory.js';
import { scaleChordRecipes } from '../engine/ScaleChords.js';
import { activeProgressionResolution, normalizeProgressionGlow } from '../engine/Progressions.js';
import { icon } from '../ui/icons.js';
import { normalizePadLayout, normalizePadMode, recommendedPadColumns } from '../engine/PadLayout.js';
import { velocityFromPointer, HEIGHT_VELOCITY_ZONES } from '../engine/HeightVelocity.js';
import { showToast } from '../ui/Toast.js';
import { dwellSettings, tremorAllows } from '../ui/AccessibilityProfiles.js';
import './heightVelocity.css';
import { ScaleBoardStepPlayMixin } from './scaleBoardStepPlay.js';
import { ScaleBoardVoiceMixin } from './scaleBoardVoice.js';

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
    this.padMode = 'single'; // 'single', 'chords', 'root', 'compass', 'step', 'voices'
    this.extensionsEnabled = false;
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
        this._applyPadGridLayout();
      }
    };
    
    // Now that state is initialized, set the project to trigger updates
    this.project = project;

    window.addEventListener('settings-pads-changed', (e) => {
      this._updateNotes();
      this._refreshPads();
    });
    window.addEventListener('project-progression-changed', () => {
      if (this.el) this._refreshPads();
    });
  }

  set project(p) {
    this._project = p;
    this.padMode = normalizePadMode(this.padMode, { voiceAvailable: !!this.voiceEngine });
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
  _updateNotes() {
    this._fullScaleNotes = getScaleNotes(this.scaleName, this.rootNote, this.octave);

    if (this.padMode === 'root') {
      this._notes = NOTE_NAMES.map(note => noteNameToMidi(note, this.octave));
    } else if (this.padMode === 'chords' && this._curatedChordRecipes()) {
      const rootMidi = noteNameToMidi(this.rootNote, this.octave);
      this._notes = this._curatedChordRecipes().map(recipe => rootMidi + (recipe.semitones?.[0] || 0));
    } else {
      const scaleDef = SCALES[this.scaleName];
      const degreeCount = scaleDef ? scaleDef.intervals.length : 7;
      const count = this._usesExtensions()
        ? (degreeCount === 7 ? 13 : degreeCount * 2)
        : degreeCount;
      this._notes = this._fullScaleNotes.slice(0, Math.min(count, this._fullScaleNotes.length));
    }
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
          </select>
        </div>
        ${this.padMode !== 'step' ? `<div class="scaleboard__octave">
          <button class="btn btn--icon btn--ghost scaleboard__oct-btn" id="sb-oct-down" aria-label="Octave down">${icon('chevronDown', { size: 18 })}</button>
          <span class="scaleboard__oct-display" id="sb-oct-display">Oct ${this.octave}</span>
          <button class="btn btn--icon btn--ghost scaleboard__oct-btn" id="sb-oct-up" aria-label="Octave up">${icon('chevronUp', { size: 18 })}</button>
        </div>` : '<div class="scaleboard__octave scaleboard__octave--hidden" aria-hidden="true"></div>'}
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
        : `<div class="scaleboard__pads${this._padGridMetrics().compact ? ' scaleboard__pads--compact' : ''}${this._heightVelocityActive() ? ' scaleboard__pads--velocity' : ''}" id="sb-pads" style="${this._padGridStyle()}">
            ${this._renderPads()}
          </div>`}
    `;

    this._bindEvents();
    window.addEventListener('resize', this._onResize);
    return this.el;
  }

  _padGridStyle() {
    const { cols, gap, compact } = this._padGridMetrics();
    return `--pad-cols: ${cols}; --pad-gap: ${gap};${compact ? ' --pad-compact: 1;' : ''}`;
  }

  _padGridMetrics() {
    const container = this.el?.querySelector('#sb-pads');
    const count = Math.max(1, this._notes.length || 1);
    const width = container?.clientWidth || 360;
    const layout = normalizePadLayout(this.project?.settings?.padLayout, count);
    const cols = recommendedPadColumns(count, width, { template: layout.template });
    return {
      cols,
      compact: cols < 4,
      gap: this._gridGap(),
    };
  }

  _applyPadGridLayout() {
    const container = this.el?.querySelector('#sb-pads');
    if (!container) return;
    const { cols, gap, compact } = this._padGridMetrics();
    container.style.setProperty('--pad-cols', String(cols));
    container.style.setProperty('--pad-gap', gap);
    container.classList.toggle('scaleboard__pads--compact', compact);
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
    const layout = normalizePadLayout(this.project?.settings?.padLayout, this._notes.length);
    const velGrid = this._heightVelocityActive() ? this._velocityGridlinesMarkup() : '';
    return this._notes.map((midi, i) => {
      const noteInfo = midiToNoteName(midi);
      const curatedChord = this._curatedChordRecipe(i);
      const isRootMode = this.padMode === 'root';
      const rootMidi = isRootMode ? this._rootMidiNear(midi) : midi;
      const rootInfo = midiToNoteName(rootMidi);
      let isChord = this.padMode === 'chords';
      const padSize = layout.pads[i]?.size || 'small';
      const degree = i + 1;
      let typeLabel = isRootMode ? `+ ${rootInfo.display}` : (curatedChord?.name || (isChord ? 'Chord' : 'Note'));
      const isVoice = this.padMode === 'voices';
      const voiceLabel = isVoice ? this._previewSyllableForPad(i) : null;
      const voiceClass = isVoice ? ' scaleboard__pad--voice' : '';
      const degreeMeta = this._degreeMetaForMidi(midi);
      const progressionMeta = this._progressionMetaForMidi(midi, degreeMeta);
      const degreeClass = degreeMeta
        ? `${degreeMeta.colorEnabled ? ' scaleboard__pad--degree-color' : ''}${degreeMeta.functionName ? ' scaleboard__pad--degree-label' : ''}`
        : '';
      const progressionClass = progressionMeta ? ' scaleboard__pad--progression-hot' : '';
      const styleVars = [];
      if (degreeMeta) {
        styleVars.push(`--degree-color: ${this._escapeAttr(degreeMeta.color)}`);
        styleVars.push(`--degree-intensity: ${this._escapeAttr(degreeMeta.intensityPercent)}`);
      }
      if (progressionMeta) {
        styleVars.push(`--progression-color: ${this._escapeAttr(progressionMeta.color)}`);
        styleVars.push(`--progression-intensity: ${this._escapeAttr(progressionMeta.intensityPercent)}`);
      }
      const padStyle = styleVars.length ? ` style="${styleVars.join('; ')};"` : '';
      const degreeLabel = degreeMeta?.functionName || '';
      const theoryLabel = degreeMeta?.functionName
        ? `, ${degreeMeta.functionName}${degreeMeta.shorthand ? ` (${degreeMeta.shorthand})` : ''}`
        : '';
      return `
        <button class="scaleboard__pad${voiceClass}${degreeClass}${progressionClass}"${padStyle} data-size="${this._escapeAttr(padSize)}" data-index="${i}" data-midi="${midi}"
                aria-label="${isRootMode ? `${noteInfo.display} plus nearest ${this.rootNote}, ${rootInfo.display}` : curatedChord ? `${curatedChord.label} chord, ${curatedChord.name}` : `Scale degree ${degree}, ${noteInfo.display}`}${theoryLabel}${voiceLabel ? ', sings ' + voiceLabel : ''}">
          ${velGrid}<span class="scaleboard__pad-degree">${isRootMode ? noteInfo.name : (curatedChord?.label || degree)}</span>
          <span class="scaleboard__pad-note">${noteInfo.display}</span>
          ${degreeLabel ? `<span class="scaleboard__pad-degree-name">${this._escapeHtml(degreeLabel)}</span>` : ''}
          ${(isRootMode || curatedChord) ? `<span class="scaleboard__pad-type">${this._escapeHtml(typeLabel)}</span>` : ''}
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

  _progressionMetaForMidi(midi, degreeMeta = null) {
    const glow = normalizeProgressionGlow(this.project?.settings?.progressionGlow);
    if (!glow.enabled) return null;
    const active = activeProgressionResolution(this.project?.progression, this.project?.musicalContext);
    if (!active?.pitchClasses?.length) return null;
    const pitchClass = ((midi % 12) + 12) % 12;
    if (!active.pitchClasses.includes(pitchClass)) return null;
    return {
      color: degreeMeta?.color || '#79c8ff',
      intensityPercent: `${Math.round(glow.intensity * 100)}%`,
      degree: active.degree,
    };
  }

  /** What syllable would the next pad press sing? */
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
    this._applyPadGridLayout();
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
      this.padMode = normalizePadMode(e.target.value, { voiceAvailable: !!this.voiceEngine });
      // When entering voices mode, ensure tokens reflect the latest bank/phrase.
      if (this.padMode === 'voices') {
        this._recomputeVoiceTokens();
      }
      this._refreshLayout();
      if (this.padMode === 'root') {
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

    this._bindVoiceEvents();
    this._bindStepPlayEvents();
    this._bindCompassEvents();
    this._bindPadEvents();
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

        const learnTarget = this._controllerLearnTargetForPad(i, midi);
        if (learnTarget && this._onControllerLearnTarget?.(learnTarget)) return;
        if (!tremorAllows(this.project, `scale:${this.padMode}:${i}`)) return;

        pad.setPointerCapture(e.pointerId);
        const velocity = this._heightVelocityActive() ? (velocityFromPointer(e, pad) ?? 0.8) : 0.8;
        this.pressPad(i, velocity);
      });

      pad.addEventListener('pointerenter', () => {
        this._startDwell(`pad:${i}`, pad, () => {
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

  pressPad(index, velocity = 0.8) {
    if (this.padMode === 'step') {
      this.triggerStepPlay();
      return;
    }
    if (this._activePadIndexes.has(index)) return;
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
      midis.forEach(m => this._noteOn(m, velocity));
      return;
    }

    const isChord = this.padMode === 'chords';
    if (isChord) {
      const chordMidis = this._getChordMidis(index);
      this._activeChords.set(index, chordMidis);
      chordMidis.forEach(m => this._noteOn(m, velocity));
    } else {
      this._noteOn(midi, velocity);
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
    if (Array.isArray(binding.midis) && binding.midis.some(Number.isFinite)) {
      midis = [...new Set(binding.midis.filter(Number.isFinite))];
    }

    const visualAction = action === 'single' && midis.length > 1 ? 'chord' : action;
    pad.classList.add('is-active', `is-controller-${visualAction}`);
    this._activeControllerPadBindings.set(bindingKey, { index, midis, action: visualAction });
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
    if (this.padMode === 'chords') return 'chord';
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

  shiftOctave(delta) {
    const next = Math.max(1, Math.min(6, this.octave + delta));
    if (next === this.octave) return;
    this.releaseAllPads();
    this.octave = next;
    this.el?.querySelector('#sb-oct-display')?.replaceChildren(`Oct ${this.octave}`);
    if (this.el) this._refreshPads();
  }

  _noteOn(midi, velocity = 0.8) {
    if (this._onBeforeNoteOn) this._onBeforeNoteOn();
    this.synth.noteOn(midi, velocity);
    this._activePads.add(midi);
    if (this._onNoteOn) this._onNoteOn(midi, velocity);
  }

  _heightVelocityActive() {
    const s = this.project?.settings || {};
    return s.padLayout?.template === 'velocity' || !!(s.labs && s.labs.heightVelocity);
  }

  _velocityGridlinesMarkup() {
    let html = '<span class="scaleboard__pad-velgrid" aria-hidden="true">';
    for (let z = 0; z < HEIGHT_VELOCITY_ZONES; z++) html += '<span class="scaleboard__pad-velzone"></span>';
    return `${html}</span>`;
  }

  _noteOff(midi) {
    this.synth.noteOff(midi);
    this._activePads.delete(midi);
    if (this._onNoteOff) this._onNoteOff(midi);
  }
}

Object.assign(ScaleBoard.prototype, ScaleBoardStepPlayMixin, ScaleBoardVoiceMixin);
