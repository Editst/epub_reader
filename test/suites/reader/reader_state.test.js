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
    assert.equal(state.hasLocations, false);
    assert.equal(state.locationsStatus, 'idle');
    assert.equal(state.locationsBreak, null);
    assert.equal(state.locationsError, null);
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
    state.isRestoreAnchorProtected = true;
    state.lastPositionSave = Promise.resolve();
    state.hasLocations = true;
    state.locationsStatus = 'ready';
    state.locationsBreak = 3200;
    state.locationsError = 'boom';
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
    assert.equal(state.isRestoreAnchorProtected, false);
    assert.equal(state.lastPositionSave, null);
    assert.equal(state.hasLocations, false);
    assert.equal(state.locationsStatus, 'idle');
    assert.equal(state.locationsBreak, null);
    assert.equal(state.locationsError, null);
    assert.equal(state.readingTimer, null);
    assert.equal(state.posTimer, null);
    assert.deepEqual(cleared, [['interval', 11], ['timeout', 22]]);
  });
});
