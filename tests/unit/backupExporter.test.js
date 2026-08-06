import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_BACKUP_FILE_BYTES,
  readJsonFile,
  validateBackup,
} from '../../src/export/BackupExporter.js';

test('readJsonFile parses a bounded JSON backup', async () => {
  const file = {
    size: 17,
    text: async () => '{"kind":"test"}',
  };

  assert.deepEqual(await readJsonFile(file), { kind: 'test' });
});

test('readJsonFile rejects oversized backups before reading them', async () => {
  let read = false;
  const file = {
    size: MAX_BACKUP_FILE_BYTES + 1,
    text: async () => {
      read = true;
      return '{}';
    },
  };

  await assert.rejects(() => readJsonFile(file), /256 MB import limit/);
  assert.equal(read, false);
});

test('readJsonFile reports invalid JSON without exposing parser internals', async () => {
  const file = {
    size: 8,
    text: async () => '{broken',
  };

  await assert.rejects(
    () => readJsonFile(file),
    { message: 'Backup file does not contain valid JSON' },
  );
});

function project(overrides = {}) {
  return {
    id: 'project-1',
    name: 'Backup test',
    snippets: [],
    tracks: [],
    settings: { customInstruments: [] },
    ...overrides,
  };
}

test('validateBackup accepts structurally valid workspace archives and snippet backups', () => {
  const workspace = {
    kind: 'notenotes-workspace',
    version: 1,
    appVersion: '0.1.126',
    project: project(),
    milestones: [{ data: project({ name: 'Milestone' }) }],
    versions: [{ data: project({ name: 'Version' }) }],
  };
  const snippets = {
    kind: 'notenotes-snippets',
    version: 1,
    snippets: [{ id: 'snippet-1', type: 'midi', notes: [], hits: [] }],
    customInstruments: [{ id: 'instrument-1', type: 'patch' }],
  };

  assert.equal(validateBackup(workspace), 'workspace');
  assert.equal(validateBackup(snippets), 'snippets');
});

test('validateBackup rejects malformed structures before they reach persistence', () => {
  assert.throws(
    () => validateBackup({ kind: 'notenotes-workspace', project: project({ tracks: {} }) }),
    /tracks must be an array/,
  );
  assert.throws(
    () => validateBackup({ kind: 'notenotes-snippets', snippets: [null] }),
    /entry must be an object/,
  );
  assert.throws(
    () => validateBackup({ kind: 'notenotes-workspace', version: '1', project: project() }),
    /schema version is invalid/,
  );
  assert.throws(
    () => validateBackup({ kind: 'notenotes-workspace', appVersion: 'unknown', project: project() }),
    /app version is invalid/,
  );
});

test('validateBackup rejects unsafe keys and excessive nesting', () => {
  const unsafe = JSON.parse(`{
    "kind": "notenotes-workspace",
    "project": {
      "id": "project-1",
      "snippets": [],
      "tracks": [],
      "settings": { "__proto__": { "polluted": true } }
    }
  }`);
  assert.throws(() => validateBackup(unsafe), /unsafe property/);

  const nested = {};
  let cursor = nested;
  for (let i = 0; i < 70; i++) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assert.throws(
    () => validateBackup({ kind: 'notenotes-workspace', project: project({ nested }) }),
    /nested too deeply/,
  );
});
