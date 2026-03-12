const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function lineCount(path) {
  return fs.readFileSync(path, 'utf8').trimEnd().split('\n').length;
}

test.describe('v2.1 TDD - Reader 内核解耦', () => {
  test.it('R-1: reader.js 为 <120 行入口编排文件', () => {
    const lines = lineCount('src/reader/reader.js');
    assert.ok(lines < 120, `reader.js line count=${lines}`);
  });

  test.it('R-1: 四个新模块文件存在且每个 <250 行', () => {
    const files = [
      'src/reader/reader-state.js',
      'src/reader/reader-runtime.js',
      'src/reader/reader-persistence.js',
      'src/reader/reader-ui.js'
    ];
    for (const f of files) {
      assert.ok(fs.existsSync(f), `${f} not found`);
      const lines = lineCount(f);
      assert.ok(lines < 250, `${f} lines=${lines}`);
    }
  });

  test.it('R-2: 各层提供 mount/unmount 生命周期接口', () => {
    const files = [
      'src/reader/reader-runtime.js',
      'src/reader/reader-persistence.js',
      'src/reader/reader-ui.js'
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      assert.ok(src.includes('mount'), `${f} missing mount`);
      assert.ok(src.includes('unmount'), `${f} missing unmount`);
    }
  });

  test.it('R-3: 入口通过 state/context 显式组装依赖', () => {
    const js = fs.readFileSync('src/reader/reader.js', 'utf8');
    assert.ok(js.includes('ReaderState.createReaderState'));
    assert.ok(js.includes('ReaderUi.createReaderUi'));
    assert.ok(js.includes('ReaderPersistence.createReaderPersistence'));
    assert.ok(js.includes('ReaderRuntime.createReaderRuntime'));
  });

  test.it('reader.html 已注入 v2.1 reader 子模块脚本', () => {
    const html = fs.readFileSync('src/reader/reader.html', 'utf8');
    assert.ok(html.includes('reader-state.js'));
    assert.ok(html.includes('reader-ui.js'));
    assert.ok(html.includes('reader-persistence.js'));
    assert.ok(html.includes('reader-runtime.js'));
  });

  test.it('清理 D-2026-06: DbGateway.getByFilename 已删除', () => {
    const src = fs.readFileSync('src/utils/db-gateway.js', 'utf8');
    assert.ok(!src.includes('getByFilename'));
  });

  test.it('manifest 版本升级到 2.1.0', () => {
    const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));
    assert.equal(manifest.version, '2.1.0');
  });
});
