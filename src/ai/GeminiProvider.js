/**
 * GeminiProvider — Talks to Google's Gemini API with function calling.
 *
 * Endpoint shape:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   Header: x-goog-api-key: <key>
 *   Body:   contents[], system_instruction, tools[], tool_config, generation_config
 *
 * Differences from OpenAI/Anthropic that matter here:
 *   - System prompt lives under `system_instruction.parts[].text`, not in `messages`.
 *   - Tool schema is a single `function_declarations` array on a single `tools` entry.
 *   - JSON Schema is OpenAPI-3-flavored. Gemini doesn't accept some fields the
 *     other providers tolerate (`const`, `additionalProperties: false`,
 *     `description` on top of `enum`-ed const values). We adapt the schema
 *     before sending to keep one source of truth in `sequence-schema.js`.
 *   - Forced tool call uses `tool_config.function_calling_config.mode: "ANY"`
 *     plus `allowed_function_names: [<name>]`.
 *   - Response: `candidates[0].content.parts[].functionCall.{name, args}`.
 */

import { AIProvider, parseToolCallArguments, safeFetch } from './AIProvider.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash';

// Approximate pricing as of late 2025. Pricing shifts; treat as a guide.
const GEMINI_PRICING = {
  'gemini-2.5-flash':       { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  'gemini-2.5-flash-lite':  { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  'gemini-2.5-pro':         { inputPerMillion: 1.25,  outputPerMillion: 5.00 },
  'gemini-1.5-flash':       { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  'gemini-1.5-pro':         { inputPerMillion: 1.25,  outputPerMillion: 5.00 },
};

export class GeminiProvider extends AIProvider {
  /**
   * @param {object} config
   * @param {string} config.apiKey
   * @param {string} [config.baseUrl=DEFAULT_BASE_URL]
   */
  constructor(config = {}) {
    super({ id: 'gemini', label: 'Google Gemini', requiresKey: true });
    this.apiKey = config.apiKey || '';
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  listModels() {
    return Object.keys(GEMINI_PRICING);
  }

  getPricing(modelId) {
    return GEMINI_PRICING[modelId] || null;
  }

  async generate({ systemPrompt, userPrompt, tool, model, signal }) {
    if (!this.apiKey) {
      throw new Error('Gemini requires an API key. Add one in Settings → AI Seed.');
    }
    const modelId = model || DEFAULT_MODEL;

    const body = {
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] },
      ],
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      tools: [{
        function_declarations: [{
          name: tool.name,
          description: tool.description,
          parameters: adaptSchemaForGemini(tool.input_schema),
        }],
      }],
      tool_config: {
        function_calling_config: {
          mode: 'ANY',
          allowed_function_names: [tool.name],
        },
      },
      generation_config: {
        temperature: 0.6,
      },
    };

    const url = `${this.baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`;
    const res = await safeFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    }, signal);

    if (!res.ok) {
      let errText = '';
      try { errText = (await res.json()).error?.message || ''; } catch (_) { errText = await res.text().catch(() => ''); }
      throw new Error(`Gemini ${res.status}: ${errText.slice(0, 240) || res.statusText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const fnPart = parts.find(p => p.functionCall && p.functionCall.name === tool.name)
      || parts.find(p => p.functionCall);
    if (!fnPart) {
      const text = parts.find(p => p.text)?.text || '';
      throw new Error(`Gemini did not call submitSequence. Returned: ${text.slice(0, 200) || '(empty)'}`);
    }

    // Gemini's `args` is already parsed JSON; parseToolCallArguments handles
    // both pre-parsed objects and JSON strings, so this works either way.
    const args = parseToolCallArguments(fnPart.functionCall.name, fnPart.functionCall.args);

    return {
      arguments: args,
      rawToolName: fnPart.functionCall.name,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      },
      providerId: this.id,
      model: modelId,
    };
  }
}

/**
 * Convert our JSON-Schema-flavored shape to something Gemini's function
 * declarations accept. Keep this minimal; we don't want a parallel schema
 * dialect.
 *
 * Adaptations:
 *   - `const: X` → `enum: [X]` and drop `const` (Gemini rejects `const`)
 *   - drop `additionalProperties` (Gemini rejects it on some shapes)
 *   - drop `$schema` and other meta keys
 *   - leave everything else (type, properties, required, enum, items,
 *     minItems, maxItems, minimum, maximum, description) untouched
 */
function adaptSchemaForGemini(schema) {
  if (Array.isArray(schema)) return schema.map(adaptSchemaForGemini);
  if (!schema || typeof schema !== 'object') return schema;

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'const') {
      // Gemini handles fixed values via single-element enum.
      out.enum = Array.isArray(out.enum) ? out.enum.concat([value]) : [value];
      continue;
    }
    if (key === 'additionalProperties') continue;
    if (key === '$schema' || key === '$id' || key === '$ref') continue;
    if (key === 'properties' && value && typeof value === 'object') {
      const props = {};
      for (const [propKey, propVal] of Object.entries(value)) {
        props[propKey] = adaptSchemaForGemini(propVal);
      }
      out.properties = props;
      continue;
    }
    if (key === 'items' || key === 'oneOf' || key === 'anyOf' || key === 'allOf') {
      out[key] = adaptSchemaForGemini(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}
