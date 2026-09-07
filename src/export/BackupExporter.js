import { APP_VERSION } from '../version.js';
import { MAX_IMPORTED_BARS, MAX_IMPORTED_TICKS } from '../engine/ImportLimits.js';

const BACKUP_VERSION = 1;
export const MAX_BACKUP_FILE_BYTES = 256 * 1024 * 1024;
const MAX_BACKUP_DEPTH = 64;
const MAX_BACKUP_NODES = 2_000_000;
const MAX_BACKUP_COLLECTION_ITEMS = 100_000;
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function parseVersion(version = '') {
  return String(version)
    .split('.')
    .map(part => parseInt(part, 10))
    .map(part => (Number.isFinite(part) ? part : 0));
}

function isNewerVersion(incoming, current) {
  if (!incoming) return false;
  const a = parseVersion(incoming);
  const b = parseVersion(current);
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return false;
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function assertRecordArray(value, label, { required = false } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  for (const item of value) assertRecord(item, `${label} entry`);
  return value;
}

function assertSafeBackupTree(root) {
  const seen = new WeakSet();
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;

  while (stack.length) {
    const { value, depth } = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (depth > MAX_BACKUP_DEPTH) throw new Error('Backup data is nested too deeply');
    if (seen.has(value)) throw new Error('Backup data must not contain circular references');
    seen.add(value);

    if (Array.isArray(value) && value.length > MAX_BACKUP_COLLECTION_ITEMS) {
      throw new Error('Backup contains an unsupported number of items');
    }

    const keys = Object.keys(value);
    nodes += keys.length + 1;
    if (nodes > MAX_BACKUP_NODES) {
      throw new Error('Backup contains an unsupported amount of data');
    }

    for (const key of keys) {
      if (UNSAFE_JSON_KEYS.has(key)) throw new Error('Backup contains an unsafe property');
      stack.push({ value: value[key], depth: depth + 1 });
    }
  }
}

function assertOptionalString(value, label) {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${label} must be text`);
  }
}

function textFields(value, fields, label) {
  for (const field of fields) assertOptionalString(value[field], `${label} ${field}`);
}

function optionalNumber(value, label, min = 0, max = MAX_IMPORTED_TICKS, integer = false) {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
    || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be a finite ${integer ? 'integer ' : ''}number between ${min} and ${max}`);
  }
}

function validateEvents(events, label, notes = false) {
  for (const event of assertRecordArray(events, label)) {
    optionalNumber(event.startTick, `${label} startTick`);
    optionalNumber(event.durationTick, `${label} durationTick`);
    optionalNumber((event.startTick ?? 0) + (event.durationTick ?? 0), `${label} end tick`);
    optionalNumber(event.velocity, `${label} velocity`, 0, 1);
    if (notes) {
      optionalNumber(event.pitch, `${label} pitch`, 0, 127, true);
      assertOptionalString(event.lyric, `${label} lyric`);
    } else assertOptionalString(event.type, `${label} type`);
  }
}

function validateSnippet(snippet, label) {
  assertRecord(snippet, label);
  textFields(snippet, ['id', 'name', 'type', 'instrumentId', 'patchId', 'kitId',
    'audioAssetId', 'audioDataUrl', 'audioUrl', 'audioUnavailableReason'], label);
  if (snippet.type !== undefined && !['midi', 'drum', 'audio'].includes(snippet.type)) {
    throw new Error(`${label} type is unsupported`);
  }
  optionalNumber(snippet.bpm, `${label} bpm`, 1, 1000);
  optionalNumber(snippet.durationTicks, `${label} durationTicks`);
  validateEvents(snippet.notes, `${label} notes`, true);
  validateEvents(snippet.hits, `${label} hits`);
  for (const field of ['patchRecorded', 'kitRecorded']) {
    if (snippet[field] == null) continue;
    assertRecord(snippet[field], `${label} ${field}`);
    textFields(snippet[field], ['instrumentId', 'name'], `${label} ${field}`);
  }
}

function validateCustomInstrument(instrument, label) {
  assertRecord(instrument, label);
  textFields(instrument, ['id', 'name', 'type', 'sourceSnippetId', 'audioAssetId', 'audioDataUrl'], label);
}

function validateProject(project, label = 'Workspace project') {
  assertRecord(project, label);
  if (typeof project.id !== 'string' || !project.id.trim()) {
    throw new Error(`${label} needs a project id`);
  }
  assertOptionalString(project.name, `${label} name`);
  optionalNumber(project.bpm, `${label} bpm`, 1, 1000);

  const snippets = assertRecordArray(project.snippets, `${label} snippets`);
  snippets.forEach((snippet, index) => validateSnippet(snippet, `${label} snippet ${index + 1}`));

  const tracks = assertRecordArray(project.tracks, `${label} tracks`);
  tracks.forEach((track, trackIndex) => {
    const trackLabel = `${label} track ${trackIndex + 1}`;
    textFields(track, ['id', 'name', 'type', 'instrumentId', 'color'], trackLabel);
    optionalNumber(track.volume, `${trackLabel} volume`, 0, 1);
    optionalNumber(track.pan, `${trackLabel} pan`, -1, 1);
    const clips = assertRecordArray(track.clips, `${label} track ${trackIndex + 1} clips`);
    clips.forEach((clip, clipIndex) => {
      const clipLabel = `${trackLabel} clip ${clipIndex + 1}`;
      textFields(clip, ['id', 'snippetId', 'name', 'color'], clipLabel);
      optionalNumber(clip.startBar, `${clipLabel} startBar`, 0, MAX_IMPORTED_BARS);
      optionalNumber(clip.durationBars, `${clipLabel} durationBars`, 0, MAX_IMPORTED_BARS);
      optionalNumber((clip.startBar ?? 0) + (clip.durationBars ?? 0), `${clipLabel} end bar`, 0, MAX_IMPORTED_BARS);
      optionalNumber(clip.timeScale, `${clipLabel} timeScale`, 0.125, 8);
      if (clip.snippet !== undefined) {
        validateSnippet(clip.snippet, `${label} track ${trackIndex + 1} clip ${clipIndex + 1} snippet`);
        if (clip.snippetId !== undefined && clip.snippet.id !== undefined && clip.snippetId !== clip.snippet.id) {
          throw new Error(`${clipLabel} snippet references disagree`);
        }
      } else if (clip.snippetId && !snippets.some(snippet => snippet.id === clip.snippetId)) {
        throw new Error(`${clipLabel} snippet reference is missing`);
      }
    });
  });

  if (project.settings !== undefined) {
    assertRecord(project.settings, `${label} settings`);
    for (const field of ['masterVolume', 'metronomeVolume']) {
      optionalNumber(project.settings[field], `${label} ${field}`, 0, 1);
    }
    if (project.settings.beatColors !== undefined) {
      if (!Array.isArray(project.settings.beatColors)) throw new Error(`${label} beatColors must be an array`);
      for (const color of project.settings.beatColors) assertOptionalString(color, `${label} beat color`);
    }
    const instruments = assertRecordArray(
      project.settings.customInstruments,
      `${label} custom instruments`,
    );
    instruments.forEach((instrument, index) => {
      validateCustomInstrument(instrument, `${label} custom instrument ${index + 1}`);
    });
  }
}

function validateSnapshots(snapshots, label) {
  const entries = assertRecordArray(snapshots, label);
  entries.forEach((snapshot, index) => {
    assertOptionalString(snapshot.label, `${label} entry ${index + 1} label`);
    optionalNumber(snapshot.bpm, `${label} entry ${index + 1} bpm`, 1, 1000);
    validateProject(snapshot.data, `${label} entry ${index + 1} project`);
  });
}

function isVersionString(value) {
  return typeof value === 'string'
    && value.length <= 64
    && /^\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

export function workspaceBackup(project, options = {}) {
  return {
    kind: 'notenotes-workspace',
    version: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    contents: options.contents || 'current',
    project: clone(project),
    milestones: options.milestones ? clone(options.milestones) : undefined,
    versions: options.versions ? clone(options.versions) : undefined,
  };
}

export function snippetsBackup(project) {
  return {
    kind: 'notenotes-snippets',
    version: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    sourceProject: {
      id: project?.id,
      name: project?.name,
      bpm: project?.bpm,
      timeSignature: project?.timeSignature,
    },
    snippets: clone(project?.snippets || []),
    customInstruments: clone(project?.settings?.customInstruments || []),
  };
}

export function backupFilename(project, suffix) {
  const name = (project?.name || 'notenotes')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'notenotes';
  return `${name}-${suffix}-${stamp()}.json`;
}

export async function saveJsonFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: 'Notenotes backup',
        accept: { 'application/json': ['.json'] },
      }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveJsonToDirectory(data, filename, directoryHandle) {
  if (!directoryHandle?.getFileHandle) {
    throw new Error('Backup folder is not available');
  }
  const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  await writable.close();
}

export async function readJsonFile(file) {
  if (!file || typeof file.text !== 'function') {
    throw new Error('Backup file could not be read');
  }
  if (Number.isFinite(file.size) && file.size > MAX_BACKUP_FILE_BYTES) {
    throw new Error('Backup file exceeds the 256 MB import limit');
  }

  let text;
  try {
    text = await file.text();
  } catch {
    throw new Error('Backup file could not be read');
  }
  if (typeof text !== 'string' || text.length > MAX_BACKUP_FILE_BYTES) {
    throw new Error('Backup file exceeds the 256 MB import limit');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Backup file does not contain valid JSON');
  }
}

export function validateBackup(data) {
  if (!isRecord(data)) throw new Error('Backup root must be an object');
  assertSafeBackupTree(data);

  const schemaVersion = data.version === undefined ? 1 : data.version;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error('Backup schema version is invalid');
  }
  if (schemaVersion > BACKUP_VERSION) {
    throw new Error(`Backup schema v${schemaVersion} needs a newer Notenotes version`);
  }
  if (data.appVersion !== undefined && !isVersionString(data.appVersion)) {
    throw new Error('Backup app version is invalid');
  }
  if (isNewerVersion(data.appVersion, APP_VERSION)) {
    throw new Error(`Backup from Notenotes ${data.appVersion} needs a newer app version`);
  }

  if (data.kind === 'notenotes-workspace') {
    validateProject(data.project);
    validateSnapshots(data.milestones, 'Workspace milestones');
    validateSnapshots(data.versions, 'Workspace versions');
    return 'workspace';
  }

  if (data.kind === 'notenotes-snippets') {
    const snippets = assertRecordArray(data.snippets, 'Snippet backup snippets', { required: true });
    snippets.forEach((snippet, index) => validateSnippet(snippet, `Snippet backup snippet ${index + 1}`));
    const instruments = assertRecordArray(data.customInstruments, 'Snippet backup custom instruments');
    instruments.forEach((instrument, index) => {
      validateCustomInstrument(instrument, `Snippet backup custom instrument ${index + 1}`);
    });
    if (data.sourceProject !== undefined) assertRecord(data.sourceProject, 'Snippet backup source project');
    return 'snippets';
  }

  throw new Error('Not a Notenotes backup file');
}

export function snippetsWithFreshIds(snippets = []) {
  return snippets.map(snippet => ({
    ...clone(snippet),
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  }));
}

export function customInstrumentsWithFreshIds(instruments = []) {
  return instruments.map(instrument => ({
    ...clone(instrument),
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
}

/** Import the library as one graph so aliases and source recordings stay linked. */
export function snippetLibraryWithFreshIds(backup) {
  const snippets = snippetsWithFreshIds(backup.snippets);
  const customInstruments = customInstrumentsWithFreshIds(backup.customInstruments);
  const snippetIds = new Map((backup.snippets || []).map((snippet, i) => [snippet.id, snippets[i].id]));
  const instrumentIds = new Map((backup.customInstruments || []).map((instrument, i) => [instrument.id, customInstruments[i].id]));
  const remapInstrument = id => {
    if (typeof id !== 'string') return id;
    const prefixed = id.startsWith('custom:');
    const original = prefixed ? id.slice(7) : id;
    const replacement = instrumentIds.get(original);
    return replacement ? `${prefixed ? 'custom:' : ''}${replacement}` : id;
  };
  for (const snippet of snippets) {
    for (const field of ['instrumentId', 'patchId', 'kitId']) {
      if (snippet[field] !== undefined) snippet[field] = remapInstrument(snippet[field]);
    }
    for (const field of ['patchRecorded', 'kitRecorded']) {
      if (snippet[field]?.instrumentId !== undefined) {
        snippet[field].instrumentId = remapInstrument(snippet[field].instrumentId);
      }
    }
  }
  for (const instrument of customInstruments) {
    if (snippetIds.has(instrument.sourceSnippetId)) {
      instrument.sourceSnippetId = snippetIds.get(instrument.sourceSnippetId);
    }
  }
  return { snippets, customInstruments };
}
