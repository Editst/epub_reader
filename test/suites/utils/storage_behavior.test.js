'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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

  test.it('enforceFileLRU 驱逐旧文件时级联清理 recentBooks 与 bookMeta', async () => {
    const now = Date.now();
    await EpubStorage.addRecentBook({ id: 'newer', title: 'newer' });
    await EpubStorage.addRecentBook({ id: 'older', title: 'older' });
    await EpubStorage.saveBookMeta('newer', { pos: null, time: 20, speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 } });
    await EpubStorage.saveBookMeta('older', { pos: null, time: 10, speed: { sampledSeconds: 0, sampledProgress: 0, sessions: [], sessionCount: 0 } });

    await EpubStorage._dbGateway.put('files', { bookId: 'older', filename: 'older.epub', data: new Uint8Array([1]), timestamp: now - 1000 });
    await EpubStorage._dbGateway.put('files', { bookId: 'newer', filename: 'newer.epub', data: new Uint8Array([2]), timestamp: now });

    await EpubStorage.enforceFileLRU(1);

    assert.equal(await EpubStorage.getFile('older'), null);
    assert.equal(await EpubStorage.getBookMeta('older'), null);
    assert.deepEqual((await EpubStorage.getRecentBooks()).map((book) => book.id), ['newer']);
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
      ['newest'],
      'recentBooks 应只剩最新一本'
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

    await EpubStorage._dbGateway.put('files', { bookId: 'fail-book', filename: 'f.epub', data: new Uint8Array([1]), timestamp: now - 3000 });
    await EpubStorage._dbGateway.put('files', { bookId: 'ok-book', filename: 'o.epub', data: new Uint8Array([2]), timestamp: now - 2000 });
    await EpubStorage._dbGateway.put('files', { bookId: 'keep-book', filename: 'k.epub', data: new Uint8Array([3]), timestamp: now - 1000 });

    // 保存原始 removeRecentBook，替换为会在 fail-book 上抛异常的版本
    const origRemoveRecentBook = EpubStorage.removeRecentBook;
    EpubStorage.removeRecentBook = async (bookId) => {
      if (bookId === 'fail-book') throw new Error('simulated removeRecentBook failure');
      return origRemoveRecentBook.call(EpubStorage, bookId);
    };

    // maxCount=1，排序后 newest-first: keep-book(now-1000), ok-book(now-2000), fail-book(now-3000)
    // slice(1) → [ok-book, fail-book]，应驱逐这两本
    // fail-book 的 removeRecentBook 会抛异常，但不阻塞 ok-book
    await EpubStorage.enforceFileLRU(1);

    EpubStorage.removeRecentBook = origRemoveRecentBook;

    // 关键验证：ok-book 应被成功驱逐（证明错误隔离——fail-book 的失败不阻塞后续淘汰）
    assert.equal(await EpubStorage.getFile('ok-book'), null, 'ok-book 应被成功驱逐（不被 fail-book 的错误阻塞）');
    // keep-book 应保留（最新，未超限）
    assert.notEqual(await EpubStorage.getFile('keep-book'), null, 'keep-book 应保留（最新）');
    // fail-book 的 file 被同步删除（_mockDb.delete 是同步的），但 removeRecentBook 失败
    assert.equal(await EpubStorage.getFile('fail-book'), null, 'fail-book 的 file 应被删除（_mockDb.delete 同步完成）');
  });

  test.it('enforceFileLRU 文件数未超限时不执行任何淘汰', async () => {
    const now = Date.now();
    await EpubStorage.addRecentBook({ id: 'book-a', title: 'A' });
    await EpubStorage._dbGateway.put('files', { bookId: 'book-a', filename: 'a.epub', data: new Uint8Array([1]), timestamp: now });

    const origRemoveRecentBook = EpubStorage.removeRecentBook;
    let removeCalled = false;
    EpubStorage.removeRecentBook = async () => { removeCalled = true; };

    await EpubStorage.enforceFileLRU(10); // maxCount=10，只有1本不淘汰

    EpubStorage.removeRecentBook = origRemoveRecentBook;
    assert.equal(removeCalled, false, '文件数未超限时不应调用 removeRecentBook');
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

    // 保留最新1本（serial-2），驱逐 serial-0 和 serial-1
    // 替换 removeRecentBook 以记录每个 bookId 的 start/end 事件
    const origRemoveRecentBook = EpubStorage.removeRecentBook;
    EpubStorage.removeRecentBook = async (bookId) => {
      executionLog.push({ op: 'start', bookId });
      await new Promise(r => setImmediate(r));
      executionLog.push({ op: 'end', bookId });
      return origRemoveRecentBook.call(EpubStorage, bookId);
    };

    await EpubStorage.enforceFileLRU(1);

    EpubStorage.removeRecentBook = origRemoveRecentBook;

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
