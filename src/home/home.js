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

  let currentPrefs = {};
  try {
    currentPrefs = await EpubStorage.getPreferences() || {};
  } catch (err) {
    console.warn('[Home] get preferences failed:', err);
  }
  let currentTheme = currentPrefs.theme === 'dark' ? 'dark' : 'light';
  let currentView  = currentPrefs.homeView === 'list' ? 'list' : 'grid';
  let bookshelfRenderSeq = 0;
  let annotationsRenderSeq = 0;

  const filterBtns = document.querySelectorAll('.filter-btn');
  const btnSortTime = document.getElementById('btn-sort-time');
  let currentSort = 'desc';

  setTheme(currentTheme);
  setView(currentView);

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadAnnotationsSafely(btn.dataset.filter);
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
      loadAnnotationsSafely(activeFilter ? activeFilter.dataset.filter : 'all');
    });
  }

  async function loadBookshelfSafely() {
    try {
      await loadBookshelf();
    } catch (err) {
      console.warn('[Home] load bookshelf failed:', err);
    }
  }

  async function loadAnnotationsSafely(filterType = 'all') {
    try {
      await loadAnnotations(filterType);
    } catch (err) {
      console.warn('[Home] load annotations failed:', err);
    }
  }

  function savePreferencesSafely(prefs) {
    EpubStorage.savePreferences(prefs).catch((err) => {
      console.warn('[Home] save preferences failed:', err);
    });
  }

  async function loadBookCardData(book) {
    const [coverBlob, meta] = await Promise.all([
      EpubStorage.getCover(book.id).catch((err) => {
        console.warn('[Home] get cover failed:', book.id, err);
        return null;
      }),
      EpubStorage.getBookMeta(book.id).catch((err) => {
        console.warn('[Home] get book meta failed:', book.id, err);
        return null;
      })
    ]);
    return { coverBlob, meta };
  }

  function releaseCoverObjectUrl(card) {
    const objectUrl = card?.dataset?.coverUrl;
    if (!objectUrl) return;
    delete card.dataset.coverUrl;
    URL.revokeObjectURL(objectUrl);
  }

  function clearRenderedBookCards() {
    booksContainer.querySelectorAll('[data-cover-url]').forEach((card) => {
      releaseCoverObjectUrl(card);
    });
    booksContainer.innerHTML = '';
  }
  window.addEventListener('pagehide', clearRenderedBookCards);

  btnTheme.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(currentTheme);
    savePreferencesSafely({ theme: currentTheme });
  });

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  btnView.addEventListener('click', () => {
    currentView = currentView === 'grid' ? 'list' : 'grid';
    setView(currentView);
    savePreferencesSafely({ homeView: currentView });
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
    e.target.value = '';
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bookId = await EpubStorage.generateBookId(file.name, arrayBuffer);
      await EpubStorage.storeFile(file.name, new Uint8Array(arrayBuffer), bookId);
      window.location.href = chrome.runtime.getURL('reader/reader.html') + '?bookId=' + encodeURIComponent(bookId);
    } catch (err) {
      console.error('[Home] Failed to open file:', err);
      alert('无法打开文件: ' + err.message);
    }
  });

  // --- Bookshelf ---
  async function loadBookshelf() {
    const renderSeq = ++bookshelfRenderSeq;
    const books = await EpubStorage.getRecentBooks();
    if (renderSeq !== bookshelfRenderSeq) return;
    bookCount.textContent = `(${books.length})`;

    if (books.length === 0) {
      clearRenderedBookCards();
      shelfEmpty.classList.add('show');
      btnClearAll.classList.add('is-hidden');
      return;
    }

    shelfEmpty.classList.remove('show');
    btnClearAll.classList.remove('is-hidden');
    renderBookshelfSkeleton(books.length);

    const tasks = books.map((book, index) => streamRenderBookCard(book, index, renderSeq));
    await Promise.all(tasks);
  }

  function renderBookshelfSkeleton(count) {
    clearRenderedBookCards();
    for (let i = 0; i < count; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'book-card skeleton-card';
      skeleton.dataset.skeletonIndex = String(i);
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

  async function streamRenderBookCard(book, index, renderSeq) {
    const { coverBlob, meta } = await loadBookCardData(book);
    if (renderSeq !== bookshelfRenderSeq) return;

    {
      const card = document.createElement('div');
      card.className = 'book-card';

      // 保存 ObjectURL 引用到 dataset，供删除时显式 revoke。
      let coverObjectUrl = null;
      if (coverBlob) {
        coverObjectUrl = URL.createObjectURL(coverBlob);
        card.dataset.coverUrl = coverObjectUrl;
      }

      // 从 bookMeta 一次读取位置与时长。
      const bookLabel = book.title || book.filename || '未知书名';
      const bookAuthor = book.author || '未知作者';
      const percent = Utils.normalizePercent(meta && meta.pos ? meta.pos.percentage : 0);
      const percentText = percent.toFixed(1);
      const timeInSeconds = (meta && meta.time) ? meta.time : 0;
      const timeHtml = Utils.formatDuration(timeInSeconds);

      card.innerHTML = `
        <div class="book-cover"></div>
        <div class="book-info">
          <div class="book-title"></div>
          <div class="book-author"></div>
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
              <span>${percentText}%</span>
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

      const coverEl = card.querySelector('.book-cover');
      if (coverEl && coverObjectUrl) {
        const coverImg = document.createElement('img');
        coverImg.className = 'cover-img';
        coverImg.alt = 'Cover';
        coverImg.addEventListener('load',  () => releaseCoverObjectUrl(card), { once: true });
        coverImg.addEventListener('error', () => releaseCoverObjectUrl(card), { once: true });
        coverImg.src = coverObjectUrl;
        coverEl.appendChild(coverImg);
      } else if (coverEl) {
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder';
        placeholder.textContent = '📖';
        coverEl.appendChild(placeholder);
      }

      const titleEl = card.querySelector('.book-title');
      if (titleEl) {
        titleEl.textContent = bookLabel;
        titleEl.title = bookLabel;
      }
      const authorEl = card.querySelector('.book-author');
      if (authorEl) authorEl.textContent = bookAuthor;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.book-delete')) return;
        window.location.href = chrome.runtime.getURL('reader/reader.html') + '?bookId=' + encodeURIComponent(book.id);
      });

      card.querySelector('.book-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`确定要移除《${bookLabel}》吗？这将删除所有阅读记录、笔记和缓存。`)) {
          // 删除前显式 revoke ObjectURL，不依赖 load/error 事件。
          releaseCoverObjectUrl(card);
          try {
            await EpubStorage.removeBook(book.id);
          } catch (err) {
            console.warn('[Home] remove book failed:', err);
          } finally {
            await loadBookshelfSafely();
          }
        }
      });

      const skeleton = booksContainer.querySelector(`.skeleton-card[data-skeleton-index="${index}"]`);
      if (skeleton) skeleton.replaceWith(card);
      else booksContainer.appendChild(card);
    }
  }

  // 所有删除任务完成后统一按权威 recentBooks 刷新，允许单本失败后继续收口。
  btnClearAll.addEventListener('click', async () => {
    if (confirm('确定要清空书架吗？所有阅读记录和本地缓存将被永久删除。')) {
      try {
        const books = await EpubStorage.getRecentBooks();
        const results = await Promise.allSettled(books.map(b => EpubStorage.removeBook(b.id)));
        const failure = results.find((result) => result.status === 'rejected');
        if (failure) console.warn('[Home] clear bookshelf failed:', failure.reason);
      } catch (err) {
        console.warn('[Home] clear bookshelf failed:', err);
      } finally {
        await loadBookshelfSafely();
      }
    }
  });

  // --- Annotations Management ---
  async function loadAnnotations(filterType = 'all') {
    const renderSeq = ++annotationsRenderSeq;
    const allHighlights = await EpubStorage.getAllHighlights() || {};
    if (renderSeq !== annotationsRenderSeq) return;
    const bookKeys = Object.keys(allHighlights);

    const recentBooks = await EpubStorage.getRecentBooks();
    if (renderSeq !== annotationsRenderSeq) return;
    const bookMetaMap = {};
    for (const b of recentBooks) bookMetaMap[b.id] = b;

    let flatAnnotations = [];
    annotationsContainer.innerHTML = '';

    for (const bookId of bookKeys) {
      const highlights = allHighlights[bookId] || [];
      const bookContext = bookMetaMap[bookId] || { title: '未知书籍' };
      for (const hl of highlights) {
        const isNoteOnly = hl.color === 'transparent';
        if (filterType === 'highlight' && isNoteOnly)  continue;
        if (filterType === 'note'      && !isNoteOnly) continue;
        flatAnnotations.push({
          ...hl,
          _bookId: bookId,
          _bookContext: bookContext
        });
      }
    }

    flatAnnotations.sort((a, b) =>
      currentSort === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp
    );

    for (const hl of flatAnnotations) {
      const isNoteOnly = hl.color === 'transparent';
      const annotationColor = isNoteOnly ? '#64748b' : Utils.resolveDisplayColor(hl.color);
      const annotationBorderColor = isNoteOnly ? '#94a3b8' : annotationColor;
      const annotationBadgeBg = isNoteOnly
        ? 'rgba(148, 163, 184, 0.1)'
        : `color-mix(in srgb, ${annotationColor} 20%, transparent)`;
      const item = document.createElement('div');
      item.className = 'annotation-item';
      item.innerHTML = `
        <div class="annotation-content">
          <div class="annotation-header">
            <div class="annotation-book" title="在阅读器中定位">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              ${Utils.escapeHtml(hl._bookContext.title || hl._bookContext.filename)}
            </div>
            <div class="annotation-type-badge ${isNoteOnly ? 'type-note' : 'type-hl'}" style="background-color: ${annotationBadgeBg}; color: ${annotationColor};">
              ${isNoteOnly ? '📝 笔记' : '🖍 标注'}
            </div>
          </div>
          <div class="annotation-quote" style="border-left-color: ${annotationBorderColor}">${Utils.escapeHtml(hl.text)}</div>
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
          try {
            const currentHighlights = await EpubStorage.getHighlights(hl._bookId) || [];
            await EpubStorage.saveHighlights(hl._bookId, currentHighlights.filter(h => h.cfi !== hl.cfi));
            loadAnnotationsSafely(filterType);
          } catch (err) {
            console.warn('[Home] remove annotation failed:', err);
          }
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
      try {
        const allHighlights = await EpubStorage.getAllHighlights() || {};
        const recentBooks   = await EpubStorage.getRecentBooks();
        let md = '# 📖 阅读笔记与标注\n\n导出时间：' + new Date().toLocaleString() + '\n\n';
        let hasData = false;
        for (const book of recentBooks) {
          const hls = allHighlights[book.id];
          if (hls && hls.length > 0) {
            hasData = true;
            md += `## 《${book.title || book.filename}》\n\n`;
            md += `*作者：${book.author || '未知'}*\n\n`;
            hls.sort((a, b) => a.timestamp - b.timestamp).forEach(hl => {
              const quote = String(hl.text || '').trim().replace(/\n/g, '\n> ');
              md += `> ${quote}\n\n`;
              if (hl.note) md += `**✏️ 笔记**：${String(hl.note).trim()}\n\n`;
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
        try {
          document.body.appendChild(a);
          a.click();
        } finally {
          a.remove();
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        console.warn('[Home] export annotations failed:', err);
      }
    });
  }

  await loadBookshelfSafely();
  await loadAnnotationsSafely('all');

});
