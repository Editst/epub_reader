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

  // Escape HTML utility to prevent XSS
  function escapeHtml(unsafe) {
    return (unsafe || '').replace(/[&<"'>]/g, function (match) {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return map[match];
    });
  }

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
    if (statusEl) statusEl.innerHTML = '';
    if (searchInput) searchInput.value = '';
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
      if (overlay) overlay.style.display = 'block';
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
      // Only hide overlay if TOC is also closed
      const sidebar = document.getElementById('sidebar');
      if (!sidebar || !sidebar.classList.contains('open')) {
         overlay.style.display = 'none';
      }
    }
    // Cancel any active searches if panel is closed
    isSearching = false;
    currentSearchId++;
  }

  async function doSearch(query) {
    if (!book) return;
    
    const searchId = ++currentSearchId;
    isSearching = true;
    resultsList.innerHTML = '';
    statusEl.textContent = '准备搜索...';
    searchBtn.disabled = true;

    try {
      let results = [];
      const spine = book.spine;
      
      for (let i = 0; i < spine.length; i++) {
        if (searchId !== currentSearchId || !isSearching) break;

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
          statusEl.innerHTML = '<span style="color:var(--text-muted)">暂无结果</span>';
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
      itemEl.className = 'bookmark-item';
      itemEl.style.cursor = 'pointer';
      itemEl.style.userSelect = 'none';
      
      const textEl = document.createElement('div');
      textEl.className = 'bookmark-title';
      textEl.style.lineHeight = '1.4';
      textEl.style.whiteSpace = 'normal'; // Allow wrapping for context
      textEl.style.fontSize = '13px';
      
      // Sanitize the excerpt to prevent XSS
      const excerpt = escapeHtml(res.excerpt.trim());
      
      // Escape query for regex and highlight safe query
      const rawSafeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedSafeQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Since `escapeHtml` might turn `<` into `&lt;`, the query string itself should be matched either as raw or escaped
      // For simplicity, we just use the escaped safe query, assuming the excerpt is already purely text or escaped.
      const regex = new RegExp(`(${escapedSafeQuery})`, 'gi');
      
      // Use CSS variables for highlight colors
      textEl.innerHTML = excerpt.replace(regex, '<mark style="background:var(--text-accent);color:#fff;padding:0 2px;border-radius:2px;">$1</mark>');
      
      itemEl.appendChild(textEl);
      
      // Click event to navigate and highlight the document text
      itemEl.addEventListener('click', () => {
        // Remove active class from all items
        const allItems = resultsList.querySelectorAll('.bookmark-item');
        allItems.forEach(el => el.style.background = '');
        
        // Emphasize this item
        itemEl.style.background = 'var(--bg-hover)';

        if (rendition && rendition.annotations) {
          rendition.annotations.highlight(res.cfi, {}, (e) => {});
          rendition.display(res.cfi);
        }
      });
      
      resultsList.appendChild(itemEl);
    });
  }

  return { init, setBook, togglePanel, closePanel, panel: () => panel };
})();
