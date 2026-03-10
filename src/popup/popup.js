// Popup logic - file picker and recent books

document.addEventListener('DOMContentLoaded', async () => {
  const openBtn = document.getElementById('open-btn');
  const homeBtn = document.getElementById('home-btn');
  const fileInput = document.getElementById('file-input');
  const recentList = document.getElementById('recent-list');
  const emptyState = document.getElementById('empty-state');

  // Load recent books
  await loadRecentBooks();

  // Open file button click
  openBtn.addEventListener('click', () => {
    fileInput.click();
  });

  // Home shelf button click
  homeBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('home/home.html') });
    window.close();
  });

  // File selected
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Read file as ArrayBuffer and store temporarily
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Store in IndexedDB for transfer to reader page
    await storeFileData(file.name, uint8Array);

    // Open reader page
    const readerUrl = chrome.runtime.getURL('reader/reader.html') +
      '?file=' + encodeURIComponent(file.name);
    chrome.tabs.create({ url: readerUrl });
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
    // Process items sequentially to resolve all async cover getters
    for (const book of books) {
      const item = document.createElement('div');
      item.className = 'recent-item';
      
      // Fetch cover
      // FIX P1-E: Pair createObjectURL with revokeObjectURL via img load/error events.
      const coverBlob = await EpubStorage.getCover(book.id);
      let coverObjectUrl = null;
      let coverHtml;
      if (coverBlob) {
        coverObjectUrl = URL.createObjectURL(coverBlob);
        coverHtml = `<img class="cover-img" src="${coverObjectUrl}" alt="Cover">`;
      } else {
        coverHtml = '📖';
      }

      // Fetch progress
      const pos = await EpubStorage.getPosition(book.id);
      const progressText = (pos && pos.percentage) ? `${pos.percentage}%` : '';

      item.innerHTML = `
        <div class="recent-item-icon">${coverHtml}</div>
        <div class="recent-item-info">
          <div class="recent-item-title" title="${escapeHtml(book.title || book.filename)}">${escapeHtml(book.title || book.filename)}</div>
          <div class="recent-item-date">${escapeHtml(book.author || '未知作者')}</div>
          <div class="recent-item-date" style="margin-top:2px;">${formatDate(book.lastOpened)}</div>
        </div>
        ${progressText ? `<div class="recent-item-progress">${progressText}</div>` : ''}
        <button class="recent-item-remove" title="移除">✕</button>
      `;

      // Revoke blob URL as soon as the image loads (or fails)
      if (coverObjectUrl) {
        const coverImg = item.querySelector('.cover-img');
        if (coverImg) {
          coverImg.addEventListener('load',  () => URL.revokeObjectURL(coverObjectUrl), { once: true });
          coverImg.addEventListener('error', () => URL.revokeObjectURL(coverObjectUrl), { once: true });
        }
      }

      // Click to reopen - pass filename so reader loads from IndexedDB
      item.querySelector('.recent-item-info').addEventListener('click', () => {
        const readerUrl = chrome.runtime.getURL('reader/reader.html') +
          '?file=' + encodeURIComponent(book.filename);
        chrome.tabs.create({ url: readerUrl });
        window.close();
      });

      // Remove from recent
      item.querySelector('.recent-item-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        // FIX P1-G: The old code only cleaned up recent-list, position, reading-time
        // and the file blob — it silently left behind highlights, bookmarks and the
        // cover image.  EpubStorage.removeBook() performs a complete cascading
        // delete (recentBook + position + readingTime + cover + highlights +
        // bookmarks + locations + file) so storage stays consistent no matter
        // which surface the user removes the book from.
        await EpubStorage.removeBook(book.id, book.filename);

        item.remove();
        const remaining = await EpubStorage.getRecentBooks();
        if (remaining.length === 0) {
          emptyState.style.display = 'block';
          recentList.appendChild(emptyState);
        }
      });

      recentList.appendChild(item);
    } // end for loop
  }
});

// Store file data in IndexedDB for transfer to reader page
// Maintains a maximum of 5 books to prevent excessive disk space usage
function storeFileData(filename, uint8Array) {
  return EpubStorage.storeFile(filename, uint8Array).then(async () => {
    if (EpubStorage.enforceFileLRU) await EpubStorage.enforceFileLRU(10);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';

  return date.toLocaleDateString('zh-CN');
}
