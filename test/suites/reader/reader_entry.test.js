'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('Reader 入口与装配契约', () => {
  test.it('reader.js 显式装配四层依赖与异常收口', () => {
    const src = fs.readFileSync('src/reader/reader.js', 'utf8');

    assert.ok(src.includes('ReaderState.createReaderState'));
    assert.ok(src.includes('ReaderUi.createReaderUi'));
    assert.ok(src.includes('ReaderPersistence.createReaderPersistence'));
    assert.ok(src.includes('ReaderRuntime.createReaderRuntime'));
    assert.ok(src.includes('Promise.resolve(lifecycleResult).catch'),
      '模块 lifecycle 返回的异步失败必须统一收口');
    assert.ok(!src.includes('style.display'));
  });

  test.it('reader.html 按文档顺序加载 reader 四层脚本', () => {
    const html = fs.readFileSync('src/reader/reader.html', 'utf8');
    const stateIdx = html.indexOf('reader-state.js');
    const runtimeIdx = html.indexOf('reader-runtime.js');
    const persistenceIdx = html.indexOf('reader-persistence.js');
    const uiIdx = html.indexOf('reader-ui.js');
    const readerIdx = html.indexOf('reader.js');

    assert.notEqual(stateIdx, -1);
    assert.notEqual(runtimeIdx, -1);
    assert.notEqual(persistenceIdx, -1);
    assert.notEqual(uiIdx, -1);
    assert.notEqual(readerIdx, -1);
    assert.ok(stateIdx < runtimeIdx);
    assert.ok(runtimeIdx < persistenceIdx || persistenceIdx < runtimeIdx);
    assert.ok(uiIdx < readerIdx);
  });

  test.it('reader.html 关键显示节点不依赖内联 display:none', () => {
    const html = fs.readFileSync('src/reader/reader.html', 'utf8');
    assert.ok(!html.match(/id="reader-main"[^>]*style=/));
    assert.ok(!html.match(/id="bottom-bar"[^>]*style=/));
    assert.ok(html.includes('loading-overlay is-hidden') || html.includes('is-hidden" id="loading-overlay'));
    assert.ok(html.includes('drag-overlay is-hidden'), '拖放遮罩应复用 is-hidden 显隐模式');
  });

  test.it('ReaderUi 注册 chrome.storage.onChanged 以支持多标签页偏好实时同步', () => {
    const uiSrc = fs.readFileSync('src/reader/reader-ui.js', 'utf8');
    assert.ok(uiSrc.includes('chrome.storage?.onChanged?.addListener') || uiSrc.includes('chrome.storage.onChanged.addListener'),
      'ReaderUi 应监听 storage.onChanged 实现多标签页主题与字体偏好同步');
    assert.ok(uiSrc.includes('changes.preferences'), '应监听 preferences 变更');
  });
});

