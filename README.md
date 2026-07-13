# EPUB Reader

Chrome MV3 EPUB 阅读器扩展。无框架、无构建步骤，直接加载 `src/` 作为 unpacked extension；电子书文件、阅读进度、标注和偏好均保存在浏览器本地。

[![Version](https://img.shields.io/badge/version-2.5.13-blue.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 核心功能

- 本地书架：导入 `.epub`，管理最近阅读、封面、阅读时间和进度。
- 阅读体验：分页/滚动布局、目录、书签、全文搜索、主题、字号、行距和字体设置。
- 标注笔记：多色高亮、纯笔记、全局标注管理和 Markdown 导出。
- 注释与图片：EPUB 脚注/尾注弹窗、图片放大查看。
- 进度恢复：基于 CFI、displayed-page locator 和 IndexedDB locations 缓存恢复阅读位置。

## 安装

1. 克隆仓库。
   ```bash
   git clone https://github.com/your-username/epub-reader-extension.git
   ```
2. 打开 `chrome://extensions/` 或 Edge 扩展管理页。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择仓库中的 `src/` 目录。

## 开发

本项目没有 package manager manifest、打包、lint 或 typecheck。

```bash
node test/run_tests.js
node --test-name-pattern="ReaderPersistence" test/run_tests.js
```

关键入口：

- `src/manifest.json`
- `src/reader/reader.html`
- `src/home/home.html`
- `src/popup/popup.html`

脚本由 HTML 直接加载，顺序即依赖边界；入口本地脚本不使用 `?v=` 查询串刷新缓存。

## 架构概览

- 渲染：`epub.js` + `JSZip`
- 存储：IndexedDB（EPUB 文件、封面、locations）+ `chrome.storage.local`（偏好、最近书籍、进度、标注、书签）
- Reader 分层：`reader-state` / `reader-runtime` / `reader-persistence` / `reader-ui`
- 存储入口：业务代码统一通过 `EpubStorage`，不直接访问 `chrome.storage.local` 或 IndexedDB

更多实现细节见 [docs/architecture.md](docs/architecture.md)。

## 隐私与安全

- Local First：不上传书籍、标注或阅读记录。
- EPUB/用户内容进入页面优先使用 DOM API 和 `textContent`。
- 颜色、属性、脚注 HTML 和 Blob URL 生命周期均有边界处理。
- 自动 LRU 只淘汰 EPUB 文件缓存；主动删除书籍才级联清理进度、标注、书签等数据。

## 文档

- [CHANGELOG.md](CHANGELOG.md)：历史版本和已完成变更。
- [docs/ROADMAP.md](docs/ROADMAP.md)：未来计划和活跃技术债。
- [AGENTS.md](AGENTS.md)：维护约束和协作规则。

## License

[MIT](LICENSE)
