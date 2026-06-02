import './stage.css';

import { STAGE_CANVAS_TRACK_LIMIT, STAGE_LIVE_LANE_LIMIT } from './StageModel.js';
import { stageBlur, stageRenderQuality, stageTrailMs } from './StageRenderQuality.js';
import { resolveStageView, stageViewNeighbor, stageViewOptionsForMode } from './StageViews.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex = '#ffffff') {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#ffffff';
  return {
    r: parseInt(clean.slice(1, 3), 16),
    g: parseInt(clean.slice(3, 5), 16),
    b: parseInt(clean.slice(5, 7), 16),
  };
}

function rgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const FIFTHS_PITCH_CLASSES = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const PITCH_CLASS_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function normalizeEvent(event = {}) {
  return {
    ...event,
    lane: Math.max(0, Math.floor(Number(event.lane) || 0)),
    subLane: Math.max(0, Math.floor(Number(event.subLane) || 0)),
    subLaneCount: Math.max(1, Math.floor(Number(event.subLaneCount) || 1)),
    startTick: Math.max(0, Math.floor(Number(event.startTick) || 0)),
    endTick: event.endTick == null ? null : Math.max(0, Math.floor(Number(event.endTick) || 0)),
    durationTick: event.durationTick == null ? null : Math.max(1, Math.floor(Number(event.durationTick) || 1)),
    velocity: clamp(Number(event.velocity) || 0.8, 0, 1),
    color: event.color || '#ffffff',
    accentColor: event.accentColor || event.color || '#ffffff',
    label: event.label || event.drum || '',
  };
}

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

  _laneGeometry(width, height) {
    const laneCount = clamp(Math.floor(Number(this.getLaneCount()) || 1), 1, this.maxLanes);
    const horizonY = height * 0.18;
    const bottomY = height * 0.88;
    const topWidth = width * 0.18;
    const bottomWidth = width * 0.94;
    const centerX = width * 0.5;
    const xAt = (laneEdge, z) => {
      const roadWidth = bottomWidth + (topWidth - bottomWidth) * z;
      const left = centerX - roadWidth / 2;
      return left + (laneEdge / laneCount) * roadWidth;
    };
    const yAt = (z) => bottomY + (horizonY - bottomY) * z;
    return { laneCount, horizonY, bottomY, xAt, yAt };
  }

  _drawHighway(ctx, width, height) {
    const geom = this._laneGeometry(width, height);
    ctx.save();
    ctx.lineCap = 'round';

    for (let i = 0; i <= geom.laneCount; i++) {
      const color = i === 0 || i === geom.laneCount ? 'rgba(255,255,255,0.22)' : 'rgba(143,210,255,0.12)';
      ctx.strokeStyle = color;
      ctx.lineWidth = i === 0 || i === geom.laneCount ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(geom.xAt(i, 0), geom.bottomY);
      ctx.lineTo(geom.xAt(i, 1), geom.horizonY);
      ctx.stroke();
    }

    for (let step = 0; step <= 14; step++) {
      const z = step / 14;
      const alpha = 0.08 + (1 - z) * 0.16;
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = step % 4 === 0 ? 1.4 : 0.7;
      ctx.beginPath();
      ctx.moveTo(geom.xAt(0, z), geom.yAt(z));
      ctx.lineTo(geom.xAt(geom.laneCount, z), geom.yAt(z));
      ctx.stroke();
    }

    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let lane = 0; lane < geom.laneCount; lane++) {
      const label = this.getLaneLabel(lane);
      const x = (geom.xAt(lane, 0.03) + geom.xAt(lane + 1, 0.03)) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.54)';
      ctx.fillText(String(label).slice(0, 14), x, geom.bottomY + 22);
    }
    ctx.restore();
  }

  _canvasMapGeometry(width, height) {
    const laneCount = clamp(Math.floor(Number(this.getLaneCount()) || 1), 1, this.maxLanes);
    const top = Math.max(56, height * 0.08);
    const bottom = height - Math.max(42, height * 0.08);
    const labelWidth = clamp(width * 0.18, 86, 180);
    const rightPad = 24;
    const playheadX = labelWidth + Math.max(96, (width - labelWidth - rightPad) * 0.28);
    const timelineLeft = labelWidth;
    const timelineRight = width - rightPad;
    const rowGap = clamp(height * 0.01, 5, 12);
    const rowHeight = Math.max(28, (bottom - top - rowGap * (laneCount - 1)) / laneCount);
    const rowTop = (lane) => top + lane * (rowHeight + rowGap);
    return {
      laneCount,
      top,
      bottom,
      labelWidth,
      rightPad,
      playheadX,
      timelineLeft,
      timelineRight,
      rowGap,
      rowHeight,
      rowTop,
      timelineWidth: timelineRight - playheadX,
    };
  }

  _drawCanvasTrackMap(ctx, width, height) {
    const geom = this._canvasMapGeometry(width, height);
    const nowTick = Math.max(0, Math.floor(Number(this.getNowTick()) || 0));
    const unitTicks = Math.max(1, Number(this.getUnitTicks()) || 480);
    const pastTicks = unitTicks * 3;
    const futureTicks = unitTicks * 18;
    const events = this._eventsForFrame();
    const quality = this._qualityForEvents(events);
    const tickToX = (tick) => {
      const delta = tick - nowTick;
      if (delta >= 0) return geom.playheadX + (delta / futureTicks) * geom.timelineWidth;
      return geom.playheadX + (delta / pastTicks) * (geom.playheadX - geom.timelineLeft);
    };

    ctx.save();
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    for (let lane = 0; lane < geom.laneCount; lane++) {
      const y = geom.rowTop(lane);
      const label = String(this.getLaneLabel(lane) || `Track ${lane + 1}`);
      const trackEvents = events.filter(event => event.lane === lane);
      const laneColor = trackEvents[0]?.color || '#7bd88f';
      const subLaneCount = Math.max(1, ...trackEvents.map(event => event.subLaneCount || 1));

      const rowGrad = ctx.createLinearGradient(geom.timelineLeft, y, geom.timelineRight, y);
      rowGrad.addColorStop(0, rgba(laneColor, 0.22));
      rowGrad.addColorStop(0.22, 'rgba(255,255,255,0.035)');
      rowGrad.addColorStop(1, rgba(laneColor, 0.08));
      ctx.fillStyle = rowGrad;
      this._roundedRect(ctx, geom.timelineLeft, y, geom.timelineRight - geom.timelineLeft, geom.rowHeight, 10);
      ctx.fill();

      ctx.strokeStyle = rgba(laneColor, 0.35);
      ctx.lineWidth = 1;
      this._roundedRect(ctx, geom.timelineLeft, y, geom.timelineRight - geom.timelineLeft, geom.rowHeight, 10);
      ctx.stroke();

      ctx.fillStyle = rgba(laneColor, 0.22);
      this._roundedRect(ctx, 14, y, geom.labelWidth - 22, geom.rowHeight, 8);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.textAlign = 'left';
      ctx.fillText(label.slice(0, 18), 24, y + geom.rowHeight * 0.5);

      for (let sub = 1; sub < subLaneCount; sub++) {
        const subY = y + (sub / subLaneCount) * geom.rowHeight;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(geom.timelineLeft + 4, subY);
        ctx.lineTo(geom.timelineRight - 4, subY);
        ctx.stroke();
      }
    }

    for (let step = -3; step <= 18; step++) {
      const x = step < 0
        ? geom.playheadX + (step / 3) * (geom.playheadX - geom.timelineLeft)
        : geom.playheadX + (step / 18) * geom.timelineWidth;
      const strong = step === 0 || step % 4 === 0;
      ctx.strokeStyle = step === 0 ? 'rgba(255,255,255,0.8)' : `rgba(255,255,255,${strong ? 0.18 : 0.08})`;
      ctx.lineWidth = step === 0 ? 2 : (strong ? 1.2 : 0.7);
      ctx.beginPath();
      ctx.moveTo(x, geom.top - 12);
      ctx.lineTo(x, geom.bottom + 10);
      ctx.stroke();
    }

    for (const event of events) {
      const startX = tickToX(event.startTick);
      const endX = tickToX(event.endTick ?? event.startTick + unitTicks * 0.35);
      const minX = Math.min(startX, endX);
      const maxX = Math.max(startX, endX);
      if (maxX < geom.timelineLeft || minX > geom.timelineRight) continue;
      this._drawCanvasEvent(ctx, geom, event, minX, maxX, quality);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.textAlign = 'center';
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.fillText('NOW', geom.playheadX, geom.top - 24);
    ctx.restore();
  }

  _drawCanvasEvent(ctx, geom, event, minX, maxX, quality = this._qualityForEvents()) {
    const rowTop = geom.rowTop(event.lane);
    const subCount = Math.max(1, event.subLaneCount || 1);
    const sub = clamp(event.subLane || 0, 0, subCount - 1);
    const subHeight = geom.rowHeight / subCount;
    const padY = Math.min(5, subHeight * 0.18);
    const y = rowTop + sub * subHeight + padY;
    const h = Math.max(6, subHeight - padY * 2);
    const width = Math.max(event.type === 'hit' ? 10 : 16, maxX - minX);
    const x = clamp(minX, geom.timelineLeft, geom.timelineRight);
    const w = Math.min(width, geom.timelineRight - x);
    if (w <= 0) return;

    const alpha = event.type === 'clip' ? 0.38 : 0.58 + (event.velocity || 0.8) * 0.32;
    const glow = event.intensity?.glow ?? 0.35;
    ctx.save();
    ctx.shadowColor = rgba(event.accentColor, 0.82);
    ctx.shadowBlur = stageBlur(event.type === 'clip' ? 8 : 10 + glow * 18, quality);
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, rgba(event.color, 0.18));
    grad.addColorStop(0.45, rgba(event.color, alpha));
    grad.addColorStop(1, rgba(event.accentColor, Math.min(1, alpha + 0.14)));
    ctx.fillStyle = grad;
    ctx.strokeStyle = rgba(event.accentColor, 0.85);
    ctx.lineWidth = event.type === 'hit' ? 2 : 1.25;
    this._roundedRect(ctx, x, y, w, h, Math.min(8, h / 2));
    ctx.fill();
    ctx.stroke();

    if (event.label && w > 34 && h > 12) {
      ctx.shadowBlur = 0;
      ctx.font = '750 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(String(event.label).slice(0, 9), x + w / 2, y + h / 2);
    }
    ctx.restore();
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

  _threadGeometry(width, height) {
    const laneCount = clamp(Math.floor(Number(this.getLaneCount()) || 1), 1, this.maxLanes);
    const top = height * 0.16;
    const bottom = height * 0.82;
    const nowX = width * 0.82;
    const left = width * 0.08;
    const floorY = height * 0.88;
    return {
      laneCount,
      top,
      bottom,
      nowX,
      left,
      floorY,
      spanX: nowX - left,
    };
  }

  _threadY(event, geom) {
    if (!Number.isFinite(Number(event.pitch))) {
      const sub = clamp(event.lane || 0, 0, geom.laneCount - 1);
      const spread = geom.laneCount <= 1 ? 0.5 : (sub / (geom.laneCount - 1));
      return geom.bottom - spread * (geom.bottom - geom.top);
    }
    const pitch = clamp(Number(event.pitch), 36, 96);
    const normalized = (pitch - 36) / 60;
    return geom.bottom - normalized * (geom.bottom - geom.top);
  }

  _drawThread(ctx, width, height) {
    const geom = this._threadGeometry(width, height);
    const now = performance.now();
    const events = this._eventsForFrame();
    const quality = this._qualityForEvents(events);
    const sweepMs = stageTrailMs(8200, quality);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const field = this._cachedGradient(ctx, 'thread-field', width, height, () => {
      const gradient = ctx.createLinearGradient(geom.left, 0, geom.nowX, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0.02)');
      gradient.addColorStop(0.72, 'rgba(90, 215, 255, 0.07)');
      gradient.addColorStop(1, 'rgba(255,255,255,0.12)');
      return gradient;
    });
    ctx.fillStyle = field;
    this._roundedRect(ctx, geom.left, geom.top - 24, geom.spanX, geom.floorY - geom.top + 48, 18);
    ctx.fill();

    for (let i = 0; i <= 6; i += 1) {
      const y = geom.top + (i / 6) * (geom.bottom - geom.top);
      ctx.strokeStyle = `rgba(255,255,255,${i === 3 ? 0.16 : 0.07})`;
      ctx.lineWidth = i === 3 ? 1.4 : 0.8;
      ctx.beginPath();
      ctx.moveTo(geom.left, y);
      ctx.lineTo(geom.nowX + 18, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.48)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(geom.nowX, geom.top - 34);
    ctx.lineTo(geom.nowX, geom.floorY + 16);
    ctx.stroke();
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillText('NOW', geom.nowX, geom.top - 42);

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(geom.left, geom.floorY);
    ctx.lineTo(geom.nowX + 20, geom.floorY);
    ctx.stroke();

    for (const event of events) {
      const startMs = event._visualStartMs || now;
      const endMs = event._active ? now : (event._visualEndMs || startMs + 120);
      const startAge = now - startMs;
      const endAge = now - endMs;
      const xStart = geom.nowX - clamp(startAge / sweepMs, 0, 1.16) * geom.spanX;
      const xEnd = geom.nowX - clamp(Math.max(0, endAge) / sweepMs, 0, 1.16) * geom.spanX;
      if (Math.max(xStart, xEnd) < geom.left - 20) continue;
      const y = this._threadY(event, geom);
      const velocity = event.velocity || 0.8;
      const glow = event.intensity?.glow ?? 0.35;
      const alpha = event._active ? 0.92 : 0.38 + velocity * 0.3;
      const lineWidth = event.type === 'hit'
        ? 2.5 + velocity * 5
        : 3 + velocity * 7 + glow * 5;

      ctx.save();
      ctx.shadowColor = rgba(event.accentColor, 0.74);
      ctx.shadowBlur = stageBlur(8 + glow * 26, quality);
      ctx.strokeStyle = rgba(event.color, alpha);
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      if (event.type === 'hit') {
        ctx.moveTo(xStart, geom.floorY + 6);
        ctx.lineTo(xEnd, y);
      } else {
        const bend = Math.sin((startMs * 0.002) + (event.pitch || 0)) * 10;
        const midX = (xStart + xEnd) / 2;
        ctx.moveTo(xStart, y + bend * 0.2);
        ctx.quadraticCurveTo(midX, y + bend, xEnd, y);
      }
      ctx.stroke();

      const headX = event._active ? xEnd : xStart;
      ctx.fillStyle = rgba(event.accentColor, Math.min(1, alpha + 0.12));
      ctx.beginPath();
      ctx.arc(headX, y, event.type === 'hit' ? 5 + velocity * 8 : 4 + velocity * 6, 0, Math.PI * 2);
      ctx.fill();

      if (event.label && event._active && width > 560) {
        ctx.shadowBlur = 0;
        ctx.font = '750 11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.fillText(String(event.label).slice(0, 10), Math.min(geom.nowX + 18, width - 64), y);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  _pulseGeometry(width, height) {
    const laneCount = clamp(Math.floor(Number(this.getLaneCount()) || 1), 1, this.maxLanes);
    const radius = Math.min(width, height) * 0.34;
    return {
      laneCount,
      cx: width * 0.5,
      cy: height * 0.52,
      inner: Math.max(36, radius * 0.28),
      outer: Math.max(82, radius),
    };
  }

  _drawPulse(ctx, width, height) {
    const geom = this._pulseGeometry(width, height);
    const events = this._eventsForFrame();
    const quality = this._qualityForEvents(events);
    const now = performance.now();
    const decayMs = stageTrailMs(2200, quality);
    const laneEnergy = Array.from({ length: geom.laneCount }, (_, index) => ({
      value: 0,
      color: '#7bd88f',
      label: this.getLaneLabel(index),
      hitCount: 0,
    }));

    for (const event of events) {
      const lane = clamp(event.lane, 0, geom.laneCount - 1);
      const eventEnd = event._active ? now : (event._visualEndMs || event._visualStartMs || now);
      const age = Math.max(0, now - eventEnd);
      const recency = event._active ? 1 : Math.max(0, 1 - age / decayMs);
      if (recency <= 0) continue;
      const sustainBoost = event._active ? 0.45 : 0;
      const intensity = event.intensity?.weight ?? 0.35;
      const value = recency * (0.35 + (event.velocity || 0.8) * 0.45 + intensity * 0.28 + sustainBoost);
      if (value > laneEnergy[lane].value) {
        laneEnergy[lane].value = value;
        laneEnergy[lane].color = event.accentColor || event.color || laneEnergy[lane].color;
        laneEnergy[lane].label = event.label || this.getLaneLabel(lane);
      }
      laneEnergy[lane].hitCount += 1;
    }

    ctx.save();
    ctx.translate(geom.cx, geom.cy);

    const halo = this._cachedGradient(ctx, 'pulse-halo', width, height, () => {
      const gradient = ctx.createRadialGradient(0, 0, geom.inner * 0.2, 0, 0, geom.outer * 1.28);
      gradient.addColorStop(0, 'rgba(255,255,255,0.09)');
      gradient.addColorStop(0.34, 'rgba(88, 221, 255, 0.10)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      return gradient;
    });
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, geom.outer * 1.28, 0, Math.PI * 2);
    ctx.fill();

    for (let ring = 0; ring < 4; ring += 1) {
      const r = geom.inner + ((geom.outer - geom.inner) * ring / 3);
      ctx.strokeStyle = `rgba(255,255,255,${ring === 0 ? 0.2 : 0.1})`;
      ctx.lineWidth = ring === 0 ? 1.4 : 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const gap = Math.min(0.03, (Math.PI * 2) / geom.laneCount * 0.16);
    const startOffset = -Math.PI / 2;
    for (let lane = 0; lane < geom.laneCount; lane += 1) {
      const slice = (Math.PI * 2) / geom.laneCount;
      const start = startOffset + lane * slice + gap;
      const end = startOffset + (lane + 1) * slice - gap;
      const energy = clamp(laneEnergy[lane].value, 0, 1.2);
      const color = laneEnergy[lane].color;
      const outer = geom.inner + (geom.outer - geom.inner) * (0.42 + energy * 0.58);
      const alpha = 0.16 + energy * 0.72;

      ctx.save();
      ctx.shadowColor = rgba(color, 0.58);
      ctx.shadowBlur = stageBlur(5 + energy * 24, quality);
      ctx.fillStyle = rgba(color, alpha);
      ctx.strokeStyle = rgba(color, 0.58 + energy * 0.34);
      ctx.lineWidth = 1 + energy * 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, outer, start, end);
      ctx.arc(0, 0, geom.inner, end, start, true);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      const mid = (start + end) / 2;
      const tickR = geom.outer + 12 + energy * 13;
      ctx.strokeStyle = rgba(color, 0.28 + energy * 0.54);
      ctx.lineWidth = 1.2 + energy * 2.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(mid) * (geom.outer + 3), Math.sin(mid) * (geom.outer + 3));
      ctx.lineTo(Math.cos(mid) * tickR, Math.sin(mid) * tickR);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '850 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PULSE', 0, -7);
    ctx.fillStyle = 'rgba(255,255,255,0.54)';
    ctx.font = '750 10px system-ui, sans-serif';
    const activeCount = laneEnergy.filter(lane => lane.value > 0.08).length;
    ctx.fillText(`${activeCount} active`, 0, 12);

    ctx.restore();

    if (width > 520 && quality.detail !== 'minimal') {
      const hot = laneEnergy
        .map((lane, index) => ({ ...lane, index }))
        .filter(lane => lane.value > 0.08)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
      ctx.save();
      ctx.font = '800 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      hot.forEach((lane, index) => {
        const x = 22;
        const y = 36 + index * 24;
        ctx.fillStyle = rgba(lane.color, 0.18 + lane.value * 0.22);
        this._roundedRect(ctx, x, y - 9, 142, 18, 9);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.fillText(String(lane.label || this.getLaneLabel(lane.index)).slice(0, 16), x + 10, y);
      });
      ctx.restore();
    }
  }

  _haloGeometry(width, height) {
    const radius = Math.min(width, height) * 0.34;
    return {
      cx: width * 0.5,
      cy: height * 0.52,
      inner: Math.max(42, radius * 0.38),
      outer: Math.max(110, radius),
      labelRadius: Math.max(126, radius + 28),
    };
  }

  _drawHalo(ctx, width, height) {
    const geom = this._haloGeometry(width, height);
    const events = this._eventsForFrame();
    const quality = this._qualityForEvents(events);
    const now = performance.now();
    const decayMs = stageTrailMs(4200, quality);
    const pitchEnergy = Array.from({ length: 12 }, () => ({
      value: 0,
      color: '#7bd88f',
      active: false,
    }));

    for (const event of events) {
      const pitch = Number(event.pitch);
      if (!Number.isFinite(pitch)) continue;
      const pitchClass = ((Math.round(pitch) % 12) + 12) % 12;
      const eventEnd = event._active ? now : (event._visualEndMs || event._visualStartMs || now);
      const age = Math.max(0, now - eventEnd);
      const recency = event._active ? 1 : Math.max(0, 1 - age / decayMs);
      if (recency <= 0) continue;
      const value = recency * (0.34 + (event.velocity || 0.8) * 0.42 + (event.intensity?.glow || 0.2) * 0.35);
      if (value > pitchEnergy[pitchClass].value) {
        pitchEnergy[pitchClass].value = value;
        pitchEnergy[pitchClass].color = event.accentColor || event.color || pitchEnergy[pitchClass].color;
      }
      pitchEnergy[pitchClass].active = pitchEnergy[pitchClass].active || event._active;
    }

    const pointForPitchClass = (pitchClass, radius = geom.outer) => {
      const orderIndex = Math.max(0, FIFTHS_PITCH_CLASSES.indexOf(pitchClass));
      const angle = -Math.PI / 2 + orderIndex * (Math.PI * 2 / 12);
      return {
        x: geom.cx + Math.cos(angle) * radius,
        y: geom.cy + Math.sin(angle) * radius,
        angle,
      };
    };

    ctx.save();
    const field = this._cachedGradient(ctx, 'halo-field', width, height, () => {
      const gradient = ctx.createRadialGradient(geom.cx, geom.cy, geom.inner * 0.2, geom.cx, geom.cy, geom.labelRadius * 1.25);
      gradient.addColorStop(0, 'rgba(255,255,255,0.08)');
      gradient.addColorStop(0.48, 'rgba(108, 226, 255, 0.08)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      return gradient;
    });
    ctx.fillStyle = field;
    ctx.beginPath();
    ctx.arc(geom.cx, geom.cy, geom.labelRadius * 1.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(geom.cx, geom.cy, geom.outer, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(geom.cx, geom.cy, geom.inner, 0, Math.PI * 2);
    ctx.stroke();

    const activePoints = FIFTHS_PITCH_CLASSES
      .filter(pitchClass => pitchEnergy[pitchClass].value > 0.08)
      .map(pitchClass => ({ pitchClass, ...pointForPitchClass(pitchClass, geom.outer * 0.76) }));

    if (activePoints.length > 1 && quality.detail !== 'minimal') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.24)';
      ctx.lineWidth = 1.4;
      ctx.shadowColor = 'rgba(125,216,255,0.34)';
      ctx.shadowBlur = stageBlur(16, quality);
      ctx.beginPath();
      activePoints.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    for (const pitchClass of FIFTHS_PITCH_CLASSES) {
      const energy = clamp(pitchEnergy[pitchClass].value, 0, 1.18);
      const color = pitchEnergy[pitchClass].color;
      const point = pointForPitchClass(pitchClass, geom.outer);
      const labelPoint = pointForPitchClass(pitchClass, geom.labelRadius);
      const dotRadius = 9 + energy * 22;

      ctx.save();
      ctx.shadowColor = rgba(color, 0.65);
      ctx.shadowBlur = stageBlur(8 + energy * 26, quality);
      ctx.fillStyle = rgba(color, 0.18 + energy * 0.72);
      ctx.strokeStyle = rgba(color, 0.36 + energy * 0.52);
      ctx.lineWidth = 1 + energy * 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = pitchEnergy[pitchClass].active ? '#fff' : 'rgba(255,255,255,0.68)';
      ctx.font = `${pitchEnergy[pitchClass].active ? 850 : 750} ${energy > 0.3 ? 13 : 11}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(PITCH_CLASS_LABELS[pitchClass], labelPoint.x, labelPoint.y);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '850 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HALO', geom.cx, geom.cy - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.54)';
    ctx.font = '750 10px system-ui, sans-serif';
    const activeCount = pitchEnergy.filter(item => item.value > 0.08).length;
    ctx.fillText(`${activeCount} tones`, geom.cx, geom.cy + 12);
    ctx.restore();
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
