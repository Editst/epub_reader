/**
 * reader-state.js — 单一状态源（可序列化字段）
 *
 * 规则：此文件仅声明状态结构与重置工具函数，禁止引入任何 DOM 操作或业务逻辑。
 * 状态字段命名与 reader-full.js 保持一致，便于 grep 溯源。
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

      // ── CFI / 导航保护 ────────────────────────────────────────────────────
      currentStableCfi: null,
      isResizing:       false,   // 字号/布局重排保护锁（期间忽略 relocated）
      navLock:          false,   // 翻页防连击锁

      // ── 阅读计时 ──────────────────────────────────────────────────────────
      readingTimer:         null,
      activeReadingSeconds: 0,

      // ── 速度追踪（对齐 reader-full.js 命名） ───────────────────────────────
      cachedSpeed:  null,  // { sampledSeconds, sampledProgress }
      sessionStart: null,  // { progress: number, timestamp: number }
      lastProgress: 0,     // 上次 relocated 进度（0-1）
      posTimer:     null,  // schedulePositionSave 防抖 timer
      lastPercent:  null,  // 上次百分比（visibilitychange flush 用）

      // ── 用户偏好（从 storage 加载后覆盖） ──────────────────────────────────
      prefs: {
        theme:           'light',
        fontSize:        18,
        lineHeight:      1.8,
        fontFamily:      '',
        layout:          'paginated',
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
    state.cachedSpeed          = null;
    state.sessionStart         = null;
    state.lastProgress         = 0;
    state.lastPercent          = null;
    state.currentStableCfi     = null;
    if (state.readingTimer) {
      clearInterval(state.readingTimer);
      state.readingTimer = null;
    }
    if (state.posTimer) {
      clearTimeout(state.posTimer);
      state.posTimer = null;
    }
  }

  window.ReaderState = {
    createReaderState,
    resetReadingSession
  };
})();
