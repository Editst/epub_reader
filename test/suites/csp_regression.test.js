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

  test.it('C-10: popup.js 中 emptyState 使用 style.display 直写（不依赖外部CSS）', () => {
    // popup 环境的特殊性：file-input 必须用物理隐藏而非 display:none，
    // emptyState 不依赖外部 CSS 的 .is-hidden 规则，直接用 style.display 最可靠
    const js = fs.readFileSync('src/popup/popup.js', 'utf8');
    assert.ok(js.includes("style.display = 'block'") || js.includes('style.display = "block"'));
    assert.ok(js.includes("style.display = 'none'") || js.includes('style.display = "none"'));
    // 不应使用 classList.add/remove('is-hidden') 来控制 emptyState（依赖外部CSS）
    assert.ok(!js.includes("classList.add('is-hidden')"));
    assert.ok(!js.includes("classList.remove('is-hidden')"));
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

test.describe('v1.9.3 popup file-input 物理隐藏回归（BUG-B 专项）', () => {
  test.it('P-1: popup.html 使用内联 <style>，不依赖外部 CSS 文件', () => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8');
    assert.ok(html.includes('<style>'), 'popup.html 应包含内联 <style> 标签');
    assert.ok(!html.includes('<link rel="stylesheet" href="popup.css">'),
      'popup.html 不应引用外部 popup.css（会引入加载时序与CSP问题）');
  });

  test.it('P-2: #file-input 使用物理隐藏而非 display:none', () => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8');
    // 不允许 display:none 隐藏 file-input（Chrome popup 禁止对 display:none 元素 .click()）
    assert.ok(!html.match(/#file-input\s*\{[^}]*display\s*:\s*none/),
      '#file-input 不得使用 display:none（会导致 .click() 被 Chrome 拦截）');
    // 应使用物理隐藏：opacity:0 或 width:0/height:0
    assert.ok(html.match(/#file-input\s*\{[^}]*(opacity|width\s*:\s*0|height\s*:\s*0)/),
      '#file-input 应使用零尺寸/透明物理隐藏');
  });

  test.it('P-3: popup.html 无外部 preconnect/prefetch 标签（CSP connect-src 未配置）', () => {
    const html = fs.readFileSync('src/popup/popup.html', 'utf8');
    assert.ok(!html.includes('rel="preconnect"'),
      'popup.html 不应有 preconnect（manifest 未配置 connect-src，会被CSP阻断）');
    assert.ok(!html.includes('rel="prefetch"'), 'popup.html 不应有 prefetch');
  });

  test.it('P-4: popup.js openBtn click handler 为同步函数（不含 showOpenFilePicker 调用）', () => {
    const js = fs.readFileSync('src/popup/popup.js', 'utf8');
    // 只检查非注释行（注释中可保留说明文字）
    const codeLines = js.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    const code = codeLines.join('\n');
    assert.ok(!code.includes('showOpenFilePicker'),
      'popup.js 代码逻辑中不应调用 showOpenFilePicker');
    assert.ok(code.includes('fileInput.click()'), 'openBtn 应直接调用 fileInput.click()');
  });

  test.it('P-5: popup.js loadRecentBooks 有顶层 try/catch 保护', () => {
    const js = fs.readFileSync('src/popup/popup.js', 'utf8');
    // try { 后紧跟 await loadRecentBooks()，中间只有空白（注释中的出现会在注释结束后）
    assert.ok(
      js.includes('try {\n    await loadRecentBooks()'),
      'try 块应直接包裹 await loadRecentBooks()'
    );
    assert.ok(js.includes("console.warn('[Popup] loadRecentBooks failed"), 'catch 块应有降级处理');
  });

  test.it('P-6: manifest CSP 已配置 style-src 允许 fonts.googleapis.com', () => {
    const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));
    const csp = manifest.content_security_policy?.extension_pages || '';
    assert.ok(csp.includes('fonts.googleapis.com'), 'style-src 应包含 fonts.googleapis.com');
    // connect-src 未配置时 preconnect 会被阻断，记录这个约束
    assert.ok(!csp.includes('connect-src'),
      'manifest 当前未配置 connect-src（因此 popup.html 不得使用 preconnect）');
  });
});

test.describe('全入口 file-input 物理隐藏一致性（BUG-B 同类扩展）', () => {
  const entries = [
    'src/popup/popup.html',
    'src/reader/reader.html',
    'src/home/home.html',
  ];

  for (const f of entries) {
    test.it(`${f}: #file-input 不使用 display:none 隐藏`, () => {
      const html = fs.readFileSync(f, 'utf8');
      // 确认没有任何形式的 display:none 作用于 file-input
      // 包括内联style、is-hidden class（该class定义了display:none）
      const fileInputLine = html.split('\n').find(l => l.includes('file-input'));
      assert.ok(fileInputLine, `${f} 应包含 file-input 元素`);
      assert.ok(!fileInputLine.includes('display:none') && !fileInputLine.includes('display: none'),
        `${f} #file-input 不得使用 display:none（用物理隐藏替代）`);
      assert.ok(!fileInputLine.includes('class="is-hidden"') && !fileInputLine.includes("class='is-hidden'"),
        `${f} #file-input 不得使用 is-hidden class（该class实现为display:none）`);
    });
  }
});
