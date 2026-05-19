/**
 * TransportBar — UI component for the top transport controls.
 * Play/Pause, Stop, Record, BPM, Metronome, Beat Indicator, Loop controls.
 */

import { TransportState } from '../engine/Transport.js';
import { ARP_MODES } from '../engine/ArpeggioManager.js';

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
    this.onArpClick = null;
    this.onKeysClick = null;
    this.onModResetClick = null;
    this.onPanicClick = null;
    this.onMoreOpen = null;
    this._lastMoreToggle = 0;
    this._lastStopPress = 0;
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
      </div>

      <div class="beat-indicator" id="beat-indicator">
        ${this._renderBeatDots()}
      </div>

      <div class="transport-bar__bpm">
        <input type="number" id="bpm-input" value="${this.transport.bpm}" min="40" max="240" aria-label="BPM" style="width:56px;" />
        <span>BPM</span>
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
      this.transport.stop();
      if (isDoubleStop && this.onPanicClick) this.onPanicClick();
    });

    // Record
    this.el.querySelector('#btn-record').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.transport.state === TransportState.RECORDING) {
        this.transport.pause();
      } else {
        this.transport.record();
      }
    });

    // BPM input
    const bpmInput = this.el.querySelector('#bpm-input');
    bpmInput.addEventListener('change', () => {
      this.transport.bpm = parseInt(bpmInput.value, 10) || 120;
      bpmInput.value = this.transport.bpm;
    });

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

  setModDisplay(pitch, mod) {
    const p = this.el?.querySelector('#mod-pitch');
    const m = this.el?.querySelector('#mod-mod');
    if (p) p.textContent = `${pitch}%`;
    if (m) m.textContent = `${mod}%`;
  }

  syncFromTransport() {
    const bpmInput = this.el?.querySelector('#bpm-input');
    if (bpmInput) bpmInput.value = this.transport.bpm;
    this.updateTimeSignature();
    this._clearBeatIndicator();
  }

  updateTimeSignature() {
    const indicator = this.el?.querySelector('#beat-indicator');
    if (!indicator) return;
    indicator.innerHTML = this._renderBeatDots();
    this._beatDots = this.el.querySelectorAll('.beat-indicator__dot');
  }

  _renderBeatDots() {
    const beats = Math.max(1, this.transport?.timeSignature?.beats || 4);
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
