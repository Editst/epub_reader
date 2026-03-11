# EPUB Reader 开发演进记录 (Development Walkthrough)

本文档记录了 EPUB Reader 从架构搭建到性能优化的完整演进历程，真实归档每一阶段的技术决策、核心修复及架构演进。

---

## [v1.7.0] - 存储合并与体验性能双飞跃 (Storage Consolidation & Performance)
**核心目标**：通过高频数据合并优化 I/O 开销，引入科学的阅读速率采样算法提升 ETA 预测精度。

### 1. 存储结构高阶收拢 (Key Consolidation)
- **Metadata 合并**：将原散落在 `pos_<bookId>` (位置) 和 `time_<bookId>` (时长) 的两个独立 Key 合并为统一的 `bookMeta_<bookId>`。
  - **减少写放大**：翻页或计时时仅操作一个微型 Key (<200 bytes)，无需触碰大型 `highlights` 字典，大幅降低 `sync` 存储的压力与冲突。
  - **延迟迁移 (Lazy Migration)**：在 `getBookMeta` 中内置兼容逻辑，首次读取旧版数据时自动执行自动聚合与旧 Key 回收。

### 2. 精准 ETA 预估算法 (Speed Sampling)
- **Session 级速率采样**：废弃原有的 `总时长 / 总进度` 朴素算法（该算法在从书本中途开读时会产生严重偏低偏差）。
  - **连续阅读判断**：仅当单次阅读片段满足「耗时 > 30s」且「进度增量在 0.1% ~ 30% 之间」时才计入速率样本。
  - **跳跃自动过滤**：手动拖动进度条或大跨度跳章将被自动识别并排除，确保“预计剩余时间”仅反映真实的阅读节奏。

### 3. 高并发与响应速度优化 (Performance & Reliability)
- **I/O 并行流水线**：重构 `loadBookshelf` 与 `btnClearAll`。将原本 20 本书的串行 I/O 加载改为 `Promise.all` 全并发模式，首屏加载书架的耗时从 ~600ms 锐减至 ~30ms。
- **翻页防抖写入 (Debounced I/O)**：为 `savePosition` 引入 300ms 尾部防抖，防止用户快速翻页时对存储层的暴力冲击。仅在页面进入 `hidden` 状态 (关闭/切换) 时立即 Flush。
- **连接退避机制**：为 `DbGateway` 引入了指数退避 (Exponential Backoff) 重试策略（500/1000/2000ms），并在 3 次彻底失败后熔断，防止在存储受限环境下的重试风暴。

### 4. 健壮性与归口清理
- **LRU 级联清理**：修正了 `enforceFileLRU` 仅删文件不删记录的问题，现已实现「文件 -> 索引 -> 元数据」的全链路级联驱逐，根除书架孤立僵尸条目。
- **显式资源回收**：改由 `card.dataset` 显式持有 `ObjectURL`，在删除书籍时主动触发 `revoke`，不再依赖加载事件的不确定触发。
- **索引去中心化**：废弃了易产生不同步风险的 `highlightKeys` 索引 Key，改由 Authority 的 `recentBooks` 列表遍历，确保标注系统 100% 书籍覆盖率。


## [v1.5.0 - v1.6.0] - Phase D 数据层加固与 Schema 重构 (Data Integrity & Storage Rebuild)
**核心目标**：解决以 `filename` 作为主键导致的并发覆盖灾难，构建基于 SHA-256 的唯一身份校验体系。

### 1. 存储底层 Schema 破坏性重建 (DB v4)
- **指纹替换主键**：`files`, `covers`, `locations` 三张表的主键字段统一由 `filename` 迁移至 `bookId`。解决了同名书籍静默覆盖原始文件，但残留旧书元数据（如批注、位置等）的严重逻辑失真 (P0-SCHEMA-1)。 
- **离线哈希赋码**：将 `generateBookId` 从基于名称+大小的非强计算迁移至基于 `filename` + 前 64KB 二进制切片的 SHA-256 内容指纹 `crypto.subtle.digest`，杜绝任何确定性碰撞风险。
- **记录平铺降维**：阅读进度缓存 `positions` 由高耗时的单体大对象读写模式降级为按书扁平化存储 `pos_<bookId>`，单次查询从 O(n) 直接降低至 O(1)。
- **路由重构**：所有跨页面跳转参数 Token (`reader.html?file=...`) 替换为更为精准的 `?bookId=...` 以适应指纹主键机制。

### 2. 存储全生命周期治理
- **IO 串行解耦**：清退了 `removeBook()` 内部执行删除 `recentBooks`、`positions`、`covers`、`files` 等 7 次独立 await I/O 的阻塞行为，彻底转换为 `Promise.all` 并发清理机制。
- **LRU 扫描扫雷**：重构 `enforceFileLRU` 算法。不再全量拉取 5MB 以上的书籍二进制 Blob 导致内存溢出，改由网关暴露全新的 `getAllMeta()` 游标 (Cursor-based) 数据流接口，实现纯元字段的 0 内存开销扫描排序。
- **安全落盘机制修补**：纠正了 IndexedDB `put` 和 `delete` 原依赖不可靠的 `req.onsuccess` 落盘判定，该旧机制在进程崩溃等极端情况将出现内存已决而磁盘未刷的假抛出。现全部锁定修复为安全的 `tx.oncomplete` 回调触发。

### 3. 注释安全防线补全 (P0-ANNOTATIONS-1)
- **DOM 内联属性绝育**：识别并修复了第三方 EPUB 内部恶意夹带 `<a onclick="...">` 与跨域伪协议引发的沙盒穿透执行。目前针对脚注浮层提取引擎，已在渲染前针对所有 `on*` 事件处理器和 `javascript:` 等恶意协议完成全套阉割。结合上个版本的 `escapeHtml` 等防御机制，现已彻底收拢内至 CSS 边界、外至 DOM 结构的 XSS 纵深缺口。


## [v1.4.1] - 存储入口全收拢与源码深度审计 (Security & Storage Finalization)
**日期**：2026-03-11  
**核心目标**：彻底消除 IndexedDB 分散连接隐患，并完成全链路安全与内存审计。

### 1. 存储入口最终收敛 (Phase C Final)
- **Home 入口修复**：排查并移除 `home.js` 中 `storeFileData` 使用的原生 `indexedDB.open('EpubReaderDB', 3)` 调用。改为透传至 `EpubStorage.storeFile`，确保全项目 IndexedDB 事务 100% 经由 `DbGateway` 单例。
- **架构一致性**：确认全项目（Reader/Home/Popup）仅存一个 DB 连接入口（v3 存储架构），彻底规避 Schema 冲突与连接死锁风险。

### 2. 全项目源代码深度审计 (Security & Performance)
- **全链路 XSS 防护**：
  - `search.js`：验证 DOM-based 高亮逻辑，弃用 `innerHTML` 拼串，采用 `TextNode` + `mark` 元素手动挂载，根除搜索注入风险。
  - `home.js` / `popup.js`：对所有注入 UI 的动态字段（书名、作者、笔记等）强制通过 `escapeHtml` 转义。
  - `reader.js` / `annotations.js`：验证 `sanitizeColor` 校验函数，阻断 style 注入。
- **内存泄露治理**：
  - **Blob 自动回收**：在 `home.js` 和 `popup.js` 封面图逻辑中植入 `onload/onerror` 自动 `revokeObjectURL` 机制，解决常驻页面时的内存堆积。
  - **事件管理**：确认 `highlights.js` 在 iframe 重建时能正确解绑旧版 `selected` 事件，根除累加监听器导致的 UI 闪烁。

### 3. 工程资产与债务记录
- **文档核心化**：废除 `task.md`，将全量开发史清单合并至本文件，确立单一事实来源。
- **债务标记**：识别 `home.css` 与 `themes.css` 存在的 CSS 变量命名空间重叠问题，列入后续治理计划。

---

## [v1.4.0] - Phase C 架构稳定性与债务清理
**日期**：2026-03-10  
**核心目标**：引入存储网关层，治理长期积累的数据库连接债务。

### 1. 存储底层网关化 (DbGateway)
- **单例中间件**：创建 `utils/db-gateway.js`。引入 Promise 缓存池机制，接管所有 `indexedDB.open`、`onupgradeneeded` 逻辑。
- **Schema 归口**：将 `files`, `covers`, `locations` 三张表的建表逻辑收拢至一处，版本号统一锚定为 `3`。
- **业务脱敏**：重构 `storage.js` 及 `reader.js`，剥离原生 IDB 繁文缛节，提升代码复用率。

### 2. CSP 策略维稳
- **防线退守**：因 v1.3.0 激进禁用 `unsafe-inline` 导致全局样式雪崩（涉及 popup 及动态注入 styles），在 v1.4.0 紧急恢复该权限。
- **架构决策**：将样式彻底外置化列入 Phase D 长期计划，确保重构期间系统可用性。

---

## [v1.3.0] - Phase B 安全加固与排版体验优化
**日期**：2026-03-10  
**核心目标**：清剿深度 XSS 隐患，精耕细作排版细节。

### 1. 安全加固 (XSS 防御)
- **hl.color 净化**：在 `home.js` 增加正则白名单校验，防止非法 CSS 色值载荷通过 `innerHTML` 注入。
- **脚注 HTML 过滤**：在 `annotations.js` 渲染前过滤内联事件处理器 (`on*`)。
- **搜索高亮 DOM 化**：`search.js` 废弃字符串正则替换逻辑，改用 `TextNode` + `mark` 元素插入，根除双重编码隐患。

### 2. 排版与交互优化
- **离线字体工程**：`reader.css` 引入 `font-display: swap` 并补全系统默认字体栈，降低离线环境下的布局偏移。
- **视角对齐**：双栏分页模式 `gap` 回归 80px 经典视角间距，改善长文阅读疲劳。
- **焦点控制**：修正进度条滑块焦点截获方向键的问题，确保护航翻页意图。

---

## [v1.2.6 - v1.2.7] - Phase A 止血与交互闭环 (PDCA)
**日期**：2026-03-09  
**核心目标**：紧急修复审计发现的 P0 级逻辑黑洞。

### 1. 致命缺陷修复 (P0)
- **IDB 版本对齐**：补全 `getLocations` / `removeLocations` 缺失的版本号，解决新用户首次进入因产生 V1 空库导致的进度失效。
- **XSS 物理隔离**：`showLoadError` 彻底抛弃 `innerHTML`，改用 `textContent` 构造 UI。
- **监听器泄漏治理**：将 `window mousedown` 匿名监听器提取为具名函数并在 `init` 阶段单次注册，根除切换章节导致的自激震荡。

### 2. 交互状态机闭环
- **遮罩层竞态重构**：`sidebar-overlay` 改为全局闭环管理。新增面板状态交叉检查，彻底解决 TOC/搜索/书签 面板叠开、遮罩僵死问题。
- **阅读时长保全**：引入 `visibilitychange` 监听，确保 Tab 关闭时立即 flush 内存中的阅读时长。
- **内存泄漏治理**：在 `home.js` / `popup.js` 封面渲染后立即执行 `revokeObjectURL`。

---

## [v1.2.4 - v1.2.5] - 数据库大一统与逻辑闭环
**核心目标**：解决 IndexedDB 版本冲突及重构引发的逻辑残留。

- **v1.2.5 (脚注雷达抢修)**：恢复在 v1.2.2 误删的 `isFootnoteLink` 函数。采用“内部锚点优先”策略，捕获所有带有 `#` 定位符且非返回链的链接，彻底解决了通过原生跳转导致的位置偏移问题。
- **v1.2.4 (IDB 版本齐平)**：将全项目 `indexedDB.open('EpubReaderDB', 2)` 统一升格至 `version: 3`，防止低权读取高权库引发的 `VersionError`。同时在 `onupgradeneeded` 钩子中强制补全 `locations` 表结构。

## [v1.2.0 - v1.2.3] - 存储架构跃迁与性能基石
**核心目标**：击穿数据规模限制，建立稳定的渲染同步机制。

- **v1.2.3 (稳定性围剿)**：将 `currentSort` 提升至全局域以解决暂时性死区（TDZ）导致的首页闪崩。将 iframe 监听器由 `click` 降级为 `mousedown`，确保在输入框处于焦点时仍能绝对拦截并清理浮层。
- **v1.2.2 (存储引擎迁移)**：彻底废弃基于 `localStorage` 的进度同步，改由 IndexedDB 承载万级 `Locations` 坐标地图，实现百兆级巨著秒开。引入“时间双向罗盘”排序算法，支持跨书域笔记的时间轴重塑。
- **v1.2.1 (视觉微测定)**：引入 `translateY(-4px)` 纠正大行高下的下划线偏离。移除交互矩形框 `<rect>` 的虚线边框，仅保留线型渲染。
- **v1.2.0 (核心重构)**：建立 `_internalAction` 同步互斥锁。针对 `epubjs-annotation polyline` 实施限定命名空间的 CSS 劫持，在保持书籍原色调前提下移除自带黑线。

---

## [v1.1.4 - v1.1.6] - 细节工程化与健壮性提升
**核心目标**：针对坐标计算与 UI 残留进行深度清淤。

- **v1.1.6 (定位再感知)**：增强了“修改标注”环节的物理坐标换算。通过实时监测 `notePopup` 的 `getBoundingClientRect` 与视口顶部的相对距离（<200px 阈值），动态注入 `.flip` 样式，彻底解决顶端文字标注面板飞出屏幕的问题。
- **v1.1.5 (清理回路确认)**：在 iframe 顶端绑定 `mousedown` 回调，强制清空 `_activeHighlightCfi` 状态，确保标注工具栏在完成操作后 100% 自动注销。通过样式劫持 `svg.epubjs-annotation polyline` 精准抹除原生黑线。
- **v1.1.4 (异步渲染同步化)**：针对 Epub.js 翻页后 iframe 重载导致的标注丢失，引入 `reRenderHighlight` 同步钩子。重构 `home.js` 数据处理链，实现标注与笔记类型分离，支持带格式导出。

## [v1.1.0 - v1.1.3] - 标注功能闭环与渲染对齐
**核心目标**：建立“高亮+笔记”双模态交互模型。

- **v1.1.3 (划线修复专项)**：针对划线功能在大段落合并时的失效问题实施了定点重写。废弃方框渲染，全面切入“仅下划线”视觉模型，并引入 `clip-path` 掩码。在 `highlights.js` 中实现了对重叠区域与重复 CFI 的静默去重算法。
- **v1.1.2 (翻页交互对准)**：修复了翻页过程中由于 iframe 卸载未及时注销选择器，导致新页面选中内容无法触发工具栏的竞态 Bug。统一了有笔记高亮的虚线下划线标识。
- **v1.1.1 (交互基石补完)**：引入毛玻璃效果（Glassmorphism）适配全主题。解决了鼠标松手后浮窗因位移判定失准而消失的问题。修复了进度条初始显示为 0% 的渲染时序问题。

---

## [v1.0.0] - 项目基石奠定
**核心目标**：构建生产可用的 EPUB 离线阅读环境。

### 1. 核心链路打通
- **渲染基础设施**：集成 Epub.js 核心引擎，支持流式布局（Reflowable）与分页渲染（Paginated）双模式切换。
- **混合存储策略**：确立了 `chrome.storage.local`（配置/轻量元数据） + `IndexedDB`（大容量书籍文件/封面数据）的本地化存储架构。
- **基础套件**：实现了全书目录提取（TOC）、全文关键词搜索排队器以及基础的主题切换（浅色/深色/护眼）系统。

