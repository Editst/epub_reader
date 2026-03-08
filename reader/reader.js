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
  let _navLock = false; // Debounce lock to prevent double page-turn

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

  const fontSizeSlider = document.getElementById('font-size-slider');
  const fontSizeValue = document.getElementById('font-size-value');
  const lineHeightSlider = document.getElementById('line-height-slider');
  const lineHeightValue = document.getElementById('line-height-value');
  const fontFamilySelect = document.getElementById('font-family-select');
  const settingsPanel = document.getElementById('settings-panel');

  // --- Initialize Modules ---
  document.addEventListener('DOMContentLoaded', async () => {
    ImageViewer.init();
    Annotations.init();
    TOC.init();
    Bookmarks.init();

    await loadPreferences();
    setupEventListeners();
    setupDragAndDrop();

    // Check if opened with a file parameter
    const params = new URLSearchParams(window.location.search);
    const fileName = params.get('file');
    if (fileName) {
      await loadFileFromIndexedDB(fileName);
    }
  });

  // --- Event Listeners ---
  function setupEventListeners() {
    // File open buttons
    document.getElementById('welcome-open-btn').addEventListener('click', () => fileInput.click());
    document.getElementById('btn-open').addEventListener('click', () => fileInput.click());

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
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (rendition && isBookLoaded) {
          rendition.resize();
        }
      }, 200);
    });

    // Click outside to close settings and bookmarks panels
    document.addEventListener('click', (e) => {
      const isSettingsBtn = e.target.closest('#btn-settings');
      const isBookmarksBtn = e.target.closest('#btn-bookmarks');
      
      if (!isSettingsBtn && settingsPanel.classList.contains('open') && !e.target.closest('#settings-panel')) {
        closeSettings();
      }
      
      if (!isBookmarksBtn && Bookmarks.panel && Bookmarks.panel.classList.contains('open') && !e.target.closest('#bookmarks-panel')) {
        Bookmarks.closePanel();
      }
    });
  }

  // Keyboard navigation handler (with debounce to prevent double-fire)
  function handleKeyNav(e) {
    if (!isBookLoaded) return;
    // Ignore when input is focused
    const active = document.activeElement;
    const tag = active ? active.tagName : '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    switch (e.key) {
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

  function navPrev() {
    if (_navLock || !rendition) return;
    _navLock = true;
    rendition.prev();
    setTimeout(() => { _navLock = false; }, 150);
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
      showLoading(false);
      alert('无法加载此 EPUB 文件: ' + err.message);
    }
  }

  /**
   * Store file data in IndexedDB for later reopening via recent books.
   * Maintains a maximum of 5 books to prevent excessive disk space usage.
   */
  function storeFileInIndexedDB(filename, uint8Array) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('EpubReaderDB', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'name' });
        }
      };
      request.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        
        // Put the new file
        store.put({ name: filename, data: uint8Array, timestamp: Date.now() });
        
        // Cleanup old files (keep only the 5 most recent)
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          const files = getAllReq.result;
          if (files.length > 5) {
            // Sort by timestamp descending (newest first)
            files.sort((a, b) => b.timestamp - a.timestamp);
            // Delete anything beyond the first 5
            for (let i = 5; i < files.length; i++) {
              store.delete(files[i].name);
            }
          }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function loadFileFromIndexedDB(fileName) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('EpubReaderDB', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'name' });
        }
      };
      request.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) {
          alert('找不到该书籍的缓存数据。请重新通过"打开文件"按钮加载该电子书。');
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
            await openBook(data.buffer);
          } else {
            alert('由于浏览器限制，该书籍的本地缓存已被自动清理（或您在旧版本中打开此书）。请重新通过"打开文件"按钮加载该电子书，重新加载后可从历史记录打开。');
          }
          resolve();
        };
        getReq.onerror = () => {
          alert('读取数据失败。请重新加载该电子书。');
          resolve();
        };
      };
      request.onerror = () => {
        alert('读取数据失败。请重新加载该电子书。');
        resolve();
      };
    });
  }

  async function openBook(arrayBuffer) {
    // Destroy previous book
    if (book) {
      book.destroy();
    }

    book = ePub(arrayBuffer);
    const prefs = await EpubStorage.getPreferences();

    // Create rendition
    rendition = book.renderTo('epub-viewer', {
      width: '100%',
      height: '100%',
      spread: prefs.spread || 'auto',
      flow: prefs.layout === 'scrolled' ? 'scrolled-doc' : 'paginated',
      manager: prefs.layout === 'scrolled' ? 'continuous' : 'default',
      allowScriptedContent: false
    });

    // Apply default theme for Chinese typography
    rendition.themes.default({
      'html': {
        'font-size': (prefs.fontSize || 18) + 'px !important'
      },
      'body': {
        'font-family': prefs.fontFamily || "'Noto Serif SC', 'Source Han Serif CN', 'SimSun', 'STSong', serif",
        'line-height': (prefs.lineHeight || 1.8) + ' !important',
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

    // Get metadata
    const metadata = await book.loaded.metadata;
    bookTitleEl.textContent = metadata.title || currentFileName;
    document.title = (metadata.title || currentFileName) + ' - EPUB Reader';

    // Build TOC
    const navigation = await book.loaded.navigation;
    TOC.build(navigation, rendition);

    // Display content FIRST (before locations.generate) for faster perceived loading
    const savedPos = await EpubStorage.getPosition(currentBookId);
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

    // Show reader UI immediately - book is already visible
    welcomeScreen.style.display = 'none';
    readerMain.style.display = 'flex';
    bottomBar.style.display = 'flex';
    showLoading(false);
    isBookLoaded = true;

    // Ensure focus after everything is loaded
    setTimeout(() => ensureFocus(), 300);

    // Generate locations in the background (this is slow for large books)
    // Progress bar will start working once this completes
    book.locations.generate(1600).then(() => {
      // Update progress display now that locations are ready
      const loc = rendition.currentLocation();
      if (loc && loc.start) {
        onLocationChanged(loc);
      }
    });
  }

  /**
   * Register keyboard events inside epub.js iframe content
   * This ensures arrow keys work even when the iframe has focus
   */
  function setupRenditionKeyEvents(rend) {
    rend.hooks.content.register((contents) => {
      const doc = contents.document;
      doc.addEventListener('keydown', (e) => {
        handleKeyNav(e);
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
    if (!location || !location.start) return;

    // Update progress (only if locations have been generated)
    if (book.locations && book.locations.length()) {
      const progress = book.locations.percentageFromCfi(location.start.cfi);
      const percent = Math.round(progress * 1000) / 10;
      progressSlider.value = percent;
      progressCurrent.textContent = percent.toFixed(1) + '%';
    }

    // Update chapter title
    const currentSection = location.start.href;
    if (currentSection) {
      const tocItem = findTocItem(book.navigation.toc, currentSection);
      chapterTitleEl.textContent = tocItem ? tocItem.label.trim() : '';
      TOC.setActive(currentSection);
    }

    // Save position
    EpubStorage.savePosition(currentBookId, location.start.cfi);

    // Update bookmark button state
    updateBookmarkButtonState();
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

    // Apply theme
    setTheme(prefs.theme || 'light', false);

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

    // Update theme buttons
    document.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });

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
      green: { bg: '#c7e6c1', color: '#2b3a2b' }
    };

    const t = themes[theme] || themes.light;

    rendition.themes.override('color', t.color);
    rendition.themes.override('background', t.bg);
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
        allowScriptedContent: false
      });

      // Re-apply everything
      EpubStorage.getPreferences().then((prefs) => {
        rendition.themes.default({
          'html': {
            'font-size': (prefs.fontSize || 18) + 'px !important'
          },
          'body': {
            'font-family': prefs.fontFamily || "'Noto Serif SC', 'Source Han Serif CN', 'SimSun', 'STSong', serif",
            'line-height': (prefs.lineHeight || 1.8) + ' !important',
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
    rendition.themes.fontSize(size + 'px');
  }

  function applyLineHeight(val) {
    if (!rendition) return;
    rendition.themes.override('line-height', val.toString());
  }

  function applyFontFamily(family) {
    if (!rendition) return;
    if (family) {
      rendition.themes.override('font-family', family);
    } else {
      rendition.themes.override('font-family', "'Noto Serif SC', 'Source Han Serif CN', 'SimSun', 'STSong', serif");
    }
  }

  // --- Helpers ---
  function showLoading(show) {
    loadingOverlay.style.display = show ? 'flex' : 'none';
  }

})();
