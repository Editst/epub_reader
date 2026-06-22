'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const { createMockDocument } = require('../../helpers/browser_env');

function loadGlobalConst(filePath, constName) {
  if (global[constName]) return global[constName];
  const code = fs.readFileSync(filePath, 'utf8');
  global.window = global;
  vm.runInThisContext(`${code}; global.${constName} = ${constName};`, { filename: filePath });
  return global[constName];
}

test.describe('Reader 模块基础行为', () => {
  const originalDocument = global.document;
  const originalWindow = global.window;
  const originalSetTimeout = global.setTimeout;

  test.afterEach(() => {
    global.document = originalDocument;
    global.window = originalWindow;
    global.setTimeout = originalSetTimeout;
  });

  test.it('Search 关闭进行中的搜索后会恢复搜索按钮', async () => {
    const { document } = createMockDocument([
      'search-panel',
      'sidebar-overlay',
      'search-input',
      'btn-do-search',
      'search-results-list',
      'search-status',
      'btn-search',
      'btn-search-close',
      'sidebar',
      'bookmarks-panel'
    ]);
    global.document = document;
    global.window = global;
    global.setTimeout = (fn) => {
      fn();
      return 1;
    };

    const Search = loadGlobalConst('src/reader/search.js', 'Search');
    Search.init();

    let resolveLoad;
    const loadPromise = new Promise((resolve) => {
      resolveLoad = resolve;
    });
    const item = {
      async load() {
        await loadPromise;
        return {};
      },
      find() {
        return [];
      },
      unload() {}
    };
    const book = {
      load() {},
      spine: {
        length: 1,
        get() {
          return item;
        }
      }
    };

    Search.setBook(book, {});
    document.getElementById('search-input').value = '关键词';
    document.getElementById('btn-do-search').click();

    assert.equal(document.getElementById('btn-do-search').disabled, true);

    Search.closePanel();
    resolveLoad();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(document.getElementById('btn-do-search').disabled, false);
  });

  test.it('Annotations 切书后仍可用 Escape 关闭弹窗', () => {
    const { document } = createMockDocument([
      'annotation-overlay',
      'annotation-popup',
      'annotation-body',
      'annotation-title',
      'annotation-close'
    ]);
    global.document = document;
    global.window = global;

    const Annotations = loadGlobalConst('src/reader/annotations.js', 'Annotations');
    Annotations.init();
    Annotations.mount({ book: {}, rendition: { hooks: { content: { register() {} } } } });
    Annotations.unmount();
    Annotations.mount({ book: {}, rendition: { hooks: { content: { register() {} } } } });

    const popup = document.getElementById('annotation-popup');
    const overlay = document.getElementById('annotation-overlay');
    popup.classList.add('is-visible');
    overlay.classList.add('is-visible');

    document.dispatchEvent('keydown', { key: 'Escape' });

    assert.equal(popup.classList.contains('is-visible'), false);
    assert.equal(overlay.classList.contains('is-visible'), false);
  });
});
