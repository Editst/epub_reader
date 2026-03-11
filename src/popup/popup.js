/**
 * src/popup/popup.js
 * Popup 快速入口 — 最近书籍列表 + 打开新书
 *
 * v1.8.0 变更：
 *   [BUG-01] 改用 showOpenFilePicker API，消除 Chrome popup 失焦导致的首次选文件无反应。
 *            降级策略：API 不可用时回退至隐藏 input 方案。
 *   [TD-2.4] 封面加载改为 Promise.all 并行，消除串行 for-await 导致的弹窗打开慢。
 *   DOM 构建由 innerHTML 改为显式 DOM API（配合 Utils.escapeHtml 已无必要的拼接路径）。
 */

document.addEventListener('DOMContentLoaded', async () => {
  const openBtn    = document.getElementById('open-btn');
  const homeBtn    = document.getElementById('home-btn');
  const fileInput  = document.getElementById('file-input');
  const recentList = document.getElementById('recent-list');
  const emptyState = document.getElementById('empty-state');

  await loadRecentBooks();

  // ── 打开新书 ───────────────────────────────────────────────────────────────
  openBtn.addEventListener('click', async () => {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          types: [{ description: 'EPUB Files', accept: { 'application/epub+zip': ['.epub'] } }],
          multiple: false
        });
        const file = await fileHandle.getFile();
        await _processFile(file);
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.warn('[Popup] showOpenFilePicker failed, falling back:', e);
          fileInput.click();
        }
      }
    } else {
      fileInput.click();
    }
  });

  // 降级路径
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
  async function loadRecentBooks() {
    const books = await EpubStorage.getRecentBooks();
    if (books.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';
    recentList.innerHTML = '';

    // v1.8.0: Promise.all 并行加载 cover + meta（原串行 for-await）
    const dataList = await Promise.all(books.map(async (book) => {
      const [coverBlob, meta] = await Promise.all([
        EpubStorage.getCover(book.id),
        EpubStorage.getBookMeta(book.id)
      ]);
      return { book, coverBlob, meta };
    }));

    for (const { book, coverBlob, meta } of dataList) {
      const item = document.createElement('div');
      item.className = 'recent-item';

      // 封面
      const iconEl = document.createElement('div');
      iconEl.className = 'recent-item-icon';
      let coverObjectUrl = null;
      if (coverBlob) {
        coverObjectUrl = URL.createObjectURL(coverBlob);
        const img = document.createElement('img');
        img.className = 'cover-img';
        img.alt = 'Cover';
        img.src = coverObjectUrl;
        img.addEventListener('load',  () => URL.revokeObjectURL(coverObjectUrl), { once: true });
        img.addEventListener('error', () => URL.revokeObjectURL(coverObjectUrl), { once: true });
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
      dateEl.className = 'recent-item-date';
      dateEl.style.marginTop = '2px';
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
        const progressEl = document.createElement('div');
        progressEl.className = 'recent-item-progress';
        progressEl.textContent = meta.pos.percentage.toFixed(1) + '%';
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
        await EpubStorage.removeBook(book.id);
        item.remove();
        const remaining = await EpubStorage.getRecentBooks();
        if (remaining.length === 0) {
          emptyState.style.display = 'block';
          recentList.appendChild(emptyState);
        }
      });

      recentList.appendChild(item);
    }
  }
});
