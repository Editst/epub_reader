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
  vm.runInThisContext(
    `${code}; global.${constName} = (typeof ${constName} !== 'undefined' ? ${constName} : window.${constName});`,
    { filename: filePath }
  );
  return global[constName];
}

function loadIsolatedConst(filePath, constName, context = {}) {
  const code = fs.readFileSync(filePath, 'utf8');
  const sandbox = { result: null, console, ...context };
  sandbox.window = sandbox.window || sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    `${code}; result = (typeof ${constName} !== 'undefined' ? ${constName} : window.${constName});`,
    sandbox,
    { filename: filePath }
  );
  return sandbox.result;
}

function loadIsolatedWindowExport(filePath, exportName, context = {}) {
  const code = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    result: null,
    console,
    Utils: global.Utils,
    ReaderState: global.ReaderState,
    ...context
  };
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

  test.it('Search 快速关闭面板后取消延迟聚焦', () => {
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
    let delayedFocus = null;
    const clearedTimers = [];
    let focusCount = 0;
    document.getElementById('search-input').focus = () => { focusCount++; };

    const Search = loadIsolatedWindowExport('src/reader/search.js', 'Search', {
      document,
      setTimeout(fn) {
        delayedFocus = fn;
        return 7;
      },
      clearTimeout(timerId) {
        clearedTimers.push(timerId);
      }
    });

    Search.init();
    Search.setBook({ spine: { length: 0 } }, {});
    Search.togglePanel();
    Search.closePanel();
    delayedFocus();

    assert.deepEqual(clearedTimers, [7], '关闭面板应取消待执行的聚焦 timer');
    assert.equal(focusCount, 0, '迟到 timer 不得聚焦已关闭的搜索面板');
  });

  test.it('Search 切书后旧搜索结果不会回写新书', async () => {
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
    const Search = loadIsolatedWindowExport('src/reader/search.js', 'Search', {
      document,
      setTimeout(fn) {
        fn();
        return 1;
      }
    });

    let resolveOldLoad;
    const oldItem = {
      async load() {
        await new Promise((resolve) => { resolveOldLoad = resolve; });
      },
      find() {
        return [{ cfi: 'old-cfi', excerpt: '旧书关键词' }];
      },
      unload() {}
    };
    const oldBook = {
      load() {},
      spine: {
        length: 1,
        get() { return oldItem; }
      }
    };
    const newBook = {
      load() {},
      spine: {
        length: 0,
        get() { return null; }
      }
    };

    Search.init();
    Search.setBook(oldBook, { annotations: { remove() {}, highlight() {} }, display() {} });
    document.getElementById('search-input').value = '关键词';
    document.getElementById('btn-do-search').click();
    await Promise.resolve();

    assert.equal(document.getElementById('btn-do-search').disabled, true);
    assert.equal(typeof resolveOldLoad, 'function');

    Search.setBook(newBook, { annotations: { remove() {}, highlight() {} }, display() {} });
    resolveOldLoad();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(document.getElementById('btn-do-search').disabled, false);
    assert.equal(document.getElementById('search-results-list').children.length, 0);
    assert.equal(document.getElementById('search-status').textContent, '');
  });

  test.it('Search 切书时清理旧 rendition 上的搜索高亮', async () => {
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
    const Search = loadIsolatedWindowExport('src/reader/search.js', 'Search', {
      document,
      setTimeout(fn) {
        fn();
        return 1;
      }
    });
    const removed = [];
    const oldRendition = {
      annotations: {
        highlight() {},
        remove(cfi, type) {
          removed.push({ owner: 'old', cfi, type });
        }
      },
      display() {}
    };
    const newRendition = {
      annotations: {
        highlight() {},
        remove(cfi, type) {
          removed.push({ owner: 'new', cfi, type });
        }
      },
      display() {}
    };
    const oldBook = {
      load() {},
      spine: {
        length: 1,
        get() {
          return {
            async load() {},
            find() {
              return [{ cfi: 'old-cfi', excerpt: '旧书关键词' }];
            },
            unload() {}
          };
        }
      }
    };

    Search.init();
    Search.setBook(oldBook, oldRendition);
    document.getElementById('search-input').value = '关键词';
    document.getElementById('btn-do-search').click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const resultItem = document.getElementById('search-results-list').children[0];
    assert.ok(resultItem);
    resultItem.click();

    Search.setBook({ load() {}, spine: { length: 0, get() { return null; } } }, newRendition);

    assert.deepEqual(removed, [{ owner: 'old', cfi: 'old-cfi', type: 'highlight' }]);
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

  test.it('Annotations 注释弹窗会移除主动内容、样式与书内属性', () => {
    const { document } = createMockDocument([
      'annotation-overlay',
      'annotation-popup',
      'annotation-body',
      'annotation-title',
      'annotation-close'
    ]);

    const originalCreateElement = document.createElement;
    document.createElement = (tag) => {
      if (String(tag).toLowerCase() !== 'template') return originalCreateElement(tag);

      let raw = '';
      const elements = [];
      const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const attrPattern = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;

      function syncElements() {
        elements.splice(0);
        raw.replace(/<([a-z0-9:-]+)([^>]*)>/gi, (_tagMatch, tagName, attrsText) => {
          const attrs = [];
          attrsText.replace(attrPattern, (_attrMatch, name, dq, sq, bare) => {
            attrs.push({ name, value: dq ?? sq ?? bare ?? '' });
            return '';
          });
          elements.push({
            tagName: tagName.toUpperCase(),
            attributes: attrs,
            removeAttribute(name) {
              const attrRe = new RegExp(`\\s+${escapeRegExp(name)}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]*))?`, 'gi');
              raw = raw.replace(attrRe, '');
            },
            setAttribute(name, value) {
              const attrRe = new RegExp(`(\\s+${escapeRegExp(name)}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]*)`, 'i');
              raw = raw.replace(attrRe, `$1"${value}"`);
            },
            remove() {
              const escapedTag = escapeRegExp(tagName);
              const paired = new RegExp(`<${escapedTag}\\b[^>]*>[\\s\\S]*?<\\/${escapedTag}\\s*>`, 'gi');
              const single = new RegExp(`<${escapedTag}\\b[^>]*\\/?>`, 'gi');
              raw = raw.replace(paired, '').replace(single, '');
            }
          });
          return '';
        });
      }

      return {
        content: {
          querySelectorAll() {
            syncElements();
            return elements;
          }
        },
        set innerHTML(value) { raw = value; },
        get innerHTML() { return raw; }
      };
    };

    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations', { document });
    Annotations.init();
    Annotations._displayContent(
      '<style>body{display:none}</style><iframe srcdoc="危险"></iframe>' +
        '<a href=javascript:alert(1) onclick=alert(2)>危险</a>' +
        '<p class="book-style" style="position:fixed" onmouseover="alert(3)">安全正文</p>' +
        '<img src="java\nscript:alert(4)" onerror="alert(5)">',
      'chapter.xhtml#note'
    );

    const html = document.getElementById('annotation-body').innerHTML;
    assert.doesNotMatch(html, /javascript:/i);
    assert.doesNotMatch(html, /<(?:style|iframe|img)\b/i);
    assert.doesNotMatch(html, /\s(?:on\w+|style|class|href|src|srcdoc)\s*=/i);
    assert.match(html, /安全正文/);
  });

  test.it('Annotations 可识别 CSS vertical-align 上标脚注链接', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const ownerDocument = {
      defaultView: {
        getComputedStyle(el) {
          return { verticalAlign: el === link ? 'super' : 'baseline' };
        }
      }
    };
    const link = {
      textContent: 'a',
      className: '',
      id: '',
      parentElement: { tagName: 'SPAN' },
      firstElementChild: null,
      ownerDocument,
      getAttribute(name) {
        if (name === 'href') return 'notes.xhtml#target';
        return '';
      },
      getAttributeNS() { return ''; },
      closest() { return null; },
      querySelector() { return null; }
    };
    const ctx = {
      isGlobalTocDoc: false,
      hasTocLinks: false,
      tocLinkNodes: new WeakSet(),
      hasFootnoteSections: false,
      footnoteSectionNodes: new WeakSet(),
      hasNavBlocks: false,
      doc: null
    };

    assert.equal(Annotations.isFootnoteLink(link, ctx), true);
  });

  test.it('Annotations 排除扁平段落中的孤立长链接', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const parent = { tagName: 'P', textContent: 'Long Appendix Notes' };
    const link = {
      textContent: 'Long Appendix Notes',
      className: '',
      id: '',
      parentElement: parent,
      firstElementChild: null,
      ownerDocument: {
        defaultView: {
          getComputedStyle() {
            return { verticalAlign: 'baseline' };
          }
        }
      },
      getAttribute(name) {
        if (name === 'href') return 'notes.xhtml#note1';
        return '';
      },
      getAttributeNS() { return ''; },
      closest(selector) {
        if (selector === 'sup' || selector === 'nav') return null;
        if (selector === 'p, li, div, dd, td') return parent;
        return null;
      },
      querySelector() { return null; }
    };
    const ctx = {
      isGlobalTocDoc: false,
      hasTocLinks: false,
      tocLinkNodes: new WeakSet(),
      hasFootnoteSections: false,
      footnoteSectionNodes: new WeakSet(),
      hasNavBlocks: false,
      doc: null
    };

    assert.equal(Annotations.isFootnoteLink(link, ctx), false);
  });

  test.it('Annotations 排除正文中的四位年份数字链接', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const parent = { tagName: 'P', textContent: 'The year 1984 appears in this paragraph.' };
    const link = {
      textContent: '1984',
      className: '',
      id: '',
      parentElement: parent,
      firstElementChild: null,
      ownerDocument: {
        defaultView: {
          getComputedStyle() {
            return { verticalAlign: 'baseline' };
          }
        }
      },
      getAttribute(name) {
        if (name === 'href') return '#note1984';
        return '';
      },
      getAttributeNS() { return ''; },
      closest(selector) {
        if (selector === 'sup' || selector === 'nav') return null;
        if (selector === 'p, li, div, dd, td') return parent;
        return null;
      },
      querySelector() { return null; }
    };
    const ctx = {
      isGlobalTocDoc: false,
      hasTocLinks: false,
      tocLinkNodes: new WeakSet(),
      hasFootnoteSections: false,
      footnoteSectionNodes: new WeakSet(),
      hasNavBlocks: false,
      doc: {
        getElementById() {
          return {
            tagName: 'DIV',
            className: 'note',
            getAttribute() { return ''; },
            getAttributeNS() { return ''; },
            closest() { return null; }
          };
        }
      }
    };

    assert.equal(Annotations.isFootnoteLink(link, ctx), false);
  });

  test.it('Annotations 保留 epub:type noteref 的四位数字脚注', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const link = {
      textContent: '2023',
      className: '',
      id: '',
      parentElement: { tagName: 'SPAN', textContent: '2023' },
      firstElementChild: null,
      ownerDocument: {
        defaultView: {
          getComputedStyle() {
            return { verticalAlign: 'baseline' };
          }
        }
      },
      getAttribute(name) {
        if (name === 'href') return '#note2023';
        if (name === 'epub:type') return 'noteref';
        return '';
      },
      getAttributeNS() { return ''; },
      closest() { return null; },
      querySelector() { return null; }
    };
    const ctx = {
      isGlobalTocDoc: false,
      hasTocLinks: false,
      tocLinkNodes: new WeakSet(),
      hasFootnoteSections: false,
      footnoteSectionNodes: new WeakSet(),
      hasNavBlocks: false,
      doc: null
    };

    assert.equal(Annotations.isFootnoteLink(link, ctx), true);
  });

  test.it('Annotations 显式 noteref 语义不被长文本弱负向规则覆盖', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const link = {
      textContent: '这是一个由出版方明确标记但文本异常冗长的脚注引用，用于确保显式 EPUB 语义优先于启发式误判抑制规则',
      className: '',
      id: '',
      parentElement: { tagName: 'SPAN', textContent: '' },
      firstElementChild: null,
      ownerDocument: null,
      getAttribute(name) {
        if (name === 'href') return 'notes.xhtml';
        if (name === 'epub:type') return 'noteref';
        return '';
      },
      getAttributeNS() { return ''; },
      closest() { return null; },
      querySelector() { return null; }
    };
    const ctx = {
      isGlobalTocDoc: false,
      hasTocLinks: false,
      tocLinkNodes: new WeakSet(),
      hasFootnoteSections: false,
      footnoteSectionNodes: new WeakSet(),
      hasNavBlocks: false,
      doc: null
    };

    assert.equal(Annotations.isFootnoteLink(link, ctx), true);
  });

  test.it('Annotations 同文档目标位于源节点之前时压低 class/fragment 弱阳性', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const doc = {};
    const target = {
      tagName: 'DIV',
      className: '',
      ownerDocument: doc,
      getAttribute() { return ''; },
      getAttributeNS() { return ''; },
      closest() { return null; }
    };
    doc.getElementById = () => target;
    const link = {
      textContent: 'note',
      className: 'note-ref',
      id: '',
      parentElement: { tagName: 'SPAN', textContent: 'note' },
      firstElementChild: null,
      ownerDocument: doc,
      getAttribute(name) {
        if (name === 'href') return '#note42';
        return '';
      },
      getAttributeNS() { return ''; },
      closest() { return null; },
      querySelector() { return null; },
      compareDocumentPosition(node) {
        return node === target ? 2 : 0;
      }
    };
    const ctx = {
      isGlobalTocDoc: false,
      hasTocLinks: false,
      tocLinkNodes: new WeakSet(),
      hasFootnoteSections: false,
      footnoteSectionNodes: new WeakSet(),
      hasNavBlocks: false,
      doc
    };

    assert.equal(Annotations.isFootnoteLink(link, ctx), false);
  });

  test.it('Annotations 同文档目标前置不否决 epub:type noteref 强信号', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const doc = {};
    const target = { ownerDocument: doc };
    doc.getElementById = () => target;
    const link = {
      textContent: 'note',
      className: '',
      id: '',
      parentElement: { tagName: 'SPAN', textContent: 'note' },
      firstElementChild: null,
      ownerDocument: doc,
      getAttribute(name) {
        if (name === 'href') return '#note42';
        if (name === 'epub:type') return 'noteref';
        return '';
      },
      getAttributeNS() { return ''; },
      closest() { return null; },
      querySelector() { return null; },
      compareDocumentPosition(node) {
        return node === target ? 2 : 0;
      }
    };
    const ctx = {
      isGlobalTocDoc: false,
      hasTocLinks: false,
      tocLinkNodes: new WeakSet(),
      hasFootnoteSections: false,
      footnoteSectionNodes: new WeakSet(),
      hasNavBlocks: false,
      doc
    };

    assert.equal(Annotations.isFootnoteLink(link, ctx), true);
  });

  test.it('Annotations 从 contents.sectionIndex 构建 spine 索引上下文', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const sections = [
      { index: 0, href: 'text/chapter1.xhtml' },
      { index: 1, href: 'text/chapter2.xhtml' },
      { index: 2, href: 'notes.xhtml' }
    ];
    const doc = {
      body: { id: '', className: '' },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    };
    const book = {
      spine: {
        length: sections.length,
        get(index) { return sections[index]; }
      }
    };

    const ctx = Annotations._buildDocContext(doc, { sectionIndex: 1 }, book);

    assert.equal(ctx.currentSpineIndex, 1);
    assert.equal(ctx.currentSpineHref, 'text/chapter2.xhtml');
    assert.equal(ctx.spineIndexesByHref.get('notes.xhtml'), 2);
  });

  test.it('Annotations 跨文档目标位于当前 section 之前时压低 class/fragment 弱阳性', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const link = {
      textContent: 'note',
      className: 'note-ref',
      id: '',
      parentElement: { tagName: 'SPAN', textContent: 'note' },
      firstElementChild: null,
      ownerDocument: {
        defaultView: {
          getComputedStyle() {
            return { verticalAlign: 'baseline' };
          }
        }
      },
      getAttribute(name) {
        if (name === 'href') return '../chapter.xhtml#note42';
        return '';
      },
      getAttributeNS() { return ''; },
      closest() { return null; },
      querySelector() { return null; }
    };
    const ctx = {
      isGlobalTocDoc: false,
      hasTocLinks: false,
      tocLinkNodes: new WeakSet(),
      hasFootnoteSections: false,
      footnoteSectionNodes: new WeakSet(),
      hasNavBlocks: false,
      doc: null,
      currentSpineIndex: 2,
      currentSpineHref: 'text/endnotes.xhtml',
      spineIndexesByHref: new Map([
        ['chapter.xhtml', 0],
        ['text/endnotes.xhtml', 2]
      ]),
      spineIndexesByFilename: new Map()
    };

    assert.equal(Annotations.isFootnoteLink(link, ctx), false);
  });

  test.it('Annotations 跨文档目标在当前 section 之后时保留 fragment 弱阳性', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const link = {
      textContent: 'note',
      className: '',
      id: '',
      parentElement: { tagName: 'SPAN', textContent: 'note' },
      firstElementChild: null,
      ownerDocument: null,
      getAttribute(name) {
        if (name === 'href') return 'notes.xhtml#note42';
        return '';
      },
      getAttributeNS() { return ''; },
      closest() { return null; },
      querySelector() { return null; }
    };
    const ctx = {
      isGlobalTocDoc: false,
      hasTocLinks: false,
      tocLinkNodes: new WeakSet(),
      hasFootnoteSections: false,
      footnoteSectionNodes: new WeakSet(),
      hasNavBlocks: false,
      doc: null,
      currentSpineIndex: 1,
      currentSpineHref: 'chapter.xhtml',
      spineIndexesByHref: new Map([
        ['chapter.xhtml', 1],
        ['notes.xhtml', 3]
      ]),
      spineIndexesByFilename: new Map()
    };

    assert.equal(Annotations.isFootnoteLink(link, ctx), true);
  });

  test.it('Annotations 跨文档目标前置不否决上标强信号', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const link = {
      textContent: 'note',
      className: '',
      id: '',
      parentElement: { tagName: 'SUP', textContent: 'note' },
      firstElementChild: null,
      ownerDocument: null,
      getAttribute(name) {
        if (name === 'href') return 'chapter.xhtml#note42';
        return '';
      },
      getAttributeNS() { return ''; },
      closest() { return null; },
      querySelector() { return null; }
    };
    const ctx = {
      isGlobalTocDoc: false,
      hasTocLinks: false,
      tocLinkNodes: new WeakSet(),
      hasFootnoteSections: false,
      footnoteSectionNodes: new WeakSet(),
      hasNavBlocks: false,
      doc: null,
      currentSpineIndex: 2,
      currentSpineHref: 'notes.xhtml',
      spineIndexesByHref: new Map([
        ['chapter.xhtml', 0],
        ['notes.xhtml', 2]
      ]),
      spineIndexesByFilename: new Map()
    };

    assert.equal(Annotations.isFootnoteLink(link, ctx), true);
  });

  test.it('Annotations 将 FB2 notes body 内链接纳入注释区排除', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const noteBackLink = {
      textContent: 'back',
      className: '',
      id: '',
      parentElement: { tagName: 'P', textContent: 'back to text' },
      firstElementChild: null,
      getAttribute(name) {
        if (name === 'href') return '#src1';
        return '';
      },
      getAttributeNS() { return ''; },
      closest() { return null; },
      querySelector() { return null; }
    };
    const fb2Body = {
      querySelectorAll(selector) {
        return selector === 'a[href]' ? [noteBackLink] : [];
      }
    };
    const doc = {
      body: { id: '', className: '' },
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'ol, ul') return [];
        if (selector.includes('body[name="notes"]')) return [fb2Body];
        return [];
      }
    };

    const ctx = Annotations._buildDocContext(doc);

    assert.equal(ctx.hasFootnoteSections, true);
    assert.equal(Annotations.isFootnoteLink(noteBackLink, ctx), false);
  });

  test.it('Annotations 识别指向 FB2 notes body 内目标的同文档链接', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const doc = {};
    const target = {
      tagName: 'SECTION',
      className: '',
      ownerDocument: doc,
      getAttribute() { return ''; },
      getAttributeNS() { return ''; },
      closest(selector) {
        return selector.includes('body[name="notes"]') ? { tagName: 'BODY' } : null;
      }
    };
    doc.getElementById = () => target;
    const link = {
      textContent: 'note',
      className: '',
      id: '',
      parentElement: { tagName: 'SPAN', textContent: 'note' },
      firstElementChild: null,
      ownerDocument: doc,
      getAttribute(name) {
        if (name === 'href') return '#fb2note';
        return '';
      },
      getAttributeNS() { return ''; },
      closest() { return null; },
      querySelector() { return null; },
      compareDocumentPosition() {
        return 4;
      }
    };
    const ctx = {
      isGlobalTocDoc: false,
      hasTocLinks: false,
      tocLinkNodes: new WeakSet(),
      hasFootnoteSections: false,
      footnoteSectionNodes: new WeakSet(),
      hasNavBlocks: false,
      doc
    };

    assert.equal(Annotations.isFootnoteLink(link, ctx), true);
  });

  test.it('Annotations 空锚点注释沿后续 sibling 收集且遇边界停止', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const boundary = {
      nodeType: 1,
      tagName: 'HR',
      textContent: '',
      outerHTML: '<hr>'
    };
    const inlineNode = {
      nodeType: 1,
      tagName: 'SPAN',
      textContent: '第二句',
      outerHTML: '<span>第二句</span>',
      nextSibling: boundary
    };
    const textNode = {
      nodeType: 3,
      nodeValue: '第一句',
      textContent: '第一句',
      nextSibling: inlineNode
    };
    const anchor = {
      nodeType: 1,
      tagName: 'A',
      textContent: '',
      innerHTML: '',
      nextSibling: textNode,
      parentElement: { tagName: 'BODY' }
    };

    const html = Annotations._extractContent(anchor);

    assert.equal(html, '第一句<span>第二句</span>');
    assert.doesNotMatch(html, /<hr>/);
  });

  test.it('Annotations 超长注释内容会截断并追加提示', () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const longText = '注'.repeat(2050);
    const el = {
      nodeType: 1,
      tagName: 'DIV',
      textContent: longText,
      innerHTML: `<p>${longText}</p>`
    };

    const html = Annotations._extractContent(el);

    assert.equal((html.match(/注/g) || []).length, 2000);
    assert.match(html, /内容过长，请点击原文/);
  });

  test.it('Annotations 跨文档注释缓存命中时不重复加载 section', async () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    let loadCount = 0;
    let unloadCount = 0;
    const loaded = {
      getElementById(id) {
        if (id !== 'fn1') return null;
        return {
          tagName: 'DIV',
          textContent: '缓存注释正文',
          innerHTML: '<p>缓存注释正文</p>'
        };
      },
      querySelector() {
        return null;
      }
    };
    const section = {
      href: 'notes.xhtml',
      async load() {
        loadCount++;
        return loaded;
      },
      unload() {
        unloadCount++;
      }
    };
    const book = {
      load() {},
      spine: {
        length: 1,
        get(key) {
          return key === 'notes.xhtml' || key === 0 ? section : null;
        }
      }
    };

    Annotations.setBook(book);
    const first = await Annotations._loadFromBook('notes.xhtml', 'fn1', { cancelled: false });
    const second = await Annotations._loadFromBook('notes.xhtml', 'fn1', { cancelled: false });

    assert.equal(first.html, '<p>缓存注释正文</p>');
    assert.equal(first.href, 'notes.xhtml');
    assert.equal(second.html, '<p>缓存注释正文</p>');
    assert.equal(second.href, 'notes.xhtml');
    assert.equal(loadCount, 1);
    assert.equal(unloadCount, 1);
  });

  test.it('Annotations 切书后清空跨文档注释缓存', async () => {
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations');
    const loadCalls = [];
    const createBook = (label) => {
      const section = {
        href: 'notes.xhtml',
        async load() {
          loadCalls.push(label);
          return {
            getElementById(id) {
              if (id !== 'fn1') return null;
              return {
                tagName: 'DIV',
                textContent: `${label}注释正文`,
                innerHTML: `<p>${label}注释正文</p>`
              };
            },
            querySelector() {
              return null;
            }
          };
        },
        unload() {}
      };
      return {
        load() {},
        spine: {
          length: 1,
          get(key) {
            return key === 'notes.xhtml' || key === 0 ? section : null;
          }
        }
      };
    };

    Annotations.setBook(createBook('旧书'));
    await Annotations._loadFromBook('notes.xhtml', 'fn1', { cancelled: false });
    await Annotations._loadFromBook('notes.xhtml', 'fn1', { cancelled: false });

    Annotations.setBook(createBook('新书'));
    const result = await Annotations._loadFromBook('notes.xhtml', 'fn1', { cancelled: false });

    assert.deepEqual(loadCalls, ['旧书', '新书']);
    assert.equal(result.html, '<p>新书注释正文</p>');
    assert.equal(result.href, 'notes.xhtml');
  });

  test.it('Annotations 切书后旧脚注异步加载结果不会显示到新书', async () => {
    const { document } = createMockDocument([
      'annotation-overlay',
      'annotation-popup',
      'annotation-body',
      'annotation-title',
      'annotation-close'
    ]);
    let resolveOldLoad;
    const oldSection = {
      href: 'notes.xhtml',
      async load() {
        await new Promise((resolve) => { resolveOldLoad = resolve; });
        return {
          getElementById(id) {
            if (id !== 'fn1') return null;
            return {
              tagName: 'DIV',
              textContent: '旧书注释正文',
              innerHTML: '<p>旧书注释正文</p>'
            };
          }
        };
      },
      unload() {}
    };
    const oldBook = {
      load() {},
      spine: {
        length: 1,
        get(key) {
          return key === 'notes.xhtml' || key === 0 ? oldSection : null;
        }
      }
    };
    const newBook = {
      load() {},
      spine: {
        length: 0,
        get() { return null; }
      }
    };
    const createRendition = () => ({
      hooks: { content: { register() {} } },
      currentLocation() {
        return { start: { href: 'chapter.xhtml' } };
      }
    });
    const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations', {
      document,
      setTimeout: global.setTimeout
    });

    Annotations.init();
    Annotations.mount({ book: oldBook, rendition: createRendition() });
    const loadPromise = Annotations.showFootnote(
      'notes.xhtml#fn1',
      { document },
      { cancelled: false }
    );
    await Promise.resolve();
    assert.equal(typeof resolveOldLoad, 'function');

    Annotations.mount({ book: newBook, rendition: createRendition() });
    resolveOldLoad();
    await loadPromise;

    assert.equal(document.getElementById('annotation-popup').classList.contains('is-visible'), false);
    assert.equal(document.getElementById('annotation-body').innerHTML, '');
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

  test.it('ImageViewer 切换 rendition 后旧 iframe 图片点击不会打开查看器', () => {
    const { document } = createMockDocument([
      'image-viewer',
      'image-viewer-img',
      'image-viewer-container',
      'image-viewer-close',
      'img-zoom-in',
      'img-zoom-out',
      'img-zoom-reset'
    ]);
    document.getElementById('image-viewer').classList.add('is-hidden');
    const imageListeners = [];
    const image = {
      tagName: 'IMG',
      src: 'blob:old-image',
      classList: { add() {} },
      addEventListener(type, fn) {
        if (type === 'click') imageListeners.push(fn);
      }
    };
    const oldDoc = {
      querySelectorAll(selector) {
        return selector === 'img, image, svg image' ? [image] : [];
      }
    };
    const createRendition = (doc) => ({
      hooks: {
        content: {
          register() {}
        }
      },
      getContents() {
        return doc ? [{ document: doc }] : [];
      }
    });
    const ImageViewer = loadIsolatedWindowExport('src/reader/image-viewer.js', 'ImageViewer', { document });

    ImageViewer.init();
    ImageViewer.hookRendition(createRendition(oldDoc));
    assert.equal(imageListeners.length, 1);

    imageListeners[0]({ preventDefault() {}, stopPropagation() {} });
    assert.equal(document.getElementById('image-viewer').classList.contains('is-hidden'), false);
    assert.equal(document.getElementById('image-viewer-img').src, 'blob:old-image');

    ImageViewer.close();
    ImageViewer.hookRendition(createRendition(null));
    imageListeners[0]({ preventDefault() {}, stopPropagation() {} });

    assert.equal(document.getElementById('image-viewer').classList.contains('is-hidden'), true);
    assert.equal(document.getElementById('image-viewer-img').src, '');
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
    const context = {
      document,
      ReaderState: {
        getTocItemLabel(item) {
          return item && item.label != null ? String(item.label).trim() : '';
        },
        isTocHrefMatch(currentHref, itemHref) {
          const currentBase = String(currentHref || '').split('#')[0];
          const itemBase = String(itemHref || '').split('#')[0];
          return !!currentBase && !!itemBase && (
            currentBase === itemBase ||
            currentBase.endsWith('/' + itemBase) ||
            itemBase.endsWith('/' + currentBase)
          );
        }
      }
    };
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

  test.it('目录、书签和搜索结果统一通过 lifecycle 导航命令定位', async () => {
    const navigated = [];
    const directDisplays = [];
    const navigate = (target) => { navigated.push(target); };
    const createRendition = () => ({
      annotations: { highlight() {}, remove() {} },
      display(target) { directDisplays.push(target); }
    });

    {
      const { document } = createMockDocument([
        'toc-container', 'sidebar', 'sidebar-overlay', 'btn-toc', 'btn-toc-close',
        'bookmarks-panel', 'search-panel'
      ]);
      const TOC = loadIsolatedWindowExport('src/reader/toc.js', 'TOC', { document });
      TOC.init();
      TOC.mount({
        book: { navigation: { toc: [{ label: '目录章节', href: 'toc.xhtml' }] } },
        rendition: createRendition(),
        navigate
      });
      document.getElementById('toc-container').children[0].click();
    }

    {
      const { document } = createMockDocument([
        'bookmarks-panel', 'bookmarks-list', 'btn-bookmarks', 'btn-bookmarks-close',
        'sidebar', 'sidebar-overlay', 'search-panel'
      ]);
      const Bookmarks = loadIsolatedWindowExport('src/reader/bookmarks.js', 'Bookmarks', {
        document,
        EpubStorage: {
          async getBookmarks() {
            return [{ cfi: 'bookmark-cfi', chapter: '书签章节', progress: 20, timestamp: 1 }];
          },
          async saveBookmarks() {}
        }
      });
      Bookmarks.init();
      Bookmarks.mount({ bookId: 'book-1', book: {}, rendition: createRendition(), navigate });
      await new Promise((resolve) => setImmediate(resolve));
      document.getElementById('bookmarks-list').querySelectorAll('.bookmark-item-info')[0].click();
    }

    {
      const { document } = createMockDocument([
        'search-panel', 'sidebar-overlay', 'search-input', 'btn-do-search',
        'search-results-list', 'search-status', 'btn-search', 'btn-search-close',
        'sidebar', 'bookmarks-panel'
      ]);
      const Search = loadIsolatedWindowExport('src/reader/search.js', 'Search', {
        document,
        setTimeout(fn) { fn(); return 1; },
        clearTimeout() {}
      });
      Search.init();
      Search.mount({
        book: {
          load() {},
          spine: {
            length: 1,
            get() {
              return {
                async load() {},
                find() { return [{ cfi: 'search-cfi', excerpt: '搜索关键词' }]; },
                unload() {}
              };
            }
          }
        },
        rendition: createRendition(),
        navigate
      });
      document.getElementById('search-input').value = '关键词';
      document.getElementById('btn-do-search').click();
      await new Promise((resolve) => setImmediate(resolve));
      document.getElementById('search-results-list').children[0].click();
      await Promise.resolve();
    }

    assert.deepEqual(navigated, ['toc.xhtml', 'bookmark-cfi', 'search-cfi']);
    assert.deepEqual(directDisplays, []);
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
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', {
      document,
      window: { document, focus() {}, addEventListener() {} }
    });
    const panelController = ReaderUi.createReaderUi({ state: { prefs: {} } });
    const TOC = loadIsolatedWindowExport('src/reader/toc.js', 'TOC', { document });
    TOC.init();
    TOC.mount({
      book: { navigation: { toc: [] } },
      rendition: {},
      panelController
    });
    document.getElementById('bookmarks-panel').classList.add('open');
    document.getElementById('search-panel').classList.add('open');

    TOC.open();

    assert.equal(document.getElementById('sidebar').classList.contains('open'), true);
    assert.equal(document.getElementById('bookmarks-panel').classList.contains('open'), false);
    assert.equal(document.getElementById('search-panel').classList.contains('open'), false);
    assert.equal(document.getElementById('sidebar-overlay').classList.contains('visible'), true);
  });

  test.it('ReaderUi 集中维护共享侧栏的互斥与遮罩状态', () => {
    const { document } = createMockDocument([
      'sidebar', 'bookmarks-panel', 'search-panel', 'sidebar-overlay', 'settings-panel'
    ]);
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', {
      document,
      window: { document, focus() {}, addEventListener() {} }
    });
    const ui = ReaderUi.createReaderUi({ state: { prefs: {} } });
    const sidebar = document.getElementById('sidebar');
    const bookmarksPanel = document.getElementById('bookmarks-panel');
    const searchPanel = document.getElementById('search-panel');
    const overlay = document.getElementById('sidebar-overlay');

    sidebar.classList.add('open');
    bookmarksPanel.classList.add('open');
    ui.openExclusivePanel(searchPanel);

    assert.equal(sidebar.classList.contains('open'), false);
    assert.equal(bookmarksPanel.classList.contains('open'), false);
    assert.equal(searchPanel.classList.contains('open'), true);
    assert.equal(overlay.classList.contains('visible'), true);

    ui.closePanelWithOverlayCheck(searchPanel);
    assert.equal(overlay.classList.contains('visible'), false);
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
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', {
      document,
      window: { document, focus() {}, addEventListener() {} }
    });
    const panelController = ReaderUi.createReaderUi({ state: { prefs: {} } });
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
    Bookmarks.mount({ bookId: 'book-1', rendition: { display() {} }, panelController });
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

  test.it('Bookmarks 切书后忽略上一书的延迟加载结果', async () => {
    const { document } = createMockDocument([
      'bookmarks-panel',
      'bookmarks-list',
      'btn-bookmarks',
      'btn-bookmarks-close',
      'sidebar',
      'sidebar-overlay',
      'search-panel'
    ]);
    let resolveOldLoad;
    const oldLoad = new Promise((resolve) => { resolveOldLoad = resolve; });
    const Bookmarks = loadIsolatedWindowExport('src/reader/bookmarks.js', 'Bookmarks', {
      document,
      EpubStorage: {
        async getBookmarks(bookId) {
          if (bookId === 'old-book') return oldLoad;
          return [{ cfi: 'new-cfi', chapter: '新书章节', progress: 20, timestamp: 1 }];
        },
        async saveBookmarks() {}
      }
    });

    Bookmarks.init();
    Bookmarks.setBook('old-book', { display() {} });
    Bookmarks.setBook('new-book', { display() {} });
    await Promise.resolve();
    await Promise.resolve();

    resolveOldLoad([{ cfi: 'old-cfi', chapter: '旧书章节', progress: 10, timestamp: 1 }]);
    await Promise.resolve();
    await Promise.resolve();

    const chapters = document.getElementById('bookmarks-list')
      .querySelectorAll('.bookmark-item-chapter')
      .map(el => el.textContent);
    assert.deepEqual(chapters, ['新书章节']);
  });

  test.it('Bookmarks 切书后旧 toggle 不会保存到新书', async () => {
    const { document } = createMockDocument([
      'bookmarks-panel',
      'bookmarks-list',
      'btn-bookmarks',
      'btn-bookmarks-close',
      'sidebar',
      'sidebar-overlay',
      'search-panel'
    ]);
    let oldGetCount = 0;
    let resolveOldToggle;
    const saveCalls = [];
    const Bookmarks = loadIsolatedWindowExport('src/reader/bookmarks.js', 'Bookmarks', {
      document,
      EpubStorage: {
        async getBookmarks(bookId) {
          if (bookId === 'old-book') {
            oldGetCount++;
            if (oldGetCount === 2) {
              return new Promise((resolve) => { resolveOldToggle = resolve; });
            }
          }
          return [];
        },
        async saveBookmarks(bookId, bookmarks) {
          saveCalls.push({ bookId, bookmarks });
        }
      }
    });

    Bookmarks.init();
    Bookmarks.setBook('old-book', { display() {} });
    await Promise.resolve();

    const togglePromise = Bookmarks.toggle('old-cfi', '旧书章节', 0.5);
    await Promise.resolve();
    Bookmarks.setBook('new-book', { display() {} });
    resolveOldToggle([]);
    await togglePromise;

    assert.deepEqual(saveCalls, []);
  });

  test.it('Bookmarks 自动加载失败只记录告警', async () => {
    const { document } = createMockDocument([
      'bookmarks-panel',
      'bookmarks-list',
      'btn-bookmarks',
      'btn-bookmarks-close',
      'sidebar',
      'sidebar-overlay',
      'search-panel'
    ]);
    const warnings = [];
    const Bookmarks = loadIsolatedWindowExport('src/reader/bookmarks.js', 'Bookmarks', {
      document,
      console: { ...console, warn(...args) { warnings.push(args); } },
      EpubStorage: {
        async getBookmarks() {
          throw new Error('storage failed');
        },
        async saveBookmarks() {}
      }
    });

    Bookmarks.init();
    Bookmarks.setBook('book-1', { display() {} });
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(String(warnings[0]?.[0] || ''), /load bookmarks failed/);
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

  test.it('Search 单章节结果超过上限时只渲染前 1000 条', async () => {
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
    const Search = loadIsolatedWindowExport('src/reader/search.js', 'Search', {
      document,
      setTimeout(fn) {
        fn();
        return 1;
      }
    });

    const manyResults = Array.from({ length: 1005 }, (_, index) => ({
      cfi: `epubcfi(/6/${index + 2})`,
      excerpt: `第 ${index + 1} 处关键词`
    }));
    const item = {
      async load() {},
      find() { return manyResults; },
      unload() {}
    };
    const book = {
      load() {},
      spine: {
        length: 1,
        get() { return item; }
      }
    };

    Search.init();
    Search.setBook(book, { annotations: { remove() {}, highlight() {} }, display() {} });
    document.getElementById('search-input').value = '关键词';
    document.getElementById('btn-do-search').click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const resultsList = document.getElementById('search-results-list');
    assert.equal(resultsList.children.length, 1000);
    assert.match(document.getElementById('search-status').textContent, /仅显示前 1000 条/);
  });

  test.it('ReaderUi 本地导入会等待文件缓存落盘后再进入阅读', async () => {
    const { document } = createMockDocument([
      'welcome-screen',
      'loading-overlay',
      'loading-text',
      'reader-main',
      'bottom-bar',
      'toolbar',
      'file-input',
      'book-title',
      'chapter-title',
      'progress-slider',
      'progress-current',
      'progress-location',
      'progress-time',
      'font-size-slider',
      'font-size-value',
      'line-height-slider',
      'line-height-value',
      'font-family-select',
      'settings-panel',
      'custom-theme-options',
      'custom-bg-color',
      'custom-text-color',
      'drag-overlay',
      'welcome-open-btn',
      'btn-open',
      'btn-home',
      'btn-prev',
      'btn-next',
      'btn-settings',
      'btn-settings-close',
      'btn-bookmark'
    ]);

    let releaseStore;
    let changePromise;
    const calls = [];
    const storeStarted = new Promise((resolve) => {
      releaseStore = () => {};
      const context = {
        document,
        window: {
          focus() {},
          addEventListener() {},
          history: {
            replaceState(_state, _title, url) { calls.push(['history', url]); }
          }
        },
        chrome: {
          runtime: { getURL: (p) => 'chrome-extension://test/' + p },
          tabs: { create() {} }
        },
        EpubStorage: {
          async generateBookId() { return 'book-ui-import'; },
          async storeFile() {
            calls.push('store-start');
            resolve();
            await new Promise((release) => { releaseStore = release; });
            calls.push('store-end');
          },
          async savePreferences() {}
        },
        TOC: { close() {} },
        Bookmarks: { closePanel() {}, isBookmarked: async () => false, toggle: async () => {} },
        Search: { closePanel() {} },
        Highlights: { closePanels() {} },
        setTimeout: global.setTimeout,
        requestAnimationFrame: (fn) => fn()
      };
      context.window.document = document;
      const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', context);
      const ui = ReaderUi.createReaderUi({ state: { prefs: {}, isBookLoaded: false } });
      ui.bindRuntime({
        async openBook() { calls.push('open-book'); },
        next() {},
        prev() {},
        setLayout() {},
        displayPercentage() {}
      }, {});

      const fileInput = document.getElementById('file-input');
      fileInput.files = [{
        name: 'sample.epub',
        async arrayBuffer() {
          return new Uint8Array([1, 2, 3]).buffer;
        }
      }];
      const changeHandler = fileInput.listeners.get('change')[0];
      changePromise = changeHandler({ target: fileInput });
    });

    await storeStarted;
    assert.deepEqual(calls, ['store-start']);

    releaseStore();
    await changePromise;

    assert.deepEqual(calls, [
      'store-start',
      'store-end',
      'open-book',
      ['history', 'chrome-extension://test/reader/reader.html?bookId=book-ui-import']
    ]);
  });

  test.it('ReaderUi 连续选择文件会按用户触发顺序完成导入与打开', async () => {
    const { document } = createMockDocument(['file-input']);
    let releaseFirstRead;
    const firstRead = new Promise((resolve) => { releaseFirstRead = resolve; });
    const calls = [];
    const context = {
      document,
      window: {
        document,
        focus() {},
        addEventListener() {},
        history: {
          replaceState(_state, _title, url) { calls.push(['history', url]); }
        }
      },
      chrome: {
        runtime: { getURL: (p) => 'chrome-extension://test/' + p }
      },
      EpubStorage: {
        async generateBookId(fileName) { return 'id-' + fileName; },
        async storeFile(fileName) { calls.push(['store', fileName]); },
        async savePreferences() {}
      },
      setTimeout: global.setTimeout,
      requestAnimationFrame: (fn) => fn()
    };
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', context);
    const ui = ReaderUi.createReaderUi({ state: { prefs: {}, isBookLoaded: false } });
    await ui.bindRuntime({
      async openBook(_data, _bookId, fileName) { calls.push(['open', fileName]); },
      next() {}, prev() {}, setLayout() {}, displayPercentage() {}
    }, {});

    const fileInput = document.getElementById('file-input');
    const changeHandler = fileInput.listeners.get('change')[0];
    const firstTask = changeHandler({
      target: {
        files: [{ name: 'first.epub', async arrayBuffer() { return firstRead; } }],
        value: ''
      }
    });
    const secondTask = changeHandler({
      target: {
        files: [{ name: 'second.epub', async arrayBuffer() { return new Uint8Array([2]).buffer; } }],
        value: ''
      }
    });

    await new Promise((resolve) => setImmediate(resolve));
    releaseFirstRead(new Uint8Array([1]).buffer);
    await Promise.all([firstTask, secondTask]);

    assert.deepEqual(calls, [
      ['store', 'first.epub'],
      ['open', 'first.epub'],
      ['history', 'chrome-extension://test/reader/reader.html?bookId=id-first.epub'],
      ['store', 'second.epub'],
      ['open', 'second.epub'],
      ['history', 'chrome-extension://test/reader/reader.html?bookId=id-second.epub']
    ]);
  });

  test.it('ReaderUi bindRuntime 重复调用不会叠加顶层事件监听', async () => {
    const { document } = createMockDocument([
      'welcome-screen',
      'loading-overlay',
      'loading-text',
      'reader-main',
      'bottom-bar',
      'toolbar',
      'file-input',
      'book-title',
      'chapter-title',
      'progress-slider',
      'progress-current',
      'progress-location',
      'progress-time',
      'font-size-slider',
      'font-size-value',
      'line-height-slider',
      'line-height-value',
      'font-family-select',
      'settings-panel',
      'custom-theme-options',
      'custom-bg-color',
      'custom-text-color',
      'drag-overlay',
      'welcome-open-btn',
      'btn-open',
      'btn-home',
      'btn-prev',
      'btn-next',
      'btn-settings',
      'btn-settings-close',
      'btn-bookmark'
    ]);
    const calls = [];
    const context = {
      document,
      window: {
        focus() {},
        addEventListener() {}
      },
      chrome: {
        runtime: { getURL: (p) => 'chrome-extension://test/' + p },
        tabs: { create() {} }
      },
      EpubStorage: {
        async savePreferences() {}
      },
      TOC: { close() {} },
      Bookmarks: { closePanel() {}, isBookmarked: async () => false, toggle: async () => {} },
      Search: { closePanel() {} },
      Highlights: { closePanels() {} },
      setTimeout: global.setTimeout,
      requestAnimationFrame: (fn) => fn()
    };
    context.window.document = document;
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', context);
    const ui = ReaderUi.createReaderUi({
      state: { prefs: {}, isBookLoaded: true }
    });

    await ui.bindRuntime({
      next() { calls.push('old-next'); },
      prev() { calls.push('old-prev'); },
      setLayout() {},
      displayPercentage() {}
    }, {});
    await ui.bindRuntime({
      next() { calls.push('new-next'); },
      prev() { calls.push('new-prev'); },
      setLayout() {},
      displayPercentage() {}
    }, {});

    document.dispatchEvent('keydown', {
      key: 'ArrowRight',
      preventDefault() {},
      stopImmediatePropagation() {}
    });
    document.getElementById('btn-next').click();

    assert.deepEqual(calls, ['new-next', 'new-next']);
  });

  test.it('ReaderUi 布局按钮会收口 setLayout 异步失败', async () => {
    const { document } = createMockDocument([]);
    const layoutButton = document.createElement('button');
    layoutButton.classList.add('layout-btn');
    layoutButton.dataset.layout = 'scrolled';
    document.querySelectorAll = (selector) => selector === '.layout-btn' ? [layoutButton] : [];

    let rejectionHandled = false;
    const context = {
      document,
      window: { document, focus() {}, addEventListener() {} },
      EpubStorage: { async savePreferences() {} },
      setTimeout: global.setTimeout,
      requestAnimationFrame: (fn) => fn()
    };
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', context);
    const ui = ReaderUi.createReaderUi({ state: { prefs: {}, isBookLoaded: true } });
    await ui.bindRuntime({
      next() {}, prev() {}, displayPercentage() {},
      setLayout() {
        return {
          then(_resolve, reject) {
            rejectionHandled = true;
            reject(new Error('layout failed'));
          }
        };
      }
    }, {});

    layoutButton.click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(rejectionHandled, true);
  });

  test.it('ReaderUi 字体重排的旧 RAF 回调不会操作新书 rendition', async () => {
    const { document } = createMockDocument(['font-size-slider', 'font-size-value']);
    const frames = [];
    const oldDisplays = [];
    const newDisplays = [];
    const relocated = [];
    const oldRendition = {
      currentLocation() { return { start: { cfi: 'old-cfi' } }; },
      getContents() { return []; },
      display(cfi) { oldDisplays.push(cfi); return Promise.resolve(); }
    };
    const newRendition = {
      currentLocation() { return { start: { cfi: 'new-cfi' } }; },
      getContents() { return []; },
      display(cfi) { newDisplays.push(cfi); return Promise.resolve(); }
    };
    const state = {
      prefs: { fontSize: 18, lineHeight: 1.8, theme: 'light' },
      rendition: oldRendition,
      isBookLoaded: true,
      isResizing: false,
      isRestoringPosition: false,
      currentStableCfi: 'old-cfi'
    };
    const windowMock = {
      document,
      focus() {},
      addEventListener() {}
    };
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', {
      document,
      window: windowMock,
      requestAnimationFrame(fn) {
        frames.push(fn);
        return frames.length;
      },
      EpubStorage: { async savePreferences() {} }
    });
    const ui = ReaderUi.createReaderUi({ state });
    await ui.bindRuntime({}, { onRelocated(location) { relocated.push(location); } });

    const fontSizeSlider = document.getElementById('font-size-slider');
    fontSizeSlider.value = '20';
    fontSizeSlider.dispatch('input');
    assert.equal(state.isResizing, true);
    assert.equal(state.isRestoringPosition, true);

    state.rendition = newRendition;
    state.isResizing = false;
    state.isRestoringPosition = false;

    frames.shift()();
    frames.shift()?.();
    await Promise.resolve();

    assert.deepEqual(oldDisplays, []);
    assert.deepEqual(newDisplays, [], '旧书 CFI 不得显示到新 rendition');
    assert.deepEqual(relocated, []);
    assert.equal(state.isResizing, false);
    assert.equal(state.isRestoringPosition, false);
  });

  test.it('ReaderUi 当前书字体重排完成后恢复 CFI、释放锁并上报位置', async () => {
    const { document } = createMockDocument(['font-size-slider', 'font-size-value']);
    const displays = [];
    const relocated = [];
    const rendition = {
      currentLocation() { return { start: { cfi: 'font-cfi' } }; },
      getContents() { return []; },
      display(cfi) { displays.push(cfi); return Promise.resolve(); }
    };
    const state = {
      prefs: { fontSize: 18, lineHeight: 1.8, theme: 'light' },
      rendition,
      isBookLoaded: true,
      isResizing: false,
      isRestoringPosition: false,
      currentStableCfi: 'font-cfi'
    };
    const windowMock = {
      document,
      focus() {},
      addEventListener() {}
    };
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', {
      document,
      window: windowMock,
      requestAnimationFrame(fn) { fn(); return 1; },
      EpubStorage: { async savePreferences() {} }
    });
    const ui = ReaderUi.createReaderUi({ state });
    await ui.bindRuntime({}, { onRelocated(location) { relocated.push(location.start.cfi); } });

    const fontSizeSlider = document.getElementById('font-size-slider');
    fontSizeSlider.value = '20';
    fontSizeSlider.dispatch('input');
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(displays, ['font-cfi']);
    assert.deepEqual(relocated, ['font-cfi']);
    assert.equal(state.isResizing, false);
    assert.equal(state.isRestoringPosition, false);
  });

  test.it('ReaderUi 旧书 resize timer 不会操作新书 rendition', async () => {
    const { document } = createMockDocument([]);
    const timers = [];
    const resizeHandlers = [];
    const newCalls = [];
    const relocated = [];
    const oldRendition = {
      currentLocation() { return { start: { cfi: 'old-resize-cfi' } }; },
      resize() {},
      display() { return Promise.resolve(); }
    };
    const newRendition = {
      currentLocation() { return { start: { cfi: 'new-cfi' } }; },
      resize() { newCalls.push('resize'); },
      display(cfi) { newCalls.push(['display', cfi]); return Promise.resolve(); }
    };
    const state = {
      prefs: {},
      rendition: oldRendition,
      isBookLoaded: true,
      isResizing: false
    };
    const windowMock = {
      document,
      focus() {},
      addEventListener(type, handler) {
        if (type === 'resize') resizeHandlers.push(handler);
      }
    };
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', {
      document,
      window: windowMock,
      setTimeout(fn) { timers.push(fn); return timers.length; },
      clearTimeout() {},
      requestAnimationFrame(fn) { fn(); return 1; },
      EpubStorage: { async savePreferences() {} }
    });
    const ui = ReaderUi.createReaderUi({ state });
    await ui.bindRuntime({}, { onRelocated(location) { relocated.push(location); } });

    resizeHandlers[0]();
    assert.equal(state.isResizing, true);

    state.rendition = newRendition;
    state.isResizing = false;
    await timers.shift()();

    assert.deepEqual(newCalls, []);
    assert.deepEqual(relocated, []);
    assert.equal(state.isResizing, false);
  });

  test.it('ReaderUi 当前书 resize 完成后恢复 CFI、释放锁并上报位置', async () => {
    const { document } = createMockDocument([]);
    const timers = [];
    const resizeHandlers = [];
    const calls = [];
    const relocated = [];
    let currentCfi = 'viewport-shifted-cfi';
    const rendition = {
      currentLocation() { return { start: { cfi: currentCfi } }; },
      resize() { calls.push('resize'); },
      display(cfi) {
        calls.push(['display', cfi]);
        currentCfi = 'restored-cfi';
        return Promise.resolve();
      }
    };
    const state = {
      prefs: {},
      rendition,
      isBookLoaded: true,
      isResizing: false,
      isRestoringPosition: false,
      currentStableCfi: 'stable-source-cfi',
      currentStableLocator: {
        sourceCfi: 'stable-source-cfi',
        restoreCfi: 'stable-restore-cfi'
      }
    };
    const windowMock = {
      document,
      focus() {},
      addEventListener(type, handler) {
        if (type === 'resize') resizeHandlers.push(handler);
      }
    };
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', {
      document,
      window: windowMock,
      setTimeout(fn) { timers.push(fn); return timers.length; },
      clearTimeout() {},
      requestAnimationFrame(fn) { fn(); return 1; },
      EpubStorage: { async savePreferences() {} }
    });
    const ui = ReaderUi.createReaderUi({ state });
    await ui.bindRuntime({}, { onRelocated(location) { relocated.push(location.start.cfi); } });

    resizeHandlers[0]();
    assert.equal(state.isResizing, true);
    assert.equal(state.isRestoringPosition, true);
    await timers.shift()();

    assert.deepEqual(calls, ['resize', ['display', 'stable-restore-cfi']]);
    assert.deepEqual(relocated, ['restored-cfi']);
    assert.equal(state.isResizing, false);
    assert.equal(state.isRestoringPosition, false);
  });

  test.it('ReaderUi 旧 iframe 键盘与滚轮事件不会导航新 rendition', () => {
    const { document } = createMockDocument([]);
    const { document: iframeDocument } = createMockDocument([]);
    const contentHooks = [];
    const oldRendition = {
      hooks: { content: { register(fn) { contentHooks.push(fn); } } }
    };
    const state = {
      rendition: oldRendition,
      isBookLoaded: true,
      prefs: { layout: 'paginated' }
    };
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', {
      document,
      window: { document, focus() {}, addEventListener() {} },
      EpubStorage: { async savePreferences() {} }
    });
    const ui = ReaderUi.createReaderUi({ state });
    let nextCalls = 0;
    ui.setupRenditionKeyEvents(oldRendition, {}, {
      next() { nextCalls++; },
      prev() {}
    });
    contentHooks[0]({ document: iframeDocument });

    state.rendition = { id: 'new-rendition' };
    iframeDocument.dispatchEvent('keydown', {
      key: 'ArrowRight',
      preventDefault() {},
      stopImmediatePropagation() {}
    });
    iframeDocument.dispatchEvent('wheel', {
      deltaY: 1,
      deltaX: 0,
      preventDefault() {}
    });

    assert.equal(nextCalls, 0);
  });

  test.it('ReaderUi 不拦截 EPUB iframe 输入控件的方向键', () => {
    const { document } = createMockDocument([]);
    const { document: iframeDocument } = createMockDocument([]);
    const contentHooks = [];
    const rendition = {
      hooks: { content: { register(fn) { contentHooks.push(fn); } } }
    };
    const state = {
      rendition,
      isBookLoaded: true,
      prefs: { layout: 'paginated' }
    };
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', {
      document,
      window: { document, focus() {}, addEventListener() {} },
      EpubStorage: { async savePreferences() {} }
    });
    const ui = ReaderUi.createReaderUi({ state });
    let nextCalls = 0;
    ui.setupRenditionKeyEvents(rendition, {}, {
      next() { nextCalls++; },
      prev() {}
    });
    contentHooks[0]({ document: iframeDocument });

    iframeDocument.dispatchEvent('keydown', {
      key: 'ArrowRight',
      target: { tagName: 'INPUT', blur() {} },
      preventDefault() { throw new Error('输入框方向键不应被阻止'); },
      stopImmediatePropagation() { throw new Error('输入框方向键不应被截断'); }
    });

    assert.equal(nextCalls, 0);
  });

  test.it('ReaderUi 书签按钮保存失败只记录告警', async () => {
    const { document } = createMockDocument([
      'welcome-screen',
      'loading-overlay',
      'loading-text',
      'reader-main',
      'bottom-bar',
      'toolbar',
      'file-input',
      'book-title',
      'chapter-title',
      'progress-slider',
      'progress-current',
      'progress-location',
      'progress-time',
      'font-size-slider',
      'font-size-value',
      'line-height-slider',
      'line-height-value',
      'font-family-select',
      'settings-panel',
      'custom-theme-options',
      'custom-bg-color',
      'custom-text-color',
      'drag-overlay',
      'welcome-open-btn',
      'btn-open',
      'btn-home',
      'btn-prev',
      'btn-next',
      'btn-settings',
      'btn-settings-close',
      'btn-bookmark'
    ]);
    const warnings = [];
    const context = {
      document,
      window: {
        focus() {},
        addEventListener() {}
      },
      chrome: {
        runtime: { getURL: (p) => 'chrome-extension://test/' + p },
        tabs: { create() {} }
      },
      EpubStorage: {
        async savePreferences() {}
      },
      ReaderState: {
        findTocItem() { return { label: '章节一' }; },
        getTocItemLabel(item) { return item && item.label ? item.label.trim() : ''; }
      },
      TOC: { close() {} },
      Bookmarks: {
        closePanel() {},
        async toggle() { throw new Error('bookmark failed'); },
        async isBookmarked() { return false; }
      },
      Search: { closePanel() {} },
      Highlights: { closePanels() {} },
      console: { ...console, warn(...args) { warnings.push(args); } },
      setTimeout: global.setTimeout,
      requestAnimationFrame: (fn) => fn()
    };
    context.window.document = document;
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', context);
    const ui = ReaderUi.createReaderUi({
      state: {
        prefs: {},
        isBookLoaded: true,
        rendition: {
          currentLocation() {
            return { start: { cfi: 'epubcfi(/6/2)', href: 'chapter.xhtml' } };
          }
        },
        book: {
          navigation: { toc: [] },
          locations: {
            length() { return 1; },
            percentageFromCfi() { return 0.5; }
          }
        }
      }
    });

    await ui.bindRuntime({
      next() {},
      prev() {},
      setLayout() {},
      displayPercentage() {}
    }, {});
    document.getElementById('btn-bookmark').click();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(String(warnings[0]?.[0] || ''), /toggle bookmark failed/);
  });

  test.it('ReaderUi 偏好保存失败只记录告警且不阻断 UI 更新', async () => {
    const { document } = createMockDocument(['custom-theme-options']);
    const warnings = [];
    const context = {
      document,
      window: {
        focus() {},
        addEventListener() {}
      },
      EpubStorage: {
        async savePreferences() {
          throw new Error('storage failed');
        }
      },
      console: {
        ...console,
        warn(...args) { warnings.push(args); }
      }
    };
    context.window.document = document;
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', context);
    const ui = ReaderUi.createReaderUi({
      state: {
        currentFileName: '',
        prefs: {
          theme: 'light',
          customBg: '#ffffff',
          customText: '#333333'
        }
      }
    });

    ui.applyTheme('dark');
    await Promise.resolve();

    assert.equal(document.documentElement.attrs['data-theme'], 'dark');
    assert.match(String(warnings[0]?.[0] || ''), /save preferences failed/);
  });

  test.it('ReaderUi 损坏的持久化外观偏好不会进入控件、epub.js 或 iframe CSS', () => {
    const { document } = createMockDocument([
      'font-size-slider', 'font-size-value', 'line-height-slider', 'line-height-value',
      'font-family-select', 'custom-theme-options', 'custom-bg-color', 'custom-text-color'
    ]);
    const themeOverrides = [];
    const state = {
      prefs: {
        theme: 'custom',
        customBg: '#fff;} body { display:none',
        customText: 'red; background:url(evil)',
        fontFamily: "serif; } body { color: red",
        fontSize: '18; color:red',
        lineHeight: '1.8; display:none',
        layout: 'broken-layout',
        spread: 'broken-spread',
        paragraphIndent: 'false'
      },
      rendition: {
        themes: {
          override(property, value) { themeOverrides.push([property, value]); }
        },
        getContents() { return []; }
      }
    };
    const windowMock = { document, focus() {}, addEventListener() {} };
    const ReaderUi = loadIsolatedWindowExport('src/reader/reader-ui.js', 'ReaderUi', {
      document,
      window: windowMock,
      EpubStorage: { async savePreferences() {} }
    });
    const ui = ReaderUi.createReaderUi({ state });

    ui.syncPrefsToControls();

    let styleEl = null;
    ui.injectCustomStyleElement({
      document: {
        getElementById() { return styleEl; },
        createElementNS() {
          return { textContent: '', setAttribute() {} };
        },
        head: {
          appendChild(element) { styleEl = element; }
        }
      }
    });

    assert.deepEqual({ ...state.prefs }, {
      theme: 'custom',
      customBg: '#ffffff',
      customText: '#333333',
      fontFamily: '',
      fontSize: 18,
      lineHeight: 1.8,
      layout: 'paginated',
      spread: 'auto',
      paragraphIndent: true
    });
    assert.deepEqual(themeOverrides.slice(0, 2), [
      ['color', '#333333'],
      ['background', '#ffffff']
    ]);
    assert.ok(styleEl.textContent.includes('font-size: 18px'));
    assert.ok(styleEl.textContent.includes('line-height: 1.8'));
    assert.ok(!styleEl.textContent.includes('display:none'));
    assert.ok(!styleEl.textContent.includes('background:url'));
  });

  test.it('Reader 功能模块 init 重复调用不会叠加顶层监听', () => {
    const count = (el, type) => (el.listeners.get(type) || []).length;

    {
      const { document } = createMockDocument([
        'bookmarks-panel',
        'bookmarks-list',
        'btn-bookmarks',
        'btn-bookmarks-close'
      ]);
      const Bookmarks = loadIsolatedWindowExport('src/reader/bookmarks.js', 'Bookmarks', {
        document,
        EpubStorage: { async getBookmarks() { return []; }, async saveBookmarks() {} }
      });

      Bookmarks.init();
      Bookmarks.init();

      assert.equal(count(document.getElementById('btn-bookmarks'), 'click'), 1);
      assert.equal(count(document.getElementById('btn-bookmarks-close'), 'click'), 1);
    }

    {
      const { document } = createMockDocument([
        'toc-container',
        'sidebar',
        'sidebar-overlay',
        'btn-toc',
        'btn-toc-close'
      ]);
      const TOC = loadIsolatedWindowExport('src/reader/toc.js', 'TOC', { document });

      TOC.init();
      TOC.init();

      assert.equal(count(document.getElementById('btn-toc'), 'click'), 1);
      assert.equal(count(document.getElementById('btn-toc-close'), 'click'), 1);
      assert.equal(count(document.getElementById('sidebar-overlay'), 'click'), 1);
    }

    {
      const { document } = createMockDocument([
        'search-panel',
        'sidebar-overlay',
        'search-input',
        'btn-do-search',
        'search-results-list',
        'search-status',
        'btn-search',
        'btn-search-close'
      ]);
      const Search = loadIsolatedConst('src/reader/search.js', 'Search', {
        document,
        setTimeout: global.setTimeout
      });

      Search.init();
      Search.init();

      assert.equal(count(document.getElementById('btn-search'), 'click'), 1);
      assert.equal(count(document.getElementById('btn-search-close'), 'click'), 1);
      assert.equal(count(document.getElementById('btn-do-search'), 'click'), 1);
      assert.equal(count(document.getElementById('search-input'), 'keydown'), 1);
    }

    {
      const { document } = createMockDocument([
        'image-viewer',
        'image-viewer-img',
        'image-viewer-container',
        'image-viewer-close',
        'img-zoom-in',
        'img-zoom-out',
        'img-zoom-reset'
      ]);
      const ImageViewer = loadIsolatedWindowExport('src/reader/image-viewer.js', 'ImageViewer', { document });

      ImageViewer.init();
      ImageViewer.init();

      assert.equal(count(document.getElementById('image-viewer-close'), 'click'), 1);
      assert.equal(count(document.getElementById('image-viewer'), 'click'), 1);
      assert.equal(count(document.getElementById('image-viewer-container'), 'wheel'), 1);
      assert.equal(count(document.getElementById('image-viewer-container'), 'mousedown'), 1);
      assert.equal(count(document.getElementById('img-zoom-in'), 'click'), 1);
      assert.equal(count(document.getElementById('img-zoom-out'), 'click'), 1);
      assert.equal(count(document.getElementById('img-zoom-reset'), 'click'), 1);
    }

    {
      const { document } = createMockDocument([
        'annotation-overlay',
        'annotation-popup',
        'annotation-body',
        'annotation-title',
        'annotation-close'
      ]);
      const Annotations = loadIsolatedWindowExport('src/reader/annotations.js', 'Annotations', { document });

      Annotations.init();
      Annotations.init();

      assert.equal(count(document.getElementById('annotation-close'), 'click'), 1);
      assert.equal(count(document.getElementById('annotation-overlay'), 'click'), 1);
    }

    {
      const { document } = createMockDocument([
        'selection-toolbar',
        'btn-add-note',
        'btn-clear-hl',
        'note-popup',
        'note-textarea',
        'btn-cancel-note',
        'btn-save-note',
        'btn-show-toolbar'
      ]);
      const windowListeners = new Map();
      const windowMock = {
        document,
        innerHeight: 800,
        addEventListener(type, handler) {
          const handlers = windowListeners.get(type) || [];
          handlers.push(handler);
          windowListeners.set(type, handlers);
        }
      };
      const Highlights = loadIsolatedWindowExport('src/reader/highlights.js', 'Highlights', {
        document,
        window: windowMock,
        setTimeout: global.setTimeout,
        EpubStorage: { async getHighlights() { return []; }, async saveHighlights() {} },
        Utils: { sanitizeColor(color) { return color; } }
      });

      Highlights.init();
      Highlights.init();

      assert.equal((windowListeners.get('mousedown') || []).length, 1);
      assert.equal(count(document.getElementById('btn-show-toolbar'), 'click'), 1);
    }
  });
});
