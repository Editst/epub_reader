'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const { createMockDocument, createMockElement } = require('../../helpers/browser_env');

const expectedContracts = [
  ['src/reader/annotations.js', 'Annotations', ['init', 'setBook', 'hookRendition']],
  ['src/reader/bookmarks.js', 'Bookmarks', ['init', 'setBook', 'toggle', 'isBookmarked', 'mount', 'unmount']],
  ['src/reader/highlights.js', 'Highlights', ['init', 'setBookDetails', 'closePanels', 'mount', 'unmount']],
  ['src/reader/image-viewer.js', 'ImageViewer', ['init', 'hookRendition', 'open', 'close', 'mount', 'unmount']],
  ['src/reader/search.js', 'Search', ['init', 'setBook', 'togglePanel', 'closePanel', 'reset', 'mount', 'unmount']],
  ['src/reader/toc.js', 'TOC', ['init', 'build', 'setActive', 'open', 'close', 'toggle', 'reset', 'mount', 'unmount']]
];

const readerElementIds = [
  'annotation-overlay',
  'annotation-popup',
  'annotation-body',
  'annotation-title',
  'annotation-close',
  'bookmarks-panel',
  'bookmarks-list',
  'btn-bookmarks',
  'btn-bookmarks-close',
  'image-viewer',
  'image-viewer-img',
  'image-viewer-container',
  'image-viewer-close',
  'img-zoom-in',
  'img-zoom-out',
  'img-zoom-reset',
  'selection-toolbar',
  'btn-add-note',
  'btn-clear-hl',
  'note-popup',
  'note-textarea',
  'btn-cancel-note',
  'btn-save-note',
  'btn-show-toolbar',
  'search-panel',
  'sidebar-overlay',
  'search-input',
  'btn-do-search',
  'search-results-list',
  'search-status',
  'btn-search',
  'btn-search-close',
  'sidebar',
  'toc-container',
  'btn-toc',
  'btn-toc-close'
];

function createReaderModuleContext() {
  const { document } = createMockDocument(readerElementIds);
  const colorButtons = ['#ffeb3b', '#81c784', '#64b5f6'].map((color) => {
    const btn = createMockElement(`color-${color}`, 'button');
    btn.dataset.color = color;
    btn.className = 'color-btn';
    btn.classList.add('color-btn');
    return btn;
  });
  document.getElementById('selection-toolbar').querySelectorAll = (selector) => {
    return selector === '.color-btn' ? colorButtons : [];
  };

  const context = {
    console,
    document,
    EpubStorage: {
      async getBookmarks() { return []; },
      async saveBookmarks() {},
      async getHighlights() { return []; },
      async saveHighlights() {}
    },
    Utils: {
      sanitizeColor(color) { return color; }
    },
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {}
  };
  context.window = context;
  return context;
}

function loadReaderModule(file, exportName) {
  const context = createReaderModuleContext();
  vm.createContext(context);
  const code = fs.readFileSync(file, 'utf8');
  vm.runInContext(
    `${code}; result = (typeof ${exportName} !== 'undefined' ? ${exportName} : window.${exportName});`,
    context,
    { filename: file }
  );
  return context.result;
}

test.describe('Reader 功能模块公开契约', () => {
  for (const [file, exportName, methods] of expectedContracts) {
    test.it(`${file} 导出文档声明的公开接口`, () => {
      const moduleApi = loadReaderModule(file, exportName);
      methods.forEach((method) => {
        assert.equal(typeof moduleApi[method], 'function', `${exportName}.${method} 应为函数`);
      });
    });
  }
});
