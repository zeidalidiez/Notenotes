/**
 * SettingsPanel — Slide-out panel for app-wide settings.
 * Includes quantization, metronome settings, project management,
 * version history, project milestones, install help, and export.
 */

import { CHORD_TYPES, ARP_PATTERNS, ARP_RATES } from '../engine/ArpeggioManager.js';
import { icon } from './icons.js';
import { APP_VERSION } from '../version.js';
import { pulseCountForMeter } from '../engine/Meter.js';
import { showToast } from './Toast.js';
import { compareAppVersions, latestVersionFromSourceText } from '../utils/AppVersion.js';
import { SaveSectionMixin } from './settings/saveSection.js';
import { AiSectionMixin } from './settings/aiSection.js';
import { ExportSectionMixin } from './settings/exportSection.js';
import { AccessibilitySectionMixin } from './settings/accessibilitySection.js';
import { focusableElements, setSubtreeInteractive, setTabActive } from './InteractionState.js';

const LATEST_VERSION_URL = 'https://raw.githubusercontent.com/zeidalidiez/Notenotes/main/src/version.js';

export class SettingsPanel {
  /**
   * @param {object} deps - { transport, metronome, store, project }
   */
  constructor(deps) {
    this.transport = deps.transport;
    this.metronome = deps.metronome;
    this.store = deps.store;
    this.project = deps.project;
    this.el = null;
    this._isOpen = false;
    this._sheetMusicView = null;
    this._diagnosticsPanel = null;
    this._sectionLoadToken = 0;
    this._activeSection = 'settings'; // 'settings' | 'accessibility' | 'sheet' | 'history' | 'diagnostics'
    this._returnFocus = null;
    this._onDocumentKeyDown = (event) => this._handleDocumentKeyDown(event);
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'settings-panel';
    this.el.id = 'settings-panel';
    setSubtreeInteractive(this.el, false);

    this.el.innerHTML = `
      <div class="settings-panel__overlay" id="settings-overlay" aria-hidden="true"></div>
      <div class="settings-panel__drawer" id="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="settings-panel__header">
          <h2 class="settings-panel__title" id="settings-title">Settings</h2>
          <button class="btn btn--icon btn--ghost settings-panel__close" id="settings-close" aria-label="Close settings">${icon('x', { size: 16 })}</button>
        </div>
        <div class="settings-panel__tabs" role="tablist" aria-label="Settings sections">
          <button class="settings-panel__tab is-active" id="settings-tab-settings" data-section="settings" role="tab" aria-controls="settings-body" aria-selected="true" tabindex="0">Settings</button>
          <button class="settings-panel__tab" id="settings-tab-accessibility" data-section="accessibility" role="tab" aria-controls="settings-body" aria-selected="false" tabindex="-1">Accessibility</button>
          <button class="settings-panel__tab" id="settings-tab-sheet" data-section="sheet" role="tab" aria-controls="settings-body" aria-selected="false" tabindex="-1">Export</button>
          <button class="settings-panel__tab" id="settings-tab-history" data-section="history" role="tab" aria-controls="settings-body" aria-selected="false" tabindex="-1">Save</button>
          ${this._diagnosticsEnabled() ? '<button class="settings-panel__tab" id="settings-tab-diagnostics" data-section="diagnostics" role="tab" aria-controls="settings-body" aria-selected="false" tabindex="-1">Diagnostics</button>' : ''}
        </div>
        <div class="settings-panel__body" id="settings-body" role="tabpanel" aria-labelledby="settings-tab-settings">
          ${this._renderSettingsSection()}
        </div>
      </div>
    `;

    this._bindEvents();
    return this.el;
  }

  _diagnosticsEnabled() {
    return typeof window !== 'undefined' && window.__notenotesDebug === true;
  }

  _renderSettingsSection() {
    const metVol = this.project?.settings?.metronomeVolume ?? 0.5;
    const masterVol = this.project?.settings?.masterVolume ?? 0.8;
    const beatColors = this._beatColorsForBeats(pulseCountForMeter(this.project?.meter || this.transport?.meter || this.project?.timeSignature || this.transport?.timeSignature));

    return `
      <div class="settings-section" id="section-settings">
        <div class="settings-group">
          <h3 class="settings-group__title">Project</h3>
          <div class="settings-row">
            <label class="settings-label">Name</label>
            <input class="settings-input" id="setting-project-name" type="text" value="${this.project?.name || 'Untitled'}" aria-label="Project name"/>
          </div>
          <div class="settings-row settings-row--version">
            <label class="settings-label">App Version</label>
            <div class="settings-version">
              <span class="settings-value">${APP_VERSION}</span>
              <button class="btn btn--ghost btn--sm" id="setting-version-check" type="button">Check latest</button>
            </div>
          </div>
          <p class="settings-desc settings-version__status" id="setting-version-status">Checks GitHub for the newest public build.</p>
          <div class="settings-row" style="justify-content: flex-start; gap: 10px;">
            <input type="checkbox" id="setting-debug-logging" ${this.project?.settings?.debugLogging ? 'checked' : ''} />
            <label class="settings-label" for="setting-debug-logging">Debug logs</label>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Install App</h3>
          <p class="settings-desc">Install Notenotes from your browser for an app-window experience. In Chrome, open the three-dot menu, then Cast, save, and share, then Install page as app. Edge uses Apps, then Install this site as an app. Safari uses Share, then Add to Home Screen.</p>
          <div class="settings-row">
            <label class="settings-label">PWA</label>
            <button class="btn btn--ghost" id="setting-install-app" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Install / Help</button>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Metronome</h3>
          <div class="settings-row">
            <label class="settings-label">Volume</label>
            <input class="settings-range" id="setting-met-vol" type="range" min="0" max="100" value="${Math.round(metVol * 100)}" aria-label="Metronome volume"/>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Master</h3>
          <div class="settings-row">
            <label class="settings-label">Volume</label>
            <input class="settings-range" id="setting-master-vol" type="range" min="0" max="100" value="${Math.round(masterVol * 100)}" aria-label="Master volume"/>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Arpeggio</h3>
          <div class="settings-row">
            <label class="settings-label">Rate</label>
            <select class="settings-select" id="setting-arp-rate" aria-label="Arpeggio rate">
              ${ARP_RATES.map(r =>
                `<option value="${r.id}" ${(this.project?.settings?.arpRate || '1/8') === r.id ? 'selected' : ''}>${r.name}</option>`
              ).join('')}
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label">Chord Type</label>
            <select class="settings-select" id="setting-arp-chord" aria-label="Arpeggio chord type">
              ${CHORD_TYPES.map(c =>
                `<option value="${c.id}" ${(this.project?.settings?.arpChordType || 'major') === c.id ? 'selected' : ''}>${c.name}</option>`
              ).join('')}
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label">Pattern</label>
            <select class="settings-select" id="setting-arp-pattern" aria-label="Arpeggio pattern">
              ${ARP_PATTERNS.map(p =>
                `<option value="${p.id}" ${(this.project?.settings?.arpPattern || 'up') === p.id ? 'selected' : ''}>${p.name}</option>`
              ).join('')}
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label">Hold Duration (<span id="setting-hold-display">${(this.project?.settings?.holdDuration || 3000) / 1000}</span>s)</label>
            <input class="settings-range" id="setting-hold-dur" type="range" min="1" max="30" value="${(this.project?.settings?.holdDuration || 3000) / 1000}" aria-label="Hold note duration"/>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Time Signature Visualizer</h3>
          <div class="settings-row" style="justify-content: flex-start; gap: 10px;">
            <input type="checkbox" id="setting-vis-enabled" ${this.project?.settings?.visualizerEnabled ? 'checked' : ''} />
            <label class="settings-label" for="setting-vis-enabled">Enable background visualizer</label>
          </div>
          <div class="settings-row">
            <label class="settings-label">Beat Colors</label>
            <div style="display: flex; gap: 4px;">
              ${beatColors.map((c, i) => 
                `<input type="color" class="setting-vis-color" data-index="${i}" value="${c}" aria-label="Beat ${i+1} color" style="width: 24px; height: 24px; padding: 0; border: none; border-radius: 4px;" />`
              ).join('')}
            </div>
          </div>
        </div>
        ${this._renderAISection()}

        <div class="settings-row" style="margin-top: var(--space-xl); justify-content: center;">
          <button class="btn btn--primary" id="setting-save-btn" style="width: 100%;">Save & Close</button>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    // Overlay close
    this.el.querySelector('#settings-overlay')?.addEventListener('pointerdown', () => this.close());
    this.el.querySelector('#settings-close')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.close();
    });

    // Section tabs
    this.el.querySelectorAll('.settings-panel__tab').forEach(tab => {
      const activate = (e) => {
        // Pointer activation already ran on pointerdown. Keep click for
        // keyboard/assistive activation without switching the section twice.
        if (e.type === 'click' && e.detail !== 0) return;
        e.preventDefault();
        this._switchSection(tab.dataset.section);
      };
      tab.addEventListener('pointerdown', activate);
      tab.addEventListener('click', activate);
      tab.addEventListener('keydown', (event) => this._handleSectionTabKeydown(event, tab));
    });

    window.addEventListener('project-time-signature-changed', () => {
      if (!this.el?.querySelector('#section-settings')) return;
      const body = this.el.querySelector('#settings-body');
      if (!body) return;
      body.innerHTML = this._renderSettingsSection();
      this._bindSettingsEvents();
    });
  }

  _bindSettingsEvents() {
    const body = this.el.querySelector('#settings-body');

    // Project name
    body.querySelector('#setting-project-name')?.addEventListener('change', (e) => {
      if (this.project) {
        this.project.name = e.target.value;
        this.store?.scheduleAutoSave(this.project);
        showToast('Project name updated');
      }
    });

    body.querySelector('#setting-install-app')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      const promptEvent = window.notenotesInstallPrompt;
      if (promptEvent) {
        promptEvent.prompt();
        await promptEvent.userChoice;
        window.notenotesInstallPrompt = null;
        showToast('Install prompt closed');
        return;
      }
      showToast('Chrome: three-dot menu > Cast, save, and share > Install page as app', 7000);
    });

    body.querySelector('#setting-version-check')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      await this._checkLatestVersion();
    });

    body.querySelector('#setting-debug-logging')?.addEventListener('change', async (e) => {
      if (!this.project) return;
      this.project.settings ||= {};
      this.project.settings.debugLogging = e.target.checked;
      this.store?.scheduleAutoSave(this.project);
      if (e.target.checked) {
        await this._dumpDebugSnapshot('enabled');
        showToast('Debug logs enabled');
      } else {
        console.info('[Notenotes Debug] Debug logs disabled');
        showToast('Debug logs disabled');
      }
    });

    // Metronome volume
    body.querySelector('#setting-met-vol')?.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10) / 100;
      if (this.metronome) this.metronome.setVolume(vol);
      if (this.project) this.project.settings.metronomeVolume = vol;
    });

      // Master volume
      body.querySelector('#setting-master-vol')?.addEventListener('input', (e) => {
        const vol = parseInt(e.target.value, 10) / 100;
        const engine = this.transport?.engine;
        engine?.setVolume?.(vol);
        if (this.project) this.project.settings.masterVolume = vol;
      });

      // Arpeggio settings
      body.querySelector('#setting-arp-rate')?.addEventListener('change', (e) => {
        if (this.project) {
          this.project.settings.arpRate = e.target.value;
          this.store?.scheduleAutoSave(this.project);
        }
      });

      body.querySelector('#setting-arp-chord')?.addEventListener('change', (e) => {
        if (this.project) {
          this.project.settings.arpChordType = e.target.value;
          this.store?.scheduleAutoSave(this.project);
        }
      });

      body.querySelector('#setting-arp-pattern')?.addEventListener('change', (e) => {
        if (this.project) {
          this.project.settings.arpPattern = e.target.value;
          this.store?.scheduleAutoSave(this.project);
        }
      });

      body.querySelector('#setting-hold-dur')?.addEventListener('input', (e) => {
        const secs = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 3));
        const display = body.querySelector('#setting-hold-display');
        if (display) display.textContent = secs;
        if (this.project) {
          this.project.settings.holdDuration = secs * 1000;
          this.store?.scheduleAutoSave(this.project);
        }
      });

      // Visualizer toggle
      body.querySelector('#setting-vis-enabled')?.addEventListener('change', (e) => {
        if (this.project) {
          this.project.settings.visualizerEnabled = e.target.checked;
          this.store?.scheduleAutoSave(this.project);
          if (!e.target.checked) document.documentElement.style.removeProperty('--surface-0');
        }
      });

      // Visualizer colors
      body.querySelectorAll('.setting-vis-color').forEach(input => {
        input.addEventListener('input', (e) => {
          if (this.project) {
            const idx = parseInt(e.target.dataset.index, 10);
            if (!this.project.settings.beatColors) {
              this.project.settings.beatColors = this._beatColorsForBeats(pulseCountForMeter(this.project?.meter || this.transport?.meter || this.project?.timeSignature || this.transport?.timeSignature));
            }
            this.project.settings.beatColors[idx] = e.target.value;
            this.store?.scheduleAutoSave(this.project);
          }
        });
      });

      // AI seed settings
      this._bindAISettingsEvents(body);

      // Save & Close button
      body.querySelector('#setting-save-btn')?.addEventListener('click', () => {
        this.close();
      });
    }

  _beatColorsForBeats(beats = 4) {
    const defaults = ['#1e1e2e', '#2a2a3e', '#1e1e2e', '#2a2a3e', '#242436'];
    const existing = this.project?.settings?.beatColors || defaults;
    return Array.from({ length: beats }, (_, i) => existing[i] || defaults[i] || defaults[0]);
  }

  _switchSection(section) {
    if (section === 'diagnostics' && !this._diagnosticsEnabled()) section = 'settings';
    const sectionLoadToken = ++this._sectionLoadToken;
    this._diagnosticsPanel?.destroy();
    this._diagnosticsPanel = null;
    this._activeSection = section;

    // Update tab visuals
    this.el.querySelectorAll('.settings-panel__tab').forEach(t => {
      const active = t.dataset.section === section;
      t.classList.toggle('is-active', active);
      setTabActive(t, active);
    });

    const body = this.el.querySelector('#settings-body');
    body?.setAttribute('aria-labelledby', `settings-tab-${section}`);

    switch (section) {
      case 'settings':
        body.innerHTML = this._renderSettingsSection();
        this._bindSettingsEvents();
        break;

      case 'accessibility':
        body.innerHTML = this._renderAccessibilitySection();
        this._bindAccessibilityEvents();
        break;

      case 'sheet':
        body.innerHTML = this._renderSheetSection();
        this._bindExportEvents();
        import('../export/SheetMusicView.js').then(({ SheetMusicView }) => {
          const mount = body.querySelector('#section-sheet-music');
          if (!mount || this._activeSection !== 'sheet' || sectionLoadToken !== this._sectionLoadToken) return;
          this._sheetMusicView = new SheetMusicView(this.project);
          mount.appendChild(this._sheetMusicView.render());
        }).catch(err => {
          console.warn('[Settings] Sheet music failed to load:', err);
          const mount = body.querySelector('#section-sheet-music');
          if (mount && this._activeSection === 'sheet' && sectionLoadToken === this._sectionLoadToken) {
            mount.innerHTML = '<div class="settings-empty">Sheet music could not be loaded.</div>';
          }
        });
        break;

      case 'history':
        body.innerHTML = this._renderHistorySection();
        this._bindBackupEvents();
        this._bindMilestoneEvents();
        this._loadStorageStatus();
        this._loadMilestones();
        this._loadVersionHistory();
        break;

      case 'diagnostics':
        body.innerHTML = '<div id="section-diagnostics"><div class="settings-empty">Loading diagnostics...</div></div>';
        import('./DiagnosticsPanel.js').then(({ DiagnosticsPanel }) => {
          const mount = body.querySelector('#section-diagnostics');
          if (!mount || this._activeSection !== 'diagnostics' || sectionLoadToken !== this._sectionLoadToken) return;
          mount.innerHTML = '';
          this._diagnosticsPanel = new DiagnosticsPanel({ transport: this.transport });
          mount.appendChild(this._diagnosticsPanel.render());
        });
        break;
    }
  }

  async _checkLatestVersion() {
    const body = this.el?.querySelector('#settings-body');
    const statusEl = body?.querySelector('#setting-version-status');
    const button = body?.querySelector('#setting-version-check');
    if (!statusEl) return;

    if (button) button.disabled = true;
    statusEl.textContent = 'Checking GitHub...';

    try {
      const response = await fetch(LATEST_VERSION_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const latest = latestVersionFromSourceText(await response.text());
      if (!latest) throw new Error('No version field found');

      const comparison = compareAppVersions(latest, APP_VERSION);
      if (comparison > 0) {
        statusEl.textContent = `Latest public version is ${latest}. This browser is on ${APP_VERSION}; clear cache or press Ctrl+Shift+R to load the newest build.`;
      } else if (comparison < 0) {
        statusEl.textContent = `This browser is on ${APP_VERSION}, which is newer than GitHub's public ${latest}.`;
      } else {
        statusEl.textContent = `You are on the latest public version (${APP_VERSION}).`;
      }
    } catch (err) {
      console.warn('[Settings] Version check failed:', err);
      statusEl.textContent = 'Could not check GitHub. If the app feels stale, clear cache or press Ctrl+Shift+R after you are back online.';
    } finally {
      if (button) button.disabled = false;
    }
  }

  open() {
    this.openTo(this._activeSection);
  }

  openTo(section = 'settings', options = {}) {
    const opening = !this._isOpen;
    if (opening) this._returnFocus = options.returnFocus || document.activeElement || null;
    this._isOpen = true;
    this.el.classList.add('is-open');
    setSubtreeInteractive(this.el, true);
    document.getElementById('app')?.setAttribute('inert', '');
    if (opening) document.addEventListener('keydown', this._onDocumentKeyDown, true);
    this._switchSection(section);
    if (opening || options.focus === 'ai') {
      requestAnimationFrame(() => {
        const target = options.focus === 'ai'
          ? this.el?.querySelector('#setting-ai-provider')
          : this.el?.querySelector('#settings-close');
        if (options.focus === 'ai') target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        try { target?.focus({ preventScroll: options.focus !== 'ai' }); } catch (_) { target?.focus?.(); }
      });
    }
    this._dumpDebugSnapshot('settings-open');
  }

  close() {
    if (!this._isOpen) {
      setSubtreeInteractive(this.el, false);
      document.getElementById('app')?.removeAttribute('inert');
      document.removeEventListener('keydown', this._onDocumentKeyDown, true);
      return;
    }
    this._isOpen = false;
    this._diagnosticsPanel?.destroy();
    this._diagnosticsPanel = null;
    this.el.classList.remove('is-open');
    setSubtreeInteractive(this.el, false);
    document.getElementById('app')?.removeAttribute('inert');
    document.removeEventListener('keydown', this._onDocumentKeyDown, true);

    const returnFocus = this._returnFocus;
    this._returnFocus = null;
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected !== false && !returnFocus?.closest?.('[inert]')) {
        try { returnFocus?.focus?.({ preventScroll: true }); } catch (_) { returnFocus?.focus?.(); }
      }
    });
  }

  toggle(options = {}) {
    if (this._isOpen) this.close();
    else this.openTo(this._activeSection, options);
  }

  _handleDocumentKeyDown(event) {
    if (!this._isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = focusableElements(this.el);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!this.el.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  _handleSectionTabKeydown(event, currentTab) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const tabs = Array.from(this.el.querySelectorAll('.settings-panel__tab'));
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else nextIndex = (currentIndex + 1) % tabs.length;

    event.preventDefault();
    const next = tabs[nextIndex];
    this._switchSection(next.dataset.section);
    next.focus();
  }
}

Object.assign(SettingsPanel.prototype, SaveSectionMixin, AiSectionMixin, ExportSectionMixin, AccessibilitySectionMixin);
