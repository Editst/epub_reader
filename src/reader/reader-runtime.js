/**
 * reader-runtime.js — epub.js 生命周期与核心阅读行为
 *
 * 职责：
 *   - openBook：完整书籍加载流程（渲染器、主题、模块挂载、位置恢复、locations 索引）
 *   - loadEpubFile：从 File 对象加载（由 UI 层 drag/open 调用）
 *   - loadFileByBookId：从 IndexedDB 缓存加载（URL 参数启动）
 *   - next / prev：翻页（含 _navLock 防连击、prev 章头特效）
 *   - displayPercentage：进度条跳转
 *   - setLayout：布局切换（重建 rendition，保留位置）
 *   - scheduleLocationsGeneration：requestIdleCallback 包装
 *
 * 本层不持有 DOM 引用，视图操作通过 ui.* 调用。
 * 阅读计时 / 速度 / 位置写入由 persistence.* 负责。
 */
(function () {
  'use strict';

  function createReaderRuntime(deps) {
    const { state, ui, persistence, moduleLifecycle } = deps;

    // ── Locations ─────────────────────────────────────────────────────────────

    function scheduleLocationsGeneration(task) {
      const run = () => Promise.resolve().then(task).catch((e) => {
        console.warn('[Runtime] locations generate failed:', e);
        ui.showLoading(false);
      });
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => run(), { timeout: 1500 });
        return;
      }
      setTimeout(() => run(), 0);
    }

    // ── Data Normalization ────────────────────────────────────────────────────

    function normalizeBookData(data) {
      if (!data) return data;
      if (data instanceof ArrayBuffer) return data;
      if (data instanceof Blob) return data;
      if (ArrayBuffer.isView(data)) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      }
      return data;
    }

    // ── Open Book ─────────────────────────────────────────────────────────────

    /**
     * 完整书籍打开流程。与 reader-full.js openBook 严格对齐。
     *
     * @param {ArrayBuffer|Uint8Array|Blob} fileData
     * @param {string} bookId
     * @param {string} fileName
     * @param {string|null} [targetCfi]  指定跳转位置（覆盖 storage savedPos）
     */
    async function openBook(fileData, bookId, fileName, targetCfi = null) {
      // ── 清理旧书 ────────────────────────────────────────────────────────────
      if (state.book) {
        state.book.destroy();
        if (typeof TOC !== 'undefined' && TOC.reset) TOC.reset();
        if (typeof Bookmarks !== 'undefined' && Bookmarks.reset) Bookmarks.reset();
        if (typeof Search !== 'undefined' && Search.reset) Search.reset();
        moduleLifecycle.unmount();
        ReaderState.resetReadingSession(state);
      }

      ui.setReaderVisible(true);
      // 清除上次加载失败留下的 error 样式（对应 showLoadError 设置的 reader-main-error）
      const readerMainEl = document.getElementById('reader-main');
      if (readerMainEl) readerMainEl.classList.remove('reader-main-error');

      state.currentBookId   = bookId;
      state.currentFileName = fileName || '';

      // ── 加载 meta & prefs ───────────────────────────────────────────────────
      const prefs = await EpubStorage.getPreferences();
      state.prefs.fontSize        = prefs.fontSize        || 18;
      state.prefs.lineHeight      = prefs.lineHeight       || 1.8;
      state.prefs.fontFamily      = prefs.fontFamily       || '';
      state.prefs.layout          = prefs.layout           || 'paginated';
      state.prefs.paragraphIndent = prefs.paragraphIndent !== false;
      ui.syncPrefsToControls();

      const meta = await EpubStorage.getBookMeta(bookId);
      state.activeReadingSeconds = (meta && meta.time) ? meta.time : 0;
      // v1.8.0 BUG-02-A：直接初始化内存缓存，不依赖异步读取路径
      state.cachedSpeed = (meta && meta.speed)
        ? meta.speed
        : { sampledSeconds: 0, sampledProgress: 0 };

      // ── 启动计时 ────────────────────────────────────────────────────────────
      persistence.startReadingTimer();

      // ── ePub 实例化 ─────────────────────────────────────────────────────────
      state.book = ePub(normalizeBookData(fileData));

      // ── Rendition ───────────────────────────────────────────────────────────
      state.rendition = state.book.renderTo('epub-viewer', {
        width:  '100%',
        height: '100%',
        spread: prefs.spread || 'auto',
        flow:    state.prefs.layout === 'scrolled' ? 'scrolled-doc' : 'paginated',
        manager: state.prefs.layout === 'scrolled' ? 'continuous'   : 'default',
        allowScriptedContent: false,
        gap: state.prefs.layout === 'scrolled' ? 48 : 80
      });

      state.rendition.hooks.content.register((contents) => {
        ui.injectCustomStyleElement(contents);
      });

      state.rendition.themes.default({
        'body': {
          'color':                    'var(--reader-text, #2d2d2d)',
          'text-align':               'justify',
          '-webkit-font-smoothing':   'antialiased',
          '-moz-osx-font-smoothing':  'grayscale'
        },
        'p': {
          'margin-bottom': '0.5em',
          'text-indent':   state.prefs.paragraphIndent ? '2em' : '0',
          'text-align':    'justify'
        },
        'img':   { 'max-width': '100% !important', 'height': 'auto !important' },
        'image': { 'max-width': '100% !important', 'height': 'auto !important' }
      });

      ui.applyThemeToRendition(prefs.theme || 'light');

      // ── 子模块挂钩 ──────────────────────────────────────────────────────────
      if (typeof ImageViewer !== 'undefined') ImageViewer.hookRendition(state.rendition);
      if (typeof Annotations !== 'undefined') {
        Annotations.setBook(state.book);
        Annotations.hookRendition(state.rendition);
      }
      ui.setupRenditionKeyEvents(state.rendition, persistence);

      // ── relocated / displayed ───────────────────────────────────────────────
      state.rendition.on('relocated', (location) => persistence.onRelocated(location));
      state.rendition.on('displayed', () => setTimeout(() => ui.ensureFocus(), 100));

      // ── book.ready ──────────────────────────────────────────────────────────
      await state.book.ready;

      // ── 封面提取（fire-and-forget） ─────────────────────────────────────────
      (async () => {
        try {
          const coverUrl = await state.book.coverUrl();
          if (coverUrl) {
            const blob = await (await fetch(coverUrl)).blob();
            await EpubStorage.saveCover(bookId, blob);
          }
        } catch (e) { console.warn('[Runtime] cover extraction failed:', e); }
      })();

      // ── metadata / title ────────────────────────────────────────────────────
      const bookMeta = await state.book.loaded.metadata;
      const bookTitle = bookMeta.title || state.currentFileName;
      const titleEl = document.getElementById('book-title');
      if (titleEl) titleEl.textContent = bookTitle;
      document.title = bookTitle + ' - EPUB Reader';

      // ── TOC ─────────────────────────────────────────────────────────────────
      const navigation = await state.book.loaded.navigation;
      if (typeof TOC !== 'undefined') TOC.build(navigation, state.rendition);

      // ── savedPos → 进度条初始值 ─────────────────────────────────────────────
      const savedPos = await EpubStorage.getPosition(bookId);
      if (savedPos && savedPos.percentage !== undefined) {
        const initialPercent = Math.round(savedPos.percentage * 10) / 10;
        ui.updateProgress(initialPercent);
      }

      // ── display（位置恢复） ──────────────────────────────────────────────────
      const displayCfi = targetCfi || (savedPos && savedPos.cfi ? savedPos.cfi : null);
      if (displayCfi) await state.rendition.display(displayCfi);
      else await state.rendition.display();

      // ── recentBooks ─────────────────────────────────────────────────────────
      await EpubStorage.addRecentBook({
        id:       bookId,
        title:    bookMeta.title   || '',
        author:   bookMeta.creator || '',
        filename: state.currentFileName
      });

      // ── 子模块 mount（统一生命周期） ─────────────────────────────────────────
      const context = {
        book:      state.book,
        rendition: state.rendition,
        bookId:    state.currentBookId,
        fileName:  state.currentFileName
      };
      moduleLifecycle.mount(context);

      // ── 各模块显式 setBook / setBookDetails（兼容旧接口） ──────────────────
      if (typeof Bookmarks !== 'undefined') {
        Bookmarks.setBook(state.currentBookId, state.book, state.rendition);
      }
      if (typeof Search !== 'undefined') {
        Search.setBook(state.book, state.rendition);
      }

      // ── isBookLoaded ─────────────────────────────────────────────────────────
      ui.showLoading(false);
      state.isBookLoaded = true;

      if (typeof Highlights !== 'undefined') {
        Highlights.setBookDetails(state.currentBookId, state.currentFileName, state.rendition);
      }

      setTimeout(() => ui.ensureFocus(), 300);

      // ── locations 索引（idle 调度，v2.0 P-2） ───────────────────────────────
      const initSpeedTracking = (progress) => {
        state.sessionStart = { progress, timestamp: Date.now() };
        state.lastProgress = progress;
      };

      const cachedLocsJSON = await EpubStorage.getLocations(bookId);
      if (cachedLocsJSON) {
        state.book.locations.load(cachedLocsJSON);
        // locations 已就绪，立即更新进度 / 速度追踪起点
        const loc = state.rendition.currentLocation();
        if (loc && loc.start) {
          const p = state.book.locations.percentageFromCfi(loc.start.cfi);
          initSpeedTracking(p);
          persistence.onRelocated(loc);
        }
      } else {
        ui.showLoading(true, '准备定位索引...');
        scheduleLocationsGeneration(async () => {
          ui.showLoading(true, '生成阅读定位索引...');
          await state.book.locations.generate(1600);
          const locsJSON = state.book.locations.save();
          await EpubStorage.saveLocations(state.currentBookId, locsJSON);
          const loc = state.rendition.currentLocation();
          if (loc && loc.start) {
            const p = state.book.locations.percentageFromCfi(loc.start.cfi);
            initSpeedTracking(p);
            persistence.onRelocated(loc);
          }
          ui.showLoading(false, '定位索引就绪');
        });
      }
    }

    // ── Load Helpers ──────────────────────────────────────────────────────────

    async function loadEpubFile(file) {
      try {
        ui.showLoading(true);
        state.currentFileName = file.name;
        const arrayBuffer = await file.arrayBuffer();
        const bookId = await EpubStorage.generateBookId(file.name, arrayBuffer);
        EpubStorage.storeFile(file.name, new Uint8Array(arrayBuffer), bookId).catch(e => {
          console.warn('[Runtime] Failed to store book in IndexedDB:', e);
        });
        await openBook(arrayBuffer, bookId, file.name);
      } catch (err) {
        console.error('[Runtime] Failed to load EPUB:', err);
        ui.showLoadError('无法加载此 EPUB 文件: ' + err.message);
      }
    }

    async function loadFileByBookId(bookId, options = {}) {
      const { targetCfi = null } = options;
      try {
        ui.showLoading(true);
        const record = await EpubStorage.getFile(bookId);
        if (record && record.data) {
          state.currentBookId   = bookId;
          state.currentFileName = record.filename || '';
          try {
            await openBook(record.data.buffer || record.data, bookId, state.currentFileName, targetCfi);
          } catch (err) {
            console.error('[Runtime] loadFileByBookId: openBook failed', err);
            ui.showLoadError('无法解析该 EPUB 缓存文件: ' + err.message);
          }
        } else {
          ui.showLoadError('该书籍缓存不存在或已被自动清理，请通过"打开文件"重新导入。');
        }
      } catch (e) {
        console.error('[Runtime] loadFileByBookId error:', e);
        ui.showLoadError('读取缓存数据失败。请重新导入该电子书。');
      }
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    function next() {
      if (state.navLock || !state.rendition) return;
      state.navLock = true;
      state.rendition.next();
      setTimeout(() => { state.navLock = false; }, 150);
    }

    async function prev() {
      if (state.navLock || !state.rendition) return;
      state.navLock = true;
      const loc = state.rendition.currentLocation();
      const readerMain = document.getElementById('reader-main');
      if (loc && loc.atStart && state.prefs.layout !== 'scrolled') {
        try {
          if (readerMain) readerMain.classList.add('reader-main-dimmed');
          await state.rendition.prev();
        } finally {
          if (readerMain) readerMain.classList.remove('reader-main-dimmed');
          setTimeout(() => { state.navLock = false; }, 150);
        }
      } else {
        state.rendition.prev();
        setTimeout(() => { state.navLock = false; }, 150);
      }
    }

    function displayPercentage(percent) {
      if (!state.rendition || !state.book) return;
      if (!state.book.locations || !state.book.locations.length()) return;
      const cfi = state.book.locations.cfiFromPercentage(percent / 100);
      if (cfi) state.rendition.display(cfi);
    }

    // ── Layout Switch ─────────────────────────────────────────────────────────

    /**
     * 布局切换：重建 rendition，保留当前阅读位置。
     * 与 reader-full.js setLayout 严格对齐（不重新 openBook，避免状态重置）。
     *
     * @param {string} layout  'paginated' | 'scrolled'
     */
    async function setLayout(layout) {
      if (!layout || !['paginated', 'scrolled'].includes(layout)) return;
      state.prefs.layout = layout;
      document.querySelectorAll('.layout-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.layout === layout);
      });
      EpubStorage.savePreferences({ layout });

      if (!state.book || !state.isBookLoaded) return;

      const loc = state.rendition ? state.rendition.currentLocation() : null;
      const currentCfi = loc && loc.start ? loc.start.cfi : null;

      state.rendition.destroy();
      state.rendition = state.book.renderTo('epub-viewer', {
        width:  '100%',
        height: '100%',
        spread: 'auto',
        flow:    layout === 'scrolled' ? 'scrolled-doc' : 'paginated',
        manager: layout === 'scrolled' ? 'continuous'   : 'default',
        allowScriptedContent: false,
        gap: layout === 'scrolled' ? 48 : 80
      });

      const prefs = await EpubStorage.getPreferences();

      state.rendition.hooks.content.register((contents) => {
        ui.injectCustomStyleElement(contents);
      });
      state.rendition.themes.default({
        'body': {
          'color': 'var(--reader-text, #2d2d2d)',
          'text-align': 'justify',
          '-webkit-font-smoothing': 'antialiased',
          '-moz-osx-font-smoothing': 'grayscale'
        },
        'p': {
          'margin-bottom': '0.5em',
          'text-indent': prefs.paragraphIndent !== false ? '2em' : '0',
          'text-align': 'justify'
        },
        'img':   { 'max-width': '100% !important', 'height': 'auto !important' }
      });
      ui.applyThemeToRendition(prefs.theme || 'light');

      if (typeof ImageViewer !== 'undefined') ImageViewer.hookRendition(state.rendition);
      if (typeof Annotations !== 'undefined') Annotations.hookRendition(state.rendition);
      ui.setupRenditionKeyEvents(state.rendition, persistence);

      state.rendition.on('relocated', (location) => persistence.onRelocated(location));
      state.rendition.on('displayed', () => setTimeout(() => ui.ensureFocus(), 100));

      if (typeof TOC !== 'undefined') TOC.build(state.book.navigation, state.rendition);
      if (typeof Bookmarks !== 'undefined') {
        Bookmarks.setBook(state.currentBookId, state.book, state.rendition);
      }
      if (typeof Search !== 'undefined') Search.setBook(state.book, state.rendition);
      if (typeof Highlights !== 'undefined') {
        Highlights.setBookDetails(state.currentBookId, state.currentFileName, state.rendition);
      }

      if (currentCfi) state.rendition.display(currentCfi);
      else state.rendition.display();
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async function mount() {
      // runtime 本身无需额外初始化，openBook 在调用时按需启动
    }

    function unmount() {
      if (state.rendition) {
        moduleLifecycle.unmount();
        state.rendition.destroy();
      }
      state.book        = null;
      state.rendition   = null;
      state.isBookLoaded = false;
    }

    return {
      mount,
      unmount,
      openBook,
      loadEpubFile,
      loadFileByBookId,
      scheduleLocationsGeneration,
      next,
      prev,
      displayPercentage,
      setLayout
    };
  }

  window.ReaderRuntime = { createReaderRuntime };
})();
