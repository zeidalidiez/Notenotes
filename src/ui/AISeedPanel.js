/**
 * AISeedPanel — Inline UI for seeding a snippet via AI.
 *
 * Renders as a collapsible panel (closed by default). When open, shows:
 *   - Read-only active instrument label.
 *   - Bar-length picker (1 / 2 / 4 / 8).
 *   - Free-text prompt textarea with per-instrument suggestion chips.
 *   - Cost estimate (refreshed when prompt or settings change).
 *   - Generate button (or Cancel while in flight).
 *   - Status line with success/error feedback.
 *
 * Owned by CreativeMode. Talks to AIController for generation. On success,
 * fires `onSnippetCreated(snippet)` so CreativeMode can add it to the
 * project + snippet tray.
 *
 * No-go-zone: this component never makes a network call. Everything goes
 * through AIController so the project tenets (BYO-key, no telemetry,
 * AI-as-instrument framing) are enforced in one place.
 */

import { ALLOWED_LENGTHS_BARS } from '../ai/PromptBuilder.js';
import { readAiSettings } from '../ai/aiSettings.js';
import { AI_INSTRUMENTS } from '../ai/sequence-schema.js';

const SUGGESTIONS_BY_INSTRUMENT = {
  scaleboard: [
    'a hopeful melodic hook',
    'a sad descending line',
    'a syncopated bass riff',
    'a bright morning motif',
    'a tense dissonant climb',
  ],
  piano: [
    'a chord progression that resolves home',
    'an arpeggiated lead',
    'a slow lullaby motif',
    'a hard-hitting riff',
    'a meandering jazz line',
  ],
  kit: [
    'a punchy boom-bap beat',
    'a half-time hip-hop groove',
    'a fast techno pattern',
    'a sparse trap-flavored groove',
    'a four-on-the-floor disco beat',
  ],
};

export class AISeedPanel {
  /**
   * @param {object} deps
   * @param {AIController} deps.controller
   * @param {() => object} deps.getProject
   * @param {(snippet: object) => void} deps.onSnippetCreated
   * @param {() => string} deps.getActiveInstrumentId
   */
  constructor({ controller, getProject, onSnippetCreated, getActiveInstrumentId }) {
    this.controller = controller;
    this._getProject = getProject;
    this._onSnippetCreated = onSnippetCreated;
    this._getActiveInstrumentId = getActiveInstrumentId;

    this.el = null;
    this._open = false;
    this._lengthBars = 4;
    this._promptText = '';
    this._statusText = '';
    this._statusKind = ''; // '' | 'info' | 'success' | 'error'
    this._costEstimate = null;
    this._unsubscribeStatus = null;
  }

  render() {
    const settings = readAiSettings(this._getProject());
    this._lengthBars = settings.defaultLengthBars || 4;

    this.el = document.createElement('section');
    this.el.className = 'ai-seed-panel';
    this.el.setAttribute('aria-label', 'AI seed panel');
    this.el.innerHTML = this._renderShell();
    this._bindEvents();

    if (this.controller) {
      this._unsubscribeStatus = this.controller.onStatus(({ state, error, costUsd }) => {
        if (state === 'generating') this._setStatus('Generating…', 'info');
        if (state === 'success') this._setStatus(`Snippet added · ${formatCost(costUsd)}`, 'success');
        if (state === 'error') this._setStatus(error || 'Generation failed', 'error');
        this._updateGenerateButtonState();
      });
    }

    return this.el;
  }

  destroy() {
    if (this._unsubscribeStatus) this._unsubscribeStatus();
  }

  _renderShell() {
    return `
      <button class="ai-seed-panel__toggle" id="ai-toggle" aria-expanded="${this._open ? 'true' : 'false'}">
        <span class="ai-seed-panel__icon" aria-hidden="true">🤖</span>
        <span class="ai-seed-panel__toggle-label">AI seed</span>
        <span class="ai-seed-panel__chev" aria-hidden="true">${this._open ? '▾' : '▸'}</span>
      </button>
      <div class="ai-seed-panel__body" id="ai-body" ${this._open ? '' : 'hidden'}>
        ${this._renderBody()}
      </div>
    `;
  }

  _renderBody() {
    const instrumentId = this._getActiveInstrumentId() || 'scaleboard';
    const instrumentLabel = AI_INSTRUMENTS[instrumentId]?.label || instrumentId;
    const suggestions = SUGGESTIONS_BY_INSTRUMENT[instrumentId] || SUGGESTIONS_BY_INSTRUMENT.scaleboard;
    const settings = readAiSettings(this._getProject());
    const providerLabel = providerLabelFor(settings.provider);
    return `
      <div class="ai-seed-panel__row ai-seed-panel__row--meta">
        <span class="ai-seed-panel__chip ai-seed-panel__chip--readonly" title="Set in Settings → AI">${providerLabel}</span>
        <span class="ai-seed-panel__chip ai-seed-panel__chip--readonly" title="Switch instruments above to retarget">${escapeHtml(instrumentLabel)}</span>
        <div class="ai-seed-panel__lengths" role="radiogroup" aria-label="Sequence length in bars">
          ${ALLOWED_LENGTHS_BARS.map(n => `
            <button class="ai-seed-panel__length ${n === this._lengthBars ? 'is-active' : ''}" data-length="${n}" role="radio" aria-checked="${n === this._lengthBars ? 'true' : 'false'}">${n} bar${n === 1 ? '' : 's'}</button>
          `).join('')}
        </div>
      </div>
      <div class="ai-seed-panel__row ai-seed-panel__row--prompt">
        <textarea
          id="ai-prompt"
          class="ai-seed-panel__prompt"
          placeholder="${escapeAttr('Describe the sequence — e.g. ' + suggestions[0])}"
          rows="2"
          spellcheck="false"
        >${escapeHtml(this._promptText)}</textarea>
      </div>
      <div class="ai-seed-panel__row ai-seed-panel__suggestions" id="ai-suggestions">
        ${suggestions.map(s => `<button class="ai-seed-panel__suggestion" data-suggestion="${escapeAttr(s)}">${escapeHtml(s)}</button>`).join('')}
      </div>
      <div class="ai-seed-panel__row ai-seed-panel__footer">
        <span class="ai-seed-panel__cost" id="ai-cost">${this._renderCostText()}</span>
        <span class="ai-seed-panel__status ${this._statusKind ? 'ai-seed-panel__status--' + this._statusKind : ''}" id="ai-status" aria-live="polite">${escapeHtml(this._statusText)}</span>
        <button class="btn btn--primary ai-seed-panel__generate" id="ai-generate">Generate</button>
        <button class="btn btn--ghost ai-seed-panel__cancel" id="ai-cancel" hidden>Cancel</button>
      </div>
      <p class="ai-seed-panel__note">AI is one of your instruments. The user is the composer.</p>
    `;
  }

  _bindEvents() {
    this.el.querySelector('#ai-toggle').addEventListener('click', (e) => {
      e.preventDefault();
      this._open = !this._open;
      this._refresh();
    });
    if (!this._open) return;

    this.el.querySelectorAll('.ai-seed-panel__length').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const n = parseInt(btn.dataset.length, 10);
        if (!Number.isFinite(n)) return;
        this._lengthBars = n;
        const project = this._getProject();
        if (project?.settings?.aiSettings) project.settings.aiSettings.defaultLengthBars = n;
        this._refresh();
      });
    });
    this.el.querySelectorAll('.ai-seed-panel__suggestion').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this._promptText = btn.dataset.suggestion || '';
        this._refresh();
        const ta = this.el.querySelector('#ai-prompt');
        if (ta) ta.focus();
      });
    });
    const ta = this.el.querySelector('#ai-prompt');
    if (ta) {
      ta.addEventListener('input', () => {
        this._promptText = ta.value;
        this._updateCost();
      });
      ta.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter') && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this._generate();
        }
      });
    }
    this.el.querySelector('#ai-generate').addEventListener('click', (e) => {
      e.preventDefault();
      this._generate();
    });
    this.el.querySelector('#ai-cancel').addEventListener('click', (e) => {
      e.preventDefault();
      this.controller?.abort();
    });
  }

  _refresh() {
    if (!this.el) return;
    this.el.innerHTML = this._renderShell();
    this._bindEvents();
    this._updateCost();
    this._updateGenerateButtonState();
  }

  _setStatus(text, kind = 'info') {
    this._statusText = text || '';
    this._statusKind = kind;
    const el = this.el?.querySelector('#ai-status');
    if (el) {
      el.textContent = this._statusText;
      el.className = 'ai-seed-panel__status' + (kind ? ' ai-seed-panel__status--' + kind : '');
    }
  }

  _updateCost() {
    if (!this.controller || !this.el) return;
    try {
      this._costEstimate = this.controller.estimateGenerationCost({ prompt: this._promptText });
    } catch (_) {
      this._costEstimate = null;
    }
    const node = this.el.querySelector('#ai-cost');
    if (node) node.textContent = this._renderCostText();
  }

  _renderCostText() {
    const e = this._costEstimate;
    if (!e) return '';
    if (e.providerId === 'mock' || e.providerId === 'ollama') {
      return 'Mock / local · no cost';
    }
    return `~${formatCost(e.costUsd)} (${e.inputTokens}+${e.outputTokens} tokens, est.)`;
  }

  _updateGenerateButtonState() {
    if (!this.el) return;
    const generating = !!this.controller?.isGenerating();
    const gen = this.el.querySelector('#ai-generate');
    const cancel = this.el.querySelector('#ai-cancel');
    if (gen) gen.hidden = generating;
    if (cancel) cancel.hidden = !generating;
  }

  async _generate() {
    if (!this.controller) {
      this._setStatus('AI is not initialized.', 'error');
      return;
    }
    if (this.controller.isGenerating()) return;
    const prompt = (this._promptText || '').trim();
    this._updateGenerateButtonState();
    try {
      const { snippet, validatorWarnings } = await this.controller.seed({
        prompt,
        lengthBars: this._lengthBars,
        instrument: this._getActiveInstrumentId(),
      });
      if (this._onSnippetCreated) this._onSnippetCreated(snippet);
      if (validatorWarnings && validatorWarnings.length > 0) {
        this._setStatus(`Snippet added (note: ${validatorWarnings[0]})`, 'success');
      }
    } catch (err) {
      this._setStatus(err?.message || 'Generation failed.', 'error');
    } finally {
      this._updateGenerateButtonState();
    }
  }
}

function providerLabelFor(id) {
  switch (id) {
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Claude';
    case 'ollama': return 'Ollama (local)';
    case 'mock': return 'Mock (offline)';
    default: return id || 'Mock (offline)';
  }
}

function formatCost(usd) {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  return '$' + usd.toFixed(2);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function escapeAttr(s) { return escapeHtml(s); }
