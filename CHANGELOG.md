# CHANGELOG

所有重要变更记录于此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [Unreleased]

### fix
- **阅读位置恢复锚点保护**：`openBook()` 通过已保存 CFI 或 `targetCfi` 恢复分页位置后，新增 `isRestoreAnchorProtected` 保护期；用户真正翻页、进度跳转、目录/书签/搜索/注释跳转前，locations cache-hit/generate-complete 与刷新 `flushPositionSave()` 不再用 epub.js 回报的页边界 `currentLocation().start.cfi` 覆盖已保存锚点。修复重开阅读器位置不准、刷新后继续跳页的级联根因。
- **恢复 displayed-page 一页内校正**：`_correctRestoredPage()` 在同章节、同布局签名、页总数一致且仅偏移一页时执行一次 `next()/prev()` 校正；校正全程仍处于恢复保护期，不写入中间态。
- **位置快照一致性**：`onRelocated()` 持久化时保证 CFI、percentage、locator 来自同一个 location 源；当 `rendition.currentLocation()` 与事件参数不一致时，不再混用“current CFI + 旧事件 locator”，避免保存出章节/页码互相矛盾的位置。

### test
- 补充恢复锚点保护回归测试，覆盖恢复后 locations 漂移不落盘、刷新前 flush 不重采样漂移 CFI、保护期 relocated 只更新 UI、以及重采样快照一致性。

---

## [2.4.0] - 2026-06-25

全面架构重构版本。修复 8 项 Bug，消除死代码与重复代码，统一代码风格与架构约束。

### refactor
- **架构违规修复（7 项）**：
  - `reader-persistence.js` 中章节标题/书签按钮/阅读统计更新委托给 `reader-ui.js` 辅助函数（`updateChapterTitle`、`updateBookmarkButtonState`、`updateReadingStatsText`），遵守"本层不持有 DOM 引用"约束。
  - 消除 `state._runtime` 注入模式，`openBook` 改为显式参数传递。
  - `setLayout()` 补充遗漏的 `Annotations.setBook()` 调用。
- **死代码清除**：删除未使用的 `btnCloseToolbar`、弃用的 `showToolbarForHighlight()`、重复的 `loadEpubFile()`。
- **重复代码合并**：
  - `findTocItem`、`buildPrefsSignature` 统一到 `reader-state.js`，消除 reader 模块间隐式依赖。
  - `_escapeHtml` 替换为 `Utils.escapeHtml()`；`sanitizeColor` 统一到 `Utils.sanitizeColor()`。
- **IIFE 统一**：`annotations.js`、`bookmarks.js`、`toc.js`、`image-viewer.js` 统一包裹 IIFE，与 `reader-runtime.js` 等模块保持一致，11 个 reader 模块全部使用 IIFE 封装。
- **魔法数字提取**：`reader-runtime.js`、`reader-persistence.js`、`reader-ui.js`、`image-viewer.js` 中 60+ 个硬编码数字替换为命名常量（如 `POSITION_SAVE_DEBOUNCE_MS`、`GAP_SCROLLED_PX`、`ZOOM_MIN_SCALE` 等）。
- **openBook 拆解**：从 ~250 行 `openBook()` 中提取 `_createRendition(layout)` 和 `_hookRenditionEvents(rendition, theme)` 两个共享辅助函数，消除与 `setLayout()` 的重复代码。`setLayout()` 从 71 行缩减至 ~25 行。

### fix
- **8 项 Bug 修复**：
  - `showLoadError` DOM 销毁导致后续打开书籍失败
  - `openBook()` 缺少 `try/finally` 导致阅读器死锁
  - `setLayout()` 缺少 `try/catch/finally` 导致保护标志永久生效
  - `_withCfiLock()` 异步函数缺少错误处理
  - `bindResize()` 异步函数缺少错误处理
  - `moduleLifecycle` 缺少逐模块错误隔离
  - 文件上传缺少错误处理
  - `activeElement` 可能为 `null` 导致 TypeError
- **enforceFileLRU 竞态条件修复**：`enforceFileLRU` 改为串行执行淘汰（逐项 try/catch），避免并发 `removeRecentBook` 的读改写竞态导致书籍记录丢失。

### test
- 新增 enforceFileLRU 串行执行、LRU 排序、错误隔离测试（4 个）。
- 新增 persistence 层架构约束（源码无 DOM 直操作）与 ui 委托集成测试（4 个）。
- 更新 `bugfix_reader_ux.test.js` 的 BUG-4 测试以匹配新的 `_createRendition` 结构。
- 更新测试 mock 以支持新的 `ui` 辅助函数。全量 124 个用例通过。

---

## [2.3.3] - 2026-06-24

### fix
- **位置恢复级联退化**：`onRelocated` 始终从 `rendition.currentLocation()` 重采样 CFI 用于持久化，不再直接使用 relocated 事件参数的 `start.cfi`。事件参数仅用于 UI 更新（章节标题、进度条、TOC）。避免快速翻页/布局重排时事件参数与 epub.js 内部状态不一致导致位置偏移。
- **新增 `_isPositionMeaningfullyChanged` 守卫**：写入前比较新旧 CFI 字符串，完全相同则跳过 `schedulePositionSave`，避免 locations 加载后用边界 CFI 覆盖正确位置导致级联退化。
- **locations 加载路径 CFI 守卫**：`openBook()` 的 cache-hit 和 generate-complete 路径中，若 `currentLocation().start.cfi` 与 `state.currentStableCfi` 相同，跳过 `persistence.onRelocated` 调用。
- **`setLayout()` 恢复保护**：布局切换期间设置 `isRestoringPosition = true`，await `display(currentCfi)` + 双帧等待后解除，防止 relocated 事件在新布局下以不同 CFI 覆盖正确位置。
- **`_withCfiLock` 恢复保护**：字号/行高/字体切换的 CFI 保护锁同步增加 `isRestoringPosition` 标志。
- **`beforeunload` 兜底**：在 `persistence.mount()` 中注册 `window.beforeunload` 事件，刷新/关闭前调用 `flushPositionSave()`，防止 `visibilitychange` 未先于页面卸载触发导致位置未落盘。
- **移除重复 resize 监听器**：`reader-runtime.js` 的 resize 防抖已由 `reader-ui.js:bindResize` 覆盖（含 CFI 快照+恢复），移除 runtime 层重复监听。

### test
- 新增 6 个测试用例：onRelocated 重采样 CFI、CFI 未变不写入、locations 加载 CFI 改变时写入、setLayout 保护、beforeunload 触发 flush、CFI 重采样。全量 116 个用例通过。

---

## [2.3.2] - 2026-06-24

### fix
- **阅读位置恢复跳页**：重写 `_correctRestoredPage`，移除 next/prev 页校正导航——CFI 本身是可靠的 DOM 位置指针，display 后仅验证 href/index 章节匹配，不再基于偏移页码做翻页导航。页码差异是字体加载导致的布局偏移，不是位置错误。
- `_waitForRenditionStable` 移除多余的 `reportLocation()` 调用（epub.js triple-deferred 机制导致 `currentLocation()` 同步读入旧值），改为双帧等待布局 reflow。
- 新增 `state.isLayoutStable` 标志：`openBook()` display 期间为 false，阻止 `next()`/`prev()`/`displayPercentage()` 执行；`_correctRestoredPage` 完成后立即设为 true。避免字体加载完成前的误触发。
- 新增窗口 resize 防抖（500ms），resize 期间 `isResizing = true`，防止 relocated 事件在窗口拖拽过程中写入不完整位置。
- **进度不更新回归修复**：`isRestoringPosition=false` 和 `isLayoutStable=true` 恢复到 `_correctRestoredPage` 后立即设置（v2.3.2 早期版本误移入 locations 索引段，导致 `onRelocated` 长时间跳过位置写入）。

### test
- 新增 `isLayoutStable` 门控测试（false 时 next/prev/displayPercentage 不执行、true 时正常导航、openBook 完成后为 true）、页校正导航移除测试（start.cfi/boundary 恢复不做导航、页号一致不校正、currentStableCfi 不偏移）。全量 110 个用例通过。

---

## [2.3.1] - 2026-06-24

### fix
- **高亮悬浮栏关闭**：修复 v2.3.0 后高亮工具栏在首屏 iframe 中点击正文空白不关闭的问题。根因是 `Highlights.setBookDetails()` 在 `rendition.display()` 后才执行，旧代码只通过 `hooks.content.register()` 绑定未来 contents，未补绑定已存在的首屏 iframe。
- **Reader 子模块生命周期**：收敛 `openBook()` 中 lifecycle mount 后的重复直调路径，避免 `Bookmarks`、`Search`、`Highlights` 在同一书籍打开流程中重复绑定或并发加载。
- **iframe hook 幂等性**：`ImageViewer` 与 `Annotations` 对同一 rendition/document 做幂等绑定，并在 hook 晚于 display 时补绑定当前 `rendition.getContents()`。

### test
- 新增高亮悬浮栏 iframe 空白点击、首屏 display 后补绑定、ImageViewer/Annotations hook 幂等、openBook 不重复直调子模块的回归测试。

---

## [2.3.0] - 2026-06-23

### fix
- **阅读位置恢复**：替代 v2.2.6 的 `end.cfi` 锚点策略，改为 `start.cfi + displayed-page locator + 有界页校正`。保存时记录 epub.js 报告的 `start.displayed.page/index/href` 与布局签名；恢复时先用 CFI 粗定位，等待渲染与字体稳定后，若同一章节内仅偏移一页，则自动 `next()` 或 `prev()` 校正。
- `flushPositionSave()` 在刷新/关闭前重建完整 position（CFI、percentage、locator），避免持久化过期内存位置。滚动模式保留 `start.cfi` 恢复，不做页号校正。
- `savePosition()` 向后兼容地支持 `locator` 字段，旧 `{ cfi, percentage, timestamp }` 数据无需迁移。

### test
- 新增 2.3 位置恢复 TDD 用例，覆盖 start 前跳自动 next、边界后跳自动 prev、页号一致不校正、href/index 不一致不校正、布局签名不一致不校正、scrolled 不校正、flush 重建 locator、storage 兼容旧调用。全量 100 个用例通过。

---

## [2.2.6] - 2026-06-23

### fix
- **阅读位置恢复**：彻底修复关闭阅读页后重开回到前一页、刷新阅读器页面后每次继续向前跳一页的问题。真实根因是分页模式下持久化了 `location.start.cfi`，而该 CFI 是当前显示区的起点边界；epub.js 对边界 CFI 执行 `display(start.cfi)` 时可能按前一页归属恢复，导致每次刷新保存新的上一页起点并持续倒退。
- 分页模式改为保存 `location.end.cfi` 作为恢复锚点，滚动模式仍保存 `location.start.cfi`；页面隐藏/关闭 flush 前会从 `rendition.currentLocation()` 重新采样当前锚点，避免快速刷新时使用过期内存 CFI。
- 后续 v2.3.0 已替换该策略：`end.cfi` 在部分书籍中会向后跳页，最终采用 displayed-page locator 校正。

### test
- 新增分页锚点回归测试，覆盖正常 `relocated` 保存 `end.cfi` 以及刷新/关闭前 flush 重新采样当前 `end.cfi` 两条链路。全量 95 个用例通过。

---

## [2.2.5] - 2026-06-23

### fix
- **阅读位置恢复**：修复 v2.2.4 后仍可能在刷新/关闭时继续向前回退一页的问题。根因为恢复期间虽然跳过了 `schedulePositionSave`，但 `relocated` 事件仍会把 epub.js 回报的 page-start CFI 写入 `state.currentStableCfi`，随后 `flushPositionSave()` 在页面隐藏或卸载时将该上一页边界 CFI 落盘。
- `openBook()` 在恢复前先把目标/已保存 CFI 初始化为可 flush 的稳定 CFI；`onRelocated()` 在 `isRestoringPosition=true` 时只更新进度与章节 UI，不替换可落盘 CFI。

### test
- 新增刷新/重开位置倒退的 TDD 回归测试，覆盖“恢复期间污染 `currentStableCfi` 后由关闭 flush 落盘”的完整链路。全量 93 个用例通过。

---

## [2.2.4] - 2026-06-23

### fix
- **阅读进度恢复**：修复关闭书籍后重新打开时进度回退到旧位置的 Bug。根因为 `openBook` 中 `rendition.display(savedCfi)` 触发的 `relocated` 事件在 locations 未加载时，以 `null` percentage 和 page-start CFI 覆写了 storage 中的正确进度。引入 `state.isRestoringPosition` 标志位，在位置恢复期间抑制 `schedulePositionSave` 调用。

### test
- 新增 6 个 `isRestoringPosition` 保护机制的 TDD 测试用例 (`progress_restore.test.js`)，覆盖恢复期间跳过写入、正常阅读时正常写入、flush 使用最新内存状态等场景。全量 92 个用例通过。

---

## [2.2.3] - 2026-06-22

### feat
- **架构决策**: 确认 `enforceFileLRU` 不级联删除标注等数据的设计，以保障电子书文件被淘汰后仍可保留读书笔记记录 (详见 ADR-001)。

### fix
- 存储与首页:
  - `home.js`: 修复重名文件导入无响应的问题 (fileInput value 重置)。
  - `home.js`: 修复导出 Markdown 笔记时，书名及作者名被误用 HTML Entity 转义的问题。
  - `storage.js`: 修复速度统计零值 (`sampledSeconds=0` 等) 被 fallback 机制忽略的问题 (`||` -> `??`)。
  - `storage.js`: 优化 `getAllHighlights` 读取性能，去除冗余的逐本查询 I/O 操作。
- 阅读器体验:
  - `reader-runtime.js`: 补充 SVG 图片内联的 `'image'` 样式声明，修复 SVG 排版溢出。
  - `reader-runtime.js`: 修复书封 Blob URL 内存泄漏，使用后主动 `URL.revokeObjectURL()`。
  - `toc.js`: 修复 TOC 当前章节高亮匹配缺陷 (避免 `/ch1.html` 误匹配 `/ch10.html`)。
  - `toc.js`: 修复 TOC 面板打开时与其他面板互斥失效的问题。
  - `highlights.js`: 为 `reRenderHighlight` 增加失败日志打印，避免静默失败难以追查。
  - `search.js`: 修复大量搜索结果下，增量返回导致的整个列表频繁清空重绘的问题，改为 append 模式。
  - `reader-persistence.js`: 修复初始化流程中的计时器泄漏问题，移除 mount 时提前启动的不必要 timer。

### test
- 新增 11 个涵盖数据完整性、阅读器行为、首页操作的 UX 层回归与缺陷验证测试 (`bugfix_reader_ux.test.js`, `bugfix_home.test.js`, `bugfix_data_integrity.test.js`)，目前全量 86 个用例通过。

---

## [2.2.2] - 2026-06-22

### fix
- 阅读进度保存改为“首次立即写入 + 300ms 防抖收敛最终位置”，降低快速关闭页面时回退到旧 CFI 的风险。
- `flushPositionSave()` 返回位置写入 Promise，并显式维护 `lastPositionSave` 状态，便于生命周期路径等待最新保存。
- 搜索面板关闭/重置进行中的搜索时恢复搜索按钮，避免取消搜索后按钮长期 disabled。
- `Annotations.mount()` 会重新确保 Escape 监听存在，修复切换书籍后注释弹窗无法用 Escape 关闭的问题。

### docs
- manifest、README、架构文档与模块接口参考更新至 v2.2.2。
- README 修正文档中关于 CSP 已彻底移除 `'unsafe-inline'` 的过期描述。

### test
- 新增 reader 持久化与模块生命周期回归测试，覆盖实时进度保存、搜索取消、注释弹窗切书后的 Escape 行为。

---

## [2.2.1] - 2026-03-27

### fix
- Reader 首开无缓存大体积 EPUB 时，不再等待 `locations.generate()` 完成后才进入正文；正文渲染成功后立即可读，定位索引改为后台生成。
- `reader-runtime.js` 为 `locations` 增加 `idle/pending/generating/ready/failed` 状态，并补充 `open_to_first_render`、`locations_generate_duration`、`locations_cache_hit` 日志，便于后续性能观测。
- `locations.generate()` 的 break 参数由固定 `1600` 改为按书籍体积自适应：默认 `1600`，大于 1MB 使用 `3200`，大于 3MB 使用 `4800`，降低大书首开索引耗时。
- `reader-persistence.js` / `reader-ui.js` 在索引未就绪或失败时降级展示 ETA 和定位状态，底部状态栏显示“阅读定位索引生成中 / 不可用 / 已就绪”，不再阻塞翻页与阅读。

### test
- 新增 reader 侧回归测试，覆盖“大书首开先可读、后台建索引、自适应 break、ETA 降级、locations 状态字段”。

---

## [2.2.0] - 2026-03-17

### fix (D-2026-25 — speed.sessions 持久化落地)
- `storage.js` `saveReadingSpeed` / `getReadingSpeed` 升级 speed 结构，补全 `sessions: []` 和 `sessionCount: 0` 字段。
- `_enqueueBookMetaWrite` 默认 speed 结构同步更新。
- 向后兼容：旧无 `sessions` 字段的数据读取时安全补零。
- D-2026-25 闭环。

### test
- 新增 `test/suites/v2_2_tdd.test.js`，覆盖 D-2026-25/版本号 全部验收项。

---

## [2.1.1] - 2026-03-12

### fix
- Reader 生命周期编排由入口匿名适配层改为子模块原生 `mount/unmount` 接口（R-2 收尾）。
- `Annotations.init()` Escape 监听改为具名 `_onKeyDown`，`unmount()` 中执行 `removeEventListener`，消除重复挂载时监听器累积（AN-C6 前置治理）。

### chore
- `architecture.md` / `modules.md` 升级至 v2.1.1，补充 Reader 分层与模块生命周期描述。
- 审计登记 D-2026-25（speed.sessions 持久化结构缺失），纳入 v2.2.0。

---

## [2.1.0] - 2026-03-12

### refactor
- R-1：`reader.js` 拆分为 `reader-runtime.js` + `reader-state.js` + `reader-persistence.js` + `reader-ui.js`，入口 `reader.js` 降至 < 120 行编排层。
- R-2：子模块建立统一 `mount(context)` / `unmount()` 生命周期接口。
- R-3：消除全局变量跨模块写入，改为 `context` 显式传参。

### chore
- 删除 `DbGateway.getByFilename()` 死代码（D-2026-06 闭环）。

---

## [2.0.0] - 2026-03-12

### feat
- P-1：阅读速度 ETA 模型升级：会话加权（β=0.8 指数衰减）+ 跳读识别（weight 0.3）+ 低样本"估算中"提示（sessionCount < 3）。
- P-2：`locations.generate()` 改为 `requestIdleCallback` 调度包装，补充"准备/生成/就绪"进度文案。
- P-3：书架流式渲染：骨架屏占位 + 每书就绪立即插入，首屏骨架 < 100ms。

---

## [1.9.3] - 2026-03-11

### fix
- F-1：`storage.js` `_get/_set/_remove` 接入 `chrome.runtime.lastError` reject（P1 清零）。
- F-2：`bookMeta` 写入引入 `_bookMetaQueue` 串行队列（P2 清零）。
- F-3：`getAllHighlights()` 扩展为全量 key 扫描补全（P2 清零）。
- F-4：`reader.js` 全部 `style.display` 迁移为 class 控制（P2 清零，transform 豁免）。
- BUG-B：修复 Chrome Extension popup `display:none` 元素 `.click()` 失效问题。

### test
- F-5：补充故障注入 + 并发写 + 数据覆盖 + style.* 静态回归测试套件。
