# EPUB Reader 开发演进记录 (Development Walkthrough)

本文档归档了 EPUB Reader 从架构搭建到极致性能优化的完整演进历程，真实记录每一阶段的技术决策、核心修复及架构演进。

---

## [v2.5.4] - 首页书架单本读取降级

- `home.js` 新增 `loadBookCardData(book)`，将封面与 `bookMeta` 读取集中到单本卡片级辅助函数。
- 单本 `getCover()` 或 `getBookMeta()` 失败时只记录 `[Home] ... failed` 告警，并分别回退为无封面或无进度；不会让 `loadBookshelf()` 的整轮 `Promise.all` 失败。
- home 页本地脚本 cache-buster 升级到 `?v=15`，确保首页降级逻辑被加载。
- 首页 UI 静态契约新增封面与 `bookMeta` 读取失败必须局部捕获的回归约束。

---

## [v2.5.3] - 共享颜色白名单严格化

- `Utils.sanitizeColor()` 从宽泛的 `{3,8}` hex 长度校验收窄为 CSS 有效长度 3/4/6/8 位，拒绝 `#12345`、`#1234567` 等浏览器无效颜色。
- `Highlights.renderHighlight()` 只有显式 `transparent` 才按纯笔记处理；缺失或损坏颜色回退为默认高亮黄，避免历史数据产生不可见高亮。
- 首页标注 badge 背景不再通过 `${color}33` 拼接透明度；颜色先经共享白名单归一化，再用 `color-mix()` 生成有效背景色。
- Reader、home、popup 三个入口的本地脚本 cache-buster 分别升级到 `?v=23`、`?v=14`、`?v=12`，确保共享工具变更被加载。
- Utils 测试覆盖 3/4/6/8 位合法 hex 与 5/7 位非法 hex；Highlights 行为测试覆盖损坏颜色默认可见与 `transparent` 纯笔记；首页 UI 静态契约锁住不得拼接 hex alpha 后缀。

---

## [v2.5.2] - 首页 DOM 属性上下文收敛

- `home.js` 书架卡片的书名、文件名和作者不再拼入 `innerHTML` 模板；模板只保留静态结构。
- 书名与作者正文改用 `textContent` 写入，书名悬浮提示改用 DOM `title` 属性赋值，避免 EPUB 元数据中的引号突破 HTML 属性上下文。
- 文档和 Agent 约束明确：`Utils.escapeHtml` 只用于元素正文上下文，属性上下文必须通过 DOM 属性或 `setAttribute` 赋值。
- 首页 UI 静态契约新增卡片模板不得包含 `book.title` / `book.filename` / `book.author` 的回归约束。

---

## [v2.5.1] - Search 结果上限性能保护

- `search.js` 将搜索最大结果数、UI 让步间隔和面板聚焦延迟提取为模块级常量，避免阈值散落在流程内部。
- `doSearch()` 在每章 `find()` 返回后按 `_SEARCH_MAX_RESULTS - results.length` 裁剪，再合并和渲染；单个章节一次返回 1000 条以上时也不会撑爆结果列表。
- 章节 `load()` 复用单个 `activeLoad` 绑定，减少循环内重复 `.bind()`。
- 回归测试覆盖单章节 1005 条命中只渲染前 1000 条，并用静态契约锁住 Search 性能保护常量和裁剪路径。

---

## [v2.5.0] - Annotations 跨文档拓扑弱负向信号

- `_buildDocContext(doc, contents, book)` 会基于 `contents.sectionIndex` 和 book spine 构建当前 section 与 href/index 映射，单个 iframe 只扫描一次。
- `isFootnoteLink()` 新增跨文档目标前置判断：当链接目标 section 位于当前 section 之前时，只压低 class/id 与 fragment 弱阳性，减少尾注区回链被误当作正文脚注引用。
- 显式 `epub:type="noteref"` / role、真实 `<sup>` / CSS 上标和明确 footnote 容器仍可覆盖该弱负向信号。
- section href 规范化与相对路径解析集中到辅助函数，`_loadFromBook()` 的相对 section 查找复用同一路径，降低 `../` 场景的分类/加载漂移。
- 回归测试覆盖 spine 索引上下文构建、跨文档前置压低弱阳性、目标在后方保留弱阳性、上标强信号保留，并用静态契约锁住跨文档拓扑辅助函数。

---

## [v2.4.18] - Annotations FB2 转换格式兼容

- `_buildDocContext()` 将 Calibre/FB2 常见的 `body[name="notes"]` / `body[name="comments"]` 及其 `section` 纳入注释容器扫描。
- 注释容器内的 `a[href]` 会进入 `footnoteSectionNodes`，因此不会再被 `isFootnoteLink()` 当作正文脚注引用拦截。
- 同文档 target analysis 新增 FB2 容器判断：正文链接指向这些 notes/comments body 内目标时，可作为明确注释容器信号。
- 回归测试覆盖 FB2 notes body 内回链排除、正文链接指向 FB2 notes body 目标识别，并用静态契约锁住 `body[name="notes"]` / `body[name="comments"]` 选择器。

---

## [v2.4.17] - Annotations 同文档拓扑弱负向信号

- `isFootnoteLink()` 对同文档 `href="#fragment"` 目标只查找一次，并在弱阳性判断与 target analysis 中复用，避免重复 DOM 查询。
- 新增 `_isSameDocumentTargetBeforeSource()`，用 `compareDocumentPosition()` 判断目标是否位于源链接之前；断连节点和跨 document 节点不参与负向判断。
- 目标前置只压低 class/id 或 fragment 形态带来的弱阳性，减少返回链接与双向链接图谱误判。
- 显式 `epub:type="noteref"` / role、真实 `<sup>` / CSS 上标和明确 footnote 容器仍可覆盖该弱负向信号，避免误杀强语义脚注。
- 回归测试覆盖弱阳性压低与强信号保留，并用静态契约锁住 DOM 顺序辅助函数和门控位置。

---

## [v2.4.16] - Annotations 四位年份误判收敛

- `noteTextMarker` 的纯数字分支从 1-4 位收窄为 1-3 位，避免正文中的 `1984`、`2023` 等年份链接被当作脚注 marker。
- 新增 `_isFourDigitNumberMarker()`，在 class/fragment 等启发式正向信号前排除四位数字文本；即使 href 形如 `#note2023` 也不会触发脚注弹窗。
- 显式语义白名单保留：`epub:type="noteref"` 或等价 role 会在四位数字排除前返回 true，仍支持少数明确标记的四位脚注编号。
- 回归测试覆盖年份链接排除、语义 noteref 覆盖，以及静态契约约束数字 marker 不得回退到 4 位。

---

## [v2.4.15] - Annotations 跨文档注释缓存

- `annotations.js` 新增 book 生命周期内的 `_sectionDocCache`，以 `Map` 实现 50 项 LRU，缓存跨章节/尾注文件的已解析 section 内容树。
- `_loadFromBook()` 的直接 section 命中与 brute-force spine 扫描统一经过 `_loadSectionDocument()`，缓存命中时不再重复调用 `section.load()`。
- `setBook()` 在 book 实例变化时清空缓存，`unmount()` 同样清空，避免旧书尾注内容跨书复用。
- 新增回归测试覆盖同一尾注文件二次点击不重复加载、切书后必须重新加载新书 section，并用静态契约约束缓存容量和 LRU 辅助函数。

---

## [v2.4.14] - Annotations 技术债收敛

- `isFootnoteLink()` 补充 CSS `vertical-align: super/sub/top/bottom` 检测，覆盖不用真实 `<sup>`、只靠 computed style 表示脚注引用的 EPUB。
- 新增源节点孤立性检查：长链接文本若占父块文本 80% 以上，会被视为目录/导航式链接，避免扁平段落中 `notes.xhtml#note1` 一类长链接误触发脚注弹窗。
- `_extractContent()` 加入 2000 字安全阀；空锚点尾注会沿后续 sibling 收集正文，并在 `<hr>`、标题或下一个带 id/name 的锚点处停止，避免把整章内容塞进弹窗。
- `annotations.js` 提取 `_hasSup()` 统一 `closest('sup')` / `querySelector('sup')` 判断，避免 `isBackLink()` 与 `isFootnoteLink()` 重复维护。
- href 片段解析集中到 `_parseHref()`，清理散落的 `split('#')`；跨章节注释加载复用 `activeBook.load` 绑定函数，避免扫描 spine 时反复 `.bind()`。
- `_BLOCK_TAGS`、`_PAGINATION_SETTLE_MS` 与 TOC 阈值提升为模块级常量；脚注 last-resort 提示改用 `.annotation-fallback-hint`，不再在 JS 中拼接 inline style。
- 新增静态回归约束，防止上述技术债重新散落。

---

## [v2.4.13] - Reader 异步上下文隔离

- `reader-runtime.js` 对旧 `rendition` 的迟到 `relocated`、`displayed`、iframe 用户事件与旧 `display()` wrapper 增加当前上下文校验，切书或布局重建后不得再写入当前书位置、抢焦点或解除恢复保护。
- `search.js` 在 `setBook()` 时取消旧搜索、恢复按钮并先清理旧 `rendition` 高亮；增量搜索结果携带 `searchId` 守卫，旧任务慢返回或旧结果点击都不能污染新书。
- `annotations.js` 与 `image-viewer.js` 为 hook、iframe 点击、异步脚注加载和弹窗跳转捕获发起时的 `book/rendition` 上下文，旧 iframe 事件不再影响新书。
- 设计确认：用户主动 `removeBook()` 是全量级联删除；自动 `enforceFileLRU()` 只删除 IndexedDB `files` 中的 EPUB 文件缓存，必须保留 `recentBooks`、`bookMeta`、封面、locations、高亮和书签，方便重新导入同一书籍后恢复进度与标注。

---

## [v2.4.6] - 重开定位无快速翻页

- 用户提供《九故事》EPUB 后重新从真实链路验证：65.3% 位置保存正确，`pos.cfi = epubcfi(/6/22!/4/168/1:0)`，`locator.restoreCfi = epubcfi(/6/22!/4/172/1:45)`。
- 根因修正：fresh rendition 首次 `display(restoreCfi)` 后，`currentLocation()` 可能短暂回报同章节旧分页；v2.4.5 根据该旧页码执行 `next()/prev()`，形成重开时可见的快速翻页。
- 单纯移除页校正会复现“右下角 65.3%，页面在旧页；一翻页进度回到旧页”的问题，因此不能只删逻辑。
- 最终策略：恢复期同章节、同页总数、同偏好签名但页码不一致时，只重放一次同一个 `displayCfi`；不再调用 `next()/prev()`。
- 真实 EPUB 连续重开 3 次验证：页面均停在 page 13/14、UI 为 65.3%、storage 未被旧页覆盖、恢复期间 `next/prev` 计数为 0。

---

## [v2.4.5] - 分裂位置快照自愈

- 根因确认：最近引入 `locator.restoreCfi` 后，恢复阶段优先 display 它；一旦 storage 出现“新 percentage / 新 pos.cfi + 旧 restoreCfi”的混合快照，就会表现为右下角进度是新的，但页面仍回到老位置。
- 进一步确认：关闭/刷新时若存在待执行的防抖保存，旧逻辑会重新采样 `currentLocation()`；而 epub.js 在同一 tick 内可能仍返回上一页，于是把刚翻到的新位置覆盖回旧页。
- 真实 EPUB 复测推翻了“恢复期完全不处理页码差异”的假设：`display(restoreCfi)` 对同一章节仍可能落到更早的 displayed page；本版先采用有限 `next()/prev()` 校正，该策略随后在 v2.4.6 被替换为同 CFI 直接重放。
- 新写入的 displayed-page locator 增加 `sourceCfi`，恢复时只有 `sourceCfi === pos.cfi` 才信任 `restoreCfi`；旧版无 `sourceCfi` 或 source 不匹配的 `restoreCfi` 会被忽略。
- `_correctRestoredPage()` 恢复为更窄的校正策略：只有 href/index、页总数、偏好签名都匹配时，最多执行 6 步 `next()/prev()`；校正期间仍处于恢复保护期，不写入 storage，不能收敛就清空 locator。该策略已在 v2.4.6 废弃。
- 恢复后 EPUB iframe 内的滚轮、触摸、鼠标、键盘手势会解除 `isRestoreAnchorProtected`，避免用户翻页后仍保存旧恢复锚点。
- 打开书籍时若已缓存 locations，会先校验 `pos.cfi` 与 `percentage` 是否一致；明显不一致时用 `percentage -> cfi` 兜底恢复，并清空旧 locator，避免翻页后进度再跳回旧页面。
- 若 locations 缓存损坏，打开流程会忽略该缓存并进入后台重建，避免历史缓存问题阻断阅读或恢复链路。

---

## [v2.4.4] - 翻页后保存位置不回滚

- `onRelocated()` 不再用同一 tick 内可能滞后的 `rendition.currentLocation()` 覆盖 relocated 事件位置，避免用户已翻到新页但落盘 CFI/locator 仍停在旧页。
- 当 `pos.cfi` 字符串相同但 displayed-page locator、`locator.restoreCfi` 或百分比变化时，仍会触发 `savePosition()`；修复“阅读进度显示已更新，重开仍回原页面”的漏写路径。
- 保留恢复期不自动翻页与恢复锚点保护：用户导航前仍不让恢复漂移覆盖已保存锚点，用户正常翻页后才写入新位置。

---

## [v2.4.3] - 分页页内锚点保存

- 分页模式保存位置时保留 `pos.cfi = currentLocation().start.cfi` 作为兼容主锚点，同时在 displayed-page locator 中写入 `restoreCfi`。
- `restoreCfi` 通过 `contents.range(start.cfi)` 向页内轻微前移后由 `contents.cfiFromRange()` 生成；恢复显示优先用 `restoreCfi`，但内存稳定锚点仍保持 `pos.cfi`。
- `flushPositionSave()` 在关闭/刷新前同样重建 locator，避免最后一次生命周期写入把恢复锚点覆盖回纯页边界。旧位置无需迁移，用户翻页或关闭后会自然写入新 locator。

---

## [v2.4.2] - 阅读位置恢复不自动翻页

- `_correctRestoredPage()` 改为只校验 displayed-page locator，不再根据 `displayed.page` 差异执行 `next()/prev()`。
- 同章节页码差异视为 locator 过期，清空 `currentStableLocator`，保留 `currentStableCfi` 与恢复锚点保护，避免重开书籍时发生自动前跳/后跳。
- 该策略在 v2.4.5 被真实 EPUB 验证修正：完全不处理页码差异会造成“进度新、页面旧”；最终在 v2.4.6 确认为同 CFI 直接重放，而不是恢复期翻页。

---

## [v2.4.1] - 阅读位置恢复降级修复

- `_correctRestoredPage()` 对章节不匹配、布局签名不兼容、页总数不一致或页码偏移超过一页的 displayed-page locator 统一视为过期快照，清空 `currentStableLocator`，保留 CFI 锚点。
- 这类过期 locator 不再输出运行警告，后续 `flushPositionSave()` 会写回无 locator 的干净位置，避免重开阅读器时反复出现 `[Runtime] CFI restore: page delta out of correction range`。

---

## [v2.0.0] - 数据与性能治理版本 (Data & Performance)
**核心目标**：完成 roadmap v2.0.0 的 P-1/P-2/P-3，提升 ETA 可信度与首屏交互体验。

- `utils.js`：新增 `computeSessionWeight`、`estimateRemainingMinutes`，引入会话加权（连续 1.0 / 轻度跳读 0.6 / 明显跳读 0.2）与低样本（sessionCount < 3）“估算中”策略。
- `reader.js`：`locations.generate()` 改为 idle 调度包装 `scheduleLocationsGeneration`（优先 `requestIdleCallback`），并按阶段反馈：“准备定位索引...”、“生成阅读定位索引...”、“定位索引就绪”。
- `home.js` + `home.css`：新增书架骨架屏（默认渲染 6 张卡片）与逐本流式渲染，每本书封面与元数据拉取就绪即插入 DOM。
- 测试：新增 `test/suites/v2_0_tdd.test.js`，包含 Utils 行为测试与版本升级静态断言。

---

## [v1.9.2] - 1.x 收尾稳定性版本 (Stability Wrap-up)
**核心目标**：完成 storage 错误语义、bookMeta 并发写一致性、高亮聚合覆盖与文档基线统一。

- `storage.js`：`_get/_set/_remove` 全部接入 `chrome.runtime.lastError` reject；新增 `bookMeta` 写队列，避免并发覆盖。
- `storage.js`：`getAllHighlights()` 从仅 recentBooks 扩展为 recentBooks + `highlights_*` key 扫描补全。
- `home/popup/image-viewer`：显隐控制进一步迁移为 class 切换，降低 `style.*` 直写。
- 文档：审计主文档统一为 `docs/comprehensive_repost.md`，删除过时报告文件。

---

## [v1.9.0] - CSP 收敛与内联样式清理 (Security Hardening)
**核心目标**：完成 v1.9 路线中的 C-1~C-6，并为 C-7（移除 `unsafe-inline`）做收尾准备。

- `reader.js`：`showLoadError` 从 `style.cssText` 切换到 `.reader-error-*`；翻页过渡改为 `.reader-main-dimmed` class。
- `search.js`：搜索结果与高亮采用 `.search-result-item` / `.search-highlight` 等类；状态文案仅使用 `textContent`。
- `toc.js`：空目录提示改为 DOM + `.toc-empty`。
- `manifest.json`：`style-src` **暂保留** `'unsafe-inline'`（仍有内联样式依赖，计划在 v1.9.1 清除）。
- 测试：`test/run_tests.js` 新增 `v1.9 CSP 收敛` 用例组，覆盖上述迁移点。

---

## [v2.3.0 - v2.3.3] — 阅读位置恢复 + iframe hook 幂等性

**核心目标**：彻底解决分页模式下 start.cfi/end.cfi 边界跳转问题；修复 iframe 内容 hook 生命周期缺陷。

### v2.3.3 — 位置恢复级联退化修复

- **`onRelocated` 自洽快照**：持久化路径优先使用 `rendition.currentLocation()` 重采样；当它与 relocated 事件参数不一致时，CFI、percentage、locator 必须来自同一个 location 源，避免保存出“当前 CFI + 旧页码/章节”的矛盾位置。
- **`_isPositionMeaningfullyChanged` 守卫**：写入前字符串精确比较新旧 CFI，相同则跳过 `schedulePositionSave`，避免 locations 加载后用边界 CFI 覆盖正确位置。
- **恢复锚点保护**：`openBook()` 通过保存 CFI 或 `targetCfi` 恢复分页位置后，`isRestoreAnchorProtected` 会阻止 locations cache-hit/generate-complete 与刷新 flush 把 epub.js 页边界 CFI 覆盖为新位置；用户翻页、进度跳转或目录/书签/搜索/注释跳转后解除。
- **displayed-page 一页内校正**：恢复后仅在同章节、同布局签名、页总数一致且页码仅偏移一页时执行一次 next/prev；更大偏移视为 locator 过期，清空 locator、保留 CFI，校正期间仍跳过位置写入。
- **locations 加载路径 CFI 守卫**：cache-hit 和 generate-complete 路径中，保护期使用 `state.currentStableCfi` 计算进度并跳过 `persistence.onRelocated`；非保护期仅在 CFI 真实变化时转交。
- **`setLayout()` 恢复保护**：布局切换期间 `isRestoringPosition = true`，await `display()` + 双帧等待后解除。
- **`_withCfiLock` 恢复保护**：字号/行高/字体切换的 CFI 保护锁同步增加 `isRestoringPosition` 标志。
- **`beforeunload` 兜底**：`persistence.mount()` 注册 `window.beforeunload`，刷新/关闭前调用 `flushPositionSave()`；保护期 flush 保存恢复锚点本身，不重新采样漂移边界。
- **移除重复 resize 监听器**：`reader-runtime.js` 的 resize 防抖已由 `reader-ui.js:bindResize` 覆盖。

### v2.3.2 — 位置恢复跳页修复

- **移除页校正导航**：重写 `_correctRestoredPage`，移除 next/prev 导航逻辑。CFI 本身是可靠的 DOM 位置指针，`display(cfi)` 后仅验证 href/index 是否与保存时一致；页码差异是字体加载导致的布局偏移，不是位置错误，不做导航。
- **修正 `_waitForRenditionStable`**：移除 triple-deferred 的 `reportLocation()` 调用（导致 `currentLocation()` 同步读取旧值），改为双帧等待布局 reflow。
- **`isLayoutStable` 标志**：`openBook()` display 期间为 false，阻止 `next()`/`prev()`/`displayPercentage()` 执行；`_correctRestoredPage` 完成后立即设为 true。避免字体加载完成前的误触发。
- **窗口 resize 防抖**：500ms debounce，resize 期间 `isResizing = true`，防止 relocated 事件在窗口拖拽过程中写入不完整位置。
- **进度不更新回归修复**：`isRestoringPosition=false` 和 `isLayoutStable=true` 必须在 `_correctRestoredPage` 后立即设置，不可移入 locations 索引段——后者包含 `await getLocations` 异步调用，会导致 `onRelocated` 长时间跳过位置写入，用户翻页后进度条不更新。

### v2.3.0 — 阅读位置恢复重写

- **替代 v2.2.6 的 end.cfi 策略**：改为 `start.cfi + displayed-page locator + 有界页校正`。保存时记录 epub.js 报告的 `displayed.page/index/href` 与布局签名；恢复时先用 CFI 粗定位，等待渲染与字体稳定后，若同一章节内仅偏移一页，则自动 `next()` 或 `prev()` 校正。
- `flushPositionSave()` 在刷新/关闭前重建完整 position（CFI、percentage、locator），避免持久化过期内存位置。
- `savePosition()` 向后兼容地支持 `locator` 字段，旧 `{ cfi, percentage, timestamp }` 数据无需迁移。

### v2.3.1 — iframe hook 幂等性 + 生命周期收敛

- `Highlights.setBookDetails()` / `ImageViewer.hookRendition()` / `Annotations.hookRendition()` 改为幂等（WeakSet 按 rendition/document 做 guard）。
- `hookRendition()` 同时处理未来 hook 和当前 `rendition.getContents()` 补绑定，修复已有 contents 的 iframe 空白点击不关闭。
- `openBook()` 中 Bookmarks/Search/Highlights 重复直调收敛，仅保留 lifecycle mount 唯一路径。

---

## [v2.2.0 - v2.2.6] — 安全与可访问性 + UI 视觉重设计

**核心目标**：CSP 收敛、ARIA 语义补全、阅读位置恢复策略迭代。

- **v2.2.0**：`speed.sessions` 持久化落地（`storage.js` 补全 `sessions: []` + `sessionCount: 0`，向后兼容旧数据）；ARIA 语义补全（工具栏/面板/书架卡片）；`image-viewer.js` `style.transform` 迁移为 CSS 自定义属性（`--iv-tx/--iv-ty/--iv-scale`）。
- **v2.2.2**：阅读位置改为"首次立即落盘 + 300ms 最终位置收敛"；修复搜索取消与注释弹窗切书后的交互恢复问题。
- **v2.2.3**：完成大规模代码审查，执行 TDD 工作流修复 11 项 UX 缺陷，确认高价值数据安全。
- **v2.2.5**：修复恢复期间 epub.js page-start CFI 污染可落盘位置的部分路径。
- **v2.2.6**：曾尝试分页模式改用 `location.end.cfi` 作为恢复锚点（该策略已由 v2.3.0 替代）。

---

## [v2.1.0 - v2.1.1] — Reader 内核解耦 (Reader Core Decoupling)

**核心目标**：完成 roadmap v2.1.0 的 R-1/R-2/R-3，建立 reader 分层边界。

### 交付内容
- 新增 `src/reader/reader-state.js`：单一状态源（可序列化），集中管理 `currentBookId` 等变量。
- 新增 `src/reader/reader-runtime.js`：epub.js 生命周期钩子与 locations idle 调度中心。
- 新增 `src/reader/reader-persistence.js`：位置（防抖）与阅读时长（visibility 监测）持久化策略。
- 新增 `src/reader/reader-ui.js`：DOM 监听器绑定与主题/排版 UI 状态控制。
- `src/reader/reader.js`：降级为入口 orchestrator（< 120 行），通过 `mount(context)` 编排各层。
- 子模块生命周期：移除匿名适配层，建立统一原生 `mount/unmount` 接口契约。
- 移除隐式共享：消除全局变量跨模块写入，改为显式 `state/context` 传递。
- 清理：删除 `DbGateway.getByFilename()` 死代码。

### 测试
- 新增 `test/suites/v2_1_tdd.test.js`。
- 运行 `node --test test/suites/*.test.js` 与 `node test/run_tests.js`。

---

## [v1.8.0] - 交互鲁棒性增强与持续性能优化 (Stability & UX)
**核心目标**：彻底解决 Popup 失焦状态下的文件输入竞态，校准 ETA 速率同步逻辑，并提升 Resize 状态下的位置保持精度。

### 1. 交互链路加固 (Interaction Robustness)
- **Popup 文件拾取优化 (BUG-01)**：
  - 引入 `showOpenFilePicker` API 作为首选文件打开方式。该 API 允许在文件对话框激活期间保持 Popup 焦点，避免了 Chrome 在系统对话框弹出时因失焦而提前卸载 `document` 导致的 `change` 事件丢失。
  - 保留 `<input type="file">` 作为降级方案以处理兼容性。
- **Resize 与重排锚点校准 (BUG-03)**：
  - **锚点位移修正**：将 `resize` 的恢复锚点从 `loc.end.cfi` 切换为 `loc.start.cfi`。解决了在字号放大场景下，由于单屏字数减少导致原 "末尾位置" 落在当前屏之前而产生的视觉后退现象。
  - **CFI 状态锁 (`_withCfiLock`)**：为字号、行高、字体切换建立保护机制。通过 `isResizing` 锁拦截重排期间的中间态 `relocated` 事件，并利用 `requestAnimationFrame` 确保在浏览器渲染循环完成后恢复至原始锚点。

### 2. 阅读速率采样校准 (ETA Calibration)
### 3. CSS / HTML 收尾清理

- **Popup 样式外联 (S-4)**：将 `popup.html` 的内联 `<style>` 拆分为独立文件 `popup.css`，便于维护与后续 CSP 收敛。
- **主题变量补全 (S-2)**：在 `themes.css` 新增 `[data-theme="custom"]` 变量块，确保自定义主题在未注入覆写前仍有稳定回退。
- **页面色彩声明 (S-5)**：`reader.html`、`home.html`、`popup.html` 统一加入 `<meta name="color-scheme" content="light dark">`。
- **拖拽遮罩结构预置 (S-6)**：拖拽层由 `reader.js` 动态 `innerHTML` 注入改为 `reader.html` 预置结构 + class 切换显示。

- **内存快照同步 (BUG-02-A)**：重构 `flushSpeedSession`。在样本落盘后立即同步更新内存中的 `_cachedSpeed` 快照。清退了旧版中无效的 `window` 全局污染指针及滞后的 `refreshCachedSpeed` 异步读取路径，确保 UI 统计数据即时更新。
- **挂机剔除机制 (BUG-02-B)**：监听 `visibilitychange` 事件。当页面从后台恢复 (visible) 时，立即重设 `_sessionStart` 锚点。确保了非活动状态下的时间流逝不被计入阅读速率分母，消除了因长时间挂机导致的 ETA 虚高。
- **采样阈值下调 (BUG-02-C)**：将 Session 级实时速率的激活阈值从 `(>60s, >0.5%)` 下调至 `(>30s, >0.3%)`，允许系统在更短的阅读周期内给出具备参考意义的估算。

### 3. 工程化与代码收拢
- **并行加载扩展 (TD-2.4)**：Popup 最近书籍列表接入 `Promise.all` 并行加载机制。封面 Blob 与书籍元数据的并发读取将首屏渲染耗时从线性 O(n) 降低至接近 O(1)。
- **工具库一致性**：`bookmarks.js` 与 `search.js` 现已彻底弃用局部实现的 `_escapeHtml` 等重复函数，全面迁移至 `Utils` 共享模块，降低维护熵值。
- **作用域收敛**：`reader.js` 的 `_cachedSpeed` 状态现已完美收拢至 IIFE 闭包，移除了所有残留的 `window` 全局挂载点。

---

## [v1.7.0] - 存储合并与体验性能双飞跃 (Storage Consolidation & Performance)
**核心目标**：通过高频数据合并优化 I/O 开销，引入速率采样算法提升 ETA 预测精度。

### 1. 存储结构高阶收拢 (Key Consolidation)
- **Metadata 合并**：将散落在 `pos_<bookId>` 和 `time_<bookId>` 的独立 Key 合并为统一的 `bookMeta_<bookId>`。
  - **降低写放大**：翻页或计时时仅操作一个微型 Key (<200 bytes)，无需触碰大型 `highlights` 字典，大幅降低 `sync` 存储压力。
  - **延迟迁移 (Lazy Migration)**：在 `getBookMeta` 中内置兼容逻辑，首次读取旧版数据时自动执行聚合与旧 Key 回收。

### 2. 精准 ETA 预估算法 (Speed Sampling)
- **Session 级速率采样**：废弃 `总时长 / 总进度` 的朴素算法（该算法在从中途开读时会产生严重偏低偏差）。
  - **连续性判断**：仅当单次阅读耗时 > 30s 且进度增量在 0.1% ~ 30% 之间时计入速率样本。
  - **跳跃过滤**：手动拖动进度条或跳章将被识别为跳转而非阅读，不计入速率计算。

### 3. I/O 流水线与响应优化
- **全并发加载**：重构 `loadBookshelf` 与 `btnClearAll`。将书架 20 本书的串行 I/O 加载改为 `Promise.all` 全并发模式，首屏响应从 ~600ms 降至 ~30ms。
- **防抖写入 (Debounced I/O)**：为 `savePosition` 引入 300ms 尾部防抖，防止快速翻页冲击存储。仅在页面 `hidden` 状态时强制 Flush。
- **重试退避机制**：为 `DbGateway` 引入指数退避重试（500/1000/2000ms），并在连续 3 次失败后熔断，防止重试风暴。

### 4. 健壮性保障
- **LRU 设计更正**：早期曾尝试把 `enforceFileLRU` 做成「文件 -> 封面 -> 元数据」级联驱逐；后续已明确废弃该方向。当前设计中，自动 LRU 只释放 IndexedDB `files` 中的 EPUB 文件缓存，主动删除才执行全量级联清理。
- **显式资源回收**：改由 `card.dataset` 持有 `ObjectURL` 引用，删除书籍时主动执行 `revoke`，不再依赖加载事件触发。
- **去中心化索引**：废弃 `highlightKeys` 风险索引，改由权威 `recentBooks` 列表遍历读取，确保标注面板 100% 数据一致性。

---

## [v1.5.0 - v1.6.0] - Phase D 数据层加固与 Schema 重构 (Storage Rebuild)
**核心目标**：建立基于 SHA-256 的唯一身份校验体系，解决 `filename` 主键导致的并发覆盖与数据孤岛。

### 1. 存储底层 Schema 重建 (DB v4)
- **内容哈希主键**：`files`, `covers`, `locations` 主键由 `filename` 迁移至 `bookId` (SHA-256 指纹)。解决了同名书籍静默覆盖原始文件但残留旧元数据的逻辑失效 (P0-SCHEMA-1)。 
- **离线指纹生成**：`generateBookId` 升级为 `filename` + 前 64KB 二进制切片组成的 SHA-256 哈希，杜绝哈希碰撞。
- **IO 并行化与网关升级**：
  - `removeBook()` 转换为 `Promise.all` 并发清理机制，显著缩短删除耗时。
  - `enforceFileLRU` 引入 `getAllMeta()` 游标 (Cursor-based) 扫描，仅读取元字段，消除了驱逐时加载数 MB 二进制 Blob 导致的内存峰值问题。
- **安全落盘语义**： IndexedDB `put` / `delete` 全部锁定为 `tx.oncomplete` 触发，确保数据真实落盘后再 resolve 信号。

### 2. 阅读体验与安全补全
- **滚动布局交互修复**：修正 `scrolled-doc` 模式下 `wheel` 事件被盲目拦截的问题，恢复原生纵向滚动 (D-1-A)。
- **标注安全补全 (P0-ANNOTATIONS-1)**：针对脚注提取引擎，引入正则过滤器阉割所有内联事件处理 (`on*`) 和恶意协议 (`javascript:`)，防止恶意 EPUB 触发沙盒穿透。
- **存储抽象归口**：`Bookmarks` 模块全面迁移至 `EpubStorage` 代理，清退全库所有分散的 `indexedDB.open` 调用，统一归口至 `DbGateway`。

---

## [v1.4.1] - 源代码深度审计与入口收拢 (Security Finalization)
**核心目标**：彻底消除分散连接隐患，通过全链路静态审计清剿残留风险。

- **存储入口最终收敛**：排查并移除 `home.js` 中 `storeFileData` 手动打开数据库的后门调用。
- **内存泄露治理**：在书架封面渲染链路植入 `onload/onerror` 自动 `revokeObjectURL` 机制。
- **搜索高亮 DOM 化**：`search.js` 废弃 `innerHTML` 拼串，采用 `TextNode` + `mark` 元素手动挂载，根除搜索注入风险。

---

## [v1.3.0 - v1.4.0] - Phase B/C 架构治理与网关抽象
**核心目标**：引入存储网关层治理连接债务，实施纵深防御策略。

- **存储底层网关化 (DbGateway)**：创建 `utils/db-gateway.js`。引入 Promise 缓存池机制，接管并单例化所有 `indexedDB.open`、`onupgradeneeded` 逻辑。
- **XSS 深度净化**：
  - `hl.color` 增加正则白名单校验，防止非法 CSS 载荷通过 style 注入。
  - 全链路 XSS 防护审计，对所有注入 UI 的变量强制执行 `escapeHtml` 净化。
- **排版微调**：双栏分页间距回归 80px，引入 `font-display: swap` 补全字体栈。

---

## [v1.2.0 - v1.2.7] - Phase A 存储跃迁与交互重生 (Performance Milestone)
**核心目标**：突破 2MB 数据限制，解决 iframe 竞态下的交互遗留。

### 1. 存储引擎革命
- **Locations 缓存引擎**：将 `Locations` (坐标地图) 从受限的 `localStorage` 迁移至 `IndexedDB`。实现百兆巨著“微秒级”秒开与精准进度回溯。
- **计时器可靠性**：引入 `visibilitychange` 监听，确保 Tab 关闭瞬间立即 Flush 内存中的阅读时长。
- **IDB 版本对齐**：统一全项目连接版本号为 `V3`，修复了新用户因自动产生空 V1 库导致的建表失败。

### 2. 交互状态机重构
- **`_internalAction` 同步锁**：在 `highlights.js` 引入互斥状态，确保点击任何空白区域都能 100% “核爆”清空遗留面板。
- **遮罩层竞态治理**：`sidebar-overlay` 统一逻辑代理，彻底解决目录/搜索/书签面板叠开导致的遮罩死锁。
- **交互边界感知**：
  - 为笔记弹窗引入实体高度感知 (`top < 200px`) 换算引擎，实现顶部边缘自动向下翻转 (`.flip`)。
  - 使用 `mousedown` 替代 `click` 拦截 iframe 事件，解决输入框焦点吞噬监听器的问题。

### 3. 视觉与排版纠偏
- **下划线 GPU 修正**：引入 `translateY(-4px)` 纠正大行高下的线条偏离。
- **SVG 精准净界**：通过 `svg.epubjs-annotation polyline` 专一性选择器，在保留书籍原本插图前提下通过 CSS 全局抹除残留黑线。
- **阅后无痕搜索**：引入 `_lastSearchAlertCfi` 单例追踪闭环，确保搜索高亮在切换章节或关闭面板时瞬间剥离。

---

## [v1.1.0 - v1.1.6] - 细节工程化与健壮性提升
**核心目标**：针对坐标计算与 UI 残留进行深度清淤。

- **定位再感知**：增强了“修改标注”环节的物理坐标换算。通过实时监测 `notePopup` 的 `getBoundingClientRect` 动态注入 `.flip` 样式。
- **异步渲染同步化**：针对 Epub.js 翻页后 iframe 重载导致的标注丢失，引入 `reRenderHighlight` 同步钩子。
- **划线专项修复**：废弃方框渲染，全面切入“仅下划线”模型，并引入 `clip-path` 掩码。

---

## [v1.0.0] - 项目基石奠定
**核心目标**：构建生产可用的 EPUB 离线阅读环境。

- **基础设施**：集成 Epub.js 核心引擎，支持流式/分页布局切换。
- **存储方案**：确立 `storage.local` (配置) + `IndexedDB` (大容量文件) 的混合架构。
- **基础套件**：实现 TOC 提取、全文搜索排队器、主题切换系统。
