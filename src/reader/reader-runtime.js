(function () {
  'use strict';

  function createReaderRuntime(deps) {
    const { state, ui, persistence } = deps;

    function scheduleLocationsGeneration(task) {
      const run = () => Promise.resolve().then(task).catch((e) => {
        console.warn('[Locations] generate failed:', e);
        ui.showLoading(false);
      });
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => run(), { timeout: 1500 });
        return;
      }
      setTimeout(() => run(), 0);
    }

    async function openBook(file, bookId, fileName) {
      ui.showLoading(true, '正在加载书籍...');
      state.book = ePub(file);
      state.rendition = state.book.renderTo('epub-viewer', {
        width: '100%', height: '100%', spread: 'auto',
        flow: state.prefs.layout === 'scrolled' ? 'scrolled-doc' : 'paginated',
        manager: state.prefs.layout === 'scrolled' ? 'continuous' : 'default',
        allowScriptedContent: false,
        gap: state.prefs.layout === 'scrolled' ? 48 : 80
      });

      await state.book.ready;
      state.currentBookId = bookId;
      state.currentFileName = fileName;
      state.isBookLoaded = true;
      ui.setReaderVisible(true);
      ui.applyTheme(state.prefs.theme);

      state.rendition.on('relocated', (location) => persistence.onRelocated(location));
      state.rendition.on('displayed', () => setTimeout(() => ui.ensureFocus(), 100));
      state.rendition.display();

      scheduleLocationsGeneration(async () => {
        ui.showLoading(true, '正在生成阅读定位索引...');
        await state.book.locations.generate(1200);
        ui.showLoading(false);
      });

      deps.moduleLifecycle.mount({
        book: state.book,
        rendition: state.rendition,
        bookId: state.currentBookId,
        fileName: state.currentFileName
      });
    }

    async function mount() {
      return true;
    }

    function unmount() {
      if (state.rendition) {
        state.rendition.destroy();
      }
      state.book = null;
      state.rendition = null;
      state.isBookLoaded = false;
    }

    return { mount, unmount, openBook, scheduleLocationsGeneration };
  }

  window.ReaderRuntime = { createReaderRuntime };
})();
