'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const _store = {};
const _mockChrome = {
  storage: {
    local: {
      get(keys, cb) {
        const result = {};
        if (keys === null) {
          Object.assign(result, _store);
        } else {
          [].concat(keys).forEach(k => { if (_store[k] !== undefined) result[k] = _store[k]; });
        }
        cb(result);
      },
      set(data, cb) { Object.assign(_store, data); if (cb) cb(); },
      remove(keys, cb) { [].concat(keys).forEach(k => delete _store[k]); if (cb) cb(); },
      _reset() { Object.keys(_store).forEach(k => delete _store[k]); },
      get _data() { return _store; }
    }
  },
  runtime: { getURL: (p) => `chrome-extension://test/${p}`, lastError: null },
  tabs:    { create: () => {} }
};
global.chrome = _mockChrome;

global.document = {
  createElement(tag) {
    const el = {
      textContent: '',
      get innerHTML() {
        return this.textContent
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }
    };
    return el;
  }
};

if (!global.crypto) {
  global.crypto = {
    subtle: {
      digest: async (algo, data) => new Uint8Array(32).fill(0xab).buffer
    }
  };
}
global.TextEncoder = class { encode(s) { return Buffer.from(s, 'utf8'); } };

let _idbStore = {};
global.indexedDB = {
  open(name, version) {
    const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
    setImmediate(() => {
      req.result = {
        objectStoreNames: { contains: () => false },
        createObjectStore: () => ({ createIndex: () => {} }),
        transaction: (stores, mode) => {
          const tx = { oncomplete: null, onerror: null };
          const store = {
            put: (val) => {
              const r2 = { onsuccess: null, onerror: null };
              setImmediate(() => {
                const key = val.bookId || val.id;
                if (key) _idbStore[`${stores[0]}:${key}`] = val;
                if (r2.onsuccess) r2.onsuccess({ target: { result: key } });
                if (tx.oncomplete) tx.oncomplete();
              });
              return r2;
            },
            get: (key) => {
              const r2 = { onsuccess: null, onerror: null };
              setImmediate(() => {
                r2.result = _idbStore[`${stores[0]}:${key}`] || undefined;
                if (r2.onsuccess) r2.onsuccess({ target: { result: r2.result } });
                if (tx.oncomplete) tx.oncomplete();
              });
              return r2;
            },
            delete: (key) => {
              const r2 = { onsuccess: null, onerror: null };
              setImmediate(() => {
                delete _idbStore[`${stores[0]}:${key}`];
                if (r2.onsuccess) r2.onsuccess({});
                if (tx.oncomplete) tx.oncomplete();
              });
              return r2;
            },
            openCursor: () => {
              const r2 = { onsuccess: null, onerror: null };
              setImmediate(() => { if (r2.onsuccess) r2.onsuccess({ target: { result: null } }); });
              return r2;
            }
          };
          tx.objectStore = () => store;
          return tx;
        }
      };
      if (req.onupgradeneeded) req.onupgradeneeded({ target: req, oldVersion: 0 });
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  }
};

function loadWindowExport(filePath, exportName) {
  const code = fs.readFileSync(filePath, 'utf8');
  vm.runInThisContext(code, { filename: filePath });
  return global[exportName];
}
global.window = global;
global.Utils = loadWindowExport('src/utils/utils.js', 'Utils');
global.DbGateway = loadWindowExport('src/utils/db-gateway.js', 'DbGateway');
global.EpubStorage = loadWindowExport('src/utils/storage.js', 'EpubStorage');

const _dbStore = {};
const _mockDb = {
  _store: _dbStore,
  _reset() { Object.keys(_dbStore).forEach(k => delete _dbStore[k]); },
  async get(store, key) { return _dbStore[`${store}:${key}`] || null; },
  async put(store, data) { const k = data.bookId || data.id; _dbStore[`${store}:${k}`] = data; },
  async delete(store, key) { delete _dbStore[`${store}:${key}`]; },
  async getAllMeta(store, fields) { 
    return Object.entries(_dbStore)
      .filter(([k]) => k.startsWith(store + ':'))
      .map(([, v]) => v);
  },
  async getAll(store) { return Object.entries(_dbStore).filter(([k]) => k.startsWith(store+':')).map(([,v])=>v); }
};

function resetAll() {
  chrome.storage.local._reset();
  _mockDb._reset();
  EpubStorage._dbGateway = _mockDb;
  EpubStorage._preferencesQueue = Promise.resolve();
  EpubStorage._recentBooksQueue = Promise.resolve();
  EpubStorage._bookMetaQueue = new Map();
  EpubStorage._bookResourceWrites = new Map();
  EpubStorage._bookDeleteTasks = new Map();
  EpubStorage._deletingBookIds = new Set();
}
global.resetAll = resetAll;

function findTestFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  list.forEach(file => {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      results = results.concat(findTestFiles(fullPath));
    } else if (file.name.endsWith('.test.js')) {
      results.push(fullPath);
    }
  });
  return results;
}

resetAll();

findTestFiles('test/suites')
  .sort()
  .forEach((filePath) => {
    const absPath = path.resolve(filePath);
    require(absPath);
  });
