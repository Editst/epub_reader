# EPUB Reader — 项目路线图

> 最后更新：2026-03-17（v2.2.0：安全与可访问性 + UI 视觉重设计）

---

## 当前状态

- **v2.2.0 已完成**：CSP 最终收敛（unsafe-inline 移除）、ARIA 语义全量补全、annotations 安全测试、speed.sessions 持久化落地、全页面 UI 视觉重设计。
- **D-2026-07/08/25 已闭环**，全部 P1/P2/P3 债务进度更新见技术债务索引。
- **下一步**：启动 v2.3.0 Annotations 算法深度对齐 + 代码质量专项。

---

## 里程碑规划

### v1.9.3 — 1.x 最终扫尾 ✅ 完成

- [x] F-1：`storage.js` 错误上抛（P1 清零）
- [x] F-2：`bookMeta` 串行队列（P2 清零）
- [x] F-3：`getAllHighlights` 全量 key 扫描（P2 清零）
- [x] F-4：reader.js `style.*` 最终迁移（P2 清零，transform 豁免）
- [x] F-5：专项回归测试
- [x] BUG-B：`#file-input` `.click()` 限制修复

---

### v2.0.0 — 数据与性能治理 ✅ 完成

- [x] P-1：阅读速度/ETA 模型升级（会话加权 + 跳读识别 + 低样本"估算中"提示）
- [x] P-2：`locations.generate()` 改为 `requestIdleCallback` 调度包装 + 进度反馈
- [x] P-3：书架流式渲染（骨架屏占位 + 每书就绪立即插入）

---

### v2.1.0 — Reader 内核解耦 ✅ 完成

- [x] R-1：拆分 `reader.js` → 四层（runtime / state / persistence / ui）
- [x] R-2：子模块建立统一 `mount(context)` / `unmount()` 生命周期接口
- [x] R-3：消除全局变量跨模块写入，改为 `context` 显式传参
- [x] 清理：删除 `DbGateway.getByFilename()` 死代码

### v2.1.1 — 2.1 收尾审计与文档对齐 ✅ 完成

- [x] R-2 收尾：子模块原生 `mount/unmount`，移除匿名适配层
- [x] AN-C6 前置：`Annotations._onKeyDown` 具名监听 + `unmount` 移除
- [x] 文档对齐：architecture.md / modules.md 升级至 v2.1.1
- [x] 审计登记：D-2026-25 纳入 v2.2.0

---

### v2.2.0 — 安全与可访问性 + UI 视觉重设计 ✅ 完成

**目标**：完成 CSP 最终收敛，补齐 ARIA 语义，全页面视觉升级，speed.sessions 持久化落地。

- [x] A-1：`image-viewer.js` `style.transform` 迁移为 CSS 自定义属性（`--iv-tx/--iv-ty/--iv-scale`），`manifest.json` 移除 `'unsafe-inline'`（D-2026-07 闭环）。
- [x] A-2：reader/home 核心控件补齐 ARIA 语义（`aria-label`、`aria-expanded`、`role`、`aria-valuemin/max/now`）（D-2026-08 闭环）。
- [x] A-3：新增 `test/suites/annotations_security.test.js`，覆盖 5 类 DOM 注入向量。
- [x] D-2026-25：`storage.js` speed 结构补全 `sessions: []` + `sessionCount: 0`，向后兼容旧数据。
- [x] UI 重设计：reader.css / home.css 完整重写，editorial dark-first 美学，Cormorant Garamond + Source Serif 4 字体，暖金 accent。

**验收标准（已达成）**：
- `manifest.json` `style-src` 不含 `'unsafe-inline'`。
- reader.html 所有交互控件含 `aria-label`，面板含 `role="dialog"`。
- progress-slider 含 `aria-valuemin/max/now`。
- `test/suites/v2_2_tdd.test.js` 全部通过。

---

### v2.3.0 — Annotations 算法深度对齐 + 代码质量专项（计划 5～7 工作日）

> 本版本两个并行专项集中在 `annotations.js` 单文件，测试套件统一补充。

#### 算法专项（AN-1 ～ AN-5）

**AN-1: computedStyle 垂直对齐检测（D-2026-11）**
- 目标：补全 CSS `vertical-align: super` 替代 `<sup>` 标签的漏判场景。
- 位置：`isFootnoteLink` Stage 3 末尾。
- 实现：当 href 在前三阶段未得确定结论时，通过 `link.ownerDocument.defaultView.getComputedStyle(link)` 读取 `verticalAlign`；值为 `super/sub/top/bottom` 视为强正向信号；同时检测 `link.firstElementChild` 的 computedStyle 覆盖子节点继承场景。
- 约束：`getComputedStyle` 为同步调用，O(1)，仅在前三阶段未命中时触发。
- 验收：CSS `vertical-align:super` 场景识别率 ≥ 95%（原 0%）。

**AN-2: 源节点孤立性检查（D-2026-12）**
- 目标：排除扁平 `<p>` 单链接（TOC 变体）被误判为注释。
- 位置：`isFootnoteLink` Stage 2 `_isTocList` 之后，作为加强型 Definitive NO。
- 条件：链接文本长度 > 6 且构成父块 `textContent` 的 > 80%。
- 验收：扁平 `<p>` 单链接误判率降至 0（回归测试覆盖 10 种 TOC 变体）。

**AN-3a: 同文档位置前后关系（D-2026-11 关联）**
- 目标：同文档 `href.startsWith('#')` 情形下，用 `compareDocumentPosition` 判断目标节点与源节点顺序。
- 信号强度：弱负向信号（目标在源之前 → 倾向为返回链接，单独不否决）。
- 验收：与既有逻辑综合后，双向链接图谱中误判率降低可验证。

**AN-4: 注释内容提取边界安全阀（D-2026-13）**
- 目标：防止空锚点场景返回超长非注释内容。
- 实现两步：
  1. `_extractContent` 末尾对纯文本提取后检查字符长度，超 `MAX_FOOTNOTE_TEXT = 2000` 时截断并追加"… [内容过长，请点击原文]"提示。
  2. 空锚点场景改为沿 nextSibling 遍历收集内容，遇 `<hr>` / `H1-H6` / 另一含 `id` 的 `<a>` / 累计 > 2000 字符时停止。
- 验收：空锚点弹窗不展示超过 2000 字符的内容；测试用例全部通过。

**AN-5: 跨文档注释 LRU 缓存（D-2026-14）**
- 目标：同一尾注文件第二次点击 P90 响应 < 15ms。
- 实现：`Map` 为底层的简易 LRU（容量 50），key = `sectionHref`，value = 已解析内容树；TTL = book 生命周期（`unmount()` 时清空）。
- 约束：缓存大小须满足合理内存边界（50 × 平均 2KB ≈ 100KB）。
- 验收：Chrome DevTools Performance 面板手动验证 P90 < 15ms。

#### 代码质量专项（AN-C1 ～ AN-C8）

**AN-C1: 提取 `_hasSup()` 公共方法（D-2026-17）**
- 消除 `isBackLink` / `isFootnoteLink` 中重复的 `closest('sup')` + `querySelector('sup')` 组合。
- 签名：`_hasSup(link: Element): boolean`
- 验收：文件内无裸重复 sup 查询组合。

**AN-C2: `_BLOCK_TAGS` 升为模块级 `Set`（D-2026-18）**
- `_extractContent` 内 `const BLOCK = [...]` 局部数组每次调用重建，升为模块级 `const _BLOCK_TAGS = new Set([...])`。
- 验收：`_extractContent` 内无局部 `const BLOCK` 定义。

**AN-C3: last-resort 降级路径 inline style 迁移（D-2026-19）**
- `showFootnote` last-resort 降级路径含 inline style 字符串，违反 style.* 约束。
- 迁移为 CSS class `.annotation-fallback-hint`（reader.css v2.2.0 已预留）。
- 验收：last-resort 路径无 inline style 字符串。

**AN-C4: 提取 `_PAGINATION_SETTLE_MS` 具名常量（D-2026-20）**
- `_compensatePaginationOffset` 中 100ms 等待提取为 `const _PAGINATION_SETTLE_MS = 100`。
- 验收：无 magic number `100`（毫秒语义）分散在代码中。

**AN-C5: 提取 `_parseHref()` 统一 href 片段解析（D-2026-21）**
- `showFootnote` / `_loadFromBook` / `_compensatePaginationOffset` 三处 href 解析逻辑碎片化，统一提取为 `_parseHref(href): { sectionHref, fragmentId }`。
- 验收：`split('#')` 出现次数 ≤ 1（仅在 `_parseHref` 内部）。

**AN-C7: `bind` 提取至循环外 + targetId 早退（D-2026-23）**
- `_loadFromBook` Method 4 循环内重复 `.bind(this)`，提取至循环外。
- 无 targetId 时提前退出，避免无效迭代。
- 验收：Method 4 循环体内无 `.bind`；无 targetId 时有 early return。

**AN-C8: `_isTocList` 阈值与 `_RE` 正则词汇来源注释（D-2026-24）**
- `_isTocList` 阈值（如 `>= 3`）与 `_RE` 正则词汇（如 `back|return|返回`）补充来源注释，说明来自 Calibre/KOReader 算法参考。
- 验收：相关阈值和正则有 `// Calibre ref:` 或 `// KOReader ref:` 注释标注。

**验收标准（v2.3.0 整体）**：
- `getComputedStyle` 检测：CSS `vertical-align:super` 场景识别率 ≥ 95%。
- 孤立性检查：10 种 TOC 变体误判率 = 0。
- 内容安全阀：空锚点弹窗 ≤ 2000 字符。
- 缓存命中：同文档第二次点击 P90 < 15ms（手动验证）。
- AN-C1～C8 全部重构完成，无回归。
- `test/suites/annotations_security.test.js`（v2.2.0）全部通过。

---

### v2.4.0 — Annotations 跨文档拓扑与 FB2 兼容（计划 3～4 工作日）

> v2.3.0 的延伸，处理更复杂的跨文档场景与历史格式兼容。

- [ ] AN-3b：spine index 跨文档位置比对（AN-3 Step B），提升跨文件返回链接的识别精度。
- [ ] AN-6：FB2 转换格式兼容（对应 Calibre 掩码 0x0008）。识别 `body[name="notes"]` / `body[name="comments"]` 下的 `section` 结构，将其链接视为注释容器高置信度；在 `_buildDocContext` 中扫描并加入 `footnoteSectionNodes`。
- [ ] AN-7：数字标记上限收窄至 3 位（过滤年份误判），白名单保留 `epub:type="noteref"` 覆盖 4 位数字场景。

**验收标准**：
- FB2 转换书籍（测试集 5 本）注释识别率 ≥ 90%。
- 正文中 "1984"、"2023" 等年份数字链接误判率 = 0。

---

## 技术债务索引（滚动）

| 优先级 | ID | 描述 | 目标版本 | 状态 |
|---|---|---|---|---|
| 🟠 P1 | D-2026-01 | `chrome.storage.local` 回调未处理 `lastError` | v1.9.3 | ✅ 已修复 |
| 🟡 P2 | D-2026-02 | `bookMeta` 并发 RMW 存在丢字段覆盖风险 | v1.9.3 | ✅ 已修复 |
| 🟡 P2 | D-2026-03 | `getAllHighlights()` 仅覆盖 recentBooks（上限 20） | v1.9.3 | ✅ 已修复 |
| 🟡 P2 | D-2026-04 | 运行时 `style.*` 写入分散 | v1.9.3 | ✅ 已修复（transform 豁免至 v2.2.0）|
| 🟡 P2 | BUG-B | `display:none` 元素 `.click()` 失效 | v1.9.3 | ✅ 已修复 |
| 🔵 P3 | D-2026-05 | `reader.js` 高耦合核心文件（~1000 行） | v2.1.0 | ✅ 已修复 |
| 🔵 P3 | D-2026-06 | `DbGateway.getByFilename()` 无调用路径 | v2.1.0 | ✅ 已修复 |
| 🔵 P3 | D-2026-07 | `image-viewer.js` `style.transform` 残余 | v2.2.0 | ✅ 已修复 |
| 🔵 P3 | D-2026-08 | ARIA 语义缺失（工具栏/面板/书架卡片） | v2.2.0 | ✅ 已修复 |
| 🔵 P3 | D-2026-09 | 阅读速度模型等权平均 | v2.0.0 | ✅ 已修复 |
| 🔵 P3 | D-2026-10 | locations 生成阻塞主线程 | v2.0.0 | ✅ 已修复 |
| 🔵 P3 | D-2026-11 | CSS `vertical-align` 替代 `<sup>` 漏判 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-12 | 孤立性链接缺乏专项排他检查 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-13 | `_extractContent` 无文本长度安全阀 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-14 | 跨文档注释无缓存 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-15 | FB2 转换格式注释容器未识别 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-16 | `noteTextMarker` 4 位数字年份误判风险 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-17 | `isBackLink`/`isFootnoteLink` 重复 sup 查询 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-18 | `_BLOCK_TAGS` 局部数组每次重建 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-19 | last-resort 降级路径含 inline style | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-20 | `_compensatePaginationOffset` 100ms magic number | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-21 | href 解析碎片化，edge case 处理不一致 | v2.3.0 | 📋 已规划 |
| ✅ P4 | D-2026-22 | `init()` Escape 键监听匿名函数永不释放 | v2.1.1 | ✅ 已修复 |
| 🔵 P3 | D-2026-23 | `_loadFromBook` Method 4 循环内重复 `.bind()` | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-24 | `_isTocList` 阈值与 `_RE` 正则词汇无来源注释 | v2.3.0 | 📋 已规划 |
| ✅ P3 | D-2026-25 | speed.sessions/sessionCount 存储结构未在 storage.js 落地 | v2.2.0 | ✅ 已修复 |
