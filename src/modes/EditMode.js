/**
 * EditMode — Live Edit / Piano Roll.
 * Per-clip note editor for fine-tuning pitch, timing, duration, and velocity.
 * Supports click-to-add, drag-to-move, resize, delete, velocity editing,
 * vertical zoom, custom octave range, and split dual-pane view.
 */

import './edit.css';
import { pulseCountForMeter, ticksPerBarForMeter } from '../engine/Meter.js';
import { showToast } from '../ui/Toast.js';
import { ChoicePicker } from '../ui/ChoicePicker.js';
import { renderSnippetPreviewSVG } from '../ui/snippetPreview.js';
import { icon } from '../ui/icons.js';
import { PRESETS } from '../instruments/WebAudioSynth.js';
import { drumInstrumentGroups, midiInstrumentGroups, labelForInstrument } from './instrumentGroups.js';
import { DEFAULT_NOTE_HEIGHT, MIN_PIANO_OCTAVE, MAX_PIANO_OCTAVE } from './editConstants.js';
import { EditAudioPlayerMixin } from './editAudioPlayer.js';
import { EditRollMixin } from './editRoll.js';
import { EditNotesMixin } from './editNotes.js';
import { EditRhythmFitMixin } from './editRhythmFit.js';
import { EditEventsMixin } from './editEvents.js';
import { EditLyricsMixin } from './editLyrics.js';

export class EditMode {
  constructor(transport, undoManager, store, project) {
    this.transport = transport;
    this.undoManager = undoManager;
    this.store = store;
    this.project = project;
    this.el = null;

    this.onSnippetRenamed = null;
    this.onSnippetCreated = null;
    /** Fired whenever the loaded snippet changes. `main.js` uses this to
     * update the `PlaybackEngine`'s inspect source (or clear it). */
    this.onInspectSnippetChanged = null;
    /** Fired when the user picks a different patch/kit in the Inspect
     * toolbar for the open snippet. `main.js` uses this to re-arm the
     * PlaybackEngine's inspect synth/kit so the change is immediately
     * audible. */
    this.onInspectPatchChanged = null;
    /** Set by `main.js` — same data shape `SnippetTray.setSnippetUsageProvider` expects. */
    this._snippetUsageProvider = null;

    this._snippet = null;
    this._clipId = null;

    this._selectedNoteIdx = null;

    this._gridSize = 480;

    this._noteHeight = DEFAULT_NOTE_HEIGHT;
    this._pitchMin = 36;
    this._pitchMax = 84;
    this._pitchRangeInitialized = false;

    this._splitMode = false;

    this._panes = [];
    this._shadowSnippetId = '';
    this._rhythmFitPreviewState = null;
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'edit-mode';
    this.el.style.setProperty('--note-height', `${this._noteHeight}px`);

    if (!this._snippet) {
      this._renderEmpty();
    } else {
      this._renderEditor();
    }

    return this.el;
  }

  loadSnippet(snippet, clipId = null) {
    const snippetChanged = this._snippet?.id !== snippet?.id;
    // Stop any current inspect playback before swapping snippets, so audio
    // doesn't bleed across clips and the transport doesn't keep ticking.
    this._stopInspectPlayback();
    // Cancel the playhead rAF before wiping the DOM so the loop does not
    // continue to fire against detached elements.
    this._stopPlayheadAnimation?.();
    this._snippet = snippet;
    this._clipId = clipId;
    this._selectedNoteIdx = null;
    if (snippetChanged) this._pitchRangeInitialized = false;

    this.el.innerHTML = '';
    if (this._snippet) {
      if (this._snippet.type === 'audio') {
        this._renderAudioPlayer();
      } else {
        this._renderEditor();
      }
    } else {
      this._renderEmpty();
    }

    if (this.onInspectSnippetChanged) this.onInspectSnippetChanged(this._snippet);
  }

  /**
   * Stop any inspect-scoped playback that the editor started: pauses the
   * native audio element, stops the Transport, and clears the inspect source
   * on the PlaybackEngine via the `onInspectSnippetChanged` callback. Safe
   * to call when nothing is playing.
   */
  _stopInspectPlayback() {
    this.stopAudioPlayback?.();
    try { this.transport?.stop?.(); } catch { /* ignore */ }
  }

  /**
   * Pure helper exposed for tests. Writes the chosen instrument id onto
   * the snippet in the same shape `_stampRecordedPatch` (Create mode) and
   * `_applyRecordedInstrumentToTrack` (Canvas) already understand. Returns
   * `true` if the snippet was actually updated, `false` if the value was
   * missing or unchanged (no-op so the caller can avoid re-rendering).
   *
   * Side effects:
   *   - sets `snippet.instrumentId`
   *   - for MIDI: writes `snippet.patchRecorded = { instrumentId,
   *     patchSnapshot: deep-clone of PRESETS[instrumentId] || null,
   *     capturedAt }` so the WAV export pipeline can replay the
   *     recorded sound even if the user later changes the project
   *     defaults
   *   - for drum: writes `snippet.kitRecorded = { instrumentId,
   *     capturedAt }` (no snapshot — drum kits are not deep-cloned)
   *   - bumps `snippet.schemaVersion` to at least 2
   */
  _setSnippetInstrument(snippet, instrumentId) {
    if (!snippet || !instrumentId) return false;
    // No-op only when the snippet's recorded block already matches the
    // pick. A legacy snippet may have `instrumentId` set but no
    // `patchRecorded` / `kitRecorded` block — in that case we want to
    // write the block on the first pick, not skip it.
    const midiRecordedMatches = snippet.patchRecorded?.instrumentId === instrumentId;
    const drumRecordedMatches = snippet.kitRecorded?.instrumentId === instrumentId;
    if (snippet.instrumentId === instrumentId
      && (midiRecordedMatches || drumRecordedMatches)) {
      return false;
    }
    snippet.instrumentId = instrumentId;
    if (snippet.type === 'midi') {
      const preset = PRESETS[instrumentId];
      snippet.patchRecorded = {
        instrumentId,
        patchSnapshot: preset ? JSON.parse(JSON.stringify(preset)) : null,
        capturedAt: Date.now(),
      };
    } else if (snippet.type === 'drum') {
      snippet.kitRecorded = {
        instrumentId,
        capturedAt: Date.now(),
      };
    }
    snippet.schemaVersion = Math.max(snippet.schemaVersion || 1, 2);
    return true;
  }

  /**
   * Open the Patch / Kit picker for the open snippet. Wired from the
   * `#edit-patch-btn` click handler in `editEvents.js`. After the user
   * picks a value, writes the snippet state, persists, re-renders the
   * editor so the toolbar button label updates, dispatches
   * `project-snippets-changed` so the SnippetTray + Canvas refresh, and
   * fires `onInspectPatchChanged` so `main.js` can re-arm the
   * PlaybackEngine's inspect synth/kit.
   */
  _openPatchPicker() {
    if (!this._snippet || this._snippet.type === 'audio') return;
    const isDrum = this._snippet.type === 'drum';
    const groups = isDrum ? drumInstrumentGroups(this.project) : midiInstrumentGroups(this.project);
    const currentId = this._currentSnippetInstrumentId?.(isDrum) || null;
    const anchor = this.el?.querySelector('#edit-patch-btn');
    if (!anchor) return;
    const picker = new ChoicePicker({
      title: isDrum ? 'Choose drum kit' : 'Choose patch',
      groups,
      selectedValue: currentId || '',
      searchPlaceholder: isDrum ? 'Search kits...' : 'Search patches...',
      onSelect: (value) => {
        if (!this._snippet) return;
        const changed = this._setSnippetInstrument(this._snippet, value);
        if (!changed) return;
        this.store?.scheduleAutoSave(this.project);
        // Re-render so the toolbar label updates and any inspect-playback
        // state (cached notes, etc.) refreshes.
        this._stopInspectPlayback();
        this.loadSnippet(this._snippet, this._clipId);
        window.dispatchEvent(new CustomEvent('project-snippets-changed', {
          detail: { snippetId: this._snippet.id, action: 'updated' },
        }));
        this.onInspectPatchChanged?.(this._snippet);
        showToast(`${isDrum ? 'Kit' : 'Patch'}: ${labelForInstrument(value, this.project)}`);
      },
    });
    picker.open(anchor);
  }

  refreshSnippetList() {
    if (!this.el) return;
    // If the open snippet was deleted elsewhere, return to the browser.
    if (this._snippet && !this.project?.snippets?.some(s => s.id === this._snippet?.id)) {
      this.loadSnippet(null);
      return;
    }
    // If we're showing the browser, re-render its items to pick up changes.
    if (!this._snippet) {
      this._refreshBrowserItems();
    }
  }


  _escapeAttr(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  _escapeHtml(value = '') {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  _renderEmpty() {
    const snippets = (this.project?.snippets || []);
    const prefs = this._getBrowserPrefs();

    this.el.innerHTML = `
      <div class="edit-browser edit-browser--${prefs.view}">
        <div class="edit-browser__header">
          <div class="edit-browser__title">
            <h2 class="edit-browser__heading">Inspect</h2>
            <span class="edit-browser__count" id="edit-browser-count">${snippets.length}</span>
          </div>
          <p class="edit-browser__desc">Browse your snippets, open one to edit, or start a blank one.</p>
        </div>
        <div class="edit-browser__toolbar">
          <div class="edit-browser__toolbar-row">
            <input type="text" class="edit-browser__search" id="edit-browser-search" placeholder="Search snippets…" value="${this._escapeAttr(prefs.search || '')}" aria-label="Search snippets" />
            <div class="edit-browser__pills" role="tablist" aria-label="Filter by type">
              ${['all','midi','drum','audio'].map(type => `
                <button class="edit-browser__pill${prefs.filter === type ? ' is-active' : ''}" data-filter="${type}" type="button" role="tab" aria-selected="${prefs.filter === type}">${this._browserTypeLabel(type)}</button>
              `).join('')}
            </div>
          </div>
          <div class="edit-browser__toolbar-row">
            <label class="edit-browser__field">
              <span>Sort</span>
              <select class="edit-browser__select" id="edit-browser-sort" aria-label="Sort snippets">
                ${this._renderBrowserSortOptions(prefs.sort)}
              </select>
            </label>
            <div class="edit-browser__view" role="tablist" aria-label="View style">
              <button class="edit-browser__view-btn${prefs.view === 'list' ? ' is-active' : ''}" data-view="list" type="button" role="tab" aria-selected="${prefs.view === 'list'}" title="List view">${icon('list', { size: 16 })}</button>
              <button class="edit-browser__view-btn${prefs.view === 'grid' ? ' is-active' : ''}" data-view="grid" type="button" role="tab" aria-selected="${prefs.view === 'grid'}" title="Grid view">${icon('layoutGrid', { size: 16 })}</button>
            </div>
            <div class="edit-browser__spacer"></div>
            <button class="btn btn--ghost edit-toolbar__btn" id="edit-new-midi" type="button">New MIDI Clip</button>
            <button class="btn btn--ghost edit-toolbar__btn" id="edit-new-drum" type="button">New Drum Clip</button>
          </div>
        </div>
        <div class="edit-browser__items" id="edit-browser-items" role="list">
          ${this._renderBrowserItemsHtml()}
        </div>
      </div>
    `;

    this._bindBrowserEvents();
  }

  _browserTypeLabel(type) {
    return type === 'all' ? 'All' : type === 'midi' ? 'MIDI' : type === 'drum' ? 'Drum' : 'Audio';
  }

  _renderBrowserSortOptions(selected) {
    const opts = [
      { value: 'newest', label: 'Newest' },
      { value: 'oldest', label: 'Oldest' },
      { value: 'name', label: 'Name A–Z' },
      { value: 'type', label: 'Type' },
      { value: 'longest', label: 'Longest' },
      { value: 'mostUsed', label: 'Most used' },
    ];
    return opts.map(o => `<option value="${o.value}" ${o.value === selected ? 'selected' : ''}>${o.label}</option>`).join('');
  }

  _renderBrowserItemsHtml() {
    const prefs = this._getBrowserPrefs();
    const all = (this.project?.snippets || []).filter(Boolean);
    const filtered = this._filterBrowserSnippets(all, prefs);
    const sorted = this._sortBrowserSnippets(filtered, prefs);

    if (all.length === 0) {
      return `
        <div class="edit-browser__empty">
          <p class="edit-browser__empty-title">No snippets yet</p>
          <p class="edit-browser__empty-desc">Create a blank clip above, or record one in Create mode.</p>
        </div>
      `;
    }
    if (sorted.length === 0) {
      return `<div class="edit-browser__empty"><p class="edit-browser__empty-desc">No snippets match your search and filter.</p></div>`;
    }

    return sorted.map(s => this._renderBrowserItemHtml(s)).join('');
  }

  _renderBrowserItemHtml(s) {
    const noteCount = (s.notes?.length || 0) + (s.hits?.length || 0);
    const type = s.type === 'audio' ? 'audio' : s.type === 'drum' ? 'drum' : 'midi';
    const typeBadge = type === 'audio' ? 'AUDIO' : type === 'drum' ? 'DRUM' : 'MIDI';
    const autoMeta = type === 'audio'
      ? `Audio · ${(s.durationTicks * (this.transport?.secondsPerTick || (60 / 120 / 480))).toFixed(1)}s`
      : `${noteCount} ${type === 'drum' ? 'hits' : 'notes'}`;
    const bars = Math.ceil(s.durationTicks / ticksPerBarForMeter(s.meter || s.timeSignature, 480));
    const barsMeta = type === 'audio' ? '' : ` · ${bars} bar${bars > 1 ? 's' : ''}`;
    const displayName = s.name || autoMeta;
    const created = this._formatBrowserDate(s.createdAt);
    const usage = this._snippetUsageProvider?.(s.id);
    const usageBadge = usage?.label
      ? `<span class="edit-browser__badge" title="${this._escapeAttr(usage.title || usage.label)}">${this._escapeHtml(usage.label)}</span>`
      : '';
    const aiBadge = s.aiSeeded
      ? `<span class="edit-browser__badge edit-browser__badge--ai" title="${this._escapeAttr(s.aiPrompt || 'AI-seeded snippet')}">AI</span>`
      : '';

    return `
      <div class="edit-browser__item edit-browser__item--${type}${s.aiSeeded ? ' is-ai-seeded' : ''}" data-id="${this._escapeAttr(s.id)}" role="listitem" tabindex="0" aria-label="Open ${this._escapeAttr(displayName)}">
        <div class="edit-browser__item-preview">${renderSnippetPreviewSVG(s)}</div>
        <div class="edit-browser__item-info">
          <div class="edit-browser__item-line">
            <span class="edit-browser__item-type edit-browser__item-type--${type}">${typeBadge}</span>
            <span class="edit-browser__item-name">${this._escapeHtml(displayName)}</span>
            ${aiBadge}${usageBadge}
          </div>
          <div class="edit-browser__item-meta">${autoMeta}${barsMeta} · ${created}</div>
        </div>
        <div class="edit-browser__item-actions">
          <button class="edit-browser__action-btn edit-browser__delete-btn" data-delete="${this._escapeAttr(s.id)}" type="button" aria-label="Delete ${this._escapeAttr(displayName)}" title="Delete">${icon('x', { size: 14 })}</button>
        </div>
      </div>
    `;
  }

  _formatBrowserDate(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  _filterBrowserSnippets(snippets, prefs) {
    const search = (prefs.search || '').trim().toLowerCase();
    return snippets.filter(s => {
      if (prefs.filter && prefs.filter !== 'all' && s.type !== prefs.filter) return false;
      if (!search) return true;
      const name = (s.name || '').toLowerCase();
      if (name.includes(search)) return true;
      const noteCount = (s.notes?.length || 0) + (s.hits?.length || 0);
      const autoMeta = s.type === 'audio'
        ? 'audio'
        : `${noteCount} ${s.type === 'drum' ? 'hits' : 'notes'}`;
      return autoMeta.includes(search);
    });
  }

  _sortBrowserSnippets(snippets, prefs) {
    const cmp = (a, b) => {
      switch (prefs.sort) {
        case 'oldest':
          return (a.createdAt || 0) - (b.createdAt || 0);
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'type': {
          const order = { midi: 0, drum: 1, audio: 2 };
          return (order[a.type] ?? 9) - (order[b.type] ?? 9)
            || (a.name || '').localeCompare(b.name || '');
        }
        case 'longest':
          return (b.durationTicks || 0) - (a.durationTicks || 0);
        case 'mostUsed': {
          const ua = this._snippetUsageProvider?.(a.id);
          const ub = this._snippetUsageProvider?.(b.id);
          const na = this._parseUsageCount(ua?.label) || 0;
          const nb = this._parseUsageCount(ub?.label) || 0;
          if (nb !== na) return nb - na;
          return (b.createdAt || 0) - (a.createdAt || 0);
        }
        case 'newest':
        default:
          return (b.createdAt || 0) - (a.createdAt || 0);
      }
    };
    return [...snippets].sort(cmp);
  }

  _parseUsageCount(label) {
    if (!label) return 0;
    const m = /(\d+)/.exec(label);
    return m ? Number(m[1]) : 0;
  }

  _getBrowserPrefs() {
    const defaults = { sort: 'newest', filter: 'all', view: 'list', search: '' };
    if (!this.project) return defaults;
    if (!this.project.settings) this.project.settings = {};
    const stored = this.project.settings.inspectBrowser || {};
    return { ...defaults, ...stored };
  }

  _setBrowserPrefs(partial) {
    if (!this.project) return;
    if (!this.project.settings) this.project.settings = {};
    if (!this.project.settings.inspectBrowser) this.project.settings.inspectBrowser = {};
    Object.assign(this.project.settings.inspectBrowser, partial);
    this.store?.scheduleAutoSave(this.project);
  }

  _bindBrowserEvents() {
    const search = this.el.querySelector('#edit-browser-search');
    search?.addEventListener('input', (e) => {
      this._setBrowserPrefs({ search: e.target.value });
      this._refreshBrowserItems();
    });

    this.el.querySelectorAll('.edit-browser__pill').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.el.querySelectorAll('.edit-browser__pill').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        this.el.querySelectorAll('.edit-browser__pill').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
        this._setBrowserPrefs({ filter: btn.dataset.filter });
        this._refreshBrowserItems();
      });
    });

    const sort = this.el.querySelector('#edit-browser-sort');
    sort?.addEventListener('change', (e) => {
      this._setBrowserPrefs({ sort: e.target.value });
      this._refreshBrowserItems();
    });

    this.el.querySelectorAll('.edit-browser__view-btn').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.el.querySelectorAll('.edit-browser__view-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        this.el.querySelectorAll('.edit-browser__view-btn').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
        const view = btn.dataset.view;
        this._setBrowserPrefs({ view });
        this.el.querySelector('.edit-browser')?.classList.remove('edit-browser--list', 'edit-browser--grid');
        this.el.querySelector('.edit-browser')?.classList.add(`edit-browser--${view}`);
      });
    });

    this.el.querySelector('#edit-new-midi')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._createBlankSnippet('midi');
    });
    this.el.querySelector('#edit-new-drum')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._createBlankSnippet('drum');
    });

    this._bindBrowserItemEvents();
  }

  _bindBrowserItemEvents() {
    const itemsContainer = this.el.querySelector('#edit-browser-items');
    if (!itemsContainer) return;
    itemsContainer.querySelectorAll('.edit-browser__item').forEach(item => {
      item.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.edit-browser__action-btn')) return;
        // Defer to pointerup so drags don't open a clip.
        const startX = e.clientX, startY = e.clientY;
        const onUp = (ue) => {
          item.removeEventListener('pointerup', onUp);
          if (Math.abs(ue.clientX - startX) < 5 && Math.abs(ue.clientY - startY) < 5) {
            this._loadSnippetById(item.dataset.id);
          }
        };
        item.addEventListener('pointerup', onUp);
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          // stopPropagation: opening a clip via Space/Enter must not also
          // fire the document-level keydown handler in main.js. Without
          // this, pressing Space on a focused browser item runs
          // _loadSnippetById (which sets _inspectSnippet) and then bubbles
          // to the document handler, which calls _handlePlayToggle and
          // starts transport — surprising behavior that contradicts the
          // "click opens, no auto-play" convention. Stopping the event
          // matches the pointer-click path exactly: the next Space (or
          // play-button click) starts the snippet.
          e.stopPropagation();
          this._loadSnippetById(item.dataset.id);
        }
      });
    });
    itemsContainer.querySelectorAll('.edit-browser__delete-btn').forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._deleteBrowserSnippet(btn.dataset.delete);
      });
    });
  }

  _deleteBrowserSnippet(id) {
    const snippet = (this.project?.snippets || []).find(s => s.id === id);
    if (!snippet) return;
    const usage = this._snippetUsageProvider?.(id);
    if (usage?.blocked) {
      usage.onBlocked?.(usage);
      return;
    }
    const name = String(snippet.name || 'this snippet').slice(0, 80);
    if (!window.confirm(`Delete "${name}"? This also removes it from Canvas.`)) return;

    if (this.project && Array.isArray(this.project.snippets)) {
      this.project.snippets = this.project.snippets.filter(s => s.id !== id);
    }
    // If the deleted snippet is open, return to the browser.
    if (this._snippet?.id === id) {
      this.loadSnippet(null);
    } else {
      this._refreshBrowserItems();
    }
    window.dispatchEvent(new CustomEvent('project-snippets-changed', {
      detail: { snippetId: id, action: 'deleted' },
    }));
    this.store?.scheduleAutoSave(this.project);
    setTimeout(() => this.store?.garbageCollectAudioAssets?.(), 2500);
  }

  _refreshBrowserItems() {
    const container = this.el.querySelector('#edit-browser-items');
    if (!container) return;
    container.innerHTML = this._renderBrowserItemsHtml();
    this._bindBrowserItemEvents();
    const count = this.el.querySelector('#edit-browser-count');
    if (count) count.textContent = (this.project?.snippets || []).length;
  }

  setSnippetUsageProvider(fn) {
    this._snippetUsageProvider = fn;
  }

  _createBlankSnippet(type = 'midi') {
    if (!this.project) return;
    if (!Array.isArray(this.project.snippets)) this.project.snippets = [];
    const isDrum = type === 'drum';
    const snippet = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      type: isDrum ? 'drum' : 'midi',
      name: isDrum ? 'New Drum Clip' : 'New MIDI Clip',
      notes: [],
      hits: [],
      durationTicks: this.transport?.ticksPerBar || ((this.transport?.ticksPerBeat || 480) * (this.transport?.timeSignature?.beats || 4)),
      bpm: this.transport?.bpm || this.project.bpm || 120,
      meter: { ...(this.transport?.meter || this.project.meter || { type: 'metered', id: '4/4', numerator: 4, denominator: 4, pulse: 'quarter', pulseCount: 4, grouping: [1, 1, 1, 1], feelName: 'Standard' }) },
      timeSignature: { ...(this.transport?.timeSignature || this.project.timeSignature || { beats: 4, subdivision: 4 }) },
    };
    this.project.snippets.push(snippet);
    this.store?.scheduleAutoSave(this.project);
    this.onSnippetCreated?.(snippet);
    window.dispatchEvent(new CustomEvent('project-snippets-changed', {
      detail: { snippetId: snippet.id, action: 'created' },
    }));
    this.loadSnippet(snippet);
    showToast(`${isDrum ? 'Drum' : 'MIDI'} clip created`);
  }

  _loadSnippetById(id) {
    if (!id || id === this._snippet?.id) return;
    const snippet = this.project?.snippets?.find(s => s.id === id);
    if (!snippet) return;
    this.loadSnippet(snippet);
    showToast(snippet.type === 'audio' ? 'Audio preview' : 'Loaded clip in Inspect');
  }

  _beatsPerBar() {
    return Math.max(1, pulseCountForMeter(this._meterSource()));
  }

  _ticksPerBar() {
    return ticksPerBarForMeter(this._meterSource(), this.transport?.ticksPerBeat || 480);
  }

  _meterSource() {
    return this._snippet?.meter || this.transport?.meter || this.project?.meter || this._snippet?.timeSignature || this.transport?.timeSignature || this.project?.timeSignature;
  }

  adjustVisibleKeyCount(direction) {
    if (!this._snippet || this._snippet.type === 'drum' || this._snippet.type === 'audio') return false;

    let lowOct = Math.floor(this._pitchMin / 12) - 1;
    let highOct = Math.floor(this._pitchMax / 12) - 1;
    const currentSpan = highOct - lowOct;

    if (direction > 0) {
      if (highOct < MAX_PIANO_OCTAVE) {
        highOct += 1;
      } else if (lowOct > MIN_PIANO_OCTAVE) {
        lowOct -= 1;
      } else {
        showToast('Piano range maxed');
        return false;
      }
    } else if (currentSpan > 1) {
      highOct -= 1;
    } else {
      showToast('Piano range minimum');
      return false;
    }

    this._pitchMin = (lowOct + 1) * 12;
    this._pitchMax = (highOct + 1) * 12;
    this._pitchRangeInitialized = true;
    this._rebuildAll();
    showToast(`Piano range C${lowOct} to C${highOct}`);
    return true;
  }

  _updateSnippetDuration() {
    if (!this._snippet) return;
    let maxEnd = 480;
    for (const n of (this._snippet.notes || [])) {
      const end = n.startTick + n.durationTick;
      if (end > maxEnd) maxEnd = end;
    }
    for (const h of (this._snippet.hits || [])) {
      const end = h.startTick + this._gridSize;
      if (end > maxEnd) maxEnd = end;
    }
    const ticksPerBeat = 480;
    this._snippet.durationTicks = Math.ceil((maxEnd + ticksPerBeat) / ticksPerBeat) * ticksPerBeat;
  }

  _setDuration(newDuration) {
    if (!this._snippet) return;
    const beforeState = this._snapshotSnippetState();
    const beats = this.transport?.ticksPerBeat || 480;
    const durationTicks = Math.max(480, Math.ceil(newDuration / beats) * beats);
    this._snippet.durationTicks = durationTicks;

    const removed = [];
    if (this._snippet.notes) {
      this._snippet.notes = this._snippet.notes.filter(n => {
        if (n.startTick >= durationTicks) { removed.push('note'); return false; }
        return true;
      });
    }
    if (this._snippet.hits) {
      this._snippet.hits = this._snippet.hits.filter(h => {
        if (h.startTick >= durationTicks) { removed.push('hit'); return false; }
        return true;
      });
    }
    if (this._selectedNoteIdx !== null && this._selectedNoteIdx >= (this._snippet.notes?.length || 0) + (this._snippet.hits?.length || 0)) {
      this._selectedNoteIdx = null;
    }

    const afterState = this._snapshotSnippetState();
    if (beforeState && afterState && JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      this.undoManager?.push({
        type: 'setSnippetDuration',
        description: 'Set snippet duration',
        undo: () => this._restoreSnippetState(beforeState),
        redo: () => this._restoreSnippetState(afterState),
      });
    }

    this._rebuildAll();
    this.store?.scheduleAutoSave(this.project);
    const msg = removed.length ? `${(this._snippet.durationTicks / 480).toFixed(0)} beats · removed ${removed.length}` : `${(this._snippet.durationTicks / 480).toFixed(0)} beats`;
    showToast(msg);
  }

  _rebuildGrids() {
    this._panes.forEach(pane => {
      const newGrid = this._renderGridForRange(pane.pitchMin, pane.pitchMax, pane.paneId);
      pane.gridContainer.replaceChild(newGrid, pane.gridEl);
      pane.gridEl = newGrid;
    });
  }

  _rebuildAll() {
    this.el.innerHTML = '';
    this._renderEditor();
  }
}

Object.assign(
  EditMode.prototype,
  EditAudioPlayerMixin,
  EditRollMixin,
  EditNotesMixin,
  EditRhythmFitMixin,
  EditEventsMixin,
  EditLyricsMixin,
);
