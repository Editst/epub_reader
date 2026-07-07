# 📖 EPUB Reader 浏览器扩展

> 一款强大、纯净、极具美感的 EPUB 电子书阅读器 Chrome 扩展应用。全面支持深度的中文排版、图文混排、高阶交互式标注（高亮+笔记），并且所有数据绝对处于**本地离线隐私存储**。

[![Version](https://img.shields.io/badge/version-2.4.9-blue.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ 特性 (Features)

- **📚 本地书架 (Local Bookshelf)**
  - 自动管理您的阅读历史、阅读时间与书籍封面。
  - 支持直接拖拽或点击上传本地 `.epub` 文件。
  - 基于 IndexedDB 打造的超大文件级存储引擎，百兆书籍也能毫秒级重载。

- **📝 极致标注体验 (Premium Annotations)**
  - 支持**多色高亮 (`Highlight`)** 与 **纯文本笔记 (`Note`)** 灵活混用。
  - 精心调教的“悬空长虚线”标识，不破坏任何书籍底层原生排版。
  - 拥有严格控制的触碰物理引擎与空间感知（碰撞翻转算法），多列表格或双栏排版均能准确交互定点，弹窗永不溢出。
  - 首创“时间全局罗盘”，支持打破书籍界限，对您的所有灵感笔记进行时间轴的正/降序贯通回溯。

- **⏱️ 进度毫秒级同步 (Progress Sync)**
  - 独创在本地生成并缓存 IndexedDB `Locations` (全局坐标地图) 架构。
  - 阅读位置恢复采用 `pos.cfi + locator.restoreCfi + 同 CFI 直接重放 + 恢复锚点保护` 策略，解决分页边界、重开错页与刷新跳页问题。
  - ETA 升级为会话加权模型（指数衰减 β=0.8），智能识别跳读；locations 生成引入 Idle 调度与进度文案。
  - Reader 内核完成四层解耦（`reader-state.js` / `reader-runtime.js` / `reader-persistence.js` / `reader-ui.js`），由 Orchestrator 统一调度并落地 `mount/unmount` 生命周期契约。
  - 每一次重新打开书籍或翻页，阅读进度/预计耗时百分比都将如磐石般稳固。

- **🔍 智能检索与注释 (Search & Footnotes)**
  - 支持侧边栏全书级别的关键词匹配，即用即走，全屏标记自动清洗消除污染。
  - 采用独家启发式算法解析原生书籍内的“脚注 / 尾注 / 参考文献”链接，不仅能自动抓取注释原文，更能为您优雅弹出原位展示框，极大地免去了频繁前后跳页的痛苦。

- **🎨 定制化阅读界面 (Customizable UI)**
  - 内置深色/浅色沉浸式护眼模式，悬浮菜单带有精美的毛玻璃（Glassmorphism）高斯模糊。
  - 支持自定义字体、字号、行距、边缘间距。随心所欲，所见即所得。

## 🚀 安装指南 (Installation)

1. 选择一个您喜欢的位置并克隆本仓库：
   ```bash
   git clone https://github.com/your-username/epub-reader-extension.git
   ```
2. 打开 Chrome / Edge 等基于 Chromium 的浏览器，访问扩展管理页面：`chrome://extensions/` 
3. 在页面右上角开启 **"开发者模式" (Developer mode)**
4. 点击左上角的 **"加载已解压的扩展程序" (Load unpacked)**
5. 选择下载源码目录下的 `src` 文件夹（即包含 `manifest.json` 的文件夹）
6. 扩展程序即刻安装完毕！建议点击浏览器右上角的拼图图标，将其固定（Pin）到工具栏，一键开启阅读时光。

## 🏗️ 架构与技术栈 (Tech Stack)

* **核心渲染器**：[Epub.js](https://github.com/futurepress/epub.js/) (v0.3.93) 提供最硬核的底层解包与 CFI 解析支持。
* **数据存储矩阵**：
   * `IndexedDB` 统配了 `files`, `covers`, `locations` 三驾重型马车，支持无限容量。
   * `chrome.storage.local` 提供轻量级首选项（Preference）的无感持久化。
* **零框架前端（Vanilla JS/CSS）**：追求极致速度与最原生的 DOM 控制体验，未接入任何沉重的现代 JS 框架，彻底规避生命周期延迟。
* **合规性**：完美适配 MV3 (Manifest V3) 高安全扩展标准规范。

## 🛡️ 隐私声明 (Privacy & Security)

**Local First / 本地唯一**：您的所有操作——小到一次翻页、大到存储所有的电子书实体文件以及您的私密笔记——**均 100% 绝对隔离存储在您的浏览器本地空间内**。本应用从架构上主动切断了任何上传服务器的回传请求，真正的您的数据归属于您！

## 🛡️ 安全与稳定性 (Security & Reliability)

- **XSS 免疫**：全局内容边界采用 DOM API（`textContent` / `createElement`）构建，书名、作者、报错信息等任何外部输入均不注入 `innerHTML`，防止恶意构造的 EPUB 文件在扩展页面执行脚本。
- **最小权限原则**：`web_accessible_resources` 仅向扩展自身页面开放（`chrome-extension://*/*`），第三方网页无法加载扩展内的核心库文件。
- **资源生命周期管理**：封面 Blob URL 在 DOM 渲染完成后即时 `revokeObjectURL`，杜绝长期会话中的内存碎片累积。
- **存储 key 中心化（v2.4.8）**：`EpubStorage` 集中声明 chrome.storage key 与 IndexedDB store 名称，避免 per-book key 字符串散落造成迁移、删除和兼容路径不一致。
- **Reader UI 绑定幂等（v2.4.8）**：阅读器顶层事件监听只注册一次，重复绑定会切换到最新 runtime 引用但不会叠加键盘、按钮或拖拽处理器。
- **功能模块初始化幂等（v2.4.8）**：注释、书签、目录、搜索、图片查看和高亮模块重复 `init()` 不会叠加顶层事件监听。
- **Reader 模块导出一致性（v2.4.9）**：搜索模块补齐 `window.Search` IIFE 导出契约，公开接口测试会防止功能模块再次漂移为顶层 `const`。
- **进度值归一化（v2.4.8）**：书架与弹窗展示阅读进度前会把 storage 值裁剪到 0–100，避免损坏数据影响文本或 CSS 进度条。
- **书架顺序稳定（v2.4.7）**：书籍卡片流式渲染时按 recentBooks 原始索引替换对应骨架，封面或元数据返回速度不同也不会打乱最近阅读顺序。
- **数据库版本一致性**：所有 IndexedDB 读写路径统一通过 DbGateway（DB v4）管理，消除新用户首次访问时读到空数据库的边缘场景。
- **阅读时长零丢失**：通过 `visibilitychange` 事件在标签页切换/关闭时立即持久化计时器，丢失窗口从最多 10 秒降为 0。
- **阅读位置实时保存**：翻页/滚动后的首个稳定 CFI 会立即启动持久化，连续变化时再用 300ms 防抖保存最终位置，减少关闭页面时回到旧位置的风险。
- **切书前会话收口（v2.4.7）**：在阅读器内打开另一本文本前，会先落盘旧书位置、阅读时长和速度采样，再卸载模块并销毁旧 rendition，避免 iframe 与事件绑定跨书残留。
- **导入缓存完整性（v2.4.7）**：Reader 页本地导入会等待 EPUB 文件写入 IndexedDB 后再进入阅读，确保关闭后可从书架或弹窗重新打开。
- **主动删除与 LRU 分层清理（v2.4.7）**：用户主动删除书籍会清理 recentBooks、bookMeta、封面、locations、高亮、书签和文件；自动 LRU 只淘汰 EPUB 文件缓存，保留阅读进度、书签和标注，重新导入同一本书后可继续使用。
- **注释弹窗内容清洗（v2.4.7）**：EPUB 脚注/尾注 HTML 进入扩展宿主页前逐属性移除事件处理器、`srcdoc` 与 `javascript:` URL，覆盖未加引号和空白混淆写法。
- **恢复锚点保护**：分页模式重新打开书籍后，用户真正导航前不会把 epub.js 回报的页边界 CFI 覆盖为新位置，避免刷新或重开时连续跳页。
- **重开定位无翻页校正（v2.4.6）**：恢复时要求 `locator.restoreCfi` 明确绑定当前 `pos.cfi`；若 fresh rendition 首次 `display(restoreCfi)` 后短暂停在同章节旧页，只在 loading 期间重放一次同一个 CFI，不调用 `next()/prev()`，避免重开时快速翻动。
- **分裂位置快照自愈（v2.4.5）**：若缓存 locations 发现 `pos.cfi` 与已保存百分比明显不一致，则用百分比回推 CFI，避免“右下角进度是新的、页面仍是老的”。
- **iframe 用户翻页保护释放（v2.4.5）**：恢复后在 EPUB iframe 内滚轮、触摸、鼠标或键盘翻页会解除恢复锚点保护，确保新页立即保存。
- **关闭前待写入保护（v2.4.5）**：若翻页后的防抖保存尚未执行，关闭/刷新会直接保存最新 relocated 快照，不再用可能滞后的 `currentLocation()` 覆盖回旧页；损坏的 locations 缓存会自动降级为后台重建。
- **翻页位置即时落盘（v2.4.4）**：`relocated` 事件优先作为本次翻页的新位置保存，避免同一 tick 内滞后的 `currentLocation()` 把恢复锚点回滚到旧页；CFI 相同但 locator/百分比变化时也会刷新存储。
- **分页恢复锚点保存（v2.4.3）**：分页模式在 `locator.restoreCfi` 中保存从页起点向页内轻微前移的恢复锚点，关闭/刷新前会重新生成该 locator，避免重开书籍时被边界归属到上一页。
- **恢复 locator 失效自愈（v2.4.2）**：旧版或不可比的页码快照会自动失效，恢复时保留可靠 CFI 锚点；v2.4.6 起 locator 只允许触发同 CFI 直接重放，不驱动翻页导航。
- **内容指纹 BookId（v1.5.0）**：书籍标识符从 32-bit djb2 哈希升级为 SHA-256 前 64KB 内容指纹，消除同名同大小文件的确定性碰撞风险，阅读记录与书籍绑定关系在密码学层面可靠。
- **高亮颜色白名单校验**：所有高亮颜色值在写入存储和渲染时均经过 `#[0-9a-fA-F]{3,8}|transparent` 正则白名单过滤，防止 CSS 注入攻击。
- **IndexedDB 持久化保障**：存储网关 `DbGateway` 的 `put()` / `delete()` 操作现在等待 `tx.oncomplete` 信号，确保数据真正落盘后才视为写入完成。
- **文件淘汰串行化（v2.4.0）**：`enforceFileLRU` 改为逐项串行淘汰 + per-item try/catch，避免并发读改写竞态导致书籍记录丢失。
- **架构约束强制化（v2.4.0）**：Reader 各层严格遵守职责边界——persistence 层不持有 DOM 引用，runtime 层不直接操作视图，UI 辅助函数作为唯一 DOM 入口。

## 📄 开源协议 (License)

本项目遵循 [MIT License](LICENSE) 协议开源。欢迎每一位同样热爱纯净阅读的开发者提交 Issue 与 Pull Request 共同改进打磨。
