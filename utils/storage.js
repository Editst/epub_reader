/**
 * Storage utility - wraps chrome.storage.local for persistence
 */
const EpubStorage = {
  /**
   * Save reading position for a book
   * @param {string} bookId - Unique book identifier (hash of filename + size)
   * @param {string} cfi - EPUB CFI location string
   * @param {number} percentage - Reading progress percentage (0-100)
   */
  async savePosition(bookId, cfi, percentage = null) {
    const positions = (await this._get('positions')) || {};
    positions[bookId] = { cfi, percentage, timestamp: Date.now() };
    await this._set({ positions });
  },

  /**
   * Get saved reading position
   * @param {string} bookId
   * @returns {object|null} { cfi, timestamp }
   */
  async getPosition(bookId) {
    const positions = (await this._get('positions')) || {};
    return positions[bookId] || null;
  },

  /**
   * Save user preferences
   * @param {object} prefs - { theme, fontSize, fontFamily, lineHeight, ... }
   */
  async savePreferences(prefs) {
    const current = (await this._get('preferences')) || {};
    await this._set({ preferences: { ...current, ...prefs } });
  },

  /**
   * Get user preferences
   * @returns {object}
   */
  async getPreferences() {
    return (await this._get('preferences')) || {
      theme: 'light',
      fontSize: 18,
      fontFamily: '',
      lineHeight: 1.8,
      letterSpacing: 0,
      paragraphIndent: true,
      spread: 'auto'
    };
  },

  /**
   * Add to recent books list
   * @param {object} book - { id, title, author, filename, lastOpened, cfi }
   */
  async addRecentBook(book) {
    let recent = (await this._get('recentBooks')) || [];
    // Remove existing entry for this book
    recent = recent.filter(b => b.id !== book.id);
    // Add to front
    recent.unshift({
      ...book,
      lastOpened: Date.now()
    });
    // Keep only last 20
    recent = recent.slice(0, 20);
    await this._set({ recentBooks: recent });
  },

  /**
   * Get recent books list
   * @returns {Array}
   */
  async getRecentBooks() {
    return (await this._get('recentBooks')) || [];
  },

  /**
   * Remove a book from recent list
   * @param {string} bookId
   */
  async removeRecentBook(bookId) {
    let recent = (await this._get('recentBooks')) || [];
    recent = recent.filter(b => b.id !== bookId);
    await this._set({ recentBooks: recent });
  },

  /**
   * Remove a book's saved position
   * @param {string} bookId
   */
  async removePosition(bookId) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['pos_' + bookId], resolve);
    });
  },

  async getReadingTime(bookId) {
    const data = await this._get('time_' + bookId);
    return data || 0; // seconds
  },

  async saveReadingTime(bookId, seconds) {
    if (!bookId) return;
    await this._set({ ['time_' + bookId]: seconds });
  },

  /**
   * Remove a book's saved reading time
   * @param {string} bookId
   */
  async removeReadingTime(bookId) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['time_' + bookId], resolve);
    });
  },

  /**
   * Remove a book file from IndexedDB
   * @param {string} filename
   */
  async removeFileFromIndexedDB(filename) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('EpubReaderDB', 2);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'name' });
        if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers', { keyPath: 'id' });
      };
      request.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) {
          resolve();
          return;
        }
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        const req = store.delete(filename);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // --- NEW CAPABILITIES FOR P0 & P1 ---

  /**
   * Save EPUB cover image to IndexedDB (Permanent until manually deleted)
   * @param {string} bookId
   * @param {Blob} blob 
   */
  async saveCover(bookId, blob) {
    if (!bookId || !blob) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('EpubReaderDB', 2);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'name' });
        if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers', { keyPath: 'id' });
      };
      request.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('covers')) {
          // Store doesn't exist even after upgrade attempt — skip silently
          console.warn('covers store not found, skipping cover save');
          resolve();
          return;
        }
        this._putCover(db, bookId, blob).then(resolve).catch(reject);
      };
      request.onerror = () => reject(request.error);
    });
  },

  _putCover(db, bookId, blob) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('covers', 'readwrite');
      const store = tx.objectStore('covers');
      const req = store.put({ id: bookId, blob: blob });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Get cover image Blob from IndexedDB
   * @param {string} bookId
   * @returns {Blob|null}
   */
  async getCover(bookId) {
    if (!bookId) return null;
    return new Promise((resolve) => {
      const request = indexedDB.open('EpubReaderDB', 2);
      request.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('covers')) return resolve(null);
        const tx = db.transaction('covers', 'readonly');
        const store = tx.objectStore('covers');
        const req = store.get(bookId);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    });
  },

  /**
   * Remove cover from IndexedDB
   * @param {string} bookId 
   */
  async removeCover(bookId) {
    if (!bookId) return;
    return new Promise((resolve) => {
      const request = indexedDB.open('EpubReaderDB', 2);
      request.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('covers')) return resolve();
        const tx = db.transaction('covers', 'readwrite');
        const store = tx.objectStore('covers');
        const req = store.delete(bookId);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      };
      request.onerror = () => resolve();
    });
  },

  /**
   * Enforced LRU cache for heavy EPUB files. Keeps only the newest 'maxCount' files.
   * @param {number} maxCount 
   */
  async enforceFileLRU(maxCount = 10) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('EpubReaderDB', 2);
      request.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) return resolve();
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        const getAllReq = store.getAll();
        
        getAllReq.onsuccess = () => {
          const files = getAllReq.result;
          if (files.length > maxCount) {
            // Sort descending by timestamp (newest first)
            files.sort((a, b) => b.timestamp - a.timestamp);
            // Delete the oldest ones beyond maxCount
            for (let i = maxCount; i < files.length; i++) {
              store.delete(files[i].name);
            }
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Manage Highlights and annotations
   */
  async getHighlights(bookId) {
    const key = 'highlights_' + bookId;
    return (await this._get(key)) || [];
  },

  async saveHighlights(bookId, highlights) {
    const key = 'highlights_' + bookId;
    await this._set({ [key]: highlights });
  },

  async removeHighlights(bookId) {
    const key = 'highlights_' + bookId;
    return new Promise(resolve => chrome.storage.local.remove([key], resolve));
  },

  async getAllHighlights() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const all = {};
        for (const [key, val] of Object.entries(items)) {
          if (key.startsWith('highlights_')) {
            const bookId = key.replace('highlights_', '');
            all[bookId] = val;
          }
        }
        resolve(all);
      });
    });
  },

  /**
   * Completely obliterate ALL data for a specific book (Cascading Delete)
   * @param {string} bookId
   * @param {string} filename 
   */
  async removeBook(bookId, filename) {
    await this.removeRecentBook(bookId);
    await this.removePosition(bookId);
    await this.removeReadingTime(bookId);
    await this.removeCover(bookId);
    await this.removeHighlights(bookId);
    await this.removeLocations(bookId); // New v1.2.0: cascade delete locations
    if (filename) {
      await this.removeFileFromIndexedDB(filename);
    }
    // Remove bookmarks
    return new Promise(resolve => chrome.storage.local.remove(['bookmarks_' + bookId], resolve));
  },

  /**
   * Generate a simple hash ID for a book
   * @param {string} filename
   * @param {number} size
   * @returns {string}
   */
  generateBookId(filename, size) {
    let hash = 0;
    const str = filename + ':' + size;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return 'book_' + Math.abs(hash).toString(36);
  },

  // Internal helpers
  async _get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);
      });
    });
  },

  async _set(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  },

  // --- NEW CAPABILITIES FOR v1.2.0: Locations Caching ---

  /**
   * Save EPUB Locations array to prevent progress zeroing on load.
   * Locations can be large, so we structure them per book.
   * @param {string} bookId 
   * @param {string} locationsJSON 
   */
  async saveLocations(bookId, locationsJSON) {
    if (!bookId || !locationsJSON) return;
    const key = 'loc_' + bookId;
    
    // Safety limit: if locations JSON is extremely huge (e.g. >2MB), skip caching to save quota
    if (locationsJSON.length > 2000000) {
      console.warn("Locations data too large, skipping cache to preserve storage quota.");
      return;
    }
    
    await this._set({ [key]: locationsJSON });
  },

  /**
   * Retrieve cached Locations JSON.
   * @param {string} bookId 
   * @returns {string|null}
   */
  async getLocations(bookId) {
    if (!bookId) return null;
    return await this._get('loc_' + bookId);
  },

  /**
   * Remove cached Locations.
   * @param {string} bookId 
   */
  async removeLocations(bookId) {
    if (!bookId) return;
    const key = 'loc_' + bookId;
    return new Promise(resolve => chrome.storage.local.remove([key], resolve));
  }
};
