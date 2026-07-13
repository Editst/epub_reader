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

  // ── 常量 ───────────────────────────────────────────────────────────────────
  const LOCATIONS_GENERATION_TIMEOUT_MS = 1500;
  const LARGE_EPUB_THRESHOLD_BYTES     = 3 * 1024 * 1024;
  const LOCATIONS_BREAK_LARGE           = 4800;
  const MEDIUM_EPUB_THRESHOLD_BYTES     = 1024 * 1024;
  const LOCATIONS_BREAK_MEDIUM          = 3200;
  const LOCATIONS_BREAK_SMALL           = 1600;
  const FONT_READY_TIMEOUT_MS           = 300;
  const GAP_SCROLLED_PX                 = 48;
  const GAP_PAGINATED_PX                = 80;
  const POST_DISPLAY_FOCUS_DELAY_MS     = 100;
  const POST_OPEN_FOCUS_DELAY_MS        = 300;
  const NAV_DEBOUNCE_MS                 = 150;
  const RESTORE_PERCENT_MISMATCH_THRESHOLD = 0.5;
  const RESTORE_DIRECT_REDISPLAY_MAX_ATTEMPTS = 1;

  function createReaderRuntime(deps) {
    const { state, ui, persistence, moduleLifecycle } = deps;
    let navigationSeq = 0;

    // ── Rendition 工厂 ───────────────────────────────────────────────────────
    // openBook 与 setLayout 共享的 rendition 创建 + 主题 + hook 逻辑

    function _createRendition(layout) {
      const rendition = state.book.renderTo('epub-viewer', {
        width:  '100%',
        height: '100%',
        spread: state.prefs.spread || 'auto',
        flow:    layout === 'scrolled' ? 'scrolled-doc' : 'paginated',
        manager: layout === 'scrolled' ? 'continuous'   : 'default',
        allowScriptedContent: false,
        gap: layout === 'scrolled' ? GAP_SCROLLED_PX : GAP_PAGINATED_PX
      });

      rendition.hooks.content.register((contents) => {
        ui.injectCustomStyleElement(contents);
      });

      rendition.themes.default({
        'body': {
          'color':                    'var(--reader-text, #2d2d2d)',
          'text-align':               'justify',
          '-webkit-font-smoothing':   'antialiased',
          '-moz-osx-font-smoothing':  'grayscale'
        },
        'p': {
          'margin-bottom': '0.5em',
          'text-indent':   state.prefs.paragraphIndent !== false ? '2em' : '0',
          'text-align':    'justify'
        },
        'img':   { 'max-width': '100% !important', 'height': 'auto !important' },
        'image': { 'max-width': '100% !important', 'height': 'auto !important' }
      });

      _wrapRenditionDisplayForPositionIntent(rendition);
      return rendition;
    }

    // ── 模块/事件挂钩 ────────────────────────────────────────────────────────
    // openBook 与 setLayout 共享的 rendition 事件 + 模块 hook 逻辑

    function _hookRenditionEvents(rendition, theme) {
      ui.applyThemeToRendition(theme || 'light');

      if (typeof ImageViewer !== 'undefined') ImageViewer.hookRendition(rendition);
      if (typeof Annotations !== 'undefined') {
        Annotations.setBook(state.book);
        Annotations.hookRendition(rendition);
      }
      _hookContentUserPositionIntent(rendition);
      ui.setupRenditionKeyEvents(rendition, persistence, { next, prev });

      rendition.on('relocated', (location) => {
        if (state.rendition !== rendition) return;
        persistence.onRelocated(location);
      });
      rendition.on('displayed', () => setTimeout(() => {
        if (state.rendition === rendition) ui.ensureFocus();
      }, POST_DISPLAY_FOCUS_DELAY_MS));
    }

    // ── Locations ─────────────────────────────────────────────────────────────

    function scheduleLocationsGeneration(task) {
      const run = () => Promise.resolve().then(task).catch((e) => {
        console.warn('[Runtime] locations generate failed:', e);
      });
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => run(), { timeout: LOCATIONS_GENERATION_TIMEOUT_MS });
        return;
      }
      setTimeout(() => run(), 0);
    }

    function _loadCachedLocations(cachedLocsJSON) {
      if (!cachedLocsJSON || !state.book || !state.book.locations || typeof state.book.locations.load !== 'function') {
        return false;
      }
      try {
        state.book.locations.load(cachedLocsJSON);
        return true;
      } catch (e) {
        console.warn('[Runtime] locations cache load failed:', e);
        return false;
      }
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
      if (size > LARGE_EPUB_THRESHOLD_BYTES) return LOCATIONS_BREAK_LARGE;
      if (size > MEDIUM_EPUB_THRESHOLD_BYTES) return LOCATIONS_BREAK_MEDIUM;
      return LOCATIONS_BREAK_SMALL;
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

    function _markUserPositionIntent() {
      state.isRestoreAnchorProtected = false;
    }

    function _hookContentUserPositionIntent(rendition) {
      if (!rendition || !rendition.hooks || !rendition.hooks.content) return;
      rendition.hooks.content.register((contents) => {
        const doc = contents && contents.document;
        if (!doc || doc.__readerPositionIntentGuarded || typeof doc.addEventListener !== 'function') return;
        const markIntent = () => {
          if (state.rendition !== rendition) return;
          if (!state.isRestoringPosition && !state.isResizing) _markUserPositionIntent();
        };
        doc.addEventListener('pointerdown', markIntent, { capture: true, passive: true });
        doc.addEventListener('touchstart', markIntent, { capture: true, passive: true });
        doc.addEventListener('mousedown', markIntent, { capture: true, passive: true });
        doc.addEventListener('keydown', markIntent, { capture: true });
        doc.addEventListener('wheel', markIntent, { capture: true, passive: true });
        doc.__readerPositionIntentGuarded = true;
      });
    }

    function _wrapRenditionDisplayForPositionIntent(rendition) {
      if (!rendition || typeof rendition.display !== 'function' || rendition.__readerDisplayGuarded) return;
      const originalDisplay = rendition.display.bind(rendition);
      rendition.display = function (...args) {
        if (state.rendition === rendition && !state.isRestoringPosition && !state.isResizing) {
          _markUserPositionIntent();
        }
        return originalDisplay(...args);
      };
      rendition.__readerDisplayGuarded = true;
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
          _delay(FONT_READY_TIMEOUT_MS)
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
        page: location.start.displayed.page,
        total: typeof location.start.displayed.total === 'number' ? location.start.displayed.total : null
      };
    }

    function _isDisplayedPageInLocatorSection(page, locator) {
      return !!page &&
        page.index === locator.index &&
        page.href === locator.href;
    }

    async function _readCurrentDisplayedPage() {
      await _waitForRenditionStable();
      if (!state.rendition || typeof state.rendition.currentLocation !== 'function') return null;
      return _getDisplayedPage(state.rendition.currentLocation());
    }

    function _getRestoreLocator(savedPos) {
      if (!savedPos || !savedPos.locator) return null;
      const locator = savedPos.locator;
      if (locator.strategy !== 'epubjs-displayed-page-v1') return null;
      if (locator.restoreCfi && locator.sourceCfi !== savedPos.cfi) return null;
      return locator;
    }

    function _getRestoreDisplayCfi(savedPos, restoreLocator) {
      if (!savedPos) return null;
      const locator = restoreLocator || _getRestoreLocator(savedPos);
      if (
        locator &&
        locator.layout === 'paginated' &&
        state.prefs.layout !== 'scrolled' &&
        typeof locator.restoreCfi === 'string' &&
        locator.restoreCfi.length > 0
      ) {
        return locator.restoreCfi;
      }
      return savedPos.cfi || null;
    }

    function _getProgressFallbackCfi(savedPos) {
      if (!savedPos || typeof savedPos.percentage !== 'number') return null;
      if (!state.book || !state.book.locations || !state.book.locations.length()) return null;
      if (typeof state.book.locations.percentageFromCfi !== 'function') return null;
      if (typeof state.book.locations.cfiFromPercentage !== 'function') return null;
      if (!savedPos.cfi) return state.book.locations.cfiFromPercentage(savedPos.percentage / 100) || null;

      let currentPercent = null;
      try {
        currentPercent = Math.round(state.book.locations.percentageFromCfi(savedPos.cfi) * 1000) / 10;
      } catch (_) {
        return null;
      }
      if (typeof currentPercent !== 'number') return null;
      if (Math.abs(currentPercent - savedPos.percentage) <= RESTORE_PERCENT_MISMATCH_THRESHOLD) return null;
      return state.book.locations.cfiFromPercentage(savedPos.percentage / 100) || null;
    }

    /**
     * 位置恢复后只用 CFI 做直接重定位，不根据 locator 页码自动翻页。
     * fresh rendition 首次 display 后 currentLocation 可能短暂回报旧分页；
     * 若同章节页码不一致，只重放同一个 displayCfi 一次，避免 next/prev 快速翻动。
     *
     * @returns {{ matched: boolean, corrected: boolean }} 章节是否匹配，是否执行过翻页校正
     */
    async function _correctRestoredPage(savedPos, displayCfi) {
      const locator = savedPos && savedPos.locator;
      if (!locator || locator.strategy !== 'epubjs-displayed-page-v1') return { matched: false, corrected: false };
      if (locator.layout !== 'paginated' || state.prefs.layout === 'scrolled') {
        state.currentStableLocator = null;
        return { matched: false, corrected: false };
      }
      if (!_isSignatureCompatible(locator.prefsSignature)) {
        state.currentStableLocator = null;
        return { matched: false, corrected: false };
      }

      let currentPage = await _readCurrentDisplayedPage();
      if (!currentPage) {
        state.currentStableLocator = null;
        return { matched: false, corrected: false };
      }

      const matched = _isDisplayedPageInLocatorSection(currentPage, locator);
      if (!matched) {
        state.currentStableLocator = null;
        return { matched: false, corrected: false };
      }

      const canRedisplay =
        !!displayCfi &&
        typeof state.rendition.display === 'function' &&
        typeof locator.page === 'number' &&
        typeof currentPage.page === 'number' &&
        (typeof locator.total !== 'number' || currentPage.total === locator.total);

      for (let attempt = 0; canRedisplay && currentPage.page !== locator.page && attempt < RESTORE_DIRECT_REDISPLAY_MAX_ATTEMPTS; attempt++) {
        try {
          await state.rendition.display(displayCfi);
        } catch (_) {
          return { matched: true, corrected: false };
        }
        currentPage = await _readCurrentDisplayedPage();
        if (!_isDisplayedPageInLocatorSection(currentPage, locator)) {
          state.currentStableLocator = null;
          return { matched: false, corrected: false };
        }
      }

      return { matched: true, corrected: false };
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

    async function _teardownActiveBookForReplacement() {
      if (!state.book && !state.rendition) {
        state.isBookLoaded = false;
        state.isLayoutStable = false;
        state.navLock = false;
        return;
      }

      const oldBookId = state.currentBookId;
      const shouldFlushSession = !!(oldBookId && state.isBookLoaded);

      if (shouldFlushSession) {
        try {
          await persistence.flushPositionSave();
          await EpubStorage.saveReadingTime(oldBookId, state.activeReadingSeconds);
          await persistence.flushSpeedSession(null);
        } catch (e) {
          console.warn('[Runtime] teardown flush failed:', e);
        }
      }

      try {
        moduleLifecycle.unmount();
      } catch (e) {
        console.warn('[Runtime] module unmount failed:', e);
      }

      if (state.rendition && typeof state.rendition.destroy === 'function') {
        try { state.rendition.destroy(); } catch (e) { console.warn('[Runtime] rendition destroy failed:', e); }
      }
      if (state.book && typeof state.book.destroy === 'function') {
        try { state.book.destroy(); } catch (e) { console.warn('[Runtime] book destroy failed:', e); }
      }

      state.book = null;
      state.rendition = null;
      state.isBookLoaded = false;
      state.isLayoutStable = false;
      state.navLock = false;
      ReaderState.resetReadingSession(state);
    }

    // ── Open Book ─────────────────────────────────────────────────────────────

    /**
     * 完整书籍打开流程。
     *
     * @param {ArrayBuffer|Uint8Array|Blob} fileData
     * @param {string} bookId
     * @param {string} fileName
     * @param {string|null} [targetCfi]  指定跳转位置（覆盖 storage savedPos）
     */
    async function openBook(fileData, bookId, fileName, targetCfi = null) {
      const openStartedAt = Date.now();

      // ── 清理旧书 ────────────────────────────────────────────────────────────
      await _teardownActiveBookForReplacement();

      ui.setReaderVisible(true);
      ui.clearReaderError();

      state.currentBookId   = bookId;
      state.currentFileName = fileName || '';
      state.isBookLoaded = false;
      state.isLayoutStable = false;
      state.navLock = false;

      // ── 加载 meta & prefs ───────────────────────────────────────────────────
      const prefs = await EpubStorage.getPreferences();
      state.prefs = { ...state.prefs, ...(prefs || {}) };
      ui.syncPrefsToControls();

      const meta = await EpubStorage.getBookMeta(bookId);
      state.activeReadingSeconds = (meta && meta.time) ? meta.time : 0;
      // 直接初始化内存缓存，避免再次读取同一份 bookMeta。
      state.cachedSpeed = (meta && meta.speed)
        ? meta.speed
        : { sampledSeconds: 0, sampledProgress: 0 };

      // ── 启动计时 ────────────────────────────────────────────────────────────
      persistence.startReadingTimer();

      // ── ePub 实例化 ─────────────────────────────────────────────────────────
      state.book = ePub(normalizeBookData(fileData));

      // ── Rendition ───────────────────────────────────────────────────────────
      state.rendition = _createRendition(state.prefs.layout);

      // ── 子模块挂钩 ──────────────────────────────────────────────────────────
      _hookRenditionEvents(state.rendition, state.prefs.theme);

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

      let cachedLocsJSON = await EpubStorage.getLocations(bookId);
      let cachedLocationsLoaded = _loadCachedLocations(cachedLocsJSON);
      if (cachedLocsJSON && !cachedLocationsLoaded) cachedLocsJSON = null;

      // ── display（位置恢复） ──────────────────────────────────────────────────
      // display 恢复期间抑制 relocated 回写，避免 null percentage 或
      // page-start CFI 覆盖已保存的正确进度。
      state.isRestoringPosition = true;
      state.isLayoutStable = false;
      try {
        const restoreLocator = targetCfi ? null : _getRestoreLocator(savedPos);
        const progressFallbackCfi = targetCfi ? null : _getProgressFallbackCfi(savedPos);
        const displayCfi = targetCfi || progressFallbackCfi || _getRestoreDisplayCfi(savedPos, restoreLocator);
        state.currentStableCfi = targetCfi || progressFallbackCfi || (savedPos && savedPos.cfi ? savedPos.cfi : null);
        state.currentStableLocator = targetCfi || progressFallbackCfi ? null : restoreLocator;
        state.isRestoreAnchorProtected = !!displayCfi && state.prefs.layout !== 'scrolled';
        if (targetCfi) {
          state.lastPercent = null;
        } else if (savedPos && savedPos.percentage !== undefined) {
          state.lastPercent = savedPos.percentage;
        }
        if (displayCfi) await state.rendition.display(displayCfi);
        else await state.rendition.display();
        if (!targetCfi && savedPos && state.currentStableLocator) {
          await _correctRestoredPage({ ...savedPos, locator: state.currentStableLocator }, displayCfi);
        }
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
        fileName:  state.currentFileName,
        navigate:  navigateTo
      };
      moduleLifecycle.mount(context);

      // ── isBookLoaded ─────────────────────────────────────────────────────────
      ui.showLoading(false);
      state.isBookLoaded = true;

      setTimeout(() => ui.ensureFocus(), POST_OPEN_FOCUS_DELAY_MS);

      // ── locations 索引（idle 调度，v2.0 P-2） ───────────────────────────────
      const initSpeedTracking = (progress) => {
        state.sessionStart = { progress, timestamp: Date.now() };
        state.lastProgress = progress;
      };

      if (cachedLocsJSON) {
        console.info('[Runtime] locations_cache_hit:', true);
        if (!cachedLocationsLoaded) state.book.locations.load(cachedLocsJSON);
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
          const progressCfi = state.isRestoreAnchorProtected && state.currentStableCfi
            ? state.currentStableCfi
            : loc.start.cfi;
          const p = state.book.locations.percentageFromCfi(progressCfi);
          initSpeedTracking(p);
          const percent = Math.round(p * 1000) / 10;
          state.lastPercent = percent;
          ui.updateProgress(percent);
          // CFI 变化检测：若 currentLocation 返回的 CFI 与已保存的相同，
          // 跳过 onRelocated 以避免用边界 CFI 覆盖正确位置。
          if (!state.isRestoreAnchorProtected && loc.start.cfi !== state.currentStableCfi) {
            persistence.onRelocated(loc);
          }
        }
        // locations 加载完毕后，后续翻页恢复正常写入。
      } else {
        // 无缓存时 display 已完成，locations 在后台生成。
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
              const progressCfi = state.isRestoreAnchorProtected && state.currentStableCfi
                ? state.currentStableCfi
                : loc.start.cfi;
              const p = state.book.locations.percentageFromCfi(progressCfi);
              initSpeedTracking(p);
              const percent = Math.round(p * 1000) / 10;
              state.lastPercent = percent;
              ui.updateProgress(percent);
              if (!state.isRestoreAnchorProtected && loc.start.cfi !== state.currentStableCfi) {
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
            await openBook(record.data, bookId, state.currentFileName, targetCfi);
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

    async function _performNavigation(label, operation) {
      try {
        await operation();
        return true;
      } catch (e) {
        console.warn(`[Runtime] navigation failed (${label}):`, e);
        return false;
      }
    }

    function _scheduleNavigationUnlock(navigationId) {
      setTimeout(() => {
        if (navigationId === navigationSeq) state.navLock = false;
      }, NAV_DEBOUNCE_MS);
    }

    async function navigateTo(target) {
      if (!target || !state.rendition || !state.isLayoutStable) return false;
      _markUserPositionIntent();
      return _performNavigation('display', () => state.rendition.display(target));
    }

    async function next() {
      if (state.navLock || !state.rendition || !state.isLayoutStable) return false;
      _markUserPositionIntent();
      state.navLock = true;
      const navigationId = ++navigationSeq;
      try {
        return await _performNavigation('next', () => state.rendition.next());
      } finally {
        _scheduleNavigationUnlock(navigationId);
      }
    }

    async function prev() {
      if (state.navLock || !state.rendition || !state.isLayoutStable) return false;
      _markUserPositionIntent();
      state.navLock = true;
      const navigationId = ++navigationSeq;
      let dimmed = false;
      try {
        return await _performNavigation('prev', async () => {
          const loc = state.rendition.currentLocation();
          dimmed = !!loc?.atStart && state.prefs.layout !== 'scrolled';
          if (dimmed) {
            ui.setReaderDimmed(true);
          }
          await state.rendition.prev();
        });
      } finally {
        if (dimmed) {
          ui.setReaderDimmed(false);
        }
        _scheduleNavigationUnlock(navigationId);
      }
    }

    async function displayPercentage(percent) {
      if (!state.rendition || !state.book || !state.isLayoutStable) return false;
      if (!state.book.locations || !state.book.locations.length()) return false;
      const cfi = state.book.locations.cfiFromPercentage(percent / 100);
      if (!cfi) return false;
      _markUserPositionIntent();
      return _performNavigation('display percentage', () => state.rendition.display(cfi));
    }

    // ── Layout Switch ─────────────────────────────────────────────────────────

    /**
     * 布局切换：重建 rendition，保留当前阅读位置。
     * 不重新 openBook，避免重置当前阅读会话。
     *
     * @param {string} layout  'paginated' | 'scrolled'
     */
    async function setLayout(layout) {
      if (!layout || !['paginated', 'scrolled'].includes(layout)) return;
      state.prefs.layout = layout;
      ui.syncPrefsToControls();
      EpubStorage.savePreferences({ layout }).catch((e) => {
        console.warn('[Runtime] save layout preference failed:', e);
      });

      if (!state.book || !state.isBookLoaded) return;

      const loc = state.rendition ? state.rendition.currentLocation() : null;
      const currentCfi = loc && loc.start ? loc.start.cfi : null;

      state.isRestoringPosition = true;
      try {
        state.rendition.destroy();
        state.rendition = _createRendition(layout);

        _hookRenditionEvents(state.rendition, state.prefs.theme);

        if (typeof TOC !== 'undefined') TOC.build(state.book.navigation, state.rendition);
        if (typeof Bookmarks !== 'undefined') {
          Bookmarks.setBook(state.currentBookId, state.book, state.rendition);
        }
        if (typeof Search !== 'undefined') Search.setBook(state.book, state.rendition);
        if (typeof Highlights !== 'undefined') {
          Highlights.setBookDetails(state.currentBookId, state.currentFileName, state.rendition);
        }

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
