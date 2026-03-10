# v1.1.1 修复任务

## A 类：高亮浮窗 UI
- [x] Issue 1: 浮窗不透明背景 + 毛玻璃 (`reader.css`)
- [x] Issue 2: 松手后浮窗消失问题 (`highlights.js`)

## B 类：高亮/笔记逻辑
- [x] Issue 4: 纯笔记无法保存 (`highlights.js`)
- [x] Issue 5: 区分高亮/笔记显示 + 管理页筛选 (`highlights.js`, `home.js`, `home.css`)
- [x] Issue 6: 高亮去重 (`highlights.js`)

## C 类：管理页功能
- [x] Issue 3: 标注管理页删除功能 (`home.js`, `home.css`)
- [x] Issue 8: 导出笔记换行符修复 (`home.js`)

## D 类：阅读器状态
- [x] Issue 9: 进度条初始显示 0% (`reader.js`)

# v1.1.2 优化与稳定性增强
- [x] 优化 1: 点击高亮直接直观查看笔记 (`highlights.js`)
- [x] 优化 2: 弹窗与高亮工具栏深层适配主题 (`reader.css`)
- [x] 优化 3: 🔴 致命问题：翻页后选中内容无反应 (`reader.js`, `highlights.js`)
- [x] 优化 4: 统一有笔记高亮的虚线下划线标识 (`reader.css`, `highlights.js`)

# v1.1.3 划线重构与交互闭环
- [x] 🔴 致命修复：划线功能彻底失效定位与解决 (`highlights.js`)
- [x] 优化样式：笔记高亮仅底部虚线，移除边框 (`reader.css`)
- [x] 交互闭环：笔记弹窗增加返回/修改高亮的入口 (`highlights.js`, `reader.html`)

# v1.1.4 细节强化与术语统一
- [x] 优化：修复取消选中后工具栏不消失的问题 (`highlights.js`)
- [x] 视觉：利用 `clip-path` 彻底消除笔记“方框” (`reader.css`)
- [x] 同步：管理页面标注颜色动态绑定 (`home.js`)
- [x] 规范：全插件术语统一，“高亮”改为“标注”

# v1.1.5 终极视觉与交互闭环
- [x] 彻底修复：主窗口监听确保标注工具栏自动消失 (`highlights.js`)
- [x] 视觉美化：消除标注黑线，改用“长虚线”标识笔记 (`reader.css`)
- [x] 逻辑补完：支持从笔记弹窗返回并准确定位修改标注 (`highlights.js`)

# v1.1.6 终极 Bug 修复与稳定性增强
- [x] 逻辑补完：增强坐标计算健壮性，确保“修改标注”定位精准 (`highlights.js`)
- [x] 规范：同步更新插件版本号至 1.1.6 (`manifest.json`)

# v1.2.0 深度架构重构与体验闭环 (全局 PDCA)
- [x] 架构：实现 `Locations` 进度缓存持久化，根治翻页/重启时进度归零及预测耗时抖动 (`storage.js`, `reader.js`)
- [x] 彻底修复：引入明确的同步锁 `_internalAction`，断绝面板顽固残留 (`highlights.js`)
- [x] 视觉美化：采用限定命名空间的 CSS `svg.epubjs-annotation polyline` 清除默认黑线，同时保护全书原生样式 (`reader.css`)
- [x] 交互边界：为笔记悬浮窗增加视口碰撞检测，防止顶部溢出 (`highlights.js`)
- [x] 逻辑补完：直接复用面板屏幕物理坐标，解决“修改标注”无响应并防止跨幅报错 (`highlights.js`)
- [x] 全局除虫：补全双栏模式右侧页面的“清除系统选中区”逻辑遍历 (`highlights.js`)
- [x] 全局除虫：消除全局搜索造成的永久性高亮（内存与视觉）污染 (`search.js`)
- [x] 规范：同步更新插件版本号至 1.2.0 (`manifest.json`)

# v1.2.1 极致视效与定位修补专项
- [x] 视觉修补：解决大行高导致的下划线脱离文字坠入行间的问题 (`reader.css`)
- [x] 视觉修补：移除通配符，彻底剥离交互 `rect` 的虚线边框 (`reader.css`)
- [x] 交互边界：重写 `notePopup` 的物理高度换算，突破顶端视口飞出问题 (`highlights.js` & `reader.css`)
- [x] 规范：同步更新插件版本号至 1.2.1 (`manifest.json`)

# v1.2.2 PDCA 终极架构重构与盲区清扫
- [x] 存储引擎：拔除 `localStorage` 的 2MB 硬阈值限制，将 `Locations` 巨兽级缓存完美迁移至 `IndexedDB` (`storage.js`)
- [x] 交互边界：重塑唤醒逻辑，彻底解决在屏幕顶部点击“记笔记”面板因缺失 `.flip` 样式导致失踪的问题 (`highlights.js`)
- [x] UI 时序：为纯笔记创建事件末尾追加 `reRenderHighlight`，消除幽灵笔记不显示虚线的问题 (`highlights.js`)
- [x] 业务引擎：对 `annotations.js` 开展基因级别缝合，剔除同名覆盖函数，让脚注的防误断链机制重新生效
- [x] 渲染层：全域统一标准，将搜索面板野蛮的 `style.display` 切换统一至 CSS `.visible`，化解遮罩并发展打架黑屏死锁 (`search.js`)
- [x] 体验引擎：主页标注面板新增【时间双向罗盘】，实现跨书域笔记时间戳打散重组与正逆序梳理 (`home.html`, `home.js`)
# v1.2.3 极致稳定与死角扫雷 (PDCA 终极防线)
- [x] 生命周期死区：将 `currentSort` 的 `let` 声明提升至全局初始化域，彻底修复 `home.js` 首页闪崩 (`home.js`)
- [x] 坐标盲区矫正：修正 `notePopup` 的物理向上生长判定阈值 (由 `<10` 扩大至 `<200`)，根治顶部唤醒面板时因缺乏 `.flip` 而溢界失焦的问题 (`highlights.js`)
- [x] 降维监听：将 `doc` 内容区的清理事件由易被吞噬的 `click` 降级为 `mousedown`，确保轻触任何留白区域都能绝对关闭面板 (`highlights.js`)
- [x] 语义级清淤：移除了 `annotations.js` 中泛滥杀伤的标准脚注正则 (`/^#(fnref|noteref...)/`)，仅保留安全且隐蔽的后向回溯判断，让合法的原生注记重获新生 (`annotations.js`)
- [x] 规范：同步更新插件版本号至 1.2.3 (`manifest.json`)

# v1.2.4 严重 BUG 解决与护航 (IndexedDB 大一统)
- [x] 版本大一统：将所有模块中调用的 `indexedDB.open('EpubReaderDB', 2)` 统一拔升至 `V3`，根除降级版本拒绝崩塌问题 (`storage.js`, `home.js`, `popup.js`, `reader.js`)
- [x] 架构自愈：在全域所有的 `onupgradeneeded` 钩子中补齐了 `locations` 表的建立逻辑，确保新旧用户进入均能构建完整三权分立表结构 (`files`, `covers`, `locations`)
- [x] 规范：同步更新插件版本号至 1.2.4 (`manifest.json`)

# v1.2.5 注释弹窗紧急修复 (消失的雷达)
- [x] 逻辑回归：在 `src/reader/annotations.js` 中重新安插了此前重构时被意外误删的关键拦截识别雷达 `isFootnoteLink`，成功消除了因为后台隐式报错（TypeError）而导致的 `epub.js` 默认接管错误跳包现象。让原本精美的注释悬浮气泡重新回归。
- [x] 规范：同步更新插件版本号至 1.2.5 (`manifest.json`)

# v1.2.6 安全加固与数据可靠性止血 (Phase A — PDCA 止血)

## 🔴 P0 — 紧急修复
- [x] P0-A: `getLocations` / `removeLocations` 补版本号 `indexedDB.open('EpubReaderDB', 3)` + `onupgradeneeded` 建表 (`storage.js`)
- [x] P0-B: `showLoadError` 改用纯 DOM API (`createElement` + `textContent` + `addEventListener`)，消除 `innerHTML` 拼接 XSS 风险 (`reader.js`)
- [x] P0-C: `window mousedown` 匿名监听器提取为具名函数 `_onWindowMouseDown`，移入 `init()` 仅注册一次；`btnShowToolbar` 同步处理 (`highlights.js`)

## 🟠 P1 — 重要修复
- [x] P1-A: 新增 `document.addEventListener('visibilitychange', ...)` 顶层监听，Tab 切换/关闭时立即 `saveReadingTime()`，阅读时长丢失窗口降为 0 (`reader.js`)
- [x] P1-G: `popup` 移除书籍改为统一调用 `EpubStorage.removeBook(id, filename)` 级联删除（highlights/bookmarks/cover/locations/file） (`popup.js`)

# v1.2.7 交互闭环与体验强化 (Phase B — PDCA 稳定)

## 🟠 P1 — 重要修复
- [x] P1-B: `overlay.click` 改调 `closeAllPanels()`；`TOC.close()` 关闭前检查 Search/Bookmarks 状态；`Search.closePanel()` 关闭前检查 TOC/Bookmarks 状态 (`toc.js`, `search.js`, `reader.js`)
- [x] P1-C: `Bookmarks.togglePanel()` 打开时先关闭其他面板并显示 overlay；`closePanel()` 检查 TOC/Search 状态决定是否移除 overlay (`bookmarks.js`)
- [x] P1-D: `openBook` gap 80 → 48；`setLayout` gap 40 → 48，两处统一消除布局切换行宽跳变 (`reader.js`)
- [x] P1-E: `home.js` / `popup.js` coverBlob 改用 `img.addEventListener('load'/'error', revokeObjectURL, {once:true})`，DOM 挂载后立即释放 blob 引用 (`home.js`, `popup.js`)
- [x] P1-F: 删除 `home.js` 中 `hl._originalIndex = i` 死代码（从未读取，删除操作已改 CFI 匹配），for-index 改为 for-of (`home.js`)

## 🔵 P2 — 持续改进
- [x] P2-C: 进度条拆分为 `input`（仅更新百分比标签）+ `change`（松手后调 `rendition.display()`），消除快速拖动时白屏闪烁 (`reader.js`)
- [x] P2-E: `manifest.json` 的 `web_accessible_resources` 从 `<all_urls>` 收敛至 `chrome-extension://*/*` (`manifest.json`)

## 规范
- [x] 同步更新版本号至 1.2.7 (`manifest.json`)
