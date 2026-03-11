# EPUB Reader 综合审计报告（comprehensive_repost）

> 文档版本：v1.9.2 审计基线  
> 最后更新：2026-03-11  
> 覆盖范围：`src/**` 全目录（reader/home/popup/utils/background/manifest）

---


## 1. 审计结论（Executive Summary）

- 当前代码基线整体可用，自动化测试通过，核心阅读/存储闭环稳定。
- 1.x 末期的主要问题不再是“功能缺失”，而是“工程一致性与极端场景鲁棒性”问题。
- 本轮新增确认：**1 个 P1 + 3 个 P2 + 2 个 P3**，均可在低风险改动下治理。
- 建议追加 **v1.9.2 收尾版本**，完成稳定性与一致性清理后，再推进 2.x 拆分。

---

## 2. 审计方法与覆盖面

### 2.1 代码源头审计

重点审阅：
- `src/utils/storage.js`、`src/utils/db-gateway.js`（持久化与一致性）
- `src/reader/reader.js` 及子模块（状态流、事件流、DOM 写入）
- `src/home/home.js`、`src/popup/popup.js`（入口逻辑与书架/导入路径）
- `src/manifest.json`（CSP 与扩展运行约束）

### 2.2 架构设计审计

关注“实现是否持续遵守既定约束”：
- 是否保持“存储统一入口”原则。
- 是否控制跨模块状态耦合。
- 是否为 2.x 模块化拆分保留明确边界。
- 是否满足 CSP 收敛目标和无障碍目标。

---

## 3. 发现的问题清单（按优先级）

## 3.1 🟠 P1：`chrome.storage.local` 错误被吞掉，调用方无法感知失败

**位置**：`src/utils/storage.js` 的 `_get/_set/_remove`。  
**现状**：Promise 始终 resolve，未检查 `chrome.runtime.lastError`。当配额/上下文异常时，业务层会误判“写入成功”。

**风险**：
- 阅读进度、阅读时长、偏好设置可能静默丢失。
- 上层逻辑无法做降级提示或重试。

**建议**：
- 三个内部方法统一改为：若 `chrome.runtime.lastError` 存在则 `reject`。
- 在关键路径（`savePosition`、`saveReadingTime`、`addRecentBook`）增加最小错误日志与可观察性。

---

## 3.2 🟡 P2：`bookMeta` 三路写入存在并发覆盖窗口（RMW 冲突）

**位置**：`savePosition` / `saveReadingTime` / `saveReadingSpeed`（均为“先读后写整对象”）。

**现状**：多个异步写入并发时，后写可能覆盖前写字段，导致 pos/time/speed 中某一字段回退。

**建议**：
- 引入每书 `bookId` 级别写队列（`Map<bookId, Promise>`）串行化。
- 或实现轻量 CAS（版本戳）并在冲突时重试一次。

---

## 3.3 🟡 P2：`getAllHighlights()` 仅遍历 recentBooks，存在“数据可见性截断”

**位置**：`src/utils/storage.js`。

**现状**：recentBooks 上限 20，本地仍存在 `highlights_<bookId>` 时，超出书架范围的数据无法在“标注总览”被发现。

**影响**：
- 数据未丢失，但用户侧表现为“历史标注消失”。

**建议**：
- 增加 fallback：当进入“全部标注”页面时，扫描 storage keys 里的 `highlights_` 前缀并补全。
- 若担心性能，增加缓存或按需分页。

---

## 3.4 🟡 P2：样式控制机制仍未统一，阻碍 CSP 最终收口

**位置**：`home.js`、`image-viewer.js`、`popup.js` 等。

**现状**：仍有 `style.display/style.cursor/style.transform/...` 运行时直写，与“全部 class 化”的目标不一致。

**建议**：
- v1.9.2 做“最后一轮 style.* 清理”并配套 CSS class。
- 清理完再执行 manifest 的 C-7（移除 `unsafe-inline`）。

---

## 3.5 🔵 P3：`reader.js` 仍是高耦合核心（约 1000 行）

架构风险仍在：状态、渲染、持久化、事件编排集中在单文件，后续需求和回归成本持续上升。

**建议**：维持 v2.0.0 拆分计划，不再在 1.x 做大规模重构。

---

## 3.6 🔵 P3：`DbGateway.getByFilename()` 无调用路径

属于低风险死代码/预留接口。建议在 2.x 清理，或补充真实使用场景说明。

---

## 4. 架构一致性回顾

### 4.1 已达成

- 持久化入口基本统一在 `EpubStorage` / `DbGateway`。
- IndexedDB 与 storage.local 分层明确（二进制 vs 元数据）。
- 1.x 多次修复已显著降低数据损坏与缓存孤岛问题。

### 4.2 待收束

- “统一状态写入语义”尚未完成（并发与错误传播不足）。
- “统一 UI 显隐与样式控制语义”尚未完成（class 与 style 混用）。

---

## 5. 1.x 最终扫尾计划（建议 v1.9.2）

1. **可靠性闭环**：修复 storage 错误上抛（P1）。  
2. **一致性闭环**：修复 bookMeta 并发 RMW（P2）。  
3. **数据可见性闭环**：补全 getAllHighlights 覆盖（P2）。  
4. **CSP 前置闭环**：清理残余 style.* 直写（P2）。  
5. **回归闭环**：新增故障注入/并发写/高亮覆盖专项测试。

> 原则：只做低风险治理，不做功能扩张，不做大规模文件拆分。

---

## 6. 2.x 深度规划（架构驱动）

### v2.0.0：内核拆分

- `reader-runtime.js`：epub.js 生命周期与事件转发。
- `reader-state.js`：单一状态源（可序列化）。
- `reader-persistence.js`：位置/时间/速度写入策略（含防抖、flush、错误处理）。
- `reader-ui.js`：DOM 渲染与交互绑定。

### v2.1.0：性能数据化

- 引入阅读会话统计指标（首次可交互、翻页稳定耗时、书架首屏耗时）。
- 优化目录/搜索长任务调度，减少主线程阻塞。

### v2.2.0：安全与无障碍

- 完成 CSP 最终收敛（移除 `unsafe-inline`）。
- 完成 ARIA 语义覆盖与键盘导航闭环。

---

## 7. 文档联动更新说明

本次审计同步更新：
- `docs/ROADMAP.md`：新增 v1.9.2 收尾里程碑与 2.x 顺序。  
- `docs/architecture.md`：补充 comprehensive_repost 审计结论与架构约束更新。  
- `docs/modules.md`：补充存储层错误语义与并发写约束。

