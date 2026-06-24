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
      });
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => run(), { timeout: 1500 });
        return;
      }
      setTimeout(() => run(), 0);
    }

    function estimateBookSizeBytes(data) {
      if (!data) return 0;
      if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size || 0;
      if (data instanceof ArrayBuffer) return data.byteLength || 0;
      if (ArrayBuffer.isView(data)) return data.byteLength || 0;
      return 0;
    }

    function chooseLocationsBreak(data) {
      const size = estimateBookSizeBytes(data);
      if (size > 3 * 1024 * 1024) return 4800;
      if (size > 1024 * 1024) return 3200;
      return 1600;
    }

    function _nextFrame() {
      return new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 0);
      });
    }

    function _delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function _isSignatureCompatible(savedSignature) {
      if (!savedSignature || typeof savedSignature !== 'object') return false;
      const current = ReaderState.buildPrefsSignature(state.prefs || {});
      return current.layout === savedSignature.layout &&
        current.fontSize === savedSignature.fontSize &&
        current.lineHeight === savedSignature.lineHeight &&
        current.fontFamily === savedSignature.fontFamily &&
        current.paragraphIndent === savedSignature.paragraphIndent &&
        current.spread === (savedSignature.spread || 'auto');
    }

    async function _waitForRenditionStable() {
      await _nextFrame();
      await _nextFrame();

      const contents = state.rendition && typeof state.rendition.getContents === 'function'
        ? state.rendition.getContents()
        : [];
      const fontPromises = contents
        .map((contentsItem) => contentsItem && contentsItem.document && contentsItem.document.fonts && contentsItem.document.fonts.ready)
        .filter(Boolean);
      if (fontPromises.length) {
        await Promise.race([
          Promise.all(fontPromises).catch(() => {}),
          _delay(300)
        ]);
      }

      // 不在此处调用 reportLocation()——display() 已触发，
      // 此处再调用会 double-defer 导致 currentLocation() 读到旧值。
      // 等待 2 帧给浏览器布局 reflow 时间。
      await _nextFrame();
      await _nextFrame();
    }

    function _getDisplayedPage(location) {
      if (!location || !location.start || !location.start.displayed) return null;
      if (typeof location.start.displayed.page !== 'number') return null;
      return {
        index: location.start.index != null ? location.start.index : null,
        href: location.start.href || '',
        page: location.start.displayed.page
      };
    }

    /**
     * 位置恢复后验证 CFI 是否落在目标章节。
     * 不再做 next/prev 页校正——CFI 本身是可靠的 DOM 位置指针，
     * 页码差异来自字体加载导致的布局偏移，不是位置错误。
     *
     * @returns {{ matched: boolean }} 章节是否匹配
     */
    async function _correctRestoredPage(savedPos) {
      const locator = savedPos && savedPos.locator;
      if (!locator || locator.strategy !== 'epubjs-displayed-page-v1') return { matched: false };
      if (locator.layout !== 'paginated' || state.prefs.layout === 'scrolled') return { matched: false };
      if (!_isSignatureCompatible(locator.prefsSignature)) return { matched: false };

      await _waitForRenditionStable();
      if (!state.rendition || typeof state.rendition.currentLocation !== 'function') return { matched: false };

      const currentPage = _getDisplayedPage(state.rendition.currentLocation());
      if (!currentPage) return { matched: false };

      // 仅验证章节是否一致（href + index），不做页码比较
      const matched = currentPage.index === locator.index && currentPage.href === locator.href;
      if (!matched) {
        console.warn('[Runtime] CFI restore: chapter mismatch', {
          expected: { href: locator.href, index: locator.index },
          actual: { href: currentPage.href, index: currentPage.index }
        });
      }
      return { matched };
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
      const openStartedAt = Date.now();

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
      ui.clearReaderError();

      state.currentBookId   = bookId;
      state.currentFileName = fileName || '';

      // ── 加载 meta & prefs ───────────────────────────────────────────────────
      const prefs = await EpubStorage.getPreferences();
      state.prefs.fontSize        = prefs.fontSize        || 18;
      state.prefs.lineHeight      = prefs.lineHeight       || 1.8;
      state.prefs.fontFamily      = prefs.fontFamily       || '';
      state.prefs.layout          = prefs.layout           || 'paginated';
      state.prefs.spread          = prefs.spread           || 'auto';
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
      ui.setupRenditionKeyEvents(state.rendition, persistence, { next, prev });

      // ── relocated / displayed ───────────────────────────────────────────────
      state.rendition.on('relocated', (location) => persistence.onRelocated(location));
      state.rendition.on('displayed', () => setTimeout(() => ui.ensureFocus(), 100));

      // ── book.ready ──────────────────────────────────────────────────────────
      await state.book.ready;

      // ── 封面提取（fire-and-forget） ─────────────────────────────────────────
      (async () => {
        let coverUrl = null;
        try {
          coverUrl = await state.book.coverUrl();
          if (coverUrl) {
            const blob = await (await fetch(coverUrl)).blob();
            await EpubStorage.saveCover(bookId, blob);
          }
        } catch (e) { console.warn('[Runtime] cover extraction failed:', e); }
        finally { if (coverUrl) URL.revokeObjectURL(coverUrl); }
      })();

      // ── metadata / title ────────────────────────────────────────────────────
      const bookMeta = await state.book.loaded.metadata;
      ui.setBookTitle(bookMeta.title || state.currentFileName);

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
      // v2.2.4 BUG-FIX：display 期间抑制 relocated 事件的位置回写，
      // 防止以 null percentage / page-start CFI 覆盖已保存的正确进度。
      state.isRestoringPosition = true;
      state.isLayoutStable = false;
      try {
        const displayCfi = targetCfi || (savedPos && savedPos.cfi ? savedPos.cfi : null);
        state.currentStableCfi = displayCfi;
        state.currentStableLocator = targetCfi ? null : (savedPos && savedPos.locator ? savedPos.locator : null);
        if (displayCfi) await state.rendition.display(displayCfi);
        else await state.rendition.display();
        if (!targetCfi && savedPos && savedPos.locator) await _correctRestoredPage(savedPos);
      } finally {
        state.isRestoringPosition = false;
        state.isLayoutStable = true;
      }
      console.info('[Runtime] open_to_first_render(ms):', Date.now() - openStartedAt);

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

      // ── isBookLoaded ─────────────────────────────────────────────────────────
      ui.showLoading(false);
      state.isBookLoaded = true;

      setTimeout(() => ui.ensureFocus(), 300);

      // ── locations 索引（idle 调度，v2.0 P-2） ───────────────────────────────
      const initSpeedTracking = (progress) => {
        state.sessionStart = { progress, timestamp: Date.now() };
        state.lastProgress = progress;
      };

      const cachedLocsJSON = await EpubStorage.getLocations(bookId);
      if (cachedLocsJSON) {
        console.info('[Runtime] locations_cache_hit:', true);
        state.book.locations.load(cachedLocsJSON);
        state.hasLocations = true;
        state.locationsStatus = 'ready';
        state.locationsBreak = null;
        state.locationsError = null;
        if (typeof ui.setLocationIndexStatus === 'function') {
          ui.setLocationIndexStatus('ready', '阅读定位索引已就绪');
        }
        // locations 已就绪，立即更新进度 / 速度追踪起点
        const loc = state.rendition.currentLocation();
        if (loc && loc.start) {
          const p = state.book.locations.percentageFromCfi(loc.start.cfi);
          initSpeedTracking(p);
          // CFI 变化检测：若 currentLocation 返回的 CFI 与已保存的相同，
          // 跳过 onRelocated 以避免用边界 CFI 覆盖正确位置。
          if (loc.start.cfi !== state.currentStableCfi) {
            persistence.onRelocated(loc);
          }
        }
        // v2.2.4：locations 加载完毕，恢复阶段结束，后续翻页正常写入
      } else {
        // v2.2.4：无缓存 locations，display 已完成，恢复阶段结束。
        // locations 异步生成期间用户可能翻页，须允许正常位置保存。
        const activeBook = state.book;
        const locationsBreak = chooseLocationsBreak(fileData);
        state.hasLocations = false;
        state.locationsStatus = 'pending';
        state.locationsBreak = locationsBreak;
        state.locationsError = null;
        if (typeof ui.setLocationIndexStatus === 'function') {
          ui.setLocationIndexStatus('pending', '准备生成阅读定位索引...');
        }
        scheduleLocationsGeneration(async () => {
          if (state.currentBookId !== bookId || state.book !== activeBook) return;

          state.locationsStatus = 'generating';
          if (typeof ui.setLocationIndexStatus === 'function') {
            ui.setLocationIndexStatus('generating', '后台生成阅读定位索引...');
          }

          const generationStartedAt = Date.now();

          try {
            await state.book.locations.generate(locationsBreak);
            if (state.currentBookId !== bookId || state.book !== activeBook) return;

            const locsJSON = state.book.locations.save();
            await EpubStorage.saveLocations(state.currentBookId, locsJSON);
            state.hasLocations = true;
            state.locationsStatus = 'ready';
            state.locationsError = null;
            console.info('[Runtime] locations_generate_duration(ms):', Date.now() - generationStartedAt);

            const loc = state.rendition.currentLocation();
            if (loc && loc.start) {
              const p = state.book.locations.percentageFromCfi(loc.start.cfi);
              initSpeedTracking(p);
              if (loc.start.cfi !== state.currentStableCfi) {
                persistence.onRelocated(loc);
              }
            }

            if (typeof ui.setLocationIndexStatus === 'function') {
              ui.setLocationIndexStatus('ready', '阅读定位索引已就绪');
            }
          } catch (e) {
            if (state.currentBookId !== bookId || state.book !== activeBook) return;

            state.hasLocations = false;
            state.locationsStatus = 'failed';
            state.locationsError = e && e.message ? e.message : String(e);
            console.warn('[Runtime] locations generate failed:', e);
            if (typeof ui.setLocationIndexStatus === 'function') {
              ui.setLocationIndexStatus('failed', '阅读定位索引不可用');
            }
            if (persistence && typeof persistence.updateReadingStats === 'function') {
              persistence.updateReadingStats();
            }
          }
        });
      }
    }

    // ── Load Helpers ──────────────────────────────────────────────────────────

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
      if (state.navLock || !state.rendition || !state.isLayoutStable) return;
      state.navLock = true;
      state.rendition.next();
      setTimeout(() => { state.navLock = false; }, 150);
    }

    async function prev() {
      if (state.navLock || !state.rendition || !state.isLayoutStable) return;
      state.navLock = true;
      const loc = state.rendition.currentLocation();
      if (loc && loc.atStart && state.prefs.layout !== 'scrolled') {
        try {
          ui.setReaderDimmed(true);
          await state.rendition.prev();
        } finally {
          ui.setReaderDimmed(false);
          setTimeout(() => { state.navLock = false; }, 150);
        }
      } else {
        state.rendition.prev();
        setTimeout(() => { state.navLock = false; }, 150);
      }
    }

    function displayPercentage(percent) {
      if (!state.rendition || !state.book || !state.isLayoutStable) return;
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
      ui.syncPrefsToControls();
      EpubStorage.savePreferences({ layout });

      if (!state.book || !state.isBookLoaded) return;

      const loc = state.rendition ? state.rendition.currentLocation() : null;
      const currentCfi = loc && loc.start ? loc.start.cfi : null;

      state.isRestoringPosition = true;
      state.rendition.destroy();
      state.rendition = state.book.renderTo('epub-viewer', {
        width:  '100%',
        height: '100%',
        spread: state.prefs.spread || 'auto',
        flow:    layout === 'scrolled' ? 'scrolled-doc' : 'paginated',
        manager: layout === 'scrolled' ? 'continuous'   : 'default',
        allowScriptedContent: false,
        gap: layout === 'scrolled' ? 48 : 80
      });

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
          'text-indent': state.prefs.paragraphIndent !== false ? '2em' : '0',
          'text-align': 'justify'
        },
        'img':   { 'max-width': '100% !important', 'height': 'auto !important' },
        'image': { 'max-width': '100% !important', 'height': 'auto !important' }
      });
      ui.applyThemeToRendition(state.prefs.theme || 'light');

      if (typeof ImageViewer !== 'undefined') ImageViewer.hookRendition(state.rendition);
      if (typeof Annotations !== 'undefined') {
        Annotations.setBook(state.book);
        Annotations.hookRendition(state.rendition);
      }
      ui.setupRenditionKeyEvents(state.rendition, persistence, { next, prev });

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

      try {
        if (currentCfi) await state.rendition.display(currentCfi);
        else await state.rendition.display();
        // 布局切换完成，等待 relocated 事件处理完毕后解除保护
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      } finally {
        state.isRestoringPosition = false;
      }
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
      state.isLayoutStable = false;
    }

    return {
      mount,
      unmount,
      openBook,
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
