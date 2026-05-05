const BACKUP_VERSION = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function workspaceBackup(project, options = {}) {
  return {
    kind: 'notenotes-workspace',
    version: BACKUP_VERSION,
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
    exportedAt: new Date().toISOString(),
    sourceProject: {
      id: project?.id,
      name: project?.name,
      bpm: project?.bpm,
      timeSignature: project?.timeSignature,
    },
    snippets: clone(project?.snippets || []),
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

export async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

export function validateBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('Backup is not valid JSON');
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
