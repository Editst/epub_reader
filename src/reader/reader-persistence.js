/**
 * reader-persistence.js — 位置/时间/速度写入策略
 *
 * 职责：
 *   - schedulePositionSave：300ms 防抖写入位置
 *   - flushPositionSave：立即写入（页面隐藏时）
 *   - flushSpeedSession：结束 session，累加 cachedSpeed 写入 storage
 *   - onRelocated：relocated 事件主处理器（更新进度 / 章节 / 速度追踪）
 *   - startReadingTimer：1s 计时器，每 10s 写入时长，每 60s 刷新 ETA
 *   - updateReadingStats：更新底部时长 + ETA 展示
 *   - visibilitychange 监听：隐藏时 flush 全部，可见时重置 session 起点
 *
 * 本层不持有 DOM 引用，所有视图操作通过 ui.* 调用。
 */
(function () {
  'use strict';

  // ── 常量 ───────────────────────────────────────────────────────────────────
  const POSITION_SAVE_DEBOUNCE_MS      = 300;
  const SPEED_MIN_PROGRESS_DELTA       = 0.001;
  const SPEED_MAX_PROGRESS_DELTA       = 0.30;
  const SPEED_MIN_SESSION_SECONDS      = 30;
  const JUMP_DETECTION_THRESHOLD       = 0.05;
  const CHARS_PER_LOCATION_ESTIMATE    = 150;
  const READING_SPEED_CHARS_PER_MINUTE = 400;
  const READING_TIMER_INTERVAL_MS      = 1000;
  const READING_TIME_FLUSH_INTERVAL_S  = 10;
  const READING_STATS_UPDATE_INTERVAL_S = 60;
  const START_CFI_NUDGE_CHARS          = 1;
  const NODE_TYPE_TEXT                 = 3;
  const NODE_FILTER_SHOW_TEXT          = 4;
  const VISIBLE_ANCHOR_X_RATIOS        = [0.5, 0.42, 0.58, 0.35, 0.65];
  const VISIBLE_ANCHOR_Y_RATIOS        = [0.45, 0.35, 0.55, 0.25, 0.70];

  function createReaderPersistence({ state, ui }) {

    // ── Position ─────────────────────────────────────────────────────────────

    function _savePosition(bookId, cfi, percent, locator) {
      if (locator !== undefined) return EpubStorage.savePosition(bookId, cfi, percent, locator);
      return EpubStorage.savePosition(bookId, cfi, percent);
    }

    function _savePositionSafely(bookId, cfi, percent, locator) {
      let write;
      try {
        write = _savePosition(bookId, cfi, percent, locator);
      } catch (e) {
        write = Promise.reject(e);
      }
      state.lastPositionSave = Promise.resolve(write).catch((e) => {
        console.warn('[Persistence] save position failed:', e);
      });
      return state.lastPositionSave;
    }

    function _saveReadingTimeSafely(bookId, seconds) {
      let write;
      try {
        write = EpubStorage.saveReadingTime(bookId, seconds);
      } catch (e) {
        write = Promise.reject(e);
      }
      return Promise.resolve(write).catch((e) => {
        console.warn('[Persistence] save reading time failed:', e);
      });
    }

    /**
     * 比较新旧 CFI，判断位置是否发生了有意义的变化。
     * 字符串精确比较——CFI 不同就视为变化，保证不丢失用户的精确位置。
     *
     * @param {string|null} newCfi
     * @param {string|null} oldCfi
     * @returns {boolean} true 表示位置有变化，应触发写入
     */
    function _isPositionMeaningfullyChanged(newCfi, oldCfi) {
      if (!newCfi && !oldCfi) return false;
      if (!newCfi || !oldCfi) return true;
      return newCfi !== oldCfi;
    }

    function _isPercentMeaningfullyChanged(newPercent, oldPercent) {
      if (newPercent === null || newPercent === undefined) return false;
      if (oldPercent === null || oldPercent === undefined) return true;
      return newPercent !== oldPercent;
    }

    function _isLocatorMeaningfullyChanged(newLocator, oldLocator) {
      if (!newLocator && !oldLocator) return false;
      if (!newLocator || !oldLocator) return true;

      const fields = ['strategy', 'layout', 'href', 'index', 'page', 'total', 'sourceCfi', 'restoreCfi'];
      for (const field of fields) {
        if (newLocator[field] !== oldLocator[field]) return true;
      }

      const newSig = newLocator.prefsSignature || {};
      const oldSig = oldLocator.prefsSignature || {};
      const sigFields = ['layout', 'fontSize', 'lineHeight', 'fontFamily', 'paragraphIndent', 'spread'];
      for (const field of sigFields) {
        if (newSig[field] !== oldSig[field]) return true;
      }

      return false;
    }

    function schedulePositionSave(bookId, cfi, percent, locator) {
      _savePositionSafely(bookId, cfi, percent, locator);
      clearTimeout(state.posTimer);
      state.posTimer = setTimeout(() => {
        state.posTimer = null;
      }, POSITION_SAVE_DEBOUNCE_MS);
    }

    function _buildDisplayedPageLocator(location, restoreCfi) {
      if (!location || !location.start) return null;
      const layout = (state.prefs && state.prefs.layout) || 'paginated';
      const displayed = location.start.displayed || {};
      const locator = {
        strategy: 'epubjs-displayed-page-v1',
        layout,
        sourceCfi: location.start.cfi,
        href: location.start.href || '',
        index: location.start.index != null ? location.start.index : null,
        page: layout === 'paginated' && typeof displayed.page === 'number' ? displayed.page : null,
        total: layout === 'paginated' && typeof displayed.total === 'number' ? displayed.total : null,
        prefsSignature: ReaderState.buildPrefsSignature(state.prefs || {})
      };
      if (restoreCfi && restoreCfi !== location.start.cfi) locator.restoreCfi = restoreCfi;
      return locator;
    }

    function _isPaginatedLayout() {
      return ((state.prefs && state.prefs.layout) || 'paginated') !== 'scrolled';
    }

    function _isUsableCfi(cfi) {
      return typeof cfi === 'string' && cfi.length > 0;
    }

    function _cfiFromRange(contents, range) {
      if (!contents || !range || typeof contents.cfiFromRange !== 'function') return null;
      try {
        const cfi = contents.cfiFromRange(range);
        return _isUsableCfi(cfi) ? cfi : null;
      } catch (_) {
        return null;
      }
    }

    function _rangeFromCfi(contents, cfi) {
      if (!contents || !cfi || typeof contents.range !== 'function') return null;
      try {
        return contents.range(cfi) || null;
      } catch (_) {
        return null;
      }
    }

    function _createCollapsedRange(doc, node, offset) {
      if (!doc || !node || typeof doc.createRange !== 'function') return null;
      try {
        const range = doc.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        return range;
      } catch (_) {
        return null;
      }
    }

    function _findNextTextNode(doc, currentNode) {
      const root = doc && (doc.body || doc.documentElement);
      if (!root || !currentNode || typeof doc.createTreeWalker !== 'function') return null;
      try {
        const walker = doc.createTreeWalker(root, NODE_FILTER_SHOW_TEXT);
        let seenCurrent = false;
        let node = walker.nextNode();
        while (node) {
          if (seenCurrent && node.data && node.data.length > 0) return node;
          if (node === currentNode) seenCurrent = true;
          node = walker.nextNode();
        }
      } catch (_) {
        return null;
      }
      return null;
    }

    function _findFirstTextNode(doc, rootNode) {
      if (!doc || !rootNode) return null;
      if (rootNode.nodeType === NODE_TYPE_TEXT && rootNode.data && rootNode.data.length > 0) return rootNode;
      if (typeof doc.createTreeWalker !== 'function') return null;
      try {
        const walker = doc.createTreeWalker(rootNode, NODE_FILTER_SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (node.data && node.data.length > 0) return node;
          node = walker.nextNode();
        }
      } catch (_) {
        return null;
      }
      return null;
    }

    function _nudgeRangeForward(range) {
      if (!range || !range.startContainer) return null;
      const node = range.startContainer;
      const doc = node.ownerDocument || (node.documentElement ? node : null);
      if (!doc) return null;

      if (node.nodeType === NODE_TYPE_TEXT) {
        const textLength = node.data ? node.data.length : 0;
        if (textLength > range.startOffset) {
          const nextOffset = Math.min(textLength, range.startOffset + START_CFI_NUDGE_CHARS);
          return _createCollapsedRange(doc, node, nextOffset);
        }
        const nextText = _findNextTextNode(doc, node);
        return nextText ? _createCollapsedRange(doc, nextText, Math.min(START_CFI_NUDGE_CHARS, nextText.data.length)) : null;
      }

      const child = node.childNodes && node.childNodes[range.startOffset];
      const firstText = _findFirstTextNode(doc, child);
      if (firstText) {
        return _createCollapsedRange(doc, firstText, Math.min(START_CFI_NUDGE_CHARS, firstText.data.length));
      }
      const nextText = _findNextTextNode(doc, node);
      return nextText ? _createCollapsedRange(doc, nextText, Math.min(START_CFI_NUDGE_CHARS, nextText.data.length)) : null;
    }

    function _getContentViewport(contents) {
      const doc = contents && contents.document;
      if (!doc) return null;
      const win = contents.window || doc.defaultView;
      const width = (win && win.innerWidth) ||
        (doc.documentElement && doc.documentElement.clientWidth) ||
        (doc.body && doc.body.clientWidth) ||
        0;
      const height = (win && win.innerHeight) ||
        (doc.documentElement && doc.documentElement.clientHeight) ||
        (doc.body && doc.body.clientHeight) ||
        0;
      if (!width || !height) return null;
      return { width, height };
    }

    function _rangeFromPoint(doc, x, y) {
      if (!doc) return null;
      try {
        if (typeof doc.caretRangeFromPoint === 'function') {
          return doc.caretRangeFromPoint(x, y) || null;
        }
        if (typeof doc.caretPositionFromPoint === 'function') {
          const pos = doc.caretPositionFromPoint(x, y);
          if (!pos) return null;
          const node = pos.offsetNode || pos.anchorNode;
          const offset = pos.offset != null ? pos.offset : pos.anchorOffset;
          return _createCollapsedRange(doc, node, offset || 0);
        }
      } catch (_) {
        return null;
      }
      return null;
    }

    function _getVisibleAnchorXs(viewport, location) {
      const displayed = location && location.start && location.start.displayed;
      const page = displayed && typeof displayed.page === 'number' ? displayed.page : null;
      const total = displayed && typeof displayed.total === 'number' ? displayed.total : null;
      if (page && total && total > 1 && page >= 1 && page <= total) {
        const columnWidth = viewport.width / total;
        const columnLeft = columnWidth * (page - 1);
        return VISIBLE_ANCHOR_X_RATIOS.map((ratio) => columnLeft + columnWidth * ratio);
      }
      return VISIBLE_ANCHOR_X_RATIOS.map((ratio) => viewport.width * ratio);
    }

    function _buildVisiblePageAnchorCfi(location) {
      if (!_isPaginatedLayout()) return null;
      if (!state.rendition || typeof state.rendition.getContents !== 'function') return null;

      let contentsList = [];
      try {
        contentsList = state.rendition.getContents() || [];
      } catch (_) {
        return null;
      }

      for (const contents of contentsList) {
        const doc = contents && contents.document;
        const viewport = _getContentViewport(contents);
        if (!doc || !viewport) continue;
        const anchorXs = _getVisibleAnchorXs(viewport, location);

        for (const yRatio of VISIBLE_ANCHOR_Y_RATIOS) {
          for (const x of anchorXs) {
            const range = _rangeFromPoint(
              doc,
              Math.round(x),
              Math.round(viewport.height * yRatio)
            );
            const cfi = _cfiFromRange(contents, range);
            if (cfi) return cfi;
          }
        }
      }

      return null;
    }

    function _buildStartInnerAnchorCfi(sourceCfi) {
      if (!_isPaginatedLayout()) return null;
      if (!sourceCfi) return null;
      if (!state.rendition || typeof state.rendition.getContents !== 'function') return null;

      let contentsList = [];
      try {
        contentsList = state.rendition.getContents() || [];
      } catch (_) {
        return null;
      }

      for (const contents of contentsList) {
        const sourceRange = _rangeFromCfi(contents, sourceCfi);
        const nudgedRange = _nudgeRangeForward(sourceRange);
        const nudgedCfi = _cfiFromRange(contents, nudgedRange);
        if (nudgedCfi && nudgedCfi !== sourceCfi) return nudgedCfi;
      }

      return null;
    }

    function _buildRestoreAnchorCfi(sourceCfi, location) {
      return _buildVisiblePageAnchorCfi(location) || _buildStartInnerAnchorCfi(sourceCfi) || sourceCfi;
    }

    function _buildPositionFromLocation(location) {
      if (!location || !location.start || !location.start.cfi) {
        return { cfi: null, percent: null, locator: null, sourceCfi: null };
      }
      const sourceCfi = location.start.cfi;
      const restoreCfi = _buildRestoreAnchorCfi(sourceCfi, location);
      let percent = null;
      if (sourceCfi && state.book && state.book.locations && state.book.locations.length()) {
        const progress = state.book.locations.percentageFromCfi(sourceCfi);
        percent = Math.round(progress * 1000) / 10;
      } else if (typeof location.start.percentage === 'number') {
        const progress = location.start.percentage <= 1 ? location.start.percentage * 100 : location.start.percentage;
        percent = Math.round(progress * 10) / 10;
      }
      return { cfi: sourceCfi, percent, locator: _buildDisplayedPageLocator(location, restoreCfi), sourceCfi };
    }

    function _refreshStablePositionFromRendition() {
      if (state.isRestoringPosition || state.isResizing) return;
      if (state.isRestoreAnchorProtected) return;
      if (!state.rendition || typeof state.rendition.currentLocation !== 'function') return;
      const position = _buildPositionFromLocation(state.rendition.currentLocation());
      if (!position.cfi) return;
      state.currentStableCfi = position.cfi;
      state.currentStableLocator = position.locator;
      if (position.percent !== null) state.lastPercent = position.percent;
    }

    function flushPositionSave() {
      const hasPendingPositionSave = !!state.posTimer;
      clearTimeout(state.posTimer);
      state.posTimer = null;
      if (!hasPendingPositionSave) _refreshStablePositionFromRendition();
      if (state.currentBookId && state.currentStableCfi) {
        return _savePositionSafely(
          state.currentBookId,
          state.currentStableCfi,
          state.lastPercent,
          state.currentStableLocator
        );
      }
      return state.lastPositionSave || Promise.resolve();
    }

    // ── Speed Session ─────────────────────────────────────────────────────────

    /**
     * 结束当前 speed session，有效样本累加到 cachedSpeed 并写入 storage。
     *
     * 有效条件（与 reader-full.js 严格对齐）：
     *   deltaProgress ∈ (0.001, 0.30)  读了 0.1%–30%
     *   deltaSeconds  > 30              持续 30s 以上
     *
     * v2.0 升级：应用 Utils.computeSessionWeight 跳读识别权重。
     *
     * @param {number|null} newStartProgress  null=session 结束；数字=跳跃后续期
     */
    async function flushSpeedSession(newStartProgress = null) {
      if (!state.sessionStart || !state.currentBookId || !state.isBookLoaded) return;

      const deltaProgress = state.lastProgress - state.sessionStart.progress;
      const deltaSeconds  = (Date.now() - state.sessionStart.timestamp) / 1000;

      if (deltaProgress > SPEED_MIN_PROGRESS_DELTA && deltaProgress < SPEED_MAX_PROGRESS_DELTA && deltaSeconds > SPEED_MIN_SESSION_SECONDS) {
        try {
          if (!state.cachedSpeed) {
            state.cachedSpeed = { sampledSeconds: 0, sampledProgress: 0 };
          }
          const weight = Utils.computeSessionWeight(deltaProgress, deltaSeconds);
          state.cachedSpeed = {
            sampledSeconds:  state.cachedSpeed.sampledSeconds  + (deltaSeconds  * weight),
            sampledProgress: state.cachedSpeed.sampledProgress + (deltaProgress * weight)
          };
          await EpubStorage.saveReadingSpeed(state.currentBookId, state.cachedSpeed);
        } catch (e) {
          console.warn('[Persistence] Failed to save speed sample:', e);
        }
      }

      state.sessionStart = (newStartProgress !== null)
        ? { progress: newStartProgress, timestamp: Date.now() }
        : null;
    }

    // ── Location / Progress ───────────────────────────────────────────────────

    /**
     * relocated 事件主处理器。
     * 与 reader-full.js onLocationChanged 功能完全对齐。
     *
     * @param {object} location  epub.js location 对象
     */
    function onRelocated(location) {
      if (state.isResizing) return;
      if (!location || !location.start) return;

      let percent = null;
      if (state.book && state.book.locations && state.book.locations.length()) {
        const progress = state.book.locations.percentageFromCfi(location.start.cfi);
        percent = Math.round(progress * 1000) / 10;
        ui.updateProgress(percent);

        // 跳跃检测：>5% 视为手动跳转，结束当前 session 并以新位置续期
        if (state.sessionStart && Math.abs(progress - state.lastProgress) > JUMP_DETECTION_THRESHOLD) {
          flushSpeedSession(progress);  // async，非阻塞
        }
        state.lastProgress = progress;
      }

      updateReadingStats();

      // 事件参数优先用于 UI；持久化快照稍后按 currentLocation/事件源二选一构建。
      const eventPosition = _buildPositionFromLocation(location);

      // 章节标题 + TOC 高亮（使用事件参数，反映用户可见的最新位置）
      const currentSection = location.start.href;
      if (currentSection) {
        const tocItem = ReaderState.findTocItem(
          state.book && state.book.navigation ? state.book.navigation.toc : [],
          currentSection
        );
        ui.updateChapterTitle(tocItem ? tocItem.label.trim() : '');
        if (typeof TOC !== 'undefined' && TOC.setActive) TOC.setActive(currentSection);
      }

      // 恢复期间跳过写入，也不替换 currentStableCfi；正常阅读时写入。
      // relocated 事件是 epub.js 对本次导航给出的最新位置；currentLocation()
      // 在同一 tick 内可能仍是上一页，只在事件缺失 CFI 时作为兜底。
      if (!state.isRestoringPosition && !state.isRestoreAnchorProtected) {
        const currentLoc = state.rendition && typeof state.rendition.currentLocation === 'function'
          ? state.rendition.currentLocation()
          : null;
        const currentPosition = _buildPositionFromLocation(currentLoc);
        const position = eventPosition.cfi ? eventPosition : currentPosition;
        const cfi = position.cfi || location.start.cfi;
        const nextPercent = position.percent !== null ? position.percent : percent;
        const cfiChanged = _isPositionMeaningfullyChanged(cfi, state.currentStableCfi);
        const locatorChanged = _isLocatorMeaningfullyChanged(position.locator, state.currentStableLocator);
        const percentChanged = _isPercentMeaningfullyChanged(nextPercent, state.lastPercent);

        if (cfiChanged || locatorChanged || percentChanged) {
          state.currentStableCfi = cfi;
          state.currentStableLocator = position.locator;
          state.lastPercent = nextPercent;
          schedulePositionSave(state.currentBookId, state.currentStableCfi, state.lastPercent, state.currentStableLocator);
        } else {
          // CFI 未变，仅更新百分比（可能因 locations 加载而变化）
          if (nextPercent !== null) state.lastPercent = nextPercent;
          else if (percent !== null) state.lastPercent = percent;
        }
      } else if (state.isRestoringPosition && !state.isRestoreAnchorProtected && percent !== null) {
        state.lastPercent = percent;
      }

      // 书签按钮状态
      _updateBookmarkButtonState();
    }

    async function _updateBookmarkButtonState() {
      if (!state.rendition || !state.isBookLoaded) return;
      const location = state.rendition.currentLocation();
      if (!location || !location.start) return;
      try {
        const isBookmarked = await Bookmarks.isBookmarked(location.start.cfi);
        ui.updateBookmarkButtonState(isBookmarked);
      } catch (e) {
        console.warn('[Persistence] bookmark state check failed:', e);
      }
    }

    // ── Reading Stats ─────────────────────────────────────────────────────────

    /**
     * 更新底部阅读统计栏（时长 + ETA）。
     *
     * ETA 策略（v2.0 加权版，与 reader-full.js 完全对齐）：
     *   1. 历史累积速度 cachedSpeed（sampledProgress>1%, sampledSeconds>120s）
     *   2. 当前 session 实时速度（deltaSeconds>30, deltaProgress>0.3%）
     *   3. Fallback：静态估算（每 location ≈ 150字，400字/分钟）
     */
    function updateReadingStats() {
      if (!state.rendition || !state.book) return;

      const readStr = Utils.formatDuration(state.activeReadingSeconds);

      let remainingStr = '--';
      const hasLocations = !!(state.book.locations && state.book.locations.length());
      if (hasLocations) {
        const currentLoc = state.rendition.currentLocation();
        let progress = 0;
        if (currentLoc && currentLoc.start) {
          progress = state.book.locations.percentageFromCfi(currentLoc.start.cfi);
        }

        if (progress >= 0 && progress <= 1) {
          const remainingProgress = 1 - progress;
          const totalLocations  = state.book.locations.length();
          const charsTotal      = totalLocations * CHARS_PER_LOCATION_ESTIMATE;
          const estTotalMinutes = charsTotal / READING_SPEED_CHARS_PER_MINUTE;
          const eta = Utils.estimateRemainingMinutes({
            remainingProgress,
            cachedSpeed: state.cachedSpeed,
            session: state.sessionStart ? {
              startProgress: state.sessionStart.progress,
              lastProgress:  state.lastProgress,
              deltaSeconds:  (Date.now() - state.sessionStart.timestamp) / 1000
            } : null,
            fallbackMinutes: estTotalMinutes
          });

          if (eta.minutes === null || eta.isEstimating) {
            remainingStr = '估算中';
          } else {
            remainingStr = Utils.formatMinutes(Math.max(0, eta.minutes));
          }
        }
      }

      ui.updateReadingStatsText(`阅读时长: ${readStr} | 预计剩余: ${remainingStr}`);

      if (typeof ui.setLocationIndexStatus === 'function' && !hasLocations) {
        if (state.locationsStatus === 'pending' || state.locationsStatus === 'generating') {
          ui.setLocationIndexStatus(state.locationsStatus, '阅读定位索引生成中');
        } else if (state.locationsStatus === 'failed') {
          ui.setLocationIndexStatus('failed', '阅读定位索引不可用');
        }
      }
    }

    // ── Reading Timer ─────────────────────────────────────────────────────────

    function startReadingTimer() {
      if (state.readingTimer) clearInterval(state.readingTimer);
      state.readingTimer = setInterval(() => {
        if (!document.hidden && state.currentBookId && state.isBookLoaded) {
          state.activeReadingSeconds++;
          // 每 10s 写入 storage
          if (state.activeReadingSeconds % READING_TIME_FLUSH_INTERVAL_S === 0) {
            _saveReadingTimeSafely(state.currentBookId, state.activeReadingSeconds);
          }
          // 每 60s 刷新 ETA 展示
          if (state.activeReadingSeconds % READING_STATS_UPDATE_INTERVAL_S === 0) updateReadingStats();
        }
      }, READING_TIMER_INTERVAL_MS);
    }

    // ── Visibility ────────────────────────────────────────────────────────────

    // v1.8.0 BUG-02-B：页面重新可见时重置 session 起点，排除挂机时间
    function _onVisibilityChange() {
      if (document.hidden) {
        if (state.currentBookId && state.isBookLoaded) {
          flushPositionSave();
          _saveReadingTimeSafely(state.currentBookId, state.activeReadingSeconds);
          flushSpeedSession(null);  // session 结束，不续期
        }
      } else {
        // 页面重新激活：以当前位置为新 session 起点
        if (state.isBookLoaded && state.lastProgress > 0) {
          state.sessionStart = { progress: state.lastProgress, timestamp: Date.now() };
        }
      }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    function _onBeforeUnload() {
      if (state.currentBookId && state.isBookLoaded) {
        flushPositionSave();
      }
    }

    function mount() {
      document.addEventListener('visibilitychange', _onVisibilityChange);
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('beforeunload', _onBeforeUnload);
      }
    }

    function unmount() {
      if (state.readingTimer) {
        clearInterval(state.readingTimer);
        state.readingTimer = null;
      }
      document.removeEventListener('visibilitychange', _onVisibilityChange);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('beforeunload', _onBeforeUnload);
      }
      flushPositionSave();
    }

    return {
      mount,
      unmount,
      onRelocated,
      schedulePositionSave,
      flushPositionSave,
      flushSpeedSession,
      updateReadingStats,
      startReadingTimer
    };
  }

  window.ReaderPersistence = { createReaderPersistence };
})();
