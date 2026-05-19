/**
 * ProjectStore — IndexedDB persistence layer for Notenotes projects.
 * Handles CRUD, auto-save, and version history.
 */

import { openDB } from 'idb';

const DB_NAME = 'notenotes';
const DB_VERSION = 3;

const STORE_PROJECTS = 'projects';
const STORE_VERSIONS = 'versions';
const STORE_MILESTONES = 'milestones';
const STORE_AUDIO_ASSETS = 'audioAssets';

export const VERSION_HISTORY_LIMITS = [5, 10, 25, 50];
export const DEFAULT_VERSION_HISTORY_LIMIT = 5;

function versionHistoryLimit(project) {
  const requested = Number(project?.settings?.versionHistoryLimit);
  return VERSION_HISTORY_LIMITS.includes(requested) ? requested : DEFAULT_VERSION_HISTORY_LIMIT;
}

/**
 * Create a new empty project with default values.
 * @param {string} [name]
 * @returns {object}
 */
export function createProject(name = 'Untitled Sketch') {
  return {
    id: crypto.randomUUID(),
    name,
    bpm: 120,
    timeSignature: { beats: 4, subdivision: 4 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tracks: [],
    snippets: [],
    settings: {
      quantize: 0,          // QuantizeGrid.OFF
      metronomeOn: false,
      metronomeVolume: 0.5,
      loopBars: 4,
      masterVolume: 0.8,
      pianoCount: 1,
      pianoKeys: 12,
      drumPads: 10,
      arpRate: '1/8',
      arpChordType: 'major',
      arpPattern: 'up',
      holdDuration: 3000,
      soundTraits: {},
      tonePresets: [],
      customInstruments: [],
      controllerToneAssignments: {
        leftTrigger: 'none',
        rightTrigger: 'none'
      },
      versionHistoryLimit: DEFAULT_VERSION_HISTORY_LIMIT,
      backupContents: 'current',
      debugLogging: false,
      canvasLoopEnabled: false,
      voicePhrase: '',
      voiceId: 'english-base',
      aiSettings: {
        // Default to Mock so users can try the AI Seed panel without keys.
        // API keys live ONLY in memory for the current session and are
        // never written to disk. Backups exclude credentials by construction.
        disclaimerAccepted: false,
        provider: 'mock',
        model: 'mock-canned-v1',
        ollamaBaseUrl: 'http://localhost:11434/v1',
        defaultLengthBars: 4,
      },
    }
  };
}

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Projects store
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      // Version history store (keyed by auto-generated id)
      if (!db.objectStoreNames.contains(STORE_VERSIONS)) {
        const versionStore = db.createObjectStore(STORE_VERSIONS, {
          keyPath: 'versionId',
          autoIncrement: true
        });
        versionStore.createIndex('projectId', 'projectId', { unique: false });
        versionStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MILESTONES)) {
        const milestoneStore = db.createObjectStore(STORE_MILESTONES, {
          keyPath: 'milestoneId',
          autoIncrement: true
        });
        milestoneStore.createIndex('projectId', 'projectId', { unique: false });
        milestoneStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO_ASSETS)) {
        db.createObjectStore(STORE_AUDIO_ASSETS, { keyPath: 'audioAssetId' });
      }
    }
  });
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isBlobUrl(value) {
  return typeof value === 'string' && value.startsWith('blob:');
}

function isDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Audio backup encoding failed'));
    reader.readAsDataURL(blob);
  });
}

function walkSnippets(projectOrSnippets) {
  if (Array.isArray(projectOrSnippets)) return projectOrSnippets;
  const snippets = [...(projectOrSnippets?.snippets || [])];
  for (const track of projectOrSnippets?.tracks || []) {
    for (const clip of track.clips || []) {
      if (clip.snippet) snippets.push(clip.snippet);
    }
  }
  return snippets;
}

function walkCustomInstruments(projectOrSettings) {
  if (Array.isArray(projectOrSettings)) return projectOrSettings;
  return projectOrSettings?.settings?.customInstruments || projectOrSettings?.customInstruments || [];
}

export class ProjectStore {
  constructor() {
    this._db = null;
    this._autoSaveTimer = null;
    this._autoSaveDelay = 2000; // 2 second debounce
    this._pendingSave = null;
    this._audioObjectUrls = new Map();
  }

  /**
   * Initialize the store (opens DB connection).
   */
  async init() {
    this._db = await getDB();
  }

  async saveAudioAsset(blob, meta = {}) {
    if (!blob) return null;
    const audioAssetId = meta.audioAssetId || crypto.randomUUID();
    const arrayBuffer = await blob.arrayBuffer();
    const record = {
      audioAssetId,
      arrayBuffer,
      mimeType: meta.mimeType || blob.type || 'audio/webm',
      size: meta.size || blob.size || arrayBuffer.byteLength || 0,
      createdAt: meta.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    await this._db.put(STORE_AUDIO_ASSETS, record);
    return record;
  }

  async getAudioAsset(audioAssetId) {
    if (!audioAssetId) return null;
    return this._db.get(STORE_AUDIO_ASSETS, audioAssetId);
  }

  async getAudioAssetBlob(audioAssetId) {
    const record = await this.getAudioAsset(audioAssetId);
    if (record?.blob) return record.blob;
    if (record?.arrayBuffer) {
      return new Blob([record.arrayBuffer], { type: record.mimeType || 'audio/webm' });
    }
    return null;
  }

  async getAudioAssetObjectUrl(audioAssetId) {
    if (!audioAssetId) return '';
    if (this._audioObjectUrls.has(audioAssetId)) return this._audioObjectUrls.get(audioAssetId);
    const blob = await this.getAudioAssetBlob(audioAssetId);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    this._audioObjectUrls.set(audioAssetId, url);
    return url;
  }

  async audioSnippetToArrayBuffer(snippet) {
    if (snippet?.audioAssetId) {
      const blob = await this.getAudioAssetBlob(snippet.audioAssetId);
      return blob ? blob.arrayBuffer() : null;
    }

    const source = snippet?.audioDataUrl || snippet?.audioUrl || '';
    if (!source || isBlobUrl(source)) return null;
    const response = await fetch(source);
    return response.arrayBuffer();
  }

  async embedAudioForBackup(value) {
    const backup = clone(value);
    const snippets = walkSnippets(backup);
    for (const snippet of snippets) {
      if (snippet?.type !== 'audio' || snippet.audioDataUrl || !snippet.audioAssetId) continue;
      const record = await this.getAudioAsset(snippet.audioAssetId);
      const blob = await this.getAudioAssetBlob(snippet.audioAssetId);
      if (!record || !blob) {
        snippet.audioUnavailable = true;
        snippet.audioUnavailableReason = 'Audio asset missing from browser storage';
        continue;
      }
      snippet.audioDataUrl = await blobToDataUrl(blob);
      snippet.audioMimeType = record.mimeType || snippet.audioMimeType;
      snippet.audioSize = record.size || snippet.audioSize;
    }
    for (const instrument of walkCustomInstruments(backup)) {
      if (!instrument?.audioAssetId || instrument.audioDataUrl) continue;
      const record = await this.getAudioAsset(instrument.audioAssetId);
      const blob = await this.getAudioAssetBlob(instrument.audioAssetId);
      if (!record || !blob) {
        instrument.audioUnavailable = true;
        instrument.audioUnavailableReason = 'Instrument sample asset missing from browser storage';
        continue;
      }
      instrument.audioDataUrl = await blobToDataUrl(blob);
      instrument.audioMimeType = record.mimeType || instrument.audioMimeType;
      instrument.audioSize = record.size || instrument.audioSize;
    }
    return backup;
  }

  _sanitizeProjectForStorage(project) {
    const safe = clone(project);
    for (const snippet of walkSnippets(safe)) {
      if (snippet.type !== 'audio') continue;
      delete snippet.audioDataUrl;
      if (isBlobUrl(snippet.audioUrl)) delete snippet.audioUrl;
    }
    for (const instrument of walkCustomInstruments(safe)) {
      delete instrument.audioDataUrl;
    }
    return safe;
  }

  async migrateSnippetsAudioAssets(snippets = []) {
    let changed = false;
    for (const snippet of snippets) {
      if (snippet?.type !== 'audio') continue;

      if (isDataUrl(snippet.audioDataUrl)) {
        const blob = await dataUrlToBlob(snippet.audioDataUrl);
        const record = await this.saveAudioAsset(blob, {
          mimeType: snippet.audioMimeType || blob.type,
          size: snippet.audioSize || blob.size,
          createdAt: snippet.createdAt,
        });
        snippet.audioAssetId = record.audioAssetId;
        snippet.audioMimeType = record.mimeType;
        snippet.audioSize = record.size;
        changed = true;
      }

      if (!snippet.audioAssetId && isBlobUrl(snippet.audioUrl)) {
        snippet.audioUnavailable = true;
        snippet.audioUnavailableReason = 'This recording used a temporary browser URL and cannot be restored after reload.';
        delete snippet.audioUrl;
        changed = true;
      }

      if (snippet.audioDataUrl) {
        delete snippet.audioDataUrl;
        changed = true;
      }
    }
    return changed;
  }

  async migrateCustomInstrumentAudioAssets(instruments = []) {
    let changed = false;
    for (const instrument of instruments) {
      if (!instrument) continue;
      if (isDataUrl(instrument.audioDataUrl)) {
        const blob = await dataUrlToBlob(instrument.audioDataUrl);
        const record = await this.saveAudioAsset(blob, {
          mimeType: instrument.audioMimeType || blob.type,
          size: instrument.audioSize || blob.size,
          createdAt: instrument.createdAt,
        });
        instrument.audioAssetId = record.audioAssetId;
        instrument.audioMimeType = record.mimeType;
        instrument.audioSize = record.size;
        changed = true;
      }
      if (instrument.audioDataUrl) {
        delete instrument.audioDataUrl;
        changed = true;
      }
    }
    return changed;
  }

  async migrateProjectAudioAssets(project) {
    if (!project) return false;
    const snippetChanged = await this.migrateSnippetsAudioAssets(walkSnippets(project));
    const instrumentChanged = await this.migrateCustomInstrumentAudioAssets(walkCustomInstruments(project));
    return snippetChanged || instrumentChanged;
  }

  /**
   * Save a project to IndexedDB.
   * @param {object} project
   */
  async save(project) {
    project.updatedAt = Date.now();
    await this.migrateProjectAudioAssets(project);
    await this._db.put(STORE_PROJECTS, this._sanitizeProjectForStorage(project));
  }

  /**
   * Load a project by ID.
   * @param {string} id
   * @returns {Promise<object|undefined>}
   */
  async load(id) {
    const project = await this._db.get(STORE_PROJECTS, id);
    if (project && await this.migrateProjectAudioAssets(project)) {
      await this.save(project);
    }
    return project;
  }

  /**
   * List all projects (summary: id, name, updatedAt).
   * @returns {Promise<object[]>}
   */
  async listAll() {
    const all = await this._db.getAll(STORE_PROJECTS);
    return all
      .map(p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, bpm: p.bpm }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Delete a project and its version history.
   * @param {string} id
   */
  async delete(id) {
    await this._db.delete(STORE_PROJECTS, id);
    // Delete associated versions
    const tx = this._db.transaction(STORE_VERSIONS, 'readwrite');
    const index = tx.store.index('projectId');
    let cursor = await index.openCursor(id);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;

    const milestoneTx = this._db.transaction(STORE_MILESTONES, 'readwrite');
    const milestoneIndex = milestoneTx.store.index('projectId');
    let milestoneCursor = await milestoneIndex.openCursor(id);
    while (milestoneCursor) {
      await milestoneCursor.delete();
      milestoneCursor = await milestoneCursor.continue();
    }
    await milestoneTx.done;
    await this.garbageCollectAudioAssets();
  }

  async saveMilestone(project, name = '') {
    await this.migrateProjectAudioAssets(project);
    const snapshot = {
      projectId: project.id,
      timestamp: Date.now(),
      label: name.trim() || `Milestone ${new Date().toLocaleString()}`,
      data: this._sanitizeProjectForStorage(project)
    };
    return this._db.add(STORE_MILESTONES, snapshot);
  }

  async getMilestones(projectId) {
    const tx = this._db.transaction(STORE_MILESTONES, 'readonly');
    const index = tx.store.index('projectId');
    const milestones = await index.getAll(projectId);
    return milestones
      .map(m => ({
        milestoneId: m.milestoneId,
        timestamp: m.timestamp,
        label: m.label,
        name: m.data.name,
        bpm: m.data.bpm,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async getMilestoneSnapshots(projectId) {
    const tx = this._db.transaction(STORE_MILESTONES, 'readonly');
    const index = tx.store.index('projectId');
    const milestones = await index.getAll(projectId);
    return milestones
      .map(m => clone(m))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async restoreMilestone(milestoneId) {
    const milestone = await this._db.get(STORE_MILESTONES, milestoneId);
    if (!milestone) throw new Error(`Milestone ${milestoneId} not found`);
    const project = milestone.data;
    project.updatedAt = Date.now();
    await this.save(project);
    return project;
  }

  /**
   * Save a version snapshot. Keeps the configured number of versions per project.
   * @param {object} project
   */
  async saveVersion(project) {
    await this.migrateProjectAudioAssets(project);
    const snapshot = {
      projectId: project.id,
      timestamp: Date.now(),
      data: this._sanitizeProjectForStorage(project)
    };
    await this._db.add(STORE_VERSIONS, snapshot);

    await this.pruneVersions(project);
  }

  async pruneVersions(project) {
    const maxVersions = versionHistoryLimit(project);
    const tx = this._db.transaction(STORE_VERSIONS, 'readwrite');
    const index = tx.store.index('projectId');
    const versions = await index.getAll(project.id);
    if (versions.length > maxVersions) {
      versions.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = versions.slice(0, versions.length - maxVersions);
      for (const v of toDelete) {
        await tx.store.delete(v.versionId);
      }
    }
    await tx.done;
  }

  /**
   * Get version history for a project.
   * @param {string} projectId
   * @returns {Promise<object[]>} Sorted newest first
   */
  async getVersions(projectId) {
    const tx = this._db.transaction(STORE_VERSIONS, 'readonly');
    const index = tx.store.index('projectId');
    const versions = await index.getAll(projectId);
    return versions
      .map(v => ({
        versionId: v.versionId,
        timestamp: v.timestamp,
        name: v.data.name,
        bpm: v.data.bpm
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async getVersionSnapshots(projectId) {
    const tx = this._db.transaction(STORE_VERSIONS, 'readonly');
    const index = tx.store.index('projectId');
    const versions = await index.getAll(projectId);
    return versions
      .map(v => clone(v))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async replaceProjectArchive(project, archive = {}) {
    await this.migrateProjectAudioAssets(project);
    await this.save(project);

    await this._replaceSnapshots(STORE_MILESTONES, project.id, Array.isArray(archive.milestones) ? archive.milestones : [], 'milestoneId');
    await this._replaceSnapshots(STORE_VERSIONS, project.id, Array.isArray(archive.versions) ? archive.versions : [], 'versionId');
    await this.garbageCollectAudioAssets();
  }

  async _replaceSnapshots(storeName, projectId, snapshots, keyName) {
    const prepared = [];
    for (const snapshot of snapshots) {
      const clean = clone(snapshot);
      delete clean[keyName];
      clean.projectId = projectId;
      if (clean.data) {
        clean.data.id = projectId;
        await this.migrateProjectAudioAssets(clean.data);
        clean.data = this._sanitizeProjectForStorage(clean.data);
      }
      prepared.push(clean);
    }

    const tx = this._db.transaction(storeName, 'readwrite');
    const index = tx.store.index('projectId');
    let cursor = await index.openCursor(projectId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }

    for (const clean of prepared) {
      await tx.store.add(clean);
    }
    await tx.done;
  }

  async _clearSnapshots(storeName, projectId) {
    const tx = this._db.transaction(storeName, 'readwrite');
    const index = tx.store.index('projectId');
    let cursor = await index.openCursor(projectId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  async deleteVersion(versionId) {
    await this._db.delete(STORE_VERSIONS, versionId);
    await this.garbageCollectAudioAssets();
  }

  async clearVersions(projectId) {
    await this._clearSnapshots(STORE_VERSIONS, projectId);
    await this.garbageCollectAudioAssets();
  }

  async deleteMilestone(milestoneId) {
    await this._db.delete(STORE_MILESTONES, milestoneId);
    await this.garbageCollectAudioAssets();
  }

  async clearMilestones(projectId) {
    await this._clearSnapshots(STORE_MILESTONES, projectId);
    await this.garbageCollectAudioAssets();
  }

  /**
   * Restore a project from a version snapshot.
   * @param {number} versionId
   * @returns {Promise<object>} The restored project data
   */
  async restoreVersion(versionId) {
    const version = await this._db.get(STORE_VERSIONS, versionId);
    if (!version) throw new Error(`Version ${versionId} not found`);
    // Save the restored data as the current project
    const project = version.data;
    project.updatedAt = Date.now();
    await this.save(project);
    return project;
  }

  /**
   * Schedule a debounced auto-save. Saves a version snapshot too.
   * @param {object} project
   */
  scheduleAutoSave(project) {
    if (this._autoSaveTimer) {
      clearTimeout(this._autoSaveTimer);
    }
    this._autoSaveTimer = setTimeout(async () => {
      await this.save(project);
      await this.saveVersion(project);
      console.log('[ProjectStore] Auto-saved:', project.name);
    }, this._autoSaveDelay);
  }

  _collectAudioAssetIdsFromValue(value, ids = new Set()) {
    for (const snippet of walkSnippets(value)) {
      if (snippet?.audioAssetId) ids.add(snippet.audioAssetId);
    }
    for (const instrument of value?.settings?.customInstruments || []) {
      if (instrument?.audioAssetId) ids.add(instrument.audioAssetId);
    }
    return ids;
  }

  async getAudioAssetStats(value) {
    const snippets = walkSnippets(value).filter(snippet => snippet?.type === 'audio');
    const ids = this._collectAudioAssetIdsFromValue(value);
    let bytes = 0;
    let missing = 0;

    for (const audioAssetId of ids) {
      const record = await this.getAudioAsset(audioAssetId);
      if (!record) {
        missing++;
        continue;
      }
      bytes += record.size || record.blob?.size || record.arrayBuffer?.byteLength || 0;
    }

    for (const snippet of snippets) {
      if (!snippet.audioAssetId && snippet.audioSize) {
        bytes += snippet.audioSize;
      }
      if (snippet.audioUnavailable) {
        missing++;
      }
    }

    return {
      audioSnippetCount: snippets.length,
      audioAssetCount: ids.size,
      bytes,
      missing,
    };
  }

  async garbageCollectAudioAssets() {
    const used = new Set();
    const projects = await this._db.getAll(STORE_PROJECTS);
    projects.forEach(project => this._collectAudioAssetIdsFromValue(project, used));

    const versions = await this._db.getAll(STORE_VERSIONS);
    versions.forEach(version => this._collectAudioAssetIdsFromValue(version.data, used));

    const milestones = await this._db.getAll(STORE_MILESTONES);
    milestones.forEach(milestone => this._collectAudioAssetIdsFromValue(milestone.data, used));

    const tx = this._db.transaction(STORE_AUDIO_ASSETS, 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      if (!used.has(cursor.value.audioAssetId)) {
        const url = this._audioObjectUrls.get(cursor.value.audioAssetId);
        if (url) URL.revokeObjectURL(url);
        this._audioObjectUrls.delete(cursor.value.audioAssetId);
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  }
}
