import './stage.css';

import { STAGE_TRACK_LIMIT } from './StageModel.js';

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

    this.el = null;
    this.canvas = null;
    this.ctx = null;
    this._raf = null;
    this._unsubscribe = null;
    this._liveEvents = [];
    this._liveLimit = 180;
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
        <button class="btn btn--ghost stage-overlay__close" type="button">Close Stage</button>
      </div>
      ${this.mode === 'live' ? this._renderInputStrip() : ''}
      <canvas class="stage-overlay__canvas" aria-label="Stage performance visualization"></canvas>
      <div class="stage-overlay__hint">${this.mode === 'canvas' ? 'Play the canvas to watch clips travel through their lanes.' : 'Play pads, keys, kit, or controller bindings to light the lanes.'}</div>
    `;
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.el.querySelector('.stage-overlay__close')?.addEventListener('click', () => this.close());
    this._bindInputStrip();
    document.body.appendChild(this.el);

    if (this.eventStream) {
      this._unsubscribe = this.eventStream.subscribe(payload => this._receiveStreamEvent(payload));
    }
    this._draw();
  }

  _renderInputStrip() {
    const items = (this.getInputItems() || []).slice(0, STAGE_TRACK_LIMIT);
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

  close({ silent = false } = {}) {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.el?.remove();
    this.el = null;
    this.canvas = null;
    this.ctx = null;
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
    this._drawHighway(ctx, width, height);
    this._drawEvents(ctx, width, height);
    this._raf = requestAnimationFrame(this._draw);
  };

  _drawBackground(ctx, width, height) {
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#02040a');
    bg.addColorStop(0.46, '#070a11');
    bg.addColorStop(1, '#020203');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(width * 0.5, height * 0.2, 20, width * 0.5, height * 0.18, width * 0.75);
    glow.addColorStop(0, 'rgba(63, 232, 255, 0.20)');
    glow.addColorStop(0.44, 'rgba(234, 87, 255, 0.08)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  _laneGeometry(width, height) {
    const laneCount = clamp(Math.floor(Number(this.getLaneCount()) || 1), 1, STAGE_TRACK_LIMIT);
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
    const laneCount = clamp(Math.floor(Number(this.getLaneCount()) || 1), 1, STAGE_TRACK_LIMIT);
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
      this._drawCanvasEvent(ctx, geom, event, minX, maxX);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.textAlign = 'center';
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.fillText('NOW', geom.playheadX, geom.top - 24);
    ctx.restore();
  }

  _drawCanvasEvent(ctx, geom, event, minX, maxX) {
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
    ctx.shadowBlur = event.type === 'clip' ? 8 : 10 + glow * 18;
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
    this._liveEvents = this._liveEvents.filter(event => event._active || now - (event._visualEndMs || event._visualStartMs) < 3200);
    return this._liveEvents.map(event => ({ ...normalizeEvent(event), _visualStartMs: event._visualStartMs, _visualEndMs: event._visualEndMs, _active: event._active }));
  }

  _drawEvents(ctx, width, height) {
    const geom = this._laneGeometry(width, height);
    const nowTick = Math.max(0, Math.floor(Number(this.getNowTick()) || 0));
    const unitTicks = Math.max(1, Number(this.getUnitTicks()) || 480);
    const horizonTicks = unitTicks * 16;
    const events = this._eventsForFrame();
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
      this._drawEventShape(ctx, geom, lane, zStart, zEnd, event);
    }
  }

  _drawEventShape(ctx, geom, lane, zStart, zEnd, event) {
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
    ctx.shadowBlur = 8 + glow * 28;
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
}
