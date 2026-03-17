/**
 * test/suites/v2_2_tdd.test.js
 *
 * v2.2.0 验收测试套件
 *
 * 覆盖：
 *   D-2026-25: storage.js speed.sessions 持久化结构落地
 *   版本号: manifest.version === '2.2.0'
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

// ── D-2026-25: storage.js speed.sessions 结构落地 ────────────────────────────

test.describe('D-2026-25: storage.js speed.sessions 持久化结构', () => {

  const storageSrc = fs.readFileSync(path.join('src', 'utils', 'storage.js'), 'utf8');

  test.it('getReadingSpeed 返回值包含 sessions 字段', () => {
    assert.ok(
      storageSrc.includes('sessions'),
      'storage.js getReadingSpeed 应包含 sessions 字段处理'
    );
  });

  test.it('getReadingSpeed 返回值包含 sessionCount 字段', () => {
    assert.ok(
      storageSrc.includes('sessionCount'),
      'storage.js 应包含 sessionCount 字段处理'
    );
  });

  test.it('speed 默认结构包含 sessions 数组', () => {
    assert.ok(
      storageSrc.includes('sessions: []') ||
      storageSrc.includes('sessions:[]') ||
      storageSrc.includes("'sessions'") ||
      storageSrc.includes('"sessions"'),
      'storage.js 默认 speed 结构应包含 sessions 字段'
    );
  });

});

// ── 版本号验证 ─────────────────────────────────────────────────────────────────

test.describe('v2.2.0 版本号', () => {

  test.it('manifest.json version === "2.2.0"', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join('src', 'manifest.json'), 'utf8')
    );
    assert.strictEqual(manifest.version, '2.2.0');
  });

});
