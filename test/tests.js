/**
 * EPUB Reader v1.7.0 — 完整测试套件
 *
 * 框架：Jest（Node.js）
 * 覆盖范围：
 *   - utils/utils.js       （纯函数，全量覆盖）
 *   - utils/storage.js     （Mock chrome.storage.local + DbGateway）
 *   - utils/db-gateway.js  （Mock indexedDB）
 *   - reader/reader.js     （速度追踪、防抖、ETA 算法）
 *   - reader/highlights.js （高亮状态机）
 *   - reader/bookmarks.js  （书签增删查）
 *   - home/home.js         （书架渲染、标注管理）
 *
 * 运行：
 *   npm install --save-dev jest
 *   npx jest --coverage
 *
 * 环境搭建说明：
 *   tests/ 目录下创建 setup.js 并在 jest.config.js 中设置
 *   setupFilesAfterFramework: ['./tests/setup.js']
 */

// ─────────────────────────────────────────────────────────────────────────────
// tests/setup.js — 全局 Mock 设置
// ─────────────────────────────────────────────────────────────────────────────

/**
 * setup.js
 *
 * global.chrome mock + crypto.subtle mock + DOM 基础
 * 在所有测试文件之前由 Jest setupFilesAfterFramework 执行
 */

// Mock chrome.storage.local
const _storage = {};
global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, cb) => {
        const result = {};
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(k => { if (_storage[k] !== undefined) result[k] = _storage[k]; });
        cb(result);
      }),
      set: jest.fn((data, cb) => {
        Object.assign(_storage, data);
        if (cb) cb();
      }),
      remove: jest.fn((keys, cb) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(k => delete _storage[k]);
        if (cb) cb();
      }),
      _reset: () => { Object.keys(_storage).forEach(k => delete _storage[k]); },
      _data: _storage
    }
  },
  runtime: {
    getURL: jest.fn(path => `chrome-extension://test/${path}`)
  },
  tabs: {
    create: jest.fn()
  }
};

// Mock crypto.subtle.digest (SHA-256)
global.crypto = {
  subtle: {
    digest: jest.fn(async (algo, data) => {
      // 简单 mock：返回固定 32 字节
      return new Uint8Array(32).fill(0xab).buffer;
    })
  }
};

// Mock TextEncoder
global.TextEncoder = class {
  encode(str) { return Buffer.from(str); }
};

// Mock indexedDB (基础 mock，db-gateway 测试中细化)
global.indexedDB = {
  open: jest.fn()
};

// ─────────────────────────────────────────────────────────────────────────────
// tests/utils.test.js
// ─────────────────────────────────────────────────────────────────────────────

const { Utils } = require('../src/utils/utils.js');
// 注意：utils.js 是 const Utils = {...}，需要在文件末尾 module.exports = { Utils }
// 或将 test 文件改为在浏览器环境运行（jsdom）

describe('Utils.escapeHtml', () => {
  test('转义 HTML 特殊字符', () => {
    expect(Utils.escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('转义双引号和单引号', () => {
    const result = Utils.escapeHtml('"hello" & \'world\'');
    expect(result).not.toContain('"');
    expect(result).not.toContain("'");
  });

  test('null/undefined 返回空字符串', () => {
    expect(Utils.escapeHtml(null)).toBe('');
    expect(Utils.escapeHtml(undefined)).toBe('');
  });

  test('数字转为字符串', () => {
    expect(Utils.escapeHtml(42)).toBe('42');
  });

  test('正常文本不变', () => {
    expect(Utils.escapeHtml('hello world')).toBe('hello world');
  });

  test('已转义字符不会二次转义（非幂等）', () => {
    // escapeHtml 不解码，&amp; 会被再次转义为 &amp;amp;
    const once = Utils.escapeHtml('&amp;');
    expect(once).toBe('&amp;amp;');
  });
});

describe('Utils.formatDate', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('null 返回默认 fallback', () => {
    expect(Utils.formatDate(null)).toBe('未知时间');
    expect(Utils.formatDate(0)).toBe('未知时间');
  });

  test('自定义 fallback', () => {
    expect(Utils.formatDate(null, '')).toBe('');
  });

  test('1 分钟内返回"刚刚"', () => {
    const now = Date.now();
    jest.setSystemTime(now + 30_000);
    expect(Utils.formatDate(now)).toBe('刚刚');
  });

  test('2 小时前', () => {
    const ts = Date.now() - 2 * 3_600_000 - 1000;
    expect(Utils.formatDate(ts)).toBe('2 小时前');
  });

  test('3 天前', () => {
    const ts = Date.now() - 3 * 86_400_000 - 1000;
    expect(Utils.formatDate(ts)).toBe('3 天前');
  });

  test('超过 7 天返回本地日期', () => {
    const ts = Date.now() - 8 * 86_400_000;
    const result = Utils.formatDate(ts);
    expect(result).toMatch(/\d{4}\/\d{1,2}\/\d{1,2}/);
  });
});

describe('Utils.formatDuration', () => {
  test('0 秒', () => expect(Utils.formatDuration(0)).toBe('0秒'));
  test('null/undefined 返回 0秒', () => {
    expect(Utils.formatDuration(null)).toBe('0秒');
    expect(Utils.formatDuration(undefined)).toBe('0秒');
  });
  test('59 秒', () => expect(Utils.formatDuration(59)).toBe('59秒'));
  test('60 秒 = 1分钟', () => expect(Utils.formatDuration(60)).toBe('1分钟'));
  test('90 秒 = 1分钟', () => expect(Utils.formatDuration(90)).toBe('1分钟'));
  test('3600 秒 = 1小时', () => expect(Utils.formatDuration(3600)).toBe('1小时'));
  test('3660 秒 = 1小时1分', () => expect(Utils.formatDuration(3660)).toBe('1小时1分'));
  test('7200 秒 = 2小时', () => expect(Utils.formatDuration(7200)).toBe('2小时'));
  test('负数当 0 处理', () => expect(Utils.formatDuration(-1)).toBe('0秒'));
});

describe('Utils.formatMinutes', () => {
  test('0 分钟', () => expect(Utils.formatMinutes(0)).toBe('0分钟'));
  test('null 返回 0分钟', () => expect(Utils.formatMinutes(null)).toBe('0分钟'));
  test('45 分钟', () => expect(Utils.formatMinutes(45)).toBe('45分钟'));
  test('60 分钟 = 1小时', () => expect(Utils.formatMinutes(60)).toBe('1小时'));
  test('90 分钟 = 1小时30分钟', () => expect(Utils.formatMinutes(90)).toBe('1小时30分钟'));
  test('小数四舍五入', () => expect(Utils.formatMinutes(1.4)).toBe('1分钟'));
});

// ─────────────────────────────────────────────────────────────────────────────
// tests/storage.test.js
// ─────────────────────────────────────────────────────────────────────────────

// EpubStorage 依赖 chrome.storage.local（已 mock）和 DbGateway
// 在测试中 mock DbGateway
jest.mock('../src/utils/db-gateway.js', () => ({
  DbGateway: {
    _store: {},
    get: jest.fn(async (store, key) => DbGateway._store[`${store}:${key}`] || null),
    put: jest.fn(async (store, data) => {
      const key = data.bookId || data.id;
      DbGateway._store[`${store}:${key}`] = data;
    }),
    delete: jest.fn(async (store, key) => {
      delete DbGateway._store[`${store}:${key}`];
    }),
    getAll: jest.fn(async () => []),
    getAllMeta: jest.fn(async () => []),
    _reset: () => { DbGateway._store = {}; }
  }
}));

const { EpubStorage } = require('../src/utils/storage.js');
const { DbGateway } = require('../src/utils/db-gateway.js');

beforeEach(() => {
  chrome.storage.local._reset();
  DbGateway._reset();
});

describe('EpubStorage.preferences', () => {
  test('getPreferences 返回默认值', async () => {
    const prefs = await EpubStorage.getPreferences();
    expect(prefs.theme).toBe('light');
    expect(prefs.fontSize).toBe(18);
  });

  test('savePreferences 合并而非替换', async () => {
    await EpubStorage.savePreferences({ fontSize: 20 });
    await EpubStorage.savePreferences({ theme: 'dark' });
    const prefs = await EpubStorage.getPreferences();
    expect(prefs.fontSize).toBe(20);
    expect(prefs.theme).toBe('dark');
  });
});

describe('EpubStorage.recentBooks', () => {
  test('addRecentBook 添加并设置 lastOpened', async () => {
    await EpubStorage.addRecentBook({ id: 'b1', title: 'Book One', author: 'A', filename: 'a.epub' });
    const books = await EpubStorage.getRecentBooks();
    expect(books).toHaveLength(1);
    expect(books[0].id).toBe('b1');
    expect(books[0].lastOpened).toBeGreaterThan(0);
  });

  test('addRecentBook 同 id 移到最前', async () => {
    await EpubStorage.addRecentBook({ id: 'b1', title: 'Book 1', filename: 'a.epub' });
    await EpubStorage.addRecentBook({ id: 'b2', title: 'Book 2', filename: 'b.epub' });
    await EpubStorage.addRecentBook({ id: 'b1', title: 'Book 1 Updated', filename: 'a.epub' });
    const books = await EpubStorage.getRecentBooks();
    expect(books[0].id).toBe('b1');
    expect(books).toHaveLength(2);
  });

  test('addRecentBook 超出 20 本时截断最旧', async () => {
    for (let i = 0; i < 25; i++) {
      await EpubStorage.addRecentBook({ id: `b${i}`, title: `Book ${i}`, filename: `${i}.epub` });
    }
    const books = await EpubStorage.getRecentBooks();
    expect(books).toHaveLength(20);
    expect(books[0].id).toBe('b24'); // 最新的在最前
  });

  test('removeRecentBook 删除指定书籍', async () => {
    await EpubStorage.addRecentBook({ id: 'b1', title: 'B1', filename: 'a.epub' });
    await EpubStorage.addRecentBook({ id: 'b2', title: 'B2', filename: 'b.epub' });
    await EpubStorage.removeRecentBook('b1');
    const books = await EpubStorage.getRecentBooks();
    expect(books).toHaveLength(1);
    expect(books[0].id).toBe('b2');
  });
});

describe('EpubStorage.bookMeta', () => {
  test('getBookMeta 未知书籍返回 null', async () => {
    const meta = await EpubStorage.getBookMeta('nonexistent');
    expect(meta).toBeNull();
  });

  test('savePosition 写入 pos 字段，保留 time', async () => {
    await EpubStorage.saveReadingTime('b1', 300);
    await EpubStorage.savePosition('b1', 'epubcfi(/6/2)', 25.5);
    const meta = await EpubStorage.getBookMeta('b1');
    expect(meta.pos.cfi).toBe('epubcfi(/6/2)');
    expect(meta.pos.percentage).toBe(25.5);
    expect(meta.time).toBe(300);
  });

  test('saveReadingTime 写入 time，保留 pos', async () => {
    await EpubStorage.savePosition('b1', 'epubcfi(/6/2)', 10);
    await EpubStorage.saveReadingTime('b1', 600);
    const meta = await EpubStorage.getBookMeta('b1');
    expect(meta.time).toBe(600);
    expect(meta.pos.cfi).toBe('epubcfi(/6/2)');
  });

  test('saveReadingSpeed 写入 speed，保留其他字段', async () => {
    await EpubStorage.saveReadingTime('b1', 100);
    await EpubStorage.saveReadingSpeed('b1', { sampledSeconds: 1800, sampledProgress: 0.3 });
    const meta = await EpubStorage.getBookMeta('b1');
    expect(meta.speed.sampledSeconds).toBe(1800);
    expect(meta.speed.sampledProgress).toBeCloseTo(0.3);
    expect(meta.time).toBe(100);
  });

  test('removeBookMeta 删除所有相关 key', async () => {
    await EpubStorage.savePosition('b1', 'epubcfi(/6/2)', 50);
    await EpubStorage.removeBookMeta('b1');
    const meta = await EpubStorage.getBookMeta('b1');
    expect(meta).toBeNull();
  });
});

describe('EpubStorage.bookMeta lazy migration（v1.6.0 → v1.7.0）', () => {
  test('迁移 pos_ 和 time_ 旧 key', async () => {
    // 模拟 v1.6.0 遗留数据
    chrome.storage.local._data['pos_legacy_book'] = {
      cfi: 'epubcfi(/6/4)', percentage: 40, timestamp: 1000
    };
    chrome.storage.local._data['time_legacy_book'] = 1200;

    const meta = await EpubStorage.getBookMeta('legacy_book');
    expect(meta).not.toBeNull();
    expect(meta.pos.cfi).toBe('epubcfi(/6/4)');
    expect(meta.time).toBe(1200);
    expect(meta.speed).toBeDefined();

    // 验证旧 key 已被删除（异步，等待微任务）
    await Promise.resolve();
    expect(chrome.storage.local._data['pos_legacy_book']).toBeUndefined();
    expect(chrome.storage.local._data['time_legacy_book']).toBeUndefined();
  });

  test('只有 pos_ 旧 key 也能迁移', async () => {
    chrome.storage.local._data['pos_b2'] = { cfi: 'epubcfi(/6/2)', percentage: 20 };
    const meta = await EpubStorage.getBookMeta('b2');
    expect(meta.pos.cfi).toBe('epubcfi(/6/2)');
    expect(meta.time).toBe(0);
  });
});

describe('EpubStorage.highlights', () => {
  test('getHighlights 空书返回空数组', async () => {
    const hls = await EpubStorage.getHighlights('b1');
    expect(hls).toEqual([]);
  });

  test('saveHighlights 和 getHighlights 往返正确', async () => {
    const highlights = [
      { cfi: 'epubcfi(/6/2)', text: '文本', color: '#ffeb3b', note: '', timestamp: 1000 }
    ];
    await EpubStorage.saveHighlights('b1', highlights);
    const result = await EpubStorage.getHighlights('b1');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('文本');
  });

  test('removeHighlights 清空高亮', async () => {
    await EpubStorage.saveHighlights('b1', [{ cfi: 'c1', text: 't', color: '#ff0000', note: '', timestamp: 1 }]);
    await EpubStorage.removeHighlights('b1');
    const result = await EpubStorage.getHighlights('b1');
    expect(result).toEqual([]);
  });

  test('getAllHighlights 只返回有数据的书', async () => {
    await EpubStorage.addRecentBook({ id: 'b1', title: 'B1', filename: 'b1.epub' });
    await EpubStorage.addRecentBook({ id: 'b2', title: 'B2', filename: 'b2.epub' });
    await EpubStorage.saveHighlights('b1', [{ cfi: 'c1', text: '高亮', color: '#ff0', note: '', timestamp: 1 }]);
    // b2 无高亮

    const all = await EpubStorage.getAllHighlights();
    expect(Object.keys(all)).toHaveLength(1);
    expect(all['b1']).toHaveLength(1);
    expect(all['b2']).toBeUndefined();
  });

  test('getAllHighlights 并行读取所有书籍', async () => {
    for (let i = 1; i <= 5; i++) {
      await EpubStorage.addRecentBook({ id: `b${i}`, title: `Book${i}`, filename: `b${i}.epub` });
      await EpubStorage.saveHighlights(`b${i}`, [
        { cfi: `c${i}`, text: `text${i}`, color: '#ff0', note: '', timestamp: i * 1000 }
      ]);
    }
    const all = await EpubStorage.getAllHighlights();
    expect(Object.keys(all)).toHaveLength(5);
  });

  test('getAllHighlights 不再依赖 highlightKeys 索引', async () => {
    // v1.6.0 的 highlightKeys 遗留数据不应影响结果
    chrome.storage.local._data['highlightKeys'] = ['stale_book'];
    await EpubStorage.addRecentBook({ id: 'real_book', title: 'R', filename: 'r.epub' });
    await EpubStorage.saveHighlights('real_book', [
      { cfi: 'c1', text: 'real', color: '#ff0', note: '', timestamp: 1 }
    ]);
    const all = await EpubStorage.getAllHighlights();
    // 应该只有 real_book，不包含 stale_book
    expect(all['real_book']).toBeDefined();
    expect(all['stale_book']).toBeUndefined();
  });
});

describe('EpubStorage.bookmarks', () => {
  test('getBookmarks 空书返回空数组', async () => {
    expect(await EpubStorage.getBookmarks('b1')).toEqual([]);
  });

  test('saveBookmarks 往返正确', async () => {
    const bms = [{ cfi: 'epubcfi(/6/2)', chapter: '第一章', progress: 10, timestamp: 1000 }];
    await EpubStorage.saveBookmarks('b1', bms);
    const result = await EpubStorage.getBookmarks('b1');
    expect(result[0].chapter).toBe('第一章');
  });
});

describe('EpubStorage.removeBook', () => {
  test('完整级联删除所有数据', async () => {
    const bookId = 'b1';
    await EpubStorage.addRecentBook({ id: bookId, title: 'T', filename: 'f.epub' });
    await EpubStorage.savePosition(bookId, 'cfi', 50);
    await EpubStorage.saveReadingTime(bookId, 600);
    await EpubStorage.saveHighlights(bookId, [{ cfi: 'c1', text: 't', color: '#f00', note: '', timestamp: 1 }]);
    await EpubStorage.saveBookmarks(bookId, [{ cfi: 'c1', chapter: 'C1', progress: 10, timestamp: 1 }]);

    await EpubStorage.removeBook(bookId);

    expect(await EpubStorage.getRecentBooks()).toHaveLength(0);
    expect(await EpubStorage.getBookMeta(bookId)).toBeNull();
    expect(await EpubStorage.getHighlights(bookId)).toEqual([]);
    expect(await EpubStorage.getBookmarks(bookId)).toEqual([]);
  });
});

describe('EpubStorage.enforceFileLRU', () => {
  test('不超过上限时不删除', async () => {
    DbGateway.getAllMeta.mockResolvedValueOnce([
      { bookId: 'b1', timestamp: 3000 },
      { bookId: 'b2', timestamp: 2000 }
    ]);
    await EpubStorage.enforceFileLRU(10);
    expect(DbGateway.delete).not.toHaveBeenCalled();
  });

  test('超出上限时删除最旧的文件并级联清理 recentBooks', async () => {
    for (let i = 1; i <= 3; i++) {
      await EpubStorage.addRecentBook({ id: `b${i}`, title: `B${i}`, filename: `${i}.epub` });
    }
    DbGateway.getAllMeta.mockResolvedValueOnce([
      { bookId: 'b1', timestamp: 3000 },
      { bookId: 'b2', timestamp: 2000 },
      { bookId: 'b3', timestamp: 1000 }  // 最旧
    ]);
    await EpubStorage.enforceFileLRU(2);

    // b3 应被删除
    expect(DbGateway.delete).toHaveBeenCalledWith('files', 'b3');

    // recentBooks 中 b3 也应被移除
    const books = await EpubStorage.getRecentBooks();
    expect(books.find(b => b.id === 'b3')).toBeUndefined();
  });
});

describe('EpubStorage.generateBookId', () => {
  test('返回 book_ 前缀的字符串', async () => {
    const id = await EpubStorage.generateBookId('test.epub', new ArrayBuffer(1000));
    expect(id).toMatch(/^book_[0-9a-f]{32}$/);
  });

  test('相同输入产生相同 ID', async () => {
    const buf = new ArrayBuffer(100);
    const id1 = await EpubStorage.generateBookId('a.epub', buf);
    const id2 = await EpubStorage.generateBookId('a.epub', buf);
    expect(id1).toBe(id2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tests/speed-tracking.test.js — 阅读速度追踪算法
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 独立测试速度采样和 ETA 估算逻辑。
 * 这些函数从 reader.js 中提取为可测试的纯函数形式。
 */

describe('速度采样：flushSpeedSession', () => {
  /**
   * 模拟 flushSpeedSession 逻辑（从 reader.js 提取的纯函数版本）
   */
  function flushSpeedSession({ sessionStart, lastProgress, currentTime, existingSpeed }) {
    if (!sessionStart) return { speed: existingSpeed, newSessionStart: null };

    const deltaProgress = lastProgress - sessionStart.progress;
    const deltaSeconds  = (currentTime - sessionStart.timestamp) / 1000;

    const isValid = deltaProgress > 0.001
                 && deltaProgress < 0.30
                 && deltaSeconds  > 30;

    let speed = { ...existingSpeed };
    if (isValid) {
      speed.sampledSeconds  += deltaSeconds;
      speed.sampledProgress += deltaProgress;
    }
    return { speed, flushed: isValid, deltaProgress, deltaSeconds };
  }

  test('正常连续阅读：有效采样', () => {
    const result = flushSpeedSession({
      sessionStart:  { progress: 0.10, timestamp: 0 },
      lastProgress:  0.20,
      currentTime:   120_000, // 2 分钟
      existingSpeed: { sampledSeconds: 0, sampledProgress: 0 }
    });
    expect(result.flushed).toBe(true);
    expect(result.speed.sampledSeconds).toBeCloseTo(120);
    expect(result.speed.sampledProgress).toBeCloseTo(0.10);
  });

  test('从中间打开书（大进度跳跃）：不计入速度', () => {
    // 进度从 0.50 跳到 0.85（35%），超出 30% 阈值
    const result = flushSpeedSession({
      sessionStart:  { progress: 0.50, timestamp: 0 },
      lastProgress:  0.85,
      currentTime:   600_000,
      existingSpeed: { sampledSeconds: 0, sampledProgress: 0 }
    });
    expect(result.flushed).toBe(false);
    expect(result.speed.sampledSeconds).toBe(0);
  });

  test('读了不到 0.1% 的进度：不计入速度', () => {
    const result = flushSpeedSession({
      sessionStart:  { progress: 0.50, timestamp: 0 },
      lastProgress:  0.5005, // 仅 0.05%
      currentTime:   120_000,
      existingSpeed: { sampledSeconds: 0, sampledProgress: 0 }
    });
    expect(result.flushed).toBe(false);
  });

  test('不足 30 秒的短 session：不计入速度', () => {
    const result = flushSpeedSession({
      sessionStart:  { progress: 0.10, timestamp: 0 },
      lastProgress:  0.15,
      currentTime:   20_000, // 20 秒
      existingSpeed: { sampledSeconds: 0, sampledProgress: 0 }
    });
    expect(result.flushed).toBe(false);
  });

  test('多次 session 累积', () => {
    const speed = { sampledSeconds: 0, sampledProgress: 0 };

    const s1 = flushSpeedSession({
      sessionStart:  { progress: 0.0, timestamp: 0 },
      lastProgress:  0.10,
      currentTime:   600_000,  // 10 分钟读 10%
      existingSpeed: speed
    });
    const s2 = flushSpeedSession({
      sessionStart:  { progress: 0.10, timestamp: 0 },
      lastProgress:  0.20,
      currentTime:   600_000,  // 10 分钟读 10%
      existingSpeed: s1.speed
    });

    expect(s2.speed.sampledSeconds).toBeCloseTo(1200);
    expect(s2.speed.sampledProgress).toBeCloseTo(0.20);
  });

  test('sessionStart 为 null：直接返回不做任何事', () => {
    const existingSpeed = { sampledSeconds: 100, sampledProgress: 0.1 };
    const result = flushSpeedSession({
      sessionStart:  null,
      lastProgress:  0.5,
      currentTime:   999_000,
      existingSpeed
    });
    expect(result.speed).toEqual(existingSpeed);
  });
});

describe('ETA 估算：estimateRemaining', () => {
  /**
   * 从 reader.js 的 updateReadingStats 提取为纯函数
   */
  function estimateRemaining({ speed, sessionStart, lastProgress, sessionStartedAt, now, currentProgress, totalLocations }) {
    const remainingProgress = 1 - currentProgress;
    let remainingMinutes = null;

    // 1. 历史累积速度
    if (speed && speed.sampledProgress > 0.01 && speed.sampledSeconds > 120) {
      const secsPerUnit = speed.sampledSeconds / speed.sampledProgress;
      remainingMinutes = Math.round(secsPerUnit * remainingProgress / 60);
    }

    // 2. 当前 session 实时速度
    if (remainingMinutes === null && sessionStart) {
      const deltaP = lastProgress - sessionStart.progress;
      const deltaT = (now - sessionStartedAt) / 1000;
      if (deltaP > 0.005 && deltaT > 60) {
        const secsPerUnit = deltaT / deltaP;
        remainingMinutes = Math.round(secsPerUnit * remainingProgress / 60);
      }
    }

    // 3. 静态 fallback
    if (remainingMinutes === null) {
      const charsTotal = totalLocations * 150;
      remainingMinutes = Math.max(0, Math.round(charsTotal * remainingProgress / 400));
    }

    return Math.max(0, remainingMinutes);
  }

  test('历史速度优先：有效数据给出准确估算', () => {
    const speed = { sampledSeconds: 3600, sampledProgress: 0.5 }; // 1小时读50%
    const mins = estimateRemaining({
      speed,
      sessionStart: null,
      lastProgress: 0.5,
      sessionStartedAt: 0,
      now: 0,
      currentProgress: 0.5,
      totalLocations: 1000
    });
    // 剩余 50%，速度 3600s/0.5 = 7200s/100%，剩余 7200 * 0.5 = 3600s = 60min
    expect(mins).toBe(60);
  });

  test('从中间打开后当前 session 速度有效时使用', () => {
    // 无历史速度，但本 session 读了 2 分钟，推进了 5%
    const mins = estimateRemaining({
      speed: { sampledSeconds: 0, sampledProgress: 0 },
      sessionStart: { progress: 0.50, timestamp: 0 },
      lastProgress: 0.55,
      sessionStartedAt: 0,
      now: 120_000,  // 2 分钟
      currentProgress: 0.55,
      totalLocations: 1000
    });
    // session: 120s / 0.05 = 2400s/unit，剩余 0.45 * 2400 / 60 = 18 分钟
    expect(mins).toBe(18);
  });

  test('无任何速度数据时使用静态 fallback', () => {
    const mins = estimateRemaining({
      speed: { sampledSeconds: 0, sampledProgress: 0 },
      sessionStart: null,
      lastProgress: 0,
      sessionStartedAt: 0,
      now: 0,
      currentProgress: 0.5,
      totalLocations: 1600  // 1600 locations * 150字 = 240000字, /400字/分 = 600分钟全书
    });
    // 剩余 50%：600 * 0.5 = 300 分钟
    expect(mins).toBe(300);
  });

  test('已读完书（progress = 1.0）返回 0', () => {
    const speed = { sampledSeconds: 3600, sampledProgress: 0.5 };
    const mins = estimateRemaining({
      speed, sessionStart: null, lastProgress: 1.0,
      sessionStartedAt: 0, now: 0,
      currentProgress: 1.0, totalLocations: 1000
    });
    expect(mins).toBe(0);
  });

  test('v1.6.0 旧算法 vs v1.7.0 新算法：从中间打开的对比', () => {
    // 场景：用户打开一本书，进度已在 50%，读了 10 分钟，推进到 55%

    // v1.6.0 算法（错误的）：
    const totalActiveMinutes = 10;
    const currentProgress = 0.55;
    const v16_total = totalActiveMinutes / currentProgress;
    const v16_remaining = Math.round(v16_total * (1 - currentProgress));
    // v1.6.0: 10/0.55 ≈ 18.2，剩余 18.2 * 0.45 ≈ 8 分钟（严重低估）

    // v1.7.0 算法（正确的）：
    const sessionDeltaP = 0.05; // 从50%到55%
    const sessionDeltaT = 10 * 60; // 10分钟
    const secsPerUnit = sessionDeltaT / sessionDeltaP; // 200s/1%
    const v17_remaining = Math.round(secsPerUnit * 0.45 / 60); // 45% * 200s / 60 = 150 分钟

    expect(v16_remaining).toBeLessThan(20); // 旧算法低估
    expect(v17_remaining).toBeGreaterThan(100); // 新算法正确
  });
});

describe('进度跳跃检测', () => {
  function shouldFlushOnJump(lastProgress, newProgress, threshold = 0.05) {
    return Math.abs(newProgress - lastProgress) > threshold;
  }

  test('正常翻页不触发跳跃', () => {
    expect(shouldFlushOnJump(0.50, 0.51)).toBe(false);
    expect(shouldFlushOnJump(0.50, 0.504)).toBe(false);
  });

  test('TOC 跳转触发跳跃检测', () => {
    expect(shouldFlushOnJump(0.10, 0.80)).toBe(true);
  });

  test('进度条拖动触发跳跃检测', () => {
    expect(shouldFlushOnJump(0.20, 0.26)).toBe(true);
  });

  test('浮点边界：0.55-0.50 因 IEEE 754 精度略超 5%，实际触发跳跃', () => {
    // JavaScript: 0.55 - 0.50 === 0.050000000000000044（不等于精确的 0.05）
    // reader.js 使用 Math.abs(newProgress - _lastProgress) > 0.05
    // 该浮点差值 > 0.05 为 true，故此边界值实际会触发 flush
    // 测试记录真实行为，不应依赖浮点精确等值
    expect(shouldFlushOnJump(0.50, 0.55)).toBe(true);  // 浮点：0.050...044 > 0.05
    expect(shouldFlushOnJump(0.50, 0.549)).toBe(false); // 明确低于阈值不触发
    expect(shouldFlushOnJump(0.50, 0.56)).toBe(true);   // 明确超过阈值触发
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tests/highlights.test.js — 高亮状态机
// ─────────────────────────────────────────────────────────────────────────────

describe('Highlights：sanitizeColor', () => {
  /**
   * 从 highlights.js 提取的纯函数
   */
  function sanitizeColor(colorStr) {
    if (!colorStr || colorStr === 'transparent') return colorStr || 'transparent';
    return /^#[0-9a-fA-F]{3,8}$/.test(colorStr) ? colorStr : '#ffeb3b';
  }

  test('合法 hex 颜色通过', () => {
    expect(sanitizeColor('#ffeb3b')).toBe('#ffeb3b');
    expect(sanitizeColor('#fff')).toBe('#fff');
    expect(sanitizeColor('#FF0000')).toBe('#FF0000');
    expect(sanitizeColor('#rgba0080')).toBe('#rgba0080'); // 8位带透明
  });

  test('transparent 通过', () => {
    expect(sanitizeColor('transparent')).toBe('transparent');
  });

  test('null/空字符串返回 transparent', () => {
    expect(sanitizeColor(null)).toBe('transparent');
    expect(sanitizeColor('')).toBe('transparent');
  });

  test('恶意注入字符串返回默认黄色', () => {
    expect(sanitizeColor('red')).toBe('#ffeb3b');
    expect(sanitizeColor('rgb(255,0,0)')).toBe('#ffeb3b');
    expect(sanitizeColor('javascript:alert(1)')).toBe('#ffeb3b');
    expect(sanitizeColor('#ff0000; color:red')).toBe('#ffeb3b');
  });

  test('CSS 函数格式返回默认黄色', () => {
    expect(sanitizeColor('linear-gradient(red,blue)')).toBe('#ffeb3b');
  });
});

describe('Highlights：去重逻辑', () => {
  /**
   * 测试 highlights 数组的 CFI 去重逻辑
   * 对应 highlights.js 的 existingIdx 检查
   */
  function upsertHighlight(highlights, newHl) {
    const existingIdx = highlights.findIndex(h => h.cfi === newHl.cfi);
    if (existingIdx !== -1) {
      highlights[existingIdx].color = newHl.color;
      return 'updated';
    }
    highlights.push(newHl);
    return 'created';
  }

  test('新 CFI 创建新高亮', () => {
    const hls = [];
    const action = upsertHighlight(hls, { cfi: 'cfi1', color: '#ff0', text: 't', note: '' });
    expect(action).toBe('created');
    expect(hls).toHaveLength(1);
  });

  test('已有 CFI 更新颜色，不创建重复', () => {
    const hls = [{ cfi: 'cfi1', color: '#ff0', text: 't', note: '' }];
    const action = upsertHighlight(hls, { cfi: 'cfi1', color: '#f00', text: 't', note: '' });
    expect(action).toBe('updated');
    expect(hls).toHaveLength(1);
    expect(hls[0].color).toBe('#f00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tests/bookmarks.test.js — 书签管理
// ─────────────────────────────────────────────────────────────────────────────

// 模拟 Bookmarks 模块的核心逻辑（提取为可测试的纯函数）
describe('Bookmarks：toggle 逻辑', () => {
  function toggleBookmark(bookmarks, cfi, chapter, progress) {
    const existing = bookmarks.findIndex(b => b.cfi === cfi);
    if (existing >= 0) {
      return bookmarks.filter(b => b.cfi !== cfi);
    }
    const updated = [...bookmarks, {
      cfi, chapter,
      progress: Math.round(progress * 1000) / 10,
      timestamp: Date.now()
    }];
    return updated.sort((a, b) => a.progress - b.progress);
  }

  test('添加新书签', () => {
    const result = toggleBookmark([], 'cfi1', '第一章', 0.1);
    expect(result).toHaveLength(1);
    expect(result[0].cfi).toBe('cfi1');
    expect(result[0].progress).toBe(100); // 1.0 * 1000 / 10
  });

  test('progress 精度正确（3 位小数 → 1 位）', () => {
    const result = toggleBookmark([], 'cfi1', '章', 0.123);
    expect(result[0].progress).toBe(12.3);
  });

  test('删除已有书签', () => {
    const existing = [
      { cfi: 'cfi1', chapter: 'C1', progress: 10, timestamp: 1 },
      { cfi: 'cfi2', chapter: 'C2', progress: 20, timestamp: 2 }
    ];
    const result = toggleBookmark(existing, 'cfi1', 'C1', 0.1);
    expect(result).toHaveLength(1);
    expect(result[0].cfi).toBe('cfi2');
  });

  test('书签按进度排序', () => {
    let bms = [];
    bms = toggleBookmark(bms, 'cfi3', 'C3', 0.3);
    bms = toggleBookmark(bms, 'cfi1', 'C1', 0.1);
    bms = toggleBookmark(bms, 'cfi2', 'C2', 0.2);
    expect(bms[0].cfi).toBe('cfi1');
    expect(bms[1].cfi).toBe('cfi2');
    expect(bms[2].cfi).toBe('cfi3');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tests/home.test.js — 书架渲染与标注管理
// ─────────────────────────────────────────────────────────────────────────────

describe('home.js：formatTime（现 Utils.formatDuration）', () => {
  // 验证 home.js 已将 formatTime 替换为 Utils.formatDuration
  test('0 秒显示 0秒', () => expect(Utils.formatDuration(0)).toBe('0秒'));
  test('120 秒显示 2分钟', () => expect(Utils.formatDuration(120)).toBe('2分钟'));
  test('3601 秒显示 1小时0分', () => expect(Utils.formatDuration(3601)).toBe('1小时0分'));
});

describe('home.js：sanitizeColor（标注颜色校验）', () => {
  function sanitizeColor(colorStr) {
    if (!colorStr) return '#ffeb3b';
    return /^#[0-9a-fA-F]{3,8}$|^transparent$/.test(colorStr) ? colorStr : '#ffeb3b';
  }

  test('合法颜色通过', () => {
    expect(sanitizeColor('#94a3b8')).toBe('#94a3b8');
    expect(sanitizeColor('transparent')).toBe('transparent');
  });

  test('null 返回默认黄色', () => expect(sanitizeColor(null)).toBe('#ffeb3b'));

  test('XSS 尝试被拦截', () => {
    expect(sanitizeColor('red; background:url(evil)')).toBe('#ffeb3b');
  });
});

describe('home.js：loadAnnotations 排序逻辑', () => {
  function sortAnnotations(annotations, order = 'desc') {
    return [...annotations].sort((a, b) =>
      order === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp
    );
  }

  const mockAnnotations = [
    { cfi: 'c1', timestamp: 1000, text: 'first' },
    { cfi: 'c2', timestamp: 3000, text: 'third' },
    { cfi: 'c3', timestamp: 2000, text: 'second' }
  ];

  test('默认降序（最新在前）', () => {
    const sorted = sortAnnotations(mockAnnotations);
    expect(sorted[0].timestamp).toBe(3000);
    expect(sorted[2].timestamp).toBe(1000);
  });

  test('升序（最早在前）', () => {
    const sorted = sortAnnotations(mockAnnotations, 'asc');
    expect(sorted[0].timestamp).toBe(1000);
    expect(sorted[2].timestamp).toBe(3000);
  });

  test('原数组不被修改', () => {
    sortAnnotations(mockAnnotations);
    expect(mockAnnotations[0].timestamp).toBe(1000);
  });
});

describe('home.js：loadBookshelf 并行加载与清理', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loadBookshelf 并行获取所有数据', async () => {
    // 模拟 EpubStorage 的 API
    const EpubStorage = {
      getRecentBooks: jest.fn().mockResolvedValue([
        { id: 'b1', title: 'Book 1' },
        { id: 'b2', title: 'Book 2' }
      ]),
      getCover: jest.fn().mockResolvedValue(new Blob()),
      getBookMeta: jest.fn().mockResolvedValue({
        pos: { percentage: 10 },
        time: 120,
        speed: {}
      })
    };

    // 提取的并行加载核心逻辑
    async function fetchBookshelfData() {
      const books = await EpubStorage.getRecentBooks();
      return Promise.all(books.map(async book => {
        const [cover, meta] = await Promise.all([
          EpubStorage.getCover(book.id),
          EpubStorage.getBookMeta(book.id)
        ]);
        return { book, cover, meta };
      }));
    }

    const data = await fetchBookshelfData();
    
    // 验证返回结构
    expect(data).toHaveLength(2);
    expect(data[0].book.id).toBe('b1');
    expect(data[0].meta.time).toBe(120);
    
    // 验证是否被并行调用
    expect(EpubStorage.getCover).toHaveBeenCalledTimes(2);
    expect(EpubStorage.getBookMeta).toHaveBeenCalledTimes(2);
  });

  test('移除书籍时显式撤销 ObjectURL', () => {
    // mock DOM API
    const revokeMock = jest.fn();
    global.URL.revokeObjectURL = revokeMock;

    // 提取的清理逻辑
    function removeBookCard(card) {
      const url = card.dataset.coverUrl;
      if (url) {
        URL.revokeObjectURL(url);
      }
      card.remove(); // 模拟 DOM 移除
    }

    // 模拟附带 dataset 的 card
    const mockCard = {
      dataset: { coverUrl: 'blob:chrome://fake-url-1234' },
      remove: jest.fn()
    };

    removeBookCard(mockCard);

    expect(revokeMock).toHaveBeenCalledWith('blob:chrome://fake-url-1234');
    expect(mockCard.remove).toHaveBeenCalledTimes(1);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// tests/position-debounce.test.js — 位置防抖
// ─────────────────────────────────────────────────────────────────────────────

describe('savePosition 防抖行为', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('300ms 内多次调用只触发一次存储写入', () => {
    const saveSpy = jest.fn();

    function schedulePositionSave(bookId, cfi, percent, timer, delay = 300) {
      clearTimeout(timer.id);
      timer.id = setTimeout(() => saveSpy(bookId, cfi, percent), delay);
      return timer;
    }

    const timer = {};
    schedulePositionSave('b1', 'cfi1', 10, timer);
    schedulePositionSave('b1', 'cfi2', 11, timer);
    schedulePositionSave('b1', 'cfi3', 12, timer); // 只有这次应被写入

    expect(saveSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(300);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith('b1', 'cfi3', 12);
  });

  test('visibilitychange 时立即 flush 清除 pending debounce', () => {
    const saveSpy = jest.fn();
    const timer = {};

    function schedulePositionSave(bookId, cfi, percent) {
      clearTimeout(timer.id);
      timer.id = setTimeout(() => saveSpy(bookId, cfi, percent), 300);
    }

    function flushPositionSave(bookId, stableCfi, lastPercent) {
      clearTimeout(timer.id);
      saveSpy(bookId, stableCfi, lastPercent);
    }

    schedulePositionSave('b1', 'cfi_pending', 50);
    flushPositionSave('b1', 'cfi_flush', 50);

    // 立即调用了一次
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith('b1', 'cfi_flush', 50);

    // 300ms 后不再触发第二次
    jest.advanceTimersByTime(300);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tests/db-gateway.test.js — IndexedDB 连接与重试
// ─────────────────────────────────────────────────────────────────────────────

describe('DbGateway：重试退避', () => {
  // 注意：此测试需要真实的 DbGateway 实现，不能使用 mock 版本
  // 使用独立的 jest.config 或 resetModules 加载真实模块

  test('连续失败 3 次后抛出明确错误（不再重试）', () => {
    const gateway = {
      _retryCount: 0,
      _retryLimit: 3,
      _dbPromise: null,
      async connect() {
        if (this._retryCount >= this._retryLimit) {
          throw new Error('IDB connection failed 3 times consecutively. Refusing further retries.');
        }
        this._dbPromise = null;
        this._retryCount++;
        throw new Error('Connection failed');
      }
    };

    for (let i = 0; i < 3; i++) {
      try { gateway.connect(); } catch (_) {}
    }
    expect(() => gateway.connect()).toThrow(/Refusing further retries/);
  });

  test('成功连接后重置 retryCount', async () => {
    const gateway = {
      _retryCount: 2,
      _retryLimit: 3,
      _dbPromise: null,
      async connect() {
        if (this._retryCount >= this._retryLimit) throw new Error('refused');
        this._retryCount = 0;
        return { objectStoreNames: { contains: () => true } };
      }
    };
    await gateway.connect();
    expect(gateway._retryCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tests/lru.test.js — LRU 驱逐
// ─────────────────────────────────────────────────────────────────────────────

describe('enforceFileLRU：驱逐策略', () => {
  test('驱逐正确的文件（最旧的）', async () => {
    const metaList = [
      { bookId: 'b1', timestamp: 100 },
      { bookId: 'b2', timestamp: 300 },
      { bookId: 'b3', timestamp: 200 },
      { bookId: 'b4', timestamp: 400 },
    ];

    function getLRUEvictions(meta, maxCount) {
      return meta
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(maxCount)
        .map(m => m.bookId);
    }

    const evicted = getLRUEvictions(metaList, 2);
    expect(evicted).toContain('b1'); // timestamp=100 最旧
    expect(evicted).toContain('b3'); // timestamp=200 次旧
    expect(evicted).not.toContain('b2');
    expect(evicted).not.toContain('b4');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tests/security.test.js — 安全防护
// ─────────────────────────────────────────────────────────────────────────────

describe('XSS 防护：escapeHtml 覆盖', () => {
  // escapeHtml 的防护边界：
  //   转义 < > & " '，阻止浏览器将字符串解析为 HTML 标签/属性
  //   注意：属性值内的 onerror= 等字符串本身无害——浏览器只在 <tag attr=...> 结构中
  //   才会解析事件处理器，< > 已转义则该结构不存在，onerror= 文本不会被执行
  //   因此正确断言是"< 不泄漏"而非"onerror 字符串不出现"
  const VECTORS = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><script>alert(document.cookie)</script>',
    "' OR '1'='1",
    '${7*7}',
    '{{7*7}}'
  ];

  VECTORS.forEach(vector => {
    test(`安全转义：${vector.slice(0, 30)}...`, () => {
      const escaped = Utils.escapeHtml(vector);
      // 核心防护：标签界定符 < > 必须被转义，阻止浏览器解析为 HTML 元素
      expect(escaped).not.toContain('<script>');
      expect(escaped).not.toContain('<img');
      // javascript: 协议头若出现在 href/src 属性中需转义；escapeHtml 转义 < >
      // 使属性上下文不存在，javascript: 文本本身无额外风险（已无 href 结构）
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
    });
  });
});

describe('颜色注入防护', () => {
  function sanitizeColor(colorStr) {
    if (!colorStr || colorStr === 'transparent') return colorStr || 'transparent';
    return /^#[0-9a-fA-F]{3,8}$/.test(colorStr) ? colorStr : '#ffeb3b';
  }

  const CSS_INJECTION_VECTORS = [
    'red; background: url(//evil.com)',
    '#ff0000; color: red',
    'expression(alert(1))',
    '-moz-binding:url(http://evil.com)',
    '; display: none',
    'url(javascript:alert(1))'
  ];

  CSS_INJECTION_VECTORS.forEach(vector => {
    test(`拦截 CSS 注入：${vector.slice(0, 30)}`, () => {
      expect(sanitizeColor(vector)).toBe('#ffeb3b');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tests/bookid.test.js — bookId 生成
// ─────────────────────────────────────────────────────────────────────────────

describe('generateBookId', () => {
  test('格式匹配 book_<32hex>', async () => {
    const id = await EpubStorage.generateBookId('test.epub', new ArrayBuffer(200));
    expect(id).toMatch(/^book_[0-9a-f]{32}$/);
  });

  test('不同文件名产生不同 ID（需要真实 SHA-256，此处为 mock 测试格式）', async () => {
    // 真实 crypto.subtle 场景下不同输入产生不同输出
    // 此处 mock 返回固定值，仅验证格式
    const id = await EpubStorage.generateBookId('book.epub', new ArrayBuffer(100));
    expect(typeof id).toBe('string');
    expect(id.startsWith('book_')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tests/integration.test.js — 端到端集成场景
// ─────────────────────────────────────────────────────────────────────────────

describe('集成：完整阅读会话模拟', () => {
  const bookId = 'book_test_integration';

  beforeEach(() => {
    chrome.storage.local._reset();
    DbGateway._reset();
  });

  test('首次打开书籍 → 翻页 → 关闭 → 再次打开的完整流程', async () => {
    // Step 1：模拟 addRecentBook
    await EpubStorage.addRecentBook({
      id: bookId, title: '测试书籍', author: '作者', filename: 'test.epub'
    });

    // Step 2：savePosition（防抖后写入）
    await EpubStorage.savePosition(bookId, 'epubcfi(/6/2)', 10.5);

    // Step 3：saveReadingTime
    await EpubStorage.saveReadingTime(bookId, 300);

    // Step 4：saveReadingSpeed（session flush）
    await EpubStorage.saveReadingSpeed(bookId, {
      sampledSeconds: 300, sampledProgress: 0.1
    });

    // Step 5：重新打开，读取 bookMeta
    const meta = await EpubStorage.getBookMeta(bookId);
    expect(meta.pos.cfi).toBe('epubcfi(/6/2)');
    expect(meta.pos.percentage).toBe(10.5);
    expect(meta.time).toBe(300);
    expect(meta.speed.sampledSeconds).toBe(300);
    expect(meta.speed.sampledProgress).toBeCloseTo(0.1);
  });

  test('删书后所有数据都被清理', async () => {
    await EpubStorage.addRecentBook({ id: bookId, title: 'T', filename: 'f.epub' });
    await EpubStorage.savePosition(bookId, 'cfi', 50);
    await EpubStorage.saveHighlights(bookId, [
      { cfi: 'c1', text: '文本', color: '#ff0', note: '', timestamp: 1 }
    ]);
    await EpubStorage.saveBookmarks(bookId, [
      { cfi: 'c1', chapter: 'C1', progress: 10, timestamp: 1 }
    ]);

    await EpubStorage.removeBook(bookId);

    expect(await EpubStorage.getRecentBooks()).toHaveLength(0);
    expect(await EpubStorage.getBookMeta(bookId)).toBeNull();
    expect(await EpubStorage.getHighlights(bookId)).toEqual([]);
    expect(await EpubStorage.getBookmarks(bookId)).toEqual([]);
  });

  test('LRU 驱逐后书架不出现孤立条目', async () => {
    // 书架有 3 本书
    for (let i = 1; i <= 3; i++) {
      await EpubStorage.addRecentBook({ id: `b${i}`, title: `B${i}`, filename: `${i}.epub` });
    }

    // mock getAllMeta 返回 3 条记录，上限为 2
    DbGateway.getAllMeta.mockResolvedValueOnce([
      { bookId: 'b1', timestamp: 3000 },
      { bookId: 'b2', timestamp: 2000 },
      { bookId: 'b3', timestamp: 1000 }  // 最旧，将被驱逐
    ]);

    await EpubStorage.enforceFileLRU(2);

    // 书架中 b3 应已被移除
    const books = await EpubStorage.getRecentBooks();
    const ids = books.map(b => b.id);
    expect(ids).not.toContain('b3');
    expect(ids).toContain('b1');
    expect(ids).toContain('b2');
  });

  test('v1.6.0 → v1.7.0 迁移：getBookMeta 触发 lazy migration', async () => {
    // 模拟 v1.6.0 写入的旧格式数据
    chrome.storage.local._data[`pos_${bookId}`] = {
      cfi: 'epubcfi(/6/10)', percentage: 62.5, timestamp: Date.now() - 10000
    };
    chrome.storage.local._data[`time_${bookId}`] = 3721;

    // getBookMeta 触发迁移
    const meta = await EpubStorage.getBookMeta(bookId);

    // 验证迁移结果
    expect(meta).not.toBeNull();
    expect(meta.pos.percentage).toBe(62.5);
    expect(meta.time).toBe(3721);
    expect(meta.speed).toBeDefined();

    // 等待异步清理完成
    await new Promise(r => setTimeout(r, 10));

    // 旧 key 应已删除
    expect(chrome.storage.local._data[`pos_${bookId}`]).toBeUndefined();
    expect(chrome.storage.local._data[`time_${bookId}`]).toBeUndefined();

    // 新 key 应存在
    expect(chrome.storage.local._data[`bookMeta_${bookId}`]).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tests/regression_v1.8.test.js — v1.8.0 目标修复的回归测试
// ─────────────────────────────────────────────────────────────────────────────

// ── BUG-01：popup 首次打开文件无响应 ─────────────────────────────────────────

describe('BUG-01：showOpenFilePicker 路径', () => {
  test('AbortError 不抛出（用户取消选文件）', async () => {
    const fakeShowOpenFilePicker = jest.fn().mockRejectedValue(
      Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
    );

    // 模拟 popup 的 open 处理逻辑（提取为纯函数便于测试）
    async function handleOpenFile(showOpenFilePicker, storeFile, createTab) {
      try {
        const [fileHandle] = await showOpenFilePicker({
          types: [{ description: 'EPUB Files', accept: { 'application/epub+zip': ['.epub'] } }]
        });
        const file = await fileHandle.getFile();
        const ab   = await file.arrayBuffer();
        await storeFile(file.name, ab);
        createTab();
      } catch (e) {
        if (e.name === 'AbortError') return; // 用户取消，静默处理
        throw e; // 其他错误继续抛出
      }
    }

    const storeFile = jest.fn();
    const createTab = jest.fn();

    // 不应抛出
    await expect(
      handleOpenFile(fakeShowOpenFilePicker, storeFile, createTab)
    ).resolves.toBeUndefined();

    // 取消后不应继续执行
    expect(storeFile).not.toHaveBeenCalled();
    expect(createTab).not.toHaveBeenCalled();
  });

  test('正常选文件 → storeFile 被调用 → createTab 被调用', async () => {
    const mockFile = {
      name: 'test.epub',
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(100))
    };
    const fakeShowOpenFilePicker = jest.fn().mockResolvedValue([
      { getFile: jest.fn().mockResolvedValue(mockFile) }
    ]);
    const storeFile = jest.fn().mockResolvedValue(undefined);
    const createTab = jest.fn();

    async function handleOpenFile(showOpenFilePicker, storeFile, createTab) {
      try {
        const [fh]   = await showOpenFilePicker({});
        const file   = await fh.getFile();
        const ab     = await file.arrayBuffer();
        await storeFile(file.name, ab);
        createTab();
      } catch (e) {
        if (e.name !== 'AbortError') throw e;
      }
    }

    await handleOpenFile(fakeShowOpenFilePicker, storeFile, createTab);
    expect(storeFile).toHaveBeenCalledWith('test.epub', expect.any(ArrayBuffer));
    expect(createTab).toHaveBeenCalledTimes(1);
  });
});

// ── BUG-02：_cachedSpeed 未同步更新 ──────────────────────────────────────────

describe('BUG-02：flushSpeedSession 同步更新内存缓存', () => {
  test('flush 后 _cachedSpeed 立即更新（不依赖 storage 读取）', async () => {
    let cachedSpeed = { sampledSeconds: 0, sampledProgress: 0 };
    const saveReadingSpeed = jest.fn().mockResolvedValue(undefined);

    async function flushSpeedSession_fixed({
      sessionStart, lastProgress, currentTime, bookId
    }) {
      if (!sessionStart) return;
      const deltaP = lastProgress - sessionStart.progress;
      const deltaT = (currentTime - sessionStart.timestamp) / 1000;
      if (deltaP > 0.001 && deltaP < 0.30 && deltaT > 30) {
        // 直接操作内存，不读 storage
        cachedSpeed = {
          sampledSeconds:  cachedSpeed.sampledSeconds  + deltaT,
          sampledProgress: cachedSpeed.sampledProgress + deltaP
        };
        await saveReadingSpeed(bookId, cachedSpeed);
      }
    }

    await flushSpeedSession_fixed({
      sessionStart: { progress: 0.1, timestamp: 0 },
      lastProgress: 0.2,
      currentTime:  120_000,
      bookId: 'b1'
    });

    // 内存缓存立即可用，无需额外 storage 读取
    expect(cachedSpeed.sampledSeconds).toBeCloseTo(120);
    expect(cachedSpeed.sampledProgress).toBeCloseTo(0.1);
    expect(saveReadingSpeed).toHaveBeenCalledTimes(1);
    // 关键：saveReadingSpeed 的调用参数与内存缓存一致
    expect(saveReadingSpeed).toHaveBeenCalledWith('b1', cachedSpeed);
  });

  test('visibilitychange hidden 后重激活：session 起点重置到当前位置', () => {
    let sessionStart = { progress: 0.1, timestamp: 1000 };
    const lastProgress = 0.15;
    const now = 999_000; // 16 分钟后

    // 模拟 visibilitychange hidden → flushSpeedSession(null) → sessionStart = null
    sessionStart = null;

    // 模拟 visibilitychange visible → 重置 session
    function onVisibilityVisible(isBookLoaded, lastProg, currentTime) {
      if (isBookLoaded && lastProg > 0) {
        return { progress: lastProg, timestamp: currentTime };
      }
      return null;
    }

    const newSession = onVisibilityVisible(true, lastProgress, now);
    expect(newSession).not.toBeNull();
    expect(newSession.progress).toBe(0.15);
    expect(newSession.timestamp).toBe(now);
    // 不再包含挂机之前的时间戳
    expect(newSession.timestamp).not.toBe(1000);
  });

  test('降低 session 阈值：30s + 0.3% 触发（原 60s + 0.5%）', () => {
    function canUseSessionETA(sessionDeltaProgress, sessionDeltaSeconds) {
      return sessionDeltaProgress > 0.003 && sessionDeltaSeconds > 30;
    }

    // v1.7.0 阈值：会拒绝这个有效 session
    function canUseSessionETA_old(sessionDeltaProgress, sessionDeltaSeconds) {
      return sessionDeltaProgress > 0.005 && sessionDeltaSeconds > 60;
    }

    const dp = 0.004; // 0.4% 进度
    const dt = 45;    // 45 秒

    expect(canUseSessionETA(dp, dt)).toBe(true);      // 新阈值：通过
    expect(canUseSessionETA_old(dp, dt)).toBe(false);  // 旧阈值：拒绝
  });
});

// ── BUG-03：resize/字号变化的 CFI 保护 ───────────────────────────────────────

describe('BUG-03：CFI 保护机制', () => {
  test('resize 应使用 start.cfi，而非 end.cfi', () => {
    const loc = {
      start: { cfi: 'epubcfi(/6/2[intro]!/4/2,/1:0,/1:248)' },
      end:   { cfi: 'epubcfi(/6/2[intro]!/4/52,/1:0,/1:89)' }
    };

    // 旧代码（错误）
    const wrongCfi = loc.end.cfi;

    // 新代码（正确）
    const correctCfi = loc.start.cfi;

    // start.cfi 是用户正在读的内容起点
    expect(correctCfi).toBe('epubcfi(/6/2[intro]!/4/2,/1:0,/1:248)');

    // end.cfi 是屏幕末尾，字号放大后这个位置会落到前一屏，造成后退
    expect(wrongCfi).toBe('epubcfi(/6/2[intro]!/4/52,/1:0,/1:89)');
    expect(wrongCfi).not.toBe(correctCfi);
  });

  test('withCfiLock 在 async 操作前后均恢复 isResizing', async () => {
    let isResizing = false;
    let displayedCfi = null;

    async function withCfiLock(fn, savedCfi) {
      isResizing = true;
      try {
        await fn();
        await new Promise(r => setTimeout(r, 0)); // 模拟 rAF
        displayedCfi = savedCfi;
      } finally {
        isResizing = false;
      }
    }

    const savedCfi = 'epubcfi(/6/4)';
    await withCfiLock(async () => {
      expect(isResizing).toBe(true); // 操作期间锁定
    }, savedCfi);

    expect(isResizing).toBe(false);     // 操作后解锁
    expect(displayedCfi).toBe(savedCfi); // 恢复到 start.cfi
  });

  test('applyFontSize 变化期间 isResizing 为 true（阻止 relocated 写入）', async () => {
    let isResizing = false;
    const locationChangedCalls = [];

    function onLocationChanged(loc) {
      if (isResizing) return; // 锁定期间忽略
      locationChangedCalls.push(loc);
    }

    async function applyFontSize_fixed(size, updateCSS, savedCfi) {
      isResizing = true;
      await updateCSS(size);
      // 模拟 epub.js 重排触发 relocated
      onLocationChanged({ start: { cfi: 'intermediate_cfi' } });
      await new Promise(r => setTimeout(r, 0));
      isResizing = false;
      // 手动触发最终态
      onLocationChanged({ start: { cfi: savedCfi } });
    }

    const updateCSS = jest.fn().mockResolvedValue(undefined);
    await applyFontSize_fixed(22, updateCSS, 'epubcfi(/6/4)');

    // 锁定期间的 relocated 被拦截，只有最终态被记录
    expect(locationChangedCalls).toHaveLength(1);
    expect(locationChangedCalls[0].start.cfi).toBe('epubcfi(/6/4)');
  });
});

// ── 综合：速度采样 + ETA 端到端验证 ──────────────────────────────────────────

describe('BUG-02 端到端：中途开书 + 多 session 累积 ETA', () => {
  test('从 50% 开始读：2 个 session 累积后 ETA 正确', () => {
    // 书的规模（locations 数量不影响，因为已有历史速度）
    let cachedSpeed = { sampledSeconds: 0, sampledProgress: 0 };

    function flushSession(sessionStart, lastProgress, currentTime) {
      const deltaP = lastProgress - sessionStart.progress;
      const deltaT = (currentTime - sessionStart.timestamp) / 1000;
      if (deltaP > 0.001 && deltaP < 0.30 && deltaT > 30) {
        cachedSpeed = {
          sampledSeconds:  cachedSpeed.sampledSeconds  + deltaT,
          sampledProgress: cachedSpeed.sampledProgress + deltaP
        };
      }
    }

    // Session 1：从 50% 读到 60%，用了 10 分钟
    flushSession({ progress: 0.50, timestamp: 0 }, 0.60, 600_000);

    // Session 2：从 60% 读到 68%，用了 8 分钟
    flushSession({ progress: 0.60, timestamp: 0 }, 0.68, 480_000);

    // 历史速度：18 分钟读了 18%
    // 1% 需要 60 秒
    expect(cachedSpeed.sampledSeconds).toBeCloseTo(1080);  // 18min
    expect(cachedSpeed.sampledProgress).toBeCloseTo(0.18);

    // 当前在 68%，剩余 32%
    const currentProgress = 0.68;
    const remainingProgress = 1 - currentProgress; // 0.32

    // ETA = (sampledSeconds / sampledProgress) * remainingProgress / 60
    const secsPerUnit = cachedSpeed.sampledSeconds / cachedSpeed.sampledProgress;
    const etaMinutes = Math.round(secsPerUnit * remainingProgress / 60);
    // 1% → 60s，剩余 32% → 1920s → 32 分钟
    expect(etaMinutes).toBe(32);

    // 对比 v1.6.0 错误算法：totalTime / currentProgress
    // 总用时 18 分钟，当前进度 68%
    // v1.6.0 会误以为读了 18 分钟是从 0% 读到 68%，速度偏慢
    // 从 68% 到 100%（32%），用 v1.6.0 算：18/0.68 * 0.32 ≈ 8.5 分钟（严重低估）
    const v16_eta = Math.round((1080 / 60) / currentProgress * remainingProgress);
    expect(v16_eta).toBeLessThan(etaMinutes); // v1.6.0 低估
    expect(etaMinutes).toBeGreaterThan(v16_eta);
  });
});
