/**
 * reader.js — EPUB Reader v2.1 入口编排层
 *
 * 职责：仅负责按序初始化四个子模块，串联生命周期，处理 URL 参数启动。
 * 业务逻辑一律委托给各子层：
 *   - ReaderState     : 状态字段声明与重置
 *   - ReaderUi        : DOM 渲染与交互绑定
 *   - ReaderPersistence: 位置/时间/速度持久化
 *   - ReaderRuntime   : epub.js 生命周期与阅读行为
 *
 * v2.0 P-2：locations 生成由 runtime.scheduleLocationsGeneration 以 requestIdleCallback 调度。
 */
(function () {
  'use strict';

  /**
   * 创建子模块统一生命周期代理。
   * mount/unmount 遍历所有子模块，调用其 mount?.(context) / unmount?.()。
   *
   * @returns {{ mount: Function, unmount: Function }}
   */
  function createModuleLifecycle() {
    const modules = [ImageViewer, Annotations, TOC, Search, Bookmarks, Highlights];
    return {
      mount(context) {
        modules.forEach((m) => {
          if (typeof m.mount === 'function') m.mount(context);
        });
      },
      unmount() {
        modules.forEach((m) => {
          if (typeof m.unmount === 'function') m.unmount();
        });
      }
    };
  }

  async function bootstrap() {
    // ── 子模块 init（各模块注册内部状态） ──────────────────────────────────────
    ImageViewer.init();
    Annotations.init();
    TOC.init();
    Search.init();
    Bookmarks.init();
    Highlights.init();

    // ── 状态实例化 ────────────────────────────────────────────────────────────
    const state = ReaderState.createReaderState();

    // ── 加载偏好到 state.prefs ────────────────────────────────────────────────
    try {
      const prefs = await EpubStorage.getPreferences();
      if (prefs && typeof prefs === 'object') {
        state.prefs = { ...state.prefs, ...prefs };
      }
    } catch (e) {
      console.warn('[Reader] load preferences failed:', e);
    }

    // ── 子层实例化（依赖注入，state 作为唯一数据总线） ─────────────────────────
    const ui          = ReaderUi.createReaderUi({ state });
    const persistence = ReaderPersistence.createReaderPersistence({ state, ui });
    const runtime     = ReaderRuntime.createReaderRuntime({
      state,
      ui,
      persistence,
      moduleLifecycle: createModuleLifecycle()
    });

    // ── 绑定 runtime（注册所有 DOM 事件监听） ─────────────────────────────────
    await ui.bindRuntime(runtime, persistence);

    // ── 各层 mount ────────────────────────────────────────────────────────────
    ui.mount();
    persistence.mount();
    await runtime.mount();

    // ── URL 参数启动：bookId → 直接从缓存打开 ────────────────────────────────
    const params      = new URLSearchParams(window.location.search);
    const bookIdParam = params.get('bookId');
    const targetCfi   = params.get('target');

    if (bookIdParam) {
      await runtime.loadFileByBookId(bookIdParam, { targetCfi });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bootstrap().catch((err) => {
      console.error('[Reader] bootstrap failed:', err);
    });
  });
})();
