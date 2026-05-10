/**
 * AnthropicProvider — Talks to Anthropic's Messages API with tool use.
 *
 * Anthropic's tool format is slightly different from OpenAI's:
 *   - System prompt is a top-level field, not a message.
 *   - Tools have `input_schema` (already what we use), not `parameters`.
 *   - Tool calls come back as content blocks with type "tool_use".
 *   - Tokens count by `usage.input_tokens` and `usage.output_tokens`.
 */

import { AIProvider, parseToolCallArguments, safeFetch } from './AIProvider.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_MODEL = 'claude-3-5-haiku-latest';
const ANTHROPIC_VERSION = '2023-06-01';

const ANTHROPIC_PRICING = {
  'claude-3-5-haiku-latest':   { inputPerMillion: 0.8,  outputPerMillion: 4 },
  'claude-3-5-haiku-20241022': { inputPerMillion: 0.8,  outputPerMillion: 4 },
  'claude-3-5-sonnet-latest':  { inputPerMillion: 3,    outputPerMillion: 15 },
  'claude-3-5-sonnet-20241022':{ inputPerMillion: 3,    outputPerMillion: 15 },
  'claude-3-opus-latest':      { inputPerMillion: 15,   outputPerMillion: 75 },
  'claude-3-haiku-20240307':   { inputPerMillion: 0.25, outputPerMillion: 1.25 },
};

export class AnthropicProvider extends AIProvider {
  /**
   * @param {object} config
   * @param {string} config.apiKey
   * @param {string} [config.baseUrl]
   */
  constructor(config = {}) {
    super({ id: 'anthropic', label: 'Anthropic (Claude)', requiresKey: true });
    this.apiKey = config.apiKey || '';
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  listModels() {
    return Object.keys(ANTHROPIC_PRICING);
  }

  getPricing(modelId) {
    return ANTHROPIC_PRICING[modelId] || null;
  }

  async generate({ systemPrompt, userPrompt, tool, model, signal }) {
    if (!this.apiKey) {
      throw new Error('Anthropic requires an API key. Add one in Settings → AI.');
    }
    const modelId = model || DEFAULT_MODEL;

    const body = {
      model: modelId,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      tools: [{
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      }],
      tool_choice: { type: 'tool', name: tool.name },
      temperature: 0.6,
    };

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Anthropic's CORS for browser usage requires this header in some setups.
      'anthropic-dangerous-direct-browser-access': 'true',
    };

    const res = await safeFetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, signal);

    if (!res.ok) {
      let errText = '';
      try { errText = (await res.json()).error?.message || ''; } catch (_) { errText = await res.text().catch(() => ''); }
      throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 240) || res.statusText}`);
    }

    const data = await res.json();
    const content = Array.isArray(data.content) ? data.content : [];
    const toolUse = content.find(b => b.type === 'tool_use' && b.name === tool.name) || content.find(b => b.type === 'tool_use');
    if (!toolUse) {
      const text = content.find(b => b.type === 'text')?.text || '';
      throw new Error(`Claude did not call submitSequence. Returned: ${text.slice(0, 200) || '(empty)'}`);
    }

    const args = parseToolCallArguments(toolUse.name, toolUse.input);

    return {
      arguments: args,
      rawToolName: toolUse.name,
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
      },
      providerId: this.id,
      model: modelId,
    };
  }
}
