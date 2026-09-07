import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.appErrors = errors;
  await page.goto('./');
  await page.waitForFunction(() => window.__notenotes?.settingsPanel);
});

test.afterEach(async ({ page }) => {
  expect(page.appErrors).toEqual([]);
});

async function settings(page, section) {
  if (await page.locator('#tb-more-btn').isVisible()) await page.locator('#tb-more-btn').click();
  await page.locator('#btn-settings').press('Enter');
  await expect(page.locator('#settings-close')).toBeVisible();
  if (section) await page.locator(`.settings-panel__tab[data-section="${section}"]`).press('Enter');
}

test('record, edit, undo, arrange, save, reload and export a musical idea', async ({ page }, testInfo) => {
  await expect(page.locator('#tab-creative')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#record-first-idea').click();
  await page.keyboard.down('1');
  await page.waitForFunction(() => window.__notenotes.transport.currentRawTick >= 240);
  await page.keyboard.up('1');
  await page.waitForFunction(() => window.__notenotes.transport.currentRawTick >= 480);
  await page.keyboard.down('2');
  await page.waitForFunction(() => window.__notenotes.transport.currentRawTick >= 720);
  await page.keyboard.up('2');
  await page.locator('#btn-stop').click();
  await expect.poll(() => page.evaluate(() => window.__notenotes.project.snippets.length)).toBe(1);
  const captured = await page.evaluate(() => structuredClone(window.__notenotes.project.snippets[0]));
  expect(captured.notes).toHaveLength(2);
  expect(captured.notes[1].startTick).toBeGreaterThan(captured.notes[0].startTick);

  await page.locator('#tab-pianoroll').click();
  await page.locator('.edit-browser__item').press('Enter');
  await page.locator('#edit-snippet-name').fill('Captured melody');
  await page.locator('#edit-snippet-name').press('Tab');
  await page.locator('#edit-double-btn').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__notenotes.project.snippets[0].durationTicks)).toBe(captured.durationTicks * 2);
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.__notenotes.project.snippets[0].durationTicks)).toBe(captured.durationTicks);

  await page.locator('#tab-canvas').click();
  await page.locator('.canvas-snippet-dock__item').press('Enter');
  await expect(page.locator('.canvas-clip')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.canvas-clip')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.canvas-clip')).toHaveCount(1);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-status-label')).toHaveText('Saved');
  await page.reload();
  await page.waitForFunction(() => window.__notenotes?.settingsPanel);
  const restored = await page.evaluate(() => {
    const project = window.__notenotes.project;
    const snippet = project.snippets[0];
    return { name: snippet.name, duration: snippet.durationTicks,
      linked: project.tracks.some(track => track.clips.some(clip => clip.snippet === snippet)) };
  });
  expect(restored).toEqual({ name: 'Captured melody', duration: captured.durationTicks, linked: true });
  await page.locator('#tab-canvas').click();
  await page.screenshot({ path: testInfo.outputPath('arrangement.png') });
  await settings(page, 'sheet');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-canvas-midi').press('Enter');
  const download = await downloadPromise;
  const midi = await readFile(await download.path());
  expect(midi.subarray(0, 4).toString()).toBe('MThd');
  expect(midi.readUInt16BE(8)).toBe(1);
  expect(midi.readUInt16BE(10)).toBeGreaterThan(1);
});

test('undo keeps its original snippet when another snippet is open', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.__notenotes;
    app.project.snippets = ['First', 'Second'].map((name, i) => ({ id: `undo-${i}`, name, type: 'midi',
      durationTicks: 1920, bpm: 120, notes: [{ pitch: 60 + i, startTick: 0, durationTick: 480 }] }));
    app.modeTabs.setActive('pianoroll');
    app.editMode.loadSnippet(app.project.snippets[0]);
  });
  await page.locator('#edit-double-btn').press('Enter');
  await page.evaluate(() => window.__notenotes.editMode.loadSnippet(window.__notenotes.project.snippets[1]));
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__notenotes.project.snippets.map(snippet => [snippet.name, snippet.durationTicks, snippet.notes[0].pitch])))
    .toEqual([['First', 1920, 60], ['Second', 1920, 61]]);
  await expect(page.locator('#edit-snippet-name')).toHaveValue('Second');
});

test('failed saves remain visible and the Retry action persists pending edits', async ({ page }) => {
  await page.evaluate(async () => {
    const app = window.__notenotes;
    const save = app.store.save.bind(app.store);
    app.store.save = async project => { app.store.save = save; throw new Error('Simulated storage failure'); };
    app.project.name = 'Recovered after retry';
    app.store.scheduleAutoSave(app.project);
    await app.store.flushAutoSave().catch(() => {});
  });
  await expect(page.locator('#save-status-label')).toHaveText('Save failed');
  await page.locator('#save-retry').press('Enter');
  await expect(page.locator('#save-status-label')).toHaveText('Saved');
  await page.reload();
  await page.waitForFunction(() => window.__notenotes?.settingsPanel);
  expect(await page.evaluate(() => window.__notenotes.project.name)).toBe('Recovered after retry');
});

test('backup imports display hostile metadata literally across views and preserve legitimate punctuation', async ({ page }) => {
  const payload = '<img src=x onerror="window.__importXss=1">';
  const archive = await page.evaluate(payload => {
    const project = structuredClone(window.__notenotes.project);
    project.name = payload;
    project.settings.customInstruments = [{ id: 'custom-lead', name: payload, type: 'patch', sourceSnippetId: null }];
    project.settings.inspectBrowser = { view: `list">${payload}<div class="` };
    project.meter = { type: 'metered', id: '4/4', grouping: [1e12, 4 - 1e12] };
    project.tracks = [{ id: 'import-track', name: payload, type: 'midi', instrumentId: 'custom:custom-lead', clips: [] }];
    project.snippets = [{ id: 'import-audio', name: 'Lead <soft> & "warm"', type: 'audio', bpm: 120,
      durationTicks: 1920, audioUnavailable: true, audioUnavailableReason: payload }];
    return { kind: 'notenotes-workspace', version: 1, project,
      milestones: [{ label: payload, bpm: 120, timestamp: Date.now(), data: structuredClone(project) }] };
  }, payload);
  await settings(page, 'history');
  await page.locator('#backup-import-file').setInputFiles({ name: 'metadata.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) });
  await page.waitForFunction(name => window.__notenotes?.project?.name === name, payload);
  await expect(page.locator('.edit-browser')).toBeVisible();
  await page.locator('.edit-browser__item').press('Enter');
  await expect(page.locator('.edit-audio__status')).toHaveText(payload);
  await expect(page.locator('#edit-snippet-name')).toHaveValue('Lead <soft> & "warm"');
  await page.locator('#tab-canvas').click();
  await expect(page.locator('[data-track-inst]')).toHaveText(payload);
  await page.locator('[data-track-pan]').press('Enter');
  await expect(page.locator('.canvas-pan-modal strong')).toHaveText(`Pan ${payload}`);
  await page.keyboard.press('Escape');
  await settings(page);
  await expect(page.locator('#setting-project-name')).toHaveValue(payload);
  await page.locator('.settings-panel__tab[data-section="history"]').press('Enter');
  await expect(page.locator('.version-list__time').filter({ hasText: payload })).toHaveCount(1);
  expect(await page.evaluate(() => window.__importXss || false)).toBe(false);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});

test('native keyboard controls work without starting transport or playing behind Settings', async ({ page }, testInfo) => {
  await settings(page);
  const pitches = await page.evaluate(() => window.__notenotes.creativeMode.synth._voices.size);
  await page.locator('#settings-close').focus();
  await page.keyboard.press('z');
  expect(await page.evaluate(() => window.__notenotes.creativeMode.synth._voices.size)).toBe(pitches);
  await page.locator('#settings-close').press('Enter');
  await expect(page.locator('#settings-panel')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => window.__notenotes.transport.state)).toBe('stopped');
  if (testInfo.project.name === 'mobile') {
    await expect(page.locator('#tb-more')).toHaveAttribute('inert', '');
    for (const tab of await page.locator('.instrument-switcher__tab').all()) await expect(tab).toBeInViewport();
    const bounds = await page.locator('#transport-bar').boundingBox();
    expect(bounds.height).toBeLessThan(100);
  }
  await page.screenshot({ path: testInfo.outputPath('create.png') });
});

test('audio assets are ready before playback and Stop cancels the running source', async ({ page }) => {
  await page.evaluate(async () => {
    const app = window.__notenotes;
    const { snippetToWavBlob } = await import('/Notenotes/src/export/WavExporter.js');
    const blob = await snippetToWavBlob({ type: 'midi', bpm: 120, durationTicks: 4800,
      notes: [{ pitch: 60, startTick: 0, durationTick: 4800, velocity: 0.5 }] });
    const asset = await app.store.saveAudioAsset(blob);
    const snippet = { id: 'audio-stop', name: 'Stop test', type: 'audio', durationTicks: 4800, bpm: 120, audioAssetId: asset.audioAssetId };
    app.project.snippets = [snippet];
    app.project.tracks = [{ id: 'audio-track', type: 'audio', name: 'Audio', clips: [{ id: 'audio-clip', startBar: 0, snippetId: snippet.id, snippet }] }];
    app.modeTabs.setActive('canvas');
    app.canvasMode.refresh();
  });
  await page.locator('#btn-play').click();
  await expect.poll(() => page.evaluate(() => window.__notenotes.playbackEngine._activeAudioSources.size)).toBe(1);
  expect(await page.evaluate(() => window.__notenotes.engine.ctx.state)).toBe('running');
  await page.locator('#btn-stop').click();
  await expect.poll(() => page.evaluate(() => window.__notenotes.playbackEngine._activeAudioSources.size)).toBe(0);
  expect(await page.evaluate(() => window.__notenotes.transport.state)).toBe('stopped');
});
