# EPUB Reader — 模块与架构参考

版本：v2.5.6
更新：2026-07-13

本文档包含项目架构总览与每个模块的完整公开接口、参数类型、返回值和调用约束。

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
│  │ popup.js  │   │  │   reader.js(Controller) │   │   │
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

**书架渲染约束**：home 页书籍卡片可流式渲染，但必须按 `recentBooks` 原始索引替换对应骨架，不能按封面/元数据异步完成顺序 append；每轮书架刷新必须携带代次令牌，旧刷新返回后不得修改新一轮 DOM。

**首页异步错误隔离约束**：home 页主题和书架视图切换应先更新 UI；偏好读取/保存、书架刷新、标注刷新、删除和导出失败只能记录告警，不得阻断后续交互绑定或留下未处理 Promise 拒绝；书架与标注刷新必须忽略过期代次，避免旧请求覆盖最新筛选、排序或删除结果。v2.5.4 起，书架单本卡片的封面与 `bookMeta` 读取失败必须局部降级为无封面/无进度，不得让整轮流式渲染 Promise 失败或留下骨架。

**首页 DOM / 样式安全约束（v2.5.3）**：EPUB 元数据（书名、文件名、作者）不得拼进 `innerHTML` 模板或带引号的 HTML 属性；书架卡片可保留静态结构模板，但用户/书籍文本必须通过 `textContent` 写入，`title` 等属性必须通过 DOM 属性或 `setAttribute` 赋值。标注颜色进入 inline style 前必须经 `Utils.sanitizeColor()` 与默认色回退归一化，不得通过给任意 hex 字符串追加 alpha 后缀构造颜色。

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
│   │   ├── reader.js              # 主控制器（Orchestrator, <120 行）
│   │   ├── reader-runtime.js      # 生命周期与事件转发
│   │   ├── reader-state.js        # 集中状态管理
│   │   ├── reader-persistence.js  # 持久化策略
│   │   ├── reader-ui.js           # DOM 渲染与交互
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
│   │   └── utils.js               # 共享工具函数
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
│   ├── architecture.md
│   └── ROADMAP.md
├── CHANGELOG.md
└── README.md
```

---

## 4. 数据流与存储架构

### 4.1 书籍 ID 生成
使用 `SHA-256(filename + content[:64KB])` 生成 ID。截取前 64KB 平衡去重准确度与哈希耗时（~100ms）。

### 4.2 完整数据生命周期
1. **导入**：`generateBookId` → `storeFile` (IDB) → `enforceFileLRU`；Reader 页本地导入必须等待 `storeFile()` 落盘后再 `openBook()`。
2. **阅读**：`onLocationChanged` → `schedulePositionSave`（首次立即写入，连续变化 300ms 后补写最终位置）→ `bookMeta_<id>`。
3. **索引**：无缓存时先进入正文，再由 `scheduleLocationsGeneration` 在后台生成并写入 IndexedDB `locations(bookId)`。
4. **统计**：`visibilitychange` → `flushSpeedSession` 记录采样。
5. **清理**：用户主动删除时，`removeBook` 等待同书 `bookMeta` 写队列收尾，并行删除 7 项关联数据；自动 LRU 只删除 IndexedDB `files` 中超限的 EPUB 文件缓存，保留 recentBooks、bookMeta、highlights、bookmarks、covers 和 locations，避免误删阅读进度、书签与标注。

### 4.3 存储结构

```
chrome.storage.local
├── preferences              全局偏好设置
├── recentBooks              书架列表（最多 20 本，读改写串行合并）
├── bookMeta_<bookId>        位置 + 时间 + 速度（高频写，< 200 bytes）
│     ├── pos: { cfi, percentage, timestamp, locator? }
│     ├── time: number               累计阅读秒数
│     └── speed: { sampledSeconds, sampledProgress, sessions[], sessionCount }
├── highlights_<bookId>      高亮与笔记数组（中频写）
└── bookmarks_<bookId>       书签数组（低频写）

IndexedDB (DB v4)
├── files(bookId)            EPUB 原文件二进制    index: by_filename(non-unique)
├── covers(bookId)           封面 Blob
└── locations(bookId)        epub.js CFI 位置索引 JSON
```

---

## 5. 扩展机制与契约

- **MV3 生命周期**：SW 不持有内存状态，所有配置必须持久化。
- **Hooks 拦截机制**：通过 `rendition.hooks.content.register` 注入 iframe，拦截点击事件或注入层。
- **重分布绑定契约**：每次 `setLayout` 后，必须重新调用所有子模块的 `setBook/hookRendition`。
- **幂等绑定契约**：子模块不得假设 hook 一定早于 `display()`；不得假设同一 rendition 只会被 hook 一次。模块需用 rendition/document 级 guard 防止重复监听，并在 display 后挂载时补绑定当前 iframe。

---

## 6. Popup 约束（BUG-B 教训）

`display:none` 元素无法被程序 `.click()`，DevTools 打开时限制放宽。Chrome Extension popup 中：

| 约束 | 原因 |
|------|------|
| `popup.html` 必须使用内联 `<style>` | 外部 CSS 异步加载时序不可控 |
| `#file-input` 必须用物理隐藏（`width:0; height:0; opacity:0`） | Chrome 禁止对 `display:none` 元素 `.click()` |
| `popup.html` 不得包含 `<link rel="preconnect">` | manifest CSP 未配置 `connect-src` |
| 不使用 `showOpenFilePicker` | 需要 transient user activation |
| `emptyState` 显隐保留 `style.display` 直写（popup 特例） | popup 小入口保留既有可靠路径；reader/home 仍优先 classList |

**Popup 异步错误隔离约束**：打开文件、进入书架和 file input 事件必须先绑定，再异步加载最近阅读列表；最近阅读加载和移除书籍失败只能记录告警，不得阻断核心按钮或留下未处理 Promise 拒绝。

---

## 7. 模块接口参考

以下列出每个模块的完整公开接口、参数类型、返回值和调用约束。

---

### EpubStorage（utils/storage.js）

所有持久化操作的唯一入口。禁止在本文件以外直接调用 `chrome.storage.local` 或 `indexedDB`。

**v2.4.0 存储键常量**：所有 key 字符串统一声明在模块顶部的 `KEYS` 常量对象中，避免散落的硬编码字符串。per-book key 使用函数生成（`KEYS.bookMeta(id)`）。

### 偏好设置

```typescript
savePreferences(prefs: Partial<Preferences>): Promise<void>
getPreferences(): Promise<Preferences>
// Preferences: { theme, fontSize, fontFamily, lineHeight,
//               letterSpacing, paragraphIndent, spread, layout,
//               customBg, customText, homeView }
// savePreferences 必须通过内部队列串行执行 read-modify-write 增量合并
// 多入口并发保存时不得互相覆盖不同字段
```

### 最近书籍

```typescript
addRecentBook(book: RecentBook): Promise<void>
// RecentBook: { id, title, author, filename, lastOpened? }
// lastOpened 由 addRecentBook 自动设置为 Date.now()
// 列表上限 20 本，超出时删除最旧
// addRecentBook/removeRecentBook 必须通过内部队列串行执行 read-modify-write
// 并发导入、删除或入口刷新不得互相覆盖 recentBooks 列表

getRecentBooks(): Promise<RecentBook[]>

removeRecentBook(bookId: string): Promise<void>
```

### 书籍元数据（v1.7.0）

```typescript
getBookMeta(bookId: string): Promise<BookMeta | null>
// BookMeta: {
//   pos:   { cfi: string, percentage: number, timestamp: number, locator?: PositionLocator } | null,
//   time:  number,   // 累计阅读秒数
//   speed: { 
//     sampledSeconds: number, 
//     sampledProgress: number,
//     sessions: Array<{seconds, progress, timestamp, isJump}>, // v2.2.0
//     sessionCount: number                                   // v2.2.0
//   }
// }
// 首次调用自动迁移 v1.6.0 的 pos_/time_ 旧 key
// lazy migration 必须进入同书 bookMeta 队列，不能绕过队列直接 _set

saveBookMeta(bookId: string, meta: BookMeta): Promise<void>
// 整体覆写，批量更新时使用
// 整体覆写也必须进入同书 bookMeta 队列，遵循与 patch 相同的调用顺序

savePosition(bookId: string, cfi: string, percentage?: number, locator?: PositionLocator): Promise<void>
// Patch pos 字段，保留其他字段不变
// 同书 bookMeta patch 必须通过内部队列串行执行，避免 pos/time/speed 互相覆盖
// 首次 patch 创建 bookMeta 时应吸收旧版 pos_/time_ 字段，再应用当前 patch

getPosition(bookId: string): Promise<Position | null>
// Position: { cfi, percentage, timestamp, locator? }

removePosition(bookId: string): Promise<void>
// 清除 pos 字段，必须进入同书队列；无现存 bookMeta 时不得新建空 meta

saveReadingTime(bookId: string, seconds: number): Promise<void>
getReadingTime(bookId: string): Promise<number>
removeReadingTime(bookId: string): Promise<void>
// 清除 time 字段，必须进入同书队列；无现存 bookMeta 时不得新建空 meta

saveReadingSpeed(bookId: string, speed: Speed): Promise<void>
// Speed: { sampledSeconds: number, sampledProgress: number }
getReadingSpeed(bookId: string): Promise<Speed>

removeBookMeta(bookId: string): Promise<void>
// 同时删除 bookMeta_/pos_/time_ 三个 key（v1.6.0 兼容清理）
// 删除前会等待同 bookId 的排队写入结束，删除期间跳过新的 bookMeta patch
// 内部队列 Promise 必须吞掉已返回给调用方的写入失败，避免 finally 派生未处理拒绝
```

### 高亮

```typescript
getHighlights(bookId: string): Promise<Highlight[]>
// Highlight: { cfi, text, color, note, timestamp }

saveHighlights(bookId: string, highlights: Highlight[]): Promise<void>
// 全量覆写，调用方负责维护数组

removeHighlights(bookId: string): Promise<void>

getAllHighlights(): Promise<Record<string, Highlight[]>>
// 遍历 recentBooks 并行读取，返回 { bookId: highlights[] }
// 顺带清理遗留的 v1.6.0 highlightKeys key
```

### 书签

```typescript
getBookmarks(bookId: string): Promise<Bookmark[]>
// Bookmark: { cfi, chapter, progress, timestamp }
// progress: 0-100 百分比

saveBookmarks(bookId: string, bookmarks: Bookmark[]): Promise<void>
removeBookmarks(bookId: string): Promise<void>
```

### 封面（IndexedDB）

```typescript
saveCover(bookId: string, blob: Blob): Promise<void>
getCover(bookId: string): Promise<Blob | null>
removeCover(bookId: string): Promise<void>
```

### Locations（IndexedDB）

```typescript
saveLocations(bookId: string, locationsJSON: string): Promise<void>
getLocations(bookId: string): Promise<string | null>
removeLocations(bookId: string): Promise<void>
```

**v2.2.1 运行约束**：
- Reader 首开无 locations 缓存时，正文渲染不可再等待 `saveLocations/getLocations` 完成。
- `locations` 只影响精确进度、ETA 与百分比跳转，不得阻塞基础阅读流程。

### 文件（IndexedDB）

```typescript
storeFile(filename: string, data: Uint8Array, bookId: string): Promise<void>
// 写入后自动调用 enforceFileLRU(10)

getFile(bookId: string): Promise<FileRecord | null>
// FileRecord: { bookId, filename, data, timestamp }

removeFile(bookId: string): Promise<void>

enforceFileLRU(maxCount?: number = 10): Promise<void>
// 串行淘汰最旧的超出 maxCount 的文件（逐项 try/catch）
// v2.4.7：自动 LRU 仅删除 EPUB 文件缓存，保留 recentBooks、bookMeta、covers、highlights、locations、bookmarks
// v2.4.0：改为串行执行并逐项隔离失败
```

### 级联删除

```typescript
removeBook(bookId: string): Promise<void>
// 仅用于用户主动删除/显式移除；并行执行 7 项删除：
// removeRecentBook + removeBookMeta + removeCover +
// removeHighlights + removeLocations + removeBookmarks + removeFile
// v2.4.7：删除期间阻止同上下文 bookMeta 队列回写孤立记录
```

### 工具

```typescript
generateBookId(filename: string, arrayBuffer: ArrayBuffer): Promise<string>
// SHA-256(encode(filename) + arrayBuffer[:64KB])
// 返回 'book_<32位十六进制>'
```

---

## DbGateway（utils/db-gateway.js）

IndexedDB 单例封装。通常不直接调用，通过 EpubStorage 间接使用。

```typescript
DbGateway.connect(): Promise<IDBDatabase>
// 返回单例 DB 连接；连续失败 3 次后抛出错误拒绝重试
// 当前连接收到 versionchange 时主动 close 并使缓存失效；浏览器 close 后同样失效，下一次访问自动重连
// 连接失效必须按当前 Promise 身份校验，旧连接迟到事件不得清除已建立的新连接缓存

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

## Utils（utils/utils.js）

以纯函数为主，`escapeHtml` 依赖浏览器 DOM API (`document.createElement`) 完成安全转义。

```typescript
Utils.escapeHtml(text: any): string
// 将任意值转为元素正文上下文可用的安全 HTML 字符串
// 内部用 DOM textContent，无正则漏洞；不要用于带引号的 HTML 属性拼接

Utils.formatDate(timestamp: number, fallback?: string = '未知时间'): string
// 相对时间（刚刚 / N分钟前 / N小时前 / N天前 / 本地日期）

Utils.formatDuration(seconds: number): string
// 0秒 / N秒 / N分钟 / N小时N分

Utils.formatMinutes(minutes: number): string
// 0分钟 / N分钟 / N小时N分钟
// 用于 ETA 显示

Utils.sanitizeColor(color: string): string
// 高亮颜色白名单校验（CSS 有效 hex 长度 3/4/6/8 位或 transparent）
// 通过返回原值；空值/transparent 返回 transparent；不通过返回默认高亮色 #ffeb3b

Utils.normalizePercent(value: any): number
// 将 storage / 外部输入中的进度归一化为 0-100 有限数字
// 进入 UI 文本、CSS 自定义属性或进度条前必须使用
```

---

## ReaderState（reader/reader-state.js）

IIFE 模块，暴露为 `window.ReaderState`。声明状态结构与工具函数，禁止引入任何 DOM 操作或业务逻辑。

### 状态字段

```typescript
state.hasLocations: boolean
state.locationsStatus: 'idle' | 'pending' | 'generating' | 'ready' | 'failed'
state.locationsBreak: number | null
state.locationsError: string | null
state.lastPositionSave: Promise<void> | null
state.currentStableCfi: string | null
state.currentStableLocator: object | null
state.isRestoringPosition: boolean
state.isRestoreAnchorProtected: boolean
state.isLayoutStable: boolean
state.isResizing: boolean
```

### 导出工具函数（v2.4.0）

```typescript
// 共享工具函数 — 供 reader 模块与功能模块共同使用
findTocItem(navigation: object[], href: string): object | null
// 在 TOC navigation 中按路径边界精确匹配当前 href，忽略 fragment，支持 3 级嵌套

buildPrefsSignature(prefs: object): string
// 生成偏好设置签名字符串，用于 locator 布局变化检测
```

**v2.4.6 运行约束**：
- `hasLocations` 表示当前书籍是否已有可用定位索引。
- `locationsStatus` 驱动底部状态栏与 ETA 降级逻辑。
- `lastPositionSave` 记录最近一次位置写入 Promise，供 flush/unmount 路径等待。
- `currentStableCfi` 保存可落盘位置锚点：分页与滚动模式均以 `location.start.cfi` 为兼容主锚点。
- `currentStableLocator` 保存 `displayed-page` 信息（layout/href/index/page/total/sourceCfi/prefsSignature），分页模式可额外携带 `restoreCfi` 作为 display 恢复锚点；`restoreCfi` 只有在 `sourceCfi === pos.cfi` 时可信，locator 只用于校验与诊断，不驱动 `next()/prev()` 翻页。
- 恢复期 `relocated.start.cfi` 不得覆盖 `currentStableCfi`。
- `isRestoringPosition` 用于区分 `openBook()` 恢复显示与用户正常翻页。
- `isRestoreAnchorProtected` 用于保护刚恢复的分页锚点；用户导航前，locations 就绪和刷新 flush 都不得用 epub.js 页边界 CFI 覆盖它。
- `isLayoutStable` 在 `openBook()` display 期间为 false，阻止 `next()`/`prev()`/`displayPercentage()` 执行；locations 就绪后设为 true。
- `isResizing` 在窗口 resize 防抖期间为 true，阻止 relocated 事件写入不完整位置。
- 切书或 `resetReadingSession()` 时，上述字段必须恢复到初始值。

---

## ReaderRuntime（reader/reader-runtime.js）

IIFE 模块，暴露为 `window.ReaderRuntime`。

```typescript
openBook(
  fileData: ArrayBuffer | Uint8Array | Blob,
  bookId: string,
  fileName: string,
  targetCfi?: string | null
): Promise<void>

setLayout(layout: 'paginated' | 'scrolled'): Promise<void>
next(): Promise<void>
prev(): Promise<void>
displayPercentage(percentage: number): Promise<void>

scheduleLocationsGeneration(task: Function): void
```

### 内部共享辅助函数

`openBook()` 与 `setLayout()` 共享两个私有辅助函数，消除 rendition 创建与模块挂载的重复代码：

```typescript
// rendition 工厂 — 创建 rendition、注入自定义样式、应用主题
_createRendition(layout: 'paginated' | 'scrolled'): Rendition

// 模块/事件挂钩 — 绑定 theme、ImageViewer、Annotations、键盘事件、relocated/displayed 监听
_hookRenditionEvents(rendition: Rendition, theme?: string): void
```

### 命名常量（v2.4.0）

模块顶部声明所有魔法数字为命名常量，避免散落的硬编码值：

| 常量 | 默认值 | 用途 |
|------|--------|------|
| `LOCATIONS_GENERATION_TIMEOUT_MS` | 1500 | requestIdleCallback 超时 |
| `LARGE_EPUB_THRESHOLD_BYTES` | 3MB | 大书阈值 |
| `LOCATIONS_BREAK_LARGE` | 4800 | 大书 locations break |
| `MEDIUM_EPUB_THRESHOLD_BYTES` | 1MB | 中书阈值 |
| `LOCATIONS_BREAK_MEDIUM` | 3200 | 中书 locations break |
| `LOCATIONS_BREAK_SMALL` | 1600 | 小书 locations break |
| `FONT_READY_TIMEOUT_MS` | 300 | 字体加载超时 |
| `GAP_SCROLLED_PX` | 48 | 滚动模式间距 |
| `GAP_PAGINATED_PX` | 80 | 分页模式间距 |
| `POST_DISPLAY_FOCUS_DELAY_MS` | 100 | display 后聚焦延迟 |
| `POST_OPEN_FOCUS_DELAY_MS` | 300 | openBook 后聚焦延迟 |
| `NAV_DEBOUNCE_MS` | 150 | 翻页防抖 |
| `RESTORE_DIRECT_REDISPLAY_MAX_ATTEMPTS` | 1 | 恢复期同 CFI 直接重放次数上限 |

**v2.4.7 行为约束**：
- `_createRendition` 由 `openBook` 和 `setLayout` 共享，确保两种路径的 rendition 配置完全一致。
- `_hookRenditionEvents` 由 `openBook` 和 `setLayout` 共享，确保模块挂载逻辑一致。
- `rendition.on('relocated')`、`displayed` 延迟聚焦、iframe 用户意图事件和 `display()` wrapper 必须校验触发者仍是当前 `state.rendition`；切书或布局重建后，旧 `rendition` 迟到事件不得写入当前书位置、抢焦点或解除恢复锚点保护。
- `openBook()` 打开新书前必须先收口旧书：`flushPositionSave()`、保存阅读时长、`flushSpeedSession(null)`，随后 `moduleLifecycle.unmount()`、销毁旧 `rendition` 与旧 `book`，再重置阅读 session。
- 新书加载期间必须设置 `isBookLoaded=false`、`isLayoutStable=false`、`navLock=false`，直到首屏 `display()` 和恢复逻辑完成后再允许导航和计时写入。
- `loadFileByBookId()` 应直接把缓存 `record.data` 交给 `openBook()`，由 `normalizeBookData()` 统一处理 `ArrayBuffer` / `Blob` / `TypedArray`，避免非零 offset 视图被扩展成完整 backing buffer。
- `setLayout()` 恢复保护：布局切换期间 `isRestoringPosition = true`，await `display(currentCfi)` + 双帧等待后解除，防止 relocated 事件在新布局下以不同 CFI 覆盖正确位置。
- `setLayout()` 中销毁旧 rendition、创建/挂钩新 rendition、功能模块重绑或 `display()` 任一步失败，都必须释放 `isRestoringPosition`，避免后续真实阅读位置被长期抑制写入。
- `setLayout()` 保存 layout 偏好失败时只记录告警，不得阻断当前布局切换，也不得产生未处理 Promise 拒绝。
- 若命中 `getLocations(bookId)`，应立即加载缓存索引并恢复精确进度。
- 若未命中缓存，`openBook()` 必须先完成正文显示，再异步调度 `locations.generate()`。
- 调用 `rendition.display(displayCfi)` 前，应先把 `displayCfi` 初始化到 `state.currentStableCfi`，确保恢复期关闭页面不会保存 epub.js 回报的 page-start CFI。
- 分页模式下，若保存位置包含与 `pos.cfi` 同源的 `locator.restoreCfi`，恢复显示应优先使用该 CFI；`state.currentStableCfi` 仍保持 `pos.cfi`，防止关闭刷新时把兼容主锚点改写成临时显示锚点。
- fresh rendition 首次 `display(displayCfi)` 后，`currentLocation()` 可能短暂回报同章节旧分页；若 href/index、页总数、偏好签名均匹配且页码不一致，只允许在恢复保护期内重放一次同一个 `displayCfi`，不得调用 `next()/prev()`。
- 若缓存 locations 可用且 `pos.cfi` 对应百分比与 `pos.percentage` 明显不一致，应视为分裂快照，用 `locations.cfiFromPercentage()` 兜底恢复并清空旧 locator。
- 若缓存 locations 加载失败，应按无缓存处理：先完成正文显示，再异步调度 locations 重建，不得阻断 `openBook()`。
- 分页模式下，`displayCfi` 恢复完成后应设置 `isRestoreAnchorProtected=true`；`next()`/`prev()`/`displayPercentage()` 以及非恢复期的 `rendition.display()` 会解除该保护。
- `isRestoringPosition=false` 和 `isLayoutStable=true` 必须在 `_correctRestoredPage` 后立即设置，不可移入 locations 索引段（含 `await getLocations`），否则 `onRelocated` 会长时间跳过位置写入。
- `isLayoutStable = false` 期间，`next()`/`prev()`/`displayPercentage()` 不执行任何导航。
- `_correctRestoredPage` 只做章节/签名/页总数校验和同 CFI 直接重放；它不得执行翻页导航。若重放后仍无法与 locator 页码一致，保留 CFI 锚点与保护，不把短暂旧 `currentLocation()` 写回 storage。
- `setLayout()` 恢复保护：布局切换期间 `isRestoringPosition = true`，await `display(currentCfi)` + 双帧等待后解除，防止 relocated 事件在新布局下以不同 CFI 覆盖正确位置。
- locations cache-hit 和 generate-complete 路径中，若 `isRestoreAnchorProtected=true`，必须用 `state.currentStableCfi` 计算进度并跳过 `persistence.onRelocated`；否则仅在 `currentLocation().start.cfi !== state.currentStableCfi` 时转交 relocated。
- 窗口 resize 期间 `isResizing = true`，防抖结束后 `rendition.resize()` 重排并清除标志。
- 后台生成失败只允许降级进度能力，不得中断当前阅读会话。

---

## ReaderPersistence（reader/reader-persistence.js）

IIFE 模块，暴露为 `window.ReaderPersistence`。本层负责阅读位置、时间、速度的持久化逻辑，**不持有任何 DOM 引用**。

```typescript
mount(context: { bookId, book, rendition, state, ui, runtime }): void
unmount(): void

onRelocated(location: object): void
schedulePositionSave(bookId: string, cfi: string, percent?: number | null): void
flushPositionSave(): Promise<void>
updateReadingStats(): void
_isPositionMeaningfullyChanged(newCfi: string, oldCfi: string): boolean
```

### DOM 委托（v2.4.0）

本层所有 DOM 更新委托给 `reader-ui.js` 辅助函数：

| DOM 操作 | 委托目标 |
|----------|----------|
| 章节标题更新 | `ui.updateChapterTitle(chapterName)` |
| 书签按钮状态 | `ui.updateBookmarkButtonState(isBookmarked)` |
| 阅读统计文本 | `ui.updateReadingStatsText(etaText, progressText)` |

### 命名常量（v2.4.0）

| 常量 | 默认值 | 用途 |
|------|--------|------|
| `POSITION_SAVE_IMMEDIATE_MS` | 0 | 首次立即写入 |
| `POSITION_SAVE_DEBOUNCE_MS` | 300 | 连续变化防抖 |
| `SPEED_SAMPLE_INTERVAL_MS` | 30000 | 速度采样间隔 |
| `SPEED_MIN_PROGRESS_DELTA` | 0.001 | 最小进度变化阈值 |
| `SPEED_JUMP_THRESHOLD` | 0.05 | 跳读判定阈值 |
| `SPEED_WEIGHT_NORMAL` | 1.0 | 正常阅读权重 |
| `SPEED_WEIGHT_JUMP` | 0.3 | 跳读权重 |
| `SPEED_DECAY_BETA` | 0.8 | 指数衰减因子 |
| `SPEED_MIN_SESSIONS` | 3 | 最小采样会话数 |
| `READING_STATS_DEBOUNCE_MS` | 500 | 统计更新防抖 |

**v2.4.6 行为约束**：
- `schedulePositionSave()` 在没有待处理防抖写入时立即启动一次位置保存。
- 连续位置变化仍保留 300ms 防抖，用最终 `pos.cfi + locator.restoreCfi` 覆盖首个位置。
- `onRelocated()` 的 UI 更新与即时持久化优先使用事件参数；`rendition.currentLocation()` 在同一 tick 内可能仍是上一页，只在事件缺失 CFI 时兜底。
- `_isPositionMeaningfullyChanged()` 字符串精确比较新旧 CFI；即使 CFI 相同，只要 locator、`restoreCfi` 或百分比变化，也必须触发 `schedulePositionSave()`。
- `flushPositionSave()` 必须清理防抖 timer；若已有待执行的防抖位置写入，直接保存 `currentStableCfi/currentStableLocator/lastPercent`，不得重新采样旧 `currentLocation()` 覆盖刚翻到的新页；仅在无 pending 且 `isRestoreAnchorProtected=false` 时，刷新/关闭前重新采样 `currentLocation()` 并重建完整 position；若保护仍为 true，直接保存当前稳定锚点。
- 分页恢复锚点生成依赖 `rendition.getContents()`、`caretRangeFromPoint/caretPositionFromPoint` 与 `contents.cfiFromRange()`，优先从当前 displayed page 所在列的可视区域取样；取样失败时再用 `contents.range(sourceCfi)` 从 `start.cfi` 向页内轻微前移。locator 必须同时写入 `sourceCfi`。生成失败时必须降级为无 `restoreCfi` 的 `location.start.cfi`，不得影响阅读。
- `onRelocated()` 在 `isRestoringPosition=true` 或 `isRestoreAnchorProtected=true` 时不得替换 `state.currentStableCfi`，但仍应更新进度、章节标题、TOC 与书签按钮状态。
- 书签按钮状态查询必须只让最新一次结果更新 UI；快速翻页或卸载时，旧页/旧书的 `Bookmarks.isBookmarked()` 慢返回不得覆盖当前页状态。
- `updateReadingStats()` 在 `hasLocations=false` 时，ETA 必须显示为 `--`。
- `locationsStatus` 为 `pending/generating/failed` 时，应通过 UI 同步"生成中/不可用"状态，而不是显示误导性的精确进度。
- `mount()` 注册 `window.addEventListener('beforeunload', _onBeforeUnload)`，`unmount()` 清理。`_onBeforeUnload` 在 `isBookLoaded && currentBookId` 时调用 `flushPositionSave()` 兜底。
- 位置保存和阅读时长保存失败时只记录告警，不得让 `schedulePositionSave()`、`visibilitychange`、`beforeunload` 或定时写入产生未处理 Promise 拒绝。
---

## ReaderUi（reader/reader-ui.js）

IIFE 模块，暴露为 `window.ReaderUi`。本层是 Reader 唯一的 DOM 操作入口。

```typescript
// UI 辅助函数（供 persistence 层委托调用）
clearReaderError(): void
setBookTitle(title: string): void
setReaderDimmed(dimmed: boolean): void
updateChapterTitle(chapterName: string): void
updateBookmarkButtonState(isBookmarked: boolean): void
updateReadingStatsText(etaText: string, progressText: string): void

// 布局与主题
applyThemeToRendition(theme: string): void
injectCustomStyleElement(contents: object): void
setupRenditionKeyEvents(rendition, persistence, nav): void
ensureFocus(): void

// 面板控制
togglePanel(panelName: string): void
closeAllPanels(): void

// resize
bindResize(rendition, state, persistence): void
```

### 命名常量（v2.4.0）

| 常量 | 默认值 | 用途 |
|------|--------|------|
| `RESIZE_DEBOUNCE_MS` | 500 | 窗口 resize 防抖 |

**v2.3.3 行为约束**：
- `progress-location` 用于承载非阻塞定位索引状态。
- 该状态更新不得重新启用全屏 `loading-overlay`，避免回退到"先等索引再阅读"的旧行为。
- `_withCfiLock` 保存/恢复 CFI 期间同步设置 `isRestoringPosition = true`，`await display()` + 双帧等待后释除，防止 relocated 事件在新布局下以不同 CFI 覆盖正确位置。
- `bindResize` 监听窗口 resize，防抖 500ms 后调用 `rendition.resize()` + CFI 快照恢复，`isResizing` 期间阻止 relocated 事件写入。

**v2.4.0 架构约束**：
- 所有 DOM 可见性控制使用 CSS 类（`is-hidden`、`is-visible`、面板类），禁止 `style.*` 直写（`image-viewer.js` 动态 transform 和 `highlights.js` 动态弹窗定位除外）。
- persistence 层通过本层辅助函数委托 DOM 更新，不直接持有元素引用。
- Reader 页本地导入 EPUB 时，`openLocalFile()` 必须等待 `EpubStorage.storeFile()` 成功后再调用 `runtime.openBook()`；若缓存失败，应显示加载错误，避免产生无法重新打开的书架记录。
- `bindRuntime()` 必须幂等；重复调用只更新当前 runtime 引用，不得重复注册 document/window/按钮级顶层事件监听。
- 主题、颜色、字号、行距和字体偏好保存失败时，只记录告警并保留当前 UI 更新，不得产生未处理 Promise 拒绝。

---

## Highlights（reader/highlights.js）

IIFE 单例，暴露为 `window.Highlights`。

```typescript
Highlights.init(): void
// 注册 window mousedown 监听（一次，不可重复调用）
// 注册 btn-show-toolbar 点击监听

Highlights.setBookDetails(
  bookId: string,
  fileName: string,
  rendition: Rendition
): Promise<void>
// 绑定新书，加载已有高亮，注册 rendition.on('selected')
// 每次切换书籍或布局时调用
// v2.3.1：必须补绑定 rendition.getContents() 中已存在 iframe 的空白点击关闭监听
// v2.4.12：异步加载和保存必须捕获 bookId/rendition 上下文；切书后旧请求不得渲染或保存到新书
// getHighlights/saveHighlights 失败应记录告警并降级，不得阻断 Reader 打开或产生未处理拒绝
// v2.5.3：只有显式 color === 'transparent' 才视为纯笔记；缺失/损坏颜色必须回退默认高亮色，避免不可见高亮

Highlights.closePanels(): void
// 关闭工具栏和笔记弹窗，清除所有 CFI 状态

Highlights.mount(context): void
Highlights.unmount(): void
// v2.2.0：接入子层统一调度
```

**内部数据结构**：

```javascript
highlights: [
  {
    cfi:       string,   // epub.js CFI 范围字符串
    text:      string,   // 选中文本（存储时截取）
    color:     string,   // '#ffeb3b' | '#ff6b6b' | ... | 'transparent'（纯笔记）
    note:      string,   // 用户笔记内容
    timestamp: number    // 创建时间戳
  }
]
```

---

## Bookmarks（reader/bookmarks.js）

IIFE 单例，暴露为 `window.Bookmarks`。

```typescript
Bookmarks.init(): void
// 注册面板开关事件

Bookmarks.setBook(bookId: string, book: Book, rendition: Rendition): void
// 绑定新书，加载书签列表

Bookmarks.toggle(cfi: string, chapterName: string, progress: number): Promise<void>
// 切换书签状态（存在则删除，不存在则添加）
// progress: 0-1 小数，内部转为 0-100
// 异步读写必须捕获发起时的 bookId；切书后旧请求不得渲染或保存到新书
// 面板自动加载和按钮事件失败时必须记录告警，不得产生未处理 Promise 拒绝

Bookmarks.isBookmarked(cfi: string): Promise<boolean>

Bookmarks.closePanel(): void
Bookmarks.togglePanel(): void

Bookmarks.reset(): void
// 切换书籍时调用，清空列表和状态

Bookmarks.mount(context): void
Bookmarks.unmount(): void
// v2.2.0：接入子层统一调度
```

---

## TOC（reader/toc.js）

IIFE 单例，暴露为 `window.TOC`。

> v2.1.1：新增 `mount(context)` / `unmount()`，由 reader 入口统一挂载。

```typescript
TOC.init(): void
// 注册面板开关和 overlay 点击事件、键盘快捷键 T

TOC.build(navigation: Navigation, rendition: Rendition): void
// 从 epub.js navigation 构建目录树，支持 3 级嵌套

TOC.setActive(href: string): void
// 在目录中高亮当前章节（由 onLocationChanged 调用）

TOC.open(): void
TOC.close(): void
TOC.toggle(): void
TOC.reset(): void
```

---

## Search（reader/search.js）

IIFE 单例，暴露为 `window.Search`。

```typescript
Search.init(): void
// 注册 DOM 事件和键盘快捷键 F

Search.setBook(book: Book, rendition: Rendition): void
// 绑定新书，取消旧搜索任务，先清理旧 rendition 上的搜索高亮，再清空搜索结果

Search.togglePanel(): void
Search.closePanel(): void
Search.reset(): void
// 切换书籍时调用，取消进行中的搜索
// v2.2.3：关闭/重置进行中的搜索必须恢复搜索按钮 disabled=false
// v2.4.13：setBook/closePanel/reset 必须递增 searchId 使旧搜索失效；增量渲染和结果点击必须校验 searchId，旧书慢返回不得写入或驱动新书
// v2.5.1：搜索结果上限必须在每章结果合并前裁剪，单章超量命中不得越过 _SEARCH_MAX_RESULTS 渲染上限

Search.mount(context): void
Search.unmount(): void
// v2.1.1：接入 Reader 统一生命周期
```

---

## ImageViewer（reader/image-viewer.js）

IIFE 单例，暴露为 `window.ImageViewer`。

```typescript
ImageViewer.init(): void
// 注册缩放、拖拽、键盘事件

ImageViewer.hookRendition(rendition: Rendition): void
// 在 rendition.hooks.content 中注册图片 click 拦截
// v2.3.1：同一 rendition/document 幂等，且 late hook 时补处理当前 getContents()
// v2.4.13：hook 与图片点击必须捕获 rendition 上下文；切书或布局重建后，旧 iframe 图片点击不得打开当前书籍页面的图片查看器

ImageViewer.mount(context): void
ImageViewer.unmount(): void
// v2.1.1：接入 Reader 统一生命周期

ImageViewer.open(src: string): void
// 打开查看器，显示指定 src 的图片

ImageViewer.close(): void
```

---

## Annotations（reader/annotations.js）

IIFE 单例，暴露为 `window.Annotations`。

```typescript
Annotations.init(): void
Annotations.setBook(book: Book): void
Annotations.hookRendition(rendition: Rendition): void
Annotations.mount(context): void
Annotations.unmount(): void
// 注册 EPUB 内联注释链接的点击处理
// v2.4.13：hook、点击、异步加载和弹窗跳转必须捕获 book/rendition 上下文；切书或布局重建后，旧 iframe 与旧请求不得显示到新书或驱动新 rendition
```

**v2.2.3 行为约束**：
- `mount(context)` 必须确保 Escape 键监听已绑定；`unmount()` 解除后，下一次 mount 要能恢复。

**v2.3.1 行为约束**：
- `hookRendition()` 对同一 rendition 只能注册一次 `hooks.content` callback。
- 对同一 contents document 只能绑定一次注释捕获监听；若调用时 iframe 已存在，必须通过 `rendition.getContents()` 补绑定。

**v2.4.14 代码质量约束**：
- `sup` 祖先/后代判断统一走 `_hasSup()`，不得在 `isBackLink()` / `isFootnoteLink()` 中重复散落 `closest('sup')` + `querySelector('sup')`。
- href 章节与 fragment 解析统一走 `_parseHref()`，不得在模块内新增 `split('#')` 解析路径。
- 注释内容块标签、分页补偿等待时间和 TOC-like list 阈值必须保持模块级常量，避免在热路径中重复构造或散落魔法数字。
- last-resort fallback 提示必须使用 `.annotation-fallback-hint`，不得重新拼接 inline style 字符串。

**v2.4.14 算法约束**：
- 当链接没有真实 `<sup>` 但 `computedStyle.verticalAlign` 为 `super/sub/top/bottom` 时，可作为脚注引用的强正向结构信号；该检测只能在便宜的字符串与 DOM gate 后触发。
- 长链接文本若占父块文本 80% 以上，应视为目录/导航式孤立链接并排除，避免扁平 `<p><a>章节标题</a></p>` 或 TOC 变体被 fragment 命中误判为脚注。
- `_extractContent()` 必须保留 2000 字文本安全阀，超长内容需截断并提示跳转原文；空锚点目标应沿后续 sibling 收集正文，在 `<hr>`、`H1-H6` 或下一个带 id/name 的 `<a>` 处停止。

**v2.4.16 数字 marker 约束**：
- `noteTextMarker` 的纯数字分支只能接受 1-3 位数字；四位数字默认按年份/正文引用风险处理，不得直接视为脚注 marker。
- `_isFourDigitNumberMarker()` 必须在 class/fragment 等启发式正向信号前排除四位数字文本，避免 `1984` / `2023` 等正文链接因 `#note2023` 被误判。
- 显式 EPUB 语义（如 `epub:type="noteref"` 或等价 role）在四位数字排除前已经返回，可作为四位数字脚注的唯一白名单。

**v2.4.17 同文档拓扑约束**：
- 同文档 `href="#fragment"` 目标查找只做一次，并在 class/fragment 弱阳性判断和后续 target analysis 中复用。
- `_isSameDocumentTargetBeforeSource()` 使用 `compareDocumentPosition()` 判断目标是否位于源链接之前；断连节点或跨 document 节点不得参与负向判断。
- 目标前置只作为弱负向信号：它只能抑制 `class/id` 或 fragment 形态带来的弱阳性，不得覆盖 `epub:type="noteref"`、role 语义、`<sup>` / CSS 上标或明确 footnote 容器。

**v2.5.0 跨文档拓扑约束**：
- `_buildDocContext(doc, contents, book)` 必须在单个 iframe 上下文内基于 `contents.sectionIndex` 与 book spine 构建 `currentSpineIndex/currentSpineHref` 和 href 到 spine index 的映射；spine 信息缺失时必须退回旧行为。
- `_isCrossDocumentTargetBeforeSource()` 只判断跨文件目标 section 是否位于当前 section 之前，并且与同文档前置一样只能作为弱负向信号：压低 class/id 与 fragment 弱阳性，不得覆盖显式 EPUB 语义、role、`<sup>` / CSS 上标或明确 footnote 容器。
- section href 规范化和相对路径解析必须集中在 `_normalizeSectionHref()` / `_resolveRelativeSectionHref()`；`_loadFromBook()` 的相对 section 查找与分类阶段的 spine index 查找应共享该逻辑，避免 `../` 解析漂移。

**v2.4.18 FB2 兼容约束**：
- `_buildDocContext()` 必须把 `body[name="notes"]`、`body[name="comments"]` 及其 `section` 下的链接加入 `footnoteSectionNodes`，避免 FB2 注释区内回链被当作正文脚注引用。
- 同文档 target analysis 必须把目标位于 `body[name="notes"]` / `body[name="comments"]` 内视为明确 footnote 容器信号。
- FB2 容器识别只能增强注释区/目标容器判断，不得绕过现有全局 TOC、孤立长链接、四位年份和上下文生命周期守卫。

**v2.4.15 性能约束**：
- 跨文档注释加载必须经过 `_loadSectionDocument()`，优先命中 `_sectionDocCache`，未命中时再调用 `section.load()`。
- `_sectionDocCache` 只缓存当前书生命周期内的已解析 section 内容树，容量由 `_FOOTNOTE_SECTION_CACHE_LIMIT = 50` 控制；缓存读命中必须刷新 LRU 顺序。
- `setBook()` 发现 book 实例变化以及 `unmount()` 时必须清空 `_sectionDocCache`，避免旧书尾注内容污染新书。

**v2.4.7 安全约束**：
- 注释弹窗展示 EPUB 内联 HTML 前，必须用 template DOM 解析后逐属性清洗，移除 `on*` 事件属性、`srcdoc`，并将 `href/src/xlink:href` 中的 `javascript:` URL 改为 `#`；不得仅依赖正则处理 quoted href。

---

## 模块加载顺序（reader.html）

```html
<!-- 基础库 -->
<script src="../lib/jszip.min.js"></script>
<script src="../lib/epub.min.js"></script>

<!-- 工具层（无依赖） -->
<script src="../utils/db-gateway.js"></script>
<script src="../utils/utils.js"></script>
<script src="../utils/storage.js"></script>  <!-- 依赖 DbGateway -->

<!-- 功能模块（依赖 EpubStorage，互不依赖） -->
<script src="image-viewer.js"></script>
<script src="annotations.js"></script>
<script src="toc.js"></script>
<script src="search.js"></script>
<script src="bookmarks.js"></script>
<script src="highlights.js"></script>

<!-- 主控制器（Orchestrator） -->
<script src="reader-state.js"></script>
<script src="reader-ui.js"></script>
<script src="reader-persistence.js"></script>
<script src="reader-runtime.js"></script>
<script src="reader.js"></script>
```

**约束**：reader.js 必须最后加载。工具层模块（db-gateway、utils、storage）必须在功能模块前加载。入口本地脚本不使用手动查询串刷新缓存；Chrome 扩展更新/重新加载会刷新扩展资源，保留查询串只会增加 HTML、测试和文档同步成本。

**v2.4.9 IIFE 规范**：全部 11 个 reader 模块统一使用 `(function () { 'use strict'; ... window.XXX = XXX; })();` 封装，避免全局变量污染。功能模块（annotations、bookmarks、toc、search、highlights、image-viewer）与四层架构模块（reader-state、reader-runtime、reader-persistence、reader-ui）均遵循此规范，公开契约测试会校验功能模块挂载到 `window.XXX`。

**v2.4.8 生命周期约束**：功能模块 `init()` 必须按 document 幂等；同一 document 上重复调用不得重复注册按钮、键盘、遮罩或 window 级顶层监听。测试环境切换 document 时允许重新绑定新 DOM。
