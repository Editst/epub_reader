const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadGlobalConst(filePath, constName) {
  const code = fs.readFileSync(filePath, 'utf8');
  global.document = global.document || {
    createElement() {
      return {
        textContent: '',
        get innerHTML() {
          return this.textContent;
        }
      };
    }
  };
  vm.runInThisContext(`${code}\n;global.${constName} = ${constName};`, { filename: filePath });
  return global[constName];
}

test.describe('v2.0 TDD - Utils 速度模型与ETA', () => {
  const Utils = loadGlobalConst('src/utils/utils.js', 'Utils');

  test.it('computeSessionWeight: 连续阅读权重高于跳读', () => {
    const continuous = Utils.computeSessionWeight(0.04, 180);
    const skipping = Utils.computeSessionWeight(0.25, 50);
    assert.ok(continuous > skipping, `continuous=${continuous}, skipping=${skipping}`);
  });

  test.it('estimateRemainingMinutes: 低样本返回 estimating', () => {
    const result = Utils.estimateRemainingMinutes({
      remainingProgress: 0.5,
      cachedSpeed: { sampledSeconds: 30, sampledProgress: 0.001 },
      session: { startProgress: 0.2, lastProgress: 0.205, deltaSeconds: 10 }
    });
    assert.equal(result.isEstimating, true);
    assert.equal(result.minutes, null);
  });

  test.it('estimateRemainingMinutes: 高质量历史样本可直接估算', () => {
    const result = Utils.estimateRemainingMinutes({
      remainingProgress: 0.5,
      cachedSpeed: { sampledSeconds: 600, sampledProgress: 0.25 },
      session: null
    });
    assert.equal(result.isEstimating, false);
    assert.ok(Number.isFinite(result.minutes));
    assert.ok(result.minutes > 0);
  });
});

test.describe('v2.0 TDD - 代码契约检查', () => {
  test.it('reader-runtime.js 使用 idle 调度 locations 生成并包含进度文案', () => {
    const js = fs.readFileSync('src/reader/reader-runtime.js', 'utf8');
    assert.ok(js.includes('scheduleLocationsGeneration'));
    assert.ok(js.includes('requestIdleCallback') || js.includes('setTimeout'));
    assert.ok(js.includes('生成阅读定位索引'));
  });

  test.it('home.js 含骨架屏与流式渲染入口', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    assert.ok(js.includes('renderBookshelfSkeleton'));
    assert.ok(js.includes('streamRenderBookCard'));
  });

  test.it('manifest 版本升级到 2.1.0', () => {
    const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));
    assert.equal(manifest.version, '2.1.0');
  });
});
