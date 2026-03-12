# EPUB Reader — 系统架构文档

版本：v2.1.1  
更新：2026-03-12

---

## 目录

1. [项目概述](#1-项目概述)
2. [宏观架构](#2-宏观架构)
3. [目录结构](#3-目录结构)
4. [模块详解](#4-模块详解)
5. [数据流与存储架构](#5-数据流与存储架构)
6. [关键设计决策（ADR）](#6-关键设计决策adr)
7. [扩展机制与接口契约](#7-扩展机制与接口契约)
8. [已知技术债务](#8-已知技术债务)
9. [附录：模块加载顺序](#9-附录模块加载顺序)

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
│  │ popup.js  │   │  │   reader.js（v2.1.1 入口编排） (Controller) │   │   │
│  └─────┬─────┘   │  │  ┌──────┐ ┌──────────┐  │   │   │
│        │         │  │  │ TOC  │ │Bookmarks │  │   │   │
│  ┌─────▼─────┐   │  │  ├──────┤ ├──────────┤  │   │   │
│  │  home/    │   │  │  │Search│ │Highlights│  │   │   │
│  │ home.html │   │  │  ├──────┤ ├──────────┤  │   │   │
│  │  home.js  │   │  │  ├──────┤ ├──────────┤  │   │   │
│  └─────┬─────┘   │  │  │Image │ │Annotation│  │   │   │
│        │         │  │  │Viewer│ │  Popup   │  │   │   │
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
│   │   ├── reader.js（v2.1.1 入口编排）              # 主控制器（<120 行）
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

## 4. 模块详解

### 4.1 utils/db-gateway.js — IndexedDB 单例网关

**职责**：所有 IndexedDB 操作的唯一入口，管理连接生命周期和 Schema 升级。

**Schema 版本历史**：

| DB 版本 | 变更内容 | 对应扩展版本 |
|---|---|---|
| v1 | 初始建表：files(name), covers(id) | v1.0 |
| v2 | 无 Schema 变更 | v1.1–v1.4 |
| v3 | 新增 locations store (keyPath='id') | v1.2 |
| v4 | files 主键从 filename 改为 bookId；三表主键字段统一为 bookId | v1.6.0 |

**当前 Schema（DB v4）**：
```
files      keyPath='bookId'  index: by_filename(non-unique)
covers     keyPath='bookId'
locations  keyPath='bookId'
```

**连接失败保护（v1.7.0）**：
- `_retryCount` 计数器，连续失败达到 `_retryLimit=3` 次后拒绝重试
- 每次失败设置指数退避冷却计时（500ms → 1000ms → 2000ms），冷却后自动将计数器 -1

**主要接口参考**：
```typescript
DbGateway.connect(): Promise<IDBDatabase>
// 返回单例 DB 连接；连续失败 3 次后抛出错误拒绝重试

DbGateway.get(storeName: string, key: any): Promise<any | null>
DbGateway.put(storeName: string, data: object): Promise<void>
// 等待 tx.oncomplete 确保落盘

DbGateway.delete(storeName: string, key: any): Promise<void>
DbGateway.getAll(storeName: string): Promise<any[]>

DbGateway.getAllMeta(storeName: string, fields: string[]): Promise<object[]>
// 游标扫描，只提取指定字段（不加载 binary data）
// 用于 LRU 按 timestamp 排序，避免将 EPUB 全量加载入内存

// by_filename 索引查询（备用路径，主路径用 bookId）
```

---

### 4.2 utils/storage.js — 统一存储抽象层 (EpubStorage)

**职责**：所有持久化操作的唯一入口。禁止在 utils/storage.js 以外直接调用 `chrome.storage.local` 或 `indexedDB`。

**v1.7.0 存储结构**：

```
chrome.storage.local
├── preferences              全局偏好设置
├── recentBooks              书架列表（最多 20 本）
├── bookMeta_<bookId>        位置 + 时间 + 速度（高频写，< 200 bytes）
│     ├── pos: { cfi, percentage, timestamp }
│     ├── time: number               累计阅读秒数
│     └── speed: { sampledSeconds, sampledProgress }
├── highlights_<bookId>      高亮与笔记数组（中频写）
└── bookmarks_<bookId>       书签数组（低频写）

IndexedDB
├── files(bookId)            EPUB 原文件二进制
├── covers(bookId)           封面 Blob
└── locations(bookId)        epub.js CFI 位置索引 JSON
```

**主要接口参考**：

#### 偏好设置
```typescript
savePreferences(prefs: Partial<Preferences>): Promise<void>
getPreferences(): Promise<Preferences>
```

#### 最近书籍
```typescript
addRecentBook(book: RecentBook): Promise<void>
// RecentBook: { id, title, author, filename, lastOpened? }
// 列表上限 20 本，超出时自动驱逐
getRecentBooks(): Promise<RecentBook[]>
removeRecentBook(bookId: string): Promise<void>
```

#### 书籍元数据 (v1.7.0 聚合)
```typescript
getBookMeta(bookId: string): Promise<BookMeta | null>
// BookMeta: { pos, time, speed }
// 首次调用自动迁移 v1.6.0 的 pos_/time_ 旧 key

savePosition(bookId: string, cfi: string, percentage?: number): Promise<void>
// Patch pos 字段，内置防抖处理
saveReadingTime(bookId: string, seconds: number): Promise<void>
saveReadingSpeed(bookId: string, speed: Speed): Promise<void>
removeBookMeta(bookId: string): Promise<void>
```

#### 高亮、书签与文件 (IndexedDB)
```typescript
getHighlights(bookId: string): Promise<Highlight[]>
saveHighlights(bookId: string, highlights: Highlight[]): Promise<void>
getAllHighlights(): Promise<Record<string, Highlight[]>>

saveCover(bookId: string, blob: Blob): Promise<void>
getCover(bookId: string): Promise<Blob | null>

storeFile(filename: string, data: Uint8Array, bookId: string): Promise<void>
// 写入后自动调用 enforceFileLRU(10)清理
getFile(bookId: string): Promise<FileRecord | null>
```

#### 级联操作
```typescript
removeBook(bookId: string): Promise<void>
// 并行执行 7 项级联删除
enforceFileLRU(maxCount?: number = 10): Promise<void>
// 驱逐旧书，同步级联清理 recentBooks + bookMeta
```

---

### 4.3 utils/utils.js — 共享工具函数

**职责**：跨页面共享函数集合，消除重复定义。多数函数为纯函数；`escapeHtml` 依赖浏览器 DOM API。

**接口参考**：
```typescript
Utils.escapeHtml(text: any): string
// 将任意值转为安全 HTML 字符串（& < > " ' 转义）
// 内部用 DOM textContent，无正则漏洞

Utils.formatDate(timestamp: number, fb?: string): string
// 相对时间字符串（刚刚 / N分钟前 / N小时前 / N天前 / 本地日期）

Utils.formatDuration(seconds: number): string
// 秒数 → 可读时长（N分钟 / N小时N分）

Utils.formatMinutes(minutes: number): string
// 用于 ETA 显示
```

---

### 4.4 reader/reader.js（v2.1.1 入口编排） — 入口编排层

**职责**：协调渲染引擎与功能模块，管理阅读器生命周期。

**v1.8.0 关键特性**：
- **CFI 锁机制 (`_withCfiLock`)**：字号/行高变化时锁定重排，统一使用 `start.cfi` 恢复锚点。
- **阅读速度追踪**：
  - `_sessionStart` 在 `visibilitychange` 激活时重置，剔除挂机时间。
  - `flushSpeedSession` 直接更新内存缓存 `_cachedSpeed` 后写存储。
  - 采样阈值：>30s 且 >0.3%（v1.8.0 调优）。

---

### 4.5 reader/highlights.js — 高亮与笔记

**模式**：IIFE 单例 `window.Highlights`。
**接口参考**：
```typescript
Highlights.init(): void
// 注册全局 mousedown 及工具栏点击

Highlights.setBookDetails(bookId, fileName, rendition): Promise<void>
// 绑定新书，加载高亮，注册 rendition.on('selected')
// 切换书籍或重分布(setLayout)时必须调用

Highlights.closePanels(): void
```

---

### 4.6 reader/bookmarks.js — 书签管理

**模式**：对象单例 `const Bookmarks`。
**接口参考**：
```typescript
Bookmarks.init(): void
Bookmarks.setBook(bookId, book, rendition): void
Bookmarks.toggle(cfi, chapterName, progress): Promise<void>
// progress: 0-1 小数，内部转为 0-100
Bookmarks.isBookmarked(cfi): Promise<boolean>
```

---

### 4.7 reader/toc.js — 目录

**模式**：对象单例 `const TOC`。
**接口参考**：
```typescript
TOC.init(): void
TOC.build(navigation, rendition): void
// 从 navigation 构建 3 级嵌套目录树
TOC.setActive(href): void
// relocated 事件后高亮当前章节
```

---

### 4.8 reader/search.js — 全文搜索

**模式**：IIFE 单例 `const Search`。
**接口参考**：
```typescript
Search.init(): void
Search.setBook(book, rendition): void
Search.togglePanel(): void
Search.reset(): void // 取消进行中的搜索并清空状态
```

---

### 4.9 reader/image-viewer.js — 图片查看器

**模式**：对象单例 `const ImageViewer`。
**接口参考**：
```typescript
ImageViewer.init(): void
ImageViewer.hookRendition(rendition): void
// 注册 hooks.content 拦截图片 click
ImageViewer.open(src): void
```

---

### 4.10 reader/annotations.js — EPUB 内联注释

**模式**：对象单例 `const Annotations`。
**接口参考**：
```typescript
Annotations.init(): void
Annotations.setBook(book): void
Annotations.hookRendition(rendition): void
// 拦截 <a> 标签，识别脚注，避免页面跳转
```

---

### 4.11 home/home.js — 书架与标注管理

**关键机制**：
- **并行加载**：使用 `Promise.all` 批量读取封面与书籍元数据（v1.7.0 性能提升 ~20倍）。
- **ObjectURL 管理**：封面生成 Blob URL 后，需在重新渲染或页面卸载时及时回收。

---

### 4.12 popup/popup.html + popup/popup.js — 快捷入口弹窗

**特性**：显示最近 5 本书，封面加载采用并行化处理（v1.8.0）。

**v1.9.3 关键约束（BUG-B 教训）**：

| 约束 | 原因 |
|------|------|
| `popup.html` 必须使用内联 `<style>`，不引用外部 CSS | 外部 CSS 异步加载，时序不可控；`display:none` 未及时生效会导致 `.click()` 被 Chrome 拦截 |
| `#file-input` 必须用物理隐藏（`width:0; height:0; opacity:0`），不用 `display:none` | Chrome 扩展 popup 禁止对 `display:none` 元素调用 `.click()`，DevTools 打开时限制放宽（此为 BUG-B 决定性诊断线索） |
| `popup.html` 不得包含 `<link rel="preconnect">` | manifest CSP 未配置 `connect-src`，preconnect 请求会被阻断并干扰页面加载 |
| 不使用 `showOpenFilePicker` | 需要 transient user activation，在 `async DOMContentLoaded` 回调中调用不可靠 |
| `emptyState` 显隐用 `style.display` 直写 | 不依赖任何外部 CSS 规则，在 popup 受限环境中最可靠 |

---

## 5. 数据流与存储架构

### 5.1 书籍 ID 生成
使用 `SHA-256(filename + content[:64KB])` 生成 ID。截取前 64KB 平衡去重准确度与哈希耗时（~100ms）。

### 5.2 完整数据生命周期
1. **导入**：`generateBookId` → `storeFile` (IDB) → `enforceFileLRU`。
2. **阅读**：`onLocationChanged` → `schedulePositionSave` (300ms 防抖) → `bookMeta_<id>`。
3. **统计**：`visibilitychange` → `flushSpeedSession` 记录采样。
4. **清理**：`removeBook` 并行删除 7 项关联数据，确保无孤立 Key。

---

## 6. 关键设计决策（ADR）

- **ADR-001：基于内容的 bookId**：解决同名不同内容进度覆盖问题。
- **ADR-002：两级存储分层**：Binary 走 IndexedDB，轻量 Metadata 走 Chrome Storage (10MB 限额)。
- **ADR-003：Key 分离原则**：按写频率分组（pos 分离），规避合并对象引起的写放大问题。
- **ADR-004：锚点对齐 start.cfi (v1.8.0)**：解决字号变大时由于单屏字数变少导致的重排偏移。
- **ADR-005：废弃 highlightKeys 索引 (v1.7.0)**：消除索引同步 Bug，改为遍历 `recentBooks` 并行读取。

---

## 7. 扩展机制与接口契约

- **MV3 生命周期**：SW 不持有内存状态，所有配置必须持久化。
- **Hooks 拦截机制**：通过 `rendition.hooks.content.register` 注入 iframe，拦截点击事件或注入层。
- **重分布绑定契约**：每次 `setLayout` 后，必须重新调用所有子模块的 `setBook/hookRendition`。

---

## 8. 已知技术债务

### 8.0 v1.9.3 核心教训：Chrome Extension popup 的 `display:none` 限制

**BUG-B 完整调试路径与根因**：

这个 bug 经历了 5 轮修复尝试，每次都找到了"看似合理"的原因，但问题始终存在，
直到注意到"DevTools 打开时能用"这个决定性线索。

**调试时序**：

1. **v1.9.2 初始改动**：将 popup 样式从内联 `<style>` 分离为外部 `popup.css` + `@import` 字体
2. **第一轮猜测**：`@import` 阻塞 CSS 加载 → 将字体改为 `<link>` 外部引入（错误：不是根因）
3. **第二轮猜测**：`loadRecentBooks()` 缺少 `try/catch` 导致回调中断 → 加了保护（部分有效，非根因）
4. **第三轮猜测**：`emptyState` 用 `classList` 而非 `style.display` 控制 → 还原直写（正确但不够）
5. **第四轮猜测**：`<link rel="preconnect">` 被 CSP 阻断 → 恢复内联 `<style>`（正确但不够）
6. **决定性线索**：用户发现"开 DevTools 就能用" → 指向 Chrome 安全限制
7. **根因确认**：`display:none` 元素无法被程序 `.click()`，DevTools 放宽了这个限制

**核心规则**：在 Chrome Extension popup 中，任何需要通过 JS 的 `.click()` 触发的
`<input type="file">`，必须使用物理隐藏（零尺寸+透明），而非逻辑隐藏（`display:none`）。

---

### 8.1 v1.9.2 审计结论：1.x 正式封版（原 8.0）

经 v1.9.2 最终收尾，P1/P2 问题全部清零：

1. ✅ `EpubStorage._get/_set/_remove` 已检查 `chrome.runtime.lastError`，失败时 reject（D-2026-01）。
2. ✅ `bookMeta` 写入引入 `_bookMetaQueue` 串行化，消除并发 RMW 覆盖窗口（D-2026-02）。
3. ✅ `getAllHighlights()` 增加全量 key 扫描，突破 recentBooks 上限约束（D-2026-03）。
4. ✅ `reader.js（v2.1 入口编排）` 全部 `style.display` 迁移为 class 控制，home/popup/reader 三入口 `style.*` 全量清零（D-2026-04）。

**style.* 迁移说明（v1.9.2 最终收口）**：
- `reader.js（v2.1 入口编排）` 中 `openBook`（3 处）、`setTheme`（1 处）、`showLoading`（1 处）共 5 处 `style.display` 已迁移为 `classList.add/toggle`。
- `reader.html` 移除 `#reader-main`、`#bottom-bar`、`#loading-overlay`、`#custom-theme-options` 的内联 `style="display:none"`。
- `reader.css` 新增 5 个辅助类：`.welcome-screen.is-hidden`、`.reader-main.is-visible`、`.bottom-bar.is-visible`、`.loading-overlay.is-hidden`、`.custom-theme-options.is-visible`。
- **唯一豁免**：`image-viewer.js` `style.transform`（动态平移+缩放计算值，无法静态化）→ v2.2.0 通过 CSS 自定义属性替代。

### P3（计划 v2.x）

- **D-2026-05**（v2.1.0）：`reader.js` 高耦合问题已通过四层拆分完成治理。
- **D-2026-06**（v2.1.0）：`DbGateway.getByFilename()` 死代码已删除。
- **D-2026-07**（v2.2.0）：`image-viewer.js` `style.transform` 豁免，计划 CSS 自定义属性替代。
- **D-2026-08**（v2.2.0）：ARIA 语义缺失，计划补全工具栏/面板/书架卡片。
- **D-2026-09**（v2.0.0）：阅读速度模型等权平均问题已在 v2.0.0 通过会话加权完成修复。
- **D-2026-10**（v2.0.0）：locations 生成阻塞主线程问题已在 v2.0.0 通过 idle 调度包装完成修复。

---


## 9. 附录：模块加载顺序

为确保依赖关系正确，`reader.html` 中的脚本加载必须遵循以下顺序：

1. **基础库**：`jszip.min.js`, `epub.min.js`
2. **工具层**：`db-gateway.js`, `utils.js`, `storage.js` (依赖前者)
3. **子模块**：`image-viewer.js`, `annotations.js`, `toc.js`, `search.js`, `bookmarks.js`, `highlights.js` (依赖工具层)
4. **主控制器**：`reader.js（v2.1 入口编排）` (必须最后加载，负责调度上述所有模块)


## v1.9 架构注记
- UI 显隐与视觉状态进一步收敛为 CSS class，减少 JS 内联样式写入。
- CSP 策略收敛后，样式来源统一至外联 CSS + 主题变量覆盖路径。
