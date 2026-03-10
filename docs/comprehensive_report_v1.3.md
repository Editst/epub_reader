# EPUB Reader 综合改进报告 v1.3
> 基于 v1.2.7 代码全量审计（含 HTML / CSS / JS）编写  
> 日期：2026-03-10 · 版本范围：v1.0 → v1.2.7 已修复 + v1.3.x/v2.x 待办

---

## 目录

1. [项目现状概览](#1-项目现状概览)
2. [已修复问题全记录](#2-已修复问题全记录)
3. [现存问题清单（按优先级）](#3-现存问题清单按优先级)
   - 3.1 P0 — 安全与正确性
   - 3.2 P1 — 稳定性与数据完整性
   - 3.3 P2 — 性能与体验
   - 3.4 P3 — 可维护性与架构债务
4. [HTML / CSS 专项审计新发现](#4-html--css-专项审计新发现)
5. [架构指引与目标分层](#5-架构指引与目标分层)
6. [分阶段落地路线](#6-分阶段落地路线)
7. [执行清单](#7-执行清单)

---

## 1. 项目现状概览

### 1.1 功能完整度
本项目是一款纯本地的 Chrome 扩展 EPUB 阅读器，功能覆盖完整：导入/存储、阅读渲染、进度同步、书签、高亮标注、笔记、全文搜索、脚注弹窗、图片查看、多主题。全部数据离线存储（IndexedDB + chrome.storage.local）。

### 1.2 代码规模
| 文件 | 行数 | 职责 |
|---|---|---|
| `reader/reader.js` | 1180 | 主控制器（上帝对象） |
| `reader/annotations.js` | ~738 | 脚注/注释弹窗 |
| `reader/highlights.js` | ~467 | 高亮与笔记标注 |
| `utils/storage.js` | ~453 | 存储抽象层 |
| `home/home.js` | ~437 | 书架与标注管理页 |
| `reader/reader.css` | 1252 | 阅读器样式 |
| `reader/search.js` | ~250 | 全文搜索 |
| `reader/toc.js / bookmarks.js` | ~200 各 | 目录/书签面板 |

### 1.3 整体评价
- **优势**：功能闭环、零框架、MV3 合规、离线能力完整、中文支持良好。
- **当前风险**：reader.js 上帝对象；CSS 变量系统双轨并行；IndexedDB 多处独立 open；hl.color 等少量字段未严格净化；缺乏可访问性（ARIA）和自动化测试。

---

## 2. 已修复问题全记录

下表汇总 v1.0 → v1.2.7 所有已修复的 Bug 和改进，按代码位置分类。

### 2.1 数据存储层（storage.js）

| ID | 版本 | 描述 |
|---|---|---|
| F-S1 | v1.2.0 | `Locations` 缓存从 `chrome.storage.local`（2 MB 上限）迁移至 IndexedDB，根治大书进度归零 |
| F-S2 | v1.2.2 | IndexedDB schema 升级至 V3，补全 `locations` store 建立逻辑 |
| F-S3 | v1.2.4 | 全库所有 `indexedDB.open('EpubReaderDB')` 统一升版至 V3，消除 `VersionError` |
| F-S4 | v1.2.6 | `getLocations()` / `removeLocations()` 补版本号（之前不带版本号，新用户首次访问产生空 V1 库） |
| F-S5 | v1.2.2 | `removePosition()` 修复 key 不一致（之前删除 `pos_${bookId}` 而实际存储为嵌套对象） |
| F-S6 | v1.2.7 | `removeBook()` 级联删除补全 highlights/bookmarks/cover/locations |

### 2.2 阅读器主控制器（reader.js）

| ID | 版本 | 描述 |
|---|---|---|
| F-R1 | v1.2.0 | `progressSlider` 在 locations 未就绪时崩溃，补充 `book.locations.length()` 守卫 |
| F-R2 | v1.2.2 | `closeAllPanels()` 由 `style.display='none'` 改为 `classList.remove('visible')`，消除 overlay 僵死 |
| F-R3 | v1.2.5 | `setLayout()` 末尾补绑 Search / Highlights 模块（原遗漏导致重排版后标注失效） |
| F-R4 | v1.2.6 | `showLoadError()` 全面改为 DOM API（`textContent` + `createElement`），消除 XSS |
| F-R5 | v1.2.6 | `visibilitychange` 顶层监听，Tab 关闭/切换时立即 flush 阅读计时 |
| F-R6 | v1.2.7 | 进度条 `input`/`change` 事件分离，松手后才触发 `rendition.display()`，消除拖动白屏 |
| F-R7 | v1.2.7 | `gap` 值 `openBook`(80) 与 `setLayout`(40) 不一致导致布局切换跳变 → 统一为 48 |

### 2.3 标注系统（highlights.js）

| ID | 版本 | 描述 |
|---|---|---|
| F-H1 | v1.1.x | 纯笔记无法保存 |
| F-H2 | v1.2.0 | `_internalAction` 同步锁，防止点击空白区后面板残留 |
| F-H3 | v1.2.0 | `notePopup` 顶部碰撞检测初版（`top < 10px` 翻转）|
| F-H4 | v1.2.1 | 碰撞阈值扩大到 200px，修复顶部文本弹窗溢界 |
| F-H5 | v1.2.2 | `setBookDetails` 尾部追加 `reRenderHighlight`，消除纯笔记不显示虚线 |
| F-H6 | v1.2.3 | `mousedown` 替代 `click` 作为清理触发，防止输入框吞噬事件 |
| F-H7 | v1.2.6 | `window.addEventListener('mousedown', ...)` 匿名函数累积 → 提取为具名函数 `_onWindowMouseDown`，移入 `init()` 仅注册一次 |

### 2.4 注释/脚注系统（annotations.js）

| ID | 版本 | 描述 |
|---|---|---|
| F-A1 | v1.2.2 | 双重 `isBackLink()` 声明冲突剔除，合并为统一实现 |
| F-A2 | v1.2.3 | 移除泛滥正则 `/^#(fnref|noteref...)/`，仅保留反向回溯判断 |
| F-A3 | v1.2.5 | 重建 `isFootnoteLink()`（v1.2.2 合并时误删），恢复脚注弹窗功能 |

### 2.5 面板交互系统（toc.js / search.js / bookmarks.js）

| ID | 版本 | 描述 |
|---|---|---|
| F-P1 | v1.2.7 | `sidebar-overlay` 竞态根治：`overlay.click` 改调 `closeAllPanels()`；各面板 `close()` 检查其余面板状态再决定是否移除 overlay |
| F-P2 | v1.2.7 | `Bookmarks.togglePanel()` 补全 overlay 管理，打开时关闭其他面板 |

### 2.6 书架/弹窗（home.js / popup.js）

| ID | 版本 | 描述 |
|---|---|---|
| F-M1 | v1.2.7 | 封面 `ObjectURL` 泄漏修复：`img.onload/onerror {once:true}` 后立即 `revokeObjectURL` |
| F-M2 | v1.2.7 | 删除 `hl._originalIndex` 死代码，`for-index` 改 `for-of` |
| F-M3 | v1.2.7 | `popup` 删除书籍改用 `removeBook()` 完整级联，之前遗漏 highlights/locations/cover |
| F-M4 | v1.2.2 | 时间双向罗盘：跨书全局标注按时间正/降序排列 |

### 2.7 样式层（reader.css）

| ID | 版本 | 描述 |
|---|---|---|
| F-C1 | v1.2.0 | 精准 CSS 选择器 `svg.epubjs-annotation polyline` 清除默认描边，不伤书籍原生 SVG |
| F-C2 | v1.2.1 | `translateY(-4px)` 回拉注释 SVG，修复大行距文字脱离下划线 |
| F-C3 | v1.2.1 | `rect` 保持透明，精准选择器消除交互框虚线边框污染 |
| F-C4 | v1.2.x | `settings-panel` / `bookmarks-panel` z-index 修复（150 → 200），确保面板在 overlay 上方 |

### 2.8 安全（manifest.json）

| ID | 版本 | 描述 |
|---|---|---|
| F-SEC1 | v1.2.7 | `web_accessible_resources.matches` 从 `<all_urls>` 收窄至 `chrome-extension://*/*` |

---

## 3. 现存问题清单（按优先级）

### 3.1 P0 — 安全与正确性（必须修复）

#### P0-NEW-1：`hl.color` 未净化直接插入 `style` 属性 [home.js]
**文件**：`home/home.js` 第 314、318 行  
**描述**：标注颜色 `hl.color` 来自 `chrome.storage.local`，写入时来源于 `data-color` 按钮属性（仅有 `#hex`），但读取时未做格式验证，直接插入 `innerHTML` 模板的 `style` 属性：
```js
style="background-color: ${hl.color}33; color: ${hl.color};"
style="border-left-color: ${hl.color}"
```
如果存储被篡改（例如 XSS 写入 storage 后二次渲染），`hl.color` 包含 `); expression(` 等 CSS 注入载荷可在 Chrome 扩展页面上下文执行。  
**修复**：写入前用正则验证 `color` 为合法 CSS 颜色值（`/^#[0-9a-fA-F]{3,8}$|^transparent$/`）；读取时同样验证，不合法时回退为默认颜色。

#### P0-NEW-2：`annotations.js` 脚注 HTML 直接注入 popup body [annotations.js]
**文件**：`reader/annotations.js` 第 605 行  
**描述**：`_displayContent()` 将从 EPUB 内部文档提取的原始 HTML（`_extractContent` 返回 `innerHTML` 或 `XMLSerializer` 序列化结果）直接设置到 `this.body.innerHTML`。EPUB 文件中可能包含恶意构造的 HTML，在扩展页面（`chrome-extension://`）上下文中渲染，尽管 CSP 设有 `script-src 'self'`，但内联事件处理器（`onclick` 等属性）仍可能被注入。  
**修复**：在注入前过滤事件属性（`on*`）和 `javascript:` 协议链接，或使用 `DOMParser` 解析后提取纯结构，或引入轻量 sanitizer（如 `DOMPurify`，本项目可内嵌一个轻量版本）。

#### P0-NEW-3：`search.js` 搜索关键词 regex 替换后 `innerHTML` [search.js]
**文件**：`reader/search.js` 第 236 行  
**描述**：虽然 `excerpt` 已经过 `escapeHtml()`，搜索关键词 `query` 也做了正则转义和 HTML 转义，但整个替换链（`escapeHtml` → 正则转义 → regex replace → innerHTML`）存在边缘情况：`&lt;` 等 HTML 实体在 `escapeHtml` 转义后再经过 `replace` 回写到 `innerHTML`，若 HTML 实体的结果字符串结构特殊可能产生双重解码。  
**修复**：改为 DOM 操作：先 `createTextNode` 插入 excerpt，再通过 `TreeWalker` 或范围 API 在文本节点中高亮关键词（替换为 `<mark>` 元素），避免字符串 → HTML 的直接路径。

---

### 3.2 P1 — 稳定性与数据完整性（重要）

#### P1-NEW-1：BookId 32位 djb2 哈希碰撞风险
**文件**：`utils/storage.js` 第 324 行  
**描述**：`generateBookId(filename, size)` 使用 `filename:size` 字符串计算 32 位 djb2 哈希。对于同一书籍的不同版本（同名但内容不同），仅靠文件名和大小无法区分（如两本同名书大小相差 1 字节但内容完全不同，哈希值几乎相同）。碰撞会导致进度、标注、封面、locations 数据跨书错绑。  
**修复**：Phase D 升级为内容指纹（Web Crypto API 的 `SubtleCrypto.digest('SHA-256', firstChunk)`，对文件前 64KB 计算 SHA-256），同时维护 `legacyId → contentId` 映射实现平滑迁移。

#### P1-NEW-2：IndexedDB 12 处独立 open，连接不复用
**文件**：`utils/storage.js`（7 处）、`reader/reader.js`（3 处：`storeFileInIndexedDB`、`loadFileFromIndexedDB` 以及 `openBook` 间接）  
**描述**：每个 storage 函数独立调用 `indexedDB.open()`，每次调用都会触发连接协商（版本检查 + `onupgradeneeded`）。高频操作（翻页保存位置、存储 locations、写入封面）会产生多次冗余连接开销，且 `onupgradeneeded` 分散在 4 个文件，将来 schema 升级需要同步修改所有处。  
**修复**：抽取 `infra/db-gateway.js`，单例管理连接（`Promise<IDBDatabase>` 缓存），所有 IndexedDB 操作通过网关访问，schema 定义集中在一处。

#### P1-NEW-3：`setupRenditionKeyEvents` 每章节注册 wheel 监听但不清理
**文件**：`reader/reader.js` 第 810-837 行  
**描述**：`hooks.content.register` 的回调在每次章节加载（包括翻页）时执行，其中 `doc.addEventListener('wheel', ...)` 在每个章节 iframe 文档上注册事件。虽然 epub.js 销毁 iframe 时会自动移除 DOM 监听器，但若某些 iframe 被复用（epub.js 的 continuous manager），监听器可能累积。  
**修复**：在注册前检查是否已注册（通过标记属性），或使用 `{once: false}` 配合 AbortController 统一清理。

#### P1-NEW-4：`storeFileInIndexedDB` 三处独立实现
**文件**：`reader/reader.js`（`storeFileInIndexedDB`）、`loadFileFromIndexedDB`、`storage.js`（`removeFileFromIndexedDB`）  
**描述**：三处各自实现 `indexedDB.open` + schema 建立 + 操作的完整逻辑，不仅代码重复，且若 schema 变更（新增 store），三处必须同步修改，遗漏即产生生产 Bug（v1.2.4 已发生过一次类似问题）。  
**修复**：统一迁移至 `db-gateway.js`（见 P1-NEW-2）。

#### P1-NEW-5：`service-worker.js` 中的 `onClicked` 监听器永远不触发
**文件**：`background/service-worker.js` 第 11-15 行  
**描述**：`manifest.json` 的 `action` 配置了 `default_popup`，当扩展有 popup 时，点击图标打开 popup，`chrome.action.onClicked` 事件**不会触发**（MV3 规范：有 popup 则 onClicked 不触发）。这段代码是无效死代码，可能误导后续开发者认为两个入口同时生效。  
**修复**：删除 `onClicked` 监听器；或若希望保留直接打开阅读器的能力，移除 `default_popup` 并通过 popup 页面的按钮跳转。

#### P1-NEW-6：滚动布局下 wheel 事件被主动拦截
**文件**：`reader/reader.js` 第 100-108 行  
**描述**：`reader-main` 元素上注册了 `wheel` 监听器并调用 `e.preventDefault()`（`{passive: false}`），强制将滚轮翻页到下一章节。在**滚动布局**（`flow: scrolled-doc`）下，这会阻止正常的页内滚动，使滚动布局实际上无法使用滚轮浏览书籍内容。  
**修复**：`wheel` 事件处理前检查当前 `prefs.layout`，滚动布局下不拦截 wheel 事件（让浏览器默认滚动），仅分页布局下拦截并翻页。

---

### 3.3 P2 — 性能与体验（持续改进）

#### P2-NEW-1：自定义主题（custom）CSS 变量在 themes.css 中无定义
**文件**：`styles/themes.css`  
**描述**：`themes.css` 定义了 `light`、`dark`、`sepia`、`green` 四个主题的 CSS 变量，但没有 `[data-theme="custom"]` 块。用户选择自定义主题时，`applyThemeToRendition('custom')` 只调用 `rendition.themes.override()`，并不改变 `document.documentElement` 的 CSS 变量。工具栏、侧边栏等 UI 区域仍使用前一个主题的变量，导致 UI 主题与阅读内容背景色不一致（例如切换到深色自定义背景后，工具栏仍为浅色）。  
**修复**：在 themes.css 中补充 `[data-theme="custom"]` 块，初始值等同于 `light`；`setTheme('custom')` 时额外监听 `customBgColor`/`customTextColor` 的变化动态更新 CSS 变量。

#### P2-NEW-2：ETA 估算模型跨书偏差大
**文件**：`reader/reader.js` 第 926-934 行  
**描述**：阅读速度完全基于当前书籍的 `activeReadingSeconds / progress` 计算，新书打开、早期进度极低时（`progress < 0.005`）降级为静态估算（400字/分钟）。不同书籍文字密度差异巨大（如图文书 vs 纯文字），静态估算偏差可达 5-10 倍。  
**修复**：为用户建立跨书阅读速度基准（如存储历史 `totalChars / totalMinutes`），新书启动时使用历史均值代替 400 字/分钟的硬编码。

#### P2-NEW-3：`home.css` 与 `themes.css` CSS 变量双轨并行，同名值不同
**文件**：`home/home.css`、`styles/themes.css`  
**描述**：两个文件均定义了 `--text-primary`、`--text-secondary`、`--border-color`，但数值不同（例如 `home.css` 中 `--text-primary: #1e293b` vs `themes.css` 中 `--text-primary: #1c1917`）。由于 `home.html` 同时加载两者，后加载的 `home.css` 覆盖 `themes.css` 的同名变量，导致主题切换在书架页效果不完整（切换到 sepia/green 主题后颜色只部分生效）。  
**修复**：将 `home.css` 中的变量名重命名为 `home.css` 私有命名空间（如 `--home-text-primary`），或统一迁移到 `themes.css` 中的对应主题块，消除双轨。

#### P2-NEW-4：全量 DOM 重建代替增量更新
**文件**：`home/home.js`、`reader/search.js`、`reader/bookmarks.js`  
**描述**：书架重绘（`loadBooks()`）、标注列表重绘（`loadAnnotations()`）、搜索结果更新均使用 `container.innerHTML = ''` + 全量重建 DOM。书架有 20+ 本书时，每次进入页面或筛选都会触发完整的异步封面加载流程，产生可感知的闪烁。  
**修复**：实现列表的增量更新（对比 DOM key 和数据 key 的差异）；大列表（搜索结果、标注列表）采用虚拟列表或分页渲染。

#### P2-NEW-5：Google Fonts 远程加载依赖网络，离线降级不完整
**文件**：`reader/reader.html`、`home/home.html` 第 7 行  
**描述**：两个页面均从 `https://fonts.googleapis.com` 加载 Inter 字体。虽然 `manifest.json` CSP 允许了该域，但离线环境或网络较差时字体加载失败，UI 回退到系统字体（字重、字距差异明显，会导致布局偏移）。此外，每次打开扩展页面都会向 Google 发起请求，不符合"本地优先"的设计理念。  
**修复**：将 Inter 字体文件内嵌至 `fonts/` 目录，使用 `@font-face` 本地引用；或使用 CSS `font-display: swap` + 本地系统字体完整 fallback stack，确保在 Inter 加载前布局不崩溃。

#### P2-NEW-6：`reader.html` 中 24 处 `style=""` 内联样式影响 CSP 可维护性
**文件**：`reader/reader.html`  
**描述**：settings panel 内的 `custom-theme-options`、颜色选择器等使用大量内联 `style`（共 24 处），`manifest.json` 为此在 CSP 的 `style-src` 中加入了 `'unsafe-inline'`。`'unsafe-inline'` 允许任何注入的内联样式执行，降低了防御层级。  
**修复**：将内联样式提取为 CSS 类，移除 CSP 中的 `'unsafe-inline'`；或对必须内联的场景使用 `nonce` 机制。

#### P2-NEW-7：`highlight.color` 在 `home.js` 中未做格式验证
（见 P0-NEW-1 安全分析）作为 P2 补充：除安全外，非法颜色值会导致 CSS 解析失败，使整个标注项样式完全失效（无颜色、无边框）。

#### P2-NEW-8：设置面板无字间距（`letter-spacing`）控制，但存储结构已有 `letterSpacing` 字段
**文件**：`reader/reader.html`、`reader/reader.js`  
**描述**：`EpubStorage.getPreferences()` 默认返回 `letterSpacing: 0`，说明该字段已被设计为可配置项，但 reader.html 设置面板缺少对应的字间距滑块，用户无法调整。`generateCustomCss()` 也未注入 `letter-spacing` CSS 属性。  
**修复**：在设置面板新增字间距滑块（`-0.05em` ~ `0.2em`），在 `generateCustomCss()` 中补充注入 `letter-spacing`。

---

### 3.4 P3 — 可维护性与架构债务

#### P3-1：`reader.js` 上帝对象（1180 行，7 种职责）
单文件混合：渲染控制、导航、UI 事件、存储、主题、统计、并发防抖。任何改动均需全量理解整个文件，回归测试成本极高。  
**目标架构**：见第 5 节。

#### P3-2：模块间直接调用，无统一生命周期协议
TOC / Search / Bookmarks / Highlights / Annotations / ImageViewer 由 reader.js 直接调用，无标准的 `mount()` / `unmount()` / `dispose()` 接口。切书时的清理顺序依赖隐式约定，容易引入时序 Bug。

#### P3-3：HTML 中缺乏可访问性支持（ARIA）
两个 HTML 文件（`reader.html`、`home.html`）无任何 `aria-*` 属性或 `role=` 标注（grep 结果为 0）。模态弹窗、面板切换、进度条均缺少语义标记，不满足 WCAG 2.1 AA 基本要求。

#### P3-4：缺乏自动化回归测试
整个项目无测试文件。上下依赖复杂的模块（annotations.js、highlights.js）无法在修改后快速验证是否引入回归。

#### P3-5：错误可观测性不足
大量 `catch` 块 `console.warn + resolve` 吞错，用户层无任何提示与重试机制。IndexedDB 写入失败、epub.js 解析错误均无用户可感知的反馈。

#### P3-6：LRU 清理后书架不标记"需重导入"
当 `enforceFileLRU` 清理旧文件后，书架仍展示该书，用户点击后才发现需要重新导入，体验断层。

#### P3-7：`dragover` 产生的 overlay DOM 不受 React/框架管理
`setupDragAndDrop()` 通过 `document.createElement` 动态创建并 `appendChild` 拖放 overlay，没有对应的清理路径（`dragend` 未覆盖所有场景）。快速多次拖入可能产生多个 overlay 叠加。

---

## 4. HTML / CSS 专项审计新发现

### 4.1 reader.html — 混合控制方式
`loading-overlay`、`annotation-overlay`、`annotation-popup`、`image-viewer` 均使用 `style="display:none;"` 硬编码初始隐藏，但同类的 `sidebar-overlay` 使用 CSS class（`.visible`）控制，侧边栏用 `.open`。同一个页面存在三种 display 控制模式：`style.display`、`classList`、`class`。  
**建议**：统一使用 CSS 类控制显示/隐藏，移除 HTML 中的内联 `display:none`，消除歧义。

### 4.2 reader.css — `selection-toolbar` 的 `position: absolute` 跟随难题
选择工具栏用 `position: absolute` + `transform: translate(-50%, -100%)`，定位锚点为 `top`/`left` 通过 JS 动态设置（相对于扩展页面坐标），而 EPUB 内容在 iframe 内。当 iframe 缩放或多栏布局时，坐标系不完全匹配，工具栏可能偏移。  
**建议**：长期考虑在 iframe 内部注入选择工具栏 DOM（在 iframe 坐标系内定位），而非依赖跨 iframe 坐标转换。

### 4.3 themes.css — 缺失 `custom` 主题块
见 P2-NEW-1 详述。`themes.css` 定义了 `light/dark/sepia/green` 四个主题块，但代码中存在 `data-theme="custom"` 的使用，缺少对应的 CSS 变量定义。

### 4.4 home.css — 双重变量系统覆盖 themes.css
见 P2-NEW-3 详述。`home.css` 在自身 `:root` 和 `[data-theme]` 块中重新定义了与 `themes.css` 同名但值不同的变量（`--text-primary`、`--text-secondary`、`--border-color`），由于 `home.html` 中 `home.css` 后加载，会覆盖 `themes.css` 中 sepia/green 主题的同名变量，导致书架页主题切换不完整。

### 4.5 popup.html — CSS 完全内联
`popup.html` 的全部样式通过 `<style>` 内嵌，而非独立 CSS 文件。样式与 markup 耦合，无法与其他页面共享变量，且因 `'unsafe-inline'` 在 CSP 中的影响，长期将限制 CSP 收紧的可能性。

### 4.6 home.html / reader.html — `<script>` 无版本号 cache-busting 不一致
`reader.html` 的脚本使用 `?v=5`（如 `storage.js?v=5`），但 `home.html` 和 `popup.html` 无版本号。更新后旧版本 `home.js`/`storage.js` 可能仍被缓存，导致 home 页与 reader 页行为不一致。  
**建议**：统一三个页面的 cache-busting 策略（版本号同步或使用 Service Worker 管理缓存）。

### 4.7 reader.html — 缺少 `<meta name="color-scheme">` 声明
扩展页面缺少 `<meta name="color-scheme" content="light dark">` 声明，在系统深色模式下浏览器可能对某些原生控件（如 `<input type="range">`、`<select>`）应用系统深色样式，与扩展自定义主题冲突，导致控件颜色与 UI 主题不协调。

---

## 5. 架构指引与目标分层

### 5.1 目标模块分层（reader.js 拆分）

```
reader/
├── core/
│   ├── reader-runtime.js     # Book/Rendition 创建、销毁、epub.js 生命周期
│   ├── reader-state.js       # 单一状态源（currentBook、location、prefs、统计）
│   ├── reader-ui.js          # DOM 绑定与工具栏交互（不直接访问存储）
│   └── reader-persistence.js # 位置/时长/偏好写入策略（含节流、写队列）
├── modules/
│   ├── toc.js               ← 现有，补充 mount/unmount 接口
│   ├── search.js            ← 现有，补充 AbortController 取消
│   ├── bookmarks.js         ← 现有，补充 mount/unmount
│   ├── highlights.js        ← 现有，提取 context hook 生命周期
│   ├── annotations.js       ← 现有，补充 sanitizer
│   └── image-viewer.js      ← 现有
└── infra/
    └── db-gateway.js         # 新建，IndexedDB 单例连接 + 事务模板
```

### 5.2 模块标准接口
```js
// 每个模块实现以下接口
{
  init(),                    // 注册 DOM 监听器（只调用一次）
  mount(context),            // 绑定到当前 book/rendition（切书时调用）
  unmount(),                 // 解绑、清理状态（切书时调用）
  reset(),                   // 重置 UI 到初始状态（已实现的保留）
}
```

### 5.3 IndexedDB 网关设计
```js
// infra/db-gateway.js
const DbGateway = {
  _db: null,
  async connect() { /* 单例，版本 V3，集中 schema */ },
  async get(storeName, key) { /* 统一错误处理 */ },
  async put(storeName, record) { /* 写队列节流 */ },
  async delete(storeName, key) { },
  async getAll(storeName) { },
};
```

### 5.4 安全加固路线
1. 所有 `innerHTML` 赋值必须经过内容安全管线：**外部来源**（EPUB 内部 HTML）→ sanitize → 注入；**内部来源**（用户输入/存储读取）→ `escapeHtml` 或 `textContent`；**常量模板**→ 代码审查确保无变量拼接。
2. `hl.color` 写入时强制验证为合法 CSS 颜色字符串。
3. 移除 CSP 中的 `'unsafe-inline'`，改为将内联样式提取为 CSS 类。
4. 长期：BookId 升级为 SHA-256 内容指纹。

### 5.5 可观测性最小埋点
```
reader_first_display_ms       — T0(fileSelect) → T1(firstDisplay)
locations_generate_ms         — locations 生成耗时
search_total_ms               — 全文搜索完整耗时
nav_to_relocated_ms           — 翻页到 relocated 事件的响应延迟
idb_write_queue_depth         — IndexedDB 待写队列深度
active_listener_count         — 模块监听器存活数（调试用）
```

---

## 6. 分阶段落地路线

### Phase A — 止血（已完成于 v1.2.6/v1.2.7）✅
- P0：XSS 修复（showLoadError DOM API）
- P0：IndexedDB 版本号遗漏
- P0：window mousedown 监听器累积
- P1：visibilitychange 阅读时长
- P1：overlay 竞态、popup 级联删除
- P2：进度条拖动节流、gap 统一、Blob 泄漏

### Phase B — 安全加固（v1.3.x 目标）
优先级：**P0-NEW-1 / P0-NEW-2 / P0-NEW-3**
- `hl.color` 写入验证（正则白名单）
- annotations.js 脚注 HTML 注入防护（inline event 过滤）
- search.js 改用 DOM 操作渲染高亮结果
- CSP 移除 `'unsafe-inline'`（需先清理所有内联 style）
- Google Fonts 内嵌，实现真正离线

### Phase C — 稳定性重构（v1.4.x / v2.0 准备）
优先级：**P1-NEW-2 / P1-NEW-4 / P1-NEW-5**
- 抽取 `infra/db-gateway.js`（单例连接 + 集中 schema）
- 删除 service-worker.js 中永远不触发的 `onClicked`
- 修复滚动布局下 wheel 事件拦截问题（P1-NEW-6）
- 模块标准化接口 `mount/unmount/reset`
- 写队列节流（位置 + 时长）
- BookId 升级为 SHA-256（内容指纹 + legacyId 迁移）

### Phase D — 架构演进（v2.x）
- `reader.js` 按 `reader-runtime / reader-state / reader-ui / reader-persistence` 拆分
- CSS 变量统一（home.css 与 themes.css 合并）
- 补充 custom 主题 CSS 变量块
- 完善 ARIA 可访问性支持
- 自动化回归矩阵（切书/搜索/resize/删除一致性）
- 性能埋点与预算守护

---

## 7. 执行清单

> ✅ = 已完成 | 🔴 = P0 待修复 | 🟠 = P1 待修复 | 🔵 = P2/P3 待修复

### 安全
- ✅ `showLoadError` XSS 修复（DOM API）— v1.2.6
- ✅ manifest.json 权限收窄 — v1.2.7
- 🔴 `hl.color` 未净化插入 style 属性 — home.js
- 🔴 annotations.js 脚注 HTML 直接 innerHTML — annotations.js
- 🔴 search.js 搜索高亮改用 DOM 操作 — search.js
- 🔵 CSP 移除 `'unsafe-inline'`，提取内联 style

### 数据与存储
- ✅ storage.js IndexedDB 版本号修复 — v1.2.6
- ✅ removeBook() 级联删除补全 — v1.2.7
- 🟠 IndexedDB 12 处独立 open → db-gateway.js 单例
- 🟠 storeFileInIndexedDB 三处独立实现 → 合并到 gateway
- 🟠 BookId djb2 碰撞风险 → SHA-256 内容指纹

### 功能与稳定性
- ✅ overlay 竞态根治 — v1.2.7
- ✅ visibilitychange 阅读时长 — v1.2.6
- ✅ 进度条拖动节流 — v1.2.7
- ✅ 封面 ObjectURL 泄漏 — v1.2.7
- 🟠 滚动布局下 wheel 事件拦截（阻止页内滚动）
- 🟠 service-worker.js onClicked 死代码删除
- 🟠 LRU 清理后书架标记"需重导入"

### 性能与体验
- 🔵 custom 主题 CSS 变量块缺失 — themes.css
- 🔵 home.css 与 themes.css 变量双轨 → 统一命名空间
- 🔵 ETA 估算使用跨书历史速度（替代 400 字/分钟硬编码）
- 🔵 字间距控件补充（UI + CSS 注入）
- 🔵 Google Fonts 内嵌（离线优先）
- 🔵 cache-busting 版本号统一（home.html/popup.html 补 ?v=N）
- 🔵 全量重建改增量更新（书架、标注列表、搜索结果）

### 架构与可维护性
- 🔵 reader.js 上帝对象 → 四层分拆
- 🔵 模块标准接口 mount/unmount/dispose
- 🔵 ARIA 可访问性（面板、弹窗、进度条、按钮）
- 🔵 `<meta name="color-scheme">` 声明补充
- 🔵 popup.html CSS 外联化
- 🔵 display 控制统一为 CSS class
- 🔵 自动化回归矩阵

---

*本报告基于 v1.2.7 代码全量人工审计生成，覆盖全部 JS / HTML / CSS / manifest 文件。*  
*下次更新建议在 Phase B 安全加固完成后（预计 v1.3.x）重新复审安全相关章节。*
