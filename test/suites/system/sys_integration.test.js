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

  test.it('bookMeta 数据持久化与生命周期端到端', async () => {
    const id = 'meta_test';
    await EpubStorage.saveBookMeta(id, {
      pos: { cfi: 'epubcfi(/6/10)', percentage: 10, timestamp: 123 },
      time: 999
    });

    // 触发读取并验证结构完整性
    const m = await EpubStorage.getBookMeta(id);

    assert.ok(m, '应该返回有效的 Meta 对象');
    assert.ok(m.pos, 'Meta.pos 应该存在');
    assert.equal(m.pos.cfi, 'epubcfi(/6/10)');
    assert.equal(m.time, 999);
    assert.ok(m.speed, '应该具备默认 speed 结构');
    assert.equal(m.speed.sampledSeconds, 0);
  });
});
