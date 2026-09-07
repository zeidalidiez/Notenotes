import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_IMPORTED_TICKS } from '../../src/engine/ImportLimits.js';
import { normalizeMeter } from '../../src/engine/Meter.js';
import { decodeSnippetShare, encodeSnippetShare, MAX_SHARE_CODE_CHARS } from '../../src/utils/SnippetShare.js';

import {
  MAX_BACKUP_FILE_BYTES,
  snippetLibraryWithFreshIds,
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
  assert.equal(validateBackup({
    kind: 'notenotes-workspace',
    project: project({ name: 'Legacy backup without version metadata' }),
  }), 'workspace');
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

test('backup imports bound timing and metadata before building editor grids', () => {
  const backup = snippet => ({ kind: 'notenotes-snippets', snippets: [snippet] });
  for (const snippet of [
    { durationTicks: Infinity }, { durationTicks: MAX_IMPORTED_TICKS + 1 },
    { notes: [{ startTick: MAX_IMPORTED_TICKS, durationTick: 1 }] },
    { hits: [{ startTick: -1 }] }, { notes: [{ pitch: 128 }] },
    { bpm: '<img src=x onerror=alert(1)>' }, { name: {} }, { type: 'midi" onclick="bad' },
  ]) assert.throws(() => validateBackup(backup(snippet)));
  assert.equal(validateBackup(backup({
    type: 'midi', name: 'Lead <soft> & "warm"', durationTicks: 480,
    notes: [{ pitch: 0, startTick: 0, durationTick: 480, velocity: 0 }],
    instrumentId: 'unknown-but-preserved', patchRecorded: { patchSnapshot: null },
  })), 'snippets');
  assert.equal(validateBackup({ kind: 'notenotes-workspace', project: project({
    tracks: [{ volume: 0, pan: 0, clips: [{ startBar: 0.25, durationBars: 0.5, snippet: { type: 'drum' } }] }],
  }) }), 'workspace');
});

test('share decoder rejects oversized codes and overflowing event ends; silence survives sharing', () => {
  const encode = payload => Buffer.from(JSON.stringify({ v: 1, t: 'midi', ...payload })).toString('base64url');
  assert.equal(decodeSnippetShare('A'.repeat(MAX_SHARE_CODE_CHARS + 1)), null);
  assert.equal(decodeSnippetShare(encode({ N: [[60, 1e308, 1e308, 80]] })), null);
  assert.equal(decodeSnippetShare(encode({ d: 1e308, N: [[60, 0, 480, 80]] })), null);
  const silent = decodeSnippetShare(encodeSnippetShare({ type: 'midi', notes: [{ pitch: 60, startTick: 0, durationTick: 480, velocity: 0 }] }));
  assert.equal(silent.notes[0].velocity, 0);
});

test('library import remaps custom instrument aliases and source recordings together', () => {
  const backup = {
    snippets: [
      { id: 'source', type: 'audio' },
      { id: 'melody', instrumentId: 'custom:patch', patchId: 'patch', patchRecorded: { instrumentId: 'custom:patch' } },
      { id: 'rhythm', kitId: 'custom:kit', kitRecorded: { instrumentId: 'custom:kit' } },
      { id: 'builtin', instrumentId: 'fm4' },
    ],
    customInstruments: [{ id: 'patch', type: 'patch', sourceSnippetId: 'source' }, { id: 'kit', type: 'kit' }],
  };
  const imported = snippetLibraryWithFreshIds(backup);
  const patch = imported.customInstruments[0];
  assert.notEqual(patch.id, 'patch');
  assert.equal(imported.snippets[1].instrumentId, `custom:${patch.id}`);
  assert.equal(imported.snippets[1].patchId, patch.id);
  assert.equal(imported.snippets[1].patchRecorded.instrumentId, `custom:${patch.id}`);
  assert.equal(patch.sourceSnippetId, imported.snippets[0].id);
  assert.equal(imported.snippets[2].kitRecorded.instrumentId, `custom:${imported.customInstruments[1].id}`);
  assert.equal(imported.snippets[3].instrumentId, 'fm4');
  assert.equal(backup.customInstruments[0].id, 'patch', 'source archive stays unchanged');
});

test('file-based instruments keep nullable source references in workspace and snippet archives', () => {
  const instrument = { id: 'sample-file', name: 'Sample <soft>', type: 'patch', sourceSnippetId: null };
  assert.equal(validateBackup({ kind: 'notenotes-snippets', snippets: [], customInstruments: [instrument] }), 'snippets');
  assert.equal(validateBackup({ kind: 'notenotes-workspace', project: project({ settings: { customInstruments: [instrument] } }) }), 'workspace');
});

test('meter normalization cannot pass hostile groups to the Canvas grid', () => {
  for (const grouping of [[1e12, 4 - 1e12], [Infinity, -Infinity], [0, 4], [-1, 5], ['2', '2']]) {
    const meter = normalizeMeter({ type: 'metered', id: '4/4', grouping });
    assert.ok(meter.grouping.every(group => Number.isInteger(group) && group > 0 && group <= 4));
  }
  assert.deepEqual(normalizeMeter({ type: 'metered', id: '5/8', grouping: [3, 2] }).grouping, [3, 2]);
});
