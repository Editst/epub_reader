/**
 * test/suites/ui/ui_home.test.js
 * 
 * 包含 书架 (home.js) 的 UI 结构与逻辑检查
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('Home 书架页面安全与防注入契约', () => {

  test.it('书架书名和作者不得插入 innerHTML 模板属性上下文 (XSS 防护)', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    const templateStart = js.indexOf('card.innerHTML = `');
    assert.ok(templateStart !== -1, '书籍卡片模板应存在');
    const templateEnd = js.indexOf('`;', templateStart);
    const cardTemplate = js.slice(templateStart, templateEnd);

    assert.ok(!/book\.(title|filename|author)/.test(cardTemplate), '书籍元数据不得出现在卡片 innerHTML 模板中');
    assert.ok(!cardTemplate.includes('Utils.escapeHtml(book.'), '不得用 escapeHtml 拼接书籍元数据属性');
    assert.ok(js.includes('titleEl.textContent = bookLabel'), '书名正文应通过 textContent 写入');
    assert.ok(js.includes('titleEl.title = bookLabel'), '书名 title 应通过 DOM 属性写入');
    assert.ok(js.includes('authorEl.textContent = bookAuthor'), '作者应通过 textContent 写入');
  });

  test.it('书架封面 Object URL 通过 DOM 属性赋值并注册回收 (防内存泄漏)', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');

    assert.ok(js.includes('coverImg.src = coverObjectUrl'), 'blob URL 应通过 img.src 属性写入');
    assert.ok(!js.includes('src="${coverObjectUrl}"'), 'blob URL 不得拼入 innerHTML');
    assert.ok(js.includes("window.addEventListener('pagehide', clearRenderedBookCards)"),
      '页面离开时必须释放仍由卡片持有的封面 URL');
  });

  test.it('BUG-11: home.js Markdown 导出不对 title/author 使用 escapeHtml 且在 finally 释放 Object URL', () => {
    const src = fs.readFileSync('src/home/home.js', 'utf8');
    const exportStart = src.indexOf('btn-export-all');
    assert.ok(exportStart !== -1, 'export button handler must exist');

    const exportBlock = src.slice(exportStart, exportStart + 2000);
    const hasEscapeInMdOutput = /escapeHtml\(book\.(title|author|filename)\)/.test(exportBlock);
    assert.ok(
      !hasEscapeInMdOutput,
      'Markdown export must not use escapeHtml for title/author — HTML entities are meaningless in .md files'
    );
    assert.match(exportBlock, /finally \{\s*a\.remove\(\);\s*URL\.revokeObjectURL\(url\);\s*\}/,
      'Markdown download must revoke its Object URL even when click/append fails');
  });

  test.it('home.html 与 home.js 支持拖放遮罩与 dragover/dragleave/drop 导入', () => {
    const html = fs.readFileSync('src/home/home.html', 'utf8');
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    const css = fs.readFileSync('src/home/home.css', 'utf8');

    assert.ok(html.includes('id="drag-overlay"'), 'home.html 必须包含 drag-overlay 元素');
    assert.ok(html.includes('drag-overlay is-hidden'), 'drag-overlay 初始状态必须包含 is-hidden 类');
    assert.ok(css.includes('.drag-overlay'), 'home.css 必须包含 drag-overlay 样式');
    assert.ok(js.includes("document.addEventListener('dragover'"), 'home.js 必须监听 dragover');
    assert.ok(js.includes("document.addEventListener('dragleave'"), 'home.js 必须监听 dragleave');
    assert.ok(js.includes("document.addEventListener('drop'"), 'home.js 必须监听 drop');
    assert.ok(js.includes('EpubStorage.importBookFile(file)'), 'drop 事件必须接入 EpubStorage.importBookFile');
  });

});
