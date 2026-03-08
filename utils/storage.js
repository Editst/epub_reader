/**
 * Storage utility - wraps chrome.storage.local for persistence
 */
const EpubStorage = {
  /**
   * Save reading position for a book
   * @param {string} bookId - Unique book identifier (hash of filename + size)
   * @param {string} cfi - EPUB CFI location string
   */
  async savePosition(bookId, cfi) {
    const positions = (await this._get('positions')) || {};
    positions[bookId] = { cfi, timestamp: Date.now() };
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
      const request = indexedDB.open('EpubReaderDB', 1);
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
  }
};
