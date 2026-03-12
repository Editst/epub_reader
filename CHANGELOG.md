# 更新日志 (Changelog)

## [2.1.0] - Reader 内核解耦

### Added
- 新增 `reader-state.js`、`reader-runtime.js`、`reader-persistence.js`、`reader-ui.js` 四层模块。
- 新增 `docs/v2.1.0-development-plan.md` 与 `test/suites/v2_1_tdd.test.js`。

### Changed
- `reader.js` 重构为入口编排层并统一模块挂载流程。
- `reader.html` 注入 v2.1 reader 子模块脚本。
- 版本升级到 `2.1.0`，文档与测试基线同步升级。

### Removed
- 删除 `DbGateway.getByFilename()` 死代码（D-2026-06）。

## [2.0.0] - 数据与性能治理

### 🚀 新增与优化
- **[P-1] ETA 模型升级**：基于会话权重识别连续阅读/跳读样本，低样本场景显示“估算中”。
- **[P-2] locations 生成调度**：`reader.js` 增加 `scheduleLocationsGeneration`，优先使用 `requestIdleCallback`，并提供阶段性进度提示。
- **[P-3] 书架流式渲染**：`home.js` 支持骨架屏占位与每书就绪即渲染，降低首屏等待体感。

### 🧪 测试
- 新增 `test/suites/v2_0_tdd.test.js`，覆盖 Utils 新算法、reader/home 契约与 manifest 版本。

### 📝 文档与版本
- `manifest.json` 版本升级为 `2.0.0`。
- 新增 `docs/v2.0.0-development-plan.md`（TDD 开发计划文档）。
- `README.md`、`docs/ROADMAP.md`、`docs/walkthrough.md`、`docs/architecture.md`、`docs/modules.md` 同步更新到 v2.0.0 语义。

---

## [1.9.3] - Bug 修复

### 🐛 关键 Bug 修复

- **[BUG-A] 注释弹窗启动时空白显示且无法关闭**
  - 根本原因：`reader.css` 中 `.annotation-popup` 块级规则（`display: flex`）
    出现在第 670 行的 `.annotation-popup { display: none }` **之后**，
    导致后者被层叠覆盖，弹窗在页面加载时即处于可见状态，无法通过关闭按钮隐藏。
  - 修复：从 `.annotation-popup` 默认规则块中移除 `display` 属性，
    `display: flex` 仅由 `.annotation-popup.is-visible` 规则负责设置，
    保持与 `.annotation-overlay` 的一致性。

- **[BUG-B] Popup 页面点击「打开文件」无任何反应（跨版本反复调试终定根因）**
  - **诊断线索**：打开 Chrome DevTools 后点击恢复正常，关闭后再次失效。
    这是 Chrome 在扩展 popup 中对非用户手势操作施加额外限制、DevTools 会放宽这些限制的典型表现。
  - **根本原因（双重）**：
    1. v1.9.2 将 `popup.html` 内联 `<style>` 改为外部 `popup.css` 并加入
       `<link rel="preconnect">` 外部字体标签。`preconnect` 受 `connect-src` 约束，
       manifest CSP 未配置 `connect-src`，请求被阻断，干扰 popup 页面加载流程。
    2. **更直接的根因**：`#file-input` 的隐藏从内联 `<style>`（随 HTML 同步解析，
       始终生效）移入外部 CSS 文件（异步加载）。Chrome 扩展 popup 环境下
       **禁止对 `display:none` 元素调用 `.click()`**，DevTools 打开时该限制被放宽——
       这正是"开 DevTools 就能用"的直接原因。
  - **修复**：
    1. `popup.html` 恢复内联 `<style>` 结构（对齐 v1.8.0 能用版本），
       消除外部 CSS 加载时序与 CSP preconnect 干扰。
    2. `#file-input` 从 `display:none` 改为
       `position:absolute; width:0; height:0; opacity:0; pointer-events:none`，
       元素真实存在于布局树，`.click()` 不再被 Chrome 拦截，但用户完全不可见。
    3. `popup.js` `loadRecentBooks()` 加 `try/catch` 顶层保护；
       `getCover/getBookMeta` 逐项加 `.catch(() => null)` 容错；
       `emptyState` 控制还原为 `style.display` 直写，不依赖外部 CSS。
  - **教训**：`display:none` ≠ "不可见的隐藏"。对于需要程序触发 `.click()` 的
    `<input type="file">`，必须用零尺寸+透明的物理隐藏，而非逻辑隐藏。

- **[BUG-C] `showLoadError()` 错误页面黑屏**
  - 根本原因：v1.9.2 将 `reader-main` 的显示控制从 `style.display` 迁移为
    `classList`，但 `showLoadError` 里只调用了 `classList.remove('is-hidden')`，
    而 `reader-main` 实际由 `is-visible` 控制，`remove('is-hidden')` 对
    `display:none` 元素无效，导致加载失败时出现黑屏。
  - 修复：同时追加 `classList.add('is-visible')`。

### 📝 文档与版本
- `manifest.json` 版本号升级为 `1.9.3`。
- `CHANGELOG.md`、`docs/architecture.md`、`docs/comprehensive_repost.md`、
  `test/suites/` 全量更新至 v1.9.3。

---

## [1.9.2] - 稳定性收尾与文档统一

### ✅ 核心修复
- `EpubStorage._get/_set/_remove` 新增 `chrome.runtime.lastError` 检查，存储失败会向上抛错，不再静默成功。
- `bookMeta` 写入改为按 `bookId` 串行队列，避免 `savePosition/saveReadingTime/saveReadingSpeed` 并发覆盖。
- `getAllHighlights()` 新增全量 key 扫描补全逻辑，覆盖 recentBooks 之外的历史书籍高亮。
- **reader.js `style.*` 全量迁移（D-2026-04 最终收口）**：
  - `openBook` 中 `welcomeScreen/readerMain/bottomBar` 的 `style.display` 改为 `classList.add('is-hidden'/'is-visible')`。
  - `setTheme` 中 `customThemeOptions.style.display` 改为 `classList.toggle('is-visible', ...)`。
  - `showLoading` 中 `loadingOverlay.style.display` 改为 `classList.toggle('is-hidden', ...)`。
  - `reader.html` 移除 `#reader-main`、`#bottom-bar`、`#loading-overlay`、`#custom-theme-options` 的内联 `style="display:none"`。
  - `reader.css` 新增 `.welcome-screen.is-hidden`、`.reader-main.is-visible`、`.bottom-bar.is-visible`、`.loading-overlay.is-hidden`、`.custom-theme-options.is-visible` 辅助类。
  - `image-viewer.js` 的 `style.transform` 保留为唯一豁免（动态计算值，无法静态化；在 v2.2.0 中通过 CSS custom property 替代）。
  - 至此 home/popup/reader 三入口的 `style.*` 运行时直写全部清零，为 v2.2.0 移除 `unsafe-inline` 奠定基线。

### 📝 文档与版本
- 全量更新根目录与 `docs/` 文档版本语义到 1.9.2。
- 审计报告统一重命名为 `docs/comprehensive_repost.md`，删除旧版 `comprehensive_report_v3.0.md` 与 `comprehensive_report_v3.1.md`。

### 🧪 测试
- `test/tests.js` 新增 v1.9.2 专项回归组（F-1/F-2/F-3/F-4），覆盖故障注入、并发写、数据可见性、style.* 迁移验证。
- `test/suites/csp_regression.test.js` 新增 C-8~C-11，验证 reader.js 全量 style.display 消除与 CSS 辅助类完整性。
- `test/suites/release_checks.test.js` 新增 v1.9.2 收尾完成验证组（F-1/F-2/F-3/F-4 静态断言）。

---

## [1.9.0] - 2026-03-11

### 🔐 CSP `unsafe-inline` 消除（Phase v1.9）
- **C-1 / C-2 (`reader.js`)**：`showLoadError()` 的 `style.cssText` 全量迁移为 CSS class（`.reader-error-*`），`navPrev` 的 `opacity` 直写改为 `.reader-main-dimmed` class 过渡。
- **C-3 / C-4 / C-5 (`search.js`)**：移除搜索结果项与高亮的内联样式写入；新增 `.search-result-item`、`.search-result-text`、`.search-highlight`、`.search-status-empty`；`statusEl.innerHTML` 改为 `textContent + class`。
- **C-6 (`toc.js`)**：空目录提示由 `innerHTML` 内联 style 改为 DOM 创建 + `.toc-empty` class。
- **C-7 (`manifest.json`)**：`style-src` 暂保留 `'unsafe-inline'`（剩余内联样式迁移在后续版本继续收敛）。
- **测试**：`test/run_tests.js` 新增 `v1.9 CSP 收敛` 套件，覆盖 C-1~C-7 的静态约束检查。

## [1.8.0] - 2026-03-11

### fix
- **BUG-01 popup 首次打开文件无反应**：将 `<input type="file">` 触发方式改为 `showOpenFilePicker` API，
  消除文件对话框弹出时 Chrome popup 失焦导致 document 提前卸载的竞态问题
- **BUG-02 ETA 不准确**：修复 `flushSpeedSession` 写入 storage 后未同步 `_cachedSpeed` 内存缓存，
  导致历史速度路径永远不生效；修复 `visibilitychange` 重激活时未重置 session 起点，
  挂机时间被计入速度分母；降低 session 实时速度触发阈值（60s→30s，0.5%→0.3%）
- **BUG-03 缩放后位置偏移**：resize 和字号变化统一改用 `loc.start.cfi` 保存锚点（原 `end.cfi`）；
  `applyFontSize/applyLineHeight` 增加 CFI 锁保护，等待 epub.js 重排完成后恢复位置

### refactor
- 消除 `window._cachedSpeed` 全局变量，改为模块级 `let _cachedSpeed`
- 废弃未完成的 `_origFlushSpeedSession` / `refreshCachedSpeed` 占位代码
- `bookmarks.js`、`search.js` 内的 escapeHtml / formatDate 迁移至 Utils

---

## [1.7.0] - 2026-03-11

### feat
- **存储整合**：将 `pos_<bookId>` 和 `time_<bookId>` 合并为 `bookMeta_<bookId>`（按写入频率分组），
  每本书从 4 个 key 精简为 3 个 key，翻页 I/O 只读写 ~200 bytes 而非触碰大型 highlights 数据
- **阅读速度追踪**：新增 per-session 采样机制（`speed.sampledSeconds / sampledProgress`），
  修复「从中间打开」「跳章阅读」导致 ETA 严重偏差的问题；仅统计连续阅读片段，跳跃自动排除
- **共享工具模块**：新建 `src/utils/utils.js`，将 `escapeHtml` / `formatDate` / `formatDuration` /
  `formatMinutes` 统一到 `Utils` 对象，消除 home.js / popup.js / reader.js 三处重复定义

### fix
- **书架并行加载**：`loadBookshelf` 由串行改为 `Promise.all` 并行（cover + meta），
  20 本书加载时间从 ~600ms 降至 ~30ms
- **savePosition 防抖**：翻页不再直写 storage，改为 300ms 尾部防抖 + visibilitychange 立即 flush
- **clearAll 并行删除**：`btnClearAll` 由 for-await 串行改为 `Promise.all` 并行
- **LRU 级联清理**：`enforceFileLRU` 驱逐文件时同步清理 `recentBooks` + `bookMeta`，
  消除书架孤立条目（书已被 LRU 驱逐但书架仍显示，点击后报错）
- **ObjectURL 显式 revoke**：删书前通过 `card.dataset.coverUrl` 显式 revoke，
  不再依赖 `load`/`error` 事件的不确定触发时机
- **highlightKeys 索引废弃**：`getAllHighlights` 改为遍历 `recentBooks` 读取，
  彻底消除 v1.6.0 引入的索引不一致风险（新书高亮在标注面板不可见）
- **DbGateway 重试退避**：IDB 连接失败后引入指数退避冷却（500/1000/2000ms），
  连续失败 3 次后拒绝进一步重试，防止重试风暴

### refactor
- `storage.js`：`removeBook` 从 7 操作精简为（removeBookMeta 替代 removePosition + removeReadingTime）
- `popup.js`：删除本地 `escapeHtml` / `formatDate`，改用 `Utils`；popup 读取进度改用 `getBookMeta` 一次完成
- Lazy migration：`getBookMeta` 首次读取时自动迁移 v1.6.0 的 `pos_` / `time_` flat key 并清理旧 key


## [1.6.0] - Phase D-2：存储层 Schema 破坏性重建 + 安全补全

> ⚠️ **破坏性变更**：IndexedDB 升级至 v4，所有书籍文件缓存、封面、位置缓存数据清空。用户需重新导入书籍。

### 💥 破坏性变更

- **IndexedDB 全表重建（DB v4）**：三个表（files / covers / locations）主键字段名统一为 `bookId`。旧数据无法迁移，安装后自动触发升级，所有已缓存的书籍文件需重新导入。

- **URL 路由 token 从 `?file=` 改为 `?bookId=`**：书架、弹窗、标注跳转的所有路由链接均已更新。旧格式 URL（如从外部书签直接打开）将无法识别，需从书架重新点击进入。

### 🐛 BUG 修复

- **files 表主键 filename 引发无声数据损坏（P0-SCHEMA-1）**：同名文件会覆盖 IDB 记录但 bookId 关联元数据（highlights/covers/positions）不一致，导致内容错配且无任何错误提示。现主键改为 `bookId`（SHA-256 内容指纹），两本同名书不再相互覆盖。

- **annotations.js 脚注弹窗 `on*` 事件注入（P0-ANNOTATIONS-1）**：EPUB 原始 HTML 包含内联 `onclick`/`onmouseover` 等属性，在 `chrome-extension://` 上下文下可执行（绕过 `script-src 'self'` CSP）。现在赋值前过滤所有 `on*` 属性和 `javascript:` href；跳转链接改为 DOM API 构建，不再使用 `innerHTML` 插入 `<a>` 标签。

### ♻️ 重构

- **`removeBook` 签名简化为 `removeBook(bookId)`**：移除 `filename` 参数。所有子操作统一使用 `bookId`，`Promise.all` 并行执行（原串行 7 次 I/O）。

- **`enforceFileLRU` 不再加载文件二进制（P1-LRU-1）**：改用 `DbGateway.getAllMeta()` cursor 扫描，只读 `bookId + timestamp` 字段。消除了旧实现中 10 本书 × 5MB = 50MB 内存峰值。

- **`DbGateway.getAllMeta()` 新接口**：cursor-based 只读元字段扫描，供 LRU 等需要轻量遍历的场景使用。

- **`positions` 改为 flat key `pos_<bookId>`（P1-STORAGE-1）**：每次翻页存位置从 O(n) 读写全量嵌套对象降为 O(1)。内置迁移逻辑：首次读取旧格式时自动迁移并清理。

- **`getAllHighlights` 索引化（P1-STORAGE-2）**：维护 `highlightKeys` 索引数组，后续调用不再 `get(null)` 全量扫描 storage。

- **`_remove()` 内部方法提取**：消除三处重复的 `chrome.storage.local.remove Promise` 包装。

- **`Object.assign` 追加方式消除（P2-STORAGE-3）**：`getBookmarks / saveBookmarks / removeBookmarks` 合并进主对象字面量。

## [1.5.0] - Phase D-1：数据层加固与功能完整性修复

### 💥 破坏性变更 (Breaking Change)

- **BookId 升级为 SHA-256 内容指纹**（`storage.js` — D-1-C）  
  `generateBookId` 从 32-bit djb2(filename+size) 升级为 `crypto.subtle.digest('SHA-256', filename+前64KB内容)`。
  旧格式 `book_<base36>` 全面替换为 `book_<hex32>`。**所有旧版 bookId 关联的 position、highlights、bookmarks、locations 数据将因 key 变更而失联（本次破坏性更新已知，不做迁移）。** djb2 存在确定性碰撞：同名同大小文件必然产生相同 ID，SHA-256 将此概率降至密码学可忽略量级（< 3×10⁻²⁴）。`generateBookId` 现为 async 函数，所有调用点均已更新为 `await`。

### 🐛 BUG 修复

- **滚动布局下滚轮完全失效**（`reader.js` — D-1-A）  
  `reader-main` 和 epub.js iframe 两处 `wheel` 事件处理器均无布局判断，`preventDefault()` 在滚动布局下阻截了 iframe 的原生滚动，导致 `flow: scrolled-doc` 模式无法用鼠标滚轮浏览。修复：新增 `if (currentPrefs.layout === 'scrolled') return` 早返回，仅分页模式拦截 wheel 事件。

- **`setLayout` 切换后当前会话内 `currentPrefs.layout` 未同步**（`reader.js` — D-1-B）  
  `setLayout(layout)` 持久化偏好后没有更新内存状态 `currentPrefs.layout`，导致同一会话内 `navPrev()` 的 atStart 判断、两处 wheel 守卫、及 `openBook` 的 gap 计算读取的是旧值。修复：在函数首行补充 `currentPrefs.layout = layout`。

- **IndexedDB 写入在事务提交前即 resolve**（`db-gateway.js` — D-1-E）  
  `put()` 和 `delete()` 监听的是 `req.onsuccess`，而 IndexedDB 规范保证数据持久化的信号是 `tx.oncomplete`。极端场景（进程崩溃、设备掉电）下可能导致"写入成功"但数据实际未落盘。两处均改为 `tx.oncomplete = () => resolve()`。

### ♻️ 重构 (Refactor)

- **`bookmarks.js` 存储访问归口 `EpubStorage`**（D-1-F）  
  `Bookmarks.getBookmarks()` / `saveBookmarks()` 原直接调用 `chrome.storage.local.get/set`，绕过存储抽象层。现委托至 `EpubStorage.getBookmarks/saveBookmarks/removeBookmarks`（新增方法）。`removeBook()` 级联删除也同步改用 `this.removeBookmarks(bookId)`。

- **`storeFile` LRU 内化，删除调用方冗余逻辑**（`storage.js` / `reader.js` / `home.js` / `popup.js` — D-1-G）  
  `home.js` 的 `storeFileData()` 和 `reader.js` 的 `storeFileInIndexedDB()` 均在调用 `EpubStorage.storeFile()` 后重复触发 `enforceFileLRU()`。LRU 逻辑已内化到 `storeFile()` 自身，两处包装函数已删除，调用方改为直接调用 `EpubStorage.storeFile()`。

- **`storeFile` 携带 bookId 存档**（`storage.js` / `reader.js` — D-1-C 联动）  
  文件存储时附带预计算的 `bookId` 字段。`loadFileFromIndexedDB` 直接从记录读取 `bookId`，不再对 `data.byteLength` 重算，消除旧版存在的 `file.size` vs `data.byteLength` 不一致风险。

- **`service-worker.js` 删除永不触发的 `onClicked` 监听器**（D-1-D）  
  `manifest.json` 配置了 `action.default_popup`，MV3 规范下有 popup 时 `chrome.action.onClicked` 绝不触发。该监听器是死代码，已删除，消除对维护者的误导。

### 🛡️ 安全

- **`highlights.js` 高亮颜色值经 `sanitizeColor` 验证**（D-1-H）  
  `renderHighlight()` 将 `hl.color` 直接传给 epub.js SVG `fill` 属性，未经验证。现通过新增的模块内 `sanitizeColor()` 函数（与 `home.js` 白名单正则一致）过滤后再传入，低风险路径完全闭合。

### 🔧 工程

- **统一 cache-busting 版本号至 `?v=6`**  
  `reader.html` 升至 `?v=6`；`home.html` / `popup.html` 补充版本号（原无），统一三入口缓存策略。

## [1.4.1] - Home 入口存储网关归口补丁

### 🐛 BUG 与安全修复
- **DbGateway 漏网排查**：彻底拔除了 `home.js` 在书籍首发上传入口残留的最后一处 `indexedDB.open` 野生连接。至此全项目的所有 IndexedDB 事务均已百分之百通过唯一的单例网关（`db-gateway.js`）安全流转，消灭了并发多点 Schema 写入的数据库竞态风险。

## [1.4.0] - Phase C 架构稳定性与债务清理 (基建期)

### 🏗️ 架构与存储底盘重构
- **IndexedDB 存储网关化 (DbGateway)**：彻底剥离了散落在 `reader.js`、`storage.js` 及 `popup.js` 等 12 处的 `indexedDB.open` 原生直连调用代码。引入单例模式的 Promise 缓存池 `DbGateway` 网关，集中接管 `files`、`covers`、`locations` 表的 `Schema` 升级逻辑及错误捕获与熔断处理。代码复用率大幅提升，根除潜在的多重版本协商冲突。

### 🐛 BUG 与安全修复
- **CSP 样式防线退守与维稳**：修正了因过于激进切除 `manifest.json` 中 `unsafe-inline` 导致全局 UI（包含 popup 和所有弹窗遮罩）样式完全雪崩错乱的严重 Bug。深刻认识到安全防卫必须梯队化，已将该项临时恢复，以保全当期核心重构链路的稳定性。

## [1.3.0] - Phase B 安全加固与排版体验优化 

### 🌟 新特性与优化
- **无网字体优雅降级**：考虑到扩展体积不再内嵌大字重，转而为 Google Fonts CSS 引入了 `&display=swap` 属性，并在全站 CSS 中追加配置了更为科学的原生操作系统字体栈（`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"` 等）。现在哪怕在极端断网环境中加载离线书籍，也将即开即用、杜绝因长时连接网络字体造成的页面空无内容以及加载后的整体排版大面积偏移。
- **重构两栏排版舒适间距**：推翻原本一刀切的 `48px` 中缝设定，针对 `flow: paginated`（分页器模式）智能回归了经典的 `gap: 80`。大幅宽慰了两栏阅读时的中缝留白以及左右视角对齐。

### 🐛 BUG 与安全漏洞修复
- **重大漏洞 - `hl.color` CSS 注入封堵**：对存入 storage 与面板渲染的自定义颜色字面量追加了基于白名单与严格 HEX 色值 Regex 正则的安全卡口过滤。杜绝一切恶意用户通过篡改高亮颜色注入跨端执行攻击。 
- **重大漏洞 - 搜索高亮防 XSS 洗底**：移除了 `search.js` 中直接凭借字符串拼接 `<mark>` 标签再去覆盖 `innerHTML` 这一隐患巨坑；全部使用纯 DOM `textContent` 与 `createElement('mark')` 原生树状结构插入完成安全渲染。
- **高危授权 - 拔除 `unsafe-inline`**：大幅重组了主页面及搜索面板等组件内长期携带的内联 `style="..."` 硬代码至外部类中，现已全面安全合规地修剪掉 `manifest.json` CSP 守卫里的 `unsafe-inline` 松散豁免限制。
- **翻页交互卡死痛点**：拦截 `<input type="range">` 下方进度条的左右按键原生抢占事件，彻底解决聚焦滑块时按下翻页键会因步进跳挡不足卡在当前页面的陈疾，现已强制流转接管至顺滑高效地 `navPrev()` / `navNext()` 系统。

## [1.2.7] - 交互闭环与体验强化 (Phase A)

### 🐛 BUG 修复

- **面板遮罩竞态根治**：`sidebar-overlay` 由 TOC、搜索、书签三个面板共用，此前点击遮罩仅关闭目录（`TOC.close()`），搜索和书签面板在打开时无遮罩、关闭时会相互擦除对方的遮罩。现在 `overlay.click` 统一调用 `closeAllPanels()`；`TOC.close()` / `Search.closePanel()` / `Bookmarks.closePanel()` 关闭前均检查其余面板状态，确保遮罩只在最后一个面板关闭时才消失。
- **书签面板补全 overlay 管理**：`Bookmarks.togglePanel()` 此前不显示遮罩、也不关闭其他面板，导致目录/搜索/书签可以同时打开。现在打开书签时自动关闭其他面板并呈现遮罩，关闭时同步检查其余面板状态。
- **进度条拖动体验优化**：进度条的 `input` 事件此前每个像素变化都触发 `rendition.display()`，高频拖动时 epub.js 连续翻页造成内容区白屏闪烁。修复后 `input` 只更新百分比标签，`change`（松手后）才真正跳转，彻底消除拖动过程中的渲染抖动。
- **封面内存泄漏修复**：书架和弹窗加载书籍封面时调用 `URL.createObjectURL(blob)` 后从未 `revoke`，长时间使用或频繁刷新书架会积累大量孤立的 blob 引用。现在统一在 `img.onload` / `img.onerror`（`{once:true}`）回调中调用 `revokeObjectURL`，DOM 挂载完成后立即释放。
- **布局切换 gap 不一致**：`openBook` 初始化使用 `gap: 80`，`setLayout` 重建使用 `gap: 40`，切换布局后阅读区行宽跳变。两处统一为 `gap: 48`。
- **popup 删除书籍数据不完整**：弹出窗口中"移除"书籍只清理了部分字段（`recent / position / readingTime / file`），遗漏了 `highlights / bookmarks / cover / locations`。现统一调用 `EpubStorage.removeBook()` 完整级联删除，与主书架行为一致。
- **删除死代码 `_originalIndex`**：`home.js` 的标注列表中计算了 `hl._originalIndex` 但从未读取（删除操作早已改用 CFI 匹配），属误导性死代码，已移除。

### 🔒 安全

- **`manifest.json` 权限收敛**：`web_accessible_resources` 的 `matches` 从 `<all_urls>` 收敛至 `chrome-extension://*/*`，第三方网页不再能加载 `epub.min.js` / `jszip.min.js` 等扩展内部库文件。

---

## [1.2.6] - 安全加固与数据可靠性止血 (Phase A)

### 🔴 P0 紧急修复

- **IndexedDB 版本号遗漏修复**：`storage.js` 中 `getLocations()` 和 `removeLocations()` 使用 `indexedDB.open('EpubReaderDB')` 不带版本号，在新用户首次访问时会创建 V1 空数据库（无 `locations` 表），导致阅读进度缓存永远读取失败。两处均补全为 `open('EpubReaderDB', 3)` 并补充 `onupgradeneeded` 建表逻辑，保持与全库其余 6 处一致。
- **XSS 风险修复 (`showLoadError`)**：`reader.js` 的加载失败提示函数将 `err.message` 直接拼入 `innerHTML`，原有转义仅处理 `<` 字符，含 `>`、`"`、`&` 的异常消息（如第三方 EPUB 解析库抛出的错误）可在扩展页面触发 XSS。现改用纯 DOM API（`createElement` + `textContent` + `addEventListener`）构建错误界面，彻底消除注入面。
- **`window mousedown` 监听器累积修复**：`highlights.js` 的 `setBookDetails()` 尾部使用匿名函数注册 `window.addEventListener('mousedown', ...)`，该函数在 `openBook` 和 `setLayout` 时各被调用一次，因匿名函数无法 `removeEventListener`，每次切换布局都会叠加新监听器。N 次切换后每次点击触发 N+1 次 `closePanels()`，状态机混乱。修复方案：将 `window` 和 `btnShowToolbar` 监听器提取为具名函数 `_onWindowMouseDown` / `_onShowToolbarClick`，移入 `init()` 中仅注册一次。

### 🐛 P1 修复

- **阅读时长在关闭标签页时丢失**：计时器每 10 秒保存一次，关闭标签页前最多丢失 9 秒。新增 `document.addEventListener('visibilitychange', ...)` 顶层监听，页面转为 `hidden`（含标签切换、关闭）时立即调用 `saveReadingTime()`，丢失窗口降为 0。
- **popup 删除书籍数据不完整**（见 v1.2.7 完整修复说明，本版已包含）。

---


### 🐛 BUG 修复
- **雷达抢修**：修复了自 v1.2.2 架构合并后被意外移掉的核心识别函数 `isFootnoteLink()`。该丢失此前导致点击脚注时引发后台崩溃，从而使得原生内核接管了行为并引发了错误的页面全屏跳转。现在，精致的脚注悬浮气泡已经重新归位。

## [1.2.4]
### 🛡️ 严重 BUG 解决与护航 (IndexedDB 大一统)
- **版本大一统**：将所有全局模块中负责读取、加载书架的 `indexedDB.open('EpubReaderDB', 2)` 调用统一强制拔升至 `V3` 级别。彻底根除了旧代码低权访问高权表导致的 `VersionError` 闪崩和封面丢失问题 (`storage.js`, `home.js`, `popup.js`, `reader.js`)。
- **架构自愈锁**：在全域代码每一次的 `onupgradeneeded` 触发点中补齐并固定了 `locations` 数据表的建立逻辑，确保新旧用户触发时均能构建完整的底层结构。

## [1.2.3] - 极致稳定与死角扫雷
- **生命周期死区填补**：将时间罗盘排序的 `currentSort` 的 `let` 声明提升至全局域，防备系统抛出暂时性死区导致的首页完全闪崩 (`home.js`)。
- **坐标盲区矫正**：修正了 `notePopup` 悬浮窗弹出的防溢出感知红线（由 `<10px` 骤升至涵盖其身高的 `<200px`），彻底终结了点击处于屏幕极高位置文本时，面板直接向上突破飞出屏幕的消失情况 (`highlights.js`)。
- **降维监听防屏蔽**：针对输入框容易吸入甚至“吞噬”点击事件的情况，将清空触发器从单纯的 `click` 降维改锁至原生的 `mousedown`，只需任意点破空白区瞬间清理残局 (`highlights.js`)。
- **语义级清淤**：剥离去除了对常规脚注具备大规模杀伤误判的正规表达式，让原本合法存在的书内锚点重新通畅运转 (`annotations.js`)。

## [1.2.2] - PDCA 终极架构重构与盲区清扫
- **无底洞存储引擎**：击穿 `localStorage` 仅给定的 2MB 死线阀门，将书籍进度地图 (`Locations`) 彻底重构转移至 `IndexedDB` 引擎。
- **时空排序罗盘**：响应终极体验诉求，主页内嵌入 `Array.prototype.sort` 打散与重组机制，所有零散分布的横跨多书籍笔记均能跟随统一时间轴一键上下颠倒排版。
- **修复幽灵笔记绘制**：强制将笔记创建后的 UI 画布挂载上 `reRenderHighlight` 闭环。哪怕只是加条纯文字的文字评语，幽蓝的虚线即可瞬间呈现。
- **基因融合防断链**：消除冲突的 `isBackLink()` 拷贝函数重灾区，统领全局返回判断。
- **渲染层停火**：剥去霸道的 `style.display="block"` 并全局软着陆到规范层级 `.visible`，断绝面板争抢。

## [1.2.1] - 极致视效与定位修补专项
- **行间悬空防坠**：通过 `GPU translateY` 回拉重新将下划线紧贴高行距中文行文本下方。
- **交互包裹盒隐形**：废弃粗暴选择器，消灭包裹 `rect` 的所有污点虚线边框，坚守透明澄净。
- **顶层实体防撞**：重写面板起跳空间评估模型。

## [1.2.0] - 深度架构重构与体验闭环
- **重器落地**：打下 `Locations` 进度缓存持久化的基础地基，从源头消灭开书与翻书期间出现的“进度条归零 / 剩余耗时抽风”并发症。
- **加盖互斥锁**：赋予全局 `_internalAction` 判断网。
- **核弹级 CSS 清剿**：引入特定的 `svg.epubjs-annotation polyline` 强制压制电子书黑描边，且完全不伤及书本原有插画。
- **无痕检索**：赋予系统动态搜索抹除痕迹的功能，告别黄斑恶化视觉疲劳问题。
- **联屏扫描消光**：针对跨双页视图残存了蓝斑残留实施根卷遍历净化。

## [1.1.x] - 早期建设
- 进行了一系列底层的 UI / UX 试做：包含核心 `Highlights` 批注系统的引入建立，以及各类基础毛玻璃窗口（Glassmorphism）的磨合适配。
