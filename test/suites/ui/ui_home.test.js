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

  test.it('C-9: home.js 无 style.* 运行时直写', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    assert.ok(!js.includes('style.display'));
    assert.ok(!js.includes('style.cursor'));
  });

});
