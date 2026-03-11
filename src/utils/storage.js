/**
 * src/utils/storage.js
 * 统一存储抽象层 — 所有持久化操作的唯一入口
 *
 * 存储分布：
 *   IndexedDB (via DbGateway)
 *     files      bookId → { bookId, filename, data, timestamp }
 *     covers     bookId → { bookId, blob }
 *     locations  bookId → { bookId, json, timestamp }
 *   chrome.storage.local
 *     'preferences'       → { theme, fontSize, ... }
 *     'recentBooks'       → [{ id, title, author, filename, lastOpened }]
 *     'pos_<bookId>'      → { cfi, percentage, timestamp }   [v1.6.0 flat key]
 *     'time_<bookId>'     → number (seconds)
 *     'highlights_<bookId>' → [{ cfi, text, color, note, timestamp }]
 *     'bookmarks_<bookId>'  → [{ cfi, chapter, progress, timestamp }]
 */
const EpubStorage = {

  // ── Preferences ────────────────────────────────────────────────────────────

  async savePreferences(prefs) {
    const current = (await this._get('preferences')) || {};
    await this._set({ preferences: { ...current, ...prefs } });
  },

  async getPreferences() {
    return (await this._get('preferences')) || {
      theme:           'light',
      fontSize:        18,
      fontFamily:      '',
      lineHeight:      1.8,
      letterSpacing:   0,
      paragraphIndent: true,
      spread:          'auto'
    };
  },

  // ── Recent Books ────────────────────────────────────────────────────────────

  async addRecentBook(book) {
    let recent = (await this._get('recentBooks')) || [];
    recent = recent.filter(b => b.id !== book.id);
    recent.unshift({ ...book, lastOpened: Date.now() });
    recent = recent.slice(0, 20);
    await this._set({ recentBooks: recent });
  },

  async getRecentBooks() {
    return (await this._get('recentBooks')) || [];
  },

  async removeRecentBook(bookId) {
    let recent = (await this._get('recentBooks')) || [];
    recent = recent.filter(b => b.id !== bookId);
    await this._set({ recentBooks: recent });
  },

  // ── Reading Position ────────────────────────────────────────────────────────
  // S-3: Flat per-book keys 'pos_<bookId>' replace the old nested 'positions'
  // map.  Each savePosition is now O(1) read+write instead of O(n).
  // Migration: getPosition() transparently reads old nested format on first
  // access and re-writes it as a flat key, then removes the stale entry.

  async savePosition(bookId, cfi, percentage = null) {
    await this._set({ ['pos_' + bookId]: { cfi, percentage, timestamp: Date.now() } });
  },

  async getPosition(bookId) {
    // Fast path: flat key (v1.6.0+)
    const flat = await this._get('pos_' + bookId);
    if (flat) return flat;

    // Migration path: check legacy nested 'positions' map (written by v1.5.0 and earlier)
    const legacy = await this._get('positions');
    if (legacy && legacy[bookId]) {
      const pos = legacy[bookId];
      // Migrate: write flat key, remove from nested map
      await this._set({ ['pos_' + bookId]: pos });
      delete legacy[bookId];
      if (Object.keys(legacy).length > 0) {
        await this._set({ positions: legacy });
      } else {
        await this._remove('positions');
      }
      return pos;
    }
    return null;
  },

  async removePosition(bookId) {
    await this._remove('pos_' + bookId);
    // Also clean legacy entry if present
    const legacy = await this._get('positions');
    if (legacy && legacy[bookId]) {
      delete legacy[bookId];
      await this._set({ positions: legacy });
    }
  },

  // ── Reading Time ─────────────────────────────────────────────────────────

  async getReadingTime(bookId) {
    return (await this._get('time_' + bookId)) || 0;
  },

  async saveReadingTime(bookId, seconds) {
    if (!bookId) return;
    await this._set({ ['time_' + bookId]: seconds });
  },

  async removeReadingTime(bookId) {
    await this._remove('time_' + bookId);
  },

  // ── Highlights ───────────────────────────────────────────────────────────

  async getHighlights(bookId) {
    return (await this._get('highlights_' + bookId)) || [];
  },

  async saveHighlights(bookId, highlights) {
    await this._set({ ['highlights_' + bookId]: highlights });
  },

  async removeHighlights(bookId) {
    await this._remove('highlights_' + bookId);
  },

  /**
   * Return all highlights keyed by bookId.
   * S: Uses a stored index 'highlightKeys' to avoid get(null) full scan.
   * Falls back to get(null) scan if the index is absent (first run / migration).
   */
  async getAllHighlights() {
    // Try index-based lookup first
    let keys = await this._get('highlightKeys');
    if (keys && Array.isArray(keys)) {
      const result = {};
      await Promise.all(keys.map(async (bookId) => {
        const val = await this._get('highlights_' + bookId);
        if (val) result[bookId] = val;
      }));
      return result;
    }

    // Fallback: full scan (migrates index on the fly)
    return new Promise((resolve) => {
      chrome.storage.local.get(null, async (items) => {
        const all  = {};
        const seen = [];
        for (const [key, val] of Object.entries(items)) {
          if (key.startsWith('highlights_')) {
            const id = key.slice('highlights_'.length);
            all[id]  = val;
            seen.push(id);
          }
        }
        // Build index for subsequent calls
        if (seen.length > 0) await this._set({ highlightKeys: seen });
        resolve(all);
      });
    });
  },

  // ── Bookmarks ─────────────────────────────────────────────────────────────

  async getBookmarks(bookId) {
    return (await this._get('bookmarks_' + bookId)) || [];
  },

  async saveBookmarks(bookId, bookmarks) {
    await this._set({ ['bookmarks_' + bookId]: bookmarks });
  },

  async removeBookmarks(bookId) {
    await this._remove('bookmarks_' + bookId);
  },

  // ── Covers (IndexedDB) ────────────────────────────────────────────────────

  async saveCover(bookId, blob) {
    if (!bookId || !blob) return;
    return DbGateway.put('covers', { bookId, blob });
  },

  async getCover(bookId) {
    if (!bookId) return null;
    const record = await DbGateway.get('covers', bookId);
    return record ? record.blob : null;
  },

  async removeCover(bookId) {
    if (!bookId) return;
    return DbGateway.delete('covers', bookId);
  },

  // ── Locations (IndexedDB) ─────────────────────────────────────────────────

  async saveLocations(bookId, locationsJSON) {
    if (!bookId || !locationsJSON) return;
    return DbGateway.put('locations', { bookId, json: locationsJSON, timestamp: Date.now() });
  },

  async getLocations(bookId) {
    if (!bookId) return null;
    const record = await DbGateway.get('locations', bookId);
    return record ? record.json : null;
  },

  async removeLocations(bookId) {
    if (!bookId) return;
    return DbGateway.delete('locations', bookId);
  },

  // ── Files (IndexedDB) ─────────────────────────────────────────────────────
  // S-1-B: files store now keyed by bookId (was filename).
  // storeFile() accepts bookId as primary key. getFile() looks up by bookId.
  // LRU uses getAllMeta() cursor scan — never loads binary data.

  /**
   * Store an EPUB file in IndexedDB, keyed by bookId.
   * LRU enforcement is internal (callers must not call enforceFileLRU separately).
   *
   * @param {string}                 filename  - Original filename (stored as metadata)
   * @param {ArrayBuffer|Uint8Array} data      - File bytes
   * @param {string}                 bookId    - SHA-256 content fingerprint (primary key)
   */
  async storeFile(filename, data, bookId) {
    if (!filename || !data || !bookId) return;
    await DbGateway.put('files', { bookId, filename, data, timestamp: Date.now() });
    await this.enforceFileLRU(10);
  },

  /**
   * Retrieve a file record by bookId.
   * Returns full record { bookId, filename, data, timestamp } or null.
   */
  async getFile(bookId) {
    if (!bookId) return null;
    return DbGateway.get('files', bookId);
  },

  /**
   * Delete a file record by bookId.
   */
  async removeFile(bookId) {
    if (!bookId) return;
    return DbGateway.delete('files', bookId);
  },

  /**
   * LRU: keep only the most recent maxCount files.
   * P1-LRU-1 fix: uses getAllMeta() cursor scan — reads only bookId+timestamp,
   * never loads binary data into memory (old getAll() caused ~50 MB spikes).
   */
  async enforceFileLRU(maxCount = 10) {
    const meta = await DbGateway.getAllMeta('files', ['timestamp']);
    if (meta.length <= maxCount) return;
    meta.sort((a, b) => b.timestamp - a.timestamp);
    for (let i = maxCount; i < meta.length; i++) {
      await DbGateway.delete('files', meta[i].bookId);
    }
  },

  // ── Cascading Delete ──────────────────────────────────────────────────────

  /**
   * Delete ALL data for a book in one call.
   * P1-CASCADE-1 fix: all independent operations run in parallel via Promise.all.
   * S-1-B: filename parameter removed — all ops now use bookId uniformly.
   *
   * @param {string} bookId
   */
  async removeBook(bookId) {
    await Promise.all([
      this.removeRecentBook(bookId),
      this.removePosition(bookId),
      this.removeReadingTime(bookId),
      this.removeCover(bookId),
      this.removeHighlights(bookId),
      this.removeLocations(bookId),
      this.removeBookmarks(bookId),
      this.removeFile(bookId),
    ]);
    // Rebuild highlights index after deletion
    const keys = await this._get('highlightKeys');
    if (keys) {
      const updated = keys.filter(k => k !== bookId);
      await this._set({ highlightKeys: updated });
    }
  },

  // ── BookId Generation ─────────────────────────────────────────────────────

  /**
   * Generate a SHA-256 content fingerprint as book identifier.
   * Hashes filename + first 64 KB of content. Async (uses crypto.subtle).
   *
   * @param {string}      filename
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<string>} "book_<hex32>"
   */
  async generateBookId(filename, arrayBuffer) {
    const chunk     = arrayBuffer.slice(0, 65536);
    const enc       = new TextEncoder();
    const nameBytes = enc.encode(filename);
    const combined  = new Uint8Array(nameBytes.length + chunk.byteLength);
    combined.set(nameBytes, 0);
    combined.set(new Uint8Array(chunk), nameBytes.length);
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
    const hex = Array.from(new Uint8Array(hashBuffer))
      .slice(0, 16)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return 'book_' + hex;
  },

  // ── Internal Helpers ──────────────────────────────────────────────────────

  async _get(key) {
    return new Promise(resolve =>
      chrome.storage.local.get([key], result => resolve(result[key]))
    );
  },

  async _set(data) {
    return new Promise(resolve => chrome.storage.local.set(data, resolve));
  },

  async _remove(key) {
    return new Promise(resolve =>
      chrome.storage.local.remove(Array.isArray(key) ? key : [key], resolve)
    );
  }
};
