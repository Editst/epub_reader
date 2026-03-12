/**
 * src/popup/popup.js
 * Popup 快速入口 — 最近书籍列表 + 打开新书
 *
 * v1.8.0 变更：
 *   [BUG-01] 改用 showOpenFilePicker API，消除 Chrome popup 失焦导致的首次选文件无反应。
 *            降级策略：API 不可用时回退至隐藏 input 方案。
 *   [TD-2.4] 封面加载改为 Promise.all 并行，消除串行 for-await 导致的弹窗打开慢。
 *   DOM 构建由 innerHTML 改为显式 DOM API（配合 Utils.escapeHtml 已无必要的拼接路径）。
 *
 * v1.9.3 变更：
 *   [BUG-B] loadRecentBooks() 缺少顶层 try/catch。v1.9.2 为 storage._get/_set 加入
 *           chrome.runtime.lastError 检查后，存储操作出错会 reject 而非静默返回。
 *           若 loadRecentBooks() reject，DOMContentLoaded 回调将在 await 处中断，
 *           其后的 openBtn.addEventListener 永远不会注册，导致点击「打开文件」
 *           毫无反应。修复：用 try/catch 包裹 await loadRecentBooks()，
 *           并对内部的 getCover/getBookMeta 并行加载逐项容错（单本失败不影响整体）。
 */

document.addEventListener('DOMContentLoaded', async () => {
  const openBtn    = document.getElementById('open-btn');
  const homeBtn    = document.getElementById('home-btn');
  const fileInput  = document.getElementById('file-input');
  const recentList = document.getElementById('recent-list');
  const emptyState = document.getElementById('empty-state');

  // v1.9.3: try/catch 确保书架加载失败时不中断后续事件注册
  try {
    await loadRecentBooks();
  } catch (e) {
    console.warn('[Popup] loadRecentBooks failed:', e);
    emptyState.style.display = 'block';
  }

  // ── 打开新书 ───────────────────────────────────────────────────────────────
  // v1.9.3: 放弃 showOpenFilePicker。
  // showOpenFilePicker 需要"transient user activation"，在 async click handler
  // 里经过任何 await（包括 loadRecentBooks 的异步等待）后激活状态即失效，
  // 导致调用静默失败（DevTools 打开时限制放宽故能通过，这是根本症状来源）。
  // fileInput.click() 在 click handler 的同步调用栈中触发，无此限制。
  openBtn.addEventListener('click', () => {
    fileInput.click();
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

    // v1.9.3: 逐项容错——单本封面/元数据加载失败不影响整个列表渲染
    const dataList = await Promise.all(books.map(async (book) => {
      const [coverBlob, meta] = await Promise.all([
        EpubStorage.getCover(book.id).catch(() => null),
        EpubStorage.getBookMeta(book.id).catch(() => null)
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
