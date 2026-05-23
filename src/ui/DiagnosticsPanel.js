import './diagnostics.css';

import {
  METER_PICKER_IDS,
  METER_PRESETS,
  pulseCountForMeter,
  pulseTicksForMeter,
  secondsPerTickForMeter,
  ticksPerBarForMeter,
} from '../engine/Meter.js';
import { Transport } from '../engine/Transport.js';

const MATRIX_BPMS = [60, 120, 240];
const MATRIX_BARS = 4;

function fmt(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : '--';
}

function statusForMs(ms) {
  const abs = Math.abs(ms);
  if (abs <= 1) return 'pass';
  if (abs <= 50) return 'warn';
  return 'fail';
}

function statusForRuntimeMs(ms) {
  const abs = Math.abs(ms);
  if (abs <= 50) return 'pass';
  if (abs <= 100) return 'warn';
  return 'fail';
}

function statusLabel(status) {
  if (status === 'pass') return 'PASS';
  if (status === 'warn') return 'WARN';
  return 'FAIL';
}

function expectedSeconds(meter, bpm, bars = MATRIX_BARS) {
  return bars * pulseCountForMeter(meter) * (60 / Math.max(1, bpm));
}

function computedSeconds(meter, bpm, bars = MATRIX_BARS, ticksPerQuarter = 480) {
  return bars * ticksPerBarForMeter(meter, ticksPerQuarter) * secondsPerTickForMeter(meter, bpm, ticksPerQuarter);
}

function matrixRows(ticksPerQuarter = 480) {
  return METER_PICKER_IDS.flatMap(id => MATRIX_BPMS.map(bpm => {
    const meter = METER_PRESETS[id];
    const expected = expectedSeconds(meter, bpm, MATRIX_BARS);
    const computed = computedSeconds(meter, bpm, MATRIX_BARS, ticksPerQuarter);
    const deviationMs = (computed - expected) * 1000;
    return { id, bpm, expected, computed, deviationMs, status: statusForMs(deviationMs) };
  }));
}

function pairInvariantRows(rows) {
  const pairs = [['2/4', '6/8'], ['2/4', '5/8'], ['3/4', '9/8'], ['3/4', '7/8'], ['4/4', '12/8']];
  const byKey = new Map(rows.map(row => [`${row.id}:${row.bpm}`, row]));
  return pairs.flatMap(([left, right]) => MATRIX_BPMS.map(bpm => {
    const a = byKey.get(`${left}:${bpm}`);
    const b = byKey.get(`${right}:${bpm}`);
    const deviationMs = ((a?.computed || 0) - (b?.computed || 0)) * 1000;
    return { label: `${left} = ${right} at ${bpm} BPM`, deviationMs, status: statusForMs(deviationMs) };
  }));
}

function linearityRows(rows) {
  const byKey = new Map(rows.map(row => [`${row.id}:${row.bpm}`, row]));
  return METER_PICKER_IDS.flatMap(id => {
    const at60 = byKey.get(`${id}:60`)?.computed;
    const at120 = byKey.get(`${id}:120`)?.computed;
    const at240 = byKey.get(`${id}:240`)?.computed;
    const ratioA = at60 / at120;
    const ratioB = at120 / at240;
    return [
      { label: `${id} 60/120`, ratio: ratioA, status: Math.abs(ratioA - 2) <= 0.1 ? 'pass' : 'fail' },
      { label: `${id} 120/240`, ratio: ratioB, status: Math.abs(ratioB - 2) <= 0.1 ? 'pass' : 'fail' },
    ];
  });
}

export class DiagnosticsPanel {
  constructor({ transport }) {
    this.transport = transport;
    this.el = null;
    this._raf = null;
    this._runtimeTransport = null;
    this._runtimeRunning = false;
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'diagnostics-panel';
    this.el.innerHTML = `
      <div class="settings-section diagnostics-panel__section">
        <div class="settings-group">
          <h3 class="settings-group__title">Diagnostics</h3>
          <p class="settings-desc">Developer-only timing checks. Math checks validate the meter helpers; the runtime check uses an isolated silent transport and never touches the active project playback.</p>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Live Timing</h3>
          <div class="diagnostics-grid" id="diag-live-grid"></div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Meter Math</h3>
          <div class="diagnostics-actions">
            <button class="btn btn--ghost btn--sm" id="diag-current" type="button">Check meter math</button>
            <button class="btn btn--ghost btn--sm" id="diag-matrix" type="button">Check meter matrix</button>
            <button class="btn btn--ghost btn--sm" id="diag-runtime" type="button">Measure live tempo</button>
          </div>
          <div class="diagnostics-result" id="diag-result">No run yet.</div>
        </div>
      </div>
    `;
    this._bind();
    this._startLiveLoop();
    return this.el;
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._stopRuntimeTransport();
  }

  _bind() {
    this.el.querySelector('#diag-current')?.addEventListener('click', () => {
      this._renderCurrentResult();
    });
    this.el.querySelector('#diag-matrix')?.addEventListener('click', () => {
      this._renderMatrixResult();
    });
    this.el.querySelector('#diag-runtime')?.addEventListener('click', () => {
      this._measureRuntimeTempo();
    });
  }

  _startLiveLoop() {
    const tick = () => {
      this._renderLiveTiming();
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  _renderLiveTiming() {
    const grid = this.el?.querySelector('#diag-live-grid');
    if (!grid || !this.transport) return;
    const meter = this.transport.meter || METER_PRESETS['4/4'];
    const pulses = pulseTicksForMeter(meter, this.transport.ticksPerBeat || 480);
    const rows = [
      ['Meter', `${meter.id || '4/4'}${meter.feelName ? ` (${meter.feelName})` : ''}`],
      ['Pulse count', String(this.transport.pulseCount || pulseCountForMeter(meter))],
      ['Grouping', JSON.stringify(meter.grouping || [])],
      ['BPM', String(this.transport.bpm)],
      ['seconds/tick', fmt(this.transport.secondsPerTick, 6)],
      ['ticks/sec', fmt(1 / this.transport.secondsPerTick, 1)],
      ['ticks/bar', String(this.transport.ticksPerBar)],
      ['ticks/pulse', pulses.join(', ')],
      ['current bar', String(this.transport.currentBar + 1)],
      ['current pulse', String(this.transport.currentBeat + 1)],
      ['current tick', `${this.transport.currentTick} (raw ${this.transport.currentRawTick})`],
    ];
    grid.innerHTML = rows.map(([label, value]) => `
      <div class="diagnostics-grid__label">${label}</div>
      <div class="diagnostics-grid__value">${value}</div>
    `).join('');
  }

  _renderCurrentResult() {
    const meter = this.transport?.meter || METER_PRESETS['4/4'];
    const bpm = this.transport?.bpm || 120;
    const ticksPerQuarter = this.transport?.ticksPerBeat || 480;
    const expected = expectedSeconds(meter, bpm, 8);
    const computed = computedSeconds(meter, bpm, 8, ticksPerQuarter);
    const deviationMs = (computed - expected) * 1000;
    const status = statusForMs(deviationMs);
    this._setResult(`
      <div class="diagnostics-summary diagnostics-summary--${status}">
        <strong>${statusLabel(status)}</strong>
        <span>Meter.js helper check: ${meter.id || '4/4'} at ${bpm} BPM, 8 bars</span>
      </div>
      <div class="diagnostics-grid diagnostics-grid--compact">
        <div class="diagnostics-grid__label">Expected</div><div class="diagnostics-grid__value">${fmt(expected)} s</div>
        <div class="diagnostics-grid__label">Computed</div><div class="diagnostics-grid__value">${fmt(computed)} s</div>
        <div class="diagnostics-grid__label">Deviation</div><div class="diagnostics-grid__value">${fmt(deviationMs, 2)} ms</div>
      </div>
    `);
  }

  _renderMatrixResult() {
    const rows = matrixRows(this.transport?.ticksPerBeat || 480);
    const pairRows = pairInvariantRows(rows);
    const lineRows = linearityRows(rows);
    const failures = [
      ...rows.filter(row => row.status === 'fail'),
      ...pairRows.filter(row => row.status === 'fail'),
      ...lineRows.filter(row => row.status === 'fail'),
    ];
    const warnings = rows.filter(row => row.status === 'warn');
    const status = failures.length ? 'fail' : warnings.length ? 'warn' : 'pass';
    this._setResult(`
      <div class="diagnostics-summary diagnostics-summary--${status}">
        <strong>${statusLabel(status)}</strong>
        <span>Meter.js matrix: ${rows.length} tempo cells, ${pairRows.length} pair checks, ${lineRows.length} linearity checks</span>
      </div>
      <div class="diagnostics-table" role="table" aria-label="Tempo matrix results">
        <div class="diagnostics-table__row diagnostics-table__row--head">
          <span>Meter</span><span>BPM</span><span>Expected</span><span>Computed</span><span>Drift</span>
        </div>
        ${rows.map(row => `
          <div class="diagnostics-table__row diagnostics-table__row--${row.status}">
            <span>${row.id}</span>
            <span>${row.bpm}</span>
            <span>${fmt(row.expected)}s</span>
            <span>${fmt(row.computed)}s</span>
            <span>${fmt(row.deviationMs, 2)}ms</span>
          </div>
        `).join('')}
      </div>
      <details class="diagnostics-details">
        <summary>Pair and linearity checks</summary>
        <div class="diagnostics-list">
          ${pairRows.map(row => `<div class="diagnostics-list__item diagnostics-list__item--${row.status}">${row.label}: ${fmt(row.deviationMs, 2)}ms</div>`).join('')}
          ${lineRows.map(row => `<div class="diagnostics-list__item diagnostics-list__item--${row.status}">${row.label}: ${fmt(row.ratio, 3)}</div>`).join('')}
        </div>
      </details>
    `);
  }

  async _measureRuntimeTempo() {
    if (this._runtimeRunning) return;
    const button = this.el?.querySelector('#diag-runtime');
    if (button) button.disabled = true;
    this._runtimeRunning = true;
    this._setResult('<div class="diagnostics-summary"><strong>RUNNING</strong><span>Measuring isolated silent transport...</span></div>');

    try {
      const result = await this._runIsolatedTempoMeasurement();
      const status = statusForRuntimeMs(result.deviationMs);
      const pulseText = result.pulseDurations.map(value => `${fmt(value, 3)}s`).join(', ');
      this._setResult(`
        <div class="diagnostics-summary diagnostics-summary--${status}">
          <strong>${statusLabel(status)}</strong>
          <span>Runtime transport: ${result.meterId} at ${result.bpm} BPM, ${result.bars} bars</span>
        </div>
        <div class="diagnostics-grid diagnostics-grid--compact">
          <div class="diagnostics-grid__label">Expected</div><div class="diagnostics-grid__value">${fmt(result.expected)} s</div>
          <div class="diagnostics-grid__label">Measured</div><div class="diagnostics-grid__value">${fmt(result.measured)} s</div>
          <div class="diagnostics-grid__label">Deviation</div><div class="diagnostics-grid__value">${fmt(result.deviationMs, 2)} ms</div>
          <div class="diagnostics-grid__label">Pulse gaps</div><div class="diagnostics-grid__value">${pulseText || '--'}</div>
        </div>
      `);
    } catch (err) {
      this._setResult(`
        <div class="diagnostics-summary diagnostics-summary--fail">
          <strong>FAIL</strong>
          <span>${err?.message || 'Runtime tempo measurement failed'}</span>
        </div>
      `);
    } finally {
      this._runtimeRunning = false;
      if (button) button.disabled = false;
      this._stopRuntimeTransport();
    }
  }

  _runIsolatedTempoMeasurement() {
    const source = this.transport;
    const meter = source?.meter || METER_PRESETS['4/4'];
    const bpm = source?.bpm || 120;
    const ticksPerBeat = source?.ticksPerBeat || 480;
    const bars = 4;
    const expected = expectedSeconds(meter, bpm, bars);
    const timeoutMs = Math.max(3000, (expected + 1.5) * 1000);

    return new Promise((resolve, reject) => {
      const runtime = new Transport();
      this._runtimeTransport = runtime;
      runtime.meter = meter;
      runtime.bpm = bpm;
      runtime.ticksPerBeat = ticksPerBeat;
      runtime.loopEnabled = false;

      const barTimes = [];
      const beatTimes = [];
      const offBar = runtime.onBar((bar, time) => {
        if (bar < 0) return;
        barTimes.push({ bar, time });
        if (barTimes.length >= bars + 1) finish();
      });
      const offBeat = runtime.onBeat((beat, time) => {
        if (beatTimes.length < 16) beatTimes.push({ beat, time });
      });

      const cleanup = () => {
        clearTimeout(timeout);
        offBar();
        offBeat();
        runtime.stop();
        if (this._runtimeTransport === runtime) this._runtimeTransport = null;
      };

      const finish = () => {
        const start = barTimes[0];
        const end = barTimes[bars];
        if (!start || !end) {
          cleanup();
          reject(new Error('Not enough bar callbacks captured'));
          return;
        }
        const measured = end.time - start.time;
        const pulseDurations = [];
        for (let i = 1; i < beatTimes.length; i += 1) {
          const prev = beatTimes[i - 1];
          const next = beatTimes[i];
          if (next.time > prev.time) pulseDurations.push(next.time - prev.time);
        }
        cleanup();
        resolve({
          meterId: meter.id || '4/4',
          bpm,
          bars,
          expected,
          measured,
          deviationMs: (measured - expected) * 1000,
          pulseDurations,
        });
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Runtime tempo measurement timed out'));
      }, timeoutMs);

      runtime.seekToBar(0);
      runtime.play();
    });
  }

  _stopRuntimeTransport() {
    if (!this._runtimeTransport) return;
    this._runtimeTransport.stop();
    this._runtimeTransport = null;
  }

  _setResult(html) {
    const result = this.el?.querySelector('#diag-result');
    if (result) result.innerHTML = html;
  }
}
