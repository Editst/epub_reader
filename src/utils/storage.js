/**
 * src/utils/storage.js
 * 统一存储抽象层 — 所有持久化操作的唯一入口
 *
 * v1.7.0 存储结构（chrome.storage.local）：
 *
 *   全局：
 *     'preferences'          → { theme, fontSize, ... }
 *     'recentBooks'          → [{ id, title, author, filename, lastOpened }]
 *
 *   每本书（3 keys，按写入频率分组）：
 *     'bookMeta_<bookId>'    → { pos, time, speed }
 *       pos:   { cfi, percentage, timestamp }
 *       time:  number                          累计阅读秒数
 *       speed: { sampledSeconds, sampledProgress }   实际采样速度
 *     'highlights_<bookId>'  → [{cfi, text, color, note, timestamp}]
 *     'bookmarks_<bookId>'   → [{cfi, chapter, progress, timestamp}]
 *
 *   IndexedDB (via DbGateway)：files / covers / locations
 *
 * v1.7.0 变更摘要：
 *   [CONSOLIDATE] pos_<bookId> + time_<bookId> 合并为 bookMeta_<bookId>
 *   [NEW]         speed 字段：per-session 采样，修复中途开书/跳章的 ETA 偏差
 *   [REMOVE]      highlightKeys 索引（有不一致风险），改用 recentBooks 遍历
 *   [FIX]         enforceFileLRU 级联清理 recentBooks + bookMeta，消除孤立条目
 *   [MIGRATION]   getBookMeta lazy migration：自动迁移 v1.6.0 pos_/time_ 旧 key
 */
const EpubStorage = {
  _bookMetaQueue: new Map(),

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

  // ── Book Meta（位置 + 时间 + 速度） ──────────────────────────────────────────
  //
  // 三个小字段合并为一个 key（合计 < 200 bytes），翻页只读写 bookMeta，
  // 不触碰大型 highlights/bookmarks 数据，避免写放大。

  /**
   * 读取书籍完整元数据。首次访问时自动迁移 v1.6.0 的 pos_/time_ flat key。
   */
  async getBookMeta(bookId) {
    if (!bookId) return null;
    const meta = await this._get('bookMeta_' + bookId);
    if (meta) return meta;

    // Lazy migration from v1.6.0 flat keys
    const [pos, time] = await Promise.all([
      this._get('pos_' + bookId),
      this._get('time_' + bookId)
    ]);
    if (pos || (typeof time === 'number')) {
      const migrated = {
        pos:   pos  || null,
        time:  (typeof time === 'number') ? time : 0,
        speed: { sampledSeconds: 0, sampledProgress: 0 }
      };
      await this._set({ ['bookMeta_' + bookId]: migrated });
      this._remove(['pos_' + bookId, 'time_' + bookId]).catch(() => {});
      return migrated;
    }
    return null;
  },

  async saveBookMeta(bookId, meta) {
    if (!bookId || !meta) return;
    await this._set({ ['bookMeta_' + bookId]: meta });
  },

  /**
   * Patch 位置字段。经 300ms 防抖后由 schedulePositionSave 调用。
   */
  async savePosition(bookId, cfi, percentage = null) {
    if (!bookId) return;
    await this._enqueueBookMetaWrite(bookId, (current) => {
      current.pos = { cfi, percentage, timestamp: Date.now() };
      return current;
    });
  },

  async getPosition(bookId) {
    const meta = await this.getBookMeta(bookId);
    return meta ? (meta.pos || null) : null;
  },

  async removePosition(bookId) {
    const current = await this._get('bookMeta_' + bookId);
    if (current) {
      current.pos = null;
      await this._set({ ['bookMeta_' + bookId]: current });
    }
    await this._remove('pos_' + bookId);
  },

  // ── Reading Time ─────────────────────────────────────────────────────────

  async getReadingTime(bookId) {
    const meta = await this.getBookMeta(bookId);
    return meta ? (meta.time || 0) : 0;
  },

  async saveReadingTime(bookId, seconds) {
    if (!bookId) return;
    await this._enqueueBookMetaWrite(bookId, (current) => {
      current.time = seconds;
      return current;
    });
  },

  async removeReadingTime(bookId) {
    await this._remove('time_' + bookId);
  },

  // ── Reading Speed（per-session 采样，v1.7.0 新增） ────────────────────────
  //
  // speed 结构（v2.2.0，D-2026-25 落地）：
  //   sampledSeconds  / sampledProgress：加权累计采样，ETA 主路径
  //   sessions: [{ seconds, progress, timestamp, isJump }]  — v2.0 新增，历史 session 列表
  //   sessionCount: number  — 有效 session 累计数，< 3 时 ETA 显示"估算中"
  //
  // ETA 计算：secsPerUnit = sampledSeconds / sampledProgress
  //            remaining = secsPerUnit * (1 - currentProgress) / 60 (分钟)
  //
  // 有效 session 条件（reader-persistence.js flushSpeedSession）：
  //   deltaProgress ∈ (0.001, 0.30)  读了 0.1%–30%
  //   deltaSeconds  > 30              持续 30s 以上
  //   isJump: deltaProgress > 0.05 → weight 0.3，否则 weight 1.0

  async saveReadingSpeed(bookId, speed) {
    if (!bookId || !speed) return;
    await this._enqueueBookMetaWrite(bookId, (current) => {
      // speed 结构 v2.2.0：向后兼容旧 { sampledSeconds, sampledProgress }
      current.speed = {
        sampledSeconds:  speed.sampledSeconds  || 0,
        sampledProgress: speed.sampledProgress || 0,
        sessions:        speed.sessions        || current.speed?.sessions        || [],
        sessionCount:    speed.sessionCount    || current.speed?.sessionCount    || 0
      };
      return current;
    });
  },

  async getReadingSpeed(bookId) {
    const meta = await this.getBookMeta(bookId);
    if (!meta || !meta.speed) {
      return { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 };
    }
    // 向后兼容：旧 speed 无 sessions/sessionCount 时补默认值
    return {
      sampledSeconds:  meta.speed.sampledSeconds  || 0,
      sampledProgress: meta.speed.sampledProgress || 0,
      sessions:        meta.speed.sessions        || [],
      sessionCount:    meta.speed.sessionCount    || 0
    };
  },

  async removeBookMeta(bookId) {
    if (!bookId) return;
    await this._remove(['bookMeta_' + bookId, 'pos_' + bookId, 'time_' + bookId]);
  },

  // ── Highlights ───────────────────────────────────────────────────────────

  async getHighlights(bookId) {
    return (await this._get('highlights_' + bookId)) || [];
  },

  async saveHighlights(bookId, highlights) {
    if (!bookId) return;
    await this._set({ ['highlights_' + bookId]: highlights });
  },

  async removeHighlights(bookId) {
    await this._remove('highlights_' + bookId);
  },

  /**
   * 返回所有书籍的高亮，格式 { [bookId]: highlights[] }。
   *
   * v1.7.0: 废弃 highlightKeys 索引，改为遍历 recentBooks 读取。
   * recentBooks 是权威书籍列表，无额外维护成本，彻底消除索引不一致风险。
   */
  async getAllHighlights() {
    const books = await this.getRecentBooks();
    const allItems = await this._getAll();
    const result = {};
    const bookIds = new Set(books.map(b => b.id));

    for (const key of Object.keys(allItems || {})) {
      if (key.startsWith('highlights_')) {
        bookIds.add(key.slice('highlights_'.length));
      }
    }

    await Promise.all(Array.from(bookIds).map(async (bookId) => {
      const hls = await this._get('highlights_' + bookId);
      if (hls && hls.length > 0) result[bookId] = hls;
    }));

    this._remove('highlightKeys').catch(() => {});
    return result;
  },

  // ── Bookmarks ─────────────────────────────────────────────────────────────

  async getBookmarks(bookId) {
    return (await this._get('bookmarks_' + bookId)) || [];
  },

  async saveBookmarks(bookId, bookmarks) {
    if (!bookId) return;
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

  async storeFile(filename, data, bookId) {
    if (!filename || !data || !bookId) return;
    await DbGateway.put('files', { bookId, filename, data, timestamp: Date.now() });
    await this.enforceFileLRU(10);
  },

  async getFile(bookId) {
    if (!bookId) return null;
    return DbGateway.get('files', bookId);
  },

  async removeFile(bookId) {
    if (!bookId) return;
    return DbGateway.delete('files', bookId);
  },

  /**
   * LRU：保留最近 maxCount 本书的文件缓存，驱逐其余。
   *
   * v1.7.0 修复：驱逐时级联清理 recentBooks + bookMeta，消除书架孤立条目。
   */
  async enforceFileLRU(maxCount = 10) {
    const meta = await DbGateway.getAllMeta('files', ['timestamp']);
    if (meta.length <= maxCount) return;
    meta.sort((a, b) => b.timestamp - a.timestamp);
    await Promise.all(
      meta.slice(maxCount).map(m => Promise.all([
        DbGateway.delete('files', m.bookId),
        this.removeRecentBook(m.bookId),
        this.removeBookMeta(m.bookId)
      ]))
    );
  },

  // ── Cascading Delete ──────────────────────────────────────────────────────

  /**
   * 删除一本书的全量数据（7 项并行）。
   * v1.7.0: removeBookMeta 取代原 removePosition + removeReadingTime。
   */
  async removeBook(bookId) {
    if (!bookId) return;
    await Promise.all([
      this.removeRecentBook(bookId),
      this.removeBookMeta(bookId),
      this.removeCover(bookId),
      this.removeHighlights(bookId),
      this.removeLocations(bookId),
      this.removeBookmarks(bookId),
      this.removeFile(bookId)
    ]);
  },

  // ── BookId Generation ─────────────────────────────────────────────────────

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
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([key], result => {
        if (chrome.runtime && chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(result[key]);
      });
    });
  },

  async _getAll() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(null, result => {
        if (chrome.runtime && chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(result || {});
      });
    });
  },

  async _set(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime && chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    });
  },

  async _remove(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(Array.isArray(key) ? key : [key], () => {
        if (chrome.runtime && chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    });
  },

  async _enqueueBookMetaWrite(bookId, mutator) {
    const prev = this._bookMetaQueue.get(bookId) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        const current = (await this._get('bookMeta_' + bookId)) || {
          pos: null,
          time: 0,
          speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 }
        };
        const updated = mutator(current) || current;
        await this._set({ ['bookMeta_' + bookId]: updated });
      });
    const queued = next.finally(() => {
      if (this._bookMetaQueue.get(bookId) === queued) this._bookMetaQueue.delete(bookId);
    });
    this._bookMetaQueue.set(bookId, queued);
    return next;
  }
};
