/**
 * TransportBar — UI component for the top transport controls.
 * Play/Pause, Stop, Record, BPM, Metronome, Beat Indicator, Loop controls.
 */

import { TransportState } from '../engine/Transport.js';
import { ARP_MODES } from '../engine/ArpeggioManager.js';
import { NOTE_CORRECTION_MODES, NOTE_NAMES, SCALES, normalizeMusicalContext, normalizeNoteCorrectionMode, scaleDescription, scaleFamilyLabel } from '../engine/MusicTheory.js';
import { ALLOWED_GROUPINGS, METER_PICKER_IDS, METER_PRESETS, meterLabel, normalizeMeter, pulseCountForMeter } from '../engine/Meter.js';
import { normalizeProgressionContext, progressionChoiceGroups, progressionLabel, progressionPreset } from '../engine/Progressions.js';
import { ChoicePicker } from './ChoicePicker.js';

export class TransportBar {
  /**
   * @param {Transport} transport
   * @param {Metronome} metronome
   */
  constructor(transport, metronome) {
    this.transport = transport;
    this.metronome = metronome;
    this.el = null;
    this._beatDots = [];
    this.onSettingsClick = null;
    this.onBackupClick = null;
    this.onArpClick = null;
    this.onKeysClick = null;
    this.onModResetClick = null;
    this.onPanicClick = null;
    this.onArmRecordClick = null;
    this.onProjectKeyChange = null;
    this.onProjectMeterChange = null;
    this.onProjectProgressionChange = null;
    this.onDroneToggle = null;
    this.onBpmChange = null;
    this.onMoreOpen = null;
    this._lastMoreToggle = 0;
    this._lastStopPress = 0;
    this._recordArmed = false;
    this._projectKey = normalizeMusicalContext();
    this._projectMeter = normalizeMeter('4/4');
    this._projectProgression = normalizeProgressionContext();
    this._scalePicker = null;
    this._progressionPicker = null;
    this._droneActive = false;
  }

  setDroneActive(active) {
    this._droneActive = !!active;
    const button = this.el?.querySelector('#project-drone-toggle');
    if (button) {
      button.classList.toggle('is-active', this._droneActive);
      button.setAttribute('aria-pressed', this._droneActive ? 'true' : 'false');
    }
  }

  /**
   * Render the transport bar and return the DOM element.
   * @returns {HTMLElement}
   */
  render() {
    this.el = document.createElement('div');
    this.el.className = 'transport-bar';
    this.el.id = 'transport-bar';

    this.el.innerHTML = `
      <div class="transport-bar__section">
        <button class="btn btn--icon" id="btn-stop" title="Stop" aria-label="Stop">
          <svg width="18" height="18" viewBox="0 0 18 18"><rect x="3" y="3" width="12" height="12" rx="2" fill="currentColor"/></svg>
        </button>
        <button class="btn btn--icon" id="btn-play" title="Play / Pause" aria-label="Play or Pause">
          <svg width="18" height="18" viewBox="0 0 18 18" id="play-icon">
            <polygon points="4,2 16,9 4,16" fill="currentColor"/>
          </svg>
        </button>
        <button class="btn btn--icon btn--record" id="btn-record" title="Record" aria-label="Record">
          <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>
        </button>
        <button class="btn btn--ghost btn--arm-record" id="btn-arm-record" type="button" title="Arm recording. Recording starts on the first note or drum hit." aria-label="Arm recording">Arm</button>
      </div>

      <div class="beat-indicator" id="beat-indicator">
        ${this._renderBeatDots()}
      </div>

      <div class="transport-bar__bpm">
        <input type="number" id="bpm-input" value="${this.transport.bpm}" min="40" max="240" aria-label="BPM" style="width:56px;" />
        <button class="transport-bar__bpm-button" id="bpm-button" type="button" aria-label="Change BPM">${this.transport.bpm}</button>
        <span>BPM</span>
      </div>

      <div class="transport-bar__project-key" aria-label="Project key and scale">
        <span class="transport-bar__project-key-label">Key</span>
        <select id="project-root-select" aria-label="Project root note">
          ${NOTE_NAMES.map(note => `<option value="${note}" ${note === this._projectKey.root ? 'selected' : ''}>${note}</option>`).join('')}
        </select>
        <button class="choice-picker-button transport-bar__scale-picker" id="project-scale-picker" type="button" aria-label="Project scale" aria-haspopup="dialog">
          <span class="choice-picker-button__label" id="project-scale-label">${this._scaleLabel(this._projectKey.scale)}</span>
          <span class="choice-picker-button__chevron" aria-hidden="true">▼</span>
        </button>
        <button class="choice-picker-button transport-bar__progression-picker" id="project-progression-picker" type="button" aria-label="Progression changes" aria-haspopup="dialog">
          <span class="choice-picker-button__label" id="project-progression-label">${this._progressionButtonLabel(this._projectProgression)}</span>
          <span class="choice-picker-button__chevron" aria-hidden="true">▼</span>
        </button>
        <button class="transport-bar__drone" id="project-drone-toggle" type="button" aria-pressed="false" aria-label="Drone — sustain the root of the key" title="Sustain the root of the key as a tonal anchor">Drone</button>
        <span class="transport-bar__project-key-label">Correction</span>
        <select id="project-correction-select" aria-label="Piano and MIDI scale correction">
          ${Object.values(NOTE_CORRECTION_MODES).map(mode => `<option value="${mode.id}" ${mode.id === this._projectKey.correction ? 'selected' : ''}>${mode.label}</option>`).join('')}
        </select>
        <span class="transport-bar__project-key-label">Meter</span>
        <select id="project-meter-select" aria-label="Project meter">
          ${METER_PICKER_IDS.map(id => {
            const meter = METER_PRESETS[id];
            return `<option value="${id}" ${id === this._projectMeter.id ? 'selected' : ''}>${meterLabel(meter)}</option>`;
          }).join('')}
        </select>
        <select id="project-meter-grouping-select" aria-label="Meter grouping" ${ALLOWED_GROUPINGS[this._projectMeter.id] ? '' : 'hidden disabled'}>
          ${this._renderGroupingOptions()}
        </select>
      </div>

      <div class="transport-bar__spacer"></div>

      <div class="transport-bar__more" id="tb-more">
        <button class="btn btn--ghost arp-toggle" id="btn-arp" title="Hold/Arpeggio" aria-label="Cycle hold/arpeggio mode" style="min-height:32px;padding:2px 10px;font-size:0.75rem;border-radius:var(--radius-sm);min-width:54px;">
          <span class="transport-bar__menu-icon">OFF</span>
          <span class="transport-bar__menu-label">Hold / Arp</span>
        </button>
        <span class="transport-bar__mod" id="mod-display" style="font-size:0.65rem;color:var(--text-tertiary);display:flex;gap:8px;align-items:center;">
          <span>Pitch <span id="mod-pitch" style="color:var(--accent-light);">0%</span></span>
          <span>Mod <span id="mod-mod" style="color:var(--accent-light);">0%</span></span>
          <button id="mod-reset-btn" style="font-size:0.55rem;background:none;border:1px solid var(--surface-3);border-radius:3px;color:var(--text-tertiary);cursor:pointer;padding:0 3px;line-height:1.2;" title="Reset pitch and modulation">↺</button>
        </span>

        <div class="metronome-toggle" id="metronome-toggle">
          <button class="btn btn--icon btn--ghost" id="btn-metronome" title="Metronome" aria-label="Toggle metronome">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L6 22h12L12 2z"/>
              <line x1="12" y1="8" x2="16" y2="4"/>
            </svg>
            <span class="transport-bar__menu-label">Metronome</span>
          </button>
        </div>
        <button class="btn btn--icon btn--ghost" id="btn-keys" title="Keyboard shortcuts" aria-label="Show keyboard shortcuts">
          <span class="transport-bar__menu-icon">⌨</span>
          <span class="transport-bar__menu-label">Keyboard Controls</span>
        </button>
        <button class="btn btn--ghost backup-status is-unknown" id="btn-backup-status" title="Open backup status" aria-label="Open backup status">
          <span class="transport-bar__menu-icon" id="backup-status-label">Backup</span>
          <span class="transport-bar__menu-label">Backup Status</span>
        </button>
        <button class="btn btn--icon btn--ghost" id="btn-settings" title="Settings" aria-label="Open settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span class="transport-bar__menu-label">Settings</span>
        </button>
      </div>

      <button class="btn btn--icon btn--ghost transport-bar__more-btn" id="tb-more-btn" title="More" aria-label="More options" aria-expanded="false">⋯</button>
    `;

    this._beatDots = this.el.querySelectorAll('.beat-indicator__dot');
    this._bindEvents();
    return this.el;
  }

  _bindEvents() {
    // Play/pause
    this.el.querySelector('#btn-play').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.transport.toggle();
    });

    // Stop
    this.el.querySelector('#btn-stop').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const now = Date.now();
      const isDoubleStop = now - this._lastStopPress < 650;
      this._lastStopPress = now;
      if (this._recordArmed && this.onArmRecordClick) this.onArmRecordClick(false);
      this.transport.stop();
      if (isDoubleStop && this.onPanicClick) this.onPanicClick();
    });

    // Record
    this.el.querySelector('#btn-record').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.setRecordArmed(false);
      if (this.transport.state === TransportState.RECORDING) {
        this.transport.pause();
      } else {
        this.transport.record();
      }
    });

    this.el.querySelector('#btn-arm-record')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.onArmRecordClick) this.onArmRecordClick(!this._recordArmed);
    });

    // BPM input
    const bpmInput = this.el.querySelector('#bpm-input');
    bpmInput.addEventListener('change', () => {
      this._setBpm(parseInt(bpmInput.value, 10) || 120);
    });
    this.el.querySelector('#bpm-button')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._openBpmModal();
    });
    this.el.querySelector('#bpm-button')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this._openBpmModal();
    });

    this.el.querySelector('#project-root-select')?.addEventListener('change', () => this._emitProjectKeyChange());
    this.el.querySelector('#project-scale-picker')?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this._openScalePicker(event.currentTarget);
    });
    this.el.querySelector('#project-progression-picker')?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this._openProgressionPicker(event.currentTarget);
    });
    this.el.querySelector('#project-drone-toggle')?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const next = !this._droneActive;
      const active = this.onDroneToggle ? this.onDroneToggle(next) : next;
      this.setDroneActive(active);
    });
    this.el.querySelector('#project-correction-select')?.addEventListener('change', () => this._emitProjectKeyChange());
    this.el.querySelector('#project-meter-select')?.addEventListener('change', () => this._emitProjectMeterChange());
    this.el.querySelector('#project-meter-grouping-select')?.addEventListener('change', () => this._emitProjectMeterChange());

    // Metronome toggle
    this.el.querySelector('#btn-metronome').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const active = this.metronome.toggle();
      this.el.querySelector('#metronome-toggle').classList.toggle('is-active', active);
    });

    // Transport state changes → update play button icon
    this.transport.onStateChange((state) => {
      this._updatePlayButton(state);
      this._updateRecordButton(state);
    });

    // Beat events → update beat indicator
    this.transport.onBeat((beat) => {
      this._updateBeatIndicator(beat);
    });

    // On stop, clear beat indicator
    this.transport.onStateChange((state) => {
      if (state === TransportState.STOPPED) {
        this._clearBeatIndicator();
      }
    });

    // Settings button
    this.el.querySelector('#btn-settings')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.closeMore();
      if (this.onSettingsClick) this.onSettingsClick();
    });

    this.el.querySelector('#btn-backup-status')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.closeMore();
      if (this.onBackupClick) this.onBackupClick();
    });

    // Hold/Arp toggle
    this.el.querySelector('#btn-arp')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.onArpClick) this.onArpClick();
    });

    // Keys shortcut reference
    this.el.querySelector('#btn-keys')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.onKeysClick) this.onKeysClick();
    });

    // Mod reset
    this.el.querySelector('#mod-reset-btn')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.onModResetClick) this.onModResetClick();
    });

    // More dropdown toggle
    const toggleMore = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - this._lastMoreToggle < 250) return;
      this._lastMoreToggle = now;
      const more = this.el.querySelector('#tb-more');
      if (!more) return;
      const shouldOpen = !more.classList.contains('is-open');
      if (shouldOpen && this.onMoreOpen) this.onMoreOpen();
      more.classList.toggle('is-open', shouldOpen);
      const moreBtn = this.el.querySelector('#tb-more-btn');
      moreBtn?.classList.toggle('is-active', shouldOpen);
      moreBtn?.setAttribute('aria-expanded', String(shouldOpen));
    };
    this.el.querySelector('#tb-more-btn')?.addEventListener('pointerdown', toggleMore);
  }

  _scaleLabel(scaleName) {
    return SCALES[scaleName]?.name || SCALES.major.name;
  }

  _progressionButtonLabel(value = {}) {
    return `Changes: ${progressionLabel(value)}`;
  }

  _scaleGroups() {
    const groups = new Map();
    Object.entries(SCALES)
      .filter(([key]) => key !== 'chromatic')
      .forEach(([key, scale]) => {
        const family = scale.family || 'western';
        if (!groups.has(family)) groups.set(family, []);
        groups.get(family).push({
          value: key,
          label: scale.name,
          kicker: scale.degreePattern || '',
          description: scale.description || '',
          tags: [scaleFamilyLabel(family), ...(scale.aliases || [])],
        });
      });

    return [...groups.entries()].map(([family, items]) => ({
      id: family,
      label: scaleFamilyLabel(family),
      items,
    }));
  }

  _openScalePicker(anchor) {
    this._scalePicker?.close();
    this._scalePicker = new ChoicePicker({
      title: 'Choose Scale',
      groups: this._scaleGroups(),
      selectedValue: this._projectKey.scale,
      searchPlaceholder: 'Search scales...',
      onSelect: (value) => {
        this._emitProjectKeyChange({ scale: value });
      },
    });
    this._scalePicker.open(anchor);
  }

  _openProgressionPicker(anchor) {
    this._progressionPicker?.close();
    this._progressionPicker = new ChoicePicker({
      title: 'Choose Changes',
      groups: progressionChoiceGroups(this._projectKey),
      selectedValue: this._projectProgression.enabled ? this._projectProgression.id : 'off',
      searchPlaceholder: 'Search changes...',
      onSelect: (value) => {
        const next = value === 'off'
          ? normalizeProgressionContext()
          : normalizeProgressionContext(progressionPreset(value));
        this.setProjectProgression(next);
        if (this.onProjectProgressionChange) this.onProjectProgressionChange({ ...this._projectProgression });
      },
    });
    this._progressionPicker.open(anchor);
  }

  setArpLabel(mode) {
    const btn = this.el?.querySelector('#btn-arp');
    if (!btn) return;
    btn.classList.remove('is-arp', 'is-hold');
    const label = btn.querySelector('.transport-bar__menu-icon');
    if (!label) return;
    if (mode === ARP_MODES.ARP) {
      btn.classList.add('is-arp');
      label.textContent = 'ARP';
    } else if (mode === ARP_MODES.HOLD) {
      btn.classList.add('is-hold');
      label.textContent = 'HLD';
    } else {
      label.textContent = 'OFF';
    }
  }

  closeMore() {
    this.el?.querySelector('#tb-more')?.classList.remove('is-open');
    const btn = this.el?.querySelector('#tb-more-btn');
    btn?.classList.remove('is-active');
    btn?.setAttribute('aria-expanded', 'false');
  }

  setBackupStatus(status = {}) {
    const btn = this.el?.querySelector('#btn-backup-status');
    if (!btn) return;
    const state = status.state || 'unknown';
    btn.classList.remove('is-ok', 'is-warning', 'is-danger', 'is-unknown', 'is-auto', 'is-permission');
    btn.classList.add(`is-${state}`);
    const label = btn.querySelector('#backup-status-label');
    if (label) label.textContent = status.shortLabel || status.label || 'Backup';
    const title = status.advice || status.label || 'Open backup status';
    btn.title = title;
    btn.setAttribute('aria-label', title);
  }

  setModDisplay(pitch, mod) {
    const p = this.el?.querySelector('#mod-pitch');
    const m = this.el?.querySelector('#mod-mod');
    if (p) p.textContent = `${pitch}%`;
    if (m) m.textContent = `${mod}%`;
  }

  setRecordArmed(armed) {
    this._recordArmed = !!armed;
    const btn = this.el?.querySelector('#btn-arm-record');
    if (!btn) return;
    btn.classList.toggle('is-armed', this._recordArmed);
    btn.setAttribute('aria-pressed', String(this._recordArmed));
    btn.title = this._recordArmed
      ? 'Armed. Recording starts on the first note or drum hit.'
      : 'Arm recording. Recording starts on the first note or drum hit.';
  }

  setProjectKey(context = {}) {
    this._projectKey = normalizeMusicalContext(context);
    const root = this.el?.querySelector('#project-root-select');
    const correction = this.el?.querySelector('#project-correction-select');
    const scaleLabel = this.el?.querySelector('#project-scale-label');
    const scaleButton = this.el?.querySelector('#project-scale-picker');
    if (root) root.value = this._projectKey.root;
    if (correction) correction.value = normalizeNoteCorrectionMode(this._projectKey.correction);
    if (scaleLabel) scaleLabel.textContent = this._scaleLabel(this._projectKey.scale);
    if (scaleButton) {
      scaleButton.title = scaleDescription(this._projectKey.scale);
      scaleButton.setAttribute('aria-label', `Project scale: ${this._scaleLabel(this._projectKey.scale)}`);
    }
  }

  setProjectProgression(value = {}) {
    this._projectProgression = normalizeProgressionContext(value);
    const label = this.el?.querySelector('#project-progression-label');
    const button = this.el?.querySelector('#project-progression-picker');
    const text = progressionLabel(this._projectProgression);
    if (label) label.textContent = this._progressionButtonLabel(this._projectProgression);
    if (button) {
      const title = this._projectProgression.enabled
        ? `Changes: ${text}. Future chord-tone glow will follow this progression.`
        : 'Changes: Off';
      button.title = title;
      button.setAttribute('aria-label', title);
      button.classList.toggle('is-active', this._projectProgression.enabled);
    }
  }

  setProjectMeter(meter = '4/4') {
    this._projectMeter = normalizeMeter(meter);
    const select = this.el?.querySelector('#project-meter-select');
    if (select) select.value = this._projectMeter.id || '4/4';
    const grouping = this.el?.querySelector('#project-meter-grouping-select');
    if (grouping) {
      grouping.innerHTML = this._renderGroupingOptions();
      grouping.value = this._groupingValue(this._projectMeter.grouping);
      grouping.hidden = !ALLOWED_GROUPINGS[this._projectMeter.id];
      grouping.disabled = !ALLOWED_GROUPINGS[this._projectMeter.id];
    }
    this.updateTimeSignature();
  }

  _emitProjectKeyChange(partial = {}) {
    const root = this.el?.querySelector('#project-root-select')?.value;
    const scale = partial.scale || this._projectKey.scale;
    const correction = partial.correction || this.el?.querySelector('#project-correction-select')?.value || this._projectKey.correction;
    this.setProjectKey({ root, scale, correction });
    if (this.onProjectKeyChange) this.onProjectKeyChange({ ...this._projectKey });
  }

  _emitProjectMeterChange() {
    const id = this.el?.querySelector('#project-meter-select')?.value || '4/4';
    const groupingValue = this.el?.querySelector('#project-meter-grouping-select')?.value;
    const next = normalizeMeter(id);
    if (groupingValue && ALLOWED_GROUPINGS[id]) {
      next.grouping = groupingValue.split('+').map(value => Number(value));
      next.pulseCount = next.grouping.length;
    }
    this.setProjectMeter(next);
    if (this.onProjectMeterChange) this.onProjectMeterChange({ ...this._projectMeter });
  }

  _groupingValue(grouping = []) {
    return Array.isArray(grouping) ? grouping.join('+') : '';
  }

  _renderGroupingOptions() {
    const options = ALLOWED_GROUPINGS[this._projectMeter.id] || [];
    if (!options.length) return '<option value="">Grouping</option>';
    const current = this._groupingValue(this._projectMeter.grouping);
    return options.map(grouping => {
      const value = this._groupingValue(grouping);
      return `<option value="${value}" ${value === current ? 'selected' : ''}>${value}</option>`;
    }).join('');
  }

  syncFromTransport() {
    this._syncBpmUi();
    this.setProjectMeter(this.transport.meter || this.transport.timeSignature);
    this.updateTimeSignature();
    this._clearBeatIndicator();
  }

  _setBpm(value) {
    this.transport.bpm = value;
    this._syncBpmUi();
    if (this.onBpmChange) this.onBpmChange(this.transport.bpm);
  }

  _syncBpmUi() {
    const bpmInput = this.el?.querySelector('#bpm-input');
    const bpmButton = this.el?.querySelector('#bpm-button');
    if (bpmInput) bpmInput.value = this.transport.bpm;
    if (bpmButton) bpmButton.textContent = this.transport.bpm;
  }

  _openBpmModal() {
    this._closeBpmModal();
    let draft = this.transport.bpm;
    const overlay = document.createElement('div');
    overlay.className = 'bpm-modal-backdrop';
    overlay.innerHTML = `
      <div class="bpm-modal" role="dialog" aria-modal="true" aria-label="Change BPM">
        <div class="bpm-modal__header">
          <span>BPM</span>
          <strong id="bpm-modal-value">${draft}</strong>
        </div>
        <input class="bpm-modal__input" id="bpm-modal-input" type="number" inputmode="numeric" min="40" max="240" value="${draft}" aria-label="BPM value" />
        <div class="bpm-modal__steps" aria-label="BPM adjustments">
          <button class="btn btn--ghost" type="button" data-bpm-step="-10">-10</button>
          <button class="btn btn--ghost" type="button" data-bpm-step="-1">-1</button>
          <button class="btn btn--ghost" type="button" data-bpm-step="1">+1</button>
          <button class="btn btn--ghost" type="button" data-bpm-step="10">+10</button>
        </div>
        <div class="bpm-modal__actions">
          <button class="btn btn--ghost" id="bpm-modal-cancel" type="button">Cancel</button>
          <button class="btn btn--primary" id="bpm-modal-save" type="button">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this._bpmModal = overlay;

    const input = overlay.querySelector('#bpm-modal-input');
    const value = overlay.querySelector('#bpm-modal-value');
    const syncDraft = (next) => {
      draft = Math.max(40, Math.min(240, Math.round(Number(next) || 120)));
      input.value = draft;
      value.textContent = draft;
    };
    input.addEventListener('input', () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) {
        draft = Math.max(40, Math.min(240, Math.round(parsed)));
        value.textContent = draft;
      }
    });
    overlay.querySelectorAll('[data-bpm-step]').forEach(button => {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        syncDraft(draft + Number(button.dataset.bpmStep));
      });
    });
    overlay.querySelector('#bpm-modal-cancel')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._closeBpmModal();
    });
    overlay.querySelector('#bpm-modal-save')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      syncDraft(input.value);
      this._setBpm(draft);
      this._closeBpmModal();
    });
  }

  _closeBpmModal() {
    this._bpmModal?.remove();
    this._bpmModal = null;
  }

  updateTimeSignature() {
    const indicator = this.el?.querySelector('#beat-indicator');
    if (!indicator) return;
    indicator.innerHTML = this._renderBeatDots();
    this._beatDots = this.el.querySelectorAll('.beat-indicator__dot');
  }

  _renderBeatDots() {
    const beats = Math.max(1, pulseCountForMeter(this.transport?.meter || this.transport?.timeSignature));
    return Array.from({ length: beats }, (_, i) =>
      `<div class="beat-indicator__dot" data-beat="${i}"></div>`
    ).join('');
  }

  _updatePlayButton(state) {
    const btn = this.el.querySelector('#btn-play');
    const isPlaying = state === TransportState.PLAYING || state === TransportState.RECORDING;
    if (isPlaying) {
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18">
        <rect x="3" y="2" width="4" height="14" rx="1" fill="currentColor"/>
        <rect x="11" y="2" width="4" height="14" rx="1" fill="currentColor"/>
      </svg>`;
    } else {
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18">
        <polygon points="4,2 16,9 4,16" fill="currentColor"/>
      </svg>`;
    }
  }

  _updateRecordButton(state) {
    const btn = this.el.querySelector('#btn-record');
    btn.classList.toggle('is-active', state === TransportState.RECORDING);
    if (state === TransportState.RECORDING) this.setRecordArmed(false);
  }

  _updateBeatIndicator(beat) {
    this._beatDots.forEach((dot, i) => {
      dot.classList.remove('is-active', 'is-accent');
      if (i === beat) {
        dot.classList.add(beat === 0 ? 'is-accent' : 'is-active');
      }
    });
  }

  _clearBeatIndicator() {
    this._beatDots.forEach(dot => {
      dot.classList.remove('is-active', 'is-accent');
    });
  }
}
