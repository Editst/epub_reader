# EPUB Reader — 项目路线图

> 最后更新：2026-03-11（基于 `docs/comprehensive_repost.md`）

---

## 当前状态（1.x 收尾窗口）

- 已完成：v1.5.0~v1.9.0 的核心稳定性修复、存储结构重整、CSP 收敛大部分工作。
- 未闭环：仍有 1 个 P1（存储错误处理缺口）+ 3 个 P2（并发写一致性/书架-标注数据覆盖范围/样式债务）值得在 1.x 结束前处理。
- 结论：建议新增 **v1.9.2** 作为 1.x 最终扫尾版本，只做低风险工程治理，不引入新功能。

---

## 里程碑规划

### v1.9.2 — 1.x 最终扫尾（建议 3~4 工作日）

**目标**：把“可预见稳定性风险”清零，让 2.x 的架构改造建立在干净基线上。

- [ ] F-1：`storage.js` 为 `_get/_set/_remove` 增加 `chrome.runtime.lastError` 处理与错误上抛。
- [ ] F-2：`bookMeta` 写入改为串行队列/CAS 风格，消除 `savePosition/saveReadingTime/saveReadingSpeed` 并发覆盖。
- [ ] F-3：`getAllHighlights()` 增加“recentBooks 之外 key 扫描补全”模式，避免旧书标注在书架裁剪后不可见。
- [ ] F-4：将 home/popup/image-viewer 剩余运行时 `style.*` 迁移为 class 切换（为 C-7 最终移除做准备）。
- [ ] F-5：补充针对 F-1/F-2/F-3 的自动化测试（故障注入 + 并发写 + 数据覆盖回归）。

---

### v2.0.0 — Reader 内核解耦（7~10 工作日）

- [ ] R-1：拆分 `reader.js` 为 runtime/state/persistence/ui 四层。
- [ ] R-2：为 Search/TOC/Bookmarks/Highlights/Annotations 建立统一 mount/unmount 生命周期。
- [ ] R-3：消除全局变量跨模块写入，改为单一状态源 + 显式 dispatch。

---

### v2.1.0 — 数据与性能治理（3~4 工作日）

- [ ] P-1：阅读速度/ETA 模型升级（按历史会话加权，区分跳读与连续阅读）。
- [ ] P-2：locations 生成与大型目录渲染做分段调度，减少主线程卡顿。
- [ ] P-3：书架渲染引入批次更新与骨架屏，降低首次白屏时长。

---

### v2.2.0 — 安全与可访问性（3 工作日）

- [ ] A-1：完成 CSP C-7（移除 `unsafe-inline`）。
- [ ] A-2：为 reader/home/popup 核心控件补齐 ARIA 语义与键盘可达性。
- [ ] A-3：补充“注释弹窗 sanitize 回归 + DOM 注入路径”专项安全测试。

---

## 技术债务索引（滚动）

| 优先级 | ID | 描述 | 目标版本 |
|---|---|---|---|
| 🟠 P1 | D-2026-01 | `chrome.storage.local` 回调未处理 `lastError` | v1.9.2 |
| 🟡 P2 | D-2026-02 | `bookMeta` 并发 RMW 存在丢字段覆盖风险 | v1.9.2 |
| 🟡 P2 | D-2026-03 | `getAllHighlights()` 仅覆盖 recentBooks（上限 20） | v1.9.2 |
| 🟡 P2 | D-2026-04 | 运行时 `style.*` 写入仍分散在 home/popup/image-viewer | v1.9.2 |
| 🔵 P3 | D-2026-05 | `reader.js` 仍为高耦合核心文件（~1000 行） | v2.0.0 |
| 🔵 P3 | D-2026-06 | `DbGateway.getByFilename()` 无调用路径 | v2.0.0（清理） |
