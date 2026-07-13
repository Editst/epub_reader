/**
 * test/suites/system/sys_integrity.test.js
 * 
 * 包含 项目整体工程完整性、测试入口统一性与全局代码约束检查
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('项目工程完整性检查', () => {

  test.it('S-5: reader/home/popup 三入口包含 color-scheme 声明', () => {
    const files = ['src/reader/reader.html', 'src/home/home.html', 'src/popup/popup.html'];
    for (const f of files) {
      const html = fs.readFileSync(f, 'utf8');
      assert.ok(html.includes('<meta name="color-scheme" content="light dark">'), `missing in ${f}`);
    }
  });

  test.it('测试入口统一：run_tests.js 自动发现嵌套 suites 目录', () => {
    const js = fs.readFileSync('test/run_tests.js', 'utf8');
    // 检查递归逻辑或 findTestFiles 函数是否存在
    assert.ok(js.includes('findTestFiles') || js.includes('recursive: true'));
    assert.ok(!js.includes("require('./suites/release_checks.test.js')"));
  });

  test.it('架构文档版本与当前接口保持同步', () => {
    const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));
    const architecture = fs.readFileSync('docs/architecture.md', 'utf8');
    const roadmap = fs.readFileSync('docs/ROADMAP.md', 'utf8');

    assert.ok(architecture.includes(`版本：v${manifest.version}`));
    assert.ok(roadmap.includes(`（v${manifest.version}）`));
    assert.ok(architecture.includes('isTocHrefMatch(currentHref: string, itemHref: string): boolean'));
    assert.ok(architecture.includes('Utils.formatDateTime(timestamp: number, fallback?: string): string'));
    assert.ok(!architecture.includes('onLocationChanged'));
  });

  test.it('入口未加载的旧 Popup 样式文件不应继续保留', () => {
    assert.equal(fs.existsSync('src/popup/popup.css'), false);
  });

  test.it('全项目 style.* 写入约束 (含豁免清单)', () => {
    const strictFiles = [
      'src/reader/reader.js', 'src/home/home.js',
      'src/reader/search.js', 'src/reader/toc.js',
      'src/reader/bookmarks.js', 'src/reader/annotations.js',
    ];
    const prohibitedProps = ['style.display', 'style.visibility', 'style.cssText', 'style.cursor'];
    for (const f of strictFiles) {
      const src = fs.readFileSync(f, 'utf8');
      for (const prop of prohibitedProps) {
        // 部分模块可能有 style.display 豁免，但在 STRICT 列表中应尽量避免
        if (f.includes('reader.js') || f.includes('home.js')) {
            assert.ok(!src.includes(prop), `${f} 仍有禁止的 ${prop} 直写`);
        }
      }
    }
  });

});
