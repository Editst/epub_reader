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

  test.it('P-2: #file-input 使用物理隐藏而非 display:none', () => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8');
    assert.ok(!html.match(/#file-input\s*\{[^}]*display\s*:\s*none/),
      '#file-input 不得使用 display:none（会导致 .click() 被 Chrome 拦截）');
    assert.ok(html.match(/#file-input\s*\{[^}]*(opacity|width\s*:\s*0|height\s*:\s*0)/),
      '#file-input 应使用零尺寸/透明物理隐藏');
  });

  test.it('C-10: popup.js 中 emptyState 使用 style.display 直写', () => {
    const js = fs.readFileSync('src/popup/popup.js', 'utf8');
    assert.ok(js.includes("style.display = 'block'") || js.includes('style.display = "block"'));
    assert.ok(js.includes("style.display = 'none'") || js.includes('style.display = "none"'));
    assert.ok(!js.includes("classList.add('is-hidden')"));
    assert.ok(!js.includes("classList.remove('is-hidden')"));
  });

  test.it('P-4: popup.js openBtn click handler 为同步函数且调用 .click()', () => {
    const js = fs.readFileSync('src/popup/popup.js', 'utf8');
    const code = js.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    assert.ok(!code.includes('showOpenFilePicker'), 'popup.js 代码逻辑中不应调用 showOpenFilePicker');
    assert.ok(code.includes('fileInput.click()'), 'openBtn 应直接调用 fileInput.click()');
  });

  test.it('P-5: popup.js loadRecentBooks 有顶层 try/catch 保护', () => {
    const js = fs.readFileSync('src/popup/popup.js', 'utf8');
    assert.ok(js.includes('try {\n    await loadRecentBooks()'), 'try 块应直接包裹 await loadRecentBooks()');
    assert.ok(js.includes("console.warn('[Popup] loadRecentBooks failed"), 'catch 块应 have fallback');
  });

  test.it('popup.js 最近阅读进度显示前必须归一化', () => {
    const js = fs.readFileSync('src/popup/popup.js', 'utf8');
    assert.ok(js.includes('Utils.normalizePercent(meta.pos.percentage)'), 'popup.js 应归一化 storage 中的阅读进度');
    assert.ok(js.includes("percent.toFixed(1) + '%'"), '展示文本应基于归一化后的数字格式化');
  });

  test.it('P-3: popup.html 无外部 preconnect/prefetch 标签', () => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8');
    assert.ok(!html.includes('rel="preconnect"'), 'popup.html 不应有 preconnect');
    assert.ok(!html.includes('rel="prefetch"'), 'popup.html 不应有 prefetch');
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
