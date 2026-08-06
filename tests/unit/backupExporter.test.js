import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_BACKUP_FILE_BYTES, readJsonFile } from '../../src/export/BackupExporter.js';

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
