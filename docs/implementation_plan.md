# EPUB Reader Phase C: 架构稳定性与债务清理 (v1.4.x)

本项目在经历 Phase A (止血) 和 Phase B (安全加固) 后，进入 Phase C 架构稳固期。本计划核心在于治理技术债务，通过单例网关统一 IndexedDB 存储，并解决高频事件产生的性能与稳定性问题。

## 1. 存储底层网关化 (DbGateway)
**目标**：消除项目中 12 处分散的 `indexedDB.open` 调用，集中 Schema 管理。

### 变更内容
- **[NEW] `src/utils/db-gateway.js`**: 实现单例网关 `DbGateway`，提供 Promise 化事务接口 (`get`, `put`, `delete`, `getAll`)。
- **[MODIFY] `src/utils/storage.js`**: 全量重构，将所有 DB 操作代理至 `DbGateway`。
- **[MODIFY] `src/reader/reader.js` & `src/popup/popup.js` & `src/home/home.js`**: 废除内联存储逻辑，调用 `EpubStorage` 统一接口。
- **[MODIFY] HTML 文件**: 在各页面头部注入 `db-gateway.js` 脚本。

---

## 2. 生命周期与事件流修正
**目标**：解决章节切换导致的监听链堆叠泄漏，以及模式冲突。

### 变更内容
- **P1-NEW-3 (事件泄漏)**：在 `setupRenditionKeyEvents` 注入前增加防御逻辑，避免 `wheel` 事件在每章节加载时重复叠加。
- **P1-NEW-6 (滚动模式冲突)**：限制 `wheel` 翻页仅在 `paginated` 模式生效；`scrolled` 模式时放开，还原原生滚动。

---

## 3. 样式双轨制与 CSP 维稳
**目标**：对齐变量系统，并寻求 CSP 安全与 UI 渲染的平衡。

### 变更内容
- **P2-NEW-1 (自定义主题)**：在 `themes.css` 补齐 `data-theme="custom"` 变量域。
- **P2-NEW-3 (变量冲突)**：重命名 `home.css` 私有变量，解决与全局 `themes.css` 的命名空间重叠。
- **CSP 维稳**：鉴于 `popup.html` 与 `epub.js` 深度依赖内联样式，临时恢复 `unsafe-inline` 权限，确保重构期间界面不崩溃。

---

## 验证计划
1. **网关回归**：执行完整“导入-阅读-标注-退出-重入”流程，确保 IndexedDB 数据无损。
2. **滚动验证**：切换“滚动布局”，验证鼠标滚轮可否平滑浏览。
3. **样式一致性**：在阅读器切换主题后返回主页，校验书架面板颜色是否同步对齐。
