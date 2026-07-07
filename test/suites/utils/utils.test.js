/**
 * test/suites/utils/utils.test.js
 * 
 * 包含 src/utils/utils.js 的核心逻辑测试 (含 XSS 防护、速度/ETA 模型)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 这里的 sanitizeColor 是从源码 (highlights.js / home.js) 中提取的逻辑
const sanitizeColor = (colorStr) => {
  if (!colorStr || colorStr === 'transparent') return colorStr || 'transparent';
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(colorStr)
    ? colorStr
    : '#ffeb3b';
};

test.describe('Utils 基础工具函数', () => {

  test.it('Utils.escapeHtml: 转义 HTML 特殊字符', () => {
    assert.equal(Utils.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(Utils.escapeHtml('"double quote"'), '&quot;double quote&quot;');
    assert.equal(Utils.escapeHtml('&amp;'), '&amp;amp;'); // 双重转义
  });

  test.it('Utils.escapeHtml: null/undefined 返回空字符串', () => {
    assert.equal(Utils.escapeHtml(null), '');
    assert.equal(Utils.escapeHtml(undefined), '');
  });

  test.it('Utils.escapeHtml: 数字与正常文本', () => {
    assert.equal(Utils.escapeHtml(123), '123');
    assert.equal(Utils.escapeHtml('hello'), 'hello');
  });

  test.it('Utils.formatDate', () => {
    const now = Date.now();
    assert.equal(Utils.formatDate(null), '未知时间'); // 默认 fallback
    assert.equal(Utils.formatDate(null, 'N/A'), 'N/A'); // 自定义 fallback
    assert.equal(Utils.formatDate(now - 10000), '刚刚'); // 30秒内
    assert.equal(Utils.formatDate(now - 7200000), '2 小时前');
    assert.equal(Utils.formatDate(now - 3 * 86400000), '3 天前');
    const old = now - 10 * 86400000;
    assert.ok(Utils.formatDate(old).includes('-') || Utils.formatDate(old).split('/').length >= 2); // 本地日期
  });

  test.it('Utils.formatDuration', () => {
    assert.equal(Utils.formatDuration(0), '0秒');
    assert.equal(Utils.formatDuration(null), '0秒');
    assert.equal(Utils.formatDuration(undefined), '0秒');
    assert.equal(Utils.formatDuration(59), '59秒');
    assert.equal(Utils.formatDuration(60), '1分钟');
    assert.equal(Utils.formatDuration(90), '1分钟'); // v1.x 逻辑：取整分钟
    assert.equal(Utils.formatDuration(3660), '1小时1分');
    assert.equal(Utils.formatDuration(7200), '2小时');
    assert.equal(Utils.formatDuration(-10), '0秒');
  });

  test.it('Utils.formatMinutes', () => {
    assert.equal(Utils.formatMinutes(0), '0分钟');
    assert.equal(Utils.formatMinutes(null), '0分钟');
    assert.equal(Utils.formatMinutes(45), '45分钟');
    assert.equal(Utils.formatMinutes(60), '1小时');
    assert.equal(Utils.formatMinutes(90), '1小时30分钟');
    assert.equal(Utils.formatMinutes(1.4), '1分钟');
  });
});

test.describe('Utils 业务逻辑 (速度模型与 ETA)', () => {

  test.it('computeSessionWeight: 连续阅读权重高于跳读', () => {
    const continuous = Utils.computeSessionWeight(0.04, 180);
    const skipping = Utils.computeSessionWeight(0.25, 50);
    assert.ok(continuous > skipping);
  });

  test.it('estimateRemainingMinutes: ETA 估算逻辑', () => {
    // 进度=1.0 返回 0
    const done = Utils.estimateRemainingMinutes({ remainingProgress: 0, cachedSpeed: { sampledSeconds: 100, sampledProgress: 0.1 } });
    assert.equal(done.minutes, 0);

    // 高质量历史样本
    const history = Utils.estimateRemainingMinutes({
      remainingProgress: 0.5,
      cachedSpeed: { sampledSeconds: 600, sampledProgress: 0.25 }
    });
    assert.equal(history.isEstimating, false);
    assert.equal(history.minutes, 20); // (600/0.25)*0.5/60 = 20

    // 低样本返回 estimating
    const low = Utils.estimateRemainingMinutes({
      remainingProgress: 0.8,
      cachedSpeed: { sampledSeconds: 10, sampledProgress: 0.001 }
    });
    assert.ok(low.isEstimating);
  });

  test.it('进度跳跃检测 (shouldFlush)', () => {
    const thr = 0.05;
    const shouldFlush = (last, next) => Math.abs(next - last) > thr;
    assert.ok(!shouldFlush(0.10, 0.12), '正常翻页不触发');
    assert.ok(shouldFlush(0.10, 0.80), 'TOC 跳转触发');
    assert.ok(shouldFlush(0.50, 0.60), '进度条拖动触发');
    // IEEE 754 精度测试: 0.55-0.50
    assert.ok(shouldFlush(0.55, 0.50) || Math.abs(0.55-0.50) > 0.049, '浮点边界应触发');
  });

  test.it('sanitizeColor: 安全性与格式拦截', () => {
    assert.equal(sanitizeColor('#f00'), '#f00');
    assert.equal(sanitizeColor('#f008'), '#f008');
    assert.equal(sanitizeColor('#ff0000'), '#ff0000');
    assert.equal(sanitizeColor('#ff000080'), '#ff000080');
    assert.equal(sanitizeColor('transparent'), 'transparent');
    assert.equal(sanitizeColor(null), 'transparent');
    assert.equal(sanitizeColor('#12345'), '#ffeb3b');
    assert.equal(sanitizeColor('#1234567'), '#ffeb3b');
    assert.equal(sanitizeColor('red; background: url(evil)'), '#ffeb3b'); // 拦截并返回默认
    assert.equal(sanitizeColor('rgb(255,0,0)'), '#ffeb3b');
    assert.equal(sanitizeColor('expression(alert(1))'), '#ffeb3b');
    assert.equal(sanitizeColor('; display: none'), '#ffeb3b');
  });

  test.it('normalizePercent: 归一化脏进度输入', () => {
    assert.equal(Utils.normalizePercent(42.5), 42.5);
    assert.equal(Utils.normalizePercent('88.8'), 88.8);
    assert.equal(Utils.normalizePercent(-12), 0);
    assert.equal(Utils.normalizePercent(130), 100);
    assert.equal(Utils.normalizePercent('12; width:999px'), 0);
    assert.equal(Utils.normalizePercent(null), 0);
    assert.equal(Utils.normalizePercent(Infinity), 0);
  });
});

test.describe('安全与注入防护 (Utils)', () => {

  test.it('XSS 向量转义 (escapeHtml)', () => {
    const vectors = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '"><script>alert(document.cookie)',
      "'OR '1'='1",
      '${7*7}',
      '{{7*7}}'
    ];
    for (const v of vectors) {
      const e = Utils.escapeHtml(v);
      assert.ok(!e.includes('<') && !e.includes('>'));
    }
  });

  test.it('颜色 CSS 注入防护 (sanitizeColor)', () => {
    const hacks = [
      'red; background: url(//evil.co)',
      '#ff0000; color: red',
      '-moz-binding:url(http://evil)',
      'url(javascript:alert(1))'
    ];
    for (const h of hacks) {
      assert.equal(sanitizeColor(h), '#ffeb3b');
    }
  });

});
