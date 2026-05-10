/**
 * SettingsPanel — Slide-out panel for app-wide settings.
 * Includes quantization, metronome settings, project management,
 * version history, project milestones, install help, and export.
 */

import { QuantizeGrid } from '../engine/Quantizer.js';
import { SheetMusicView } from '../export/SheetMusicView.js';
import { downloadBlob, projectToMidiBlob, safeFilename, snippetToMidiBlob } from '../export/MidiExporter.js';
import { projectToWavBlob, snippetToWavBlob } from '../export/WavExporter.js';
import { backupFilename, customInstrumentsWithFreshIds, readJsonFile, saveJsonFile, snippetsBackup, snippetsWithFreshIds, validateBackup, workspaceBackup } from '../export/BackupExporter.js';
import { CHORD_TYPES, ARP_PATTERNS, ARP_RATES } from '../engine/ArpeggioManager.js';
import { DEFAULT_VERSION_HISTORY_LIMIT, VERSION_HISTORY_LIMITS } from '../data/ProjectStore.js';
import { APP_VERSION } from '../version.js';
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

const TIME_SIGNATURE_OPTIONS = [
  { beats: 2, subdivision: 4, label: '2/4' },
  { beats: 3, subdivision: 4, label: '3/4' },
  { beats: 4, subdivision: 4, label: '4/4' },
  { beats: 5, subdivision: 4, label: '5/4' },
];

const BACKUP_CONTENT_OPTIONS = [
  { id: 'current', label: 'Current workspace' },
  { id: 'milestones', label: 'Workspace + milestones' },
  { id: 'archive', label: 'Full archive' },
];

function byteLength(text = '') {
  return new TextEncoder().encode(text).length;
}

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function percent(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

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
   * @param {object} deps - { transport, metronome, quantizer, store, project }
   */
  constructor(deps) {
    this.transport = deps.transport;
    this.metronome = deps.metronome;
    this.quantizer = deps.quantizer;
    this.store = deps.store;
    this.project = deps.project;
    this.el = null;
    this._isOpen = false;
    this._sheetMusicView = null;
    this._activeSection = 'settings'; // 'settings' | 'sheet' | 'history'
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
          <button class="settings-panel__tab" data-section="sheet">Export</button>
          <button class="settings-panel__tab" data-section="history">Save</button>
        </div>
        <div class="settings-panel__body" id="settings-body">
          ${this._renderSettingsSection()}
        </div>
      </div>
    `;

    this._bindEvents();
    return this.el;
  }

  _renderSettingsSection() {
    const q = this.project?.settings?.quantize || 0;
    const metVol = this.project?.settings?.metronomeVolume ?? 0.5;
    const masterVol = this.project?.settings?.masterVolume ?? 0.8;
    const timeSig = this.project?.timeSignature || this.transport?.timeSignature || { beats: 4, subdivision: 4 };
    const timeSigValue = `${timeSig.beats}/${timeSig.subdivision}`;
    const beatColors = this._beatColorsForBeats(timeSig.beats);

    return `
      <div class="settings-section" id="section-settings">
        <div class="settings-group">
          <h3 class="settings-group__title">Project</h3>
          <div class="settings-row">
            <label class="settings-label">Name</label>
            <input class="settings-input" id="setting-project-name" type="text" value="${this.project?.name || 'Untitled'}" aria-label="Project name"/>
          </div>
          <div class="settings-row">
            <label class="settings-label">BPM</label>
            <input class="settings-input settings-input--sm" id="setting-bpm" type="number" min="40" max="240" value="${this.transport?.bpm || 120}" aria-label="BPM"/>
          </div>
          <div class="settings-row">
            <label class="settings-label">Time Signature</label>
            <select class="settings-select" id="setting-time-signature" aria-label="Project time signature">
              ${TIME_SIGNATURE_OPTIONS.map(ts => {
                const value = `${ts.beats}/${ts.subdivision}`;
                return `<option value="${value}" ${timeSigValue === value ? 'selected' : ''}>${ts.label}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label">App Version</label>
            <span class="settings-value">${APP_VERSION}</span>
          </div>
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
          <h3 class="settings-group__title">Quantization</h3>
          <div class="settings-row">
            <label class="settings-label">Grid</label>
            <select class="settings-select" id="setting-quantize" aria-label="Quantize grid">
              <option value="0" ${q === 0 ? 'selected' : ''}>Free (OFF)</option>
              <option value="1" ${q === 1 ? 'selected' : ''}>1/4 Note</option>
              <option value="2" ${q === 2 ? 'selected' : ''}>1/8 Note</option>
              <option value="3" ${q === 3 ? 'selected' : ''}>1/16 Note</option>
              <option value="4" ${q === 4 ? 'selected' : ''}>1/4 Triplet</option>
              <option value="5" ${q === 5 ? 'selected' : ''}>1/8 Triplet</option>
              <option value="6" ${q === 6 ? 'selected' : ''}>1/32 Note</option>
            </select>
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
          <h3 class="settings-group__title">Scale Board</h3>
          <div class="settings-row">
            <label class="settings-label">Number of Pads (<span id="setting-pads-display">${this.project?.settings?.scalePadsCount || 7}</span>)</label>
            <input class="settings-range" id="setting-pads-count" type="range" min="1" max="16" value="${this.project?.settings?.scalePadsCount || 7}" aria-label="Scale board pads count"/>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Piano</h3>
          <div class="settings-row">
            <label class="settings-label">Pianos</label>
            <select class="settings-select" id="setting-piano-count" aria-label="Number of pianos">
              <option value="1" ${(this.project?.settings?.pianoCount || 1) === 1 ? 'selected' : ''}>1</option>
              <option value="2" ${(this.project?.settings?.pianoCount || 1) === 2 ? 'selected' : ''}>2</option>
            </select>
          </div>
          <div class="settings-row">
            <label class="settings-label">Keys (<span id="setting-keys-display">${this.project?.settings?.pianoKeys || 12}</span>)</label>
            <input class="settings-range" id="setting-piano-keys" type="range" min="10" max="32" value="${this.project?.settings?.pianoKeys || 12}" aria-label="Piano keys"/>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group__title">Drum Kit</h3>
          <div class="settings-row">
            <label class="settings-label">Number of Pads (<span id="setting-drum-display">${this.project?.settings?.drumPads || 10}</span>)</label>
            <input class="settings-range" id="setting-drum-pads" type="range" min="1" max="10" value="${this.project?.settings?.drumPads || 10}" aria-label="Drum kit pad count"/>
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
            Notenotes is BYO-key. <strong>Keys live in memory only and are forgotten when you reload — you'll re-enter them each session.</strong> Costs go to your provider, not us. We never see, log, or relay your prompts.
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
            <button class="btn btn--ghost" id="export-canvas-wav" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Export WAV</button>
          </div>
          <div class="settings-row">
            <label class="settings-label">Snippet</label>
            <select class="settings-select" id="export-snippet-wav-select" aria-label="WAV snippet to export">
              ${wavOptions}
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

  _renderHistorySection() {
    const historyLimit = VERSION_HISTORY_LIMITS.includes(Number(this.project?.settings?.versionHistoryLimit))
      ? Number(this.project.settings.versionHistoryLimit)
      : DEFAULT_VERSION_HISTORY_LIMIT;
    const backupContents = this.project?.settings?.backupContents || 'current';
    return `
      <div class="settings-section" id="section-history">
        <div class="settings-group">
          <h3 class="settings-group__title">Storage</h3>
          <p class="settings-desc">Notenotes saves work in this browser. Browser storage is convenient, but it is not a backup file you own. Save workspace backups for anything you would hate to lose.</p>
          <div class="storage-meter" id="storage-meter">
            <div class="storage-meter__bar" aria-hidden="true">
              <span class="storage-meter__fill" id="storage-meter-fill" style="width:0%;"></span>
            </div>
            <div class="storage-meter__stats">
              <span id="storage-meter-used">Checking storage...</span>
              <span id="storage-meter-quota"></span>
            </div>
          </div>
          <div class="settings-row">
            <label class="settings-label">Audio</label>
            <span class="settings-value" id="storage-audio-count">Checking...</span>
          </div>
          <div class="settings-row">
            <label class="settings-label">Workspace backup</label>
            <span class="settings-value" id="storage-backup-size">Estimating...</span>
          </div>
          <p class="settings-desc" id="storage-advice">Checking storage...</p>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Backups</h3>
          <p class="settings-desc">Save portable JSON files outside browser storage. Workspace backups restore the project; snippet backups restore just the snippet library. Older backups can import into newer Notenotes builds, but newer backups will not import into older builds.</p>
          <div class="settings-row">
            <label class="settings-label">Contents</label>
            <select class="settings-select" id="backup-contents" aria-label="Workspace backup contents">
              ${BACKUP_CONTENT_OPTIONS.map(option => `<option value="${option.id}" ${backupContents === option.id ? 'selected' : ''}>${option.label}</option>`).join('')}
            </select>
          </div>
          <p class="settings-desc" id="backup-contents-desc">${this._backupContentsDescription(backupContents)}</p>
          <div class="settings-row">
            <label class="settings-label">Workspace</label>
            <button class="btn btn--ghost" id="backup-workspace-save" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Save Backup</button>
          </div>
          <div class="settings-row">
            <label class="settings-label">Snippets</label>
            <button class="btn btn--ghost" id="backup-snippets-save" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Save Backup</button>
          </div>
          <div class="settings-row">
            <label class="settings-label">Restore</label>
            <button class="btn btn--ghost" id="backup-import-btn" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Import Backup</button>
            <input id="backup-import-file" type="file" accept="application/json,.json" hidden />
          </div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Milestones</h3>
          <p class="settings-desc">Save named project checkpoints when you reach an important idea. Milestones are kept until browser data is cleared.</p>
          <div class="settings-row">
            <label class="settings-label">Name</label>
            <input class="settings-input" id="milestone-name" type="text" placeholder="Verse idea, Beta 1..." aria-label="Milestone name"/>
          </div>
          <div class="settings-row">
            <label class="settings-label"></label>
            <button class="btn btn--primary" id="milestone-save" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Save Milestone</button>
          </div>
          <div id="milestone-list" class="version-list">
            <div class="version-list__loading">Loading milestones...</div>
          </div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Version History</h3>
          <p class="settings-desc">Restore to a previous save. Higher limits use more local browser storage.</p>
          <div class="settings-row">
            <label class="settings-label">Keep</label>
            <select class="settings-select" id="version-history-limit" aria-label="Version history depth">
              ${VERSION_HISTORY_LIMITS.map(limit => `<option value="${limit}" ${historyLimit === limit ? 'selected' : ''}>${limit} versions</option>`).join('')}
            </select>
          </div>
          <div id="version-list" class="version-list">
            <div class="version-list__loading">Loading versions...</div>
          </div>
        </div>
      </div>
    `;
  }

  _backupContentsDescription(contents = 'current') {
    if (contents === 'archive') return 'Full archive includes the current workspace, milestones, and version history. This is the biggest file and the safest handoff.';
    if (contents === 'milestones') return 'Includes the current workspace and named milestones, but leaves auto-save history out.';
    return 'Includes the current workspace only. This is the smallest normal project backup.';
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

    // BPM
    body.querySelector('#setting-bpm')?.addEventListener('change', (e) => {
      const bpm = parseInt(e.target.value, 10);
      if (bpm >= 40 && bpm <= 240) {
        this.transport.bpm = bpm;
        if (this.project) {
          this.project.bpm = bpm;
          this.store?.scheduleAutoSave(this.project);
        }
        showToast(`BPM: ${bpm}`);
      }
    });

    body.querySelector('#setting-time-signature')?.addEventListener('change', (e) => {
      const [beats, subdivision] = e.target.value.split('/').map(v => parseInt(v, 10));
      this._setProjectTimeSignature({ beats, subdivision });
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

    // Quantize
    body.querySelector('#setting-quantize')?.addEventListener('change', (e) => {
      const grid = parseInt(e.target.value, 10);
      this.quantizer?.setGrid(grid);
      if (this.project) {
        this.project.settings.quantize = grid;
        this.store?.scheduleAutoSave(this.project);
      }
    });

    // Metronome volume
    body.querySelector('#setting-met-vol')?.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10) / 100;
      if (this.metronome) this.metronome.volume = vol;
      if (this.project) this.project.settings.metronomeVolume = vol;
    });

      // Master volume
      body.querySelector('#setting-master-vol')?.addEventListener('input', (e) => {
        const vol = parseInt(e.target.value, 10) / 100;
        const engine = this.transport?.engine;
        if (engine?.masterGain) {
          engine.masterGain.gain.setTargetAtTime(vol, engine.currentTime, 0.01);
        }
        if (this.project) this.project.settings.masterVolume = vol;
      });

      // Scale pads count
      body.querySelector('#setting-pads-count')?.addEventListener('input', (e) => {
        let count = parseInt(e.target.value, 10);
        if (isNaN(count) || count < 1) count = 7;
        if (count > 16) count = 16;
        
        const display = body.querySelector('#setting-pads-display');
        if (display) display.textContent = count;

        if (this.project) {
          this.project.settings.scalePadsCount = count;
          this.store?.scheduleAutoSave(this.project);
          window.dispatchEvent(new CustomEvent('settings-pads-changed', { detail: { count } }));
        }
      });

      // Piano count
      body.querySelector('#setting-piano-count')?.addEventListener('change', (e) => {
        const count = parseInt(e.target.value, 10);
        if (this.project) {
          this.project.settings.pianoCount = count;
          this.store?.scheduleAutoSave(this.project);
          window.dispatchEvent(new CustomEvent('settings-piano-changed'));
        }
      });

      // Piano keys
      body.querySelector('#setting-piano-keys')?.addEventListener('input', (e) => {
        let keys = parseInt(e.target.value, 10);
        if (isNaN(keys) || keys < 10) keys = 12;
        if (keys > 32) keys = 32;

        const display = body.querySelector('#setting-keys-display');
        if (display) display.textContent = keys;

        if (this.project) {
          this.project.settings.pianoKeys = keys;
          this.store?.scheduleAutoSave(this.project);
          window.dispatchEvent(new CustomEvent('settings-piano-changed'));
        }
      });

      // Drum pads count
      body.querySelector('#setting-drum-pads')?.addEventListener('input', (e) => {
        let count = parseInt(e.target.value, 10);
        if (isNaN(count) || count < 1) count = 10;
        if (count > 10) count = 10;

        const display = body.querySelector('#setting-drum-display');
        if (display) display.textContent = count;

        if (this.project) {
          this.project.settings.drumPads = count;
          this.store?.scheduleAutoSave(this.project);
          window.dispatchEvent(new CustomEvent('settings-pads-changed'));
        }
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
              this.project.settings.beatColors = this._beatColorsForBeats(this.project.timeSignature?.beats || 4);
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

  _beatColorsForBeats(beats = 4) {
    const defaults = ['#1e1e2e', '#2a2a3e', '#1e1e2e', '#2a2a3e', '#242436'];
    const existing = this.project?.settings?.beatColors || defaults;
    return Array.from({ length: beats }, (_, i) => existing[i] || defaults[i] || defaults[0]);
  }

  _setProjectTimeSignature(next) {
    if (!this.project || !this.transport || !Number.isFinite(next.beats) || !Number.isFinite(next.subdivision)) {
      return;
    }

    const current = this.project.timeSignature || this.transport.timeSignature || { beats: 4, subdivision: 4 };
    if (current.beats === next.beats && current.subdivision === next.subdivision) return;

    const oldTicksPerBar = this.transport.ticksPerBar;
    const clipPositions = [];
    for (const track of (this.project.tracks || [])) {
      for (const clip of (track.clips || [])) {
        clipPositions.push({
          clip,
          startTick: (clip.startBar || 0) * oldTicksPerBar,
          durationTicks: clip.snippet?.durationTicks || (clip.durationBars || 1) * oldTicksPerBar,
        });
      }
    }

    if (this.transport.state !== 'stopped') {
      this.transport.stop();
    }

    this.project.timeSignature = { beats: next.beats, subdivision: next.subdivision };
    this.transport.timeSignature = this.project.timeSignature;
    const newTicksPerBar = this.transport.ticksPerBar;

    for (const item of clipPositions) {
      item.clip.startBar = item.startTick / newTicksPerBar;
      item.clip.durationBars = item.durationTicks / newTicksPerBar;
    }

    this.project.settings.beatColors = this._beatColorsForBeats(next.beats);
    this.store?.scheduleAutoSave(this.project);
    window.dispatchEvent(new CustomEvent('project-time-signature-changed', {
      detail: { timeSignature: { ...this.project.timeSignature } },
    }));

    const body = this.el.querySelector('#settings-body');
    if (body && this._activeSection === 'settings') {
      body.innerHTML = this._renderSettingsSection();
      this._bindSettingsEvents();
    }

    showToast(`Time signature: ${next.beats}/${next.subdivision}`);
  }

  _switchSection(section) {
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
    }
  }

  async _loadVersionHistory() {
    if (!this.project || !this.store) return;
    const listEl = this.el.querySelector('#version-list');
    if (!listEl) return;

    try {
      const versions = await this.store.getVersions(this.project.id);
      if (versions.length === 0) {
        listEl.innerHTML = '<div class="version-list__empty">No saved versions yet</div>';
        return;
      }

      listEl.innerHTML = versions.map(v => {
        const date = new Date(v.timestamp);
        const timeStr = date.toLocaleString();
        return `
          <div class="version-list__item" data-version-id="${v.versionId}">
            <div class="version-list__info">
              <span class="version-list__time">${timeStr}</span>
              <span class="version-list__meta">${v.bpm} BPM</span>
            </div>
            <button class="btn btn--ghost version-list__restore" data-version-id="${v.versionId}">Restore</button>
          </div>
        `;
      }).join('');

      // Bind restore buttons
      listEl.querySelectorAll('.version-list__restore').forEach(btn => {
        btn.addEventListener('pointerdown', async (e) => {
          e.preventDefault();
          const vid = parseInt(btn.dataset.versionId, 10);
          if (confirm('Restore this version? Current changes will be saved first.')) {
            await this.store.save(this.project);
            const restored = await this.store.restoreVersion(vid);
            showToast('Version restored! Reload to apply.');
            // Force reload to apply
            setTimeout(() => window.location.reload(), 500);
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = '<div class="version-list__empty">Error loading versions</div>';
      console.error('[Settings] Version history error:', err);
    }
  }

  async _loadStorageStatus() {
    const body = this.el.querySelector('#settings-body');
    if (!body || !this.project) return;

    const fillEl = body.querySelector('#storage-meter-fill');
    const usedEl = body.querySelector('#storage-meter-used');
    const quotaEl = body.querySelector('#storage-meter-quota');
    const audioEl = body.querySelector('#storage-audio-count');
    const backupEl = body.querySelector('#storage-backup-size');
    const adviceEl = body.querySelector('#storage-advice');

    try {
      const estimate = await navigator.storage?.estimate?.();
      const usage = estimate?.usage || 0;
      const quota = estimate?.quota || 0;
      const usedPercent = percent(usage, quota);

      if (fillEl) {
        fillEl.style.width = `${usedPercent}%`;
        fillEl.classList.toggle('is-warning', usedPercent >= 70);
        fillEl.classList.toggle('is-danger', usedPercent >= 85);
      }
      if (usedEl) usedEl.textContent = quota ? `${formatBytes(usage)} used` : 'Storage estimate unavailable';
      if (quotaEl) quotaEl.textContent = quota ? `${usedPercent.toFixed(1)}% of ${formatBytes(quota)}` : '';

      const audioStats = await this.store?.getAudioAssetStats?.(this.project);
      const audioBytes = audioStats?.bytes || 0;
      const audioCount = audioStats?.audioSnippetCount || 0;
      const missing = audioStats?.missing || 0;
      const backupBytes = this._estimateWorkspaceBackupBytes(audioBytes);

      if (audioEl) {
        const missingText = missing ? `, ${missing} unavailable` : '';
        audioEl.textContent = `${audioCount} recording${audioCount === 1 ? '' : 's'}, ${formatBytes(audioBytes)}${missingText}`;
      }
      if (backupEl) backupEl.textContent = `About ${formatBytes(backupBytes)}`;
      if (adviceEl) {
        if (missing > 0) {
          adviceEl.textContent = 'Some older audio clips are unavailable. Save a fresh workspace backup after checking the project.';
        } else if (usedPercent >= 85) {
          adviceEl.textContent = 'Storage is getting tight. Save a workspace backup outside the browser before recording more audio.';
        } else if (audioCount > 0) {
          adviceEl.textContent = 'Audio recordings are stored locally. Save a workspace backup when you reach a version you care about.';
        } else {
          adviceEl.textContent = 'No audio recordings yet. Browser storage is still local, so workspace backups are the safest handoff point.';
        }
      }
    } catch (err) {
      console.warn('[Settings] Storage estimate failed:', err);
      if (usedEl) usedEl.textContent = 'Storage estimate unavailable';
      if (quotaEl) quotaEl.textContent = '';
      if (audioEl) audioEl.textContent = 'Could not check audio storage';
      if (backupEl) backupEl.textContent = 'Could not estimate';
      if (adviceEl) adviceEl.textContent = 'Save workspace backups outside the browser for anything important.';
    }
  }

  _estimateWorkspaceBackupBytes(audioBytes = 0) {
    const contents = this.project?.settings?.backupContents || 'current';
    const projectBytes = byteLength(JSON.stringify(workspaceBackup(this.project, { contents })));
    const multiplier = contents === 'archive' ? 2.5 : contents === 'milestones' ? 1.6 : 1;
    const base64AudioBytes = Math.ceil(audioBytes * 1.37 * multiplier);
    return Math.ceil(projectBytes * multiplier + base64AudioBytes);
  }

  async _dumpDebugSnapshot(reason = 'manual') {
    if (!this.project?.settings?.debugLogging) return;
    try {
      const audioStats = await this.store?.getAudioAssetStats?.(this.project);
      const storage = await navigator.storage?.estimate?.();
      const snippets = this.project?.snippets || [];
      const tracks = this.project?.tracks || [];
      const byType = snippets.reduce((counts, snippet) => {
        counts[snippet.type || 'unknown'] = (counts[snippet.type || 'unknown'] || 0) + 1;
        return counts;
      }, {});
      console.info('[Notenotes Debug]', {
        reason,
        appVersion: APP_VERSION,
        project: {
          id: this.project.id,
          name: this.project.name,
          bpm: this.project.bpm,
          timeSignature: this.project.timeSignature,
          tracks: tracks.length,
          clips: tracks.reduce((total, track) => total + (track.clips?.length || 0), 0),
          snippets: snippets.length,
          snippetsByType: byType,
        },
        audio: {
          snippets: audioStats?.audioSnippetCount || 0,
          assets: audioStats?.audioAssetCount || 0,
          bytes: audioStats?.bytes || 0,
          readableSize: formatBytes(audioStats?.bytes || 0),
          missing: audioStats?.missing || 0,
        },
        browserStorage: storage ? {
          usage: storage.usage || 0,
          quota: storage.quota || 0,
          readableUsage: formatBytes(storage.usage || 0),
          readableQuota: formatBytes(storage.quota || 0),
        } : 'unavailable',
        settings: {
          backupContents: this.project.settings?.backupContents,
          versionHistoryLimit: this.project.settings?.versionHistoryLimit,
          quantize: this.project.settings?.quantize,
        },
      });
    } catch (err) {
      console.warn('[Notenotes Debug] Snapshot failed:', err);
    }
  }

  async _workspaceBackupPayload(contents = 'current') {
    const portableProject = await this.store.embedAudioForBackup(this.project);
    const options = { contents };
    if (contents === 'milestones' || contents === 'archive') {
      const milestones = await this.store.getMilestoneSnapshots(this.project.id);
      options.milestones = await Promise.all(milestones.map(async snapshot => ({
        ...snapshot,
        data: await this.store.embedAudioForBackup(snapshot.data),
      })));
    }
    if (contents === 'archive') {
      const versions = await this.store.getVersionSnapshots(this.project.id);
      options.versions = await Promise.all(versions.map(async snapshot => ({
        ...snapshot,
        data: await this.store.embedAudioForBackup(snapshot.data),
      })));
    }
    return workspaceBackup(portableProject, options);
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
        const blob = await projectToWavBlob(this.project, { store: this.store, stats });
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
        const blob = await snippetToWavBlob(snippet, this.project, { store: this.store, stats });
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

  _bindBackupEvents() {
    const body = this.el.querySelector('#settings-body');

    body.querySelector('#backup-contents')?.addEventListener('change', (e) => {
      if (!this.project) return;
      this.project.settings ||= {};
      this.project.settings.backupContents = e.target.value;
      const desc = body.querySelector('#backup-contents-desc');
      if (desc) desc.textContent = this._backupContentsDescription(e.target.value);
      this.store?.scheduleAutoSave(this.project);
      this._loadStorageStatus();
    });

    body.querySelector('#version-history-limit')?.addEventListener('change', (e) => {
      if (!this.project) return;
      const limit = parseInt(e.target.value, 10);
      if (!VERSION_HISTORY_LIMITS.includes(limit)) return;
      this.project.settings ||= {};
      this.project.settings.versionHistoryLimit = limit;
      this.store?.scheduleAutoSave(this.project);
      showToast(`Keeping up to ${limit} versions`);
    });

    body.querySelector('#backup-workspace-save')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this.project) return;
      await this.store?.save(this.project);
      try {
        const contents = this.project?.settings?.backupContents || 'current';
        const backup = await this._workspaceBackupPayload(contents);
        const suffix = contents === 'archive' ? 'archive' : contents === 'milestones' ? 'workspace-milestones' : 'workspace';
        await saveJsonFile(backup, backupFilename(this.project, suffix));
        showToast('Workspace backup saved');
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('[Settings] Workspace backup failed:', err);
          showToast('Workspace backup failed');
        }
      }
    });

    body.querySelector('#backup-snippets-save')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this.project) return;
      await this.store?.save(this.project);
      try {
        const portableProject = await this.store.embedAudioForBackup(this.project);
        await saveJsonFile(snippetsBackup(portableProject), backupFilename(this.project, 'snippets'));
        showToast('Snippet backup saved');
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('[Settings] Snippet backup failed:', err);
          showToast('Snippet backup failed');
        }
      }
    });

    const importInput = body.querySelector('#backup-import-file');
    body.querySelector('#backup-import-btn')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      importInput?.click();
    });

    importInput?.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (!file || !this.store) return;

      try {
        const backup = await readJsonFile(file);
        const type = validateBackup(backup);

        if (type === 'workspace') {
          await this.store.replaceProjectArchive(backup.project, {
            milestones: backup.milestones,
            versions: backup.versions,
          });
          showToast('Workspace restored. Reloading...');
          setTimeout(() => window.location.reload(), 500);
          return;
        }

        if (!this.project) return;
        this.project.snippets = [
          ...(this.project.snippets || []),
          ...snippetsWithFreshIds(backup.snippets),
        ];
        if (Array.isArray(backup.customInstruments) && backup.customInstruments.length) {
          this.project.settings ||= {};
          this.project.settings.customInstruments = [
            ...(this.project.settings.customInstruments || []),
            ...customInstrumentsWithFreshIds(backup.customInstruments),
          ];
          await this.store.migrateCustomInstrumentAudioAssets(this.project.settings.customInstruments);
        }
        await this.store.migrateSnippetsAudioAssets(this.project.snippets);
        await this.store.save(this.project);
        showToast(`Imported ${backup.snippets.length} snippets. Reloading...`);
        setTimeout(() => window.location.reload(), 500);
      } catch (err) {
        console.error('[Settings] Backup import failed:', err);
        showToast(err?.message || 'Backup import failed');
      }
    });
  }

  _bindMilestoneEvents() {
    const body = this.el.querySelector('#settings-body');
    body.querySelector('#milestone-save')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this.project || !this.store) return;
      const input = body.querySelector('#milestone-name');
      const label = input?.value || '';
      await this.store.save(this.project);
      await this.store.saveMilestone(this.project, label);
      if (input) input.value = '';
      await this._loadMilestones();
      showToast('Milestone saved');
    });
  }

  async _loadMilestones() {
    if (!this.project || !this.store) return;
    const listEl = this.el.querySelector('#milestone-list');
    if (!listEl) return;

    try {
      const milestones = await this.store.getMilestones(this.project.id);
      if (milestones.length === 0) {
        listEl.innerHTML = '<div class="version-list__empty">No milestones yet</div>';
        return;
      }

      listEl.innerHTML = milestones.map(m => {
        const date = new Date(m.timestamp);
        return `
          <div class="version-list__item" data-milestone-id="${m.milestoneId}">
            <div class="version-list__info">
              <span class="version-list__time">${m.label}</span>
              <span class="version-list__meta">${date.toLocaleString()} - ${m.bpm} BPM</span>
            </div>
            <button class="btn btn--ghost milestone-list__restore" data-milestone-id="${m.milestoneId}">Load</button>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.milestone-list__restore').forEach(btn => {
        btn.addEventListener('pointerdown', async (e) => {
          e.preventDefault();
          const id = parseInt(btn.dataset.milestoneId, 10);
          if (confirm('Load this milestone? Current changes will be saved first.')) {
            await this.store.save(this.project);
            await this.store.restoreMilestone(id);
            showToast('Milestone loaded. Reloading...');
            setTimeout(() => window.location.reload(), 500);
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = '<div class="version-list__empty">Error loading milestones</div>';
      console.error('[Settings] Milestone error:', err);
    }
  }

  open() {
    this._isOpen = true;
    this.el.classList.add('is-open');
    this._switchSection(this._activeSection);
    this._dumpDebugSnapshot('settings-open');
  }

  close() {
    this._isOpen = false;
    this.el.classList.remove('is-open');
  }

  toggle() {
    if (this._isOpen) this.close();
    else this.open();
  }
}
