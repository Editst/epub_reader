/**
 * Bookmarks Module
 * Allows users to bookmark pages and manage bookmarks
 */
const Bookmarks = {
  bookId: '',
  book: null,
  rendition: null,
  panel: null,
  listEl: null,

  init() {
    this.panel = document.getElementById('bookmarks-panel');
    this.listEl = document.getElementById('bookmarks-list');

    // Panel toggle
    document.getElementById('btn-bookmarks').addEventListener('click', () => this.togglePanel());
    document.getElementById('btn-bookmarks-close').addEventListener('click', () => this.closePanel());
  },

  setBook(bookId, book, rendition) {
    this.bookId = bookId;
    this.book = book;
    this.rendition = rendition;
    this.loadBookmarks();
  },

  async getBookmarks() {
    // D-1-F: Delegate to EpubStorage to enforce unified storage access policy.
    return EpubStorage.getBookmarks(this.bookId);
  },

  async saveBookmarks(bookmarks) {
    // D-1-F: Delegate to EpubStorage.
    return EpubStorage.saveBookmarks(this.bookId, bookmarks);
  },

  async toggle(cfi, chapterName, progress) {
    let bookmarks = await this.getBookmarks();
    const existing = bookmarks.findIndex(b => b.cfi === cfi);

    if (existing >= 0) {
      bookmarks.splice(existing, 1);
    } else {
      bookmarks.push({
        cfi,
        chapter: chapterName,
        progress: Math.round(progress * 1000) / 10,
        timestamp: Date.now()
      });
      // Sort by progress
      bookmarks.sort((a, b) => a.progress - b.progress);
    }

    await this.saveBookmarks(bookmarks);
    this.renderList(bookmarks);
  },

  async isBookmarked(cfi) {
    const bookmarks = await this.getBookmarks();
    return bookmarks.some(b => b.cfi === cfi);
  },

  async loadBookmarks() {
    const bookmarks = await this.getBookmarks();
    this.renderList(bookmarks);
  },

  renderList(bookmarks) {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    if (bookmarks.length === 0) {
      this.listEl.innerHTML = '<div class="bookmarks-empty">暂无书签<br><span>按 B 键或点击书签按钮添加</span></div>';
      return;
    }

    bookmarks.forEach((bm) => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      item.innerHTML = `
        <div class="bookmark-item-info">
          <div class="bookmark-item-chapter">${this._escapeHtml(bm.chapter || '未知章节')}</div>
          <div class="bookmark-item-meta">${bm.progress}% · ${this._formatDate(bm.timestamp)}</div>
        </div>
        <button class="bookmark-item-remove" title="删除书签">✕</button>
      `;

      item.querySelector('.bookmark-item-info').addEventListener('click', () => {
        if (this.rendition) {
          this.rendition.display(bm.cfi);
          this.closePanel();
        }
      });

      item.querySelector('.bookmark-item-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        let bms = await this.getBookmarks();
        bms = bms.filter(b => b.cfi !== bm.cfi);
        await this.saveBookmarks(bms);
        this.renderList(bms);
      });

      this.listEl.appendChild(item);
    });
  },

  togglePanel() {
    if (this.panel.classList.contains('open')) {
      this.closePanel();
    } else {
      // FIX P1-C: Bookmarks previously toggled its own panel without touching
      // the shared sidebar-overlay or closing other panels, allowing TOC, Search,
      // and Bookmarks to all be open simultaneously with no backdrop.
      // Close every other panel first, then show this one with the overlay.
      const sidebar     = document.getElementById('sidebar');
      const searchPanel = document.getElementById('search-panel');
      if (sidebar)     sidebar.classList.remove('open');
      if (searchPanel) searchPanel.classList.remove('open');

      this.panel.classList.add('open');
      const overlay = document.getElementById('sidebar-overlay');
      if (overlay) overlay.classList.add('visible');

      this.loadBookmarks();
    }
  },

  closePanel() {
    this.panel.classList.remove('open');
    // FIX P1-C: Only hide the overlay when no other panel is still open.
    const tocOpen    = document.getElementById('sidebar')?.classList.contains('open');
    const searchOpen = document.getElementById('search-panel')?.classList.contains('open');
    if (!tocOpen && !searchOpen) {
      const overlay = document.getElementById('sidebar-overlay');
      if (overlay) overlay.classList.remove('visible');
    }
  },

  reset() {
    this.closePanel();
    this.bookId = '';
    this.book = null;
    this.rendition = null;
    if (this.listEl) this.listEl.innerHTML = '';
  },

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  _formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
};
