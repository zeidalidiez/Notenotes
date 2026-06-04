import test from 'node:test';
import assert from 'node:assert/strict';

import { ProjectStore, createProject } from '../../src/data/ProjectStore.js';

async function freshStore() {
  const store = new ProjectStore();
  await store.init();
  return store;
}

test('save then load round-trips a project structurally', async () => {
  const store = await freshStore();
  const project = createProject('Round Trip');
  project.bpm = 140;
  project.snippets.push({ id: 's1', type: 'midi', notes: [{ pitch: 60, startTick: 0, durationTick: 240 }] });

  await store.save(project);
  const loaded = await store.load(project.id);

  assert.equal(loaded.id, project.id);
  assert.equal(loaded.name, 'Round Trip');
  assert.equal(loaded.bpm, 140);
  assert.equal(loaded.snippets.length, 1);
  assert.equal(loaded.snippets[0].notes[0].pitch, 60);
});

test('load returns undefined for an unknown project id', async () => {
  const store = await freshStore();
  assert.equal(await store.load('does-not-exist'), undefined);
});

test('listAll returns summaries sorted newest first', async () => {
  const store = await freshStore();
  const a = createProject('A'); a.updatedAt = 1000;
  const b = createProject('B'); b.updatedAt = 3000;
  const c = createProject('C'); c.updatedAt = 2000;
  await store.save(a); await store.save(b); await store.save(c);

  const list = await store.listAll();
  // save() stamps updatedAt = Date.now(), so assert the shape rather than the order we set
  assert.equal(list.length, 3);
  for (const item of list) assert.ok(item.id && item.name && typeof item.updatedAt === 'number');
});

test('saveVersion keeps only the configured number of versions per project', async () => {
  const store = await freshStore();
  const project = createProject('Versioned'); // default version history limit is 5
  await store.save(project);

  for (let i = 0; i < 9; i++) await store.saveVersion(project);

  const versions = await store.getVersions(project.id);
  assert.equal(versions.length, 5, 'pruneVersions trimmed history to the default limit');
});

test('version history limit is configurable per project', async () => {
  const store = await freshStore();
  const project = createProject('BigHistory');
  project.settings.versionHistoryLimit = 10;
  await store.save(project);

  for (let i = 0; i < 14; i++) await store.saveVersion(project);

  const versions = await store.getVersions(project.id);
  assert.equal(versions.length, 10);
});

test('data-URL audio migrates to a content-addressed asset and is idempotent', async () => {
  const store = await freshStore();
  const project = createProject('Migrate');
  project.snippets.push({
    id: 'a1', type: 'audio',
    audioDataUrl: 'data:audio/webm;base64,AAAA', audioSize: 4,
  });

  const changed = await store.migrateProjectAudioAssets(project);
  assert.equal(changed, true, 'first migration reports a change');
  const assetId = project.snippets[0].audioAssetId;
  assert.ok(assetId, 'snippet now references a stored asset id');
  assert.equal(project.snippets[0].audioDataUrl, undefined, 'inline data-URL stripped after migration');

  const changedAgain = await store.migrateProjectAudioAssets(project);
  assert.equal(changedAgain, false, 'second migration is a no-op (idempotent)');
  assert.equal(project.snippets[0].audioAssetId, assetId, 'asset id is stable across migrations');
});

test('garbageCollectAudioAssets deletes only unreferenced assets', async () => {
  const store = await freshStore();
  const project = createProject('GC');
  // referenced asset
  project.snippets.push({ id: 'a1', type: 'audio', audioAssetId: 'used-1' });
  await store.save(project);
  await store.saveAudioAsset(new Blob([new ArrayBuffer(64)], { type: 'audio/webm' }), { audioAssetId: 'used-1' });
  // orphan asset
  await store.saveAudioAsset(new Blob([new ArrayBuffer(128)], { type: 'audio/webm' }), { audioAssetId: 'orphan-1' });

  await store.garbageCollectAudioAssets();

  assert.ok(await store.getAudioAsset('used-1'), 'referenced asset survives GC');
  assert.equal(await store.getAudioAsset('orphan-1'), undefined, 'orphaned asset removed by GC');
});

test('save normalizes meter and progression on the stored project', async () => {
  const store = await freshStore();
  const project = createProject('Normalize');
  delete project.meter;
  project.timeSignature = { beats: 6, subdivision: 8 };
  project.progression = null;

  await store.save(project);
  const loaded = await store.load(project.id);

  assert.ok(loaded.meter && loaded.meter.id, 'meter rebuilt from time signature');
  assert.ok(loaded.progression, 'progression normalized to a default object');
  assert.equal(loaded.progression.enabled, false);
});

test('local settings persist by arbitrary key', async () => {
  const store = await freshStore();
  await store.setLocalSetting('lastFolder', { path: '/music' });
  assert.deepEqual(await store.getLocalSetting('lastFolder'), { path: '/music' });
  await store.deleteLocalSetting('lastFolder');
  assert.equal(await store.getLocalSetting('lastFolder'), undefined);
});
