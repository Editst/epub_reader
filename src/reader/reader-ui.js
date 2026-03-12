/**
 * reader-ui.js — DOM 渲染与交互绑定
 *
 * 职责：
 *   - DOM 元素缓存（一次性查找）
 *   - 显隐 / 进度 / 主题 / 自定义样式更新
 *   - 所有事件监听注册（键盘、鼠标、拖拽、滑块、主题按钮……）
 *   - _withCfiLock：字号/行高/字体变更时保护阅读位置
 *   - setLayout 按钮状态同步
 *   - 书签按钮触发（实际写入由 Bookmarks 模块完成）
 *
 * 本层不持有 book / rendition 引用，所有阅读行为通过 runtime.* 调用。
 * 所有 DOM 显隐必须使用 classList，禁止 style.* 直写（transform 豁免至 v2.2.0）。
 */
(function () {
  'use strict';

  function createReaderUi({ state }) {

    // ── DOM Cache ─────────────────────────────────────────────────────────────

    const dom = {
      welcomeScreen:      document.getElementById('welcome-screen'),
      loadingOverlay:     document.getElementById('loading-overlay'),
      loadingText:        document.querySelector('#loading-overlay .loading-text'),
      readerMain:         document.getElementById('reader-main'),
      bottomBar:          document.getElementById('bottom-bar'),
      toolbar:            document.getElementById('toolbar'),
      fileInput:          document.getElementById('file-input'),
      bookTitleEl:        document.getElementById('book-title'),
      chapterTitleEl:     document.getElementById('chapter-title'),
      progressSlider:     document.getElementById('progress-slider'),
      progressCurrent:    document.getElementById('progress-current'),
      progressLocation:   document.getElementById('progress-location'),
      progressTime:       document.getElementById('progress-time'),
      fontSizeSlider:     document.getElementById('font-size-slider'),
      fontSizeValue:      document.getElementById('font-size-value'),
      lineHeightSlider:   document.getElementById('line-height-slider'),
      lineHeightValue:    document.getElementById('line-height-value'),
      fontFamilySelect:   document.getElementById('font-family-select'),
      settingsPanel:      document.getElementById('settings-panel'),
      customThemeOptions: document.getElementById('custom-theme-options'),
      customBgColor:      document.getElementById('custom-bg-color'),
      customTextColor:    document.getElementById('custom-text-color'),
      dragOverlay:        document.getElementById('drag-overlay')
    };

    // ── Focus ─────────────────────────────────────────────────────────────────

    function ensureFocus() {
      if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
        document.activeElement.blur();
      }
      window.focus();
    }

    // ── Visibility ────────────────────────────────────────────────────────────

    /**
     * 切换 reader 主界面可见性（欢迎屏 ↔ 阅读区）。
     * @param {boolean} isVisible  true = 显示阅读区，false = 显示欢迎屏
     */
    function setReaderVisible(isVisible) {
      dom.welcomeScreen?.classList.toggle('is-hidden', isVisible);
      dom.readerMain?.classList.toggle('is-visible', isVisible);
      dom.bottomBar?.classList.toggle('is-visible', isVisible);
    }

    function showLoading(show, message = '') {
      dom.loadingOverlay?.classList.toggle('is-hidden', !show);
      if (show && message && dom.loadingText) dom.loadingText.textContent = message;
    }

    function showLoadError(msg) {
      showLoading(false);
      if (dom.welcomeScreen) dom.welcomeScreen.classList.add('is-hidden');
      const rm = dom.readerMain;
      if (!rm) return;
      rm.innerHTML = '';

      const wrapper = document.createElement('div');
      wrapper.className = 'reader-error-wrapper';

      const icon = document.createElement('div');
      icon.className = 'reader-error-icon';
      icon.textContent = '📚';

      const title = document.createElement('h2');
      title.className = 'reader-error-title';
      title.textContent = '书籍加载失败';

      const detail = document.createElement('p');
      detail.className = 'reader-error-detail';
      detail.textContent = msg;

      const btn = document.createElement('button');
      btn.className = 'reader-error-btn';
      btn.textContent = '重新选择文件';
      btn.addEventListener('click', () => dom.fileInput && dom.fileInput.click());

      wrapper.append(icon, title, detail, btn);
      rm.appendChild(wrapper);
      rm.classList.remove('is-hidden');
      rm.classList.add('is-visible');
      rm.classList.add('reader-main-error');
    }

    // ── Progress ──────────────────────────────────────────────────────────────

    /**
     * @param {number} percent  0–100
     */
    function updateProgress(percent) {
      if (dom.progressSlider)  dom.progressSlider.value = percent.toFixed(1);
      if (dom.progressCurrent) dom.progressCurrent.textContent = percent.toFixed(1) + '%';
    }

    // ── Theme ─────────────────────────────────────────────────────────────────

    // 以下主题与对比度工具函数直接从 reader-full.js 搬运，保证颜色逻辑一致性
    function normalizeHexColor(input) {
      if (typeof input !== 'string') return null;
      const val = input.trim();
      if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val)) return null;
      if (val.length === 4) {
        return '#' + val.slice(1).split('').map(ch => ch + ch).join('').toLowerCase();
      }
      return val.toLowerCase();
    }

    function luminance(hexColor) {
      const [r, g, b] = [1, 3, 5]
        .map((idx) => parseInt(hexColor.slice(idx, idx + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function contrastRatio(a, b) {
      const l1 = luminance(a);
      const l2 = luminance(b);
      const [bright, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
      return (bright + 0.05) / (dark + 0.05);
    }

    function ensureReadableTheme(themeObj) {
      if (!themeObj || !themeObj.bg || !themeObj.color) return themeObj;
      const bg = normalizeHexColor(themeObj.bg);
      const fg = normalizeHexColor(themeObj.color);
      if (!bg || !fg) return themeObj;
      const contrast = contrastRatio(bg, fg);
      if (contrast >= 2.5) return themeObj;
      const fallback = luminance(bg) > 0.5 ? '#1f2937' : '#f3f4f6';
      return { ...themeObj, color: fallback };
    }

    function getActiveThemeColors(theme) {
      const themes = {
        light:  { bg: '#ffffff',  color: '#2d2d2d' },
        dark:   { bg: '#1a1a1a',  color: '#d4d0c8' },
        sepia:  { bg: '#f8f0dc',  color: '#3e2f1c' },
        green:  { bg: '#c7e6c1',  color: '#2b3a2b' },
        custom: {
          bg:    state.prefs.customBg   || '#ffffff',
          color: state.prefs.customText || '#333333'
        }
      };
      return ensureReadableTheme(themes[theme] || themes.light);
    }

    function applyThemeToRendition(theme) {
      if (!state.rendition) return;
      const t = getActiveThemeColors(theme);
      state.rendition.themes.override('color', t.color);
      state.rendition.themes.override('background', t.bg);
      updateCustomStyles();
    }

    /**
     * 设置主题（body data-theme + 按钮 active + customThemeOptions + rendition）。
     * @param {string}  theme
     * @param {boolean} save   是否持久化到 storage
     */
    function applyTheme(theme, save = true) {
      document.documentElement.setAttribute('data-theme', theme);
      state.prefs.theme = theme;
      document.querySelectorAll('.theme-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
      });
      if (dom.customThemeOptions) {
        dom.customThemeOptions.classList.toggle('is-visible', theme === 'custom');
      }
      applyThemeToRendition(theme);
      if (save) EpubStorage.savePreferences({ theme });
    }

    // ── Custom Styles ─────────────────────────────────────────────────────────

    function generateCustomCss() {
      const fallbackFont = "'Noto Serif SC', 'Source Han Serif CN', 'SimSun', 'STSong', serif";
      const fontFamily = state.prefs.fontFamily
        ? `${state.prefs.fontFamily}, ${fallbackFont}`
        : fallbackFont;
      const activeTheme = getActiveThemeColors(state.prefs.theme || 'light');
      return `
        @namespace xmlns "http://www.w3.org/1999/xhtml";
        html, body {
          background-color: ${activeTheme.bg} !important;
          color: ${activeTheme.color} !important;
          font-size: ${state.prefs.fontSize}px !important;
          font-family: ${fontFamily} !important;
          line-height: ${state.prefs.lineHeight} !important;
        }
        p, div, li, h1, h2, h3, h4, h5, h6 { font-family: inherit; line-height: inherit !important; text-align: justify; }
        a { color: var(--text-accent, #0078D7) !important; }
      `;
    }

    function injectCustomStyleElement(contents) {
      if (!contents || !contents.document) return;
      const doc = contents.document;
      let styleEl = doc.getElementById('epub-reader-custom-styles');
      if (!styleEl) {
        styleEl = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
        styleEl.setAttribute('id', 'epub-reader-custom-styles');
        const target = doc.head || doc.documentElement || doc.body;
        if (target) target.appendChild(styleEl);
      }
      styleEl.textContent = generateCustomCss();
    }

    function updateCustomStyles() {
      if (!state.rendition || !state.rendition.getContents) return;
      state.rendition.getContents().forEach(contents => injectCustomStyleElement(contents));
    }

    // ── CFI Lock（v1.8.0 BUG-03-B）────────────────────────────────────────────

    /**
     * 在可能触发 epub.js 重排的同步操作前后保护当前阅读位置。
     *
     * 流程：
     *   1. 记录 loc.start.cfi 作为恢复锚点
     *   2. isResizing = true，阻止 relocated 期间写入 storage
     *   3. 执行 fn()（同步，如 updateCustomStyles）
     *   4. 等两帧让 epub.js 完成重排
     *   5. display(savedCfi) 恢复位置
     *   6. 解锁 isResizing，手动触发 onLocationChanged
     *
     * @param {Function} fn  同步操作
     */
    function _withCfiLock(fn, persistence) {
      if (!state.rendition || !state.isBookLoaded) {
        fn();
        return;
      }
      const loc = state.rendition.currentLocation();
      const savedCfi = (loc && loc.start) ? loc.start.cfi : state.currentStableCfi;
      state.isResizing = true;
      fn();
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          if (savedCfi) await state.rendition.display(savedCfi);
          state.isResizing = false;
          const newLoc = state.rendition.currentLocation();
          if (newLoc && newLoc.start && persistence) persistence.onRelocated(newLoc);
        });
      });
    }

    // ── Rendition Hooks ───────────────────────────────────────────────────────

    /**
     * 注册 rendition.hooks.content 内的键盘/滚轮事件（epub iframe 内部）。
     * 与 reader-full.js setupRenditionKeyEvents 完全对齐。
     */
    function setupRenditionKeyEvents(rend, persistence) {
      rend.hooks.content.register((contents) => {
        const doc = contents.document;
        doc.addEventListener('keydown', (e) => _handleKeyNav(e));
        doc.addEventListener('click', (e) => {
          if (!e.target.closest('a')) {
            if (document.querySelector('.settings-panel.open, .bookmarks-panel.open, .sidebar.open')) {
              closeAllPanels();
            }
          }
        });
        doc.addEventListener('wheel', (e) => {
          if (!state.isBookLoaded || !state.rendition) return;
          if (state.prefs.layout === 'scrolled') return;
          e.preventDefault();
          if (e.deltaY > 0 || e.deltaX > 0) { if (state._runtime) state._runtime.next(); }
          else { if (state._runtime) state._runtime.prev(); }
        }, { passive: false });
      });
    }

    // ── Panels ────────────────────────────────────────────────────────────────

    function toggleSettings() { dom.settingsPanel?.classList.toggle('open'); }
    function closeSettings()  { dom.settingsPanel?.classList.remove('open'); }

    function closeAllPanels() {
      closeSettings();
      if (typeof TOC !== 'undefined' && TOC.close) TOC.close();
      if (typeof Bookmarks !== 'undefined' && Bookmarks.closePanel) Bookmarks.closePanel();
      if (typeof Search !== 'undefined' && Search.closePanel) Search.closePanel();
      if (typeof Highlights !== 'undefined' && Highlights.closePanels) Highlights.closePanels();
      const overlay = document.getElementById('sidebar-overlay');
      if (overlay) overlay.classList.remove('visible');
    }

    // 供 iframe 内 click 和 persistence 的 TOC.close 调用
    window.closeAllPanels = closeAllPanels;

    // ── Keyboard Nav ──────────────────────────────────────────────────────────

    // _runtime 在 bindRuntime 后注入
    function _handleKeyNav(e) {
      if (!state.isBookLoaded) return;
      const active = document.activeElement;
      const tag = active ? active.tagName : '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') active.blur();
        return;
      }
      const runtime = state._runtime;
      switch (e.key) {
        case 'Escape':
          e.preventDefault(); closeAllPanels(); break;
        case 'ArrowLeft': case 'PageUp':
          e.preventDefault(); e.stopImmediatePropagation();
          if (runtime) runtime.prev(); break;
        case 'ArrowRight': case 'PageDown': case ' ':
          e.preventDefault(); e.stopImmediatePropagation();
          if (runtime) runtime.next(); break;
        case 'o':
          if (!e.ctrlKey && !e.metaKey) dom.fileInput && dom.fileInput.click(); break;
        case 's':
          if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleSettings(); } break;
        case 'b':
          if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); _toggleBookmarkAtCurrent(); } break;
        case 'h':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
          } break;
      }
    }

    async function _toggleBookmarkAtCurrent() {
      if (!state.rendition || !state.isBookLoaded) return;
      const location = state.rendition.currentLocation();
      if (!location || !location.start) return;
      const cfi = location.start.cfi;
      const currentSection = location.start.href;
      const tocItem = _findTocItemForBookmark(
        state.book && state.book.navigation ? state.book.navigation.toc : [],
        currentSection
      );
      const chapterName = tocItem ? tocItem.label.trim() : '';
      const progress = (state.book && state.book.locations && state.book.locations.length())
        ? state.book.locations.percentageFromCfi(cfi) : 0;
      await Bookmarks.toggle(cfi, chapterName, progress);
      // 刷新书签按钮状态（复用 persistence 的逻辑，这里直接操作 DOM）
      const btn = document.getElementById('btn-bookmark');
      if (btn) {
        const isBookmarked = await Bookmarks.isBookmarked(cfi);
        btn.classList.toggle('active', isBookmarked);
        btn.title = isBookmarked ? '移除书签 (B)' : '添加书签 (B)';
      }
    }

    function _findTocItemForBookmark(items, href) {
      if (!items || !items.length) return null;
      for (const item of items) {
        if (href.includes(item.href.split('#')[0])) return item;
        if (item.subitems && item.subitems.length > 0) {
          const found = _findTocItemForBookmark(item.subitems, href);
          if (found) return found;
        }
      }
      return null;
    }

    // ── Preferences Load ──────────────────────────────────────────────────────

    /**
     * 将已加载的 state.prefs 同步到 DOM 控件。
     */
    function syncPrefsToControls() {
      if (dom.customBgColor)   dom.customBgColor.value   = state.prefs.customBg;
      if (dom.customTextColor) dom.customTextColor.value = state.prefs.customText;
      if (dom.fontSizeSlider) {
        dom.fontSizeSlider.value = state.prefs.fontSize;
        if (dom.fontSizeValue) dom.fontSizeValue.textContent = state.prefs.fontSize + 'px';
      }
      if (dom.lineHeightSlider) {
        dom.lineHeightSlider.value = Math.round(state.prefs.lineHeight * 10);
        if (dom.lineHeightValue) dom.lineHeightValue.textContent = state.prefs.lineHeight.toFixed(1);
      }
      if (dom.fontFamilySelect) dom.fontFamilySelect.value = state.prefs.fontFamily;
      document.querySelectorAll('.layout-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.layout === state.prefs.layout);
      });
      // 主题按钮
      applyTheme(state.prefs.theme, false);
    }

    // ── Event Binding ─────────────────────────────────────────────────────────

    function bindNavigation(runtime) {
      document.getElementById('btn-prev')?.addEventListener('click', () => runtime.prev());
      document.getElementById('btn-next')?.addEventListener('click', () => runtime.next());

      dom.readerMain?.addEventListener('wheel', (e) => {
        if (!state.isBookLoaded || !state.rendition) return;
        if (state.prefs.layout === 'scrolled') return;
        e.preventDefault();
        if (e.deltaY > 0 || e.deltaX > 0) runtime.next();
        else runtime.prev();
      }, { passive: false });

      dom.readerMain?.addEventListener('click', () => ensureFocus());

      document.addEventListener('keydown', _handleKeyNav);
    }

    function bindProgress(runtime) {
      if (!dom.progressSlider) return;
      dom.progressSlider.addEventListener('input', (e) => {
        if (dom.progressCurrent) {
          dom.progressCurrent.textContent = parseFloat(e.target.value).toFixed(1) + '%';
        }
      });
      dom.progressSlider.addEventListener('change', (e) => {
        if (!state.book || !state.book.locations || !state.book.locations.length()) return;
        runtime.displayPercentage(parseFloat(e.target.value));
      });
      dom.progressSlider.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.key === 'ArrowLeft') runtime.prev(); else runtime.next();
        }
      });
    }

    function bindLayoutSettings(runtime) {
      document.querySelectorAll('.layout-btn').forEach((btn) => {
        btn.addEventListener('click', () => runtime.setLayout(btn.dataset.layout));
      });
    }

    function bindTheme() {
      document.querySelectorAll('.theme-btn').forEach((btn) => {
        btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
      });

      if (dom.customBgColor && dom.customTextColor) {
        dom.customBgColor.addEventListener('input', (e) => {
          state.prefs.customBg = e.target.value;
          if (state.prefs.theme === 'custom') applyThemeToRendition('custom');
        });
        dom.customBgColor.addEventListener('change', (e) => {
          EpubStorage.savePreferences({ customBg: e.target.value });
        });
        dom.customTextColor.addEventListener('input', (e) => {
          state.prefs.customText = e.target.value;
          if (state.prefs.theme === 'custom') applyThemeToRendition('custom');
        });
        dom.customTextColor.addEventListener('change', (e) => {
          EpubStorage.savePreferences({ customText: e.target.value });
        });
      }
    }

    function bindTypography(persistence) {
      if (!dom.fontSizeSlider) return;

      dom.fontSizeSlider.addEventListener('input', (e) => {
        const size = parseInt(e.target.value);
        if (dom.fontSizeValue) dom.fontSizeValue.textContent = size + 'px';
        state.prefs.fontSize = size;
        _withCfiLock(() => updateCustomStyles(), persistence);
      });
      dom.fontSizeSlider.addEventListener('change', (e) => {
        EpubStorage.savePreferences({ fontSize: parseInt(e.target.value) });
      });

      dom.lineHeightSlider?.addEventListener('input', (e) => {
        const val = parseInt(e.target.value) / 10;
        if (dom.lineHeightValue) dom.lineHeightValue.textContent = val.toFixed(1);
        state.prefs.lineHeight = val;
        _withCfiLock(() => updateCustomStyles(), persistence);
      });
      dom.lineHeightSlider?.addEventListener('change', (e) => {
        EpubStorage.savePreferences({ lineHeight: parseInt(e.target.value) / 10 });
      });

      dom.fontFamilySelect?.addEventListener('change', (e) => {
        state.prefs.fontFamily = e.target.value;
        _withCfiLock(() => updateCustomStyles(), persistence);
        EpubStorage.savePreferences({ fontFamily: e.target.value });
      });
    }

    function bindPanelState() {
      document.getElementById('btn-settings')?.addEventListener('click', () => toggleSettings());
      document.getElementById('btn-settings-close')?.addEventListener('click', () => closeSettings());
      document.getElementById('btn-bookmark')?.addEventListener('click', () => _toggleBookmarkAtCurrent());

      document.addEventListener('click', (e) => {
        const isInsidePanel = e.target.closest('#settings-panel') ||
          e.target.closest('#bookmarks-panel') ||
          e.target.closest('#sidebar') ||
          e.target.closest('#search-panel') ||
          e.target.closest('.toolbar-btn') ||
          e.target.closest('.annotation-popup');
        if (!isInsidePanel) closeAllPanels();
      });
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

    function bindResize(persistence) {
      let resizeTimer;
      let preResizeCfi = null;
      window.addEventListener('resize', () => {
        if (!state.rendition || !state.isBookLoaded) return;
        state.isResizing = true;
        if (!preResizeCfi) {
          const loc = state.rendition.currentLocation();
          // v1.8.0 BUG-03-A：使用 start.cfi（end.cfi 在字号放大后会视觉后退）
          if (loc && loc.start) preResizeCfi = loc.start.cfi;
        }
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(async () => {
          const targetCfi = preResizeCfi;
          preResizeCfi = null;
          state.rendition.resize();
          await new Promise(resolve => requestAnimationFrame(resolve));
          if (targetCfi) await state.rendition.display(targetCfi);
          state.isResizing = false;
          const newLoc = state.rendition.currentLocation();
          if (newLoc && newLoc.start && persistence) persistence.onRelocated(newLoc);
        }, 250);
      });
    }

    async function openLocalFile(file, runtime) {
      try {
        showLoading(true);
        const arrayBuffer = await file.arrayBuffer();
        const bookId = await EpubStorage.generateBookId(file.name, arrayBuffer);
        // storeFile 参数顺序：(filename, data, bookId) — 对齐 reader-full.js
        EpubStorage.storeFile(file.name, new Uint8Array(arrayBuffer), bookId).catch(e => {
          console.warn('[ReaderUi] Failed to store book in IndexedDB:', e);
        });
        await runtime.openBook(arrayBuffer, bookId, file.name);
      } catch (err) {
        console.error('[ReaderUi] failed to open local file:', err);
        showLoadError('无法加载此 EPUB 文件: ' + err.message);
      }
    }

    /**
     * 注册所有顶层事件监听，必须在 runtime 实例化后调用。
     */
    async function bindRuntime(runtime, persistence) {
      // 将 runtime 注入 state，供 _handleKeyNav 和 iframe wheel 事件使用
      state._runtime = runtime;

      document.getElementById('welcome-open-btn')?.addEventListener('click', () => {
        dom.fileInput && dom.fileInput.click();
      });
      document.getElementById('btn-open')?.addEventListener('click', () => {
        dom.fileInput && dom.fileInput.click();
      });
      document.getElementById('btn-home')?.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
      });

      dom.fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await openLocalFile(file, runtime);
        e.target.value = '';
      });

      bindNavigation(runtime);
      bindProgress(runtime);
      bindLayoutSettings(runtime);
      bindTheme();
      bindTypography(persistence);
      bindPanelState();
      bindDragAndDrop(runtime);
      bindResize(persistence);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    function mount() {
      syncPrefsToControls();
    }

    function unmount() {
      // 事件监听均为 document/window 级，通过页面卸载自动清理
    }

    return {
      mount,
      unmount,
      bindRuntime,
      setReaderVisible,
      showLoading,
      showLoadError,
      updateProgress,
      applyTheme,
      applyThemeToRendition,
      ensureFocus,
      setupRenditionKeyEvents,
      injectCustomStyleElement,
      updateCustomStyles,
      generateCustomCss,
      getActiveThemeColors,
      closeAllPanels,
      syncPrefsToControls
    };
  }

  window.ReaderUi = { createReaderUi };
})();
