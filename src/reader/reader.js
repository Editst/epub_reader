/**
 * EPUB Reader - Main Controller
 * Orchestrates epub.js rendering, settings, navigation, and all modules
 */
(function () {
  'use strict';

  // --- State ---
  let book = null;
  let rendition = null;
  let currentBookId = '';
  let currentFileName = '';
  let isBookLoaded = false;
  let currentStableCfi = null; // Reliable position anchor for resize/reflows
  let isResizing = false; // Flag to ignore corrupted 'relocated' events during reflow
  let _navLock = false; // Debounce lock to prevent double page-turn

  // --- Reading Stats State ---
  let readingTimer = null;
  let activeReadingSeconds = 0;

  // --- DOM Elements ---
  const welcomeScreen = document.getElementById('welcome-screen');
  const loadingOverlay = document.getElementById('loading-overlay');
  const readerMain = document.getElementById('reader-main');
  const bottomBar = document.getElementById('bottom-bar');
  const toolbar = document.getElementById('toolbar');
  const fileInput = document.getElementById('file-input');

  const bookTitleEl = document.getElementById('book-title');
  const chapterTitleEl = document.getElementById('chapter-title');
  const progressSlider = document.getElementById('progress-slider');
  const progressCurrent = document.getElementById('progress-current');
  const progressLocation = document.getElementById('progress-location');
  const progressTime = document.getElementById('progress-time');

  const fontSizeSlider = document.getElementById('font-size-slider');
  const fontSizeValue = document.getElementById('font-size-value');
  const lineHeightSlider = document.getElementById('line-height-slider');
  const lineHeightValue = document.getElementById('line-height-value');
  const fontFamilySelect = document.getElementById('font-family-select');
  const settingsPanel = document.getElementById('settings-panel');

  const customThemeOptions = document.getElementById('custom-theme-options');
  const customBgColor = document.getElementById('custom-bg-color');
  const customTextColor = document.getElementById('custom-text-color');

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

    // Check if opened with a file parameter
    const params = new URLSearchParams(window.location.search);
    const fileName = params.get('file');
    const targetCfi = params.get('target');
    if (fileName) {
      await loadFileFromIndexedDB(fileName);
      if (targetCfi && rendition) {
        // Navigate directly to the requested annotation
        rendition.display(targetCfi);
      }
    }
  });

  // --- Event Listeners ---
  function setupEventListeners() {
    // File open buttons
    document.getElementById('welcome-open-btn').addEventListener('click', () => fileInput.click());
    document.getElementById('btn-open').addEventListener('click', () => fileInput.click());
    document.getElementById('btn-home').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) loadEpubFile(file);
    });

    // Navigation
    document.getElementById('btn-prev').addEventListener('click', () => {
      navPrev();
    });
    document.getElementById('btn-next').addEventListener('click', () => {
      navNext();
    });

    // Keyboard navigation - only on document (iframe events handled separately)
    document.addEventListener('keydown', handleKeyNav);

    // Mouse wheel for page turning in paginated mode
    document.getElementById('reader-main').addEventListener('wheel', (e) => {
      if (!isBookLoaded || !rendition) return;
      e.preventDefault();
      if (e.deltaY > 0 || e.deltaX > 0) {
        navNext();
      } else if (e.deltaY < 0 || e.deltaX < 0) {
        navPrev();
      }
    }, { passive: false });

    // Settings panel
    document.getElementById('btn-settings').addEventListener('click', () => toggleSettings());
    document.getElementById('btn-settings-close').addEventListener('click', () => closeSettings());

    // Bookmark button
    document.getElementById('btn-bookmark').addEventListener('click', () => toggleBookmarkAtCurrent());

    // Theme buttons
    document.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        setTheme(theme);
      });
    });

    // Custom Theme Color Pickers
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

    // Layout buttons
    document.querySelectorAll('.layout-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const layout = btn.dataset.layout;
        setLayout(layout);
      });
    });

    // Font size slider
    fontSizeSlider.addEventListener('input', (e) => {
      const size = parseInt(e.target.value);
      fontSizeValue.textContent = size + 'px';
      applyFontSize(size);
    });
    fontSizeSlider.addEventListener('change', (e) => {
      EpubStorage.savePreferences({ fontSize: parseInt(e.target.value) });
    });

    // Line height slider
    lineHeightSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value) / 10;
      lineHeightValue.textContent = val.toFixed(1);
      applyLineHeight(val);
    });
    lineHeightSlider.addEventListener('change', (e) => {
      EpubStorage.savePreferences({ lineHeight: parseInt(e.target.value) / 10 });
    });

    // Font family select
    fontFamilySelect.addEventListener('change', (e) => {
      applyFontFamily(e.target.value);
      EpubStorage.savePreferences({ fontFamily: e.target.value });
    });

    // Progress slider
    progressSlider.addEventListener('input', (e) => {
      if (!rendition || !book) return;
      const value = parseFloat(e.target.value) / 100;
      const cfi = book.locations.cfiFromPercentage(value);
      rendition.display(cfi);
    });

    // Click on reader area to ensure focus
    document.getElementById('reader-main').addEventListener('click', () => {
      ensureFocus();
    });

    // Handle window resize cleanly with debounce
    let resizeTimer;
    let preResizeCfi = null;
    window.addEventListener('resize', () => {
      if (!rendition || !isBookLoaded) return;
      isResizing = true; // Block corrupted intermediate CFIs
      
      // The epub.js backward-drift bug is caused by start.cfi pointing to spanning elements.
      // By using end.cfi, we guarantee the bounding box anchors to the current page.
      if (!preResizeCfi) {
        const loc = rendition.currentLocation();
        if (loc && loc.end) {
          preResizeCfi = loc.end.cfi;
        }
      }

      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(async () => {
        const targetCfi = preResizeCfi;
        preResizeCfi = null;
        
        rendition.resize(); 
        
        // Wait 1 frame to ensure DOM layout of the iframe has absorbed the resize
        await new Promise(resolve => requestAnimationFrame(resolve));
        
        if (targetCfi) {
          // Override epub.js's native (and flawed) start.cfi restoration
          await rendition.display(targetCfi);
        }
        
        isResizing = false;
        const newLoc = rendition.currentLocation();
        if (newLoc && newLoc.start) {
          onLocationChanged(newLoc);
        }
      }, 250);
    });

    // Click outside to close panels (Centralized Panel Management)
    document.addEventListener('click', (e) => {
      // Ignore clicks that are inside a panel or on a toolbar button
      const isInsidePanel = e.target.closest('#settings-panel') ||
        e.target.closest('#bookmarks-panel') ||
        e.target.closest('#sidebar') ||
        e.target.closest('#search-panel') ||
        e.target.closest('.toolbar-btn') ||
        e.target.closest('.annotation-popup');

      if (!isInsidePanel) {
        closeAllPanels();
      }
    });
  }

  // --- Centralized Panel Management ---
  function closeAllPanels() {
    closeSettings();
    if (typeof TOC !== 'undefined' && typeof TOC.close === 'function') TOC.close();
    if (typeof Bookmarks !== 'undefined' && typeof Bookmarks.closePanel === 'function') Bookmarks.closePanel();
    if (typeof Search !== 'undefined' && typeof Search.closePanel === 'function') Search.closePanel();
    if (typeof Highlights !== 'undefined' && typeof Highlights.closePanels === 'function') Highlights.closePanels();

    // Explicitly hide overlay
    const overlay = document.getElementById('sidebar-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // Keyboard navigation handler (with debounce to prevent double-fire)
  function handleKeyNav(e) {
    if (!isBookLoaded) return;
    // Ignore when input is focused
    const active = document.activeElement;
    const tag = active ? active.tagName : '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      // Allow ESC to blur inputs
      if (e.key === 'Escape') active.blur();
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeAllPanels();
        break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        e.stopImmediatePropagation();
        navPrev();
        break;
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        e.stopImmediatePropagation();
        navNext();
        break;
      case 'o':
        if (!e.ctrlKey && !e.metaKey) fileInput.click();
        break;
      case 's':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          toggleSettings();
        }
        break;
      case 'b':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          toggleBookmarkAtCurrent();
        }
        break;
      case 'h':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
        }
        break;
    }
  }

  /**
   * Debounced navigation to prevent double page-turns
   * At chapter boundaries, epub.js can trigger extra events; the debounce
   * ensures only one prev/next fires within 150ms.
   */
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

  /**
   * Ensure the reader area has focus so keyboard events work
   * epub.js renders in iframes which can steal focus
   */
  function ensureFocus() {
    // Blur any focused iframe
    if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
      document.activeElement.blur();
    }
    // Focus the main document
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
      if (files.length > 0) {
        const file = files[0];
        if (file.name.toLowerCase().endsWith('.epub')) {
          loadEpubFile(file);
        }
      }
    });

    function removeDragOverlay() {
      if (dragOverlay) {
        dragOverlay.remove();
        dragOverlay = null;
      }
    }
  }

  // --- Load EPUB ---
  async function loadEpubFile(file) {
    try {
      showLoading(true);
      currentFileName = file.name;
      currentBookId = EpubStorage.generateBookId(file.name, file.size);

      const arrayBuffer = await file.arrayBuffer();

      // Store file in IndexedDB asynchronously so it doesn't block loading the book
      storeFileInIndexedDB(file.name, new Uint8Array(arrayBuffer)).catch(e => {
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
    readerMain.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--reader-text, #333);">
        <div style="font-size:48px; margin-bottom:16px;">📚</div>
        <h2 style="margin-bottom:8px;">书籍加载失败</h2>
        <p style="color:#e94560; text-align:center; max-width:80%; margin-bottom:20px; line-height:1.5;">${msg.replace(/</g, '&lt;')}</p>
        <button onclick="document.getElementById('file-input').click()" style="padding:10px 24px; border-radius:8px; border:none; background:linear-gradient(135deg, #e94560, #c23152); color:white; font-weight:600; cursor:pointer; font-size:14px;">重新选择文件</button>
      </div>
    `;
    readerMain.style.display = 'block';
  }

  /**
   * Store file data in IndexedDB for later reopening via recent books.
   */
  function storeFileInIndexedDB(filename, uint8Array) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('EpubReaderDB', 3);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'name' });
        if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('locations')) db.createObjectStore('locations', { keyPath: 'id' });
      };
      request.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) return resolve();
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        store.put({ name: filename, data: uint8Array, timestamp: Date.now() });

        tx.oncomplete = async () => {
          // Trigger centralized LRU
          if (EpubStorage.enforceFileLRU) await EpubStorage.enforceFileLRU(10);
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function loadFileFromIndexedDB(fileName) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('EpubReaderDB', 3);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'name' });
        if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('locations')) db.createObjectStore('locations', { keyPath: 'id' });
      };
      request.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) {
          showLoadError('找不到该书籍的缓存数据。此书可能已被自动清理，请重新选用"打开文件"加载。');
          resolve();
          return;
        }
        const tx = db.transaction('files', 'readonly');
        const store = tx.objectStore('files');
        const getReq = store.get(fileName);
        getReq.onsuccess = async () => {
          if (getReq.result) {
            currentFileName = fileName;
            const data = getReq.result.data;
            currentBookId = EpubStorage.generateBookId(fileName, data.byteLength);
            showLoading(true);
            try {
              await openBook(data.buffer);
            } catch (err) {
              console.error('Failed to load EPUB:', err);
              showLoadError('无法解析该 EPUB 缓存文件: ' + err.message);
            }
          } else {
            showLoadError('由于缓存限制，该书籍已被系统自动清理以节省空间。请通过"打开文件"重新导入该电子书，历史阅读进度将自动恢复。');
          }
          resolve();
        };
        getReq.onerror = () => {
          showLoadError('读取缓存数据失败。请重新导入该电子书。');
          resolve();
        };
      };
      request.onerror = () => {
        showLoadError('访问本地数据库失败。请重新加载。');
        resolve();
      };
    });
  }

  // --- Robust Styling Overrides ---
  let currentPrefs = {
    fontSize: 18,
    lineHeight: 1.8,
    fontFamily: ''
  };

  function generateCustomCss() {
    const fallbackFont = "'Noto Serif SC', 'Source Han Serif CN', 'SimSun', 'STSong', serif";
    const fontFamily = currentPrefs.fontFamily ? `${currentPrefs.fontFamily}, ${fallbackFont}` : fallbackFont;

    // Explicitly target root to let relative sizes inside the EPUB scale naturally.
    return `
      @namespace xmlns "http://www.w3.org/1999/xhtml";
      html, body {
        background-color: ${currentPrefs.theme === 'custom' && currentPrefs.customBg ? currentPrefs.customBg : 'transparent'} !important;
        color: ${currentPrefs.theme === 'custom' && currentPrefs.customText ? currentPrefs.customText : 'inherit'} !important;
        font-size: ${currentPrefs.fontSize}px !important;
        font-family: ${fontFamily} !important;
        line-height: ${currentPrefs.lineHeight} !important;
      }
      p, div, li, h1, h2, h3, h4, h5, h6 {
        font-family: inherit;
        line-height: inherit !important;
        text-align: justify;
      }
      a {
        color: var(--text-accent, #0078D7) !important;
      }
    `;
  }

  function injectCustomStyleElement(contents) {
    if (!contents || !contents.document) return;
    const doc = contents.document;
    let styleEl = doc.getElementById('epub-reader-custom-styles');
    if (!styleEl) {
      // CRITICAL: EPUB sub-documents use XHTML. Regular createElement creates inert, ignored tags.
      styleEl = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
      styleEl.setAttribute('id', 'epub-reader-custom-styles');
      const target = doc.head || doc.documentElement || doc.body;
      if (target) target.appendChild(styleEl);
    }
    styleEl.textContent = generateCustomCss();
  }

  function updateCustomStyles() {
    if (!rendition || !rendition.getContents) return;
    rendition.getContents().forEach(contents => {
      injectCustomStyleElement(contents);
    });
  }

  async function openBook(arrayBuffer) {
    // Show reader UI early so container has dimensions for epub.js to measure
    welcomeScreen.style.display = 'none';
    readerMain.style.display = 'flex';
    bottomBar.style.display = 'flex';

    // Destroy previous book and clean up memory
    if (book) {
      book.destroy();

      // Clean up sidebars to prevent memory leaks across books
      if (typeof TOC !== 'undefined' && TOC.reset) TOC.reset();
      if (typeof Bookmarks !== 'undefined' && Bookmarks.reset) Bookmarks.reset();
      if (typeof Search !== 'undefined' && Search.reset) Search.reset();

      // Stop timer for old book
      if (readingTimer) {
        clearInterval(readingTimer);
        readingTimer = null;
      }
      activeReadingSeconds = 0;
    }

    book = ePub(arrayBuffer);
    const prefs = await EpubStorage.getPreferences();

    // Fetch correctly scoped reading time for the *new* book
    const savedTime = await EpubStorage.getReadingTime(currentBookId);
    activeReadingSeconds = savedTime || 0;

    // Cache preferences for synchronous style injections
    currentPrefs.fontSize = prefs.fontSize || 18;
    currentPrefs.lineHeight = prefs.lineHeight || 1.8;
    currentPrefs.fontFamily = prefs.fontFamily || '';

    startReadingTimer();

    // Create rendition
    rendition = book.renderTo('epub-viewer', {
      width: '100%',
      height: '100%',
      spread: prefs.spread || 'auto',
      flow: prefs.layout === 'scrolled' ? 'scrolled-doc' : 'paginated',
      manager: prefs.layout === 'scrolled' ? 'continuous' : 'default',
      allowScriptedContent: false,
      gap: 80
    });

    // Inject our bulletproof custom styles into every new chapter iframe
    rendition.hooks.content.register((contents) => {
      injectCustomStyleElement(contents);
    });

    // Apply default theme
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
      'img': {
        'max-width': '100% !important',
        'height': 'auto !important'
      },
      'image': {
        'max-width': '100% !important',
        'height': 'auto !important'
      }
    });

    // Apply theme colors to reader content
    applyThemeToRendition(prefs.theme || 'light');

    // Hook modules into rendition
    ImageViewer.hookRendition(rendition);
    Annotations.setBook(book);
    Annotations.hookRendition(rendition);
    setupRenditionKeyEvents(rendition);

    // Track location changes
    rendition.on('relocated', (location) => {
      onLocationChanged(location);
    });

    // When content is displayed, ensure focus returns to main window
    rendition.on('displayed', () => {
      // Delay slightly to let iframe load
      setTimeout(() => ensureFocus(), 100);
    });

    // Wait for book to be ready
    await book.ready;

    // Extract and save cover for Home / Popup (non-blocking, fire-and-forget)
    (async () => {
      try {
        const coverUrl = await book.coverUrl();
        if (coverUrl) {
          const response = await fetch(coverUrl);
          const blob = await response.blob();
          await EpubStorage.saveCover(currentBookId, blob);
        }
      } catch (e) {
        console.warn('Failed to extract cover:', e);
      }
    })();

    // Get metadata
    const metadata = await book.loaded.metadata;
    bookTitleEl.textContent = metadata.title || currentFileName;
    document.title = (metadata.title || currentFileName) + ' - EPUB Reader';

    // Build TOC
    const navigation = await book.loaded.navigation;
    TOC.build(navigation, rendition);

    // Display content FIRST (before locations.generate) for faster perceived loading
    const savedPos = await EpubStorage.getPosition(currentBookId);
    
    // Issue 9: Set initial progress from saved metadata immediately
    if (savedPos && savedPos.percentage !== undefined) {
      const initialPercent = Math.round(savedPos.percentage * 10) / 10;
      progressSlider.value = initialPercent;
      progressCurrent.textContent = initialPercent.toFixed(1) + '%';
    }

    if (savedPos && savedPos.cfi) {
      await rendition.display(savedPos.cfi);
    } else {
      await rendition.display();
    }

    // Save to recent books
    await EpubStorage.addRecentBook({
      id: currentBookId,
      title: metadata.title || '',
      author: metadata.creator || '',
      filename: currentFileName
    });

    // Init bookmarks for this book
    Bookmarks.setBook(currentBookId, book, rendition);

    // Init search for this book
    Search.setBook(book, rendition);

    // Hide loading overlay now that book is visible
    showLoading(false);
    isBookLoaded = true;

    // Init highlights AFTER content is displayed to avoid corrupting epub.js state
    Highlights.setBookDetails(currentBookId, currentFileName, rendition);

    // Ensure focus after everything is loaded
    setTimeout(() => ensureFocus(), 300);

    // v1.2.0 PDCA: Locations Caching architecture to prevent progress & ETA zeroing
    const cachedLocsJSON = await EpubStorage.getLocations(currentBookId);
    
    if (cachedLocsJSON) {
        // Instant load from cache
        book.locations.load(cachedLocsJSON);
        
        // Update progress display instantly
        const loc = rendition.currentLocation();
        if (loc && loc.start) {
            onLocationChanged(loc);
        }
    } else {
        // Generate locations in the background (this is slow for large books)
        book.locations.generate(1600).then(async (locations) => {
            // Save to cache for next time
            const locsJSON = book.locations.save();
            await EpubStorage.saveLocations(currentBookId, locsJSON);
            
            // Update progress display now that locations are ready
            const loc = rendition.currentLocation();
            if (loc && loc.start) {
                onLocationChanged(loc);
            }
        });
    }
  }

  /**
   * Register keyboard events and clicks inside epub.js iframe content
   * This ensures arrow keys work even when the iframe has focus,
   * and clicking the text closes open panels.
   */
  function setupRenditionKeyEvents(rend) {
    rend.hooks.content.register((contents) => {
      const doc = contents.document;
      doc.addEventListener('keydown', (e) => {
        handleKeyNav(e);
      });
      // Handle click to close panels
      doc.addEventListener('click', (e) => {
        if (!e.target.closest('a')) {
          // Check if any panels are open
          const hasOpenPanels = document.querySelector('.settings-panel.open, .bookmarks-panel.open, .sidebar.open');

          if (hasOpenPanels) {
            closeAllPanels();
          }
        }
      });
      // Also handle mouse wheel inside iframe for paginated mode
      doc.addEventListener('wheel', (e) => {
        if (!isBookLoaded || !rendition) return;
        e.preventDefault();
        if (e.deltaY > 0 || e.deltaX > 0) {
          navNext();
        } else if (e.deltaY < 0 || e.deltaX < 0) {
          navPrev();
        }
      }, { passive: false });
    });
  }

  // --- Location / Progress ---
  function onLocationChanged(location) {
    if (isResizing) return; // Ignore garbage locations emitted during reflows
    if (!location || !location.start) return;

    let percent = null;
    // Update progress (only if locations have been generated)
    if (book.locations && book.locations.length()) {
      const progress = book.locations.percentageFromCfi(location.start.cfi);
      percent = Math.round(progress * 1000) / 10;
      progressSlider.value = percent;
      progressCurrent.textContent = percent.toFixed(1) + '%';
    }

    updateReadingStats();

    // Update chapter title
    const currentSection = location.start.href;
    if (currentSection) {
      const tocItem = findTocItem(book.navigation.toc, currentSection);
      chapterTitleEl.textContent = tocItem ? tocItem.label.trim() : '';
      TOC.setActive(currentSection);
    }

    // Save position
    currentStableCfi = location.start.cfi;
    EpubStorage.savePosition(currentBookId, currentStableCfi, percent);

    // Update bookmark button state
    updateBookmarkButtonState();
  }

  // --- Reading Stats Logic ---
  function startReadingTimer() {
    if (readingTimer) clearInterval(readingTimer);

    readingTimer = setInterval(() => {
      // Only increment if document is active (not hidden)
      if (!document.hidden && currentBookId && isBookLoaded) {
        activeReadingSeconds++;
        // Save to storage every 10 seconds
        if (activeReadingSeconds % 10 === 0) {
          EpubStorage.saveReadingTime(currentBookId, activeReadingSeconds);
        }
        // Update UI every minute or continuously
        if (activeReadingSeconds % 60 === 0) {
          updateReadingStats();
        }
      }
    }, 1000);
  }

  function updateReadingStats() {
    if (!progressTime || !rendition || !book) return;

    // Formatting active read time
    const hours = Math.floor(activeReadingSeconds / 3600);
    const minutes = Math.floor((activeReadingSeconds % 3600) / 60);
    const readStr = hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;

    // Estimation logic
    let remainingStr = '--';
    if (book.locations && book.locations.length()) {
      const currentLoc = rendition.currentLocation();
      let progress = 0;
      if (currentLoc && currentLoc.start) {
        progress = book.locations.percentageFromCfi(currentLoc.start.cfi);
      }

      if (progress >= 0 && progress <= 1) {
        const activeMinutes = activeReadingSeconds / 60;
        let remainingMinutes = 0;

        // Use dynamic speed if there is meaningful data points (> 1 min and > 0.5% read)
        if (activeMinutes > 1 && progress > 0.005) {
          const totalMinutesDesc = activeMinutes / progress;
          remainingMinutes = Math.max(0, Math.round(totalMinutesDesc * (1 - progress)));
        } else {
          // Static fallback estimation
          const totalLocations = book.locations.length();
          const charsTotal = totalLocations * 150;
          const estTotalMinutes = charsTotal / 400; // 400 chars per min
          remainingMinutes = Math.max(0, Math.round(estTotalMinutes * (1 - progress)));
        }

        const remHours = Math.floor(remainingMinutes / 60);
        const remMins = remainingMinutes % 60;
        remainingStr = remHours > 0 ? `${remHours}小时${remMins}分钟` : `${remMins}分钟`;
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
    const progress = book.locations.percentageFromCfi(cfi);

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
  function toggleSettings() {
    settingsPanel.classList.toggle('open');
  }

  function closeSettings() {
    settingsPanel.classList.remove('open');
  }

  async function loadPreferences() {
    const prefs = await EpubStorage.getPreferences();

    currentPrefs.theme = prefs.theme || 'light';
    currentPrefs.customBg = prefs.customBg || '#ffffff';
    currentPrefs.customText = prefs.customText || '#333333';

    if (customBgColor) customBgColor.value = currentPrefs.customBg;
    if (customTextColor) customTextColor.value = currentPrefs.customText;

    // Apply theme
    setTheme(currentPrefs.theme, false);

    // Sync UI controls
    fontSizeSlider.value = prefs.fontSize || 18;
    fontSizeValue.textContent = (prefs.fontSize || 18) + 'px';

    const lhVal = prefs.lineHeight || 1.8;
    lineHeightSlider.value = Math.round(lhVal * 10);
    lineHeightValue.textContent = lhVal.toFixed(1);

    fontFamilySelect.value = prefs.fontFamily || '';

    // Layout buttons
    const layout = prefs.layout || 'paginated';
    document.querySelectorAll('.layout-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.layout === layout);
    });
  }

  function setTheme(theme, save = true) {
    document.documentElement.setAttribute('data-theme', theme);
    currentPrefs.theme = theme;

    // Update theme buttons
    document.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });

    if (customThemeOptions) {
      customThemeOptions.style.display = theme === 'custom' ? 'block' : 'none';
    }

    // Apply to epub rendition
    if (rendition) {
      applyThemeToRendition(theme);
    }

    if (save) {
      EpubStorage.savePreferences({ theme });
    }
  }

  function applyThemeToRendition(theme) {
    if (!rendition) return;

    const themes = {
      light: { bg: '#ffffff', color: '#2d2d2d' },
      dark: { bg: '#1a1a1a', color: '#d4d0c8' },
      sepia: { bg: '#f8f0dc', color: '#3e2f1c' },
      green: { bg: '#c7e6c1', color: '#2b3a2b' },
      custom: { bg: currentPrefs.customBg || '#ffffff', color: currentPrefs.customText || '#333333' }
    };

    const t = themes[theme] || themes.light;

    rendition.themes.override('color', t.color);
    rendition.themes.override('background', t.bg);

    // Update the custom CSS hook to either crush inline styles (for custom theme) 
    // or remove the custom color overrides (for standard themes).
    updateCustomStyles();
  }

  function setLayout(layout) {
    document.querySelectorAll('.layout-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.layout === layout);
    });

    EpubStorage.savePreferences({ layout });

    // Need to reload the book with new flow settings
    if (book && isBookLoaded) {
      const currentCfi = rendition.currentLocation()?.start?.cfi;
      rendition.destroy();

      const flow = layout === 'scrolled' ? 'scrolled-doc' : 'paginated';
      const manager = layout === 'scrolled' ? 'continuous' : 'default';

      rendition = book.renderTo('epub-viewer', {
        width: '100%',
        height: '100%',
        spread: 'auto',
        flow: flow,
        manager: manager,
        allowScriptedContent: false,
        gap: 40
      });

      // Re-apply everything
      EpubStorage.getPreferences().then((prefs) => {
        // Inject our bulletproof custom styles into every new chapter iframe
        rendition.hooks.content.register((contents) => {
          injectCustomStyleElement(contents);
        });

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
          'img': {
            'max-width': '100% !important',
            'height': 'auto !important'
          }
        });

        applyThemeToRendition(prefs.theme || 'light');
        ImageViewer.hookRendition(rendition);
        Annotations.hookRendition(rendition);
        setupRenditionKeyEvents(rendition);

        rendition.on('relocated', (location) => {
          onLocationChanged(location);
        });

        rendition.on('displayed', () => {
          setTimeout(() => ensureFocus(), 100);
        });

        TOC.build(book.navigation, rendition);
        Bookmarks.setBook(currentBookId, book, rendition);

        if (currentCfi) {
          rendition.display(currentCfi);
        } else {
          rendition.display();
        }
      });
    }
  }

  function applyFontSize(size) {
    if (!rendition) return;
    currentPrefs.fontSize = size;
    updateCustomStyles();
  }

  function applyLineHeight(val) {
    if (!rendition) return;
    currentPrefs.lineHeight = val;
    updateCustomStyles();
  }

  function applyFontFamily(family) {
    if (!rendition) return;
    currentPrefs.fontFamily = family;
    updateCustomStyles();
  }

  // --- Helpers ---
  function showLoading(show) {
    loadingOverlay.style.display = show ? 'flex' : 'none';
  }

})();
