/**
 * aiSettings — Helpers for reading/writing AI configuration.
 *
 * Storage strategy:
 *   - **API keys are NOT persisted.** They live only in memory for the
 *     current session. On page reload the user re-enters them. We never
 *     write them to localStorage, IndexedDB, or any disk-backed store, and
 *     we never include them in project JSON.
 *   - Non-secret config (provider id, model id, custom base URL, disclaimer
 *     accepted flag) lives in `project.settings.aiSettings`. That makes it
 *     part of the user's project and travels with backups, which is desired
 *     for "what model was I using when I made this?" reproducibility.
 *
 * The disclaimer is a per-project consent. Once accepted, it persists with
 * the project.
 */

// In-memory key storage. Keys are gone the moment the tab reloads.
// Module-scoped Map: provider id -> key string. There is intentionally no
// public "list all keys" or "export keys" helper — the only operations are
// read/write/clear.
const _liveKeys = new Map();

export const PROVIDER_IDS = Object.freeze({
  mock: 'mock',
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
  ollama: 'ollama',
});

const DEFAULT_AI_SETTINGS = Object.freeze({
  disclaimerAccepted: false,
  provider: 'mock',
  model: 'mock-canned-v1',
  ollamaBaseUrl: 'http://localhost:11434/v1',
  defaultLengthBars: 4,
});

export function defaultAiSettings() {
  return { ...DEFAULT_AI_SETTINGS };
}

export function readAiSettings(project) {
  if (!project) return defaultAiSettings();
  if (!project.settings) project.settings = {};
  if (!project.settings.aiSettings) project.settings.aiSettings = defaultAiSettings();
  // Backfill any missing fields without overwriting user choices.
  const merged = { ...defaultAiSettings(), ...project.settings.aiSettings };
  project.settings.aiSettings = merged;
  return merged;
}

export function writeAiSettings(project, patch) {
  if (!project) return;
  if (!project.settings) project.settings = {};
  const current = readAiSettings(project);
  project.settings.aiSettings = { ...current, ...patch };
  return project.settings.aiSettings;
}

/**
 * Read the in-memory API key for a provider. Returns '' when nothing is
 * staged in this session.
 */
export function readApiKey(providerId) {
  if (!providerId) return '';
  return _liveKeys.get(providerId) || '';
}

/**
 * Stage an API key for the current session only. The key is held in a
 * module-scoped Map and is forgotten on page reload. Pass an empty string
 * to clear.
 */
export function writeApiKey(providerId, apiKey) {
  if (!providerId) return;
  if (apiKey) {
    _liveKeys.set(providerId, apiKey);
  } else {
    _liveKeys.delete(providerId);
  }
}

/**
 * Clear all session keys. Equivalent to a page reload for credential state.
 */
export function clearAllApiKeys() {
  _liveKeys.clear();
}

/**
 * Indicates whether a key is staged for a provider in the current session.
 * Used by UI to show "key staged" vs "no key" state without leaking the key.
 */
export function hasApiKey(providerId) {
  if (!providerId) return false;
  return _liveKeys.has(providerId);
}

/**
 * The disclaimer text shown to the user before any API key is entered.
 * Verbatim copy — change with care.
 */
export const DISCLAIMER_TEXT =
  'Your API key stays in memory while this tab is open and is never written to disk, ' +
  'never sent anywhere except your chosen provider, and is forgotten when you reload. ' +
  'You will re-enter it each session. Prompts you submit will incur costs from that ' +
  'provider, and those costs are your responsibility. Notenotes does not see, log, ' +
  'or relay your prompts.';
