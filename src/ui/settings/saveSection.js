/**
 * saveSection — SettingsPanel "Save" tab: version history, storage status,
 * workspace backup (incl. folder backup), and milestones.
 *
 * Methods are split out of SettingsPanel for size and composed back onto its
 * prototype via Object.assign (see SettingsPanel.js). Bodies are unchanged.
 */

import { byteLength, formatBytes, percent, BACKUP_CONTENT_OPTIONS } from './settingsShared.js';
import { APP_VERSION } from '../../version.js';
import { showToast } from '../Toast.js';
import { backupFilename, customInstrumentsWithFreshIds, readJsonFile, saveJsonFile, snippetsBackup, snippetsWithFreshIds, validateBackup, workspaceBackup } from '../../export/BackupExporter.js';
import { DEFAULT_VERSION_HISTORY_LIMIT, VERSION_HISTORY_LIMITS } from '../../data/ProjectStore.js';
import { formatRelativeTime, workspaceBackupStatus } from '../../utils/BackupStatus.js';
import { LOCAL_BACKUP_FOLDER_KEY, backupFolderPermission, folderBackupSupported, getBackupFolderHandle, saveWorkspaceBackupToFolder, workspaceBackupPayload } from '../../utils/FolderBackup.js';

export const SaveSectionMixin = {
  _renderHistorySection() {
    const historyLimit = VERSION_HISTORY_LIMITS.includes(Number(this.project?.settings?.versionHistoryLimit))
      ? Number(this.project.settings.versionHistoryLimit)
      : DEFAULT_VERSION_HISTORY_LIMIT;
    const backupContents = this.project?.settings?.backupContents || 'current';
    return `
      <div class="settings-section" id="section-history">
        <div class="settings-group">
          <h3 class="settings-group__title">Storage</h3>
          <p class="settings-desc">Notenotes saves work in this browser. Browser storage is convenient, but it is not a backup file you own. Save workspace backups for anything you would hate to lose.</p>
          <div class="storage-meter" id="storage-meter">
            <div class="storage-meter__bar" aria-hidden="true">
              <span class="storage-meter__fill" id="storage-meter-fill" style="width:0%;"></span>
            </div>
            <div class="storage-meter__stats">
              <span id="storage-meter-used">Checking storage...</span>
              <span id="storage-meter-quota"></span>
            </div>
          </div>
          <div class="settings-row">
            <label class="settings-label">Audio</label>
            <span class="settings-value" id="storage-audio-count">Checking...</span>
          </div>
          <div class="settings-row">
            <label class="settings-label">Browser storage</label>
            <span class="settings-value" id="storage-persistence">Checking...</span>
          </div>
          <div class="settings-row">
            <label class="settings-label">Workspace backup</label>
            <span class="settings-value" id="storage-backup-size">Estimating...</span>
          </div>
          <div class="settings-row">
            <label class="settings-label">Backup status</label>
            <span class="settings-value" id="storage-backup-status">Checking...</span>
          </div>
          <p class="settings-desc" id="storage-advice">Checking storage...</p>
          <div class="settings-row">
            <label class="settings-label">Health audit</label>
            <button class="btn btn--ghost" id="storage-health-check" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Check Storage Health</button>
          </div>
          <div class="version-list__empty" id="storage-health-report">Run a storage health check to find missing audio assets or orphaned local audio.</div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Backups</h3>
          <p class="settings-desc">Save portable JSON files outside browser storage. Workspace backups restore the project; snippet backups restore just the snippet library. Older backups can import into newer Notenotes builds, but newer backups will not import into older builds.</p>
          <div class="settings-row">
            <label class="settings-label">Contents</label>
            <select class="settings-select" id="backup-contents" aria-label="Workspace backup contents">
              ${BACKUP_CONTENT_OPTIONS.map(option => `<option value="${option.id}" ${backupContents === option.id ? 'selected' : ''}>${option.label}</option>`).join('')}
            </select>
          </div>
          <p class="settings-desc" id="backup-contents-desc">${this._backupContentsDescription(backupContents)}</p>
          <div class="settings-row">
            <label class="settings-label">Local folder</label>
            <span class="settings-value" id="backup-folder-status">Checking...</span>
          </div>
          <div class="settings-row">
            <label class="settings-label"></label>
            <button class="btn btn--ghost" id="backup-folder-connect" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Connect Folder</button>
            <button class="btn btn--ghost" id="backup-folder-save" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Save To Folder</button>
            <button class="btn btn--ghost version-list__danger" id="backup-folder-disconnect" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Disconnect</button>
          </div>
          <p class="settings-desc" id="backup-folder-desc">Desktop Chrome and Edge can save workspace backups straight into a folder you pick. Other browsers can still use Save Backup.</p>
          <div class="settings-row">
            <label class="settings-label">Workspace</label>
            <button class="btn btn--ghost" id="backup-workspace-save" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Save Backup</button>
          </div>
          <div class="settings-row">
            <label class="settings-label">Snippets</label>
            <button class="btn btn--ghost" id="backup-snippets-save" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Save Backup</button>
          </div>
          <div class="settings-row">
            <label class="settings-label">Restore</label>
            <button class="btn btn--ghost" id="backup-import-btn" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Import Backup</button>
            <input id="backup-import-file" type="file" accept="application/json,.json" hidden />
          </div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Milestones</h3>
          <p class="settings-desc">Save named project checkpoints when you reach an important idea. Milestones are kept until browser data is cleared.</p>
          <div class="settings-row">
            <label class="settings-label">Name</label>
            <input class="settings-input" id="milestone-name" type="text" placeholder="Verse idea, Beta 1..." aria-label="Milestone name"/>
          </div>
          <div class="settings-row">
            <label class="settings-label"></label>
            <button class="btn btn--primary" id="milestone-save" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Save Milestone</button>
            <button class="btn btn--ghost version-list__danger" id="milestone-clear" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Clear Milestones</button>
          </div>
          <div id="milestone-list" class="version-list">
            <div class="version-list__loading">Loading milestones...</div>
          </div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group__title">Version History</h3>
          <p class="settings-desc">Restore to a previous save. Higher limits use more local browser storage.</p>
          <div class="settings-row">
            <label class="settings-label">Keep</label>
            <select class="settings-select" id="version-history-limit" aria-label="Version history depth">
              ${VERSION_HISTORY_LIMITS.map(limit => `<option value="${limit}" ${historyLimit === limit ? 'selected' : ''}>${limit} versions</option>`).join('')}
            </select>
            <button class="btn btn--ghost version-list__danger" id="version-history-clear" style="font-size:0.75rem;min-height:30px;padding:2px 10px;">Clear History</button>
          </div>
          <div id="version-list" class="version-list">
            <div class="version-list__loading">Loading versions...</div>
          </div>
        </div>
      </div>
    `;
  },

  _backupContentsDescription(contents = 'current') {
    if (contents === 'archive') return 'Full archive includes the current workspace, milestones, and version history. This is the biggest file and the safest handoff.';
    if (contents === 'milestones') return 'Includes the current workspace and named milestones, but leaves auto-save history out.';
    return 'Includes the current workspace only. This is the smallest normal project backup.';
  },

  _workspaceBackupStatus() {
    return workspaceBackupStatus(this.project);
  },

  async _loadVersionHistory() {
    if (!this.project || !this.store) return;
    const listEl = this.el.querySelector('#version-list');
    if (!listEl) return;

    try {
      const versions = await this.store.getVersions(this.project.id);
      if (versions.length === 0) {
        listEl.innerHTML = '<div class="version-list__empty">No saved versions yet</div>';
        return;
      }

      listEl.innerHTML = versions.map(v => {
        const date = new Date(v.timestamp);
        const timeStr = date.toLocaleString();
        return `
          <div class="version-list__item" data-version-id="${v.versionId}">
            <div class="version-list__info">
              <span class="version-list__time">${timeStr}</span>
              <span class="version-list__meta">${v.bpm} BPM</span>
            </div>
            <div class="version-list__actions">
              <button class="btn btn--ghost version-list__restore" data-version-id="${v.versionId}">Restore</button>
              <button class="btn btn--ghost version-list__delete" data-version-id="${v.versionId}">Delete</button>
            </div>
          </div>
        `;
      }).join('');

      // Bind restore buttons
      listEl.querySelectorAll('.version-list__restore').forEach(btn => {
        btn.addEventListener('pointerdown', async (e) => {
          e.preventDefault();
          const vid = parseInt(btn.dataset.versionId, 10);
          if (confirm('Restore this version? Current changes will be saved first.')) {
            await this.store.save(this.project);
            const restored = await this.store.restoreVersion(vid);
            showToast('Version restored! Reload to apply.');
            // Force reload to apply
            setTimeout(() => window.location.reload(), 500);
          }
        });
      });

      listEl.querySelectorAll('.version-list__delete').forEach(btn => {
        btn.addEventListener('pointerdown', async (e) => {
          e.preventDefault();
          const vid = parseInt(btn.dataset.versionId, 10);
          if (!Number.isFinite(vid) || !confirm('Delete this version history entry?')) return;
          await this.store.deleteVersion(vid);
          await this._loadVersionHistory();
          await this._loadStorageStatus();
          showToast('Version deleted');
        });
      });
    } catch (err) {
      listEl.innerHTML = '<div class="version-list__empty">Error loading versions</div>';
      console.error('[Settings] Version history error:', err);
    }
  },

  async _loadStorageStatus() {
    const body = this.el.querySelector('#settings-body');
    if (!body || !this.project) return;

    const fillEl = body.querySelector('#storage-meter-fill');
    const usedEl = body.querySelector('#storage-meter-used');
    const quotaEl = body.querySelector('#storage-meter-quota');
    const audioEl = body.querySelector('#storage-audio-count');
    const persistenceEl = body.querySelector('#storage-persistence');
    const backupEl = body.querySelector('#storage-backup-size');
    const backupStatusEl = body.querySelector('#storage-backup-status');
    const adviceEl = body.querySelector('#storage-advice');

    try {
      const estimate = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      const usage = estimate?.usage || 0;
      const quota = estimate?.quota || 0;
      const usedPercent = percent(usage, quota);
      const backupStatus = this._workspaceBackupStatus();

      if (fillEl) {
        fillEl.style.width = `${usedPercent}%`;
        fillEl.classList.toggle('is-warning', usedPercent >= 70);
        fillEl.classList.toggle('is-danger', usedPercent >= 85);
      }
      if (usedEl) usedEl.textContent = quota ? `${formatBytes(usage)} used` : 'Storage estimate unavailable';
      if (quotaEl) quotaEl.textContent = quota ? `${usedPercent.toFixed(1)}% of ${formatBytes(quota)}` : '';
      if (persistenceEl) {
        if (persisted === true) persistenceEl.textContent = 'Persistent';
        else if (persisted === false) persistenceEl.textContent = 'Best effort';
        else persistenceEl.textContent = 'Unknown';
      }

      const audioStats = await this.store?.getAudioAssetStats?.(this.project);
      const audioBytes = audioStats?.bytes || 0;
      const audioCount = audioStats?.audioSnippetCount || 0;
      const missing = audioStats?.missing || 0;
      const backupBytes = this._estimateWorkspaceBackupBytes(audioBytes);

      if (audioEl) {
        const missingText = missing ? `, ${missing} unavailable` : '';
        audioEl.textContent = `${audioCount} recording${audioCount === 1 ? '' : 's'}, ${formatBytes(audioBytes)}${missingText}`;
      }
      if (backupEl) backupEl.textContent = `About ${formatBytes(backupBytes)}`;
      if (backupStatusEl) backupStatusEl.textContent = backupStatus.label;
      if (adviceEl) {
        if (backupStatus.state === 'danger') {
          adviceEl.textContent = backupStatus.advice;
        } else if (backupStatus.state === 'warning') {
          adviceEl.textContent = backupStatus.advice;
        } else if (missing > 0) {
          adviceEl.textContent = 'Some older audio clips are unavailable. Save a fresh workspace backup after checking the project.';
        } else if (usedPercent >= 85) {
          adviceEl.textContent = 'Storage is getting tight. Save a workspace backup outside the browser before recording more audio.';
        } else if (persisted === false) {
          adviceEl.textContent = 'Browser storage is best effort on this device. Workspace backups are still the real safety net.';
        } else if (audioCount > 0) {
          adviceEl.textContent = 'Audio recordings are stored locally. Save a workspace backup when you reach a version you care about.';
        } else {
          adviceEl.textContent = 'No audio recordings yet. Browser storage is still local, so workspace backups are the safest handoff point.';
        }
      }
    } catch (err) {
      console.warn('[Settings] Storage estimate failed:', err);
      if (usedEl) usedEl.textContent = 'Storage estimate unavailable';
      if (quotaEl) quotaEl.textContent = '';
      if (audioEl) audioEl.textContent = 'Could not check audio storage';
      if (persistenceEl) persistenceEl.textContent = 'Could not check';
      if (backupEl) backupEl.textContent = 'Could not estimate';
      if (backupStatusEl) backupStatusEl.textContent = this._workspaceBackupStatus().label;
      if (adviceEl) adviceEl.textContent = 'Save workspace backups outside the browser for anything important.';
    }
  },

  async _runStorageHealthAudit() {
    const reportEl = this.el?.querySelector('#storage-health-report');
    const btn = this.el?.querySelector('#storage-health-check');
    if (!reportEl || !this.project || !this.store?.getAudioStorageAudit) return;
    if (btn) btn.disabled = true;
    reportEl.textContent = 'Checking audio assets...';
    try {
      const audit = await this.store.getAudioStorageAudit(this.project);
      const status = audit.backupReady
        ? 'Ready for backup'
        : `${audit.missingAssetCount} missing/unavailable item${audit.missingAssetCount === 1 ? '' : 's'}`;
      const orphanText = audit.orphanedAssetCount
        ? `${audit.orphanedAssetCount} orphaned asset${audit.orphanedAssetCount === 1 ? '' : 's'} (${formatBytes(audit.bytesOrphaned)})`
        : 'No orphaned audio assets';
      const missingDetail = audit.missingAssetCount
        ? ` Missing: ${audit.missing.slice(0, 3).map(item => item.id || item.audioAssetId || item.kind).join(', ')}${audit.missing.length > 3 ? '...' : ''}.`
        : '';
      reportEl.textContent =
        `${status}. ${audit.audioSnippetCount} audio clip${audit.audioSnippetCount === 1 ? '' : 's'}, ` +
        `${audit.customInstrumentSampleCount} custom sample${audit.customInstrumentSampleCount === 1 ? '' : 's'}, ` +
        `${audit.referencedAssetCount} referenced asset${audit.referencedAssetCount === 1 ? '' : 's'} (${formatBytes(audit.bytesReferenced)}). ` +
        `${orphanText}.${missingDetail}`;
      reportEl.classList.toggle('is-danger', !audit.backupReady);
      reportEl.classList.toggle('is-warning', audit.backupReady && audit.orphanedAssetCount > 0);
      showToast(audit.backupReady ? 'Storage health check complete' : 'Storage health found missing audio');
    } catch (err) {
      console.error('[Settings] Storage health audit failed:', err);
      reportEl.textContent = 'Storage health check failed. Save a workspace backup before making risky changes.';
      showToast('Storage health check failed');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  _estimateWorkspaceBackupBytes(audioBytes = 0) {
    const contents = this.project?.settings?.backupContents || 'current';
    const projectBytes = byteLength(JSON.stringify(workspaceBackup(this.project, { contents })));
    const multiplier = contents === 'archive' ? 2.5 : contents === 'milestones' ? 1.6 : 1;
    const base64AudioBytes = Math.ceil(audioBytes * 1.37 * multiplier);
    return Math.ceil(projectBytes * multiplier + base64AudioBytes);
  },

  async _dumpDebugSnapshot(reason = 'manual') {
    if (!this.project?.settings?.debugLogging) return;
    try {
      const audioStats = await this.store?.getAudioAssetStats?.(this.project);
      const storage = await navigator.storage?.estimate?.();
      const snippets = this.project?.snippets || [];
      const tracks = this.project?.tracks || [];
      const byType = snippets.reduce((counts, snippet) => {
        counts[snippet.type || 'unknown'] = (counts[snippet.type || 'unknown'] || 0) + 1;
        return counts;
      }, {});
      console.info('[Notenotes Debug]', {
        reason,
        appVersion: APP_VERSION,
        project: {
          id: this.project.id,
          name: this.project.name,
          bpm: this.project.bpm,
          timeSignature: this.project.timeSignature,
          tracks: tracks.length,
          clips: tracks.reduce((total, track) => total + (track.clips?.length || 0), 0),
          snippets: snippets.length,
          snippetsByType: byType,
        },
        audio: {
          snippets: audioStats?.audioSnippetCount || 0,
          assets: audioStats?.audioAssetCount || 0,
          bytes: audioStats?.bytes || 0,
          readableSize: formatBytes(audioStats?.bytes || 0),
          missing: audioStats?.missing || 0,
        },
        browserStorage: storage ? {
          usage: storage.usage || 0,
          quota: storage.quota || 0,
          readableUsage: formatBytes(storage.usage || 0),
          readableQuota: formatBytes(storage.quota || 0),
        } : 'unavailable',
        settings: {
          backupContents: this.project.settings?.backupContents,
          versionHistoryLimit: this.project.settings?.versionHistoryLimit,
          quantize: this.project.settings?.quantize,
        },
      });
    } catch (err) {
      console.warn('[Notenotes Debug] Snapshot failed:', err);
    }
  },

  async _workspaceBackupPayload(contents = 'current') {
    return workspaceBackupPayload(this.store, this.project, contents);
  },

  _folderBackupSupported() {
    return folderBackupSupported();
  },

  async _backupFolderHandle() {
    return getBackupFolderHandle(this.store);
  },

  async _backupFolderPermission(handle, request = false) {
    return backupFolderPermission(handle, request);
  },

  async _refreshBackupFolderStatus() {
    const statusEl = this.el?.querySelector('#backup-folder-status');
    const descEl = this.el?.querySelector('#backup-folder-desc');
    const connectBtn = this.el?.querySelector('#backup-folder-connect');
    const saveBtn = this.el?.querySelector('#backup-folder-save');
    const disconnectBtn = this.el?.querySelector('#backup-folder-disconnect');

    if (!this._folderBackupSupported()) {
      if (statusEl) statusEl.textContent = 'Not supported here';
      if (descEl) descEl.textContent = 'Folder backup needs desktop Chrome or Edge. Use Save Backup on this browser.';
      if (connectBtn) connectBtn.disabled = true;
      if (saveBtn) saveBtn.disabled = true;
      if (disconnectBtn) disconnectBtn.disabled = true;
      return;
    }

    const handle = await this._backupFolderHandle();
    if (!handle) {
      if (statusEl) statusEl.textContent = 'No folder connected';
      if (descEl) descEl.textContent = 'Connect a folder to save workspace backups there without relying on browser storage.';
      if (connectBtn) connectBtn.disabled = false;
      if (saveBtn) saveBtn.disabled = true;
      if (disconnectBtn) disconnectBtn.disabled = true;
      return;
    }

    const permission = await this._backupFolderPermission(handle, false);
    const lastBackupAt = Number(this.project?.settings?.lastWorkspaceBackupAt || 0);
    const lastEditAt = Number(this.project?.settings?.lastEditAt || this.project?.updatedAt || 0);
    const lastText = lastBackupAt ? ` Last backup: ${formatRelativeTime(lastBackupAt)}.` : '';
    const pendingText = lastEditAt > lastBackupAt ? ' Pending edits will auto-save shortly.' : '';
    if (statusEl) statusEl.textContent = permission === 'granted'
      ? `Connected: ${handle.name || 'backup folder'}`
      : `Connected: ${handle.name || 'backup folder'} (needs permission)`;
    if (descEl) descEl.textContent = permission === 'granted'
      ? `Auto folder backups are active. Notenotes writes the current workspace here shortly after edits.${lastText}${pendingText}`
      : 'The folder is still connected, but the browser needs permission again. Use Save To Folder or the top backup shortcut to grant access.';
    if (connectBtn) connectBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
    if (disconnectBtn) disconnectBtn.disabled = false;
  },

  async _saveWorkspaceBackupToFolder() {
    const handle = await this._backupFolderHandle();
    if (!handle) {
      showToast('Connect a backup folder first');
      return false;
    }
    const permission = await this._backupFolderPermission(handle, true);
    if (permission !== 'granted') {
      showToast('Backup folder permission denied');
      await this._refreshBackupFolderStatus();
      return false;
    }
    const contents = this.project?.settings?.backupContents || 'current';
    const result = await saveWorkspaceBackupToFolder({
      store: this.store,
      project: this.project,
      handle,
      contents,
      requestPermission: false,
      saveBefore: true,
      markBackup: true,
    });
    if (!result.saved) return false;
    await this._loadStorageStatus();
    await this._refreshBackupFolderStatus();
    window.dispatchEvent(new CustomEvent('notenotes-backup-status-changed', {
      detail: { projectId: this.project?.id, markEdit: false },
    }));
    return true;
  },

  _bindBackupEvents() {
    const body = this.el.querySelector('#settings-body');
    this._refreshBackupFolderStatus();

    body.querySelector('#backup-contents')?.addEventListener('change', (e) => {
      if (!this.project) return;
      this.project.settings ||= {};
      this.project.settings.backupContents = e.target.value;
      const desc = body.querySelector('#backup-contents-desc');
      if (desc) desc.textContent = this._backupContentsDescription(e.target.value);
      this.store?.scheduleAutoSave(this.project);
      this._loadStorageStatus();
    });

    body.querySelector('#storage-health-check')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      await this._runStorageHealthAudit();
    });

    body.querySelector('#version-history-limit')?.addEventListener('change', async (e) => {
      if (!this.project) return;
      const limit = parseInt(e.target.value, 10);
      if (!VERSION_HISTORY_LIMITS.includes(limit)) return;
      this.project.settings ||= {};
      this.project.settings.versionHistoryLimit = limit;
      await this.store?.save(this.project);
      await this.store?.pruneVersions?.(this.project);
      await this._loadVersionHistory();
      await this._loadStorageStatus();
      showToast(`Keeping up to ${limit} versions`);
    });

    body.querySelector('#version-history-clear')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this.project || !this.store) return;
      if (!confirm('Clear all version history for this workspace?')) return;
      await this.store.clearVersions(this.project.id);
      await this._loadVersionHistory();
      await this._loadStorageStatus();
      showToast('Version history cleared');
    });

    body.querySelector('#backup-workspace-save')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this.project) return;
      await this.store?.save(this.project);
      try {
        const contents = this.project?.settings?.backupContents || 'current';
        const backup = await this._workspaceBackupPayload(contents);
        const suffix = contents === 'archive' ? 'archive' : contents === 'milestones' ? 'workspace-milestones' : 'workspace';
        await saveJsonFile(backup, backupFilename(this.project, suffix));
        this.project.settings ||= {};
        this.project.settings.lastWorkspaceBackupAt = Date.now();
        await this.store?.save(this.project, { markEdit: false });
        await this._loadStorageStatus();
        window.dispatchEvent(new CustomEvent('notenotes-backup-status-changed', {
          detail: { projectId: this.project?.id, markEdit: false },
        }));
        showToast('Workspace backup saved');
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('[Settings] Workspace backup failed:', err);
          showToast('Workspace backup failed');
        }
      }
    });

    body.querySelector('#backup-folder-connect')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this._folderBackupSupported()) {
        showToast('Folder backup needs desktop Chrome or Edge');
        return;
      }
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const permission = await this._backupFolderPermission(handle, true);
        if (permission !== 'granted') {
          showToast('Backup folder permission denied');
          return;
        }
        await this.store?.setLocalSetting(LOCAL_BACKUP_FOLDER_KEY, handle);
        await this._refreshBackupFolderStatus();
        window.dispatchEvent(new CustomEvent('notenotes-backup-status-changed', {
          detail: { projectId: this.project?.id, markEdit: false },
        }));
        showToast('Backup folder connected');
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('[Settings] Backup folder connect failed:', err);
          showToast('Could not connect backup folder');
        }
      }
    });

    body.querySelector('#backup-folder-save')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this.project) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const saved = await this._saveWorkspaceBackupToFolder();
        if (saved) showToast('Workspace backup saved to folder');
      } catch (err) {
        console.error('[Settings] Folder workspace backup failed:', err);
        showToast('Folder backup failed');
      } finally {
        btn.disabled = false;
        await this._refreshBackupFolderStatus();
      }
    });

    body.querySelector('#backup-folder-disconnect')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!confirm('Disconnect backup folder? Existing backup files will stay in the folder.')) return;
      await this.store?.deleteLocalSetting(LOCAL_BACKUP_FOLDER_KEY);
      await this._refreshBackupFolderStatus();
      window.dispatchEvent(new CustomEvent('notenotes-backup-status-changed', {
        detail: { projectId: this.project?.id, markEdit: false },
      }));
      showToast('Backup folder disconnected');
    });

    body.querySelector('#backup-snippets-save')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this.project) return;
      await this.store?.save(this.project);
      try {
        const portableProject = await this.store.embedAudioForBackup(this.project);
        await saveJsonFile(snippetsBackup(portableProject), backupFilename(this.project, 'snippets'));
        showToast('Snippet backup saved');
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('[Settings] Snippet backup failed:', err);
          showToast('Snippet backup failed');
        }
      }
    });

    const importInput = body.querySelector('#backup-import-file');
    body.querySelector('#backup-import-btn')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      importInput?.click();
    });

    importInput?.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (!file || !this.store) return;

      try {
        const backup = await readJsonFile(file);
        const type = validateBackup(backup);

        if (type === 'workspace') {
          await this.store.replaceProjectArchive(backup.project, {
            milestones: backup.milestones,
            versions: backup.versions,
          });
          showToast('Workspace restored. Reloading...');
          setTimeout(() => window.location.reload(), 500);
          return;
        }

        if (!this.project) return;
        this.project.snippets = [
          ...(this.project.snippets || []),
          ...snippetsWithFreshIds(backup.snippets),
        ];
        if (Array.isArray(backup.customInstruments) && backup.customInstruments.length) {
          this.project.settings ||= {};
          this.project.settings.customInstruments = [
            ...(this.project.settings.customInstruments || []),
            ...customInstrumentsWithFreshIds(backup.customInstruments),
          ];
          await this.store.migrateCustomInstrumentAudioAssets(this.project.settings.customInstruments);
        }
        await this.store.migrateSnippetsAudioAssets(this.project.snippets);
        await this.store.save(this.project);
        showToast(`Imported ${backup.snippets.length} snippets. Reloading...`);
        setTimeout(() => window.location.reload(), 500);
      } catch (err) {
        console.error('[Settings] Backup import failed:', err);
        showToast(err?.message || 'Backup import failed');
      }
    });
  },

  _bindMilestoneEvents() {
    const body = this.el.querySelector('#settings-body');
    body.querySelector('#milestone-save')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this.project || !this.store) return;
      const input = body.querySelector('#milestone-name');
      const label = input?.value || '';
      await this.store.save(this.project);
      await this.store.saveMilestone(this.project, label);
      if (input) input.value = '';
      await this._loadMilestones();
      showToast('Milestone saved');
    });

    body.querySelector('#milestone-clear')?.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this.project || !this.store) return;
      if (!confirm('Clear all milestones for this workspace?')) return;
      await this.store.clearMilestones(this.project.id);
      await this._loadMilestones();
      await this._loadStorageStatus();
      showToast('Milestones cleared');
    });
  },

  async _loadMilestones() {
    if (!this.project || !this.store) return;
    const listEl = this.el.querySelector('#milestone-list');
    if (!listEl) return;

    try {
      const milestones = await this.store.getMilestones(this.project.id);
      if (milestones.length === 0) {
        listEl.innerHTML = '<div class="version-list__empty">No milestones yet</div>';
        return;
      }

      listEl.innerHTML = milestones.map(m => {
        const date = new Date(m.timestamp);
        return `
          <div class="version-list__item" data-milestone-id="${m.milestoneId}">
            <div class="version-list__info">
              <span class="version-list__time">${m.label}</span>
              <span class="version-list__meta">${date.toLocaleString()} - ${m.bpm} BPM</span>
            </div>
            <div class="version-list__actions">
              <button class="btn btn--ghost milestone-list__restore" data-milestone-id="${m.milestoneId}">Load</button>
              <button class="btn btn--ghost milestone-list__delete" data-milestone-id="${m.milestoneId}">Delete</button>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.milestone-list__restore').forEach(btn => {
        btn.addEventListener('pointerdown', async (e) => {
          e.preventDefault();
          const id = parseInt(btn.dataset.milestoneId, 10);
          if (confirm('Load this milestone? Current changes will be saved first.')) {
            await this.store.save(this.project);
            await this.store.restoreMilestone(id);
            showToast('Milestone loaded. Reloading...');
            setTimeout(() => window.location.reload(), 500);
          }
        });
      });

      listEl.querySelectorAll('.milestone-list__delete').forEach(btn => {
        btn.addEventListener('pointerdown', async (e) => {
          e.preventDefault();
          const id = parseInt(btn.dataset.milestoneId, 10);
          if (!Number.isFinite(id) || !confirm('Delete this milestone?')) return;
          await this.store.deleteMilestone(id);
          await this._loadMilestones();
          await this._loadStorageStatus();
          showToast('Milestone deleted');
        });
      });
    } catch (err) {
      listEl.innerHTML = '<div class="version-list__empty">Error loading milestones</div>';
      console.error('[Settings] Milestone error:', err);
    }
  },
};
