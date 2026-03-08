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
    // We don't automatically clear highlights on close, letting user keep them while reading
  }

  async function doSearch(query) {
    if (!book || isSearching) return;
    
    isSearching = true;
    resultsList.innerHTML = '';
    statusEl.textContent = '准备搜索...';
    searchBtn.disabled = true;

    try {
      let results = [];
      const spine = book.spine;
      
      for (let i = 0; i < spine.length; i++) {
        const item = spine.get(i);
        statusEl.textContent = `搜索中... (章节 ${i + 1}/${spine.length})`;
        
        // Yield to browser UI thread to allow status text to render
        await new Promise(r => setTimeout(r, 10));
        
        let itemResults = [];
        try {
          await item.load(book.load.bind(book));
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

      statusEl.textContent = `搜索完成，共找到 ${results.length} 个结果`;
    } catch (err) {
      console.error(err);
      statusEl.textContent = '搜索出错';
    } finally {
      isSearching = false;
      searchBtn.disabled = false;
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
      
      // Highlight the exact query match in the excerpt
      const excerpt = res.excerpt.trim();
      
      // Escape query for regex
      const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${safeQuery})`, 'gi');
      
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
