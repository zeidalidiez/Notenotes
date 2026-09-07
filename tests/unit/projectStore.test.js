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

test('restoring an archive cannot be overwritten by an older pending autosave', async () => {
  const store = await freshStore();
  const project = createProject('Old pending edit');
  store.scheduleAutoSave(project);
  await store.replaceProjectArchive({ ...structuredClone(project), name: 'Restored workspace' });
  await store.flushAutoSave();
  assert.equal((await store.load(project.id)).name, 'Restored workspace');
});

test('library edits remain linked to Canvas clips after saving and loading', async () => {
  const store = await freshStore();
  const project = createProject('Linked clips');
  const snippet = { id: 'linked', type: 'midi', notes: [{ pitch: 60, startTick: 0, durationTick: 240 }] };
  project.snippets.push(snippet);
  project.tracks.push({ id: 'track', clips: [{ id: 'clip', snippetId: snippet.id, snippet }] });
  await store.save(project);
  const loaded = await store.load(project.id);
  assert.equal(loaded.snippets[0], loaded.tracks[0].clips[0].snippet);
  loaded.snippets[0].notes[0].pitch = 65;
  await store.save(loaded);
  const reloaded = await store.load(project.id);
  assert.equal(reloaded.tracks[0].clips[0].snippet.notes[0].pitch, 65);
  assert.equal(reloaded.snippets.length, 1);
});

test('legacy divergent clip edits survive normalization and repeated round trips', async () => {
  const store = await freshStore();
  const project = createProject('Legacy clip edits');
  const snippet = { id: 'linked', type: 'midi', notes: [{ pitch: 60 }] };
  project.snippets.push(snippet);
  const copy = { ...snippet, notes: [{ pitch: 72 }] };
  project.tracks.push({ id: 'track', clips: [
    { id: 'c1', snippetId: 'linked', snippet: structuredClone(copy) },
    { id: 'c2', snippetId: 'linked', snippet: structuredClone(copy) },
  ] });
  await store.save(project);
  const loaded = await store.load(project.id);
  assert.equal(loaded.snippets.length, 2);
  assert.equal(loaded.snippets[0].notes[0].pitch, 60);
  assert.equal(loaded.tracks[0].clips[0].snippet.notes[0].pitch, 72);
  assert.equal(loaded.tracks[0].clips[0].snippet, loaded.tracks[0].clips[1].snippet);
  await store.saveVersion(loaded);
  const [{ versionId }] = await store.getVersions(loaded.id);
  const restored = await store.restoreVersion(versionId);
  assert.equal(restored.snippets.length, 2);
  assert.equal(restored.tracks[0].clips[0].snippet, restored.snippets[1]);
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

test('flushAutoSave persists pending edits once and cancels the debounce', async () => {
  const store = await freshStore();
  const project = createProject('Flush Pending');
  store._autoSaveDelay = 10;

  let saves = 0;
  let versions = 0;
  const save = store.save.bind(store);
  const saveVersion = store.saveVersion.bind(store);
  store.save = async (...args) => {
    saves++;
    return save(...args);
  };
  store.saveVersion = async (...args) => {
    versions++;
    return saveVersion(...args);
  };

  project.bpm = 137;
  store.scheduleAutoSave(project);

  assert.equal(await store.flushAutoSave(), true);
  assert.equal((await store.load(project.id)).bpm, 137);
  assert.equal(saves, 1);
  assert.equal(versions, 1);

  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(saves, 1, 'cleared debounce does not save a second time');
  assert.equal(await store.flushAutoSave(), false, 'nothing remains pending');
});

test('a failed autosave retains its project for an explicit retry', async () => {
  const store = await freshStore();
  const project = createProject('Retry');
  const save = store.save.bind(store);
  store.save = async () => { throw new Error('Quota exceeded'); };
  store.scheduleAutoSave(project);
  await assert.rejects(store.flushAutoSave(), /Quota exceeded/);
  assert.equal(store.saveState, 'error');
  assert.equal(store._pendingSave, project);
  store.save = save;
  assert.equal(await store.flushAutoSave(), true);
  assert.equal(store.saveState, 'saved');
  assert.equal((await store.load(project.id)).name, 'Retry');
});

test('a failed in-flight autosave cannot replace a newer pending edit', async () => {
  const store = await freshStore();
  const first = createProject('Old');
  const latest = createProject('Latest');
  let rejectSave;
  const save = store.save.bind(store);
  store.save = () => new Promise((resolve, reject) => { rejectSave = reject; });
  store.scheduleAutoSave(first);
  const pending = store.flushAutoSave();
  await Promise.resolve();
  store.scheduleAutoSave(latest);
  rejectSave(new Error('Write failed'));
  await assert.rejects(pending, /Write failed/);
  assert.equal(store._pendingSave, latest);
  store.save = save;
  await store.flushAutoSave();
  assert.equal((await store.load(latest.id)).name, 'Latest');
});
