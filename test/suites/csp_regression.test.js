const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('v1.9 CSP 收敛', () => {
  test.it('C-7: manifest 暂保留 unsafe-inline（当前实现仍依赖）', () => {
    const manifest = fs.readFileSync('src/manifest.json', 'utf8');
    assert.ok(manifest.includes("'unsafe-inline'"));
  });

  test.it('C-1/C-2: reader.js 不再使用 style.cssText 与 opacity 直写', () => {
    const js = fs.readFileSync('src/reader/reader.js', 'utf8');
    assert.ok(!js.includes('style.cssText'));
    assert.ok(!js.includes('readerMain.style.opacity'));
  });

  test.it('C-3/C-4/C-5: search.js 移除内联样式与 status innerHTML', () => {
    const js = fs.readFileSync('src/reader/search.js', 'utf8');
    assert.ok(!js.includes('statusEl.innerHTML'));
    assert.ok(!js.includes('mark.style.cssText'));
    assert.ok(!js.includes('itemEl.style.'));
    assert.ok(!js.includes('textEl.style.'));
  });

  test.it('C-6: toc.js 空目录不再 innerHTML style 字符串', () => {
    const js = fs.readFileSync('src/reader/toc.js', 'utf8');
    assert.ok(!js.includes('<div style='));
    assert.ok(js.includes('toc-empty'));
  });
});

test.describe('reader 主题回归', () => {
  test.it('reader.js 包含低对比度自定义主题保护逻辑', () => {
    const js = fs.readFileSync('src/reader/reader.js', 'utf8');
    assert.ok(js.includes('ensureReadableTheme'));
    assert.ok(js.includes('contrastRatio'));
    assert.ok(js.includes('normalizeHexColor'));
  });
});


test.describe('reader 主题背景回归', () => {
  test.it('generateCustomCss 不再将非 custom 主题背景强制为 transparent', () => {
    const js = fs.readFileSync('src/reader/reader.js', 'utf8');
    assert.ok(js.includes('background-color: ${activeTheme.bg} !important;'));
    assert.ok(!js.includes("currentPrefs.theme === 'custom' && currentPrefs.customBg ? currentPrefs.customBg : 'transparent'"));
  });
});
