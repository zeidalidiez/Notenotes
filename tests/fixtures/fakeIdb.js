/**
 * Hand-rolled in-memory stand-in for the `idb` package's `openDB`.
 *
 * Implements exactly the surface ProjectStore.js drives (discovered by grepping
 * src/data/ProjectStore.js): keyPath stores, autoIncrement keys, single-field
 * indexes, db-level get/put/add/getAll/delete, transactions with `store`/`done`,
 * index.getAll(key), index.openCursor(key), store.openCursor(), and cursors with
 * value/delete()/continue(). No real async IndexedDB, no dependency.
 *
 * The store registered by the global setup (see setup.js) maps `import 'idb'`
 * to this module, so source code that `import { openDB } from 'idb'` runs
 * unmodified against an in-memory database.
 */

function getByKeyPath(value, keyPath) {
  return keyPath ? value?.[keyPath] : undefined;
}

class FakeIndex {
  /**
   * @param {FakeObjectStore} store
   * @param {string} keyPath
   */
  constructor(store, keyPath) {
    this.store = store;
    this.keyPath = keyPath;
  }

  _matching(key) {
    const out = [];
    for (const value of this.store._data.values()) {
      if (getByKeyPath(value, this.keyPath) === key) out.push(value);
    }
    return out;
  }

  async getAll(key) {
    if (key === undefined) return [...this.store._data.values()];
    return this._matching(key);
  }

  async openCursor(key) {
    const matches = this._matching(key);
    return makeCursor(this.store, matches);
  }
}

class FakeObjectStore {
  /**
   * @param {string} name
   * @param {{keyPath?: string|null, autoIncrement?: boolean}} [opts]
   */
  constructor(name, opts = {}) {
    this.name = name;
    this.keyPath = opts.keyPath ?? null;
    this.autoIncrement = !!opts.autoIncrement;
    /** @type {Map<any, any>} */
    this._data = new Map();
    /** @type {Map<string, FakeIndex>} */
    this._indexes = new Map();
    this._autoKey = 0;
  }

  createIndex(name, keyPath) {
    this._indexes.set(name, new FakeIndex(this, keyPath));
  }

  index(name) {
    const idx = this._indexes.get(name);
    if (!idx) throw new Error(`No index named "${name}" on store "${this.name}"`);
    return idx;
  }

  _resolveKey(value, explicitKey) {
    if (explicitKey !== undefined) return explicitKey;
    if (this.keyPath) {
      let key = getByKeyPath(value, this.keyPath);
      if (key === undefined && this.autoIncrement) {
        key = ++this._autoKey;
        value[this.keyPath] = key;
      }
      return key;
    }
    if (this.autoIncrement) return ++this._autoKey;
    return undefined;
  }

  async put(value, key) {
    const k = this._resolveKey(value, key);
    this._data.set(k, value);
    return k;
  }

  async add(value, key) {
    const k = this._resolveKey(value, key);
    if (this._data.has(k)) throw new Error(`Key ${String(k)} already exists in "${this.name}"`);
    this._data.set(k, value);
    return k;
  }

  async get(key) { return this._data.get(key); }
  async getAll() { return [...this._data.values()]; }
  async delete(key) { this._data.delete(key); }
  async clear() { this._data.clear(); }
  async count() { return this._data.size; }

  async openCursor() {
    return makeCursor(this, [...this._data.values()]);
  }
}

function makeCursor(store, values) {
  let i = 0;
  function at(idx) {
    if (idx >= values.length) return null;
    const value = values[idx];
    let key;
    for (const [k, v] of store._data.entries()) {
      if (v === value) { key = k; break; }
    }
    return {
      value,
      key,
      async delete() { store._data.delete(key); },
      async continue() { return at(++i); },
      async update(next) { store._data.set(key, next); },
    };
  }
  return at(i);
}

class FakeTransaction {
  constructor(db, storeNames, mode) {
    this.db = db;
    this.mode = mode;
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    this._stores = names.map(n => db._stores.get(n));
    this.done = Promise.resolve();
  }
  get store() { return this._stores[0]; }
  objectStore(name) { return this.db._stores.get(name); }
}

class FakeDB {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    /** @type {Map<string, FakeObjectStore>} */
    this._stores = new Map();
    this.objectStoreNames = {
      contains: (n) => this._stores.has(n),
    };
  }

  createObjectStore(name, opts) {
    const store = new FakeObjectStore(name, opts);
    this._stores.set(name, store);
    return store;
  }

  transaction(storeNames, mode = 'readonly') {
    return new FakeTransaction(this, storeNames, mode);
  }

  // db-level convenience methods (idb sugar)
  async get(storeName, key) { return this._stores.get(storeName).get(key); }
  async getAll(storeName) { return this._stores.get(storeName).getAll(); }
  async put(storeName, value, key) { return this._stores.get(storeName).put(value, key); }
  async add(storeName, value, key) { return this._stores.get(storeName).add(value, key); }
  async delete(storeName, key) { return this._stores.get(storeName).delete(key); }
  async clear(storeName) { return this._stores.get(storeName).clear(); }
  async count(storeName) { return this._stores.get(storeName).count(); }

  close() {}
}

/**
 * @param {string} name
 * @param {number} version
 * @param {{upgrade?: (db: FakeDB) => void}} [opts]
 * @returns {Promise<FakeDB>}
 */
export async function openDB(name, version, opts = {}) {
  const db = new FakeDB(name, version);
  if (typeof opts.upgrade === 'function') opts.upgrade(db);
  return db;
}

export function deleteDB() { return Promise.resolve(); }
