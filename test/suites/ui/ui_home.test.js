/**
 * test/suites/ui/ui_home.test.js
 * 
 * 包含 书架 (home.js) 的 UI 结构与逻辑检查
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('Home 首页 UI 检查 (v2.0 迁移)', () => {

  test.it('home.js 含骨架屏与流式渲染入口', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    assert.ok(js.includes('renderBookshelfSkeleton'));
    assert.ok(js.includes('streamRenderBookCard'));
  });

  test.it('home.html 首页脚本使用裸路径并保持加载顺序', () => {
    const html = fs.readFileSync('src/home/home.html', 'utf8');
    const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map((match) => match[1]);

    assert.deepEqual(scripts, [
      '../utils/db-gateway.js',
      '../utils/utils.js',
      '../utils/storage.js',
      'home.js',
    ]);
    assert.ok(scripts.every((src) => !src.includes('?')), '首页本地脚本不应使用手动查询串刷新缓存');
  });

  test.it('书架流式渲染按 recentBooks 顺序替换对应骨架', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    assert.ok(js.includes('renderBookshelfSkeleton(books.length)'), '应为每本书创建稳定占位');
    assert.ok(js.includes('streamRenderBookCard(book, index, renderSeq)'), '渲染任务应携带原始顺序索引与刷新代次');
    assert.ok(js.includes('data-skeleton-index'), '骨架应标记顺序索引');
    assert.ok(js.includes('replaceWith(card)'), '书籍卡片应替换对应骨架，而不是按完成时间追加');
  });

  test.it('书架异步刷新返回过期时不得回写 DOM', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');

    assert.ok(js.includes('let bookshelfRenderSeq = 0'), '书架刷新应有代次令牌');
    assert.ok(js.includes('const renderSeq = ++bookshelfRenderSeq'), '每轮书架刷新应递增代次');
    assert.ok(js.includes('if (renderSeq !== bookshelfRenderSeq) return'), '过期书架刷新应退出');
    assert.ok(js.includes('async function streamRenderBookCard(book, index, renderSeq)'), '流式卡片渲染应接收所属代次');
  });

  test.it('标注异步刷新返回过期时不得回写 DOM', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');

    assert.ok(js.includes('let annotationsRenderSeq = 0'), '标注刷新应有代次令牌');
    assert.ok(js.includes('const renderSeq = ++annotationsRenderSeq'), '每轮标注刷新应递增代次');
    assert.ok(js.includes('if (renderSeq !== annotationsRenderSeq) return'), '过期标注刷新应退出');
  });

  test.it('C-9: home.js 无 style.* 运行时直写', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    assert.ok(!js.includes('style.display'));
    assert.ok(!js.includes('style.cursor'));
  });

  test.it('书架进度进入文本和 CSS 前必须归一化', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    assert.ok(js.includes('Utils.normalizePercent'), 'home.js 应归一化 storage 中的阅读进度');
    assert.ok(js.includes('const percentText = percent.toFixed(1)'), '展示文本应基于归一化后的数字格式化');
    assert.ok(js.includes('--progress-width: ${percent}%'), 'CSS 进度宽度只能使用归一化后的 percent');
  });

  test.it('书架书名和作者不得插入 innerHTML 模板属性上下文', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    const templateStart = js.indexOf('card.innerHTML = `');
    assert.ok(templateStart !== -1, '书籍卡片模板应存在');
    const templateEnd = js.indexOf('`;', templateStart);
    const cardTemplate = js.slice(templateStart, templateEnd);

    assert.ok(!/book\.(title|filename|author)/.test(cardTemplate), '书籍元数据不得出现在卡片 innerHTML 模板中');
    assert.ok(!cardTemplate.includes('Utils.escapeHtml(book.'), '不得用 escapeHtml 拼接书籍元数据属性');
    assert.ok(js.includes('titleEl.textContent = bookLabel'), '书名正文应通过 textContent 写入');
    assert.ok(js.includes('titleEl.title = bookLabel'), '书名 title 应通过 DOM 属性写入');
    assert.ok(js.includes('authorEl.textContent = bookAuthor'), '作者应通过 textContent 写入');
  });

  test.it('标注颜色不得通过拼接 hex alpha 构造背景色', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');

    assert.ok(js.includes('function resolveAnnotationColor'), '首页应集中归一化标注颜色');
    assert.ok(js.includes("safeColor !== 'transparent' ? safeColor : '#ffeb3b'"), '损坏或透明高亮颜色应回退默认高亮色');
    assert.ok(js.includes('color-mix(in srgb, ${annotationColor} 20%, transparent)'), '标注 badge 背景应使用有效 CSS 混色');
    assert.ok(!js.includes('Utils.sanitizeColor(hl.color)}33'), '不得直接给 sanitizeColor 结果拼接 alpha 后缀');
    assert.ok(!js.includes('${annotationColor}33'), '不得给任意 hex 颜色拼接 alpha 后缀');
  });

  test.it('首页偏好保存失败不应产生未处理 Promise 拒绝', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    const savePreferenceCallCount = (js.match(/EpubStorage\.savePreferences/g) || []).length;

    assert.equal(savePreferenceCallCount, 1, '偏好保存应统一经过 savePreferencesSafely');
    assert.ok(js.includes('function savePreferencesSafely'), '应有首页偏好安全保存辅助函数');
    assert.ok(js.includes('.catch((err) =>'), '偏好保存失败应被 catch');
    assert.ok(js.includes("console.warn('[Home] save preferences failed:'"), '失败应记录首页上下文告警');
    assert.ok(js.includes('savePreferencesSafely({ theme: currentTheme })'), '主题保存应走安全保存');
    assert.ok(js.includes('savePreferencesSafely({ homeView: currentView })'), '视图保存应走安全保存');
  });

  test.it('首页初始化与异步刷新路径应有错误隔离', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');

    assert.ok(js.includes("console.warn('[Home] get preferences failed:'"), '偏好读取失败不应中断首页初始化');
    assert.ok(js.includes('await loadBookshelfSafely()'), '初始化书架加载应走安全刷新');
    assert.ok(js.includes("await loadAnnotationsSafely('all')"), '初始化标注加载应走安全刷新');
    assert.ok(js.includes('function loadBookshelfSafely'), '应有书架安全刷新辅助函数');
    assert.ok(js.includes('function loadAnnotationsSafely'), '应有标注安全刷新辅助函数');
    assert.ok(js.includes('loadAnnotationsSafely(btn.dataset.filter)'), '筛选标注应走安全刷新');
    assert.ok(js.includes("console.warn('[Home] remove book failed:'"), '删除书籍失败应被捕获');
    assert.ok(js.includes("console.warn('[Home] clear bookshelf failed:'"), '清空书架失败应被捕获');
    assert.ok(js.includes("console.warn('[Home] remove annotation failed:'"), '删除标注失败应被捕获');
    assert.ok(js.includes("console.warn('[Home] export annotations failed:'"), '导出失败应被捕获');
  });

  test.it('书架单本封面与元数据读取失败只降级当前卡片', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');

    assert.ok(js.includes('async function loadBookCardData(book)'), '单本卡片数据读取应集中在辅助函数中');
    assert.ok(js.includes('EpubStorage.getCover(book.id).catch((err) =>'), '封面读取失败应局部捕获');
    assert.ok(js.includes("console.warn('[Home] get cover failed:'"), '封面读取失败应带首页上下文告警');
    assert.ok(js.includes('EpubStorage.getBookMeta(book.id).catch((err) =>'), 'bookMeta 读取失败应局部捕获');
    assert.ok(js.includes("console.warn('[Home] get book meta failed:'"), 'bookMeta 读取失败应带首页上下文告警');
    assert.ok(js.includes('const { coverBlob, meta } = await loadBookCardData(book);'), '卡片渲染应使用降级后的数据');
  });

  test.it('删除书籍成功或失败后都按权威 recentBooks 刷新书架', () => {
    const js = fs.readFileSync('src/home/home.js', 'utf8');
    const refreshFinallyCount = (js.match(/finally \{\s*await loadBookshelfSafely\(\);/g) || []).length;

    assert.equal(refreshFinallyCount, 2, '单本删除和清空书架都应在 finally 中刷新');
    assert.ok(js.includes('Promise.allSettled(books.map(b => EpubStorage.removeBook(b.id)))'), '清空书架应等待所有删除任务收口');
    assert.ok(!js.includes('card.remove();'), '单本删除不应维护独立 DOM 真相源');
  });

});
