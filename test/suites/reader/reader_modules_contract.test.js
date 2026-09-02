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
    `${code}; result = window.${exportName};`,
    context,
    { filename: file }
  );
  return context.result;
}

test.describe('Reader 功能模块公开契约', () => {
  test.it('Highlights 延迟到 init 查询 DOM，并使用规范 IIFE 导出', () => {
    const src = fs.readFileSync('src/reader/highlights.js', 'utf8');
    const initIndex = src.indexOf('function init()');

    assert.match(src, /^\/\*[\s\S]*?\*\/\s*\(function \(\) \{\s*'use strict';/);
    assert.ok(src.indexOf("document.getElementById('selection-toolbar')") > initIndex);
    assert.ok(src.includes('window.Highlights = Highlights'));
    assert.ok(src.includes('const INTERNAL_ACTION_LOCK_MS'));
    assert.ok(src.includes('const IFRAME_CLICK_SETTLE_MS'));
    assert.ok(src.includes('const FLOATING_UI_GAP_PX'));
    assert.ok(!/FIX P\d|Issue \d|v1\.\d/.test(src), '实现注释不应保留历史版本/工单标签');
  });

  test.it('ReaderUi 键盘分支、DOM 缓存与拖放显隐保持显式一致', () => {
    const src = fs.readFileSync('src/reader/reader-ui.js', 'utf8');

    assert.match(src, /case 'b':[\s\S]*?if \(!e\.ctrlKey && !e\.metaKey\)[\s\S]*?break;\s*case 'h':/);
    assert.ok(src.includes("btnBookmark:        document.getElementById('btn-bookmark')"));
    assert.ok(src.includes("sidebarOverlay:     document.getElementById('sidebar-overlay')"));
    assert.ok(!src.includes("classList.add('hidden')"));
    assert.ok(!src.includes("classList.remove('hidden')"));
  });

  test.it('Reader 错误页保留 epub.js 挂载节点并允许原页重新导入', () => {
    const source = fs.readFileSync('src/reader/reader-ui.js', 'utf8');
    const styles = fs.readFileSync('src/reader/reader.css', 'utf8');

    assert.ok(source.includes('epubViewer.replaceChildren()'));
    assert.ok(!source.includes('epubViewer.remove()'));
    assert.ok(source.includes("readerMain.querySelector('.reader-error-wrapper')?.remove()"));
    assert.match(styles, /\.reader-main-error\s+#epub-viewer\s*\{[^}]*display:\s*none/s);
  });

  for (const [file, exportName, methods] of expectedContracts) {
    test.it(`${file} 导出文档声明的公开接口`, () => {
      const moduleApi = loadReaderModule(file, exportName);
      methods.forEach((method) => {
        assert.equal(typeof moduleApi[method], 'function', `${exportName}.${method} 应为函数`);
      });
    });
  }

  test.it('Reader 功能模块统一暴露为 window.XXX', () => {
    for (const [file, exportName] of expectedContracts) {
      const context = createReaderModuleContext();
      vm.createContext(context);
      const code = fs.readFileSync(file, 'utf8');
      vm.runInContext(code, context, { filename: file });
      assert.equal(typeof context.window[exportName], 'object', `${exportName} 应挂载到 window.${exportName}`);
    }
  });

  test.it('共享侧栏状态只由 ReaderUi 统一控制，子模块不直接刺探兄弟面板', () => {
    const toc = fs.readFileSync('src/reader/toc.js', 'utf8');
    const bookmarks = fs.readFileSync('src/reader/bookmarks.js', 'utf8');
    const search = fs.readFileSync('src/reader/search.js', 'utf8');

    assert.ok(!toc.includes("document.getElementById('bookmarks-panel')"));
    assert.ok(!toc.includes("document.getElementById('search-panel')"));
    assert.ok(!bookmarks.includes("document.getElementById('search-panel')"));
    assert.ok(!search.includes("document.getElementById('bookmarks-panel')"));
  });

  test.it('ReaderPersistence 导出 flushSessionBundle 聚合原子刷盘方法', () => {
    const src = fs.readFileSync('src/reader/reader-persistence.js', 'utf8');
    assert.match(src, /flushSessionBundle,\s*updateReadingStats/,
      'ReaderPersistence 必须导出 flushSessionBundle');
  });

  test.it('ReaderUi 与 reader.css 支持重排平滑过渡类 .reader-reflowing', () => {
    const ui = fs.readFileSync('src/reader/reader-ui.js', 'utf8');
    const css = fs.readFileSync('src/reader/reader.css', 'utf8');

    assert.match(ui, /dom\.readerMain\?\.classList\.add\('reader-reflowing'\)/,
      '进入重排时必须为 readerMain 添加 reader-reflowing 类');
    assert.match(ui, /dom\.readerMain\?\.classList\.remove\('reader-reflowing'\)/,
      '重排结束与失败时必须清理 reader-reflowing 类');
    assert.ok(css.includes('.reader-reflowing'), 'reader.css 必须声明 .reader-reflowing 样式');
  });
});
