/**
 * stageDrawViews — Per-view canvas drawing routines for CanvasStageRenderer
 * (highway, canvas-map, thread, pulse, pocket, halo) plus their geometry helpers.
 *
 * Split out of CanvasStageRenderer for size and composed back onto its prototype
 * via Object.assign. Method bodies are unchanged; shared draw helpers
 * (_drawEvents/_drawEventShape/_roundedRect/_cachedGradient/...) remain on the class.
 */

import { clamp, rgba, FIFTHS_PITCH_CLASSES, PITCH_CLASS_LABELS } from './stageDrawUtils.js';
import { pocketActiveSpan, pocketEventPhase } from './StagePocketModel.js';
import { stageBlur, stageTrailMs } from './StageRenderQuality.js';

export const StageDrawViewsMixin = {
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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  _threadY(event, geom) {
    if (!Number.isFinite(Number(event.pitch))) {
      const sub = clamp(event.lane || 0, 0, geom.laneCount - 1);
      const spread = geom.laneCount <= 1 ? 0.5 : (sub / (geom.laneCount - 1));
      return geom.bottom - spread * (geom.bottom - geom.top);
    }
    const pitch = clamp(Number(event.pitch), 36, 96);
    const normalized = (pitch - 36) / 60;
    return geom.bottom - normalized * (geom.bottom - geom.top);
  },

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
  },

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
  },

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
  },

  _haloGeometry(width, height) {
    const radius = Math.min(width, height) * 0.34;
    return {
      cx: width * 0.5,
      cy: height * 0.52,
      inner: Math.max(42, radius * 0.38),
      outer: Math.max(110, radius),
      labelRadius: Math.max(126, radius + 28),
    };
  },

  _pocketGeometry(width, height) {
    const laneCount = clamp(Math.floor(Number(this.getLaneCount()) || 1), 1, this.maxLanes);
    const radius = Math.min(width, height) * 0.34;
    const outer = Math.max(106, radius);
    const inner = Math.max(38, outer * 0.24);
    const ringGap = laneCount <= 1 ? 0 : (outer - inner) / Math.max(1, laneCount - 1);
    const laneRadius = (lane) => laneCount <= 1 ? (inner + outer) / 2 : outer - lane * ringGap;
    return {
      laneCount,
      cx: width * 0.5,
      cy: height * 0.52,
      inner,
      outer,
      laneRadius,
    };
  },

  _drawPocket(ctx, width, height) {
    const geom = this._pocketGeometry(width, height);
    const events = this._eventsForFrame();
    const quality = this._qualityForEvents(events);
    const now = performance.now();
    const nowTick = Math.max(0, Math.floor(Number(this.getNowTick()) || 0));
    const unitTicks = Math.max(1, Number(this.getUnitTicks()) || 480);
    const unitSeconds = Number(this.getUnitSeconds?.());
    const unitMs = Number.isFinite(unitSeconds) && unitSeconds > 0 ? unitSeconds * 1000 : 2000;
    const decayMs = stageTrailMs(2800, quality);
    const startOffset = -Math.PI / 2;
    const laneEnergy = Array.from({ length: geom.laneCount }, (_, index) => ({
      value: 0,
      color: '#7bd88f',
      label: this.getLaneLabel(index),
      hits: 0,
    }));

    const pointAt = (phase, radius) => {
      const angle = startOffset + phase * Math.PI * 2;
      return {
        angle,
        x: geom.cx + Math.cos(angle) * radius,
        y: geom.cy + Math.sin(angle) * radius,
      };
    };

    ctx.save();
    const field = this._cachedGradient(ctx, 'pocket-field', width, height, () => {
      const gradient = ctx.createRadialGradient(geom.cx, geom.cy, geom.inner * 0.2, geom.cx, geom.cy, geom.outer * 1.36);
      gradient.addColorStop(0, 'rgba(255,255,255,0.08)');
      gradient.addColorStop(0.42, 'rgba(90, 255, 196, 0.09)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      return gradient;
    });
    ctx.fillStyle = field;
    ctx.beginPath();
    ctx.arc(geom.cx, geom.cy, geom.outer * 1.36, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let lane = 0; lane < geom.laneCount; lane += 1) {
      const r = geom.laneRadius(lane);
      const strong = lane === 0 || lane === geom.laneCount - 1;
      ctx.strokeStyle = `rgba(255,255,255,${strong ? 0.17 : 0.075})`;
      ctx.lineWidth = strong ? 1.4 : 0.7;
      ctx.beginPath();
      ctx.arc(geom.cx, geom.cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let tick = 0; tick < 16; tick += 1) {
      const phase = tick / 16;
      const start = pointAt(phase, geom.inner - 8);
      const end = pointAt(phase, geom.outer + (tick % 4 === 0 ? 18 : 9));
      const strong = tick % 4 === 0;
      ctx.strokeStyle = `rgba(255,255,255,${strong ? 0.22 : 0.08})`;
      ctx.lineWidth = strong ? 1.4 : 0.75;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }

    const nowLine = pointAt(0, geom.outer + 24);
    ctx.strokeStyle = 'rgba(255,255,255,0.62)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(geom.cx, geom.cy - geom.inner + 4);
    ctx.lineTo(nowLine.x, nowLine.y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NOW', nowLine.x, nowLine.y - 12);

    for (const event of events) {
      const lane = clamp(event.lane, 0, geom.laneCount - 1);
      const eventEnd = event._active ? now : (event._visualEndMs || event._visualStartMs || now);
      const age = Math.max(0, now - eventEnd);
      const recency = event._active ? 1 : Math.max(0, 1 - age / decayMs);
      if (recency <= 0) continue;

      const radius = geom.laneRadius(lane);
      const phase = pocketEventPhase(event, { nowTick, unitTicks });
      const spanPhase = pocketActiveSpan(event, { currentMs: now, unitMs });
      const endTick = event.endTick ?? event.startTick + (event.durationTick || Math.max(1, Math.round(unitTicks * spanPhase)));
      const tickPhase = Math.abs(endTick - event.startTick) / unitTicks;
      const durationPhase = clamp(Math.max(spanPhase, tickPhase), event._active ? 0.08 : 0.035, 1);
      const color = event.accentColor || event.color || laneEnergy[lane].color;
      const velocity = event.velocity || 0.8;
      const glow = event.intensity?.glow ?? 0.35;
      const alpha = event._active ? 0.92 : 0.28 + recency * 0.54;
      const point = pointAt(phase, radius);
      const lineWidth = event.type === 'hit' ? 3 + velocity * 5 : 2.2 + velocity * 3.4 + glow * 2.8;

      laneEnergy[lane].value = Math.max(laneEnergy[lane].value, recency * (0.4 + velocity * 0.42 + glow * 0.25));
      laneEnergy[lane].color = color;
      laneEnergy[lane].label = event.label || this.getLaneLabel(lane);
      laneEnergy[lane].hits += 1;

      ctx.save();
      ctx.shadowColor = rgba(color, 0.72);
      ctx.shadowBlur = stageBlur(8 + glow * 24, quality);
      ctx.strokeStyle = rgba(color, alpha);
      ctx.lineWidth = lineWidth;
      if (event.type !== 'hit' && durationPhase > 0.04) {
        ctx.beginPath();
        ctx.arc(
          geom.cx,
          geom.cy,
          radius,
          startOffset + (phase - durationPhase) * Math.PI * 2,
          startOffset + phase * Math.PI * 2
        );
        ctx.stroke();
      }
      ctx.fillStyle = rgba(color, Math.min(1, alpha + 0.16));
      ctx.beginPath();
      ctx.arc(point.x, point.y, event.type === 'hit' ? 5 + velocity * 8 : 4 + velocity * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (event.label && event._active && width > 560 && quality.detail === 'full') {
        ctx.save();
        ctx.font = '750 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.fillText(String(event.label).slice(0, 8), point.x, point.y - 10);
        ctx.restore();
      }
    }

    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.font = '850 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('POCKET', geom.cx, geom.cy - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.54)';
    ctx.font = '750 10px system-ui, sans-serif';
    const activeCount = laneEnergy.filter(lane => lane.value > 0.08).length;
    ctx.fillText(`${activeCount} lanes`, geom.cx, geom.cy + 12);
    ctx.restore();

    if (width > 560 && quality.detail !== 'minimal') {
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
        const y = 38 + index * 24;
        ctx.fillStyle = rgba(lane.color, 0.16 + lane.value * 0.24);
        this._roundedRect(ctx, x, y - 9, 150, 18, 9);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.fillText(String(lane.label || this.getLaneLabel(lane.index)).slice(0, 16), x + 10, y);
      });
      ctx.restore();
    }
  },

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
  },
};
