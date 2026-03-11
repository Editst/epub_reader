# EPUB Reader 开发演进记录 (Development Walkthrough)

本文档归档了 EPUB Reader 从架构搭建到极致性能优化的完整演进历程，真实记录每一阶段的技术决策、核心修复及架构演进。

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
- **LRU 全链路级联清理**：修正 `enforceFileLRU` 仅删文件缺陷，现已实现「文件 -> 封面 -> 元数据」的全链路级联驱逐，根除僵尸条目。
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
