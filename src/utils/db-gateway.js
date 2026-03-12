/**
 * src/utils/db-gateway.js
 * IndexedDB 唯一单例接驳 + 全量 Schema 定义
 *
 * Schema 版本历史：
 *   v1  初始建表（files keyPath='name', covers keyPath='id'）
 *   v2  无 Schema 变更
 *   v3  新增 locations store（keyPath='id'）
 *   v4  [v1.6.0 破坏性变更]
 *         files:     主键从 'name'(filename) 改为 'bookId'，新增 by_filename 索引
 *         covers:    主键字段名从 'id' 统一为 'bookId'
 *         locations: 主键字段名从 'id' 统一为 'bookId'
 *       三表旧数据全部删除重建，无迁移。用户需重新导入书籍。
 *
 * D-1-E: put() / delete() 等待 tx.oncomplete，确保落盘后再 resolve。
 */
const DbGateway = {
  DB_NAME:      'EpubReaderDB',
  DB_VERSION:   4,
  _dbPromise:   null,
  _retryCount:  0,       // C-1: consecutive connection failure counter
  _retryLimit:  3,       // refuse to reconnect after this many successive failures

  async connect() {
    // C-1: refuse to hammer IDB after repeated failures (e.g. disk full, incognito limits)
    if (this._retryCount >= this._retryLimit) {
      throw new Error(`[DbGateway] IDB connection failed ${this._retryLimit} times consecutively. Refusing further retries.`);
    }
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db         = e.target.result;
        const oldVersion = e.oldVersion; // 0 = brand-new install

        // v4: all three stores are rebuilt. Data is dropped (breaking change).
        if (oldVersion < 4) {
          if (db.objectStoreNames.contains('files'))     db.deleteObjectStore('files');
          if (db.objectStoreNames.contains('covers'))    db.deleteObjectStore('covers');
          if (db.objectStoreNames.contains('locations')) db.deleteObjectStore('locations');
        }

        if (!db.objectStoreNames.contains('files')) {
          const s = db.createObjectStore('files', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('covers'))
          db.createObjectStore('covers',    { keyPath: 'bookId' });
        if (!db.objectStoreNames.contains('locations'))
          db.createObjectStore('locations', { keyPath: 'bookId' });
      };

      request.onsuccess = (e) => {
        this._retryCount = 0; // reset on success
        resolve(e.target.result);
      };
      request.onerror   = (e) => {
        this._dbPromise = null;
        this._retryCount++;
        // Exponential backoff: auto-reset counter after a cooling period
        // so transient failures don't permanently block future attempts.
        const cooldown = Math.min(500 * Math.pow(2, this._retryCount), 8000);
        setTimeout(() => {
          if (this._retryCount > 0) this._retryCount--;
        }, cooldown);
        reject(e.target.error);
      };
    });
    return this._dbPromise;
  },

  async get(storeName, key) {
    const db = await this.connect();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) {
        console.warn(`[DbGateway] Store "${storeName}" not found.`);
        return resolve(null);
      }
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => reject(req.error);
    });
  },

    async put(storeName, data) {
    const db = await this.connect();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) {
        console.warn(`[DbGateway] Store "${storeName}" not found, skipping put.`);
        return resolve();
      }
      const tx    = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req   = store.put(data);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
      req.onerror   = () => reject(req.error);
    });
  },

  async delete(storeName, key) {
    const db = await this.connect();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) return resolve();
      const tx    = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req   = store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
      req.onerror   = () => reject(req.error);
    });
  },

  async getAll(storeName) {
    const db = await this.connect();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) return resolve([]);
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },

  /**
   * Cursor-based metadata scan — reads only the listed fields, never loads
   * binary 'data' blobs. Solves P1-LRU-1 where enforceFileLRU was loading
   * full EPUB binaries (~50 MB peak) just to sort by timestamp.
   *
   * @param {string}   storeName
   * @param {string[]} fields      field names to include (keyPath always included)
   * @returns {Promise<object[]>}
   */
  async getAllMeta(storeName, fields) {
    const db = await this.connect();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) return resolve([]);
      const tx      = db.transaction(storeName, 'readonly');
      const store   = tx.objectStore(storeName);
      const results = [];
      const req     = store.openCursor();

      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        const rec = { [store.keyPath]: cursor.primaryKey };
        for (const f of fields) {
          if (f !== store.keyPath && f in cursor.value) rec[f] = cursor.value[f];
        }
        results.push(rec);
        cursor.continue();
      };
      tx.oncomplete = () => resolve(results);
      tx.onerror    = () => reject(tx.error);
      req.onerror   = () => reject(req.error);
    });
  }
};
