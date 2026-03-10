# 📖 EPUB Reader 浏览器扩展

> 一款强大、纯净、极具美感的 EPUB 电子书阅读器 Chrome 扩展应用。全面支持深度的中文排版、图文混排、高阶交互式标注（高亮+笔记），并且所有数据绝对处于**本地离线隐私存储**。

[![Version](https://img.shields.io/badge/version-1.2.7-blue.svg)]()
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
  - 每一次重新打开书籍或翻页，阅读进度/预计耗时百分比都将如磐石般稳固，再无由于重绘导致的 0% 进度闪断。

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
- **数据库版本一致性**：所有 IndexedDB 读写路径统一指定版本 V3，消除新用户首次访问时读到空数据库的边缘场景。
- **阅读时长零丢失**：通过 `visibilitychange` 事件在标签页切换/关闭时立即持久化计时器，丢失窗口从最多 10 秒降为 0。

## 📄 开源协议 (License)

本项目遵循 [MIT License](LICENSE) 协议开源。欢迎每一位同样热爱纯净阅读的开发者提交 Issue 与 Pull Request 共同改进打磨。
