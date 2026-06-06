/**
 * aiSection — SettingsPanel AI provider tab (render + event binding) plus its
 * private formatting helpers.
 *
 * Methods split out of SettingsPanel for size and composed back via
 * Object.assign. Bodies unchanged.
 */

import { OpenAIProvider } from '../../ai/OpenAIProvider.js';
import { AnthropicProvider } from '../../ai/AnthropicProvider.js';
import { GeminiProvider } from '../../ai/GeminiProvider.js';
import {
  DISCLAIMER_TEXT as AI_DISCLAIMER_TEXT,
  PROVIDER_IDS as AI_PROVIDER_IDS,
  clearAllApiKeys as aiClearAllApiKeys,
  readAiSettings,
  readApiKey as aiReadApiKey,
  writeAiSettings,
  writeApiKey as aiWriteApiKey,
} from '../../ai/aiSettings.js';
import { showToast } from '../Toast.js';

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

export const AiSectionMixin = {
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
  },

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
  },
};
