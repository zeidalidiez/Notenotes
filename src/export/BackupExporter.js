import { APP_VERSION } from '../version.js';

const BACKUP_VERSION = 1;
export const MAX_BACKUP_FILE_BYTES = 256 * 1024 * 1024;

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
  if (!data || typeof data !== 'object') throw new Error('Backup is not valid JSON');
  if ((data.version || 1) > BACKUP_VERSION) {
    throw new Error(`Backup schema v${data.version} needs a newer Notenotes version`);
  }
  if (isNewerVersion(data.appVersion, APP_VERSION)) {
    throw new Error(`Backup from Notenotes ${data.appVersion} needs a newer app version`);
  }
  if (data.kind === 'notenotes-workspace' && data.project?.id) return 'workspace';
  if (data.kind === 'notenotes-snippets' && Array.isArray(data.snippets)) return 'snippets';
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
