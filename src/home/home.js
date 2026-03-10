document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const tabs = document.querySelectorAll('.nav-btn');
  const panes = document.querySelectorAll('.tab-pane');
  const btnTheme = document.getElementById('btn-theme');
  const btnView = document.getElementById('btn-view');
  const btnUpload = document.getElementById('btn-upload');
  const fileInput = document.getElementById('file-input');
  const btnClearAll = document.getElementById('btn-clear-all');
  
  const booksContainer = document.getElementById('books-container');
  const shelfEmpty = document.getElementById('shelf-empty');
  const bookCount = document.getElementById('book-count');

  const annotationsContainer = document.getElementById('annotations-container');
  const annotationsEmpty = document.getElementById('annotations-empty');

  // State
  let currentPrefs = await EpubStorage.getPreferences() || {};
  let currentTheme = currentPrefs.theme === 'dark' ? 'dark' : 'light';
  let currentView = currentPrefs.homeView === 'list' ? 'list' : 'grid';

  // --- State and UI Setup ---
  const filterBtns = document.querySelectorAll('.filter-btn');
  const btnSortTime = document.getElementById('btn-sort-time');
  let currentSort = 'desc'; // 'desc' (newest first) or 'asc' (oldest first)
  
  // Initialize
  setTheme(currentTheme);
  setView(currentView);
  await loadBookshelf();
  await loadAnnotations('all');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadAnnotations(btn.dataset.filter);
    });
  });

  if (btnSortTime) {
    btnSortTime.addEventListener('click', () => {
      // Toggle sort
      if (currentSort === 'desc') {
        currentSort = 'asc';
        btnSortTime.textContent = '⬆️ 最早时间';
        btnSortTime.title = '切换时间排序: 升序';
      } else {
        currentSort = 'desc';
        btnSortTime.textContent = '⬇️ 最新时间';
        btnSortTime.title = '切换时间排序: 降序';
      }
      
      // Re-load with current active filter
      const activeFilter = document.querySelector('.filter-btn.active');
      const filterMode = activeFilter ? activeFilter.dataset.filter : 'all';
      loadAnnotations(filterMode);
    });
  }

  // --- Theme & View Toggles ---
  btnTheme.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(currentTheme);
    EpubStorage.savePreferences({ theme: currentTheme });
  });

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  btnView.addEventListener('click', () => {
    currentView = currentView === 'grid' ? 'list' : 'grid';
    setView(currentView);
    EpubStorage.savePreferences({ homeView: currentView });
  });

  function setView(view) {
    if (view === 'list') {
      booksContainer.classList.add('list-view');
    } else {
      booksContainer.classList.remove('list-view');
    }
  }

  // --- Tab Switching ---
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById('pane-' + tab.dataset.tab).classList.add('active');
    });
  });

  // --- File Upload ---
  btnUpload.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Read and store
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Use the same store function as popup
    await storeFileData(file.name, uint8Array);

    // Open Reader
    window.location.href = chrome.runtime.getURL('reader/reader.html') + '?file=' + encodeURIComponent(file.name);
  });

  // Helper from popup
  function storeFileData(filename, uint8Array) {
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
          if (EpubStorage.enforceFileLRU) await EpubStorage.enforceFileLRU(10);
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // --- Bookshelf ---
  async function loadBookshelf() {
    const books = await EpubStorage.getRecentBooks();
    bookCount.textContent = `(${books.length})`;
    
    if (books.length === 0) {
      booksContainer.innerHTML = '';
      shelfEmpty.classList.add('show');
      btnClearAll.style.display = 'none';
      return;
    }
    
    shelfEmpty.classList.remove('show');
    btnClearAll.style.display = 'block';
    booksContainer.innerHTML = '';

    for (const book of books) {
      const card = document.createElement('div');
      card.className = 'book-card';

      // Load Cover
      // FIX P1-E: URL.createObjectURL must be paired with revokeObjectURL to
      // avoid leaking blob references across bookshelf refreshes.  Build the
      // img element via DOM APIs so we can revoke as soon as the image loads
      // (or fails), rather than embedding the raw URL in an innerHTML template.
      const coverBlob = await EpubStorage.getCover(book.id);
      let coverObjectUrl = null;
      let coverHtml;
      if (coverBlob) {
        coverObjectUrl = URL.createObjectURL(coverBlob);
        coverHtml = `<img class="cover-img" src="${coverObjectUrl}" alt="Cover">`;
      } else {
        coverHtml = `<div class="placeholder">📖</div>`;
      }

      // Load Progress
      const pos = await EpubStorage.getPosition(book.id);
      const percent = (pos && pos.percentage) ? pos.percentage : 0;
      
      // Load Time
      const timeInSeconds = await EpubStorage.getReadingTime(book.id) || 0;
      const timeHtml = formatTime(timeInSeconds);

      card.innerHTML = `
        <div class="book-cover">${coverHtml}</div>
        <div class="book-info">
          <div class="book-title" title="${escapeHtml(book.title || book.filename)}">${escapeHtml(book.title || book.filename)}</div>
          <div class="book-author">${escapeHtml(book.author || '未知作者')}</div>
          
          <div class="book-meta">
            <div class="book-time">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${timeHtml}
            </div>
            <div class="book-date">${formatDate(book.lastOpened)}</div>
          </div>
          
          <div class="progress-bar-container">
            <div class="progress-header">
              <span>阅读进度</span>
              <span>${percent}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${percent}%"></div>
            </div>
          </div>
        </div>
        <button class="book-delete" title="删除书籍及记录">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>
        </button>
      `;

      // Open book
      card.addEventListener('click', (e) => {
        if (e.target.closest('.book-delete')) return;
        window.location.href = chrome.runtime.getURL('reader/reader.html') + '?file=' + encodeURIComponent(book.filename);
      });

      // FIX P1-E: Revoke the blob URL as soon as the image finishes loading
      // (or fails) so the browser can free the underlying Blob memory.
      if (coverObjectUrl) {
        const coverImg = card.querySelector('.cover-img');
        if (coverImg) {
          coverImg.addEventListener('load',  () => URL.revokeObjectURL(coverObjectUrl), { once: true });
          coverImg.addEventListener('error', () => URL.revokeObjectURL(coverObjectUrl), { once: true });
        }
      }

      // Delete book
      card.querySelector('.book-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`确定要移除《${book.title || book.filename}》吗？这将删除所有阅读记录、笔记和缓存。`)) {
          await EpubStorage.removeBook(book.id, book.filename);
          card.remove();
          // Reload shelf
          await loadBookshelf();
        }
      });

      booksContainer.appendChild(card);
    }
  }

  btnClearAll.addEventListener('click', async () => {
    if (confirm('确定要清空书架吗？所有阅读记录和本地缓存将被永久删除。')) {
      const books = await EpubStorage.getRecentBooks();
      for (const book of books) {
        await EpubStorage.removeBook(book.id, book.filename);
      }
      await loadBookshelf();
    }
  });

  // --- Annotations Management ---
  async function loadAnnotations(filterType = 'all') {
    const allHighlights = await EpubStorage.getAllHighlights() || {};
    const bookKeys = Object.keys(allHighlights);
    
    const recentBooks = await EpubStorage.getRecentBooks();
    const bookMetaMap = {};
    for (const b of recentBooks) {
      bookMetaMap[b.id] = b;
    }

    let hasAny = false;
    annotationsContainer.innerHTML = '';

    // v1.2.2: Compile all annotations into a single flat array for global time sorting
    let flatAnnotations = [];

    for (const bookId of bookKeys) {
      const highlights = allHighlights[bookId] || [];
      const bookContext = bookMetaMap[bookId] || { title: '未知书籍' };
      
      for (const hl of highlights) {
         // Attach lookup context used for deletion and display
         hl._bookId      = bookId;
         // FIX P1-F: _originalIndex was computed here but never read; deletion
         // already uses CFI matching (not index), so the variable was dead code.
         hl._bookContext = bookContext;

         // Filter logic
         const isNoteOnly = hl.color === 'transparent';
         if (filterType === 'highlight' && isNoteOnly) continue;
         if (filterType === 'note' && !isNoteOnly) continue;

         flatAnnotations.push(hl);
      }
    }

    // Apply Sorting
    flatAnnotations.sort((a, b) => {
      return currentSort === 'desc' 
        ? b.timestamp - a.timestamp 
        : a.timestamp - b.timestamp;
    });

    if (flatAnnotations.length > 0) hasAny = true;

    // Render sorted annotations
    for (const hl of flatAnnotations) {
       const isNoteOnly = hl.color === 'transparent';
       const item = document.createElement('div');
       item.className = 'annotation-item';
              item.innerHTML = `
          <div class="annotation-content">
            <div class="annotation-header">
              <div class="annotation-book" title="在阅读器中定位">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                ${escapeHtml(hl._bookContext.title || hl._bookContext.filename)}
              </div>
              <div class="annotation-type-badge ${isNoteOnly ? 'type-note' : 'type-hl'}" style="${isNoteOnly ? 'background-color: rgba(148, 163, 184, 0.1); color: #64748b;' : `background-color: ${sanitizeColor(hl.color)}33; color: ${sanitizeColor(hl.color)};`}">
                ${isNoteOnly ? '📝 笔记' : '🖍 标注'}
              </div>
            </div>
            <div class="annotation-quote" style="border-left-color: ${isNoteOnly ? '#94a3b8' : sanitizeColor(hl.color)}">${escapeHtml(hl.text)}</div>
            ${hl.note ? `<div class="annotation-note">${escapeHtml(hl.note)}</div>` : ''}
            <div class="annotation-footer">
              <span class="annotation-meta">创建于 ${formatDate(hl.timestamp)}</span>
              <button class="annotation-delete-btn" title="删除标注">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>
              </button>
            </div>
          </div>
        `;

       // Click book title to open reader
       item.querySelector('.annotation-book').addEventListener('click', (e) => {
          if (hl._bookContext.filename) {
             window.location.href = chrome.runtime.getURL('reader/reader.html') + '?file=' + encodeURIComponent(hl._bookContext.filename) + '&target=' + encodeURIComponent(hl.cfi);
          }
       });

       // Delete annotation
       item.querySelector('.annotation-delete-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm('确定要删除这条标注吗？')) {
             // Retrieve fresh list to ensure correct deletion indexing
             const currentHighlights = await EpubStorage.getHighlights(hl._bookId) || [];
             // Filter it out via CFI match instead of index since indexing might have drifted in sorted state
             const updated = currentHighlights.filter(h => h.cfi !== hl.cfi);
             await EpubStorage.saveHighlights(hl._bookId, updated);
             loadAnnotations(filterType);
          }
       });

       annotationsContainer.appendChild(item);
    }

    if (!hasAny) {
      annotationsEmpty.classList.add('show');
    } else {
      annotationsEmpty.classList.remove('show');
    }
  }

  // --- Export Annotations ---
  const btnExportAll = document.getElementById('btn-export-all');
  if (btnExportAll) {
    btnExportAll.addEventListener('click', async () => {
      const allHighlights = await EpubStorage.getAllHighlights() || {};
      const recentBooks = await EpubStorage.getRecentBooks();
      let md = '# 📖 阅读笔记与标注\n\n导出时间：' + new Date().toLocaleString() + '\n\n';
      
      let hasData = false;
      for (const book of recentBooks) {
        const hls = allHighlights[book.id];
        if (hls && hls.length > 0) {
          hasData = true;
          md += `## 《${escapeHtml(book.title || book.filename)}》\n\n`;
          md += `*作者：${escapeHtml(book.author || '未知')}*\n\n`;
          
          // Sort chronologically by timestamp
          hls.sort((a,b) => a.timestamp - b.timestamp).forEach(hl => {
            md += `> ${hl.text.trim().replace(/\n/g, '\n> ')}\n\n`;
            if (hl.note) {
              md += `**✏️ 笔记**：${hl.note.trim()}\n\n`;
            }
            md += `---\n\n`; // Issue 8: Using correct newline sequences
          });
          md += `\n\n`; // Final separator per book
        }
      }

      if (!hasData) {
        alert('此时还没有可以导出的笔记！');
        return;
      }

      // Download as markdown file
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `epub_notes_${new Date().toISOString().slice(0,10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // --- Utils ---
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // FIX P0-NEW-1: Validate CSS color to prevent style-based XSS injection
  function sanitizeColor(colorStr) {
    if (!colorStr) return '#ffeb3b'; // Default fallback yellow
    // Match hex colors (e.g. #fff, #ffeb3b, #ffeb3b33) or literal 'transparent'
    const colorRegex = /^#[0-9a-fA-F]{3,8}$|^transparent$/;
    return colorRegex.test(colorStr) ? colorStr : '#ffeb3b';
  }

  function formatDate(timestamp) {
    if (!timestamp) return '未知时间';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';

    return date.toLocaleDateString('zh-CN');
  }

  function formatTime(seconds) {
    if (seconds === undefined || seconds === null) return '0秒';
    if (seconds < 60) return `${Math.max(0, seconds)}秒`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}分钟`;
    const hrs = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${hrs}小时${m}分` : `${hrs}小时`;
  }
});
