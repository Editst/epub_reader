(function () {
  'use strict';

  function createReaderUi({ state }) {
    const dom = {
      welcomeScreen: document.getElementById('welcome-screen'),
      loadingOverlay: document.getElementById('loading-overlay'),
      loadingText: document.querySelector('#loading-overlay .loading-text'),
      readerMain: document.getElementById('reader-main'),
      bottomBar: document.getElementById('bottom-bar'),
      fileInput: document.getElementById('file-input'),
      progressSlider: document.getElementById('progress-slider'),
      progressCurrent: document.getElementById('progress-current'),
      progressLocation: document.getElementById('progress-location'),
      progressTime: document.getElementById('progress-time')
    };

    function ensureFocus() {
      dom.readerMain?.focus?.();
    }

    function setReaderVisible(isVisible) {
      dom.welcomeScreen?.classList.toggle('is-hidden', isVisible);
      dom.readerMain?.classList.toggle('is-visible', isVisible);
      dom.bottomBar?.classList.toggle('is-visible', isVisible);
    }

    function showLoading(show, message = '') {
      dom.loadingOverlay?.classList.toggle('is-hidden', !show);
      if (show && message && dom.loadingText) dom.loadingText.textContent = message;
    }

    function updateProgress(percent, page, total) {
      if (dom.progressSlider) dom.progressSlider.value = String(percent.toFixed(1));
      if (dom.progressCurrent) dom.progressCurrent.textContent = `${percent.toFixed(1)}%`;
      if (dom.progressLocation && page && total) dom.progressLocation.textContent = `${page}/${total}`;
    }

    function updateReadingStats(seconds) {
      if (!dom.progressTime) return;
      dom.progressTime.textContent = `阅读时长: ${Utils.formatDuration(seconds)}`;
    }

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      state.prefs.theme = theme;
    }

    async function bindRuntime(runtime) {
      document.getElementById('welcome-open-btn').addEventListener('click', () => dom.fileInput.click());
      document.getElementById('btn-open').addEventListener('click', () => dom.fileInput.click());
      document.getElementById('btn-home').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
      });

      dom.fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const bookId = await Utils.generateBookId(file);
        await EpubStorage.storeFile(bookId, file.name, file);
        await runtime.openBook(file, bookId, file.name);
      });
    }

    function mount() { return true; }
    function unmount() { return true; }

    return {
      mount,
      unmount,
      bindRuntime,
      setReaderVisible,
      showLoading,
      updateProgress,
      updateReadingStats,
      applyTheme,
      ensureFocus
    };
  }

  window.ReaderUi = { createReaderUi };
})();
