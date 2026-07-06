const fs = require('node:fs');
const vm = require('node:vm');

function loadWindowScript(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  global.window = global;
  vm.runInThisContext(code, { filename: filePath });
}

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...names) {
      names.forEach((name) => set.add(name));
    },
    remove(...names) {
      names.forEach((name) => set.delete(name));
    },
    toggle(name, force) {
      if (force === true) {
        set.add(name);
        return true;
      }
      if (force === false) {
        set.delete(name);
        return false;
      }
      if (set.has(name)) {
        set.delete(name);
        return false;
      }
      set.add(name);
      return true;
    },
    contains(name) {
      return set.has(name);
    },
    toString() {
      return Array.from(set).join(' ');
    }
  };
}

function createMockElement(id = '', tagName = 'DIV') {
  const el = {
    id,
    tagName: tagName.toUpperCase(),
    textContent: '',
    innerHTML: '',
    value: '',
    title: '',
    dataset: {},
    style: {},
    files: [],
    classList: createClassList(),
    children: [],
    listeners: new Map(),
    focus() {},
    blur() {},
    click() {
      const handlers = this.listeners.get('click') || [];
      handlers.forEach((handler) => handler({ target: this, preventDefault() {}, stopImmediatePropagation() {} }));
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    append(...children) {
      children.forEach((child) => {
        child.parentNode = this;
        this.children.push(child);
      });
    },
    remove() {
      if (!this.parentNode || !this.parentNode.children) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      handlers.push(handler);
      this.listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      this.listeners.set(type, handlers.filter((item) => item !== handler));
    },
    dispatch(type, event = {}) {
      const handlers = this.listeners.get(type) || [];
      handlers.forEach((handler) => handler({
        target: this,
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {},
        ...event
      }));
    },
    closest() {
      return null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const matches = [];
      const visit = (node) => {
        if (!node || !node.children) return;
        node.children.forEach((child) => {
          if (matchesSelector(child, selector)) matches.push(child);
          visit(child);
        });
      };
      visit(this);
      return matches;
    }
  };
  return el;
}

function matchesSelector(el, selector) {
  if (!el || !selector) return false;
  if (selector.startsWith('.')) {
    const className = selector.slice(1);
    return (el.classList && el.classList.contains(className)) ||
      String(el.className || '').split(/\s+/).includes(className);
  }
  if (selector.startsWith('#')) {
    return el.id === selector.slice(1);
  }
  return el.tagName && el.tagName.toLowerCase() === selector.toLowerCase();
}

function createMockDocument(elementIds = []) {
  const elements = new Map();
  const listeners = new Map();

  function ensureElement(id) {
    if (!elements.has(id)) {
      elements.set(id, createMockElement(id));
    }
    return elements.get(id);
  }

  elementIds.forEach((id) => ensureElement(id));

  const document = {
    hidden: false,
    title: '',
    activeElement: null,
    documentElement: {
      attrs: {},
      setAttribute(name, value) {
        this.attrs[name] = value;
      }
    },
    body: createMockElement('body', 'BODY'),
    getElementById(id) {
      return ensureElement(id);
    },
    querySelector(selector) {
      if (selector === '#loading-overlay .loading-text') {
        return ensureElement('loading-text');
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      return createMockElement('', tag);
    },
    createElementNS(_ns, tag) {
      return createMockElement('', tag);
    },
    createTextNode(text) {
      const node = createMockElement('', '#text');
      node.nodeType = 3;
      node.textContent = String(text);
      return node;
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      listeners.set(type, handlers.filter((item) => item !== handler));
    },
    dispatchEvent(type, event = {}) {
      const handlers = listeners.get(type) || [];
      handlers.forEach((handler) => handler(event));
    }
  };

  return { document, elements, ensureElement };
}

function withPatchedGlobals(patches, fn) {
  const originals = new Map();
  Object.keys(patches).forEach((key) => {
    originals.set(key, global[key]);
    global[key] = patches[key];
  });
  try {
    return fn();
  } finally {
    Object.keys(patches).forEach((key) => {
      global[key] = originals.get(key);
    });
  }
}

module.exports = {
  loadWindowScript,
  createMockDocument,
  createMockElement,
  createClassList,
  withPatchedGlobals
};
