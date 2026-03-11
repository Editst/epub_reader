# EPUB Reader 综合审计报告（comprehensive_repost）

> 文档版本：v1.9.2 最终审计基线（1.x 正式封版）
> 最后更新：2026-03-11
> 覆盖范围：`src/**` 全目录（reader/home/popup/utils/background/manifest）

---

## 1. 审计结论（Executive Summary）

- **1.x 系列已完成全部既定开发目标**。v1.5.0～v1.9.2 涵盖：数据层加固、存储架构重整、安全加固（XSS/CSP 收敛）、性能优化（并行加载、防抖、LRU 优化）、BUG 系列修复（ETA 算法、resize 偏移、popup 竞态）。
- **v1.9.2 最终收尾已完成**：原 ROADMAP 中 F-1/F-2/F-3/F-4 四项均已实现并通过自动化测试验证。
- **本轮新增审计发现与修复**：`reader.js` 中残余 5 处 `style.*` 运行时直写（D-2026-04 最终收口），已全部迁移为 CSS class 控制；`reader.html` 同步移除对应内联 `style="display:none"`；`reader.css` 新增完整的 `.is-hidden/.is-visible` 辅助类组。
- **当前技术债务状态**：原 P1（D-2026-01）和全部 P2（D-2026-02/03/04）已清零。仅剩 P3 级别债务（reader.js 高耦合、DbGateway 死代码、image-viewer transform 豁免），均已纳入 2.x 规划。
- **结论**：1.x 系列可正式封版。建议以当前 v1.9.2 为基线启动 2.x 架构演进。

---

## 2. 审计方法与覆盖面

### 2.1 代码源头审计

重点审阅：
- `src/utils/storage.js`、`src/utils/db-gateway.js`（持久化与一致性）
- `src/reader/reader.js` 及子模块（状态流、事件流、DOM 写入）
- `src/home/home.js`、`src/popup/popup.js`（入口逻辑与书架/导入路径）
- `src/reader/reader.css`、`src/reader/reader.html`（CSS class vs inline style 状态控制）
- `src/manifest.json`（CSP 与扩展运行约束）

### 2.2 架构设计审计

关注"实现是否持续遵守既定约束"：
- 是否保持"存储统一入口"原则。
- 是否控制跨模块状态耦合。
- 是否为 2.x 模块化拆分保留明确边界。
- 是否满足 CSP 收敛目标和无障碍目标。

---

## 3. 1.x 最终状态确认（问题已清零清单）

### 3.1 ✅ P1 已修复：`chrome.storage.local` 错误上抛

**修复版本**：v1.9.2
**修复内容**：`_get/_set/_remove` 统一检查 `chrome.runtime.lastError`，存在则 `reject`。
**验证**：`test/tests.js` F-1 故障注入套件（3 个方法 × 3 种错误场景）。

---

### 3.2 ✅ P2 已修复：`bookMeta` 并发 RMW 覆盖窗口

**修复版本**：v1.9.2
**修复内容**：引入 `_bookMetaQueue: Map<bookId, Promise>`，三路写入（pos/time/speed）串行化。队列在写入完成后自动清理，无内存泄漏。
**验证**：`test/tests.js` F-2 并发写一致性套件。

---

### 3.3 ✅ P2 已修复：`getAllHighlights()` 数据可见性截断

**修复版本**：v1.9.2
**修复内容**：`getAllHighlights` 在遍历 `recentBooks` 基础上，额外调用 `_getAll()` 扫描所有以 `highlights_` 为前缀的 key 并补全，突破 20 本上限约束。
**验证**：`test/tests.js` F-3 全量 key 扫描套件（22 本书场景）。

---

### 3.4 ✅ P2 已修复：样式控制机制统一（`style.*` 全量清零）

**修复版本**：v1.9.2（最终收口，本轮新发现并修复）

**修复内容**：

`reader.js` 中以下 5 处 `style.*` 运行时直写已全部迁移：

| 位置 | 原写法 | 新写法 |
|---|---|---|
| `openBook` — welcomeScreen | `style.display = 'none'` | `classList.add('is-hidden')` |
| `openBook` — readerMain | `style.display = 'flex'` | `classList.add('is-visible')` |
| `openBook` — bottomBar | `style.display = 'flex'` | `classList.add('is-visible')` |
| `setTheme` — customThemeOptions | `style.display = ... ? 'block' : 'none'` | `classList.toggle('is-visible', ...)` |
| `showLoading` — loadingOverlay | `style.display = ... ? 'flex' : 'none'` | `classList.toggle('is-hidden', ...)` |

`reader.html` 移除以下内联样式：
- `#loading-overlay` 的 `style="display:none;"` → 改为 `class="loading-overlay is-hidden"`
- `#custom-theme-options` 的 `style="display: none;"` → 移除（由 JS class 控制）
- `#reader-main` 的 `style="display:none;"` → 移除（CSS 默认 `display:none`）
- `#bottom-bar` 的 `style="display:none;"` → 移除（CSS 默认 `display:none`）

`reader.css` 新增辅助类组：
```css
.welcome-screen.is-hidden       { display: none !important; }
.reader-main.is-visible         { display: flex !important; }
.bottom-bar.is-visible          { display: flex !important; }
.loading-overlay.is-hidden      { display: none !important; }
.custom-theme-options.is-visible { display: block !important; }
```

**豁免类型1（变换值）**：`image-viewer.js` 的 `style.transform`（动态平移+缩放计算值，无法静态化）→ v2.2.0 通过 CSS 自定义属性替代。
**豁免类型2（定位值）**：`highlights.js` 的 `style.top/left`（悬浮工具栏运行时坐标）→ v2.2.0 通过 CSS 自定义属性替代。

**同步修复（本轮新增）**：`highlights.js` 中 4 处 `btnClearHl.style.display` 和 `annotations.js` 中 3 处 `style.display` 均已迁移为 `classList` 操作，新增对应 CSS 辅助类，`reader.html` 移除对应内联 `style="display:none"`。

**当前状态**：home.js / popup.js / reader.js / highlights.js / annotations.js 全部 `style.display/visibility` 清零。全项目仅保留两类计算值豁免：`image-viewer.js` `style.transform` 和 `highlights.js` `style.top/left`，均计划 v2.2.0 通过 CSS 自定义属性消除。

**验证**：`test/tests.js` F-4 静态回归套件 + `test/suites/csp_regression.test.js` C-8～C-11 + `test/suites/release_checks.test.js` v1.9.2 完成验证组。

---

### 3.5 🔵 P3 在记（已纳入 2.x）：`reader.js` 高耦合核心

架构风险仍存：状态、渲染、持久化、事件编排集中在单文件（~1000 行），后续需求和回归成本持续上升。建议维持 v2.0.0 拆分计划。

---

### 3.6 🔵 P3 在记（已纳入 2.x）：`DbGateway.getByFilename()` 无调用路径

属于低风险死代码/预留接口。在 v2.0.0 清理或补充真实使用场景说明。

---

## 4. 架构一致性回顾（1.x 结束时）

### 4.1 已完全达成

- 持久化入口统一在 `EpubStorage` / `DbGateway`，全项目无野生 `indexedDB.open` 或直接 `chrome.storage.local` 调用。
- IndexedDB 与 storage.local 分层明确（二进制 vs 元数据）。
- `chrome.storage.local` 错误语义统一（lastError → reject）。
- `bookMeta` 写入语义统一（串行队列，无并发 RMW 窗口）。
- 高亮数据聚合语义完整（全量 key 扫描，无上限截断）。
- **UI 显隐样式控制语义统一**（`style.*` 全量迁移为 class，仅 transform 豁免）。

### 4.2 有意推迟至 2.x

- `reader.js` 单文件架构未解耦（P3，设计上确认，不做 1.x 破坏性重构）。
- `unsafe-inline` 未完全移除（image-viewer transform 豁免，计划 v2.2.0）。
- ARIA 语义与键盘可达性未补全（v2.2.0）。

---

## 5. 1.x 系列版本总结

| 版本 | 核心交付 | 状态 |
|---|---|---|
| v1.1.x | 高亮、书签、UI 基础建设 | ✅ 完成 |
| v1.2.x | XSS 修复、CSP 初始加固、数据可靠性止血、架构稳定 | ✅ 完成 |
| v1.3.0 | 字体降级、排版优化、高亮 CSS 注入封堵 | ✅ 完成 |
| v1.4.x | IndexedDB 网关化、野生连接根除 | ✅ 完成 |
| v1.5.0 | bookId SHA-256、IDB tx.oncomplete、bookmarks 归口 | ✅ 完成 |
| v1.6.0 | IDB Schema v4 重建、annotations 安全加固、highlightKeys 废弃 | ✅ 完成 |
| v1.7.0 | bookMeta 聚合、速度追踪、Utils 共享模块、并行加载、防抖写入 | ✅ 完成 |
| v1.8.0 | BUG-01/02/03 修复（popup 竞态、ETA 算法、resize 偏移） | ✅ 完成 |
| v1.9.0 | CSP C-1～C-7（reader/search/toc 内联样式迁移） | ✅ 完成 |
| v1.9.2 | F-1/F-2/F-3/F-4（P1/P2 全清零，style.* 最终收口） | ✅ **完成，1.x 封版** |

---

## 6. 2.x 深度规划

### 总体原则

- 不引入破坏性存储变更（Storage Schema v4 冻结）。
- 每个 2.x 版本独立可回滚，不捆绑大特性。
- 新增功能均须先补测试，不允许"功能先行、测试后补"。

---

### v2.0.0 — Reader 内核解耦（预计 7～10 工作日）

**核心目标**：打破 `reader.js` 单文件高耦合，建立分层模块边界。

#### R-1：拆分 `reader.js` 为四层

| 新文件 | 职责 | 主要内容 |
|---|---|---|
| `reader-runtime.js` | epub.js 生命周期与事件转发 | book/rendition 初始化、relocated/displayed 事件 |
| `reader-state.js` | 单一状态源（可序列化） | currentBookId/currentPrefs/isBookLoaded 等所有 let 变量 |
| `reader-persistence.js` | 位置/时间/速度写入策略 | schedulePositionSave、flushSpeedSession、readingTimer |
| `reader-ui.js` | DOM 渲染与交互绑定 | setupEventListeners、toggleSettings、setTheme、setLayout |

**实施约束**：
- 各层通过 `dispatchEvent` / 共享 `state` 对象通信，禁止跨层直接读写变量。
- `reader.js` 降级为入口编排文件（< 100 行），仅负责按序初始化上述四层。

#### R-2：子模块统一生命周期接口

当前 TOC/Bookmarks/Search/Highlights/Annotations/ImageViewer 各自有 `init/setBook/hookRendition` 但命名不一致。
- 建立统一的 `module.mount(context)` / `module.unmount()` 接口（`context` 包含 book/rendition/bookId）。
- `setLayout` 重建渲染器时遍历 `modules.forEach(m => m.mount(ctx))`，消除逐一手动调用。

#### R-3：消除全局变量跨模块写入

子模块访问 `rendition` 等全局变量改为通过 `context` 参数显式传递。

#### 清理

- 删除 `DbGateway.getByFilename()` 死代码（D-2026-06）。

#### 验收标准

- `reader.js` 行数 < 120。
- 各新文件行数 < 250。
- 现有所有测试用例保持通过（无回归）。
- 新增模块加载顺序文档。

---

### v2.1.0 — 数据与性能治理（预计 3～4 工作日）

**核心目标**：量化阅读体验，消除主线程长任务。

#### P-1：阅读速度/ETA 模型升级

当前问题：`sampledSeconds / sampledProgress` 等权平均，历史久远的慢速 session 拖低近期快速阅读的 ETA 估算精度。

改进方案：
- 引入**会话加权**：近期会话权重更高（指数衰减，衰减因子 β=0.8）。
  ```
  weightedSpeed = Σ(β^i * sessionSpeed_i) / Σ(β^i)
  ```
- 区分**跳读**（progress delta > 5%）与**连续阅读**（< 5%），跳读 session 权重降为 0.3。
- 新增 `speed.sessionCount` 字段，样本量 < 3 时 ETA 显示"估算中"。
- Speed 结构升级（向后兼容）：
  ```
  speed: {
    sampledSeconds: number,   // 保留（兼容）
    sampledProgress: number,  // 保留（兼容）
    sessions: [               // 新增
      { seconds, progress, timestamp, isJump }
    ]
  }
  ```

#### P-2：locations 生成与长目录渲染分段调度

- `book.locations.generate()` 在大型书籍上阻塞主线程 > 500ms：改为 `requestIdleCallback` 分批调度，每批 50 个 location，期间显示生成进度条。
- TOC 列表 > 100 项改用虚拟滚动（Intersection Observer），避免一次性创建大量 DOM。

#### P-3：书架渲染流式更新与骨架屏

- 当前：`Promise.all` 全部完成后一次 DOM 更新。
- 改为：每本书就绪立即插入，骨架屏占位未加载书籍。
- 目标：首帧骨架屏 < 100ms，第一本书完整卡片 < 500ms。

#### 验收标准

- ETA 估算在"从中途开书"场景下误差 < 20%（与真实阅读速度对比）。
- 1000 章节书籍的 locations 生成期间 CPU 主线程帧率 > 30fps。
- 书架首屏时间（TTF）< 500ms（20 本书，含封面）。

---

### v2.2.0 — 安全与可访问性（预计 3 工作日）

**核心目标**：完成 CSP 最终收敛，补齐 ARIA 语义。

#### A-1：完成 CSP 最终收敛（移除 `unsafe-inline`）

唯一阻塞点：`image-viewer.js` 的 `style.transform`（动态计算值）。

迁移方案：
```css
/* reader.css */
#image-viewer-img {
  transform: translate(var(--iv-tx, 0px), var(--iv-ty, 0px)) scale(var(--iv-scale, 1));
  transition: transform 0.08s ease;
}
```
```js
// image-viewer.js - applyTransform()
applyTransform() {
  this.img.style.setProperty('--iv-tx', `${this.translateX}px`);
  this.img.style.setProperty('--iv-ty', `${this.translateY}px`);
  this.img.style.setProperty('--iv-scale', this.scale);
}
```

> `style.setProperty` 设置 CSS 自定义属性不触发 `unsafe-inline` 限制。

完成后从 `manifest.json` `style-src` 移除 `'unsafe-inline'`，同步从 `test/suites/csp_regression.test.js` 更新 C-7 断言为"不包含 unsafe-inline"。

#### A-2：ARIA 语义与键盘可达性

覆盖范围（按重要性排序）：

1. **reader 工具栏**：所有 `<button>` 补 `aria-label`（当前 `btn-bookmark` 等仅有 `title`，屏幕阅读器无法读取）。
2. **进度滑块**：`<input type="range">` 补 `aria-valuemin/valuemax/valuenow/aria-label`。
3. **面板开关**：TOC/搜索/书签面板补 `aria-expanded` 状态，面板本身补 `role="dialog"` + `aria-label`。
4. **高亮工具栏**：颜色选择按钮补 `aria-label="高亮为 XXX 色"`。
5. **书架卡片**：`<div class="book-card">` 改为 `<article>` 或补 `role="listitem"`，封面图 `alt` 属性填写书名。

#### A-3：注释弹窗安全加固专项测试

`annotations.js` 的 EPUB 脚注渲染路径已过滤 `on*` 属性，但缺乏针对性测试。
- 新增 `test/suites/annotations_security.test.js`，覆盖向量：`onload`、`href=javascript:`、`data: URL`、`srcdoc`、`<base>` 重定向。

#### 验收标准

- `manifest.json` 的 `style-src` 不含 `'unsafe-inline'`。
- Lighthouse Accessibility 评分 ≥ 90。
- 所有交互控件可通过 Tab/Enter/Space/Escape 键盘操作完成。

---

## 7. 技术债务索引（更新至 v1.9.2 封版）

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

---

## 8. 文档联动更新说明

本次审计同步更新（均已执行）：
- `docs/ROADMAP.md`：标记 v1.9.2 全部收尾项完成，补充 v2.0.0/v2.1.0/v2.2.0 详细规划与验收标准。
- `docs/architecture.md`：补充 1.x 封版结论、style.* 迁移说明、image-viewer transform 豁免理由、v2.x 架构演进方向。
- `docs/modules.md`：补充 `getAllHighlights` 更新语义、`_bookMetaQueue` 串行化约束、CSS 辅助类控制机制说明。
- `test/tests.js`：新增 F-1/F-2/F-3/F-4 专项回归套件（v1.9.2），测试头注释更新至 v1.9.2。
- `test/suites/csp_regression.test.js`：新增 C-8～C-11，覆盖 reader.js style.display 消除与辅助类完整性。
- `test/suites/release_checks.test.js`：新增 v1.9.2 收尾完成验证组（F-1/F-2/F-3/F-4 静态断言）。
- `CHANGELOG.md`：v1.9.2 条目补充 reader.js style.* 迁移详情与测试更新说明。
