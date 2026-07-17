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

  test.it('旧失败的 cooldown 不得递减成功后新一轮失败计数', async () => {
    const originalIndexedDb = global.indexedDB;
    const originalSetTimeout = global.setTimeout;
    const gateway = global.DbGateway;
    const originalDbPromise = gateway._dbPromise;
    const originalRetryCount = gateway._retryCount;
    const originalRetryEpoch = gateway._retryEpoch;
    const requests = [];
    const cooldowns = [];

    try {
      global.indexedDB = {
        open() {
          const request = { onsuccess: null, onerror: null, onupgradeneeded: null };
          requests.push(request);
          return request;
        }
      };
      global.setTimeout = (fn) => {
        cooldowns.push(fn);
        return cooldowns.length;
      };
      gateway._dbPromise = null;
      gateway._retryCount = 0;
      gateway._retryEpoch = 0;

      const firstFailure = gateway.connect();
      requests[0].onerror({ target: { error: new Error('first failure') } });
      await assert.rejects(firstFailure, /first failure/);
      assert.equal(gateway._retryCount, 1);

      const db = { close() {}, onclose: null, onversionchange: null };
      const success = gateway.connect();
      requests[1].onsuccess({ target: { result: db } });
      await success;
      assert.equal(gateway._retryCount, 0);
      db.onclose();

      const newFailure = gateway.connect();
      requests[2].onerror({ target: { error: new Error('new failure') } });
      await assert.rejects(newFailure, /new failure/);
      assert.equal(gateway._retryCount, 1);

      cooldowns[0]();
      assert.equal(gateway._retryCount, 1,
        '成功前旧 cooldown 不得消耗成功后新失败的计数');
      cooldowns[1]();
      assert.equal(gateway._retryCount, 0);
    } finally {
      gateway._dbPromise = originalDbPromise;
      gateway._retryCount = originalRetryCount;
      gateway._retryEpoch = originalRetryEpoch;
      global.indexedDB = originalIndexedDb;
      global.setTimeout = originalSetTimeout;
    }
  });

  test.it('indexedDB.open 同步抛错后不缓存拒绝并允许后续重连', async () => {
    const originalIndexedDb = global.indexedDB;
    const originalSetTimeout = global.setTimeout;
    const gateway = global.DbGateway;
    const originalDbPromise = gateway._dbPromise;
    const originalRetryCount = gateway._retryCount;
    const originalRetryEpoch = gateway._retryEpoch;
    const cooldowns = [];
    let openCount = 0;

    try {
      global.indexedDB = {
        open() {
          openCount++;
          if (openCount === 1) throw new Error('synchronous open failure');
          const request = { onsuccess: null, onerror: null, onupgradeneeded: null };
          setImmediate(() => request.onsuccess({
            target: { result: { close() {}, onclose: null, onversionchange: null } }
          }));
          return request;
        }
      };
      global.setTimeout = (fn) => {
        cooldowns.push(fn);
        return cooldowns.length;
      };
      gateway._dbPromise = null;
      gateway._retryCount = 0;
      gateway._retryEpoch = 0;

      await assert.rejects(() => gateway.connect(), /synchronous open failure/);
      assert.equal(gateway._dbPromise, null, '同步异常不得缓存 rejected Promise');
      assert.equal(gateway._retryCount, 1, '同步异常也应计入重试冷却');

      await gateway.connect();
      assert.equal(openCount, 2, '后续 connect 应重新调用 indexedDB.open');
      assert.equal(gateway._retryCount, 0);
      cooldowns[0]();
      assert.equal(gateway._retryCount, 0, '成功前的 cooldown 应被 retry epoch 作废');
    } finally {
      gateway._dbPromise = originalDbPromise;
      gateway._retryCount = originalRetryCount;
      gateway._retryEpoch = originalRetryEpoch;
      global.indexedDB = originalIndexedDb;
      global.setTimeout = originalSetTimeout;
    }
  });

  test.it('写事务 abort 会拒绝调用方 Promise', async () => {
    const gateway = global.DbGateway;
    const originalDbPromise = gateway._dbPromise;
    const abortError = new Error('transaction aborted');
    let transaction = null;
    gateway._dbPromise = Promise.resolve({
      objectStoreNames: { contains: () => true },
      transaction() {
        transaction = {
          error: abortError,
          objectStore() {
            return { put() { return {}; } };
          }
        };
        return transaction;
      }
    });

    try {
      const write = gateway.put('covers', { bookId: 'book-abort' });
      while (!transaction) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(typeof transaction?.onabort, 'function');
      transaction.onabort();
      await assert.rejects(write, /transaction aborted/);
    } finally {
      gateway._dbPromise = originalDbPromise;
    }
  });

  test.it('读事务 abort 会拒绝调用方 Promise', async () => {
    const gateway = global.DbGateway;
    const originalDbPromise = gateway._dbPromise;
    const abortError = new Error('read transaction aborted');
    let transaction = null;
    gateway._dbPromise = Promise.resolve({
      objectStoreNames: { contains: () => true },
      transaction() {
        transaction = {
          error: abortError,
          objectStore() { return { get() { return {}; } }; }
        };
        return transaction;
      }
    });

    try {
      const read = gateway.get('covers', 'book-abort');
      while (!transaction) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(typeof transaction.onabort, 'function');
      transaction.onabort();
      await assert.rejects(read, /read transaction aborted/);
    } finally {
      gateway._dbPromise = originalDbPromise;
    }
  });
});
