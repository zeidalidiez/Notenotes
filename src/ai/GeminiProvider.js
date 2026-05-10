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

    // Gemini's REST API accepts either snake_case or camelCase for top-level
    // request fields, but the docs canonicalize on camelCase. We use camelCase
    // throughout to match the published examples and avoid any edge-case
    // parsing differences.
    const body = {
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] },
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      tools: [{
        functionDeclarations: [{
          name: tool.name,
          description: tool.description,
          parameters: adaptSchemaForGemini(tool.input_schema),
        }],
      }],
      toolConfig: {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [tool.name],
        },
      },
      generationConfig: {
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
      const friendly = await formatGeminiError(res, body, modelId);
      throw new Error(friendly);
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
 *   - `const: X` → `enum: [X]` and drop `const`.
 *   - Drop `additionalProperties`.
 *   - Drop `$schema` / `$id` / `$ref`.
 *   - Drop `description` on a single-element-enum node (the description
 *     just duplicates the constant; some Gemini versions 400 on it).
 *   - Drop non-string `enum`s. Gemini's Schema proto defines `enum` as
 *     `repeated string`, so `enum: [1, 2, 4, 8]` triggers a 400. We drop
 *     the constraint and append the allowed values to the description
 *     so the LLM still sees them; the SequenceValidator catches any
 *     out-of-range value downstream.
 *   - Leave everything else (type, properties, required, items, minItems,
 *     maxItems, minimum, maximum, string enums, descriptions on non-enum
 *     nodes) untouched.
 */
function adaptSchemaForGemini(schema) {
  if (Array.isArray(schema)) return schema.map(adaptSchemaForGemini);
  if (!schema || typeof schema !== 'object') return schema;

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'const') {
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

  // Drop non-string enums. Gemini only supports string-array enums; an
  // integer enum like `[1, 2, 4, 8]` causes a 400. Move the constraint
  // into the description so the LLM still sees the allowed values.
  if (Array.isArray(out.enum) && out.enum.some(v => typeof v !== 'string')) {
    const allowed = out.enum.map(v => JSON.stringify(v)).join(', ');
    delete out.enum;
    const note = `Allowed values: ${allowed}.`;
    out.description = out.description ? `${out.description} ${note}` : note;
  }

  // Gemini requires `type: "string"` to be explicitly declared on any node
  // that has an enum. Our `const: "X"` conversion produces a bare
  // `{ enum: ["X"] }` with no type field; Gemini's validator rejects that
  // with "only allowed for STRING type." Backfill the type for any
  // surviving (necessarily-string-only) enum.
  if (Array.isArray(out.enum) && out.enum.length > 0 && !('type' in out)) {
    out.type = 'string';
  }

  // Drop description on single-value-enum nodes — Gemini has been observed
  // to 400 on a one-element enum sitting next to a description.
  if (Array.isArray(out.enum) && out.enum.length === 1 && 'description' in out) {
    delete out.description;
  }

  return out;
}

/**
 * Compose a friendly error message from a Gemini 4xx/5xx response. Logs the
 * full response body and our request body to console.error so the user can
 * paste them into a bug report; the toast shows a tighter summary.
 */
async function formatGeminiError(res, requestBody, modelId) {
  let raw = null;
  let parsed = null;
  try {
    raw = await res.text();
    parsed = JSON.parse(raw);
  } catch (_) { /* leave parsed null; raw may still be useful */ }

  const errBlock = parsed?.error || {};
  const status = errBlock.status || res.statusText || `HTTP ${res.status}`;
  const message = errBlock.message || raw || res.statusText || '';

  // Pull the FieldViolation reasons out of details when present. Google's
  // API surfaces them under either error.details[*].fieldViolations[] or
  // error.details[*].reason.
  let detailLines = [];
  if (Array.isArray(errBlock.details)) {
    for (const d of errBlock.details) {
      if (Array.isArray(d.fieldViolations)) {
        for (const fv of d.fieldViolations) {
          detailLines.push(`${fv.field || '?'}: ${fv.description || fv.reason || ''}`);
        }
      } else if (d.reason) {
        detailLines.push(d.reason);
      } else if (d.message) {
        detailLines.push(d.message);
      }
    }
  }

  const detailsStr = detailLines.length > 0 ? `\n${detailLines.join('\n')}` : '';

  // Console-level diagnostics for the developer / power user.
  try {
    console.error('[Gemini] request failed', { model: modelId, status: res.status, body: parsed || raw });
    console.error('[Gemini] request body was', requestBody);
  } catch (_) { /* console may not exist */ }

  const summary = `Gemini ${res.status} ${status}: ${message}${detailsStr}`;
  return summary.slice(0, 480);
}
