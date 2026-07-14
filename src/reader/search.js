/**
 * EPUB Reader - Search Module
 */
(function () {
  'use strict';

  const _SEARCH_MAX_RESULTS = 1000;
  const _SEARCH_UI_YIELD_MS = 10;
  const _SEARCH_FOCUS_DELAY_MS = 100;

  let book = null;
  let rendition = null;
  let navigate = null;
  let panelController = null;
  let panel = null;
  let searchInput = null;
  let searchBtn = null;
  let resultsList = null;
  let statusEl = null;
  let isSearching = false;
  let currentSearchId = 0;
  let focusTimerId = null;
  let focusRequestSeq = 0;
  let _lastSearchAlertCfi = null;
  let _boundDocument = null;

  function cancelPendingFocus() {
    focusRequestSeq++;
    if (focusTimerId !== null) {
      clearTimeout(focusTimerId);
      focusTimerId = null;
    }
  }

  function init() {
    cancelPendingFocus();
    panel = document.getElementById('search-panel');
    searchInput = document.getElementById('search-input');
    searchBtn = document.getElementById('btn-do-search');
    resultsList = document.getElementById('search-results-list');
    statusEl = document.getElementById('search-status');

    if (_boundDocument === document) return;
    _boundDocument = document;

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
    cancelPendingFocus();
    isSearching = false;
    currentSearchId++;
    if (searchBtn) searchBtn.disabled = false;
    clearSearchHighlight();

    book = b;
    rendition = r;
    if (resultsList) resultsList.innerHTML = '';
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.remove('search-status-empty');
    }
    if (searchInput) searchInput.value = '';
  }

  function togglePanel() {
    if (!book || !panel) return;
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
      closePanel();
    } else {
      if (panelController) panelController.openExclusivePanel(panel);
      else panel.classList.add('open');
      cancelPendingFocus();
      const requestSeq = focusRequestSeq;
      focusTimerId = setTimeout(() => {
        if (requestSeq !== focusRequestSeq) return;
        focusTimerId = null;
        if (!panel?.classList.contains('open')) return;
        if (searchInput) searchInput.focus();
        // Select all text if exists
        if (searchInput && searchInput.value) searchInput.select();
      }, _SEARCH_FOCUS_DELAY_MS);
    }
  }

  function closePanel() {
    cancelPendingFocus();
    if (panelController) panelController.closePanelWithOverlayCheck(panel);
    else if (panel) panel.classList.remove('open');
    // Cancel any active searches if panel is closed
    isSearching = false;
    currentSearchId++;
    if (searchBtn) searchBtn.disabled = false;
    clearSearchHighlight();
  }

  function reset() {
    closePanel();
    if (resultsList) resultsList.innerHTML = '';
    if (statusEl) statusEl.textContent = '';
    if (searchInput) searchInput.value = '';
    book = null;
    rendition = null;
    navigate = null;
  }

  async function doSearch(query) {
    if (!book) return;
    
    const searchId = ++currentSearchId;
    const activeBook = book;
    isSearching = true;
    resultsList.innerHTML = '';
    statusEl.textContent = '准备搜索...';
    statusEl.classList.remove('search-status-empty');
    searchBtn.disabled = true;

    try {
      let results = [];
      const spine = activeBook.spine;
      const activeLoad = typeof activeBook.load === 'function' ? activeBook.load.bind(activeBook) : undefined;
      
      for (let i = 0; i < spine.length; i++) {
        if (searchId !== currentSearchId || !isSearching) break;
        if (results.length >= _SEARCH_MAX_RESULTS) break;

        const item = spine.get(i);
        statusEl.textContent = `搜索中... (章节 ${i + 1}/${spine.length})`;
        
        // Yield to browser UI thread to allow status text to render
        await new Promise(r => setTimeout(r, _SEARCH_UI_YIELD_MS));
        
        if (searchId !== currentSearchId || !isSearching) break;

        let itemResults = [];
        let loaded = false;
        try {
          await item.load(activeLoad);
          loaded = true;
          if (searchId !== currentSearchId || !isSearching) {
            break;
          }
          // item.find returns array of { cfi, excerpt }
          itemResults = item.find(query);
        } catch(e) {
          console.warn('Search error in chapter', i, e);
        } finally {
          if (loaded && typeof item.unload === 'function') {
            try {
              item.unload();
            } catch (e) {
              console.warn('Search unload error in chapter', i, e);
            }
          }
        }
        
        if (itemResults && itemResults.length > 0) {
          const remaining = _SEARCH_MAX_RESULTS - results.length;
          const cappedResults = itemResults.slice(0, remaining);
          results = results.concat(cappedResults);
          renderPartialResults(cappedResults, query, searchId);
        }
      }

      if (searchId === currentSearchId) {
        if (results.length === 0) {
          statusEl.textContent = '暂无结果';
          statusEl.classList.add('search-status-empty');
        } else if (results.length >= _SEARCH_MAX_RESULTS) {
          statusEl.textContent = `找到极多结果，仅显示前 ${_SEARCH_MAX_RESULTS} 条以保护性能`;
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

  function renderPartialResults(newResults, query, searchId) {
    if (searchId !== currentSearchId || !resultsList) return;
    newResults.forEach(res => {
      if (searchId !== currentSearchId) return;
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
        if (searchId !== currentSearchId) return;
        const allItems = resultsList.querySelectorAll('.search-result-item');
        allItems.forEach(el => el.classList.remove('active'));
        itemEl.classList.add('active');

        if (rendition && rendition.annotations) {
          clearSearchHighlight();
          rendition.annotations.highlight(res.cfi, {}, () => {}, 'epubjs-search-highlight', { fill: 'yellow', 'fill-opacity': '0.5' });
          _lastSearchAlertCfi = res.cfi;
          navigateTo(res.cfi);
        }
      });

      resultsList.appendChild(itemEl);
    });
  }


  // 清理上一次结果定位产生的 rendition annotation，避免跨搜索残留。
  function clearSearchHighlight() {
    if (_lastSearchAlertCfi && rendition && rendition.annotations) {
      rendition.annotations.remove(_lastSearchAlertCfi, 'highlight');
      _lastSearchAlertCfi = null;
    }
  }

  function navigateTo(target) {
    const navigateCommand = navigate || ((value) => rendition?.display(value));
    try {
      Promise.resolve(navigateCommand(target)).catch((err) => {
        console.warn('[Search] navigation failed:', err);
      });
    } catch (err) {
      console.warn('[Search] navigation failed:', err);
    }
  }

  function mount(context) {
    if (!context) return;
    navigate = typeof context.navigate === 'function' ? context.navigate : null;
    panelController = context.panelController || null;
    setBook(context.book, context.rendition);
  }

  function unmount() {
    reset();
  }

  const Search = { init, setBook, togglePanel, closePanel, reset, mount, unmount };

  window.Search = Search;
})();
