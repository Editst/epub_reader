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
  let _textContent = '';
  const el = {
    id,
    tagName: tagName.toUpperCase(),
    get textContent() {
      if (this.children && this.children.length > 0) {
        return this.children.map((c) => c.textContent).join('');
      }
      return _textContent;
    },
    set textContent(val) {
      _textContent = String(val ?? '');
      this.children = [];
    },
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
      this.dispatch('click');
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
    replaceChildren(...children) {
      this.children = [];
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
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = String(value);
      }
    },
    getAttribute(name) {
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return this.dataset && this.dataset[key] !== undefined ? this.dataset[key] : null;
      }
      return this[name] !== undefined ? this[name] : null;
    },
    hasAttribute(name) {
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return Boolean(this.dataset && this.dataset[key] !== undefined);
      }
      return this[name] !== undefined;
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
      let stopped = false;
      const evt = {
        target: this,
        currentTarget: this,
        preventDefault() {},
        stopPropagation() { stopped = true; },
        stopImmediatePropagation() { stopped = true; },
        ...event
      };
      let curr = this;
      while (curr && !stopped) {
        evt.currentTarget = curr;
        const handlers = curr.listeners.get(type) || [];
        for (const handler of handlers) {
          handler(evt);
          if (stopped) break;
        }
        curr = curr.parentNode || null;
      }
    },
    closest(selector) {
      let curr = this;
      while (curr) {
        if (matchesSelector(curr, selector)) return curr;
        curr = curr.parentNode || null;
      }
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
  selector = selector.trim();

  // 属性选择器或包含属性选择器的前缀组合，如 [data-filter="note"] 或 .btn[data-filter="note"]
  if (selector.includes('[') && selector.endsWith(']')) {
    const bracketIdx = selector.indexOf('[');
    const prefix = selector.slice(0, bracketIdx);
    const attrPart = selector.slice(bracketIdx);
    if (prefix && !matchesSelector(el, prefix)) return false;
    const inner = attrPart.slice(1, -1);
    if (inner.includes('=')) {
      const [rawAttr, rawVal] = inner.split('=');
      const attr = rawAttr.trim();
      const val = rawVal.trim().replace(/^['"]|['"]$/g, '');
      const actualVal = el.getAttribute ? el.getAttribute(attr) : (el[attr] ?? el.dataset?.[attr.replace('data-', '')]);
      return actualVal === val;
    } else {
      const attr = inner.trim();
      return el.hasAttribute ? el.hasAttribute(attr) : (attr in el || (el.dataset && attr.replace('data-', '') in el.dataset));
    }
  }

  if (selector.startsWith('.')) {
    const classes = selector.split('.').filter(Boolean);
    return classes.every((cls) => (el.classList && el.classList.contains(cls)) ||
      String(el.className || '').split(/\s+/).includes(cls));
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
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const results = [];
      const visited = new Set();
      const visit = (node) => {
        if (!node || visited.has(node)) return;
        visited.add(node);
        if (matchesSelector(node, selector)) {
          results.push(node);
        }
        if (node.children) {
          node.children.forEach(visit);
        }
      };
      visit(this.body);
      for (const el of elements.values()) {
        visit(el);
      }
      return results;
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
      const evt = {
        target: this,
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {},
        ...event
      };
      handlers.forEach((handler) => handler(evt));
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
