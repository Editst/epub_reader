(function () {
  'use strict';

  function createReaderPersistence({ state, ui }) {
    async function savePosition(cfi, percentage) {
      if (!state.currentBookId) return;
      await EpubStorage.savePosition(state.currentBookId, cfi, percentage * 100);
    }

    function schedulePositionSave(cfi, percentage) {
      if (state.posTimer) clearTimeout(state.posTimer);
      state.posTimer = setTimeout(() => savePosition(cfi, percentage), 300);
    }

    async function onRelocated(location) {
      if (!location || !location.start || !state.book || !state.book.locations) return;
      const progress = state.book.locations.percentageFromCfi(location.start.cfi);
      state.lastProgress = progress;
      state.lastPercent = progress * 100;
      schedulePositionSave(location.start.cfi, progress);
      ui.updateProgress(progress * 100, location.start.displayed?.page, location.start.displayed?.total);
    }

    function startReadingTimer() {
      if (state.readingTimer) clearInterval(state.readingTimer);
      state.readingTimer = setInterval(() => {
        if (!state.isBookLoaded) return;
        state.activeReadingSeconds += 1;
        ui.updateReadingStats(state.activeReadingSeconds);
      }, 1000);
    }

    function mount() {
      startReadingTimer();
    }

    function unmount() {
      if (state.readingTimer) {
        clearInterval(state.readingTimer);
        state.readingTimer = null;
      }
    }

    return { mount, unmount, onRelocated, schedulePositionSave };
  }

  window.ReaderPersistence = { createReaderPersistence };
})();
