/**
 * AIProvider — Base interface for an LLM provider.
 *
 * Concrete implementations (OpenAIProvider, AnthropicProvider, MockProvider)
 * adapt their respective tool-calling APIs to a single shape so the rest of
 * Notenotes never has to care which model the user picked.
 *
 * The contract is narrow on purpose: AIController hands a request in, gets
 * exactly one tool call out, or an error. No streaming, no message threads,
 * no chained calls. One shot per generation.
 */

/**
 * @typedef {object} GenerateRequest
 * @property {string} systemPrompt
 * @property {string} userPrompt
 * @property {object} tool                 - The tool the AI is allowed to call.
 * @property {string} model                - Provider-specific model id.
 * @property {AbortSignal} [signal]        - Optional cancellation.
 */

/**
 * @typedef {object} GenerateResult
 * @property {object} arguments            - The parsed JSON argument the AI passed to submitSequence.
 * @property {string} rawToolName          - Should equal tool.name; surfaced for debugging.
 * @property {object} usage                - { inputTokens, outputTokens } when known.
 * @property {string} providerId
 * @property {string} model
 */

export class AIProvider {
  /**
   * @param {object} config
   * @param {string} config.id              - Stable provider id.
   * @param {string} config.label           - Human-readable label.
   * @param {boolean} [config.requiresKey=true]
   */
  constructor(config) {
    this.id = config.id;
    this.label = config.label;
    this.requiresKey = config.requiresKey !== false;
  }

  /**
   * Concrete providers override this. Should return a GenerateResult or throw
   * an Error with a user-friendly .message.
   *
   * @param {GenerateRequest} _req
   * @returns {Promise<GenerateResult>}
   */
  async generate(_req) {
    throw new Error(`${this.id}: generate() not implemented.`);
  }

  /**
   * Returns the list of model ids this provider supports. Used to populate
   * the Settings model picker. Override.
   *
   * @returns {string[]}
   */
  listModels() {
    return [];
  }

  /**
   * Pricing per million tokens for cost estimation. Override; defaults to
   * "unknown" which means estimateCostUsd returns 0 (safe — no false bills).
   *
   * @param {string} _modelId
   * @returns {{ inputPerMillion: number, outputPerMillion: number } | null}
   */
  getPricing(_modelId) {
    return null;
  }
}

/**
 * Common helper: extract the JSON arguments from a structured tool-call
 * response, given the tool's name. Throws a friendly error if the AI
 * misbehaved (called nothing, called something else, returned unparseable
 * JSON).
 */
export function parseToolCallArguments(toolName, callArgsJson) {
  if (typeof callArgsJson === 'object' && callArgsJson !== null) {
    return callArgsJson; // already parsed by the API
  }
  if (typeof callArgsJson !== 'string') {
    throw new Error(`Provider returned no arguments for ${toolName}.`);
  }
  try {
    return JSON.parse(callArgsJson);
  } catch (_) {
    throw new Error(`Provider returned malformed JSON for ${toolName}: ${callArgsJson.slice(0, 120)}...`);
  }
}

/**
 * Wraps a fetch call so we can cancel it via AbortSignal and produce
 * consistent error messages for network/timeout failures.
 */
export async function safeFetch(url, init = {}, signal) {
  try {
    const res = await fetch(url, { ...init, signal });
    return res;
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    const message = err?.message || String(err);
    throw new Error(`Network error reaching ${truncateUrl(url)}: ${message}`);
  }
}

function truncateUrl(url) {
  if (typeof url !== 'string') return '(provider URL)';
  // Don't echo full URLs that might contain query-string keys; most providers
  // don't support that, but defense-in-depth.
  return url.split('?')[0];
}
