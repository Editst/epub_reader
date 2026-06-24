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

  function createReaderPersistence({ state, ui }) {

    // ── Position ─────────────────────────────────────────────────────────────

    function _savePosition(bookId, cfi, percent, locator) {
      if (locator !== undefined) return EpubStorage.savePosition(bookId, cfi, percent, locator);
      return EpubStorage.savePosition(bookId, cfi, percent);
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

    function schedulePositionSave(bookId, cfi, percent, locator) {
      const shouldSaveImmediately = !state.posTimer;
      if (shouldSaveImmediately) {
        state.lastPositionSave = _savePosition(bookId, cfi, percent, locator);
      }

      clearTimeout(state.posTimer);
      state.posTimer = setTimeout(() => {
        state.posTimer = null;
        state.lastPositionSave = _savePosition(bookId, cfi, percent, locator);
      }, 300);
    }

    function _buildDisplayedPageLocator(location) {
      if (!location || !location.start) return null;
      const layout = (state.prefs && state.prefs.layout) || 'paginated';
      const displayed = location.start.displayed || {};
      return {
        strategy: 'epubjs-displayed-page-v1',
        layout,
        href: location.start.href || '',
        index: location.start.index != null ? location.start.index : null,
        page: layout === 'paginated' && typeof displayed.page === 'number' ? displayed.page : null,
        total: layout === 'paginated' && typeof displayed.total === 'number' ? displayed.total : null,
        prefsSignature: ReaderState.buildPrefsSignature(state.prefs || {})
      };
    }

    function _buildPositionFromLocation(location) {
      if (!location || !location.start || !location.start.cfi) {
        return { cfi: null, percent: null, locator: null };
      }
      const cfi = location.start.cfi;
      let percent = null;
      if (cfi && state.book && state.book.locations && state.book.locations.length()) {
        const progress = state.book.locations.percentageFromCfi(cfi);
        percent = Math.round(progress * 1000) / 10;
      } else if (typeof location.start.percentage === 'number') {
        const progress = location.start.percentage <= 1 ? location.start.percentage * 100 : location.start.percentage;
        percent = Math.round(progress * 10) / 10;
      }
      return { cfi, percent, locator: _buildDisplayedPageLocator(location) };
    }

    function _refreshStablePositionFromRendition() {
      if (state.isRestoringPosition || state.isResizing) return;
      if (!state.rendition || typeof state.rendition.currentLocation !== 'function') return;
      const position = _buildPositionFromLocation(state.rendition.currentLocation());
      if (!position.cfi) return;
      state.currentStableCfi = position.cfi;
      state.currentStableLocator = position.locator;
      if (position.percent !== null) state.lastPercent = position.percent;
    }

    function flushPositionSave() {
      clearTimeout(state.posTimer);
      state.posTimer = null;
      _refreshStablePositionFromRendition();
      if (state.currentBookId && state.currentStableCfi) {
        state.lastPositionSave = _savePosition(
          state.currentBookId,
          state.currentStableCfi,
          state.lastPercent,
          state.currentStableLocator
        );
        return state.lastPositionSave;
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

      if (deltaProgress > 0.001 && deltaProgress < 0.30 && deltaSeconds > 30) {
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
        if (state.sessionStart && Math.abs(progress - state.lastProgress) > 0.05) {
          flushSpeedSession(progress);  // async，非阻塞
        }
        state.lastProgress = progress;
      }

      updateReadingStats();

      // 从事件参数构建 displayed-page locator（用于保存）
      const position = _buildPositionFromLocation(location);

      // 章节标题 + TOC 高亮（使用事件参数，反映用户可见的最新位置）
      const currentSection = location.start.href;
      if (currentSection) {
        const chapterTitleEl = document.getElementById('chapter-title');
        if (chapterTitleEl) {
          const tocItem = ReaderState.findTocItem(
            state.book && state.book.navigation ? state.book.navigation.toc : [],
            currentSection
          );
          chapterTitleEl.textContent = tocItem ? tocItem.label.trim() : '';
        }
        if (typeof TOC !== 'undefined' && TOC.setActive) TOC.setActive(currentSection);
      }

      // 恢复期间跳过写入，也不替换 currentStableCfi；正常阅读时写入。
      // CFI 始终从 rendition.currentLocation() 重采样——事件参数的 start.cfi 在快速翻页/
      // 布局重排时可能与 epub.js 内部状态不一致。locator 仍从事件参数构建，
      // 因为 displayed.page/total 是事件发生时的快照，currentLocation() 不一定包含。
      if (!state.isRestoringPosition) {
        const currentLoc = state.rendition && typeof state.rendition.currentLocation === 'function'
          ? state.rendition.currentLocation()
          : null;
        const cfi = (currentLoc && currentLoc.start && currentLoc.start.cfi)
          || position.cfi
          || location.start.cfi;

        if (_isPositionMeaningfullyChanged(cfi, state.currentStableCfi)) {
          state.currentStableCfi = cfi;
          state.currentStableLocator = position.locator;
          state.lastPercent = position.percent !== null ? position.percent : percent;
          schedulePositionSave(state.currentBookId, state.currentStableCfi, state.lastPercent, state.currentStableLocator);
        } else {
          // CFI 未变，仅更新百分比（可能因 locations 加载而变化）
          if (position.percent !== null) state.lastPercent = position.percent;
          else if (percent !== null) state.lastPercent = percent;
        }
      } else if (percent !== null) {
        state.lastPercent = percent;
      }

      // 书签按钮状态
      _updateBookmarkButtonState();
    }

    async function _updateBookmarkButtonState() {
      const btn = document.getElementById('btn-bookmark');
      if (!btn || !state.rendition || !state.isBookLoaded) return;
      const location = state.rendition.currentLocation();
      if (!location || !location.start) return;
      try {
        const isBookmarked = await Bookmarks.isBookmarked(location.start.cfi);
        btn.classList.toggle('active', isBookmarked);
        btn.title = isBookmarked ? '移除书签 (B)' : '添加书签 (B)';
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
      const progressTimeEl = document.getElementById('progress-time');
      if (!progressTimeEl || !state.rendition || !state.book) return;

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
          const charsTotal      = totalLocations * 150;
          const estTotalMinutes = charsTotal / 400;
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

      progressTimeEl.textContent = `阅读时长: ${readStr} | 预计剩余: ${remainingStr}`;

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
          if (state.activeReadingSeconds % 10 === 0) {
            EpubStorage.saveReadingTime(state.currentBookId, state.activeReadingSeconds);
          }
          // 每 60s 刷新 ETA 展示
          if (state.activeReadingSeconds % 60 === 0) updateReadingStats();
        }
      }, 1000);
    }

    // ── Visibility ────────────────────────────────────────────────────────────

    // v1.8.0 BUG-02-B：页面重新可见时重置 session 起点，排除挂机时间
    function _onVisibilityChange() {
      if (document.hidden) {
        if (state.currentBookId && state.isBookLoaded) {
          flushPositionSave();
          EpubStorage.saveReadingTime(state.currentBookId, state.activeReadingSeconds);
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
