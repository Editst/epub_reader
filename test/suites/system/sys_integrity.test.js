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

  test.it('首方样式不保留已废弃的选择器', () => {
    const css = [
      fs.readFileSync('src/reader/reader.css', 'utf8'),
      fs.readFileSync('src/home/home.css', 'utf8')
    ].join('\n');

    assert.ok(!css.includes('.annotation-item-cover'));
  });

  test.it('本地工具单例使用 IIFE 并显式导出到 window', () => {
    const modules = [
      ['src/utils/db-gateway.js', 'DbGateway'],
      ['src/utils/utils.js', 'Utils'],
      ['src/utils/storage.js', 'EpubStorage']
    ];

    for (const [file, exportName] of modules) {
      const source = fs.readFileSync(file, 'utf8');
      assert.match(source, /\(function \(\) \{\s*'use strict';/);
      assert.ok(source.includes(`window.${exportName} = ${exportName};`));
    }
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
        if (f.includes('reader.js') || f.includes('home.js')) {
            assert.ok(!src.includes(prop), `${f} 仍有禁止的 ${prop} 直写`);
        }
      }
    }
  });

  test.it('全入口 HTML 本地脚本使用裸路径并保持依赖加载顺序', () => {
    const expectations = {
      'src/popup/popup.html': [
        '../utils/db-gateway.js',
        '../utils/utils.js',
        '../utils/storage.js',
        'popup.js',
      ],
      'src/home/home.html': [
        '../utils/db-gateway.js',
        '../utils/utils.js',
        '../utils/storage.js',
        'home.js',
      ],
      'src/reader/reader.html': [
        '../utils/db-gateway.js',
        '../utils/utils.js',
        '../utils/storage.js',
        'image-viewer.js',
        'annotations.js',
        'toc.js',
        'search.js',
        'bookmarks.js',
        'highlights.js',
        'reader-state.js',
        'reader-ui.js',
        'reader-persistence.js',
        'reader-runtime.js',
        'reader.js',
      ]
    };

    for (const [file, expectedScripts] of Object.entries(expectations)) {
      const html = fs.readFileSync(file, 'utf8');
      const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g))
        .map((m) => m[1])
        .filter((src) => !src.startsWith('../lib/'));

      assert.deepEqual(scripts, expectedScripts, `${file} 脚本加载顺序不符`);
      assert.ok(scripts.every((src) => !src.includes('?')), `${file} 本地脚本不应使用查询串刷新缓存`);
    }
  });

  test.it('全入口 file-input 物理隐藏一致性 (防 .click() 拦截)', () => {
    const entries = [
      'src/popup/popup.html',
      'src/reader/reader.html',
      'src/home/home.html',
    ];

    for (const f of entries) {
      const html = fs.readFileSync(f, 'utf8');
      const fileInputLine = html.split('\n').find(l => l.includes('file-input'));
      assert.ok(fileInputLine, `${f} 应包含 file-input 元素`);
      assert.ok(!fileInputLine.includes('display:none') && !fileInputLine.includes('display: none'),
        `${f} #file-input 不得使用 display:none`);
      assert.ok(!fileInputLine.includes('class="is-hidden"') && !fileInputLine.includes("class='is-hidden'"),
        `${f} #file-input 不得使用 is-hidden class`);
    }
  });

});
