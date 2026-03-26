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
});
