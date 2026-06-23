# EPUB Reader — 项目路线图

> 最后更新：2026-06-24（v2.3.1）

---

## 当前状态

- **v2.3.1 已完成**（2026-06-24）：iframe hook 幂等性 + 生命周期收敛。
- **v2.3.0 已完成**（2026-06-24）：Annotations 算法深度对齐 + 代码质量专项。
- **下一步**：v2.4.0 Annotations 跨文档拓扑与 FB2 兼容。

---

## 已完成里程碑

| 版本 | 主题 | 关键交付 |
|------|------|---------|
| v2.3.1 | iframe hook 幂等性 | WeakSet guard、补绑定当前 contents、openBook 直调收敛 |
| v2.3.0 | Annotations 算法对齐 | computedStyle 检测、孤立性检查、内容安全阀、LRU 缓存、AN-C1～C8 重构 |
| v2.2.x | 安全与位置恢复迭代 | speed.sessions 持久化、ARIA 补全、实时位置保存、CFI 恢复策略迭代 |
| v2.1.x | Reader 内核解耦 | 四层拆分（runtime/state/persistence/ui）、mount/unmount 生命周期 |
| v2.0.0 | 数据与性能治理 | 会话加权 ETA、locations idle 调度、书架流式渲染 |
| v1.9.x | 1.x 收尾 | CSP 收敛、storage 错误语义、bookMeta 串行化、BUG-B 修复 |
| v1.7.0 | 存储合并 | bookMeta 聚合、全并发加载、防抖写入、LRU 级联清理 |
| v1.5.0 | Schema 重构 | DB v4（bookId 主键）、SHA-256 指纹、安全落盘语义 |
| v1.0.0 | 基石 | epub.js 集成、IndexedDB 存储、TOC/搜索/主题 |

> 详细开发演进记录见 `walkthrough.md`。

---

## 路线规划

### v2.4.0 — Annotations 跨文档拓扑与 FB2 兼容（计划 3～4 工作日）

> v2.3.0 的延伸，处理更复杂的跨文档场景与历史格式兼容。

- [ ] **AN-3b**：spine index 跨文档位置比对（AN-3 Step B），提升跨文件返回链接的识别精度。
- [ ] **AN-6**：FB2 转换格式兼容（对应 Calibre 掩码 0x0008）。识别 `body[name="notes"]` / `body[name="comments"]` 下的 `section` 结构，将其链接视为注释容器高置信度；在 `_buildDocContext` 中扫描并加入 `footnoteSectionNodes`。
- [ ] **AN-7**：数字标记上限收窄至 3 位（过滤年份误判），白名单保留 `epub:type="noteref"` 覆盖 4 位数字场景。

**验收标准**：
- FB2 转换书籍（测试集 5 本）注释识别率 ≥ 90%。
- 正文中 "1984"、"2023" 等年份数字链接误判率 = 0。

### v2.5.0 — 阅读体验增强（待评估）

> 以下为候选方向，需根据用户反馈和使用数据确定优先级。

- [ ] EPUB 3 Media Overlays 支持（SMIL 同步朗读）。
- [ ] RTL（从右到左）文字方向布局适配。
- [ ] 键盘快捷键体系增强（章节跳转、标注操作、搜索导航）。
- [ ] 标注导出格式扩展（PDF 批注、Anki 卡片）。

### v2.6.0 — 性能与大文件优化（待评估）

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

### ADR-008：分页边界 CFI 不作为唯一真相 (v2.3.0)
`start.cfi` 可前跳、`end.cfi` 可后跳；持久化 `start.cfi + displayed-page locator`，恢复时只在同章节内做一次页校正。

### ADR-009：Reader 子模块 hook 必须幂等 (v2.3.1)
`openBook()`、`setLayout()` 与 epub.js contents 生命周期可能多次触达同一模块；模块需用 rendition/document 级 guard 防止重复监听，并在 display 后挂载时补绑定当前 iframe。

### ADR-010：enforceFileLRU 不删除标注与书签
LRU 淘汰只释放源文件与缓存（files/recentBooks/bookMeta），用户高亮笔记等高价值数据仅在主动 `removeBook` 时级联删除。再次导入同一 bookId 时数据自动恢复。

---

## 技术债务索引（仅活跃项）

| 优先级 | ID | 描述 | 目标版本 | 状态 |
|---|---|---|---|---|
| 🔵 P3 | D-2026-15 | FB2 转换格式注释容器未识别 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-16 | `noteTextMarker` 4 位数字年份误判风险 | v2.4.0 | 📋 已规划 |

> 已修复的历史债务（D-2026-01～D-2026-25）全部清零，详见 git 历史。
