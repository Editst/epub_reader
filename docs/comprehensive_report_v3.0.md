# EPUB Reader 综合改进报告 v3.0

> 基于 v1.4 报告、v2.1 报告与 v1.6.0 全量代码交叉核查  
> 日期：2026-03-11 · 覆盖范围：v1.5.0 / v1.6.0 完成度核查 + 存量问题全清单 + 演进路线重定

---

## 目录

1. [v1.5.0 + v1.6.0 完成度核查](#1-v150--v160-完成度核查)
2. [存量问题全清单（按优先级）](#2-存量问题全清单)
3. [新发现问题](#3-新发现问题)
4. [演进路线规划](#4-演进路线规划)
5. [不变式检查清单](#5-不变式检查清单)

---

## 1. v1.5.0 + v1.6.0 完成度核查

### 1.1 已完成项 ✅（15/15）

| ID | 描述 | 引入版本 |
|---|---|---|
| D-1-A | 滚动布局 wheel 事件守卫 | v1.5.0 |
| D-1-B | `setLayout` 同步 `currentPrefs.layout` | v1.5.0 |
| D-1-C | SHA-256 内容指纹 bookId（破坏性升级） | v1.5.0 |
| D-1-D | service-worker `onClicked` 死代码删除 | v1.5.0 |
| D-1-E | `DbGateway.put/delete` 改为 `tx.oncomplete` | v1.5.0 |
| D-1-F | `bookmarks.js` 归口 `EpubStorage` | v1.5.0 |
| D-1-G | `storeFile` LRU 内化，删调用方重复逻辑 | v1.5.0 |
| D-1-H | `highlights.js` `renderHighlight` 补 `sanitizeColor` | v1.5.0 |
| P0-SCHEMA-1 | `files` 表主键从 filename 改为 bookId（DB v4） | v1.6.0 |
| P0-ANNOTATIONS-1 | `annotations.js` 脚注 `on*` 属性 + `javascript:` href 过滤 | v1.6.0 |
| P1-ROUTE-1 | URL 路由 token 从 `?file=` 改为 `?bookId=` | v1.6.0 |
| P1-LRU-1 | `enforceFileLRU` 改用 `getAllMeta` cursor，消除 ~50MB 内存峰值 | v1.6.0 |
| P1-CASCADE-1 | `removeBook` 改为 `Promise.all` 并行删除 | v1.6.0 |
| P1-STORAGE-1 | `positions` 改为 flat key `pos_<bookId>`，O(1) 读写 | v1.6.0 |
| P1-STORAGE-2 | `getAllHighlights` 引入 `highlightKeys` 索引，消除 `get(null)` 全量扫描 | v1.6.0 |

### 1.2 未完成项（原 D-2 CSS 清理阶段）

v1.4 报告将 D-2 CSS 清理规划为 v1.6.0 目标。实际 v1.6.0 优先解决了 P0-SCHEMA-1 存储层破坏性问题，CSS 清理整体推后。以下为当时 D-2 计划中未执行的内容，全部归入本报告第 2 节问题清单。

---

## 2. 存量问题全清单

> 状态标记：🔴 P0 · 🟠 P1 · 🟡 P2 · 🔵 P3

### 2.1 🟠 P1：DbGateway 重试风暴（C-1，v1.4 报告遗留）

**文件**：`src/utils/db-gateway.js`

**描述**：`request.onerror` 触发时，执行 `this._dbPromise = null`，随后立即 reject。若调用方在 catch 中继续操作（如 `visibilitychange` 触发 `savePosition`），下一次 `connect()` 立即发起新的 `indexedDB.open()`。若底层故障持续（磁盘满、隐身模式受限），可能触发高频重试风暴，积累大量挂起的 Promise。

**当前代码**：
```javascript
request.onerror = (e) => {
  this._dbPromise = null;  // 立即允许下次重试
  reject(e.target.error);
};
```

**修复方案**：引入指数退避冷却，连续失败不超过 3 次：
```javascript
_retryCount: 0,
_retryDelay: 500,

request.onerror = (e) => {
  this._dbPromise = null;
  this._retryCount++;
  if (this._retryCount <= 3) {
    // 指数退避：500ms / 1000ms / 2000ms
    setTimeout(() => { this._retryCount = 0; }, this._retryDelay * this._retryCount * 4);
  }
  reject(e.target.error);
};

async connect() {
  if (this._retryCount >= 3) {
    throw new Error('[DbGateway] IDB connection failed 3 times, refusing to retry.');
  }
  ...
}
```

---

### 2.2 🟡 P2：LRU 驱逐后 recentBooks 条目残留

**文件**：`src/utils/storage.js`，`enforceFileLRU()`

**描述**：`enforceFileLRU` 删除 IDB 中的文件记录，但不清理 `chrome.storage.local` 中对应的 `recentBooks` 条目。用户在书架点击已被 LRU 驱逐的书籍时，`loadFileByBookId()` 返回 null，报错"缓存不存在"。

**修复方案**：`enforceFileLRU` 删除文件后，调用 `removeRecentBook(meta.bookId)` 级联清理书架条目（已有该方法，零成本复用）：
```javascript
async enforceFileLRU(maxCount = 10) {
  const meta = await DbGateway.getAllMeta('files', ['timestamp']);
  if (meta.length <= maxCount) return;
  meta.sort((a, b) => b.timestamp - a.timestamp);
  for (let i = maxCount; i < meta.length; i++) {
    await DbGateway.delete('files', meta[i].bookId);
    await this.removeRecentBook(meta[i].bookId);  // 新增
  }
}
```

---

### 2.3 🟡 P2：home.js 书架卡片删除时 ObjectURL 可能泄漏

**文件**：`src/home/home.js`，`loadBookshelf()` 删除路径

**描述**：书架渲染时，每个 `<img>` 挂载了 `{once: true}` 的 `load`/`error` 监听器负责 `revokeObjectURL`。但删除书籍时的代码：
```javascript
await EpubStorage.removeBook(book.id);
card.remove();  // img 从 DOM 移除
// load/error 事件是否已触发取决于浏览器 — 若图片未完成加载则 URL 永久泄漏
```

`card.remove()` 将 img 从 DOM 移除后，浏览器不保证 `load` 事件仍会触发（规范层面有歧义，Chrome 实测通常触发，但不可依赖）。

**修复方案**：在 card 元素上存储 URL 引用，删除前显式 revoke：
```javascript
// 渲染时：card.dataset.coverUrl = coverObjectUrl;
// 删除时：
const url = card.dataset.coverUrl;
if (url) URL.revokeObjectURL(url);
await EpubStorage.removeBook(book.id);
card.remove();
```

---

### 2.4 🟡 P2：savePosition 无防抖，每次翻页直写 storage

**文件**：`src/reader/reader.js`，`onLocationChanged()`

**描述**：
```javascript
function onLocationChanged(location) {
  ...
  EpubStorage.savePosition(currentBookId, currentStableCfi, percent); // 无防抖
}
```

`rendition.on('relocated', onLocationChanged)` 在翻页、键盘翻页、章节跳转时均触发。快速翻页（键盘连按 ←→）每次触发一次 `chrome.storage.local.set`。虽然 v1.6.0 已将 positions 改为 flat key（O(1) 写），单次操作开销从原来的"读所有→写所有"降为单 key 写，但仍无防抖，高频写入对扩展 storage I/O 有不必要压力。

epub.js 在章节边界处会触发两次 `relocated`（设计如此），现有注释已承认这个问题，但仅通过 debounce 过滤了双触发，未限制整体频率。

**修复方案**：300ms 尾部防抖 + `visibilitychange` 时立即 flush：
```javascript
let _posTimer = null;

function schedulePositionSave(bookId, cfi, percent) {
  clearTimeout(_posTimer);
  _posTimer = setTimeout(() => EpubStorage.savePosition(bookId, cfi, percent), 300);
}

// visibilitychange flush（已有逻辑，补充 flush）：
document.addEventListener('visibilitychange', () => {
  if (document.hidden && currentBookId && isBookLoaded) {
    clearTimeout(_posTimer);
    EpubStorage.savePosition(currentBookId, currentStableCfi, lastPercent);
    ...
  }
});
```

---

### 2.5 🟡 P2：home.js loadBookshelf 串行加载（性能）

**文件**：`src/home/home.js`，`loadBookshelf()`

**描述**：当前对每本书串行 `await getCover()` + `await getPosition()` + `await getReadingTime()`，20 本书 = 60 次串行异步操作。首次渲染延迟随书库大小线性增长。

**修复方案**：三个 Promise 先在单本书内并行，再并行渲染所有书：
```javascript
const books = await EpubStorage.getRecentBooks();
const dataList = await Promise.all(books.map(book =>
  Promise.all([
    EpubStorage.getCover(book.id),
    EpubStorage.getPosition(book.id),
    EpubStorage.getReadingTime(book.id)
  ]).then(([coverBlob, pos, time]) => ({ book, coverBlob, pos, time }))
));
for (const d of dataList) renderCard(d);
```

预计效果：20 本书加载时间从 ~600ms 降至 ~30ms。

---

### 2.6 🔵 P3：CSP `style-src 'unsafe-inline'` 未消除

**文件**：`src/manifest.json`

**描述**：manifest CSP 中 `style-src 'self' 'unsafe-inline'` 允许任意内联样式，削弱 CSP 防御纵深。根因是多处 JS 使用 `element.style.cssText = ...` 和 `element.style.display = ...`（共 15+ 处）。

移除 `unsafe-inline` 的前提是将所有动态内联样式改为 CSS class 切换。以下是当前存量内联样式：

| 位置 | 用途 | 迁移难度 |
|---|---|---|
| `reader.js:1150` `showLoading()` | `loadingOverlay.style.display = show ? 'flex' : 'none'` | 低：`.is-loading` class |
| `reader.js:583-585` `openBook()` | `welcomeScreen/readerMain/bottomBar.style.display` | 低：`.book-open` class on body |
| `reader.js:471,500` `showLoadError()` | 多处 `.style.cssText` 构建错误 UI | 中：提取 `.reader-error` CSS |
| `reader.js:1006` | `customThemeOptions.style.display` | 低：`.visible` class |
| `reader.js:363,366` | `readerMain.style.opacity` 过渡动画 | 低：CSS transition class |
| `search.js:215-222` | item `style.cursor/userSelect/lineHeight` 等 | 中：`.search-result-item` CSS |
| `search.js:239` | `mark.style.cssText` 搜索高亮 | 低：`.search-highlight` CSS class |
| `search.js:189` | `statusEl.innerHTML = '<span style=...>'` | 低：用 textContent + CSS class |
| `toc.js:54` | `innerHTML = '<div style="padding...">'` | 低：`.toc-empty` CSS class |

全部迁移完成后，方可从 manifest 移除 `'unsafe-inline'`。

---

### 2.7 🔵 P3：dragover overlay 使用 innerHTML 常量 SVG

**文件**：`src/reader/reader.js`，`setupDragAndDrop()`，第 398 行

**描述**：
```javascript
dragOverlay.innerHTML = `
  <div class="drag-overlay-content">
    <svg viewBox="0 0 24 24" ...>...</svg>
    <p>释放以打开 EPUB 文件</p>
  </div>
`;
```

纯常量字符串，无用户数据插入，**无安全风险**。但与"禁止 `innerHTML` 字符串赋值"规范形式冲突，且每次 dragover 触发时重建 DOM。

**修复方案**：将 overlay HTML 预置于 `reader.html`（`display:none`），dragover 时仅切换 class：
```html
<!-- reader.html -->
<div id="drag-overlay" class="drag-overlay hidden">
  <div class="drag-overlay-content">
    <svg ...>...</svg>
    <p>释放以打开 EPUB 文件</p>
  </div>
</div>
```

---

### 2.8 🔵 P3：home.css 与 themes.css CSS 变量双轨

**文件**：`src/home/home.css`、`src/styles/themes.css`

**描述**：两个文件均在 `[data-theme="light"]` / `[data-theme="dark"]` 下定义 `--text-primary`、`--border-color` 等同名变量，但值不同。加载顺序决定哪个生效，导致主题切换在 home 页面上不完整（sepia/green 主题下部分颜色仍使用 light 主题值）。

**修复方案**：将 `home.css` 中与 `themes.css` 重名的 `:root` 变量重命名为私有命名空间 `--home-*`，并补充对应的 `[data-theme="dark"]` 块。

---

### 2.9 🔵 P3：themes.css 缺失 `[data-theme="custom"]` 块

**文件**：`src/styles/themes.css`

**描述**：themes.css 定义了 light / dark / sepia / green 四个主题块，但 reader.js 中 `setTheme('custom')` 会设置 `data-theme="custom"`，此时无对应 CSS block，工具栏/侧边栏等 UI 颜色回退到 `:root` 默认值，与用户自定义的内容区颜色不协调。

**修复方案**：在 themes.css 末尾添加 `[data-theme="custom"]` 块，使用 CSS 自定义属性 `var(--custom-bg)` / `var(--custom-text)` 作为占位，由 JS `setProperty` 动态注入。

---

### 2.10 🔵 P3：reader.html display 控制三轨并存

**文件**：`src/reader/reader.html`、`src/reader/reader.js`

**描述**：
- `loading-overlay`：`style.display = 'flex' | 'none'`（JS 直接控制 style）
- `sidebar-overlay`：`classList.remove('visible')`（class 控制）
- `settings-panel`、`bookmarks-panel`：`classList.toggle('open')`（class 控制）
- `welcome-screen`、`reader-main`、`bottom-bar`：`style.display = '...'`（JS 直接控制 style）

混用三种模式，维护者需要分别查找每个元素的显隐方式。统一为 class 控制是 D-2 清理目标的一部分，且是移除 CSP `unsafe-inline` 的前提条件之一。

---

### 2.11 🔵 P3：缺少 `<meta name="color-scheme">` 声明

**文件**：`src/reader/reader.html`、`src/home/home.html`

**描述**：无此声明时，系统深色模式下原生表单控件（`<input type="range">`进度条、`<input type="color">` 颜色选择器）采用浅色样式，与深色主题的 UI 冲突。一行 meta 即可修复。

---

### 2.12 🔵 P3：popup.html 234 行 CSS 完全内联

**文件**：`src/popup/popup.html`

**描述**：全部样式写在 `<style>` 标签内，无法被 CSP `style-src 'self'` 覆盖（内联 style 块属于 `unsafe-inline`）。需提取为 `popup/popup.css` 外联文件。

---

### 2.13 🔵 P3：search.js 多处 innerHTML 和内联 style

**文件**：`src/reader/search.js`

具体问题：
- 第 189 行：`statusEl.innerHTML = '<span style="color:var(--text-muted)">暂无结果</span>'` — innerHTML + 内联 style 双违规（虽内容为常量，但规范一致性要求）
- 第 215-222 行：`itemEl.style.cursor/userSelect/lineHeight/fontSize` — 应提取为 `.search-result-item` CSS class
- 第 239 行：`mark.style.cssText = '...'` — 应改为 `.search-highlight` CSS class

---

### 2.14 🔵 P3：reader.js 1160 行上帝对象，无模块分层

**文件**：`src/reader/reader.js`

**描述**：reader.js 承担：状态管理、DOM 事件绑定、epub.js 生命周期、位置/时间/书签更新、主题/字体/布局设置、性能埋点、错误处理——全部混合在一个 1160 行文件中。无单一职责，无 mount/unmount 生命周期协议。

**目标**：按 v1.4 报告 D-3 节设计，拆分为：
- `reader-state.js`：单一状态源
- `reader-persistence.js`：防抖写入策略
- `reader-ui.js`：DOM 绑定层
- `reader-runtime.js`：epub.js 生命周期

**工时估算**：7-10 个工作日（高风险，需完整集成测试）

---

### 2.15 🔵 P3：ETA 阅读时间估算硬编码 400 字/分钟

**文件**：`src/reader/reader.js`，第 901 行

```javascript
const estTotalMinutes = charsTotal / 400; // 400 chars per min
```

建议改为基于用户历史阅读速度动态估算：`totalChars / actualReadingSeconds * 60`，已有 `getReadingTime` 和位置数据，可以计算。

---

### 2.16 🔵 P3：缺少 ARIA 可访问性标注

**文件**：`src/reader/reader.html`

`reader.html` 中无任何 `role`、`aria-*`、`tabindex` 属性。关键缺口：
- 侧边栏/面板：应有 `role="dialog"` + `aria-modal="true"` + `aria-label`
- 上/下一页按钮：应有 `aria-label="上一页/下一页"`
- 进度条 `<input type="range">`：应有 `aria-label="阅读进度"` + `aria-valuetext`
- 搜索面板：应有 `role="search"`

---

### 2.17 🔵 P3：缺少 ROADMAP.md

项目文档中无演进规划文件，技术债务和阶段目标分散在各版本审计报告里。建议在项目根目录维护 `ROADMAP.md`，按里程碑记录当前阶段目标和已知技术债务。

---

## 3. 新发现问题

### 3.1 🟡 P2：`highlightKeys` 索引与实际 highlights 可能不一致

**文件**：`src/utils/storage.js`，`getAllHighlights()` / `saveHighlights()` / `removeHighlights()`

**描述**：v1.6.0 引入 `highlightKeys` 数组作为索引，供 `getAllHighlights()` 使用以避免 `get(null)` 全量扫描。但 `saveHighlights()` 在写入 highlights 时**没有更新 `highlightKeys`**：

```javascript
async saveHighlights(bookId, highlights) {
  await this._set({ ['highlights_' + bookId]: highlights });
  // 缺少：若 bookId 不在 highlightKeys 中，需追加
}
```

**后果**：新书首次写入 highlights 后，`highlightKeys` 中无此 bookId → 下次 `getAllHighlights()` 命中快路径但跳过这本书 → home.js 标注管理面板中该书的高亮不可见。仅在历史迁移 scan 时（`highlightKeys` 不存在时的 fallback 全量扫描）可以补救，但一旦 `highlightKeys` 存在就永久走快路径。

**修复**：
```javascript
async saveHighlights(bookId, highlights) {
  await this._set({ ['highlights_' + bookId]: highlights });
  // 确保 bookId 在索引中
  let keys = (await this._get('highlightKeys')) || [];
  if (!keys.includes(bookId)) {
    keys.push(bookId);
    await this._set({ highlightKeys: keys });
  }
},
```

同理，`removeHighlights()` 需从 `highlightKeys` 中移除 bookId（`removeBook()` 已有此逻辑，但直接调用 `removeHighlights()` 的路径没有）。

---

### 3.2 🟡 P2：`getAllHighlights()` 快路径缺少空值过滤

**文件**：`src/utils/storage.js`，`getAllHighlights()` 快路径

**描述**：
```javascript
await Promise.all(keys.map(async (bookId) => {
  const val = await this._get('highlights_' + bookId);
  if (val) result[bookId] = val;
}));
```

若某个 bookId 对应的 highlights 已被删除（key 不存在），`_get()` 返回 undefined，`if (val)` 会跳过它，但 `highlightKeys` 中仍保留该 bookId。下次仍会尝试读取，产生无效查询。应在读取返回 undefined 时同步清理索引（lazy cleanup）。

---

### 3.3 🟡 P2：`positions` 旧格式 lazy migration 可能积累多个 migrate 调用

**文件**：`src/utils/storage.js`，`getPosition()`

**描述**：migration 路径：读 `pos_<bookId>` 未命中 → 读旧 `positions` map → 迁移写入 flat key + 删除旧 entry。但如果同一 bookId 的 `getPosition()` 在迁移完成前被并发调用（如书架渲染时 `Promise.all` 中），两次调用都会读到旧格式，尝试两次迁移，第二次写入 flat key 为冗余操作（幂等，无害），但第二次删除 `positions[bookId]` 时 entry 已不存在，触发一次额外的 `_set({ positions: ... })` 写入。

**风险等级**：低（幂等，无数据损坏）。但修复后的 `loadBookshelf` 并行化（2.5 节）会触发多本书同时调用 `getPosition`，届时并发迁移发生概率上升。建议在迁移前加一个 migration flag 或在 `getPosition` 中添加简单的 in-flight 检测。

---

### 3.4 🔵 P3：`_remove()` 不接受数组，与 `chrome.storage.local.remove` 接口不一致

**文件**：`src/utils/storage.js`

**描述**：`_remove(key)` 已实现接受数组：
```javascript
async _remove(key) {
  return new Promise(resolve =>
    chrome.storage.local.remove(Array.isArray(key) ? key : [key], resolve)
  );
}
```

这是正确的，但当前调用方均为单 key 调用。未来 `removeBook` 可能需要批量删除多个 key（如 `['pos_<bookId>', 'time_<bookId>']`），接口已支持，只是无测试覆盖。记录为 P3。

---

### 3.5 🔵 P3：`by_filename` 索引存在但无调用路径

**文件**：`src/utils/db-gateway.js`

**描述**：v1.6.0 在 files store 上建立了 `by_filename` 索引，并实现了 `getByFilename(filename)` 方法，但当前代码中无任何调用路径使用它（原有的 `loadFileFromIndexedDB(filename)` 已被 `loadFileByBookId(bookId)` 替代）。该索引占用少量存储空间，维护更新开销极低，但属于无用代码。

选项 A：保留（作为"万一需要按文件名查"的预留接口，零成本）。  
选项 B：删除（遵循 YAGNI）。

建议：保留索引，删除 `getByFilename()` 方法，如未来需要时再从 `getAllMeta` 实现。

---

## 4. 演进路线规划

### 4.1 路线总览

```
v1.6.0 (当前)
  存储层 Schema 重建完成，两个 P0 安全问题已修复
       ↓
v1.7.0  (P1/P2 稳定性修复)         ≈ 2 个工作日
       ↓
v1.8.0  (CSS/HTML 清理)             ≈ 3 个工作日
       ↓
v1.9.0  (unsafe-inline 消除)        ≈ 2 个工作日
       ↓
v2.0.0  (reader.js 架构拆分)        ≈ 7-10 个工作日
       ↓
v2.1.0  (性能 + UX 提升)            ≈ 3 个工作日
       ↓
v2.2.0  (ARIA 可访问性)             ≈ 2 个工作日
```

---

### 4.2 v1.7.0 — P1/P2 稳定性修复

**目标**：消除所有 P1/P2 级问题，使当前架构达到稳定状态。

#### T-1：`highlightKeys` 索引一致性修复（P2，0.5h）

同步 `saveHighlights` / `removeHighlights` 维护 `highlightKeys` 索引。确保快路径与实际数据永远一致。

#### T-2：`enforceFileLRU` 级联清理 recentBooks（P2，0.5h）

`enforceFileLRU` 删除文件后，同步调用 `removeRecentBook(bookId)`，消除书架孤立条目。

#### T-3：home.js 删除书籍时显式 revoke ObjectURL（P2，0.5h）

`card.dataset.coverUrl = coverObjectUrl` 保存引用，删除前显式 revoke，消除潜在内存泄漏。

#### T-4：savePosition 防抖 300ms（P2，1h）

提取 `schedulePositionSave()`，章节边界双重触发和快速翻页均合并为一次写入。`visibilitychange` 时立即 flush。

#### T-5：loadBookshelf 并行化（P2，1h）

单本书内三个 storage 操作改为 `Promise.all`，再并行渲染所有书。

#### T-6：DbGateway 指数退避冷却（P1，1h）

连续失败计数 + 延迟重置，防止重试风暴。上限 3 次后 throw 明确错误。

**v1.7.0 不变式**：
```bash
# highlightKeys 同步：saveHighlights 调用后 highlightKeys 包含该 bookId
# recentBooks 无孤立条目：enforceFileLRU 后 recentBooks 中不含已驱逐 bookId
# savePosition 无直接调用：onLocationChanged 中仅调用 schedulePositionSave
grep "EpubStorage.savePosition" src/reader/reader.js  # 应只在 flush 路径出现
```

---

### 4.3 v1.8.0 — CSS / HTML 清理（D-2）

**目标**：统一显隐控制机制，消除 CSS 变量冲突，为移除 `unsafe-inline` 做铺垫。

#### S-1：home.css 变量私有命名空间

将 `home.css` 中所有与 `themes.css` 重名的变量重命名为 `--home-*`，全文约 30 处替换。补充 `[data-theme="dark"]` / `[data-theme="sepia"]` / `[data-theme="green"]` 块对应的 `--home-*` 值。

#### S-2：themes.css 补充 `[data-theme="custom"]` 块

以 light 为基准，通过 `var(--custom-bg, ...)` / `var(--custom-text, ...)` CSS 自定义属性与 JS `setProperty` 联动。

#### S-3：display 控制统一为 CSS class

涉及 `reader.html` 的 7 处 `style="display:none"` 元素，统一改为：
- 初始隐藏：`class="hidden"`（CSS `.hidden { display: none }`）
- `showLoading()` 等：改为 `classList.toggle('is-visible', show)` 或 `classList.toggle('hidden', !show)`
- `openBook()` 后的 welcomeScreen/readerMain/bottomBar：改为 body 上加 `.book-open` class，CSS 选择器控制各元素的 display

#### S-4：popup.css 外联化

从 `popup.html` 提取 234 行 CSS 到 `popup/popup.css`，html 改为 `<link>` 引用。

#### S-5：补充 `<meta name="color-scheme">`

`reader.html` 和 `home.html` 各添加一行。

#### S-6：drag-overlay 移出 innerHTML

预置于 `reader.html`，`setupDragAndDrop()` 改为 class 切换。

---

### 4.4 v1.9.0 — 消除 CSP `unsafe-inline`（状态修正：未彻底完成）

**状态修正（2026-03-11 复审）**：C-1~C-6 已完成，但 C-7 仍未满足移除条件，manifest 需暂时保留 `'unsafe-inline'`。

**目标**：清理剩余所有 `element.style.*` 动态赋值：

| 位置 | 现状 | 迁移方案 |
|---|---|---|
| `reader.js showLoadError()` | 5 处 `style.cssText` 构建错误 UI | 提取 `.reader-error-wrapper` 等 CSS class |
| `reader.js opacity` 动画 | `style.opacity = '0'/'1'` | `classList.add('fade-in')` + CSS transition |
| `search.js` item styles | 4 处 `style.*` | `.search-result-item` CSS |
| `search.js mark` | `style.cssText` | `.search-highlight` CSS |
| `search.js statusEl` | `innerHTML = '<span style=...>'` | textContent + `.search-status-empty` class |
| `toc.js` empty | `innerHTML = '<div style=...>'` | `.toc-empty` CSS |

复审发现仍存在以下阻塞项：
- `reader.html` / `home.html` / `popup.html` 仍有静态 `style="..."` 属性；
- `home.js` / `popup.js` / `annotations.js` 仍有运行时 `style.*` 或内联 style 字符串。

因此当前不能移除 manifest 中的 `'unsafe-inline'`，否则会出现页面布局错乱。



### 4.4.1 v1.9.1 收尾建议（新增）

1. 先迁移三类残留：HTML 静态 style、JS `style.*`、`innerHTML` 内联样式模板。
2. 新增回归用例：
   - `manifest` 是否仍含 `unsafe-inline`（迁移前应为 true，迁移后改为 false）；
   - 三个入口 HTML 是否无 `style="`；
   - `src/` 是否无 `innerHTML.*style=`。
3. 最后一步再改 CSP，避免“先改策略、后修代码”导致线上白屏/错版。

### 4.4.2 Reader 白屏根因与修复（新增）

**现象**：恢复 `unsafe-inline` 后仍出现“阅读页全白”。

**复审结论**：问题主要来自“自定义主题低对比度组合”（例如背景与文字都近白）导致正文视觉上近似空白，并非 CSP 本身持续失效。

**已修复**：`reader.js` 新增 `ensureReadableTheme`，对自定义主题进行颜色归一化与对比度检测；当对比度过低时自动回退到高可读文字色，避免“假白屏”。


---

### 4.5 v2.0.0 — reader.js 架构拆分

**目标**：将 1160 行上帝对象拆分为职责单一的模块，降低后续功能开发的维护风险。

拆分路径（低风险到高风险）：

**Step 1**：提取 `reader-persistence.js`（位置保存 + 时间保存防抖，约 60 行）  
**Step 2**：提取 `reader-state.js`（所有 `let` 顶层变量集中为一个对象，约 30 行）  
**Step 3**：为现有模块（Search、TOC、Bookmarks、Highlights、Annotations）添加统一 `mount(book, rendition, bookId)` / `unmount()` 接口  
**Step 4**：提取 `reader-ui.js`（DOM 查询 + 事件绑定，约 200 行）  
**Step 5**：reader.js 缩减为 `reader-runtime.js`（epub.js 生命周期协调，目标 < 400 行）

每步独立可测试，步骤间无硬依赖。

---

### 4.6 v2.1.0 — 性能与 UX 打磨

- ETA 改为基于实际历史速度动态估算（替换 400 字/分钟硬编码）
- locations 生成进度反馈（`locations.on('progress', ...)` 或轮询）
- `requestIdleCallback` 优化阅读计时器的存储写入（当前每 10 秒用 setInterval，改为空闲时批写）
- 搜索：`setTimeout(r, 0)` 替换 `setTimeout(r, 10)`，每 5 章让出一次而非每章

---

### 4.7 v2.2.0 — ARIA 可访问性基础

优先级最低，但对 Chrome 商店评级有正面影响：
- 侧边栏/面板：`role="dialog"` + `aria-modal="true"`
- 导航按钮：`aria-label`
- 进度条：`aria-label` + `aria-valuetext`
- 搜索：`role="search"`

---

## 5. 不变式检查清单

### 5.1 v1.6.0 当前已保证的不变式

```bash
# [1] IDB files 主键为 bookId
grep "keyPath.*bookId" src/utils/db-gateway.js

# [2] 无 ?file= 路由 token
grep -r "?file=" src/  # 应返回空

# [3] removeBook 无 filename 参数
grep "removeBook(" src/utils/storage.js  # 仅 (bookId)

# [4] enforceFileLRU 无 getAll 全量加载
grep "getAll('files')" src/utils/storage.js  # 应返回空

# [5] 无 indexedDB.open 散落
grep -r "indexedDB.open" src/ | grep -v db-gateway.js  # 应为空

# [6] positions 无嵌套 map 写入（仅在迁移读取路径出现 'positions'）
grep -n "'positions'" src/utils/storage.js | grep "_set"  # 仅迁移路径

# [7] 无旧 storeFileInIndexedDB / storeFileData 包装
grep -r "storeFileInIndexedDB\|storeFileData" src/  # 应为空

# [8] annotations.js on* 过滤存在
grep "on\\w\+\s*=" src/reader/annotations.js | grep "replace"  # sanitizer 行
```

### 5.2 v1.7.0 完成后新增不变式

```bash
# [9] savePosition 无直接裸调用（仅通过 schedulePositionSave）
grep "EpubStorage.savePosition" src/reader/reader.js | grep -v "flush\|schedule"  # 应为空

# [10] saveHighlights 调用后 highlightKeys 同步更新
# （需人工或集成测试验证）

# [11] enforceFileLRU 后 recentBooks 无对应条目
# （需人工验证）
```

### 5.3 v1.9.0 完成后新增不变式

```bash
# [12] v1.9.1 前 manifest 暂含 unsafe-inline（迁移完成后应为空）
grep "unsafe-inline" src/manifest.json  # 现阶段应命中，v1.9.1 完成后应为空

# [13] 无 element.style.cssText 赋值
grep -r "style.cssText" src/  # 应为空

# [14] 无 innerHTML 含 style= 属性的字符串
grep -r "innerHTML.*style=" src/  # 应为空（允许注释中的示例）
```

---

*本报告基于 v1.4 审计报告、v2.1 审计报告与 v1.6.0 全量代码交叉核查。*  
*v1.5.0 + v1.6.0 共清理 15 项已知问题（含 2 项 P0 安全问题）。当前无 P0 级开放问题。*  
*最高优先级待处理：P1 DbGateway 重试风暴（C-1）、P2 highlightKeys 不一致（新发现）、P2 savePosition 无防抖。*
