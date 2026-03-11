# EPUB Reader — 项目路线图

> 最后更新：2026-03-11 · 基于 v3.0 审计报告

---

## 当前状态：v1.7.0

存储层 Schema 已完成破坏性重建（DB v4），全部 P0 安全问题已修复，两次版本迭代共清理 15 项问题。

当前无 P0 级开放问题。最高优先级待处理：DbGateway 重试风暴（P1）、highlightKeys 索引不一致（P2 新发现）。

---

## 里程碑规划

### v1.7.0 — 稳定性修复（≈ 2 工作日）

**目标**：消除所有 P1/P2 级问题，使当前架构达到稳定状态。

- [x] T-1：`highlightKeys` 索引一致性（saveHighlights/removeHighlights 同步维护）
- [x] T-2：`enforceFileLRU` 级联清理 recentBooks 孤立条目
- [x] T-3：home.js 删书时显式 revoke ObjectURL
- [x] T-4：`savePosition` 防抖 300ms（翻页不直写 storage）
- [x] T-5：`loadBookshelf` 并行化（串行 60 次 → 并行 ~3 次）
- [x] T-6：DbGateway 指数退避冷却（防重试风暴）

---

### v1.8.0 — Bug 修复 + CSS 清理（≈ 3 工作日）

**优先级更新**：v1.7.0 验收阶段发现 3 个 P1 级功能 bug，v1.8.0 首要任务是修复，其次完成原 CSS 清理计划。

**P1 Bug 修复**：
- [x] BUG-01：Popup 首次打开新书无反应（`showOpenFilePicker` 替代 `<input type="file">`）
- [x] BUG-02：ETA 不准确（`_cachedSpeed` 内存同步 + session 起点重置 + 阈值调优）
- [x] BUG-03：缩放后位置偏移（`start.cfi` 锚点 + 字号变化 CFI 锁保护）

**原有 CSS 清理**：

**目标**：统一显隐控制，消除 CSS 变量冲突，为移除 `unsafe-inline` 铺路。

- [ ] S-1：home.css 变量私有命名空间（`--home-*`），消除与 themes.css 的双轨冲突
- [x] S-2：themes.css 补充 `[data-theme="custom"]` 块
- [ ] S-3：display 控制统一为 CSS class（消除 7 处 `style.display` 直写）
- [x] S-4：popup.css 外联化（234 行内联 CSS → `popup.css`）
- [x] S-5：reader.html / home.html / popup.html 补充 `<meta name="color-scheme">`
- [x] S-6：drag-overlay HTML 预置于 reader.html，移出 innerHTML 赋值

---

### v1.9.0 — CSP unsafe-inline 消除（≈ 2 工作日）

**前提**：v1.8.0 完成。

- [x] C-1：`showLoadError()` 5 处 `style.cssText` → CSS class
- [x] C-2：`reader.js` opacity 动画 → CSS transition class
- [x] C-3：`search.js` 4 处 `style.*` → `.search-result-item` CSS
- [x] C-4：`search.js mark.style.cssText` → `.search-highlight` CSS class
- [x] C-5：`search.js statusEl.innerHTML` → textContent + CSS class
- [x] C-6：`toc.js` empty inline style → `.toc-empty` CSS class
- [ ] C-7：manifest `style-src` 移除 `'unsafe-inline'`

---


### v1.9.1 — CSP 收敛收尾（≈ 2-3 工作日）

**目标**：在不引入 UI 回归前提下完成 C-7。

- [ ] C-7R-1：`reader.html`/`home.html`/`popup.html` 去除静态 `style="..."` 属性
- [ ] C-7R-2：`home.js`/`popup.js` 迁移运行时 `style.*` 为 class 切换或 CSS 变量
- [ ] C-7R-3：`annotations.js` 去除 `innerHTML` 中的内联 style 片段
- [ ] C-7R-4：完成迁移后再移除 manifest 的 `unsafe-inline`

### v2.0.0 — reader.js 架构拆分（≈ 7-10 工作日）

**目标**：1160 行上帝对象拆分为职责单一模块。

- [ ] Step 1：提取 `reader-persistence.js`（位置/时间防抖写入）
- [ ] Step 2：提取 `reader-state.js`（单一状态源）
- [ ] Step 3：为 Search/TOC/Bookmarks/Highlights/Annotations 添加 `mount/unmount` 接口
- [ ] Step 4：提取 `reader-ui.js`（DOM 绑定层）
- [ ] Step 5：reader.js 缩减为 `reader-runtime.js`（目标 < 400 行）

---

### v2.1.0 — 性能与 UX（≈ 3 工作日）

- [ ] P-1：ETA 改为基于实际历史阅读速度动态估算
- [ ] P-2：locations 生成期间进度反馈（消除"--"状态）
- [ ] P-3：`requestIdleCallback` 优化阅读计时写入
- [ ] P-4：搜索性能：每 5 章让出 UI 线程一次（当前每章）

---

### v2.2.0 — ARIA 可访问性（≈ 2 工作日）

- [ ] A-1：侧边栏/面板 `role="dialog"` + `aria-modal`
- [ ] A-2：导航按钮 `aria-label`
- [ ] A-3：进度条 `aria-label` + `aria-valuetext`
- [ ] A-4：搜索面板 `role="search"`

---

## 技术债务索引

| 优先级 | ID | 描述 | 目标版本 |
|---|---|---|---|
| 🟠 P1 | C-1 | DbGateway 重试风暴 | v1.7.0 |
| 🟡 P2 | NEW-1 | highlightKeys 索引不一致 | v1.7.0 |
| 🟡 P2 | NEW-2 | savePosition 无防抖 | v1.7.0 |
| 🟡 P2 | 2.2 | LRU 驱逐后书架孤立条目 | v1.7.0 |
| 🟡 P2 | 2.3 | card.remove() ObjectURL 泄漏 | v1.7.0 |
| 🟡 P2 | 2.5 | loadBookshelf 串行加载 | v1.7.0 |
| 🔵 P3 | 2.6 | CSP unsafe-inline | v1.9.0 |
| 🔵 P3 | 2.8 | CSS 变量双轨 | v1.8.0 |
| 🔵 P3 | 2.9 | custom 主题 CSS 缺失 | v1.8.0 |
| 🔵 P3 | 2.10 | display 三轨并存 | v1.8.0 |
| 🔵 P3 | 2.11 | 缺 meta color-scheme | v1.8.0 |
| 🔵 P3 | 2.12 | popup.html 内联 CSS | v1.8.0 |
| 🔵 P3 | 2.13 | search.js innerHTML/style | v1.9.0 |
| 🔵 P3 | 2.14 | reader.js 上帝对象 | v2.0.0 |
| 🔵 P3 | 2.15 | ETA 硬编码 400 字/分 | v2.1.0 |
| 🔵 P3 | 2.16 | 缺 ARIA 标注 | v2.2.0 |
| 🔵 P3 | 3.5 | by_filename 无用接口 | v1.7.0（顺手） |
