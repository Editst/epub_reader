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

function loadIsolatedConst(filePath, constName, context = {}) {
  const code = fs.readFileSync(filePath, 'utf8');
  const sandbox = { result: null, console, ...context };
  sandbox.window = sandbox.window || sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${code}; result = ${constName};`, sandbox, { filename: filePath });
  return sandbox.result;
}

function loadIsolatedWindowExport(filePath, exportName, context = {}) {
  const code = fs.readFileSync(filePath, 'utf8');
  const sandbox = { result: null, console, ...context };
  sandbox.window = sandbox.window || sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${code}; result = window.${exportName};`, sandbox, { filename: filePath });
  return sandbox.result;
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

  test.it('Annotations 同一个 rendition 不会重复注册 content hook', () => {
    const Annotations = loadGlobalConst('src/reader/annotations.js', 'Annotations');
    const callbacks = [];
    const rendition = {
      hooks: {
        content: {
          register(fn) {
            callbacks.push(fn);
          }
        }
      }
    };

    Annotations.hookRendition(rendition);
    Annotations.hookRendition(rendition);

    assert.equal(callbacks.length, 1);
  });

  test.it('ImageViewer 同一个 rendition 不重复注册 hook，且补绑定当前 iframe 图片', () => {
    const ImageViewer = loadIsolatedConst('src/reader/image-viewer.js', 'ImageViewer');
    const callbacks = [];
    const imageListeners = [];
    const image = {
      tagName: 'IMG',
      src: 'blob:image',
      classList: { add() {} },
      addEventListener(type, fn) {
        if (type === 'click') imageListeners.push(fn);
      }
    };
    const doc = {
      querySelectorAll(selector) {
        return selector === 'img, image, svg image' ? [image] : [];
      }
    };
    const rendition = {
      hooks: {
        content: {
          register(fn) {
            callbacks.push(fn);
          }
        }
      },
      getContents() {
        return [{ document: doc }];
      }
    };

    ImageViewer.hookRendition(rendition);
    ImageViewer.hookRendition(rendition);

    assert.equal(callbacks.length, 1);
    assert.equal(imageListeners.length, 1);
  });

  test.it('TOC setActive 精确匹配 href，不把 ch1 误标为 ch10', () => {
    const { document } = createMockDocument([
      'toc-container',
      'sidebar',
      'sidebar-overlay',
      'btn-toc',
      'btn-toc-close',
      'bookmarks-panel',
      'search-panel'
    ]);
    const context = { document };
    const TOC = loadIsolatedWindowExport('src/reader/toc.js', 'TOC', context);
    TOC.init();
    TOC.build({
      toc: [
        { label: '第一章', href: 'text/ch1.xhtml' },
        { label: '第十章', href: 'text/ch10.xhtml' }
      ]
    }, { display() {} });

    TOC.setActive('text/ch10.xhtml#p1');
    const items = document.getElementById('toc-container').querySelectorAll('.toc-item');

    assert.equal(items.length, 2);
    assert.equal(items[0].classList.contains('active'), false);
    assert.equal(items[1].classList.contains('active'), true);
  });

  test.it('TOC 打开时关闭兄弟面板并显示共享遮罩', () => {
    const { document } = createMockDocument([
      'toc-container',
      'sidebar',
      'sidebar-overlay',
      'btn-toc',
      'btn-toc-close',
      'bookmarks-panel',
      'search-panel'
    ]);
    const TOC = loadIsolatedWindowExport('src/reader/toc.js', 'TOC', { document });
    TOC.init();
    document.getElementById('bookmarks-panel').classList.add('open');
    document.getElementById('search-panel').classList.add('open');

    TOC.open();

    assert.equal(document.getElementById('sidebar').classList.contains('open'), true);
    assert.equal(document.getElementById('bookmarks-panel').classList.contains('open'), false);
    assert.equal(document.getElementById('search-panel').classList.contains('open'), false);
    assert.equal(document.getElementById('sidebar-overlay').classList.contains('visible'), true);
  });

  test.it('Bookmarks 打开/关闭时维护共享遮罩与兄弟面板状态', async () => {
    const { document } = createMockDocument([
      'bookmarks-panel',
      'bookmarks-list',
      'btn-bookmarks',
      'btn-bookmarks-close',
      'sidebar',
      'sidebar-overlay',
      'search-panel'
    ]);
    const saved = [];
    const Bookmarks = loadIsolatedWindowExport('src/reader/bookmarks.js', 'Bookmarks', {
      document,
      EpubStorage: {
        async getBookmarks() { return saved; },
        async saveBookmarks(_bookId, bookmarks) {
          saved.splice(0, saved.length, ...bookmarks);
        }
      }
    });
    Bookmarks.init();
    Bookmarks.setBook('book-1', {}, { display() {} });
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('search-panel').classList.add('open');

    Bookmarks.togglePanel();
    await Promise.resolve();

    assert.equal(document.getElementById('bookmarks-panel').classList.contains('open'), true);
    assert.equal(document.getElementById('sidebar').classList.contains('open'), false);
    assert.equal(document.getElementById('search-panel').classList.contains('open'), false);
    assert.equal(document.getElementById('sidebar-overlay').classList.contains('visible'), true);

    document.getElementById('sidebar').classList.add('open');
    Bookmarks.closePanel();
    assert.equal(document.getElementById('sidebar-overlay').classList.contains('visible'), true);

    document.getElementById('sidebar').classList.remove('open');
    Bookmarks.closePanel();
    assert.equal(document.getElementById('sidebar-overlay').classList.contains('visible'), false);
  });

  test.it('Search 增量渲染会追加多章节结果，不清空已有结果', async () => {
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

    const items = [
      {
        async load() {},
        find() { return [{ cfi: 'epubcfi(/6/2)', excerpt: '第一处关键词' }]; },
        unload() {}
      },
      {
        async load() {},
        find() { return [{ cfi: 'epubcfi(/6/4)', excerpt: '第二处关键词' }]; },
        unload() {}
      }
    ];
    const book = {
      load() {},
      spine: {
        length: items.length,
        get(index) { return items[index]; }
      }
    };

    Search.setBook(book, { annotations: { remove() {}, highlight() {} }, display() {} });
    document.getElementById('search-input').value = '关键词';
    document.getElementById('btn-do-search').click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const resultsList = document.getElementById('search-results-list');
    assert.equal(resultsList.children.length, 2);
    assert.match(document.getElementById('search-status').textContent, /共找到 2 个结果/);
  });
});
