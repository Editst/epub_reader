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

  test.it('Annotations 技术债收敛约束', () => {
    const src = fs.readFileSync('src/reader/annotations.js', 'utf8');
    const css = fs.readFileSync('src/reader/reader.css', 'utf8');

    assert.match(src, /const _BLOCK_TAGS = new Set/, '_BLOCK_TAGS 应为模块级 Set');
    assert.match(src, /const _PAGINATION_SETTLE_MS = 100/, '分页补偿等待时间应提取为具名常量');
    assert.match(src, /const _MAX_FOOTNOTE_TEXT = 2000/, '注释内容安全阀应保持模块级常量');
    assert.match(src, /const _EMPTY_ANCHOR_BOUNDARY_TAGS = new Set/, '空锚点收集边界应保持模块级 Set');
    assert.match(src, /const _FOOTNOTE_SECTION_CACHE_LIMIT = 50/, '跨文档注释缓存容量应保持显式上限');
    assert.match(src, /const _DOCUMENT_POSITION_PRECEDING = 2/, '同文档目标顺序判断应使用具名 DOM bit 常量');
    assert.ok(src.includes('body[name="notes"]'), 'FB2 notes body 应纳入注释容器识别');
    assert.ok(src.includes('body[name="comments"]'), 'FB2 comments body 应纳入注释容器识别');
    assert.match(src, /_sectionDocCache: new Map\(\)/, '跨文档注释缓存应挂在模块生命周期内');
    assert.match(src, /function _hasSup\(link\)/, 'sup 判断应集中到 _hasSup');
    assert.match(src, /function _parseHref\(href\)/, 'href 片段解析应集中到 _parseHref');
    assert.match(src, /function _isFourDigitNumberMarker\(text\)/, '四位数字 marker 应集中判断并排除年份误判');
    assert.match(src, /function _isSameDocumentTargetBeforeSource\(link, targetEl\)/, '同文档目标前置判断应集中到辅助函数');
    assert.match(src, /function _collectAfterEmptyAnchor\(anchor\)/, '空锚点内容收集应集中到辅助函数');
    assert.match(src, /_clearSectionCache\(\)/, '切书和卸载应复用注释缓存清理方法');
    assert.match(src, /_getCachedSectionDocument\(cacheKey\)/, '缓存读取应集中并刷新 LRU 顺序');
    assert.match(src, /_rememberSectionDocument\(cacheKey, loaded\)/, '缓存写入应集中并执行容量淘汰');
    assert.match(src, /_loadSectionDocument\(section, activeLoad, cacheKey, cancelToken, context\)/, 'section 加载应统一经过缓存辅助');
    assert.match(src, /while \(this\._sectionDocCache\.size > _FOOTNOTE_SECTION_CACHE_LIMIT\)/, '跨文档注释缓存应执行 LRU 容量淘汰');
    assert.match(src, /!isTargetBeforeSource && _RE\.noteFragPos\.test\(fragment\)/, '目标在源前时只能压低 class/fragment 弱阳性');
    assert.ok(src.includes('(\\d{1,3}|'), '纯数字脚注 marker 应限制为 1-3 位');
    assert.ok(!src.includes('(\\d{1,4}|'), '不得重新把四位年份纳入纯数字脚注 marker');
    assert.equal((src.match(/split\('#'\)/g) || []).length, 0, '不得在 _parseHref 外散落 split("#")');
    assert.ok(!src.includes('<p style='), '注释 fallback 提示不得使用 inline style');
    assert.ok(!src.includes('setTimeout(r, 100)'), '不得直接散落分页补偿魔法数字');
    assert.ok(src.includes('annotation-fallback-hint'), 'fallback 提示应使用 CSS class');
    assert.ok(css.includes('.annotation-fallback-hint'), 'reader.css 应定义 fallback 提示样式');
  });
});
