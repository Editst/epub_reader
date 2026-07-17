'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// ────────────────────────────────────────────────────────────────────────────
// BUG-2: saveReadingSpeed — `||` treats legitimate 0 as falsy.
// 显式重置速度采样时必须用 `??` 区分 0 与缺失字段。
// ────────────────────────────────────────────────────────────────────────────

test.describe('BUG-2: saveReadingSpeed preserves explicit zero values', () => {
  test.beforeEach(() => { if (global.resetAll) global.resetAll(); });

  test.it('sampledSeconds=0 and sampledProgress=0 must be written, not skipped', async () => {
    const bookId = 'book_zero_speed';

    // Seed with non-zero speed data
    await EpubStorage.saveReadingSpeed(bookId, {
      sampledSeconds:  120,
      sampledProgress: 0.05
    });

    // Now reset speed to all zeros — this is a legitimate operation
    await EpubStorage.saveReadingSpeed(bookId, {
      sampledSeconds:  0,
      sampledProgress: 0
    });

    const meta = await EpubStorage.getBookMeta(bookId);
    assert.strictEqual(meta.speed.sampledSeconds,  0, 'sampledSeconds should be 0, not 120');
    assert.strictEqual(meta.speed.sampledProgress, 0, 'sampledProgress should be 0, not 0.05');
  });

  test.it('non-zero values still write correctly', async () => {
    const bookId = 'book_nonzero_speed';

    await EpubStorage.saveReadingSpeed(bookId, {
      sampledSeconds:  60,
      sampledProgress: 0.02
    });

    const meta = await EpubStorage.getBookMeta(bookId);
    assert.strictEqual(meta.speed.sampledSeconds,  60);
    assert.strictEqual(meta.speed.sampledProgress, 0.02);
  });

  test.it('正文计数 patch 保留已有速度，后续速度 patch 也保留正文计数', async () => {
    const bookId = 'book_speed_patch';
    await EpubStorage.saveReadingSpeed(bookId, {
      sampledSeconds: 300,
      sampledProgress: 0.15
    });
    await EpubStorage.saveReadingSpeed(bookId, {
      contentUnitCount: 24000,
      contentUnitVersion: 1
    });
    await EpubStorage.saveReadingSpeed(bookId, {
      sampledSeconds: 360,
      sampledProgress: 0.18
    });

    const speed = await EpubStorage.getReadingSpeed(bookId);
    assert.equal(speed.sampledSeconds, 360);
    assert.equal(speed.sampledProgress, 0.18);
    assert.equal(speed.contentUnitCount, 24000);
    assert.equal(speed.contentUnitVersion, 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// BUG-3: getAllHighlights — reads entire storage with _getAll(), then
// redundantly calls _get('highlights_<bookId>') per book.
//
// After fix, _get should NOT be called for highlights_ keys — the data
// should come directly from the allItems result.
// ────────────────────────────────────────────────────────────────────────────

test.describe('BUG-3: getAllHighlights avoids redundant per-book reads', () => {
  test.beforeEach(() => { if (global.resetAll) global.resetAll(); });

  test.it('does not call _get for individual highlights_ keys after _getAll', async () => {
    const bookId1 = 'book_hl_1';
    const bookId2 = 'book_hl_2';

    // Seed data
    await EpubStorage.addRecentBook({ id: bookId1, title: 'A', author: '', filename: 'a.epub' });
    await EpubStorage.addRecentBook({ id: bookId2, title: 'B', author: '', filename: 'b.epub' });
    await EpubStorage.saveHighlights(bookId1, [{ cfi: 'c1', text: 'hi', color: '#ff0', note: '', timestamp: 1 }]);
    await EpubStorage.saveHighlights(bookId2, [{ cfi: 'c2', text: 'lo', color: '#0f0', note: '', timestamp: 2 }]);

    // Spy on _get calls
    const originalGet = EpubStorage._get.bind(EpubStorage);
    const getCalls = [];
    EpubStorage._get = async function(key) {
      getCalls.push(key);
      return originalGet(key);
    };

    try {
      const result = await EpubStorage.getAllHighlights();

      // Should still return correct data
      assert.ok(result[bookId1], 'book1 highlights should be present');
      assert.ok(result[bookId2], 'book2 highlights should be present');
      assert.strictEqual(result[bookId1].length, 1);
      assert.strictEqual(result[bookId2].length, 1);

      // Should NOT have called _get for individual highlights_ keys
      const highlightGetCalls = getCalls.filter(k => k.startsWith('highlights_'));
      assert.strictEqual(highlightGetCalls.length, 0,
        `Expected 0 individual highlights_ _get calls, got ${highlightGetCalls.length}: ${highlightGetCalls.join(', ')}`);
    } finally {
      EpubStorage._get = originalGet;
    }
  });
});
