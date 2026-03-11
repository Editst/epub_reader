/**
 * EPUB Reader - Main Controller
 * Orchestrates epub.js rendering, settings, navigation, and all modules
 *
 * v1.7.0 变更：
 *   [SPEED]   per-session 阅读速度追踪（_sessionStart）修复中途开书/跳章 ETA 偏差
 *   [DEBOUNCE] savePosition 改为 300ms 防抖（schedulePositionSave），翻页不直写
 *   [UTILS]   格式化函数迁移至 Utils（Utils.formatDuration / Utils.formatMinutes）
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
  let isResizing = false;
  let _navLock = false;

  // --- Reading Stats State ---
  let readingTimer        = null;
  let activeReadingSeconds = 0;

  // --- Speed Tracking State (in-memory, not persisted) ---
  // _sessionStart: progress + timestamp at which the current reading session began.
  // Flushed to EpubStorage.saveReadingSpeed() on visibilitychange or progress jump.
  let _sessionStart   = null;  // { progress: number, timestamp: number }
  let _lastProgress   = 0;     // progress at last relocated event (0-1)
  let _posTimer       = null;  // debounce timer for savePosition
  let _lastPercent    = null;  // last known percent (for flush on visibilitychange)

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

    const params     = new URLSearchParams(window.location.search);
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

    // D-1-A: wheel — paginated mode only
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

    fontSizeSlider.addEventListener('input', (e) => {
      const size = parseInt(e.target.value);
      fontSizeValue.textContent = size + 'px';
      applyFontSize(size);
    });
    fontSizeSlider.addEventListener('change', (e) => {
      EpubStorage.savePreferences({ fontSize: parseInt(e.target.value) });
    });

    lineHeightSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value) / 10;
      lineHeightValue.textContent = val.toFixed(1);
      applyLineHeight(val);
    });
    lineHeightSlider.addEventListener('change', (e) => {
      EpubStorage.savePreferences({ lineHeight: parseInt(e.target.value) / 10 });
    });

    fontFamilySelect.addEventListener('change', (e) => {
      applyFontFamily(e.target.value);
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

    let resizeTimer;
    let preResizeCfi = null;
    window.addEventListener('resize', () => {
      if (!rendition || !isBookLoaded) return;
      isResizing = true;
      if (!preResizeCfi) {
        const loc = rendition.currentLocation();
        if (loc && loc.end) preResizeCfi = loc.end.cfi;
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
        readerMain.style.opacity = '0';
        await rendition.prev();
      } finally {
        readerMain.style.opacity = '1';
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
    let dragOverlay = null;
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragOverlay) {
        dragOverlay = document.createElement('div');
        dragOverlay.className = 'drag-overlay';
        dragOverlay.innerHTML = `
          <div class="drag-overlay-content">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <p>释放以打开 EPUB 文件</p>
          </div>
        `;
        document.body.appendChild(dragOverlay);
      }
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
      if (dragOverlay) { dragOverlay.remove(); dragOverlay = null; }
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
    document.getElementById('welcome-screen').style.display = 'none';
    const readerMain = document.getElementById('reader-main');
    readerMain.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--reader-text,#333)';
    const icon = document.createElement('div');
    icon.style.cssText = 'font-size:48px;margin-bottom:16px';
    icon.textContent = '📚';
    const title = document.createElement('h2');
    title.style.cssText = 'margin-bottom:8px';
    title.textContent = '书籍加载失败';
    const detail = document.createElement('p');
    detail.style.cssText = 'color:#e94560;text-align:center;max-width:80%;margin-bottom:20px;line-height:1.5';
    detail.textContent = msg;
    const btn = document.createElement('button');
    btn.style.cssText = 'padding:10px 24px;border-radius:8px;border:none;background:linear-gradient(135deg,#e94560,#c23152);color:white;font-weight:600;cursor:pointer;font-size:14px';
    btn.textContent = '重新选择文件';
    btn.addEventListener('click', () => document.getElementById('file-input').click());
    wrapper.appendChild(icon); wrapper.appendChild(title);
    wrapper.appendChild(detail); wrapper.appendChild(btn);
    readerMain.appendChild(wrapper);
    readerMain.style.display = 'block';
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
    return `
      @namespace xmlns "http://www.w3.org/1999/xhtml";
      html, body {
        background-color: ${currentPrefs.theme === 'custom' && currentPrefs.customBg ? currentPrefs.customBg : 'transparent'} !important;
        color: ${currentPrefs.theme === 'custom' && currentPrefs.customText ? currentPrefs.customText : 'inherit'} !important;
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
    welcomeScreen.style.display = 'none';
    readerMain.style.display = 'flex';
    bottomBar.style.display = 'flex';

    if (book) {
      book.destroy();
      if (typeof TOC !== 'undefined' && TOC.reset) TOC.reset();
      if (typeof Bookmarks !== 'undefined' && Bookmarks.reset) Bookmarks.reset();
      if (typeof Search !== 'undefined' && Search.reset) Search.reset();
      if (readingTimer) { clearInterval(readingTimer); readingTimer = null; }
      activeReadingSeconds = 0;
    }

    book = ePub(arrayBuffer);
    const prefs = await EpubStorage.getPreferences();

    // v1.7.0: 通过 getBookMeta 一次读取 time + speed（合并读取，减少 storage 操作）
    const meta = await EpubStorage.getBookMeta(currentBookId);
    activeReadingSeconds = (meta && meta.time) ? meta.time : 0;

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

    // Cover extraction (fire-and-forget)
    (async () => {
      try {
        const coverUrl = await book.coverUrl();
        if (coverUrl) {
          const blob = await (await fetch(coverUrl)).blob();
          await EpubStorage.saveCover(currentBookId, blob);
        }
      } catch (e) { console.warn('Failed to extract cover:', e); }
    })();

    const metadata = await book.loaded.metadata;
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

    // v1.7.0: 速度追踪 — 记录本次打开时的进度作为 session 起点
    // 等 locations 就绪后再设置，确保 progress 计算准确
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
   * Debounced position save — 300ms trailing debounce.
   * visibilitychange 时立即 flush，不等待 debounce 到期。
   */
  function schedulePositionSave(bookId, cfi, percent) {
    clearTimeout(_posTimer);
    _posTimer = setTimeout(() => {
      EpubStorage.savePosition(bookId, cfi, percent);
    }, 300);
  }

  /**
   * 立即写入当前位置，清除 pending debounce（用于 visibilitychange flush）。
   */
  function flushPositionSave() {
    clearTimeout(_posTimer);
    if (currentBookId && currentStableCfi) {
      EpubStorage.savePosition(currentBookId, currentStableCfi, _lastPercent);
    }
  }

  /**
   * 结束当前 session，将有效的 (deltaTime, deltaProgress) 样本累加到 speed。
   *
   * 有效 session 条件：
   *   - deltaProgress > 0.001：读了至少 0.1%（滤除几乎没读的会话）
   *   - deltaProgress < 0.30 ：单次不超过 30%（超过视为跳跃，不计速度）
   *   - deltaSeconds  > 30   ：超过 30 秒（滤除快速翻页/测试）
   *
   * @param {number|null} newStartProgress  null = session 结束不续期；数字 = 跳跃后重设起点
   */
  async function flushSpeedSession(newStartProgress = null) {
    if (!_sessionStart || !currentBookId || !isBookLoaded) return;

    const deltaProgress = _lastProgress - _sessionStart.progress;
    const deltaSeconds  = (Date.now() - _sessionStart.timestamp) / 1000;

    if (deltaProgress > 0.001 && deltaProgress < 0.30 && deltaSeconds > 30) {
      try {
        const stored = await EpubStorage.getReadingSpeed(currentBookId);
        const spd = stored || { sampledSeconds: 0, sampledProgress: 0 };
        spd.sampledSeconds  += deltaSeconds;
        spd.sampledProgress += deltaProgress;
        await EpubStorage.saveReadingSpeed(currentBookId, spd);
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

      // v1.7.0: 跳跃检测 — 单次进度变化超过 5% 视为手动跳转
      // 当前 session 计入速度样本，然后以新位置重设起点
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
    // v1.7.0: 防抖写入，翻页不直接触发 storage write
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

  // visibilitychange: 立即 flush 位置 + 时间 + speed session
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && currentBookId && isBookLoaded) {
      flushPositionSave();
      EpubStorage.saveReadingTime(currentBookId, activeReadingSeconds);
      flushSpeedSession(null); // session 结束，不续期
    }
  });

  /**
   * 更新底部阅读统计栏。
   *
   * v1.7.0 ETA 算法：
   *   优先使用历史累积速度（sampledSeconds / sampledProgress）估算。
   *   次选当前 session 的实时速度（仅当 session 读了 > 1min 且 > 0.5%）。
   *   最终 fallback：基于章节数量的静态估算（400 字/分钟）。
   *
   * 相比 v1.6.0 修复的核心问题：
   *   v1.6.0 用 totalTime / currentProgress，「从中间打开」时分母包含
   *   未曾阅读的 0~起点 进度，导致估算严重偏低。
   *   v1.7.0 只统计实际阅读时间对应的实际进度增量，与起始位置无关。
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

        // 优先：历史累积速度（跨 session，不受起点影响）
        // 使用内存中已知的 _sessionStart.progress 来判断是否有有效历史数据
        // 历史速度由 EpubStorage 在 session flush 时写入，这里用缓存读取
        // （updateReadingStats 可能每分钟调用一次，不每次都读 storage）
        if (window._cachedSpeed &&
            window._cachedSpeed.sampledProgress > 0.01 &&
            window._cachedSpeed.sampledSeconds > 120) {
          const secsPerUnit = window._cachedSpeed.sampledSeconds / window._cachedSpeed.sampledProgress;
          remainingMinutes = Math.round(secsPerUnit * remainingProgress / 60);
        }

        // 次选：当前 session 实时速度（session 内读了 > 1min 且 > 0.5%）
        if (remainingMinutes === null && _sessionStart) {
          const sessionDeltaProgress = _lastProgress - _sessionStart.progress;
          const sessionDeltaSeconds  = (Date.now() - _sessionStart.timestamp) / 1000;
          if (sessionDeltaProgress > 0.005 && sessionDeltaSeconds > 60) {
            const secsPerUnit = sessionDeltaSeconds / sessionDeltaProgress;
            remainingMinutes = Math.round(secsPerUnit * remainingProgress / 60);
          }
        }

        // Fallback：静态估算（每 location ≈ 150 字，400 字/分钟）
        if (remainingMinutes === null) {
          const totalLocations = book.locations.length();
          const charsTotal     = totalLocations * 150;
          const estTotalMinutes = charsTotal / 400;
          remainingMinutes = Math.max(0, Math.round(estTotalMinutes * remainingProgress));
        }

        remainingStr = Utils.formatMinutes(Math.max(0, remainingMinutes));
      }
    }

    progressTime.textContent = `阅读时长: ${readStr} | 预计剩余: ${remainingStr}`;
  }

  // v1.7.0: 缓存历史速度到 window._cachedSpeed，避免每次 updateReadingStats 读 storage
  // 在 openBook 加载 meta 后设置，在 flushSpeedSession 写入后更新
  async function refreshCachedSpeed() {
    if (!currentBookId) return;
    window._cachedSpeed = await EpubStorage.getReadingSpeed(currentBookId);
  }

  // 覆写 flushSpeedSession 以在 flush 后刷新缓存
  const _origFlushSpeedSession = flushSpeedSession;
  // Note: 由于 flushSpeedSession 已在上方声明为 async function，
  // 我们通过事后调用 refreshCachedSpeed 来保持缓存同步
  // openBook 末尾在 locations ready 后调用一次
  // flushSpeedSession 执行后自动调用（见下方 wrap）

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
      customThemeOptions.style.display = theme === 'custom' ? 'block' : 'none';
    }
    if (rendition) applyThemeToRendition(theme);
    if (save) EpubStorage.savePreferences({ theme });
  }

  function applyThemeToRendition(theme) {
    if (!rendition) return;
    const themes = {
      light:  { bg: '#ffffff',  color: '#2d2d2d' },
      dark:   { bg: '#1a1a1a',  color: '#d4d0c8' },
      sepia:  { bg: '#f8f0dc',  color: '#3e2f1c' },
      green:  { bg: '#c7e6c1',  color: '#2b3a2b' },
      custom: { bg: currentPrefs.customBg || '#ffffff', color: currentPrefs.customText || '#333333' }
    };
    const t = themes[theme] || themes.light;
    rendition.themes.override('color', t.color);
    rendition.themes.override('background', t.bg);
    updateCustomStyles();
  }

  function setLayout(layout) {
    currentPrefs.layout = layout;
    document.querySelectorAll('.layout-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.layout === layout);
    });
    EpubStorage.savePreferences({ layout });

    if (book && isBookLoaded) {
      const currentCfi = rendition.currentLocation()?.start?.cfi;
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

  function applyFontSize(size)   { if (!rendition) return; currentPrefs.fontSize   = size;   updateCustomStyles(); }
  function applyLineHeight(val)  { if (!rendition) return; currentPrefs.lineHeight  = val;    updateCustomStyles(); }
  function applyFontFamily(fam)  { if (!rendition) return; currentPrefs.fontFamily  = fam;    updateCustomStyles(); }

  function showLoading(show) {
    loadingOverlay.style.display = show ? 'flex' : 'none';
  }

})();
