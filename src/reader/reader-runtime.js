/**
 * reader-runtime.js — epub.js 生命周期与核心阅读行为
 *
 * 职责：
 *   - openBook：完整书籍加载流程（渲染器、主题、模块挂载、位置恢复、locations 索引）
 *   - loadFileByBookId：从 IndexedDB 缓存加载（URL 参数启动）
 *   - next / prev：翻页（含 _navLock 防连击、prev 章头特效）
 *   - displayPercentage：进度条跳转
 *   - setLayout：布局切换（重建 rendition，保留位置）
 *   - scheduleLocationsGeneration：requestIdleCallback 后台任务包装
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
  const CONTENT_UNIT_VERSION            = 1;
  const CONTENT_UNIT_EXCLUDED_SELECTOR  = 'script,style,noscript,template,[hidden],[aria-hidden="true"],rt,rp';
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
    let layoutSeq = 0;
    let lifecycleSeq = 0;
    let isMounted = true;
    let openBookQueue = Promise.resolve();

    function _createAbortError(message) {
      const error = new Error(message);
      error.name = 'AbortError';
      return error;
    }

    function _assertOpenActive(openLifecycleSeq) {
      if (!isMounted || openLifecycleSeq !== lifecycleSeq) {
        throw _createAbortError('Reader runtime lifecycle ended while opening a book');
      }
    }

    async function _attemptStorage(label, operation, fallback) {
      try {
        return await operation();
      } catch (e) {
        console.warn(`[Runtime] ${label} failed, using fallback:`, e);
        return fallback;
      }
    }

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

    function _mountFeatureModules() {
      moduleLifecycle.mount({
        book: state.book,
        rendition: state.rendition,
        bookId: state.currentBookId,
        navigate: navigateTo,
        panelController: ui
      });
    }

    // ── Locations ─────────────────────────────────────────────────────────────

    function scheduleLocationsGeneration(task) {
      const run = () => Promise.resolve().then(task).catch((e) => {
        console.warn('[Runtime] background task failed:', e);
      });
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => run(), { timeout: LOCATIONS_GENERATION_TIMEOUT_MS });
        return;
      }
      setTimeout(() => run(), 0);
    }

    function _hasCurrentContentUnitCount(speed) {
      return !!speed &&
        speed.contentUnitVersion === CONTENT_UNIT_VERSION &&
        Number.isFinite(speed.contentUnitCount) &&
        speed.contentUnitCount >= 0;
    }

    function _isActiveBook(bookId, activeBook) {
      return state.currentBookId === bookId && state.book === activeBook;
    }

    function _getSectionReadingText(item, loadedContent) {
      const doc = item && item.document
        ? item.document
        : (loadedContent && loadedContent.nodeType === 9 ? loadedContent : null);
      const root = doc && (doc.body || doc.documentElement)
        ? (doc.body || doc.documentElement)
        : (loadedContent && loadedContent.nodeType ? loadedContent : null);
      if (!root) throw new Error('Section document is unavailable');

      if (typeof root.cloneNode !== 'function') return root.textContent || '';
      const clone = root.cloneNode(true);
      if (typeof clone.querySelectorAll === 'function') {
        clone.querySelectorAll(CONTENT_UNIT_EXCLUDED_SELECTOR).forEach((node) => {
          if (typeof node.remove === 'function') node.remove();
          else if (node.parentNode) node.parentNode.removeChild(node);
        });
      }
      return clone.textContent || '';
    }

    async function _countBookContentUnits(bookId, activeBook) {
      const spine = activeBook && activeBook.spine;
      if (!spine || !Number.isFinite(spine.length) || typeof spine.get !== 'function') {
        throw new Error('Book spine is unavailable');
      }

      const activeLoad = typeof activeBook.load === 'function'
        ? activeBook.load.bind(activeBook)
        : undefined;
      let totalUnits = 0;

      for (let index = 0; index < spine.length; index++) {
        if (!_isActiveBook(bookId, activeBook)) return null;
        const item = spine.get(index);
        if (!item || typeof item.load !== 'function') {
          throw new Error(`Section ${index} cannot be loaded`);
        }

        let loaded = false;
        try {
          const loadedContent = await item.load(activeLoad);
          loaded = true;
          if (!_isActiveBook(bookId, activeBook)) return null;
          totalUnits += Utils.countReadingUnits(_getSectionReadingText(item, loadedContent));
        } finally {
          if (loaded && typeof item.unload === 'function') {
            try {
              item.unload();
            } catch (e) {
              console.warn(`[Runtime] content unit section ${index} unload failed:`, e);
            }
          }
        }
        await _delay(0);
      }

      return totalUnits;
    }

    function _scheduleContentUnitCount(bookId, activeBook) {
      if (_hasCurrentContentUnitCount(state.cachedSpeed)) {
        state.contentUnitStatus = 'ready';
        return;
      }

      const spine = activeBook && activeBook.spine;
      if (!spine || !Number.isFinite(spine.length) || typeof spine.get !== 'function') {
        state.contentUnitStatus = 'failed';
        if (persistence && typeof persistence.updateReadingStats === 'function') {
          persistence.updateReadingStats();
        }
        return;
      }

      state.contentUnitStatus = 'pending';
      if (persistence && typeof persistence.updateReadingStats === 'function') {
        persistence.updateReadingStats();
      }

      scheduleLocationsGeneration(async () => {
        if (!_isActiveBook(bookId, activeBook)) return;
        try {
          const contentUnitCount = await _countBookContentUnits(bookId, activeBook);
          if (contentUnitCount === null || !_isActiveBook(bookId, activeBook)) return;

          const speedPatch = {
            contentUnitCount,
            contentUnitVersion: CONTENT_UNIT_VERSION
          };
          await EpubStorage.saveReadingSpeed(bookId, speedPatch);
          if (!_isActiveBook(bookId, activeBook)) return;

          state.cachedSpeed = { ...state.cachedSpeed, ...speedPatch };
          state.contentUnitStatus = 'ready';
        } catch (e) {
          if (!_isActiveBook(bookId, activeBook)) return;
          state.contentUnitStatus = 'failed';
          console.warn('[Runtime] content unit count failed:', e);
        }

        if (persistence && typeof persistence.updateReadingStats === 'function') {
          persistence.updateReadingStats();
        }
      });
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

    async function _waitForRenditionStable(rendition = state.rendition) {
      await _nextFrame();
      await _nextFrame();

      const contents = rendition && typeof rendition.getContents === 'function'
        ? rendition.getContents()
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

    function _destroyActiveBookResources() {
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
    }

    async function _teardownActiveBookForReplacement() {
      if (!state.book && !state.rendition) {
        state.currentBookId = '';
        state.currentFileName = '';
        state.isBookLoaded = false;
        state.isLayoutStable = false;
        state.navLock = false;
        ReaderState.resetReadingSession(state);
        return;
      }

      const oldBookId = state.currentBookId;
      const shouldFlushSession = !!(oldBookId && state.isBookLoaded);

      if (shouldFlushSession) {
        const flushTasks = [
          () => typeof persistence.flushPositionSave === 'function'
            ? persistence.flushPositionSave()
            : undefined,
          () => typeof persistence.flushReadingTime === 'function'
            ? persistence.flushReadingTime(oldBookId)
            : undefined,
          () => typeof persistence.flushSpeedSession === 'function'
            ? persistence.flushSpeedSession(null)
            : undefined
        ].map((task) => {
          try {
            return Promise.resolve(task());
          } catch (e) {
            return Promise.reject(e);
          }
        });
        const flushResults = await Promise.allSettled(flushTasks);
        flushResults.forEach((result) => {
          if (result.status === 'rejected') {
            console.warn('[Runtime] teardown flush failed:', result.reason);
          }
        });
      }

      _destroyActiveBookResources();

      state.book = null;
      state.rendition = null;
      state.currentBookId = '';
      state.currentFileName = '';
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
    async function _openBook(fileData, bookId, fileName, targetCfi, openLifecycleSeq) {
      const openStartedAt = Date.now();
      layoutSeq++;
      _assertOpenActive(openLifecycleSeq);

      // ── 清理旧书 ────────────────────────────────────────────────────────────
      await _teardownActiveBookForReplacement();
      _assertOpenActive(openLifecycleSeq);
      try {
        return await _initializeBook(
          fileData, bookId, fileName, targetCfi, openStartedAt, openLifecycleSeq
        );
      } catch (error) {
        await _teardownActiveBookForReplacement();
        throw error;
      }
    }

    function _applyLocationsProgress(initSpeedTracking) {
      const loc = state.rendition.currentLocation();
      if (!loc || !loc.start) return;

      const progressCfi = state.isRestoreAnchorProtected && state.currentStableCfi
        ? state.currentStableCfi
        : loc.start.cfi;
      const progress = state.book.locations.percentageFromCfi(progressCfi);
      initSpeedTracking(progress);
      const percent = Math.round(progress * 1000) / 10;
      state.lastPercent = percent;
      ui.updateProgress(percent);
      if (!state.isRestoreAnchorProtected && loc.start.cfi !== state.currentStableCfi) {
        persistence.onRelocated(loc);
      }
    }

    function _initLocationsFromCache(cachedLocsJSON, cachedLocationsLoaded, initSpeedTracking) {
      console.info('[Runtime] locations_cache_hit:', true);
      if (!cachedLocationsLoaded) state.book.locations.load(cachedLocsJSON);
      state.locationsStatus = 'ready';
      if (typeof ui.setLocationIndexStatus === 'function') {
        ui.setLocationIndexStatus('ready', '阅读定位索引已就绪');
      }
      _applyLocationsProgress(initSpeedTracking);
    }

    function _scheduleLocationsGeneration(bookId, fileData, activeBook, initSpeedTracking) {
      const locationsBreak = chooseLocationsBreak(fileData);
      state.locationsStatus = 'pending';
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
          await activeBook.locations.generate(locationsBreak);
          if (state.currentBookId !== bookId || state.book !== activeBook) return;

          const locsJSON = activeBook.locations.save();
          await EpubStorage.saveLocations(bookId, locsJSON);
          if (state.currentBookId !== bookId || state.book !== activeBook) return;

          state.locationsStatus = 'ready';
          console.info('[Runtime] locations_generate_duration(ms):', Date.now() - generationStartedAt);
          _applyLocationsProgress(initSpeedTracking);
          if (typeof ui.setLocationIndexStatus === 'function') {
            ui.setLocationIndexStatus('ready', '阅读定位索引已就绪');
          }
        } catch (e) {
          if (state.currentBookId !== bookId || state.book !== activeBook) return;

          state.locationsStatus = 'failed';
          console.warn('[Runtime] locations generate failed:', e);
          if (typeof ui.setLocationIndexStatus === 'function') {
            ui.setLocationIndexStatus('failed', '阅读定位索引不可用');
          }
          if (persistence && typeof persistence.updateReadingStats === 'function') {
            persistence.updateReadingStats();
          }
        }

        if (_isActiveBook(bookId, activeBook)) {
          _scheduleContentUnitCount(bookId, activeBook);
        }
      });
    }

    async function _initializeBook(
      fileData, bookId, fileName, targetCfi, openStartedAt, openLifecycleSeq
    ) {
      ui.setReaderVisible(true);
      ui.clearReaderError();

      state.currentBookId   = bookId;
      state.currentFileName = fileName || '';
      state.isBookLoaded = false;
      state.isLayoutStable = false;
      state.navLock = false;

      // ── 加载 meta & prefs ───────────────────────────────────────────────────
      const prefs = await _attemptStorage(
        'load preferences',
        () => EpubStorage.getPreferences(),
        null
      );
      _assertOpenActive(openLifecycleSeq);
      state.prefs = { ...state.prefs, ...(prefs || {}) };
      ui.syncPrefsToControls();

      const meta = await _attemptStorage(
        'load book metadata',
        () => EpubStorage.getBookMeta(bookId),
        null
      );
      _assertOpenActive(openLifecycleSeq);
      state.activeReadingSeconds = (meta && meta.time) ? meta.time : 0;
      state.pendingReadingSeconds = 0;
      state.lastReadingTimeSave = null;
      // 直接初始化内存缓存，避免再次读取同一份 bookMeta。
      state.cachedSpeed = (meta && meta.speed)
        ? meta.speed
        : {
          sampledSeconds: 0,
          sampledProgress: 0,
          sessions: [],
          sessionCount: 0,
          contentUnitCount: null,
          contentUnitVersion: 0
        };
      state.contentUnitStatus = _hasCurrentContentUnitCount(state.cachedSpeed)
        ? 'ready'
        : 'idle';

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
      _assertOpenActive(openLifecycleSeq);

      // ── 封面提取（fire-and-forget） ─────────────────────────────────────────
      const activeBook = state.book;
      (async () => {
        let coverUrl = null;
        try {
          coverUrl = await activeBook.coverUrl();
          if (coverUrl) {
            const blob = await (await fetch(coverUrl)).blob();
            await EpubStorage.saveCover(bookId, blob);
          }
        } catch (e) { console.warn('[Runtime] cover extraction failed:', e); }
        finally { if (coverUrl) URL.revokeObjectURL(coverUrl); }
      })();

      // ── metadata / title ────────────────────────────────────────────────────
      const bookMeta = await state.book.loaded.metadata;
      _assertOpenActive(openLifecycleSeq);
      ui.setBookTitle(bookMeta.title || state.currentFileName);

      // ── TOC ─────────────────────────────────────────────────────────────────
      await state.book.loaded.navigation;
      _assertOpenActive(openLifecycleSeq);

      // ── savedPos → 进度条初始值 ─────────────────────────────────────────────
      const savedPos = meta && meta.pos ? meta.pos : null;
      if (savedPos && savedPos.percentage !== undefined) {
        const initialPercent = Math.round(savedPos.percentage * 10) / 10;
        ui.updateProgress(initialPercent);
      }

      let cachedLocsJSON = await _attemptStorage(
        'load locations cache',
        () => EpubStorage.getLocations(bookId),
        null
      );
      _assertOpenActive(openLifecycleSeq);
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
        _assertOpenActive(openLifecycleSeq);
        if (!targetCfi && savedPos && state.currentStableLocator) {
          await _correctRestoredPage({ ...savedPos, locator: state.currentStableLocator }, displayCfi);
          _assertOpenActive(openLifecycleSeq);
        }
      } finally {
        state.isRestoringPosition = false;
        state.isLayoutStable = true;
      }
      console.info('[Runtime] open_to_first_render(ms):', Date.now() - openStartedAt);

      // ── recentBooks ─────────────────────────────────────────────────────────
      await _attemptStorage(
        'update recent books',
        () => EpubStorage.addRecentBook({
          id:       bookId,
          title:    bookMeta.title   || '',
          author:   bookMeta.creator || '',
          filename: state.currentFileName
        }),
        undefined
      );
      _assertOpenActive(openLifecycleSeq);

      // ── 子模块 mount（统一生命周期） ─────────────────────────────────────────
      _mountFeatureModules();

      // ── isBookLoaded ─────────────────────────────────────────────────────────
      ui.showLoading(false);
      state.isBookLoaded = true;

      const openedBook = state.book;
      const openedRendition = state.rendition;
      setTimeout(() => {
        if (!isMounted || state.book !== openedBook || state.rendition !== openedRendition) return;
        ui.ensureFocus();
      }, POST_OPEN_FOCUS_DELAY_MS);

      // ── locations 索引（idle 调度） ────────────────────────────────────────
      const initSpeedTracking = (progress) => {
        state.sessionStart = { progress, timestamp: Date.now() };
        state.lastProgress = progress;
      };

      if (cachedLocsJSON) {
        _initLocationsFromCache(cachedLocsJSON, cachedLocationsLoaded, initSpeedTracking);
        _scheduleContentUnitCount(bookId, state.book);
      } else {
        _scheduleLocationsGeneration(bookId, fileData, state.book, initSpeedTracking);
      }
    }

    function openBook(fileData, bookId, fileName, targetCfi = null) {
      const openLifecycleSeq = lifecycleSeq;
      const task = openBookQueue.then(() => {
        _assertOpenActive(openLifecycleSeq);
        return _openBook(fileData, bookId, fileName, targetCfi, openLifecycleSeq);
      });
      openBookQueue = task.catch(() => {});
      return task;
    }

    // ── Load Helpers ──────────────────────────────────────────────────────────

    async function loadFileByBookId(bookId, options = {}) {
      const { targetCfi = null } = options;
      const loadLifecycleSeq = lifecycleSeq;
      try {
        ui.showLoading(true);
        const record = await EpubStorage.getFile(bookId);
        _assertOpenActive(loadLifecycleSeq);
        if (record && record.data) {
          const fileName = record.filename || '';
          try {
            await openBook(record.data, bookId, fileName, targetCfi);
          } catch (err) {
            if (err?.name === 'AbortError') return;
            console.error('[Runtime] loadFileByBookId: openBook failed', err);
            ui.showLoadError('无法解析该 EPUB 缓存文件: ' + err.message);
          }
        } else {
          ui.showLoadError('该书籍缓存不存在或已被自动清理，请通过"打开文件"重新导入。');
        }
      } catch (e) {
        if (e?.name === 'AbortError') return;
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

    function _saveLayoutPreferenceSafely(layout) {
      EpubStorage.savePreferences({ layout }).catch((e) => {
        console.warn('[Runtime] save layout preference failed:', e);
      });
    }

    async function _displayLayoutRendition(rendition, cfi, isActive) {
      if (cfi) await rendition.display(cfi);
      else await rendition.display();
      await _waitForRenditionStable(rendition);
      if (isActive && !isActive()) return false;
      // 新 rendition 首次 display 时，字体与自定义行距可能尚未完成重排。
      // 稳定后只重放同一个 CFI 一次，避免落在重排前分页对应的错误列。
      if (cfi) {
        await rendition.display(cfi);
        await _waitForRenditionStable(rendition);
      }
      return !isActive || isActive();
    }

    function _isCurrentLayoutContext(layoutId, activeBook, activeRendition) {
      return layoutId === layoutSeq &&
        state.book === activeBook &&
        (!activeRendition || state.rendition === activeRendition);
    }

    function _destroyRenditionSafely(rendition, warningLabel) {
      if (!rendition || typeof rendition.destroy !== 'function') return;
      try {
        rendition.destroy();
      } catch (e) {
        console.warn(`[Runtime] ${warningLabel}:`, e);
      }
    }

    function _clearBrokenLayoutContext() {
      _destroyActiveBookResources();
      state.book = null;
      state.rendition = null;
      state.currentBookId = '';
      state.currentFileName = '';
      state.isBookLoaded = false;
      state.navLock = false;
      ReaderState.resetReadingSession(state);
      if (typeof ui.showLoadError === 'function') {
        ui.showLoadError('切换阅读布局失败，请重新打开该书籍。');
      }
    }

    function _getLayoutRestoreCfi(rendition) {
      const locator = state.currentStableLocator;
      if (
        locator &&
        locator.sourceCfi === state.currentStableCfi &&
        typeof locator.restoreCfi === 'string' &&
        locator.restoreCfi
      ) {
        return locator.restoreCfi;
      }
      try {
        const location = rendition && rendition.currentLocation();
        return location?.start?.cfi || state.currentStableCfi || null;
      } catch (e) {
        console.warn('[Runtime] layout switch could not read current location:', e);
        return state.currentStableCfi || null;
      }
    }

    async function _rollbackLayout(
      previousLayout, currentCfi, failedRendition, layoutId, activeBook
    ) {
      state.prefs.layout = previousLayout;
      ui.syncPrefsToControls();
      _destroyRenditionSafely(failedRendition, 'failed rendition cleanup after layout error');

      let rollbackRendition = failedRendition;
      try {
        const rendition = _createRendition(previousLayout);
        rollbackRendition = rendition;
        state.rendition = rendition;
        _hookRenditionEvents(rendition, state.prefs.theme);
        _mountFeatureModules();
        const displayed = await _displayLayoutRendition(
          rendition,
          currentCfi,
          () => _isCurrentLayoutContext(layoutId, activeBook, rendition)
        );
        if (!displayed) return null;
        return rendition;
      } catch (e) {
        if (_isCurrentLayoutContext(layoutId, activeBook, rollbackRendition)) {
          console.error('[Runtime] layout rollback failed:', e);
          _clearBrokenLayoutContext();
        } else {
          console.warn('[Runtime] stale layout rollback failure ignored:', e);
        }
        return null;
      }
    }

    /**
     * 布局切换：重建 rendition，保留当前阅读位置。
     * 不重新 openBook，避免重置当前阅读会话。
     *
     * @param {string} layout  'paginated' | 'scrolled'
     */
    async function setLayout(layout) {
      if (!layout || !['paginated', 'scrolled'].includes(layout)) return false;
      if (!state.book || !state.isBookLoaded) {
        state.prefs.layout = layout;
        ui.syncPrefsToControls();
        _saveLayoutPreferenceSafely(layout);
        return true;
      }

      const layoutId = ++layoutSeq;
      const activeBook = state.book;
      const previousLayout = state.prefs.layout;
      const previousRendition = state.rendition;
      const currentCfi = _getLayoutRestoreCfi(previousRendition);

      let activeRendition = previousRendition;
      let layoutCompleted = false;
      let layoutRecovered = false;

      state.isRestoringPosition = true;
      state.isLayoutStable = false;
      try {
        if (previousRendition && typeof previousRendition.destroy === 'function') {
          previousRendition.destroy();
        }
        state.prefs.layout = layout;
        ui.syncPrefsToControls();
        state.rendition = _createRendition(layout);
        activeRendition = state.rendition;

        _hookRenditionEvents(state.rendition, state.prefs.theme);

        _mountFeatureModules();

        const displayed = await _displayLayoutRendition(
          activeRendition,
          currentCfi,
          () => _isCurrentLayoutContext(layoutId, activeBook, activeRendition)
        );
        if (!displayed) return false;
        if (!_isCurrentLayoutContext(layoutId, activeBook, activeRendition)) return false;
        layoutCompleted = true;
        _saveLayoutPreferenceSafely(layout);
        return true;
      } catch (e) {
        console.warn('[Runtime] layout switch failed, restoring previous layout:', e);
        if (!_isCurrentLayoutContext(layoutId, activeBook)) return false;

        activeRendition = await _rollbackLayout(
          previousLayout, currentCfi, activeRendition, layoutId, activeBook
        );
        layoutRecovered = !!activeRendition;
        return false;
      } finally {
        if (_isCurrentLayoutContext(layoutId, activeBook, activeRendition)) {
          state.isRestoringPosition = false;
          state.isLayoutStable = layoutCompleted || layoutRecovered;
        }
      }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async function mount() {
      if (!isMounted) lifecycleSeq++;
      isMounted = true;
    }

    function discardDeletedBook(bookId) {
      if (!bookId || state.currentBookId !== bookId) return false;
      lifecycleSeq++;
      layoutSeq++;
      navigationSeq++;
      _destroyActiveBookResources();

      state.book = null;
      state.rendition = null;
      state.currentBookId = '';
      state.currentFileName = '';
      state.isBookLoaded = false;
      state.isLayoutStable = false;
      state.navLock = false;
      ReaderState.resetReadingSession(state);
      return true;
    }

    function unmount() {
      isMounted = false;
      lifecycleSeq++;
      layoutSeq++;
      _destroyActiveBookResources();

      state.book = null;
      state.rendition = null;
      state.currentBookId = '';
      state.currentFileName = '';
      state.isBookLoaded = false;
      state.isLayoutStable = false;
      state.navLock = false;
      ReaderState.resetReadingSession(state);
    }

    return {
      mount,
      unmount,
      openBook,
      loadFileByBookId,
      discardDeletedBook,
      scheduleLocationsGeneration,
      next,
      prev,
      displayPercentage,
      setLayout
    };
  }

  window.ReaderRuntime = { createReaderRuntime };
})();
