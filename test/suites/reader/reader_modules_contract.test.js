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

  test.it('ReaderRuntime 将 locations 初始化与后台生成从打开主流程拆出', () => {
    const src = fs.readFileSync('src/reader/reader-runtime.js', 'utf8');

    assert.ok(src.includes('function _applyLocationsProgress(initSpeedTracking)'));
    assert.ok(src.includes('function _initLocationsFromCache(cachedLocsJSON, cachedLocationsLoaded, initSpeedTracking)'));
    assert.ok(src.includes('function _scheduleLocationsGeneration(bookId, fileData, activeBook, initSpeedTracking)'));
    assert.ok(src.includes('let layoutSeq = 0'));
    assert.ok(src.includes('state.isLayoutStable = false'));
    assert.ok(src.includes('layoutId === layoutSeq'));
  });

  test.it('Reader 持久化与书签复用直接依赖，源码不保留归档文件引用', () => {
    const persistence = fs.readFileSync('src/reader/reader-persistence.js', 'utf8');
    const bookmarks = fs.readFileSync('src/reader/bookmarks.js', 'utf8');
    const highlights = fs.readFileSync('src/reader/highlights.js', 'utf8');
    const readerSources = fs.readdirSync('src/reader')
      .filter((name) => name.endsWith('.js'))
      .map((name) => fs.readFileSync(`src/reader/${name}`, 'utf8'))
      .join('\n');

    assert.ok(!persistence.includes('function _savePosition('));
    assert.ok(persistence.includes('Utils.safeWrite('));
    assert.ok(highlights.includes('Utils.safeWrite('));
    assert.ok(bookmarks.includes('Utils.formatDateTime(bm.timestamp)'));
    assert.ok(!bookmarks.includes('_formatDate('));
    assert.ok(!readerSources.includes('reader-full.js'));
    assert.ok(!readerSources.includes('EPUB Reader v2.1'));
  });

  test.it('Reader 功能模块不保留从未读取的书籍上下文字段', () => {
    const highlights = fs.readFileSync('src/reader/highlights.js', 'utf8');
    const bookmarks = fs.readFileSync('src/reader/bookmarks.js', 'utf8');
    const toc = fs.readFileSync('src/reader/toc.js', 'utf8');

    assert.ok(!highlights.includes('let _fileName'));
    assert.ok(highlights.includes('async function setBookDetails(bookId, rendition)'));
    assert.ok(highlights.includes('return setBookDetails(context.bookId, context.rendition)'));
    assert.ok(!highlights.includes('setBookDetails(context.bookId, context.fileName'));
    assert.ok(!fs.readFileSync('src/reader/reader-runtime.js', 'utf8')
      .includes('fileName: state.currentFileName'));
    assert.ok(!bookmarks.includes('book: null'));
    assert.ok(!bookmarks.includes('this.book ='));
    assert.ok(!bookmarks.includes('async getBookmarks()'));
    assert.ok(!bookmarks.includes('async saveBookmarks('));
    assert.ok(bookmarks.includes('setBook(bookId, rendition)'));
    assert.ok(!bookmarks.includes('context.book, context.rendition'));
    assert.ok(!toc.includes('currentHref'));
    assert.ok(!toc.includes("typeof closeAllPanels === 'function'"));
    assert.ok(toc.includes('ReaderState.getTocItemLabel(item)'));
    assert.ok(!fs.readFileSync('src/reader/search.js', 'utf8').includes('panel: () => panel'));
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
    assert.match(src, /function _isCrossDocumentTargetBeforeSource\(ctx, sectionHref\)/, '跨文档 spine 前置判断应集中到辅助函数');
    assert.match(src, /function _checkFootnoteTextSignals\(/, '脚注文本与 href 启发式应从主判定函数拆出');
    assert.match(src, /function _checkFootnoteStructuralSignals\(/, '脚注结构判定应从主判定函数拆出');
    assert.match(src, /function _resolveRelativeSectionHref\(baseHref, href\)/, '跨文档相对 href 解析应集中处理');
    assert.match(src, /function _indexSpineContext\(ctx, book, contents\)/, 'spine href 索引应在文档上下文阶段一次性构建');
    assert.match(src, /function _collectAfterEmptyAnchor\(anchor\)/, '空锚点内容收集应集中到辅助函数');
    assert.match(src, /currentSpineIndex\s+:\s+-1/, 'DocContext 应携带当前 spine index');
    assert.match(src, /spineIndexesByHref\s+:\s+new Map\(\)/, 'DocContext 应携带 href 到 spine index 的映射');
    assert.match(src, /_clearSectionCache\(\)/, '切书和卸载应复用注释缓存清理方法');
    assert.match(src, /_getCachedSectionDocument\(cacheKey\)/, '缓存读取应集中并刷新 LRU 顺序');
    assert.match(src, /_rememberSectionDocument\(cacheKey, loaded\)/, '缓存写入应集中并执行容量淘汰');
    assert.match(src, /_loadSectionDocument\(section, activeLoad, cacheKey, cancelToken, context\)/, 'section 加载应统一经过缓存辅助');
    assert.match(src, /while \(this\._sectionDocCache\.size > _FOOTNOTE_SECTION_CACHE_LIMIT\)/, '跨文档注释缓存应执行 LRU 容量淘汰');
    assert.match(src, /_isCrossDocumentTargetBeforeSource\(ctx, parsedHref\.sectionHref\)/, '跨文档目标前置只能作为分类弱负向信号');
    assert.match(src, /!isTargetBeforeSource && _RE\.noteFragPos\.test\(fragment\)/, '目标在源前时只能压低 class/fragment 弱阳性');
    assert.ok(src.includes('(\\d{1,3}|'), '纯数字脚注 marker 应限制为 1-3 位');
    assert.ok(!src.includes('(\\d{1,4}|'), '不得重新把四位年份纳入纯数字脚注 marker');
    assert.equal((src.match(/split\('#'\)/g) || []).length, 0, '不得在 _parseHref 外散落 split("#")');
    assert.ok(!src.includes('<p style='), '注释 fallback 提示不得使用 inline style');
    assert.ok(!src.includes('setTimeout(r, 100)'), '不得直接散落分页补偿魔法数字');
    assert.ok(src.includes('annotation-fallback-hint'), 'fallback 提示应使用 CSS class');
    assert.ok(css.includes('.annotation-fallback-hint'), 'reader.css 应定义 fallback 提示样式');
  });

  test.it('共享侧栏状态只由 ReaderUi 控制', () => {
    const ui = fs.readFileSync('src/reader/reader-ui.js', 'utf8');
    const toc = fs.readFileSync('src/reader/toc.js', 'utf8');
    const bookmarks = fs.readFileSync('src/reader/bookmarks.js', 'utf8');
    const search = fs.readFileSync('src/reader/search.js', 'utf8');

    assert.ok(ui.includes('function openExclusivePanel(panelElement)'));
    assert.ok(ui.includes('function closePanelWithOverlayCheck(panelElement)'));
    assert.ok(!ui.includes('window.closeAllPanels'));
    assert.ok(!toc.includes("document.getElementById('bookmarks-panel')"));
    assert.ok(!toc.includes("document.getElementById('search-panel')"));
    assert.ok(!bookmarks.includes("document.getElementById('search-panel')"));
    assert.ok(!search.includes("document.getElementById('bookmarks-panel')"));
  });

  test.it('Search 性能保护约束', () => {
    const src = fs.readFileSync('src/reader/search.js', 'utf8');

    assert.match(src, /const _SEARCH_MAX_RESULTS = 1000/, '搜索最大结果数应保持模块级常量');
    assert.match(src, /const _SEARCH_UI_YIELD_MS = 10/, '搜索 UI 让步间隔应保持模块级常量');
    assert.match(src, /const _SEARCH_FOCUS_DELAY_MS = 100/, '搜索面板聚焦延迟应保持模块级常量');
    assert.match(src, /const remaining = _SEARCH_MAX_RESULTS - results\.length/, '每章搜索结果应按剩余额度裁剪');
    assert.match(src, /const cappedResults = itemResults\.slice\(0, remaining\)/, '单章超量结果不得全部渲染');
    assert.ok(!src.includes('const MAX_RESULTS = 1000'), '不得在 doSearch 内重新定义结果上限');
    assert.ok(!src.includes('setTimeout(r, 10)'), '不得散落搜索让步魔法数字');
    assert.match(src, /}, _SEARCH_FOCUS_DELAY_MS\);/, '搜索聚焦延迟应使用具名常量');
    assert.match(src, /function cancelPendingFocus\(\)/, '搜索延迟聚焦清理应集中到辅助函数');
    assert.match(src, /clearTimeout\(focusTimerId\)/, '关闭或切书时必须取消待执行聚焦 timer');
    assert.match(src, /function setBook\(b, r\) \{\s*cancelPendingFocus\(\)/, '切书不得继承上一上下文的延迟聚焦');
    assert.match(src, /function closePanel\(\) \{\s*cancelPendingFocus\(\)/, '关闭面板必须先取消延迟聚焦');
  });
});
