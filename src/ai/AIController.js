/**
 * AIController — Top-level facade that orchestrates the AI seed pipeline.
 *
 * Pipeline:
 *   1. Resolve provider + model from project settings.
 *   2. Build the system prompt and tool definition for the active instrument.
 *   3. Call provider.generate(...).
 *   4. Validate the returned arguments against the sequence schema.
 *   5. Build a snippet via SequenceExecutor.
 *   6. Hand the snippet back to the caller, which adds it to the project.
 *
 * The controller is owned by CreativeMode; the AISeedPanel UI talks to it
 * through `seed({prompt, instrument, lengthBars})`.
 *
 * No audio playback. No transport coordination. No real-time anything.
 * The snippet appears in the tray; the user previews it manually.
 */

import { AIProvider } from './AIProvider.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { MockProvider } from './MockProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { validateSequence } from './SequenceValidator.js';
import { buildSnippetFromSequence } from './SequenceExecutor.js';
import {
  approxTokens,
  buildSystemPrompt,
  buildToolDefinition,
  buildUserPrompt,
  estimateCostUsd,
} from './PromptBuilder.js';
import { PROVIDER_IDS, readAiSettings, readApiKey } from './aiSettings.js';
import { AI_INSTRUMENTS } from './sequence-schema.js';

export class AIController {
  /**
   * @param {object} deps
   * @param {object} deps.transport       - Engine transport (read-only access to bpm + meter).
   * @param {() => object} deps.getProject - Project accessor (project may swap between sessions).
   * @param {() => object} deps.getActiveInstrumentInfo
   *   Returns { instrument, padCount, scaleName, rootNote, octave } from the
   *   active instrument view. CreativeMode wires this.
   */
  constructor({ transport, getProject, getActiveInstrumentInfo }) {
    this.transport = transport;
    this._getProject = getProject;
    this._getActiveInstrumentInfo = getActiveInstrumentInfo;

    this._abortController = null;
    this._lastUsage = null;
    this._lastCostUsd = null;

    this._statusListeners = new Set();
  }

  /** Subscribe to status events: 'idle', 'generating', 'success', 'error'. */
  onStatus(fn) {
    this._statusListeners.add(fn);
    return () => this._statusListeners.delete(fn);
  }

  _emitStatus(state, payload = {}) {
    for (const fn of this._statusListeners) {
      try { fn({ state, ...payload }); } catch (_) {}
    }
  }

  isGenerating() {
    return !!this._abortController;
  }

  abort() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
      this._emitStatus('idle');
    }
  }

  /**
   * Build the provider instance fresh on each generation. Cheap, and avoids
   * stale-key bugs if the user updates their key mid-session.
   */
  _resolveProvider(settings) {
    switch (settings.provider) {
      case PROVIDER_IDS.openai: {
        return new OpenAIProvider({ apiKey: readApiKey(PROVIDER_IDS.openai) });
      }
      case PROVIDER_IDS.anthropic: {
        return new AnthropicProvider({ apiKey: readApiKey(PROVIDER_IDS.anthropic) });
      }
      case PROVIDER_IDS.ollama: {
        return new OpenAIProvider({
          baseUrl: settings.ollamaBaseUrl || 'http://localhost:11434/v1',
          apiKey: readApiKey(PROVIDER_IDS.ollama),
          id: 'ollama',
          label: 'Ollama (local)',
          requiresKey: false,
        });
      }
      case PROVIDER_IDS.mock:
      default:
        return new MockProvider();
    }
  }

  /**
   * Estimate cost of a generation BEFORE running it. Returns rough USD plus
   * the token estimates. Used by the panel's "this will cost roughly X" hint.
   *
   * @param {object} opts
   * @param {string} opts.prompt
   * @returns {{ inputTokens: number, outputTokens: number, costUsd: number, providerId: string, model: string }}
   */
  estimateGenerationCost({ prompt }) {
    const settings = readAiSettings(this._getProject());
    const provider = this._resolveProvider(settings);

    const inst = this._getActiveInstrumentInfo();
    const ctx = this._buildPromptContext(inst, settings);
    const sysText = buildSystemPrompt(ctx);
    const userText = buildUserPrompt(prompt);

    const inputTokens = approxTokens(sysText) + approxTokens(userText) + 400; // ~400 tokens for tool schema
    const outputTokens = 600; // rough average for a structured sequence
    const pricing = provider.getPricing(settings.model);
    const costUsd = estimateCostUsd({ inputTokens, outputTokens, pricing });

    return {
      inputTokens,
      outputTokens,
      costUsd,
      providerId: provider.id,
      model: settings.model,
    };
  }

  /**
   * Run a full generation. Returns a built snippet ready to be added to the
   * project. Throws Error with .message for any failure.
   *
   * @param {object} opts
   * @param {string} opts.prompt
   * @param {number} [opts.lengthBars]   - Override; defaults to settings.
   * @param {string} [opts.instrument]   - Override; defaults to active.
   * @returns {Promise<{ snippet: object, usage: object, costUsd: number, validatorWarnings: string[] }>}
   */
  async seed({ prompt, lengthBars, instrument } = {}) {
    if (this._abortController) {
      throw new Error('A generation is already in progress.');
    }
    const project = this._getProject();
    const settings = readAiSettings(project);

    if (settings.provider !== PROVIDER_IDS.mock && !settings.disclaimerAccepted) {
      throw new Error('Accept the AI disclaimer in Settings → AI before using a real provider.');
    }

    const provider = this._resolveProvider(settings);
    const inst = this._getActiveInstrumentInfo();
    const effectiveInstrument = instrument || inst.instrument || 'scaleboard';
    if (!AI_INSTRUMENTS[effectiveInstrument]) {
      throw new Error(`AI does not support instrument "${effectiveInstrument}".`);
    }
    const effectiveLength = lengthBars || settings.defaultLengthBars || 4;

    const ctxForPrompt = this._buildPromptContext(
      { ...inst, instrument: effectiveInstrument },
      { ...settings, defaultLengthBars: effectiveLength },
    );
    const systemPrompt = buildSystemPrompt(ctxForPrompt);
    const userPrompt = buildUserPrompt(prompt);
    const tool = buildToolDefinition(effectiveInstrument);

    this._abortController = new AbortController();
    this._emitStatus('generating', { providerId: provider.id, model: settings.model });

    let result;
    try {
      result = await provider.generate({
        systemPrompt,
        userPrompt,
        tool,
        model: settings.model,
        signal: this._abortController.signal,
        // Real LLM providers ignore this; Mock uses it to honor the user's
        // requested length without reading the system prompt.
        requestedLengthBars: effectiveLength,
      });
    } catch (err) {
      this._abortController = null;
      this._emitStatus('error', { error: err?.message || String(err) });
      throw err;
    } finally {
      this._abortController = null;
    }

    const validatorContext = {
      instrument: effectiveInstrument,
      lengthBars: effectiveLength,
      beatsPerBar: this.transport.timeSignature?.beats || 4,
      padCount: inst.padCount,
    };
    const v = validateSequence(result.arguments, validatorContext);
    if (!v.valid) {
      const errMsg = `AI returned an invalid sequence: ${v.errors.slice(0, 3).join('; ')}`;
      this._emitStatus('error', { error: errMsg });
      throw new Error(errMsg);
    }

    const snippet = buildSnippetFromSequence(result.arguments, {
      transport: this.transport,
      scaleName: inst.scaleName,
      rootNote: inst.rootNote,
      octave: inst.octave,
      prompt: userPrompt,
      providerId: result.providerId,
    });

    const pricing = provider.getPricing(settings.model);
    const costUsd = estimateCostUsd({
      inputTokens: result.usage?.inputTokens || 0,
      outputTokens: result.usage?.outputTokens || 0,
      pricing,
    });
    this._lastUsage = result.usage;
    this._lastCostUsd = costUsd;

    this._emitStatus('success', { snippetId: snippet.id, costUsd, usage: result.usage });

    return { snippet, usage: result.usage, costUsd, validatorWarnings: v.warnings };
  }

  /**
   * Compose the PromptContext object PromptBuilder expects.
   */
  _buildPromptContext(inst, settings) {
    return {
      instrument: inst.instrument || 'scaleboard',
      lengthBars: settings.defaultLengthBars || 4,
      bpm: this.transport.bpm,
      timeSignature: { ...this.transport.timeSignature },
      scaleName: inst.scaleName,
      rootNote: inst.rootNote,
      padCount: inst.padCount,
      referencedSnippet: inst.referencedSnippet,
    };
  }
}

export { AIProvider };
