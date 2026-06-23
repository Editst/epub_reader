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
});
