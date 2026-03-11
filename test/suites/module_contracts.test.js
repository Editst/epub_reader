const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const moduleContracts = [
  ['src/reader/annotations.js', ['init(', 'setBook(', 'hookRendition(']],
  ['src/reader/search.js', ['init(', 'setBook(', 'togglePanel(']],
  ['src/reader/toc.js', ['init(', 'build(', 'toggle(']],
  ['src/reader/bookmarks.js', ['init(', 'setBook(', 'toggle(']],
  ['src/reader/highlights.js', ['init(', 'setBookDetails(', 'closePanels(']],
  ['src/reader/image-viewer.js', ['init(', 'hookRendition(', 'open(']],
  ['src/utils/storage.js', ['getPreferences', 'savePreferences', 'removeBook(']],
  ['src/utils/db-gateway.js', ['connect()', 'get(', 'put(']],
];

test.describe('模块契约覆盖（基于 docs 架构与模块文档）', () => {
  for (const [file, apiTokens] of moduleContracts) {
    test.it(`${file} 暴露核心接口`, () => {
      const src = fs.readFileSync(file, 'utf8');
      for (const token of apiTokens) {
        assert.ok(src.includes(token), `missing token ${token} in ${file}`);
      }
    });
  }
});
