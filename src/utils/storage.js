/**
 * src/utils/storage.js
 * 统一存储抽象层 — 所有持久化操作的唯一入口
 *
 * 当前存储结构（chrome.storage.local）：
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
 * 兼容约束：getBookMeta 首次读取时迁移旧 pos_/time_ key；getAllHighlights
 * 清理旧 highlightKeys 索引。enforceFileLRU 只淘汰 EPUB 文件缓存，保留
 * 进度、书签、标注、封面和 locations。
 */
(function () {
  'use strict';

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
  _dbGateway: DbGateway,
  _preferencesQueue: Promise.resolve(),
  _recentBooksQueue: Promise.resolve(),
  _bookMetaQueue: new Map(),
  _bookResourceWrites: new Map(),
  _bookDeleteTasks: new Map(),
  _deletingBookIds: new Set(),

  // ── Preferences ────────────────────────────────────────────────────────────

  async savePreferences(prefs) {
    if (!this._isRecord(prefs)) return;
    return this._enqueueKeyWrite(
      '_preferencesQueue',
      KEYS.preferences,
      {},
      (current) => ({ ...current, ...prefs })
    );
  },

  async getPreferences() {
    const stored = await this._get(KEYS.preferences);
    return {
      theme:           'light',
      fontSize:        18,
      fontFamily:      '',
      lineHeight:      1.8,
      paragraphIndent: true,
      spread:          'auto',
      layout:          'paginated',
      customBg:        '#ffffff',
      customText:      '#333333',
      homeView:        'grid',
      ...(this._isRecord(stored) ? stored : {})
    };
  },

  // ── Recent Books ────────────────────────────────────────────────────────────

  async addRecentBook(book) {
    if (
      !this._isRecord(book) ||
      typeof book.id !== 'string' ||
      !book.id.trim() ||
      this._deletingBookIds.has(book.id)
    ) return;
    return this._enqueueKeyWrite('_recentBooksQueue', KEYS.recentBooks, [], (recent) => {
      if (this._deletingBookIds.has(book.id)) return recent;
      recent = this._normalizeRecordList(recent, 'id').filter(b => b.id !== book.id);
      recent.unshift({ ...book, lastOpened: Date.now() });
      return recent.slice(0, 20);
    });
  },

  async getRecentBooks() {
    const recent = await this._get(KEYS.recentBooks);
    return this._normalizeRecordList(recent, 'id');
  },

  async removeRecentBook(bookId) {
    return this._enqueueKeyWrite(
      '_recentBooksQueue',
      KEYS.recentBooks,
      [],
      (recent) => this._normalizeRecordList(recent, 'id').filter(b => b.id !== bookId)
    );
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
    const normalized = this._normalizeBookMeta(meta);
    if (normalized) return normalized;

    return this._migrateLegacyBookMeta(bookId);
  },

  async saveBookMeta(bookId, meta) {
    if (!bookId || !this._isRecord(meta)) return;
    const normalized = this._normalizeBookMeta(meta);
    await this._enqueueBookMetaTask(bookId, async () => {
      if (this._deletingBookIds.has(bookId)) return;
      await this._set({ [KEYS.bookMeta(bookId)]: normalized });
      this._removeLegacyBookMetaKeys(bookId).catch(() => {});
    });
  },

  /** Patch 位置字段，由 Reader 的位置事件与生命周期 flush 调用。 */
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

  // ── Reading Speed ────────────────────────────────────────────────────────
  //
  // sampledSeconds / sampledProgress 是当前 ETA 主路径；sessions / sessionCount
  // 作为已持久化的兼容字段保留，当前 Reader 不新增历史 session 列表。
  //
  // ETA 计算：secsPerUnit = sampledSeconds / sampledProgress
  //            remaining = secsPerUnit * (1 - currentProgress) / 60 (分钟)
  //
  // 有效 session 条件（reader-persistence.js flushSpeedSession）：
  //   deltaProgress ∈ (0.001, 0.30)  读了 0.1%–30%
  //   deltaSeconds  > 30              持续 30s 以上
  //   isJump: deltaProgress > 0.05 → weight 0.3，否则 weight 1.0

  async saveReadingSpeed(bookId, speed) {
    if (!bookId || !this._isRecord(speed)) return;
    await this._enqueueBookMetaWrite(bookId, (current) => {
      // 兼容旧的 { sampledSeconds, sampledProgress } 结构。
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
    // 旧 speed 无 sessions/sessionCount 时补默认值。
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
    const highlights = await this._get(KEYS.highlights(bookId));
    return this._normalizeRecordList(highlights, 'cfi');
  },

  async saveHighlights(bookId, highlights) {
    if (!bookId || !Array.isArray(highlights)) return;
    return this._runBookResourceWrite(bookId, () =>
      this._set({ [KEYS.highlights(bookId)]: highlights })
    );
  },

  async removeHighlights(bookId) {
    await this._remove(KEYS.highlights(bookId));
  },

  /**
   * 返回所有书籍的高亮，格式 { [bookId]: highlights[] }。
   *
   * recentBooks 与现存 highlights_* key 共同决定扫描范围，避免孤立标注丢失。
   */
  async getAllHighlights() {
    const books = await this.getRecentBooks();
    const allItems = await this._getAll();
    const result = {};
    const bookIds = new Set(books.map(b => b?.id).filter(Boolean));

    for (const key of Object.keys(allItems || {})) {
      if (key.startsWith(KEY_PREFIXES.highlights)) {
        bookIds.add(key.slice(KEY_PREFIXES.highlights.length));
      }
    }

    for (const bookId of bookIds) {
      const hls = this._normalizeRecordList(allItems[KEYS.highlights(bookId)], 'cfi');
      if (hls.length > 0) result[bookId] = hls;
    }

    this._remove(KEYS.legacyHighlightIndex).catch(() => {});
    return result;
  },

  // ── Bookmarks ─────────────────────────────────────────────────────────────

  async getBookmarks(bookId) {
    const bookmarks = await this._get(KEYS.bookmarks(bookId));
    return this._normalizeRecordList(bookmarks, 'cfi');
  },

  async saveBookmarks(bookId, bookmarks) {
    if (!bookId || !Array.isArray(bookmarks)) return;
    return this._runBookResourceWrite(bookId, () =>
      this._set({ [KEYS.bookmarks(bookId)]: bookmarks })
    );
  },

  async removeBookmarks(bookId) {
    await this._remove(KEYS.bookmarks(bookId));
  },

  // ── Covers (IndexedDB) ────────────────────────────────────────────────────

  async saveCover(bookId, blob) {
    if (!bookId || !blob) return;
    return this._runBookResourceWrite(bookId, () =>
      this._dbGateway.put(STORES.covers, { bookId, blob })
    );
  },

  async getCover(bookId) {
    if (!bookId) return null;
    const record = await this._dbGateway.get(STORES.covers, bookId);
    return record ? record.blob : null;
  },

  async removeCover(bookId) {
    if (!bookId) return;
    return this._dbGateway.delete(STORES.covers, bookId);
  },

  // ── Locations (IndexedDB) ─────────────────────────────────────────────────

  async saveLocations(bookId, locationsJSON) {
    if (!bookId || !locationsJSON) return;
    return this._runBookResourceWrite(bookId, () =>
      this._dbGateway.put(STORES.locations, { bookId, json: locationsJSON, timestamp: Date.now() })
    );
  },

  async getLocations(bookId) {
    if (!bookId) return null;
    const record = await this._dbGateway.get(STORES.locations, bookId);
    return record ? record.json : null;
  },

  async removeLocations(bookId) {
    if (!bookId) return;
    return this._dbGateway.delete(STORES.locations, bookId);
  },

  // ── Files (IndexedDB) ─────────────────────────────────────────────────────

  async storeFile(filename, data, bookId) {
    if (!filename || !data || !bookId) return;
    return this._runBookResourceWrite(bookId, async () => {
      await this._dbGateway.put(STORES.files, { bookId, filename, data, timestamp: Date.now() });
      await this.enforceFileLRU(10);
    });
  },

  async getFile(bookId) {
    if (!bookId) return null;
    return this._dbGateway.get(STORES.files, bookId);
  },

  async removeFile(bookId) {
    if (!bookId) return;
    return this._dbGateway.delete(STORES.files, bookId);
  },

  /**
   * LRU：保留最近 maxCount 本书的文件缓存，驱逐其余。
   *
   * 设计约束：自动淘汰只删除占空间最大的 EPUB 文件缓存。
   * recentBooks、bookMeta、highlights、bookmarks、covers、locations 均保留，
   * 以便用户重新导入同一书籍后继续使用阅读进度、书签和标注。
   * 淘汰串行执行并逐项隔离失败，避免单本失败阻塞后续清理。
   */
  async enforceFileLRU(maxCount = 10) {
    const meta = await this._dbGateway.getAllMeta(STORES.files, ['timestamp']);
    if (meta.length <= maxCount) return;
    meta.sort((a, b) => b.timestamp - a.timestamp);
    const toRemove = meta.slice(maxCount);
    for (const m of toRemove) {
      try {
        await this._dbGateway.delete(STORES.files, m.bookId);
      } catch (e) {
        console.warn('[Storage] enforceFileLRU: failed to remove file cache', m.bookId, e);
      }
    }
  },

  // ── Cascading Delete ──────────────────────────────────────────────────────

  /**
   * 删除一本书的全量数据（7 项并行，全部收口后再释放删除守卫）。
   * 单项失败时仍等待其余清理结束；同书并发调用复用同一删除任务。
   */
  async removeBook(bookId) {
    if (!bookId) return;
    const pending = this._bookDeleteTasks.get(bookId);
    if (pending) return pending;

    const deleteTask = (async () => {
      this._deletingBookIds.add(bookId);
      try {
        await Promise.all([
          this._drainBookMetaQueue(bookId),
          this._drainBookResourceWrites(bookId)
        ]);
        const results = await Promise.allSettled([
          this.removeRecentBook(bookId),
          this.removeBookMeta(bookId),
          this.removeCover(bookId),
          this.removeHighlights(bookId),
          this.removeLocations(bookId),
          this.removeBookmarks(bookId),
          this.removeFile(bookId)
        ]);
        const failure = results.find((result) => result.status === 'rejected');
        if (failure) throw failure.reason;
      } finally {
        this._deletingBookIds.delete(bookId);
      }
    })();

    this._bookDeleteTasks.set(bookId, deleteTask);
    try {
      await deleteTask;
    } finally {
      if (this._bookDeleteTasks.get(bookId) === deleteTask) {
        this._bookDeleteTasks.delete(bookId);
      }
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

  async _enqueueKeyWrite(queueField, key, defaultValue, mutator) {
    const prev = this[queueField] || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        const stored = await this._get(key);
        const expectsArray = Array.isArray(defaultValue);
        const isCompatible = expectsArray
          ? Array.isArray(stored)
          : this._isRecord(stored);
        const current = isCompatible ? stored : defaultValue;
        const mutableValue = Array.isArray(current) ? current.slice() : current;
        const updated = mutator(mutableValue) || mutableValue;
        await this._set({ [key]: updated });
      });
    this[queueField] = next.catch(() => {});
    return next;
  },

  async _enqueueBookMetaWrite(bookId, mutator, createIfMissing = true) {
    return this._enqueueBookMetaTask(bookId, async () => {
      const stored = await this._get(KEYS.bookMeta(bookId));
      const existing = this._normalizeBookMeta(stored);
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

  async _runBookResourceWrite(bookId, task) {
    if (!bookId || this._deletingBookIds.has(bookId)) return undefined;
    let writes = this._bookResourceWrites.get(bookId);
    if (!writes) {
      writes = new Set();
      this._bookResourceWrites.set(bookId, writes);
    }

    const write = Promise.resolve().then(() => {
      if (this._deletingBookIds.has(bookId)) return undefined;
      return task();
    });
    writes.add(write);
    try {
      return await write;
    } finally {
      writes.delete(write);
      if (writes.size === 0 && this._bookResourceWrites.get(bookId) === writes) {
        this._bookResourceWrites.delete(bookId);
      }
    }
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
      const stored = await this._get(KEYS.bookMeta(bookId));
      const existing = this._normalizeBookMeta(stored);
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
    const hasLegacyTime = typeof time === 'number';
    if (!pos && !hasLegacyTime) return null;
    const normalized = this._normalizeBookMeta({
      pos:   pos || null,
      time:  hasLegacyTime ? time : 0,
      speed: this._createDefaultSpeed()
    });
    return normalized && (normalized.pos || hasLegacyTime) ? normalized : null;
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

  _isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  },

  _normalizeRecordList(value, requiredField) {
    if (!Array.isArray(value)) return [];
    return value.filter((item) =>
      this._isRecord(item) &&
      typeof item[requiredField] === 'string' &&
      item[requiredField].trim().length > 0
    );
  },

  _normalizeBookMeta(meta) {
    if (!this._isRecord(meta)) return null;
    const speed = this._isRecord(meta.speed) ? meta.speed : {};
    let pos = null;
    if (this._isRecord(meta.pos) && typeof meta.pos.cfi === 'string' && meta.pos.cfi) {
      pos = {
        ...meta.pos,
        percentage: Number.isFinite(meta.pos.percentage)
          ? Math.min(100, Math.max(0, meta.pos.percentage))
          : null
      };
      if (!this._isRecord(pos.locator)) delete pos.locator;
    }
    return {
      ...meta,
      pos,
      time: Number.isFinite(meta.time) ? Math.max(0, Math.floor(meta.time)) : 0,
      speed: {
        sampledSeconds: Number.isFinite(speed.sampledSeconds) ? Math.max(0, speed.sampledSeconds) : 0,
        sampledProgress: Number.isFinite(speed.sampledProgress) ? Math.max(0, speed.sampledProgress) : 0,
        sessions: Array.isArray(speed.sessions) ? speed.sessions : [],
        sessionCount: Number.isFinite(speed.sessionCount) ? Math.max(0, Math.floor(speed.sessionCount)) : 0
      }
    };
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
  },

  async _drainBookResourceWrites(bookId) {
    const writes = this._bookResourceWrites.get(bookId);
    if (!writes || writes.size === 0) return;
    await Promise.allSettled(Array.from(writes));
  }
};

window.EpubStorage = EpubStorage;
})();
