/**
 * Bookmarks Module
 * Allows users to bookmark pages and manage bookmarks
 */
(function () {
  'use strict';

  const Bookmarks = {
  bookId: '',
  rendition: null,
  navigate: null,
  panelController: null,
  panel: null,
  listEl: null,
  _boundDocument: null,
  _loadSeq: 0,

  init() {
    this.panel = document.getElementById('bookmarks-panel');
    this.listEl = document.getElementById('bookmarks-list');

    if (this._boundDocument === document) return;
    this._boundDocument = document;

    // Panel toggle
    document.getElementById('btn-bookmarks')?.addEventListener('click', () => this.togglePanel());
    document.getElementById('btn-bookmarks-close')?.addEventListener('click', () => this.closePanel());
  },

  mount(context) {
    if (!context) return;
    this.navigate = typeof context.navigate === 'function' ? context.navigate : null;
    this.panelController = context.panelController || null;
    this.setBook(context.bookId, context.rendition);
  },

  unmount() {
    this.reset();
  },

  setBook(bookId, rendition) {
    this.bookId = bookId;
    this.rendition = rendition;
    this._loadBookmarksSafely();
  },

  async toggle(cfi, chapterName, progress) {
    const bookId = this.bookId;
    let bookmarks = await EpubStorage.getBookmarks(bookId);
    if (bookId !== this.bookId) return;
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

    await EpubStorage.saveBookmarks(bookId, bookmarks);
    if (bookId !== this.bookId) return;
    this.renderList(bookmarks);
  },

  async isBookmarked(cfi) {
    const bookId = this.bookId;
    const bookmarks = await EpubStorage.getBookmarks(bookId);
    if (bookId !== this.bookId) return false;
    return bookmarks.some(b => b.cfi === cfi);
  },

  async loadBookmarks() {
    const bookId = this.bookId;
    const loadSeq = ++this._loadSeq;
    const bookmarks = await EpubStorage.getBookmarks(bookId);
    if (loadSeq !== this._loadSeq || bookId !== this.bookId) return;
    this.renderList(bookmarks);
  },

  _loadBookmarksSafely() {
    this.loadBookmarks().catch((err) => {
      console.warn('[Bookmarks] load bookmarks failed:', err);
    });
  },

  renderList(bookmarks) {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    if (bookmarks.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'bookmarks-empty';
      emptyEl.innerHTML = '暂无书签<br><span>按 B 键或点击书签按钮添加</span>';
      this.listEl.appendChild(emptyEl);
      return;
    }

    bookmarks.forEach((bm) => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';

      const info = document.createElement('div');
      info.className = 'bookmark-item-info';

      const chapter = document.createElement('div');
      chapter.className = 'bookmark-item-chapter';
      chapter.textContent = bm.chapter || '未知章节';

      const meta = document.createElement('div');
      meta.className = 'bookmark-item-meta';
      meta.textContent = `${bm.progress}% · ${Utils.formatDateTime(bm.timestamp)}`;

      info.append(chapter, meta);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'bookmark-item-remove';
      removeBtn.title = '删除书签';
      removeBtn.textContent = '✕';

      item.append(info, removeBtn);

      info.addEventListener('click', () => {
        if (this.rendition) {
          this._navigateTo(bm.cfi);
          this.closePanel();
        }
      });

      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const bookId = this.bookId;
          let bms = await EpubStorage.getBookmarks(bookId);
          if (bookId !== this.bookId) return;
          bms = bms.filter(b => b.cfi !== bm.cfi);
          await EpubStorage.saveBookmarks(bookId, bms);
          if (bookId !== this.bookId) return;
          this.renderList(bms);
        } catch (err) {
          console.warn('[Bookmarks] remove bookmark failed:', err);
        }
      });

      this.listEl.appendChild(item);
    });
  },

  togglePanel() {
    if (this.panel.classList.contains('open')) {
      this.closePanel();
    } else {
      if (this.panelController) {
        this.panelController.openExclusivePanel(this.panel);
      } else {
        this.panel?.classList.add('open');
      }

      this._loadBookmarksSafely();
    }
  },

  closePanel() {
    if (this.panelController) {
      this.panelController.closePanelWithOverlayCheck(this.panel);
      return;
    }
    this.panel?.classList.remove('open');
  },

  _navigateTo(target) {
    const navigate = this.navigate || ((value) => this.rendition?.display(value));
    try {
      Promise.resolve(navigate(target)).catch((err) => {
        console.warn('[Bookmarks] navigation failed:', err);
      });
    } catch (err) {
      console.warn('[Bookmarks] navigation failed:', err);
    }
  },

  reset() {
    this.closePanel();
    this._loadSeq++;
    this.bookId = '';
    this.rendition = null;
    this.navigate = null;
    if (this.listEl) this.listEl.innerHTML = '';
  }
  };

  window.Bookmarks = Bookmarks;
})();
