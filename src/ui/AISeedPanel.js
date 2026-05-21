/**
 * AISeedPanel — Inline body of the AI seed popover.
 *
 * This component renders the AI prompt UI. It does NOT manage its own
 * visibility — CreativeMode owns the popover container, opens it via the
 * AI Seed button, and tears it down on close or instrument change.
 *
 * Contents:
 *   - Read-only chips: provider label, active instrument label.
 *   - Bar-length picker (1 / 2 / 4 / 8).
 *   - Free-text prompt textarea with per-instrument suggestion chips.
 *   - Generate button (or Cancel while in flight).
 *   - Status line with success/error feedback.
 *
 * On success, fires `onSnippetCreated(snippet)` so CreativeMode can add it
 * to the project + snippet tray.
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
   * @param {() => { available: boolean, reason?: string }} [deps.getAvailability]
   *   Returns whether AI generation is currently usable. When `available`
   *   is false, the panel renders a disabled state with a message keyed
   *   off `reason`. Defaults to always-available.
   * @param {() => void} [deps.onClose]  Called when the user wants to close the popover (e.g., Escape).
   * @param {() => void} [deps.onOpenSettings] Called when the user wants to change AI settings.
   */
  constructor({ controller, getProject, onSnippetCreated, getActiveInstrumentId, getAvailability, onClose, onOpenSettings }) {
    this.controller = controller;
    this._getProject = getProject;
    this._onSnippetCreated = onSnippetCreated;
    this._getActiveInstrumentId = getActiveInstrumentId;
    this._getAvailability = getAvailability || (() => ({ available: true }));
    this._onClose = onClose;
    this._onOpenSettings = onOpenSettings;

    this.el = null;
    this._lengthBars = 4;
    this._promptText = '';
    this._statusText = '';
    this._statusKind = '';
    this._unsubscribeStatus = null;
  }

  render() {
    const settings = readAiSettings(this._getProject());
    this._lengthBars = settings.defaultLengthBars || 4;

    this.el = document.createElement('section');
    this.el.className = 'ai-seed-panel';
    this.el.setAttribute('aria-label', 'AI seed');
    this.el.innerHTML = this._renderBody();
    this._bindEvents();

    if (this.controller) {
      this._unsubscribeStatus = this.controller.onStatus(({ state, error }) => {
        if (state === 'generating') this._setStatus('Generating...', 'info');
        else if (state === 'success') this._setStatus('Snippet added', 'success');
        else if (state === 'error') this._setStatus(error || 'Generation failed', 'error');
        this._updateGenerateButtonState();
      });
    }

    // Focus the prompt textarea so the user can start typing immediately.
    queueMicrotask(() => {
      const ta = this.el?.querySelector('#ai-prompt');
      if (ta) {
        try { ta.focus(); } catch (_) {}
      }
    });

    return this.el;
  }

  destroy() {
    if (this._unsubscribeStatus) {
      this._unsubscribeStatus();
      this._unsubscribeStatus = null;
    }
    this.el = null;
  }

  /** External signal that the active instrument changed — re-render. */
  refresh() {
    if (!this.el) return;
    this.el.innerHTML = this._renderBody();
    this._bindEvents();
    this._updateGenerateButtonState();
  }

  /**
   * Render the disabled state shown when AI seed isn't available in the
   * current context (e.g. Scale Board's Voice Sketch mode). The panel
   * still has a header, but the inputs are gone.
   */
  _renderUnavailableBody(availability) {
    const { reason } = availability || {};
    let message;
    let detail;
    if (reason === 'voices-mode') {
      message = 'Unavailable in Voice Sketch mode';
      detail = 'AI generates standard MIDI/drum snippets, not vocal phrases. Switch Pads mode to Single, Chords, or Custom to use AI seed here.';
    } else if (reason === 'unsupported-instrument') {
      message = 'Unavailable on this instrument';
      detail = 'AI seed works on Pads, Micro Piano, and Sketch Kit. Pick one of those to generate a snippet.';
    } else {
      message = 'AI seed is currently unavailable';
      detail = 'Check the active instrument and try again.';
    }
    return `
      <header class="ai-seed-panel__header">
        <h3 class="ai-seed-panel__title">AI seed</h3>
      </header>
      <div class="ai-seed-panel__unavailable">
        <p class="ai-seed-panel__unavailable-headline">${escapeHtml(message)}</p>
        <p class="ai-seed-panel__unavailable-detail">${escapeHtml(detail)}</p>
      </div>
    `;
  }

  _renderBody() {
    const availability = this._getAvailability() || { available: true };
    if (!availability.available) {
      return this._renderUnavailableBody(availability);
    }
    const instrumentId = this._getActiveInstrumentId() || 'scaleboard';
    const instrumentLabel = AI_INSTRUMENTS[instrumentId]?.label || instrumentId;
    const suggestions = SUGGESTIONS_BY_INSTRUMENT[instrumentId] || SUGGESTIONS_BY_INSTRUMENT.scaleboard;
    const settings = readAiSettings(this._getProject());
    const providerLabel = providerLabelFor(settings.provider);
    return `
      <header class="ai-seed-panel__header">
        <h3 class="ai-seed-panel__title">AI seed</h3>
      </header>
      <div class="ai-seed-panel__row ai-seed-panel__row--meta">
        <button class="ai-seed-panel__chip ai-seed-panel__chip--action" id="ai-provider-settings" type="button" title="Open Settings to change AI provider">${escapeHtml(providerLabel)}</button>
        <span class="ai-seed-panel__chip ai-seed-panel__chip--readonly" title="Switch instruments below to retarget">${escapeHtml(instrumentLabel)}</span>
        <div class="ai-seed-panel__lengths" role="radiogroup" aria-label="Sequence length in bars">
          ${ALLOWED_LENGTHS_BARS.map(n => `
            <button class="ai-seed-panel__length ${n === this._lengthBars ? 'is-active' : ''}" data-length="${n}" type="button" role="radio" aria-checked="${n === this._lengthBars ? 'true' : 'false'}">${n} bar${n === 1 ? '' : 's'}</button>
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
        ${suggestions.map(s => `<button class="ai-seed-panel__suggestion" data-suggestion="${escapeAttr(s)}" type="button">${escapeHtml(s)}</button>`).join('')}
      </div>
      <div class="ai-seed-panel__row ai-seed-panel__footer">
        <span class="ai-seed-panel__billing-note">Provider billing may apply</span>
        <span class="ai-seed-panel__status ${this._statusKind ? 'ai-seed-panel__status--' + this._statusKind : ''}" id="ai-status" aria-live="polite">${escapeHtml(this._statusText)}</span>
        <button class="btn btn--primary ai-seed-panel__generate" id="ai-generate" type="button">Generate</button>
        <button class="btn btn--ghost ai-seed-panel__cancel" id="ai-cancel" type="button" hidden>Cancel</button>
      </div>
      <p class="ai-seed-panel__note">AI is one of your instruments. The user is the composer.</p>
    `;
  }

  _bindEvents() {
    if (!this.el) return;
    this.el.querySelector('#ai-provider-settings')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._onOpenSettings?.();
    });

    this.el.querySelectorAll('.ai-seed-panel__length').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const n = parseInt(btn.dataset.length, 10);
        if (!Number.isFinite(n)) return;
        this._lengthBars = n;
        const project = this._getProject();
        if (project?.settings?.aiSettings) project.settings.aiSettings.defaultLengthBars = n;
        this.refresh();
      });
    });

    this.el.querySelectorAll('.ai-seed-panel__suggestion').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this._promptText = btn.dataset.suggestion || '';
        this.refresh();
        const ta = this.el?.querySelector('#ai-prompt');
        if (ta) try { ta.focus(); } catch (_) {}
      });
    });

    const ta = this.el.querySelector('#ai-prompt');
    if (ta) {
      ta.addEventListener('input', () => {
        this._promptText = ta.value;
      });
      ta.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter') && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this._generate();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this._onClose?.();
        }
      });
    }

    this.el.querySelector('#ai-generate')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._generate();
    });
    this.el.querySelector('#ai-cancel')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.controller?.isGenerating?.()) this.controller.abort();
      this._onClose?.();
    });
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function escapeAttr(s) { return escapeHtml(s); }
