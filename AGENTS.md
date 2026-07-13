# AGENTS.md

## 协作原则

- 中文回复，言简意赅；问题复杂时先给短计划，简单改动直接完成。
- 如无必要，勿增实体：优先沿用现有模块、数据结构、工具函数和测试风格。
- 这是 Chrome MV3 扩展，无框架、无构建步骤；直接加载 `src/` 作为 unpacked extension。
- HTML 直接按顺序加载脚本，加载顺序就是依赖边界；不要假设存在 bundling、imports 或 tree shaking。

## 常用命令

- 全量测试：`node test/run_tests.js`
- 聚焦测试：`node --test-name-pattern="ReaderPersistence" test/run_tests.js`
- 本仓库没有 package manager manifest、lint、formatter、typecheck 或 CI；依赖测试和人工审查验证。

## 入口与加载顺序

- Runtime 入口：`src/manifest.json`、`src/reader/reader.html`、`src/home/home.html`、`src/popup/popup.html`。
- `reader.html` 加载顺序必须保持：库（`jszip`、`epub`）→ utils（`db-gateway`、`utils`、`storage`）→ 功能模块 → `reader-state`、`reader-ui`、`reader-persistence`、`reader-runtime` → `reader.js`。
- `storage.js` 依赖 `db-gateway.js`；`reader.js` 依赖所有 reader 层和功能模块全局导出。
- 本地脚本不使用 `?v=` 等手动查询串刷新缓存；Chrome 扩展更新/开发者模式 reload 会刷新扩展资源。

## Reader 架构

- `src/reader/reader.js` 只做 orchestrator；行为放在四层：`reader-state.js`、`reader-runtime.js`、`reader-persistence.js`、`reader-ui.js`。
- `reader-runtime.js` 负责 epub.js 生命周期、`openBook()`、文件加载、导航、布局切换和 locations 生成。
- ReaderUi 本地导入从文件读取到 `openBook()` 按触发顺序串行；`openBook()` 全流程再通过 Runtime 内部队列串行，前一任务失败不得阻断后一任务。缓存加载等待排队期间不得提前改写 `currentBookId/currentFileName`。
- `openBook()` 初始化必须具备事务式失败回滚：任一阶段异常都统一 unmount、销毁已创建 book/rendition、清空书籍标识和 session 后再原样抛错，不得保留半初始化 Reader 状态。
- `reader-persistence.js` 负责阅读位置、阅读时长、速度统计、`relocated`、`visibilitychange` 和 flush。
- `reader-ui.js` 是 Reader DOM 操作入口；persistence 层不得直接持有 DOM 引用。
- 功能模块（`annotations`、`toc`、`search`、`bookmarks`、`highlights`、`image-viewer`）通过 lifecycle context 挂载；新增模块必须同步 `reader.html` 和 `reader.js` 生命周期 wiring。
- TOC、Bookmarks、Search 的用户定位统一调用 lifecycle context 注入的 `navigate(target)`；不要直接丢弃 `rendition.display()` Promise。Runtime 的用户导航必须自行收口同步异常与异步拒绝，旧导航的迟到解锁不得影响新导航锁。
- Reader 模块统一 IIFE：`(function () { 'use strict'; ... window.XXX = XXX; })();`
- 模块级魔法数字提取为顶部命名常量；`openBook`/`setLayout` 共享逻辑放在 `reader-runtime.js` 私有函数；跨 reader 模块共享 helper 放在 `reader-state.js`。

## 存储规则

- 所有 app 持久化走 `EpubStorage`；页面和 reader 模块不要直接调用 `chrome.storage.local` 或 IndexedDB。
- EPUB 文件、封面、locations 存 IndexedDB（`DbGateway`）；preferences、recentBooks、highlights、bookmarks、`bookMeta_<bookId>` 存 `chrome.storage.local`。
- `preferences`、`recentBooks`、同书 `bookMeta` 的读改写必须走内部队列，禁止裸 `_get` → mutate → `_set`。
- `getBookMeta()` 的旧 `pos_` / `time_` lazy migration 必须进入同书队列；首次 patch 应先吸收 legacy 字段。
- 自动 `enforceFileLRU` 只淘汰 IndexedDB `files` EPUB 缓存；阅读进度、标注、书签、封面和 locations 只能在主动 `removeBook()` 时级联删除。
- `removeBook()` 的级联清理即使单项失败也必须等待其余任务全部结束后再释放删除守卫并传播错误；同书并发调用复用同一删除任务，避免重复清理和守卫提前释放。
- `DbGateway` 缓存连接收到 `versionchange` 时必须主动关闭并失效，浏览器触发 `close` 时也必须清空当前连接缓存；旧连接迟到事件不得清除更新的连接。
- Book ID 使用 `SHA-256(filename + first 64KB)`，不要退回文件名或弱哈希。

## 阅读位置约束

- v2.3+ 的主锚点是 `pos.cfi = location.start.cfi`，分页恢复依赖 `pos.locator`（`epubjs-displayed-page-v1`）；不要恢复为 `location.end.cfi` 主锚点。
- `openBook()` 恢复期间，`state.isRestoringPosition` 必须覆盖 CFI display、字体/布局稳定和必要的一次同 CFI 重放；中间 `relocated` 不得写 storage。
- 恢复期不得执行 `next()` / `prev()` 页校正；fresh rendition 短暂回报旧页时只允许同一个 `displayCfi` 直接重放一次。
- `flushPositionSave()` 保存前应按当前状态重建位置；有 pending 防抖写入时不得用滞后的 `rendition.currentLocation()` 覆盖刚翻到的新页。
- locations 生成是后台能力；首屏渲染不得等待 `book.locations.generate()`。
- 字号、行高、字体和窗口 resize 的延迟 reflow 必须捕获 rendition 并校验操作代次；旧书 RAF/timer 不得操作新 rendition 或释放新上下文的锁。切书重置必须清除 `isResizing` 与 `isRestoringPosition`。

## 功能模块重点

- `annotations.js`：保留 `_hasSup()`、`_parseHref()`、模块级 block tags/timing/cache 常量和 `.annotation-fallback-hint`；不要重新散落 `split('#')` 或 inline fallback style。
- 脚注识别中，CSS `vertical-align: super/sub/top/bottom` 只能在便宜 gate 后作为强信号；孤立长链接、四位年份、同文档/跨文档目标前置等只作为误判抑制，不得覆盖显式 EPUB 语义、上标或明确 footnote 容器。
- 跨文档注释缓存只在 book 生命周期内有效，容量由 `_FOOTNOTE_SECTION_CACHE_LIMIT` 控制，切书和 `unmount()` 必须清空。
- FB2/Calibre `body[name="notes"]` / `body[name="comments"]` 必须继续被识别为注释容器。
- `search.js` 的结果上限和 timing 阈值保持模块级常量；每章结果合并前必须按 `_SEARCH_MAX_RESULTS` 裁剪。面板关闭、切书、重新初始化时必须取消待执行的延迟聚焦，迟到 timer 不得聚焦隐藏或新上下文输入框。
- `home.js` 书架卡片封面或 `bookMeta` 单本读取失败只能降级当前卡片，不得让整轮流式渲染失败或留下骨架。
- home/popup 主动删除后无论成功失败都必须重新读取权威 `recentBooks` 并重建列表；不要同时维护手工 DOM 删除分支。

## DOM、安全与样式

- 用户/书籍内容进 DOM 优先用 `textContent` 或 DOM 属性赋值；避免用 `innerHTML` 拼接未清洗内容。
- `Utils.escapeHtml` 只用于元素正文上下文，不能用于带引号 HTML 属性；属性值用 DOM property 或 `setAttribute`。
- 进入 inline style 或 CSS custom property 的颜色必须先归一化；只允许 CSS 有效 hex 长度（3/4/6/8）或 `transparent`。
- Reader 持久化外观偏好进入控件、epub.js 或 iframe CSS 前必须统一归一化：主题/布局/分栏/字体走白名单，字号与行距限制范围，自定义主题颜色只接受 3/6 位 hex；`openBook()` 重读偏好时完整合并，禁止维护易漏字段的手工复制清单。
- `highlights.js` 中只有显式 `color === 'transparent'` 是纯笔记；缺失或非法颜色必须回退默认可见高亮色。
- 运行时显隐优先用 CSS class（`is-hidden`、`is-visible`、panel class）；已知例外包括图片 transform、popup 小入口和必要的动态定位。
- `URL.createObjectURL()` 结果使用后及时 revoke。

## 测试与发布文档

- 测试入口是 `test/run_tests.js`，会自动发现 `test/suites/**/*.test.js`。
- 测试环境 mock 了 `chrome.storage.local`、IndexedDB、最小 DOM，并挂载 `global.Utils`、`global.DbGateway`、`global.EpubStorage`。
- 触碰 storage 或 mocked DB 的测试使用 `resetAll()`；浏览器式模块用 `loadWindowScript()`。
- 修改代码或行为后同步版本号：`src/manifest.json`、`test/suites/system/sys_manifest.test.js`、README badge、`CHANGELOG.md`，并按需更新 `docs/architecture.md` / `docs/ROADMAP.md`。
- `CHANGELOG.md` 是唯一历史演进记录；不要再新增或维护独立 walkthrough。
- README 只保留项目入口级信息：是什么、怎么安装/开发、核心能力和关键文档链接；版本流水、细节修复和长约束放到 `CHANGELOG.md` / `docs/architecture.md`。
