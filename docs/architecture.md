# EPUB Reader — 系统架构文档

版本：v1.7.0  
更新：2026-03-11

---

## 目录

1. [项目概述](#1-项目概述)
2. [宏观架构](#2-宏观架构)
3. [目录结构](#3-目录结构)
4. [核心模块与 API 详解](#4-核心模块与-api-详解)
5. [数据流与存储架构](#5-数据流与存储架构)
6. [辅助工具与共用库](#6-辅助工具与共用库)
7. [关键设计决策（ADR）](#7-关键设计决策adr)
8. [已知技术债务](#8-已知技术债务)

---

## 1. 项目概述

EPUB Reader 是一个 Chrome MV3 扩展，提供完整的 EPUB 电子书阅读体验。全部数据在本地处理，无任何网络请求（字体资源除外）。

**技术栈**：
- 渲染引擎：epub.js v0.3.x（解析 EPUB 并渲染到 iframe）
- 压缩库：JSZip（epub.js 内部依赖）
- 存储：IndexedDB（via DbGateway）+ chrome.storage.local
- 扩展平台：Chrome MV3（Manifest Version 3）

**核心约束**：
- MV3 service worker 无法持有长连接，所有状态必须持久化到存储层
- EPUB iframe 与宿主页面跨源隔离，事件穿透需要 epub.js hooks 机制
- `chrome.storage.local` 总配额 10MB，二进制文件（EPUB、封面）走 IndexedDB

---

## 2. 宏观架构

```
┌─────────────────────────────────────────────────────────┐
│                   Chrome Extension Shell                 │
│                                                         │
│  ┌───────────┐   ┌─────────────────────────────────┐   │
│  │  popup/   │   │          reader/                │   │
│  │ popup.html│   │  ┌──────────────────────────┐   │   │
│  │ popup.js  │   │  │   reader.js (Controller) │   │   │
│  └─────┬─────┘   │  │  ┌──────┐ ┌──────────┐  │   │   │
│        │         │  │  │ TOC  │ │Bookmarks │  │   │   │
│  ┌─────▼─────┐   │  │  ├──────┤ ├──────────┤  │   │   │
│  │  home/    │   │  │  │Search│ │Highlights│  │   │   │
│  │ home.html │   │  │  ├──────┤ ├──────────┤  │   │   │
│  │  home.js  │   │  │  │Image │ │Annotation│  │   │   │
│  └─────┬─────┘   │  │  │Viewer│ │  Popup   │  │   │   │
│        │         │  │  └──────┘ └──────────┘  │   │   │
│        │         │  └──────────────────────────┘   │   │
│        │         │         epub.js iframe           │   │
│        │         └─────────────────────────────────┘   │
│        │                                               │
│  ┌─────▼─────────────────────────┐                    │
│  │         utils/                │                    │
│  │  db-gateway.js  storage.js   utils.js              │
│  └─────────────────┬─────────────┘                    │
│                    │                                   │
│  ┌─────────────────▼─────────────┐                    │
│  │    IndexedDB (DbGateway)      │                    │
│  │  files | covers | locations   │                    │
│  └───────────────────────────────┘                    │
│  ┌───────────────────────────────┐                    │
│  │   chrome.storage.local        │                    │
│  │  preferences | recentBooks    │                    │
│  │  bookMeta_* | highlights_*    │                    │
│  │  bookmarks_*                  │                    │
│  └───────────────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

**页面间通信**：所有页面（popup、home、reader）通过共享的 `chrome.storage.local` 交换数据，不使用 `chrome.runtime.sendMessage`（避免 service worker 生命周期问题）。

**路由方式**：reader.html 通过 URL 参数 `?bookId=<id>` 接收书籍标识，通过 `?target=<cfi>` 接收跳转 CFI（标注定位）。

---

## 3. 目录结构

```
epub_reader/
├── src/
│   ├── manifest.json              # MV3 扩展声明
│   ├── background/
│   │   └── service-worker.js      # MV3 后台（最小化，仅处理扩展安装事件）
│   ├── reader/                    # 阅读器页面（主体）
│   │   ├── reader.html            # 阅读器 UI 骨架
│   │   ├── reader.css             # 阅读器样式
│   │   ├── reader.js              # 主控制器（约 900 行）
│   │   ├── annotations.js         # EPUB 内联注释弹窗处理
│   │   ├── bookmarks.js           # 书签管理模块
│   │   ├── highlights.js          # 高亮与笔记模块
│   │   ├── image-viewer.js        # 图片放大查看器
│   │   ├── search.js              # 全文搜索模块
│   │   └── toc.js                 # 目录侧边栏模块
│   ├── home/
│   │   ├── home.html              # 书架主页
│   │   ├── home.js                # 书架与标注管理
│   │   └── home.css               # 书架样式
│   ├── popup/
│   │   ├── popup.html             # 扩展弹窗（快速入口）
│   │   └── popup.js               # 弹窗逻辑
│   ├── utils/
│   │   ├── db-gateway.js          # IndexedDB 单例封装
│   │   ├── storage.js             # 统一存储抽象层（唯一入口）
│   │   └── utils.js               # 共享工具函数（v1.7.0 新增）
│   ├── styles/
│   │   └── themes.css             # 全局主题变量（light/dark/sepia/green/custom）
│   ├── lib/
│   │   ├── epub.min.js            # epub.js 渲染引擎
│   │   └── jszip.min.js           # ZIP 解压库
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── docs/                          # 开发文档
├── CHANGELOG.md
├── README.md
└── ROADMAP.md
```

---

## 4. 核心模块与 API 详解

### 4.1 EpubStorage (utils/storage.js)

所有持久化操作的唯一入口。禁止在 storage.js 以外直接调用 `chrome.storage.local` 或 `indexedDB`。

#### 偏好设置
- `savePreferences(prefs: Partial<Preferences>): Promise<void>`
- `getPreferences(): Promise<Preferences>`

#### 最近书籍
- `addRecentBook(book: RecentBook): Promise<void>` (上限 20 本，自动级联 LRU)
- `getRecentBooks(): Promise<RecentBook[]>`
- `removeRecentBook(bookId: string): Promise<void>`

#### 书籍元数据 (v1.7.0 聚合)
- `getBookMeta(bookId: string): Promise<BookMeta | null>` (返回 { pos, time, speed })
- `savePosition(bookId, cfi, %): Promise<void>` (Patch pos 字段，内置防抖)
- `saveReadingTime(bookId, sec): Promise<void>`
- `saveReadingSpeed(bookId, speed): Promise<void>`
- `removeBookMeta(bookId): Promise<void>` (级联清理 pos/time/meta 键)

#### 标注与书签
- `getHighlights(bookId): Promise<Highlight[]>`
- `saveHighlights(bookId, arr): Promise<void>`
- `getAllHighlights(): Promise<Record<string, Highlight[]>>` (并行读取所有书的高亮)
- `getBookmarks(bookId): Promise<Bookmark[]>`
- `saveBookmarks(bookId, arr): Promise<void>`

#### 级联清理
- `removeBook(bookId): Promise<void>` (并行执行 7 项级联删除)
- `enforceFileLRU(maxCount=10): Promise<void>` (驱逐旧书，同步级联清理元数据)

### 4.2 DbGateway (utils/db-gateway.js)

IndexedDB 单例封装，提供事务原子性保障与重试机制。

- `DbGateway.connect(): Promise<IDBDatabase>` (单例，内置指数退避重试)
- `DbGateway.get(storeName, key)` / `DbGateway.put(storeName, data)`
- `DbGateway.delete(storeName, key)`
- `DbGateway.getAllMeta(storeName, fields: string[])` (游标扫描，避免加载全量二进制数据)

### 4.3 Utils (utils/utils.js)

纯函数集合，无环境依赖。

- `Utils.escapeHtml(text)`: XSS 核心防护，基于 DOM 转义。
- `Utils.formatDate(ts)`: 相对时间转换。
- `Utils.formatDuration(sec)`: 时长格式化。

---

## 5. UI 与交互模块 (Reader Modules)

### 5.1 Highlights (reader/highlights.js)
- **模式**：IIFE 单例 `window.Highlights`。
- **职责**：文字选中拦截、高亮渲染、笔记弹窗维护。
- **API**: `init()`, `setBookDetails(bookId, fileName, rendition)`, `closePanels()`。

### 5.2 Search (reader/search.js)
- **模式**：IIFE 单例 `const Search`。
- **算法**：Spine 遍历 + yield 机制（`setTimeout(0)`），防止大书搜索挂起 UI。
- **API**: `init()`, `setBook(book, rendition)`, `togglePanel()`, `reset()`。

### 5.3 TOC / Bookmarks (reader/toc.js / bookmarks.js)
- **职责**：目录树递归构建、书签持久化与 UI 对齐。
- **生命周期**：`init()` 注册全局事件，`setBook()` / `build()` 接收引擎实例。

### 5.4 Annotations (reader/annotations.js)
- **职责**：EPUB 注释链接拦截与防护。
- **API**: `init()`, `hookRendition(rendition)`。在 `hooks.content` 中注入点击拦截。

### 5.5 ImageViewer (reader/image-viewer.js)
- **职责**：基于 CSS transform 的高性能全屏查看器。
- **API**: `init()`, `hookRendition(rendition)`, `open(src)`。

---

## 6. 数据流与存储架构

### 6.1 书籍 ID 生成

```javascript
generateBookId(filename, arrayBuffer):
  combined = encode(filename) + arrayBuffer.slice(0, 64KB)
  hash = SHA-256(combined)
  return 'book_' + hex(hash).slice(0, 32)
```

使用 `crypto.subtle.digest`（异步），格式 `book_<32位十六进制>`。基于文件名+内容前 64KB，同一文件的不同副本产生相同 ID（去重）。

### 6.2 完整数据生命周期

```
用户打开 EPUB 文件
  → generateBookId()                    → bookId = 'book_abc123'
  → storeFile(filename, data, bookId)   → IDB files[bookId]
  → openBook(arrayBuffer)
      → addRecentBook()                 → recentBooks[] 更新
      → saveCover()                     → IDB covers[bookId]
      → locations.generate()            → IDB locations[bookId]

翻页
  → onLocationChanged(location)
      → schedulePositionSave(300ms)     → bookMeta_<bookId>.pos（防抖）
      → flushSpeedSession(如跳跃)       → bookMeta_<bookId>.speed
  → readingTimer（每 10s）              → bookMeta_<bookId>.time
```

---

### 6.3 reader/reader.js — 主控制器

**职责**：协调 epub.js 渲染引擎与所有功能模块，管理阅读器生命周期。

**状态变量**：

| 变量 | 类型 | 说明 |
|---|---|---|
| `book` | ePub | epub.js book 实例 |
| `rendition` | Rendition | epub.js 渲染实例 |
| `currentBookId` | string | SHA-256 书籍标识 |
| `currentFileName` | string | 原始文件名 |
| `isBookLoaded` | boolean | 书籍是否已完全加载 |
| `currentStableCfi` | string | 当前稳定位置 CFI（resize 时使用 end.cfi） |
| `isResizing` | boolean | resize 中标志（忽略中间态 relocated 事件） |
| `activeReadingSeconds` | number | 累计阅读秒数（与 storage 同步） |
| `_sessionStart` | object\|null | 当前 session 起点 {progress, timestamp} |
| `_lastProgress` | number | 上一次 relocated 的进度值（跳跃检测） |
| `_posTimer` | number | savePosition 防抖 timer id |

**书籍加载流程**：

```
loadEpubFile(file) / loadFileByBookId(bookId)
  ↓
openBook(arrayBuffer)
  ├── 销毁旧 book 实例，清理计时器
  ├── ePub(arrayBuffer) 创建新实例
  ├── getBookMeta() 读取历史时间 + 速度
  ├── book.renderTo() 创建 rendition
  ├── 注册 hooks.content（样式注入）
  ├── rendition.display(savedCfi) 显示上次位置
  ├── 非阻塞：提取封面 saveCover()
  ├── 非阻塞：locations.generate() 或从缓存 load()
  └── locations ready 后：initSpeedTracking(progress)
```

**阅读速度追踪（v1.7.0）**：

```
打开书籍：_sessionStart = { progress: p0, timestamp: t0 }
               
翻页（relocated）：
  newProgress = percentageFromCfi(cfi)
  if |newProgress - _lastProgress| > 0.05:
    flushSpeedSession(newProgress)   ← 跳跃：结束旧session，新session从当前位置开始
  _lastProgress = newProgress
  schedulePositionSave(...)          ← 300ms 防抖

visibilitychange(hidden)：
  flushPositionSave()                ← 立即写位置
  saveReadingTime()                  ← 立即写时间
  flushSpeedSession(null)            ← 结束session，不续期

flushSpeedSession(newStart):
  delta_p = _lastProgress - _sessionStart.progress
  delta_t = (now - _sessionStart.timestamp) / 1000
  if delta_p ∈ (0.001, 0.30) and delta_t > 30:
    speed.sampledSeconds  += delta_t
    speed.sampledProgress += delta_p
    saveReadingSpeed()
  _sessionStart = newStart ? { progress: newStart, timestamp: now } : null
```

**ETA 估算优先级**：
1. 历史累积速度（`_cachedSpeed.sampledSeconds / sampledProgress`，需 > 120s 且 > 1%）
2. 当前 session 实时速度（需 > 60s 且 > 0.5%）
3. 静态 fallback（章节数 × 150字 ÷ 400字/分钟）

---

### 4.5 reader/highlights.js — 高亮与笔记

**模式**：IIFE 单例（`window.Highlights`）

**状态机**：

```
idle
  ↓ 文字选中（rendition 'selected' 事件）
selection_pending  ← _currentCfiRange 已设置
  ↓ 点击颜色按钮
highlight_created  ← highlights[] 新增，storage 已写
  ↓ 点击已有高亮
highlight_active   ← _activeHighlightCfi 已设置
  ↓ 点击 "添加笔记" 按钮
note_editing       ← notePopup 显示
  ↓ 保存/取消
highlight_active / idle
```

**关键机制**：
- `_internalAction` 互斥锁（50ms 有效）：阻止颜色按钮点击后的 mousedown 关闭面板
- 注册时机：`init()` 内注册 window mousedown（一次）；`setBookDetails()` 内注册 rendition.on('selected')（重新设置书籍时重新注册）
- 颜色校验：`sanitizeColor()` 白名单正则，防止 CSS 注入进入 epub.js SVG 属性

**渲染方式**：通过 `rendition.annotations.highlight()` 和 `rendition.annotations.underline()` 渲染，epub.js 负责在 iframe SVG 层叠加。

---

### 4.6 reader/bookmarks.js — 书签管理

**模式**：对象单例（`const Bookmarks`）

**存储格式**：
```javascript
// bookmarks_<bookId>
[{ cfi, chapter, progress, timestamp }]
// progress: 0-100 的百分比（已乘 1000/10 四舍五入）
```

**面板互斥**：打开时关闭 TOC 和 Search 面板，共享 sidebar-overlay。

---

### 4.7 reader/toc.js — 目录

**模式**：对象单例（`const TOC`）

**构建方式**：递归遍历 `book.navigation.toc`，支持最多 3 级嵌套（`toc-item-level-1/2/3`）。

**当前章节高亮**：`setActive(href)` 在 `relocated` 事件后调用，通过 href 包含关系匹配（处理 `file.html#section1` 格式）。

---

### 4.8 reader/search.js — 全文搜索

**模式**：IIFE 单例（`const Search`）

**算法**：遍历 `book.spine`，逐章节 `item.load()` → `item.find(query)` → `item.unload()`，每章节 yield（`await setTimeout(0)`）避免 UI 冻结。

**搜索 ID 机制**：`currentSearchId` 自增，每次新搜索触发前递增，旧搜索通过 ID 不匹配提前退出。

**最大结果数**：1000 条（性能保护）。

**搜索高亮清理**：`_lastSearchAlertCfi` 单例追踪，切换结果或关闭面板时通过 `rendition.annotations.remove()` 清理。

---

### 4.9 reader/image-viewer.js — 图片查看器

**模式**：对象单例（`const ImageViewer`）

**功能**：缩放（0.2x–8x）、平移（拖拽）、鼠标滚轮缩放、键盘快捷键（+/-/0/Esc）。

**图片拦截**：`rendition.hooks.content.register()` 在每个 chapter iframe 加载时为所有 `img/image/svg image` 元素绑定 click 事件，取 `img.src` 或 SVG xlink:href 打开查看器。

---

### 4.10 reader/annotations.js — EPUB 内联注释

**职责**：处理 EPUB 文档内的 `<a>` 注释链接（脚注、尾注），点击时以弹窗形式显示注释内容而不是跳转页面。

**模式**：对象单例（`const Annotations`）

**反向链接保护**：通过 `isBackLink()` 检测返回链接（如 `[↩]`），对返回链接不拦截，允许正常导航。

---

### 4.11 home/home.js — 书架与标注管理

**v1.7.0 并行加载优化**：

```javascript
// 旧版串行（每本书 3 次串行 await）
for (const book of books) {
  const cover = await EpubStorage.getCover(book.id);        // await 1
  const pos   = await EpubStorage.getPosition(book.id);     // await 2
  const time  = await EpubStorage.getReadingTime(book.id);  // await 3
  renderCard(book, cover, pos, time);
}

// v1.7.0 并行（全书并行，每本书 2 次并行 await）
const dataList = await Promise.all(books.map(async book => {
  const [cover, meta] = await Promise.all([
    EpubStorage.getCover(book.id),     // IDB（1 次）
    EpubStorage.getBookMeta(book.id)   // storage（1 次，包含 pos+time+speed）
  ]);
  return { book, cover, meta };
}));
```

20 本书加载时间：串行 ~600ms → 并行 ~30ms（以 30ms/次存储访问估算）。

**getAllHighlights（v1.7.0）**：废弃 `highlightKeys` 索引，直接遍历 `recentBooks` 并行读取各书高亮。消除 v1.6.0 的索引不一致 bug（saveHighlights 未同步维护索引）。

---

### 4.12 popup/popup.js — 快捷入口弹窗

显示最近 5 本书（从 recentBooks 读取），支持快速打开和移除。v1.7.0 改用 `getBookMeta()` 一次读取进度，替代原来的 `getPosition()` 单独调用。

---

### 4.13 background/service-worker.js — MV3 后台

最小化实现，仅处理 `chrome.runtime.onInstalled` 事件（初次安装时打开书架页）。不持有任何长连接或定时器（MV3 限制）。

---

## 5. 数据流与存储架构

### 5.1 书籍 ID 生成

```javascript
generateBookId(filename, arrayBuffer):
  combined = encode(filename) + arrayBuffer.slice(0, 64KB)
  hash = SHA-256(combined)
  return 'book_' + hex(hash).slice(0, 32)
```

使用 `crypto.subtle.digest`（异步），格式 `book_<32位十六进制>`。基于文件名+内容前 64KB，同一文件的不同副本产生相同 ID（去重）。

### 5.2 完整数据生命周期

```
用户打开 EPUB 文件
  → generateBookId()                    → bookId = 'book_abc123'
  → storeFile(filename, data, bookId)   → IDB files[bookId]
  → openBook(arrayBuffer)
      → addRecentBook()                 → recentBooks[] 更新
      → saveCover()                     → IDB covers[bookId]
      → locations.generate()            → IDB locations[bookId]

翻页
  → onLocationChanged(location)
      → schedulePositionSave(300ms)     → bookMeta_<bookId>.pos（防抖）
      → flushSpeedSession(如跳跃)       → bookMeta_<bookId>.speed
  → readingTimer（每 10s）              → bookMeta_<bookId>.time

切换标签/关闭
  → visibilitychange(hidden)
      → flushPositionSave()             → bookMeta_<bookId>.pos（立即）
      → saveReadingTime()               → bookMeta_<bookId>.time（立即）
      → flushSpeedSession(null)         → bookMeta_<bookId>.speed（立即）

添加高亮
  → highlights[].push(hl)
  → saveHighlights(bookId, highlights) → highlights_<bookId>

删除书籍
  → removeBook(bookId)                  → 7 项并行删除
      ├── removeRecentBook()            → recentBooks 过滤
      ├── removeBookMeta()              → bookMeta_/pos_/time_ 删除
      ├── removeCover()                 → IDB covers 删除
      ├── removeHighlights()            → highlights_<bookId> 删除
      ├── removeLocations()             → IDB locations 删除
      ├── removeBookmarks()             → bookmarks_<bookId> 删除
      └── removeFile()                  → IDB files 删除
```

### 5.3 LRU 驱逐策略

文件缓存上限：10 本书（`enforceFileLRU(10)`）。驱逐时按 `timestamp` 倒序排列，删除最旧的超出部分。

**v1.7.0 级联清理**：驱逐文件同时删除对应的 `recentBooks` 条目和 `bookMeta`，防止书架出现孤立条目。

---

## 6. 关键设计决策（ADR）

### ADR-001：bookId 基于内容指纹而非文件名

**背景**：v1.5.0 之前使用文件名作为 ID，同名不同内容的文件会覆盖彼此的阅读进度。

**决策**：使用 SHA-256(filename + content[:64KB]) 生成 bookId。

**代价**：文件被重新命名后会被视为新书（进度独立）。截取前 64KB 而非全文的原因是性能——完整哈希一本 5MB 的 EPUB 约需 100ms。

### ADR-002：EPUB 文件存 IndexedDB，元数据存 chrome.storage.local

**背景**：chrome.storage.local 上限 10MB，一本书就可能超限。

**决策**：二进制文件（EPUB data、cover blob、locations JSON）走 IndexedDB（无实际容量上限）；轻量的元数据（位置、时间、高亮等文本数据）走 chrome.storage.local。

**代价**：两套 API，storage.js 需要封装两层。

### ADR-003：highlights 和 bookmarks 不并入 bookMeta

**背景**：完全合并所有数据到单 key 看起来最整洁。

**决策**：按写频率分组：`bookMeta`（翻页高频写）独立于 `highlights`（用户主动操作，低频写）和 `bookmarks`（极低频）。

**原因**：`chrome.storage.local.set` 替换整个 value。若 highlights 在 bookMeta 中，每次翻页需读写整个 highlights 数组（最大 ~50KB），写放大 250 倍，对存储 I/O 和扩展配额均是不必要压力。

### ADR-004：speed.sessionStart 不持久化

**背景**：sessionStart 记录本次打开书籍的起点。

**决策**：仅存内存，不写 storage。

**原因**：Tab 关闭时 session 结束，数据已 flush 到 sampledSeconds/sampledProgress。持久化 sessionStart 会引入「上次未正常关闭时残留脏数据」的状态污染问题。

### ADR-005：废弃 highlightKeys 索引（v1.7.0）

**背景**：v1.6.0 引入 highlightKeys 数组索引加速 getAllHighlights，但 saveHighlights 未维护该索引，导致新书高亮不可见。

**决策**：废弃索引，getAllHighlights 直接遍历 recentBooks（权威书籍列表）并行读取。

**代价**：每次打开标注面板触发 O(n) 次 storage 读取（n = 书架书籍数，最多 20），不影响用户感知速度。

---

## 7. 扩展机制与接口契约

### 7.1 模块初始化契约

所有功能模块在 `DOMContentLoaded` 中统一初始化：

```javascript
// reader.js
document.addEventListener('DOMContentLoaded', async () => {
  ImageViewer.init();
  Annotations.init();
  TOC.init();
  Search.init();
  Bookmarks.init();
  Highlights.init();
  // ...
});
```

`init()` 只注册 DOM 事件监听，不依赖 book/rendition（此时尚未加载）。

### 7.2 书籍加载后的模块绑定

```javascript
// 书籍加载完成后，依次绑定各模块
Bookmarks.setBook(currentBookId, book, rendition);
Search.setBook(book, rendition);
Highlights.setBookDetails(currentBookId, currentFileName, rendition);
// Annotations 通过 setBook + hookRendition 绑定
```

### 7.3 布局切换后的重新绑定（setLayout）

`setLayout()` 销毁旧 rendition 并创建新 rendition，必须重新绑定所有持有 rendition 引用的模块：

```javascript
// 必须在 rendition.display() 之前绑定，否则 hooks 注册时机会错过首次渲染
Search.setBook(book, rendition);
Highlights.setBookDetails(currentBookId, currentFileName, rendition);
ImageViewer.hookRendition(rendition);
Annotations.hookRendition(rendition);
```

### 7.4 epub.js hooks 机制

```javascript
// 在每个 chapter iframe 渲染时注入自定义内容
rendition.hooks.content.register((contents) => {
  // contents.document = iframe 的 document
  // 注入样式、绑定事件
});
```

**注意**：hooks.content.register 会在每次章节切换时调用，内部注册的事件监听器会随 iframe 销毁，无内存泄漏风险。但 rendition.on() 注册的监听器需要在 rendition 销毁前手动 off（或通过 rendition.destroy() 统一清理）。

---

## 8. 已知技术债务

按优先级排列，参见 ROADMAP.md 获取完整规划。

### P1（需在下一版本处理）

无当前开放 P1 问题（v1.7.0 已全部修复）。

### P2（计划 v1.8.0）

| ID | 描述 | 影响 |
|---|---|---|
| 2.3 | home.js 书架 card.dataset.coverUrl 在 loadBookshelf 重新渲染时可能二次创建但不 revoke | 内存轻微泄漏 |
| 2.4 | popup.js 串行加载封面（for-await 循环） | 弹窗打开慢 |
| 2.5 | bookmarks.js 有独立的 _escapeHtml/_formatDate，未使用 Utils | DRY 违规 |

### P3（计划 v1.8.0 - v1.9.0）

| ID | 描述 |
|---|---|
| 3.1 | DbGateway.by_filename 索引无调用路径，维护开销无收益 |
| 3.2 | CSP unsafe-inline 未消除（reader.html/home.html 有 15+ 处 style.* 直写） |
| 3.3 | home.css 与 themes.css CSS 变量命名冲突（--text-primary 等） |
| 3.4 | reader.js 约 900 行上帝对象，缺乏模块分层 |
| 3.5 | 缺 ARIA 无障碍标注（role/aria-* 属性） |
| 3.6 | search.js mark.style.cssText 内联样式（应抽为 CSS 类） |
