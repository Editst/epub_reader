const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('v1.8 剩余项收尾', () => {
  test.it('S-4: popup.html 使用内联 <style>（v1.9.3 回归内联，消除外部CSS加载时序问题）', () => {
    const popupHtml = fs.readFileSync('src/popup/popup.html', 'utf8');
    // v1.9.3 教训：popup.html 不应依赖外部 CSS 控制关键交互元素（file-input 显隐）
    assert.ok(popupHtml.includes('<style>'), 'popup.html 应使用内联 <style>');
    assert.ok(!popupHtml.includes('href="popup.css"'), 'popup.html 不应引用外部 popup.css');
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

test.describe('v1.9.2 收尾完成验证', () => {
  test.it('F-1: storage.js _get/_set/_remove 均检查 chrome.runtime.lastError', () => {
    const js = fs.readFileSync('src/utils/storage.js', 'utf8');
    // 三个内部方法均有 lastError 的 reject 路径
    const lastErrorCount = (js.match(/chrome\.runtime\.lastError/g) || []).length;
    assert.ok(lastErrorCount >= 3, `期望至少 3 处 lastError 检查，实际 ${lastErrorCount}`);
    assert.ok(js.includes('return reject(chrome.runtime.lastError)'));
  });

  test.it('F-2: storage.js 使用 _bookMetaQueue 串行化 bookMeta 写入', () => {
    const js = fs.readFileSync('src/utils/storage.js', 'utf8');
    assert.ok(js.includes('_bookMetaQueue'));
    assert.ok(js.includes('_enqueueBookMetaWrite'));
    // 三个写操作均通过队列
    assert.ok(js.includes("await this._enqueueBookMetaWrite(bookId"));
  });

  test.it('F-3: getAllHighlights 使用 _getAll 全量扫描补全 highlights_ 前缀', () => {
    const js = fs.readFileSync('src/utils/storage.js', 'utf8');
    assert.ok(js.includes("key.startsWith('highlights_')"));
    assert.ok(js.includes('_getAll'));
  });

  test.it('F-4a: reader.js 所有 style.display 已迁移为 class 切换', () => {
    const js = fs.readFileSync('src/reader/reader.js', 'utf8');
    assert.ok(!js.includes('style.display'));
    assert.ok(js.includes("classList.add('is-hidden')") || js.includes("classList.toggle('is-hidden'"));
    assert.ok(js.includes("classList.add('is-visible')"));
  });

  test.it('F-4b: reader.html 关键元素无内联 style="display:none"', () => {
    const html = fs.readFileSync('src/reader/reader.html', 'utf8');
    // reader-main 和 bottom-bar 不再有 inline style
    assert.ok(!html.match(/id="reader-main"[^>]*style=/));
    assert.ok(!html.match(/id="bottom-bar"[^>]*style=/));
    // loading-overlay 通过 is-hidden class 控制
    assert.ok(html.includes('loading-overlay is-hidden') || html.includes('is-hidden" id="loading-overlay'));
  });

  test.it('F-4c: reader.css 提供完整的 is-hidden/is-visible 辅助类组', () => {
    const css = fs.readFileSync('src/reader/reader.css', 'utf8');
    assert.ok(css.includes('.welcome-screen.is-hidden'));
    assert.ok(css.includes('.reader-main.is-visible'));
    assert.ok(css.includes('.bottom-bar.is-visible'));
    assert.ok(css.includes('.loading-overlay.is-hidden'));
    assert.ok(css.includes('.custom-theme-options.is-visible'));
  });

  test.it('manifest version 为 1.9.3', () => {
    const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));
    assert.strictEqual(manifest.version, '1.9.3');
  });

  test.it('全项目 style.* 写入约束（含豁免清单）', () => {
    // reader/home/search/toc 等模块禁止 style.display 等显隐控制直写
    const strictFiles = [
      'src/reader/reader.js', 'src/home/home.js',
      'src/reader/search.js', 'src/reader/toc.js',
      'src/reader/bookmarks.js', 'src/reader/annotations.js',
    ];
    const prohibitedProps = ['style.display', 'style.visibility', 'style.cssText', 'style.cursor'];
    for (const f of strictFiles) {
      const src = fs.readFileSync(f, 'utf8');
      for (const prop of prohibitedProps) {
        assert.ok(!src.includes(prop), `${f} 仍有禁止的 ${prop} 直写`);
      }
    }
    // ── 豁免清单 ──────────────────────────────────────────────────────────
    // image-viewer: style.transform（缩放平移计算值，无法静态化）→ v2.2.0 迁移
    const ivSrc = fs.readFileSync('src/reader/image-viewer.js', 'utf8');
    assert.ok(ivSrc.includes('style.transform'));
    assert.ok(!ivSrc.includes('style.display'));
    // highlights: style.top/left（悬浮工具栏动态定位）
    const hlSrc = fs.readFileSync('src/reader/highlights.js', 'utf8');
    assert.ok(hlSrc.includes('style.top') || hlSrc.includes('style.left'));
    assert.ok(!hlSrc.includes('style.display'));
    // popup.js: style.display 豁免（emptyState 不依赖外部CSS；file-input 物理隐藏例外）
    // popup 的隐藏控制必须不依赖外部CSS加载，style.display 直写是此场景的正确模式
    const popupJs = fs.readFileSync('src/popup/popup.js', 'utf8');
    assert.ok(popupJs.includes("style.display"), 'popup.js 应保留 style.display 直写（豁免）');
    assert.ok(!popupJs.includes('style.visibility'), 'popup.js 不应有 style.visibility');
    assert.ok(!popupJs.includes('style.cssText'), 'popup.js 不应有 style.cssText');
  });
});
