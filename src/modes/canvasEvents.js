/**
 * canvasEvents — CanvasMode feature extracted for size; composed back onto
 * CanvasMode.prototype via Object.assign. Method bodies are unchanged.
 */

import { showToast } from '../ui/Toast.js';

export const CanvasEventsMixin = {
  _bindEvents() {
    // Zoom In
    this.el.querySelector('#canvas-zoom-in-btn')?.addEventListener('click', () => {
      this._setZoom(this._zoomLevel * 2);
    });

    // Zoom Out
    this.el.querySelector('#canvas-zoom-out-btn')?.addEventListener('click', () => {
      this._setZoom(this._zoomLevel / 2);
    });

    // Trim empty space
    this.el.querySelector('#canvas-trim-btn')?.addEventListener('click', () => {
      this._trimEmptySpace();
    });

    this.el.querySelector('#canvas-loop-toggle')?.addEventListener('click', () => {
      this._setCanvasLoopEnabled(!this._canvasLoopEnabled());
    });

    this.el.querySelector('#canvas-synesthesia-toggle')?.addEventListener('click', () => {
      this._setSynesthesiaEnabled(!this._synesthesiaEnabled());
    });

    this.el.querySelector('#canvas-time-tool')?.addEventListener('click', () => {
      this._setTimeToolActive(!this._timeToolActive);
    });

    this.el.querySelector('#canvas-tone-apply')?.addEventListener('click', () => {
      this._applyTonePresetToSelectedClip();
    });

    this.el.querySelector('#canvas-stage-button')?.addEventListener('click', () => {
      this._toggleStageOverlay();
    });

    this.el.querySelector('#canvas-tone-preset')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._openTonePresetPicker(e.currentTarget);
    });

    // Delegated events on the canvas element
    this.el.addEventListener('pointerdown', (e) => {
      // Mute/Solo buttons
      const addTrackBtn = e.target.closest('[data-add-track-type]');
      if (addTrackBtn) {
        e.preventDefault();
        this._addTrack(addTrackBtn.dataset.addTrackType || 'midi');
        return;
      }

      const instBtn = e.target.closest('[data-track-inst]');
      if (instBtn) {
        e.preventDefault();
        this._openTrackInstrumentPicker(instBtn);
        return;
      }

      const panBtn = e.target.closest('[data-track-pan]');
      if (panBtn) {
        e.preventDefault();
        this._openTrackPanModal(panBtn.dataset.trackPan);
        return;
      }

      const btn = e.target.closest('[data-action]');
      if (btn) {
        const action = btn.dataset.action;
        const trackId = btn.dataset.track;
        const track = this.project?.tracks.find(t => t.id === trackId);
        if (!track) return;

        if (action === 'mute') {
          track.muted = !track.muted;
          btn.classList.toggle('is-muted', track.muted);
        } else if (action === 'solo') {
          track.solo = !track.solo;
          btn.classList.toggle('is-solo', track.solo);
        }
        return;
      }

      // Remove track button
      const removeBtn = e.target.closest('[data-remove-track]');
      if (removeBtn) {
        e.preventDefault();
        const trackId = removeBtn.dataset.removeTrack;
        this._removeTrack(trackId);
        return;
      }
    });

    // Instrument selector change (event delegation)
    this.el.addEventListener('change', (e) => {
      const colorInput = e.target.closest('[data-track-color]');
      if (colorInput) {
        const trackId = colorInput.dataset.trackColor;
        const track = this.project?.tracks.find(t => t.id === trackId);
        if (!track) return;

        track.color = /^#[0-9a-f]{6}$/i.test(colorInput.value) ? colorInput.value : this._trackColor(track);
        this.store?.scheduleAutoSave(this.project);
        this._renderTracks();
        showToast(`${track.name}: color updated`);
        return;
      }

    });

    this._rulerEl?.addEventListener('pointerdown', (e) => {
      const beatEl = e.target.closest('.canvas-ruler__beat');
      if (!beatEl?.dataset.seekBar) return;
      e.preventDefault();
      const bar = parseFloat(beatEl.dataset.seekBar);
      if (!Number.isFinite(bar)) return;
      this.transport.seekToBar(bar);
      this._manualPlayheadVisible = true;
      this._updatePlayheadPosition(true);
    });

    // Double-click to rename track
    this.el.addEventListener('dblclick', (e) => {
      const nameEl = e.target.closest('.canvas-lane__name');
      if (!nameEl) return;

      const trackId = nameEl.dataset.trackId;
      const track = this.project?.tracks.find(t => t.id === trackId);
      if (!track) return;

      // Replace span with input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'canvas-lane__name-input';
      input.value = track.name;
      input.setAttribute('aria-label', 'Track name');

      nameEl.replaceWith(input);
      input.focus();
      input.select();

      const commit = () => {
        const newName = input.value.trim() || track.name;
        track.name = newName;
        this.store?.scheduleAutoSave(this.project);

        const span = document.createElement('span');
        span.className = 'canvas-lane__name';
        span.dataset.trackId = trackId;
        span.title = 'Double-click to rename';
        span.textContent = newName;
        input.replaceWith(span);
      };

      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
        if (ke.key === 'Escape') { input.value = track.name; input.blur(); }
      });
    });

    // Delete selected clip with Delete/Backspace key. Stored on the instance so
    // destroy() can remove it — otherwise each construction leaks a handler on document.
    this._documentKeydownHandler = (e) => {
      if ((e.code === 'Delete' || e.code === 'Backspace') && this._selectedClip) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        this._deleteSelectedClip();
      }
    };
    document.addEventListener('keydown', this._documentKeydownHandler);

    // Sync scroll between ruler and tracks
    this._tracksContainer?.addEventListener('scroll', () => {
      if (this._rulerEl) {
        this._rulerEl.scrollLeft = this._tracksContainer.scrollLeft;
      }
    });

    // Drag-to-pan timeline
    this._tracksContainer?.addEventListener('pointerdown', (e) => {
      // Ignore if clicking on a clip, track header, or scrollbar
      if (e.target.closest('.canvas-clip') || e.target.closest('.canvas-lane__header')) return;
      if (e.target.closest('button') || e.target.closest('select')) return;
      e.preventDefault();
      this._clearClipSelection();

      const startX = e.clientX;
      const startY = e.clientY;
      const startScrollLeft = this._tracksContainer.scrollLeft;
      const startScrollTop = this._tracksContainer.scrollTop;
      const pointerId = e.pointerId;
      
      this._tracksContainer.style.cursor = 'grabbing';
      this._tracksContainer.style.userSelect = 'none';
      this._tracksContainer.setPointerCapture?.(pointerId);

      const onMove = (me) => {
        if (me.pointerId !== pointerId) return;
        me.preventDefault();
        const dx = me.clientX - startX;
        const dy = me.clientY - startY;
        this._tracksContainer.scrollLeft = startScrollLeft - dx;
        this._tracksContainer.scrollTop = startScrollTop - dy;
      };

      const onUp = (ue) => {
        if (ue.pointerId !== pointerId) return;
        this._tracksContainer.style.cursor = '';
        this._tracksContainer.style.userSelect = '';
        this._tracksContainer.releasePointerCapture?.(pointerId);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  },
};
