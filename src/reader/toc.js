/**
 * Table of Contents Module
 * Builds and manages the sidebar TOC from epub.js navigation
 */
(function () {
  'use strict';

  const TOC = {
  container: null,
  sidebar: null,
  overlay: null,
  rendition: null,
  navigate: null,
  panelController: null,
  _boundDocument: null,

  init() {
    this.container = document.getElementById('toc-container');
    this.sidebar = document.getElementById('sidebar');
    this.overlay = document.getElementById('sidebar-overlay');

    if (this._boundDocument === document) return;
    this._boundDocument = document;

    // Toggle buttons
    document.getElementById('btn-toc')?.addEventListener('click', () => this.toggle());
    document.getElementById('btn-toc-close')?.addEventListener('click', () => this.close());

    // ReaderUi 的 document click 会统一关闭共享面板；初始化早期先关闭 TOC 自身。
    this.overlay?.addEventListener('click', () => {
      this.close();
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement;
        const tag = active ? active.tagName : '';
        if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA' && !active?.isContentEditable) {
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
    this.navigate = typeof context.navigate === 'function' ? context.navigate : null;
    this.panelController = context.panelController || null;
    this.build(context.book.navigation, context.rendition);
  },

  unmount() {
    this.reset();
  },

  build(navigation, rendition) {
    if (!this.container) return;
    this.rendition = rendition;
    this.container.innerHTML = '';

    if (!navigation || !navigation.toc || navigation.toc.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'toc-empty';
      emptyEl.textContent = '本书没有目录';
      this.container.appendChild(emptyEl);
      return;
    }

    const hasFragment = typeof document.createDocumentFragment === 'function';
    const fragment = hasFragment ? document.createDocumentFragment() : this.container;
    this._buildItems(navigation.toc, 1, fragment);
    if (hasFragment) {
      this.container.appendChild(fragment);
    }
  },

  /**
   * Recursively build TOC items
   * @param {Array} items - TOC items
   * @param {number} level - Nesting level
   * @param {DocumentFragment|HTMLElement} targetContainer
   */
  _buildItems(items, level, targetContainer = this.container) {
    if (!items || !targetContainer) return;
    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = `toc-item toc-item-level-${Math.min(level, 3)}`;
      el.textContent = ReaderState.getTocItemLabel(item);
      el.dataset.href = item.href;

      el.addEventListener('click', () => {
        if (this.rendition) {
          this._navigateTo(item.href);
          this.close();
        }
      });

      targetContainer.appendChild(el);

      // Recursively add sub-items
      if (item.subitems && item.subitems.length > 0) {
        this._buildItems(item.subitems, level + 1, targetContainer);
      }
    });
  },

  /**
   * Highlight the current chapter in TOC
   * @param {string} href - Current section href
   */
  setActive(href) {
    if (!this.container) return;
    const items = this.container.querySelectorAll('.toc-item');

    items.forEach((item) => {
      item.classList.remove('active');
      const itemHref = item.dataset.href;
      if (ReaderState.isTocHrefMatch(href, itemHref)) {
        item.classList.add('active');
        if (this.sidebar?.classList.contains('open') && typeof item.scrollIntoView === 'function') {
          item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    });
  },

  toggle() {
    if (this.sidebar?.classList.contains('open')) {
      this.close();
    } else {
      this.open();
    }
  },

  open() {
    if (this.panelController) {
      this.panelController.openExclusivePanel(this.sidebar);
    } else {
      this.sidebar?.classList.add('open');
      this.overlay?.classList.add('visible');
    }
    const activeItem = this.container?.querySelector('.toc-item.active');
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  },

  close() {
    if (this.panelController) {
      this.panelController.closePanelWithOverlayCheck(this.sidebar);
      return;
    }
    this.sidebar?.classList.remove('open');
    this.overlay?.classList.remove('visible');
  },

  _navigateTo(target) {
    return ReaderState.safeNavigate(this.navigate, this.rendition, target, 'TOC');
  },

  reset() {
    this.close();
    if (this.container) this.container.innerHTML = '';
    this.rendition = null;
    this.navigate = null;
  }
  };

  window.TOC = TOC;
})();
