/**
 * test/suites/ui/ui_popup.test.js
 * 
 * 包含 扩展弹出页 (popup.js/html) 的结构、特殊约束 (BUG-B) 与 CSP 检查
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('Popup 弹出页安全与瞬态交互契约', () => {

  test.it('P-1: popup.html 使用内联 <style>，不依赖外部 CSS 文件 (防加载时序与CSP冲突)', () => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8');
    assert.ok(html.includes('<style>'), 'popup.html 应包含内联 <style> 标签');
    assert.ok(!html.includes('<link rel="stylesheet" href="popup.css">'),
      'popup.html 不应引用外部 popup.css（会引入加载时序与CSP问题）');
  });

  test.it('P-3: popup.html 无外部 preconnect/prefetch 标签 (防网络泄露)', () => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8');
    assert.ok(!html.includes('rel="preconnect"'), 'popup.html 不应有 preconnect');
    assert.ok(!html.includes('rel="prefetch"'), 'popup.html 不应有 prefetch');
  });

  test.it('P-4: popup.js openBtn click handler 为同步函数且直接调用 .click() (防用户激活丢失)', () => {
    const js = fs.readFileSync('src/popup/popup.js', 'utf8');
    const code = js.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    assert.ok(!code.includes('showOpenFilePicker'), 'popup.js 代码逻辑中不应调用 showOpenFilePicker（会丢失用户手势激活）');
    assert.ok(code.includes('fileInput.click()'), 'openBtn 应直接调用 fileInput.click()');
  });

});
