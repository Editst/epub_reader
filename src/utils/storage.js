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
    // FIX P0-1: savePosition stores data inside a nested 'positions' object
    // keyed by bookId. The old implementation removed 'pos_${bookId}' which
    // never existed, so positions were never actually deleted.
    const positions = (await this._get('positions')) || {};
    delete positions[bookId];
    await this._set({ positions });
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
    return DbGateway.delete('files', filename);
  },

  // --- NEW CAPABILITIES FOR P0 & P1 ---

  /**
   * Save EPUB cover image to IndexedDB (Permanent until manually deleted)
   * @param {string} bookId
   * @param {Blob} blob 
   */
  async saveCover(bookId, blob) {
    if (!bookId || !blob) return;
    return DbGateway.put('covers', { id: bookId, blob: blob });
  },

  /**
   * Get cover image Blob from IndexedDB
   * @param {string} bookId
   * @returns {Blob|null}
   */
  async getCover(bookId) {
    if (!bookId) return null;
    const record = await DbGateway.get('covers', bookId);
    return record ? record.blob : null;
  },

  /**
   * Remove cover from IndexedDB
   * @param {string} bookId 
   */
  async removeCover(bookId) {
    if (!bookId) return;
    return DbGateway.delete('covers', bookId);
  },

  /**
   * Enforced LRU cache for heavy EPUB files. Keeps only the newest 'maxCount' files.
   * @param {number} maxCount 
   */
  async enforceFileLRU(maxCount = 10) {
    const files = await DbGateway.getAll('files');
    if (files.length > maxCount) {
      files.sort((a, b) => b.timestamp - a.timestamp);
      for (let i = maxCount; i < files.length; i++) {
        await DbGateway.delete('files', files[i].name);
      }
    }
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

  // --- NEW CAPABILITIES FOR v1.2.0 & v1.2.2: Locations Caching via IndexedDB ---

  /**
   * Save EPUB Locations array to prevent progress zeroing on load.
   * Migrated to IndexedDB in v1.2.2 to handle massive books exceeding 2MB limits.
   * @param {string} bookId 
   * @param {string} locationsJSON 
   */
  async saveLocations(bookId, locationsJSON) {
    if (!bookId || !locationsJSON) return;
    return DbGateway.put('locations', { id: bookId, json: locationsJSON, timestamp: Date.now() });
  },

  /**
   * Retrieve cached Locations JSON from IndexedDB.
   * @param {string} bookId 
   * @returns {string|null}
   */
  async getLocations(bookId) {
    if (!bookId) return null;
    const record = await DbGateway.get('locations', bookId);
    return record ? record.json : null;
  },

  /**
   * Remove cached Locations.
   * @param {string} bookId 
   */
  async removeLocations(bookId) {
    if (!bookId) return;
    return DbGateway.delete('locations', bookId);
  },

  // --- NEW CAPABILITIES FOR v1.4.0: Centralized File Storage via Gateway ---
  
  /**
   * Store parsed or unparsed EPUB file blobs into the database safely
   * @param {string} filename 
   * @param {ArrayBuffer|Uint8Array|Blob} data 
   */
  async storeFile(filename, data) {
    if (!filename || !data) return;
    return DbGateway.put('files', { name: filename, data: data, timestamp: Date.now() });
  },

  /**
   * Retrieve stored EPUB file
   * @param {string} filename 
   * @returns {ArrayBuffer|Uint8Array|Blob|null}
   */
  async getFile(filename) {
    if (!filename) return null;
    const record = await DbGateway.get('files', filename);
    return record ? record.data : null;
  }
};
