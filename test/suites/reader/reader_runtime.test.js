'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWindowScript, createMockDocument } = require('../../helpers/browser_env');

loadWindowScript('src/reader/reader-runtime.js');

test.describe('ReaderRuntime', () => {
  const originalDocument = global.document;
  const originalRequestIdleCallback = global.requestIdleCallback;
  const originalSetTimeout = global.setTimeout;
  const originalEpub = global.ePub;
  const originalImageViewer = global.ImageViewer;
  const originalAnnotations = global.Annotations;
  const originalTOC = global.TOC;
  const originalBookmarks = global.Bookmarks;
  const originalSearch = global.Search;
  const originalHighlights = global.Highlights;
  const originalFetch = global.fetch;

  test.beforeEach(() => {
    if (global.resetAll) global.resetAll();
    global.document = originalDocument;
    global.requestIdleCallback = originalRequestIdleCallback;
    global.setTimeout = originalSetTimeout;
    global.ePub = originalEpub;
    global.ImageViewer = originalImageViewer;
    global.Annotations = originalAnnotations;
    global.TOC = originalTOC;
    global.Bookmarks = originalBookmarks;
    global.Search = originalSearch;
    global.Highlights = originalHighlights;
    global.fetch = originalFetch;
  });

  test.afterEach(() => {
    global.document = originalDocument;
    global.requestIdleCallback = originalRequestIdleCallback;
    global.setTimeout = originalSetTimeout;
    global.ePub = originalEpub;
    global.ImageViewer = originalImageViewer;
    global.Annotations = originalAnnotations;
    global.TOC = originalTOC;
    global.Bookmarks = originalBookmarks;
    global.Search = originalSearch;
    global.Highlights = originalHighlights;
    global.fetch = originalFetch;
  });

  test.it('next 在导航锁期间不会重复翻页', () => {
    const state = {
      navLock: false,
      rendition: {
        calls: 0,
        next() {
          this.calls++;
        }
      }
    };
    const scheduled = [];
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => {
      scheduled.push(fn);
      return scheduled.length;
    };

    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui: {},
      persistence: {},
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    runtime.next();
    runtime.next();
    assert.equal(state.rendition.calls, 1);
    scheduled[0]();
    runtime.next();

    global.setTimeout = originalSetTimeout;

    assert.equal(state.rendition.calls, 2);
  });

  test.it('displayPercentage 仅在 locations 可用时跳转', () => {
    const displayed = [];
    const state = {
      book: {
        locations: {
          length: () => 3,
          cfiFromPercentage(percent) {
            return percent === 0.5 ? 'epubcfi(/6/10)' : null;
          }
        }
      },
      rendition: {
        display(cfi) {
          displayed.push(cfi);
        }
      }
    };
    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui: {},
      persistence: {},
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    runtime.displayPercentage(50);
    runtime.displayPercentage(75);

    assert.deepEqual(displayed, ['epubcfi(/6/10)']);
  });

  test.it('openBook 首次无缓存时先进入阅读，再后台生成大书索引', async () => {
    const { document } = createMockDocument([
      'reader-main',
      'book-title',
      'chapter-title',
      'progress-location'
    ]);
    global.document = document;

    let idleTask = null;
    global.requestIdleCallback = (cb) => {
      idleTask = cb;
      return 1;
    };
    global.setTimeout = (fn) => {
      fn();
      return 1;
    };

    const showLoadingCalls = [];
    const locationStatusCalls = [];
    const relocatedCalls = [];
    let savedLocations = null;
    let generateBreak = null;

    const rendition = {
      hooks: { content: { register() {} } },
      themes: { default() {} },
      on() {},
      async display() {},
      currentLocation() {
        return { start: { cfi: 'epubcfi(/6/2)', href: 'chapter1.xhtml' } };
      }
    };

    const locations = {
      _length: 0,
      length() {
        return this._length;
      },
      async generate(breakValue) {
        generateBreak = breakValue;
        this._length = 128;
      },
      save() {
        return 'locations-json';
      },
      percentageFromCfi() {
        return 0.25;
      },
      load() {
        this._length = 128;
      }
    };

    global.ePub = () => ({
      ready: Promise.resolve(),
      locations,
      renderTo() {
        return rendition;
      },
      destroy() {},
      coverUrl: async () => null,
      loaded: {
        metadata: Promise.resolve({ title: '大书', creator: '作者' }),
        navigation: Promise.resolve({ toc: [] })
      }
    });
    global.ImageViewer = { hookRendition() {} };
    global.Annotations = { setBook() {}, hookRendition() {} };
    global.TOC = { build() {}, reset() {} };
    global.Bookmarks = { setBook() {}, reset() {} };
    global.Search = { setBook() {}, reset() {} };
    global.Highlights = { setBookDetails() {} };
    global.fetch = async () => ({ blob: async () => ({}) });

    const originalGetPreferences = EpubStorage.getPreferences;
    const originalGetBookMeta = EpubStorage.getBookMeta;
    const originalGetPosition = EpubStorage.getPosition;
    const originalAddRecentBook = EpubStorage.addRecentBook;
    const originalGetLocations = EpubStorage.getLocations;
    const originalSaveLocations = EpubStorage.saveLocations;
    EpubStorage.getPreferences = async () => ({});
    EpubStorage.getBookMeta = async () => null;
    EpubStorage.getPosition = async () => null;
    EpubStorage.addRecentBook = async () => {};
    EpubStorage.getLocations = async () => null;
    EpubStorage.saveLocations = async (_bookId, json) => {
      savedLocations = json;
    };

    const state = {
      book: null,
      rendition: null,
      currentBookId: '',
      currentFileName: '',
      isBookLoaded: false,
      prefs: {},
      activeReadingSeconds: 0,
      cachedSpeed: null,
      sessionStart: null,
      lastProgress: 0
    };
    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui: {
        setReaderVisible() {},
        syncPrefsToControls() {},
        applyThemeToRendition() {},
        setupRenditionKeyEvents() {},
        ensureFocus() {},
        updateProgress() {},
        showLoading(show, message = '') {
          showLoadingCalls.push([show, message]);
        },
        setLocationIndexStatus(status, detail) {
          locationStatusCalls.push([status, detail]);
        }
      },
      persistence: {
        startReadingTimer() {},
        onRelocated(location) {
          relocatedCalls.push(location.start.cfi);
        }
      },
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    const largeBookData = new Uint8Array(3 * 1024 * 1024 + 1);
    await runtime.openBook(largeBookData, 'book-large', 'large.epub');

    assert.equal(state.isBookLoaded, true);
    assert.equal(state.locationsStatus, 'pending');
    assert.equal(generateBreak, null);
    assert.deepEqual(showLoadingCalls.at(-1), [false, '']);
    assert.deepEqual(locationStatusCalls, [['pending', '准备生成阅读定位索引...']]);

    await idleTask();
    await Promise.resolve();
    await Promise.resolve();

    EpubStorage.getPreferences = originalGetPreferences;
    EpubStorage.getBookMeta = originalGetBookMeta;
    EpubStorage.getPosition = originalGetPosition;
    EpubStorage.addRecentBook = originalAddRecentBook;
    EpubStorage.getLocations = originalGetLocations;
    EpubStorage.saveLocations = originalSaveLocations;

    assert.equal(generateBreak, 4800);
    assert.equal(savedLocations, 'locations-json');
    assert.equal(state.locationsStatus, 'ready');
    assert.equal(state.hasLocations, true);
    assert.deepEqual(relocatedCalls, ['epubcfi(/6/2)']);
    assert.deepEqual(locationStatusCalls, [
      ['pending', '准备生成阅读定位索引...'],
      ['generating', '后台生成阅读定位索引...'],
      ['ready', '阅读定位索引已就绪']
    ]);
  });

  test.it('loadFileByBookId 在缓存缺失时显示重新导入错误', async () => {
    const messages = [];
    const originalGetFile = EpubStorage.getFile;
    EpubStorage.getFile = async () => null;

    const runtime = ReaderRuntime.createReaderRuntime({
      state: {},
      ui: {
        showLoading() {},
        showLoadError(msg) {
          messages.push(msg);
        }
      },
      persistence: {},
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    await runtime.loadFileByBookId('missing-book');
    EpubStorage.getFile = originalGetFile;

    assert.equal(messages.length, 1);
    assert.match(messages[0], /重新导入/);
  });

  test.it('unmount 销毁 rendition 并清空关键状态', () => {
    const state = {
      rendition: {
        destroyed: false,
        destroy() {
          this.destroyed = true;
        }
      },
      book: { id: 'b' },
      isBookLoaded: true
    };
    let unmounted = 0;
    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui: {},
      persistence: {},
      moduleLifecycle: { mount() {}, unmount() { unmounted++; } }
    });

    runtime.unmount();

    assert.equal(unmounted, 1);
    assert.equal(state.book, null);
    assert.equal(state.rendition, null);
    assert.equal(state.isBookLoaded, false);
  });
});
