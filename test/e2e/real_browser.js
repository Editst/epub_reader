#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const DEFAULT_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 150;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index++;
    }
  }
  return options;
}

function printUsage() {
  console.log(`用法：
  node test/e2e/real_browser.js \\
    --chrome /path/to/chrome \\
    --chromedriver /path/to/chromedriver \\
    --epub /path/to/book.epub

也可使用 CHROME_BINARY、CHROMEDRIVER、EPUB_PATH 环境变量。
可选参数：--extension /path/to/src；--keep 保留临时 profile、日志和失败截图。`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, message, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_INTERVAL_MS);
  }
  const suffix = lastError ? `: ${lastError.message}` : '';
  throw new Error(`${message}${suffix}`);
}

class WebDriver {
  constructor(port) {
    this.origin = `http://127.0.0.1:${port}`;
    this.sessionId = null;
  }

  async request(method, endpoint, body) {
    const response = await fetch(this.origin + endpoint, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || (payload.value && payload.value.error)) {
      const detail = payload.value && (payload.value.message || payload.value.error);
      throw new Error(`${method} ${endpoint} failed: ${detail || response.status}`);
    }
    return payload.value;
  }

  async createSession({ chromeBinary, extensionDir, profileDir, loadExtension = true }) {
    const chromeArgs = [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--no-first-run',
      '--window-size=1280,900',
      `--user-data-dir=${profileDir}`
    ];
    if (loadExtension) {
      chromeArgs.push(
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`
      );
    }
    const value = await this.request('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          browserName: 'chrome',
          'goog:loggingPrefs': { browser: 'ALL' },
          'goog:chromeOptions': {
            binary: chromeBinary,
            args: chromeArgs
          }
        }
      }
    });
    this.sessionId = value.sessionId;
    return value.capabilities;
  }

  async quit() {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = null;
    try {
      await this.request('DELETE', `/session/${sessionId}`);
    } catch (_) {
      // Chrome may already have exited after a failed assertion.
    }
  }

  endpoint(suffix) {
    assert.ok(this.sessionId, 'WebDriver session is not active');
    return `/session/${this.sessionId}${suffix}`;
  }

  navigate(url) {
    return this.request('POST', this.endpoint('/url'), { url });
  }

  evaluate(script, args = []) {
    return this.request('POST', this.endpoint('/execute/sync'), { script, args });
  }

  evaluateAsync(script, args = []) {
    return this.request('POST', this.endpoint('/execute/async'), { script, args });
  }

  async find(css) {
    const value = await this.request('POST', this.endpoint('/element'), {
      using: 'css selector',
      value: css
    });
    return value[ELEMENT_KEY];
  }

  click(elementId) {
    return this.request('POST', this.endpoint(`/element/${elementId}/click`), {});
  }

  sendFile(elementId, filePath) {
    return this.request('POST', this.endpoint(`/element/${elementId}/value`), {
      text: filePath,
      value: [filePath]
    });
  }

  setWindowRect(width, height) {
    return this.request('POST', this.endpoint('/window/rect'), { width, height });
  }

  currentWindowHandle() {
    return this.request('GET', this.endpoint('/window'));
  }

  newWindow(type = 'tab') {
    return this.request('POST', this.endpoint('/window/new'), { type });
  }

  switchToWindow(handle) {
    return this.request('POST', this.endpoint('/window'), { handle });
  }

  closeWindow() {
    return this.request('DELETE', this.endpoint('/window'));
  }

  acceptAlert() {
    return this.request('POST', this.endpoint('/alert/accept'), {});
  }

  browserLogs() {
    return this.request('POST', this.endpoint('/se/log'), { type: 'browser' });
  }

  screenshot() {
    return this.request('GET', this.endpoint('/screenshot'));
  }
}

function startChromeDriver(binary, port, logPath) {
  const process = childProcess.spawn(binary, [
    `--port=${port}`,
    '--allowed-ips=127.0.0.1',
    `--log-path=${logPath}`
  ], {
    stdio: 'ignore'
  });
  return process;
}

async function createSessionWithStartupRetry(driver, options) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await driver.createSession(options);
    } catch (error) {
      lastError = error;
      if (!error.message.includes('unable to discover open window')) throw error;
      await delay(1200);
    }
  }
  throw lastError;
}

async function discoverExtensionId(driver) {
  await driver.navigate('chrome://extensions/');
  return waitFor(async () => {
    const items = await driver.evaluate(`
      const manager = document.querySelector('extensions-manager');
      const list = manager && manager.shadowRoot.querySelector('extensions-item-list');
      if (!list) return [];
      return [...list.shadowRoot.querySelectorAll('extensions-item')].map((item) => ({
        id: item.id,
        name: item.shadowRoot.querySelector('#name')?.textContent?.trim() || ''
      }));
    `);
    const extension = items.find((item) => item.name === 'EPUB Reader');
    return extension && extension.id;
  }, '未在 chrome://extensions 中发现 EPUB Reader');
}

async function getRecentBooks(driver) {
  return driver.evaluateAsync(`
    const done = arguments[arguments.length - 1];
    EpubStorage.getRecentBooks().then(done, (error) => done({ __error: String(error) }));
  `);
}

async function getPosition(driver, bookId) {
  return driver.evaluateAsync(`
    const bookId = arguments[0];
    const done = arguments[arguments.length - 1];
    EpubStorage.getPosition(bookId).then(done, (error) => done({ __error: String(error) }));
  `, [bookId]);
}

async function getBookMeta(driver, bookId) {
  return driver.evaluateAsync(`
    const bookId = arguments[0];
    const done = arguments[arguments.length - 1];
    EpubStorage.getBookMeta(bookId).then(done, (error) => done({ __error: String(error) }));
  `, [bookId]);
}

async function getLocations(driver, bookId) {
  return driver.evaluateAsync(`
    const bookId = arguments[0];
    const done = arguments[arguments.length - 1];
    EpubStorage.getLocations(bookId).then(done, (error) => done({ __error: String(error) }));
  `, [bookId]);
}

async function getBookmarks(driver, bookId) {
  return driver.evaluateAsync(`
    const bookId = arguments[0];
    const done = arguments[arguments.length - 1];
    EpubStorage.getBookmarks(bookId).then(done, (error) => done({ __error: String(error) }));
  `, [bookId]);
}

async function emulateDocumentVisibility(driver, hidden) {
  return driver.evaluate(`
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: arguments[0]
    });
    document.dispatchEvent(new Event('visibilitychange'));
    return document.hidden;
  `, [hidden]);
}

async function waitForBookLoaded(driver, expectedTitle) {
  return waitFor(async () => driver.evaluate(`
    const iframe = document.querySelector('#epub-viewer iframe');
    const title = document.querySelector('#book-title')?.textContent?.trim() || '';
    const body = iframe?.contentDocument?.body;
    const loadingHidden = document.querySelector('#loading-overlay')?.classList.contains('is-hidden');
    return { title, iframeReady: !!body && body.childElementCount > 0, loadingHidden };
  `).then((status) => (
    status.iframeReady && status.loadingHidden && (!expectedTitle || status.title === expectedTitle)
      ? status
      : null
  )), 'EPUB 正文未在真实 iframe 中完成渲染', 45000);
}

async function visibleFingerprint(driver) {
  return driver.evaluate(`
    const samples = [];
    const addSample = (node, offset) => {
      if (!node) return;
      const textNode = node.nodeType === Node.TEXT_NODE
        ? node
        : [...node.childNodes].find((child) => child.nodeType === Node.TEXT_NODE);
      const text = textNode?.data?.replace(/\\s+/g, ' ').trim();
      if (!text) return;
      const safeOffset = Math.max(0, Math.min(Number(offset) || 0, text.length));
      const sample = text.slice(Math.max(0, safeOffset - 50), safeOffset + 90).trim();
      if (sample && !samples.includes(sample)) samples.push(sample);
    };

    for (const iframe of document.querySelectorAll('#epub-viewer iframe')) {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win) continue;
      const container = iframe.closest('.epub-container') || iframe.parentElement?.parentElement;
      const viewportLeft = container?.scrollLeft || Math.max(0, -iframe.getBoundingClientRect().left);
      const viewportWidth = container?.clientWidth || iframe.getBoundingClientRect().width || win.innerWidth;
      const xs = [0.18, 0.38, 0.62, 0.82]
        .map((ratio) => Math.round(viewportLeft + viewportWidth * ratio));
      const ys = [0.22, 0.48, 0.74].map((ratio) => Math.round(win.innerHeight * ratio));
      for (const y of ys) {
        for (const x of xs) {
          if (typeof doc.caretRangeFromPoint === 'function') {
            const range = doc.caretRangeFromPoint(x, y);
            addSample(range?.startContainer, range?.startOffset);
          } else if (typeof doc.caretPositionFromPoint === 'function') {
            const position = doc.caretPositionFromPoint(x, y);
            addSample(position?.offsetNode, position?.offset);
          }
        }
      }
    }
    return samples;
  `);
}

async function getRenderGeometry(driver) {
  return driver.evaluate(`
    const iframe = document.querySelector('#epub-viewer iframe');
    const doc = iframe?.contentDocument;
    const describe = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        className: element.className || '',
        width: rect.width,
        left: rect.left,
        scrollLeft: element.scrollLeft,
        scrollWidth: element.scrollWidth,
        transform: style.transform,
        overflow: style.overflow
      };
    };
    return {
      iframe: describe(iframe),
      parent: describe(iframe?.parentElement),
      grandparent: describe(iframe?.parentElement?.parentElement),
      windowWidth: iframe?.contentWindow?.innerWidth || 0,
      documentWidth: doc?.documentElement?.scrollWidth || 0,
      bodyWidth: doc?.body?.scrollWidth || 0,
      bodyColumns: doc?.body ? {
        columnWidth: getComputedStyle(doc.body).columnWidth,
        columnGap: getComputedStyle(doc.body).columnGap
      } : null
    };
  `);
}

async function getCfiVisibility(driver, cfi) {
  return driver.evaluate(`
    const cfi = arguments[0];
    const results = [];
    if (!cfi || !window.ePub?.CFI) return { visible: false, results };
    for (const iframe of document.querySelectorAll('#epub-viewer iframe')) {
      const doc = iframe.contentDocument;
      const container = iframe.closest('.epub-container') || iframe.parentElement?.parentElement;
      if (!doc || !container) continue;
      try {
        const range = new ePub.CFI(cfi).toRange(doc);
        if (!range) continue;
        const rects = [...range.getClientRects()].map((rect) => ({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom
        }));
        const viewport = {
          left: container.scrollLeft,
          right: container.scrollLeft + container.clientWidth,
          top: 0,
          bottom: container.clientHeight
        };
        const visible = rects.some((rect) =>
          rect.right >= viewport.left && rect.left <= viewport.right &&
          rect.bottom >= viewport.top && rect.top <= viewport.bottom
        );
        results.push({ visible, rects, viewport });
        if (visible) return { visible: true, results };
      } catch (error) {
        results.push({ visible: false, error: String(error) });
      }
    }
    return { visible: false, results };
  `, [cfi]);
}

function fingerprintSimilarity(first, second) {
  const tokens = (samples) => {
    const text = samples.join(' ').toLowerCase();
    const result = new Set(text
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3));
    const characters = Array.from(text.replace(/[^\p{L}\p{N}]+/gu, ''));
    for (let index = 0; index <= characters.length - 3; index++) {
      result.add(characters.slice(index, index + 3).join(''));
    }
    return result;
  };
  const left = tokens(first);
  const right = tokens(second);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap++;
  return overlap / Math.min(left.size, right.size);
}

async function saveScreenshot(driver, outputPath) {
  if (!driver.sessionId) return;
  try {
    const data = await driver.screenshot();
    fs.writeFileSync(outputPath, Buffer.from(data, 'base64'));
  } catch (_) {
    // Preserve the original test error when screenshot capture also fails.
  }
}

async function configureDeterministicPreferences(driver) {
  await driver.evaluateAsync(`
    const done = arguments[arguments.length - 1];
    EpubStorage.savePreferences({
      layout: 'paginated',
      spread: 'none',
      fontSize: 32,
      lineHeight: 3,
      fontFamily: ''
    }).then(() => done(true), (error) => done({ __error: String(error) }));
  `);
}

async function switchLayout(driver, layout) {
  await driver.evaluate(`
    const panel = document.getElementById('settings-panel');
    if (panel && !panel.classList.contains('open')) {
      document.getElementById('btn-settings')?.click();
    }
  `);
  await waitFor(() => driver.evaluate(`
    return document.getElementById('settings-panel')?.classList.contains('open');
  `), '设置面板未打开');
  await delay(350);
  const button = await driver.find(`.layout-btn[data-layout="${layout}"]`);
  await driver.click(button);
  const switched = await waitFor(() => driver.evaluateAsync(`
    const layout = arguments[0];
    const done = arguments[arguments.length - 1];
    EpubStorage.getPreferences().then((prefs) => {
      const active = document.querySelector('.layout-btn.active')?.dataset.layout;
      const iframeReady = !!document.querySelector('#epub-viewer iframe')?.contentDocument?.body;
      done(prefs.layout === layout && active === layout && iframeReady);
    }, () => done(false));
  `, [layout]), `布局未切换到 ${layout}`);
  await driver.evaluate(`document.getElementById('btn-settings-close')?.click();`);
  await waitFor(() => driver.evaluate(`
    return !document.getElementById('settings-panel')?.classList.contains('open');
  `), '设置面板未关闭');
  return switched;
}

async function getVisibleSearchQuery(driver) {
  return driver.evaluate(`
    const text = [...document.querySelectorAll('#epub-viewer iframe')]
      .map((iframe) => iframe.contentDocument?.body?.innerText || '')
      .join(' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const cjk = text.match(/[\\u3400-\\u9fff]{4,8}/);
    if (cjk) return cjk[0];
    const word = text.match(/[A-Za-z]{5,12}/);
    return word ? word[0] : '';
  `);
}

async function assertNoRuntimeErrors(driver, phase) {
  const logs = await driver.browserLogs();
  const severe = logs.filter((entry) => entry.level === 'SEVERE')
    .filter((entry) => !entry.message.includes('fonts.googleapis.com'));
  assert.deepEqual(severe, [], `${phase} 出现浏览器运行时错误`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const repoRoot = path.resolve(__dirname, '..', '..');
  const extensionDir = path.resolve(args.extension || path.join(repoRoot, 'src'));
  const chromeBinary = path.resolve(args.chrome || process.env.CHROME_BINARY || '');
  const driverBinary = path.resolve(args.chromedriver || process.env.CHROMEDRIVER || '');
  const epubPath = path.resolve(args.epub || process.env.EPUB_PATH || '');

  assert.ok(chromeBinary && fs.existsSync(chromeBinary), '请用 --chrome 或 CHROME_BINARY 指定 Chrome/Chromium');
  assert.ok(driverBinary && fs.existsSync(driverBinary), '请用 --chromedriver 或 CHROMEDRIVER 指定匹配的 ChromeDriver');
  assert.ok(epubPath && fs.existsSync(epubPath), '请用 --epub 或 EPUB_PATH 指定真实 EPUB 文件');
  assert.equal(path.extname(epubPath).toLowerCase(), '.epub', 'E2E 样本必须是 .epub 文件');

  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-reader-e2e-'));
  const profileDir = path.join(artifactsDir, 'profile');
  const driverLog = path.join(artifactsDir, 'chromedriver.log');
  const failureScreenshot = path.join(artifactsDir, 'failure.png');
  const port = 10240 + Math.floor(Math.random() * 20000);
  const driverProcess = startChromeDriver(driverBinary, port, driverLog);
  const driver = new WebDriver(port);
  let success = false;

  try {
    await waitFor(() => driver.request('GET', '/status').then((status) => status.ready), 'ChromeDriver 启动超时');

    const firstCapabilities = await createSessionWithStartupRetry(driver, {
      chromeBinary,
      extensionDir,
      profileDir
    });
    console.log(`Chrome ${firstCapabilities.browserVersion}`);
    const extensionId = await discoverExtensionId(driver);
    const readerUrl = `chrome-extension://${extensionId}/reader/reader.html`;
    console.log(`扩展 ${extensionId}`);

    await driver.navigate(readerUrl);
    await waitFor(() => driver.evaluate('return typeof EpubStorage !== "undefined";'), 'Reader 存储层未加载');
    await configureDeterministicPreferences(driver);
    await driver.navigate(readerUrl);
    await waitFor(() => driver.evaluate('return typeof EpubStorage !== "undefined";'), 'Reader 重载失败');

    const fileInput = await driver.find('#file-input');
    await driver.sendFile(fileInput, epubPath);
    const loaded = await waitForBookLoaded(driver);
    const recentBooks = await waitFor(async () => {
      const books = await getRecentBooks(driver);
      return Array.isArray(books) && books.length ? books : null;
    }, '导入后 recentBooks 未写入');
    const book = recentBooks[0];
    console.log(`已载入《${loaded.title}》 (${book.id.slice(0, 12)}…)`);

    await waitFor(() => getLocations(driver, book.id), '速度测试所需 locations 后台索引未就绪', 45000);
    await delay(300);

    const initialPosition = await waitFor(() => getPosition(driver, book.id), '初始位置未写入');
    const nextButton = await driver.find('#btn-next');
    await driver.evaluate(`
      const slider = document.getElementById('progress-slider');
      slider.value = '10';
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    const navigatedPosition = await waitFor(async () => {
      const position = await getPosition(driver, book.id);
      return position && position.cfi !== initialPosition.cfi ? position : null;
    }, '百分比导航后位置没有更新');
    await delay(350);
    await driver.evaluate(`
      window.__e2eRealDateNow = Date.now.bind(Date);
      const advancedNow = window.__e2eRealDateNow() + 300000;
      Date.now = () => advancedNow;
      return true;
    `);
    await driver.click(nextButton);
    const savedPosition = await waitFor(async () => {
      const position = await getPosition(driver, book.id);
      return position && position.cfi !== navigatedPosition.cfi ? position : null;
    }, '速度采样前的最终翻页位置没有更新');
    const beforeReopenFingerprint = await waitFor(async () => {
      const samples = await visibleFingerprint(driver);
      return samples.length ? samples : null;
    }, '无法采样重启前可见正文');

    assert.match(savedPosition.cfi, /^epubcfi\(/, '保存位置不是 EPUB CFI');
    assert.equal(savedPosition.locator?.strategy, 'epubjs-displayed-page-v1');
    assert.equal(savedPosition.locator?.layout, 'paginated');
    assert.equal(savedPosition.locator?.sourceCfi, savedPosition.cfi);
    assert.ok(savedPosition.locator?.href, 'locator 缺少章节 href');
    assert.ok(Number.isInteger(savedPosition.locator?.page), 'locator 缺少真实 displayed page');
    assert.ok(Number.isInteger(savedPosition.locator?.total), 'locator 缺少真实 displayed total');
    assert.match(savedPosition.locator?.restoreCfi || '', /^epubcfi\(/, '真实浏览器未生成页内 restoreCfi');
    const savedAnchorVisibility = await getCfiVisibility(driver, savedPosition.locator.restoreCfi);
    assert.equal(savedAnchorVisibility.visible, true, '保存的 restoreCfi 不在当前真实可视页');
    console.log(`已保存：page ${savedPosition.locator.page}/${savedPosition.locator.total}, ${savedPosition.cfi}`);
    await emulateDocumentVisibility(driver, true);
    await waitFor(async () => {
      const meta = await getBookMeta(driver, book.id);
      return meta?.speed?.sampledSeconds > 30 &&
        meta.speed.sampledProgress > 0.001 &&
        meta.speed.contentUnitVersion === 1 &&
        meta.speed.contentUnitCount > 0
        ? meta
        : null;
    }, 'visibilitychange 后真实速度样本未落盘');
    await emulateDocumentVisibility(driver, false);
    await driver.evaluate(`
      if (window.__e2eRealDateNow) Date.now = window.__e2eRealDateNow;
      return true;
    `);
    const bookmarkButton = await driver.find('#btn-bookmark');
    await driver.click(bookmarkButton);
    const savedBookmark = await waitFor(async () => {
      const bookmarks = await getBookmarks(driver, book.id);
      return Array.isArray(bookmarks) && bookmarks.length === 1 ? bookmarks[0] : null;
    }, '当前真实阅读位置未保存为书签');
    await assertNoRuntimeErrors(driver, '首次阅读');

    const readerWindow = await driver.currentWindowHandle();
    const replacementTab = await driver.newWindow('tab');
    await delay(500);
    await driver.switchToWindow(readerWindow);
    await driver.closeWindow();
    await driver.switchToWindow(replacementTab.handle);
    await driver.navigate(`${readerUrl}?bookId=${encodeURIComponent(book.id)}`);
    await waitForBookLoaded(driver, loaded.title);
    await delay(800);

    const restoredMeta = await getBookMeta(driver, book.id);
    const restoredBookmarks = await getBookmarks(driver, book.id);
    const afterReopenPosition = restoredMeta.pos;
    assert.ok(restoredMeta.time > 0, '标签页隐藏/关闭时未持久化阅读时长');
    assert.ok(restoredMeta.speed?.sampledSeconds > 30, '标签页隐藏/关闭时未持久化有效阅读时长样本');
    assert.ok(restoredMeta.speed?.sampledProgress > 0.001, '标签页隐藏/关闭时未持久化有效阅读进度样本');
    assert.equal(restoredMeta.speed?.contentUnitVersion, 1, '正文计数版本未持久化');
    assert.ok(restoredMeta.speed?.contentUnitCount > 0, '正文计数未持久化');
    assert.equal(restoredBookmarks.some((item) => item.cfi === savedBookmark.cfi), true,
      '关闭并重开 Reader 后书签未恢复');
    const speedEstimate = await driver.evaluate(`
      return Utils.estimateRemainingMinutes({
        remainingProgress: arguments[0],
        cachedSpeed: arguments[1]
      });
    `, [Math.max(0, 1 - ((afterReopenPosition.percentage || 0) / 100)), restoredMeta.speed]);
    assert.equal(speedEstimate.source, 'history', '重开后 ETA 未复用真实历史速度样本');
    assert.ok(Number.isFinite(speedEstimate.minutes), '历史速度 ETA 不是有限分钟数');
    const readingSpeedEstimate = await driver.evaluate(`
      return Utils.estimateReadingSpeed(arguments[0]);
    `, [restoredMeta.speed]);
    assert.equal(readingSpeedEstimate.source, 'history', '重开后未恢复历史平均字速');
    assert.ok(readingSpeedEstimate.unitsPerMinute > 0, '历史平均字速不是正数');
    const readerStatsText = await driver.evaluate(`
      return document.getElementById('progress-time')?.textContent || '';
    `);
    assert.match(readerStatsText, new RegExp(`阅读速度: ${readingSpeedEstimate.unitsPerMinute}字/分钟`));
    console.log(
      `阅读速度恢复：${restoredMeta.speed.sampledSeconds.toFixed(1)} 秒 / ` +
      `${(restoredMeta.speed.sampledProgress * 100).toFixed(1)}%，` +
      `${readingSpeedEstimate.unitsPerMinute} 字/分钟，ETA ${speedEstimate.minutes} 分钟`
    );
    const afterReopenFingerprint = await waitFor(async () => {
      const samples = await visibleFingerprint(driver);
      return samples.length ? samples : null;
    }, '无法采样恢复后的可见正文');
    const similarity = fingerprintSimilarity(beforeReopenFingerprint, afterReopenFingerprint);

    if (similarity < 0.55) {
      console.error('重开前正文采样：', beforeReopenFingerprint);
      console.error('重开后正文采样：', afterReopenFingerprint);
    }

    assert.equal(afterReopenPosition.cfi, savedPosition.cfi, '恢复过程改写了主 CFI');
    assert.equal(afterReopenPosition.locator?.sourceCfi, savedPosition.cfi, '恢复后 locator 与主 CFI 分裂');
    assert.ok(similarity >= 0.55, `关闭并重开 Reader 后可见正文不一致（相似度 ${similarity.toFixed(2)}）`);
    console.log(`关闭/重开恢复：正文指纹相似度 ${(similarity * 100).toFixed(1)}%`);

    const layoutAnchor = savedPosition.locator.restoreCfi || savedPosition.cfi;
    await switchLayout(driver, 'scrolled');
    await delay(500);
    assert.ok((await getPosition(driver, book.id))?.cfi, '切换滚动布局后持久位置丢失');
    await switchLayout(driver, 'paginated');
    await delay(500);
    const layoutAnchorVisibility = await getCfiVisibility(driver, layoutAnchor);
    if (!layoutAnchorVisibility.visible) {
      console.error('布局往返前位置：', afterReopenPosition);
      console.error('布局往返后位置：', await getPosition(driver, book.id));
      console.error('布局往返锚点可见性：', layoutAnchorVisibility);
      console.error('布局往返后渲染几何：', await getRenderGeometry(driver));
    }
    assert.equal(layoutAnchorVisibility.visible, true, '滚动/分页往返后原页锚点不在可视区域');
    console.log('布局往返保位：paginated → scrolled → paginated，锚点可见');

    await driver.setWindowRect(980, 760);
    await delay(900);
    const resizedPosition = await getPosition(driver, book.id);
    assert.ok(resizedPosition?.cfi, '窗口 reflow 后位置丢失');
    const resizeAnchor = savedPosition.locator.restoreCfi || savedPosition.cfi;
    const resizedAnchorVisibility = await getCfiVisibility(driver, resizeAnchor);
    const resizedFingerprint = await waitFor(async () => {
      const samples = await visibleFingerprint(driver);
      return samples.length ? samples : null;
    }, '无法采样窗口 reflow 后的可见正文');
    const resizeSimilarity = fingerprintSimilarity(afterReopenFingerprint, resizedFingerprint);
    if (!resizedAnchorVisibility.visible) {
      console.error('reflow 前位置：', afterReopenPosition);
      console.error('reflow 后位置：', resizedPosition);
      console.error('reflow 前正文采样：', afterReopenFingerprint);
      console.error('reflow 后正文采样：', resizedFingerprint);
      console.error('reflow 锚点可见性：', resizedAnchorVisibility);
      console.error('reflow 后渲染几何：', await getRenderGeometry(driver));
    }
    assert.equal(resizedAnchorVisibility.visible, true, '窗口 reflow 后保存的页内锚点不在可视区域');
    console.log(`窗口 reflow 保位：锚点可见，正文指纹相似度 ${(resizeSimilarity * 100).toFixed(1)}%`);

    const restoredNextButton = await driver.find('#btn-next');
    await driver.click(restoredNextButton);
    const postRestorePosition = await waitFor(async () => {
      const position = await getPosition(driver, book.id);
      return position && position.cfi !== savedPosition.cfi ? position : null;
    }, '恢复后首次用户翻页没有解除保护并保存新位置');
    assert.equal(postRestorePosition.locator?.sourceCfi, postRestorePosition.cfi);
    await assertNoRuntimeErrors(driver, '恢复与 reflow');
    console.log(`恢复后继续翻页：${postRestorePosition.cfi}`);

    const searchQuery = await getVisibleSearchQuery(driver);
    assert.ok(searchQuery.length >= 4, '无法从真实正文提取搜索词');
    const tocButton = await driver.find('#btn-toc');
    await driver.click(tocButton);
    const tocTarget = await waitFor(async () => {
      const count = await driver.evaluate(`return document.querySelectorAll('#toc-container .toc-item').length;`);
      return count > 1 ? driver.find('#toc-container .toc-item:last-child') : null;
    }, '真实 EPUB 未渲染可导航目录');
    await driver.click(tocTarget);
    const tocPosition = await waitFor(async () => {
      const position = await getPosition(driver, book.id);
      return position?.cfi && position.cfi !== postRestorePosition.cfi ? position : null;
    }, '真实目录点击没有导航并保存新位置');

    const searchButton = await driver.find('#btn-search');
    await driver.click(searchButton);
    await waitFor(() => driver.evaluate(`
      return document.getElementById('search-panel')?.classList.contains('open');
    `), '搜索面板未打开');
    await delay(350);
    await driver.evaluate(`
      const input = document.getElementById('search-input');
      input.value = arguments[0];
      input.dispatchEvent(new Event('input', { bubbles: true }));
    `, [searchQuery]);
    const doSearchButton = await driver.find('#btn-do-search');
    await driver.click(doSearchButton);
    const searchResult = await waitFor(async () => {
      const status = await driver.evaluate(`return document.getElementById('search-status')?.textContent || '';`);
      if (/搜索出错|暂无结果/.test(status)) throw new Error(status);
      const count = await driver.evaluate(`return document.querySelectorAll('#search-results-list .search-result-item').length;`);
      return count > 0 ? driver.find('#search-results-list .search-result-item:first-child') : null;
    }, `真实 EPUB 搜索未找到“${searchQuery}”`, 45000);
    await driver.click(searchResult);
    await waitFor(async () => {
      const position = await getPosition(driver, book.id);
      return position?.cfi && position.cfi !== tocPosition.cfi ? position : null;
    }, '搜索结果点击没有通过 runtime 导航并保存位置');
    await assertNoRuntimeErrors(driver, '目录与搜索');
    console.log(`功能导航：目录与正文搜索“${searchQuery}”均通过 runtime 生效`);

    const activeReaderWindow = await driver.currentWindowHandle();
    const homeTab = await driver.newWindow('tab');
    await driver.switchToWindow(homeTab.handle);
    await driver.navigate(`chrome-extension://${extensionId}/home/home.html`);
    await waitFor(() => driver.evaluate('return typeof EpubStorage !== "undefined";'), 'Home 存储层未加载');
    const homeSpeedText = await waitFor(() => driver.evaluate(`
      return document.querySelector('.book-speed-value')?.textContent || null;
    `), 'Home 未展示历史平均字速');
    assert.equal(homeSpeedText, `${readingSpeedEstimate.unitsPerMinute} 字/分`);
    const deleteResult = await driver.evaluateAsync(`
      const bookId = arguments[0];
      const done = arguments[arguments.length - 1];
      EpubStorage.removeBook(bookId).then(
        () => done({ ok: true }),
        (error) => done({ ok: false, error: String(error) })
      );
    `, [book.id]);
    assert.equal(deleteResult.ok, true, `跨标签页删除失败：${deleteResult.error || ''}`);

    await driver.switchToWindow(activeReaderWindow);
    await waitFor(() => driver.evaluate(`
      const error = document.querySelector('.reader-error-wrapper');
      return error && /已从书架删除/.test(error.textContent) && !document.querySelector('#epub-viewer iframe');
    `), '活动 Reader 未响应另一标签页的删除事件');

    const deletionResidue = await driver.evaluateAsync(`
      const bookId = arguments[0];
      const done = arguments[arguments.length - 1];
      Promise.all([
        EpubStorage.savePosition(bookId, 'epubcfi(/6/999)', 99),
        EpubStorage.saveReadingTime(bookId, 9999),
        EpubStorage.saveHighlights(bookId, [{ cfi: 'late-highlight' }]),
        EpubStorage.saveBookmarks(bookId, [{ cfi: 'late-bookmark' }]),
        EpubStorage.addRecentBook({ id: bookId, title: 'late-reader-write' })
      ]).then(async () => {
        const [meta, highlights, bookmarks, cover, locations, file, recent, all] = await Promise.all([
          EpubStorage.getBookMeta(bookId),
          EpubStorage.getHighlights(bookId),
          EpubStorage.getBookmarks(bookId),
          EpubStorage.getCover(bookId),
          EpubStorage.getLocations(bookId),
          EpubStorage.getFile(bookId),
          EpubStorage.getRecentBooks(),
          EpubStorage._getAll()
        ]);
        done({
          meta,
          highlights,
          bookmarks,
          hasCover: !!cover,
          hasLocations: !!locations,
          hasFile: !!file,
          inRecent: recent.some((entry) => entry.id === bookId),
          hasDeletionMarker: !!all['deletedBook_' + bookId]
        });
      }, (error) => done({ __error: String(error) }));
    `, [book.id]);
    assert.equal(deletionResidue.__error, undefined, deletionResidue.__error);
    assert.equal(deletionResidue.meta, null, '删除后迟到写入重建了 bookMeta');
    assert.deepEqual(deletionResidue.highlights, [], '删除后迟到写入重建了 highlights');
    assert.deepEqual(deletionResidue.bookmarks, [], '删除后迟到写入重建了 bookmarks');
    assert.equal(deletionResidue.hasCover, false, '删除后残留 cover');
    assert.equal(deletionResidue.hasLocations, false, '删除后残留 locations');
    assert.equal(deletionResidue.hasFile, false, '删除后残留 EPUB 文件');
    assert.equal(deletionResidue.inRecent, false, '删除后迟到写入重新加入 recentBooks');
    assert.equal(deletionResidue.hasDeletionMarker, true, '跨页面删除标记未持久化');
    await assertNoRuntimeErrors(driver, '跨标签页删除');
    console.log('跨标签页删除：活动 Reader 已收口，迟到写入未复活书籍数据');

    const reimportInput = await driver.find('#file-input');
    await driver.sendFile(reimportInput, epubPath);
    await waitForBookLoaded(driver, loaded.title);
    await waitFor(async () => {
      const books = await getRecentBooks(driver);
      return books.some((entry) => entry.id === book.id);
    }, '删除错误页原地重新导入后 recentBooks 未恢复');
    assert.equal(await driver.evaluate(`return !!document.querySelector('#epub-viewer iframe');`), true,
      '删除错误页原地重新导入后 epub.js 未重新挂载');
    console.log('错误页恢复：保留 #epub-viewer 后可在原 Reader 重新导入');

    const orphanId = 'e2e-orphan-' + book.id;
    const orphanSetup = await driver.evaluateAsync(`
      const orphanId = arguments[0];
      const done = arguments[arguments.length - 1];
      Promise.all([
        EpubStorage.savePosition(orphanId, 'epubcfi(/6/2)', 10),
        EpubStorage.saveHighlights(orphanId, [{ cfi: 'orphan-highlight' }]),
        EpubStorage.saveBookmarks(orphanId, [{ cfi: 'orphan-bookmark' }]),
        EpubStorage.saveLocations(orphanId, '["orphan-location"]'),
        EpubStorage.saveCover(orphanId, new Blob(['cover'], { type: 'image/plain' }))
      ]).then(() => done({ ok: true }), (error) => done({ ok: false, error: String(error) }));
    `, [orphanId]);
    assert.equal(orphanSetup.ok, true, `构造清空测试孤立数据失败：${orphanSetup.error || ''}`);

    await driver.switchToWindow(homeTab.handle);
    await driver.navigate(`chrome-extension://${extensionId}/home/home.html`);
    await waitFor(() => driver.evaluate(`
      const button = document.getElementById('btn-clear-all');
      return button && !button.classList.contains('is-hidden');
    `), 'Home 清空书架按钮未显示');
    const clearAllButton = await driver.find('#btn-clear-all');
    await driver.click(clearAllButton);
    await driver.acceptAlert();
    await waitFor(async () => {
      const ids = await driver.evaluateAsync(`
        const done = arguments[arguments.length - 1];
        EpubStorage.getAllBookIds().then(done, (error) => done({ __error: String(error) }));
      `);
      return Array.isArray(ids) && ids.length === 0;
    }, '通过 Home 清空书架后仍有书籍资源残留');

    await driver.switchToWindow(activeReaderWindow);
    await waitFor(() => driver.evaluate(`
      const error = document.querySelector('.reader-error-wrapper');
      return error && /已从书架删除/.test(error.textContent) && !document.querySelector('#epub-viewer iframe');
    `), 'Home 清空书架后活动 Reader 未收口');
    const clearResidue = await driver.evaluateAsync(`
      const ids = arguments[0];
      const done = arguments[arguments.length - 1];
      Promise.all(ids.map(async (id) => ({
        id,
        meta: await EpubStorage.getBookMeta(id),
        highlights: await EpubStorage.getHighlights(id),
        bookmarks: await EpubStorage.getBookmarks(id),
        cover: await EpubStorage.getCover(id),
        locations: await EpubStorage.getLocations(id),
        file: await EpubStorage.getFile(id)
      }))).then(done, (error) => done({ __error: String(error) }));
    `, [[book.id, orphanId]]);
    assert.equal(clearResidue.__error, undefined, clearResidue.__error);
    for (const residue of clearResidue) {
      assert.equal(residue.meta, null, `${residue.id} 清空后残留 bookMeta`);
      assert.deepEqual(residue.highlights, [], `${residue.id} 清空后残留 highlights`);
      assert.deepEqual(residue.bookmarks, [], `${residue.id} 清空后残留 bookmarks`);
      assert.equal(residue.cover, null, `${residue.id} 清空后残留 cover`);
      assert.equal(residue.locations, null, `${residue.id} 清空后残留 locations`);
      assert.equal(residue.file, null, `${residue.id} 清空后残留 EPUB 文件`);
    }
    await assertNoRuntimeErrors(driver, '重新导入与清空书架');
    console.log('Home 清空书架：真实确认框路径清理当前书与孤立资源，并收口活动 Reader');

    success = true;
    console.log('真实浏览器 E2E：通过');
  } catch (error) {
    await saveScreenshot(driver, failureScreenshot);
    console.error(`真实浏览器 E2E：失败\n${error.stack || error}`);
    console.error(`诊断文件：${artifactsDir}`);
    process.exitCode = 1;
  } finally {
    await driver.quit();
    driverProcess.kill('SIGTERM');
    await delay(100);
    if (success && !args.keep && process.env.KEEP_E2E_ARTIFACTS !== '1') {
      fs.rmSync(artifactsDir, { recursive: true, force: true });
    } else if (success) {
      console.log(`诊断文件：${artifactsDir}`);
    }
  }
}

run();
