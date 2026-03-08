// Popup logic - file picker and recent books

document.addEventListener('DOMContentLoaded', async () => {
  const openBtn = document.getElementById('open-btn');
  const fileInput = document.getElementById('file-input');
  const recentList = document.getElementById('recent-list');
  const emptyState = document.getElementById('empty-state');

  // Load recent books
  await loadRecentBooks();

  // Open file button click
  openBtn.addEventListener('click', () => {
    fileInput.click();
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
    books.forEach((book) => {
      const item = document.createElement('div');
      item.className = 'recent-item';
      item.innerHTML = `
        <div class="recent-item-icon">📖</div>
        <div class="recent-item-info">
          <div class="recent-item-title">${escapeHtml(book.title || book.filename)}</div>
          <div class="recent-item-meta">
            <span class="recent-item-author">${escapeHtml(book.author || '')}</span>
            <span class="recent-item-date">${formatDate(book.lastOpened)}</span>
          </div>
        </div>
        <button class="recent-item-remove" title="移除">✕</button>
      `;

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
        await EpubStorage.removeRecentBook(book.id);
        item.remove();
        const remaining = await EpubStorage.getRecentBooks();
        if (remaining.length === 0) {
          emptyState.style.display = 'block';
          recentList.appendChild(emptyState);
        }
      });

      recentList.appendChild(item);
    });
  }
});

// Store file data in IndexedDB for transfer to reader page
// Maintains a maximum of 5 books to prevent excessive disk space usage
function storeFileData(filename, uint8Array) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('EpubReaderDB', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'name' });
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      
      // Put the new file
      store.put({ name: filename, data: uint8Array, timestamp: Date.now() });
      
      // Cleanup old files (keep only the 5 most recent)
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const files = getAllReq.result;
        if (files.length > 5) {
          files.sort((a, b) => b.timestamp - a.timestamp);
          for (let i = 5; i < files.length; i++) {
            store.delete(files[i].name);
          }
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
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
