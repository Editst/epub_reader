/**
 * EPUB Reader - Search Module
 */
const Search = (function() {
  let book = null;
  let rendition = null;
  let panel = null;
  let overlay = null;
  let searchInput = null;
  let searchBtn = null;
  let resultsList = null;
  let statusEl = null;
  let isSearching = false;
  let currentSearchId = 0;
  let _lastSearchAlertCfi = null; // v1.2.0: Track search highlights to prevent memory/visual leaks

  function init() {
    panel = document.getElementById('search-panel');
    overlay = document.getElementById('sidebar-overlay');
    searchInput = document.getElementById('search-input');
    searchBtn = document.getElementById('btn-do-search');
    resultsList = document.getElementById('search-results-list');
    statusEl = document.getElementById('search-status');

    const btnSearch = document.getElementById('btn-search');
    if (btnSearch) {
      btnSearch.addEventListener('click', togglePanel);
    }
    
    const btnClose = document.getElementById('btn-search-close');
    if (btnClose) {
      btnClose.addEventListener('click', closePanel);
    }

    if (searchBtn && searchInput) {
      searchBtn.addEventListener('click', () => {
        const query = searchInput.value.trim();
        if (query) doSearch(query);
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const query = searchInput.value.trim();
          if (query) doSearch(query);
        }
      });
    }

    // Keyboard shortcut (F)
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
        if (!book) return;
        const active = document.activeElement;
        const tag = active ? active.tagName : '';
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          togglePanel();
          if (panel.classList.contains('open')) {
            searchInput.focus();
          }
        }
      }
    });
  }

  function setBook(b, r) {
    book = b;
    rendition = r;
    if (resultsList) resultsList.innerHTML = '';
    if (statusEl) statusEl.textContent = '';
    if (searchInput) searchInput.value = '';
    clearSearchHighlight();
  }

  function togglePanel() {
    if (!book || !panel) return;
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
      closePanel();
    } else {
      // Close other panels
      const sidebar = document.getElementById('sidebar');
      const bookmarksPanel = document.getElementById('bookmarks-panel');
      if (sidebar) sidebar.classList.remove('open');
      if (bookmarksPanel) bookmarksPanel.classList.remove('open');
      
      panel.classList.add('open');
      if (overlay) overlay.classList.add('visible'); // v1.2.2: Standardize overlay toggling
      setTimeout(() => {
        if (searchInput) searchInput.focus();
        // Select all text if exists
        if (searchInput && searchInput.value) searchInput.select();
      }, 100);
    }
  }

  function closePanel() {
    if (panel) panel.classList.remove('open');
    if (overlay) {
      // FIX P1-B: The overlay is shared by TOC, Search, and Bookmarks.
      // Only remove it when ALL three panels are closed; otherwise the other
      // panel's backdrop would disappear while the panel itself stays visible.
      const tocOpen       = document.getElementById('sidebar')?.classList.contains('open');
      const bookmarksOpen = document.getElementById('bookmarks-panel')?.classList.contains('open');
      if (!tocOpen && !bookmarksOpen) {
        overlay.classList.remove('visible');
      }
    }
    // Cancel any active searches if panel is closed
    isSearching = false;
    currentSearchId++;
    clearSearchHighlight(); // v1.2.0: Clean up search highlights on exit
  }

  function reset() {
    closePanel();
    if (resultsList) resultsList.innerHTML = '';
    if (statusEl) statusEl.textContent = '';
    if (searchInput) searchInput.value = '';
    isSearching = false;
    currentSearchId++;
    clearSearchHighlight();
    book = null;
    rendition = null;
  }

  async function doSearch(query) {
    if (!book) return;
    
    const searchId = ++currentSearchId;
    isSearching = true;
    resultsList.innerHTML = '';
    statusEl.textContent = '准备搜索...';
    statusEl.classList.remove('search-status-empty');
    searchBtn.disabled = true;

    try {
      let results = [];
      const spine = book.spine;
      const MAX_RESULTS = 1000;
      
      for (let i = 0; i < spine.length; i++) {
        if (searchId !== currentSearchId || !isSearching) break;
        if (results.length >= MAX_RESULTS) break;

        const item = spine.get(i);
        statusEl.textContent = `搜索中... (章节 ${i + 1}/${spine.length})`;
        
        // Yield to browser UI thread to allow status text to render
        await new Promise(r => setTimeout(r, 10));
        
        if (searchId !== currentSearchId || !isSearching) break;

        let itemResults = [];
        try {
          await item.load(book.load.bind(book));
          if (searchId !== currentSearchId || !isSearching) {
            item.unload();
            break;
          }
          // item.find returns array of { cfi, excerpt }
          itemResults = item.find(query);
          item.unload();
        } catch(e) {
          console.warn('Search error in chapter', i, e);
        }
        
        if (itemResults && itemResults.length > 0) {
          results = results.concat(itemResults);
          renderPartialResults(results, query);
        }
      }

      if (searchId === currentSearchId) {
        if (results.length === 0) {
          statusEl.textContent = '暂无结果';
          statusEl.classList.add('search-status-empty');
        } else if (results.length >= MAX_RESULTS) {
          statusEl.textContent = `找到极多结果，仅显示前 ${MAX_RESULTS} 条以保护性能`;
        } else {
          statusEl.textContent = `搜索完成，共找到 ${results.length} 个结果`;
        }
      }
    } catch (err) {
      if (searchId === currentSearchId) {
        console.error(err);
        statusEl.textContent = '搜索出错';
      }
    } finally {
      if (searchId === currentSearchId) {
        isSearching = false;
        searchBtn.disabled = false;
      }
    }
  }

  function renderPartialResults(results, query) {
    resultsList.innerHTML = '';

    results.forEach(res => {
      const itemEl = document.createElement('div');
      itemEl.className = 'bookmark-item search-result-item';

      const textEl = document.createElement('div');
      textEl.className = 'bookmark-title search-result-text';

      const excerpt = (res.excerpt || '').trim();
      const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${safeQuery})`, 'gi');

      const parts = excerpt.split(regex);
      parts.forEach(part => {
        if (new RegExp(`^${safeQuery}$`, 'i').test(part)) {
          const mark = document.createElement('mark');
          mark.className = 'search-highlight';
          mark.textContent = part;
          textEl.appendChild(mark);
        } else if (part) {
          textEl.appendChild(document.createTextNode(part));
        }
      });

      itemEl.appendChild(textEl);

      itemEl.addEventListener('click', () => {
        const allItems = resultsList.querySelectorAll('.search-result-item');
        allItems.forEach(el => el.classList.remove('active'));
        itemEl.classList.add('active');

        if (rendition && rendition.annotations) {
          clearSearchHighlight();
          rendition.annotations.highlight(res.cfi, {}, () => {}, 'epubjs-search-highlight', { fill: 'yellow', 'fill-opacity': '0.5' });
          _lastSearchAlertCfi = res.cfi;
          rendition.display(res.cfi);
        }
      });

      resultsList.appendChild(itemEl);
    });
  }


  // v1.2.0: Utility to clear the last search highlight to prevent visual/memory pollution
  function clearSearchHighlight() {
      if (_lastSearchAlertCfi && rendition && rendition.annotations) {
          rendition.annotations.remove(_lastSearchAlertCfi, "highlight");
          _lastSearchAlertCfi = null;
      }
  }

  function mount(context) {
    if (!context) return;
    setBook(context.book, context.rendition);
  }

  function unmount() {
    reset();
  }

  return { init, setBook, togglePanel, closePanel, reset, mount, unmount, panel: () => panel };
})();
