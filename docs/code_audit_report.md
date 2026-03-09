# EPUB Reader 综合合并版审计报告（架构 + 代码 + 性能）

> 本报告为三次审计结果的**合并版**：
> 1) 首版问题清单与优化框架；
> 2) 第二版宏观架构 + 微观代码深化；
> 3) 本版新增“性能专项深度优化”，形成统一治理路线。

---

## 0. 审计范围、方法与目标

### 0.1 审计范围
- 核心阅读编排：`src/reader/reader.js`
- 搜索与标注：`src/reader/search.js`、`src/reader/highlights.js`
- 书架与聚合页：`src/home/home.js`
- 存储与数据模型：`src/utils/storage.js`
- 权限与暴露面：`src/manifest.json`

### 0.2 审计方法
- **静态代码审查**：状态一致性、并发链路、异常处理、资源释放、数据模型。
- **用户链路审计**：首次导入、缓存失效、切书、搜索、标注、导出、删除。
- **边缘案例审计**：大文件、连续操作、重排版、失败恢复、跨页面跳转。
- **性能视角审计**：启动时延、渲染流畅度、I/O 放大、内存生命周期、可观测性。

### 0.3 审计目标
- 降低“偶发错误、难复现、难定位”的系统性风险。
- 在不牺牲功能完整度前提下，提高性能上限与可维护性。

---

## 1. 现状总览：优势与结构性风险

### 1.1 现有优势
- 功能闭环完整：导入、阅读、进度、标注、书架、导出均已覆盖。
- 模块划分有基础：TOC/Search/Highlights/Bookmarks 等已模块化。
- 离线能力较好：`chrome.storage.local + IndexedDB` 组合设计合理。

### 1.2 结构性风险概览
- `reader.js` 作为“上帝对象”承载过多职责。
- 模块之间通过全局对象直接互调，生命周期边界弱。
- IndexedDB schema 初始化逻辑分散重复，迁移风险累积。
- BookId 主键设计过弱（`filename + size`），存在数据串联风险。
- 注解/高亮类型管理不统一，导致清理与回收不稳定。

---

## 2. 宏观架构审计（合并版）

## 2.1 架构问题 A：Reader 控制器过重
`reader.js` 同时处理：生命周期、导航、UI 事件、存储、主题、统计、并发防抖。

**影响**
- 变更耦合度高，单点修改引发多链路回归。
- 并发链路定位困难（`resize/display/relocated/nav`）。

**建议框架（目标分层）**
1. `ReaderRuntime`：book/rendition 的创建、销毁、渲染控制。
2. `ReaderState`：单一状态源（含事务号、选择器、派生状态）。
3. `ReaderUI`：DOM 显示与交互绑定（不直接写持久层）。
4. `ReaderPersistence`：位置、时长、缓存、封面、locations 写入策略。

> 依赖方向：UI -> State -> Runtime/Persistence，禁止逆向穿透。

## 2.2 架构问题 B：缺少统一模块协议
当前模块由主控制器直接调用，导致挂载/卸载不对称。

**建议框架**
- 建立轻量事件协议：
  - `BOOK_OPENED` / `BOOK_CLOSED`
  - `LOCATION_CHANGED`
  - `SEARCH_SESSION_CHANGED`
  - `ANNOTATION_CHANGED`
- 每个模块统一接口：`mount(context)` / `unmount()` / `reset()`。
- 引入 `disposer registry`，确保切书时统一释放监听器。

## 2.3 架构问题 C：存储网关缺失
多处重复 `indexedDB.open(..., version)` + `onupgradeneeded`。

**建议框架**
- 新建 `infra/db-gateway.js`：
  - 统一 open、迁移、事务模板、错误上报。
- schema 单一真相源（store 列表 + 版本迁移脚本）。
- 应用层禁止直接调用 `indexedDB.open`。

## 2.4 架构问题 D：领域主键模型脆弱
BookId 基于文件名与大小，冲突概率不可接受（尤其同名版次文件）。

**建议框架**
- 升级到内容指纹（SHA-256，支持分块策略）。
- 维护 `legacyId -> contentId` 映射实现平滑迁移。
- 所有业务 key（位置/标注/时长/封面/locations）围绕 `contentId` 统一。

---

## 3. 微观代码审计（合并版）

## P0（必须优先）

1. **搜索高亮清理类型不一致**
- 添加高亮与清理时使用标识不统一，存在残留风险。
- 影响：视觉污染、对象累积、用户定位误判。
- 修复：统一注解类型常量 + 全入口 cleanup + 搜索会话 token。

2. **BookId 碰撞引发“串书”风险**
- 影响：进度、标注、封面错绑，数据可信度受损。
- 修复：内容指纹主键 + 增量迁移。

3. **Manifest 暴露面偏宽**
- `web_accessible_resources` 对 `<all_urls>` 暴露 `lib/*`，超最小权限。
- 修复：按资源最小化清单收敛到必要范围。

## P1（重要）

4. **导航/重排版/定位保存竞态**
- 多事件交错导致旧位置信息覆盖新位置。
- 修复：`navTxnId` 事务序列号 + 最终一致写入策略。

5. **生命周期清理不对称**
- 切书/重挂载后可能重复监听。
- 修复：监听器可释放化 + 统一 `disposeAll()`。

6. **innerHTML 使用模式不统一，存在未来 XSS 回归风险**
- 当前局部做了转义，但缺统一边界。
- 修复：默认 DOM API + 统一 safeHtml 入口 + payload 回归用例。

7. **错误处理可观测性不足**
- 大量 `console.warn + resolve` 吞错。
- 修复：统一 `reportError(scope, context)`，提供用户级轻提示与重试。

## P2（持续改进）

8. ETA 估算模型静态化，跨书籍偏差大。
9. `URL.createObjectURL` 生命周期管理需收敛（统一 revoke）。
10. 自动化回归矩阵缺失（切书、搜索、resize、删除一致性）。

---

## 4. 性能专项深度审计（新增重点）

## 4.1 启动性能（Time to First Read）

### 观察
- 首次打开流程包含：读取文件 -> openBook -> display -> locations 逻辑。
- 虽已采用“先 display 再 generate locations”的策略，但仍有潜在阻塞点：
  - metadata/navigation 解析顺序串行。
  - 封面提取与存储虽异步，但错误重试与降级策略不足。

### 优化建议
- 明确分阶段指标：
  - `T0` 文件选取
  - `T1` 首屏可读（display 完成）
  - `T2` 目录可用
  - `T3` locations 就绪
- 首屏优先级调度：
  - 保证 `display` 与基础输入交互优先；
  - TOC、封面、统计等非关键链路后台化并可取消。

## 4.2 渲染性能（翻页/滚动/重排版）

### 观察
- `resize` + `display(targetCfi)` + `relocated` 间事件交错，存在重复计算与状态抖动。
- 高频 UI 操作（字体、行距、主题）可能触发多次样式注入更新。

### 优化建议
- 将 `updateCustomStyles` 合并为微任务/动画帧批处理（RAF batching）。
- 布局相关操作统一走“事务帧”调度：一次操作只做一次 reflow。
- 对连续输入（slider）采用“即时预览 + 尾提交持久化”双通道。

## 4.3 搜索性能（大书全文检索）

### 观察
- 当前为章节串行扫描，虽有中断标识，但仍在主线程执行，长书时 UI 压力明显。

### 优化建议
- 搜索分片执行：每 N 章节让渡主线程（已有基础，可加强调度策略）。
- 限制渲染结果窗口：
  - 仅渲染可视区 + 邻域（虚拟列表）。
- 中长期：迁移到 Worker 搜索管线（文本索引/倒排可选）。

## 4.4 I/O 性能（存储读写放大）

### 观察
- 位置信息、时长、标注写入频率较高，存在写放大与抖动。
- 多处 DB 打开逻辑造成连接与迁移判断重复成本。

### 优化建议
- 写入队列化：位置/时长采用节流 + 合并写（coalescing）。
- 统一 DB Gateway 后复用连接，减少重复 open 成本。
- 为大对象（locations、cover）建立容量与淘汰策略指标。

## 4.5 内存性能（会话稳定性）

### 观察
- 多本切换时，若监听器/注解对象释放不彻底，易出现隐性增长。
- 封面 URL 需要统一生命周期管理避免泄露。

### 优化建议
- 建立“可释放资源登记表”：listener、annotation、objectURL、timer。
- 切书时执行统一 `teardown snapshot`，并输出调试计数。
- 对关键对象建立弱引用/ID 索引防重。

## 4.6 前端交互性能（长列表/频繁刷新）

### 观察
- 标注列表与搜索结果使用全量重绘，数据量大时会卡顿。

### 优化建议
- 引入列表虚拟化（或分页渲染）减少 DOM 压力。
- 采用增量更新（patch）替代 `innerHTML = ''` 后全量重建。

## 4.7 性能可观测性

### 建议埋点（最小集）
- `reader_first_display_ms`
- `locations_generate_ms`
- `search_total_ms` / `search_cancel_count`
- `nav_to_relocated_ms`
- `storage_write_queue_depth`
- `active_listener_count`

> 没有可观测性，就无法稳定迭代性能。

---

## 5. 用户视角与边缘场景（合并增强）

1. **缓存被 LRU 清理后打开失败**：建议书架提前标记“需重导入”。
2. **快速连续操作（翻页+主题+字号+resize）**：需事务化状态机与写队列。
3. **导出期间并发修改标注**：导出前冻结快照，避免不一致。
4. **大书搜索可取消性**：统一 AbortController 风格，避免模块内各自维护取消旗标。
5. **异常恢复能力**：关键失败场景给出“可重试入口”，减少用户无助感。

---

## 6. 目标架构与数据契约（合并版）

## 6.1 目标分层
- `core/reader-runtime.js`
- `core/reader-state.js`
- `core/reader-ui.js`
- `core/reader-persistence.js`
- `infra/db-gateway.js`
- `modules/*`（统一生命周期）

## 6.2 数据契约
- `BookIdentity`: `{ contentId, legacyIds[], filename, size, fingerprintVersion }`
- `ReadingPosition`: `{ contentId, cfi, percent, txnId, updatedAt }`
- `Highlight`: `{ contentId, cfi, color, note, createdAt, updatedAt, source }`
- `PerformanceSample`: `{ metric, value, ts, context }`

## 6.3 并发治理
- 只接受最新事务写入（Last-write-by-txn）。
- I/O 统一写队列 + 失败可重试。
- 长任务可取消（locations、search、批量渲染）。

---

## 7. 分阶段落地路线（含性能）

### Phase A（1~2 周，止血）
- 修复搜索高亮 add/remove 一致性。
- 收敛 manifest 资源暴露范围。
- 位置写入事务号 + 节流。
- 新增基础性能埋点（首屏、导航、搜索）。

### Phase B（2~4 周，稳定性重构）
- 引入 `db-gateway` 与迁移脚手架。
- 建立模块 `mount/unmount/dispose` 标准。
- BookId 内容指纹 + 兼容迁移。
- 引入写队列、资源释放登记、监听器计数。

### Phase C（持续，性能与质量工程）
- 搜索性能升级（分片 + 虚拟列表，后续 Worker）。
- ETA 动态模型（个体 + 本书双通道）。
- 建立自动化回归矩阵与性能预算守护。

---

## 8. 合并版执行清单（可直接排期）
- [ ] 统一注解类型常量，修复搜索高亮清理链路
- [ ] BookId 升级为内容指纹并完成兼容迁移
- [ ] 收敛 `web_accessible_resources` 到最小权限
- [ ] 实施 `navTxnId` + 位置写节流与写队列
- [ ] 建立统一模块生命周期（mount/unmount/dispose）
- [ ] 抽象 `db-gateway` + migration tests
- [ ] 错误可观测：ring buffer + 轻提示 + 重试
- [ ] 大列表性能：虚拟化/分页 + 增量更新
- [ ] 资源释放治理：listeners/timers/objectURL/annotations
- [ ] 性能埋点与预算：首屏、搜索、导航、写队列深度

---

## 9. 结论
项目具备较高产品完成度，但已进入“复杂度临界点”：
- 若继续在当前结构上叠加功能，偶发 bug、性能抖动和回归成本会持续上升。
- 建议按“**先止血、再分层、后性能工程化**”推进，优先解决主键可靠性、并发一致性与生命周期治理；随后通过可观测性驱动性能优化，建立可持续迭代能力。
