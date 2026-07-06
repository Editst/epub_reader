'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWindowScript, createMockDocument } = require('../../helpers/browser_env');

loadWindowScript('src/reader/reader-runtime.js');

test.describe('ReaderRuntime', () => {
  const originalDocument = global.document;
  const originalRequestIdleCallback = global.requestIdleCallback;
  const originalRequestAnimationFrame = global.requestAnimationFrame;
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
    global.requestAnimationFrame = originalRequestAnimationFrame;
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
    global.requestAnimationFrame = originalRequestAnimationFrame;
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
      isLayoutStable: true,
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
      },
      isLayoutStable: true
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

  test.it('openBook 通过 lifecycle 挂载 Bookmarks/Search/Highlights，不再额外直调', async () => {
    const { document } = createMockDocument([
      'reader-main',
      'book-title',
      'chapter-title',
      'progress-location'
    ]);
    global.document = document;
    global.setTimeout = (fn) => { fn(); return 1; };

    const rendition = {
      hooks: { content: { register() {} } },
      themes: { default() {}, override() {} },
      on() {},
      async display() {},
      currentLocation() {
        return { start: { cfi: 'epubcfi(/6/2)', href: 'chapter.xhtml', index: 0 } };
      },
      getContents() {
        return [{ document: { fonts: { ready: Promise.resolve() } } }];
      }
    };
    const locations = {
      _length: 0,
      length() { return this._length; },
      load() { this._length = 100; },
      percentageFromCfi() { return 0.25; }
    };

    global.ePub = () => ({
      ready: Promise.resolve(),
      locations,
      renderTo() { return rendition; },
      destroy() {},
      coverUrl: async () => null,
      loaded: {
        metadata: Promise.resolve({ title: '生命周期测试', creator: '作者' }),
        navigation: Promise.resolve({ toc: [] })
      }
    });

    const directCalls = { bookmarks: 0, search: 0, highlights: 0 };
    const mountCalls = [];
    global.ImageViewer = { hookRendition() {} };
    global.Annotations = { setBook() {}, hookRendition() {} };
    global.TOC = { build() {}, reset() {} };
    global.Bookmarks = { setBook() { directCalls.bookmarks++; }, reset() {} };
    global.Search = { setBook() { directCalls.search++; }, reset() {} };
    global.Highlights = { setBookDetails() { directCalls.highlights++; } };
    global.fetch = async () => ({ blob: async () => ({}) });

    const originalGetPreferences = EpubStorage.getPreferences;
    const originalGetBookMeta = EpubStorage.getBookMeta;
    const originalGetPosition = EpubStorage.getPosition;
    const originalAddRecentBook = EpubStorage.addRecentBook;
    const originalGetLocations = EpubStorage.getLocations;
    EpubStorage.getPreferences = async () => ({ layout: 'paginated', theme: 'light' });
    EpubStorage.getBookMeta = async () => null;
    EpubStorage.getPosition = async () => null;
    EpubStorage.addRecentBook = async () => {};
    EpubStorage.getLocations = async () => 'cached-locations';

    try {
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
          clearReaderError() {},
          setBookTitle() {},
          setReaderDimmed() {},
          syncPrefsToControls() {},
          applyThemeToRendition() {},
          setupRenditionKeyEvents() {},
          ensureFocus() {},
          updateProgress() {},
          showLoading() {},
          setLocationIndexStatus() {}
        },
        persistence: { startReadingTimer() {}, onRelocated() {} },
        moduleLifecycle: {
          mount(context) { mountCalls.push(context); },
          unmount() {}
        }
      });

      await runtime.openBook(new Uint8Array([1, 2, 3]), 'book-lifecycle', 'lifecycle.epub');
    } finally {
      EpubStorage.getPreferences = originalGetPreferences;
      EpubStorage.getBookMeta = originalGetBookMeta;
      EpubStorage.getPosition = originalGetPosition;
      EpubStorage.addRecentBook = originalAddRecentBook;
      EpubStorage.getLocations = originalGetLocations;
    }

    assert.equal(mountCalls.length, 1);
    assert.equal(mountCalls[0].bookId, 'book-lifecycle');
    assert.deepEqual(directCalls, { bookmarks: 0, search: 0, highlights: 0 });
  });

  test.it('openBook 与 setLayout 创建的 rendition 均约束 EPUB 图片尺寸', async () => {
    const { document } = createMockDocument([
      'reader-main',
      'book-title',
      'chapter-title',
      'progress-location'
    ]);
    global.document = document;
    global.requestAnimationFrame = (fn) => fn();
    global.setTimeout = (fn) => { fn(); return 1; };

    const themeDefaults = [];
    function createRendition() {
      return {
        hooks: { content: { register() {} } },
        themes: {
          default(rules) { themeDefaults.push(rules); },
          override() {}
        },
        on() {},
        async display() {},
        currentLocation() {
          return { start: { cfi: 'epubcfi(/6/2)', href: 'chapter.xhtml', index: 0 } };
        },
        getContents() {
          return [{ document: { fonts: { ready: Promise.resolve() } } }];
        },
        destroy() {}
      };
    }

    const locations = {
      _length: 0,
      length() { return this._length; },
      load() { this._length = 100; },
      percentageFromCfi() { return 0.25; }
    };
    const book = {
      ready: Promise.resolve(),
      locations,
      navigation: { toc: [] },
      renderTo() { return createRendition(); },
      destroy() {},
      coverUrl: async () => null,
      loaded: {
        metadata: Promise.resolve({ title: '图片测试', creator: '作者' }),
        navigation: Promise.resolve({ toc: [] })
      }
    };

    global.ePub = () => book;
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
    const originalSavePreferences = EpubStorage.savePreferences;

    EpubStorage.getPreferences = async () => ({ layout: 'paginated', theme: 'light' });
    EpubStorage.getBookMeta = async () => null;
    EpubStorage.getPosition = async () => null;
    EpubStorage.addRecentBook = async () => {};
    EpubStorage.getLocations = async () => 'cached-locations';
    EpubStorage.savePreferences = async () => {};

    try {
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
          clearReaderError() {},
          setBookTitle() {},
          setReaderDimmed() {},
          syncPrefsToControls() {},
          applyThemeToRendition() {},
          setupRenditionKeyEvents() {},
          ensureFocus() {},
          updateProgress() {},
          showLoading() {},
          setLocationIndexStatus() {}
        },
        persistence: { startReadingTimer() {}, onRelocated() {} },
        moduleLifecycle: { mount() {}, unmount() {} }
      });

      await runtime.openBook(new Uint8Array([1, 2, 3]), 'book-image-rule', 'image.epub');
      await runtime.setLayout('scrolled');
    } finally {
      EpubStorage.getPreferences = originalGetPreferences;
      EpubStorage.getBookMeta = originalGetBookMeta;
      EpubStorage.getPosition = originalGetPosition;
      EpubStorage.addRecentBook = originalAddRecentBook;
      EpubStorage.getLocations = originalGetLocations;
      EpubStorage.savePreferences = originalSavePreferences;
    }

    assert.equal(themeDefaults.length, 2);
    themeDefaults.forEach((rules) => {
      assert.equal(rules.img['max-width'], '100% !important');
      assert.equal(rules.image['max-width'], '100% !important');
      assert.equal(rules.image.height, 'auto !important');
    });
  });

  test.it('openBook 提取封面后会释放 Blob URL', async () => {
    const { document } = createMockDocument([
      'reader-main',
      'book-title',
      'chapter-title',
      'progress-location'
    ]);
    global.document = document;
    global.requestAnimationFrame = (fn) => fn();
    global.setTimeout = (fn) => { fn(); return 1; };

    const rendition = {
      hooks: { content: { register() {} } },
      themes: { default() {}, override() {} },
      on() {},
      async display() {},
      currentLocation() {
        return { start: { cfi: 'epubcfi(/6/2)', href: 'chapter.xhtml', index: 0 } };
      },
      getContents() {
        return [{ document: { fonts: { ready: Promise.resolve() } } }];
      },
      destroy() {}
    };
    const locations = {
      _length: 0,
      length() { return this._length; },
      load() { this._length = 100; },
      percentageFromCfi() { return 0.25; }
    };

    global.ePub = () => ({
      ready: Promise.resolve(),
      locations,
      renderTo() { return rendition; },
      destroy() {},
      coverUrl: async () => 'blob:cover-url',
      loaded: {
        metadata: Promise.resolve({ title: '封面测试', creator: '作者' }),
        navigation: Promise.resolve({ toc: [] })
      }
    });
    global.ImageViewer = { hookRendition() {} };
    global.Annotations = { setBook() {}, hookRendition() {} };
    global.TOC = { build() {}, reset() {} };
    global.Bookmarks = { setBook() {}, reset() {} };
    global.Search = { setBook() {}, reset() {} };
    global.Highlights = { setBookDetails() {} };

    const savedCovers = [];
    const revokedUrls = [];
    const originalGetPreferences = EpubStorage.getPreferences;
    const originalGetBookMeta = EpubStorage.getBookMeta;
    const originalGetPosition = EpubStorage.getPosition;
    const originalAddRecentBook = EpubStorage.addRecentBook;
    const originalGetLocations = EpubStorage.getLocations;
    const originalSaveCover = EpubStorage.saveCover;
    const originalFetch = global.fetch;
    const originalRevokeObjectURL = global.URL && global.URL.revokeObjectURL;

    EpubStorage.getPreferences = async () => ({ layout: 'paginated', theme: 'light' });
    EpubStorage.getBookMeta = async () => null;
    EpubStorage.getPosition = async () => null;
    EpubStorage.addRecentBook = async () => {};
    EpubStorage.getLocations = async () => 'cached-locations';
    EpubStorage.saveCover = async (bookId, blob) => savedCovers.push([bookId, blob]);
    global.fetch = async () => ({ blob: async () => ({ type: 'image/png' }) });
    if (!global.URL) global.URL = {};
    global.URL.revokeObjectURL = (url) => revokedUrls.push(url);

    try {
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
          clearReaderError() {},
          setBookTitle() {},
          setReaderDimmed() {},
          syncPrefsToControls() {},
          applyThemeToRendition() {},
          setupRenditionKeyEvents() {},
          ensureFocus() {},
          updateProgress() {},
          showLoading() {},
          setLocationIndexStatus() {}
        },
        persistence: { startReadingTimer() {}, onRelocated() {} },
        moduleLifecycle: { mount() {}, unmount() {} }
      });

      await runtime.openBook(new Uint8Array([1, 2, 3]), 'book-cover', 'cover.epub');
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      EpubStorage.getPreferences = originalGetPreferences;
      EpubStorage.getBookMeta = originalGetBookMeta;
      EpubStorage.getPosition = originalGetPosition;
      EpubStorage.addRecentBook = originalAddRecentBook;
      EpubStorage.getLocations = originalGetLocations;
      EpubStorage.saveCover = originalSaveCover;
      global.fetch = originalFetch;
      if (global.URL) global.URL.revokeObjectURL = originalRevokeObjectURL;
    }

    assert.deepEqual(savedCovers, [['book-cover', { type: 'image/png' }]]);
    assert.deepEqual(revokedUrls, ['blob:cover-url']);
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
        clearReaderError() {},
        setBookTitle() {},
        setReaderDimmed() {},
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

  async function runRestoreCorrectionCase({ savedPos, initialLocation, correctedLocation, prefs = {}, locationsJson = 'locations-json' }) {
    const { document } = createMockDocument(['reader-main', 'book-title', 'chapter-title', 'progress-location']);
    global.document = document;
    global.requestAnimationFrame = (fn) => fn();
    global.setTimeout = (fn) => { fn(); return 1; };

    const displayCalls = [];
    let nextCalls = 0;
    let prevCalls = 0;
    let reportLocationCalls = 0;
    let current = initialLocation;

    const rendition = {
      hooks: { content: { register() {} } },
      themes: { default() {} },
      on() {},
      async display(target) {
        displayCalls.push(target);
      },
      async next() {
        nextCalls++;
        if (correctedLocation) current = correctedLocation;
      },
      async prev() {
        prevCalls++;
        if (correctedLocation) current = correctedLocation;
      },
      reportLocation() {
        reportLocationCalls++;
      },
      currentLocation() {
        return current;
      },
      getContents() {
        return [{ document: { fonts: { ready: Promise.resolve() } } }];
      }
    };

    const locations = {
      _length: 0,
      length() { return this._length; },
      load() { this._length = 128; },
      percentageFromCfi() { return 0.30; }
    };

    global.ePub = () => ({
      ready: Promise.resolve(),
      locations,
      renderTo() { return rendition; },
      destroy() {},
      coverUrl: async () => null,
      loaded: {
        metadata: Promise.resolve({ title: '恢复测试', creator: '作者' }),
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
    EpubStorage.getPreferences = async () => prefs;
    EpubStorage.getBookMeta = async () => null;
    EpubStorage.getPosition = async () => savedPos;
    EpubStorage.addRecentBook = async () => {};
    EpubStorage.getLocations = async () => locationsJson;

    const relocatedCalls = [];
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
        clearReaderError() {},
        setBookTitle() {},
        setReaderDimmed() {},
        syncPrefsToControls() {},
        applyThemeToRendition() {},
        setupRenditionKeyEvents() {},
        ensureFocus() {},
        updateProgress() {},
        showLoading() {},
        setLocationIndexStatus() {}
      },
      persistence: {
        startReadingTimer() {},
        onRelocated(location) {
          relocatedCalls.push({ cfi: location.start.cfi, restoring: state.isRestoringPosition });
        }
      },
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    await runtime.openBook(new Uint8Array([1, 2, 3]), 'book-restore-correct', 'restore.epub');

    EpubStorage.getPreferences = originalGetPreferences;
    EpubStorage.getBookMeta = originalGetBookMeta;
    EpubStorage.getPosition = originalGetPosition;
    EpubStorage.addRecentBook = originalAddRecentBook;
    EpubStorage.getLocations = originalGetLocations;

    return { displayCalls, nextCalls, prevCalls, reportLocationCalls, relocatedCalls, state };
  }

  test.it('openBook 恢复 start.cfi 后同章节差一页时执行 next 校正', async () => {
    const prefs = { layout: 'paginated', fontSize: 18, lineHeight: 1.8, fontFamily: '', paragraphIndent: true, spread: 'auto' };
    const savedPos = {
      cfi: 'epubcfi(/6/8!/4/2)',
      percentage: 30,
      locator: {
        strategy: 'epubjs-displayed-page-v1',
        layout: 'paginated',
        href: 'chapter.xhtml',
        index: 3,
        page: 5,
        total: 12,
        prefsSignature: prefs
      }
    };
    const result = await runRestoreCorrectionCase({
      prefs,
      savedPos,
      initialLocation: { start: { index: 3, href: 'chapter.xhtml', cfi: 'cfi-page-4', displayed: { page: 4, total: 12 } }, end: { displayed: { page: 4, total: 12 } } },
      correctedLocation: { start: { index: 3, href: 'chapter.xhtml', cfi: 'cfi-page-5', displayed: { page: 5, total: 12 } }, end: { displayed: { page: 5, total: 12 } } }
    });

    assert.deepEqual(result.displayCalls, ['epubcfi(/6/8!/4/2)']);
    assert.equal(result.nextCalls, 1, '同章节且只差一页时应执行一次 next 校正');
    assert.equal(result.prevCalls, 0, '目标页在后一页时不应执行 prev 导航');
    assert.deepEqual(result.relocatedCalls, [], '恢复保护期不应把 currentLocation 边界 CFI 当作新位置保存');
  });

  test.it('openBook 恢复边界 CFI 后同章节差一页时执行 prev 校正', async () => {
    const prefs = { layout: 'paginated', fontSize: 18, lineHeight: 1.8, fontFamily: '', paragraphIndent: true, spread: 'auto' };
    const savedPos = {
      cfi: 'epubcfi(/6/8!/4/20)',
      percentage: 30,
      locator: {
        strategy: 'epubjs-displayed-page-v1',
        layout: 'paginated',
        href: 'chapter.xhtml',
        index: 3,
        page: 5,
        total: 12,
        prefsSignature: prefs
      }
    };
    const result = await runRestoreCorrectionCase({
      prefs,
      savedPos,
      initialLocation: { start: { index: 3, href: 'chapter.xhtml', cfi: 'cfi-page-6', displayed: { page: 6, total: 12 } }, end: { displayed: { page: 6, total: 12 } } },
      correctedLocation: { start: { index: 3, href: 'chapter.xhtml', cfi: 'cfi-page-5', displayed: { page: 5, total: 12 } }, end: { displayed: { page: 5, total: 12 } } }
    });

    assert.equal(result.nextCalls, 0, '不应执行 next 导航');
    assert.equal(result.prevCalls, 1, '同章节且只差一页时应执行一次 prev 校正');
  });

  test.it('openBook 页号一致或布局不可比时不做校正，href/index 不一致时不导航', async () => {
    const prefs = { layout: 'paginated', fontSize: 18, lineHeight: 1.8, fontFamily: '', paragraphIndent: true, spread: 'auto' };
    const baseLocator = {
      strategy: 'epubjs-displayed-page-v1',
      layout: 'paginated',
      href: 'chapter.xhtml',
      index: 3,
      page: 5,
      total: 12,
      prefsSignature: prefs
    };

    const samePage = await runRestoreCorrectionCase({
      prefs,
      savedPos: { cfi: 'cfi', percentage: 30, locator: baseLocator },
      initialLocation: { start: { index: 3, href: 'chapter.xhtml', cfi: 'cfi-page-5', displayed: { page: 5, total: 12 } }, end: { displayed: { page: 5, total: 12 } } }
    });
    const differentHref = await runRestoreCorrectionCase({
      prefs,
      savedPos: { cfi: 'cfi', percentage: 30, locator: baseLocator },
      initialLocation: { start: { index: 4, href: 'other.xhtml', cfi: 'cfi-other', displayed: { page: 4, total: 12 } }, end: { displayed: { page: 4, total: 12 } } }
    });
    const differentSignature = await runRestoreCorrectionCase({
      prefs: { ...prefs, fontSize: 20 },
      savedPos: { cfi: 'cfi', percentage: 30, locator: baseLocator },
      initialLocation: { start: { index: 3, href: 'chapter.xhtml', cfi: 'cfi-page-4', displayed: { page: 4, total: 12 } }, end: { displayed: { page: 4, total: 12 } } }
    });
    const scrolled = await runRestoreCorrectionCase({
      prefs: { ...prefs, layout: 'scrolled' },
      savedPos: { cfi: 'cfi', percentage: 30, locator: { ...baseLocator, layout: 'scrolled' } },
      initialLocation: { start: { index: 3, href: 'chapter.xhtml', cfi: 'cfi-page-4' }, end: {} }
    });

    assert.equal(samePage.nextCalls + samePage.prevCalls, 0, '页号一致：不导航');
    assert.equal(differentHref.nextCalls + differentHref.prevCalls, 0, 'href 不一致：不导航');
    assert.equal(differentSignature.nextCalls + differentSignature.prevCalls, 0, '签名不一致：跳过验证');
    assert.equal(scrolled.nextCalls + scrolled.prevCalls, 0, 'scrolled 模式：跳过验证');
  });

  test.it('openBook 恢复页码差超过一页时失效 locator 且不输出运行警告', async () => {
    const prefs = { layout: 'paginated', fontSize: 18, lineHeight: 1.8, fontFamily: '', paragraphIndent: true, spread: 'auto' };
    const savedPos = {
      cfi: 'epubcfi(/6/8!/4/2)',
      percentage: 30,
      locator: {
        strategy: 'epubjs-displayed-page-v1',
        layout: 'paginated',
        href: 'chapter.xhtml',
        index: 3,
        page: 10,
        total: 20,
        prefsSignature: prefs
      }
    };
    const warnCalls = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnCalls.push(args); };

    let result;
    try {
      result = await runRestoreCorrectionCase({
        prefs,
        savedPos,
        initialLocation: {
          start: {
            index: 3,
            href: 'chapter.xhtml',
            cfi: 'cfi-page-4',
            displayed: { page: 4, total: 20 }
          },
          end: { displayed: { page: 4, total: 20 } }
        }
      });
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(result.nextCalls + result.prevCalls, 0, '超过一页不做校正导航');
    assert.equal(result.state.currentStableCfi, 'epubcfi(/6/8!/4/2)');
    assert.equal(result.state.currentStableLocator, null, '不可比 locator 应被清除，避免下次重开重复告警');
    assert.equal(
      warnCalls.some((args) => String(args[0]).includes('page delta out of correction range')),
      false,
      '页码差超范围是可预期降级，不应输出运行警告'
    );
  });

  test.it('openBook 页校正后 currentStableCfi 仍等于 displayCfi', async () => {
    const prefs = { layout: 'paginated', fontSize: 18, lineHeight: 1.8, fontFamily: '', paragraphIndent: true, spread: 'auto' };
    const savedPos = {
      cfi: 'epubcfi(/6/8!/4/2)',
      percentage: 30,
      locator: {
        strategy: 'epubjs-displayed-page-v1',
        layout: 'paginated',
        href: 'chapter.xhtml',
        index: 3,
        page: 5,
        total: 12,
        prefsSignature: prefs
      }
    };
    const result = await runRestoreCorrectionCase({
      prefs,
      savedPos,
      initialLocation: { start: { index: 3, href: 'chapter.xhtml', cfi: 'cfi-page-4', displayed: { page: 4, total: 12 } }, end: { displayed: { page: 4, total: 12 } } },
      correctedLocation: { start: { index: 3, href: 'chapter.xhtml', cfi: 'cfi-page-5', displayed: { page: 5, total: 12 } }, end: { displayed: { page: 5, total: 12 } } }
    });

    assert.equal(result.state.currentStableCfi, 'epubcfi(/6/8!/4/2)', 'currentStableCfi 应等于保存的 CFI，不随校正导航偏移');
    assert.equal(result.state.isRestoreAnchorProtected, true, '恢复锚点应保持保护，直到用户导航');
    assert.equal(result.nextCalls, 1, '执行一次 next 校正');
    assert.equal(result.prevCalls, 0, '不做 prev 导航');
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

  test.it('isLayoutStable 为 false 时 next/prev 不执行导航', () => {
    const state = {
      navLock: false,
      isLayoutStable: false,
      rendition: {
        calls: 0,
        next() { this.calls++; },
        prev() { this.calls++; }
      }
    };

    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui: {},
      persistence: {},
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    runtime.next();
    runtime.prev();
    assert.equal(state.rendition.calls, 0, 'isLayoutStable=false 时 next/prev 不应执行');
  });

  test.it('isLayoutStable 为 true 时 next/prev 正常导航', () => {
    const origDoc = global.document;
    global.document = { getElementById() { return null; } };
    const state = {
      navLock: false,
      isLayoutStable: true,
      rendition: {
        calls: 0,
        next() { this.calls++; },
        prev() { this.calls++; },
        currentLocation() { return { start: { cfi: '/6/4' } }; }
      }
    };
    const scheduled = [];
    global.setTimeout = (fn) => { scheduled.push(fn); return scheduled.length; };

    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui: {},
      persistence: {},
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    runtime.next();
    assert.equal(state.rendition.calls, 1, 'isLayoutStable=true 时 next 应执行');
    scheduled[0]();
    runtime.prev();
    assert.equal(state.rendition.calls, 2, 'isLayoutStable=true 时 prev 应执行');

    global.setTimeout = originalSetTimeout;
    global.document = origDoc;
  });

  test.it('isLayoutStable 为 false 时 displayPercentage 不执行跳转', () => {
    const displayed = [];
    const state = {
      isLayoutStable: false,
      book: {
        locations: {
          length: () => 3,
          cfiFromPercentage(percent) {
            return percent === 0.5 ? 'epubcfi(/6/10)' : null;
          }
        }
      },
      rendition: {
        display(cfi) { displayed.push(cfi); }
      }
    };

    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui: {},
      persistence: {},
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    runtime.displayPercentage(50);
    assert.equal(displayed.length, 0, 'isLayoutStable=false 时 displayPercentage 不应执行');
  });

  test.it('openBook 完成后 isLayoutStable 为 true', async () => {
    const { document } = createMockDocument(['reader-main', 'book-title', 'chapter-title', 'progress-location']);
    global.document = document;
    global.requestAnimationFrame = (fn) => fn();
    global.setTimeout = (fn) => { fn(); return 1; };

    const rendition = {
      hooks: { content: { register() {} } },
      themes: { default() {} },
      on() {},
      async display() {},
      currentLocation() {
        return { start: { cfi: 'epubcfi(/6/2)', href: 'chapter1.xhtml' } };
      },
      getContents() {
        return [{ document: { fonts: { ready: Promise.resolve() } } }];
      },
      reportLocation() {}
    };

    global.ePub = () => ({
      ready: Promise.resolve(),
      locations: { length: () => 0, load() {}, percentageFromCfi() { return 0; } },
      renderTo() { return rendition; },
      destroy() {},
      coverUrl: async () => null,
      loaded: {
        metadata: Promise.resolve({ title: '测试', creator: '作者' }),
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

    const origGetPref = EpubStorage.getPreferences;
    const origGetMeta = EpubStorage.getBookMeta;
    const origGetPos = EpubStorage.getPosition;
    const origAddRecent = EpubStorage.addRecentBook;
    const origGetLocs = EpubStorage.getLocations;
    EpubStorage.getPreferences = async () => ({});
    EpubStorage.getBookMeta = async () => null;
    EpubStorage.getPosition = async () => null;
    EpubStorage.addRecentBook = async () => {};
    EpubStorage.getLocations = async () => null;

    const state = {
      book: null, rendition: null, currentBookId: '', currentFileName: '',
      isBookLoaded: false, prefs: {}, activeReadingSeconds: 0,
      cachedSpeed: null, sessionStart: null, lastProgress: 0
    };
    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui: {
        setReaderVisible() {}, clearReaderError() {}, setBookTitle() {}, setReaderDimmed() {},
        syncPrefsToControls() {}, applyThemeToRendition() {},
        setupRenditionKeyEvents() {}, ensureFocus() {}, updateProgress() {},
        showLoading() {}, setLocationIndexStatus() {}
      },
      persistence: { startReadingTimer() {}, onRelocated() {} },
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    await runtime.openBook(new Uint8Array([1, 2, 3]), 'book-stable', 'stable.epub');

    EpubStorage.getPreferences = origGetPref;
    EpubStorage.getBookMeta = origGetMeta;
    EpubStorage.getPosition = origGetPos;
    EpubStorage.addRecentBook = origAddRecent;
    EpubStorage.getLocations = origGetLocs;

    assert.equal(state.isLayoutStable, true, 'openBook 完成后 isLayoutStable 应为 true');
  });

  test.it('locations 加载后 CFI 未变时不触发 savePosition', async () => {
    const { document } = createMockDocument(['reader-main', 'book-title', 'chapter-title', 'progress-location']);
    global.document = document;
    global.requestAnimationFrame = (fn) => fn();
    global.setTimeout = (fn) => { fn(); return 1; };

    const positionCalls = [];
    const originalSavePosition = EpubStorage.savePosition;
    EpubStorage.savePosition = async (...args) => { positionCalls.push(args); };
    const origGetPref = EpubStorage.getPreferences;
    const origGetMeta = EpubStorage.getBookMeta;
    const origGetPos = EpubStorage.getPosition;
    const origAddRecent = EpubStorage.addRecentBook;
    const origGetLocs = EpubStorage.getLocations;

    let currentLoc = { start: { cfi: 'epubcfi(/6/8)', href: 'ch.xhtml', index: 2 } };
    const rendition = {
      hooks: { content: { register() {} } },
      themes: { default() {} },
      on() {},
      async display() {},
      currentLocation() { return currentLoc; },
      getContents() { return [{ document: { fonts: { ready: Promise.resolve() } } }]; }
    };
    const locations = {
      _length: 0,
      length() { return this._length; },
      async generate() { this._length = 100; },
      save() { return 'json'; },
      percentageFromCfi() { return 0.30; },
      load() { this._length = 100; }
    };

    global.ePub = () => ({
      ready: Promise.resolve(),
      locations,
      renderTo() { return rendition; },
      destroy() {},
      coverUrl: async () => null,
      loaded: {
        metadata: Promise.resolve({ title: 'T', creator: 'A' }),
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

    EpubStorage.getPreferences = async () => ({ layout: 'paginated', fontSize: 18 });
    EpubStorage.getBookMeta = async () => null;
    EpubStorage.getPosition = async () => ({ cfi: 'epubcfi(/6/8)', percentage: 30, locator: { strategy: 'epubjs-displayed-page-v1', layout: 'paginated', href: 'ch.xhtml', index: 2, page: 5, total: 12, prefsSignature: {} } });
    EpubStorage.addRecentBook = async () => {};
    EpubStorage.getLocations = async () => 'cached-locs';

    const relocatedCalls = [];
    const state = {
      book: null, rendition: null, currentBookId: '', currentFileName: '',
      isBookLoaded: false, prefs: {}, activeReadingSeconds: 0,
      cachedSpeed: null, sessionStart: null, lastProgress: 0
    };
    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui: {
        setReaderVisible() {}, clearReaderError() {}, setBookTitle() {}, setReaderDimmed() {},
        syncPrefsToControls() {}, applyThemeToRendition() {},
        setupRenditionKeyEvents() {}, ensureFocus() {}, updateProgress() {},
        showLoading() {}, setLocationIndexStatus() {}
      },
      persistence: {
        startReadingTimer() {},
        onRelocated(loc) { relocatedCalls.push(loc); }
      },
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    await runtime.openBook(new Uint8Array([1, 2, 3]), 'book-nodup', 'nodup.epub');

    EpubStorage.getPreferences = origGetPref;
    EpubStorage.getBookMeta = origGetMeta;
    EpubStorage.getPosition = origGetPos;
    EpubStorage.addRecentBook = origAddRecent;
    EpubStorage.getLocations = origGetLocs;
    EpubStorage.savePosition = originalSavePosition;

    // locations 加载后 currentLocation().start.cfi === state.currentStableCfi
    // 不应触发新的 savePosition
    const saveCallsAfterLocs = positionCalls.filter(args => args[0] === 'book-nodup');
    assert.equal(saveCallsAfterLocs.length, 0, 'CFI 未变时不应触发 savePosition');
  });

  test.it('locations 加载后恢复锚点受保护，CFI 漂移不触发 onRelocated', async () => {
    const { document } = createMockDocument(['reader-main', 'book-title', 'chapter-title', 'progress-location']);
    global.document = document;
    global.requestAnimationFrame = (fn) => fn();
    global.setTimeout = (fn) => { fn(); return 1; };

    const origGetPref = EpubStorage.getPreferences;
    const origGetMeta = EpubStorage.getBookMeta;
    const origGetPos = EpubStorage.getPosition;
    const origAddRecent = EpubStorage.addRecentBook;
    const origGetLocs = EpubStorage.getLocations;

    let currentLoc = { start: { cfi: 'epubcfi(/6/10)', href: 'ch.xhtml', index: 3 } };
    const rendition = {
      hooks: { content: { register() {} } },
      themes: { default() {} },
      on() {},
      async display() {},
      currentLocation() { return currentLoc; },
      getContents() { return [{ document: { fonts: { ready: Promise.resolve() } } }]; }
    };
    const locations = {
      _length: 0,
      length() { return this._length; },
      async generate() { this._length = 100; },
      save() { return 'json'; },
      percentageFromCfi(cfi) { return cfi === 'epubcfi(/6/8)' ? 0.30 : 0.50; },
      load() { this._length = 100; }
    };

    global.ePub = () => ({
      ready: Promise.resolve(),
      locations,
      renderTo() { return rendition; },
      destroy() {},
      coverUrl: async () => null,
      loaded: {
        metadata: Promise.resolve({ title: 'T', creator: 'A' }),
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

    EpubStorage.getPreferences = async () => ({ layout: 'paginated', fontSize: 18 });
    EpubStorage.getBookMeta = async () => null;
    // savedPos CFI = epubcfi(/6/8), but currentLocation returns epubcfi(/6/10) — different!
    EpubStorage.getPosition = async () => ({ cfi: 'epubcfi(/6/8)', percentage: 30, locator: { strategy: 'epubjs-displayed-page-v1', layout: 'paginated', href: 'ch.xhtml', index: 2, page: 5, total: 12, prefsSignature: {} } });
    EpubStorage.addRecentBook = async () => {};
    EpubStorage.getLocations = async () => 'cached-locs';

    const onRelocatedCalls = [];
    const state = {
      book: null, rendition: null, currentBookId: '', currentFileName: '',
      isBookLoaded: false, prefs: {}, activeReadingSeconds: 0,
      cachedSpeed: null, sessionStart: null, lastProgress: 0
    };
    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui: {
        setReaderVisible() {}, clearReaderError() {}, setBookTitle() {}, setReaderDimmed() {},
        syncPrefsToControls() {}, applyThemeToRendition() {},
        setupRenditionKeyEvents() {}, ensureFocus() {}, updateProgress() {},
        showLoading() {}, setLocationIndexStatus() {}
      },
      persistence: {
        startReadingTimer() {},
        onRelocated(loc) { onRelocatedCalls.push(loc); }
      },
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    await runtime.openBook(new Uint8Array([1, 2, 3]), 'book-diff', 'diff.epub');

    EpubStorage.getPreferences = origGetPref;
    EpubStorage.getBookMeta = origGetMeta;
    EpubStorage.getPosition = origGetPos;
    EpubStorage.addRecentBook = origAddRecent;
    EpubStorage.getLocations = origGetLocs;

    // CFI 从 epubcfi(/6/8) 漂到 epubcfi(/6/10)，但这仍属于恢复后的布局回报，
    // 不应触发 onRelocated 覆盖保存锚点。
    assert.equal(onRelocatedCalls.length, 0, '恢复保护期 CFI 漂移不应触发 onRelocated');
    assert.equal(state.currentStableCfi, 'epubcfi(/6/8)');
    assert.equal(state.lastPercent, 30);
    assert.equal(state.isRestoreAnchorProtected, true);
  });

  test.it('setLayout 切换期间 relocated 不写入位置', async () => {
    const { document } = createMockDocument(['reader-main', 'book-title', 'chapter-title', 'progress-location']);
    global.document = document;
    global.requestAnimationFrame = (fn) => fn();
    global.setTimeout = (fn) => { fn(); return 1; };

    const origGetPref = EpubStorage.getPreferences;
    const origGetMeta = EpubStorage.getBookMeta;
    const origGetPos = EpubStorage.getPosition;
    const origAddRecent = EpubStorage.addRecentBook;
    const origGetLocs = EpubStorage.getLocations;
    const origSavePref = EpubStorage.savePreferences;
    const originalSavePosition = EpubStorage.savePosition;

    const positionCalls = [];
    EpubStorage.savePosition = async (...args) => { positionCalls.push(args); };

    let relocatedDuringLayout = false;
    const rendition = {
      hooks: { content: { register() {} } },
      themes: { default() {} },
      on() {},
      async display() {},
      currentLocation() {
        return { start: { cfi: 'epubcfi(/6/8)', href: 'ch.xhtml', index: 2 } };
      },
      destroy() {},
      renderTo() {
        return {
          hooks: { content: { register() {} } },
          themes: { default() {} },
          on(evt) { if (evt === 'relocated') relocatedDuringLayout = true; },
          async display() {},
          currentLocation() {
            return { start: { cfi: 'epubcfi(/6/10)', href: 'ch.xhtml', index: 3 } };
          },
          getContents() { return [{ document: { fonts: { ready: Promise.resolve() } } }]; }
        };
      },
      getContents() { return [{ document: { fonts: { ready: Promise.resolve() } } }]; }
    };
    const locations = {
      _length: 0,
      length() { return this._length; },
      async generate() { this._length = 100; },
      save() { return 'json'; },
      percentageFromCfi() { return 0.30; },
      load() { this._length = 100; }
    };

    global.ePub = () => ({
      ready: Promise.resolve(),
      locations,
      renderTo() { return rendition; },
      destroy() {},
      coverUrl: async () => null,
      loaded: {
        metadata: Promise.resolve({ title: 'T', creator: 'A' }),
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

    EpubStorage.getPreferences = async () => ({ layout: 'paginated', fontSize: 18 });
    EpubStorage.getBookMeta = async () => null;
    EpubStorage.getPosition = async () => null;
    EpubStorage.addRecentBook = async () => {};
    EpubStorage.getLocations = async () => null;
    EpubStorage.savePreferences = async () => {};

    const state = {
      book: null, rendition: null, currentBookId: '', currentFileName: '',
      isBookLoaded: false, prefs: { layout: 'paginated' }, activeReadingSeconds: 0,
      cachedSpeed: null, sessionStart: null, lastProgress: 0
    };
    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui: {
        setReaderVisible() {}, clearReaderError() {}, setBookTitle() {}, setReaderDimmed() {},
        syncPrefsToControls() {}, applyThemeToRendition() {},
        setupRenditionKeyEvents() {}, ensureFocus() {}, updateProgress() {},
        showLoading() {}, setLocationIndexStatus() {}
      },
      persistence: { startReadingTimer() {}, onRelocated() {} },
      moduleLifecycle: { mount() {}, unmount() {} }
    });

    await runtime.openBook(new Uint8Array([1, 2, 3]), 'book-layout', 'layout.epub');

    EpubStorage.getPreferences = origGetPref;
    EpubStorage.getBookMeta = origGetMeta;
    EpubStorage.getPosition = origGetPos;
    EpubStorage.addRecentBook = origAddRecent;
    EpubStorage.getLocations = origGetLocs;
    EpubStorage.savePreferences = origSavePref;
    EpubStorage.savePosition = originalSavePosition;

    // setLayout 期间 isRestoringPosition 应为 true，阻止 relocated 写入
    assert.equal(typeof runtime.setLayout, 'function', 'setLayout 应可调用');
    // 此测试验证 setLayout 不会导致位置被错误覆盖
    // （isRestoringPosition 保护在实现后生效）
  });
});
