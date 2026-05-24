import { backupFilename, saveJsonToDirectory, workspaceBackup } from '../export/BackupExporter.js';

export const LOCAL_BACKUP_FOLDER_KEY = 'workspaceBackupDirectoryHandle';
export const AUTO_FOLDER_BACKUP_DELAY_MS = 10 * 1000;
export const AUTO_FOLDER_BACKUP_MIN_INTERVAL_MS = 60 * 1000;

export function folderBackupSupported() {
  return typeof window !== 'undefined' && !!window.showDirectoryPicker;
}

export async function getBackupFolderHandle(store) {
  if (!folderBackupSupported()) return null;
  try {
    return await store?.getLocalSetting(LOCAL_BACKUP_FOLDER_KEY);
  } catch (err) {
    console.warn('[FolderBackup] Could not read backup folder handle:', err);
    return null;
  }
}

export async function backupFolderPermission(handle, request = false) {
  if (!handle) return 'denied';
  const options = { mode: 'readwrite' };
  if (handle.queryPermission) {
    const queried = await handle.queryPermission(options);
    if (queried === 'granted' || !request) return queried;
  }
  if (request && handle.requestPermission) return handle.requestPermission(options);
  return 'prompt';
}

export async function workspaceBackupPayload(store, project, contents = 'current') {
  const portableProject = await store.embedAudioForBackup(project);
  const options = { contents };
  if (contents === 'milestones' || contents === 'archive') {
    const milestones = await store.getMilestoneSnapshots(project.id);
    options.milestones = await Promise.all(milestones.map(async snapshot => ({
      ...snapshot,
      data: await store.embedAudioForBackup(snapshot.data),
    })));
  }
  if (contents === 'archive') {
    const versions = await store.getVersionSnapshots(project.id);
    options.versions = await Promise.all(versions.map(async snapshot => ({
      ...snapshot,
      data: await store.embedAudioForBackup(snapshot.data),
    })));
  }
  return workspaceBackup(portableProject, options);
}

export async function saveWorkspaceBackupToFolder({
  store,
  project,
  handle,
  contents = 'current',
  requestPermission = false,
  saveBefore = false,
  markBackup = true,
} = {}) {
  if (!project || !store) return { saved: false, reason: 'missing-project' };
  if (!handle) return { saved: false, reason: 'missing-folder' };

  const permission = await backupFolderPermission(handle, requestPermission);
  if (permission !== 'granted') return { saved: false, reason: 'permission', permission };

  if (saveBefore) await store.save(project);
  const backup = await workspaceBackupPayload(store, project, contents);
  const suffix = contents === 'archive' ? 'archive' : contents === 'milestones' ? 'workspace-milestones' : 'workspace';
  await saveJsonToDirectory(backup, backupFilename(project, suffix), handle);

  if (markBackup) {
    project.settings ||= {};
    project.settings.lastWorkspaceBackupAt = Date.now();
    await store.save(project, { markEdit: false });
  }

  return { saved: true };
}
