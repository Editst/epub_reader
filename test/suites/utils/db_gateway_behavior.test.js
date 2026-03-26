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

    const gateway = global.DbGateway;
    gateway._dbPromise = null;
    gateway._retryCount = 0;

    await gateway.connect();

    global.indexedDB = originalIndexedDb;
    global.setTimeout = originalSetTimeout;

    assert.deepEqual(createdIndexes, [{
      name: 'files',
      indexName: 'by_filename',
      keyPath: 'filename',
      opts: { unique: false }
    }]);
  });
});
