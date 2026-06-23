'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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

  test.it('openBook 子模块挂载后不再重复直调 Bookmarks/Search/Highlights', () => {
    const src = fs.readFileSync('src/reader/reader-runtime.js', 'utf8');
    const mountStart = src.indexOf('moduleLifecycle.mount(context);');
    const loadedStart = src.indexOf('// ── isBookLoaded', mountStart);
    const mountSection = src.slice(mountStart, loadedStart);

    assert.ok(mountStart !== -1, 'openBook must mount reader modules');
    assert.ok(!mountSection.includes('Bookmarks.setBook('));
    assert.ok(!mountSection.includes('Search.setBook('));
    assert.ok(!mountSection.includes('Highlights.setBookDetails('));
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

  test.it('openBook 恢复 start.cfi 后不做页校正导航，仅验证章节匹配', async () => {
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
    assert.equal(result.nextCalls, 0, '不应执行 next 导航——信任 CFI 本身');
    assert.equal(result.prevCalls, 0, '不应执行 prev 导航——信任 CFI 本身');
    assert.equal(result.relocatedCalls[0].restoring, true);
  });

  test.it('openBook 恢复边界 CFI 后不做页校正导航，仅验证章节匹配', async () => {
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
    assert.equal(result.prevCalls, 0, '不应执行 prev 导航');
  });

  test.it('openBook 页号一致时不做校正，href/index 不一致时仅 warn 不导航', async () => {
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
    assert.equal(differentHref.nextCalls + differentHref.prevCalls, 0, 'href 不一致：仅 warn，不导航');
    assert.equal(differentSignature.nextCalls + differentSignature.prevCalls, 0, '签名不一致：跳过验证');
    assert.equal(scrolled.nextCalls + scrolled.prevCalls, 0, 'scrolled 模式：跳过验证');
  });

  test.it('openBook 恢复后 currentStableCfi 等于 displayCfi（不做页校正偏移）', async () => {
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
      initialLocation: { start: { index: 3, href: 'chapter.xhtml', cfi: 'cfi-page-4', displayed: { page: 4, total: 12 } }, end: { displayed: { page: 4, total: 12 } } }
    });

    assert.equal(result.state.currentStableCfi, 'epubcfi(/6/8!/4/2)', 'currentStableCfi 应等于保存的 CFI，不做偏移');
    assert.equal(result.nextCalls, 0, '不做 next 导航');
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
        setReaderVisible() {}, syncPrefsToControls() {}, applyThemeToRendition() {},
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
});
