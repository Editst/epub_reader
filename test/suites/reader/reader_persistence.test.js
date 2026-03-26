'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWindowScript, createMockDocument } = require('../../helpers/browser_env');

loadWindowScript('src/reader/reader-persistence.js');

test.describe('ReaderPersistence', () => {
  const originalDocument = global.document;

  test.beforeEach(() => {
    if (global.resetAll) global.resetAll();
    global.document = originalDocument;
  });

  test.afterEach(() => {
    global.document = originalDocument;
  });

  test.it('schedulePositionSave 仅保存最后一次 debounce 结果', async () => {
    const state = {
      posTimer: null
    };
    const scheduled = new Map();
    let nextTimerId = 1;
    const saves = [];
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const originalSavePosition = EpubStorage.savePosition;

    global.setTimeout = (fn) => {
      const id = nextTimerId++;
      scheduled.set(id, fn);
      return id;
    };
    global.clearTimeout = (id) => {
      scheduled.delete(id);
    };
    EpubStorage.savePosition = async (...args) => {
      saves.push(args);
    };

    const persistence = ReaderPersistence.createReaderPersistence({ state, ui: {} });
    persistence.schedulePositionSave('book-1', 'cfi-1', 10);
    persistence.schedulePositionSave('book-1', 'cfi-2', 20);

    assert.equal(scheduled.size, 1);
    scheduled.values().next().value();
    await Promise.resolve();

    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    EpubStorage.savePosition = originalSavePosition;

    assert.deepEqual(saves, [['book-1', 'cfi-2', 20]]);
  });

  test.it('flushPositionSave 立即落盘 currentStableCfi 与 lastPercent', async () => {
    const state = {
      posTimer: 9,
      currentBookId: 'book-2',
      currentStableCfi: 'epubcfi(/6/4)',
      lastPercent: 33.3
    };
    const originalClearTimeout = global.clearTimeout;
    const originalSavePosition = EpubStorage.savePosition;
    let clearedTimer = null;
    const saves = [];

    global.clearTimeout = (id) => {
      clearedTimer = id;
    };
    EpubStorage.savePosition = async (...args) => {
      saves.push(args);
    };

    const persistence = ReaderPersistence.createReaderPersistence({ state, ui: {} });
    persistence.flushPositionSave();
    await Promise.resolve();

    global.clearTimeout = originalClearTimeout;
    EpubStorage.savePosition = originalSavePosition;

    assert.equal(clearedTimer, 9);
    assert.deepEqual(saves, [['book-2', 'epubcfi(/6/4)', 33.3]]);
  });

  test.it('onRelocated 更新进度、章节标题、TOC 激活与书签按钮状态', async () => {
    const { document } = createMockDocument(['chapter-title', 'btn-bookmark']);
    global.document = document;
    global.TOC = { setActiveCalls: [], setActive(href) { this.setActiveCalls.push(href); } };
    global.Bookmarks = { async isBookmarked() { return true; } };

    const updates = [];
    const state = {
      isResizing: false,
      currentBookId: 'book-3',
      currentStableCfi: null,
      lastPercent: null,
      lastProgress: 0.1,
      sessionStart: { progress: 0.1, timestamp: Date.now() - 60_000 },
      isBookLoaded: true,
      book: {
        locations: {
          length: () => 1,
          percentageFromCfi: () => 0.23
        },
        navigation: {
          toc: [{ href: 'chapter1.xhtml', label: ' 第一章 ' }]
        }
      },
      rendition: {
        currentLocation() {
          return { start: { cfi: 'epubcfi(/6/2)', href: 'chapter1.xhtml' } };
        }
      }
    };
    const ui = {
      updateProgress(percent) {
        updates.push(percent);
      },
      updateReadingStats() {}
    };
    const persistence = ReaderPersistence.createReaderPersistence({ state, ui });
    persistence.updateReadingStats = () => {};

    persistence.onRelocated({ start: { cfi: 'epubcfi(/6/2)', href: 'chapter1.xhtml' } });
    await Promise.resolve();

    assert.deepEqual(updates, [23]);
    assert.equal(state.currentStableCfi, 'epubcfi(/6/2)');
    assert.equal(document.getElementById('chapter-title').textContent, '第一章');
    assert.deepEqual(global.TOC.setActiveCalls, ['chapter1.xhtml']);
    assert.ok(document.getElementById('btn-bookmark').classList.contains('active'));
    assert.equal(document.getElementById('btn-bookmark').title, '移除书签 (B)');
  });

  test.it('visibilitychange 在隐藏时 flush 位置、时长和速度会话，在重新可见时重置起点', async () => {
    const { document } = createMockDocument();
    global.document = document;

    const positionCalls = [];
    const saveTimeCalls = [];
    const speedCalls = [];
    const originalSavePosition = EpubStorage.savePosition;
    const originalSaveReadingTime = EpubStorage.saveReadingTime;
    const originalSaveReadingSpeed = EpubStorage.saveReadingSpeed;
    EpubStorage.savePosition = async (...args) => {
      positionCalls.push(args);
    };
    EpubStorage.saveReadingTime = async (...args) => {
      saveTimeCalls.push(args);
    };
    EpubStorage.saveReadingSpeed = async (...args) => {
      speedCalls.push(args);
    };

    const state = {
      readingTimer: null,
      posTimer: null,
      currentBookId: 'book-4',
      currentStableCfi: 'epubcfi(/6/8)',
      lastPercent: 88.8,
      activeReadingSeconds: 120,
      sessionStart: { progress: 0.4, timestamp: Date.now() - 60_000 },
      lastProgress: 0.5,
      cachedSpeed: { sampledSeconds: 100, sampledProgress: 0.05 },
      isBookLoaded: true
    };
    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: {
        updateProgress() {},
        updateReadingStats() {}
      }
    });

    persistence.mount();
    document.hidden = true;
    document.dispatchEvent('visibilitychange');
    await Promise.resolve();
    document.hidden = false;
    document.dispatchEvent('visibilitychange');
    persistence.unmount();

    EpubStorage.savePosition = originalSavePosition;
    EpubStorage.saveReadingTime = originalSaveReadingTime;
    EpubStorage.saveReadingSpeed = originalSaveReadingSpeed;

    assert.deepEqual(positionCalls, [
      ['book-4', 'epubcfi(/6/8)', 88.8],
      ['book-4', 'epubcfi(/6/8)', 88.8]
    ]);
    assert.deepEqual(saveTimeCalls, [['book-4', 120]]);
    assert.equal(speedCalls.length, 1);
    assert.equal(state.sessionStart.progress, 0.5);
  });
});
