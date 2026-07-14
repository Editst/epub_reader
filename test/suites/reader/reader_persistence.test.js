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

  function createNudgedCfiContent(sourceCfi, nudgedCfi) {
    let textNode = null;
    const doc = {
      createRange() {
        return {
          startContainer: null,
          startOffset: 0,
          setStart(node, offset) {
            this.startContainer = node;
            this.startOffset = offset;
          },
          collapse() {}
        };
      }
    };
    textNode = { nodeType: 3, data: 'abcdef', ownerDocument: doc };
    return {
      document: doc,
      range(cfi) {
        if (cfi !== sourceCfi) return null;
        const range = doc.createRange();
        range.setStart(textNode, 0);
        range.collapse(true);
        return range;
      },
      cfiFromRange(range) {
        return range && range.startContainer === textNode && range.startOffset === 1
          ? nudgedCfi
          : null;
      }
    };
  }

  function createVisibleCfiContent(sourceCfi, nudgedCfi, visibleCfi) {
    let sourceNode = null;
    let visibleNode = null;
    const doc = {
      defaultView: { innerWidth: 800, innerHeight: 600 },
      body: {},
      documentElement: {},
      createRange() {
        return {
          startContainer: null,
          startOffset: 0,
          setStart(node, offset) {
            this.startContainer = node;
            this.startOffset = offset;
          },
          collapse() {}
        };
      },
      caretRangeFromPoint(x, y) {
        if (x !== 600 || y !== 270) return null;
        const range = doc.createRange();
        range.setStart(visibleNode, 3);
        range.collapse(true);
        return range;
      }
    };
    sourceNode = { nodeType: 3, data: 'abcdef', ownerDocument: doc };
    visibleNode = { nodeType: 3, data: 'visible text', ownerDocument: doc };
    return {
      document: doc,
      range(cfi) {
        if (cfi !== sourceCfi) return null;
        const range = doc.createRange();
        range.setStart(sourceNode, 0);
        range.collapse(true);
        return range;
      },
      cfiFromRange(range) {
        if (range && range.startContainer === visibleNode && range.startOffset === 3) return visibleCfi;
        if (range && range.startContainer === sourceNode && range.startOffset === 1) return nudgedCfi;
        return null;
      }
    };
  }

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

  test.it('schedulePositionSave 连续翻页时也立即启动最新位置持久化', async () => {
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

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });
    persistence.schedulePositionSave('book-live', 'epubcfi(/6/10)', 61.3);
    await Promise.resolve();
    persistence.schedulePositionSave('book-live', 'epubcfi(/6/20)', 65.3);
    await Promise.resolve();

    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    EpubStorage.savePosition = originalSavePosition;

    assert.deepEqual(saves, [
      ['book-live', 'epubcfi(/6/10)', 61.3],
      ['book-live', 'epubcfi(/6/20)', 65.3]
    ]);
    assert.equal(scheduled.size, 1);
  });

  test.it('schedulePositionSave 位置保存失败只记录告警，不留下 rejected promise', async () => {
    const state = {
      posTimer: null,
      lastPositionSave: null
    };
    const originalSavePosition = EpubStorage.savePosition;
    const originalWarn = console.warn;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const warnings = [];

    EpubStorage.savePosition = async () => {
      throw new Error('position failed');
    };
    console.warn = (...args) => warnings.push(args);
    global.setTimeout = () => 1;
    global.clearTimeout = () => {};

    try {
      const persistence = ReaderPersistence.createReaderPersistence({
        state,
        ui: { updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
      });
      persistence.schedulePositionSave('book-fail-position', 'epubcfi(/6/2)', 12.3);
      await state.lastPositionSave;
    } finally {
      EpubStorage.savePosition = originalSavePosition;
      console.warn = originalWarn;
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }

    assert.match(String(warnings[0]?.[0] || ''), /save position failed/);
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

  test.it('onRelocated 仅在进度跳跃超过阈值时续期速度会话', () => {
    global.TOC = { setActive() {} };
    global.Bookmarks = { async isBookmarked() { return false; } };
    let progress = 0.12;
    const originalSessionStart = { progress: 0.1, timestamp: Date.now() };
    const state = {
      isResizing: false,
      isRestoringPosition: false,
      currentBookId: 'book-jump-threshold',
      currentStableCfi: null,
      lastPercent: 10,
      lastProgress: 0.1,
      sessionStart: originalSessionStart,
      isBookLoaded: true,
      prefs: { layout: 'paginated' },
      book: {
        locations: {
          length: () => 1,
          percentageFromCfi: () => progress
        },
        navigation: { toc: [] }
      },
      rendition: {
        currentLocation() {
          return { start: { cfi: 'epubcfi(/6/2)', href: 'chapter.xhtml' } };
        }
      }
    };
    const ui = {
      updateProgress() {}, updateChapterTitle() {}, updateBookmarkButtonState() {},
      updateReadingStatsText() {}
    };
    const persistence = ReaderPersistence.createReaderPersistence({ state, ui });

    persistence.onRelocated(state.rendition.currentLocation());
    assert.equal(state.sessionStart, originalSessionStart, '正常翻页不应重启速度会话');

    progress = 0.8;
    persistence.onRelocated(state.rendition.currentLocation());
    assert.notEqual(state.sessionStart, originalSessionStart);
    assert.equal(state.sessionStart.progress, 0.8, '大幅跳转后应从新进度续期');
  });

  test.it('onRelocated 忽略过期的书签状态查询结果', async () => {
    const { document } = createMockDocument(['btn-bookmark']);
    global.document = document;
    global.TOC = { setActive() {} };

    let resolveOldBookmark;
    let currentCfi = 'epubcfi(/6/2)';
    global.Bookmarks = {
      async isBookmarked(cfi) {
        if (cfi === 'epubcfi(/6/2)') {
          return new Promise((resolve) => { resolveOldBookmark = resolve; });
        }
        return false;
      }
    };

    const bookmarkStates = [];
    const state = {
      isResizing: false,
      isRestoringPosition: false,
      currentBookId: 'book-stale-bookmark',
      currentStableCfi: null,
      lastPercent: null,
      isBookLoaded: true,
      book: {
        locations: {
          length: () => 0
        },
        navigation: { toc: [] }
      },
      rendition: {
        currentLocation() {
          return { start: { cfi: currentCfi, href: 'chapter.xhtml' } };
        }
      }
    };
    const ui = {
      updateProgress() {},
      updateReadingStats() {},
      updateChapterTitle() {},
      updateBookmarkButtonState(isBookmarked) { bookmarkStates.push(isBookmarked); },
      updateReadingStatsText() {}
    };
    const persistence = ReaderPersistence.createReaderPersistence({ state, ui });

    persistence.onRelocated({ start: { cfi: 'epubcfi(/6/2)', href: 'chapter.xhtml' } });
    currentCfi = 'epubcfi(/6/4)';
    persistence.onRelocated({ start: { cfi: 'epubcfi(/6/4)', href: 'chapter.xhtml' } });
    await Promise.resolve();

    resolveOldBookmark(true);
    await Promise.resolve();

    assert.deepEqual(bookmarkStates, [false]);
  });

  test.it('onRelocated 分页模式保存 start.cfi，并把页内恢复锚点写入 locator', async () => {
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
          percentageFromCfi(cfi) {
            if (cfi === 'epubcfi(/6/8!/4/2)') return 0.30;
            if (cfi === 'epubcfi(/6/8!/4/10)') return 0.90;
            return 0;
          }
        },
        navigation: { toc: [] }
      },
      rendition: {
        getContents() {
          return [createNudgedCfiContent('epubcfi(/6/8!/4/2)', 'epubcfi(/6/8!/4/10)')];
        },
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
    assert.equal(state.currentStableLocator.sourceCfi, 'epubcfi(/6/8!/4/2)');
    assert.equal(state.currentStableLocator.restoreCfi, 'epubcfi(/6/8!/4/10)');
    assert.deepEqual(positionCalls, [[
      'book-paginated-anchor',
      'epubcfi(/6/8!/4/2)',
      30,
      state.currentStableLocator
    ]]);
  });

  test.it('onRelocated 分页模式优先用当前可视区域生成恢复锚点', async () => {
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
      currentBookId: 'book-visible-anchor',
      currentStableCfi: null,
      lastPercent: null,
      lastProgress: 0.1,
      sessionStart: null,
      isBookLoaded: true,
      prefs: { layout: 'paginated' },
      book: {
        locations: {
          length: () => 100,
          percentageFromCfi() { return 0.653; }
        },
        navigation: { toc: [] }
      },
      rendition: {
        getContents() {
          return [createVisibleCfiContent(
            'epubcfi(/6/22!/4/180/1:0)',
            'epubcfi(/6/22!/4/180/1:1)',
            'epubcfi(/6/22!/4/188/1:3)'
          )];
        },
        currentLocation() {
          return {
            start: {
              index: 10,
              cfi: 'epubcfi(/6/22!/4/180/1:0)',
              href: 'Text/chapter07.xhtml',
              displayed: { page: 8, total: 10 }
            }
          };
        }
      }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateProgress() {}, updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });

    persistence.onRelocated(state.rendition.currentLocation());
    await Promise.resolve();

    EpubStorage.savePosition = originalSavePosition;

    assert.equal(state.currentStableLocator.sourceCfi, 'epubcfi(/6/22!/4/180/1:0)');
    assert.equal(state.currentStableLocator.restoreCfi, 'epubcfi(/6/22!/4/188/1:3)');
    assert.equal(positionCalls[0][3].restoreCfi, 'epubcfi(/6/22!/4/188/1:3)');
  });

  test.it('flushPositionSave 关闭/刷新前保存 start.cfi，并重建 locator.restoreCfi', async () => {
    const state = {
      posTimer: null,
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
          percentageFromCfi(cfi) {
            if (cfi === 'epubcfi(/6/8!/4/2)') return 0.30;
            if (cfi === 'epubcfi(/6/8!/4/10)') return 0.90;
            return 0;
          }
        }
      },
      rendition: {
        getContents() {
          return [createNudgedCfiContent('epubcfi(/6/8!/4/2)', 'epubcfi(/6/8!/4/10)')];
        },
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
    assert.equal(state.currentStableLocator.sourceCfi, 'epubcfi(/6/8!/4/2)');
    assert.equal(state.currentStableLocator.restoreCfi, 'epubcfi(/6/8!/4/10)');
    assert.deepEqual(saves, [[
      'book-flush-sample',
      'epubcfi(/6/8!/4/2)',
      30,
      state.currentStableLocator
    ]]);
  });

  test.it('flushPositionSave 有待写入翻页位置时不重新采样旧 currentLocation 覆盖', async () => {
    const newLocator = {
      strategy: 'epubjs-displayed-page-v1',
      layout: 'paginated',
      href: 'new.xhtml',
      index: 8,
      page: 9,
      total: 12,
      sourceCfi: 'epubcfi(/6/20!/4/2)',
      restoreCfi: 'epubcfi(/6/20!/4/3)',
      prefsSignature: {
        layout: 'paginated',
        fontSize: 18,
        lineHeight: 1.8,
        fontFamily: '',
        paragraphIndent: true,
        spread: 'auto'
      }
    };
    const state = {
      posTimer: 9,
      currentBookId: 'book-flush-pending',
      currentStableCfi: 'epubcfi(/6/20!/4/2)',
      lastPercent: 70,
      currentStableLocator: newLocator,
      isRestoringPosition: false,
      isResizing: false,
      prefs: { layout: 'paginated' },
      book: {
        locations: {
          length: () => 100,
          percentageFromCfi(cfi) {
            return cfi === 'epubcfi(/6/8!/4/2)' ? 30 : 70;
          }
        }
      },
      rendition: {
        getContents() {
          return [createNudgedCfiContent('epubcfi(/6/8!/4/2)', 'epubcfi(/6/8!/4/3)')];
        },
        currentLocation() {
          return {
            start: {
              index: 1,
              cfi: 'epubcfi(/6/8!/4/2)',
              href: 'old.xhtml',
              displayed: { page: 3, total: 12 }
            }
          };
        }
      }
    };
    const originalClearTimeout = global.clearTimeout;
    const originalSavePosition = EpubStorage.savePosition;
    const saves = [];

    global.clearTimeout = () => {};
    EpubStorage.savePosition = async (...args) => { saves.push(args); };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });
    await persistence.flushPositionSave();

    global.clearTimeout = originalClearTimeout;
    EpubStorage.savePosition = originalSavePosition;

    assert.equal(state.currentStableCfi, 'epubcfi(/6/20!/4/2)');
    assert.equal(state.currentStableLocator.href, 'new.xhtml');
    assert.deepEqual(saves, [[
      'book-flush-pending',
      'epubcfi(/6/20!/4/2)',
      70,
      newLocator
    ]]);
  });

  test.it('分页页内锚点不可用时安全降级保存 start.cfi', async () => {
    const state = {
      posTimer: null,
      currentBookId: 'book-inner-anchor-fallback',
      currentStableCfi: null,
      lastPercent: null,
      lastProgress: 0,
      sessionStart: null,
      isBookLoaded: true,
      isResizing: false,
      isRestoringPosition: false,
      prefs: { layout: 'paginated' },
      book: {
        locations: {
          length: () => 100,
          percentageFromCfi() { return 0.30; }
        },
        navigation: { toc: [] }
      },
      rendition: {
        getContents() {
          return [{
            document: {
              defaultView: { innerWidth: 800, innerHeight: 600 },
              caretRangeFromPoint() { return null; },
              elementFromPoint() { return null; }
            },
            cfiFromRange() { return ''; },
            cfiFromNode() { return ''; }
          }];
        },
        currentLocation() {
          return {
            start: {
              index: 3,
              cfi: 'epubcfi(/6/8!/4/2)',
              href: 'chapter.xhtml',
              displayed: { page: 5, total: 12 }
            }
          };
        }
      }
    };
    const originalSavePosition = EpubStorage.savePosition;
    const saves = [];
    EpubStorage.savePosition = async (...args) => { saves.push(args); };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateProgress() {}, updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });

    persistence.onRelocated(state.rendition.currentLocation());
    await Promise.resolve();

    EpubStorage.savePosition = originalSavePosition;

    assert.equal(state.currentStableCfi, 'epubcfi(/6/8!/4/2)');
    assert.equal(saves[0][1], 'epubcfi(/6/8!/4/2)');
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

  test.it('visibilitychange 阅读时长保存失败只记录告警', async () => {
    const { document } = createMockDocument();
    global.document = document;

    const originalSavePosition = EpubStorage.savePosition;
    const originalSaveReadingTime = EpubStorage.saveReadingTime;
    const originalWarn = console.warn;
    const warnings = [];

    EpubStorage.savePosition = async () => {};
    EpubStorage.saveReadingTime = async () => {
      throw new Error('time failed');
    };
    console.warn = (...args) => warnings.push(args);

    const state = {
      readingTimer: null,
      posTimer: null,
      currentBookId: 'book-time-fail',
      currentStableCfi: 'epubcfi(/6/8)',
      lastPercent: 88.8,
      activeReadingSeconds: 120,
      sessionStart: null,
      lastProgress: 0,
      isBookLoaded: true
    };

    try {
      const persistence = ReaderPersistence.createReaderPersistence({
        state,
        ui: { updateProgress() {}, updateReadingStats() {} }
      });

      persistence.mount();
      document.hidden = true;
      document.dispatchEvent('visibilitychange');
      await Promise.resolve();
      persistence.unmount();
    } finally {
      EpubStorage.savePosition = originalSavePosition;
      EpubStorage.saveReadingTime = originalSaveReadingTime;
      console.warn = originalWarn;
    }

    assert.match(String(warnings[0]?.[0] || ''), /save reading time failed/);
  });

  test.it('onRelocated 正常阅读时优先使用 relocated 事件位置，避免 currentLocation 旧值回滚', async () => {
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
            start: { cfi: 'epubcfi(/6/8)', href: 'ch1.xhtml' },
            end: { cfi: 'epubcfi(/6/10)', href: 'ch1.xhtml' }
          };
        }
      }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateProgress() {}, updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });

    // relocated 事件已经是新页，currentLocation() 在同一 tick 内仍可能返回旧页
    persistence.onRelocated({
      start: {
        cfi: 'epubcfi(/6/10)',
        href: 'ch2.xhtml',
        displayed: { page: 4, total: 12 }
      },
      end: {
        cfi: 'epubcfi(/6/12)',
        href: 'ch2.xhtml',
        displayed: { page: 4, total: 12 }
      }
    });
    await Promise.resolve();

    EpubStorage.savePosition = originalSavePosition;

    // 应使用 relocated 事件 CFI，而非 currentLocation() 的旧 CFI
    assert.equal(state.currentStableCfi, 'epubcfi(/6/10)');
    assert.equal(state.currentStableLocator.href, 'ch2.xhtml');
    assert.equal(state.currentStableLocator.page, 4);
    assert.equal(positionCalls.length, 1);
    assert.equal(positionCalls[0][1], 'epubcfi(/6/10)');
    assert.equal(positionCalls[0][3].href, 'ch2.xhtml');
  });

  test.it('onRelocated currentLocation 旧值不覆盖 relocated 事件 locator 与恢复锚点', async () => {
    const { document } = createMockDocument(['chapter-title']);
    global.document = document;
    global.Bookmarks = { async isBookmarked() { return false; } };

    const positionCalls = [];
    const originalSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async (...args) => { positionCalls.push(args); };

    const state = {
      isResizing: false,
      isRestoringPosition: false,
      currentBookId: 'book-resample-inner-anchor',
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
        getContents() {
          return [
            createNudgedCfiContent('epubcfi(/6/8!/4/2)', 'epubcfi(/6/8!/4/12)'),
            createNudgedCfiContent('epubcfi(/6/10!/4/2)', 'epubcfi(/6/10!/4/12)')
          ];
        },
        currentLocation() {
          return {
            start: {
              index: 1,
              cfi: 'epubcfi(/6/8!/4/2)',
              href: 'ch1.xhtml',
              displayed: { page: 5, total: 12 }
            }
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
        index: 2,
        cfi: 'epubcfi(/6/10!/4/2)',
        href: 'ch2.xhtml',
        displayed: { page: 6, total: 12 }
      }
    });
    await Promise.resolve();

    EpubStorage.savePosition = originalSavePosition;

    assert.equal(state.currentStableCfi, 'epubcfi(/6/10!/4/2)');
    assert.equal(state.currentStableLocator.href, 'ch2.xhtml');
    assert.equal(state.currentStableLocator.index, 2);
    assert.equal(state.currentStableLocator.page, 6);
    assert.equal(state.currentStableLocator.restoreCfi, 'epubcfi(/6/10!/4/12)');
    assert.equal(positionCalls[0][1], 'epubcfi(/6/10!/4/2)');
    assert.equal(positionCalls[0][3].href, 'ch2.xhtml');
  });

  test.it('onRelocated CFI 未变但 locator 或百分比变化时仍保存最新恢复位置', async () => {
    const { document } = createMockDocument(['chapter-title']);
    global.document = document;
    global.Bookmarks = { async isBookmarked() { return false; } };

    const positionCalls = [];
    const originalSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async (...args) => { positionCalls.push(args); };

    const oldLocator = {
      strategy: 'epubjs-displayed-page-v1',
      layout: 'paginated',
      href: 'ch.xhtml',
      index: 2,
      page: 4,
      total: 12,
      sourceCfi: 'epubcfi(/6/10!/4/2)',
      restoreCfi: 'epubcfi(/6/10!/4/3)',
      prefsSignature: {
        layout: 'paginated',
        fontSize: 18,
        lineHeight: 1.8,
        fontFamily: '',
        paragraphIndent: true,
        spread: 'auto'
      }
    };
    const state = {
      isResizing: false,
      isRestoringPosition: false,
      currentBookId: 'book-same-cfi-new-page',
      currentStableCfi: 'epubcfi(/6/10!/4/2)',
      currentStableLocator: oldLocator,
      lastPercent: 29,
      lastProgress: 0.29,
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
        getContents() {
          return [createNudgedCfiContent('epubcfi(/6/10!/4/2)', 'epubcfi(/6/10!/4/12)')];
        },
        currentLocation() {
          return {
            start: {
              index: 2,
              cfi: 'epubcfi(/6/10!/4/2)',
              href: 'ch.xhtml',
              displayed: { page: 5, total: 12 }
            }
          };
        }
      }
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateProgress() {}, updateChapterTitle() {}, updateBookmarkButtonState() {}, updateReadingStatsText() {} }
    });

    persistence.onRelocated(state.rendition.currentLocation());
    await Promise.resolve();

    EpubStorage.savePosition = originalSavePosition;

    assert.equal(state.currentStableCfi, 'epubcfi(/6/10!/4/2)');
    assert.equal(state.lastPercent, 30);
    assert.equal(state.currentStableLocator.page, 5);
    assert.equal(state.currentStableLocator.sourceCfi, 'epubcfi(/6/10!/4/2)');
    assert.equal(state.currentStableLocator.restoreCfi, 'epubcfi(/6/10!/4/12)');
    assert.deepEqual(positionCalls, [[
      'book-same-cfi-new-page',
      'epubcfi(/6/10!/4/2)',
      30,
      state.currentStableLocator
    ]]);
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
      currentStableLocator: {
        strategy: 'epubjs-displayed-page-v1',
        layout: 'paginated',
        href: 'ch2.xhtml',
        index: null,
        page: null,
        total: null,
        sourceCfi: 'epubcfi(/6/10)',
        prefsSignature: {
          layout: 'paginated',
          fontSize: 18,
          lineHeight: 1.8,
          fontFamily: '',
          paragraphIndent: true,
          spread: 'auto'
        }
      },
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
