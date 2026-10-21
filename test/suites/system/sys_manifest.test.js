/**
 * test/suites/system/sys_manifest.test.js
 * 
 * 包含 manifest.json 的版本、配置与 CSP 检查
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test.describe('Manifest 配置检查', () => {

  test.it('manifest 版本升级到 2.6.8', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join('src', 'manifest.json'), 'utf8'));
    assert.strictEqual(manifest.version, '2.6.8');
  });

  test.it('C-7: manifest 暂保留 unsafe-inline (image-viewer 依赖)', () => {
    const manifest = fs.readFileSync('src/manifest.json', 'utf8');
    assert.ok(manifest.includes("'unsafe-inline'"));
  });

  test.it('P-6: manifest CSP 已配置 style-src 与 connect-src，且不再放行外部字体', () => {
    const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));
    const csp = manifest.content_security_policy?.extension_pages || '';
    assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"), 'style-src 应仅允许本地与内联样式');
    assert.ok(!csp.includes('fonts.googleapis.com'), 'style-src 不应再放行 Google Fonts');
    assert.ok(!csp.includes('fonts.gstatic.com'), 'font-src 不应再放行 Google Fonts');
    assert.ok(csp.includes("connect-src 'self' blob:"), 'manifest 应配置 connect-src 限制');
  });

  test.it('无后台职责时不注册空 service worker', () => {
    const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));

    assert.equal(manifest.background, undefined);
    assert.equal(fs.existsSync('src/background/service-worker.js'), false);
  });

  test.it('仅扩展页面使用的本地库不对网页开放', () => {
    const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));
    assert.equal(manifest.web_accessible_resources, undefined);
  });

});
