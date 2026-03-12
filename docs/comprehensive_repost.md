# EPUB Reader 综合审计报告（comprehensive_repost）

> 文档版本：v1.9.3 最终审计基线（1.x 正式封版）+ Annotations 算法深度对齐专项 + 代码质量专项
> 最后更新：2026-03-12
> 覆盖范围：`src/**` 全目录（reader/home/popup/utils/background/manifest）

---

## 1. 审计结论（Executive Summary）

- **1.x 系列已完成全部既定开发目标**。v1.5.0～v1.9.3 涵盖：数据层加固、存储架构重整、安全加固（XSS/CSP 收敛）、性能优化（并行加载、防抖、LRU 优化）、BUG 系列修复（ETA 算法、resize 偏移、popup 竞态、file-input click 限制）。
- **v1.9.3 最终收尾已完成**：原 ROADMAP 中 F-1/F-2/F-3/F-4 四项均已实现并通过自动化测试验证；BUG-B（`display:none` 元素 `.click()` 失效）已修复并同步至所有受影响文件。
- **本轮新增审计发现与修复**：`reader.js` 中残余 5 处 `style.*` 运行时直写（D-2026-04 最终收口），已全部迁移为 CSS class 控制；`reader.html` 同步移除对应内联 `style="display:none"`；`reader.css` 新增完整的 `.is-hidden/.is-visible` 辅助类组。
- **当前技术债务状态**：原 P1（D-2026-01）和全部 P2（D-2026-02/03/04/BUG-B）已清零。仅剩 P3 级别债务（reader.js 高耦合、DbGateway 死代码、image-viewer transform 豁免），均已纳入 2.x 规划。
- **新增：Annotations 算法短板专项审计**（本轮补充）：基于 Calibre/KOReader 注释识别算法逆向分析，发现 `annotations.js` 存在 5 类系统性短板，已全部登记为 D-2026-11～16，纳入 v2.3.0/v2.4.0 规划。
- **新增：Annotations 代码质量审计**（本轮补充）：对 `annotations.js` 进行纯代码维度审计，独立于 Calibre 算法对比，发现 8 项代码质量问题（逻辑重复、常量管理、约束违反、magic number、碎片化解析、监听器泄漏风险、冗余 bind、文档治理），登记为 D-2026-17～24，与 Calibre 对齐项合并纳入 v2.3.0 同批处理。
- **结论**：1.x 系列可正式封版。建议以当前 v1.9.3 为基线启动 2.x 架构演进。

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

**修复版本**：v1.9.3
**修复内容**：`_get/_set/_remove` 统一检查 `chrome.runtime.lastError`，存在则 `reject`。
**验证**：`test/tests.js` F-1 故障注入套件（3 个方法 × 3 种错误场景）。

---

### 3.2 ✅ P2 已修复：`bookMeta` 并发 RMW 覆盖窗口

**修复版本**：v1.9.3
**修复内容**：引入 `_bookMetaQueue: Map<bookId, Promise>`，三路写入（pos/time/speed）串行化。队列在写入完成后自动清理，无内存泄漏。
**验证**：`test/tests.js` F-2 并发写一致性套件。

---

### 3.3 ✅ P2 已修复：`getAllHighlights()` 数据可见性截断

**修复版本**：v1.9.3
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
- Chrome Extension popup 限制已修复（BUG-B 闭环）。

### 4.2 有意推迟至 2.x

- `reader.js` 单文件架构未解耦（P3，设计上确认，不做 1.x 破坏性重构）。
- `unsafe-inline` 未完全移除（image-viewer transform 豁免，计划 v2.2.0）。
- ARIA 语义与键盘可达性未补全（v2.2.0）。
- Annotations 算法深度对齐（v2.3.0/v2.4.0，详见第 9 节）。
- Annotations 代码质量治理（v2.3.0，详见第 10 节）。

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
| v1.9.3 | F-1/F-2/F-3/F-4（P1/P2 全清零，style.* 最终收口）+ BUG-B 修复 | ✅ **完成，1.x 封版** |

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

### v2.3.0 — Annotations 算法深度对齐 + 代码质量专项（预计 5～7 工作日）

详细规划见第 9 节（算法）和第 10 节（代码质量）。摘要：

- [ ] AN-1：`getComputedStyle` 垂直对齐检测，补全 CSS 替代 `<sup>` 的漏判场景（D-2026-11）。
- [ ] AN-2：源节点孤立性检查，补全扁平 `<p>` 单链接误判排除（D-2026-12）。
- [ ] AN-3a：同文档 `compareDocumentPosition` 位置前后判断，作为辅助返回链接信号。
- [ ] AN-4：`_extractContent` 文本长度安全阀 + 空锚点 sibling 遍历截断（D-2026-13）。
- [ ] AN-5：跨文档注释内容 LRU 缓存（容量 50，TTL = book 生命周期）（D-2026-14）。
- [ ] AN-C1：提取 `_hasSup()` 消除重复 sup 查询与语义混淆（D-2026-17）。
- [ ] AN-C2：`_BLOCK_TAGS` 升为模块级 `Set`（D-2026-18）。
- [ ] AN-C3：last-resort 降级路径 inline style 迁移为 CSS class（D-2026-19）。
- [ ] AN-C4：提取 `_PAGINATION_SETTLE_MS` 具名常量（D-2026-20）。
- [ ] AN-C5：提取 `_parseHref()` 统一 href 片段解析（D-2026-21）。
- [ ] AN-C6：`init()` 监听器提取为 `_onKeyDown` 具名绑定（D-2026-22）。
- [ ] AN-C7：`bind` 提取至循环外，Method 4 增加 targetId 早退条件（D-2026-23）。
- [ ] AN-C8：`_isTocList` 阈值与 `_RE` 正则词汇补充来源注释（D-2026-24）。

**验收标准（v2.3.0 整体）**：
- `getComputedStyle` 检测：使用 CSS `vertical-align: super` 替代 `<sup>` 的测试 EPUB 上，注释识别率 ≥ 95%（原为 0%）。
- 孤立性检查：扁平 `<p>` 单链接误判率降至 0（回归测试覆盖 10 种 TOC 变体）。
- 内容安全阀：空锚点场景弹窗不再展示超过 2000 字符的非注释内容；测试套件全部通过。
- 缓存命中：同一尾注文件第二次点击 P90 响应时间 < 15ms（Chrome DevTools 手动验证）。
- AN-C1 重构：`_hasSup(link)` 提取完成，文件内无裸 `closest('sup')` + `querySelector('sup')` 重复组合。
- AN-C2 重构：`_BLOCK_TAGS` 升级为模块级 `Set`，`_extractContent` 内无 `const BLOCK = [...]` 局部数组。
- AN-C3 修复：last-resort 降级路径无 inline style 字符串；`reader.css` 新增 `.annotation-fallback-hint`。
- AN-C5 重构：`showFootnote` 中 href 片段解析统一由 `_parseHref()` 完成，无重复 `split('#')`。
- AN-C7 修复：`this.book.load.bind` 提取至循环外；Method 4 在无 targetId 时提前退出。
- 无回归：现有 `annotations_security.test.js`（v2.2.0）全部通过。

---

### v2.4.0 — Annotations 跨文档拓扑与 FB2 兼容（预计 3～4 工作日）

> v2.3.0 的延伸，处理更复杂的跨文档场景与历史格式兼容。

- [ ] AN-3b：spine index 跨文档位置比对（AN-3 的跨文档延伸）。
- [ ] AN-6：FB2 转换格式兼容（`body[name="notes/comments"] > section` 结构识别）。
- [ ] AN-7：数字标记上限收窄至 3 位，过滤年份误判，白名单保留 `epub:type="noteref"` 覆盖。

**验收标准**：
- FB2 转换书籍（测试集 5 本）注释识别率 ≥ 90%。
- 正文中出现 "1984"、"2023" 等年份数字链接时，误判率 = 0。

---

## 7. 技术债务索引（更新至 v1.9.3 封版 + Annotations 双维度专项）

| 优先级 | ID | 描述 | 目标版本 | 状态 |
|---|---|---|---|---|
| 🟠 P1 | D-2026-01 | `chrome.storage.local` 回调未处理 `lastError` | v1.9.3 | ✅ 已修复 |
| 🟡 P2 | BUG-B | `display:none` 元素 `.click()` 失效（Chrome Extension popup 限制） | v1.9.3 | ✅ 已修复 |
| 🟡 P2 | D-2026-02 | `bookMeta` 并发 RMW 存在丢字段覆盖风险 | v1.9.3 | ✅ 已修复 |
| 🟡 P2 | D-2026-03 | `getAllHighlights()` 仅覆盖 recentBooks（上限 20） | v1.9.3 | ✅ 已修复 |
| 🟡 P2 | D-2026-04 | 运行时 `style.*` 写入分散（home/popup/image-viewer/reader） | v1.9.3 | ✅ 已修复（transform 豁免至 v2.2.0） |
| 🔵 P3 | D-2026-05 | `reader.js` 仍为高耦合核心文件（~1000 行） | v2.0.0 | 📋 已规划 |
| 🔵 P3 | D-2026-06 | `DbGateway.getByFilename()` 无调用路径 | v2.0.0 | 📋 已规划 |
| 🔵 P3 | D-2026-07 | `image-viewer.js` `style.transform` 残余（动态计算值豁免） | v2.2.0 | 📋 已规划 |
| 🔵 P3 | D-2026-08 | ARIA 语义缺失（工具栏/面板/书架卡片） | v2.2.0 | 📋 已规划 |
| 🔵 P3 | D-2026-09 | 阅读速度模型为等权平均，未区分跳读/连续阅读 | v2.1.0 | 📋 已规划 |
| 🔵 P3 | D-2026-10 | locations 生成阻塞主线程（大型书籍 > 500ms） | v2.1.0 | 📋 已规划 |
| 🔵 P3 | D-2026-11 | CSS `vertical-align` 替代 `<sup>` 的注释链接漏判（缺 computedStyle 检测） | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-12 | 孤立性链接（父块唯一内容）缺乏专项排他检查，TOC 变体误判风险 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-13 | `_extractContent` 无文本长度安全阀，空锚点可返回超长内容 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-14 | 跨文档注释无缓存，密集点击场景有可感延迟 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-15 | FB2 转换格式（`body[name="notes"]`）注释容器未识别 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-16 | `noteTextMarker` 支持 4 位数字，年份链接（如"1984"）存在误判风险 | v2.4.0 | 📋 已规划 |
| 🔵 P3 | D-2026-17 | `isBackLink`/`isFootnoteLink` 重复 sup DOM 查询，语义混淆，缺 `_hasSup()` 公共方法 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-18 | `_extractContent` 局部 `BLOCK` 数组每次调用重建，应升为模块级 `Set` | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-19 | `showFootnote` last-resort 降级路径含 inline style 字符串，违反 style.* 约束 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-20 | `_compensatePaginationOffset` 中 100ms 等待为 magic number，无具名常量 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-21 | `showFootnote`/`_loadFromBook`/`_compensatePaginationOffset` href 解析碎片化，edge case 处理不一致 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-22 | `init()` Escape 键监听使用匿名函数永不释放，与 v2.0.0 生命周期接口存在兼容风险 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-23 | `_loadFromBook` Method 4 循环内重复 `.bind()`，无 targetId 时仍进入无效迭代 | v2.3.0 | 📋 已规划 |
| 🔵 P3 | D-2026-24 | `_isTocList` 阈值与 `_RE` 正则词汇无来源注释，后续维护成本高 | v2.3.0 | 📋 已规划 |

---

## 8. 文档联动更新说明

本次审计同步更新（均已执行）：
- `docs/ROADMAP.md`：版本号更新至 v1.9.3，标记 BUG-B 修复，补充 v2.0.0/v2.1.0/v2.2.0 详细规划与验收标准，**新增 v2.3.0/v2.4.0 Annotations 专项规划（算法 + 代码质量双维度）**。
- `docs/architecture.md`：补充 1.x 封版结论、style.* 迁移说明、image-viewer transform 豁免理由、v2.x 架构演进方向。
- `docs/modules.md`：补充 `getAllHighlights` 更新语义、`_bookMetaQueue` 串行化约束、CSS 辅助类控制机制说明，**新增 Annotations 模块接口约束补充**（`_contentCache`、`_parseHref`、`_hasSup` 等新增内部接口）。
- `test/tests.js`：新增 F-1/F-2/F-3/F-4 专项回归套件（v1.9.3），测试头注释更新至 v1.9.3。
- `test/suites/csp_regression.test.js`：新增 C-8～C-11，覆盖 reader.js style.display 消除与辅助类完整性；**v2.3.0 新增 C-12：last-resort 降级 HTML 不含 `style=` 属性**。
- `test/suites/release_checks.test.js`：新增 v1.9.3 收尾完成验证组（F-1/F-2/F-3/F-4/BUG-B 静态断言）。
- `CHANGELOG.md`：v1.9.3 条目补充 reader.js style.* 迁移详情、BUG-B 修复说明与测试更新说明。


---

## 9. Annotations 算法深度审计（新增专项）

> 基于 Calibre E-book Viewer / KOReader 注释识别算法逆向分析报告，与 `annotations.js` v1.9.3 当前实现的系统性对比。

### 9.1 当前实现总体评估

`annotations.js` 当前已实现完整的四阶段识别管线，在设计上与 Calibre 位掩码状态机的核心逻辑高度吻合：

| Calibre 掩码 | 含义 | annotations.js 当前覆盖 |
|---|---|---|
| 0x0004 | epub:type / role 语义信任 | ✅ Stage 1，isFootnoteLink + isBackLink 均覆盖 |
| 0x0008 | FB2 `body[name="notes"]` 兼容 | ❌ 未覆盖（D-2026-15，v2.4.0） |
| 0x0010 | 目标必须含锚点 `#id` | ✅ Stage 0 硬门：无 `#` 的外部文件链接直接拒绝 |
| 0x0020 | 目标须在源节点之后（文档流顺序） | ⚠️ 部分覆盖：同文档靠结构启发式，跨文档缺失（AN-3） |
| 0x0040 | TOC 目标排他 | ✅ `_buildDocContext` 预索引 `tocLinkNodes`，O(1) 排查 |
| 0x0100 | 源节点孤立性（父块唯一内容） | ❌ 未覆盖（D-2026-12，AN-2） |
| 0x0200 | vertical-align 垂直排版特征 | ⚠️ 部分覆盖：检测 `<sup>` 标签，未检测 CSS computedStyle（D-2026-11，AN-1） |
| 0x0400 | 纯数字内容（≤ 3 位上限） | ⚠️ 已覆盖数字匹配，但上限为 4 位而非 3 位（D-2026-16，AN-7） |
| 0x0800 | 字母数字混合（1-2 字母 + 0-2 数字） | ✅ `noteTextMarker` 正则覆盖典型学术角标 |
| 0x1000 | 目标不含 H1-H6 | ✅ Stage 3 目标元素分析：`/^H[1-6]$/` 排除 |
| 0x8000 | 提取文本长度安全阀（≤ 10000 字符） | ❌ `_extractContent` 无长度上限（D-2026-13，AN-4） |

**总体结论**：核心路径覆盖充分，主要短板集中在视觉排版检测（computedStyle）、源节点孤立性、内容提取边界安全和跨文档缓存四个维度。

---

### 9.2 短板一：CSS vertical-align 漏判（AN-1 / D-2026-11）

**现象**：现代电子书出版商常用 `<span class="marker" style="vertical-align: super">` 替代语义化 `<sup>` 标签，实现跨设备精细排版控制。当前 `isFootnoteLink` Stage 3 仅检测 `link.parentElement.tagName === 'SUP'` 和 `link.querySelector('sup')`，无法识别此类 CSS 驱动的上标形式。

**影响范围**：预计影响 15%～30% 的现代商业 EPUB（尤其是从 InDesign 导出的学术出版物）。

**修复方案**（在 `isFootnoteLink` Stage 3 末尾新增）：

```javascript
// Stage 3 末尾追加 — computedStyle 垂直对齐检测
// 仅在前三阶段未能得出结论时触发，保持"廉价信号优先"原则
const win = link.ownerDocument?.defaultView;
if (win) {
  try {
    const cs = win.getComputedStyle(link);
    const va = cs.verticalAlign;
    if (va === 'super' || va === 'sub' || va === 'top' || va === 'bottom') {
      return true;
    }
    // 子节点继承：link 包裹 <span> 且 <span> 为上标
    const firstChild = link.firstElementChild;
    if (firstChild) {
      const csChild = win.getComputedStyle(firstChild);
      if (csChild.verticalAlign === 'super' || csChild.verticalAlign === 'sub') {
        return true;
      }
    }
  } catch (_) {}
}
```

**性能说明**：`getComputedStyle` 为同步调用，触发条件为前三阶段均未命中，实际调用频率极低，不影响整体扫描性能。

---

### 9.3 短板二：源节点孤立性检查缺失（AN-2 / D-2026-12）

**现象**：Calibre 掩码 0x0100 明确要求触发链接"不能是父块的唯一实质性内容"。当前 `_isTocList` 只能识别 `<ol>/<ul>` 容器内的 TOC，无法处理以下形式：

```html
<!-- 扁平目录 / 内联章节跳转 —— 应排除 -->
<p><a href="chapter3.html#start">第三章 暗物质的发现</a></p>
<div><a href="part2.html">Part II</a></div>
```

**修复方案**（在 `isFootnoteLink` Stage 2"Definitive NO"序列末尾追加）：

```javascript
// 孤立性检查：链接文本 > 6 字符 且 构成父块 > 80% 内容 → 非注释
if (text.length > 6) {
  const block = link.closest('p, li, div, td') || link.parentElement;
  if (block) {
    const blockText = block.textContent.trim();
    if (blockText.length > 0 && (text.length / blockText.length) > 0.8) {
      return false;
    }
  }
}
```

**边界说明**：短文本链接（≤ 6 字符）豁免此检查，避免误杀 `<p><a>[1]</a></p>` 形式的注释标记。

---

### 9.4 短板三：`_extractContent` 无边界安全阀（AN-4 / D-2026-13）

**现象**：目标锚点若为空锚（`<a id="note1"></a>`）且无封闭容器，`_extractContent` 会爬升至最近块级祖先并返回其 `innerHTML`，该祖先可能包含数万字后续章节内容。这与 Calibre 掩码 0x8000（10000 字符硬截断）及其 sibling 遍历策略的设计初衷完全一致。

**修复方案**（两步）：

Step A — 在 `_extractContent` 末尾加安全阀：
```javascript
// 安全阀：纯文本超过 2000 字符时截断并追加提示
const MAX_TEXT = 2000;
function _truncateHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  if (tmp.textContent.length <= MAX_TEXT) return html;
  let acc = 0;
  const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    acc += node.textContent.length;
    if (acc > MAX_TEXT) {
      node.textContent = node.textContent.slice(0, node.textContent.length - (acc - MAX_TEXT)) + '…';
      let sib = node.nextSibling;
      while (sib) { const next = sib.nextSibling; sib.remove(); sib = next; }
      break;
    }
  }
  return tmp.innerHTML;
}
```

Step B — 空锚点识别后改用 sibling 遍历：
```javascript
// 在 _extractContent 中，当 el.textContent.trim() === '' 时
// 改为沿 nextSibling 遍历，遇到以下条件停止：
//   - <hr> 分割线
//   - H1-H6 标题标签
//   - 含 id 属性的 <a>（下一注释锚点）
//   - 累计纯文本 > 2000 字符
```

---

### 9.5 短板四：跨文档注释无缓存（AN-5 / D-2026-14）

**现象**：`_loadFromBook` 每次调用均执行完整的四级 spine 解析流程（spine.get → 相对路径解析 → 文件名匹配 → 暴力全扫），对于集中在单一尾注文件（如 `endnotes.xhtml`）的学术书籍，同一注释项被重复 load/unload，有明显延迟。

**修复方案**：在 `Annotations` 对象新增 LRU 内存缓存。

```javascript
_contentCache: null,   // Map<string, {html, href}> — 由 setBook 初始化/清空

setBook(book) {
  this.book = book;
  this._contentCache = new Map();  // book 切换时清空缓存
},

async _loadFromBook(sectionHref, targetId, cancelToken) {
  const key = targetId ? `${sectionHref}#${targetId}` : sectionHref;
  if (this._contentCache?.has(key)) return this._contentCache.get(key);
  const result = await this._loadFromBookUncached(sectionHref, targetId, cancelToken);
  if (result && this._contentCache) {
    // LRU 淘汰：超过 50 条时删除最旧的一条
    if (this._contentCache.size >= 50) {
      this._contentCache.delete(this._contentCache.keys().next().value);
    }
    this._contentCache.set(key, result);
  }
  return result;
},
```

**内存估算**：单条缓存约 2～20KB HTML，50 条上限约 0.1～1MB，对 Chrome 扩展内存预算无压力。

---

### 9.6 短板五：数字上限与年份过滤（AN-7 / D-2026-16，v2.4.0）

**现象**：当前 `noteTextMarker` 允许 1～4 位数字（`\d{1,4}`），导致正文中的 4 位年份链接（如 `<a href="#y1984">1984</a>`）可能误判为注释。Calibre 的 0x0400 掩码明确以 3 位（1～999）为上限。

**修复方案（v2.4.0）**：
1. 将 `noteTextMarker` 中 `\d{1,4}` 收窄为 `\d{1,3}`。
2. 白名单：若同时命中 `epub:type="noteref"` 则允许 4 位数字通过（在 Stage 1 处理，不受正则收窄影响）。
3. 新增回归测试：正文年份链接（1000、1984、2023）不触发注释弹窗。

---

### 9.7 Annotations 模块接口约束补充（新增约束，同步至 modules.md）

```typescript
// 新增内部状态
Annotations._contentCache: Map<string, {html: string, href: string}> | null
// 生命周期：随 setBook() 初始化/清空，容量上限 50（LRU）

// setBook 语义更新（v2.3.0）
Annotations.setBook(book: Book): void
// 同时初始化 _contentCache

// 新增私有方法（v2.3.0）
Annotations._hasSup(link: HTMLElement): boolean
Annotations._isWrappedInSup(link: HTMLElement): boolean  // link 被 <sup> 包裹
Annotations._containsSup(link: HTMLElement): boolean     // link 内含 <sup>
Annotations._parseHref(href: string): { isSameDoc: boolean, sectionHref: string, fragment: string }

// _extractContent 新增约束（v2.3.0）
Annotations._extractContent(el: Element): string
// 纯文本长度 > 2000 字符时执行截断
// 空锚点（textContent === ''）改为 sibling 遍历提取
```

---

### 9.8 测试计划补充

| 测试文件 | 新增套件 | 覆盖场景 |
|---|---|---|
| `test/suites/annotations_recognition.test.js`（新建） | computedStyle 上标检测 | CSS `vertical-align:super` 替代 `<sup>` 的 EPUB 样本 |
| 同上 | 孤立性链接排除 | 10 种扁平 TOC 变体，确保误判率 = 0 |
| `test/suites/annotations_content.test.js`（新建） | 空锚点安全截断 | 空锚点 + 1万字后续内容，确认弹窗 ≤ 2000 字符 |
| 同上 | sibling 遍历终止条件 | `<hr>` / `H2` / 下一注释锚点三类终止场景 |
| `test/suites/annotations_cache.test.js`（新建） | LRU 缓存命中 | 同一 href 连续两次调用，第二次不触发 spine.load |
| 同上 | setBook 缓存清空 | 切换书籍后旧缓存不命中 |
| `test/suites/annotations_security.test.js`（v2.2.0 已规划） | 5 类 DOM 注入路径 | onload / javascript: / data: / srcdoc / `<base>` |

---

## 10. Annotations 代码质量审计（新增专项，v2.3.0）

> 本节为纯代码维度审计，与 Calibre 算法对比无关，聚焦 `annotations.js` 自身存在的逻辑重复、常量管理、API 使用规范和可维护性问题。共发现 8 项，均已登记为 D-2026-17～24，纳入 v2.3.0 一并处理。

---

### 10.1 sup 检测逻辑重复与语义混淆（D-2026-17）

**位置**：`isBackLink` Stage 3（第 271 行）和 `isFootnoteLink` Stage 2/3（第 333 行）

**问题**：两处均独立执行：
```javascript
const hasSup = link.closest('sup') !== null || link.querySelector('sup') !== null;
```

`closest('sup')` 查找链接的**祖先** `<sup>`（链接被 sup 包裹），`querySelector('sup')` 查找链接的**后代** `<sup>`（链接内部含 sup）。两者语义完全不同，却合并在同一个 `hasSup` 变量下，注释不足，维护者容易误解。同时两个函数各执行一次，存在重复 DOM 查询。

**修复方案**：
```javascript
_isWrappedInSup(link) {
  return link.closest('sup') !== null;           // <sup><a>...</a></sup>
},
_containsSup(link) {
  return link.querySelector('sup') !== null;     // <a><sup>...</sup></a>
},
_hasSup(link) {
  return this._isWrappedInSup(link) || this._containsSup(link);
},
```

两个函数中的重复代码替换为 `this._hasSup(link)` 调用，语义在方法名层面明确区分。

---

### 10.2 `_extractContent` 局部 BLOCK 数组（D-2026-18）

**位置**：`_extractContent`（第 479 行）

**问题**：
```javascript
const BLOCK = ['p', 'div', 'li', 'aside', 'section', 'blockquote'];
...
if (BLOCK.includes(t)) break;   // O(n) 线性扫描
```

每次调用重新分配 6 元素数组，`Array.includes` 为 O(n) 扫描。在注释密集书籍的链接扫描和 AN-4 sibling 遍历场景下累积开销可观。

**修复方案**：
```javascript
const _BLOCK_TAGS = Object.freeze(new Set(['p', 'div', 'li', 'aside', 'section', 'blockquote']));

// _extractContent 内改为
if (_BLOCK_TAGS.has(t)) break;
```

同时将 while 循环中的停止条件（`body`、`html`、nodeType === 9）也改为常量集合，提升可读性。

---

### 10.3 `showFootnote` last-resort 路径的 inline style（D-2026-19）

**位置**：`showFootnote`（第 431 行）

**问题**：
```javascript
this._displayContent(
  '<p style="color:var(--text-muted,#888);text-align:center;padding:8px 0;">点击下方链接查看注释内容</p>',
  resolvedHref
);
```

`style` 属性不在 `_displayContent` 的 inline handler 清洗范围内。虽然 `var()` 无安全风险，但违反了项目 v1.9.3 确立的"style.* 全量迁移为 class"约束，且为后续维护者设定不良先例。

**修复方案**：
```javascript
'<p class="annotation-fallback-hint">点击下方链接查看注释内容</p>'

// reader.css 新增
.annotation-fallback-hint {
  color: var(--text-muted, #888);
  text-align: center;
  padding: 8px 0;
}
```

同步在 `csp_regression.test.js` 中新增 C-12 断言：last-resort 降级 HTML 不包含 `style=` 属性。

---

### 10.4 `_compensatePaginationOffset` 中的 magic number（D-2026-20）

**位置**：`_compensatePaginationOffset`（第 658 行）

**问题**：
```javascript
await new Promise(r => setTimeout(r, 100));   // let epub.js finish painting
```

100ms 来自经验判断，但硬编码存在三个问题：低端设备上可能不足；测试中需记忆该值以配置 fake timers；未来调整无法通过文本搜索定位全部依赖点。

**修复方案**：
```javascript
/** epub.js paginated layout settle time (ms). Empirically determined;
 *  increase if pagination offset compensation fails on slow devices. */
const _PAGINATION_SETTLE_MS = 100;

await new Promise(r => setTimeout(r, _PAGINATION_SETTLE_MS));
```

---

### 10.5 href 片段解析碎片化（D-2026-21）

**位置**：`showFootnote`（第 389-407 行）、`_loadFromBook`（第 533-535 行）、`_compensatePaginationOffset`（第 655 行）

**问题**：三处各自独立进行 href 片段解析，`split('#')[1]` 与 `.pop()` 对多个 `#` 的处理行为不一致，存在 edge case 隐患。

**修复方案**：提取纯函数 `_parseHref(href)`：
```javascript
_parseHref(href) {
  if (!href) return { isSameDoc: false, sectionHref: '', fragment: '' };
  const hashIdx = href.indexOf('#');
  if (hashIdx === -1) return { isSameDoc: false, sectionHref: href, fragment: '' };
  if (hashIdx === 0)  return { isSameDoc: true,  sectionHref: '', fragment: href.slice(1) };
  return {
    isSameDoc   : false,
    sectionHref : href.slice(0, hashIdx),
    fragment    : href.slice(hashIdx + 1),
  };
},
```

`showFootnote` 和 `_compensatePaginationOffset` 均调用此函数，消除三处独立解析逻辑及行为不一致。

---

### 10.6 `init()` 全局 Escape 键监听永不释放（D-2026-22）

**位置**：`init()`（第 133 行）

**问题**：
```javascript
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && this.popup.classList.contains('is-visible')) this.close();
});
```

匿名箭头函数无法被 `removeEventListener` 移除。当前 `init()` 只调用一次（设计上正确），但 v2.0.0 R-2 生命周期接口落地后，若 `Annotations` 需支持 `unmount()` 清理，将成为内存泄漏点。

**修复方案**（分两步）：

Step A（v2.3.0）：
```javascript
init() {
  ...
  this._onKeyDown = (e) => {
    if (e.key === 'Escape' && this.popup.classList.contains('is-visible')) this.close();
  };
  document.addEventListener('keydown', this._onKeyDown);
},
```

Step B（v2.0.0 R-2 落地后）：在 `unmount()` 中 `document.removeEventListener('keydown', this._onKeyDown)`。

---

### 10.7 `_loadFromBook` Method 4 循环内重复 `.bind()` 及无效迭代（D-2026-23）

**位置**：`_loadFromBook`（第 577 行）

**问题**：
```javascript
for (let i = 0; i < this.book.spine.length; i++) {
  ...
  const loaded = await s.load(this.book.load.bind(this.book));
  //                                        ^^^^^^^^^^^^^^^^^ 每次迭代重新 bind
```

在 spine 长度为 N 的书籍中创建 N 个 bound 函数。`targetId` 为空时仍进入循环，`_findTarget(loaded, '')` 会立即返回 null，属无效迭代。

**修复方案**：
```javascript
async _loadFromBook(sectionHref, targetId, cancelToken) {
  if (!this.book) return null;
  const bookLoad = this.book.load.bind(this.book);  // 提取到循环外

  // ... Methods 1-3 ...

  // Method 4: brute-force — 仅在有 targetId 时执行
  if (targetId) {
    for (let i = 0; i < this.book.spine.length; i++) {
      if (cancelToken?.cancelled) return null;
      const s = this.book.spine.get(i);
      if (!s) continue;
      try {
        const loaded = await s.load(bookLoad);   // 复用 bound 函数
        ...
      }
    }
  }
}
```

---

### 10.8 `_isTocList` 阈值与 `_RE` 正则词汇无来源注释（D-2026-24）

**位置**：`_isTocList`（第 207-216 行）和 `_RE` 对象（第 50-76 行）

**问题**：`items.length < 3`、`>= 0.6`、`> 10` 三个经验阈值以及各正则词汇（如 `en|n|ref`）均无来源说明，后续维护者无法判断调整影响范围。

**修复方案**（文档治理，无逻辑变更）：

```javascript
_isTocList(listEl) {
  // Threshold rationale:
  //   < 3 items  → likely an author's list or figure caption, not a ToC
  //   > 10 chars → chapter/section titles; footnote markers are always shorter
  //   >= 60%     → empirical threshold from sampling 100 EPUBs; covers
  //                books where some ToC entries have sub-lists with no direct <a>
  const items = listEl.querySelectorAll(':scope > li');
  if (items.length < 3) return false;
  ...
}
```

```javascript
// noteFragPos: fragment id patterns by format
//   fn/ft        — Adobe InDesign EPUB export
//   note/endnote — Pandoc, Asciidoc
//   en           — some academic publishers (Springer, Wiley)
//   n/ref        — Calibre conversion from MOBI/AZW
noteFragPos : /^(fn|ft|note|endnote|footnote|annotation|en|n|ref)\d+/i,
```

---

### 10.9 代码质量问题汇总与优先级

| ID | 类型 | 影响 | 修复代价 | 优先级 |
|---|---|---|---|---|
| D-2026-17 | 逻辑重复 + 语义模糊 | 可维护性、轻微性能 | 低（提取3个方法） | 高 |
| D-2026-18 | 性能微优化 | 密集场景性能 | 极低（改 Set） | 高 |
| D-2026-19 | 约束违反（style.*） | 一致性、先例风险 | 低（加 CSS class） | 高 |
| D-2026-20 | magic number | 可测试性、可维护性 | 极低（加常量） | 中 |
| D-2026-21 | 逻辑碎片化 | 可维护性、edge case 一致性 | 中（提取函数+调用点改写） | 中 |
| D-2026-22 | 监听器泄漏风险 | 与 v2.0.0 R-2 生命周期兼容性 | 低（提取具名函数） | 中 |
| D-2026-23 | 冗余对象创建 + 无效迭代 | 极端 spine 场景性能 | 低（提取 bind + 加条件） | 低 |
| D-2026-24 | 文档治理 | 可维护性 | 极低（加注释） | 低 |

**建议执行顺序**：D-17、18、19 与 AN-1/2/3/4/5 在 v2.3.0 同批实施（改动集中在 `annotations.js` 单文件，测试套件统一补充）。D-20、21、22、23、24 作为同批顺带处理，无需独立迭代。
