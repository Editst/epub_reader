# EPUB Reader — 项目路线图

> 最后更新：2026-03-11（v1.9.2 封版，2.x 规划详细化）

---

## 当前状态（1.x 已封版）

- **已完成**：v1.5.0～v1.9.2 的全部既定目标。核心稳定性修复、存储结构重整、CSP 收敛、BUG 系列修复均已完成。
- **v1.9.2 收尾已全部闭环**：
  - [x] F-1：`storage.js` 为 `_get/_set/_remove` 增加 `chrome.runtime.lastError` 处理与错误上抛。
  - [x] F-2：`bookMeta` 写入改为串行队列/CAS 风格，消除 `savePosition/saveReadingTime/saveReadingSpeed` 并发覆盖。
  - [x] F-3：`getAllHighlights()` 增加"storage key 全扫补全"模式，突破 recentBooks 上限约束。
  - [x] F-4：reader.js 全部 `style.display/style.cursor` 等运行时直写迁移为 class 切换（home/popup 在前序版本已完成；image-viewer.js transform 豁免至 v2.2.0）。
  - [x] F-5：补充 F-1/F-2/F-3/F-4 专项回归测试（故障注入 + 并发写 + 数据覆盖 + style.* 静态回归）。
- **1.x 封版基线**：`style.*` 全量清零（transform 豁免），P1/P2 债务清零，仅 P3 债务纳入 2.x。
- **下一步**：启动 v2.0.0 内核解耦。

---

## 里程碑规划

### v1.9.2 — 1.x 最终扫尾 ✅ 完成

> 原则：只做低风险治理，不做功能扩张，不做大规模文件拆分。

- [x] F-1：`storage.js` 错误上抛（P1 清零）
- [x] F-2：`bookMeta` 串行队列（P2 清零）
- [x] F-3：`getAllHighlights` 全量 key 扫描（P2 清零）
- [x] F-4：reader.js `style.*` 最终迁移（P2 清零，transform 豁免）
- [x] F-5：专项回归测试

---

### v2.0.0 — Reader 内核解耦（计划 7～10 工作日）

**目标**：打破 `reader.js` 单文件高耦合，建立分层模块边界，为后续功能演进奠定架构基础。

- [ ] R-1：拆分 `reader.js` → `reader-runtime.js` + `reader-state.js` + `reader-persistence.js` + `reader-ui.js`（`reader.js` 降至 < 120 行入口编排）。
- [ ] R-2：子模块建立统一 `mount(context)` / `unmount()` 生命周期接口，替代散乱的 `setBook/hookRendition` 调用序列。
- [ ] R-3：消除全局变量跨模块写入，改为 `context` 显式传参。
- [ ] 清理：删除 `DbGateway.getByFilename()` 死代码（D-2026-06）。

**验收标准**：
- `reader.js` 行数 < 120，各新文件 < 250 行。
- 所有既有测试通过（无回归）。
- 新增模块加载顺序文档与架构图更新。

---

### v2.1.0 — 数据与性能治理（计划 3～4 工作日）

**目标**：阅读速度模型精度提升，消除主线程长任务，改善首屏体验。

- [ ] P-1：阅读速度/ETA 模型升级（会话加权 + 跳读识别 + 低样本"估算中"提示）。
- [ ] P-2：`locations.generate()` 改为 `requestIdleCallback` 分批调度 + 进度反馈；TOC > 100 项引入虚拟滚动。
- [ ] P-3：书架流式渲染（骨架屏占位 + 每书就绪立即插入），目标首屏骨架 < 100ms。

**验收标准**：
- ETA 估算在"从中途开书"场景误差 < 20%。
- 1000 章节书籍 locations 生成期间主线程帧率 > 30fps。
- 书架首屏时间 < 500ms（20 本书含封面）。

---

### v2.2.0 — 安全与可访问性（计划 3 工作日）

**目标**：完成 CSP 最终收敛，补齐 ARIA 语义，完成 1.x 遗留的 image-viewer transform 豁免收口。

- [ ] A-1：`image-viewer.js` `style.transform` 迁移为 CSS 自定义属性（`--iv-tx/--iv-ty/--iv-scale`），从 `manifest.json` 移除 `'unsafe-inline'`。
- [ ] A-2：reader/home/popup 核心控件补齐 ARIA 语义（`aria-label`、`aria-expanded`、`role`）与键盘可达性（Tab/Enter/Escape 完整闭环）。
- [ ] A-3：新增 `test/suites/annotations_security.test.js`（5 类 DOM 注入路径验证）。

**验收标准**：
- `manifest.json` `style-src` 不含 `'unsafe-inline'`。
- Lighthouse Accessibility 评分 ≥ 90。
- 所有交互控件可通过键盘完成操作。

---

## 技术债务索引（滚动）

| 优先级 | ID | 描述 | 目标版本 | 状态 |
|---|---|---|---|---|
| 🟠 P1 | D-2026-01 | `chrome.storage.local` 回调未处理 `lastError` | v1.9.2 | ✅ 已修复 |
| 🟡 P2 | D-2026-02 | `bookMeta` 并发 RMW 存在丢字段覆盖风险 | v1.9.2 | ✅ 已修复 |
| 🟡 P2 | D-2026-03 | `getAllHighlights()` 仅覆盖 recentBooks（上限 20） | v1.9.2 | ✅ 已修复 |
| 🟡 P2 | D-2026-04 | 运行时 `style.*` 写入分散（home/popup/image-viewer/reader） | v1.9.2 | ✅ 已修复（transform 豁免至 v2.2.0） |
| 🔵 P3 | D-2026-05 | `reader.js` 仍为高耦合核心文件（~1000 行） | v2.0.0 | 📋 已规划 |
| 🔵 P3 | D-2026-06 | `DbGateway.getByFilename()` 无调用路径 | v2.0.0 | 📋 已规划 |
| 🔵 P3 | D-2026-07 | `image-viewer.js` `style.transform` 残余（动态计算值豁免） | v2.2.0 | 📋 已规划 |
| 🔵 P3 | D-2026-08 | ARIA 语义缺失（工具栏/面板/书架卡片） | v2.2.0 | 📋 已规划 |
| 🔵 P3 | D-2026-09 | 阅读速度模型为等权平均，未区分跳读/连续阅读 | v2.1.0 | 📋 已规划 |
| 🔵 P3 | D-2026-10 | locations 生成阻塞主线程（大型书籍 > 500ms） | v2.1.0 | 📋 已规划 |
