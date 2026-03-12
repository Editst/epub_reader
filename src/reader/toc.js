/**
 * Table of Contents Module
 * Builds and manages the sidebar TOC from epub.js navigation
 */
const TOC = {
  container: null,
  sidebar: null,
  overlay: null,
  rendition: null,
  currentHref: '',

  init() {
    this.container = document.getElementById('toc-container');
    this.sidebar = document.getElementById('sidebar');
    this.overlay = document.getElementById('sidebar-overlay');

    // Toggle buttons
    document.getElementById('btn-toc').addEventListener('click', () => this.toggle());
    document.getElementById('btn-toc-close').addEventListener('click', () => this.close());

    // FIX P1-B: The overlay is shared by TOC, Search, and Bookmarks.
    // Clicking it should close ALL open panels, not just TOC.
    // We defer to closeAllPanels() (defined in reader.js) which already
    // handles every panel and the overlay in one consistent call.
    this.overlay.addEventListener('click', () => {
      if (typeof closeAllPanels === 'function') closeAllPanels();
      else this.close(); // fallback if called before reader.js initialises
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Only if no input is focused
        if (document.activeElement.tagName !== 'INPUT' &&
            document.activeElement.tagName !== 'SELECT' &&
            document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          this.toggle();
        }
      }
    });
  },

  /**
   * Build TOC from epub.js navigation
   * @param {object} navigation - epub.js book.navigation
   * @param {object} rendition - epub.js rendition
   */
  mount(context) {
    if (!context?.book || !context?.rendition) return;
    this.build(context.book.navigation, context.rendition);
  },

  unmount() {
    this.reset();
  },

  build(navigation, rendition) {
    this.rendition = rendition;
    this.container.innerHTML = '';

    if (!navigation || !navigation.toc || navigation.toc.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'toc-empty';
      emptyEl.textContent = '本书没有目录';
      this.container.appendChild(emptyEl);
      return;
    }

    this._buildItems(navigation.toc, 1);
  },

  /**
   * Recursively build TOC items
   * @param {Array} items - TOC items
   * @param {number} level - Nesting level
   */
  _buildItems(items, level) {
    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = `toc-item toc-item-level-${Math.min(level, 3)}`;
      el.textContent = item.label.trim();
      el.dataset.href = item.href;

      el.addEventListener('click', () => {
        if (this.rendition) {
          this.rendition.display(item.href);
          this.close();
        }
      });

      this.container.appendChild(el);

      // Recursively add sub-items
      if (item.subitems && item.subitems.length > 0) {
        this._buildItems(item.subitems, level + 1);
      }
    });
  },

  /**
   * Highlight the current chapter in TOC
   * @param {string} href - Current section href
   */
  setActive(href) {
    this.currentHref = href;
    const items = this.container.querySelectorAll('.toc-item');

    items.forEach((item) => {
      item.classList.remove('active');
      // Match by href (may contain #fragment)
      const itemHref = item.dataset.href;
      if (itemHref === href || href.includes(itemHref) || itemHref.includes(href.split('#')[0])) {
        item.classList.add('active');
      }
    });
  },

  toggle() {
    if (this.sidebar.classList.contains('open')) {
      this.close();
    } else {
      this.open();
    }
  },

  open() {
    this.sidebar.classList.add('open');
    this.overlay.classList.add('visible');
  },

  close() {
    this.sidebar.classList.remove('open');
    // FIX P1-B: Only hide the overlay when no other panel (Search, Bookmarks)
    // is still open.  Removing it unconditionally would leave Search/Bookmarks
    // panels floating without a backdrop.
    const searchOpen    = document.getElementById('search-panel')?.classList.contains('open');
    const bookmarksOpen = document.getElementById('bookmarks-panel')?.classList.contains('open');
    if (!searchOpen && !bookmarksOpen) {
      this.overlay.classList.remove('visible');
    }
  },

  reset() {
    this.close();
    if (this.container) this.container.innerHTML = '';
    this.rendition = null;
  }
};
