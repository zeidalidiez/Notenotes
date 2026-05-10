/**
 * aiSettings — Helpers for reading/writing AI configuration.
 *
 * Storage strategy:
 *   - API keys live in localStorage (per-origin, persistent, NOT in the
 *     project JSON). This means backups never carry credentials.
 *   - Non-secret config (provider id, model id, custom base URL, disclaimer
 *     accepted flag) lives in `project.settings.aiSettings`. That makes it
 *     part of the user's project and travels with backups, which is desired
 *     for "what model was I using when I made this?" reproducibility.
 *
 * The disclaimer is a one-time consent. Once accepted, it persists per
 * project. If the user creates a new project, they re-accept (intentional).
 */

const STORAGE_PREFIX = 'notenotes.ai.';

export const PROVIDER_IDS = Object.freeze({
  mock: 'mock',
  openai: 'openai',
  anthropic: 'anthropic',
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
 * API key storage. localStorage only — never IndexedDB, never project JSON.
 * Keys are prefixed by provider id so multiple providers can coexist.
 */
export function readApiKey(providerId) {
  if (!providerId) return '';
  try {
    return globalThis.localStorage?.getItem(`${STORAGE_PREFIX}${providerId}.apiKey`) || '';
  } catch (_) {
    return '';
  }
}

export function writeApiKey(providerId, apiKey) {
  if (!providerId) return;
  try {
    if (apiKey) {
      globalThis.localStorage?.setItem(`${STORAGE_PREFIX}${providerId}.apiKey`, apiKey);
    } else {
      globalThis.localStorage?.removeItem(`${STORAGE_PREFIX}${providerId}.apiKey`);
    }
  } catch (_) {}
}

export function clearAllApiKeys() {
  try {
    const keys = [];
    for (let i = 0; i < globalThis.localStorage.length; i++) {
      const k = globalThis.localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX) && k.endsWith('.apiKey')) keys.push(k);
    }
    for (const k of keys) globalThis.localStorage.removeItem(k);
  } catch (_) {}
}

/**
 * The disclaimer text shown to the user before any API key is saved.
 * Verbatim copy — change with care.
 */
export const DISCLAIMER_TEXT =
  'Your API key stays in this browser and is never sent anywhere except your chosen provider. ' +
  'By entering it, you acknowledge that prompts you submit will incur costs from that provider, ' +
  'and that those costs are your responsibility. Notenotes does not see, log, or relay your prompts.';
