/**
 * test/suites/ui/ui_popup_interaction.test.js
 * 
 * 包含 Popup 弹出页 (popup.js) 的真实 UI 交互行为测试
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createMockDocument } = require('../../helpers/browser_env.js');

function loadPopupInSandbox({ mockStorage = {}, mockChrome = {}, initialConfirm = true } = {}) {
  const elementIds = [
    'open-btn', 'home-btn', 'file-input', 'recent-list', 'empty-state'
  ];
  const { document, elements } = createMockDocument(elementIds);

  const openBtn = elements.get('open-btn');
  const homeBtn = elements.get('home-btn');
  const fileInput = elements.get('file-input');
  const recentList = elements.get('recent-list');
  const emptyState = elements.get('empty-state');

  // 构建默认 chrome mock
  const createdTabs = [];
  let windowClosed = false;
  const chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://mock-id/${path}`,
      ...mockChrome.runtime
    },
    tabs: {
      create: (opts) => {
        createdTabs.push(opts);
        return Promise.resolve({ id: 1, ...opts });
      },
      ...mockChrome.tabs
    }
  };

  const defaultStorage = {
    async getRecentBooks() { return []; },
    async getBookMetaBatch() { return {}; },
    async getCover() { return null; },
    async importBookFile() { return { bookId: 'test-book-id' }; },
    async removeBook() {},
    ...mockStorage
  };

  const windowMock = {
    document,
    chrome,
    EpubStorage: defaultStorage,
    Utils: {
      formatDate: (ts) => (ts ? '刚刚' : ''),
      normalizePercent: (p) => (Number.isFinite(p) ? p : 0)
    },
    URL: {
      createObjectURL: () => 'blob:mock-cover',
      revokeObjectURL: () => {}
    },
    confirm: () => initialConfirm,
    alert: () => {},
    close: () => { windowClosed = true; },
    addEventListener(type, handler) {
      document.addEventListener(type, handler);
    }
  };

  const popupCode = fs.readFileSync('src/popup/popup.js', 'utf8');
  const context = vm.createContext({
    ...windowMock,
    window: windowMock,
    global: windowMock,
    console
  });

  // 执行 popup.js 脚本
  vm.runInContext(popupCode, context, { filename: 'src/popup/popup.js' });

  return {
    document,
    elements,
    openBtn,
    homeBtn,
    fileInput,
    recentList,
    emptyState,
    createdTabs,
    getWindowClosed: () => windowClosed,
    dispatchReady: async () => {
      document.dispatchEvent('DOMContentLoaded');
      // 等待宏任务与微任务队列结算
      await new Promise((r) => setTimeout(r, 10));
    }
  };
}

test.describe('Popup 弹出页 UI 交互行为测试', () => {

  test.it('点击 openBtn 同步触发 fileInput.click', async () => {
    let fileInputClicked = false;
    const { openBtn, fileInput, dispatchReady } = loadPopupInSandbox();
    fileInput.click = () => { fileInputClicked = true; };

    await dispatchReady();
    assert.equal(fileInputClicked, false);

    openBtn.click();
    assert.equal(fileInputClicked, true, 'openBtn 点击必须同步触发 fileInput.click()');
  });

  test.it('fileInput 选择文件后触发 importBookFile 并打开 reader 页面', async () => {
    let importedFile = null;
    const mockStorage = {
      async importBookFile(file) {
        importedFile = file;
        return { bookId: 'imported-book-123' };
      }
    };
    const { fileInput, createdTabs, getWindowClosed, dispatchReady } = loadPopupInSandbox({ mockStorage });

    await dispatchReady();

    const dummyFile = { name: 'test.epub', size: 1024 };
    fileInput.files = [dummyFile];
    fileInput.dispatch('change', { target: fileInput });

    // 等待异步 _processFile 执行完毕
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(importedFile, dummyFile, '应将选中的文件提交给 EpubStorage.importBookFile');
    assert.equal(createdTabs.length, 1, '应调用 chrome.tabs.create 打开标签页');
    assert.ok(createdTabs[0].url.includes('reader/reader.html?bookId=imported-book-123'));
    assert.equal(getWindowClosed(), true, '导入完成后应调用 window.close()');
  });

  test.it('点击 homeBtn 触发 chrome.tabs.create 打开书架页并关闭弹窗', async () => {
    const { homeBtn, createdTabs, getWindowClosed, dispatchReady } = loadPopupInSandbox();

    await dispatchReady();
    homeBtn.click();

    assert.equal(createdTabs.length, 1);
    assert.ok(createdTabs[0].url.includes('home/home.html'));
    assert.equal(getWindowClosed(), true);
  });

  test.it('最近书籍为空时正确展示 emptyState', async () => {
    const mockStorage = {
      async getRecentBooks() { return []; }
    };
    const { emptyState, dispatchReady } = loadPopupInSandbox({ mockStorage });

    await dispatchReady();

    assert.equal(emptyState.style.display, 'block', '无书籍时 emptyState 应设为 block');
  });

  test.it('最近书籍有内容时渲染书籍卡片，点击卡片打开 reader', async () => {
    const mockStorage = {
      async getRecentBooks() {
        return [
          { id: 'book-a', title: '百年孤独', author: '马尔克斯', lastOpened: Date.now() }
        ];
      },
      async getBookMetaBatch() {
        return {
          'book-a': { pos: { percentage: 42.5 } }
        };
      }
    };
    const { recentList, emptyState, createdTabs, getWindowClosed, dispatchReady } = loadPopupInSandbox({ mockStorage });

    await dispatchReady();

    assert.equal(emptyState.style.display, 'none', '有书籍时 emptyState 应隐藏');

    const item = recentList.querySelector('.recent-item');
    assert.ok(item, '应渲染出 .recent-item 卡片');
    assert.ok(item.textContent.includes('百年孤独'));
    assert.ok(item.textContent.includes('马尔克斯'));
    assert.ok(item.textContent.includes('42.5%'));

    // 点击卡片主体
    item.click();
    assert.equal(createdTabs.length, 1);
    assert.ok(createdTabs[0].url.includes('reader/reader.html?bookId=book-a'));
    assert.equal(getWindowClosed(), true);
  });

  test.it('点击书籍移除按钮阻止冒泡并触发 removeBook 与列表刷新', async () => {
    let removedBookId = null;
    let books = [
      { id: 'book-del', title: '待删除书籍', author: '测试作者', lastOpened: Date.now() }
    ];
    const mockStorage = {
      async getRecentBooks() {
        return [...books];
      },
      async getBookMetaBatch() { return {}; },
      async removeBook(id) {
        removedBookId = id;
        books = [];
      }
    };
    const { recentList, emptyState, createdTabs, dispatchReady } = loadPopupInSandbox({
      mockStorage,
      initialConfirm: true
    });

    await dispatchReady();

    const removeBtn = recentList.querySelector('.recent-item-remove');
    assert.ok(removeBtn, '卡片应包含 .recent-item-remove 按钮');

    // 点击删除按钮
    removeBtn.click();
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(removedBookId, 'book-del', '确认删除应调用 EpubStorage.removeBook(id)');
    assert.equal(createdTabs.length, 0, '删除操作阻止冒泡，不得误触发卡片打开 reader');
    assert.equal(emptyState.style.display, 'block', '删除最后单本后应刷新并展示空状态');
  });

});
