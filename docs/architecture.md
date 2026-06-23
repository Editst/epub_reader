# EPUB Reader — 模块与架构参考

版本：v2.3.1  
更新：2026-06-24

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
├── CHANGELOG.md
├── README.md
└── ROADMAP.md
```

---

## 4. 数据流与存储架构

### 4.1 书籍 ID 生成
使用 `SHA-256(filename + content[:64KB])` 生成 ID。截取前 64KB 平衡去重准确度与哈希耗时（~100ms）。

### 4.2 完整数据生命周期
1. **导入**：`generateBookId` → `storeFile` (IDB) → `enforceFileLRU`。
2. **阅读**：`onLocationChanged` → `schedulePositionSave`（首次立即写入，连续变化 300ms 后补写最终位置）→ `bookMeta_<id>`。
3. **索引**：无缓存时先进入正文，再由 `scheduleLocationsGeneration` 在后台生成并写入 IndexedDB `locations(bookId)`。
4. **统计**：`visibilitychange` → `flushSpeedSession` 记录采样。
5. **清理**：`removeBook` 并行删除 7 项关联数据，确保无孤立 Key。

### 4.3 存储结构

```
chrome.storage.local
├── preferences              全局偏好设置
├── recentBooks              书架列表（最多 20 本）
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
| `emptyState` 显隐用 `style.display` 直写 | popup 受限环境中最可靠 |

---

## 7. 模块接口参考

以下列出每个模块的完整公开接口、参数类型、返回值和调用约束。

---

### EpubStorage（utils/storage.js）

所有持久化操作的唯一入口。禁止在本文件以外直接调用 `chrome.storage.local` 或 `indexedDB`。

### 偏好设置

```typescript
savePreferences(prefs: Partial<Preferences>): Promise<void>
getPreferences(): Promise<Preferences>
// Preferences: { theme, fontSize, fontFamily, lineHeight,
//               letterSpacing, paragraphIndent, spread, layout,
//               customBg, customText, homeView }
```

### 最近书籍

```typescript
addRecentBook(book: RecentBook): Promise<void>
// RecentBook: { id, title, author, filename, lastOpened? }
// lastOpened 由 addRecentBook 自动设置为 Date.now()
// 列表上限 20 本，超出时删除最旧

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

saveBookMeta(bookId: string, meta: BookMeta): Promise<void>
// 整体覆写，批量更新时使用

savePosition(bookId: string, cfi: string, percentage?: number, locator?: PositionLocator): Promise<void>
// Patch pos 字段，保留其他字段不变

getPosition(bookId: string): Promise<Position | null>
// Position: { cfi, percentage, timestamp, locator? }

removePosition(bookId: string): Promise<void>

saveReadingTime(bookId: string, seconds: number): Promise<void>
getReadingTime(bookId: string): Promise<number>
removeReadingTime(bookId: string): Promise<void>

saveReadingSpeed(bookId: string, speed: Speed): Promise<void>
// Speed: { sampledSeconds: number, sampledProgress: number }
getReadingSpeed(bookId: string): Promise<Speed>

removeBookMeta(bookId: string): Promise<void>
// 同时删除 bookMeta_/pos_/time_ 三个 key（v1.6.0 兼容清理）
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
// 驱逐最旧的超出 maxCount 的文件
// v1.7.0：同步级联清理 recentBooks + bookMeta
```

### 级联删除

```typescript
removeBook(bookId: string): Promise<void>
// 并行执行 7 项删除：
// removeRecentBook + removeBookMeta + removeCover +
// removeHighlights + removeLocations + removeBookmarks + removeFile
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
// 将任意值转为安全 HTML 字符串（& < > " ' 转义）
// 内部用 DOM textContent，无正则漏洞

Utils.formatDate(timestamp: number, fallback?: string = '未知时间'): string
// 相对时间（刚刚 / N分钟前 / N小时前 / N天前 / 本地日期）

Utils.formatDuration(seconds: number): string
// 0秒 / N秒 / N分钟 / N小时N分

Utils.formatMinutes(minutes: number): string
// 0分钟 / N分钟 / N小时N分钟
// 用于 ETA 显示
```

---

## ReaderState（reader/reader-state.js）

```typescript
state.hasLocations: boolean
state.locationsStatus: 'idle' | 'pending' | 'generating' | 'ready' | 'failed'
state.locationsBreak: number | null
state.locationsError: string | null
state.lastPositionSave: Promise<void> | null
state.currentStableCfi: string | null
state.currentStableLocator: object | null
state.isRestoringPosition: boolean
```

**v2.3.0 运行约束**：
- `hasLocations` 表示当前书籍是否已有可用定位索引。
- `locationsStatus` 驱动底部状态栏与 ETA 降级逻辑。
- `lastPositionSave` 记录最近一次位置写入 Promise，供 flush/unmount 路径等待。
- `currentStableCfi` 保存 `location.start.cfi` 作为粗定位入口；分页模式的视觉页身份由 `currentStableLocator` 表达。
- `currentStableLocator` 保存 `displayed-page` 信息（layout/href/index/page/total/prefsSignature），供恢复期有界校正。
- 恢复期 `relocated.start.cfi` 不得覆盖 `currentStableCfi`。
- `isRestoringPosition` 用于区分 `openBook()` 恢复显示与用户正常翻页。
- 切书或 `resetReadingSession()` 时，上述字段必须恢复到初始值。

---

## ReaderRuntime（reader/reader-runtime.js）

```typescript
openBook(
  fileData: ArrayBuffer | Uint8Array | Blob,
  bookId: string,
  fileName: string,
  targetCfi?: string | null
): Promise<void>

scheduleLocationsGeneration(task: Function): void
```

**v2.2.1 行为约束**：
- 若命中 `getLocations(bookId)`，应立即加载缓存索引并恢复精确进度。
- 若未命中缓存，`openBook()` 必须先完成正文显示，再异步调度 `locations.generate()`。
- 调用 `rendition.display(displayCfi)` 前，应先把 `displayCfi` 初始化到 `state.currentStableCfi`，确保恢复期关闭页面不会保存 epub.js 回报的 page-start CFI。
- 普通重开书籍时，若 saved position 含 displayed-page locator，应在 CFI 粗定位后等待渲染/字体稳定，并在同章节内最多执行一次 `next()`/`prev()` 页校正。
- break 参数采用自适应策略：默认 `1600`，大于 1MB 使用 `3200`，大于 3MB 使用 `4800`。
- 后台生成失败只允许降级进度能力，不得中断当前阅读会话。

---

## ReaderPersistence（reader/reader-persistence.js）

```typescript
onRelocated(location: object): void
schedulePositionSave(bookId: string, cfi: string, percent?: number | null): void
flushPositionSave(): Promise<void>
updateReadingStats(): void
```

**v2.3.0 行为约束**：
- `schedulePositionSave()` 在没有待处理防抖写入时立即启动一次位置保存。
- 连续位置变化仍保留 300ms 防抖，用最终 `start.cfi + locator` 覆盖首个位置。
- `onRelocated()` 必须保存 `location.start.cfi` 与 displayed-page locator；不得用 `location.end.cfi` 作为主恢复锚点。
- `flushPositionSave()` 必须清理防抖 timer，刷新/关闭前重新采样 `currentLocation()` 并重建完整 position，然后返回最新保存 Promise。
- `onRelocated()` 在 `isRestoringPosition=true` 时不得替换 `state.currentStableCfi`，但仍应更新进度、章节标题、TOC 与书签按钮状态。
- `updateReadingStats()` 在 `hasLocations=false` 时，ETA 必须显示为 `--`。
- `locationsStatus` 为 `pending/generating/failed` 时，应通过 UI 同步“生成中/不可用”状态，而不是显示误导性的精确进度。

---

## ReaderUi（reader/reader-ui.js）

```typescript
setLocationIndexStatus(
  status: 'idle' | 'pending' | 'generating' | 'ready' | 'failed',
  detail?: string
): void
```

**v2.2.1 行为约束**：
- `progress-location` 用于承载非阻塞定位索引状态。
- 该状态更新不得重新启用全屏 `loading-overlay`，避免回退到“先等索引再阅读”的旧行为。

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

对象单例 `const Bookmarks`。

```typescript
Bookmarks.init(): void
// 注册面板开关事件

Bookmarks.setBook(bookId: string, book: Book, rendition: Rendition): void
// 绑定新书，加载书签列表

Bookmarks.toggle(cfi: string, chapterName: string, progress: number): Promise<void>
// 切换书签状态（存在则删除，不存在则添加）
// progress: 0-1 小数，内部转为 0-100

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

对象单例 `const TOC`。

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

IIFE 单例，暴露为 `const Search`。

```typescript
Search.init(): void
// 注册 DOM 事件和键盘快捷键 F

Search.setBook(book: Book, rendition: Rendition): void
// 绑定新书，清空搜索结果

Search.togglePanel(): void
Search.closePanel(): void
Search.reset(): void
// 切换书籍时调用，取消进行中的搜索
// v2.2.3：关闭/重置进行中的搜索必须恢复搜索按钮 disabled=false

Search.mount(context): void
Search.unmount(): void
// v2.1.1：接入 Reader 统一生命周期
```

---

## ImageViewer（reader/image-viewer.js）

对象单例 `const ImageViewer`。

```typescript
ImageViewer.init(): void
// 注册缩放、拖拽、键盘事件

ImageViewer.hookRendition(rendition: Rendition): void
// 在 rendition.hooks.content 中注册图片 click 拦截
// v2.3.1：同一 rendition/document 幂等，且 late hook 时补处理当前 getContents()

ImageViewer.mount(context): void
ImageViewer.unmount(): void
// v2.1.1：接入 Reader 统一生命周期

ImageViewer.open(src: string): void
// 打开查看器，显示指定 src 的图片

ImageViewer.close(): void
```

---

## Annotations（reader/annotations.js）

对象单例 `const Annotations`。

```typescript
Annotations.init(): void
Annotations.setBook(book: Book): void
Annotations.hookRendition(rendition: Rendition): void
Annotations.mount(context): void
Annotations.unmount(): void
// 注册 EPUB 内联注释链接的点击处理
```

**v2.2.3 行为约束**：
- `mount(context)` 必须确保 Escape 键监听已绑定；`unmount()` 解除后，下一次 mount 要能恢复。

**v2.3.1 行为约束**：
- `hookRendition()` 对同一 rendition 只能注册一次 `hooks.content` callback。
- 对同一 contents document 只能绑定一次注释捕获监听；若调用时 iframe 已存在，必须通过 `rendition.getContents()` 补绑定。

---

## 模块加载顺序（reader.html）

```html
<!-- 基础库 -->
<script src="../lib/jszip.min.js"></script>
<script src="../lib/epub.min.js"></script>

<!-- 工具层（无依赖） -->
<script src="../utils/db-gateway.js?v=9"></script>
<script src="../utils/utils.js?v=9"></script>
<script src="../utils/storage.js?v=9"></script>  <!-- 依赖 DbGateway -->

<!-- 功能模块（依赖 EpubStorage，互不依赖） -->
<script src="image-viewer.js?v=11"></script>
<script src="annotations.js?v=11"></script>
<script src="toc.js?v=11"></script>
<script src="search.js?v=11"></script>
<script src="bookmarks.js?v=11"></script>
<script src="highlights.js?v=11"></script>

<!-- 主控制器（Orchestrator） -->
<script src="reader-state.js?v=11"></script>
<script src="reader-ui.js?v=11"></script>
<script src="reader-persistence.js?v=11"></script>
<script src="reader-runtime.js?v=11"></script>
<script src="reader.js?v=11"></script>
```

**约束**：reader.js 必须最后加载。工具层模块（db-gateway、utils、storage）必须在功能模块前加载。

