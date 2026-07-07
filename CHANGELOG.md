# CHANGELOG

所有重要变更记录于此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [Unreleased]

---

## [2.4.18] - 2026-07-07

### fix
- **FB2 转换格式注释容器识别**：`Annotations._buildDocContext()` 现在会把 `body[name="notes"]` / `body[name="comments"]` 及其 `section` 下的链接纳入 `footnoteSectionNodes`，避免注释区内回链被误拦截为正文脚注。
- **FB2 同文档目标识别**：`isFootnoteLink()` 的 target analysis 会把目标落在 `body[name="notes"]` / `body[name="comments"]` 内视为注释容器强信号，提升 Calibre FB2 转换书籍的脚注识别率。
- **入口脚本缓存刷新**：Reader 本地脚本 cache-buster 升级为 `?v=20`，确保 FB2 兼容逻辑被加载。

### test
- Reader 模块行为测试新增 FB2 notes body 内回链排除、正文链接指向 FB2 notes body 目标识别回归；Reader 功能模块契约测试新增 `body[name="notes"]` / `body[name="comments"]` 静态约束。

---

## [2.4.17] - 2026-07-07

### fix
- **同文档脚注拓扑弱负向信号**：`isFootnoteLink()` 对 `href="#..."` 目标复用同一次 `_findTarget()`，并通过 `compareDocumentPosition()` 判断目标是否位于源链接之前；若目标前置，只压低 class/fragment 这类弱阳性，减少返回链接或双向链接图谱误判。
- **强信号保留**：`epub:type="noteref"`、role 语义、真实 `<sup>` / 上标样式和明确 footnote 容器仍可覆盖目标前置信号，避免把弱负向误用成强否决。
- **入口脚本缓存刷新**：Reader 本地脚本 cache-buster 升级为 `?v=19`，确保 Annotations 拓扑修复被加载。

### test
- Reader 模块行为测试新增同文档目标前置压低 class/fragment 弱阳性、但不否决 `epub:type="noteref"` 强信号的回归；Reader 功能模块契约测试新增 DOM 顺序判断辅助与弱阳性门控静态约束。

---

## [2.4.16] - 2026-07-07

### fix
- **四位年份链接误判收敛**：`noteTextMarker` 的纯数字脚注 marker 从 1-4 位收窄到 1-3 位，并新增四位数字 marker 排除；正文里的 `1984`、`2023` 等年份链接即使 href/fragment 形似 `note*` 也不会弹脚注。
- **语义白名单保留**：带 `epub:type="noteref"` 或等价 role 的四位数字引用仍按 EPUB 语义识别为脚注，避免破坏显式标记书籍。
- **入口脚本缓存刷新**：Reader 本地脚本 cache-buster 升级为 `?v=18`，确保 Annotations 年份误判修复被加载。

### test
- Reader 模块行为测试新增四位年份链接排除与 `epub:type="noteref"` 四位数字保留回归；Reader 功能模块契约测试约束 `noteTextMarker` 纯数字上限不得回退为 4 位。

---

## [2.4.15] - 2026-07-07

### perf
- **跨文档注释 LRU 缓存**：`Annotations._loadFromBook()` 现在对跨章节/尾注文件的已解析内容树做 book 生命周期内缓存，容量上限 50；同一尾注文件二次点击不再重复 `section.load()`，切书或卸载时清空缓存。
- **入口脚本缓存刷新**：Reader 本地脚本 cache-buster 升级为 `?v=17`，确保 Annotations 缓存实现被加载。

### test
- Reader 模块行为测试新增跨文档注释缓存命中与切书清空回归；Reader 功能模块契约测试新增缓存容量、LRU 读写辅助和统一 section 加载路径静态约束。

---

## [2.4.14] - 2026-07-07

### refactor
- **Annotations 低风险技术债收敛**：`annotations.js` 集中提取 `_hasSup()`、`_parseHref()`、`_BLOCK_TAGS` 与 `_PAGINATION_SETTLE_MS`，消除重复 `sup` 查询、散落的 `href.split('#')`、局部块标签数组和分页补偿魔法数字。
- **Annotations fallback 样式归口**：脚注 last-resort 提示改用 `.annotation-fallback-hint` CSS class，不再在模块里拼接 inline style 字符串。
- **Annotations 加载路径微收敛**：跨章节注释加载复用同一个 `activeBook.load` 绑定函数，避免 brute-force 扫描时反复 `.bind()`。
- **入口脚本缓存刷新**：Reader 本地脚本 cache-buster 升级为 `?v=16`，确保 Annotations 重构被加载。

### fix
- **CSS 上标脚注识别**：`isFootnoteLink()` 在便宜的字符串/DOM gate 之后补充 `computedStyle.verticalAlign` 检测，能识别使用 `vertical-align: super/sub/top/bottom` 而非真实 `<sup>` 的脚注引用。
- **扁平目录长链接排除**：`isFootnoteLink()` 新增源节点孤立性检查；当长链接文本占父块文本 80% 以上时视为导航/目录式链接，即使 fragment 命中 `note*` 形态也不弹注释，降低 TOC 误判。
- **注释内容安全阀**：`_extractContent()` 新增 2000 字文本上限，超长内容会截断并追加“内容过长”提示；空锚点脚注会沿 `nextSibling` 收集正文，并在 `<hr>`、标题或下一个带 id/name 的锚点处停止，避免弹窗吞入整章内容。

### test
- Reader 功能模块契约测试新增 Annotations 技术债收敛静态约束，覆盖模块级常量、`_hasSup()`、`_parseHref()`、fallback CSS class、禁止散落 `split('#')` 与分页补偿魔法数字；Reader 模块行为测试新增 CSS `vertical-align` 上标识别、扁平段落孤立长链接排除、空锚点 sibling 收集边界和超长内容截断回归。

---

## [2.4.13] - 2026-07-07

### fix
- **ReaderRuntime 旧 rendition 事件隔离**：`relocated`、`displayed`、iframe 用户意图事件和 `display()` wrapper 均校验触发者是否仍是当前 `state.rendition`；切书或布局重建后，旧 `rendition` 的迟到事件不会写入当前书位置、抢焦点或解除恢复锚点保护。
- **Search 切书生命周期隔离**：`Search.setBook()` 现在会先取消进行中的搜索、恢复搜索按钮，并在替换新 `rendition` 前清理旧书搜索高亮，避免搜索标记残留在旧 iframe 或误清到新书。
- **Search 旧任务结果防回写**：搜索增量渲染携带 `searchId` 守卫，旧书搜索慢返回后不会把结果追加到新书面板；旧搜索结果项也不会在切书后驱动新书跳转。
- **Search 章节资源收口**：章节 `load()` 成功后统一在 `finally` 中 `unload()`，即使 `find()` 抛错或切书中断也会释放章节资源。
- **Annotations 切书上下文隔离**：脚注 hook、点击处理、异步内容加载和弹窗跳转均捕获发起时的 `book/rendition` 上下文；切书或布局重建后，旧 iframe 点击和旧脚注慢返回不会显示到新书，也不会驱动新 `rendition` 跳转。
- **ImageViewer 切书上下文隔离**：图片 hook 和 iframe 图片点击捕获当前 `rendition` 上下文；切书或布局重建后，旧 iframe 的图片点击不会再打开当前书籍页面的图片查看器。
- **入口脚本缓存刷新**：Reader 本地脚本 cache-buster 升级为 `?v=15`，确保 Search 生命周期修复被加载。

### test
- ReaderRuntime 测试新增旧 `rendition` 迟到事件隔离回归；Reader 模块行为测试新增 Search、Annotations 与 ImageViewer 切书竞态回归，覆盖旧搜索慢返回不回写新书结果、切书时必须清理旧 `rendition` 上的搜索高亮、旧脚注异步加载结果不得显示到新书，以及旧 iframe 图片点击不得打开新书页面的图片查看器。

---

## [2.4.12] - 2026-07-07

### fix
- **首页刷新代次隔离**：`home.js` 的书架与标注刷新加入 render sequence。旧一轮 `getRecentBooks()`、封面/meta 读取或标注读取返回时，若已有新刷新启动，会直接退出，不再把已删除书籍、旧筛选结果或旧排序结果重新写回 DOM。
- **书签切书竞态隔离**：`Bookmarks` 的加载、切换和删除操作捕获发起时的 `bookId`，切书后旧请求返回不会渲染到新书，也不会把旧书书签保存到新书记录。
- **书签按钮状态防回滚**：`ReaderPersistence` 查询当前页是否已加书签时加入序列守卫，快速翻页下上一页的慢查询返回后不会把当前页按钮状态改错。
- **书签异步错误隔离**：书签列表自动加载、面板刷新、删除按钮和 Reader 工具栏书签按钮失败时只记录告警，不再留下未处理 Promise 拒绝。
- **高亮切书竞态隔离**：`Highlights.setBookDetails()` 加入上下文序列守卫，切书后旧书高亮列表慢返回不会渲染到新书；高亮列表读取失败时记录告警并按空列表继续绑定，不阻断 Reader 打开；高亮保存失败也只记录告警，不留下未处理 Promise。
- **入口脚本缓存刷新**：home 页本地脚本 cache-buster 升级为 `?v=12`，Reader 本地脚本 cache-buster 升级为 `?v=14`，确保首页与书签异步刷新防护被加载。

### test
- 首页 UI 静态回归补充书架与标注刷新代次约束；Reader 模块行为测试补充 Bookmarks 切书竞态与书签失败隔离回归；ReaderPersistence 测试补充书签按钮状态防回滚；Highlights 测试补充旧书高亮加载慢返回、旧选择保存、加载失败降级和保存失败隔离，确保旧书加载、旧 toggle、旧页查询、旧高亮列表、旧选择和失败写入都不会污染新书或当前页。

---

## [2.4.11] - 2026-07-07

### fix
- **recentBooks 写入串行化**：`EpubStorage.addRecentBook()` 与 `removeRecentBook()` 改为通过 `_recentBooksQueue` 串行执行读改写，避免并发导入、删除或入口刷新时读到同一旧列表，导致最后一次写入覆盖另一本书架记录。
- **bookMeta 整体覆写串行化**：`saveBookMeta()` 改为进入同书 `_bookMetaQueue`，与位置、时长、速度 patch 保持调用顺序，避免批量覆写和阅读中保存并发时被旧快照回滚。
- **bookMeta 清除路径串行化**：`removePosition()` 与 `removeReadingTime()` 改为进入同书 `_bookMetaQueue`，并在无现存 `bookMeta` 时不创建空记录，避免清位置/清时长与保存位置/时长并发时互相回滚字段。
- **bookMeta 迁移路径串行化**：`getBookMeta()` 的 v1.6 `pos_/time_` lazy migration 改为进入同书队列；首次 `savePosition()` / `saveReadingTime()` 创建 `bookMeta` 时会吸收旧版字段，避免迁移回写旧位置或丢失旧阅读时长。
- **入口脚本缓存刷新**：Reader 本地脚本 cache-buster 升级为 `?v=13`，home/popup 本地脚本 cache-buster 升级为 `?v=11`，确保存储层行为变更被三个入口页加载。

### test
- 存储层测试新增 `addRecentBook`、`bookMeta` lazy migration、`saveBookMeta`、`removePosition`、`removeReadingTime` 并发写入回归，并在测试重置流程中复位 `_recentBooksQueue`，确保并发新增书籍、旧版迁移、整体覆写和同书 meta patch 不会互相覆盖。

---

## [2.4.10] - 2026-07-07

### fix
- **首页异步错误隔离**：`home.js` 中偏好读取/保存、书架刷新、标注刷新、删除书籍、清空书架、删除标注和导出笔记均改为局部错误隔离；失败时记录 `[Home] ... failed` 告警，当前 UI 更新不回滚，也不产生未处理 Promise 拒绝或阻断后续交互绑定。
- **弹窗异步错误隔离**：`popup.js` 中打开文件、进入书架和 file input 事件绑定前置到最近阅读加载之前；最近阅读加载与移除书籍路径均通过局部 catch 记录告警，避免 storage 抖动造成核心按钮不可用或未处理 Promise 拒绝。
- **偏好写入串行化**：`EpubStorage.savePreferences()` 改为通过 `_preferencesQueue` 串行执行增量合并，避免首页主题/视图、Reader 布局/主题等并发保存时读到同一旧值而互相覆盖。
- **bookMeta 队列失败收敛**：`EpubStorage._enqueueBookMetaWrite()` 继续向调用方返回真实写入失败，但内部排队 Promise 会吞掉该失败后清理队列，避免 `finally()` 派生出额外未处理 Promise 拒绝，并保证同书后续写入可继续。
- **入口脚本缓存刷新**：`home.html` 与 `popup.html` 本地脚本 cache-buster 统一升级为 `?v=10`，避免入口脚本变更后仍命中旧缓存。

### test
- 首页与弹窗 UI 静态测试新增异步错误隔离与脚本 cache-buster 约束，确保主题和视图保存、书架/标注刷新、删除、导出和弹窗最近阅读路径都有安全失败处理，且入口本地脚本版本保持一致；存储层测试新增偏好并发写入与 bookMeta 队列失败回归，确保增量保存不互相覆盖，内部队列 Promise 不派生未处理拒绝。

---

## [2.4.9] - 2026-07-07

### refactor
- **Search 模块导出一致化**：`search.js` 补齐外层 IIFE 与 `window.Search` 导出，和其他 Reader 功能模块保持同一公开契约，避免顶层 `const` 与文档/加载顺序约束漂移。
- **Reader 脚本 cache-buster 对齐**：`reader.html` 中工具层、功能模块和四层架构脚本统一升级为 `?v=12`，与架构文档加载顺序示例保持一致。

### fix
- **章节标题匹配精确化**：`ReaderState.findTocItem()` 改为去除 fragment 后按路径边界匹配，避免 `ch10` 误命中短 href `ch1` 导致章节标题显示错误。
- **布局偏好保存错误隔离**：`ReaderRuntime.setLayout()` 保存 layout 偏好失败时会记录告警但继续完成当前布局切换，避免产生未处理 Promise 拒绝。
- **布局切换恢复锁异常释放**：`ReaderRuntime.setLayout()` 在销毁旧 rendition、重建、模块重绑或 display 任一步失败时都会释放 `isRestoringPosition`，避免后续阅读位置写入被长期抑制。
- **Reader UI 偏好保存错误隔离**：主题、颜色、字号、行距和字体偏好保存失败时统一记录告警，不阻断当前 UI 更新，也避免未处理 Promise 拒绝。
- **阅读持久化错误隔离**：位置保存和阅读时长保存失败时统一记录告警，不再让 `schedulePositionSave()`、`visibilitychange`、`beforeunload` 或定时写入留下未处理 Promise 拒绝。

### test
- Reader 功能模块公开契约测试改为直接验证 `window.XXX` 导出，并新增统一导出断言；Reader 入口测试新增脚本 cache-buster 一致性检查；ReaderState 测试补充 TOC href 边界匹配回归；ReaderRuntime 测试覆盖 layout 偏好保存失败不阻断布局切换与重建失败释放恢复锁；ReaderUi 测试覆盖偏好保存失败不阻断主题更新；ReaderPersistence 测试覆盖位置与阅读时长保存失败隔离。

---

## [2.4.8] - 2026-07-07

### refactor
- **存储 key 中心化**：`storage.js` 新增 `KEYS` / `STORES` 常量，统一生成 `preferences`、`recentBooks`、`bookMeta_*`、旧版 `pos_/time_`、高亮、书签和 IndexedDB store 名称，降低迁移、删除、LRU 与兼容路径使用不同硬编码 key 的风险。
- **Reader UI 事件绑定幂等**：`reader-ui.js` 的 `bindRuntime()` 改为可重复调用但只注册一次顶层监听，事件回调读取当前 runtime 引用，避免异常重试、测试复挂或热重载时叠加键盘、按钮、拖拽监听。
- **功能模块初始化幂等**：`Annotations`、`Bookmarks`、`TOC`、`Search`、`ImageViewer`、`Highlights` 的 `init()` 对同一 document 只注册一次顶层事件监听，避免重复 bootstrap 或测试复挂时叠加按钮、键盘、遮罩与窗口监听。
- **UI 进度值防御性归一化**：新增 `Utils.normalizePercent()`，home 书架和 popup 最近阅读列表在把 storage 中的阅读进度写入文本或 CSS 自定义属性前统一裁剪到 0–100，避免损坏/旧版数据污染界面。

### test
- 新增存储层源码契约测试，确保 per-book key 不再散落回实现；新增 ReaderUi 重复绑定行为测试、功能模块 init 幂等测试与 UI 进度归一化测试。全量测试保持通过。

---

## [2.4.7] - 2026-07-07

### fix
- **切书生命周期闭合**：在阅读器内打开另一本文本前，先 flush 旧书位置、阅读时长与速度 session，再卸载功能模块并显式销毁旧 `rendition` / `book`，避免旧 iframe、事件绑定和未落盘进度污染新书。
- **导入后可重开保障**：Reader 页本地导入 EPUB 时改为等待 `storeFile()` 完整落盘后再进入阅读，避免快速关闭后 recentBooks 已有记录但 IndexedDB 文件缓存缺失。
- **缓存重开二进制边界修复**：`loadFileByBookId()` 不再手动传入 `TypedArray.buffer`，统一交给 `normalizeBookData()` 裁剪视图边界，避免非零 offset 的缓存视图带入多余字节导致解析失败。
- **主动删除与自动 LRU 分层清理**：`removeBook()` 会等待同书 `bookMeta` 写队列收尾并在删除期间跳过新写入，防止主动删除后回写孤立 meta；`enforceFileLRU()` 恢复既定设计，仅淘汰占空间的 EPUB 文件缓存，保留 recentBooks、bookMeta、封面、locations、高亮和书签，方便重新导入后继续使用阅读进度与标注。
- **书架顺序稳定**：首页流式渲染书籍卡片时按 `recentBooks` 原始索引替换对应骨架，避免两本及以上 EPUB 因封面/元数据异步返回顺序不同导致书架排序跳动。
- **注释弹窗 HTML 清洗增强**：EPUB 内联注释内容进入宿主扩展页前改为 template DOM 解析后逐属性清洗，移除 `on*` / `srcdoc`，并拦截未加引号或空白混淆的 `javascript:` URL。

### sample
- 使用根目录两本样本 EPUB 校验导入指纹与包结构：`九故事 - J.D.塞林格.epub` → `book_974cdedfeff479ff4aaf6edaf15ebe96`，`鱼不存在 - 露露·米勒.epub` → `book_339786574b00222a503c3f7d71e83f60`。

### test
- 新增 6 个生命周期/安全回归测试，覆盖 Reader 导入等待缓存、缓存视图边界、切书前落盘并销毁旧 rendition、删除时等待 bookMeta 队列、LRU 仅淘汰文件并保留用户数据、注释弹窗 HTML 清洗与书架流式渲染顺序。全量 145 个测试通过。

---

## [2.4.6] - 2026-07-07

### fix
- **彻底移除恢复期 `next()/prev()` 快速翻页校正**：真实 EPUB 验证确认，fresh rendition 首次 `display(restoreCfi)` 后 `currentLocation()` 可能短暂回报旧页；v2.4.5 的页码校正会因此误判并快速翻页。本版改为在同章节、同布局签名、页总数匹配且页码不一致时，最多重放一次同一个 `displayCfi`，不再调用 `next()/prev()`。
- **修复“右下角进度是新的、页面是旧的、一翻页进度回滚”**：恢复阶段若首次显示停在旧分页，会在 loading 期间直接 `display(同一 CFI)` 收敛到保存页；用户真正翻页前仍保护 `currentStableCfi`，不会把旧 `currentLocation()` 写回 storage。
- **连续重开稳定性**：使用用户提供的《九故事》EPUB 复测，65.3% 位置连续重开 3 次均停在 page 13/14，`pos.cfi` 与 `locator.restoreCfi` 未被关闭/重开覆盖，恢复期间 `next/prev` 计数为 0。

### test
- 更新 ReaderRuntime 恢复定位回归用例：覆盖同章节前页/后页/真实 EPUB page 9 → page 13 短暂回报时，只允许二次 `display(同一 CFI)`，禁止 `next()/prev()`；全量 139 个测试通过。

---

## [2.4.5] - 2026-07-07

### fix
- **修复“进度是新的、页面是旧的”分裂快照**：分页恢复不再无条件信任 `locator.restoreCfi`。新写入的 locator 会带 `sourceCfi`，恢复时只有 `locator.sourceCfi === pos.cfi` 才允许用 `restoreCfi` 显示，避免旧 `restoreCfi` 把新进度恢复到老页面。
- **恢复页码做同章节有限校正**：真实 EPUB 验证确认，epub.js `display(restoreCfi)` 仍可能落到同章节更早的显示页。恢复期现在只在 href/index、页总数、偏好签名均匹配时，最多执行 6 步 `next()/prev()` 校正到 locator 记录页；校正期间保持 `isRestoringPosition`，不触发位置写入，无法收敛则清空 locator。该策略已在 2.4.6 被同 CFI 直接重放替代。
- **iframe 内部手势会解除恢复保护**：恢复后若用户在 EPUB iframe 内滚轮、触摸、鼠标或键盘翻页，会先解除 `isRestoreAnchorProtected`，避免“页面已翻到新页，但保存仍停在恢复锚点”。
- **分页恢复锚点改为列感知采样**：分页模式下优先从当前 displayed page 所在列的可视区域生成 `restoreCfi`，避免在横向分页 iframe 中误采整章中点。
- **坏快照自愈**：打开书籍时若已缓存 locations，先加载缓存并检查 `pos.cfi` 对应百分比是否与已保存 `percentage` 明显不一致；若不一致，说明 storage 中 CFI 与百分比分裂，恢复时改用 `percentage -> cfi` 兜底，并清空旧 locator。
- **关闭/刷新前不再用旧页覆盖待写入翻页**：`flushPositionSave()` 发现已有防抖中的位置写入时，直接保存内存中的最新 relocated 快照，不再重新采样可能仍停在上一页的 `currentLocation()`。
- **损坏 locations 缓存不再阻断打开**：缓存 locations 加载失败时按无缓存处理，先按保存 CFI 打开书籍，再进入后台重建路径。

### test
- 补充 ReaderPersistence / ReaderRuntime 回归测试，覆盖旧 `restoreCfi` 不得覆盖新 `pos.cfi`、真实 EPUB 同章节多步页校正、iframe 用户手势解除恢复保护、列感知可视锚点、`pos.cfi` 与 `percentage` 分裂时用百分比恢复、pending flush 不回滚、损坏 locations 缓存降级打开。

---

## [2.4.4] - 2026-07-07

### fix
- **翻页后恢复位置不再回滚到旧页**：`onRelocated()` 改为优先使用 epub.js `relocated` 事件携带的新位置落盘；`rendition.currentLocation()` 在同一 tick 内可能仍停留在上一页，不能覆盖本次翻页事件。修复“进度条已变化，但重新打开仍回到原页面”的问题。
- **CFI 相同也会刷新恢复快照**：当 `pos.cfi` 字符串未变，但 displayed-page locator、`locator.restoreCfi` 或百分比发生变化时，仍会触发 `savePosition()`，避免只保存了百分比而恢复锚点停留在旧页。

### test
- 补充 ReaderPersistence 回归测试，覆盖 `currentLocation()` 旧值不能覆盖 relocated 新位置、CFI 相同但 locator/百分比变化仍保存，以及无变化时不重复写入。

---

## [2.4.3] - 2026-07-06

### fix
- **分页模式拆分保存锚点与恢复锚点**：`pos.cfi` 继续保存 epub.js `location.start.cfi` 作为进度计算与存储兼容锚点；分页模式额外在 `locator.restoreCfi` 写入从 `start.cfi` 向页内轻微前移的恢复锚点。恢复时优先 display `restoreCfi`，但 `currentStableCfi` 保持 `pos.cfi`，避免把边界 CFI 直接用于分页恢复导致前跳。
- **刷新/关闭前重建恢复 locator**：`flushPositionSave()` 会重新采样当前 location，并同步重建 `locator.restoreCfi`；生成失败时降级为旧行为，不阻断阅读。

### test
- 补充分页恢复锚点 TDD 回归测试，覆盖 `onRelocated()`、`flushPositionSave()`、恢复锚点不可用降级、滚动模式不启用恢复锚点，以及恢复保护期 flush 不重采样。

---

## [2.4.2] - 2026-07-06

### fix
- **恢复期不再自动翻页**：`_correctRestoredPage()` 改为只校验 displayed-page locator；同章节内即使页码只差一页，也不再执行 `next()/prev()`。页码漂移只会清空过期 locator，保留已保存 CFI 和恢复锚点保护，避免重新打开书籍时被旧 locator 带到上一页/下一页。该原则最终在 v2.4.6 确认为“同 CFI 直接重放一次，不做翻页导航”。

### test
- 更新恢复定位回归测试，覆盖同章节页码差一页时 `next()/prev()` 均不调用、`currentStableCfi` 不偏移、过期 locator 被清理。

---

## [2.4.1] - 2026-07-06

### fix
- **恢复 locator 失效降级**：`_correctRestoredPage()` 遇到同章节但页码偏移超过一页、页总数不一致、章节不匹配或布局签名不兼容时，不再 `console.warn` 报运行警告；改为清空 `currentStableLocator`，保留 CFI 锚点，并在后续 flush 中写回无 locator 的干净位置，避免重开时重复触发 `[Runtime] CFI restore: page delta out of correction range`。
- **阅读位置恢复锚点保护**：`openBook()` 通过已保存 CFI 或 `targetCfi` 恢复分页位置后，新增 `isRestoreAnchorProtected` 保护期；用户真正翻页、进度跳转、目录/书签/搜索/注释跳转前，locations cache-hit/generate-complete 与刷新 `flushPositionSave()` 不再用 epub.js 回报的页边界 `currentLocation().start.cfi` 覆盖已保存锚点。修复重开阅读器位置不准、刷新后继续跳页的级联根因。
- **恢复 displayed-page 一页内校正**：`_correctRestoredPage()` 在同章节、同布局签名、页总数一致且仅偏移一页时执行一次 `next()/prev()` 校正；校正全程仍处于恢复保护期，不写入中间态。
- **位置快照一致性**：`onRelocated()` 持久化时保证 CFI、percentage、locator 来自同一个 location 源；当 `rendition.currentLocation()` 与事件参数不一致时，不再混用“current CFI + 旧事件 locator”，避免保存出章节/页码互相矛盾的位置。

### test
- 补充恢复锚点保护与 locator 失效降级回归测试，覆盖恢复后 locations 漂移不落盘、刷新前 flush 不重采样漂移 CFI、保护期 relocated 只更新 UI、重采样快照一致性，以及页码偏移超过一页时不输出运行警告。

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
