/**
 * test/suites/ui/ui_home.test.js
 * 
 * 包含 书架 (home.js) 的 UI 结构与逻辑检查
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('Home 首页 UI 检查 (v2.0 迁移)', () => {

  test.it('home.js 含骨架屏与流式渲染入口', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    assert.ok(js.includes('renderBookshelfSkeleton'));
    assert.ok(js.includes('streamRenderBookCard'));
  });

  test.it('书架流式渲染按 recentBooks 顺序替换对应骨架', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    assert.ok(js.includes('renderBookshelfSkeleton(books.length)'), '应为每本书创建稳定占位');
    assert.ok(js.includes('streamRenderBookCard(book, index)'), '渲染任务应携带原始顺序索引');
    assert.ok(js.includes('data-skeleton-index'), '骨架应标记顺序索引');
    assert.ok(js.includes('replaceWith(card)'), '书籍卡片应替换对应骨架，而不是按完成时间追加');
  });

  test.it('C-9: home.js 无 style.* 运行时直写', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    assert.ok(!js.includes('style.display'));
    assert.ok(!js.includes('style.cursor'));
  });

});
