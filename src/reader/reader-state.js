/**
 * reader-state.js — 单一状态源与跨 Reader 共享纯函数
 *
 * 规则：此文件仅声明状态结构、重置和无副作用的边界 helper，禁止引入 DOM 操作。
 */
(function () {
  'use strict';

  /**
   * 创建初始状态对象。
   * 所有 reader 子模块通过同一引用读写，禁止各模块持有局部副本。
   *
   * @returns {object} state
   */
  function createReaderState() {
    return {
      // ── epub.js 实体 ──────────────────────────────────────────────────────
      book:             null,
      rendition:        null,

      // ── 书籍标识 ──────────────────────────────────────────────────────────
      currentBookId:    '',
      currentFileName:  '',
      isBookLoaded:     false,
      locationsStatus:  'idle',

      // ── CFI / 导航保护 ────────────────────────────────────────────────────
      currentStableCfi: null,
      currentStableLocator: null,
      isResizing:          false,   // 字号/布局重排保护锁（期间忽略 relocated）
      isRestoringPosition: false,   // openBook 位置恢复期间为 true，防止 relocated 覆写已保存进度
      isLayoutStable:      false,   // 字体加载/布局重排完成前为 false，阻止翻页与跳转
      isRestoreAnchorProtected: false, // 恢复/目标跳转后的锚点保护，用户导航前不被边界 CFI 覆盖
      navLock:             false,   // 翻页防连击锁

      // ── 阅读计时 ──────────────────────────────────────────────────────────
      readingTimer:         null,
      activeReadingSeconds: 0,
      pendingReadingSeconds: 0,
      lastReadingTimeSave:  null,

      // ── 速度追踪 ──────────────────────────────────────────────────────────
      cachedSpeed:  null,  // { sampledSeconds, sampledProgress, contentUnitCount, contentUnitVersion }
      contentUnitStatus: 'idle', // idle | pending | ready | failed
      sessionStart: null,  // { progress: number, timestamp: number }
      lastProgress: 0,     // 上次 relocated 进度（0-1）
      posTimer:     null,  // schedulePositionSave 防抖 timer
      lastPositionSave: null, // 最近一次位置写入 Promise（flush/unmount 可等待）
      lastPercent:  null,  // 上次百分比（visibilitychange flush 用）

      // ── 用户偏好（从 storage 加载后覆盖） ──────────────────────────────────
      prefs: {
        theme:           'light',
        fontSize:        18,
        lineHeight:      1.8,
        fontFamily:      '',
        layout:          'paginated',
        spread:          'auto',
        customBg:        '#ffffff',
        customText:      '#333333',
        paragraphIndent: true
      }
    };
  }

  /**
   * 重置阅读 session 相关字段（切书时调用）。
   * 不重置 prefs / currentBookId / isBookLoaded，由 openBook 逻辑自行管理。
   *
   * @param {object} state
   */
  function resetReadingSession(state) {
    state.activeReadingSeconds = 0;
    state.pendingReadingSeconds = 0;
    state.lastReadingTimeSave  = null;
    state.cachedSpeed          = null;
    state.contentUnitStatus    = 'idle';
    state.sessionStart         = null;
    state.lastProgress         = 0;
    state.lastPercent          = null;
    state.currentStableCfi     = null;
    state.currentStableLocator = null;
    state.isResizing           = false;
    state.isRestoringPosition  = false;
    state.isRestoreAnchorProtected = false;
    state.lastPositionSave     = null;
    state.locationsStatus      = 'idle';
    if (state.readingTimer) {
      clearInterval(state.readingTimer);
      state.readingTimer = null;
    }
    if (state.posTimer) {
      clearTimeout(state.posTimer);
      state.posTimer = null;
    }
  }

  function isTocHrefMatch(currentHref, itemHref) {
    const currentBase = String(currentHref || '').split('#')[0];
    const itemBase = String(itemHref || '').split('#')[0];
    if (!currentBase || !itemBase) return false;
    return currentBase === itemBase ||
      currentBase.endsWith('/' + itemBase) ||
      itemBase.endsWith('/' + currentBase);
  }

  function getTocItemLabel(item) {
    if (!item || item.label === null || item.label === undefined) return '';
    return String(item.label).trim();
  }

  function hasLocations(locations) {
    if (!locations || typeof locations.length !== 'function') return false;
    try {
      const count = locations.length();
      return Number.isFinite(count) && count > 0;
    } catch (_) {
      return false;
    }
  }

  function getLocationProgress(locations, cfi) {
    if (!hasLocations(locations) || typeof locations.percentageFromCfi !== 'function') return null;
    if (typeof cfi !== 'string' || !cfi) return null;
    try {
      const progress = locations.percentageFromCfi(cfi);
      return Number.isFinite(progress) && progress >= 0 && progress <= 1 ? progress : null;
    } catch (_) {
      return null;
    }
  }

  function getCfiFromPercentage(locations, percentage) {
    if (!hasLocations(locations) || typeof locations.cfiFromPercentage !== 'function') return null;
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 1) return null;
    try {
      const cfi = locations.cfiFromPercentage(percentage);
      return typeof cfi === 'string' && cfi ? cfi : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * 在 TOC 树中递归查找匹配当前 href 的条目。
   * @param {Array} items TOC 节点数组
   * @param {string} href 当前 section href
   * @returns {object|null}
   */
  function findTocItem(items, href) {
    if (!items || !items.length) return null;
    for (const item of items) {
      if (isTocHrefMatch(href, item.href)) return item;
      if (item.subitems && item.subitems.length > 0) {
        const found = findTocItem(item.subitems, href);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * 构建当前偏好快照，用于 locator 签名比对。
   * @param {object} prefs
   * @returns {object}
   */
  function buildPrefsSignature(prefs) {
    return {
      layout: prefs.layout || 'paginated',
      fontSize: prefs.fontSize || 18,
      lineHeight: prefs.lineHeight || 1.8,
      fontFamily: prefs.fontFamily || '',
      paragraphIndent: prefs.paragraphIndent !== false,
      spread: prefs.spread || 'auto'
    };
  }

  window.ReaderState = {
    createReaderState,
    resetReadingSession,
    isTocHrefMatch,
    getTocItemLabel,
    hasLocations,
    getLocationProgress,
    getCfiFromPercentage,
    findTocItem,
    buildPrefsSignature
  };
})();
