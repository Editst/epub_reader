/**
 * test/suites/ui/ui_popup.test.js
 * 
 * 包含 扩展弹出页 (popup.js/html) 的结构、特殊约束 (BUG-B) 与 CSP 检查
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('Popup 弹出页专项检查 (迁移)', () => {

  test.it('P-1: popup.html 使用内联 <style>，不依赖外部 CSS 文件', () => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8');
    assert.ok(html.includes('<style>'), 'popup.html 应包含内联 <style> 标签');
    assert.ok(!html.includes('<link rel="stylesheet" href="popup.css">'),
      'popup.html 不应引用外部 popup.css（会引入加载时序与CSP问题）');
  });

  test.it('P-3: popup.html 无外部 preconnect/prefetch 标签', () => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8');
    assert.ok(!html.includes('rel="preconnect"'), 'popup.html 不应有 preconnect');
    assert.ok(!html.includes('rel="prefetch"'), 'popup.html 不应有 prefetch');
  });

  test.it('P-4: popup.js openBtn click handler 为同步函数且调用 .click()', () => {
    const js = fs.readFileSync('src/popup/popup.js', 'utf8');
    const code = js.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    assert.ok(!code.includes('showOpenFilePicker'), 'popup.js 代码逻辑中不应调用 showOpenFilePicker（会丢失用户手势激活）');
    assert.ok(code.includes('fileInput.click()'), 'openBtn 应直接调用 fileInput.click()');
  });

  test.it('popup.html 弹窗脚本使用裸路径并保持加载顺序', () => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8');
    const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map((match) => match[1]);

    assert.deepEqual(scripts, [
      '../utils/db-gateway.js',
      '../utils/utils.js',
      '../utils/storage.js',
      'popup.js',
    ]);
    assert.ok(scripts.every((src) => !src.includes('?')), '弹窗本地脚本不应使用手动查询串刷新缓存');
  });

});

test.describe('全入口 file-input 物理隐藏一致性 (BUG-B 同类扩展)', () => {
  const entries = [
    'src/popup/popup.html',
    'src/reader/reader.html',
    'src/home/home.html',
  ];

  for (const f of entries) {
    test.it(`${f}: #file-input 不使用 display:none 隐藏`, () => {
      const html = fs.readFileSync(f, 'utf8');
      const fileInputLine = html.split('\n').find(l => l.includes('file-input'));
      assert.ok(fileInputLine, `${f} 应包含 file-input 元素`);
      assert.ok(!fileInputLine.includes('display:none') && !fileInputLine.includes('display: none'),
        `${f} #file-input 不得使用 display:none`);
      assert.ok(!fileInputLine.includes('class="is-hidden"') && !fileInputLine.includes("class='is-hidden'"),
        `${f} #file-input 不得使用 is-hidden class`);
    });
  }
});
