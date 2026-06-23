'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWindowScript, createMockDocument } = require('../../helpers/browser_env');

// 加载被测模块
loadWindowScript('src/reader/reader-state.js');
loadWindowScript('src/reader/reader-persistence.js');

/**
 * progress_restore.test.js
 *
 * 验证 openBook 位置恢复期间，relocated 事件不会覆写 storage 中的已保存进度。
 * 根因：rendition.display(savedCfi) 触发 relocated → onRelocated →
 *       schedulePositionSave(cfi, null)，在 locations 未加载时以 null percentage
 *       覆盖正确的已存进度。
 */
test.describe('Progress Restore — isRestoringPosition 保护', () => {
  const originalDocument = global.document;

  test.afterEach(() => {
    global.document = originalDocument;
  });

  /**
   * 核心场景：位置恢复期间 onRelocated 不触发 schedulePositionSave。
   * 模拟 openBook 流程中 rendition.display(savedCfi) 触发 relocated，
   * 此时 state.isRestoringPosition = true，onRelocated 应跳过位置写入。
   */
  test.it('isRestoringPosition 为 true 时 onRelocated 不调用 schedulePositionSave', () => {
    const { document } = createMockDocument(['chapter-title']);
    global.document = document;

    const state = ReaderState.createReaderState();
    state.currentBookId = 'book-test';
    state.isBookLoaded = true;
    state.isRestoringPosition = true;
    state.book = {
      navigation: { toc: [] },
      locations: { length: () => 0 }
    };

    let savePositionCalls = 0;
    const mockUi = {
      updateProgress() {}
    };

    const persistence = ReaderPersistence.createReaderPersistence({ state, ui: mockUi });

    // 拦截 EpubStorage.savePosition 统计调用次数
    const origSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async () => { savePositionCalls++; };

    persistence.onRelocated({
      start: { cfi: 'epubcfi(/6/4)', href: 'chapter1.xhtml' }
    });

    EpubStorage.savePosition = origSavePosition;

    // 内存状态应更新（currentStableCfi），但不应写入 storage
    assert.equal(state.currentStableCfi, 'epubcfi(/6/4)');
    assert.equal(savePositionCalls, 0, '位置恢复期间不应调用 savePosition');
  });

  /**
   * 验证 isRestoringPosition 期间，即使 locations 已加载，
   * onRelocated 仍然更新内存状态（percent/progress）但不写入 storage。
   */
  test.it('isRestoringPosition 为 true 且 locations 已加载时，更新内存状态但不写入', () => {
    const { document } = createMockDocument(['chapter-title']);
    global.document = document;

    const state = ReaderState.createReaderState();
    state.currentBookId = 'book-test';
    state.isBookLoaded = true;
    state.isRestoringPosition = true;
    state.book = {
      navigation: { toc: [] },
      locations: {
        length: () => 100,
        percentageFromCfi: () => 0.35
      }
    };

    let savePositionCalls = 0;
    const origSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async () => { savePositionCalls++; };

    const mockUi = {
      progressUpdated: null,
      updateProgress(p) { this.progressUpdated = p; }
    };

    const persistence = ReaderPersistence.createReaderPersistence({ state, ui: mockUi });

    persistence.onRelocated({
      start: { cfi: 'epubcfi(/6/8)', href: 'chapter3.xhtml' }
    });

    EpubStorage.savePosition = origSavePosition;

    // 内存状态应全部更新
    assert.equal(state.currentStableCfi, 'epubcfi(/6/8)');
    assert.equal(state.lastPercent, 35.0);
    assert.equal(state.lastProgress, 0.35);
    assert.equal(mockUi.progressUpdated, 35.0);
    // 但不应写入 storage
    assert.equal(savePositionCalls, 0, '位置恢复期间不应调用 savePosition');
  });

  /**
   * 验证 isRestoringPosition = false（正常阅读）时，
   * onRelocated 正常触发 schedulePositionSave。
   */
  test.it('isRestoringPosition 为 false 时 onRelocated 正常保存位置', () => {
    const { document } = createMockDocument(['chapter-title']);
    global.document = document;

    const state = ReaderState.createReaderState();
    state.currentBookId = 'book-test';
    state.isBookLoaded = true;
    state.isRestoringPosition = false;
    state.book = {
      navigation: { toc: [] },
      locations: {
        length: () => 100,
        percentageFromCfi: () => 0.50
      }
    };

    let savePositionCalls = 0;
    const origSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async () => { savePositionCalls++; };
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => { return 999; };

    const mockUi = { updateProgress() {} };
    const persistence = ReaderPersistence.createReaderPersistence({ state, ui: mockUi });

    persistence.onRelocated({
      start: { cfi: 'epubcfi(/6/10)', href: 'chapter5.xhtml' }
    });

    EpubStorage.savePosition = origSavePosition;
    global.setTimeout = origSetTimeout;

    assert.equal(savePositionCalls, 1, '正常阅读时应调用 savePosition');
    assert.equal(state.currentStableCfi, 'epubcfi(/6/10)');
    assert.equal(state.lastPercent, 50.0);
  });

  /**
   * 验证 flushPositionSave 始终使用 state 中最新的内存值写入。
   */
  test.it('flushPositionSave 使用 state.currentStableCfi 和 state.lastPercent 写入', async () => {
    const state = ReaderState.createReaderState();
    state.currentBookId = 'book-flush';
    state.currentStableCfi = 'epubcfi(/6/20)';
    state.lastPercent = 75.5;
    state.isRestoringPosition = false;

    const savedArgs = [];
    const origSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async (bookId, cfi, percent) => {
      savedArgs.push({ bookId, cfi, percent });
    };

    const persistence = ReaderPersistence.createReaderPersistence({
      state,
      ui: { updateProgress() {} }
    });

    await persistence.flushPositionSave();

    EpubStorage.savePosition = origSavePosition;

    assert.equal(savedArgs.length, 1);
    assert.equal(savedArgs[0].bookId, 'book-flush');
    assert.equal(savedArgs[0].cfi, 'epubcfi(/6/20)');
    assert.equal(savedArgs[0].percent, 75.5);
  });

  /**
   * 验证 createReaderState 包含 isRestoringPosition 字段且默认为 false。
   */
  test.it('createReaderState 初始 isRestoringPosition 为 false', () => {
    const state = ReaderState.createReaderState();
    assert.equal(state.isRestoringPosition, false);
  });

  /**
   * 验证 resetReadingSession 重置 isRestoringPosition 为 false。
   */
  test.it('resetReadingSession 重置 isRestoringPosition', () => {
    const state = ReaderState.createReaderState();
    state.isRestoringPosition = true;
    ReaderState.resetReadingSession(state);
    assert.equal(state.isRestoringPosition, false);
  });
});
