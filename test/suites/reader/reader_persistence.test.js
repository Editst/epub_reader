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

  test.it('schedulePositionSave 立即保存首个位置并 debounce 最后位置', async () => {
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

    const persistence = ReaderPersistence.createReaderPersistence({ state, ui: { updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} } });
    persistence.schedulePositionSave('book-1', 'cfi-1', 10);
    persistence.schedulePositionSave('book-1', 'cfi-2', 20);

    assert.equal(scheduled.size, 1);
    scheduled.values().next().value();
    await Promise.resolve();

    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    EpubStorage.savePosition = originalSavePosition;

    assert.deepEqual(saves, [
      ['book-1', 'cfi-1', 10],
      ['book-1', 'cfi-2', 20]
    ]);
  });

  test.it('schedulePositionSave 会立即启动最新位置持久化', async () => {
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

    const persistence = ReaderPersistence.createReaderPersistence({ state, ui: { updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} } });
    persistence.schedulePositionSave('book-live', 'epubcfi(/6/10)', 42.1);
    await Promise.resolve();

    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    EpubStorage.savePosition = originalSavePosition;

    assert.deepEqual(saves, [['book-live', 'epubcfi(/6/10)', 42.1]]);
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

    const persistence = ReaderPersistence.createReaderPersistence({ state, ui: { updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} } });
    await persistence.flushPositionSave();

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
    let chapterTitle = '';
    let bookmarkState = null;
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
      updateReadingStats() {},
      updateChapterTitle(title) { chapterTitle = title; },
      updateBookmarkButtonState(isBookmarked) { bookmarkState = isBookmarked; },
      updateReadingStatsText() {}
    };
    const persistence = ReaderPersistence.createReaderPersistence({ state, ui });
    persistence.updateReadingStats = () => {};

    persistence.onRelocated({ start: { cfi: 'epubcfi(/6/2)', href: 'chapter1.xhtml' } });
    await Promise.resolve();

    assert.deepEqual(updates, [23]);
    assert.equal(state.currentStableCfi, 'epubcfi(/6/2)');
    assert.equal(chapterTitle, '第一章');
    assert.deepEqual(global.TOC.setActiveCalls, ['chapter1.xhtml']);
    assert.equal(bookmarkState, true);
  });

  test.it('onRelocated 分页模式保存 start.cfi 与 displayed-page locator，不再保存 end.cfi', async () => {
    const { document } = createMockDocument(['chapter-title']);
    global.document = document;
    global.Bookmarks = { async isBookmarked() { return false; } };

    const positionCalls = [];
    const originalSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async (...args) => {
      positionCalls.push(args);
    };

    const state = {
      isResizing: false,
      isRestoringPosition: false,
      currentBookId: 'book-paginated-anchor',
      currentStableCfi: null,
      lastPercent: null,
      lastProgress: 0.1,
      sessionStart: null,
      isBookLoaded: true,
      prefs: { layout: 'paginated' },
      book: {
        locations: {
          length: () => 100,
          percentageFromCfi() { return 0.30; }
        },
        navigation: { toc: [] }
      },
      rendition: {
        currentLocation() {
          return {
            start: { cfi: 'epubcfi(/6/8!/4/2)', href: 'chapter.xhtml' },
            end: { cfi: 'epubcfi(/6/8!/4/20)', href: 'chapter.xhtml' }
          };
        }
      }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateProgress() {}, updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });

    persistence.onRelocated({
      start: {
        index: 3,
        cfi: 'epubcfi(/6/8!/4/2)',
        href: 'chapter.xhtml',
        displayed: { page: 5, total: 12 }
      },
      end: {
        index: 3,
        cfi: 'epubcfi(/6/8!/4/20)',
        href: 'chapter.xhtml',
        displayed: { page: 5, total: 12 }
      }
    });
    await Promise.resolve();

    EpubStorage.savePosition = originalSavePosition;

    assert.equal(state.currentStableCfi, 'epubcfi(/6/8!/4/2)');
    assert.equal(state.lastPercent, 30);
    assert.equal(state.currentStableLocator.strategy, 'epubjs-displayed-page-v1');
    assert.equal(state.currentStableLocator.index, 3);
    assert.equal(state.currentStableLocator.href, 'chapter.xhtml');
    assert.equal(state.currentStableLocator.page, 5);
    assert.deepEqual(positionCalls, [[
      'book-paginated-anchor',
      'epubcfi(/6/8!/4/2)',
      30,
      state.currentStableLocator
    ]]);
  });

  test.it('flushPositionSave 关闭/刷新前从 currentLocation 重建 start.cfi 与 locator', async () => {
    const state = {
      posTimer: 9,
      currentBookId: 'book-flush-sample',
      currentStableCfi: 'epubcfi(/6/6!/4/2)',
      lastPercent: 20,
      currentStableLocator: null,
      isRestoringPosition: false,
      isResizing: false,
      prefs: { layout: 'paginated' },
      book: {
        locations: {
          length: () => 100,
          percentageFromCfi() { return 0.30; }
        }
      },
      rendition: {
        currentLocation() {
          return {
            start: {
              index: 3,
              cfi: 'epubcfi(/6/8!/4/2)',
              href: 'chapter.xhtml',
              displayed: { page: 5, total: 12 }
            },
            end: {
              index: 3,
              cfi: 'epubcfi(/6/8!/4/20)',
              href: 'chapter.xhtml',
              displayed: { page: 5, total: 12 }
            }
          };
        }
      }
    };
    const originalClearTimeout = global.clearTimeout;
    const originalSavePosition = EpubStorage.savePosition;
    const saves = [];

    global.clearTimeout = () => {};
    EpubStorage.savePosition = async (...args) => {
      saves.push(args);
    };

    const persistence = ReaderPersistence.createReaderPersistence({ state, ui: { updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} } });
    await persistence.flushPositionSave();

    global.clearTimeout = originalClearTimeout;
    EpubStorage.savePosition = originalSavePosition;

    assert.equal(state.currentStableCfi, 'epubcfi(/6/8!/4/2)');
    assert.equal(state.lastPercent, 30);
    assert.equal(state.currentStableLocator.page, 5);
    assert.deepEqual(saves, [[
      'book-flush-sample',
      'epubcfi(/6/8!/4/2)',
      30,
      state.currentStableLocator
    ]]);
  });

  test.it('flushPositionSave 在恢复锚点保护期不使用 currentLocation 漂移 CFI 覆盖', async () => {
    const savedLocator = {
      strategy: 'epubjs-displayed-page-v1',
      layout: 'paginated',
      href: 'chapter.xhtml',
      index: 3,
      page: 5,
      total: 12
    };
    const state = {
      posTimer: 9,
      currentBookId: 'book-restore-refresh',
      currentStableCfi: 'epubcfi(/6/10!/4/20)',
      lastPercent: 42,
      currentStableLocator: savedLocator,
      isRestoreAnchorProtected: true,
      isRestoringPosition: false,
      isResizing: false,
      prefs: { layout: 'paginated' },
      book: {
        locations: {
          length: () => 100,
          percentageFromCfi() { return 0.38; }
        }
      },
      rendition: {
        currentLocation() {
          return {
            start: {
              index: 3,
              cfi: 'epubcfi(/6/8!/4/2)',
              href: 'chapter.xhtml',
              displayed: { page: 4, total: 12 }
            }
          };
        }
      }
    };
    const originalClearTimeout = global.clearTimeout;
    const originalSavePosition = EpubStorage.savePosition;
    const saves = [];

    global.clearTimeout = () => {};
    EpubStorage.savePosition = async (...args) => {
      saves.push(args);
    };

    const persistence = ReaderPersistence.createReaderPersistence({ state, ui: {} });
    await persistence.flushPositionSave();

    global.clearTimeout = originalClearTimeout;
    EpubStorage.savePosition = originalSavePosition;

    assert.equal(state.currentStableCfi, 'epubcfi(/6/10!/4/20)');
    assert.equal(state.lastPercent, 42);
    assert.deepEqual(saves, [[
      'book-restore-refresh',
      'epubcfi(/6/10!/4/20)',
      42,
      savedLocator
    ]]);
  });

  test.it('onRelocated 在恢复锚点保护期只更新 UI，不落盘漂移 CFI', async () => {
    const { document } = createMockDocument(['chapter-title']);
    global.document = document;
    global.Bookmarks = { async isBookmarked() { return false; } };

    const positionCalls = [];
    const progressCalls = [];
    const originalSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async (...args) => { positionCalls.push(args); };

    const state = {
      isResizing: false,
      isRestoringPosition: false,
      isRestoreAnchorProtected: true,
      currentBookId: 'book-restore-relocated',
      currentStableCfi: 'epubcfi(/6/10!/4/20)',
      lastPercent: 42,
      lastProgress: 0.42,
      sessionStart: null,
      isBookLoaded: true,
      prefs: { layout: 'paginated' },
      book: {
        locations: {
          length: () => 100,
          percentageFromCfi() { return 0.38; }
        },
        navigation: { toc: [] }
      },
      rendition: {
        currentLocation() {
          return {
            start: {
              cfi: 'epubcfi(/6/8!/4/2)',
              href: 'chapter.xhtml',
              displayed: { page: 4, total: 12 }
            }
          };
        }
      }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: {
        updateProgress(percent) { progressCalls.push(percent); },
        updateChapterTitle() {},
        updateBookmarkButtonState() {},
        updateReadingStatsText() {}
      }
    });

    persistence.onRelocated({
      start: {
        cfi: 'epubcfi(/6/8!/4/2)',
        href: 'chapter.xhtml',
        displayed: { page: 4, total: 12 }
      }
    });
    await Promise.resolve();

    EpubStorage.savePosition = originalSavePosition;

    assert.deepEqual(progressCalls, [38]);
    assert.equal(state.currentStableCfi, 'epubcfi(/6/10!/4/20)');
    assert.equal(state.lastPercent, 42);
    assert.deepEqual(positionCalls, []);
  });

  test.it('onRelocated 在 scrolled 模式保存 start.cfi locator 且不依赖 displayed page 校正', async () => {
    const { document } = createMockDocument(['chapter-title']);
    global.document = document;
    global.Bookmarks = { async isBookmarked() { return false; } };

    const positionCalls = [];
    const originalSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async (...args) => { positionCalls.push(args); };

    const state = {
      isResizing: false,
      isRestoringPosition: false,
      currentBookId: 'book-scrolled-anchor',
      currentStableCfi: null,
      lastPercent: null,
      lastProgress: 0.1,
      sessionStart: null,
      isBookLoaded: true,
      prefs: { layout: 'scrolled' },
      book: {
        locations: { length: () => 100, percentageFromCfi: () => 0.45 },
        navigation: { toc: [] }
      },
      rendition: { currentLocation() { return null; } }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateProgress() {}, updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });

    persistence.onRelocated({
      start: { index: 4, cfi: 'epubcfi(/6/12!/4/2)', href: 'chapter.xhtml' },
      end: { index: 4, cfi: 'epubcfi(/6/12!/4/80)', href: 'chapter.xhtml' }
    });
    await Promise.resolve();

    EpubStorage.savePosition = originalSavePosition;

    assert.equal(state.currentStableCfi, 'epubcfi(/6/12!/4/2)');
    assert.equal(state.currentStableLocator.layout, 'scrolled');
    assert.equal(state.currentStableLocator.page, null);
    assert.deepEqual(positionCalls, [[
      'book-scrolled-anchor',
      'epubcfi(/6/12!/4/2)',
      45,
      state.currentStableLocator
    ]]);
  });

  test.it('updateReadingStats 在索引未就绪时显示 ETA 降级文案', () => {
    const { document } = createMockDocument(['progress-time', 'progress-location']);
    global.document = document;

    const locationStatusCalls = [];
    let statsText = '';
    const state = {
      activeReadingSeconds: 45,
      locationsStatus: 'pending',
      book: {
        locations: {
          length: () => 0
        }
      },
      rendition: {
        currentLocation() {
          return { start: { cfi: 'epubcfi(/6/2)' } };
        }
      }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: {
        updateChapterTitle() {}, updateBookmarkButtonState() {},
        updateReadingStatsText(text) { statsText = text; },
        setLocationIndexStatus(status, detail) {
          locationStatusCalls.push([status, detail]);
        }
      }
    });

    persistence.updateReadingStats();

    assert.match(statsText, /阅读时长: 45秒 \| 预计剩余: --/);
    assert.deepEqual(locationStatusCalls, [['pending', '阅读定位索引生成中']]);
  });

  test.it('updateReadingStats 在索引失败时保留阅读并显示失败状态', () => {
    const { document } = createMockDocument(['progress-time', 'progress-location']);
    global.document = document;

    const locationStatusCalls = [];
    const state = {
      activeReadingSeconds: 90,
      locationsStatus: 'failed',
      book: {
        locations: {
          length: () => 0
        }
      },
      rendition: {
        currentLocation() {
          return { start: { cfi: 'epubcfi(/6/3)' } };
        }
      }
    };

    let statsText = '';
    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: {
        updateChapterTitle() {}, updateBookmarkButtonState() {},
        updateReadingStatsText(text) { statsText = text; },
        setLocationIndexStatus(status, detail) {
          locationStatusCalls.push([status, detail]);
        }
      }
    });

    persistence.updateReadingStats();

    assert.match(statsText, /阅读时长: 1分钟 \| 预计剩余: --/);
    assert.deepEqual(locationStatusCalls, [['failed', '阅读定位索引不可用']]);
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

  test.it('onRelocated 正常阅读时从 rendition.currentLocation() 重采样 CFI', async () => {
    const { document } = createMockDocument(['chapter-title']);
    global.document = document;
    global.Bookmarks = { async isBookmarked() { return false; } };

    const positionCalls = [];
    const originalSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async (...args) => { positionCalls.push(args); };

    const state = {
      isResizing: false,
      isRestoringPosition: false,
      currentBookId: 'book-resample',
      currentStableCfi: null,
      lastPercent: null,
      lastProgress: 0,
      sessionStart: null,
      isBookLoaded: true,
      prefs: { layout: 'paginated' },
      book: {
        locations: {
          length: () => 100,
          percentageFromCfi() { return 0.50; }
        },
        navigation: { toc: [] }
      },
      rendition: {
        currentLocation() {
          return {
            start: { cfi: 'epubcfi(/6/10)', href: 'ch2.xhtml' },
            end: { cfi: 'epubcfi(/6/12)', href: 'ch2.xhtml' }
          };
        }
      }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateProgress() {}, updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });

    // relocated 事件参数传入一个「旧」CFI，rendition.currentLocation() 返回「新」CFI
    persistence.onRelocated({
      start: {
        cfi: 'epubcfi(/6/8)',
        href: 'ch1.xhtml',
        displayed: { page: 4, total: 12 }
      },
      end: {
        cfi: 'epubcfi(/6/10)',
        href: 'ch1.xhtml',
        displayed: { page: 4, total: 12 }
      }
    });
    await Promise.resolve();

    EpubStorage.savePosition = originalSavePosition;

    // 应使用 rendition.currentLocation() 的 CFI，而非事件参数的 CFI
    assert.equal(state.currentStableCfi, 'epubcfi(/6/10)');
    assert.equal(state.currentStableLocator.href, 'ch2.xhtml');
    assert.equal(state.currentStableLocator.page, null);
    assert.equal(positionCalls.length, 1);
    assert.equal(positionCalls[0][1], 'epubcfi(/6/10)');
    assert.equal(positionCalls[0][3].href, 'ch2.xhtml');
  });

  test.it('CFI 未变时不触发 savePosition', async () => {
    const { document } = createMockDocument(['chapter-title']);
    global.document = document;
    global.Bookmarks = { async isBookmarked() { return false; } };

    const positionCalls = [];
    const originalSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async (...args) => { positionCalls.push(args); };

    const state = {
      isResizing: false,
      isRestoringPosition: false,
      currentBookId: 'book-nodup',
      currentStableCfi: 'epubcfi(/6/10)',
      lastPercent: 50,
      lastProgress: 0.5,
      sessionStart: null,
      isBookLoaded: true,
      prefs: { layout: 'paginated' },
      book: {
        locations: {
          length: () => 100,
          percentageFromCfi() { return 0.50; }
        },
        navigation: { toc: [] }
      },
      rendition: {
        currentLocation() {
          return {
            start: { cfi: 'epubcfi(/6/10)', href: 'ch2.xhtml' },
            end: { cfi: 'epubcfi(/6/12)', href: 'ch2.xhtml' }
          };
        }
      }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateProgress() {}, updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });

    // relocated 事件参数 CFI 与 currentLocation().start.cfi 相同
    persistence.onRelocated({
      start: { cfi: 'epubcfi(/6/10)', href: 'ch2.xhtml' },
      end: { cfi: 'epubcfi(/6/12)', href: 'ch2.xhtml' }
    });
    await Promise.resolve();

    EpubStorage.savePosition = originalSavePosition;

    // CFI 未变，不应触发 savePosition
    assert.equal(positionCalls.length, 0);
    assert.equal(state.currentStableCfi, 'epubcfi(/6/10)');
  });

  test.it('mount 注册 beforeunload → flushPositionSave', async () => {
    const { document } = createMockDocument([]);
    const origDoc = global.document;
    global.document = document;

    // Mock window.addEventListener/removeEventListener
    const origWindowAddEventListener = global.window?.addEventListener;
    const origWindowRemoveEventListener = global.window?.removeEventListener;
    const beforeunloadHandlers = [];
    if (!global.window) global.window = global;
    global.window.addEventListener = (type, handler) => {
      if (type === 'beforeunload') beforeunloadHandlers.push(handler);
    };
    global.window.removeEventListener = (type, handler) => {
      if (type === 'beforeunload') {
        const idx = beforeunloadHandlers.indexOf(handler);
        if (idx >= 0) beforeunloadHandlers.splice(idx, 1);
      }
    };

    // Mock EpubStorage.savePosition to detect flush calls
    const saves = [];
    const origSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async (...args) => { saves.push(args); };

    const state = {
      isBookLoaded: true,
      currentBookId: 'book-beforeunload',
      currentStableCfi: 'epubcfi(/6/5)',
      lastPercent: 25,
      lastPositionSave: null,
      posTimer: null
    };
    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateProgress() {}, updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });

    persistence.mount();

    // 模拟 beforeunload 事件
    beforeunloadHandlers.forEach((h) => h());

    persistence.unmount();
    global.document = origDoc;
    if (origWindowAddEventListener) global.window.addEventListener = origWindowAddEventListener;
    if (origWindowRemoveEventListener) global.window.removeEventListener = origWindowRemoveEventListener;
    EpubStorage.savePosition = origSavePosition;

    assert.ok(saves.length > 0, 'beforeunload/unmount 应触发 flushPositionSave → savePosition');
  });

  test.it('mount 只注册生命周期监听，不提前启动阅读计时器', () => {
    const { document } = createMockDocument([]);
    global.document = document;
    const originalSetInterval = global.setInterval;
    const intervalCalls = [];

    global.setInterval = (...args) => {
      intervalCalls.push(args);
      return 1;
    };

    const state = { readingTimer: null, posTimer: null };
    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateProgress() {}, updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });

    persistence.mount();
    persistence.unmount();
    global.setInterval = originalSetInterval;

    assert.equal(intervalCalls.length, 0);
    assert.equal(state.readingTimer, null);
  });

  // ── 架构约束：persistence 层不直接操作 DOM ─────────────────────────────────

  test.it('reader-persistence.js 源码不包含直接 DOM 操作（document.getElementById / textContent / classList）', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/reader/reader-persistence.js', 'utf8');

    // 不应出现 document.getElementById 或直接 textContent/classList 赋值
    assert.ok(!src.includes('document.getElementById'), 'persistence 不应调用 document.getElementById');
    assert.ok(!src.includes('.textContent'), 'persistence 不应直接操作 .textContent');
    assert.ok(!src.includes('.classList'), 'persistence 不应直接操作 .classList');
    assert.ok(!src.includes('style.display'), 'persistence 不应直接操作 style.display');
  });

  test.it('reader-persistence.js onRelocated 通过 ui 委托章节标题更新', async () => {
    const { document } = createMockDocument(['chapter-title']);
    global.document = document;
    global.Bookmarks = { async isBookmarked() { return false; } };

    let chapterTitleArg = null;
    const state = {
      isResizing: false,
      isRestoringPosition: false,
      currentBookId: 'book-ui-delegate',
      currentStableCfi: null,
      lastPercent: null,
      lastProgress: 0,
      sessionStart: null,
      isBookLoaded: true,
      prefs: { layout: 'paginated' },
      book: {
        locations: { length: () => 0 },
        navigation: { toc: [{ href: 'ch1.xhtml', label: ' 第一章 ' }] }
      },
      rendition: {
        currentLocation() {
          return { start: { cfi: 'epubcfi(/6/2)', href: 'ch1.xhtml' } };
        }
      }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: {
        updateProgress() {},
        updateReadingStats() {},
        updateChapterTitle(title) { chapterTitleArg = title; },
        updateBookmarkButtonState() {},
        updateReadingStatsText() {}
      }
    });

    persistence.onRelocated({ start: { cfi: 'epubcfi(/6/2)', href: 'ch1.xhtml' } });
    await Promise.resolve();

    // 章节标题应通过 ui.updateChapterTitle 更新，而非直接操作 DOM
    assert.equal(chapterTitleArg, '第一章');
    // DOM 元素不应被直接修改
    assert.equal(document.getElementById('chapter-title').textContent, '', 'chapter-title 不应被 persistence 直接修改');
  });

  test.it('reader-persistence.js onRelocated 通过 ui 委托书签按钮状态更新', async () => {
    const { document } = createMockDocument(['btn-bookmark']);
    global.document = document;
    global.Bookmarks = { async isBookmarked() { return true; } };

    let bookmarkArg = null;
    const state = {
      isResizing: false,
      isRestoringPosition: false,
      currentBookId: 'book-bookmark-delegate',
      currentStableCfi: null,
      lastPercent: null,
      lastProgress: 0,
      sessionStart: null,
      isBookLoaded: true,
      prefs: { layout: 'paginated' },
      book: {
        locations: { length: () => 0 },
        navigation: { toc: [] }
      },
      rendition: {
        currentLocation() {
          return { start: { cfi: 'epubcfi(/6/2)', href: 'ch.xhtml' } };
        }
      }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: {
        updateProgress() {},
        updateReadingStats() {},
        updateChapterTitle() {},
        updateBookmarkButtonState(isBookmarked) { bookmarkArg = isBookmarked; },
        updateReadingStatsText() {}
      }
    });

    persistence.onRelocated({ start: { cfi: 'epubcfi(/6/2)', href: 'ch.xhtml' } });
    await Promise.resolve();

    // 书签状态应通过 ui.updateBookmarkButtonState 更新
    assert.equal(bookmarkArg, true);
    // DOM 的 classList 不应被 persistence 直接修改
    assert.ok(!document.getElementById('btn-bookmark').classList.contains('active'),
      'btn-bookmark 不应被 persistence 直接修改');
  });

  test.it('reader-persistence.js updateReadingStats 通过 ui 委托统计文本更新', () => {
    const { document } = createMockDocument(['progress-time']);
    global.document = document;

    let statsTextArg = null;
    const state = {
      activeReadingSeconds: 120,
      locationsStatus: 'ready',
      book: {
        locations: {
          length: () => 100,
          percentageFromCfi() { return 0.25; }
        }
      },
      rendition: {
        currentLocation() {
          return { start: { cfi: 'epubcfi(/6/5)' } };
        }
      }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: {
        updateChapterTitle() {},
        updateBookmarkButtonState() {},
        updateReadingStatsText(text) { statsTextArg = text; }
      }
    });

    persistence.updateReadingStats();

    // 统计文本应通过 ui.updateReadingStatsText 更新
    assert.ok(statsTextArg !== null, 'updateReadingStatsText 应被调用');
    assert.ok(statsTextArg.includes('阅读时长'), '统计文本应包含阅读时长');
    // DOM 元素不应被直接修改
    assert.equal(document.getElementById('progress-time').textContent, '',
      'progress-time 不应被 persistence 直接修改');
  });
});
