// Popup logic - file picker and recent books
// v1.7.0: escapeHtml / formatDate 迁移至 Utils (utils.js)

document.addEventListener('DOMContentLoaded', async () => {
  const openBtn   = document.getElementById('open-btn');
  const homeBtn   = document.getElementById('home-btn');
  const fileInput = document.getElementById('file-input');
  const recentList= document.getElementById('recent-list');
  const emptyState= document.getElementById('empty-state');

  await loadRecentBooks();

  openBtn.addEventListener('click', () => fileInput.click());
  homeBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
    window.close();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    const bookId = await EpubStorage.generateBookId(file.name, arrayBuffer);
    await EpubStorage.storeFile(file.name, new Uint8Array(arrayBuffer), bookId);
    chrome.tabs.create({
      url: chrome.runtime.getURL('reader/reader.html') + '?bookId=' + encodeURIComponent(bookId)
    });
    window.close();
  });

  async function loadRecentBooks() {
    const books = await EpubStorage.getRecentBooks();
    if (books.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';
    recentList.innerHTML = '';

    for (const book of books) {
      const item = document.createElement('div');
      item.className = 'recent-item';

      const coverBlob = await EpubStorage.getCover(book.id);
      let coverObjectUrl = null;
      let coverHtml;
      if (coverBlob) {
        coverObjectUrl = URL.createObjectURL(coverBlob);
        coverHtml = `<img class="cover-img" src="${coverObjectUrl}" alt="Cover">`;
      } else {
        coverHtml = '📖';
      }

      // v1.7.0: getBookMeta 一次读取 pos（合并原来的 getPosition 调用）
      const meta = await EpubStorage.getBookMeta(book.id);
      const progressText = (meta && meta.pos && meta.pos.percentage)
        ? `${meta.pos.percentage}%` : '';

      item.innerHTML = `
        <div class="recent-item-icon">${coverHtml}</div>
        <div class="recent-item-info">
          <div class="recent-item-title" title="${Utils.escapeHtml(book.title || book.filename)}">${Utils.escapeHtml(book.title || book.filename)}</div>
          <div class="recent-item-date">${Utils.escapeHtml(book.author || '未知作者')}</div>
          <div class="recent-item-date" style="margin-top:2px;">${Utils.formatDate(book.lastOpened, '')}</div>
        </div>
        ${progressText ? `<div class="recent-item-progress">${progressText}</div>` : ''}
        <button class="recent-item-remove" title="移除">✕</button>
      `;

      if (coverObjectUrl) {
        const coverImg = item.querySelector('.cover-img');
        if (coverImg) {
          coverImg.addEventListener('load',  () => URL.revokeObjectURL(coverObjectUrl), { once: true });
          coverImg.addEventListener('error', () => URL.revokeObjectURL(coverObjectUrl), { once: true });
        }
      }

      item.querySelector('.recent-item-info').addEventListener('click', () => {
        chrome.tabs.create({
          url: chrome.runtime.getURL('reader/reader.html') + '?bookId=' + encodeURIComponent(book.id)
        });
        window.close();
      });

      item.querySelector('.recent-item-remove').addEventListener('click', async (e) => {
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
