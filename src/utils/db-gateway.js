/**
 * src/utils/db-gateway.js
 * 负责管控 IndexedDB 的唯一单例接驳与全量 Schema
 */
const DbGateway = {
  DB_NAME: 'EpubReaderDB',
  DB_VERSION: 3,
  _dbPromise: null,

  async connect() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'name' });
        if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('locations')) db.createObjectStore('locations', { keyPath: 'id' });
      };

      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => {
        this._dbPromise = null;
        reject(e.target.error);
      };
    });
    return this._dbPromise;
  },

  async get(storeName, key) {
    const db = await this.connect();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) {
        console.warn(`[DbGateway] Store ${storeName} not found.`);
        return resolve(null);
      }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async put(storeName, data) {
    const db = await this.connect();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) {
        console.warn(`[DbGateway] Store ${storeName} not found, skipping put.`);
        return resolve();
      }
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(data);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async delete(storeName, key) {
    const db = await this.connect();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) return resolve();
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async getAll(storeName) {
    const db = await this.connect();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) return resolve([]);
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
};
