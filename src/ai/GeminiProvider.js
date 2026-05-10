/**
 * GeminiProvider — Talks to Google's Gemini API with function calling.
 *
 * Gemini's constrained-decoder is far stricter than OpenAI/Anthropic's. It
 * rejects schemas with too many "states" — long arrays multiplied by
 * properties with bounds, fixed enums, etc. We've been chipping at this in
 * the adapter (camelCase, drop additionalProperties, drop integer enums,
 * backfill type:string, drop numeric bounds, cap maxItems). Each round
 * surfaced a new constraint.
 *
 * The robust approach taken here: build a MINIMAL schema for Gemini that
 * only includes the fields the LLM actually has to choose:
 *
 *   - events: array of { beat, <instrument-specific identifier> }
 *
 * Everything else (instrument, lengthBars, event type, velocity defaults,
 * duration defaults) is set by us after the response comes back. The
 * system prompt still tells the LLM about constraints; the
 * SequenceValidator still enforces them on the response side. Gemini's
 * decoder gets a tiny state space and stops 400-ing.
 *
 * Other providers (OpenAI, Anthropic, Mock, Ollama) keep the full,
 * descriptive schema — they handle complexity fine.
 */

import { AIProvider, parseToolCallArguments, safeFetch } from './AIProvider.js';
import { AI_INSTRUMENTS, ALLOWED_LENGTHS_BARS, KIT_DRUMS, MIDI_MAX, MIDI_MIN } from './sequence-schema.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash';

const GEMINI_PRICING = {
  'gemini-2.5-flash':       { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  'gemini-2.5-flash-lite':  { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  'gemini-2.5-pro':         { inputPerMillion: 1.25,  outputPerMillion: 5.00 },
  'gemini-1.5-flash':       { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  'gemini-1.5-pro':         { inputPerMillion: 1.25,  outputPerMillion: 5.00 },
};

const GEMINI_MAX_EVENTS = 32; // hard cap so the constrained decoder stays sane

export class GeminiProvider extends AIProvider {
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

  async generate({ systemPrompt, userPrompt, tool, model, signal, requestedLengthBars }) {
    if (!this.apiKey) {
      throw new Error('Gemini requires an API key. Add one in Settings → AI Seed.');
    }
    const modelId = model || DEFAULT_MODEL;
    const instrumentId = tool.input_schema?.properties?.instrument?.const || 'scaleboard';
    const inst = AI_INSTRUMENTS[instrumentId];
    if (!inst) {
      throw new Error(`Gemini provider got an unknown instrument: ${instrumentId}`);
    }

    // Build a minimal schema that only contains the LLM-controlled fields.
    // The post-processor adds everything else after the response.
    const minimalSchema = buildMinimalSchemaForInstrument(instrumentId);

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
          parameters: minimalSchema,
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
      throw new Error(await formatGeminiError(res, body, modelId));
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

    const minimalArgs = parseToolCallArguments(fnPart.functionCall.name, fnPart.functionCall.args);
    // Re-inflate the minimal args back to the full sequence shape the
    // SequenceValidator and SequenceExecutor expect.
    const fullArgs = inflateGeminiResponse(minimalArgs, instrumentId, requestedLengthBars);

    return {
      arguments: fullArgs,
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
 * Compose a friendly error message from a Gemini 4xx/5xx response. Logs the
 * full request and response bodies to console.error so the user can paste
 * them into a bug report; the toast shows a tighter summary.
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

  try {
    console.error('[Gemini] request failed', { model: modelId, status: res.status, body: parsed || raw });
    console.error('[Gemini] request body was', requestBody);
  } catch (_) {}

  return `Gemini ${res.status} ${status}: ${message}${detailsStr}`.slice(0, 480);
}

// ---------- minimal schema + response inflation ----------

/**
 * Per-instrument minimal schema for Gemini's constrained decoder. We
 * include only the LLM-chosen fields. instrument, lengthBars, event type,
 * and the velocity/duration defaults are added back in `inflateGeminiResponse`.
 */
function buildMinimalSchemaForInstrument(instrumentId) {
  const eventItem = buildMinimalEventItem(instrumentId);
  return {
    type: 'object',
    description: 'Submit your planned sequence as an array of events. The instrument, length, and per-event type/velocity/duration are set by Notenotes from the system prompt context.',
    required: ['events'],
    properties: {
      events: {
        type: 'array',
        description: 'Ordered events. Sort by beat ascending. 1-' + GEMINI_MAX_EVENTS + ' entries.',
        maxItems: GEMINI_MAX_EVENTS,
        items: eventItem,
      },
    },
  };
}

function buildMinimalEventItem(instrumentId) {
  switch (instrumentId) {
    case 'scaleboard':
      return {
        type: 'object',
        required: ['beat', 'padIndex'],
        properties: {
          beat:     { type: 'number',  description: 'Beat position from sequence start (>= 0).' },
          padIndex: { type: 'integer', description: 'Scale-locked pad index (0 = root).' },
        },
      };
    case 'piano':
      return {
        type: 'object',
        required: ['beat', 'midi'],
        properties: {
          beat: { type: 'number',  description: 'Beat position from sequence start (>= 0).' },
          midi: { type: 'integer', description: `MIDI note ${MIDI_MIN}..${MIDI_MAX}; middle C is 60.` },
        },
      };
    case 'kit':
      return {
        type: 'object',
        required: ['beat', 'drum'],
        properties: {
          beat: { type: 'number', description: 'Beat position from sequence start (>= 0).' },
          drum: {
            type: 'string',
            enum: [...KIT_DRUMS],
            description: 'Drum voice id.',
          },
        },
      };
    default:
      throw new Error(`buildMinimalEventItem: unknown instrument ${instrumentId}`);
  }
}

/**
 * Re-inflate Gemini's minimal-schema response into the full sequence shape
 * the SequenceValidator and SequenceExecutor expect.
 */
function inflateGeminiResponse(minimalArgs, instrumentId, requestedLengthBars) {
  const inst = AI_INSTRUMENTS[instrumentId];
  if (!inst) throw new Error(`inflateGeminiResponse: unknown instrument ${instrumentId}`);

  const lengthBars = ALLOWED_LENGTHS_BARS.includes(requestedLengthBars) ? requestedLengthBars : 4;
  const events = Array.isArray(minimalArgs?.events) ? minimalArgs.events : [];

  const inflatedEvents = events.map(rawEv => {
    const ev = { ...rawEv };
    // Add the type field that Gemini didn't see.
    ev.type = inst.eventType;
    // Apply velocity/duration defaults for fields the LLM didn't have to choose.
    if (typeof ev.velocity !== 'number') {
      ev.velocity = inst.eventType === 'drumHit' ? 1 : 0.85;
    }
    if (inst.eventType !== 'drumHit' && typeof ev.durationBeats !== 'number') {
      ev.durationBeats = 0.5;
    }
    return ev;
  });

  return {
    instrument: instrumentId,
    lengthBars,
    events: inflatedEvents,
  };
}
