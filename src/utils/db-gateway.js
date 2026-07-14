/**
 * src/utils/db-gateway.js
 * IndexedDB 唯一单例接驳 + 全量 Schema 定义
 *
 * DB v4 将 files / covers / locations 统一为 bookId 主键；从旧 schema
 * 升级时三表重建，用户需重新导入 EPUB。put() / delete() 等待事务完成后
 * 才 resolve；连接在 versionchange / close 后失效并于下次访问重建。
 */
(function () {
  'use strict';

const DbGateway = {
  DB_NAME:      'EpubReaderDB',
  DB_VERSION:   4,
  _dbPromise:   null,
  _retryCount:  0,
  _retryLimit:  3,

  async connect() {
    // 磁盘满或隐身模式限制下避免持续高频重试。
    if (this._retryCount >= this._retryLimit) {
      throw new Error(`[DbGateway] IDB connection failed ${this._retryLimit} times consecutively. Refusing further retries.`);
    }
    if (this._dbPromise) return this._dbPromise;
    const connectionPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db         = e.target.result;
        const oldVersion = e.oldVersion; // 0 = brand-new install

        // 旧 schema 的 keyPath 不兼容，统一重建三个 store。
        if (oldVersion < 4) {
          if (db.objectStoreNames.contains('files'))     db.deleteObjectStore('files');
          if (db.objectStoreNames.contains('covers'))    db.deleteObjectStore('covers');
          if (db.objectStoreNames.contains('locations')) db.deleteObjectStore('locations');
        }

        if (!db.objectStoreNames.contains('files')) {
          const s = db.createObjectStore('files', { keyPath: 'bookId' });
          s.createIndex('by_filename', 'filename', { unique: false });
        }
        if (!db.objectStoreNames.contains('covers'))
          db.createObjectStore('covers',    { keyPath: 'bookId' });
        if (!db.objectStoreNames.contains('locations'))
          db.createObjectStore('locations', { keyPath: 'bookId' });
      };

      request.onsuccess = (e) => {
        const db = e.target.result;
        const invalidateConnection = () => {
          if (this._dbPromise === connectionPromise) this._dbPromise = null;
        };
        db.onversionchange = () => {
          try {
            db.close();
          } finally {
            invalidateConnection();
          }
        };
        db.onclose = invalidateConnection;
        this._retryCount = 0; // reset on success
        resolve(db);
      };
      request.onerror   = (e) => {
        if (this._dbPromise === connectionPromise) this._dbPromise = null;
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
    this._dbPromise = connectionPromise;
    return connectionPromise;
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
      tx.onabort    = () => reject(tx.error || new Error(`[DbGateway] get aborted for store "${storeName}"`));
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
      tx.onabort    = () => reject(tx.error || new Error(`[DbGateway] put aborted for store "${storeName}"`));
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
      tx.onabort    = () => reject(tx.error || new Error(`[DbGateway] delete aborted for store "${storeName}"`));
      req.onerror   = () => reject(req.error);
    });
  },

  async getAll(storeName) {
    const db = await this.connect();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) return resolve([]);
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      tx.onabort    = () => reject(tx.error || new Error(`[DbGateway] getAll aborted for store "${storeName}"`));
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },

  /**
   * Cursor-based metadata scan — reads only the listed fields, never loads
   * binary 'data' blobs，避免 LRU 排序时把 EPUB 二进制整体载入内存。
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
      tx.onabort    = () => reject(tx.error || new Error(`[DbGateway] metadata scan aborted for store "${storeName}"`));
      req.onerror   = () => reject(req.error);
    });
  }
};

window.DbGateway = DbGateway;
})();
