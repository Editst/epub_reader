'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('EpubStorage 行为覆盖', () => {
  test.beforeEach(() => {
    if (global.resetAll) global.resetAll();
  });

  test.it('savePreferences 在默认值基础上增量合并', async () => {
    const before = await EpubStorage.getPreferences();
    await EpubStorage.savePreferences({ fontSize: 22 });
    const after = await EpubStorage.getPreferences();

    assert.equal(before.theme, 'light');
    assert.equal(after.fontSize, 22);
    assert.equal(after.theme, 'light');
  });

  test.it('损坏的持久化容器类型在存储边界降级为空结构', async () => {
    await new Promise((resolve) => chrome.storage.local.set({
      preferences: 'invalid-preferences',
      recentBooks: [null, 'bad', { title: 'missing id' }, { id: '  ' }, { id: 'valid-book', title: 'Valid' }],
      highlights_corrupt: { cfi: 'not-an-array' },
      bookmarks_corrupt: 'not-an-array',
      bookMeta_corrupt: 'not-an-object',
      bookMeta_nested_corrupt: {
        pos: { cfi: 42, percentage: 999 },
        time: -5,
        speed: { sampledSeconds: -1, sampledProgress: -2, sessions: 'bad', sessionCount: -3 }
      }
    }, resolve));

    const [prefs, recent, highlights, bookmarks, meta] = await Promise.all([
      EpubStorage.getPreferences(),
      EpubStorage.getRecentBooks(),
      EpubStorage.getHighlights('corrupt'),
      EpubStorage.getBookmarks('corrupt'),
      EpubStorage.getBookMeta('corrupt')
    ]);

    assert.equal(prefs.theme, 'light');
    assert.deepEqual(recent, [{ id: 'valid-book', title: 'Valid' }]);
    assert.deepEqual(highlights, []);
    assert.deepEqual(bookmarks, []);
    assert.equal(meta, null);

    const nestedMeta = await EpubStorage.getBookMeta('nested_corrupt');
    assert.deepEqual(nestedMeta, {
      pos: null,
      time: 0,
      speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 }
    });

    await new Promise((resolve) => chrome.storage.local.set({
      highlights_items: [null, { text: 'missing cfi' }, { cfi: 'valid-highlight' }],
      bookmarks_items: ['bad', { chapter: 'missing cfi' }, { cfi: '  ' }, { cfi: 'valid-bookmark' }],
      pos_legacy_corrupt: { cfi: 42 }
    }, resolve));
    assert.deepEqual(await EpubStorage.getHighlights('items'), [{ cfi: 'valid-highlight' }]);
    assert.deepEqual(await EpubStorage.getBookmarks('items'), [{ cfi: 'valid-bookmark' }]);
    assert.equal(await EpubStorage.getBookMeta('legacy_corrupt'), null);

    await EpubStorage.savePosition('corrupt', 'epubcfi(/6/4)', 25);
    assert.equal((await EpubStorage.getPosition('corrupt')).cfi, 'epubcfi(/6/4)');
  });

  test.it('IndexedDB 公开方法通过可注入 gateway 执行生产实现', async () => {
    const originalGateway = EpubStorage._dbGateway;
    const calls = [];
    EpubStorage._dbGateway = {
      async put(store, data) { calls.push(['put', store, data.bookId]); },
      async get(store, key) {
        calls.push(['get', store, key]);
        return store === 'covers' ? { bookId: key, blob: 'cover' } : null;
      },
      async delete(store, key) { calls.push(['delete', store, key]); },
      async getAllMeta() { return []; }
    };

    try {
      await EpubStorage.saveCover('book-gateway', 'blob');
      assert.equal(await EpubStorage.getCover('book-gateway'), 'cover');
      await EpubStorage.removeCover('book-gateway');
    } finally {
      EpubStorage._dbGateway = originalGateway;
    }

    assert.deepEqual(calls, [
      ['put', 'covers', 'book-gateway'],
      ['get', 'covers', 'book-gateway'],
      ['delete', 'covers', 'book-gateway']
    ]);
  });

  test.it('savePreferences 并发增量写入不会互相覆盖', async () => {
    const originalGet = EpubStorage._get;
    const originalSet = EpubStorage._set;
    const memory = {
      preferences: { theme: 'light' }
    };

    EpubStorage._get = async function patchedGet(key) {
      await new Promise((resolve) => setImmediate(resolve));
      return memory[key] ? { ...memory[key] } : undefined;
    };
    EpubStorage._set = async function patchedSet(data) {
      await new Promise((resolve) => setImmediate(resolve));
      Object.assign(memory, data);
    };

    try {
      await Promise.all([
        EpubStorage.savePreferences({ theme: 'dark' }),
        EpubStorage.savePreferences({ homeView: 'list' })
      ]);
    } finally {
      EpubStorage._get = originalGet;
      EpubStorage._set = originalSet;
    }

    assert.equal(memory.preferences.theme, 'dark');
    assert.equal(memory.preferences.homeView, 'list');
  });

  test.it('全局 read-modify-write 队列复用同一实现', () => {
    const source = fs.readFileSync('src/utils/storage.js', 'utf8');

    assert.ok(source.includes('async _enqueueKeyWrite(queueField, key, defaultValue, mutator)'));
    assert.ok(!source.includes('async _enqueuePreferencesWrite('));
    assert.ok(!source.includes('async _enqueueRecentBooksWrite('));
  });

  test.it('addRecentBook 并发写入不会互相覆盖', async () => {
    const originalGet = EpubStorage._get;
    const originalSet = EpubStorage._set;
    const memory = {
      recentBooks: [{ id: 'existing', title: 'Existing' }]
    };

    EpubStorage._get = async function patchedGet(key) {
      await new Promise((resolve) => setImmediate(resolve));
      const value = memory[key];
      return Array.isArray(value) ? value.map((item) => ({ ...item })) : value;
    };
    EpubStorage._set = async function patchedSet(data) {
      await new Promise((resolve) => setImmediate(resolve));
      Object.assign(memory, data);
    };

    try {
      await Promise.all([
        EpubStorage.addRecentBook({ id: 'book-a', title: 'A' }),
        EpubStorage.addRecentBook({ id: 'book-b', title: 'B' })
      ]);
    } finally {
      EpubStorage._get = originalGet;
      EpubStorage._set = originalSet;
    }

    assert.deepEqual(
      memory.recentBooks.map((book) => book.id).sort(),
      ['book-a', 'book-b', 'existing']
    );
  });

  test.it('bookMeta lazy migration 产出完整 speed 默认结构', async () => {
    await new Promise((resolve) => chrome.storage.local.set({
      pos_book_meta_migrate: { cfi: 'epubcfi(/6/2)', percentage: 12.3, timestamp: 1 },
      time_book_meta_migrate: 180
    }, resolve));

    const meta = await EpubStorage.getBookMeta('book_meta_migrate');

    assert.deepEqual(meta, {
      pos: { cfi: 'epubcfi(/6/2)', percentage: 12.3, timestamp: 1 },
      time: 180,
      speed: {
        sampledSeconds: 0,
        sampledProgress: 0,
        sessions: [],
        sessionCount: 0
      }
    });
  });

  test.it('bookMeta lazy migration 与 savePosition 并发时不会回写旧位置', async () => {
    const id = 'book-meta-migrate-race';
    const key = 'bookMeta_' + id;
    const legacyPosKey = 'pos_' + id;
    const legacyTimeKey = 'time_' + id;
    const originalGet = EpubStorage._get;
    const originalSet = EpubStorage._set;
    const originalRemove = EpubStorage._remove;
    const memory = {
      [legacyPosKey]: { cfi: 'epubcfi(/6/2)', percentage: 10, timestamp: 1 },
      [legacyTimeKey]: 180
    };

    EpubStorage._get = async function patchedGet(storageKey) {
      await new Promise((resolve) => setImmediate(resolve));
      return memory[storageKey] ? JSON.parse(JSON.stringify(memory[storageKey])) : undefined;
    };
    EpubStorage._set = async function patchedSet(data) {
      const meta = data[key];
      if (meta?.pos?.cfi === 'epubcfi(/6/2)') {
        await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
      } else {
        await new Promise((resolve) => setImmediate(resolve));
      }
      Object.assign(memory, JSON.parse(JSON.stringify(data)));
    };
    EpubStorage._remove = async function patchedRemove(storageKey) {
      await new Promise((resolve) => setImmediate(resolve));
      [].concat(storageKey).forEach((keyToRemove) => { delete memory[keyToRemove]; });
    };

    try {
      await Promise.all([
        EpubStorage.getBookMeta(id),
        EpubStorage.savePosition(id, 'epubcfi(/6/8)', 55)
      ]);
    } finally {
      EpubStorage._get = originalGet;
      EpubStorage._set = originalSet;
      EpubStorage._remove = originalRemove;
    }

    assert.equal(memory[key].pos.cfi, 'epubcfi(/6/8)');
    assert.equal(memory[key].pos.percentage, 55);
    assert.equal(memory[key].time, 180);
    assert.equal(memory[legacyPosKey], undefined);
    assert.equal(memory[legacyTimeKey], undefined);
  });

  test.it('removeReadingTime 会清除聚合 bookMeta.time 并兼容旧 key', async () => {
    await EpubStorage.saveBookMeta('book-remove-time', {
      pos: null,
      time: 240,
      speed: { sampledSeconds: 10, sampledProgress: 0.02, sessions: [], sessionCount: 1 }
    });
    await new Promise((resolve) => chrome.storage.local.set({ 'time_book-remove-time': 240 }, resolve));

    await EpubStorage.removeReadingTime('book-remove-time');

    const meta = await EpubStorage.getBookMeta('book-remove-time');
    const legacy = await new Promise((resolve) => chrome.storage.local.get(['time_book-remove-time'], resolve));

    assert.equal(meta.time, 0);
    assert.equal(legacy['time_book-remove-time'], undefined);
  });

  test.it('removePosition 与 saveReadingTime 并发时不会互相覆盖', async () => {
    const id = 'book-remove-position-race';
    const key = 'bookMeta_' + id;
    const originalGet = EpubStorage._get;
    const originalSet = EpubStorage._set;
    const memory = {
      [key]: {
        pos: { cfi: 'epubcfi(/6/2)', percentage: 10, timestamp: 1 },
        time: 30,
        speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 }
      }
    };

    EpubStorage._get = async function patchedGet(storageKey) {
      await new Promise((resolve) => setImmediate(resolve));
      return memory[storageKey] ? JSON.parse(JSON.stringify(memory[storageKey])) : undefined;
    };
    EpubStorage._set = async function patchedSet(data) {
      await new Promise((resolve) => setImmediate(resolve));
      Object.assign(memory, JSON.parse(JSON.stringify(data)));
    };

    try {
      await Promise.all([
        EpubStorage.removePosition(id),
        EpubStorage.saveReadingTime(id, 900)
      ]);
    } finally {
      EpubStorage._get = originalGet;
      EpubStorage._set = originalSet;
    }

    const meta = memory[key];
    assert.equal(meta.pos, null);
    assert.equal(meta.time, 900);
  });

  test.it('removeReadingTime 与 savePosition 并发时不会互相覆盖', async () => {
    const id = 'book-remove-time-race';
    const key = 'bookMeta_' + id;
    const originalGet = EpubStorage._get;
    const originalSet = EpubStorage._set;
    const memory = {
      [key]: {
        pos: { cfi: 'epubcfi(/6/2)', percentage: 10, timestamp: 1 },
        time: 300,
        speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 }
      }
    };

    EpubStorage._get = async function patchedGet(storageKey) {
      await new Promise((resolve) => setImmediate(resolve));
      return memory[storageKey] ? JSON.parse(JSON.stringify(memory[storageKey])) : undefined;
    };
    EpubStorage._set = async function patchedSet(data) {
      await new Promise((resolve) => setImmediate(resolve));
      Object.assign(memory, JSON.parse(JSON.stringify(data)));
    };

    try {
      await Promise.all([
        EpubStorage.removeReadingTime(id),
        EpubStorage.savePosition(id, 'epubcfi(/6/8)', 55)
      ]);
    } finally {
      EpubStorage._get = originalGet;
      EpubStorage._set = originalSet;
    }

    const meta = memory[key];
    assert.equal(meta.pos.cfi, 'epubcfi(/6/8)');
    assert.equal(meta.pos.percentage, 55);
    assert.equal(meta.time, 0);
  });

  test.it('saveBookMeta 与 saveReadingTime 并发时遵循同书队列顺序', async () => {
    const id = 'book-save-meta-race';
    const key = 'bookMeta_' + id;
    const originalGet = EpubStorage._get;
    const originalSet = EpubStorage._set;
    const originalRemove = EpubStorage._remove;
    const fullMeta = {
      pos: { cfi: 'epubcfi(/6/10)', percentage: 80, timestamp: 2 },
      time: 20,
      speed: { sampledSeconds: 10, sampledProgress: 0.2, sessions: [], sessionCount: 1 }
    };
    const memory = {
      [key]: {
        pos: { cfi: 'epubcfi(/6/2)', percentage: 10, timestamp: 1 },
        time: 10,
        speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 }
      }
    };

    EpubStorage._get = async function patchedGet(storageKey) {
      await new Promise((resolve) => setImmediate(resolve));
      return memory[storageKey] ? JSON.parse(JSON.stringify(memory[storageKey])) : undefined;
    };
    EpubStorage._set = async function patchedSet(data) {
      const meta = data[key];
      if (meta?.time === 900) {
        await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
      } else {
        await new Promise((resolve) => setImmediate(resolve));
      }
      Object.assign(memory, JSON.parse(JSON.stringify(data)));
    };
    EpubStorage._remove = async function patchedRemove(storageKey) {
      await new Promise((resolve) => setImmediate(resolve));
      [].concat(storageKey).forEach((keyToRemove) => { delete memory[keyToRemove]; });
    };

    try {
      const patchPromise = EpubStorage.saveReadingTime(id, 900);
      const fullWritePromise = EpubStorage.saveBookMeta(id, fullMeta);
      await Promise.all([patchPromise, fullWritePromise]);
    } finally {
      EpubStorage._get = originalGet;
      EpubStorage._set = originalSet;
      EpubStorage._remove = originalRemove;
    }

    assert.deepEqual(memory[key], fullMeta);
  });

  test.it('同一 bookId 的 savePosition 与 saveReadingTime 不会互相覆盖', async () => {
    await Promise.all([
      EpubStorage.savePosition('book-concurrent', 'epubcfi(/6/4)', 25.5),
      EpubStorage.saveReadingTime('book-concurrent', 600)
    ]);

    const meta = await EpubStorage.getBookMeta('book-concurrent');
    assert.equal(meta.pos.cfi, 'epubcfi(/6/4)');
    assert.equal(meta.pos.percentage, 25.5);
    assert.equal(meta.time, 600);
  });

  test.it('savePosition 持久化 displayed-page locator 并兼容旧调用', async () => {
    const locator = {
      strategy: 'epubjs-displayed-page-v1',
      layout: 'paginated',
      href: 'chapter.xhtml',
      index: 3,
      page: 5,
      total: 12
    };

    await EpubStorage.savePosition('book-locator', 'epubcfi(/6/8!/4/2)', 30, locator);
    const withLocator = await EpubStorage.getPosition('book-locator');
    await EpubStorage.savePosition('book-legacy-position', 'epubcfi(/6/2)', 10);
    const legacy = await EpubStorage.getPosition('book-legacy-position');

    assert.equal(withLocator.cfi, 'epubcfi(/6/8!/4/2)');
    assert.equal(withLocator.percentage, 30);
    assert.deepEqual(withLocator.locator, locator);
    assert.equal(legacy.cfi, 'epubcfi(/6/2)');
    assert.equal(legacy.locator, undefined);
  });

  test.it('getAllHighlights 同时覆盖 recentBooks 外的遗留 highlights key', async () => {
    await EpubStorage.addRecentBook({ id: 'book-a', title: 'A' });
    await EpubStorage.saveHighlights('book-a', [{ cfi: 'a' }]);
    await EpubStorage.saveHighlights('book-orphan', [{ cfi: 'orphan' }]);

    const all = await EpubStorage.getAllHighlights();

    assert.deepEqual(Object.keys(all).sort(), ['book-a', 'book-orphan']);
  });

  test.it('高亮与书签的资源锁事务保留并发标签页各自的 CFI 变更', async () => {
    const exclusiveQueues = new Map();
    EpubStorage._lockManager = {
      request(name, options, task) {
        if (options.mode === 'shared') return task();
        const previous = exclusiveQueues.get(name) || Promise.resolve();
        const next = previous.catch(() => {}).then(task);
        exclusiveQueues.set(name, next.catch(() => {}));
        return next;
      }
    };
    const id = 'book-list-transactions';
    await EpubStorage.saveHighlights(id, [{ cfi: 'base', text: 'base' }]);
    await EpubStorage.saveBookmarks(id, [{ cfi: 'base', chapter: 'base' }]);

    await Promise.all([
      EpubStorage.updateHighlights(id, (items) => [...items, { cfi: 'highlight-a', text: 'A' }]),
      EpubStorage.updateHighlights(id, (items) => [...items, { cfi: 'highlight-b', text: 'B' }]),
      EpubStorage.updateBookmarks(id, (items) => [...items, { cfi: 'bookmark-a', chapter: 'A' }]),
      EpubStorage.updateBookmarks(id, (items) => [...items, { cfi: 'bookmark-b', chapter: 'B' }])
    ]);

    assert.deepEqual(
      (await EpubStorage.getHighlights(id)).map((item) => item.cfi).sort(),
      ['base', 'highlight-a', 'highlight-b']
    );
    assert.deepEqual(
      (await EpubStorage.getBookmarks(id)).map((item) => item.cfi).sort(),
      ['base', 'bookmark-a', 'bookmark-b']
    );
  });

  test.it('storage.js 集中声明存储 key 与 IndexedDB store 名称', () => {
    const source = fs.readFileSync('src/utils/storage.js', 'utf8');
    const count = (pattern) => (source.match(pattern) || []).length;

    assert.match(source, /const KEYS = Object\.freeze/);
    assert.match(source, /const STORES = Object\.freeze/);
    assert.match(source, /_bookResourceWrites: new Map\(\)/,
      '非 bookMeta 资源写入也必须进入同书删除协调');
    for (const method of ['saveHighlights', 'saveBookmarks', 'saveCover', 'saveLocations']) {
      const start = source.indexOf(`async ${method}(`);
      const end = source.indexOf('\n  },', start);
      assert.ok(start >= 0 && source.slice(start, end).includes('_runBookResourceWrite'),
        `${method} 必须注册同书资源写入`);
    }
    const storeFileStart = source.indexOf('async storeFile(');
    const storeFileEnd = source.indexOf('\n  },', storeFileStart);
    assert.ok(source.slice(storeFileStart, storeFileEnd).includes('_trackBookResourceWrite'),
      'storeFile 必须在独占导入锁内注册同书资源写入');
    assert.equal(count(/'bookMeta_' \+ bookId/g), 1, 'bookMeta 前缀只能出现在 KEYS 声明中');
    assert.equal(count(/'highlights_' \+ bookId/g), 1, 'highlights 前缀只能出现在 KEYS 声明中');
    assert.equal(count(/'bookmarks_' \+ bookId/g), 1, 'bookmarks 前缀只能出现在 KEYS 声明中');
  });

  test.it('removeBook 会等待同书 bookMeta 写队列，避免删除后回写孤立 meta', async () => {
    const id = 'book-delete-queue';
    const originalSet = EpubStorage._set;
    let releaseSet;
    const setStarted = new Promise((resolve) => {
      EpubStorage._set = async function patchedSet(data) {
        if (Object.prototype.hasOwnProperty.call(data, 'bookMeta_' + id)) {
          resolve();
          await new Promise((release) => { releaseSet = release; });
        }
        return originalSet.call(this, data);
      };
    });

    try {
      const writePromise = EpubStorage.savePosition(id, 'epubcfi(/6/2)', 12.5);
      await setStarted;

      const deletePromise = EpubStorage.removeBook(id);
      releaseSet();
      await Promise.all([writePromise, deletePromise]);

      assert.equal(await EpubStorage.getBookMeta(id), null);
    } finally {
      EpubStorage._set = originalSet;
    }
  });

  test.it('removeBook 会等待同书资源写入，避免删除后回写孤立高亮', async () => {
    const id = 'book-delete-resource-write';
    const originalSet = EpubStorage._set;
    let releaseSet;
    let setStartedResolve;
    const setStarted = new Promise((resolve) => { setStartedResolve = resolve; });

    EpubStorage._set = async function patchedSet(data) {
      if (Object.prototype.hasOwnProperty.call(data, 'highlights_' + id)) {
        setStartedResolve();
        await new Promise((resolve) => { releaseSet = resolve; });
      }
      return originalSet.call(this, data);
    };

    try {
      const writePromise = EpubStorage.saveHighlights(id, [{ cfi: 'late' }]);
      await setStarted;
      const deletePromise = EpubStorage.removeBook(id);
      await new Promise((resolve) => setImmediate(resolve));

      releaseSet();
      await Promise.all([writePromise, deletePromise]);

      assert.deepEqual(await EpubStorage.getHighlights(id), []);
    } finally {
      if (releaseSet) releaseSet();
      EpubStorage._set = originalSet;
    }
  });

  test.it('removeBook 单项失败时等待其余清理结束再释放删除守卫', async () => {
    const id = 'book-delete-partial-failure';
    const originalRemoveCover = EpubStorage.removeCover;
    const originalRemoveFile = EpubStorage.removeFile;
    let releaseFileDelete;
    let fileDeleteStartedResolve;
    const fileDeleteStarted = new Promise((resolve) => { fileDeleteStartedResolve = resolve; });

    EpubStorage.removeCover = async function patchedRemoveCover(bookId) {
      if (bookId === id) throw new Error('simulated cover delete failure');
      return originalRemoveCover.call(this, bookId);
    };
    EpubStorage.removeFile = async function patchedRemoveFile(bookId) {
      if (bookId !== id) return originalRemoveFile.call(this, bookId);
      fileDeleteStartedResolve();
      await new Promise((resolve) => { releaseFileDelete = resolve; });
    };

    try {
      await EpubStorage.savePosition(id, 'epubcfi(/6/2)', 10);

      let deleteSettled = false;
      const deleteResultPromise = EpubStorage.removeBook(id).then(
        () => ({ status: 'fulfilled' }),
        (error) => ({ status: 'rejected', error })
      );
      deleteResultPromise.then(() => { deleteSettled = true; });

      await fileDeleteStarted;
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(deleteSettled, false, '单项失败后仍应等待其余清理任务');
      assert.equal(EpubStorage._deletingBookIds.has(id), true, '其余清理完成前删除守卫必须保留');

      await EpubStorage.savePosition(id, 'epubcfi(/6/8)', 80);
      await EpubStorage.saveHighlights(id, [{ cfi: 'late' }]);
      await EpubStorage.saveBookmarks(id, [{ cfi: 'late' }]);
      await EpubStorage.addRecentBook({ id, title: 'late' });
      releaseFileDelete();

      const result = await deleteResultPromise;
      assert.equal(result.status, 'rejected');
      assert.match(result.error.message, /simulated cover delete failure/);
      assert.equal(EpubStorage._deletingBookIds.has(id), false, '全部清理收口后应释放删除守卫');
      assert.equal(await EpubStorage.getBookMeta(id), null, '删除期间的新位置写入不得重建 bookMeta');
      assert.deepEqual(await EpubStorage.getHighlights(id), [], '删除期间不得重建 highlights');
      assert.deepEqual(await EpubStorage.getBookmarks(id), [], '删除期间不得重建 bookmarks');
      assert.equal((await EpubStorage.getRecentBooks()).some((book) => book.id === id), false,
        '删除期间不得重新加入 recentBooks');
    } finally {
      if (releaseFileDelete) releaseFileDelete();
      EpubStorage.removeCover = originalRemoveCover;
      EpubStorage.removeFile = originalRemoveFile;
      EpubStorage._deletingBookIds.delete(id);
    }
  });

  test.it('removeBook 同书并发调用复用同一删除任务', async () => {
    const id = 'book-delete-deduplicate';
    const originalRemoveFile = EpubStorage.removeFile;
    let removeFileCalls = 0;
    let releaseFileDelete;
    let fileDeleteStartedResolve;
    const fileDeleteStarted = new Promise((resolve) => { fileDeleteStartedResolve = resolve; });
    const fileDeleteGate = new Promise((resolve) => { releaseFileDelete = resolve; });

    EpubStorage.removeFile = async function patchedRemoveFile(bookId) {
      if (bookId !== id) return originalRemoveFile.call(this, bookId);
      removeFileCalls++;
      fileDeleteStartedResolve();
      await fileDeleteGate;
    };

    try {
      const firstDelete = EpubStorage.removeBook(id);
      await fileDeleteStarted;
      const secondDelete = EpubStorage.removeBook(id);
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(removeFileCalls, 1, '同一本书的并发删除不得重复执行级联任务');
      assert.equal(EpubStorage._deletingBookIds.has(id), true, '共享删除任务完成前守卫必须保留');

      releaseFileDelete();
      await Promise.all([firstDelete, secondDelete]);

      assert.equal(removeFileCalls, 1);
      assert.equal(EpubStorage._bookDeleteTasks.has(id), false, '删除完成后应清理任务缓存');
      assert.equal(EpubStorage._deletingBookIds.has(id), false);
    } finally {
      releaseFileDelete();
      EpubStorage.removeFile = originalRemoveFile;
      EpubStorage._bookDeleteTasks?.delete(id);
      EpubStorage._deletingBookIds.delete(id);
    }
  });

  test.it('删除标记阻止其他页面的迟到写入，重新导入后才解除', async () => {
    const id = 'book-cross-context-delete';
    await EpubStorage.storeFile('deleted.epub', new Uint8Array([1]), id);
    await EpubStorage.savePosition(id, 'epubcfi(/6/2)', 10);
    await EpubStorage.saveHighlights(id, [{ cfi: 'before-delete' }]);
    await EpubStorage.addRecentBook({ id, title: 'Before delete' });

    await EpubStorage.removeBook(id);
    assert.ok(await EpubStorage._get('deletedBook_' + id), '删除标记必须跨页面持久化');

    await EpubStorage.savePosition(id, 'epubcfi(/6/8)', 80);
    await EpubStorage.saveReadingTime(id, 600);
    await EpubStorage.saveHighlights(id, [{ cfi: 'late-highlight' }]);
    await EpubStorage.saveBookmarks(id, [{ cfi: 'late-bookmark' }]);
    await EpubStorage.addRecentBook({ id, title: 'Late write' });

    assert.equal(await EpubStorage.getBookMeta(id), null);
    assert.deepEqual(await EpubStorage.getHighlights(id), []);
    assert.deepEqual(await EpubStorage.getBookmarks(id), []);
    assert.equal((await EpubStorage.getRecentBooks()).some((book) => book.id === id), false);

    await EpubStorage.storeFile('reimported.epub', new Uint8Array([2]), id);
    await EpubStorage.savePosition(id, 'epubcfi(/6/10)', 90);
    await EpubStorage.addRecentBook({ id, title: 'Reimported' });

    assert.equal(await EpubStorage._get('deletedBook_' + id), undefined);
    assert.equal((await EpubStorage.getPosition(id)).cfi, 'epubcfi(/6/10)');
    assert.equal((await EpubStorage.getRecentBooks())[0].id, id);
  });

  test.it('Web Locks 对书籍写入、删除和全局读改写使用正确锁模式', async () => {
    const calls = [];
    EpubStorage._lockManager = {
      async request(name, options, task) {
        calls.push([name, options.mode]);
        return task();
      }
    };

    await EpubStorage.savePreferences({ theme: 'dark' });
    await EpubStorage.savePosition('book-locks', 'epubcfi(/6/2)', 10);
    await EpubStorage.removeBook('book-locks');
    await EpubStorage.storeFile('locks.epub', new Uint8Array([1]), 'book-locks');
    await EpubStorage.getFile('book-locks');

    assert.ok(calls.some(([name, mode]) => name.endsWith('key:preferences') && mode === 'exclusive'));
    assert.ok(calls.some(([name, mode]) => name.endsWith('book:book-locks') && mode === 'shared'));
    assert.ok(calls.some(([name, mode]) => name.endsWith('book:book-locks') && mode === 'exclusive'));
    assert.ok(calls.some(([name, mode]) =>
      name.endsWith('resource:book-meta:book-locks') && mode === 'exclusive'));
    assert.ok(calls.some(([name, mode]) =>
      name.endsWith('resource:file:book-locks') && mode === 'exclusive'));
  });

  test.it('删除标记使级联失败遗留的 EPUB 文件对读取方不可见', async () => {
    const id = 'book-tombstoned-file';
    await EpubStorage._dbGateway.put('files', {
      bookId: id,
      filename: 'leftover.epub',
      data: new Uint8Array([1]),
      timestamp: Date.now()
    });
    await EpubStorage._set({ ['deletedBook_' + id]: Date.now() });

    assert.equal(await EpubStorage.getFile(id), null);
    assert.notEqual(await EpubStorage._dbGateway.get('files', id), null,
      '读取屏蔽不应妨碍后续 removeAllBooks 重试清理残留');
  });

  test.it('subscribeBookDeletion 仅转发 local 区域的新删除标记', () => {
    const originalOnChanged = chrome.storage.onChanged;
    let listener = null;
    let removed = null;
    const received = [];
    chrome.storage.onChanged = {
      addListener(callback) { listener = callback; },
      removeListener(callback) { removed = callback; }
    };

    try {
      const unsubscribe = EpubStorage.subscribeBookDeletion((bookId) => received.push(bookId));
      listener({ deletedBook_target: { newValue: 123 } }, 'sync');
      listener({ bookMeta_target: { newValue: {} } }, 'local');
      listener({ deletedBook_target: { oldValue: 123 } }, 'local');
      listener({ deletedBook_target: { newValue: 456 } }, 'local');
      unsubscribe();
      assert.deepEqual(received, ['target']);
      assert.equal(removed, listener);
    } finally {
      chrome.storage.onChanged = originalOnChanged;
    }
  });

  test.it('bookMeta 写入失败不会让内部队列 Promise 继续 reject', async () => {
    const id = 'book-queue-fail';
    const originalSet = EpubStorage._set;
    const originalQueueSet = EpubStorage._bookMetaQueue.set;
    let queuedPromise = null;
    let shouldFail = true;

    EpubStorage._bookMetaQueue.set = function patchedQueueSet(bookId, promise) {
      if (bookId === id) queuedPromise = promise;
      return originalQueueSet.call(this, bookId, promise);
    };
    EpubStorage._set = async function patchedSet(data) {
      if (shouldFail && Object.prototype.hasOwnProperty.call(data, 'bookMeta_' + id)) {
        shouldFail = false;
        throw new Error('simulated bookMeta write failure');
      }
      return originalSet.call(this, data);
    };

    try {
      await assert.rejects(
        () => EpubStorage.savePosition(id, 'epubcfi(/6/2)', 12.5),
        /simulated bookMeta write failure/
      );
      assert.ok(queuedPromise, '内部队列 Promise 应被记录');
      await assert.doesNotReject(
        () => queuedPromise,
        '内部队列 Promise 应吞掉失败，避免派生未处理拒绝'
      );

      await EpubStorage.saveReadingTime(id, 30);
      const meta = await EpubStorage.getBookMeta(id);
      assert.equal(meta.time, 30);
    } finally {
      EpubStorage._set = originalSet;
      EpubStorage._bookMetaQueue.set = originalQueueSet;
      EpubStorage._bookMetaQueue.delete(id);
    }
  });

  test.it('enforceFileLRU 仅淘汰文件缓存并保留阅读数据', async () => {
    const now = Date.now();
    await EpubStorage.addRecentBook({ id: 'newer', title: 'newer' });
    await EpubStorage.addRecentBook({ id: 'older', title: 'older' });
    await EpubStorage.saveBookMeta('newer', { pos: null, time: 20, speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 } });
    await EpubStorage.saveBookMeta('older', { pos: null, time: 10, speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 } });
    await EpubStorage.saveHighlights('older', [{ cfi: 'hl-old' }]);
    await EpubStorage.saveBookmarks('older', [{ cfi: 'bm-old' }]);
    await EpubStorage.saveCover('older', { type: 'image/jpeg' });
    await EpubStorage.saveLocations('older', 'locations-old');

    await EpubStorage._dbGateway.put('files', { bookId: 'older', filename: 'older.epub', data: new Uint8Array([1]), timestamp: now - 1000 });
    await EpubStorage._dbGateway.put('files', { bookId: 'newer', filename: 'newer.epub', data: new Uint8Array([2]), timestamp: now });

    await EpubStorage.enforceFileLRU(1);

    assert.equal(await EpubStorage.getFile('older'), null);
    assert.notEqual(await EpubStorage.getFile('newer'), null);

    const oldMeta = await EpubStorage.getBookMeta('older');
    assert.equal(oldMeta.time, 10);
    assert.deepEqual(await EpubStorage.getHighlights('older'), [{ cfi: 'hl-old' }]);
    assert.deepEqual(await EpubStorage.getBookmarks('older'), [{ cfi: 'bm-old' }]);
    assert.deepEqual(await EpubStorage.getCover('older'), { type: 'image/jpeg' });
    assert.equal(await EpubStorage.getLocations('older'), 'locations-old');
    assert.deepEqual((await EpubStorage.getRecentBooks()).map((book) => book.id).sort(), ['newer', 'older']);
  });

  test.it('getFile 刷新访问时间，使 LRU 保留最近打开的旧缓存', async () => {
    const now = Date.now();
    await EpubStorage._dbGateway.put('files', {
      bookId: 'opened-old', filename: 'old.epub', data: new Uint8Array([1]), timestamp: now - 10_000
    });
    await EpubStorage._dbGateway.put('files', {
      bookId: 'unopened-new', filename: 'new.epub', data: new Uint8Array([2]), timestamp: now
    });
    const originalNow = Date.now;
    Date.now = () => now + 10_000;

    try {
      await EpubStorage.getFile('opened-old');
      await EpubStorage.enforceFileLRU(1);
    } finally {
      Date.now = originalNow;
    }

    assert.notEqual(await EpubStorage.getFile('opened-old'), null);
    assert.equal(await EpubStorage.getFile('unopened-new'), null);
  });

  test.it('removeAllBooks 清理 recentBooks 外的孤立 Chrome 与 IndexedDB 数据', async () => {
    await EpubStorage.addRecentBook({ id: 'recent-book', title: 'Recent' });
    await EpubStorage.saveBookMeta('orphan-meta', {
      pos: null,
      time: 20,
      speed: { sampledSeconds: 0, sampledProgress: 0 }
    });
    await EpubStorage.saveHighlights('orphan-highlight', [{ cfi: 'epubcfi(/6/2)' }]);
    await EpubStorage.saveBookmarks('orphan-bookmark', [{ cfi: 'epubcfi(/6/4)' }]);
    await EpubStorage._set({
      'pos_legacy-position': { cfi: 'epubcfi(/6/6)' },
      'time_legacy-time': 30
    });
    await EpubStorage._dbGateway.put('files', {
      bookId: 'orphan-file', filename: 'orphan.epub', data: new Uint8Array([1]), timestamp: Date.now()
    });
    await EpubStorage._dbGateway.put('covers', { bookId: 'orphan-cover', blob: { type: 'image/jpeg' } });
    await EpubStorage._dbGateway.put('locations', { bookId: 'orphan-locations', json: '[]' });

    assert.deepEqual((await EpubStorage.getAllBookIds()).sort(), [
      'legacy-position',
      'legacy-time',
      'orphan-bookmark',
      'orphan-cover',
      'orphan-file',
      'orphan-highlight',
      'orphan-locations',
      'orphan-meta',
      'recent-book'
    ]);

    await EpubStorage.removeAllBooks();

    const remainingChromeData = await EpubStorage._getAll();
    assert.deepEqual(await EpubStorage.getRecentBooks(), []);
    assert.equal(Object.keys(remainingChromeData).some((key) =>
      Object.values({
        bookMeta: 'bookMeta_', position: 'pos_', time: 'time_',
        highlights: 'highlights_', bookmarks: 'bookmarks_'
      }).some((prefix) => key.startsWith(prefix))
    ), false);
    assert.deepEqual(await EpubStorage._dbGateway.getAll('files'), []);
    assert.deepEqual(await EpubStorage._dbGateway.getAll('covers'), []);
    assert.deepEqual(await EpubStorage._dbGateway.getAll('locations'), []);
  });

  test.it('enforceFileLRU 按时间戳从旧到新排序驱逐（LRU 顺序）', async () => {
    const now = Date.now();
    // 添加3本书，时间戳从旧到新：oldest < middle < newest
    await EpubStorage.addRecentBook({ id: 'oldest', title: 'oldest' });
    await EpubStorage.addRecentBook({ id: 'middle', title: 'middle' });
    await EpubStorage.addRecentBook({ id: 'newest', title: 'newest' });

    await EpubStorage._dbGateway.put('files', { bookId: 'oldest', filename: 'a.epub', data: new Uint8Array([1]), timestamp: now - 3000 });
    await EpubStorage._dbGateway.put('files', { bookId: 'middle', filename: 'b.epub', data: new Uint8Array([2]), timestamp: now - 2000 });
    await EpubStorage._dbGateway.put('files', { bookId: 'newest', filename: 'c.epub', data: new Uint8Array([3]), timestamp: now - 1000 });

    // maxCount=1，只保留最新1本，驱逐 oldest 和 middle
    await EpubStorage.enforceFileLRU(1);

    assert.equal(await EpubStorage.getFile('oldest'), null, '最旧的应被驱逐');
    assert.equal(await EpubStorage.getFile('middle'), null, '次旧的应被驱逐');
    assert.notEqual(await EpubStorage.getFile('newest'), null, '最新的应保留');
    assert.deepEqual(
      (await EpubStorage.getRecentBooks()).map(b => b.id),
      ['newest', 'middle', 'oldest'],
      'recentBooks 应保留完整书架记录'
    );
  });

  test.it('enforceFileLRU 单本淘汰失败不阻塞后续淘汰（错误隔离）', async () => {
    const now = Date.now();
    await EpubStorage.addRecentBook({ id: 'fail-book', title: 'fail' });
    await EpubStorage.addRecentBook({ id: 'ok-book', title: 'ok' });
    await EpubStorage.addRecentBook({ id: 'keep-book', title: 'keep' });

    await EpubStorage.saveBookMeta('fail-book', { pos: null, time: 0, speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 } });
    await EpubStorage.saveBookMeta('ok-book', { pos: null, time: 0, speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 } });
    await EpubStorage.saveBookMeta('keep-book', { pos: null, time: 0, speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 } });

    await EpubStorage._dbGateway.put('files', { bookId: 'fail-book', filename: 'f.epub', data: new Uint8Array([1]), timestamp: now - 1000 });
    await EpubStorage._dbGateway.put('files', { bookId: 'ok-book', filename: 'o.epub', data: new Uint8Array([2]), timestamp: now - 2000 });
    await EpubStorage._dbGateway.put('files', { bookId: 'keep-book', filename: 'k.epub', data: new Uint8Array([3]), timestamp: now });

    const origDelete = EpubStorage._dbGateway.delete;
    EpubStorage._dbGateway.delete = async function patchedDelete(store, bookId) {
      if (store === 'files' && bookId === 'fail-book') {
        throw new Error('simulated file delete failure');
      }
      return origDelete.call(this, store, bookId);
    };

    try {
      // maxCount=1，排序后 newest-first: keep-book, fail-book, ok-book。
      // fail-book 删除失败后，ok-book 仍应继续淘汰。
      await EpubStorage.enforceFileLRU(1);
    } finally {
      EpubStorage._dbGateway.delete = origDelete;
    }

    assert.equal(await EpubStorage.getFile('ok-book'), null, 'ok-book 应被成功驱逐（不被 fail-book 的错误阻塞）');
    assert.notEqual(await EpubStorage.getFile('keep-book'), null, 'keep-book 应保留（最新）');
    assert.notEqual(await EpubStorage.getFile('fail-book'), null, 'fail-book 删除失败时应保留文件');
    assert.deepEqual(
      (await EpubStorage.getRecentBooks()).map(b => b.id),
      ['keep-book', 'ok-book', 'fail-book'],
      'LRU 失败隔离不应改写 recentBooks'
    );
  });

  test.it('enforceFileLRU 文件数未超限时不执行任何淘汰', async () => {
    const now = Date.now();
    await EpubStorage.addRecentBook({ id: 'book-a', title: 'A' });
    await EpubStorage._dbGateway.put('files', { bookId: 'book-a', filename: 'a.epub', data: new Uint8Array([1]), timestamp: now });

    const origDelete = EpubStorage._dbGateway.delete;
    let deleteCalled = false;
    EpubStorage._dbGateway.delete = async function patchedDelete(store, bookId) {
      deleteCalled = true;
      return origDelete.call(this, store, bookId);
    };

    try {
      await EpubStorage.enforceFileLRU(10); // maxCount=10，只有1本不淘汰
    } finally {
      EpubStorage._dbGateway.delete = origDelete;
    }

    assert.equal(deleteCalled, false, '文件数未超限时不应删除文件');
    assert.notEqual(await EpubStorage.getFile('book-a'), null, '文件应保留');
  });

  test.it('enforceFileLRU 串行执行：前一本清理完成后才开始下一本', async () => {
    const now = Date.now();
    const executionLog = [];

    // 创建3本需要淘汰的书
    for (let i = 0; i < 3; i++) {
      const id = `serial-${i}`;
      await EpubStorage.addRecentBook({ id, title: id });
      await EpubStorage.saveBookMeta(id, { pos: null, time: 0, speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 } });
      await EpubStorage._dbGateway.put('files', { bookId: id, filename: `${i}.epub`, data: new Uint8Array([i]), timestamp: now - (3 - i) * 1000 });
    }

    // 保留最新1本（serial-2），驱逐 serial-1 和 serial-0
    // 替换文件删除以记录每个 bookId 的 start/end 事件
    const origDelete = EpubStorage._dbGateway.delete;
    EpubStorage._dbGateway.delete = async function patchedDelete(store, bookId) {
      if (store !== 'files') return origDelete.call(this, store, bookId);
      executionLog.push({ op: 'start', bookId });
      await new Promise(r => setImmediate(r));
      executionLog.push({ op: 'end', bookId });
      return origDelete.call(this, store, bookId);
    };

    try {
      await EpubStorage.enforceFileLRU(1);
    } finally {
      EpubStorage._dbGateway.delete = origDelete;
    }

    // 核心验证：不同 bookId 的操作不能交错。
    // 如果串行，日志应为：[start-0, end-0, start-1, end-1]（无交错）
    // 如果并行，日志可能为：[start-0, start-1, end-0, end-1]（交错）
    const bookIds = executionLog.map(e => e.bookId);
    const uniqueBookIds = [...new Set(bookIds)];

    for (const bid of uniqueBookIds) {
      const indices = bookIds
        .map((id, idx) => ({ id, idx }))
        .filter(e => e.id === bid)
        .map(e => e.idx);
      // 每个 bookId 的 start 和 end 应相邻（中间没有其他 bookId 的事件）
      assert.equal(indices.length, 2, `${bid} 应有 start 和 end 两个事件`);
      assert.equal(
        executionLog[indices[0]].op, 'start',
        `${bid} 第一个事件应是 start`
      );
      assert.equal(
        executionLog[indices[1]].op, 'end',
        `${bid} 第二个事件应是 end`
      );
    }

    // 更强的验证：日志中不应出现 start-A ... start-B ... end-A 的交错模式
    let lastBookId = null;
    for (const entry of executionLog) {
      if (entry.op === 'start' && lastBookId !== null && lastBookId !== entry.bookId) {
        // 新 bookId 的 start 出现，但上一个 bookId 还没 end —— 说明并行了
        const prevEndExists = executionLog.some(
          (e, i) => e.op === 'end' && e.bookId === lastBookId
            && i > executionLog.findIndex(e2 => e2.op === 'start' && e2.bookId === lastBookId)
        );
        // 实际上只要检查前一个 bookId 的 end 是否已出现
        const prevEndIdx = executionLog.findIndex(
          (e, i) => e.op === 'end' && e.bookId === lastBookId
            && i > executionLog.findIndex(e2 => e2.op === 'start' && e2.bookId === lastBookId)
        );
        const currentStartIdx = executionLog.indexOf(entry);
        assert.ok(
          prevEndIdx !== -1 && prevEndIdx < currentStartIdx,
          `串行违规：${entry.bookId} 的 start 出现在 ${lastBookId} 的 end 之前`
        );
      }
      if (entry.op === 'start') lastBookId = entry.bookId;
    }
  });
});
