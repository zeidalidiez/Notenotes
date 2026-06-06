/**
 * SettingsPanel — Slide-out panel for app-wide settings.
 * Includes quantization, metronome settings, project management,
 * version history, project milestones, install help, and export.
 */

import { SheetMusicView } from '../export/SheetMusicView.js';
import { downloadBlob, projectToMidiBlob, safeFilename, snippetToMidiBlob } from '../export/MidiExporter.js';
import { projectToWavBlob, snippetToWavBlob } from '../export/WavExporter.js';
import { CHORD_TYPES, ARP_PATTERNS, ARP_RATES } from '../engine/ArpeggioManager.js';
import { APP_VERSION } from '../version.js';
import { pulseCountForMeter } from '../engine/Meter.js';
import {
  DISCLAIMER_TEXT as AI_DISCLAIMER_TEXT,
  PROVIDER_IDS as AI_PROVIDER_IDS,
  clearAllApiKeys as aiClearAllApiKeys,
  readAiSettings,
  readApiKey as aiReadApiKey,
  writeAiSettings,
  writeApiKey as aiWriteApiKey,
} from '../ai/aiSettings.js';
import { OpenAIProvider } from '../ai/OpenAIProvider.js';
import { AnthropicProvider } from '../ai/AnthropicProvider.js';
import { GeminiProvider } from '../ai/GeminiProvider.js';
import { showToast } from './Toast.js';
import { compareAppVersions, latestVersionFromSourceText } from '../utils/AppVersion.js';
import { ensureAccessibilitySettings } from './AccessibilityProfiles.js';
import { SaveSectionMixin } from './settings/saveSection.js';

const LATEST_VERSION_URL = 'https://raw.githubusercontent.com/zeidalidiez/Notenotes/main/src/version.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function apiKeyPlaceholderFor(providerId) {
  switch (providerId) {
    case 'openai':    return 'sk-...';
    case 'anthropic': return 'sk-ant-...';
    case 'gemini':    return 'AIza...';
    default:          return 'paste your API key';
  }
}

function modelDisplayLabel(providerId, modelId) {
  // Surface tier hints inline so users don't have to read the docs to know
  // which model their free key actually works with.
  if (providerId === 'gemini') {
    if (modelId === 'gemini-2.5-flash')      return `${modelId}  (best free)`;
    if (modelId === 'gemini-2.5-flash-lite') return `${modelId}  (free, lighter)`;
    if (modelId === 'gemini-1.5-flash')      return `${modelId}  (free tier · older)`;
    if (modelId === 'gemini-2.5-pro')        return `${modelId}  (paid, best quality)`;
    if (modelId === 'gemini-1.5-pro')        return `${modelId}  (paid, older)`;
  }
  return modelId;
}

function providerModelsForUi(providerId) {
  switch (providerId) {
    case 'openai':
      return new OpenAIProvider().listModels();
    case 'anthropic':
      return new AnthropicProvider().listModels();
    case 'gemini':
      return new GeminiProvider().listModels();
    case 'ollama':
      return new OpenAIProvider({ baseUrl: 'http://localhost:11434/v1', requiresKey: false, id: 'ollama' }).listModels();
    case 'mock':
    default:
      return ['mock-canned-v1'];
  }
}

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
    this._activeSection = 'settings'; // 'settings' | 'accessibility' | 'sheet' | 'history' | 'diagnostics'
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'settings-panel';
    this.el.id = 'settings-panel';

    this.el.innerHTML = `
      <div class="settings-panel__overlay" id="settings-overlay"></div>
      <div class="settings-panel__drawer" id="settings-drawer">
        <div class="settings-panel__header">
          <h2 class="settings-panel__title">Settings</h2>
          <button class="btn btn--icon btn--ghost settings-panel__close" id="settings-close" aria-label="Close settings">✕</button>
        </div>
        <div class="settings-panel__tabs">
          <button class="settings-panel__tab is-active" data-section="settings">Settings</button>
          <button class="settings-panel__tab" data-section="accessibility">Accessibility</button>
          <button class="settings-panel__tab" data-section="sheet">Export</button>
          <button class="settings-panel__tab" data-section="history">Save</button>
          ${this._diagnosticsEnabled() ? '<button class="settings-panel__tab" data-section="diagnostics">Diagnostics</button>' : ''}
        </div>
        <div class="settings-panel__body" id="settings-body">
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

  _renderAISection() {
    const aiSettings = readAiSettings(this.project);
    const provider = aiSettings.provider || 'mock';
    const showOllamaUrl = provider === AI_PROVIDER_IDS.ollama;
    const showApiKey = provider === AI_PROVIDER_IDS.openai
      || provider === AI_PROVIDER_IDS.anthropic
      || provider === AI_PROVIDER_IDS.gemini;
    const apiKey = showApiKey ? aiReadApiKey(provider) : '';
    const keyStaged = showApiKey && !!apiKey;
    const models = providerModelsForUi(provider);
    return `
      <div class="settings-group">
        <h3 class="settings-group__title">AI Seed (experimental)</h3>
        <div class="settings-row" style="display: block;">
          <p class="settings-help" style="margin: 0 0 var(--space-sm) 0; color: var(--text-tertiary); font-size: var(--font-size-xs); line-height: 1.45;">
            Lets you ask an LLM to seed a snippet you'll then play with or refine. The AI is one of your instruments — the user is still the composer.
            Notenotes is BYO-key. <strong>Keys live in memory only and are forgotten when you reload — you'll re-enter them each session.</strong> Provider billing may apply. We never see, log, or relay your prompts.
          </p>
        </div>
        <div class="settings-row">
          <label class="settings-label" for="setting-ai-provider">Provider</label>
          <select class="settings-select" id="setting-ai-provider">
            <option value="mock"      ${provider === 'mock'      ? 'selected' : ''}>Mock (offline test)</option>
            <option value="openai"    ${provider === 'openai'    ? 'selected' : ''}>OpenAI</option>
            <option value="anthropic" ${provider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
            <option value="gemini"    ${provider === 'gemini'    ? 'selected' : ''}>Google Gemini</option>
            <option value="ollama"    ${provider === 'ollama'    ? 'selected' : ''}>Ollama (local)</option>
          </select>
        </div>
        <div class="settings-row">
          <label class="settings-label" for="setting-ai-model">Model</label>
          <select class="settings-select" id="setting-ai-model">
            ${models.map(m => `<option value="${escapeAttr(m)}" ${aiSettings.model === m ? 'selected' : ''}>${escapeHtml(modelDisplayLabel(provider, m))}</option>`).join('')}
          </select>
        </div>
        ${showOllamaUrl ? `
        <div class="settings-row">
          <label class="settings-label" for="setting-ai-ollama-url">Ollama base URL</label>
          <input class="settings-input" id="setting-ai-ollama-url" type="url" value="${escapeAttr(aiSettings.ollamaBaseUrl || 'http://localhost:11434/v1')}" placeholder="http://localhost:11434/v1" />
        </div>
        ` : ''}
        ${showApiKey ? `
        <div class="settings-row">
          <label class="settings-label" for="setting-ai-api-key">API key (this session)</label>
          <input class="settings-input" id="setting-ai-api-key" type="password" value="${escapeAttr(apiKey)}" placeholder="${escapeAttr(apiKeyPlaceholderFor(provider))}" autocomplete="off" />
        </div>
        <div class="settings-row" style="display: block;">
          <p class="settings-help" style="margin: 0 0 var(--space-xs) 0; color: var(--text-tertiary); font-size: var(--font-size-xs); line-height: 1.4;">
            ${escapeHtml(AI_DISCLAIMER_TEXT)}
          </p>
          <label class="settings-row" style="justify-content: flex-start; gap: 8px;">
            <input type="checkbox" id="setting-ai-disclaimer" ${aiSettings.disclaimerAccepted ? 'checked' : ''} />
            <span class="settings-label" style="white-space: normal;">I understand and accept these terms.</span>
          </label>
          <p class="settings-help" style="margin: var(--space-xs) 0 0 0; color: var(--text-tertiary); font-size: 11px;">
            ${keyStaged ? 'Key staged for this session. Reload the app to forget it.' : 'No key staged.'}
          </p>
        </div>
        ` : ''}
        <div class="settings-row" style="justify-content: flex-start; gap: 8px;">
          <button class="btn btn--ghost btn--sm" id="setting-ai-clear-keys" type="button">Forget AI key for this session</button>
        </div>
      </div>
    `;
  }

  _renderSheetSection() {
    const snippets = (this.project?.snippets || []).filter(s => s.type !== 'audio');
    const allSnippets = this.project?.snippets || [];
    const options = snippets.length
      ? snippets.map(s => `<option value="${s.id}">${s.name || `${(s.notes?.length || 0) + (s.hits?.length || 0)} events`}</option>`).join('')
      : '<option value="">No MIDI snippets yet</option>';
    const wavOptions = allSnippets.length
      ? allSnippets.map(s => `<option value="${s.id}">${s.name || (s.type === 'audio' ? 'Audio in recording' : `${(s.notes?.length || 0) + (s.hits?.length || 0)} events`)}</option>`).join('')
      : '<option value="">No snippets yet</option>';

    return `
      <div class="settings-section" id="section-sheet">
        <div class="settings-group">
          <h3 class="settings-group__title">MIDI Export</h3>
          <p class="settings-desc">Export the whole Canvas arrangement or an individual MIDI/drum snippet as a standard .mid file.</p>
          <div class="settings-row">
            <label class="settings-label">Canvas</label>
            <button class="btn btn--ghost" id="export-canvas-midi" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Export MIDI</button>
          </div>
          <div class="settings-row">
            <label class="settings-label">Snippet</label>
            <select class="settings-select" id="export-snippet-select" aria-label="MIDI snippet to export">
              ${options}
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label"></label>
            <button class="btn btn--ghost" id="export-snippet-midi" style="font-size:0.75rem;min-height:30px;padding:2px 10px;" ${snippets.length ? '' : 'disabled'}>Export Snippet MIDI</button>
          </div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Audio Export</h3>
          <p class="settings-desc">Export browser-rendered WAV files for a snippet or the whole Canvas. Tone settings are rendered into WAV. MP3 will need an optional encoder dependency later.</p>
          <div class="settings-row">
            <label class="settings-label">Canvas</label>
            <select class="settings-select" id="export-canvas-wav-channels" aria-label="Canvas WAV channel mode">
              <option value="stereo" selected>Stereo (pan)</option>
              <option value="mono">Mono</option>
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label"></label>
            <button class="btn btn--ghost" id="export-canvas-wav" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Export WAV</button>
          </div>
          <div class="settings-row">
            <label class="settings-label">Snippet</label>
            <select class="settings-select" id="export-snippet-wav-select" aria-label="WAV snippet to export">
              ${wavOptions}
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label">Channels</label>
            <select class="settings-select" id="export-snippet-wav-channels" aria-label="Snippet WAV channel mode">
              <option value="auto" selected>Auto</option>
              <option value="mono">Mono</option>
              <option value="stereo">Stereo</option>
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label"></label>
            <button class="btn btn--ghost" id="export-snippet-wav" style="font-size:0.75rem;min-height:30px;padding:2px 10px;" ${allSnippets.length ? '' : 'disabled'}>Export Snippet WAV</button>
          </div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Sheet Music</h3>
          <div id="section-sheet-music"></div>
        </div>
      </div>`;
  }

  _renderAccessibilitySection() {
    const accessibility = ensureAccessibilitySettings(this.project);
    const tremor = accessibility.tremorFilter;
    const dwell = accessibility.dwellPlay;
    return `
      <div class="settings-section" id="section-accessibility">
        <div class="settings-group">
          <h3 class="settings-group__title">Accessibility Profiles</h3>
          <p class="settings-desc">These settings change how Notenotes receives input. They can also be turned on from a shared link, such as <code>?tremor=1</code> or <code>?dwell=1</code>, so a user does not need to click through setup before the app becomes playable.</p>
          <div class="settings-row" style="justify-content: flex-start; gap: 10px;">
            <input type="checkbox" id="setting-tremor-enabled" ${tremor.enabled ? 'checked' : ''} />
            <label class="settings-label" for="setting-tremor-enabled">Tremor filter</label>
          </div>
          <p class="settings-desc">Ignores accidental rapid re-triggers of the same pad, key, or drum sound.</p>
          <div class="settings-row">
            <label class="settings-label">Tremor window (<span id="setting-tremor-display">${tremor.thresholdMs}</span> ms)</label>
            <input class="settings-range" id="setting-tremor-threshold" type="range" min="60" max="1000" step="10" value="${tremor.thresholdMs}" aria-label="Tremor filter threshold" />
          </div>
          <div class="settings-row" style="justify-content: flex-start; gap: 10px;">
            <input type="checkbox" id="setting-dwell-enabled" ${dwell.enabled ? 'checked' : ''} />
            <label class="settings-label" for="setting-dwell-enabled">Dwell play</label>
          </div>
          <p class="settings-desc">Hover over a playable pad, key, or drum sound until the dwell timer completes. Useful for head trackers, eye trackers, and users who can aim more easily than click.</p>
          <div class="settings-row">
            <label class="settings-label">Dwell time (<span id="setting-dwell-display">${dwell.thresholdMs}</span> ms)</label>
            <input class="settings-range" id="setting-dwell-threshold" type="range" min="150" max="2000" step="25" value="${dwell.thresholdMs}" aria-label="Dwell play threshold" />
          </div>
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
        e.preventDefault();
        this._switchSection(tab.dataset.section);
      };
      tab.addEventListener('pointerdown', activate);
      tab.addEventListener('click', activate);
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

  _bindAISettingsEvents(body) {
    if (!body) return;
    const refreshSection = () => {
      // Re-render only the settings section to reflect provider/disclaimer changes.
      body.innerHTML = this._renderSettingsSection();
      this._bindSettingsEvents();
    };

    body.querySelector('#setting-ai-provider')?.addEventListener('change', (e) => {
      const provider = e.target.value;
      const models = providerModelsForUi(provider);
      // Pick a sensible default model when switching providers.
      const model = models[0] || '';
      writeAiSettings(this.project, { provider, model });
      this.store?.scheduleAutoSave(this.project);
      refreshSection();
    });

    body.querySelector('#setting-ai-model')?.addEventListener('change', (e) => {
      writeAiSettings(this.project, { model: e.target.value });
      this.store?.scheduleAutoSave(this.project);
    });

    body.querySelector('#setting-ai-ollama-url')?.addEventListener('change', (e) => {
      writeAiSettings(this.project, { ollamaBaseUrl: e.target.value || 'http://localhost:11434/v1' });
      this.store?.scheduleAutoSave(this.project);
    });

    body.querySelector('#setting-ai-api-key')?.addEventListener('change', (e) => {
      const aiSettings = readAiSettings(this.project);
      aiWriteApiKey(aiSettings.provider, (e.target.value || '').trim());
      showToast('API key saved locally');
    });

    body.querySelector('#setting-ai-disclaimer')?.addEventListener('change', (e) => {
      writeAiSettings(this.project, { disclaimerAccepted: !!e.target.checked });
      this.store?.scheduleAutoSave(this.project);
    });

    body.querySelector('#setting-ai-clear-keys')?.addEventListener('click', (e) => {
      e.preventDefault();
      aiClearAllApiKeys();
      showToast('AI keys forgotten');
      refreshSection();
    });
  }

  _bindAccessibilityEvents() {
    const body = this.el.querySelector('#settings-body');
    const accessibility = ensureAccessibilitySettings(this.project);
    const save = () => {
      this.store?.scheduleAutoSave(this.project);
      window.dispatchEvent(new CustomEvent('settings-accessibility-changed', { detail: accessibility }));
    };

    body.querySelector('#setting-tremor-enabled')?.addEventListener('change', (e) => {
      accessibility.tremorFilter.enabled = !!e.target.checked;
      save();
      showToast(accessibility.tremorFilter.enabled ? 'Tremor filter enabled' : 'Tremor filter off');
    });

    body.querySelector('#setting-tremor-threshold')?.addEventListener('input', (e) => {
      const ms = Math.max(60, Math.min(1000, parseInt(e.target.value, 10) || 180));
      accessibility.tremorFilter.thresholdMs = ms;
      body.querySelector('#setting-tremor-display')?.replaceChildren(String(ms));
      save();
    });

    body.querySelector('#setting-dwell-enabled')?.addEventListener('change', (e) => {
      accessibility.dwellPlay.enabled = !!e.target.checked;
      save();
      showToast(accessibility.dwellPlay.enabled ? 'Dwell play enabled' : 'Dwell play off');
    });

    body.querySelector('#setting-dwell-threshold')?.addEventListener('input', (e) => {
      const ms = Math.max(150, Math.min(2000, parseInt(e.target.value, 10) || 450));
      accessibility.dwellPlay.thresholdMs = ms;
      body.querySelector('#setting-dwell-display')?.replaceChildren(String(ms));
      save();
    });
  }

  _beatColorsForBeats(beats = 4) {
    const defaults = ['#1e1e2e', '#2a2a3e', '#1e1e2e', '#2a2a3e', '#242436'];
    const existing = this.project?.settings?.beatColors || defaults;
    return Array.from({ length: beats }, (_, i) => existing[i] || defaults[i] || defaults[0]);
  }

  _switchSection(section) {
    if (section === 'diagnostics' && !this._diagnosticsEnabled()) section = 'settings';
    this._diagnosticsPanel?.destroy();
    this._diagnosticsPanel = null;
    this._activeSection = section;

    // Update tab visuals
    this.el.querySelectorAll('.settings-panel__tab').forEach(t => {
      t.classList.toggle('is-active', t.dataset.section === section);
    });

    const body = this.el.querySelector('#settings-body');

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
        this._sheetMusicView = new SheetMusicView(this.project);
        body.querySelector('#section-sheet-music')?.appendChild(this._sheetMusicView.render());
        this._bindExportEvents();
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
          if (!mount || this._activeSection !== 'diagnostics') return;
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

  _bindExportEvents() {
    const body = this.el.querySelector('#settings-body');
    body.querySelector('#export-canvas-midi')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!this.project) return;
      const stats = { renderedEvents: 0, skippedMismatchedClips: 0 };
      const blob = projectToMidiBlob(this.project, { stats });
      if (!stats.renderedEvents) {
        showToast('No MIDI or drum Canvas clips to export');
        return;
      }
      downloadBlob(blob, safeFilename(`${this.project.name || 'notenotes'}-canvas`, 'mid'));
      showToast(stats.skippedMismatchedClips ? 'Canvas MIDI exported, skipped mismatched clips' : 'Canvas MIDI exported');
    });

    body.querySelector('#export-canvas-wav')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this.project) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      showToast('Rendering Canvas WAV...');
      try {
        const stats = { skippedAudio: 0, skippedMismatchedClips: 0, renderedClips: 0 };
        const channelMode = body.querySelector('#export-canvas-wav-channels')?.value || 'stereo';
        const blob = await projectToWavBlob(this.project, { store: this.store, stats, channelMode });
        if (!stats.renderedClips) {
          showToast('No audible Canvas clips to export');
          return;
        }
        downloadBlob(blob, safeFilename(`${this.project.name || 'notenotes'}-canvas`, 'wav'));
        const skipped = [];
        if (stats.skippedAudio) skipped.push(`${stats.skippedAudio} unavailable audio clip${stats.skippedAudio === 1 ? '' : 's'}`);
        if (stats.skippedMismatchedClips) skipped.push(`${stats.skippedMismatchedClips} mismatched clip${stats.skippedMismatchedClips === 1 ? '' : 's'}`);
        showToast(skipped.length ? `Canvas WAV exported, skipped ${skipped.join(' and ')}` : 'Canvas WAV exported');
      } catch (err) {
        console.error('[Settings] Canvas WAV export failed:', err);
        showToast('Canvas WAV export failed');
      } finally {
        btn.disabled = false;
      }
    });

    body.querySelector('#export-snippet-midi')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const snippetId = body.querySelector('#export-snippet-select')?.value;
      const snippet = this.project?.snippets?.find(s => s.id === snippetId);
      if (!snippet) return;
      const stats = { renderedEvents: 0 };
      const blob = snippetToMidiBlob(snippet, this.project, { stats });
      if (!stats.renderedEvents) {
        showToast('Selected snippet has no MIDI events');
        return;
      }
      downloadBlob(blob, safeFilename(snippet.name || 'snippet', 'mid'));
      showToast('Snippet MIDI exported');
    });

    body.querySelector('#export-snippet-wav')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      const snippetId = body.querySelector('#export-snippet-wav-select')?.value;
      const snippet = this.project?.snippets?.find(s => s.id === snippetId);
      if (!snippet) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      showToast('Rendering snippet WAV...');
      try {
        const stats = { skippedAudio: 0 };
        const channelMode = body.querySelector('#export-snippet-wav-channels')?.value || 'auto';
        const blob = await snippetToWavBlob(snippet, this.project, { store: this.store, stats, channelMode });
        downloadBlob(blob, safeFilename(snippet.name || 'snippet', 'wav'));
        showToast(stats.skippedAudio ? 'Snippet WAV exported without unavailable audio' : 'Snippet WAV exported');
      } catch (err) {
        console.error('[Settings] Snippet WAV export failed:', err);
        showToast(err?.message || 'Snippet WAV export failed');
      } finally {
        btn.disabled = false;
      }
    });
  }

  open() {
    this.openTo(this._activeSection);
  }

  openTo(section = 'settings', options = {}) {
    this._isOpen = true;
    this.el.classList.add('is-open');
    this._switchSection(section);
    if (options.focus === 'ai') {
      requestAnimationFrame(() => {
        const provider = this.el?.querySelector('#setting-ai-provider');
        provider?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        try { provider?.focus(); } catch (_) {}
      });
    }
    this._dumpDebugSnapshot('settings-open');
  }

  close() {
    this._isOpen = false;
    this._diagnosticsPanel?.destroy();
    this._diagnosticsPanel = null;
    this.el.classList.remove('is-open');
  }

  toggle() {
    if (this._isOpen) this.close();
    else this.open();
  }
}

Object.assign(SettingsPanel.prototype, SaveSectionMixin);
