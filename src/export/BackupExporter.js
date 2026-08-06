import { APP_VERSION } from '../version.js';

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

function validateSnippet(snippet, label) {
  assertRecord(snippet, label);
  assertOptionalString(snippet.id, `${label} id`);
  assertOptionalString(snippet.type, `${label} type`);
  assertOptionalString(snippet.audioDataUrl, `${label} audio data`);
  assertRecordArray(snippet.notes, `${label} notes`);
  assertRecordArray(snippet.hits, `${label} hits`);
}

function validateCustomInstrument(instrument, label) {
  assertRecord(instrument, label);
  assertOptionalString(instrument.id, `${label} id`);
  assertOptionalString(instrument.type, `${label} type`);
  assertOptionalString(instrument.audioDataUrl, `${label} audio data`);
}

function validateProject(project, label = 'Workspace project') {
  assertRecord(project, label);
  if (typeof project.id !== 'string' || !project.id.trim()) {
    throw new Error(`${label} needs a project id`);
  }
  assertOptionalString(project.name, `${label} name`);

  const snippets = assertRecordArray(project.snippets, `${label} snippets`);
  snippets.forEach((snippet, index) => validateSnippet(snippet, `${label} snippet ${index + 1}`));

  const tracks = assertRecordArray(project.tracks, `${label} tracks`);
  tracks.forEach((track, trackIndex) => {
    const clips = assertRecordArray(track.clips, `${label} track ${trackIndex + 1} clips`);
    clips.forEach((clip, clipIndex) => {
      if (clip.snippet !== undefined) {
        validateSnippet(clip.snippet, `${label} track ${trackIndex + 1} clip ${clipIndex + 1} snippet`);
      }
    });
  });

  if (project.settings !== undefined) {
    assertRecord(project.settings, `${label} settings`);
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
