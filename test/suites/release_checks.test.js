const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('v1.8 剩余项收尾', () => {
  test.it('S-4: popup.html 已外联 popup.css，不再包含内联 <style>', () => {
    const popupHtml = fs.readFileSync('src/popup/popup.html', 'utf8');
    assert.ok(popupHtml.includes('href="popup.css"'));
    assert.ok(!popupHtml.includes('<style>'));
  });

  test.it('S-5: reader/home/popup 三入口包含 color-scheme 声明', () => {
    const files = ['src/reader/reader.html', 'src/home/home.html', 'src/popup/popup.html'];
    for (const f of files) {
      const html = fs.readFileSync(f, 'utf8');
      assert.ok(html.includes('<meta name="color-scheme" content="light dark">'), `missing in ${f}`);
    }
  });

  test.it('S-2: themes.css 提供 [data-theme="custom"] 主题变量块', () => {
    const css = fs.readFileSync('src/styles/themes.css', 'utf8');
    assert.ok(css.includes('[data-theme="custom"]'));
    assert.ok(css.includes('--reader-bg'));
    assert.ok(css.includes('--reader-text'));
  });

  test.it('S-6: drag-overlay 结构已移入 reader.html，reader.js 不再 innerHTML 注入', () => {
    const html = fs.readFileSync('src/reader/reader.html', 'utf8');
    const js = fs.readFileSync('src/reader/reader.js', 'utf8');
    assert.ok(html.includes('id="drag-overlay"'));
    assert.ok(!js.includes('dragOverlay.innerHTML'));
  });
});
