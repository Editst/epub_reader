# 更新日志 (Changelog)

所有该项目中极具标志性的迭代、修复和优化记录都将在此公示。

## [1.3.0] - Phase B 安全加固与排版体验优化 

### 🌟 新特性与优化
- **无网字体优雅降级**：考虑到扩展体积不再内嵌大字重，转而为 Google Fonts CSS 引入了 `&display=swap` 属性，并在全站 CSS 中追加配置了更为科学的原生操作系统字体栈（`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"` 等）。现在哪怕在极端断网环境中加载离线书籍，也将即开即用、杜绝因长时连接网络字体造成的页面空无内容以及加载后的整体排版大面积偏移。
- **重构两栏排版舒适间距**：推翻原本一刀切的 `48px` 中缝设定，针对 `flow: paginated`（分页器模式）智能回归了经典的 `gap: 80`。大幅宽慰了两栏阅读时的中缝留白以及左右视角对齐。

### 🐛 BUG 与安全漏洞修复
- **重大漏洞 - `hl.color` CSS 注入封堵**：对存入 storage 与面板渲染的自定义颜色字面量追加了基于白名单与严格 HEX 色值 Regex 正则的安全卡口过滤。杜绝一切恶意用户通过篡改高亮颜色注入跨端执行攻击。 
- **重大漏洞 - 搜索高亮防 XSS 洗底**：移除了 `search.js` 中直接凭借字符串拼接 `<mark>` 标签再去覆盖 `innerHTML` 这一隐患巨坑；全部使用纯 DOM `textContent` 与 `createElement('mark')` 原生树状结构插入完成安全渲染。
- **高危授权 - 拔除 `unsafe-inline`**：大幅重组了主页面及搜索面板等组件内长期携带的内联 `style="..."` 硬代码至外部类中，现已全面安全合规地修剪掉 `manifest.json` CSP 守卫里的 `unsafe-inline` 松散豁免限制。
- **翻页交互卡死痛点**：拦截 `<input type="range">` 下方进度条的左右按键原生抢占事件，彻底解决聚焦滑块时按下翻页键会因步进跳挡不足卡在当前页面的陈疾，现已强制流转接管至顺滑高效地 `navPrev()` / `navNext()` 系统。

## [1.2.7] - 交互闭环与体验强化 (Phase A)

### 🐛 BUG 修复

- **面板遮罩竞态根治**：`sidebar-overlay` 由 TOC、搜索、书签三个面板共用，此前点击遮罩仅关闭目录（`TOC.close()`），搜索和书签面板在打开时无遮罩、关闭时会相互擦除对方的遮罩。现在 `overlay.click` 统一调用 `closeAllPanels()`；`TOC.close()` / `Search.closePanel()` / `Bookmarks.closePanel()` 关闭前均检查其余面板状态，确保遮罩只在最后一个面板关闭时才消失。
- **书签面板补全 overlay 管理**：`Bookmarks.togglePanel()` 此前不显示遮罩、也不关闭其他面板，导致目录/搜索/书签可以同时打开。现在打开书签时自动关闭其他面板并呈现遮罩，关闭时同步检查其余面板状态。
- **进度条拖动体验优化**：进度条的 `input` 事件此前每个像素变化都触发 `rendition.display()`，高频拖动时 epub.js 连续翻页造成内容区白屏闪烁。修复后 `input` 只更新百分比标签，`change`（松手后）才真正跳转，彻底消除拖动过程中的渲染抖动。
- **封面内存泄漏修复**：书架和弹窗加载书籍封面时调用 `URL.createObjectURL(blob)` 后从未 `revoke`，长时间使用或频繁刷新书架会积累大量孤立的 blob 引用。现在统一在 `img.onload` / `img.onerror`（`{once:true}`）回调中调用 `revokeObjectURL`，DOM 挂载完成后立即释放。
- **布局切换 gap 不一致**：`openBook` 初始化使用 `gap: 80`，`setLayout` 重建使用 `gap: 40`，切换布局后阅读区行宽跳变。两处统一为 `gap: 48`。
- **popup 删除书籍数据不完整**：弹出窗口中"移除"书籍只清理了部分字段（`recent / position / readingTime / file`），遗漏了 `highlights / bookmarks / cover / locations`。现统一调用 `EpubStorage.removeBook()` 完整级联删除，与主书架行为一致。
- **删除死代码 `_originalIndex`**：`home.js` 的标注列表中计算了 `hl._originalIndex` 但从未读取（删除操作早已改用 CFI 匹配），属误导性死代码，已移除。

### 🔒 安全

- **`manifest.json` 权限收敛**：`web_accessible_resources` 的 `matches` 从 `<all_urls>` 收敛至 `chrome-extension://*/*`，第三方网页不再能加载 `epub.min.js` / `jszip.min.js` 等扩展内部库文件。

---

## [1.2.6] - 安全加固与数据可靠性止血 (Phase A)

### 🔴 P0 紧急修复

- **IndexedDB 版本号遗漏修复**：`storage.js` 中 `getLocations()` 和 `removeLocations()` 使用 `indexedDB.open('EpubReaderDB')` 不带版本号，在新用户首次访问时会创建 V1 空数据库（无 `locations` 表），导致阅读进度缓存永远读取失败。两处均补全为 `open('EpubReaderDB', 3)` 并补充 `onupgradeneeded` 建表逻辑，保持与全库其余 6 处一致。
- **XSS 风险修复 (`showLoadError`)**：`reader.js` 的加载失败提示函数将 `err.message` 直接拼入 `innerHTML`，原有转义仅处理 `<` 字符，含 `>`、`"`、`&` 的异常消息（如第三方 EPUB 解析库抛出的错误）可在扩展页面触发 XSS。现改用纯 DOM API（`createElement` + `textContent` + `addEventListener`）构建错误界面，彻底消除注入面。
- **`window mousedown` 监听器累积修复**：`highlights.js` 的 `setBookDetails()` 尾部使用匿名函数注册 `window.addEventListener('mousedown', ...)`，该函数在 `openBook` 和 `setLayout` 时各被调用一次，因匿名函数无法 `removeEventListener`，每次切换布局都会叠加新监听器。N 次切换后每次点击触发 N+1 次 `closePanels()`，状态机混乱。修复方案：将 `window` 和 `btnShowToolbar` 监听器提取为具名函数 `_onWindowMouseDown` / `_onShowToolbarClick`，移入 `init()` 中仅注册一次。

### 🐛 P1 修复

- **阅读时长在关闭标签页时丢失**：计时器每 10 秒保存一次，关闭标签页前最多丢失 9 秒。新增 `document.addEventListener('visibilitychange', ...)` 顶层监听，页面转为 `hidden`（含标签切换、关闭）时立即调用 `saveReadingTime()`，丢失窗口降为 0。
- **popup 删除书籍数据不完整**（见 v1.2.7 完整修复说明，本版已包含）。

---


### 🐛 BUG 修复
- **雷达抢修**：修复了自 v1.2.2 架构合并后被意外移掉的核心识别函数 `isFootnoteLink()`。该丢失此前导致点击脚注时引发后台崩溃，从而使得原生内核接管了行为并引发了错误的页面全屏跳转。现在，精致的脚注悬浮气泡已经重新归位。

## [1.2.4]
### 🛡️ 严重 BUG 解决与护航 (IndexedDB 大一统)
- **版本大一统**：将所有全局模块中负责读取、加载书架的 `indexedDB.open('EpubReaderDB', 2)` 调用统一强制拔升至 `V3` 级别。彻底根除了旧代码低权访问高权表导致的 `VersionError` 闪崩和封面丢失问题 (`storage.js`, `home.js`, `popup.js`, `reader.js`)。
- **架构自愈锁**：在全域代码每一次的 `onupgradeneeded` 触发点中补齐并固定了 `locations` 数据表的建立逻辑，确保新旧用户触发时均能构建完整的底层结构。

## [1.2.3] - 极致稳定与死角扫雷
- **生命周期死区填补**：将时间罗盘排序的 `currentSort` 的 `let` 声明提升至全局域，防备系统抛出暂时性死区导致的首页完全闪崩 (`home.js`)。
- **坐标盲区矫正**：修正了 `notePopup` 悬浮窗弹出的防溢出感知红线（由 `<10px` 骤升至涵盖其身高的 `<200px`），彻底终结了点击处于屏幕极高位置文本时，面板直接向上突破飞出屏幕的消失情况 (`highlights.js`)。
- **降维监听防屏蔽**：针对输入框容易吸入甚至“吞噬”点击事件的情况，将清空触发器从单纯的 `click` 降维改锁至原生的 `mousedown`，只需任意点破空白区瞬间清理残局 (`highlights.js`)。
- **语义级清淤**：剥离去除了对常规脚注具备大规模杀伤误判的正规表达式，让原本合法存在的书内锚点重新通畅运转 (`annotations.js`)。

## [1.2.2] - PDCA 终极架构重构与盲区清扫
- **无底洞存储引擎**：击穿 `localStorage` 仅给定的 2MB 死线阀门，将书籍进度地图 (`Locations`) 彻底重构转移至 `IndexedDB` 引擎。
- **时空排序罗盘**：响应终极体验诉求，主页内嵌入 `Array.prototype.sort` 打散与重组机制，所有零散分布的横跨多书籍笔记均能跟随统一时间轴一键上下颠倒排版。
- **修复幽灵笔记绘制**：强制将笔记创建后的 UI 画布挂载上 `reRenderHighlight` 闭环。哪怕只是加条纯文字的文字评语，幽蓝的虚线即可瞬间呈现。
- **基因融合防断链**：消除冲突的 `isBackLink()` 拷贝函数重灾区，统领全局返回判断。
- **渲染层停火**：剥去霸道的 `style.display="block"` 并全局软着陆到规范层级 `.visible`，断绝面板争抢。

## [1.2.1] - 极致视效与定位修补专项
- **行间悬空防坠**：通过 `GPU translateY` 回拉重新将下划线紧贴高行距中文行文本下方。
- **交互包裹盒隐形**：废弃粗暴选择器，消灭包裹 `rect` 的所有污点虚线边框，坚守透明澄净。
- **顶层实体防撞**：重写面板起跳空间评估模型。

## [1.2.0] - 深度架构重构与体验闭环
- **重器落地**：打下 `Locations` 进度缓存持久化的基础地基，从源头消灭开书与翻书期间出现的“进度条归零 / 剩余耗时抽风”并发症。
- **加盖互斥锁**：赋予全局 `_internalAction` 判断网。
- **核弹级 CSS 清剿**：引入特定的 `svg.epubjs-annotation polyline` 强制压制电子书黑描边，且完全不伤及书本原有插画。
- **无痕检索**：赋予系统动态搜索抹除痕迹的功能，告别黄斑恶化视觉疲劳问题。
- **联屏扫描消光**：针对跨双页视图残存了蓝斑残留实施根卷遍历净化。

## [1.1.x] - 早期建设
- 进行了一系列底层的 UI / UX 试做：包含核心 `Highlights` 批注系统的引入建立，以及各类基础毛玻璃窗口（Glassmorphism）的磨合适配。
