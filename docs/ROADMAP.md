# EPUB Reader — 项目路线图

> 最后更新：2026-07-07（v2.4.6）

---

## 当前状态

- **v2.4.6 已完成**（2026-07-07）：重开定位无快速翻页——同章节旧页短暂回报时重放同一个 `displayCfi`，彻底移除恢复期 `next()/prev()` 校正；用户 EPUB 连续重开 3 次验证不回退、不覆盖 storage。
- **v2.4.5 已完成**（2026-07-07）：分裂位置快照与重开错页修复——restoreCfi 绑定 sourceCfi，iframe 手势解除恢复保护，pos.cfi 与 percentage 不一致时用百分比兜底恢复，pending flush 不回滚，损坏 locations 缓存降级重建；其 `next()/prev()` 有限页校正已被 v2.4.6 替换为同 CFI 直接重放。
- **v2.4.4 已完成**（2026-07-07）：翻页后保存位置不回滚——onRelocated 优先使用 relocated 事件位置，CFI 相同但 locator/百分比变化也会落盘。
- **v2.4.3 已完成**（2026-07-06）：分页模式保存恢复锚点——pos.cfi 保持 start.cfi，locator.restoreCfi 保存页内恢复锚点，避免重开书籍时页边界 CFI 被归属到上一页。
- **v2.4.2 已完成**（2026-07-06）：恢复期不再自动翻页——locator 只校验，不执行 next/prev；v2.4.6 最终确认该原则，仅允许同 CFI 直接重放。
- **v2.3.3 已完成**（2026-06-24）：位置恢复级联退化修复——onRelocated 重采样 CFI、CFI 变化守卫、setLayout/_withCfiLock 恢复保护、beforeunload 兜底。
- **v2.3.2 已完成**（2026-06-24）：位置恢复跳页修复——移除页校正导航、isLayoutStable 门控、resize 防抖。
- **v2.3.1 已完成**（2026-06-24）：iframe hook 幂等性 + 生命周期收敛。
- **v2.3.0 已完成**（2026-06-24）：阅读位置恢复重写（start.cfi + displayed-page locator）。
- **下一步**：v2.4.0 Annotations 算法深度对齐 + 代码质量专项。

---

## 已完成里程碑

| 版本 | 主题 | 关键交付 |
|------|------|---------|
| v2.4.6 | 重开定位无快速翻页 | 同 CFI 直接重放一次、恢复期禁止 next/prev、连续重开不回退 |
| v2.4.5 | 分裂位置快照与重开错页修复 | restoreCfi 绑定 sourceCfi、iframe 手势解除恢复保护、百分比兜底恢复、pending flush 保护、损坏 locations 缓存降级 |
| v2.4.4 | 翻页保存不回滚 | relocated 事件优先、CFI 相同但 locator/百分比变化仍保存 |
| v2.4.3 | 分页恢复锚点保存 | pos.cfi 保持 start.cfi、locator.restoreCfi 保存页内恢复锚点 |
| v2.4.2 | 恢复期不自动翻页 | locator 只校验，页码差异清空 locator；v2.4.6 确认为禁止 next/prev |
| v2.3.3 | 位置恢复级联退化修复 | onRelocated 重采样 CFI、CFI 变化守卫、setLayout 恢复保护、beforeunload |
| v2.3.2 | 位置恢复跳页修复 | 移除页校正导航、isLayoutStable 门控、resize 防抖 |
| v2.3.1 | iframe hook 幂等性 | WeakSet guard、补绑定当前 contents、openBook 直调收敛 |
| v2.3.0 | 位置恢复重写 | start.cfi + displayed-page locator + 有界页校正、flushPositionSave 重建 |
| v2.2.x | 位置恢复迭代 | 实时位置保存、end.cfi 尝试（已被 v2.3.0 替代）、CFI 恢复期保护 |
| v2.1.x | Reader 内核解耦 | 四层拆分（runtime/state/persistence/ui）、mount/unmount 生命周期 |
| v2.0.0 | 数据与性能治理 | 会话加权 ETA、locations idle 调度、书架流式渲染 |
| v1.9.x | 1.x 收尾 | CSP 收敛、storage 错误语义、bookMeta 串行化、BUG-B 修复 |
| v1.7.0 | 存储合并 | bookMeta 聚合、全并发加载、防抖写入、LRU 级联清理 |
| v1.5.0 | Schema 重构 | DB v4（bookId 主键）、SHA-256 指纹、安全落盘语义 |
| v1.0.0 | 基石 | epub.js 集成、IndexedDB 存储、TOC/搜索/主题 |

> 详细开发演进记录见 `walkthrough.md`。

---

## 路线规划

### v2.4.0 — Annotations 算法深度对齐 + 代码质量专项（计划 5～7 工作日）

> 基于 Calibre/KOReader 注释识别算法逆向分析，对 `annotations.js` 进行算法专项与代码质量专项双线治理。

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

**AN-C2: `_BLOCK_TAGS` 升为模块级 `Set`（D-2026-18）**
- `_extractContent` 内 `const BLOCK = [...]` 局部数组每次调用重建，升为模块级 `const _BLOCK_TAGS = new Set([...])`。

**AN-C3: last-resort 降级路径 inline style 迁移（D-2026-19）**
- `showFootnote` last-resort 降级路径含 inline style 字符串，违反 style.* 约束。
- 迁移为 CSS class `.annotation-fallback-hint`（reader.css v2.2.0 已预留）。

**AN-C4: 提取 `_PAGINATION_SETTLE_MS` 具名常量（D-2026-20）**
- `_compensatePaginationOffset` 中 100ms 等待提取为 `const _PAGINATION_SETTLE_MS = 100`。

**AN-C5: 提取 `_parseHref()` 统一 href 片段解析（D-2026-21）**
- `showFootnote` / `_loadFromBook` / `_compensatePaginationOffset` 三处 href 解析逻辑碎片化，统一提取为 `_parseHref(href): { sectionHref, fragmentId }`。
- 验收：`split('#')` 出现次数 ≤ 1（仅在 `_parseHref` 内部）。

**AN-C7: `bind` 提取至循环外 + targetId 早退（D-2026-23）**
- `_loadFromBook` Method 4 循环内重复 `.bind(this)`，提取至循环外。
- 无 targetId 时提前退出，避免无效迭代。

**AN-C8: `_isTocList` 阈值与 `_RE` 正则词汇来源注释（D-2026-24）**
- `_isTocList` 阈值（如 `>= 3`）与 `_RE` 正则词汇（如 `back|return|返回`）补充来源注释，说明来自 Calibre/KOReader 算法参考。

**验收标准（v2.4.0 整体）**：
- `getComputedStyle` 检测：CSS `vertical-align:super` 场景识别率 ≥ 95%。
- 孤立性检查：10 种 TOC 变体误判率 = 0。
- 内容安全阀：空锚点弹窗 ≤ 2000 字符。
- 缓存命中：同文档第二次点击 P90 < 15ms（手动验证）。
- AN-C1～C8 全部重构完成，无回归。

### v2.5.0 — Annotations 跨文档拓扑与 FB2 兼容（计划 3～4 工作日）

> v2.4.0 的延伸，处理更复杂的跨文档场景与历史格式兼容。

- [ ] **AN-3b**：spine index 跨文档位置比对（AN-3 Step B），提升跨文件返回链接的识别精度。
- [ ] **AN-6**：FB2 转换格式兼容（对应 Calibre 掩码 0x0008）。识别 `body[name="notes"]` / `body[name="comments"]` 下的 `section` 结构，将其链接视为注释容器高置信度；在 `_buildDocContext` 中扫描并加入 `footnoteSectionNodes`。
- [ ] **AN-7**：数字标记上限收窄至 3 位（过滤年份误判），白名单保留 `epub:type="noteref"` 覆盖 4 位数字场景。

**验收标准**：
- FB2 转换书籍（测试集 5 本）注释识别率 ≥ 90%。
- 正文中 "1984"、"2023" 等年份数字链接误判率 = 0。

### v2.6.0 — 阅读体验增强（待评估）

> 以下为候选方向，需根据用户反馈和使用数据确定优先级。

- [ ] EPUB 3 Media Overlays 支持（SMIL 同步朗读）。
- [ ] RTL（从右到左）文字方向布局适配。
- [ ] 键盘快捷键体系增强（章节跳转、标注操作、搜索导航）。
- [ ] 标注导出格式扩展（PDF 批注、Anki 卡片）。

### v2.7.0 — 性能与大文件优化（待评估）

- [ ] 超大 EPUB（>50MB）分片加载与内存优化。
- [ ] Locations 生成 Web Worker 化，彻底释放主线程。
- [ ] 标注数据分页加载（单书 >500 条标注场景）。

---

## 关键设计决策（ADR）

### ADR-001：基于内容的 bookId
解决同名不同内容进度覆盖问题。使用 `SHA-256(filename + content[:64KB])` 生成。

### ADR-002：两级存储分层
Binary 走 IndexedDB，轻量 Metadata 走 Chrome Storage (10MB 限额)。

### ADR-003：Key 分离原则
按写频率分组（pos/time/speed 各自独立 patch），规避合并对象引起的写放大问题。

### ADR-004：锚点对齐 start.cfi (v1.8.0)
解决字号变大时由于单屏字数变少导致的重排偏移。

### ADR-005：废弃 highlightKeys 索引 (v1.7.0)
消除索引同步 Bug，改为遍历 `recentBooks` 并行读取。

### ADR-006：阅读位置保存实时化 (v2.2.2)
首个稳定 CFI 立即启动持久化，防抖仅用于连续翻页/滚动后的最终位置收敛。

### ADR-007：恢复期 CFI 不落盘 (v2.2.5)
`display(savedCfi)` 触发的 `relocated.start.cfi` 可能是上一页边界，只能用于 UI 进度，不得覆盖可 flush 的稳定 CFI。

### ADR-008：分页边界 CFI 不作为唯一恢复真相 (v2.3.0 / v2.4.6)
`start.cfi` 可前跳、`end.cfi` 可后跳；分页模式保留 `pos.cfi = start.cfi` 作为兼容主锚点，并在 displayed-page locator 中记录 `sourceCfi + restoreCfi` 作为实际 display 恢复锚点。`restoreCfi` 只有与当前 `pos.cfi` 同源才可信，生成失败或来源不匹配时降级为 `pos.cfi`；若 fresh rendition 首次 `display(restoreCfi)` 后 `currentLocation()` 短暂回报同章节旧页，只重放一次同一个 `displayCfi`，不得执行 `next()/prev()`；若 `pos.cfi` 与 `percentage` 分裂则用百分比兜底恢复。

### ADR-009：Reader 子模块 hook 必须幂等 (v2.3.1)
`openBook()`、`setLayout()` 与 epub.js contents 生命周期可能多次触达同一模块；模块需用 rendition/document 级 guard 防止重复监听，并在 display 后挂载时补绑定当前 iframe。

### ADR-010：enforceFileLRU 不删除标注与书签
LRU 淘汰只释放源文件与缓存（files/recentBooks/bookMeta），用户高亮笔记等高价值数据仅在主动 `removeBook` 时级联删除。再次导入同一 bookId 时数据自动恢复。

---

## 技术债务索引（仅活跃项）

| 优先级 | ID | 描述 | 目标版本 | 状态 |
|---|---|---|---|---|
| 🔵 P3 | D-2026-11 | CSS `vertical-align` 替代 `<sup>` 漏判 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-12 | 孤立性链接缺乏专项排他检查 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-13 | `_extractContent` 无文本长度安全阀 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-14 | 跨文档注释无缓存 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-15 | FB2 转换格式注释容器未识别 | v2.5.0 | 📋 已规划 |
| 🔵 P3 | D-2026-16 | `noteTextMarker` 4 位数字年份误判风险 | v2.5.0 | 📋 已规划 |
| 🔵 P3 | D-2026-17 | `isBackLink`/`isFootnoteLink` 重复 sup 查询 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-18 | `_BLOCK_TAGS` 局部数组每次重建 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-19 | last-resort 降级路径含 inline style | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-20 | `_compensatePaginationOffset` 100ms magic number | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-21 | href 解析碎片化，edge case 处理不一致 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-23 | `_loadFromBook` Method 4 循环内重复 `.bind()` | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-24 | `_isTocList` 阈值与 `_RE` 正则词汇无来源注释 | v2.4.0 | 📋 已规划 |

> 已修复的历史债务（D-2026-01～D-2026-10, D-2026-22, D-2026-25）全部清零，详见 git 历史。
