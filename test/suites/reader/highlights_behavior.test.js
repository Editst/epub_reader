'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createElement(id) {
  const listeners = {};
  return {
    id,
    dataset: {},
    style: {},
    value: '',
    ownerDocument: {
      defaultView: {
        frameElement: {
          getBoundingClientRect() {
            return { top: 0, left: 0 };
          }
        }
      }
    },
    classList: {
      _set: new Set(),
      add(name) { this._set.add(name); },
      remove(name) { this._set.delete(name); },
      contains(name) { return this._set.has(name); },
      toggle(name, force) {
        if (force) this.add(name);
        else this.remove(name);
      }
    },
    addEventListener(type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    dispatch(type, event = {}) {
      (listeners[type] || []).forEach(fn => fn(event));
    },
    contains() { return false; },
    closest() { return null; },
    focus() {},
    getBoundingClientRect() {
      return { top: 100, left: 100, bottom: 120, width: 20 };
    },
    querySelectorAll(selector) {
      if (selector !== '.color-btn') return [];
      return ['#ffeb3b', '#81c784', '#64b5f6'].map((color) => {
        const btn = createElement(`color-${color}`);
        btn.dataset.color = color;
        return btn;
      });
    }
  };
}

function loadHighlights(storedHighlights) {
  const elements = new Map();
  const documentMock = {
    createElement,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(id));
      return elements.get(id);
    }
  };

  const annotations = [];
  const currentContents = [];
  const rendition = {
    annotations: {
      highlight(cfi, data, cb, className, styles) {
        annotations.push({ type: 'highlight', cfi, cb, className, styles });
      },
      underline(cfi, data, cb, className, styles) {
        annotations.push({ type: 'underline', cfi, cb, className, styles });
      },
      remove(cfi, type) {
        const index = annotations.findIndex(item => item.cfi === cfi && item.type === type);
        if (index !== -1) annotations.splice(index, 1);
      }
    },
    getContents() {
      return currentContents;
    },
    hooks: {
      content: {
        callbacks: [],
        register(fn) {
          this.callbacks.push(fn);
        }
      }
    },
    on() {},
    off() {},
    book: {
      async getRange() {
        return { toString: () => 'text' };
      }
    }
  };

  const context = {
    window: {
      addEventListener() {},
      innerHeight: 800
    },
    setTimeout(fn) { fn(); },
    document: documentMock,
    EpubStorage: {
      async getHighlights() {
        return storedHighlights.map(item => ({ ...item }));
      },
      async saveHighlights(bookId, highlights) {
        storedHighlights.splice(0, storedHighlights.length, ...highlights.map(item => ({ ...item })));
      }
    },
    console
  };
  context.window.window = context.window;
  context.window.document = documentMock;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('src/reader/highlights.js', 'utf8'), context);

  return {
    Highlights: context.window.Highlights,
    rendition,
    annotations,
    currentContents,
    elements
  };
}

test.describe('Reader Highlights 行为', () => {
  test.it('重复绑定同一本书不会叠加已有高亮注解', async () => {
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: '', timestamp: 1 }];
    const { Highlights, rendition, annotations } = loadHighlights(stored);

    await Highlights.setBookDetails('book-1', 'a.epub', rendition);
    await Highlights.setBookDetails('book-1', 'a.epub', rendition);

    assert.equal(annotations.filter(item => item.type === 'highlight').length, 1);
  });

  test.it('删除高亮后当前页面不残留重复渲染的注解', async () => {
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: '', timestamp: 1 }];
    const { Highlights, rendition, annotations, elements } = loadHighlights(stored);

    await Highlights.setBookDetails('book-1', 'a.epub', rendition);
    await Highlights.setBookDetails('book-1', 'a.epub', rendition);
    annotations[0].cb({
      stopPropagation() {},
      target: createElement('rendered-highlight')
    }, 'epubcfi(/6/2)');
    elements.get('btn-clear-hl').dispatch('click', { stopPropagation() {} });

    assert.equal(annotations.length, 0);
    assert.deepEqual(stored, []);
  });

  test.it('重复绑定同一个 rendition 不会叠加 content hook', async () => {
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: '', timestamp: 1 }];
    const { Highlights, rendition } = loadHighlights(stored);

    await Highlights.setBookDetails('book-1', 'a.epub', rendition);
    await Highlights.setBookDetails('book-1', 'a.epub', rendition);

    assert.equal(rendition.hooks.content.callbacks.length, 1);
  });

  test.it('iframe 空白点击即使保留原生选区也会关闭高亮悬浮栏', async () => {
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: '', timestamp: 1 }];
    const { Highlights, rendition, annotations, elements } = loadHighlights(stored);
    const contentListeners = {};
    const contents = {
      document: {
        addEventListener(type, fn) {
          contentListeners[type] = fn;
        }
      },
      window: {
        getSelection() {
          return { isCollapsed: false };
        }
      }
    };

    await Highlights.setBookDetails('book-1', 'a.epub', rendition);
    rendition.hooks.content.callbacks[0](contents);
    annotations[0].cb({
      stopPropagation() {},
      target: createElement('rendered-highlight')
    }, 'epubcfi(/6/2)');

    assert.equal(elements.get('selection-toolbar').classList.contains('show'), true);

    contentListeners.mousedown({ target: createElement('blank-page') });

    assert.equal(elements.get('selection-toolbar').classList.contains('show'), false);
  });

  test.it('setBookDetails 在首屏 display 后调用时也会绑定当前 iframe 空白点击关闭', async () => {
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: '', timestamp: 1 }];
    const { Highlights, rendition, annotations, currentContents, elements } = loadHighlights(stored);
    const contentListeners = {};
    currentContents.push({
      document: {
        addEventListener(type, fn) {
          contentListeners[type] = fn;
        }
      },
      window: {
        getSelection() {
          return { isCollapsed: false };
        }
      }
    });

    await Highlights.setBookDetails('book-1', 'a.epub', rendition);
    annotations[0].cb({
      stopPropagation() {},
      target: createElement('rendered-highlight')
    }, 'epubcfi(/6/2)');

    assert.equal(elements.get('selection-toolbar').classList.contains('show'), true);
    assert.equal(typeof contentListeners.mousedown, 'function');

    contentListeners.mousedown({ target: createElement('blank-page') });

    assert.equal(elements.get('selection-toolbar').classList.contains('show'), false);
  });
});
