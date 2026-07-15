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
      if (!this._colorBtns) {
        this._colorBtns = ['#ffeb3b', '#81c784', '#64b5f6'].map((color) => {
          const btn = createElement(`color-${color}`);
          btn.dataset.color = color;
          return btn;
        });
      }
      return this._colorBtns;
    }
  };
}

function loadHighlights(storedHighlights, options = {}) {
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
  const selectedHandlers = new Set();
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
    on(type, fn) {
      if (type === 'selected') selectedHandlers.add(fn);
    },
    off(type, fn) {
      if (type === 'selected') selectedHandlers.delete(fn);
    },
    triggerSelected(cfiRange, contents) {
      selectedHandlers.forEach(fn => fn(cfiRange, contents));
    },
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
    Utils: {
      sanitizeColor(colorStr) {
        if (!colorStr || colorStr === 'transparent') return colorStr || 'transparent';
        return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(colorStr)
          ? colorStr
          : '#ffeb3b';
      },
      resolveDisplayColor(color) {
        const safeColor = this.sanitizeColor(color);
        return safeColor && safeColor !== 'transparent' ? safeColor : '#ffeb3b';
      }
    },
    console
  };
  if (options.EpubStorage) {
    context.EpubStorage = options.EpubStorage;
  }
  if (typeof context.EpubStorage.updateHighlights !== 'function') {
    context.EpubStorage.updateHighlights = async (bookId, mutator) => {
      const current = await context.EpubStorage.getHighlights(bookId);
      const mutated = mutator(current.map((item) => ({ ...item })));
      if (mutated === false) return current;
      const updated = mutated || current;
      await context.EpubStorage.saveHighlights(bookId, updated);
      return updated;
    };
  }
  if (options.console) {
    context.console = options.console;
  }
  context.Utils.safeWrite = (writer, warningLabel) => {
    try {
      return Promise.resolve(writer()).catch((error) => {
        context.console.warn(warningLabel, error);
      });
    } catch (error) {
      context.console.warn(warningLabel, error);
      return Promise.resolve();
    }
  };
  if (options.setTimeout) {
    context.setTimeout = options.setTimeout;
  }
  context.window.window = context.window;
  context.window.document = documentMock;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('src/reader/highlights.js', 'utf8'), context);
  context.window.Highlights.init();

  return {
    Highlights: context.window.Highlights,
    rendition,
    annotations,
    currentContents,
    elements,
    context
  };
}

test.describe('Reader Highlights 行为', () => {
  test.it('切书后忽略上一书延迟返回的高亮列表', async () => {
    let resolveOldHighlights;
    const { Highlights, rendition, annotations } = loadHighlights([], {
      EpubStorage: {
        async getHighlights(bookId) {
          if (bookId === 'old-book') {
            return new Promise((resolve) => { resolveOldHighlights = resolve; });
          }
          return [{ cfi: 'epubcfi(/6/4)', text: 'new', color: '#81c784', note: '', timestamp: 2 }];
        },
        async saveHighlights() {}
      }
    });

    const oldLoad = Highlights.setBookDetails('old-book', rendition);
    await Highlights.setBookDetails('new-book', rendition);
    resolveOldHighlights([{ cfi: 'epubcfi(/6/2)', text: 'old', color: '#ffeb3b', note: '', timestamp: 1 }]);
    await oldLoad;

    assert.deepEqual(annotations.map(item => item.cfi), ['epubcfi(/6/4)']);
  });

  test.it('高亮列表加载失败只记录告警并按空列表继续绑定', async () => {
    const warnings = [];
    const { Highlights, rendition, annotations } = loadHighlights([], {
      console: { ...console, warn(...args) { warnings.push(args); } },
      EpubStorage: {
        async getHighlights() {
          throw new Error('storage failed');
        },
        async saveHighlights() {}
      }
    });

    await Highlights.setBookDetails('book-1', rendition);

    assert.deepEqual(annotations, []);
    assert.match(String(warnings[0]?.[0] || ''), /load highlights failed/);
  });

  test.it('缺失或损坏的高亮颜色按默认高亮色渲染，显式 transparent 仍为纯笔记', async () => {
    const stored = [
      { cfi: 'epubcfi(/6/2)', text: 'missing', color: null, note: '', timestamp: 1 },
      { cfi: 'epubcfi(/6/4)', text: 'bad', color: '#12345', note: '', timestamp: 2 },
      { cfi: 'epubcfi(/6/6)', text: 'note', color: 'transparent', note: 'n', timestamp: 3 }
    ];
    const { Highlights, rendition, annotations } = loadHighlights(stored);

    await Highlights.setBookDetails('book-1', rendition);

    const baseHighlights = annotations.filter(item => item.type === 'highlight');
    assert.deepEqual(
      baseHighlights.map(item => [item.cfi, item.styles.fill]),
      [
        ['epubcfi(/6/2)', '#ffeb3b'],
        ['epubcfi(/6/4)', '#ffeb3b']
      ]
    );
    assert.equal(
      annotations.find(item => item.cfi === 'epubcfi(/6/6)' && item.type === 'underline')?.className,
      'epubjs-hl-note-only'
    );
    assert.equal(
      annotations.some(item => item.cfi === 'epubcfi(/6/6)' && item.type === 'highlight'),
      false
    );
  });

  test.it('切书后旧选择的高亮保存不会写入新书', async () => {
    const saveCalls = [];
    let resolveOldRange;
    const { Highlights, rendition, elements } = loadHighlights([], {
      EpubStorage: {
        async getHighlights() {
          return [];
        },
        async saveHighlights(bookId, highlights) {
          saveCalls.push({ bookId, highlights });
        }
      }
    });
    rendition.book.getRange = async () => new Promise((resolve) => { resolveOldRange = resolve; });

    await Highlights.setBookDetails('old-book', rendition);
    rendition.triggerSelected('epubcfi(/6/2)', {
      window: {
        frameElement: {
          getBoundingClientRect() {
            return { top: 0, left: 0 };
          }
        },
        getSelection() {
          return {
            rangeCount: 1,
            getRangeAt() {
              return {
                getBoundingClientRect() {
                  return { top: 100, left: 100, bottom: 120, width: 20 };
                }
              };
            }
          };
        }
      }
    });
    elements.get('selection-toolbar').querySelectorAll('.color-btn')[0].dispatch('click', {
      stopPropagation() {}
    });

    await Highlights.setBookDetails('new-book', rendition);
    resolveOldRange({ toString: () => 'old text' });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(saveCalls, []);
  });

  test.it('高亮保存失败只记录告警', async () => {
    const warnings = [];
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: '', timestamp: 1 }];
    const { Highlights, rendition, annotations, elements } = loadHighlights(stored, {
      console: { ...console, warn(...args) { warnings.push(args); } },
      EpubStorage: {
        async getHighlights() {
          return stored.map(item => ({ ...item }));
        },
        async saveHighlights() {
          throw new Error('save failed');
        }
      }
    });

    await Highlights.setBookDetails('book-1', rendition);
    annotations[0].cb({
      stopPropagation() {},
      target: createElement('rendered-highlight')
    }, 'epubcfi(/6/2)');
    elements.get('selection-toolbar').querySelectorAll('.color-btn')[1].dispatch('click', {
      stopPropagation() {}
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(String(warnings[0]?.[0] || ''), /save highlights failed/);
  });

  test.it('重复绑定同一本书不会叠加已有高亮注解', async () => {
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: '', timestamp: 1 }];
    const { Highlights, rendition, annotations } = loadHighlights(stored);

    await Highlights.setBookDetails('book-1', rendition);
    await Highlights.setBookDetails('book-1', rendition);

    assert.equal(annotations.filter(item => item.type === 'highlight').length, 1);
  });

  test.it('删除高亮后当前页面不残留重复渲染的注解', async () => {
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: '', timestamp: 1 }];
    const { Highlights, rendition, annotations, elements } = loadHighlights(stored);

    await Highlights.setBookDetails('book-1', rendition);
    await Highlights.setBookDetails('book-1', rendition);
    annotations[0].cb({
      stopPropagation() {},
      target: createElement('rendered-highlight')
    }, 'epubcfi(/6/2)');
    elements.get('btn-clear-hl').dispatch('click', { stopPropagation() {} });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(annotations.length, 0);
    assert.deepEqual(stored, []);
  });

  test.it('重复绑定同一个 rendition 不会叠加 content hook', async () => {
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: '', timestamp: 1 }];
    const { Highlights, rendition } = loadHighlights(stored);

    await Highlights.setBookDetails('book-1', rendition);
    await Highlights.setBookDetails('book-1', rendition);

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

    await Highlights.setBookDetails('book-1', rendition);
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

    await Highlights.setBookDetails('book-1', rendition);
    annotations[0].cb({
      stopPropagation() {},
      target: createElement('rendered-highlight')
    }, 'epubcfi(/6/2)');

    assert.equal(elements.get('selection-toolbar').classList.contains('show'), true);
    assert.equal(typeof contentListeners.mousedown, 'function');

    contentListeners.mousedown({ target: createElement('blank-page') });

    assert.equal(elements.get('selection-toolbar').classList.contains('show'), false);
  });

  test.it('切书后旧 iframe 的迟到空白点击不会关闭新书悬浮栏', async () => {
    const timers = [];
    const { Highlights, rendition, elements } = loadHighlights([], {
      setTimeout(fn) { timers.push(fn); }
    });
    const oldListeners = {};
    const oldContents = {
      document: {
        addEventListener(type, fn) { oldListeners[type] = fn; }
      },
      window: {
        getSelection() { return { isCollapsed: true }; }
      }
    };

    await Highlights.setBookDetails('old-book', rendition);
    rendition.hooks.content.callbacks[0](oldContents);
    await Highlights.setBookDetails('new-book', rendition);

    const toolbar = elements.get('selection-toolbar');
    toolbar.classList.add('show');
    oldListeners.mousedown();
    timers.splice(0).forEach((fn) => fn());

    assert.equal(toolbar.classList.contains('show'), true);
  });

  test.it('切书后旧高亮点击回调不会打开新书悬浮层', async () => {
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: 'note', timestamp: 1 }];
    const { Highlights, rendition, annotations, elements } = loadHighlights(stored);

    await Highlights.setBookDetails('old-book', rendition);
    const oldClick = annotations[0].cb;
    await Highlights.setBookDetails('new-book', rendition);

    oldClick({
      stopPropagation() {},
      target: createElement('old-rendered-highlight')
    });

    assert.equal(elements.get('selection-toolbar').classList.contains('show'), false);
    assert.equal(elements.get('note-popup').classList.contains('show'), false);
  });

  test.it('旧上下文内部操作计时器不会提前释放新书交互锁', async () => {
    const timers = [];
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: '', timestamp: 1 }];
    const { Highlights, rendition, annotations, elements } = loadHighlights(stored, {
      setTimeout(fn) { timers.push(fn); }
    });

    await Highlights.setBookDetails('old-book', rendition);
    annotations[0].cb({ stopPropagation() {}, target: createElement('old-highlight') });

    await Highlights.setBookDetails('new-book', rendition);
    const newClick = annotations[0].cb;
    const contentListeners = {};
    rendition.hooks.content.callbacks[0]({
      document: { addEventListener(type, fn) { contentListeners[type] = fn; } },
      window: { getSelection() { return { isCollapsed: true }; } }
    });
    newClick({ stopPropagation() {}, target: createElement('new-highlight') });

    timers.shift()(); // 旧上下文的 INTERNAL_ACTION_LOCK timer
    contentListeners.mousedown();
    timers.pop()(); // 当前 iframe 空白点击的 settle timer

    assert.equal(elements.get('selection-toolbar').classList.contains('show'), true);
  });

  test.it('更新已有高亮重渲染失败时会记录告警且保留数据保存', async () => {
    const stored = [{ cfi: 'epubcfi(/6/2)', text: 'A', color: '#ffeb3b', note: '', timestamp: 1 }];
    const { Highlights, rendition, annotations, elements } = loadHighlights(stored);
    const warnCalls = [];
    const originalWarn = console.warn;

    await Highlights.setBookDetails('book-1', rendition);
    annotations[0].cb({
      stopPropagation() {},
      target: createElement('rendered-highlight')
    }, 'epubcfi(/6/2)');

    rendition.annotations.remove = () => {
      throw new Error('remove failed');
    };
    console.warn = (...args) => warnCalls.push(args);
    elements.get('note-textarea').value = '新的笔记';
    elements.get('btn-save-note').dispatch('click', {});
    await Promise.resolve();
    await Promise.resolve();
    console.warn = originalWarn;

    assert.equal(stored[0].note, '新的笔记');
    assert.equal(warnCalls.length, 1);
    assert.match(String(warnCalls[0][0]), /reRenderHighlight failed/);
  });

  test.it('清空纯笔记内容会删除不可见记录', async () => {
    const stored = [{
      cfi: 'epubcfi(/6/2)', text: 'A', color: 'transparent', note: '旧笔记', timestamp: 1
    }];
    const { Highlights, rendition, annotations, elements } = loadHighlights(stored);

    await Highlights.setBookDetails('book-note-only', rendition);
    annotations[0].cb({
      stopPropagation() {},
      target: createElement('rendered-note')
    });
    elements.get('note-textarea').value = '   ';
    elements.get('btn-save-note').dispatch('click', {});
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(stored, []);
    assert.equal(annotations.length, 0);
  });

  test.it('新建空白纯笔记不会产生幽灵记录', async () => {
    const stored = [];
    const { Highlights, rendition, elements } = loadHighlights(stored);

    await Highlights.setBookDetails('book-empty-note', rendition);
    rendition.triggerSelected('epubcfi(/6/4)', {
      window: {
        frameElement: { getBoundingClientRect() { return { top: 0, left: 0 }; } },
        getSelection() {
          return {
            rangeCount: 1,
            getRangeAt() {
              return { getBoundingClientRect() { return { top: 10, left: 10, width: 10 }; } };
            }
          };
        }
      }
    });
    elements.get('btn-add-note').dispatch('click', { stopPropagation() {} });
    elements.get('note-textarea').value = '';
    elements.get('btn-save-note').dispatch('click', {});
    await Promise.resolve();

    assert.deepEqual(stored, []);
  });
});
