'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test.describe('DbGateway 行为与 Schema 契约', () => {
  test.it('DB v4 初始化 files store 时创建 by_filename 索引', async () => {
    const originalIndexedDb = global.indexedDB;
    const originalSetTimeout = global.setTimeout;
    const createdIndexes = [];

    global.setTimeout = (fn) => {
      fn();
      return 1;
    };
    const gateway = global.DbGateway;
    try {
      global.indexedDB = {
        open() {
          const request = {
            result: null,
            onupgradeneeded: null,
            onsuccess: null
          };
          setImmediate(() => {
            const stores = new Set();
            request.result = {
              objectStoreNames: {
                contains(name) {
                  return stores.has(name);
                }
              },
              createObjectStore(name, options) {
                stores.add(name);
                return {
                  keyPath: options.keyPath,
                  createIndex(indexName, keyPath, opts) {
                    createdIndexes.push({ name, indexName, keyPath, opts });
                  }
                };
              },
              deleteObjectStore(name) {
                stores.delete(name);
              }
            };
            request.onupgradeneeded({ target: request, oldVersion: 0 });
            request.onsuccess({ target: request });
          });
          return request;
        }
      };

      gateway._dbPromise = null;
      gateway._retryCount = 0;
      await gateway.connect();
    } finally {
      gateway._dbPromise = null;
      gateway._retryCount = 0;
      global.indexedDB = originalIndexedDb;
      global.setTimeout = originalSetTimeout;
    }

    assert.deepEqual(createdIndexes, [{
      name: 'files',
      indexName: 'by_filename',
      keyPath: 'filename',
      opts: { unique: false }
    }]);
  });

  test.it('连接 versionchange 或 close 后清空缓存并在下次访问重连', async () => {
    const originalIndexedDb = global.indexedDB;
    const gateway = global.DbGateway;
    let openCount = 0;

    try {
      global.indexedDB = {
        open() {
          openCount++;
          const request = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
          const db = {
            objectStoreNames: { contains: () => true },
            closeCount: 0,
            close() {
              this.closeCount++;
            },
            onversionchange: null,
            onclose: null
          };
          setImmediate(() => {
            request.result = db;
            request.onsuccess({ target: request });
          });
          return request;
        }
      };

      gateway._dbPromise = null;
      gateway._retryCount = 0;

      const first = await gateway.connect();
      first.onversionchange();
      assert.equal(first.closeCount, 1, 'versionchange 应主动关闭旧连接');
      assert.equal(gateway._dbPromise, null, 'versionchange 应使缓存连接失效');

      const second = await gateway.connect();
      assert.notEqual(second, first, '下一次访问应建立新连接');
      assert.equal(openCount, 2);

      first.onclose();
      assert.notEqual(gateway._dbPromise, null, '旧连接迟到的 close 不得清除新连接缓存');

      second.onclose();
      assert.equal(gateway._dbPromise, null, '浏览器关闭连接后应使缓存连接失效');
    } finally {
      gateway._dbPromise = null;
      gateway._retryCount = 0;
      global.indexedDB = originalIndexedDb;
    }
  });
});
