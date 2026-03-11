/**
 * EPUB Reader - Main Controller
 * Orchestrates epub.js rendering, settings, navigation, and all modules
 *
 * v1.7.0 变更：
 *   [SPEED]    per-session 阅读速度追踪（_sessionStart）修复中途开书/跳章 ETA 偏差
 *   [DEBOUNCE] savePosition 改为 300ms 防抖（schedulePositionSave），翻页不直写
 *   [UTILS]    格式化函数迁移至 Utils
 *
 * v1.8.0 变更：
 *   [BUG-02-A] flushSpeedSession 直接更新内存缓存 _cachedSpeed，废弃无效的
 *              window._cachedSpeed + refreshCachedSpeed + _origFlushSpeedSession 占位代码
 *   [BUG-02-B] visibilitychange visible 时重置 _sessionStart，排除挂机时间被计入速度
 *   [BUG-02-C] session 实时速度触发阈值从 (>60s, >0.5%) 降至 (>30s, >0.3%)
 *   [BUG-03-A] resize 改用 loc.start.cfi 作为锚点（原 end.cfi 会在字号变大时导致后退）
 *   [BUG-03-B] 字号/行高/字间距变化引入 _withCfiLock，等待重排完成后恢复位置
 *   [TD-2.5]   消除 window._cachedSpeed 全局变量，改为 IIFE 内模块级 _cachedSpeed
 */
(function () {
  'use strict';

  // --- State ---
  let book = null;
  let rendition = null;
  let currentBookId = '';
  let currentFileName = '';
  let isBookLoaded = false;
  let currentStableCfi = null;
  let isResizing = false;    // 缩放/布局重排保护锁（期间忽略 relocated 事件）
  let _navLock = false;

  // --- Reading Stats State ---
  let readingTimer         = null;
  let activeReadingSeconds = 0;

  // --- Speed Tracking State ---
  // _cachedSpeed: 内存缓存，由 flushSpeedSession 在写入 storage 后同步更新。
  // 消除原 window._cachedSpeed（全局污染）和失效的 refreshCachedSpeed() 路径。
  let _cachedSpeed    = null;  // { sampledSeconds, sampledProgress }
  let _sessionStart   = null;  // { progress: number, timestamp: number }
  let _lastProgress   = 0;     // 上一次 relocated 事件的进度 (0-1)
  let _posTimer       = null;  // savePosition 防抖 timer id
  let _lastPercent    = null;  // 上一次已知百分比（visibilitychange flush 用）

  // --- DOM Elements ---
  const welcomeScreen   = document.getElementById('welcome-screen');
  const loadingOverlay  = document.getElementById('loading-overlay');
  const readerMain      = document.getElementById('reader-main');
  const bottomBar       = document.getElementById('bottom-bar');
  const toolbar         = document.getElementById('toolbar');
  const fileInput       = document.getElementById('file-input');

  const bookTitleEl     = document.getElementById('book-title');
  const chapterTitleEl  = document.getElementById('chapter-title');
  const progressSlider  = document.getElementById('progress-slider');
  const progressCurrent = document.getElementById('progress-current');
  const progressLocation= document.getElementById('progress-location');
  const progressTime    = document.getElementById('progress-time');

  const fontSizeSlider  = document.getElementById('font-size-slider');
  const fontSizeValue   = document.getElementById('font-size-value');
  const lineHeightSlider= document.getElementById('line-height-slider');
  const lineHeightValue = document.getElementById('line-height-value');
  const fontFamilySelect= document.getElementById('font-family-select');
  const settingsPanel   = document.getElementById('settings-panel');

  const customThemeOptions = document.getElementById('custom-theme-options');
  const customBgColor      = document.getElementById('custom-bg-color');
  const customTextColor    = document.getElementById('custom-text-color');

  // --- Initialize Modules ---
  document.addEventListener('DOMContentLoaded', async () => {
    ImageViewer.init();
    Annotations.init();
    TOC.init();
    Search.init();
    Bookmarks.init();
    Highlights.init();

    await loadPreferences();
    setupEventListeners();
    setupDragAndDrop();

    const params      = new URLSearchParams(window.location.search);
    const bookIdParam = params.get('bookId');
    const targetCfi   = params.get('target');
    if (bookIdParam) {
      await loadFileByBookId(bookIdParam);
      if (targetCfi && rendition) rendition.display(targetCfi);
    }
  });

  // --- Event Listeners ---
  function setupEventListeners() {
    document.getElementById('welcome-open-btn').addEventListener('click', () => fileInput.click());
    document.getElementById('btn-open').addEventListener('click', () => fileInput.click());
    document.getElementById('btn-home').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) loadEpubFile(file);
    });

    document.getElementById('btn-prev').addEventListener('click', () => navPrev());
    document.getElementById('btn-next').addEventListener('click', () => navNext());
    document.addEventListener('keydown', handleKeyNav);

    document.getElementById('reader-main').addEventListener('wheel', (e) => {
      if (!isBookLoaded || !rendition) return;
      if (currentPrefs.layout === 'scrolled') return;
      e.preventDefault();
      if (e.deltaY > 0 || e.deltaX > 0) navNext();
      else if (e.deltaY < 0 || e.deltaX < 0) navPrev();
    }, { passive: false });

    document.getElementById('btn-settings').addEventListener('click', () => toggleSettings());
    document.getElementById('btn-settings-close').addEventListener('click', () => closeSettings());
    document.getElementById('btn-bookmark').addEventListener('click', () => toggleBookmarkAtCurrent());

    document.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.addEventListener('click', () => setTheme(btn.dataset.theme));
    });

    if (customBgColor && customTextColor) {
      customBgColor.addEventListener('input', (e) => {
        currentPrefs.customBg = e.target.value;
        if (currentPrefs.theme === 'custom') applyThemeToRendition('custom');
      });
      customBgColor.addEventListener('change', (e) => {
        EpubStorage.savePreferences({ customBg: e.target.value });
      });
      customTextColor.addEventListener('input', (e) => {
        currentPrefs.customText = e.target.value;
        if (currentPrefs.theme === 'custom') applyThemeToRendition('custom');
      });
      customTextColor.addEventListener('change', (e) => {
        EpubStorage.savePreferences({ customText: e.target.value });
      });
    }

    document.querySelectorAll('.layout-btn').forEach((btn) => {
      btn.addEventListener('click', () => setLayout(btn.dataset.layout));
    });

    // ── 字号 / 行高 / 字体 ── 带 CFI 锁（v1.8.0 BUG-03-B）
    fontSizeSlider.addEventListener('input', (e) => {
      const size = parseInt(e.target.value);
      fontSizeValue.textContent = size + 'px';
      currentPrefs.fontSize = size;
      _withCfiLock(() => updateCustomStyles());
    });
    fontSizeSlider.addEventListener('change', (e) => {
      EpubStorage.savePreferences({ fontSize: parseInt(e.target.value) });
    });

    lineHeightSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value) / 10;
      lineHeightValue.textContent = val.toFixed(1);
      currentPrefs.lineHeight = val;
      _withCfiLock(() => updateCustomStyles());
    });
    lineHeightSlider.addEventListener('change', (e) => {
      EpubStorage.savePreferences({ lineHeight: parseInt(e.target.value) / 10 });
    });

    fontFamilySelect.addEventListener('change', (e) => {
      currentPrefs.fontFamily = e.target.value;
      _withCfiLock(() => updateCustomStyles());
      EpubStorage.savePreferences({ fontFamily: e.target.value });
    });

    progressSlider.addEventListener('input', (e) => {
      if (!book || !book.locations || !book.locations.length()) return;
      progressCurrent.textContent = parseFloat(e.target.value).toFixed(1) + '%';
    });
    progressSlider.addEventListener('change', (e) => {
      if (!rendition || !book) return;
      if (!book.locations || !book.locations.length()) return;
      const cfi = book.locations.cfiFromPercentage(parseFloat(e.target.value) / 100);
      if (cfi) rendition.display(cfi);
    });
    progressSlider.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'ArrowLeft') navPrev(); else navNext();
      }
    });

    document.getElementById('reader-main').addEventListener('click', () => ensureFocus());

    // ── Resize 保护（v1.8.0 BUG-03-A：改用 start.cfi）
    let resizeTimer;
    let preResizeCfi = null;
    window.addEventListener('resize', () => {
      if (!rendition || !isBookLoaded) return;
      isResizing = true;
      if (!preResizeCfi) {
        const loc = rendition.currentLocation();
        // v1.8.0 BUG-03-A: 使用 start.cfi（用户正在读的内容起点）
        // 原 end.cfi 在字号放大后行变短，end 对应内容落入前一屏，造成视觉后退
        if (loc && loc.start) preResizeCfi = loc.start.cfi;
      }
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(async () => {
        const targetCfi = preResizeCfi;
        preResizeCfi = null;
        rendition.resize();
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (targetCfi) await rendition.display(targetCfi);
        isResizing = false;
        const newLoc = rendition.currentLocation();
        if (newLoc && newLoc.start) onLocationChanged(newLoc);
      }, 250);
    });

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

  // --- CFI 锁（v1.8.0 BUG-03-B）────────────────────────────────────────────
  /**
   * 在执行可能触发 epub.js 内部重排的同步操作前后，保护当前阅读位置。
   *
   * 操作模式：
   *   1. 记录当前 loc.start.cfi 作为恢复锚点
   *   2. 设置 isResizing = true，阻止期间 relocated 事件写入 storage
   *   3. 执行 fn()（同步，如 updateCustomStyles）
   *   4. 等待两个 rAF 让 epub.js 完成重排
   *   5. display(savedCfi) 恢复到锚点位置
   *   6. 解锁 isResizing，手动触发一次 onLocationChanged
   *
   * @param {Function} fn  同步操作（不应返回 Promise）
   */
  function _withCfiLock(fn) {
    if (!rendition || !isBookLoaded) {
      fn();
      return;
    }
    const loc = rendition.currentLocation();
    const savedCfi = (loc && loc.start) ? loc.start.cfi : currentStableCfi;
    isResizing = true;
    fn();
    // 等待两帧：第一帧 epub.js 处理样式，第二帧 layout 完成
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        if (savedCfi) await rendition.display(savedCfi);
        isResizing = false;
        const newLoc = rendition.currentLocation();
        if (newLoc && newLoc.start) onLocationChanged(newLoc);
      });
    });
  }

  // --- Centralized Panel Management ---
  function closeAllPanels() {
    closeSettings();
    if (typeof TOC !== 'undefined' && TOC.close) TOC.close();
    if (typeof Bookmarks !== 'undefined' && Bookmarks.closePanel) Bookmarks.closePanel();
    if (typeof Search !== 'undefined' && Search.closePanel) Search.closePanel();
    if (typeof Highlights !== 'undefined' && Highlights.closePanels) Highlights.closePanels();
    const overlay = document.getElementById('sidebar-overlay');
    if (overlay) overlay.classList.remove('visible');
  }

  function handleKeyNav(e) {
    if (!isBookLoaded) return;
    const active = document.activeElement;
    const tag = active ? active.tagName : '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') active.blur();
      return;
    }
    switch (e.key) {
      case 'Escape':    e.preventDefault(); closeAllPanels(); break;
      case 'ArrowLeft': case 'PageUp':
        e.preventDefault(); e.stopImmediatePropagation(); navPrev(); break;
      case 'ArrowRight': case 'PageDown': case ' ':
        e.preventDefault(); e.stopImmediatePropagation(); navNext(); break;
      case 'o': if (!e.ctrlKey && !e.metaKey) fileInput.click(); break;
      case 's': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleSettings(); } break;
      case 'b': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleBookmarkAtCurrent(); } break;
      case 'h': if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
      } break;
    }
  }

  function navNext() {
    if (_navLock || !rendition) return;
    _navLock = true;
    rendition.next();
    setTimeout(() => { _navLock = false; }, 150);
  }

  async function navPrev() {
    if (_navLock || !rendition) return;
    _navLock = true;
    const loc = rendition.currentLocation();
    if (loc && loc.atStart && currentPrefs.layout !== 'scrolled') {
      try {
        readerMain.classList.add('reader-main-dimmed');
        await rendition.prev();
      } finally {
        readerMain.classList.remove('reader-main-dimmed');
        setTimeout(() => { _navLock = false; }, 150);
      }
    } else {
      rendition.prev();
      setTimeout(() => { _navLock = false; }, 150);
    }
  }

  function ensureFocus() {
    if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
      document.activeElement.blur();
    }
    window.focus();
  }

  // --- Drag & Drop ---
  function setupDragAndDrop() {
    const dragOverlay = document.getElementById('drag-overlay');
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragOverlay) dragOverlay.classList.remove('hidden');
    });
    document.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null || e.relatedTarget === document.documentElement) {
        removeDragOverlay();
      }
    });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeDragOverlay();
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].name.toLowerCase().endsWith('.epub')) {
        loadEpubFile(files[0]);
      }
    });
    function removeDragOverlay() {
      if (dragOverlay) dragOverlay.classList.add('hidden');
    }
  }

  // --- Load EPUB ---
  async function loadEpubFile(file) {
    try {
      showLoading(true);
      currentFileName = file.name;
      const arrayBuffer = await file.arrayBuffer();
      currentBookId = await EpubStorage.generateBookId(file.name, arrayBuffer);
      EpubStorage.storeFile(file.name, new Uint8Array(arrayBuffer), currentBookId).catch(e => {
        console.warn('Failed to store book in IndexedDB:', e);
      });
      await openBook(arrayBuffer);
    } catch (err) {
      console.error('Failed to load EPUB:', err);
      showLoadError('无法加载此 EPUB 文件: ' + err.message);
    }
  }

  function showLoadError(msg) {
    showLoading(false);
    const ws = document.getElementById('welcome-screen');
    if (ws) ws.classList.add('is-hidden');
    const rm = document.getElementById('reader-main');
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
    btn.addEventListener('click', () => document.getElementById('file-input').click());

    wrapper.append(icon, title, detail, btn);
    rm.appendChild(wrapper);
    rm.classList.remove('is-hidden');
    rm.classList.add('reader-main-error');
  }

  async function loadFileByBookId(bookId) {
    try {
      showLoading(true);
      const record = await EpubStorage.getFile(bookId);
      if (record && record.data) {
        currentBookId   = bookId;
        currentFileName = record.filename || '';
        try {
          await openBook(record.data.buffer || record.data);
        } catch (err) {
          console.error('loadFileByBookId: openBook failed', err);
          showLoadError('无法解析该 EPUB 缓存文件: ' + err.message);
        }
      } else {
        showLoadError('该书籍缓存不存在或已被自动清理，请通过"打开文件"重新导入。');
      }
    } catch (e) {
      console.error('loadFileByBookId error:', e);
      showLoadError('读取缓存数据失败。请重新导入该电子书。');
    }
  }

  // --- Preferences & Styles ---
  let currentPrefs = { fontSize: 18, lineHeight: 1.8, fontFamily: '' };

  function generateCustomCss() {
    const fallbackFont = "'Noto Serif SC', 'Source Han Serif CN', 'SimSun', 'STSong', serif";
    const fontFamily = currentPrefs.fontFamily ? `${currentPrefs.fontFamily}, ${fallbackFont}` : fallbackFont;
    const activeTheme = getActiveThemeColors(currentPrefs.theme || 'light');
    return `
      @namespace xmlns "http://www.w3.org/1999/xhtml";
      html, body {
        background-color: ${activeTheme.bg} !important;
        color: ${activeTheme.color} !important;
        font-size: ${currentPrefs.fontSize}px !important;
        font-family: ${fontFamily} !important;
        line-height: ${currentPrefs.lineHeight} !important;
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
    if (!rendition || !rendition.getContents) return;
    rendition.getContents().forEach(contents => injectCustomStyleElement(contents));
  }

  async function openBook(arrayBuffer) {
    welcomeScreen.classList.add('is-hidden');
    readerMain.classList.add('is-visible');
    readerMain.classList.remove('reader-main-error');
    bottomBar.classList.add('is-visible');

    if (book) {
      book.destroy();
      if (typeof TOC !== 'undefined' && TOC.reset) TOC.reset();
      if (typeof Bookmarks !== 'undefined' && Bookmarks.reset) Bookmarks.reset();
      if (typeof Search !== 'undefined' && Search.reset) Search.reset();
      if (readingTimer) { clearInterval(readingTimer); readingTimer = null; }
      activeReadingSeconds = 0;
      _cachedSpeed  = null;
      _sessionStart = null;
      _lastProgress = 0;
    }

    book = ePub(arrayBuffer);
    const prefs = await EpubStorage.getPreferences();

    const meta = await EpubStorage.getBookMeta(currentBookId);
    activeReadingSeconds = (meta && meta.time) ? meta.time : 0;

    // v1.8.0 BUG-02-A: 直接初始化内存缓存，不依赖 storage 异步读取路径
    _cachedSpeed = (meta && meta.speed) ? meta.speed : { sampledSeconds: 0, sampledProgress: 0 };

    currentPrefs.fontSize   = prefs.fontSize   || 18;
    currentPrefs.lineHeight = prefs.lineHeight  || 1.8;
    currentPrefs.fontFamily = prefs.fontFamily  || '';

    startReadingTimer();

    rendition = book.renderTo('epub-viewer', {
      width: '100%', height: '100%',
      spread: prefs.spread || 'auto',
      flow:    prefs.layout === 'scrolled' ? 'scrolled-doc' : 'paginated',
      manager: prefs.layout === 'scrolled' ? 'continuous'   : 'default',
      allowScriptedContent: false,
      gap: prefs.layout === 'scrolled' ? 48 : 80
    });

    rendition.hooks.content.register((contents) => injectCustomStyleElement(contents));
    rendition.themes.default({
      'body': {
        'color': 'var(--reader-text, #2d2d2d)',
        'text-align': 'justify',
        '-webkit-font-smoothing': 'antialiased',
        '-moz-osx-font-smoothing': 'grayscale'
      },
      'p': {
        'margin-bottom': '0.5em',
        'text-indent': prefs.paragraphIndent !== false ? '2em' : '0',
        'text-align': 'justify'
      },
      'img':   { 'max-width': '100% !important', 'height': 'auto !important' },
      'image': { 'max-width': '100% !important', 'height': 'auto !important' }
    });

    applyThemeToRendition(prefs.theme || 'light');

    ImageViewer.hookRendition(rendition);
    Annotations.setBook(book);
    Annotations.hookRendition(rendition);
    setupRenditionKeyEvents(rendition);

    rendition.on('relocated', (location) => onLocationChanged(location));
    rendition.on('displayed', () => setTimeout(() => ensureFocus(), 100));

    await book.ready;

    // 封面提取（fire-and-forget）
    (async () => {
      try {
        const coverUrl = await book.coverUrl();
        if (coverUrl) {
          const blob = await (await fetch(coverUrl)).blob();
          await EpubStorage.saveCover(currentBookId, blob);
        }
      } catch (e) { console.warn('Failed to extract cover:', e); }
    })();

    const metadata   = await book.loaded.metadata;
    bookTitleEl.textContent = metadata.title || currentFileName;
    document.title = (metadata.title || currentFileName) + ' - EPUB Reader';

    const navigation = await book.loaded.navigation;
    TOC.build(navigation, rendition);

    const savedPos = await EpubStorage.getPosition(currentBookId);
    if (savedPos && savedPos.percentage !== undefined) {
      const initialPercent = Math.round(savedPos.percentage * 10) / 10;
      progressSlider.value = initialPercent;
      progressCurrent.textContent = initialPercent.toFixed(1) + '%';
    }

    if (savedPos && savedPos.cfi) await rendition.display(savedPos.cfi);
    else await rendition.display();

    await EpubStorage.addRecentBook({
      id: currentBookId, title: metadata.title || '',
      author: metadata.creator || '', filename: currentFileName
    });

    Bookmarks.setBook(currentBookId, book, rendition);
    Search.setBook(book, rendition);
    showLoading(false);
    isBookLoaded = true;
    Highlights.setBookDetails(currentBookId, currentFileName, rendition);
    setTimeout(() => ensureFocus(), 300);

    // 速度追踪：等 locations 就绪后初始化 session 起点
    const initSpeedTracking = (progress) => {
      _sessionStart = { progress, timestamp: Date.now() };
      _lastProgress = progress;
    };

    const cachedLocsJSON = await EpubStorage.getLocations(currentBookId);
    if (cachedLocsJSON) {
      book.locations.load(cachedLocsJSON);
      const loc = rendition.currentLocation();
      if (loc && loc.start) {
        const p = book.locations.percentageFromCfi(loc.start.cfi);
        initSpeedTracking(p);
        onLocationChanged(loc);
      }
    } else {
      book.locations.generate(1600).then(async () => {
        const locsJSON = book.locations.save();
        await EpubStorage.saveLocations(currentBookId, locsJSON);
        const loc = rendition.currentLocation();
        if (loc && loc.start) {
          const p = book.locations.percentageFromCfi(loc.start.cfi);
          initSpeedTracking(p);
          onLocationChanged(loc);
        }
      });
    }
  }

  function setupRenditionKeyEvents(rend) {
    rend.hooks.content.register((contents) => {
      const doc = contents.document;
      doc.addEventListener('keydown', (e) => handleKeyNav(e));
      doc.addEventListener('click', (e) => {
        if (!e.target.closest('a')) {
          if (document.querySelector('.settings-panel.open, .bookmarks-panel.open, .sidebar.open')) {
            closeAllPanels();
          }
        }
      });
      doc.addEventListener('wheel', (e) => {
        if (!isBookLoaded || !rendition) return;
        if (currentPrefs.layout === 'scrolled') return;
        e.preventDefault();
        if (e.deltaY > 0 || e.deltaX > 0) navNext();
        else if (e.deltaY < 0 || e.deltaX < 0) navPrev();
      }, { passive: false });
    });
  }

  // --- Location / Progress ---

  /**
   * 300ms 尾部防抖 — 翻页不直写 storage。
   * visibilitychange 时通过 flushPositionSave() 立即写入。
   */
  function schedulePositionSave(bookId, cfi, percent) {
    clearTimeout(_posTimer);
    _posTimer = setTimeout(() => {
      EpubStorage.savePosition(bookId, cfi, percent);
    }, 300);
  }

  function flushPositionSave() {
    clearTimeout(_posTimer);
    if (currentBookId && currentStableCfi) {
      EpubStorage.savePosition(currentBookId, currentStableCfi, _lastPercent);
    }
  }

  /**
   * 结束当前 speed session，将有效样本累加到 _cachedSpeed 并写入 storage。
   *
   * v1.8.0 BUG-02-A：直接操作 _cachedSpeed 内存变量，写入 storage 后无需再读。
   *   原实现通过 getReadingSpeed() 从 storage 读取再写入，
   *   且 refreshCachedSpeed() 的调用路径从未被挂接，_cachedSpeed 始终为旧值。
   *
   * 有效 session 条件：
   *   - deltaProgress ∈ (0.001, 0.30)：读了 0.1%–30%（滤除无效和跳跃）
   *   - deltaSeconds  > 30             ：超过 30 秒（滤除快速测试）
   *
   * @param {number|null} newStartProgress  null = session 结束；数字 = 跳跃后重设起点
   */
  async function flushSpeedSession(newStartProgress = null) {
    if (!_sessionStart || !currentBookId || !isBookLoaded) return;

    const deltaProgress = _lastProgress - _sessionStart.progress;
    const deltaSeconds  = (Date.now() - _sessionStart.timestamp) / 1000;

    if (deltaProgress > 0.001 && deltaProgress < 0.30 && deltaSeconds > 30) {
      try {
        // v1.8.0: 直接累加内存缓存，不从 storage 读取
        if (!_cachedSpeed) _cachedSpeed = { sampledSeconds: 0, sampledProgress: 0 };
        _cachedSpeed = {
          sampledSeconds:  _cachedSpeed.sampledSeconds  + deltaSeconds,
          sampledProgress: _cachedSpeed.sampledProgress + deltaProgress
        };
        await EpubStorage.saveReadingSpeed(currentBookId, _cachedSpeed);
      } catch (e) {
        console.warn('[Speed] Failed to save speed sample:', e);
      }
    }

    _sessionStart = (newStartProgress !== null)
      ? { progress: newStartProgress, timestamp: Date.now() }
      : null;
  }

  function onLocationChanged(location) {
    if (isResizing) return;
    if (!location || !location.start) return;

    let percent = null;
    if (book.locations && book.locations.length()) {
      const progress = book.locations.percentageFromCfi(location.start.cfi);
      percent = Math.round(progress * 1000) / 10;
      progressSlider.value = percent;
      progressCurrent.textContent = percent.toFixed(1) + '%';

      // 跳跃检测：单次进度变化超过 5% 视为手动跳转（TOC / 进度条拖动）
      if (_sessionStart && Math.abs(progress - _lastProgress) > 0.05) {
        flushSpeedSession(progress); // async, non-blocking
      }
      _lastProgress = progress;
      _lastPercent  = percent;
    }

    updateReadingStats();

    const currentSection = location.start.href;
    if (currentSection) {
      const tocItem = findTocItem(book.navigation.toc, currentSection);
      chapterTitleEl.textContent = tocItem ? tocItem.label.trim() : '';
      TOC.setActive(currentSection);
    }

    currentStableCfi = location.start.cfi;
    schedulePositionSave(currentBookId, currentStableCfi, percent);

    updateBookmarkButtonState();
  }

  // --- Reading Stats ---
  function startReadingTimer() {
    if (readingTimer) clearInterval(readingTimer);
    readingTimer = setInterval(() => {
      if (!document.hidden && currentBookId && isBookLoaded) {
        activeReadingSeconds++;
        if (activeReadingSeconds % 10 === 0) {
          EpubStorage.saveReadingTime(currentBookId, activeReadingSeconds);
        }
        if (activeReadingSeconds % 60 === 0) updateReadingStats();
      }
    }, 1000);
  }

  // visibilitychange：立即 flush 位置 + 时间 + speed session
  // v1.8.0 BUG-02-B：页面重新可见时重置 session 起点，排除挂机时间
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (currentBookId && isBookLoaded) {
        flushPositionSave();
        EpubStorage.saveReadingTime(currentBookId, activeReadingSeconds);
        flushSpeedSession(null); // session 结束，不续期
      }
    } else {
      // 页面重新激活：以当前位置为新 session 起点，排除挂机时间段
      if (isBookLoaded && _lastProgress > 0) {
        _sessionStart = { progress: _lastProgress, timestamp: Date.now() };
      }
    }
  });

  /**
   * 更新底部阅读统计栏。
   *
   * v1.8.0 ETA 算法（在 v1.7.0 基础上修复三处缺陷）：
   *
   *   优先：历史累积速度 _cachedSpeed（跨 session，不受起点影响）
   *     - 要求 sampledProgress > 0.01（累计读了 > 1%）
   *     - 要求 sampledSeconds  > 120  （累计读了 > 2 分钟）
   *     - v1.8.0 fix：_cachedSpeed 在 flushSpeedSession 后立即同步，不再滞后
   *
   *   次选：当前 session 实时速度
   *     - v1.8.0 fix：阈值从 (>60s, >0.5%) 降至 (>30s, >0.3%)，更快给出估算
   *     - v1.8.0 fix：_sessionStart 在 visibilitychange visible 时重置，不含挂机时间
   *
   *   Fallback：静态估算（每 location ≈ 150 字，400 字/分钟）
   */
  function updateReadingStats() {
    if (!progressTime || !rendition || !book) return;

    const readStr = Utils.formatDuration(activeReadingSeconds);

    let remainingStr = '--';
    if (book.locations && book.locations.length()) {
      const currentLoc = rendition.currentLocation();
      let progress = 0;
      if (currentLoc && currentLoc.start) {
        progress = book.locations.percentageFromCfi(currentLoc.start.cfi);
      }

      if (progress >= 0 && progress <= 1) {
        const remainingProgress = 1 - progress;
        let remainingMinutes = null;

        // 优先：历史累积速度
        if (_cachedSpeed &&
            _cachedSpeed.sampledProgress > 0.01 &&
            _cachedSpeed.sampledSeconds > 120) {
          const secsPerUnit = _cachedSpeed.sampledSeconds / _cachedSpeed.sampledProgress;
          remainingMinutes = Math.round(secsPerUnit * remainingProgress / 60);
        }

        // 次选：当前 session 实时速度（v1.8.0: 阈值降至 30s + 0.3%）
        if (remainingMinutes === null && _sessionStart) {
          const sessionDeltaProgress = _lastProgress - _sessionStart.progress;
          const sessionDeltaSeconds  = (Date.now() - _sessionStart.timestamp) / 1000;
          if (sessionDeltaProgress > 0.003 && sessionDeltaSeconds > 30) {
            const secsPerUnit = sessionDeltaSeconds / sessionDeltaProgress;
            remainingMinutes = Math.round(secsPerUnit * remainingProgress / 60);
          }
        }

        // Fallback：静态估算（每 location ≈ 150 字，400 字/分钟）
        if (remainingMinutes === null) {
          const totalLocations  = book.locations.length();
          const charsTotal      = totalLocations * 150;
          const estTotalMinutes = charsTotal / 400;
          remainingMinutes = Math.max(0, Math.round(estTotalMinutes * remainingProgress));
        }

        remainingStr = Utils.formatMinutes(Math.max(0, remainingMinutes));
      }
    }

    progressTime.textContent = `阅读时长: ${readStr} | 预计剩余: ${remainingStr}`;
  }

  function findTocItem(items, href) {
    for (const item of items) {
      if (href.includes(item.href.split('#')[0])) return item;
      if (item.subitems && item.subitems.length > 0) {
        const found = findTocItem(item.subitems, href);
        if (found) return found;
      }
    }
    return null;
  }

  // --- Bookmarks ---
  async function toggleBookmarkAtCurrent() {
    if (!rendition || !isBookLoaded) return;
    const location = rendition.currentLocation();
    if (!location || !location.start) return;
    const cfi = location.start.cfi;
    const currentSection = location.start.href;
    const tocItem = findTocItem(book.navigation.toc, currentSection);
    const chapterName = tocItem ? tocItem.label.trim() : '';
    const progress = (book.locations && book.locations.length())
      ? book.locations.percentageFromCfi(cfi) : 0;
    await Bookmarks.toggle(cfi, chapterName, progress);
    updateBookmarkButtonState();
  }

  async function updateBookmarkButtonState() {
    const btn = document.getElementById('btn-bookmark');
    if (!rendition || !isBookLoaded) return;
    const location = rendition.currentLocation();
    if (!location || !location.start) return;
    const isBookmarked = await Bookmarks.isBookmarked(location.start.cfi);
    btn.classList.toggle('active', isBookmarked);
    btn.title = isBookmarked ? '移除书签 (B)' : '添加书签 (B)';
  }

  // --- Settings ---
  function toggleSettings() { settingsPanel.classList.toggle('open'); }
  function closeSettings()  { settingsPanel.classList.remove('open'); }

  async function loadPreferences() {
    const prefs = await EpubStorage.getPreferences();
    currentPrefs.theme      = prefs.theme      || 'light';
    currentPrefs.customBg   = prefs.customBg   || '#ffffff';
    currentPrefs.customText = prefs.customText || '#333333';
    if (customBgColor)   customBgColor.value   = currentPrefs.customBg;
    if (customTextColor) customTextColor.value = currentPrefs.customText;
    setTheme(currentPrefs.theme, false);
    fontSizeSlider.value  = prefs.fontSize || 18;
    fontSizeValue.textContent = (prefs.fontSize || 18) + 'px';
    const lhVal = prefs.lineHeight || 1.8;
    lineHeightSlider.value    = Math.round(lhVal * 10);
    lineHeightValue.textContent = lhVal.toFixed(1);
    fontFamilySelect.value = prefs.fontFamily || '';
    const layout = prefs.layout || 'paginated';
    document.querySelectorAll('.layout-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.layout === layout);
    });
  }

  function setTheme(theme, save = true) {
    document.documentElement.setAttribute('data-theme', theme);
    currentPrefs.theme = theme;
    document.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
    if (customThemeOptions) {
      customThemeOptions.classList.toggle('is-visible', theme === 'custom');
    }
    if (rendition) applyThemeToRendition(theme);
    if (save) EpubStorage.savePreferences({ theme });
  }

  function applyThemeToRendition(theme) {
    if (!rendition) return;
    const t = getActiveThemeColors(theme);
    rendition.themes.override('color', t.color);
    rendition.themes.override('background', t.bg);
    updateCustomStyles();
  }

  function getActiveThemeColors(theme) {
    const themes = {
      light:  { bg: '#ffffff',  color: '#2d2d2d' },
      dark:   { bg: '#1a1a1a',  color: '#d4d0c8' },
      sepia:  { bg: '#f8f0dc',  color: '#3e2f1c' },
      green:  { bg: '#c7e6c1',  color: '#2b3a2b' },
      custom: { bg: currentPrefs.customBg || '#ffffff', color: currentPrefs.customText || '#333333' }
    };
    return ensureReadableTheme(themes[theme] || themes.light);
  }

  function ensureReadableTheme(themeObj) {
    if (!themeObj || !themeObj.bg || !themeObj.color) return themeObj;
    const bg = normalizeHexColor(themeObj.bg);
    const fg = normalizeHexColor(themeObj.color);
    if (!bg || !fg) return themeObj;
    // 修复：若用户将自定义文字色与背景色设得过于接近，会出现“整页发白/看不见文字”
    // 自动回退为与背景对比更高的颜色，避免阅读区看似白屏。
    const contrast = contrastRatio(bg, fg);
    if (contrast >= 2.5) return themeObj;
    const fallback = luminance(bg) > 0.5 ? '#1f2937' : '#f3f4f6';
    return { ...themeObj, color: fallback };
  }

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
    const [r, g, b] = [1, 3, 5].map((idx) => parseInt(hexColor.slice(idx, idx + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(a, b) {
    const l1 = luminance(a);
    const l2 = luminance(b);
    const [bright, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (bright + 0.05) / (dark + 0.05);
  }

  function setLayout(layout) {
    currentPrefs.layout = layout;
    document.querySelectorAll('.layout-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.layout === layout);
    });
    EpubStorage.savePreferences({ layout });

    if (book && isBookLoaded) {
      const loc = rendition.currentLocation();
      const currentCfi = loc && loc.start ? loc.start.cfi : null;
      rendition.destroy();
      rendition = book.renderTo('epub-viewer', {
        width: '100%', height: '100%', spread: 'auto',
        flow:    layout === 'scrolled' ? 'scrolled-doc' : 'paginated',
        manager: layout === 'scrolled' ? 'continuous'   : 'default',
        allowScriptedContent: false,
        gap: layout === 'scrolled' ? 48 : 80
      });
      EpubStorage.getPreferences().then((prefs) => {
        rendition.hooks.content.register((contents) => injectCustomStyleElement(contents));
        rendition.themes.default({
          'body': { 'color': 'var(--reader-text, #2d2d2d)', 'text-align': 'justify',
            '-webkit-font-smoothing': 'antialiased', '-moz-osx-font-smoothing': 'grayscale' },
          'p': { 'margin-bottom': '0.5em',
            'text-indent': prefs.paragraphIndent !== false ? '2em' : '0', 'text-align': 'justify' },
          'img':   { 'max-width': '100% !important', 'height': 'auto !important' }
        });
        applyThemeToRendition(prefs.theme || 'light');
        ImageViewer.hookRendition(rendition);
        Annotations.hookRendition(rendition);
        setupRenditionKeyEvents(rendition);
        rendition.on('relocated', (location) => onLocationChanged(location));
        rendition.on('displayed', () => setTimeout(() => ensureFocus(), 100));
        TOC.build(book.navigation, rendition);
        Bookmarks.setBook(currentBookId, book, rendition);
        Search.setBook(book, rendition);
        Highlights.setBookDetails(currentBookId, currentFileName, rendition);
        if (currentCfi) rendition.display(currentCfi); else rendition.display();
      });
    }
  }

  // applyFontSize / applyLineHeight / applyFontFamily 由 setupEventListeners
  // 中的 _withCfiLock 包裹调用，此处只保留裸操作函数供内部使用
  function applyFontSize(size)  { currentPrefs.fontSize = size;   updateCustomStyles(); }
  function applyLineHeight(val) { currentPrefs.lineHeight = val;  updateCustomStyles(); }
  function applyFontFamily(fam) { currentPrefs.fontFamily = fam;  updateCustomStyles(); }

  function showLoading(show) {
    loadingOverlay.classList.toggle('is-hidden', !show);
  }

})();
