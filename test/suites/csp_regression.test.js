const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('v1.9 CSP 收敛', () => {
  test.it('C-7: manifest 暂保留 unsafe-inline（当前实现仍依赖 image-viewer transform）', () => {
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

  test.it('C-8: reader.js 不再使用 style.display 直写（D-2026-04 修复）', () => {
    const js = fs.readFileSync('src/reader/reader.js', 'utf8');
    assert.ok(!js.includes('style.display'));
    assert.ok(!js.includes('welcomeScreen.style.'));
    assert.ok(!js.includes('readerMain.style.'));
    assert.ok(!js.includes('bottomBar.style.'));
    assert.ok(!js.includes('loadingOverlay.style.'));
    assert.ok(!js.includes('customThemeOptions.style.'));
  });

  test.it('C-9: home.js 无 style.* 运行时直写', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    assert.ok(!js.includes('style.display'));
    assert.ok(!js.includes('style.cursor'));
  });

  test.it('C-10: popup.js 无 style.* 运行时直写', () => {
    const js = fs.readFileSync('src/popup/popup.js', 'utf8');
    assert.ok(!js.includes('style.display'));
  });

  test.it('C-11: reader.css 提供 is-hidden/is-visible JS 控制 class（替代 style.display）', () => {
    const css = fs.readFileSync('src/reader/reader.css', 'utf8');
    assert.ok(css.includes('.welcome-screen.is-hidden'));
    assert.ok(css.includes('.reader-main.is-visible'));
    assert.ok(css.includes('.bottom-bar.is-visible'));
    assert.ok(css.includes('.loading-overlay.is-hidden'));
    assert.ok(css.includes('.custom-theme-options.is-visible'));
  });

  test.it('image-viewer.js transform 为合理例外（动态数值无法静态化）', () => {
    // image-viewer: style.transform 是豁免（缩放平移计算值）
    const js = fs.readFileSync('src/reader/image-viewer.js', 'utf8');
    assert.ok(js.includes('style.transform'));
    assert.ok(!js.includes('style.display'));
  });

  test.it('highlights.js top/left 为动态定位豁免，无 style.display', () => {
    // highlights: style.top/left 是悬浮工具栏动态坐标（计算值），属于豁免类型
    const js = fs.readFileSync('src/reader/highlights.js', 'utf8');
    assert.ok(!js.includes('style.display'), 'highlights.js 不应有 style.display');
    assert.ok(!js.includes('style.visibility'), 'highlights.js 不应有 style.visibility');
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
