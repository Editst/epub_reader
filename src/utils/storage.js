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
 *   [DESIGN]      enforceFileLRU 仅淘汰 EPUB 文件缓存，保留进度、书签和标注
 *   [MIGRATION]   getBookMeta lazy migration：自动迁移 v1.6.0 pos_/time_ 旧 key
 */
const KEYS = Object.freeze({
  preferences: 'preferences',
  recentBooks: 'recentBooks',
  legacyHighlightIndex: 'highlightKeys',
  bookMeta: (bookId) => 'bookMeta_' + bookId,
  legacyPosition: (bookId) => 'pos_' + bookId,
  legacyReadingTime: (bookId) => 'time_' + bookId,
  highlights: (bookId) => 'highlights_' + bookId,
  bookmarks: (bookId) => 'bookmarks_' + bookId
});

const KEY_PREFIXES = Object.freeze({
  highlights: 'highlights_'
});

const STORES = Object.freeze({
  files: 'files',
  covers: 'covers',
  locations: 'locations'
});

const EpubStorage = {
  _preferencesQueue: Promise.resolve(),
  _recentBooksQueue: Promise.resolve(),
  _bookMetaQueue: new Map(),
  _deletingBookIds: new Set(),

  // ── Preferences ────────────────────────────────────────────────────────────

  async savePreferences(prefs) {
    if (!prefs) return;
    return this._enqueuePreferencesWrite((current) => ({ ...current, ...prefs }));
  },

  async getPreferences() {
    return {
      theme:           'light',
      fontSize:        18,
      fontFamily:      '',
      lineHeight:      1.8,
      letterSpacing:   0,
      paragraphIndent: true,
      spread:          'auto',
      layout:          'paginated',
      customBg:        '#ffffff',
      customText:      '#333333',
      homeView:        'grid',
      ...((await this._get(KEYS.preferences)) || {})
    };
  },

  // ── Recent Books ────────────────────────────────────────────────────────────

  async addRecentBook(book) {
    return this._enqueueRecentBooksWrite((recent) => {
      recent = recent.filter(b => b.id !== book.id);
      recent.unshift({ ...book, lastOpened: Date.now() });
      return recent.slice(0, 20);
    });
  },

  async getRecentBooks() {
    return (await this._get(KEYS.recentBooks)) || [];
  },

  async removeRecentBook(bookId) {
    return this._enqueueRecentBooksWrite((recent) => recent.filter(b => b.id !== bookId));
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
    const meta = await this._get(KEYS.bookMeta(bookId));
    if (meta) return meta;

    return this._migrateLegacyBookMeta(bookId);
  },

  async saveBookMeta(bookId, meta) {
    if (!bookId || !meta) return;
    await this._enqueueBookMetaTask(bookId, async () => {
      if (this._deletingBookIds.has(bookId)) return;
      await this._set({ [KEYS.bookMeta(bookId)]: meta });
      this._removeLegacyBookMetaKeys(bookId).catch(() => {});
    });
  },

  /**
   * Patch 位置字段。经 300ms 防抖后由 schedulePositionSave 调用。
   */
  async savePosition(bookId, cfi, percentage = null, locator = undefined) {
    if (!bookId) return;
    await this._enqueueBookMetaWrite(bookId, (current) => {
      current.pos = { cfi, percentage, timestamp: Date.now() };
      if (locator !== undefined) current.pos.locator = locator;
      return current;
    });
  },

  async getPosition(bookId) {
    const meta = await this.getBookMeta(bookId);
    return meta ? (meta.pos || null) : null;
  },

  async removePosition(bookId) {
    if (!bookId) return;
    await this._enqueueBookMetaWrite(bookId, (current) => {
      current.pos = null;
      return current;
    }, false);
    await this._remove(KEYS.legacyPosition(bookId));
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
    if (!bookId) return;
    await this._enqueueBookMetaWrite(bookId, (current) => {
      current.time = 0;
      return current;
    }, false);
    await this._remove(KEYS.legacyReadingTime(bookId));
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
        sampledSeconds:  speed.sampledSeconds  ?? 0,
        sampledProgress: speed.sampledProgress ?? 0,
        sessions:        speed.sessions        ?? current.speed?.sessions        ?? [],
        sessionCount:    speed.sessionCount    ?? current.speed?.sessionCount    ?? 0
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
    const hadDeleteGuard = this._deletingBookIds.has(bookId);
    if (!hadDeleteGuard) this._deletingBookIds.add(bookId);
    try {
      await this._drainBookMetaQueue(bookId);
      await this._remove([KEYS.bookMeta(bookId), KEYS.legacyPosition(bookId), KEYS.legacyReadingTime(bookId)]);
    } finally {
      if (!hadDeleteGuard) this._deletingBookIds.delete(bookId);
    }
  },

  // ── Highlights ───────────────────────────────────────────────────────────

  async getHighlights(bookId) {
    return (await this._get(KEYS.highlights(bookId))) || [];
  },

  async saveHighlights(bookId, highlights) {
    if (!bookId) return;
    await this._set({ [KEYS.highlights(bookId)]: highlights });
  },

  async removeHighlights(bookId) {
    await this._remove(KEYS.highlights(bookId));
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
      if (key.startsWith(KEY_PREFIXES.highlights)) {
        bookIds.add(key.slice(KEY_PREFIXES.highlights.length));
      }
    }

    for (const bookId of bookIds) {
      const hls = allItems[KEYS.highlights(bookId)];
      if (hls && hls.length > 0) result[bookId] = hls;
    }

    this._remove(KEYS.legacyHighlightIndex).catch(() => {});
    return result;
  },

  // ── Bookmarks ─────────────────────────────────────────────────────────────

  async getBookmarks(bookId) {
    return (await this._get(KEYS.bookmarks(bookId))) || [];
  },

  async saveBookmarks(bookId, bookmarks) {
    if (!bookId) return;
    await this._set({ [KEYS.bookmarks(bookId)]: bookmarks });
  },

  async removeBookmarks(bookId) {
    await this._remove(KEYS.bookmarks(bookId));
  },

  // ── Covers (IndexedDB) ────────────────────────────────────────────────────

  async saveCover(bookId, blob) {
    if (!bookId || !blob) return;
    return DbGateway.put(STORES.covers, { bookId, blob });
  },

  async getCover(bookId) {
    if (!bookId) return null;
    const record = await DbGateway.get(STORES.covers, bookId);
    return record ? record.blob : null;
  },

  async removeCover(bookId) {
    if (!bookId) return;
    return DbGateway.delete(STORES.covers, bookId);
  },

  // ── Locations (IndexedDB) ─────────────────────────────────────────────────

  async saveLocations(bookId, locationsJSON) {
    if (!bookId || !locationsJSON) return;
    return DbGateway.put(STORES.locations, { bookId, json: locationsJSON, timestamp: Date.now() });
  },

  async getLocations(bookId) {
    if (!bookId) return null;
    const record = await DbGateway.get(STORES.locations, bookId);
    return record ? record.json : null;
  },

  async removeLocations(bookId) {
    if (!bookId) return;
    return DbGateway.delete(STORES.locations, bookId);
  },

  // ── Files (IndexedDB) ─────────────────────────────────────────────────────

  async storeFile(filename, data, bookId) {
    if (!filename || !data || !bookId) return;
    await DbGateway.put(STORES.files, { bookId, filename, data, timestamp: Date.now() });
    await this.enforceFileLRU(10);
  },

  async getFile(bookId) {
    if (!bookId) return null;
    return DbGateway.get(STORES.files, bookId);
  },

  async removeFile(bookId) {
    if (!bookId) return;
    return DbGateway.delete(STORES.files, bookId);
  },

  /**
   * LRU：保留最近 maxCount 本书的文件缓存，驱逐其余。
   *
   * 设计约束：自动淘汰只删除占空间最大的 EPUB 文件缓存。
   * recentBooks、bookMeta、highlights、bookmarks、covers、locations 均保留，
   * 以便用户重新导入同一书籍后继续使用阅读进度、书签和标注。
   * v2.4.0 修复：改为串行执行并逐项隔离失败，避免单本淘汰失败阻塞后续清理。
   */
  async enforceFileLRU(maxCount = 10) {
    const meta = await DbGateway.getAllMeta(STORES.files, ['timestamp']);
    if (meta.length <= maxCount) return;
    meta.sort((a, b) => b.timestamp - a.timestamp);
    const toRemove = meta.slice(maxCount);
    for (const m of toRemove) {
      try {
        await DbGateway.delete(STORES.files, m.bookId);
      } catch (e) {
        console.warn('[Storage] enforceFileLRU: failed to remove file cache', m.bookId, e);
      }
    }
  },

  // ── Cascading Delete ──────────────────────────────────────────────────────

  /**
   * 删除一本书的全量数据（7 项并行）。
   * v1.7.0: removeBookMeta 取代原 removePosition + removeReadingTime。
   */
  async removeBook(bookId) {
    if (!bookId) return;
    this._deletingBookIds.add(bookId);
    try {
      await this._drainBookMetaQueue(bookId);
      await Promise.all([
        this.removeRecentBook(bookId),
        this.removeBookMeta(bookId),
        this.removeCover(bookId),
        this.removeHighlights(bookId),
        this.removeLocations(bookId),
        this.removeBookmarks(bookId),
        this.removeFile(bookId)
      ]);
    } finally {
      this._deletingBookIds.delete(bookId);
    }
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

  async _enqueuePreferencesWrite(mutator) {
    const prev = this._preferencesQueue || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        const current = (await this._get(KEYS.preferences)) || {};
        const updated = mutator(current) || current;
        await this._set({ [KEYS.preferences]: updated });
      });
    this._preferencesQueue = next.catch(() => {});
    return next;
  },

  async _enqueueRecentBooksWrite(mutator) {
    const prev = this._recentBooksQueue || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        const recent = (await this._get(KEYS.recentBooks)) || [];
        const updated = mutator(recent.slice()) || recent;
        await this._set({ [KEYS.recentBooks]: updated });
      });
    this._recentBooksQueue = next.catch(() => {});
    return next;
  },

  async _enqueueBookMetaWrite(bookId, mutator, createIfMissing = true) {
    return this._enqueueBookMetaTask(bookId, async () => {
      const existing = await this._get(KEYS.bookMeta(bookId));
      if (!existing && !createIfMissing) return;

      let shouldRemoveLegacy = false;
      let current = existing;
      if (!current) {
        const legacy = await this._getLegacyBookMeta(bookId);
        current = legacy || this._createDefaultBookMeta();
        shouldRemoveLegacy = !!legacy;
      }

      if (this._deletingBookIds.has(bookId)) return;
      const updated = mutator(current) || current;
      await this._set({ [KEYS.bookMeta(bookId)]: updated });
      if (shouldRemoveLegacy) this._removeLegacyBookMetaKeys(bookId).catch(() => {});
    });
  },

  async _enqueueBookMetaTask(bookId, task) {
    if (this._deletingBookIds.has(bookId)) return undefined;
    let result;
    const prev = this._bookMetaQueue.get(bookId) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        if (this._deletingBookIds.has(bookId)) return;
        result = await task();
      });
    const queued = next
      .catch(() => {})
      .finally(() => {
        if (this._bookMetaQueue.get(bookId) === queued) this._bookMetaQueue.delete(bookId);
      });
    this._bookMetaQueue.set(bookId, queued);
    await next;
    return result;
  },

  async _migrateLegacyBookMeta(bookId) {
    return this._enqueueBookMetaTask(bookId, async () => {
      const existing = await this._get(KEYS.bookMeta(bookId));
      if (existing) {
        this._removeLegacyBookMetaKeys(bookId).catch(() => {});
        return existing;
      }
      const migrated = await this._getLegacyBookMeta(bookId);
      if (!migrated) return null;
      await this._set({ [KEYS.bookMeta(bookId)]: migrated });
      this._removeLegacyBookMetaKeys(bookId).catch(() => {});
      return migrated;
    });
  },

  async _getLegacyBookMeta(bookId) {
    const [pos, time] = await Promise.all([
      this._get(KEYS.legacyPosition(bookId)),
      this._get(KEYS.legacyReadingTime(bookId))
    ]);
    if (!pos && (typeof time !== 'number')) return null;
    return {
      pos:   pos || null,
      time:  (typeof time === 'number') ? time : 0,
      speed: this._createDefaultSpeed()
    };
  },

  _createDefaultBookMeta() {
    return {
      pos: null,
      time: 0,
      speed: this._createDefaultSpeed()
    };
  },

  _createDefaultSpeed() {
    return { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 };
  },

  _removeLegacyBookMetaKeys(bookId) {
    return this._remove([KEYS.legacyPosition(bookId), KEYS.legacyReadingTime(bookId)]);
  },

  async _drainBookMetaQueue(bookId) {
    const pending = this._bookMetaQueue.get(bookId);
    if (!pending) return;
    try {
      await pending;
    } catch (_) {}
  }
};
