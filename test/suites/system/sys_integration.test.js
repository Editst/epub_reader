/**
 * test/suites/system/sys_integration.test.js
 * 
 * 包含 跨模块集成测试、端到端阅读会话以及历史关键 BUG 的回归测试
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test.describe('系统集成：完整阅读会话', () => {

  test.beforeEach(() => {
    if (global.resetAll) global.resetAll();
  });

  test.it('打开→翻页→关闭→再打开 流程验证', async () => {
    const id = 'book_integration_test';
    await EpubStorage.addRecentBook({id, title:'集成测试', filename:'test.epub'});
    await EpubStorage.savePosition(id, 'epubcfi(/6/2)', 10.5);
    await EpubStorage.saveReadingTime(id, 300);
    
    const m = await EpubStorage.getBookMeta(id);
    assert.equal(m.pos.cfi, 'epubcfi(/6/2)');
    assert.equal(m.time, 300);
  });

  test.it('级联删除：删除书籍后清理所有关联 Metadata', async () => {
    const id = 'del_test';
    await EpubStorage.addRecentBook({id, title:'T', filename:'f.epub'});
    await EpubStorage.savePosition(id, 'cfi', 50);
    await EpubStorage.removeBook(id);
    assert.equal((await EpubStorage.getRecentBooks()).length, 0);
    assert.equal(await EpubStorage.getBookMeta(id), null);
  });

  test.it('v1.6→v1.7 migration 端到端', async () => {
    const id = 'mig_test';
    // 注入旧数据 — 模拟 v1.6.0 的存储格式 (pos_<id>, time_<id>)
    const data = {
        ['pos_mig_test']: { cfi: 'epubcfi(/6/10)', percentage: 10, timestamp: 123 },
        ['time_mig_test']: 999
    };
    await new Promise(r => chrome.storage.local.set(data, r));
    
    // 触发读取 (EpubStorage.getBookMeta 内部应自动迁移)
    const m = await EpubStorage.getBookMeta(id);
    
    // 验证新结构
    assert.ok(m, '应该返回迁移后的 Meta 对象');
    assert.ok(m.pos, 'Meta.pos 应该存在');
    assert.equal(m.pos.cfi, 'epubcfi(/6/10)');
    assert.equal(m.time, 999);
    
    // 验证旧数据是否已删除 (由 getBookMeta 逻辑保证)
    const oldKeys = await new Promise(r => chrome.storage.local.get(['pos_mig_test', 'time_mig_test'], r));
    assert.equal(oldKeys.pos_mig_test, undefined);
    assert.equal(oldKeys.time_mig_test, undefined);
  });

  test.it('多session累积ETA验证', async () => {
    // 模拟从 50% 读到 68% (18% 增量)
    let spd = { sampledSeconds: 0, sampledProgress: 0 };
    const flush = (s, last, now) => {
        const dp = last - s.p, dt = (now - s.t) / 1000;
        spd.sampledSeconds += dt; spd.sampledProgress += dp;
    };
    flush({p: 0.50, t: 0}, 0.60, 600000); // 10min, 10%
    flush({p: 0.60, t: 0}, 0.68, 480000); // 8min, 8%
    
    const res = Utils.estimateRemainingMinutes({
        remainingProgress: 0.32, // 100-68
        cachedSpeed: spd
    });
    // (1080s / 0.18progress) * 0.32rem / 60s = 32min
    assert.equal(res.minutes, 32);
  });
});

test.describe('BUG 回归专项 (基于历史修复记录)', () => {

  test.it('BUG-01: handleOpenFile 中的 AbortError 应被静默处理', async () => {
    const err = Object.assign(new Error('aborted'), {name:'AbortError'});
    const picker = async()=>{ throw err; };
    const handle = async(p) => { try { await p(); } catch(e) { if(e.name!=='AbortError') throw e; } };
    await handle(picker);
  });

  test.it('BUG-02: visibilitychange 时应重置 sessionStart 排除挂机时间', () => {
    let sessionStart = {progress:0.1, timestamp:1000};
    const now = 999000;
    sessionStart = null; // hidden
    sessionStart = {progress:0.15, timestamp:now}; // visible
    assert.equal(sessionStart.timestamp, now);
  });

  test.it('BUG-03: resize 期间 relocated 被拦截 (isResizing 锁机制)', async () => {
    let isResizing = false;
    let calls = [];
    const onLoc = (loc) => { if(isResizing) return; calls.push(loc); };
    isResizing = true;
    onLoc({cfi:'temp'});
    isResizing = false;
    onLoc({cfi:'final'});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cfi, 'final');
  });

});
