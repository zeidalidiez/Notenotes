import './stage.css';
import { StageDrawViewsMixin } from './stageDrawViews.js';
import { clamp, rgba, normalizeEvent } from './stageDrawUtils.js';
import { STAGE_CANVAS_TRACK_LIMIT, STAGE_LIVE_LANE_LIMIT } from './StageModel.js';
import { stageBlur, stageRenderQuality, stageTrailMs } from './StageRenderQuality.js';
import { resolveStageView, stageViewNeighbor, stageViewOptionsForMode } from './StageViews.js';

export class CanvasStageRenderer {
  constructor(options = {}) {
    this.title = options.title || 'Stage';
    this.subtitle = options.subtitle || '';
    this.mode = options.mode || 'live';
    this.eventStream = options.eventStream || null;
    this.getEvents = options.getEvents || (() => []);
    this.getLaneCount = options.getLaneCount || (() => 8);
    this.getLaneLabel = options.getLaneLabel || ((index) => `Lane ${index + 1}`);
    this.getNowTick = options.getNowTick || (() => 0);
    this.getUnitTicks = options.getUnitTicks || (() => 480);
    this.getUnitSeconds = options.getUnitSeconds || (() => null);
    this.getInputItems = options.getInputItems || (() => []);
    this.getInputNotice = options.getInputNotice || (() => '');
    this.onInputDown = options.onInputDown || null;
    this.onInputUp = options.onInputUp || null;
    this.onClose = options.onClose || null;
    this.viewId = resolveStageView(options.viewId || this._storedViewId(), this.mode).id;
    const fallbackLimit = this.mode === 'canvas' ? STAGE_CANVAS_TRACK_LIMIT : STAGE_LIVE_LANE_LIMIT;
    this.maxLanes = Math.max(1, Math.floor(Number(options.maxLanes) || fallbackLimit));

    this.el = null;
    this.canvas = null;
    this.ctx = null;
    this._raf = null;
    this._unsubscribe = null;
    this._liveEvents = [];
    this._liveLimit = 260;
    this._swipeStart = null;
    this._gradientCache = new Map();
    this._gradientSizeKey = '';
    this._reducedMotionQuery = null;
  }

  open() {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.className = 'stage-overlay';
    this.el.innerHTML = `
      <div class="stage-overlay__chrome" aria-hidden="false">
        <div>
          <div class="stage-overlay__eyebrow">${this.mode === 'canvas' ? 'Canvas Performance' : 'Live Performance'}</div>
          <h2 class="stage-overlay__title">${this.title}</h2>
          <p class="stage-overlay__subtitle">${this.subtitle}</p>
        </div>
        <div class="stage-overlay__actions">
          ${this._renderViewSelector()}
          <button class="btn btn--ghost stage-overlay__close" type="button">Close Stage</button>
        </div>
      </div>
      ${this.mode === 'live' ? this._renderInputStrip() : ''}
      <canvas class="stage-overlay__canvas" aria-label="Stage performance visualization"></canvas>
      <div class="stage-overlay__hint">${this.mode === 'canvas' ? 'Play the canvas to watch clips travel through their lanes.' : 'Play pads, keys, kit, or controller bindings to light the lanes.'}</div>
    `;
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this._reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    this.el.querySelector('.stage-overlay__close')?.addEventListener('click', () => this.close());
    this.el.querySelector('#stage-view-select')?.addEventListener('change', (event) => {
      this._setViewId(event.target.value);
    });
    this.el.querySelector('[data-stage-view-prev]')?.addEventListener('click', () => this._shiftView(-1));
    this.el.querySelector('[data-stage-view-next]')?.addEventListener('click', () => this._shiftView(1));
    this._bindInputStrip();
    this._bindViewSwipe();
    document.body.appendChild(this.el);

    if (this.eventStream) {
      this._unsubscribe = this.eventStream.subscribe(payload => this._receiveStreamEvent(payload));
    }
    this._draw();
  }

  _storedViewId() {
    try {
      return window.localStorage?.getItem(`notenotes-stage-view-${this.mode}`);
    } catch {
      return '';
    }
  }

  _storeViewId(viewId) {
    try {
      window.localStorage?.setItem(`notenotes-stage-view-${this.mode}`, viewId);
    } catch { /* non-critical preference */ }
  }

  _setViewId(viewId) {
    this.viewId = resolveStageView(viewId, this.mode).id;
    this._storeViewId(this.viewId);
    const select = this.el?.querySelector('#stage-view-select');
    if (select && select.value !== this.viewId) select.value = this.viewId;
  }

  _shiftView(direction) {
    const options = stageViewOptionsForMode(this.mode);
    if (options.length < 2) return;
    this._setViewId(stageViewNeighbor(this.viewId, this.mode, direction).id);
  }

  _renderViewSelector() {
    const options = stageViewOptionsForMode(this.mode);
    if (options.length < 2) return '';
    return `
      <label class="stage-overlay__view">
        <span>View</span>
        <button class="stage-overlay__view-nav" type="button" data-stage-view-prev aria-label="Previous Stage view">‹</button>
        <select id="stage-view-select" aria-label="Stage view">
          ${options.map(view => `
            <option value="${this._escapeAttr(view.id)}" ${view.id === this.viewId ? 'selected' : ''}>
              ${this._escapeHtml(view.label)}
            </option>
          `).join('')}
        </select>
        <button class="stage-overlay__view-nav" type="button" data-stage-view-next aria-label="Next Stage view">›</button>
      </label>
    `;
  }

  _renderInputStrip() {
    const items = (this.getInputItems() || []).slice(0, this.maxLanes);
    if (!items.length) return '';
    const notice = this.getInputNotice?.() || 'Tap these lanes or connect a controller.';
    return `
      <div class="stage-overlay__input-strip" aria-label="Stage touch input">
        <span class="stage-overlay__input-notice">${notice}</span>
        <div class="stage-overlay__input-buttons">
          ${items.map((item, index) => `
            <button class="stage-overlay__input" type="button" data-stage-input="${index}" style="--stage-input-color:${item.color || '#7bd88f'}">
              <span>${item.label || index + 1}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  _bindInputStrip() {
    this.el?.querySelectorAll('[data-stage-input]').forEach(button => {
      let pointerId = null;
      const index = Number(button.dataset.stageInput);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        pointerId = event.pointerId;
        button.setPointerCapture?.(event.pointerId);
        button.classList.add('is-active');
        this.onInputDown?.(index);
      });
      const release = (event) => {
        if (pointerId !== null && event.pointerId !== pointerId) return;
        pointerId = null;
        button.classList.remove('is-active');
        this.onInputUp?.(index);
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', () => {
        if (pointerId === null) return;
        pointerId = null;
        button.classList.remove('is-active');
        this.onInputUp?.(index);
      });
    });
  }

  _bindViewSwipe() {
    this.canvas?.addEventListener('pointerdown', (event) => {
      if (stageViewOptionsForMode(this.mode).length < 2) return;
      this._swipeStart = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
    });
    this.canvas?.addEventListener('pointerup', (event) => this._finishViewSwipe(event));
    this.canvas?.addEventListener('pointercancel', () => {
      this._swipeStart = null;
    });
  }

  _finishViewSwipe(event) {
    const start = this._swipeStart;
    this._swipeStart = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    this._shiftView(dx < 0 ? 1 : -1);
  }

  close({ silent = false } = {}) {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.el?.remove();
    this.el = null;
    this.canvas = null;
    this.ctx = null;
    this._gradientCache.clear();
    this._gradientSizeKey = '';
    this._reducedMotionQuery = null;
    if (!silent) this.onClose?.();
  }

  _receiveStreamEvent(payload = {}) {
    const now = performance.now();
    if (payload.kind === 'clear') {
      this._liveEvents = [];
      return;
    }
    const event = normalizeEvent(payload.event || {});
    if (!event.id) return;

    if (payload.kind === 'start') {
      this._liveEvents.push({
        ...event,
        _visualStartMs: now,
        _visualEndMs: null,
        _active: true,
      });
    } else if (payload.kind === 'end') {
      const active = this._liveEvents.find(item => item.id === event.id && item._active);
      if (active) {
        Object.assign(active, event, { _visualEndMs: now, _active: false });
      } else {
        this._liveEvents.push({
          ...event,
          _visualStartMs: now - 160,
          _visualEndMs: now,
          _active: false,
        });
      }
    } else if (payload.kind === 'hit') {
      this._liveEvents.push({
        ...event,
        _visualStartMs: now,
        _visualEndMs: now + 120,
        _active: false,
      });
    }

    if (this._liveEvents.length > this._liveLimit) {
      this._liveEvents.splice(0, this._liveEvents.length - this._liveLimit);
    }
  }

  _resize() {
    const canvas = this.canvas;
    if (!canvas) return { width: 0, height: 0, ratio: 1 };
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(320, Math.floor(rect.height));
    if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      this._gradientCache.clear();
      this._gradientSizeKey = '';
    }
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width, height, ratio };
  }

  _draw = () => {
    if (!this.ctx || !this.canvas) return;
    const { width, height } = this._resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    this._drawBackground(ctx, width, height);
    if (this.mode === 'canvas') {
      this._drawCanvasTrackMap(ctx, width, height);
      this._raf = requestAnimationFrame(this._draw);
      return;
    }
    if (this.viewId === 'thread') {
      this._drawThread(ctx, width, height);
    } else if (this.viewId === 'pulse') {
      this._drawPulse(ctx, width, height);
    } else if (this.viewId === 'halo') {
      this._drawHalo(ctx, width, height);
    } else if (this.viewId === 'pocket') {
      this._drawPocket(ctx, width, height);
    } else {
      this._drawHighway(ctx, width, height);
      this._drawEvents(ctx, width, height);
    }
    this._raf = requestAnimationFrame(this._draw);
  };

  _drawBackground(ctx, width, height) {
    const bg = this._cachedGradient(ctx, 'background', width, height, () => {
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#02040a');
      gradient.addColorStop(0.46, '#070a11');
      gradient.addColorStop(1, '#020203');
      return gradient;
    });
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const glow = this._cachedGradient(ctx, 'background-glow', width, height, () => {
      const gradient = ctx.createRadialGradient(width * 0.5, height * 0.2, 20, width * 0.5, height * 0.18, width * 0.75);
      gradient.addColorStop(0, 'rgba(63, 232, 255, 0.20)');
      gradient.addColorStop(0.44, 'rgba(234, 87, 255, 0.08)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      return gradient;
    });
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  _cachedGradient(ctx, key, width, height, create) {
    const sizeKey = `${Math.round(width)}x${Math.round(height)}:${this.mode}:${this.viewId}`;
    if (this._gradientSizeKey !== sizeKey) {
      this._gradientSizeKey = sizeKey;
      this._gradientCache.clear();
    }
    const cacheKey = `${key}:${sizeKey}`;
    if (!this._gradientCache.has(cacheKey)) {
      this._gradientCache.set(cacheKey, create(ctx));
    }
    return this._gradientCache.get(cacheKey);
  }

  _prefersReducedMotion() {
    return Boolean(this._reducedMotionQuery?.matches);
  }

  _qualityForEvents(events = []) {
    return stageRenderQuality({
      eventCount: events.length,
      laneCount: this.getLaneCount?.() || 1,
      reducedMotion: this._prefersReducedMotion(),
    });
  }

  _roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  _eventsForFrame() {
    if (this.mode === 'canvas') return (this.getEvents() || []).map(normalizeEvent);
    const now = performance.now();
    const quality = stageRenderQuality({
      eventCount: this._liveEvents.length,
      laneCount: this.getLaneCount?.() || 1,
      reducedMotion: this._prefersReducedMotion(),
    });
    const retentionMs = stageTrailMs(6800, quality);
    this._liveEvents = this._liveEvents.filter(event => event._active || now - (event._visualEndMs || event._visualStartMs) < retentionMs);
    return this._liveEvents.map(event => ({ ...normalizeEvent(event), _visualStartMs: event._visualStartMs, _visualEndMs: event._visualEndMs, _active: event._active }));
  }

  _drawEvents(ctx, width, height) {
    const geom = this._laneGeometry(width, height);
    const nowTick = Math.max(0, Math.floor(Number(this.getNowTick()) || 0));
    const unitTicks = Math.max(1, Number(this.getUnitTicks()) || 480);
    const horizonTicks = unitTicks * 16;
    const events = this._eventsForFrame();
    const quality = this._qualityForEvents(events);
    const nowMs = performance.now();

    for (const event of events) {
      const lane = clamp(event.lane, 0, geom.laneCount - 1);
      let zStart;
      let zEnd;
      if (this.mode === 'canvas') {
        const eventStart = event.startTick - nowTick;
        const eventEnd = (event.endTick ?? event.startTick + unitTicks) - nowTick;
        if (eventEnd < -unitTicks || eventStart > horizonTicks) continue;
        zStart = clamp(1 - (eventStart / horizonTicks), 0, 1);
        zEnd = clamp(1 - (eventEnd / horizonTicks), 0, 1);
      } else {
        const age = Math.max(0, nowMs - (event._visualStartMs || nowMs));
        const tailAge = event._active ? 0 : Math.max(0, nowMs - (event._visualEndMs || event._visualStartMs || nowMs));
        zStart = clamp(age / 2800, 0, 1);
        zEnd = clamp(tailAge / 2800, 0, 1);
      }
      if (zStart < zEnd) [zStart, zEnd] = [zEnd, zStart];
      this._drawEventShape(ctx, geom, lane, zStart, zEnd, event, quality);
    }
  }

  _drawEventShape(ctx, geom, lane, zStart, zEnd, event, quality = this._qualityForEvents()) {
    const inset = 0.14;
    const leftStart = geom.xAt(lane + inset, zStart);
    const rightStart = geom.xAt(lane + 1 - inset, zStart);
    const leftEnd = geom.xAt(lane + inset, zEnd);
    const rightEnd = geom.xAt(lane + 1 - inset, zEnd);
    const yStart = geom.yAt(zStart);
    const yEnd = geom.yAt(zEnd);
    const alpha = 0.28 + (event.velocity || 0.8) * 0.55;
    const glow = event.intensity?.glow ?? 0.45;

    ctx.save();
    ctx.shadowColor = rgba(event.accentColor, 0.78);
    ctx.shadowBlur = stageBlur(8 + glow * 28, quality);
    const grad = ctx.createLinearGradient(0, yEnd, 0, yStart);
    grad.addColorStop(0, rgba(event.color, 0.15));
    grad.addColorStop(0.5, rgba(event.color, alpha));
    grad.addColorStop(1, rgba(event.accentColor, Math.min(1, alpha + 0.16)));
    ctx.fillStyle = grad;
    ctx.strokeStyle = rgba(event.accentColor, 0.9);
    ctx.lineWidth = event.type === 'hit' ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(leftStart, yStart);
    ctx.lineTo(rightStart, yStart);
    ctx.lineTo(rightEnd, yEnd);
    ctx.lineTo(leftEnd, yEnd);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (event.label && Math.abs(yStart - yEnd) > 18 && yStart > 36) {
      ctx.shadowBlur = 0;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillText(String(event.label).slice(0, 10), (leftStart + rightStart + leftEnd + rightEnd) / 4, (yStart + yEnd) / 2);
    }
    ctx.restore();
  }

  _escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char]);
  }

  _escapeAttr(value) {
    return this._escapeHtml(value);
  }
}

Object.assign(CanvasStageRenderer.prototype, StageDrawViewsMixin);
