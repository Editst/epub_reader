/**
 * test/suites/utils/utils.test.js
 * 
 * 包含 src/utils/utils.js 的核心逻辑测试 (含 XSS 防护、速度/ETA 模型)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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

  test.it('Utils.escapeHtml: 连续多次调用无状态污染并复用单例容器', () => {
    const originalCreate = typeof document !== 'undefined' ? document.createElement : null;
    let createCount = 0;
    if (typeof document !== 'undefined') {
      document.createElement = function (tag) {
        createCount++;
        return originalCreate.call(document, tag);
      };
    }
    try {
      assert.equal(Utils.escapeHtml('<b>first</b>'), '&lt;b&gt;first&lt;/b&gt;');
      assert.equal(Utils.escapeHtml('<i>second</i>'), '&lt;i&gt;second&lt;/i&gt;');
      assert.equal(Utils.escapeHtml(null), '');
      assert.equal(Utils.escapeHtml('<span attr="val">& test</span>'), '&lt;span attr=&quot;val&quot;&gt;&amp; test&lt;/span&gt;');
      // 后续调用不应重复触发 document.createElement
      if (typeof document !== 'undefined') {
        assert.ok(createCount <= 1, `Expected createElement count <= 1, got ${createCount}`);
      }
    } finally {
      if (typeof document !== 'undefined') {
        document.createElement = originalCreate;
      }
    }
  });

  test.it('Utils.formatDate', () => {
    const now = Date.now();
    assert.equal(Utils.formatDate(null), '未知时间'); // 默认 fallback
    assert.equal(Utils.formatDate(null, 'N/A'), 'N/A'); // 自定义 fallback
    assert.equal(Utils.formatDate('invalid'), '未知时间');
    assert.equal(Utils.formatDate(now - 10000), '刚刚'); // 30秒内
    assert.equal(Utils.formatDate(now - 7200000), '2 小时前');
    assert.equal(Utils.formatDate(now - 3 * 86400000), '3 天前');
    const old = now - 10 * 86400000;
    assert.ok(Utils.formatDate(old).includes('-') || Utils.formatDate(old).split('/').length >= 2); // 本地日期
    const future = now + 86400000;
    assert.ok(Utils.formatDate(future).includes('-') || Utils.formatDate(future).split('/').length >= 2); // 未来时间不应为“刚刚”
  });

  test.it('Utils.formatDateTime: 格式化绝对日期与分钟时间', () => {
    const timestamp = new Date(2024, 0, 2, 3, 4).getTime();
    const expected = new Date(timestamp).toLocaleDateString('zh-CN') + ' ' +
      new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    assert.equal(Utils.formatDateTime(null), '');
    assert.equal(Utils.formatDateTime('invalid'), '');
    assert.equal(Utils.formatDateTime(timestamp), expected);
  });

  test.it('Utils.formatDuration', () => {
    assert.equal(Utils.formatDuration(0), '0秒');
    assert.equal(Utils.formatDuration(null), '0秒');
    assert.equal(Utils.formatDuration(undefined), '0秒');
    assert.equal(Utils.formatDuration(Infinity), '0秒');
    assert.equal(Utils.formatDuration(NaN), '0秒');
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
    assert.equal(Utils.formatMinutes(Infinity), '0分钟');
    assert.equal(Utils.formatMinutes(45), '45分钟');
    assert.equal(Utils.formatMinutes(60), '1小时');
    assert.equal(Utils.formatMinutes(90), '1小时30分钟');
    assert.equal(Utils.formatMinutes(1.4), '1分钟');
  });

  test.it('Utils.safeWrite 统一收口同步异常与异步拒绝', async () => {
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
      assert.equal(await Utils.safeWrite(() => 42, '[Test] write failed:'), 42);
      assert.equal(await Utils.safeWrite(() => { throw new Error('sync'); }, '[Test] write failed:'), undefined);
      assert.equal(await Utils.safeWrite(
        () => Promise.reject(new Error('async')),
        '[Test] write failed:'
      ), undefined);
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(warnings.length, 2);
    assert.equal(warnings[0][0], '[Test] write failed:');
  });

  test.it('Utils.isEditableTarget: 准确识别 input/select/textarea 和 isContentEditable', () => {
    assert.equal(Utils.isEditableTarget(null), false);
    assert.equal(Utils.isEditableTarget({ tagName: 'DIV' }), false);
    assert.equal(Utils.isEditableTarget({ tagName: 'BUTTON' }), false);
    assert.equal(Utils.isEditableTarget({ tagName: 'INPUT' }), true);
    assert.equal(Utils.isEditableTarget({ tagName: 'input' }), true);
    assert.equal(Utils.isEditableTarget({ tagName: 'TEXTAREA' }), true);
    assert.equal(Utils.isEditableTarget({ tagName: 'SELECT' }), true);
    assert.equal(Utils.isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(Utils.isEditableTarget(null, { tagName: 'INPUT' }), true);
  });
});

test.describe('Utils 业务逻辑 (速度模型与 ETA)', () => {

  test.it('countReadingUnits: 按混合语言口径统计正文单位', () => {
    assert.equal(Utils.countReadingUnits('中文 ABC 123'), 4);
    assert.equal(Utils.countReadingUnits('日本語かなカナ한글'), 9);
    assert.equal(Utils.countReadingUnits("cafe\u0301 don't"), 2, '组合音标和英文撇号应保留在词内');
    assert.equal(Utils.countReadingUnits('，。！？ --'), 0);
    assert.equal(Utils.countReadingUnits(null), 0);
    assert.equal(Utils.countReadingUnits('第1章 核心概念与实践 (Chapter 2: Testing)'), 13);
    // 纯英文文本
    assert.equal(Utils.countReadingUnits('The quick brown fox jumps over the lazy dog.'), 9);
    // 空白与多标点
    assert.equal(Utils.countReadingUnits('   Hello,   world!   '), 2);
  });

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
    assert.equal(low.minutes, null);
    assert.equal(low.source, 'insufficient');

    const obsoleteFallback = Utils.estimateRemainingMinutes({
      remainingProgress: 0.8,
      fallbackMinutes: 100
    });
    assert.equal(obsoleteFallback.minutes, null, '不得用与 locations break 脱节的静态字数生成伪精确 ETA');
  });

  test.it('estimateReadingSpeed: 使用历史进度与正文量换算字速', () => {
    const history = Utils.estimateReadingSpeed({
      sampledSeconds: 600,
      sampledProgress: 0.2,
      contentUnitCount: 10000,
      contentUnitVersion: 1
    });
    assert.deepEqual(history, {
      unitsPerMinute: 200,
      isEstimating: false,
      source: 'history'
    });

    const lowSample = Utils.estimateReadingSpeed({
      sampledSeconds: 120,
      sampledProgress: 0.01,
      contentUnitCount: 10000,
      contentUnitVersion: 1
    });
    assert.equal(lowSample.isEstimating, true);
    assert.equal(lowSample.unitsPerMinute, null);

    const oldSpeed = Utils.estimateReadingSpeed({ sampledSeconds: 600, sampledProgress: 0.2 });
    assert.equal(oldSpeed.source, 'insufficient');
    assert.equal(oldSpeed.isEstimating, true);

    const imageOnly = Utils.estimateReadingSpeed({
      sampledSeconds: 600,
      sampledProgress: 0.2,
      contentUnitCount: 0,
      contentUnitVersion: 1
    });
    assert.equal(imageOnly.source, 'unavailable');
    assert.equal(imageOnly.isEstimating, false);

    const failed = Utils.estimateReadingSpeed(null, 'failed');
    assert.equal(failed.source, 'unavailable');
  });

  test.it('sanitizeColor: 安全性与格式拦截', () => {
    assert.equal(Utils.sanitizeColor('#f00'), '#f00');
    assert.equal(Utils.sanitizeColor('#f008'), '#f008');
    assert.equal(Utils.sanitizeColor('#ff0000'), '#ff0000');
    assert.equal(Utils.sanitizeColor('#ff000080'), '#ff000080');
    assert.equal(Utils.sanitizeColor('transparent'), 'transparent');
    assert.equal(Utils.sanitizeColor(null), 'transparent');
    assert.equal(Utils.sanitizeColor('#12345'), '#ffeb3b');
    assert.equal(Utils.sanitizeColor('#1234567'), '#ffeb3b');
    assert.equal(Utils.sanitizeColor('red; background: url(evil)'), '#ffeb3b'); // 拦截并返回默认
    assert.equal(Utils.sanitizeColor('rgb(255,0,0)'), '#ffeb3b');
    assert.equal(Utils.sanitizeColor('expression(alert(1))'), '#ffeb3b');
    assert.equal(Utils.sanitizeColor('; display: none'), '#ffeb3b');
  });

  test.it('resolveDisplayColor: 透明、缺失和非法颜色回退为可见高亮色', () => {
    assert.equal(Utils.resolveDisplayColor('#abc'), '#abc');
    assert.equal(Utils.resolveDisplayColor('transparent'), '#ffeb3b');
    assert.equal(Utils.resolveDisplayColor(null), '#ffeb3b');
    assert.equal(Utils.resolveDisplayColor('red; display:none'), '#ffeb3b');
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
      assert.equal(Utils.sanitizeColor(h), '#ffeb3b');
    }
  });

  test.it('releaseElementCoverUrl: 正确删除 dataset 属性并调用 URL.revokeObjectURL', () => {
    let revokedUrl = null;
    const oldRevoke = global.URL.revokeObjectURL;
    global.URL.revokeObjectURL = (url) => { revokedUrl = url; };
    try {
      const el = { dataset: { coverUrl: 'blob:test/123' } };
      Utils.releaseElementCoverUrl(el);
      assert.equal(el.dataset.coverUrl, undefined);
      assert.equal(revokedUrl, 'blob:test/123');
    } finally {
      global.URL.revokeObjectURL = oldRevoke;
    }
  });

  test.it('formatDuration 与 formatMinutes 极端脏输入与异常类型全面防御', () => {
    const dirtyInputs = [-999, 'not-a-number', {}, [], true, false, Symbol('test')];
    for (const input of dirtyInputs) {
      assert.equal(Utils.formatDuration(input), '0秒');
      assert.equal(Utils.formatMinutes(input), '0分钟');
    }
  });

  test.it('sanitizeColor 严格支持标准 3/4/6/8 位十六进制及 transparent，其余一律回退默认', () => {
    // 合法十六进制（含大小写与透明通道）
    assert.equal(Utils.sanitizeColor('#ABC'), '#ABC');
    assert.equal(Utils.sanitizeColor('#AbCd'), '#AbCd');
    assert.equal(Utils.sanitizeColor('#123456'), '#123456');
    assert.equal(Utils.sanitizeColor('#123456Ff'), '#123456Ff');
    assert.equal(Utils.sanitizeColor('transparent'), 'transparent');

    // 畸形与越界
    assert.equal(Utils.sanitizeColor('#12'), '#ffeb3b');
    assert.equal(Utils.sanitizeColor('#12345'), '#ffeb3b');
    assert.equal(Utils.sanitizeColor('#1234567'), '#ffeb3b');
    assert.equal(Utils.sanitizeColor('#123456789'), '#ffeb3b');
    assert.equal(Utils.sanitizeColor('rgba(0,0,0,0)'), '#ffeb3b');
    assert.equal(Utils.sanitizeColor('hsl(0, 100%, 50%)'), '#ffeb3b');
    assert.equal(Utils.sanitizeColor(''), 'transparent');
  });

});

