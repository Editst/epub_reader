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

    function normalizeBookData(data) {
      if (!data) return data;
      if (data instanceof Blob) return data;
      if (data instanceof ArrayBuffer) return data;
      if (ArrayBuffer.isView(data)) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      }
      return data;
    }

    async function resolveInitialCfi(bookId, targetCfi) {
      if (targetCfi) return targetCfi;
      const savedPos = await EpubStorage.getPosition(bookId);
      return savedPos?.cfi || null;
    }

    async function ensureLocationsIndex() {
      const cached = await EpubStorage.getLocations(state.currentBookId);
      if (cached) {
        state.book.locations.load(cached);
        ui.showLoading(false);
        return;
      }
      scheduleLocationsGeneration(async () => {
        ui.showLoading(true, '正在生成阅读定位索引...');
        await state.book.locations.generate(1200);
        await EpubStorage.saveLocations(state.currentBookId, state.book.locations.save());
        ui.showLoading(false);
      });
    }

    async function openBook(fileData, bookId, fileName, options = {}) {
      const { targetCfi = null } = options;

      if (state.rendition) {
        deps.moduleLifecycle.unmount();
        state.rendition.destroy();
      }

      ui.showLoading(true, '正在加载书籍...');
      state.book = ePub(normalizeBookData(fileData));
      state.rendition = state.book.renderTo('epub-viewer', {
        width: '100%', height: '100%', spread: 'auto',
        flow: state.prefs.layout === 'scrolled' ? 'scrolled-doc' : 'paginated',
        manager: state.prefs.layout === 'scrolled' ? 'continuous' : 'default',
        allowScriptedContent: false,
        gap: state.prefs.layout === 'scrolled' ? 48 : 80
      });

      await state.book.ready;
      state.currentBookId = bookId;
      state.currentFileName = fileName || '';
      state.isBookLoaded = true;
      ui.setReaderVisible(true);
      ui.applyTheme(state.prefs.theme);

      state.rendition.on('relocated', (location) => persistence.onRelocated(location));
      state.rendition.on('displayed', () => setTimeout(() => ui.ensureFocus(), 100));

      const metadata = await state.book.loaded.metadata;
      const title = metadata?.title || state.currentFileName || 'EPUB Reader';
      document.title = `${title} - EPUB Reader`;
      const titleEl = document.getElementById('book-title');
      if (titleEl) titleEl.textContent = title;

      await EpubStorage.addRecentBook({
        id: bookId,
        title: metadata?.title || '',
        author: metadata?.creator || '',
        filename: state.currentFileName || title
      });

      deps.moduleLifecycle.mount({
        book: state.book,
        rendition: state.rendition,
        bookId: state.currentBookId,
        fileName: state.currentFileName
      });

      const initialCfi = await resolveInitialCfi(bookId, targetCfi);
      if (initialCfi) await state.rendition.display(initialCfi);
      else await state.rendition.display();

      await ensureLocationsIndex();
    }

    async function loadFileByBookId(bookId, options = {}) {
      const record = await EpubStorage.getFile(bookId);
      if (!record || !record.data) {
        throw new Error('该书籍缓存不存在或已被自动清理，请重新导入。');
      }
      await openBook(record.data, bookId, record.filename || '', options);
    }

    function next() {
      if (!state.rendition) return;
      state.rendition.next();
    }

    async function prev() {
      if (!state.rendition) return;
      await state.rendition.prev();
    }

    function displayPercentage(percent) {
      if (!state.rendition || !state.book?.locations?.length?.()) return;
      const cfi = state.book.locations.cfiFromPercentage(percent / 100);
      if (cfi) state.rendition.display(cfi);
    }

    async function setLayout(layout) {
      if (!layout || !['paginated', 'scrolled'].includes(layout)) return;
      state.prefs.layout = layout;
      await EpubStorage.savePreferences({ layout });
      if (!state.currentBookId) return;
      const loc = state.rendition?.currentLocation();
      const targetCfi = loc?.start?.cfi || null;
      const record = await EpubStorage.getFile(state.currentBookId);
      if (!record?.data) return;
      await openBook(record.data, state.currentBookId, state.currentFileName, { targetCfi });
    }

    async function mount() {
      return true;
    }

    function unmount() {
      if (state.rendition) {
        deps.moduleLifecycle.unmount();
        state.rendition.destroy();
      }
      state.book = null;
      state.rendition = null;
      state.isBookLoaded = false;
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
