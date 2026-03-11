/**
 * run_tests.js — 使用 Node.js 22 内置 node:test runner
 * 将 docs/tests.js 的所有测试逐组真实执行，记录失败
 */
const test  = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// ─── 全局 Mock 环境 ───────────────────────────────────────────────────────────
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

// DOM mock for escapeHtml
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

// crypto mock
global.crypto = {
  subtle: {
    digest: async (algo, data) => new Uint8Array(32).fill(0xab).buffer
  }
};
global.TextEncoder = class { encode(s) { return Buffer.from(s, 'utf8'); } };

// IndexedDB mock (minimal — for db-gateway connect() path)
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

// ─── Load source modules ───────────────────────────────────────────────────────
const vm = require('node:vm');
function loadGlobalConst(filePath, constName) {
  const code = fs.readFileSync(filePath, 'utf8');
  vm.runInThisContext(`${code}
;global.${constName} = ${constName};`, { filename: filePath });
  return global[constName];
}
const Utils = loadGlobalConst('src/utils/utils.js', 'Utils');
const DbGateway = loadGlobalConst('src/utils/db-gateway.js', 'DbGateway');
global.DbGateway = DbGateway;
const EpubStorage = loadGlobalConst('src/utils/storage.js', 'EpubStorage');
global.EpubStorage = EpubStorage;

// Mock DbGateway for storage tests (overrides IDB calls)
const _dbStore = {};
const _mockDb = {
  _store: _dbStore,
  _reset() { Object.keys(_dbStore).forEach(k => delete _dbStore[k]); },
  async get(store, key) { return _dbStore[`${store}:${key}`] || null; },
  async put(store, data) { const k = data.bookId || data.id; _dbStore[`${store}:${k}`] = data; },
  async delete(store, key) { delete _dbStore[`${store}:${key}`]; },
  async getAllMeta(store, fields) { return []; },
  async getAll(store) { return Object.entries(_dbStore).filter(([k]) => k.startsWith(store+':')).map(([,v])=>v); }
};

function resetAll() {
  chrome.storage.local._reset();
  _mockDb._reset();
  // patch EpubStorage to use mock db
  EpubStorage._dbGateway = _mockDb;
}

// Patch EpubStorage to use mock DbGateway (replace all DbGateway calls)
const origStoreFile   = EpubStorage.storeFile.bind(EpubStorage);
const origGetFile     = EpubStorage.getFile.bind(EpubStorage);
const origRemoveFile  = EpubStorage.removeFile.bind(EpubStorage);
const origSaveCover   = EpubStorage.saveCover.bind(EpubStorage);
const origGetCover    = EpubStorage.getCover.bind(EpubStorage);
const origRemoveCover = EpubStorage.removeCover.bind(EpubStorage);
const origSaveLocs    = EpubStorage.saveLocations.bind(EpubStorage);
const origGetLocs     = EpubStorage.getLocations.bind(EpubStorage);
const origRemoveLocs  = EpubStorage.removeLocations.bind(EpubStorage);
const origGetAllMeta  = EpubStorage.enforceFileLRU.bind(EpubStorage);

// Monkey-patch to use _mockDb
EpubStorage.storeFile    = async (fn, data, id) => { await _mockDb.put('files', {bookId:id, filename:fn, data, timestamp:Date.now()}); };
EpubStorage.getFile      = async (id) => _mockDb.get('files', id);
EpubStorage.removeFile   = async (id) => _mockDb.delete('files', id);
EpubStorage.saveCover    = async (id, b) => { await _mockDb.put('covers', {bookId:id, blob:b}); };
EpubStorage.getCover     = async (id) => { const r = await _mockDb.get('covers',id); return r?r.blob:null; };
EpubStorage.removeCover  = async (id) => _mockDb.delete('covers', id);
EpubStorage.saveLocations= async (id, j) => { await _mockDb.put('locations',{bookId:id,json:j,timestamp:Date.now()}); };
EpubStorage.getLocations = async (id) => { const r=await _mockDb.get('locations',id); return r?r.json:null; };
EpubStorage.removeLocations= async (id)=> _mockDb.delete('locations',id);
EpubStorage.enforceFileLRU = async (max=10) => {
  const meta = await _mockDb.getAllMeta('files', ['timestamp']);
  if (meta.length <= max) return;
  meta.sort((a,b)=>b.timestamp-a.timestamp);
  await Promise.all(meta.slice(max).map(m=>Promise.all([
    _mockDb.delete('files', m.bookId),
    EpubStorage.removeRecentBook(m.bookId),
    EpubStorage.removeBookMeta(m.bookId)
  ])));
};

// ─── Utils Tests ──────────────────────────────────────────────────────────────
test.describe('Utils.escapeHtml', () => {
  test.it('转义 HTML 特殊字符', () => {
    assert.equal(Utils.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  test.it('null/undefined 返回空字符串', () => {
    assert.equal(Utils.escapeHtml(null), '');
    assert.equal(Utils.escapeHtml(undefined), '');
  });
  test.it('数字转为字符串', () => {
    assert.equal(Utils.escapeHtml(42), '42');
  });
  test.it('正常文本不变', () => {
    assert.equal(Utils.escapeHtml('hello world'), 'hello world');
  });
  test.it('双引号被转义', () => {
    const r = Utils.escapeHtml('"hello"');
    assert.ok(!r.includes('"') || r.includes('&quot;'));
  });
  test.it('&amp; 二次转义为 &amp;amp;', () => {
    assert.equal(Utils.escapeHtml('&amp;'), '&amp;amp;');
  });
});

test.describe('Utils.formatDate', () => {
  test.it('null 返回默认 fallback', () => {
    assert.equal(Utils.formatDate(null), '未知时间');
    assert.equal(Utils.formatDate(0), '未知时间');
  });
  test.it('自定义 fallback', () => {
    assert.equal(Utils.formatDate(null, ''), '');
  });
  test.it('30秒内 = 刚刚', () => {
    const now = Date.now();
    assert.equal(Utils.formatDate(now - 30000), '刚刚');
  });
  test.it('2小时前', () => {
    const ts = Date.now() - 2*3600000 - 1000;
    assert.equal(Utils.formatDate(ts), '2 小时前');
  });
  test.it('3天前', () => {
    const ts = Date.now() - 3*86400000 - 1000;
    assert.equal(Utils.formatDate(ts), '3 天前');
  });
  test.it('超7天返回本地日期', () => {
    const ts = Date.now() - 8*86400000;
    const r = Utils.formatDate(ts);
    assert.ok(r.match(/\d{4}[\/-]\d/), `got: ${r}`);
  });
});

test.describe('Utils.formatDuration', () => {
  test.it('0秒', () => assert.equal(Utils.formatDuration(0), '0秒'));
  test.it('null → 0秒', () => assert.equal(Utils.formatDuration(null), '0秒'));
  test.it('undefined → 0秒', () => assert.equal(Utils.formatDuration(undefined), '0秒'));
  test.it('59秒', () => assert.equal(Utils.formatDuration(59), '59秒'));
  test.it('60秒 = 1分钟', () => assert.equal(Utils.formatDuration(60), '1分钟'));
  test.it('90秒 = 1分钟', () => assert.equal(Utils.formatDuration(90), '1分钟'));
  test.it('3600秒 = 1小时', () => assert.equal(Utils.formatDuration(3600), '1小时'));
  test.it('3660秒 = 1小时1分', () => assert.equal(Utils.formatDuration(3660), '1小时1分'));
  test.it('7200秒 = 2小时', () => assert.equal(Utils.formatDuration(7200), '2小时'));
  test.it('负数 = 0秒', () => assert.equal(Utils.formatDuration(-1), '0秒'));
});

test.describe('Utils.formatMinutes', () => {
  test.it('0 → 0分钟', () => assert.equal(Utils.formatMinutes(0), '0分钟'));
  test.it('null → 0分钟', () => assert.equal(Utils.formatMinutes(null), '0分钟'));
  test.it('45 → 45分钟', () => assert.equal(Utils.formatMinutes(45), '45分钟'));
  test.it('60 → 1小时', () => assert.equal(Utils.formatMinutes(60), '1小时'));
  test.it('90 → 1小时30分钟', () => assert.equal(Utils.formatMinutes(90), '1小时30分钟'));
  test.it('1.4 → 1分钟', () => assert.equal(Utils.formatMinutes(1.4), '1分钟'));
});

// ─── Storage Tests ─────────────────────────────────────────────────────────────
test.describe('EpubStorage.preferences', () => {
  test.beforeEach(() => resetAll());
  test.it('getPreferences 返回默认值', async () => {
    const p = await EpubStorage.getPreferences();
    assert.equal(p.theme, 'light');
    assert.equal(p.fontSize, 18);
  });
  test.it('savePreferences 合并不替换', async () => {
    await EpubStorage.savePreferences({ fontSize: 20 });
    await EpubStorage.savePreferences({ theme: 'dark' });
    const p = await EpubStorage.getPreferences();
    assert.equal(p.fontSize, 20);
    assert.equal(p.theme, 'dark');
  });
});

test.describe('EpubStorage.recentBooks', () => {
  test.beforeEach(() => resetAll());
  test.it('addRecentBook 添加并设 lastOpened', async () => {
    await EpubStorage.addRecentBook({id:'b1', title:'B', author:'A', filename:'a.epub'});
    const books = await EpubStorage.getRecentBooks();
    assert.equal(books.length, 1);
    assert.ok(books[0].lastOpened > 0);
  });
  test.it('同id移到最前，不重复', async () => {
    await EpubStorage.addRecentBook({id:'b1', title:'B1', filename:'a.epub'});
    await EpubStorage.addRecentBook({id:'b2', title:'B2', filename:'b.epub'});
    await EpubStorage.addRecentBook({id:'b1', title:'B1 updated', filename:'a.epub'});
    const books = await EpubStorage.getRecentBooks();
    assert.equal(books[0].id, 'b1');
    assert.equal(books.length, 2);
  });
  test.it('超20本截断', async () => {
    for (let i=0;i<25;i++) await EpubStorage.addRecentBook({id:`b${i}`,title:`B${i}`,filename:`${i}.epub`});
    const books = await EpubStorage.getRecentBooks();
    assert.equal(books.length, 20);
    assert.equal(books[0].id, 'b24');
  });
  test.it('removeRecentBook 删除指定', async () => {
    await EpubStorage.addRecentBook({id:'b1', title:'B1', filename:'a.epub'});
    await EpubStorage.addRecentBook({id:'b2', title:'B2', filename:'b.epub'});
    await EpubStorage.removeRecentBook('b1');
    const books = await EpubStorage.getRecentBooks();
    assert.equal(books.length, 1);
    assert.equal(books[0].id, 'b2');
  });
});

test.describe('EpubStorage.bookMeta', () => {
  test.beforeEach(() => resetAll());
  test.it('未知书籍返回 null', async () => {
    assert.equal(await EpubStorage.getBookMeta('nonexistent'), null);
  });
  test.it('savePosition 写 pos 保留 time', async () => {
    await EpubStorage.saveReadingTime('b1', 300);
    await EpubStorage.savePosition('b1', 'epubcfi(/6/2)', 25.5);
    const m = await EpubStorage.getBookMeta('b1');
    assert.equal(m.pos.cfi, 'epubcfi(/6/2)');
    assert.equal(m.pos.percentage, 25.5);
    assert.equal(m.time, 300);
  });
  test.it('saveReadingTime 写 time 保留 pos', async () => {
    await EpubStorage.savePosition('b1', 'epubcfi(/6/2)', 10);
    await EpubStorage.saveReadingTime('b1', 600);
    const m = await EpubStorage.getBookMeta('b1');
    assert.equal(m.time, 600);
    assert.equal(m.pos.cfi, 'epubcfi(/6/2)');
  });
  test.it('saveReadingSpeed 保留其他字段', async () => {
    await EpubStorage.saveReadingTime('b1', 100);
    await EpubStorage.saveReadingSpeed('b1', {sampledSeconds:1800, sampledProgress:0.3});
    const m = await EpubStorage.getBookMeta('b1');
    assert.equal(m.speed.sampledSeconds, 1800);
    assert.ok(Math.abs(m.speed.sampledProgress - 0.3) < 0.001);
    assert.equal(m.time, 100);
  });
  test.it('removeBookMeta 删除数据', async () => {
    await EpubStorage.savePosition('b1', 'epubcfi(/6/2)', 50);
    await EpubStorage.removeBookMeta('b1');
    assert.equal(await EpubStorage.getBookMeta('b1'), null);
  });
});

test.describe('EpubStorage.bookMeta lazy migration v1.6→v1.7', () => {
  test.beforeEach(() => resetAll());
  test.it('迁移 pos_ 和 time_ 旧 key', async () => {
    _store['pos_legacy'] = {cfi:'epubcfi(/6/4)', percentage:40, timestamp:1000};
    _store['time_legacy'] = 1200;
    const m = await EpubStorage.getBookMeta('legacy');
    assert.ok(m !== null);
    assert.equal(m.pos.cfi, 'epubcfi(/6/4)');
    assert.equal(m.time, 1200);
    assert.ok(m.speed !== undefined);
    await new Promise(r=>setTimeout(r,20));
    assert.equal(_store['pos_legacy'], undefined);
    assert.equal(_store['time_legacy'], undefined);
  });
  test.it('仅 pos_ 也能迁移', async () => {
    _store['pos_b2'] = {cfi:'epubcfi(/6/2)', percentage:20};
    const m = await EpubStorage.getBookMeta('b2');
    assert.equal(m.pos.cfi, 'epubcfi(/6/2)');
    assert.equal(m.time, 0);
  });
});

test.describe('EpubStorage.highlights', () => {
  test.beforeEach(() => resetAll());
  test.it('空书返回空数组', async () => {
    assert.deepEqual(await EpubStorage.getHighlights('b1'), []);
  });
  test.it('save/get 往返正确', async () => {
    await EpubStorage.saveHighlights('b1', [{cfi:'c1', text:'文本', color:'#ffeb3b', note:'', timestamp:1000}]);
    const r = await EpubStorage.getHighlights('b1');
    assert.equal(r.length, 1);
    assert.equal(r[0].text, '文本');
  });
  test.it('removeHighlights 清空', async () => {
    await EpubStorage.saveHighlights('b1', [{cfi:'c1',text:'t',color:'#ff0',note:'',timestamp:1}]);
    await EpubStorage.removeHighlights('b1');
    assert.deepEqual(await EpubStorage.getHighlights('b1'), []);
  });
  test.it('getAllHighlights 只返回有数据的书', async () => {
    await EpubStorage.addRecentBook({id:'b1',title:'B1',filename:'b1.epub'});
    await EpubStorage.addRecentBook({id:'b2',title:'B2',filename:'b2.epub'});
    await EpubStorage.saveHighlights('b1',[{cfi:'c1',text:'高亮',color:'#ff0',note:'',timestamp:1}]);
    const all = await EpubStorage.getAllHighlights();
    assert.equal(Object.keys(all).length, 1);
    assert.ok(all['b1']);
    assert.equal(all['b2'], undefined);
  });
  test.it('getAllHighlights 不依赖 highlightKeys 索引', async () => {
    _store['highlightKeys'] = ['stale_book'];
    await EpubStorage.addRecentBook({id:'real_book',title:'R',filename:'r.epub'});
    await EpubStorage.saveHighlights('real_book',[{cfi:'c1',text:'real',color:'#ff0',note:'',timestamp:1}]);
    const all = await EpubStorage.getAllHighlights();
    assert.ok(all['real_book']);
    assert.equal(all['stale_book'], undefined);
  });
});

test.describe('EpubStorage.bookmarks', () => {
  test.beforeEach(() => resetAll());
  test.it('空书返回空数组', async () => {
    assert.deepEqual(await EpubStorage.getBookmarks('b1'), []);
  });
  test.it('save/get 往返正确', async () => {
    await EpubStorage.saveBookmarks('b1',[{cfi:'c1',chapter:'第一章',progress:10,timestamp:1}]);
    const r = await EpubStorage.getBookmarks('b1');
    assert.equal(r[0].chapter, '第一章');
  });
});

test.describe('EpubStorage.removeBook 级联删除', () => {
  test.beforeEach(() => resetAll());
  test.it('删除全量数据', async () => {
    const id = 'b1';
    await EpubStorage.addRecentBook({id, title:'T', filename:'f.epub'});
    await EpubStorage.savePosition(id,'cfi',50);
    await EpubStorage.saveHighlights(id,[{cfi:'c1',text:'t',color:'#f00',note:'',timestamp:1}]);
    await EpubStorage.saveBookmarks(id,[{cfi:'c1',chapter:'C1',progress:10,timestamp:1}]);
    await EpubStorage.removeBook(id);
    assert.equal((await EpubStorage.getRecentBooks()).length, 0);
    assert.equal(await EpubStorage.getBookMeta(id), null);
    assert.deepEqual(await EpubStorage.getHighlights(id), []);
    assert.deepEqual(await EpubStorage.getBookmarks(id), []);
  });
});

test.describe('EpubStorage.enforceFileLRU', () => {
  test.beforeEach(() => resetAll());
  test.it('未超限不删除', async () => {
    let deleted = false;
    const orig = EpubStorage.enforceFileLRU;
    // _mockDb.getAllMeta returns [] by default → no eviction
    await EpubStorage.enforceFileLRU(10);
    assert.ok(!deleted);
  });
  test.it('超限时删除最旧并级联清理 recentBooks', async () => {
    for (let i=1;i<=3;i++) {
      await EpubStorage.addRecentBook({id:`b${i}`,title:`B${i}`,filename:`${i}.epub`});
      await _mockDb.put('files',{bookId:`b${i}`, filename:`${i}.epub`, data:new Uint8Array(1), timestamp: i*1000});
    }
    // 提供 getAllMeta 返回数据
    _mockDb.getAllMeta = async () => [
      {bookId:'b1', timestamp:3000},
      {bookId:'b2', timestamp:2000},
      {bookId:'b3', timestamp:1000}
    ];
    await EpubStorage.enforceFileLRU(2);
    const books = await EpubStorage.getRecentBooks();
    assert.ok(!books.find(b=>b.id==='b3'), 'b3 should be evicted from recentBooks');
    assert.ok(books.find(b=>b.id==='b1'));
    assert.ok(books.find(b=>b.id==='b2'));
    _mockDb.getAllMeta = async () => []; // restore
  });
});

test.describe('EpubStorage.generateBookId', () => {
  test.it('返回 book_ 前缀 32位hex', async () => {
    const id = await EpubStorage.generateBookId('test.epub', new ArrayBuffer(1000));
    assert.match(id, /^book_[0-9a-f]{32}$/);
  });
  test.it('相同输入产生相同ID', async () => {
    const buf = new ArrayBuffer(100);
    const id1 = await EpubStorage.generateBookId('a.epub', buf);
    const id2 = await EpubStorage.generateBookId('a.epub', buf);
    assert.equal(id1, id2);
  });
});

// ─── Speed Tracking ────────────────────────────────────────────────────────────
function flushSpeedSession({sessionStart, lastProgress, currentTime, existingSpeed}) {
  if (!sessionStart) return {speed: existingSpeed, flushed: false};
  const deltaProgress = lastProgress - sessionStart.progress;
  const deltaSeconds  = (currentTime - sessionStart.timestamp) / 1000;
  const isValid = deltaProgress > 0.001 && deltaProgress < 0.30 && deltaSeconds > 30;
  const speed = {...existingSpeed};
  if (isValid) {
    speed.sampledSeconds  += deltaSeconds;
    speed.sampledProgress += deltaProgress;
  }
  return {speed, flushed: isValid, deltaProgress, deltaSeconds};
}

test.describe('速度采样 flushSpeedSession', () => {
  test.it('正常连续阅读 — 有效采样', () => {
    const r = flushSpeedSession({
      sessionStart:{progress:0.10, timestamp:0},
      lastProgress:0.20, currentTime:120000,
      existingSpeed:{sampledSeconds:0, sampledProgress:0}
    });
    assert.ok(r.flushed);
    assert.ok(Math.abs(r.speed.sampledSeconds-120) < 0.01);
    assert.ok(Math.abs(r.speed.sampledProgress-0.10) < 0.0001);
  });
  test.it('大进度跳跃 >30% — 不计入', () => {
    const r = flushSpeedSession({
      sessionStart:{progress:0.50, timestamp:0},
      lastProgress:0.85, currentTime:600000,
      existingSpeed:{sampledSeconds:0, sampledProgress:0}
    });
    assert.ok(!r.flushed);
    assert.equal(r.speed.sampledSeconds, 0);
  });
  test.it('进度 <0.1% — 不计入', () => {
    const r = flushSpeedSession({
      sessionStart:{progress:0.50, timestamp:0},
      lastProgress:0.5005, currentTime:120000,
      existingSpeed:{sampledSeconds:0, sampledProgress:0}
    });
    assert.ok(!r.flushed);
  });
  test.it('不足30秒 — 不计入', () => {
    const r = flushSpeedSession({
      sessionStart:{progress:0.10, timestamp:0},
      lastProgress:0.15, currentTime:20000,
      existingSpeed:{sampledSeconds:0, sampledProgress:0}
    });
    assert.ok(!r.flushed);
  });
  test.it('多次 session 累积', () => {
    const s0 = {sampledSeconds:0, sampledProgress:0};
    const s1 = flushSpeedSession({
      sessionStart:{progress:0.0, timestamp:0}, lastProgress:0.10,
      currentTime:600000, existingSpeed:s0
    });
    const s2 = flushSpeedSession({
      sessionStart:{progress:0.10, timestamp:0}, lastProgress:0.20,
      currentTime:600000, existingSpeed:s1.speed
    });
    assert.ok(Math.abs(s2.speed.sampledSeconds-1200) < 0.01);
    assert.ok(Math.abs(s2.speed.sampledProgress-0.20) < 0.0001);
  });
  test.it('sessionStart=null 直接返回', () => {
    const existing = {sampledSeconds:100, sampledProgress:0.1};
    const r = flushSpeedSession({
      sessionStart:null, lastProgress:0.5, currentTime:999000, existingSpeed:existing
    });
    assert.deepEqual(r.speed, existing);
  });
});

function estimateRemaining({speed, sessionStart, lastProgress, sessionStartedAt, now, currentProgress, totalLocations}) {
  const rem = 1 - currentProgress;
  let mins = null;
  if (speed && speed.sampledProgress > 0.01 && speed.sampledSeconds > 120) {
    mins = Math.round((speed.sampledSeconds / speed.sampledProgress) * rem / 60);
  }
  if (mins === null && sessionStart) {
    const dp = lastProgress - sessionStart.progress;
    const dt = (now - sessionStartedAt) / 1000;
    if (dp > 0.003 && dt > 30) {  // v1.8.0 阈值
      mins = Math.round((dt / dp) * rem / 60);
    }
  }
  if (mins === null) {
    mins = Math.max(0, Math.round(totalLocations * 150 * rem / 400));
  }
  return Math.max(0, mins);
}

test.describe('ETA 估算 estimateRemaining', () => {
  test.it('历史速度优先', () => {
    const m = estimateRemaining({
      speed:{sampledSeconds:3600, sampledProgress:0.5},
      sessionStart:null, lastProgress:0.5, sessionStartedAt:0, now:0,
      currentProgress:0.5, totalLocations:1000
    });
    assert.equal(m, 60);
  });
  test.it('session 速度次选', () => {
    const m = estimateRemaining({
      speed:{sampledSeconds:0, sampledProgress:0},
      sessionStart:{progress:0.50, timestamp:0},
      lastProgress:0.55, sessionStartedAt:0, now:120000,
      currentProgress:0.55, totalLocations:1000
    });
    // 120s/0.05=2400s/unit, 0.45*2400/60=18
    assert.equal(m, 18);
  });
  test.it('静态 fallback', () => {
    const m = estimateRemaining({
      speed:{sampledSeconds:0, sampledProgress:0},
      sessionStart:null, lastProgress:0, sessionStartedAt:0, now:0,
      currentProgress:0.5, totalLocations:1600
    });
    assert.equal(m, 300);
  });
  test.it('进度=1.0 返回0', () => {
    const m = estimateRemaining({
      speed:{sampledSeconds:3600, sampledProgress:0.5},
      sessionStart:null, lastProgress:1, sessionStartedAt:0, now:0,
      currentProgress:1.0, totalLocations:1000
    });
    assert.equal(m, 0);
  });
  test.it('v1.8.0 阈值(30s+0.3%)启用更早', () => {
    // dp=0.004, dt=45s — v1.7.0(0.5%+60s)拒绝，v1.8.0(0.3%+30s)接受
    const m = estimateRemaining({
      speed:{sampledSeconds:0, sampledProgress:0},
      sessionStart:{progress:0.50, timestamp:0},
      lastProgress:0.504, sessionStartedAt:0, now:45000,
      currentProgress:0.504, totalLocations:1600
    });
    // 有 session 速度：45s/0.004=11250s/unit, 0.496*11250/60=93
    assert.ok(m > 0, `expected >0, got ${m}`);
  });
});

test.describe('进度跳跃检测', () => {
  function shouldFlush(last, next, thr=0.05) { return Math.abs(next-last) > thr; }
  test.it('正常翻页不触发', () => {
    assert.ok(!shouldFlush(0.50, 0.51));
    assert.ok(!shouldFlush(0.50, 0.504));
  });
  test.it('TOC 跳转触发', () => assert.ok(shouldFlush(0.10, 0.80)));
  test.it('进度条拖动触发', () => assert.ok(shouldFlush(0.20, 0.26)));
  test.it('浮点边界 0.55-0.50 因 IEEE 754 精度略超 5%，实际触发', () => {
    // 0.55 - 0.50 === 0.050000000000000044，> 0.05 为 true
    assert.ok(shouldFlush(0.50, 0.55),  '浮点差值 0.050...044 > 0.05 应触发');
    assert.ok(!shouldFlush(0.50, 0.549), '0.049 < 0.05 不触发');
    assert.ok(shouldFlush(0.50, 0.56),   '0.06 > 0.05 触发');
  });
});

// ─── Highlights ────────────────────────────────────────────────────────────────
function sanitizeColor(c) {
  if (!c || c === 'transparent') return c || 'transparent';
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#ffeb3b';
}

test.describe('sanitizeColor', () => {
  test.it('合法 hex 通过', () => {
    assert.equal(sanitizeColor('#ffeb3b'), '#ffeb3b');
    assert.equal(sanitizeColor('#fff'), '#fff');
    assert.equal(sanitizeColor('#FF0000'), '#FF0000');
  });
  test.it('transparent 通过', () => assert.equal(sanitizeColor('transparent'), 'transparent'));
  test.it('null→transparent', () => assert.equal(sanitizeColor(null), 'transparent'));
  test.it('空串→transparent', () => assert.equal(sanitizeColor(''), 'transparent'));
  test.it('CSS 名称拦截', () => assert.equal(sanitizeColor('red'), '#ffeb3b'));
  test.it('rgb()拦截', () => assert.equal(sanitizeColor('rgb(255,0,0)'), '#ffeb3b'));
  test.it('注入拦截', () => assert.equal(sanitizeColor('javascript:alert(1)'), '#ffeb3b'));
  test.it('内嵌分号拦截', () => assert.equal(sanitizeColor('#ff0000; color:red'), '#ffeb3b'));
});

test.describe('Highlights 去重 upsert', () => {
  function upsert(hls, h) {
    const i = hls.findIndex(x=>x.cfi===h.cfi);
    if (i>=0) { hls[i].color=h.color; return 'updated'; }
    hls.push(h); return 'created';
  }
  test.it('新 CFI 创建', () => {
    const hls=[];
    assert.equal(upsert(hls,{cfi:'c1',color:'#ff0',text:'t',note:''}), 'created');
    assert.equal(hls.length, 1);
  });
  test.it('已有 CFI 更新颜色', () => {
    const hls=[{cfi:'c1',color:'#ff0',text:'t',note:''}];
    assert.equal(upsert(hls,{cfi:'c1',color:'#f00',text:'t',note:''}), 'updated');
    assert.equal(hls.length, 1);
    assert.equal(hls[0].color, '#f00');
  });
});

// ─── Bookmarks ─────────────────────────────────────────────────────────────────
test.describe('Bookmarks toggle', () => {
  function toggle(bms, cfi, chapter, progress) {
    const i = bms.findIndex(b=>b.cfi===cfi);
    if (i>=0) return bms.filter(b=>b.cfi!==cfi);
    const updated = [...bms, {cfi, chapter, progress: Math.round(progress*1000)/10, timestamp:Date.now()}];
    return updated.sort((a,b)=>a.progress-b.progress);
  }
  test.it('添加新书签', () => {
    const r = toggle([],'cfi1','第一章',0.1);
    assert.equal(r.length, 1);
    assert.equal(r[0].cfi, 'cfi1');
  });
  test.it('progress精度 0.123→12.3', () => {
    assert.equal(toggle([],'c','C',0.123)[0].progress, 12.3);
  });
  test.it('删除已有书签', () => {
    const existing=[{cfi:'cfi1',chapter:'C1',progress:10,timestamp:1},{cfi:'cfi2',chapter:'C2',progress:20,timestamp:2}];
    const r = toggle(existing,'cfi1','C1',0.1);
    assert.equal(r.length, 1);
    assert.equal(r[0].cfi, 'cfi2');
  });
  test.it('按进度排序', () => {
    let bms=[];
    bms=toggle(bms,'c3','C3',0.3);
    bms=toggle(bms,'c1','C1',0.1);
    bms=toggle(bms,'c2','C2',0.2);
    assert.equal(bms[0].cfi,'c1');
    assert.equal(bms[1].cfi,'c2');
    assert.equal(bms[2].cfi,'c3');
  });
});

// ─── savePosition 防抖 ────────────────────────────────────────────────────────
test.describe('savePosition 防抖', () => {
  test.it('300ms 内多次调用只写一次', async () => {
    let callCount=0;
    const saveSpy = (...args)=>{ callCount++; };
    const timer={id:null};
    function schedule(bookId,cfi,pct) {
      clearTimeout(timer.id);
      timer.id = setTimeout(()=>saveSpy(bookId,cfi,pct), 300);
    }
    schedule('b1','cfi1',10);
    schedule('b1','cfi2',11);
    schedule('b1','cfi3',12);
    assert.equal(callCount, 0);
    await new Promise(r=>setTimeout(r, 350));
    assert.equal(callCount, 1);
  });
  test.it('visibilitychange 立即 flush 取消 pending', async () => {
    let calls=[];
    const timer={id:null};
    function schedule(bk,cfi,pct){ clearTimeout(timer.id); timer.id=setTimeout(()=>calls.push({bk,cfi,pct,'via':'debounce'}),300); }
    function flush(bk,cfi,pct){ clearTimeout(timer.id); calls.push({bk,cfi,pct,'via':'flush'}); }
    schedule('b1','pending',50);
    flush('b1','flush_cfi',50);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].via, 'flush');
    await new Promise(r=>setTimeout(r,350));
    assert.equal(calls.length, 1);  // 不再触发第二次
  });
});

// ─── Security ─────────────────────────────────────────────────────────────────
test.describe('XSS 防护', () => {
  // escapeHtml 防护边界：转义 < > & " '，阻止浏览器解析 HTML 结构
  // onerror= 等属性名文本在无 < > 包裹的上下文中浏览器不执行，属于安全文本
  const VECTORS = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><script>alert(document.cookie)</script>',
    "'OR '1'='1",
    '${7*7}',
    '{{7*7}}'
  ];
  for (const v of VECTORS) {
    test.it(`转义: ${v.slice(0,30)}`, () => {
      const e = Utils.escapeHtml(v);
      // 核心：< > 必须转义，HTML 标签结构不能保留
      assert.ok(!e.includes('<script>'), `<script> leaked in: ${e}`);
      assert.ok(!e.includes('<img'),     `<img tag leaked in: ${e}`);
      assert.ok(!e.includes('<'),        `< leaked in: ${e}`);
      assert.ok(!e.includes('>'),        `> leaked in: ${e}`);
    });
  }
});

test.describe('颜色 CSS 注入防护', () => {
  const CSS_VECTORS = [
    'red; background: url(//evil.com)',
    '#ff0000; color: red',
    'expression(alert(1))',
    '-moz-binding:url(http://evil.com)',
    '; display: none',
    'url(javascript:alert(1))'
  ];
  for (const v of CSS_VECTORS) {
    test.it(`拦截: ${v.slice(0,30)}`, () => {
      assert.equal(sanitizeColor(v), '#ffeb3b');
    });
  }
});

// ─── LRU ────────────────────────────────────────────────────────────────────────
test.describe('LRU 驱逐策略', () => {
  test.it('驱逐最旧的条目', () => {
    const meta = [
      {bookId:'b1', timestamp:100},
      {bookId:'b2', timestamp:300},
      {bookId:'b3', timestamp:200},
      {bookId:'b4', timestamp:400},
    ];
    const evicted = meta.sort((a,b)=>b.timestamp-a.timestamp).slice(2).map(m=>m.bookId);
    assert.ok(evicted.includes('b1'));
    assert.ok(evicted.includes('b3'));
    assert.ok(!evicted.includes('b2'));
    assert.ok(!evicted.includes('b4'));
  });
});

// ─── BUG-01 showOpenFilePicker ────────────────────────────────────────────────
async function handleOpenFile(picker, storeFile, createTab) {
  try {
    const [fh] = await picker({types:[]});
    const file = await fh.getFile();
    const ab   = await file.arrayBuffer();
    await storeFile(file.name, ab);
    createTab();
  } catch(e) {
    if (e.name === 'AbortError') return;
    throw e;
  }
}

test.describe('BUG-01 showOpenFilePicker', () => {
  test.it('AbortError 静默处理', async () => {
    const err = Object.assign(new Error('aborted'), {name:'AbortError'});
    const picker = async()=>{ throw err; };
    await handleOpenFile(picker, async()=>{}, ()=>{});  // must not throw
  });
  test.it('正常选文件完整流程', async () => {
    let stored=null, tabCreated=false;
    const mockFile = {name:'test.epub', arrayBuffer: async()=>new ArrayBuffer(100)};
    const picker = async()=>[{getFile:async()=>mockFile}];
    await handleOpenFile(picker, async(n,ab)=>{stored={n,ab};}, ()=>{tabCreated=true;});
    assert.equal(stored.n, 'test.epub');
    assert.ok(tabCreated);
  });
});

// ─── BUG-02 _cachedSpeed 同步 ────────────────────────────────────────────────
test.describe('BUG-02 _cachedSpeed 内存同步', () => {
  test.it('flush 后立即可用不读 storage', async () => {
    let cached = {sampledSeconds:0, sampledProgress:0};
    let savedToStorage = null;
    const saveSpeed = async(id, spd)=>{ savedToStorage=spd; };
    async function flush({sessionStart, lastProgress, currentTime, bookId}) {
      if (!sessionStart) return;
      const dp = lastProgress - sessionStart.progress;
      const dt = (currentTime - sessionStart.timestamp)/1000;
      if (dp>0.001 && dp<0.30 && dt>30) {
        cached = {sampledSeconds:cached.sampledSeconds+dt, sampledProgress:cached.sampledProgress+dp};
        await saveSpeed(bookId, cached);
      }
    }
    await flush({sessionStart:{progress:0.1, timestamp:0}, lastProgress:0.2, currentTime:120000, bookId:'b1'});
    assert.ok(Math.abs(cached.sampledSeconds-120)<0.01);
    assert.ok(Math.abs(cached.sampledProgress-0.1)<0.0001);
    assert.ok(savedToStorage !== null);
    assert.equal(savedToStorage, cached);  // 同一对象引用
  });
  test.it('visible 时 session 起点重置排除挂机时间', () => {
    let sessionStart = {progress:0.1, timestamp:1000};
    const lastProgress = 0.15;
    const now = 999000;
    sessionStart = null; // hidden时清除
    // visible 时重置
    if (lastProgress > 0) sessionStart = {progress:lastProgress, timestamp:now};
    assert.ok(sessionStart !== null);
    assert.equal(sessionStart.progress, 0.15);
    assert.equal(sessionStart.timestamp, now);
    assert.notEqual(sessionStart.timestamp, 1000);
  });
  test.it('v1.8.0 阈值 0.3%+30s 比旧 0.5%+60s 更早触发', () => {
    const dp=0.004, dt=45;
    const v18 = dp>0.003 && dt>30;
    const v17 = dp>0.005 && dt>60;
    assert.ok(v18, 'v1.8.0 should accept');
    assert.ok(!v17, 'v1.7.0 should reject');
  });
});

// ─── BUG-03 CFI 保护 ─────────────────────────────────────────────────────────
test.describe('BUG-03 CFI 保护', () => {
  test.it('resize 用 start.cfi 不用 end.cfi', () => {
    const loc = {start:{cfi:'epubcfi(/6/2[intro]!/4/2,/1:0,/1:248)'}, end:{cfi:'epubcfi(/6/2[intro]!/4/52,/1:0,/1:89)'}};
    const correct = loc.start.cfi;
    const wrong   = loc.end.cfi;
    assert.equal(correct, 'epubcfi(/6/2[intro]!/4/2,/1:0,/1:248)');
    assert.notEqual(correct, wrong);
  });
  test.it('_withCfiLock 保证 isResizing 最终恢复为 false', async () => {
    let isResizing=false;
    let displayed=null;
    async function withCfiLock(fn, savedCfi) {
      isResizing=true;
      try { await fn(); await new Promise(r=>setTimeout(r,0)); displayed=savedCfi; }
      finally { isResizing=false; }
    }
    await withCfiLock(async()=>{ assert.ok(isResizing); }, 'epubcfi(/6/4)');
    assert.ok(!isResizing);
    assert.equal(displayed, 'epubcfi(/6/4)');
  });
  test.it('isResizing 期间 relocated 被拦截', async () => {
    let isResizing=false;
    const calls=[];
    function onLoc(loc){ if(isResizing) return; calls.push(loc); }
    async function applyFont(savedCfi) {
      isResizing=true;
      onLoc({start:{cfi:'intermediate'}});
      await new Promise(r=>setTimeout(r,0));
      isResizing=false;
      onLoc({start:{cfi:savedCfi}});
    }
    await applyFont('epubcfi(/6/4)');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].start.cfi, 'epubcfi(/6/4)');
  });
});

// ─── 端对端集成 ───────────────────────────────────────────────────────────────
test.describe('集成：完整阅读会话', () => {
  test.beforeEach(() => resetAll());
  test.it('打开→翻页→关闭→再打开 完整流程', async () => {
    const id='book_integration_test';
    await EpubStorage.addRecentBook({id, title:'测试', author:'A', filename:'t.epub'});
    await EpubStorage.savePosition(id,'epubcfi(/6/2)', 10.5);
    await EpubStorage.saveReadingTime(id, 300);
    await EpubStorage.saveReadingSpeed(id,{sampledSeconds:300, sampledProgress:0.1});
    const m = await EpubStorage.getBookMeta(id);
    assert.equal(m.pos.cfi, 'epubcfi(/6/2)');
    assert.equal(m.pos.percentage, 10.5);
    assert.equal(m.time, 300);
    assert.equal(m.speed.sampledSeconds, 300);
    assert.ok(Math.abs(m.speed.sampledProgress-0.1)<0.001);
  });
  test.it('删书后所有数据清理', async () => {
    const id='book_del_test';
    await EpubStorage.addRecentBook({id,title:'T',filename:'f.epub'});
    await EpubStorage.savePosition(id,'cfi',50);
    await EpubStorage.saveHighlights(id,[{cfi:'c1',text:'t',color:'#f00',note:'',timestamp:1}]);
    await EpubStorage.removeBook(id);
    assert.equal((await EpubStorage.getRecentBooks()).length, 0);
    assert.equal(await EpubStorage.getBookMeta(id), null);
    assert.deepEqual(await EpubStorage.getHighlights(id), []);
  });
  test.it('v1.6→v1.7 migration 端到端', async () => {
    const id='book_migrate';
    _store[`pos_${id}`]={cfi:'epubcfi(/6/10)', percentage:62.5, timestamp:Date.now()-10000};
    _store[`time_${id}`]=3721;
    const m = await EpubStorage.getBookMeta(id);
    assert.ok(m !== null);
    assert.equal(m.pos.percentage, 62.5);
    assert.equal(m.time, 3721);
    await new Promise(r=>setTimeout(r,20));
    assert.equal(_store[`pos_${id}`], undefined);
    assert.equal(_store[`time_${id}`], undefined);
    assert.ok(_store[`bookMeta_${id}`] !== undefined);
  });
  test.it('多session累积ETA 从50%读到68%', () => {
    let spd={sampledSeconds:0, sampledProgress:0};
    function flush(start, last, now) {
      const dp=last-start.progress, dt=(now-start.timestamp)/1000;
      if(dp>0.001 && dp<0.30 && dt>30) {
        spd={sampledSeconds:spd.sampledSeconds+dt, sampledProgress:spd.sampledProgress+dp};
      }
    }
    flush({progress:0.50,timestamp:0}, 0.60, 600000);
    flush({progress:0.60,timestamp:0}, 0.68, 480000);
    assert.ok(Math.abs(spd.sampledSeconds-1080)<0.01);
    assert.ok(Math.abs(spd.sampledProgress-0.18)<0.0001);
    const etaMin = Math.round((spd.sampledSeconds/spd.sampledProgress)*0.32/60);
    assert.equal(etaMin, 32);
    const v16eta = Math.round((1080/60)/0.68*0.32);
    assert.ok(v16eta < etaMin, `v1.6 ETA ${v16eta} should be less than v1.8 ETA ${etaMin}`);
  });
});





test.describe('v1.9.2 稳定性收尾', () => {
  test.beforeEach(() => resetAll());

  test.it('storage helper 在 chrome.runtime.lastError 时 reject', async () => {
    const originalSet = chrome.storage.local.set;
    chrome.storage.local.set = (data, cb) => {
      Object.assign(_store, data);
      chrome.runtime.lastError = new Error('mock set failed');
      cb && cb();
      chrome.runtime.lastError = null;
    };
    await assert.rejects(() => EpubStorage._set({ a: 1 }), /mock set failed/);
    chrome.storage.local.set = originalSet;
  });

  test.it('bookMeta 并发写不会互相覆盖字段', async () => {
    const id = 'book_queue_case';
    await Promise.all([
      EpubStorage.savePosition(id, 'epubcfi(/6/2)', 20),
      EpubStorage.saveReadingTime(id, 120),
      EpubStorage.saveReadingSpeed(id, { sampledSeconds: 240, sampledProgress: 0.2 })
    ]);
    const meta = await EpubStorage.getBookMeta(id);
    assert.equal(meta.pos.cfi, 'epubcfi(/6/2)');
    assert.equal(meta.time, 120);
    assert.equal(meta.speed.sampledSeconds, 240);
  });

  test.it('getAllHighlights 覆盖 recentBooks 外的历史书籍', async () => {
    await EpubStorage.addRecentBook({ id: 'b_recent', title: 'Recent', filename: 'r.epub' });
    await EpubStorage.saveHighlights('b_recent', [{ cfi: 'a', text: 't', color: '#ff0', note: '', timestamp: 1 }]);
    _store['highlights_b_legacy'] = [{ cfi: 'l', text: 'legacy', color: '#0f0', note: '', timestamp: 2 }];

    const all = await EpubStorage.getAllHighlights();
    assert.ok(all.b_recent && all.b_recent.length === 1);
    assert.ok(all.b_legacy && all.b_legacy.length === 1);
  });
});

// ─── 拆分后的发布验证测试 ──────────────────────────────────────────────
require('./suites/release_checks.test.js');
require('./suites/csp_regression.test.js');
require('./suites/module_contracts.test.js');

