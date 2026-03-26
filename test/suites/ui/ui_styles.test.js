/**
 * test/suites/ui/ui_styles.test.js
 * 
 * 包含 全局样式、主题变量与 CSS class 辅助类的检查
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('样式与辅助类检查', () => {

  test.it('S-2: themes.css 提供 [data-theme="custom"] 主题变量块', () => {
    const css = fs.readFileSync('src/styles/themes.css', 'utf8');
    assert.ok(css.includes('[data-theme="custom"]'));
    assert.ok(css.includes('--reader-bg'));
    assert.ok(css.includes('--reader-text'));
  });

  test.it('F-4c/C-11: reader.css 提供完整的 is-hidden/is-visible 辅助类组', () => {
    const css = fs.readFileSync('src/reader/reader.css', 'utf8');
    assert.ok(css.includes('.welcome-screen.is-hidden'));
    assert.ok(css.includes('.reader-main.is-visible'));
    assert.ok(css.includes('.bottom-bar.is-visible'));
    assert.ok(css.includes('.loading-overlay.is-hidden'));
    assert.ok(css.includes('.custom-theme-options.is-visible'));
  });

});
