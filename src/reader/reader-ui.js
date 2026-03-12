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
      progressTime: document.getElementById('progress-time'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      dragOverlay: document.getElementById('drag-overlay'),
      settingsPanel: document.getElementById('settings-panel')
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

    async function openLocalFile(file, runtime) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const bookId = await EpubStorage.generateBookId(file.name, arrayBuffer);
        await EpubStorage.storeFile(file.name, file, bookId);
        await runtime.openBook(file, bookId, file.name);
      } catch (error) {
        console.error('[ReaderUi] failed to open local file:', error);
        showLoading(false);
        alert('打开书籍失败，请重试或更换文件。');
      }
    }

    function bindNavigation(runtime) {
      dom.btnPrev?.addEventListener('click', () => runtime.prev());
      dom.btnNext?.addEventListener('click', () => runtime.next());

      dom.readerMain?.addEventListener('wheel', (e) => {
        if (!state.isBookLoaded || state.prefs.layout === 'scrolled') return;
        e.preventDefault();
        if (e.deltaY > 0 || e.deltaX > 0) runtime.next();
        else runtime.prev();
      }, { passive: false });

      document.addEventListener('keydown', (e) => {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown') {
          e.preventDefault();
          runtime.next();
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault();
          runtime.prev();
        }
      });
    }

    function bindProgress(runtime) {
      if (!dom.progressSlider) return;
      dom.progressSlider.addEventListener('input', (e) => {
        dom.progressCurrent.textContent = `${parseFloat(e.target.value).toFixed(1)}%`;
      });
      dom.progressSlider.addEventListener('change', (e) => {
        runtime.displayPercentage(parseFloat(e.target.value));
      });
    }

    function bindLayoutSettings(runtime) {
      document.querySelectorAll('.layout-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const layout = btn.dataset.layout;
          await runtime.setLayout(layout);
          document.querySelectorAll('.layout-btn').forEach((b) => b.classList.toggle('active', b === btn));
        });
      });
    }

    function bindPanelState() {
      const btnSettings = document.getElementById('btn-settings');
      const btnSettingsClose = document.getElementById('btn-settings-close');
      btnSettings?.addEventListener('click', () => dom.settingsPanel?.classList.toggle('open'));
      btnSettingsClose?.addEventListener('click', () => dom.settingsPanel?.classList.remove('open'));

      window.closeAllPanels = function closeAllPanels() {
        dom.settingsPanel?.classList.remove('open');
        TOC?.close?.();
        Bookmarks?.closePanel?.();
        Search?.closePanel?.();
        Highlights?.closePanels?.();
      };
    }

    function bindDragAndDrop(runtime) {
      document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dom.dragOverlay?.classList.remove('hidden');
      });
      document.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null || e.relatedTarget === document.documentElement) {
          dom.dragOverlay?.classList.add('hidden');
        }
      });
      document.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dom.dragOverlay?.classList.add('hidden');
        const files = e.dataTransfer?.files;
        const file = files && files[0];
        if (!file || !file.name.toLowerCase().endsWith('.epub')) return;
        await openLocalFile(file, runtime);
      });
    }

    async function bindRuntime(runtime) {
      document.getElementById('welcome-open-btn').addEventListener('click', () => dom.fileInput.click());
      document.getElementById('btn-open').addEventListener('click', () => dom.fileInput.click());
      document.getElementById('btn-home').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
      });

      bindNavigation(runtime);
      bindProgress(runtime);
      bindLayoutSettings(runtime);
      bindPanelState();
      bindDragAndDrop(runtime);

      dom.fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await openLocalFile(file, runtime);
        e.target.value = '';
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
