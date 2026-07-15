'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWindowScript } = require('../../helpers/browser_env');

loadWindowScript('src/reader/reader-state.js');

test.describe('ReaderState', () => {
  test.it('createReaderState 提供文档声明的默认状态', () => {
    const state = ReaderState.createReaderState();

    assert.equal(state.book, null);
    assert.equal(state.rendition, null);
    assert.equal(state.currentBookId, '');
    assert.equal(state.isBookLoaded, false);
    assert.equal(state.locationsStatus, 'idle');
    assert.equal(state.isRestoreAnchorProtected, false);
    assert.equal(state.lastPositionSave, null);
    assert.equal(state.currentStableLocator, null);
    assert.equal(state.prefs.theme, 'light');
    assert.equal(state.prefs.layout, 'paginated');
    assert.equal(state.prefs.spread, 'auto');
  });

  test.it('resetReadingSession 清空计时、速度与防抖状态', () => {
    const state = ReaderState.createReaderState();
    const cleared = [];
    const originalClearInterval = global.clearInterval;
    const originalClearTimeout = global.clearTimeout;

    global.clearInterval = (timer) => cleared.push(['interval', timer]);
    global.clearTimeout = (timer) => cleared.push(['timeout', timer]);

    state.activeReadingSeconds = 300;
    state.cachedSpeed = { sampledSeconds: 60, sampledProgress: 0.1 };
    state.sessionStart = { progress: 0.3, timestamp: 1 };
    state.lastProgress = 0.4;
    state.lastPercent = 40;
    state.currentStableCfi = 'epubcfi(/6/2)';
    state.currentStableLocator = { page: 2 };
    state.isResizing = true;
    state.isRestoringPosition = true;
    state.isRestoreAnchorProtected = true;
    state.lastPositionSave = Promise.resolve();
    state.locationsStatus = 'ready';
    state.readingTimer = 11;
    state.posTimer = 22;

    ReaderState.resetReadingSession(state);

    global.clearInterval = originalClearInterval;
    global.clearTimeout = originalClearTimeout;

    assert.equal(state.activeReadingSeconds, 0);
    assert.equal(state.cachedSpeed, null);
    assert.equal(state.sessionStart, null);
    assert.equal(state.lastProgress, 0);
    assert.equal(state.lastPercent, null);
    assert.equal(state.currentStableCfi, null);
    assert.equal(state.currentStableLocator, null);
    assert.equal(state.isResizing, false);
    assert.equal(state.isRestoringPosition, false);
    assert.equal(state.isRestoreAnchorProtected, false);
    assert.equal(state.lastPositionSave, null);
    assert.equal(state.locationsStatus, 'idle');
    assert.equal(state.readingTimer, null);
    assert.equal(state.posTimer, null);
    assert.deepEqual(cleared, [['interval', 11], ['timeout', 22]]);
  });

  test.it('findTocItem 按路径边界匹配章节，避免 ch1 误命中 ch10', () => {
    const toc = [
      { label: '第一章', href: 'ch1' },
      { label: '第十章', href: 'text/ch10.xhtml' },
      {
        label: '附录',
        href: 'appendix.xhtml',
        subitems: [
          { label: '附录 A', href: 'appendix/a.xhtml#top' }
        ]
      }
    ];

    assert.equal(ReaderState.findTocItem(toc, 'text/ch10.xhtml#p1').label, '第十章');
    assert.equal(ReaderState.findTocItem(toc, 'OPS/appendix/a.xhtml#note').label, '附录 A');
  });

  test.it('isTocHrefMatch 供目录状态与持久化共享相同路径边界规则', () => {
    assert.equal(ReaderState.isTocHrefMatch('OPS/text/ch1.xhtml#p1', 'text/ch1.xhtml'), true);
    assert.equal(ReaderState.isTocHrefMatch('text/ch10.xhtml', 'text/ch1.xhtml'), false);
    assert.equal(ReaderState.isTocHrefMatch('', 'text/ch1.xhtml'), false);
  });

  test.it('getTocItemLabel 安全归一化缺失或非字符串目录标题', () => {
    assert.equal(ReaderState.getTocItemLabel(null), '');
    assert.equal(ReaderState.getTocItemLabel({}), '');
    assert.equal(ReaderState.getTocItemLabel({ label: '  第一章  ' }), '第一章');
    assert.equal(ReaderState.getTocItemLabel({ label: 12 }), '12');
  });
});
