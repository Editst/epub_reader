/**
 * src/popup/popup.js
 * Popup 快速入口 — 最近书籍列表 + 打开新书
 */

document.addEventListener('DOMContentLoaded', () => {
  const openBtn    = document.getElementById('open-btn');
  const homeBtn    = document.getElementById('home-btn');
  const fileInput  = document.getElementById('file-input');
  const recentList = document.getElementById('recent-list');
  const emptyState = document.getElementById('empty-state');
  let recentBooksRenderSeq = 0;

  // ── 打开新书 ───────────────────────────────────────────────────────────────
  // showOpenFilePicker 需要 "transient user activation"，在 async click handler
  // 里经过任何 await（包括 loadRecentBooks 的异步等待）后激活状态即失效，
  // 导致调用静默失败（DevTools 打开时限制放宽故能通过，这是根本症状来源）。
  // fileInput.click() 在 click handler 的同步调用栈中触发，无此限制。
  openBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileInput.value = '';
    await _processFile(file);
  });

  homeBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
    window.close();
  });

  loadRecentBooksSafely();

  function releaseCoverObjectUrl(item) {
    const objectUrl = item?.dataset?.coverUrl;
    if (!objectUrl) return;
    delete item.dataset.coverUrl;
    URL.revokeObjectURL(objectUrl);
  }

  function clearRenderedRecentItems() {
    recentList.querySelectorAll('[data-cover-url]').forEach((item) => {
      releaseCoverObjectUrl(item);
    });
    recentList.innerHTML = '';
  }

  function showEmptyState() {
    clearRenderedRecentItems();
    recentList.appendChild(emptyState);
    emptyState.style.display = 'block';
  }

  function loadRecentBooksSafely() {
    const renderSeq = ++recentBooksRenderSeq;
    return loadRecentBooks(renderSeq).catch((e) => {
      if (renderSeq !== recentBooksRenderSeq) return;
      console.warn('[Popup] loadRecentBooks failed:', e);
      showEmptyState();
    });
  }

  async function _processFile(file) {
    try {
      openBtn.disabled = true;
      const arrayBuffer = await file.arrayBuffer();
      const bookId = await EpubStorage.generateBookId(file.name, arrayBuffer);
      await EpubStorage.storeFile(file.name, new Uint8Array(arrayBuffer), bookId);
      chrome.tabs.create({
        url: chrome.runtime.getURL('reader/reader.html') + '?bookId=' + encodeURIComponent(bookId)
      });
      window.close();
    } catch (e) {
      console.error('[Popup] Failed to process EPUB:', e);
      openBtn.disabled = false;
    }
  }

  // ── 最近书籍列表（并行加载） ───────────────────────────────────────────────
  async function loadRecentBooks(renderSeq) {
    const books = await EpubStorage.getRecentBooks();
    if (renderSeq !== recentBooksRenderSeq) return;
    if (books.length === 0) {
      showEmptyState();
      return;
    }

    // 逐项容错：单本封面/元数据加载失败不影响整个列表渲染。
    const dataList = await Promise.all(books.map(async (book) => {
      const [coverBlob, meta] = await Promise.all([
        EpubStorage.getCover(book.id).catch(() => null),
        EpubStorage.getBookMeta(book.id).catch(() => null)
      ]);
      return { book, coverBlob, meta };
    }));
    if (renderSeq !== recentBooksRenderSeq) return;

    emptyState.style.display = 'none';
    clearRenderedRecentItems();

    for (const { book, coverBlob, meta } of dataList) {
      const item = document.createElement('div');
      item.className = 'recent-item';

      // 封面
      const iconEl = document.createElement('div');
      iconEl.className = 'recent-item-icon';
      let coverObjectUrl = null;
      if (coverBlob) {
        coverObjectUrl = URL.createObjectURL(coverBlob);
        item.dataset.coverUrl = coverObjectUrl;
        const img = document.createElement('img');
        img.className = 'cover-img';
        img.alt = 'Cover';
        img.addEventListener('load',  () => releaseCoverObjectUrl(item), { once: true });
        img.addEventListener('error', () => releaseCoverObjectUrl(item), { once: true });
        img.src = coverObjectUrl;
        iconEl.appendChild(img);
      } else {
        iconEl.textContent = '📖';
      }

      // 书目信息
      const infoEl = document.createElement('div');
      infoEl.className = 'recent-item-info';

      const titleEl = document.createElement('div');
      titleEl.className = 'recent-item-title';
      titleEl.title = book.title || book.filename || '';
      titleEl.textContent = book.title || book.filename || '未知书名';

      const authorEl = document.createElement('div');
      authorEl.className = 'recent-item-date';
      authorEl.textContent = book.author || '未知作者';

      const dateEl = document.createElement('div');
      dateEl.className = 'recent-item-date recent-item-opened-at';
      dateEl.textContent = Utils.formatDate(book.lastOpened, '');

      infoEl.append(titleEl, authorEl, dateEl);

      // 移除按钮
      const removeBtn = document.createElement('button');
      removeBtn.className = 'recent-item-remove';
      removeBtn.title = '移除';
      removeBtn.textContent = '✕';

      item.append(iconEl, infoEl);

      // 进度
      if (meta && meta.pos && meta.pos.percentage != null) {
        const percent = Utils.normalizePercent(meta.pos.percentage);
        const progressEl = document.createElement('div');
        progressEl.className = 'recent-item-progress';
        progressEl.textContent = percent.toFixed(1) + '%';
        item.appendChild(progressEl);
      }

      item.appendChild(removeBtn);

      infoEl.addEventListener('click', () => {
        chrome.tabs.create({
          url: chrome.runtime.getURL('reader/reader.html') + '?bookId=' + encodeURIComponent(book.id)
        });
        window.close();
      });

      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await EpubStorage.removeBook(book.id);
        } catch (err) {
          console.warn('[Popup] remove recent book failed:', err);
        } finally {
          releaseCoverObjectUrl(item);
          await loadRecentBooksSafely();
        }
      });

      recentList.appendChild(item);
    }
  }
});
