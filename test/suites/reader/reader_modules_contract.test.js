'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const expectedContracts = [
  ['src/reader/annotations.js', ['init(', 'setBook(', 'hookRendition(']],
  ['src/reader/bookmarks.js', ['init(', 'setBook(', 'toggle(', 'isBookmarked(', 'mount(', 'unmount(']],
  ['src/reader/highlights.js', ['init(', 'setBookDetails(', 'closePanels(', 'mount(', 'unmount(']],
  ['src/reader/image-viewer.js', ['init(', 'hookRendition(', 'open(', 'close(', 'mount(', 'unmount(']],
  ['src/reader/search.js', ['init(', 'setBook(', 'togglePanel(', 'closePanel(', 'reset(', 'mount(', 'unmount(']],
  ['src/reader/toc.js', ['init(', 'build(', 'setActive(', 'open(', 'close(', 'toggle(', 'reset(', 'mount(', 'unmount(']]
];

test.describe('Reader 功能模块公开契约', () => {
  for (const [file, tokens] of expectedContracts) {
    test.it(`${file} 覆盖文档声明的公开接口`, () => {
      const src = fs.readFileSync(file, 'utf8');
      tokens.forEach((token) => {
        assert.ok(src.includes(token), `${file} missing ${token}`);
      });
    });
  }

  test.it('search/toc/highlights 避免已知的内联样式回退', () => {
    const searchSrc = fs.readFileSync('src/reader/search.js', 'utf8');
    const tocSrc = fs.readFileSync('src/reader/toc.js', 'utf8');
    const highlightsSrc = fs.readFileSync('src/reader/highlights.js', 'utf8');

    assert.ok(!searchSrc.includes('statusEl.innerHTML'));
    assert.ok(!searchSrc.includes('mark.style.cssText'));
    assert.ok(!tocSrc.includes('<div style='));
    assert.ok(!highlightsSrc.includes('style.display'));
  });
});
