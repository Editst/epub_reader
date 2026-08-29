# AGENTS.md

Chrome MV3 原生 EPUB 阅读器扩展。无构建、无打包、无框架；直接加载 `src/` 作为 unpacked extension，HTML 按 `<script>` 顺序同步加载，加载顺序即依赖边界。

## 1. 协作原则

- 中文回复，简明扼要；遵循 YAGNI / DRY，杜绝面向未来的过度设计。
- 禁止 `TODO`、占位函数、空 `catch` 块；改动前先定位根因，禁止表面掩盖式修复。
- 破坏性变更或需求模糊时先确认方案，再动手实现。
- 本地脚本不追加 `?v=` 等查询串；Chrome 扩展重新加载会刷新资源。

## 2. 测试

```bash
node test/run_tests.js                                          # 全量测试
node --test-name-pattern="ReaderPersistence" test/run_tests.js  # 按名称过滤
```

- 测试基于 Node.js 原生 `node:test`。
- 触碰 storage / IndexedDB 的用例必须调用 `resetAll()`。
- 加载浏览器式模块用 `test/helpers/browser_env.js` 的 `loadWindowScript()`。
- 无 lint / typecheck / CI，正确性由测试和人工审查保证。

## 3. 架构分层与加载顺序（`reader.html`）

1. **基础库**：`jszip.min.js` → `epub.min.js`
2. **工具层**（无依赖）：`utils/db-gateway.js` → `utils/utils.js` → `utils/storage.js`
3. **功能模块**（依赖 `EpubStorage`，互不依赖）：`image-viewer.js` → `annotations.js` → `toc.js` → `search.js` → `bookmarks.js` → `highlights.js`
4. **Reader 四层**：`reader-state.js` → `reader-ui.js` → `reader-persistence.js` → `reader-runtime.js`
5. **入口编排层**：`reader.js`（仅生命周期装配与依赖注入，不含业务逻辑，< 120 行）

### 四层职责

| 层                      | 职责                                                                                                       | 关键约束                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reader-state.js`       | 状态容器 `createReaderState()`，跨模块纯函数（`safeNavigate`、`isTocHrefMatch`、`getLocationProgress` 等） | 禁止任何 DOM 操作或引用                                                                                                                                                                                                   |
| `reader-runtime.js`     | epub.js 生命周期、`openBook()`、导航、布局切换、locations 索引生成                                         | `openBook()` 内部队列串行执行，失败事务式回滚并清空半初始化状态；`state.isResizing`/`isLayoutStable` 门控导航；`loadFileByBookId` 用 `openSessionSeq` 代次防止旧任务复活                                                  |
| `reader-persistence.js` | 阅读位置 / 时长 / 速度持久化                                                                               | 不持有 DOM 引用，一律通过 `ui.*` 委托；`onRelocated` 不在翻页热路径做重排采样，恢复锚点延迟到 `flushPositionSave`/`flushSessionBundle` 按需生成；退出/休眠/切书统一走 `flushSessionBundle(bookId, bundle)` 单事务原子刷盘 |
| `reader-ui.js`          | 唯一 DOM 操作入口                                                                                          | 面板互斥与共享遮罩集中管理；显隐一律用 CSS class（`is-hidden`/`is-visible`），例外仅限图片 transform 与弹窗动态定位；字号/行距滑块 `input` 立即视觉更新 + 200ms 防抖重排，`change` 立即 flush 并持久化                    |

新增功能模块必须同步 `reader.html` 加载顺序与 `reader.js` 的 lifecycle wiring；模块统一暴露为 `window.XXX`，IIFE 封装，`init()` 按 document 幂等。

## 4. 存储架构（`EpubStorage` / `DbGateway`）

- **唯一入口**：所有持久化必须经 `EpubStorage`；禁止业务代码直接调用 `chrome.storage.local` 或 `indexedDB`。
- **分区**：
  - IndexedDB（`DbGateway`，v4，bookId 主键）：`files`（EPUB 二进制，`by_filename` 索引）、`covers`、`locations`。
  - `chrome.storage.local`：`preferences`、`recentBooks`（≤20）、`fileTimestamps`（纯读 LRU）、`bookMeta_<id>`（pos/time/speed）、`highlights_<id>`、`bookmarks_<id>`、`deletedBook_<id>`（删除墓碑）。
- **并发控制**：
  - `preferences` / `recentBooks` / 同书 `bookMeta` 的读改写通过内部队列串行化，禁止裸 `_get → mutate → _set`。
  - 跨标签页用 Web Locks：书籍读写持有 `book:<id>` 共享锁，各资源（meta/highlights/bookmarks/cover/locations/file）另持独占锁；删除与导入持有 `book:<id>` 独占锁。
  - `updateHighlights` / `updateBookmarks` 用浅拷贝 Copy-on-Write，mutator 返回 `false` 取消写入。
- **Book ID**：`SHA-256(filename + 首 64KB 内容)`，通过 `Blob.slice()` 避免整文件读入内存。
- **LRU 与删除**：`enforceFileLRU(10)` 只淘汰 IndexedDB `files` 缓存，保留进度/标注/书签/封面/locations；`removeBook()` 写删除墓碑后并行清理 7 项资源，等待全部 settled 才释放守卫，同书并发调用复用同一任务。
- **连接生命周期**：`DbGateway` 在 `versionchange` 时主动关闭并失效缓存，`close` 后同样失效；连接失败按指数退避冷却重试。

## 5. 阅读位置恢复约束

- 复合锚点：主锚点 `pos.cfi = location.start.cfi`；分页模式辅以 `epubjs-displayed-page-v1` locator（`restoreCfi`/页码/`prefsSignature`），仅当 `restoreCfi.sourceCfi === pos.cfi` 才可信。
- `openBook()` 恢复期间 `state.isRestoringPosition = true` 覆盖 CFI display、字体/布局稳定和必要的同 CFI 重放；中间 `relocated` 不得写 storage。
- 页码不一致时只允许重放同一个 `displayCfi` 一次，禁止调用 `next()/prev()` 做翻页校正。
- 窗口 resize / 字号 / 行距 / 字体变更共享 reflow 代次与保护锁（`isResizing`），完成后恢复变化前捕获的锚点；切书必须重置这两个保护标志。

## 6. 功能模块要点

- **`annotations.js`**：跨章节 DOM 缓存 `_FOOTNOTE_SECTION_CACHE_LIMIT = 5`（LRU）；`_targetIdIndex` 缓存 targetId→section 实现 O(1) 二次定位；识别 `body[name="notes"/"comments"]`、`<dd>`/`<dt>`/`<figure>`/`<figcaption>`；跳转统一走注入的 `navigate()`；弹窗内容经 `<template>` 逐属性清洗后再显示。
- **`search.js`**：`_SEARCH_MAX_RESULTS = 1000`（每章结果按剩余额度裁剪）；`_SEARCH_TIME_BUDGET_MS = 16` 帧预算让步；查询字符串需转义正则元字符；关闭/切书取消延迟聚焦定时器。
- **`highlights.js`**：`_HIGHLIGHT_RENDER_BATCH_SIZE = 20`，超量走 RAF 分批渲染并校验代次；仅显式 `color === 'transparent'` 视为纯笔记，非法/缺失颜色回退默认可见色。
- **`bookmarks.js`** / **`toc.js`**：UI 状态更新统一委托 `panelController`；跳转统一走 `ReaderState.safeNavigate`。
- **`image-viewer.js`**：拖拽平移时临时关闭 CSS transition；缩放范围 `ZOOM_MIN_SCALE=0.2` ~ `ZOOM_MAX_SCALE=8`。
- **`home.js`**：支持全局拖放导入；单本卡片封面/元数据读取失败只局部降级，不影响整轮流式渲染（`card` 变量需在 `try` 外声明防 TDZ）；标注管理走内存缓存筛选/排序；笔记导出遍历 `getAllHighlights()` 全量字典，无 20 本上限截断。
- **`popup.js`**：内联 `<style>`；`#file-input` 用零尺寸/透明物理隐藏（禁 `display:none`，否则 `.click()` 被拦截）；不使用 `showOpenFilePicker`（会丢失 transient user activation）。

## 7. 安全与防御性编程

- 用户/书籍内容进 DOM 优先 `textContent` 或 DOM 属性；`Utils.escapeHtml` 仅用于元素正文上下文，不用于带引号的 HTML 属性。
- 颜色进入 inline style/CSS 自定义属性前必须经 `Utils.sanitizeColor` 归一化（仅接受 3/4/6/8 位 hex 或 `transparent`）。
- 外观偏好（主题/布局/分栏/字体）走白名单；字号限制 12–32，行距限制 1.2–3.0。
- Blob URL 用后经 `Utils.releaseElementCoverUrl(el)` 或显式 `URL.revokeObjectURL()` 释放；具名监听器只在 `init()`/`mount()` 注册一次，`unmount()` 完整清理；定时器持有引用并在销毁时 clear。
- 所有异步 Promise 与 DB 调用必须带上下文捕获异常，日志附带模块标签，严禁空 `catch`。

## 8. 发布规范

修改版本号时同步更新 4 处：

1. `src/manifest.json`（`version`）
2. `test/suites/system/sys_manifest.test.js`（版本断言）
3. `README.md`（badge 与正文）
4. `CHANGELOG.md`（新版本条目，Keep a Changelog 格式）

文档职责划分：

| 文档                   | 内容                           |
| ---------------------- | ------------------------------ |
| `CHANGELOG.md`         | 唯一历史演进记录               |
| `docs/architecture.md` | 架构图、模块接口契约、机制细节 |
| `docs/ROADMAP.md`      | 未来规划与活跃技术债           |
| `README.md`            | 面向用户的入口、安装、功能介绍 |
| `AGENTS.md`（本文档）  | 面向协作者/Agent 的规则与约束  |