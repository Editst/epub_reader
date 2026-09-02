/**
 * test/suites/ui/ui_home_interaction.test.js
 * 
 * 包含 Home 书架页 (home.js) 的真实 UI 交互行为测试
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createMockDocument, createMockElement } = require('../../helpers/browser_env.js');

function loadHomeInSandbox({ mockStorage = {}, mockPrefs = {} } = {}) {
  const elementIds = [
    'btn-theme', 'btn-view', 'btn-upload', 'file-input', 'btn-clear-all',
    'books-container', 'shelf-empty', 'book-count',
    'annotations-container', 'annotations-empty', 'drag-overlay', 'btn-sort-time'
  ];
  const { document, elements } = createMockDocument(elementIds);

  const btnTheme = elements.get('btn-theme');
  const btnView = elements.get('btn-view');
  const btnUpload = elements.get('btn-upload');
  const fileInput = elements.get('file-input');
  const btnClearAll = elements.get('btn-clear-all');
  const booksContainer = elements.get('books-container');
  const shelfEmpty = elements.get('shelf-empty');
  const bookCount = elements.get('book-count');
  const annotationsContainer = elements.get('annotations-container');
  const annotationsEmpty = elements.get('annotations-empty');
  const dragOverlay = elements.get('drag-overlay');
  dragOverlay.classList.add('is-hidden');
  const btnSortTime = elements.get('btn-sort-time');

  // 构建导航 tab 与 pane
  const tabBooks = createMockElement('tab-books', 'BUTTON');
  tabBooks.classList.add('nav-btn', 'active');
  tabBooks.setAttribute('data-tab', 'books');
  const tabAnnotations = createMockElement('tab-annotations', 'BUTTON');
  tabAnnotations.classList.add('nav-btn');
  tabAnnotations.setAttribute('data-tab', 'annotations');

  const paneBooks = createMockElement('pane-books', 'DIV');
  paneBooks.classList.add('tab-pane', 'active');
  paneBooks.id = 'pane-books';
  const paneAnnotations = createMockElement('pane-annotations', 'DIV');
  paneAnnotations.classList.add('tab-pane');
  paneAnnotations.id = 'pane-annotations';

  // 构建筛选按钮
  const filterAll = createMockElement('filter-all', 'BUTTON');
  filterAll.classList.add('filter-btn', 'active');
  filterAll.setAttribute('data-filter', 'all');

  const filterHighlight = createMockElement('filter-highlight', 'BUTTON');
  filterHighlight.classList.add('filter-btn');
  filterHighlight.setAttribute('data-filter', 'highlight');

  const filterNote = createMockElement('filter-note', 'BUTTON');
  filterNote.classList.add('filter-btn');
  filterNote.setAttribute('data-filter', 'note');

  document.body.append(
    tabBooks, tabAnnotations,
    paneBooks, paneAnnotations,
    filterAll, filterHighlight, filterNote
  );

  const savedPreferences = [];
  const defaultStorage = {
    async getPreferences() {
      return { theme: 'light', homeView: 'grid', ...mockPrefs };
    },
    async savePreferences(p) {
      savedPreferences.push(p);
    },
    async getRecentBooks() { return []; },
    async getBookMeta() { return null; },
    async getCover() { return null; },
    async getAllHighlights() { return {}; },
    async importBookFile() { return { bookId: 'mock-book-1' }; },
    async removeBook() {},
    ...mockStorage
  };

  const windowMock = {
    document,
    EpubStorage: defaultStorage,
    Utils: {
      formatDate: (ts) => (ts ? '2026-09-03' : ''),
      formatDateTime: (ts) => (ts ? '2026-09-03 01:00' : ''),
      normalizePercent: (p) => (Number.isFinite(p) ? p : 0),
      estimateReadingSpeed: () => ({ unitsPerMinute: null, isEstimating: true }),
      resolveDisplayColor: (c) => c || '#ffeb3b',
      releaseElementCoverUrl: () => {}
    },
    URL: {
      createObjectURL: () => 'blob:mock-cover',
      revokeObjectURL: () => {}
    },
    location: { href: '' },
    chrome: {
      runtime: {
        getURL: (p) => `chrome-extension://mock-id/${p}`
      }
    },
    confirm: () => true,
    alert: () => {},
    addEventListener(type, handler) {
      document.addEventListener(type, handler);
    }
  };

  const homeCode = fs.readFileSync('src/home/home.js', 'utf8');
  const context = vm.createContext({
    ...windowMock,
    window: windowMock,
    global: windowMock,
    console
  });

  vm.runInContext(homeCode, context, { filename: 'src/home/home.js' });

  return {
    document,
    elements,
    btnTheme,
    btnView,
    btnUpload,
    fileInput,
    booksContainer,
    dragOverlay,
    filterBtns: { filterAll, filterHighlight, filterNote },
    btnSortTime,
    savedPreferences,
    windowMock,
    dispatchReady: async () => {
      document.dispatchEvent('DOMContentLoaded');
      await new Promise((r) => setTimeout(r, 20));
    }
  };
}

test.describe('Home 书架页 UI 交互行为测试', () => {

  test.it('点击 btnTheme 切换主题并在 light/dark 之间切换且持久化偏好', async () => {
    const { document, btnTheme, savedPreferences, dispatchReady } = loadHomeInSandbox({
      mockPrefs: { theme: 'light' }
    });

    await dispatchReady();
    assert.equal(document.documentElement.attrs['data-theme'], 'light');

    // 点击切换为 dark
    btnTheme.click();
    assert.equal(document.documentElement.attrs['data-theme'], 'dark');
    assert.equal(savedPreferences[savedPreferences.length - 1]?.theme, 'dark');

    // 再次点击切回 light
    btnTheme.click();
    assert.equal(document.documentElement.attrs['data-theme'], 'light');
    assert.equal(savedPreferences[savedPreferences.length - 1]?.theme, 'light');
  });

  test.it('点击 btnView 切换网格与列表视图并持久化偏好', async () => {
    const { booksContainer, btnView, savedPreferences, dispatchReady } = loadHomeInSandbox({
      mockPrefs: { homeView: 'grid' }
    });

    await dispatchReady();
    assert.equal(booksContainer.classList.contains('list-view'), false, '默认网格视图无 list-view 类');

    // 点击切换为 list
    btnView.click();
    assert.equal(booksContainer.classList.contains('list-view'), true, '切换列表视图应添加 list-view 类');
    assert.equal(savedPreferences[savedPreferences.length - 1]?.homeView, 'list');

    // 再次点击切换为 grid
    btnView.click();
    assert.equal(booksContainer.classList.contains('list-view'), false, '切回网格视图应移除 list-view 类');
    assert.equal(savedPreferences[savedPreferences.length - 1]?.homeView, 'grid');
  });

  test.it('点击标注筛选按钮切换激活状态与过滤参数', async () => {
    let capturedFilter = null;
    const { filterBtns, dispatchReady } = loadHomeInSandbox();

    await dispatchReady();

    // 点击笔记筛选按钮
    filterBtns.filterNote.click();
    await new Promise((r) => setTimeout(r, 10));

    assert.ok(!filterBtns.filterAll.classList.contains('active'), '旧按钮应移除 active');
    assert.ok(filterBtns.filterNote.classList.contains('active'), '当前按钮应添加 active');

    // 点击高亮筛选按钮
    filterBtns.filterHighlight.click();
    await new Promise((r) => setTimeout(r, 10));

    assert.ok(!filterBtns.filterNote.classList.contains('active'), '旧按钮应移除 active');
    assert.ok(filterBtns.filterHighlight.classList.contains('active'), '当前按钮应添加 active');
  });

  test.it('点击时间排序按钮切换升序与降序文案', async () => {
    const { btnSortTime, dispatchReady } = loadHomeInSandbox();

    await dispatchReady();

    // 初始降序，点击切换为升序
    btnSortTime.click();
    assert.equal(btnSortTime.textContent, '⬆️ 最早时间');

    // 再次点击切回降序
    btnSortTime.click();
    assert.equal(btnSortTime.textContent, '⬇️ 最新时间');
  });

  test.it('全局拖放交互：dragover 显示遮罩，dragleave 隐藏，drop 触发导入', async () => {
    let importedFile = null;
    const mockStorage = {
      async importBookFile(file) {
        importedFile = file;
        return { bookId: 'drag-imported-book' };
      }
    };
    const { document, dragOverlay, dispatchReady } = loadHomeInSandbox({ mockStorage });

    await dispatchReady();
    assert.ok(dragOverlay.classList.contains('is-hidden'), '初始状态遮罩应隐藏');

    // 1. 拖入：dragover
    document.dispatchEvent('dragover', {
      preventDefault() {},
      dataTransfer: { types: ['Files'] }
    });
    assert.ok(!dragOverlay.classList.contains('is-hidden'), 'dragover 应显示遮罩');

    // 2. 移出：dragleave (光标移出窗口边界)
    document.dispatchEvent('dragleave', {
      relatedTarget: null
    });
    assert.ok(dragOverlay.classList.contains('is-hidden'), 'dragleave 应隐藏遮罩');

    // 3. 释放文件：drop
    const dropFile = { name: 'dropped.epub', size: 2048 };
    document.dispatchEvent('drop', {
      preventDefault() {},
      dataTransfer: {
        files: [dropFile]
      }
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.ok(dragOverlay.classList.contains('is-hidden'), 'drop 后遮罩必须重新隐藏');
    assert.equal(importedFile, dropFile, 'drop 事件应将文件送交 EpubStorage.importBookFile');
  });

});
