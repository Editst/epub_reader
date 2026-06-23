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

  test.it('manifest 版本升级到 2.3.0', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join('src', 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, '2.3.0');
  });

  test.it('C-7: manifest 暂保留 unsafe-inline (image-viewer 依赖)', () => {
    const manifest = fs.readFileSync('src/manifest.json', 'utf8');
    assert.ok(manifest.includes("'unsafe-inline'"));
  });

  test.it('P-6: manifest CSP 已配置 style-src 允许 fonts.googleapis.com', () => {
    const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));
    const csp = manifest.content_security_policy?.extension_pages || '';
    assert.ok(csp.includes('fonts.googleapis.com'), 'style-src 应包含 fonts.googleapis.com');
    assert.ok(!csp.includes('connect-src'), 'manifest 当前未配置 connect-src');
  });

});
