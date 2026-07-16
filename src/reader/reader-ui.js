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
 * 所有 DOM 显隐必须使用 classList，禁止 style.* 直写。
 */
(function () {
  'use strict';

  const RESIZE_DEBOUNCE_MS = 250;
  const DEFAULT_THEME = 'light';
  const DEFAULT_CUSTOM_BG = '#ffffff';
  const DEFAULT_CUSTOM_TEXT = '#333333';
  const DEFAULT_FONT_SIZE = 18;
  const DEFAULT_LINE_HEIGHT = 1.8;
  const DEFAULT_FONT_STACK = "'Noto Serif SC', 'Source Han Serif CN', 'SimSun', 'STSong', serif";
  const VALID_THEMES = new Set(['light', 'dark', 'sepia', 'green', 'custom']);
  const VALID_LAYOUTS = new Set(['paginated', 'scrolled']);
  const VALID_SPREADS = new Set(['auto', 'none']);
  const VALID_FONT_FAMILIES = new Set([
    '',
    "'Noto Serif SC', 'Source Han Serif CN', serif",
    "'Noto Sans SC', 'Source Han Sans CN', sans-serif",
    "'LXGW WenKai', '楷体', KaiTi, serif",
    'serif',
    'sans-serif'
  ]);

  function createReaderUi({ state }) {
    let _runtime = null;
    let _isRuntimeBound = false;
    let _reflowSeq = 0;
    let _openLocalFileQueue = Promise.resolve();

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
      dragOverlay:        document.getElementById('drag-overlay'),
      btnBookmark:        document.getElementById('btn-bookmark'),
      sidebarOverlay:     document.getElementById('sidebar-overlay'),
      tocSidebar:         document.getElementById('sidebar'),
      bookmarksPanel:     document.getElementById('bookmarks-panel'),
      searchPanel:        document.getElementById('search-panel')
    };

    // ── Focus ─────────────────────────────────────────────────────────────────

    function ensureFocus() {
      if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
        document.activeElement.blur();
      }
      window.focus();
    }

    function _savePreferencesSafely(prefs) {
      EpubStorage.savePreferences(prefs).catch((e) => {
        console.warn('[ReaderUi] save preferences failed:', e);
      });
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

    /**
     * 清除 reader-main 的 error 样式（对应 showLoadError 设置的 reader-main-error）。
     */
    function clearReaderError() {
      dom.readerMain?.classList.remove('reader-main-error');
    }

    /**
     * 设置书名显示（同步 book-title 元素和 document.title）。
     * @param {string} title
     */
    function setBookTitle(title) {
      const bookTitle = title || state.currentFileName;
      if (dom.bookTitleEl) dom.bookTitleEl.textContent = bookTitle;
      document.title = bookTitle + ' - EPUB Reader';
    }

    /**
     * 设置 reader-main 的 dimmed 状态（用于 prev 翻页章头特效）。
     * @param {boolean} dimmed
     */
    function setReaderDimmed(dimmed) {
      dom.readerMain?.classList.toggle('reader-main-dimmed', dimmed);
    }

    /**
     * 更新章节标题显示。
     * @param {string} title
     */
    function updateChapterTitle(title) {
      if (dom.chapterTitleEl) dom.chapterTitleEl.textContent = title;
    }

    /**
     * 更新书签按钮状态。
     * @param {boolean} isBookmarked
     */
    function updateBookmarkButtonState(isBookmarked) {
      const btn = dom.btnBookmark;
      if (btn) {
        btn.classList.toggle('active', isBookmarked);
        btn.title = isBookmarked ? '移除书签 (B)' : '添加书签 (B)';
      }
    }

    /**
     * 更新阅读统计文本（时长 + 历史平均字速 + ETA）。
     * @param {string} text
     */
    function updateReadingStatsText(text) {
      if (dom.progressTime) dom.progressTime.textContent = text;
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

      // 清理epub-viewer（如果存在）和旧的error wrapper
      const epubViewer = document.getElementById('epub-viewer');
      if (epubViewer) epubViewer.remove();
      const oldWrapper = rm.querySelector('.reader-error-wrapper');
      if (oldWrapper) oldWrapper.remove();

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

    function setLocationIndexStatus(status, detail = '') {
      if (!dom.progressLocation) return;
      if (status === 'ready') {
        dom.progressLocation.textContent = '';
        return;
      }
      if (detail) {
        dom.progressLocation.textContent = detail;
        return;
      }
      const fallbackText = {
        idle: '',
        pending: '准备生成阅读定位索引...',
        generating: '后台生成阅读定位索引...',
        ready: '阅读定位索引已就绪',
        failed: '阅读定位索引不可用'
      };
      dom.progressLocation.textContent = fallbackText[status] || '';
    }

    // ── Theme ─────────────────────────────────────────────────────────────────

    // 主题颜色进入 EPUB iframe 前先做格式与对比度校验。
    function normalizeHexColor(input) {
      if (typeof input !== 'string') return null;
      const val = input.trim();
      if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val)) return null;
      if (val.length === 4) {
        return '#' + val.slice(1).split('').map(ch => ch + ch).join('').toLowerCase();
      }
      return val.toLowerCase();
    }

    function normalizeNumber(value, fallback, min, max) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
      return Math.min(max, Math.max(min, value));
    }

    function normalizePreferences(prefs) {
      const source = prefs && typeof prefs === 'object' ? prefs : {};
      return {
        ...source,
        theme: VALID_THEMES.has(source.theme) ? source.theme : DEFAULT_THEME,
        customBg: normalizeHexColor(source.customBg) || DEFAULT_CUSTOM_BG,
        customText: normalizeHexColor(source.customText) || DEFAULT_CUSTOM_TEXT,
        fontFamily: VALID_FONT_FAMILIES.has(source.fontFamily) ? source.fontFamily : '',
        fontSize: normalizeNumber(source.fontSize, DEFAULT_FONT_SIZE, 12, 32),
        lineHeight: normalizeNumber(source.lineHeight, DEFAULT_LINE_HEIGHT, 1.2, 3),
        layout: VALID_LAYOUTS.has(source.layout) ? source.layout : 'paginated',
        spread: VALID_SPREADS.has(source.spread) ? source.spread : 'auto',
        paragraphIndent: typeof source.paragraphIndent === 'boolean' ? source.paragraphIndent : true
      };
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
      const bg = normalizeHexColor(themeObj?.bg) || DEFAULT_CUSTOM_BG;
      const fg = normalizeHexColor(themeObj?.color) || DEFAULT_CUSTOM_TEXT;
      const contrast = contrastRatio(bg, fg);
      if (contrast >= 2.5) return { bg, color: fg };
      const fallback = luminance(bg) > 0.5 ? '#1f2937' : '#f3f4f6';
      return { bg, color: fallback };
    }

    function getActiveThemeColors(theme) {
      const themes = {
        light:  { bg: '#ffffff',  color: '#2d2d2d' },
        dark:   { bg: '#1a1a1a',  color: '#d4d0c8' },
        sepia:  { bg: '#f8f0dc',  color: '#3e2f1c' },
        green:  { bg: '#c7e6c1',  color: '#2b3a2b' },
        custom: {
          bg:    state.prefs.customBg,
          color: state.prefs.customText
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
      const normalizedTheme = VALID_THEMES.has(theme) ? theme : DEFAULT_THEME;
      document.documentElement.setAttribute('data-theme', normalizedTheme);
      state.prefs.theme = normalizedTheme;
      document.querySelectorAll('.theme-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.theme === normalizedTheme);
      });
      if (dom.customThemeOptions) {
        dom.customThemeOptions.classList.toggle('is-visible', normalizedTheme === 'custom');
      }
      applyThemeToRendition(normalizedTheme);
      if (save) _savePreferencesSafely({ theme: normalizedTheme });
    }

    // ── Custom Styles ─────────────────────────────────────────────────────────

    function generateCustomCss() {
      const prefs = normalizePreferences(state.prefs);
      const fontFamily = prefs.fontFamily || DEFAULT_FONT_STACK;
      const activeTheme = getActiveThemeColors(prefs.theme);
      return `
        @namespace xmlns "http://www.w3.org/1999/xhtml";
        html, body {
          background-color: ${activeTheme.bg} !important;
          color: ${activeTheme.color} !important;
          font-size: ${prefs.fontSize}px !important;
          font-family: ${fontFamily} !important;
          line-height: ${prefs.lineHeight} !important;
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

    // ── CFI Lock ──────────────────────────────────────────────────────────────

    function _beginReflow(rendition) {
      const operationId = ++_reflowSeq;
      state.isResizing = true;
      state.isRestoringPosition = true;
      return { operationId, rendition };
    }

    function _isCurrentReflow(context) {
      return context.operationId === _reflowSeq &&
        context.rendition === state.rendition &&
        state.isBookLoaded;
    }

    function _releaseReflow(context) {
      if (!_isCurrentReflow(context)) return false;
      state.isResizing = false;
      state.isRestoringPosition = false;
      return true;
    }

    /**
     * 在可能触发 epub.js 重排的同步操作前后保护当前阅读位置。
     *
     * 流程：
     *   1. 记录 loc.start.cfi 作为恢复锚点
     *   2. isResizing = true，阻止 relocated 期间写入 storage
     *   3. 执行 fn()（同步，如 updateCustomStyles）
     *   4. 等两帧让 epub.js 完成重排
     *   5. display(savedCfi) 恢复位置
     *   6. 解锁 isResizing，手动触发 onRelocated
     *
     * @param {Function} fn  同步操作
     */
    function _withCfiLock(fn, persistence) {
      if (!state.rendition || !state.isBookLoaded) {
        fn();
        return;
      }
      const rendition = state.rendition;
      const loc = rendition.currentLocation();
      const savedCfi = (loc && loc.start) ? loc.start.cfi : state.currentStableCfi;
      const context = _beginReflow(rendition);
      try {
        fn();
      } catch (e) {
        _releaseReflow(context);
        console.warn('[Ui] _withCfiLock update failed:', e);
        return;
      }
      requestAnimationFrame(() => {
        if (!_isCurrentReflow(context)) return;
        requestAnimationFrame(async () => {
          if (!_isCurrentReflow(context)) return;
          try {
            if (savedCfi) await rendition.display(savedCfi);
          } catch (e) {
            console.warn('[Ui] _withCfiLock display failed:', e);
          } finally {
            if (!_isCurrentReflow(context)) return;
            state.isResizing = false;
            // 等待 relocated 事件处理完毕后解除恢复保护
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            if (!_releaseReflow(context)) return;
          }
          const newLoc = rendition.currentLocation();
          if (newLoc && newLoc.start && persistence) persistence.onRelocated(newLoc);
        });
      });
    }

    // ── Rendition Hooks ───────────────────────────────────────────────────────

    /**
     * 注册 rendition.hooks.content 内的键盘/滚轮事件（epub iframe 内部）。
     */
    function setupRenditionKeyEvents(rend, persistence, runtime) {
      rend.hooks.content.register((contents) => {
        if (state.rendition !== rend) return;
        const doc = contents.document;
        doc.addEventListener('keydown', (e) => {
          if (state.rendition !== rend) return;
          _handleKeyNav(e, runtime);
        });
        doc.addEventListener('click', (e) => {
          if (state.rendition !== rend) return;
          if (!e.target.closest('a')) {
            if (document.querySelector('.settings-panel.open, .bookmarks-panel.open, .sidebar.open')) {
              closeAllPanels();
            }
          }
        });
        doc.addEventListener('wheel', (e) => {
          if (state.rendition !== rend || !state.isBookLoaded) return;
          if (state.prefs.layout === 'scrolled') return;
          e.preventDefault();
          if (e.deltaY > 0 || e.deltaX > 0) { if (runtime) runtime.next(); }
          else { if (runtime) runtime.prev(); }
        }, { passive: false });
      });
    }

    // ── Panels ────────────────────────────────────────────────────────────────

    function toggleSettings() { dom.settingsPanel?.classList.toggle('open'); }
    function closeSettings()  { dom.settingsPanel?.classList.remove('open'); }

    function _sharedSidebarPanels() {
      return [dom.tocSidebar, dom.bookmarksPanel, dom.searchPanel].filter(Boolean);
    }

    function openExclusivePanel(panelElement) {
      if (!panelElement) return;
      _sharedSidebarPanels().forEach((panel) => {
        panel.classList.toggle('open', panel === panelElement);
      });
      dom.sidebarOverlay?.classList.add('visible');
    }

    function closePanelWithOverlayCheck(panelElement) {
      panelElement?.classList.remove('open');
      const hasOpenPanel = _sharedSidebarPanels().some((panel) => panel.classList.contains('open'));
      if (!hasOpenPanel) dom.sidebarOverlay?.classList.remove('visible');
    }

    function closeAllPanels() {
      closeSettings();
      if (typeof TOC !== 'undefined' && TOC.close) TOC.close();
      if (typeof Bookmarks !== 'undefined' && Bookmarks.closePanel) Bookmarks.closePanel();
      if (typeof Search !== 'undefined' && Search.closePanel) Search.closePanel();
      if (typeof Highlights !== 'undefined' && Highlights.closePanels) Highlights.closePanels();
      dom.sidebarOverlay?.classList.remove('visible');
    }

    // ── Keyboard Nav ──────────────────────────────────────────────────────────

    // _runtime 在 bindRuntime 后注入
    function _handleKeyNav(e, runtime) {
      if (!state.isBookLoaded) return;
      const active = document.activeElement;
      const tag = e.target?.tagName || (active ? active.tagName : '');
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') (e.target?.blur ? e.target : active)?.blur();
        return;
      }
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
          if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); _toggleBookmarkAtCurrent(); }
          break;
        case 'h':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
          } break;
      }
    }

    async function _toggleBookmarkAtCurrent() {
      try {
        if (!state.rendition || !state.isBookLoaded) return;
        const location = state.rendition.currentLocation();
        if (!location || !location.start) return;
        const cfi = location.start.cfi;
        const currentSection = location.start.href;
        const tocItem = ReaderState.findTocItem(
          state.book && state.book.navigation ? state.book.navigation.toc : [],
          currentSection
        );
        const chapterName = ReaderState.getTocItemLabel(tocItem);
        const progress = (state.book && state.book.locations && state.book.locations.length())
          ? state.book.locations.percentageFromCfi(cfi) : 0;
        await Bookmarks.toggle(cfi, chapterName, progress);
        const isBookmarked = await Bookmarks.isBookmarked(cfi);
        updateBookmarkButtonState(isBookmarked);
      } catch (err) {
        console.warn('[ReaderUi] toggle bookmark failed:', err);
      }
    }

    // ── Preferences Load ──────────────────────────────────────────────────────

    /**
     * 将已加载的 state.prefs 同步到 DOM 控件。
     */
    function syncPrefsToControls() {
      state.prefs = normalizePreferences(state.prefs);
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

    function bindNavigation() {
      document.getElementById('btn-prev')?.addEventListener('click', () => _runtime && _runtime.prev());
      document.getElementById('btn-next')?.addEventListener('click', () => _runtime && _runtime.next());

      dom.readerMain?.addEventListener('wheel', (e) => {
        if (!state.isBookLoaded || !state.rendition) return;
        if (state.prefs.layout === 'scrolled') return;
        e.preventDefault();
        if (!_runtime) return;
        if (e.deltaY > 0 || e.deltaX > 0) _runtime.next();
        else _runtime.prev();
      }, { passive: false });

      dom.readerMain?.addEventListener('click', () => ensureFocus());

      document.addEventListener('keydown', (e) => _handleKeyNav(e, _runtime));
    }

    function bindProgress() {
      if (!dom.progressSlider) return;
      dom.progressSlider.addEventListener('input', (e) => {
        if (dom.progressCurrent) {
          dom.progressCurrent.textContent = parseFloat(e.target.value).toFixed(1) + '%';
        }
      });
      dom.progressSlider.addEventListener('change', (e) => {
        if (!state.book || !state.book.locations || !state.book.locations.length()) return;
        if (_runtime) _runtime.displayPercentage(parseFloat(e.target.value));
      });
      dom.progressSlider.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!_runtime) return;
          if (e.key === 'ArrowLeft') _runtime.prev(); else _runtime.next();
        }
      });
    }

    function bindLayoutSettings() {
      document.querySelectorAll('.layout-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!_runtime) return;
          Promise.resolve(_runtime.setLayout(btn.dataset.layout)).catch((e) => {
            console.warn('[ReaderUi] layout switch failed:', e);
          });
        });
      });
    }

    function bindTheme() {
      document.querySelectorAll('.theme-btn').forEach((btn) => {
        btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
      });

      if (dom.customBgColor && dom.customTextColor) {
        dom.customBgColor.addEventListener('input', (e) => {
          state.prefs.customBg = normalizeHexColor(e.target.value) || DEFAULT_CUSTOM_BG;
          if (state.prefs.theme === 'custom') applyThemeToRendition('custom');
        });
        dom.customBgColor.addEventListener('change', (e) => {
          _savePreferencesSafely({ customBg: normalizeHexColor(e.target.value) || DEFAULT_CUSTOM_BG });
        });
        dom.customTextColor.addEventListener('input', (e) => {
          state.prefs.customText = normalizeHexColor(e.target.value) || DEFAULT_CUSTOM_TEXT;
          if (state.prefs.theme === 'custom') applyThemeToRendition('custom');
        });
        dom.customTextColor.addEventListener('change', (e) => {
          _savePreferencesSafely({ customText: normalizeHexColor(e.target.value) || DEFAULT_CUSTOM_TEXT });
        });
      }
    }

    function bindTypography(persistence) {
      if (!dom.fontSizeSlider) return;

      dom.fontSizeSlider.addEventListener('input', (e) => {
        const size = normalizeNumber(Number(e.target.value), DEFAULT_FONT_SIZE, 12, 32);
        e.target.value = size;
        if (dom.fontSizeValue) dom.fontSizeValue.textContent = size + 'px';
        state.prefs.fontSize = size;
        _withCfiLock(() => updateCustomStyles(), persistence);
      });
      dom.fontSizeSlider.addEventListener('change', (e) => {
        _savePreferencesSafely({
          fontSize: normalizeNumber(Number(e.target.value), DEFAULT_FONT_SIZE, 12, 32)
        });
      });

      dom.lineHeightSlider?.addEventListener('input', (e) => {
        const val = normalizeNumber(Number(e.target.value) / 10, DEFAULT_LINE_HEIGHT, 1.2, 3);
        e.target.value = Math.round(val * 10);
        if (dom.lineHeightValue) dom.lineHeightValue.textContent = val.toFixed(1);
        state.prefs.lineHeight = val;
        _withCfiLock(() => updateCustomStyles(), persistence);
      });
      dom.lineHeightSlider?.addEventListener('change', (e) => {
        _savePreferencesSafely({
          lineHeight: normalizeNumber(Number(e.target.value) / 10, DEFAULT_LINE_HEIGHT, 1.2, 3)
        });
      });

      dom.fontFamilySelect?.addEventListener('change', (e) => {
        const fontFamily = VALID_FONT_FAMILIES.has(e.target.value) ? e.target.value : '';
        state.prefs.fontFamily = fontFamily;
        e.target.value = fontFamily;
        _withCfiLock(() => updateCustomStyles(), persistence);
        _savePreferencesSafely({ fontFamily });
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

    function bindDragAndDrop() {
      document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dom.dragOverlay?.classList.remove('is-hidden');
      });
      document.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null || e.relatedTarget === document.documentElement) {
          dom.dragOverlay?.classList.add('is-hidden');
        }
      });
      document.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dom.dragOverlay?.classList.add('is-hidden');
        const files = e.dataTransfer?.files;
        const file = files && files[0];
        if (!file || !file.name.toLowerCase().endsWith('.epub')) return;
        if (_runtime) await openLocalFile(file, _runtime);
      });
    }

    function bindResize(persistence) {
      let resizeTimer;
      let preResizeCfi = null;
      let resizeRendition = null;
      window.addEventListener('resize', () => {
        if (!state.rendition || !state.isBookLoaded) return;
        const rendition = state.rendition;
        if (resizeRendition !== rendition) {
          resizeRendition = rendition;
          preResizeCfi = null;
        }
        if (!preResizeCfi) {
          const locator = state.currentStableLocator;
          const hasMatchingRestoreCfi = locator &&
            locator.sourceCfi === state.currentStableCfi &&
            typeof locator.restoreCfi === 'string' &&
            locator.restoreCfi;
          // resize 事件触发时 viewport 已改变，此时 currentLocation() 可能已指向
          // 新布局的错误页。优先使用变化前持久化的可视锚点，再退回主 CFI。
          preResizeCfi = hasMatchingRestoreCfi || state.currentStableCfi;
          if (!preResizeCfi) {
            const loc = rendition.currentLocation();
            if (loc && loc.start) preResizeCfi = loc.start.cfi;
          }
        }
        const targetCfi = preResizeCfi;
        const context = _beginReflow(rendition);
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(async () => {
          if (!_isCurrentReflow(context)) return;
          preResizeCfi = null;
          resizeRendition = null;
          resizeTimer = null;
          let newLoc = null;
          try {
            rendition.resize();
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (!_isCurrentReflow(context)) return;
            if (targetCfi) await rendition.display(targetCfi);
            if (_isCurrentReflow(context)) newLoc = rendition.currentLocation();
          } catch (e) {
            console.warn('[Ui] bindResize display failed:', e);
          } finally {
            if (!_releaseReflow(context)) return;
          }
          if (newLoc && newLoc.start && persistence) persistence.onRelocated(newLoc);
        }, RESIZE_DEBOUNCE_MS);
      });
    }

    async function _openLocalFile(file, runtime) {
      try {
        showLoading(true);
        const arrayBuffer = await file.arrayBuffer();
        const bookId = await EpubStorage.generateBookId(file.name, arrayBuffer);
        // storeFile 参数顺序：(filename, data, bookId)
        await EpubStorage.storeFile(file.name, new Uint8Array(arrayBuffer), bookId);
        await runtime.openBook(arrayBuffer, bookId, file.name);
        const readerUrl = chrome.runtime.getURL('reader/reader.html') +
          '?bookId=' + encodeURIComponent(bookId);
        window.history?.replaceState?.(null, '', readerUrl);
      } catch (err) {
        console.error('[ReaderUi] failed to open local file:', err);
        showLoadError('无法加载此 EPUB 文件: ' + err.message);
      }
    }

    function openLocalFile(file, runtime) {
      const task = _openLocalFileQueue.then(() => _openLocalFile(file, runtime));
      _openLocalFileQueue = task.catch(() => {});
      return task;
    }

    /**
     * 注册所有顶层事件监听，必须在 runtime 实例化后调用。
     */
    async function bindRuntime(runtime, persistence) {
      _runtime = runtime;
      if (_isRuntimeBound) return;
      _isRuntimeBound = true;

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
        if (_runtime) await openLocalFile(file, _runtime);
        e.target.value = '';
      });

      bindNavigation();
      bindProgress();
      bindLayoutSettings();
      bindTheme();
      bindTypography(persistence);
      bindPanelState();
      bindDragAndDrop();
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
      clearReaderError,
      setBookTitle,
      setReaderDimmed,
      updateChapterTitle,
      updateBookmarkButtonState,
      updateReadingStatsText,
      showLoading,
      showLoadError,
      updateProgress,
      setLocationIndexStatus,
      applyTheme,
      applyThemeToRendition,
      ensureFocus,
      setupRenditionKeyEvents,
      injectCustomStyleElement,
      updateCustomStyles,
      openExclusivePanel,
      closePanelWithOverlayCheck,
      closeAllPanels,
      syncPrefsToControls
    };
  }

  window.ReaderUi = { createReaderUi };
})();
