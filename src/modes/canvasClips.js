/**
 * canvasClips — CanvasMode feature extracted for size; composed back onto
 * CanvasMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { TRACK_INSTRUMENTS } from '../engine/PlaybackEngine.js';
import { clipVisualDurationBars } from '../engine/ClipTimeScale.js';
import { showToast } from '../ui/Toast.js';

export const CanvasClipsMixin = {
  _findClip(clipId = this._selectedClip) {
    if (!clipId) return null;
    for (const track of this.project?.tracks || []) {
      const clip = (track.clips || []).find(c => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  },

  _syncClipTools() {
    const select = this.el?.querySelector('#canvas-tone-preset');
    const applyBtn = this.el?.querySelector('#canvas-tone-apply');
    if (!select || !applyBtn) return;
    const clip = this._findClip();
    const canApplyTone = !!clip && clip.snippet?.type !== 'audio';
    select.disabled = !canApplyTone;
    applyBtn.disabled = !canApplyTone;
    const title = !clip
      ? 'Select a MIDI or drum clip first'
      : clip.snippet?.type === 'audio'
        ? 'Tone presets work on MIDI and drum clips'
        : 'Apply Tone preset to selected clip';
    select.title = title;
    applyBtn.title = title;
  },

  _setTimeToolActive(active) {
    this._timeToolActive = !!active;
    this.el?.classList.toggle('is-time-tool-active', this._timeToolActive);
    const btn = this.el?.querySelector('#canvas-time-tool');
    if (btn) {
      btn.classList.toggle('is-active', this._timeToolActive);
      btn.setAttribute('aria-pressed', String(this._timeToolActive));
      btn.title = this._timeToolActive ? 'Click a clip to set its timing' : 'Pick a clip to set half-time or double-time';
    }
  },

  _trackForClip(clip) {
    return this.project?.tracks?.find(track => (track.clips || []).some(c => c.id === clip?.id));
  },

  _clipEndBar(clip, startBar = clip?.startBar, durationBars = clip?.durationBars) {
    return (startBar || 0) + Math.max(1 / this._beatsPerBar(), durationBars || clipVisualDurationBars(clip, this.transport.ticksPerBar));
  },

  _clipOverlapsAt(track, clip, startBar, durationBars = clipVisualDurationBars(clip, this.transport.ticksPerBar)) {
    if (!track) return false;
    const epsilon = 0.001;
    const endBar = this._clipEndBar(clip, startBar, durationBars);
    return (track.clips || []).some(other => {
      if (other.id === clip?.id) return false;
      const otherStart = other.startBar || 0;
      const otherEnd = this._clipEndBar(other);
      return startBar < otherEnd - epsilon && endBar > otherStart + epsilon;
    });
  },

  _resolveClipStart(track, clip, desiredStartBar, durationBars = clipVisualDurationBars(clip, this.transport.ticksPerBar)) {
    const minStep = 1 / this._beatsPerBar();
    const desired = Math.max(0, Math.round((desiredStartBar || 0) / minStep) * minStep);
    const otherClips = (track?.clips || [])
      .filter(other => other.id !== clip?.id)
      .sort((a, b) => (a.startBar || 0) - (b.startBar || 0));
    const snapDistance = Math.max(minStep, 18 / this.barWidth);
    const candidates = [{ start: desired, snapToGrid: true }];

    for (const other of otherClips) {
      const before = Math.max(0, (other.startBar || 0) - durationBars);
      const after = this._clipEndBar(other);
      if (Math.abs(desired - before) <= snapDistance) candidates.unshift({ start: before, snapToGrid: false });
      if (Math.abs(desired - after) <= snapDistance) candidates.unshift({ start: after, snapToGrid: false });
      candidates.push({ start: before, snapToGrid: false }, { start: after, snapToGrid: false });
    }

    let best = null;
    for (const candidate of candidates) {
      const rawStart = typeof candidate === 'number' ? candidate : candidate.start;
      const shouldSnap = typeof candidate === 'number' ? true : candidate.snapToGrid;
      const start = Math.max(0, shouldSnap ? Math.round(rawStart / minStep) * minStep : rawStart);
      if (this._clipOverlapsAt(track, clip, start, durationBars)) continue;
      const distance = Math.abs(start - desired);
      if (!best || distance < best.distance) best = { start, distance };
    }

    return best ? best.start : null;
  },

  _recordedInstrumentForSnippet(snippet) {
    if (!snippet) return null;
    if (snippet.type === 'midi') {
      const id = snippet.patchRecorded?.instrumentId || snippet.instrumentId || snippet.patchId;
      if (id?.startsWith?.('custom:')) return id;
      if (TRACK_INSTRUMENTS[id]) return id;
    }
    if (snippet.type === 'drum') {
      const id = snippet.kitRecorded?.instrumentId || snippet.instrumentId || snippet.kitId;
      if (id?.startsWith?.('custom:')) return id;
      if (this._isDrumInstrumentId(id)) return id;
    }
    return null;
  },

  _applyRecordedInstrumentToTrack(track, snippet) {
    const instrumentId = this._recordedInstrumentForSnippet(snippet);
    if (!track || !instrumentId) return null;
    if (track.type === 'midi' && snippet.type !== 'midi') return null;
    if (track.type === 'drum' && snippet.type !== 'drum') return null;
    if (track.instrumentId === instrumentId) return null;
    const previousInstrumentId = track.instrumentId;
    track.instrumentId = instrumentId;
    this.onTrackInstrumentChanged?.(track.id);
    return previousInstrumentId;
  },

  _maxDurationForClip(track, clip) {
    const start = clip.startBar || 0;
    const next = (track?.clips || [])
      .filter(other => other.id !== clip.id && (other.startBar || 0) >= start)
      .sort((a, b) => (a.startBar || 0) - (b.startBar || 0))[0];
    return next ? Math.max(1 / this._beatsPerBar(), (next.startBar || 0) - start) : Infinity;
  },

  _setupDropZone(contentEl, track) {
    contentEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      contentEl.classList.add('is-drop-target');
    });

    contentEl.addEventListener('dragleave', () => {
      contentEl.classList.remove('is-drop-target');
    });

    contentEl.addEventListener('drop', (e) => {
      e.preventDefault();
      contentEl.classList.remove('is-drop-target');

      const snippetId = e.dataTransfer.getData('text/snippet-id');
      if (!snippetId || !this.project) return;

      const snippet = this.project.snippets.find(s => s.id === snippetId);
      if (!snippet) return;
      if (!this._trackAcceptsSnippet(track, snippet)) {
        showToast(`${this._snippetTypeLabel(snippet)} snippets need a ${this._trackTypeLabel(this._snippetTrackType(snippet))} track`);
        return;
      }

      // Calculate bar position from drop point
      const rect = contentEl.getBoundingClientRect();
      const scrollLeft = contentEl.parentElement?.closest('.canvas-tracks')?.scrollLeft || 0;
      const offsetX = e.clientX - rect.left + scrollLeft;
      const durationBars = snippet.durationTicks / this.transport.ticksPerBar || 1;
      const desiredStartBar = this._barPositionFromPixels(offsetX, 'floor');

      const clip = {
        id: crypto.randomUUID(),
        snippetId: snippet.id,
        snippet: snippet,
        startBar: desiredStartBar,
        durationBars,
        timeScale: 1,
      };
      const startBar = this._resolveClipStart(track, clip, desiredStartBar, durationBars);
      if (startBar === null) {
        showToast('No room for that clip on this track');
        return;
      }
      clip.startBar = startBar;

      const previousInstrumentId = this._applyRecordedInstrumentToTrack(track, snippet);

      this._commitClipAdd(track, clip, snippet, previousInstrumentId);
    });
  },

  /**
   * Commit a freshly-positioned clip to a track: push it, autosave, register the
   * add/remove undo entry, and re-render. Shared by the desktop drop path and the
   * snippet-dock touch-drag path so the two stay in sync.
   */
  _commitClipAdd(track, clip, snippet, previousInstrumentId) {
    track.clips.push(clip);
    this.store?.scheduleAutoSave(this.project);
    this.undoManager?.push({
      type: 'addClip',
      description: `Add clip to ${track.name}`,
      undo: () => {
        track.clips = track.clips.filter(c => c.id !== clip.id);
        if (previousInstrumentId !== null) {
          track.instrumentId = previousInstrumentId;
          this.onTrackInstrumentChanged?.(track.id);
        }
        this._renderTracks();
      },
      redo: () => {
        this._applyRecordedInstrumentToTrack(track, snippet);
        track.clips.push(clip);
        this._renderTracks();
      },
    });
    this._renderTracks();
    this._autoSetLoopFromClips();
    showToast(`Clip added to ${track.name}`);
  },

  _snippetTrackType(snippet) {
    if (snippet?.type === 'audio') return 'audio';
    if (snippet?.type === 'drum') return 'drum';
    return 'midi';
  },

  _trackAcceptsSnippet(track, snippet) {
    return (track?.type || 'midi') === this._snippetTrackType(snippet);
  },

  _trackTypeLabel(type) {
    return type === 'audio' ? 'Audio' : type === 'drum' ? 'Drum' : 'MIDI';
  },

  _snippetTypeLabel(snippet) {
    return this._trackTypeLabel(this._snippetTrackType(snippet));
  },

  _selectClip(clipId, el) {
    // Deselect previous
    this.el.querySelectorAll('.canvas-clip.is-selected').forEach(c => c.classList.remove('is-selected'));
    el.classList.add('is-selected');
    this._selectedClip = clipId;
    this._syncClipTools();
  },

  _clearClipSelection() {
    this.el?.querySelectorAll('.canvas-clip.is-selected').forEach(c => c.classList.remove('is-selected'));
    this._selectedClip = null;
    this._syncClipTools();
  },

  removeSnippetReferences(snippetId) {
    if (!snippetId || !this.project?.tracks) return;
    let removedSelected = false;
    let changed = false;
    for (const track of this.project.tracks) {
      const before = track.clips?.length || 0;
      track.clips = (track.clips || []).filter(clip => {
        const keep = clip.snippetId !== snippetId && clip.snippet?.id !== snippetId;
        if (!keep && clip.id === this._selectedClip) removedSelected = true;
        return keep;
      });
      if ((track.clips?.length || 0) !== before) changed = true;
    }
    if (!changed) return;
    if (removedSelected) this._selectedClip = null;
    this.store?.scheduleAutoSave(this.project);
    this._renderTracks();
    this._renderSnippetDock();
    this._autoSetLoopFromClips();
    this._syncClipTools();
  },

  _startTouchClipIntent(e, clip, el) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let consumed = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };

    const askDelete = () => {
      consumed = true;
      cleanup();
      const name = clip.snippet?.name || 'this clip';
      if (window.confirm(`Delete "${name}" from Canvas?`)) {
        this._selectedClip = clip.id;
        this._deleteSelectedClip();
      }
    };

    const timer = window.setTimeout(askDelete, 650);

    const onMove = (me) => {
      if (me.pointerId !== pointerId || consumed) return;
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      consumed = true;
      cleanup();
      this._startClipDrag(e, clip, el);
    };

    const onUp = (ue) => {
      if (ue.pointerId !== pointerId) return;
      cleanup();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  },

  _startClipDrag(e, clip, el) {
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = parseInt(el.style.left, 10) || 0;
    const originalBar = clip.startBar;
    const track = this._trackForClip(clip);
    const pointerId = e.pointerId;

    el.classList.add('is-dragging');
    el.setPointerCapture?.(pointerId);

    const onMove = (me) => {
      if (me.pointerId !== pointerId) return;
      me.preventDefault();
      const dx = me.clientX - startX;
      const newLeft = Math.max(0, startLeft + dx);
      const desiredBar = this._barPositionFromPixels(newLeft, 'round');
      const resolvedBar = this._resolveClipStart(track, clip, desiredBar, clip.durationBars);
      el.style.left = `${(resolvedBar ?? desiredBar) * this.barWidth}px`;
    };

    const onUp = (ue) => {
      if (ue.pointerId !== pointerId) return;
      el.classList.remove('is-dragging');
      el.releasePointerCapture?.(pointerId);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);

      const desiredBar = this._barPositionFromPixels(parseInt(el.style.left, 10), 'round');
      const newBar = this._resolveClipStart(track, clip, desiredBar, clip.durationBars);
      if (newBar === null) {
        el.style.left = `${originalBar * this.barWidth}px`;
        return;
      }
      if (newBar !== originalBar) {
        clip.startBar = newBar;
        el.style.left = `${newBar * this.barWidth}px`;
        this._autoSetLoopFromClips();
        this.store?.scheduleAutoSave(this.project);

        this.undoManager?.push({
          type: 'moveClip',
          description: 'Move clip',
          undo: () => { clip.startBar = originalBar; this._renderTracks(); },
          redo: () => { clip.startBar = newBar; this._renderTracks(); },
        });
      } else {
        el.style.left = `${originalBar * this.barWidth}px`;
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  },

  _deleteSelectedClip() {
    if (!this._selectedClip || !this.project) return;
    for (const track of this.project.tracks) {
      const idx = track.clips.findIndex(c => c.id === this._selectedClip);
      if (idx !== -1) {
        const removed = track.clips.splice(idx, 1)[0];
        this._selectedClip = null;
        this.store?.scheduleAutoSave(this.project);
        this.undoManager?.push({
          type: 'deleteClip',
          description: 'Delete clip',
          undo: () => { track.clips.push(removed); this._renderTracks(); },
          redo: () => { track.clips = track.clips.filter(c => c.id !== removed.id); this._renderTracks(); },
        });
        this._renderTracks();
        this._autoSetLoopFromClips();
        showToast('Clip deleted');
        return;
      }
    }
  },
};
