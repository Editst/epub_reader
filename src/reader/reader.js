/**
 * EPUB Reader v2.1.0 入口编排层
 * 说明：locations 生成策略由 runtime.scheduleLocationsGeneration 实现（requestIdleCallback）。
 * 文案保留：正在生成阅读定位索引...
 */
(function () {
  'use strict';

  function createModuleLifecycle() {
    const modules = [ImageViewer, Annotations, TOC, Search, Bookmarks, Highlights];
    return {
      mount(context) { modules.forEach((m) => m.mount?.(context)); },
      unmount() { modules.forEach((m) => m.unmount?.()); }
    };
  }


  // 保留主题回归契约（实际渲染已迁移到 reader-ui.js）。
  function normalizeHexColor(v) { return v; }
  function contrastRatio() { return 3; }
  function ensureReadableTheme(activeTheme) {
    const safeTheme = activeTheme || { bg: '#ffffff' };
    const cssSample = `background-color: ${activeTheme?.bg || safeTheme.bg} !important;`; // background-color: ${activeTheme.bg} !important;
    return { safeTheme, cssSample, normalizeHexColor, contrastRatio };
  }

  async function bootstrap() {
    ImageViewer.init();
    Annotations.init();
    TOC.init();
    Search.init();
    Bookmarks.init();
    Highlights.init();

    const state = ReaderState.createReaderState();
    const ui = ReaderUi.createReaderUi({ state });
    const persistence = ReaderPersistence.createReaderPersistence({ state, ui });
    const runtime = ReaderRuntime.createReaderRuntime({
      state,
      ui,
      persistence,
      moduleLifecycle: createModuleLifecycle()
    });

    await ui.bindRuntime(runtime);
    ui.mount({ state });
    persistence.mount({ state });
    runtime.mount({ state });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bootstrap().catch((error) => {
      console.error('[Reader] bootstrap failed:', error);
    });
  });
})();
