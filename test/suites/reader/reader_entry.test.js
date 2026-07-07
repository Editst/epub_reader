'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test.describe('Reader 入口与装配契约', () => {
  test.it('reader.js 保持为轻量编排层，并显式装配四层依赖', () => {
    const src = fs.readFileSync('src/reader/reader.js', 'utf8');
    const lines = src.trimEnd().split('\n').length;

    assert.ok(lines < 120, `reader.js line count=${lines}`);
    assert.ok(src.includes('ReaderState.createReaderState'));
    assert.ok(src.includes('ReaderUi.createReaderUi'));
    assert.ok(src.includes('ReaderPersistence.createReaderPersistence'));
    assert.ok(src.includes('ReaderRuntime.createReaderRuntime'));
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
  });

  test.it('reader.html 本地脚本使用裸路径并保持加载顺序', () => {
    const html = fs.readFileSync('src/reader/reader.html', 'utf8');
    const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map((match) => match[1]);
    const localScripts = scripts.filter((src) => !src.startsWith('../lib/'));

    assert.deepEqual(localScripts, [
      '../utils/db-gateway.js',
      '../utils/utils.js',
      '../utils/storage.js',
      'image-viewer.js',
      'annotations.js',
      'toc.js',
      'search.js',
      'bookmarks.js',
      'highlights.js',
      'reader-state.js',
      'reader-ui.js',
      'reader-persistence.js',
      'reader-runtime.js',
      'reader.js',
    ]);
    assert.ok(localScripts.every((src) => !src.includes('?')), '本地脚本不应使用手动查询串刷新缓存');
  });
});
