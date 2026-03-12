# EPUB Reader — 项目路线图

> 最后更新：2026-03-12（v1.9.3 封版，2.x 规划详细化；补充 Annotations 算法深度优化专项 + 代码质量专项）

---

## 当前状态（1.x 已封版）

- **已完成**：v1.5.0～v1.9.3 的全部既定目标。核心稳定性修复、存储结构重整、CSP 收敛、BUG 系列修复均已完成。
- **v1.9.3 收尾已全部闭环**：
  - [x] F-1：`storage.js` 为 `_get/_set/_remove` 增加 `chrome.runtime.lastError` 处理与错误上抛。
  - [x] F-2：`bookMeta` 写入改为串行队列/CAS 风格，消除 `savePosition/saveReadingTime/saveReadingSpeed` 并发覆盖。
  - [x] F-3：`getAllHighlights()` 增加"storage key 全扫补全"模式，突破 recentBooks 上限约束。
  - [x] F-4：reader.js 全部 `style.display/style.cursor` 等运行时直写迁移为 class 切换（home/popup 在前序版本已完成；image-viewer.js transform 豁免至 v2.2.0）。
  - [x] F-5：补充 F-1/F-2/F-3/F-4 专项回归测试（故障注入 + 并发写 + 数据覆盖 + style.* 静态回归）。
  - [x] BUG-B：修复 `display:none` 元素无法被 `.click()` 触发的 Chrome Extension popup 限制，同步修复 `reader.html` 和 `home.html` 的 `#file-input` 元素。
- **1.x 封版基线**：`style.*` 全量清零（transform 豁免），P1/P2 债务清零，仅 P3 债务纳入 2.x。
- **下一步**：启动 v2.0.0 内核解耦。

---

## 里程碑规划

### v1.9.3 — 1.x 最终扫尾 ✅ 完成

> 原则：只做低风险治理，不做功能扩张，不做大规模文件拆分。

- [x] F-1：`storage.js` 错误上抛（P1 清零）
- [x] F-2：`bookMeta` 串行队列（P2 清零）
- [x] F-3：`getAllHighlights` 全量 key 扫描（P2 清零）
- [x] F-4：reader.js `style.*` 最终迁移（P2 清零，transform 豁免）
- [x] F-5：专项回归测试
- [x] BUG-B：`#file-input` `.click()` 限制修复

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

### v2.3.0 — Annotations 算法深度对齐 + 代码质量专项（计划 5～7 工作日）

> 本版本包含两个并行专项：① 基于 Calibre/KOReader 注释识别算法逆向分析的系统性算法补强；② 对 `annotations.js` 自身代码质量问题的集中治理。两类改动集中在单文件，测试套件统一补充，合并一个迭代处理。

**背景**：当前 `annotations.js` 已实现完整的四阶段识别管线（epub:type 语义 → 类名/片段正则 → 结构 DOM → 目标元素分析），在规范 EPUB3 和 Calibre 生成书籍上表现稳定。通过与 Calibre 位掩码状态机的深度对比，发现以下五类系统性短板，均有明确优化路径。

#### AN-1：computedStyle 垂直对齐检测（对应 Calibre 掩码 0x0200）

**问题**：当前仅检测 `<sup>` 标签和 `parentElement.tagName === 'SUP'`，无法处理出版商使用 CSS 替代 `<sup>` 的情形（如 `<span class="footnote-marker">` + `vertical-align: super`）。这是现代电子书制作的主流工艺，错过率显著。

**方案**：在 `isFootnoteLink` Stage 3 末尾，当 href 通过前三阶段未能得出确定结论时，通过 `link.ownerDocument.defaultView` 调用 `getComputedStyle(link)` 读取 `verticalAlign`，若值为 `super`、`sub`、`top`、`bottom` 则视为强正向信号。同时检测 `link.firstElementChild` 的 computedStyle 以覆盖子节点继承场景。

**约束**：`getComputedStyle` 为同步调用，仍属 O(1)，不影响 per-link 扫描性能；仅在前三阶段未命中时触发，符合现有"廉价信号优先"原则。

#### AN-2：源节点孤立性检查（对应 Calibre 掩码 0x0100）

**问题**：当前对"链接是否为其父块的唯一实质内容"缺乏判断。目录类链接（`<li><a href="#ch3">第三章</a></li>`）与注释引用在文本特征上相似，孤立性检查是关键排他手段，但现有 `_isTocList` 只能覆盖 `<ol>/<ul>` 容器，无法处理扁平 `<p>` 单链接。

**方案**：在 `isFootnoteLink` Stage 2 增加孤立性检查：若链接文本长度 > 6 且链接文本构成父块 `textContent` 的 > 80%，则判定为非注释链接。此条件在当前 `chapterText` 正则过滤之后执行，属加强型 Definitive NO。

#### AN-3：文档流位置相对性（对应 Calibre 掩码 0x0020）

**问题**：当前不分析触发节点与目标节点的文档流前后关系。返回链接的核心拓扑特征是"目标位于源之前"，而现有 `isBackLink` 完全依赖文本/类名/结构启发式，在 Calibre 生成的双向链接图谱中存在误判窗口——尤其是返回链接使用数字标记（如 `<a href="maintext.html#ref2">2</a>`）且无 `<sup>` 的情形（此类已有 Stage 3 覆盖，但跨文档场景无法判断）。

**方案**（渐进式，分两步落地）：

Step A（v2.3.0）：对同文档 href（`href.startsWith('#')`），在 `isFootnoteLink` Stage 3 中用 `compareDocumentPosition` 判断目标节点与当前链接的 DOM 顺序；若目标节点在源节点**之前**，作为弱负向信号（单独不否决，与其他信号综合）。

Step B（v2.4.0）：跨文档场景引入 spine index 比对——若 `sectionHref` 对应的 spine 位置在当前 section 之前，且链接文本是返回类字符，提升 `isBackLink` 判定信心。

#### AN-4：注释内容提取边界安全阀（对应 Calibre 掩码 0x8000 + 内容截断策略）

**问题**：当前 `_extractContent` 无文本长度上限。若目标锚点是空锚 `<a id="note1"></a>` 且其后跟随数万字正文（无闭合容器），`_extractContent` 会返回整个父节点 `innerHTML`，可能导致弹窗渲染大量非注释内容，甚至影响主线程性能。

**方案**：

1. 在 `_extractContent` 末尾，对返回的 `html` 做纯文本提取后检查字符长度，超过阈值（建议 `MAX_FOOTNOTE_TEXT = 2000` 字符）时执行截断并追加省略提示。
2. 对空锚点场景（`el.textContent.trim() === ''`），改为沿 next sibling 遍历收集内容，遇到以下任一条件立即停止：`<hr>` / `H1-H6` / 另一个 `<a>` 含 `id` 属性（下一注释锚点）/ 累计纯文本 > 2000 字符。
3. 新增 `test/suites/annotations_content.test.js` 覆盖空锚点、超长内容、嵌套结构三类场景。

#### AN-5：跨文档注释缓存（对应 Calibre 静态缓存策略）

**问题**：当前 `_loadFromBook` 每次点击都重新执行四级 spine 解析（get → 相对路径 → 文件名匹配 → 暴力扫描），跨文档尾注文件（如 `endnotes.xhtml`）每次点击都会触发 spine load/unload，在注释密集的学术书籍中造成可感知延迟。

**方案**：在 `Annotations` 对象上新增 `_contentCache: Map<href, {html, href}>`，容量上限 50 条（LRU 淘汰），TTL = book 生命周期（`setBook` 时清空）。

```javascript
// 伪代码
async _loadFromBook(sectionHref, targetId, cancelToken) {
  const cacheKey = targetId ? `${sectionHref}#${targetId}` : sectionHref;
  if (this._contentCache.has(cacheKey)) return this._contentCache.get(cacheKey);
  const result = await this._loadFromBookUncached(...);
  if (result) this._lruSet(cacheKey, result);
  return result;
}
```

**收益预期**：尾注文件二次点击响应从 ~200ms 降至 <10ms；对注释密集书籍（每章 20+ 注释）体验改善显著。

#### AN-C1：`isBackLink` / `isFootnoteLink` sup 检测逻辑重复（D-2026-17）

两个函数在 Stage 3 中均独立执行：
```javascript
const hasSup = link.closest('sup') !== null || link.querySelector('sup') !== null;
```
此处存在两个独立问题：一是同一个 `link` 节点会在 `isBackLink` 和 `isFootnoteLink` 中各执行一次完全相同的 DOM 查询（在有大量数字标记的文档中累积开销可观）；二是 `closest('sup')` 查找的是链接的**祖先** sup，而 `querySelector('sup')` 查找的是链接的**后代** sup，两者语义不同却用同一变量名 `hasSup` 合并，缺乏注释区分。

**方案**：提取为 `_isWrappedInSup(link)` / `_containsSup(link)` / `_hasSup(link)` 三个具名私有方法，两处调用点统一替换为 `this._hasSup(link)`，语义在方法名层面明确区分。

#### AN-C2：`_extractContent` 中 BLOCK 数组每次调用重建（D-2026-18）

```javascript
_extractContent(el) {
  const BLOCK = ['p', 'div', 'li', 'aside', 'section', 'blockquote'];
  ...
  if (BLOCK.includes(t)) break;  // Array.includes 线性扫描
```

`BLOCK` 数组在每次 `_extractContent` 调用时重新分配，且 `Array.includes` 为 O(n) 线性扫描。在渲染注释密集的弹窗时调用频繁。

**方案**：将 `BLOCK` 提升为模块级冻结 `Set`（`const _BLOCK_TAGS = Object.freeze(new Set([...]))`），`Set.has` 为 O(1)，同时避免每次调用的数组分配。

#### AN-C3：`_displayContent` 中 inline style 硬编码（D-2026-19）

```javascript
this._displayContent(
  '<p style="color:var(--text-muted,#888);text-align:center;padding:8px 0;">点击下方链接查看注释内容</p>',
  resolvedHref
);
```

`showFootnote` 的 last-resort 降级路径直接拼接带 inline style 的 HTML 字符串，与项目 v1.9.3 确立的"style.* 全量迁移为 class"约束不一致，也绕过了 `_displayContent` 本身的 inline handler 清洗逻辑（虽然 `var()` 无安全风险，但先例危险）。

**方案**：将该 `<p>` 改为使用 CSS class（如 `annotation-fallback-hint`），样式移入 `reader.css`，字符串改为 `<p class="annotation-fallback-hint">点击下方链接查看注释内容</p>`。同步在 `csp_regression.test.js` 新增断言：last-resort 降级 HTML 不包含 `style=` 属性。

#### AN-C4：`_compensatePaginationOffset` 中 magic number `100`（D-2026-20）

```javascript
await new Promise(r => setTimeout(r, 100));   // let epub.js finish painting
```

100ms 等待时间为硬编码 magic number，无具名常量，无法在不同设备性能场景下调整，也不利于测试（测试中需 fake timers）。

**方案**：提取为模块级常量 `const _PAGINATION_SETTLE_MS = 100`，并在函数 JSDoc 中说明该值的来源与调优依据。

#### AN-C5：`showFootnote` 中 href 解析重复三次（D-2026-21）

`showFootnote`、`_loadFromBook`、`_compensatePaginationOffset` 三处各自独立进行 `href` 片段解析，`split('#')[1]` 与 `.pop()` 对多个 `#` 的处理行为不一致，存在 edge case 隐患。

**方案**：提取 `_parseHref(href)` 纯函数，返回 `{ isSameDoc, sectionHref, fragment }`，统一在 `showFootnote` 入口调用一次，结果向下传递，消除三处重复逻辑。

#### AN-C6：`init()` 中 Escape 键监听范围过宽（D-2026-22）

```javascript
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && this.popup.classList.contains('is-visible')) this.close();
});
```

监听挂在全局 `document` 上，且该监听器永不移除（无对应 `removeEventListener`）。若未来 `Annotations` 需要支持 `unmount()` 清理，将产生监听器泄漏。

**方案**（分两步）：v2.3.0 将箭头函数改为具名方法 `this._onKeyDown`，以便将来可精确移除；v2.0.0 R-2 生命周期接口落地后，在 `unmount()` 中统一 `removeEventListener`。

#### AN-C7：`_loadFromBook` 中 Method 4 暴力扫描无 spine 长度上限保护（D-2026-23）

```javascript
// Method 4: brute-force
for (let i = 0; i < this.book.spine.length; i++) {
  ...
  const loaded = await s.load(this.book.load.bind(this.book));
```

`this.book.load.bind(this.book)` 在每次循环迭代中重复 `.bind()` 创建新函数对象，可提取为循环外变量。同时，Method 4 在 `targetId` 为空时仍会进入循环，属于无效迭代。

**方案**：① 在循环外 `const bookLoad = this.book.load.bind(this.book)` 避免重复 bind；② 新增早退条件：`targetId` 为空时直接跳过 Method 4；③ 与 AN-5 缓存协同，已命中缓存时完全不进入该路径。

#### AN-C8：`_isTocList` 阈值与 `_RE` 覆盖范围缺乏注释说明（D-2026-24）

`_isTocList` 使用 `items.length < 3` 和 `>= 0.6` 两个阈值，`_RE.noteCls` / `_RE.noteFragPos` 的正则词汇均为经验积累，但均无参考依据注释，后续维护者难以判断是否可调整。

**方案**：在各处添加行内注释，说明阈值来源（如"< 3 项的列表多为作者标注/图例，非目录"、"0.6 经验阈值来自对 100 本 EPUB 样本的统计"），正则词汇表附上典型来源书籍格式（如 Adobe InDesign 导出、Calibre 转换、Pandoc 等）。属于文档治理项，不涉及逻辑变更。

**验收标准（v2.3.0 整体）**：
- `getComputedStyle` 检测：在使用 CSS `vertical-align: super` 替代 `<sup>` 的测试 EPUB 上，注释识别率 ≥ 95%（原为 0%）。
- 孤立性检查：扁平 `<p>` 单链接误判率降至 0（回归测试覆盖 10 种 TOC 变体）。
- 内容安全阀：空锚点场景弹窗不再展示超过 2000 字符的非注释内容；测试套件全部通过。
- 缓存命中：同一尾注文件第二次点击 P90 响应时间 < 15ms（Chrome DevTools 手动验证）。
- AN-C1 重构：`_hasSup(link)` 提取完成，`annotations.js` 中无裸 `closest('sup')` + `querySelector('sup')` 重复组合。
- AN-C2 重构：`_BLOCK_TAGS` 升级为模块级 `Set`，`_extractContent` 中无 `const BLOCK = [...]` 局部数组。
- AN-C3 修复：last-resort 降级路径无 inline style 字符串；`reader.css` 新增 `.annotation-fallback-hint`。
- AN-C5 重构：`showFootnote` 中 href 片段解析统一由 `_parseHref()` 完成，无重复 `split('#')`。
- AN-C7 修复：`this.book.load.bind` 提取至循环外；Method 4 在无 targetId 时提前退出。
- 无回归：现有 `annotations_security.test.js`（v2.2.0）全部通过。

---

### v2.4.0 — Annotations 跨文档拓扑与 FB2 兼容（计划 3～4 工作日）

> v2.3.0 的延伸，处理更复杂的跨文档场景与历史格式兼容。

- [ ] AN-3b：spine index 跨文档位置比对（AN-3 Step B），提升跨文件返回链接的识别精度。
- [ ] AN-6：FB2 转换格式兼容（对应 Calibre 掩码 0x0008）。目标：识别 `body[name="notes"]` / `body[name="comments"]` 下的 `section` 结构，将其链接视为注释容器高置信度。在 `_buildDocContext` 中扫描此类结构并加入 `footnoteSectionNodes`。
- [ ] AN-7：数字标记上限收窄。当前 `noteTextMarker` 支持 1～4 位数字，Calibre 以 3 位（999）为上限以过滤年份（如 "1984"）。将正则收窄至 1～3 位，并新增白名单：若同时命中 `epub:type="noteref"` 则 4 位数字仍允许通过。

**验收标准**：
- FB2 转换书籍（测试集 5 本）注释识别率 ≥ 90%。
- 正文中出现 "1984"、"2023" 等年份数字链接时，误判率 = 0。

---

## 技术债务索引（滚动）

| 优先级 | ID | 描述 | 目标版本 | 状态 |
|---|---|---|---|---|
| 🟠 P1 | D-2026-01 | `chrome.storage.local` 回调未处理 `lastError` | v1.9.3 | ✅ 已修复 |
| 🟡 P2 | D-2026-02 | `bookMeta` 并发 RMW 存在丢字段覆盖风险 | v1.9.3 | ✅ 已修复 |
| 🟡 P2 | D-2026-03 | `getAllHighlights()` 仅覆盖 recentBooks（上限 20） | v1.9.3 | ✅ 已修复 |
| 🟡 P2 | D-2026-04 | 运行时 `style.*` 写入分散（home/popup/image-viewer/reader） | v1.9.3 | ✅ 已修复（transform 豁免至 v2.2.0） |
| 🟡 P2 | BUG-B | `display:none` 元素 `.click()` 失效（Chrome Extension popup 限制） | v1.9.3 | ✅ 已修复 |
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
