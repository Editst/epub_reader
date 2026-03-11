# EPUB Reader — 模块接口参考

版本：v1.9.2  
更新：2026-03-11

本文档列出每个模块的完整公开接口、参数类型、返回值和调用约束。

---

## EpubStorage（utils/storage.js）

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
//   pos:   { cfi: string, percentage: number, timestamp: number } | null,
//   time:  number,   // 累计阅读秒数
//   speed: { sampledSeconds: number, sampledProgress: number }
// }
// 首次调用自动迁移 v1.6.0 的 pos_/time_ 旧 key

saveBookMeta(bookId: string, meta: BookMeta): Promise<void>
// 整体覆写，批量更新时使用

savePosition(bookId: string, cfi: string, percentage?: number): Promise<void>
// Patch pos 字段，保留其他字段不变

getPosition(bookId: string): Promise<Position | null>
// Position: { cfi, percentage, timestamp }

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

DbGateway.getByFilename(filename: string): Promise<FileRecord | null>
// by_filename 索引查询（备用路径，主路径用 bookId）
```

---

## Utils（utils/utils.js）

纯函数，无 DOM 依赖。

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

Highlights.closePanels(): void
// 关闭工具栏和笔记弹窗，清除所有 CFI 状态
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
```

---

## TOC（reader/toc.js）

对象单例 `const TOC`。

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
```

---

## ImageViewer（reader/image-viewer.js）

对象单例 `const ImageViewer`。

```typescript
ImageViewer.init(): void
// 注册缩放、拖拽、键盘事件

ImageViewer.hookRendition(rendition: Rendition): void
// 在 rendition.hooks.content 中注册图片 click 拦截

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
// 注册 EPUB 内联注释链接的点击处理
```

---

## 模块加载顺序（reader.html）

```html
<!-- 基础库 -->
<script src="../lib/jszip.min.js"></script>
<script src="../lib/epub.min.js"></script>

<!-- 工具层（无依赖） -->
<script src="../utils/db-gateway.js?v=8"></script>
<script src="../utils/utils.js?v=8"></script>
<script src="../utils/storage.js?v=8"></script>  <!-- 依赖 DbGateway -->

<!-- 功能模块（依赖 EpubStorage，互不依赖） -->
<script src="image-viewer.js?v=8"></script>
<script src="annotations.js?v=8"></script>
<script src="toc.js?v=8"></script>
<script src="search.js?v=8"></script>
<script src="bookmarks.js?v=8"></script>
<script src="highlights.js?v=8"></script>

<!-- 主控制器（依赖所有上层模块） -->
<script src="reader.js?v=8"></script>
```

**约束**：reader.js 必须最后加载。工具层模块（db-gateway、utils、storage）必须在功能模块前加载。


## v1.9 更新摘要
- 搜索模块改为 class 驱动样式（`search-result-item` / `search-highlight` / `search-status-empty`）。
- 目录模块空态改为 `.toc-empty`。
- Reader 错误态改为 `.reader-error-*` class，翻页过渡使用 `.reader-main-dimmed`。

---

## comprehensive_repost 审计补充（实现约束）

### 存储错误语义（新增约束）

- `EpubStorage` 的 `_get/_set/_remove` 应将 `chrome.runtime.lastError` 作为 reject 向上抛出。
- 业务层（reader/home/popup）调用持久化接口时，应在关键路径具备最小可观察性（日志或用户提示）。

### 并发写语义（新增约束）

- `savePosition/saveReadingTime/saveReadingSpeed` 当前都属于“读-改-写整对象”模式。
- 后续实现必须保证 **同一 bookId 的写入串行化**（队列或 CAS），避免字段被并发覆盖。

### 标注聚合语义（新增约束）

- `getAllHighlights()` 不应仅依赖 `recentBooks`（上限 20）。
- “全部标注”场景需覆盖所有 `highlights_<bookId>` key（可按需分页/缓存）。
