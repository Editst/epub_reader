document.addEventListener('DOMContentLoaded', async () => {
  const tabs           = document.querySelectorAll('.nav-btn');
  const panes          = document.querySelectorAll('.tab-pane');
  const btnTheme       = document.getElementById('btn-theme');
  const btnView        = document.getElementById('btn-view');
  const btnUpload      = document.getElementById('btn-upload');
  const fileInput      = document.getElementById('file-input');
  const btnClearAll    = document.getElementById('btn-clear-all');

  const booksContainer = document.getElementById('books-container');
  const shelfEmpty     = document.getElementById('shelf-empty');
  const bookCount      = document.getElementById('book-count');

  const annotationsContainer = document.getElementById('annotations-container');
  const annotationsEmpty     = document.getElementById('annotations-empty');

  let currentPrefs = await EpubStorage.getPreferences() || {};
  let currentTheme = currentPrefs.theme === 'dark' ? 'dark' : 'light';
  let currentView  = currentPrefs.homeView === 'list' ? 'list' : 'grid';

  const filterBtns = document.querySelectorAll('.filter-btn');
  const btnSortTime = document.getElementById('btn-sort-time');
  let currentSort = 'desc';

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
      if (currentSort === 'desc') {
        currentSort = 'asc';
        btnSortTime.textContent = '⬆️ 最早时间';
        btnSortTime.title = '切换时间排序: 升序';
      } else {
        currentSort = 'desc';
        btnSortTime.textContent = '⬇️ 最新时间';
        btnSortTime.title = '切换时间排序: 降序';
      }
      const activeFilter = document.querySelector('.filter-btn.active');
      loadAnnotations(activeFilter ? activeFilter.dataset.filter : 'all');
    });
  }

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
    booksContainer.classList.toggle('list-view', view === 'list');
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('pane-' + tab.dataset.tab).classList.add('active');
    });
  });

  btnUpload.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    const bookId = await EpubStorage.generateBookId(file.name, arrayBuffer);
    await EpubStorage.storeFile(file.name, new Uint8Array(arrayBuffer), bookId);
    window.location.href = chrome.runtime.getURL('reader/reader.html') + '?bookId=' + encodeURIComponent(bookId);
  });

  // --- Bookshelf ---
  async function loadBookshelf() {
    const books = await EpubStorage.getRecentBooks();
    bookCount.textContent = `(${books.length})`;

    if (books.length === 0) {
      booksContainer.innerHTML = '';
      shelfEmpty.classList.add('show');
      btnClearAll.classList.add('is-hidden');
      return;
    }

    shelfEmpty.classList.remove('show');
    btnClearAll.classList.remove('is-hidden');
    booksContainer.innerHTML = '';
    renderBookshelfSkeleton(Math.min(6, books.length));

    const tasks = books.map((book) => streamRenderBookCard(book));
    await Promise.all(tasks);
  }

  function renderBookshelfSkeleton(count) {
    booksContainer.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'book-card skeleton-card';
      skeleton.innerHTML = `
        <div class="book-cover skeleton-block"></div>
        <div class="book-info">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line short"></div>
        </div>
      `;
      booksContainer.appendChild(skeleton);
    }
  }

  async function streamRenderBookCard(book) {
    const [coverBlob, meta] = await Promise.all([
      EpubStorage.getCover(book.id),
      EpubStorage.getBookMeta(book.id)
    ]);

    const firstSkeleton = booksContainer.querySelector('.skeleton-card');
    if (firstSkeleton) firstSkeleton.remove();

    {
      const card = document.createElement('div');
      card.className = 'book-card';

      // v1.7.0: 保存 ObjectURL 引用到 dataset，供删除时显式 revoke
      let coverObjectUrl = null;
      let coverHtml;
      if (coverBlob) {
        coverObjectUrl = URL.createObjectURL(coverBlob);
        card.dataset.coverUrl = coverObjectUrl;
        coverHtml = `<img class="cover-img" src="${coverObjectUrl}" alt="Cover">`;
      } else {
        coverHtml = `<div class="placeholder">📖</div>`;
      }

      // 从 bookMeta 读取 pos + time（v1.7.0 合并读取，节省一次 storage 访问）
      const percent = (meta && meta.pos && meta.pos.percentage) ? meta.pos.percentage : 0;
      const timeInSeconds = (meta && meta.time) ? meta.time : 0;
      const timeHtml = Utils.formatDuration(timeInSeconds);

      card.innerHTML = `
        <div class="book-cover">${coverHtml}</div>
        <div class="book-info">
          <div class="book-title" title="${Utils.escapeHtml(book.title || book.filename)}">${Utils.escapeHtml(book.title || book.filename)}</div>
          <div class="book-author">${Utils.escapeHtml(book.author || '未知作者')}</div>
          <div class="book-meta">
            <div class="book-time">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${timeHtml}
            </div>
            <div class="book-date">${Utils.formatDate(book.lastOpened)}</div>
          </div>
          <div class="progress-bar-container">
            <div class="progress-header">
              <span>阅读进度</span>
              <span>${percent}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="--progress-width: ${percent}%;"></div>
            </div>
          </div>
        </div>
        <button class="book-delete" title="删除书籍及记录">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>
        </button>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.book-delete')) return;
        window.location.href = chrome.runtime.getURL('reader/reader.html') + '?bookId=' + encodeURIComponent(book.id);
      });

      // FIX P1-E: revoke 仍保留 load/error 监听（图片从网络加载时机不确定）
      if (coverObjectUrl) {
        const coverImg = card.querySelector('.cover-img');
        if (coverImg) {
          coverImg.addEventListener('load',  () => URL.revokeObjectURL(coverObjectUrl), { once: true });
          coverImg.addEventListener('error', () => URL.revokeObjectURL(coverObjectUrl), { once: true });
        }
      }

      card.querySelector('.book-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`确定要移除《${book.title || book.filename}》吗？这将删除所有阅读记录、笔记和缓存。`)) {
          // v1.7.0: 删除前显式 revoke ObjectURL（不依赖 load/error 事件）
          const savedUrl = card.dataset.coverUrl;
          if (savedUrl) URL.revokeObjectURL(savedUrl);
          await EpubStorage.removeBook(book.id);
          card.remove();
          await loadBookshelf();
        }
      });

      booksContainer.appendChild(card);
    }
  }

  // v1.7.0: clearAll 改为 Promise.all 并行删除
  btnClearAll.addEventListener('click', async () => {
    if (confirm('确定要清空书架吗？所有阅读记录和本地缓存将被永久删除。')) {
      const books = await EpubStorage.getRecentBooks();
      await Promise.all(books.map(b => EpubStorage.removeBook(b.id)));
      await loadBookshelf();
    }
  });

  // --- Annotations Management ---
  async function loadAnnotations(filterType = 'all') {
    const allHighlights = await EpubStorage.getAllHighlights() || {};
    const bookKeys = Object.keys(allHighlights);

    const recentBooks = await EpubStorage.getRecentBooks();
    const bookMetaMap = {};
    for (const b of recentBooks) bookMetaMap[b.id] = b;

    let flatAnnotations = [];
    annotationsContainer.innerHTML = '';

    for (const bookId of bookKeys) {
      const highlights = allHighlights[bookId] || [];
      const bookContext = bookMetaMap[bookId] || { title: '未知书籍' };
      for (const hl of highlights) {
        hl._bookId      = bookId;
        hl._bookContext = bookContext;
        const isNoteOnly = hl.color === 'transparent';
        if (filterType === 'highlight' && isNoteOnly)  continue;
        if (filterType === 'note'      && !isNoteOnly) continue;
        flatAnnotations.push(hl);
      }
    }

    flatAnnotations.sort((a, b) =>
      currentSort === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp
    );

    for (const hl of flatAnnotations) {
      const isNoteOnly = hl.color === 'transparent';
      const item = document.createElement('div');
      item.className = 'annotation-item';
      item.innerHTML = `
        <div class="annotation-content">
          <div class="annotation-header">
            <div class="annotation-book" title="在阅读器中定位">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              ${Utils.escapeHtml(hl._bookContext.title || hl._bookContext.filename)}
            </div>
            <div class="annotation-type-badge ${isNoteOnly ? 'type-note' : 'type-hl'}" style="${isNoteOnly ? 'background-color: rgba(148, 163, 184, 0.1); color: #64748b;' : `background-color: ${sanitizeColor(hl.color)}33; color: ${sanitizeColor(hl.color)};`}">
              ${isNoteOnly ? '📝 笔记' : '🖍 标注'}
            </div>
          </div>
          <div class="annotation-quote" style="border-left-color: ${isNoteOnly ? '#94a3b8' : sanitizeColor(hl.color)}">${Utils.escapeHtml(hl.text)}</div>
          ${hl.note ? `<div class="annotation-note">${Utils.escapeHtml(hl.note)}</div>` : ''}
          <div class="annotation-footer">
            <span class="annotation-meta">创建于 ${Utils.formatDate(hl.timestamp)}</span>
            <button class="annotation-delete-btn" title="删除标注">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        </div>
      `;

      item.querySelector('.annotation-book').addEventListener('click', () => {
        if (hl._bookContext.filename) {
          window.location.href = chrome.runtime.getURL('reader/reader.html') +
            '?bookId=' + encodeURIComponent(hl._bookId) +
            '&target=' + encodeURIComponent(hl.cfi);
        }
      });

      item.querySelector('.annotation-delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('确定要删除这条标注吗？')) {
          const currentHighlights = await EpubStorage.getHighlights(hl._bookId) || [];
          await EpubStorage.saveHighlights(hl._bookId, currentHighlights.filter(h => h.cfi !== hl.cfi));
          loadAnnotations(filterType);
        }
      });

      annotationsContainer.appendChild(item);
    }

    annotationsEmpty.classList.toggle('show', flatAnnotations.length === 0);
  }

  // --- Export Annotations ---
  const btnExportAll = document.getElementById('btn-export-all');
  if (btnExportAll) {
    btnExportAll.addEventListener('click', async () => {
      const allHighlights = await EpubStorage.getAllHighlights() || {};
      const recentBooks   = await EpubStorage.getRecentBooks();
      let md = '# 📖 阅读笔记与标注\n\n导出时间：' + new Date().toLocaleString() + '\n\n';
      let hasData = false;
      for (const book of recentBooks) {
        const hls = allHighlights[book.id];
        if (hls && hls.length > 0) {
          hasData = true;
          md += `## 《${Utils.escapeHtml(book.title || book.filename)}》\n\n`;
          md += `*作者：${Utils.escapeHtml(book.author || '未知')}*\n\n`;
          hls.sort((a, b) => a.timestamp - b.timestamp).forEach(hl => {
            md += `> ${hl.text.trim().replace(/\n/g, '\n> ')}\n\n`;
            if (hl.note) md += `**✏️ 笔记**：${hl.note.trim()}\n\n`;
            md += `---\n\n`;
          });
          md += `\n\n`;
        }
      }
      if (!hasData) { alert('此时还没有可以导出的笔记！'); return; }
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `epub_notes_${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // --- Utils (local, color validation only) ---
  // v1.7.0: escapeHtml / formatDate / formatDuration 迁移至 Utils (utils.js)
  function sanitizeColor(colorStr) {
    if (!colorStr) return '#ffeb3b';
    return /^#[0-9a-fA-F]{3,8}$|^transparent$/.test(colorStr) ? colorStr : '#ffeb3b';
  }
});
