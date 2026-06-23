# CHANGELOG

所有重要变更记录于此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [2.2.4] - 2026-06-23

### fix
- **阅读进度恢复**：修复关闭书籍后重新打开时进度回退到旧位置的 Bug。根因为 `openBook` 中 `rendition.display(savedCfi)` 触发的 `relocated` 事件在 locations 未加载时，以 `null` percentage 和 page-start CFI 覆写了 storage 中的正确进度。引入 `state.isRestoringPosition` 标志位，在位置恢复期间抑制 `schedulePositionSave` 调用。

### test
- 新增 6 个 `isRestoringPosition` 保护机制的 TDD 测试用例 (`progress_restore.test.js`)，覆盖恢复期间跳过写入、正常阅读时正常写入、flush 使用最新内存状态等场景。全量 92 个用例通过。

---

## [2.2.3] - 2026-06-22

### feat
- **架构决策**: 确认 `enforceFileLRU` 不级联删除标注等数据的设计，以保障电子书文件被淘汰后仍可保留读书笔记记录 (详见 ADR-001)。

### fix
- 存储与首页:
  - `home.js`: 修复重名文件导入无响应的问题 (fileInput value 重置)。
  - `home.js`: 修复导出 Markdown 笔记时，书名及作者名被误用 HTML Entity 转义的问题。
  - `storage.js`: 修复速度统计零值 (`sampledSeconds=0` 等) 被 fallback 机制忽略的问题 (`||` -> `??`)。
  - `storage.js`: 优化 `getAllHighlights` 读取性能，去除冗余的逐本查询 I/O 操作。
- 阅读器体验:
  - `reader-runtime.js`: 补充 SVG 图片内联的 `'image'` 样式声明，修复 SVG 排版溢出。
  - `reader-runtime.js`: 修复书封 Blob URL 内存泄漏，使用后主动 `URL.revokeObjectURL()`。
  - `toc.js`: 修复 TOC 当前章节高亮匹配缺陷 (避免 `/ch1.html` 误匹配 `/ch10.html`)。
  - `toc.js`: 修复 TOC 面板打开时与其他面板互斥失效的问题。
  - `highlights.js`: 为 `reRenderHighlight` 增加失败日志打印，避免静默失败难以追查。
  - `search.js`: 修复大量搜索结果下，增量返回导致的整个列表频繁清空重绘的问题，改为 append 模式。
  - `reader-persistence.js`: 修复初始化流程中的计时器泄漏问题，移除 mount 时提前启动的不必要 timer。

### test
- 新增 11 个涵盖数据完整性、阅读器行为、首页操作的 UX 层回归与缺陷验证测试 (`bugfix_reader_ux.test.js`, `bugfix_home.test.js`, `bugfix_data_integrity.test.js`)，目前全量 86 个用例通过。

---

## [2.2.2] - 2026-06-22

### fix
- 阅读进度保存改为“首次立即写入 + 300ms 防抖收敛最终位置”，降低快速关闭页面时回退到旧 CFI 的风险。
- `flushPositionSave()` 返回位置写入 Promise，并显式维护 `lastPositionSave` 状态，便于生命周期路径等待最新保存。
- 搜索面板关闭/重置进行中的搜索时恢复搜索按钮，避免取消搜索后按钮长期 disabled。
- `Annotations.mount()` 会重新确保 Escape 监听存在，修复切换书籍后注释弹窗无法用 Escape 关闭的问题。

### docs
- manifest、README、架构文档与模块接口参考更新至 v2.2.2。
- README 修正文档中关于 CSP 已彻底移除 `'unsafe-inline'` 的过期描述。

### test
- 新增 reader 持久化与模块生命周期回归测试，覆盖实时进度保存、搜索取消、注释弹窗切书后的 Escape 行为。

---

## [2.2.1] - 2026-03-27

### fix
- Reader 首开无缓存大体积 EPUB 时，不再等待 `locations.generate()` 完成后才进入正文；正文渲染成功后立即可读，定位索引改为后台生成。
- `reader-runtime.js` 为 `locations` 增加 `idle/pending/generating/ready/failed` 状态，并补充 `open_to_first_render`、`locations_generate_duration`、`locations_cache_hit` 日志，便于后续性能观测。
- `locations.generate()` 的 break 参数由固定 `1600` 改为按书籍体积自适应：默认 `1600`，大于 1MB 使用 `3200`，大于 3MB 使用 `4800`，降低大书首开索引耗时。
- `reader-persistence.js` / `reader-ui.js` 在索引未就绪或失败时降级展示 ETA 和定位状态，底部状态栏显示“阅读定位索引生成中 / 不可用 / 已就绪”，不再阻塞翻页与阅读。

### test
- 新增 reader 侧回归测试，覆盖“大书首开先可读、后台建索引、自适应 break、ETA 降级、locations 状态字段”。

---

## [2.2.0] - 2026-03-17

### fix (D-2026-25 — speed.sessions 持久化落地)
- `storage.js` `saveReadingSpeed` / `getReadingSpeed` 升级 speed 结构，补全 `sessions: []` 和 `sessionCount: 0` 字段。
- `_enqueueBookMetaWrite` 默认 speed 结构同步更新。
- 向后兼容：旧无 `sessions` 字段的数据读取时安全补零。
- D-2026-25 闭环。

### test
- 新增 `test/suites/v2_2_tdd.test.js`，覆盖 D-2026-25/版本号 全部验收项。

---

## [2.1.1] - 2026-03-12

### fix
- Reader 生命周期编排由入口匿名适配层改为子模块原生 `mount/unmount` 接口（R-2 收尾）。
- `Annotations.init()` Escape 监听改为具名 `_onKeyDown`，`unmount()` 中执行 `removeEventListener`，消除重复挂载时监听器累积（AN-C6 前置治理）。

### chore
- `architecture.md` / `modules.md` 升级至 v2.1.1，补充 Reader 分层与模块生命周期描述。
- 审计登记 D-2026-25（speed.sessions 持久化结构缺失），纳入 v2.2.0。

---

## [2.1.0] - 2026-03-12

### refactor
- R-1：`reader.js` 拆分为 `reader-runtime.js` + `reader-state.js` + `reader-persistence.js` + `reader-ui.js`，入口 `reader.js` 降至 < 120 行编排层。
- R-2：子模块建立统一 `mount(context)` / `unmount()` 生命周期接口。
- R-3：消除全局变量跨模块写入，改为 `context` 显式传参。

### chore
- 删除 `DbGateway.getByFilename()` 死代码（D-2026-06 闭环）。

---

## [2.0.0] - 2026-03-12

### feat
- P-1：阅读速度 ETA 模型升级：会话加权（β=0.8 指数衰减）+ 跳读识别（weight 0.3）+ 低样本"估算中"提示（sessionCount < 3）。
- P-2：`locations.generate()` 改为 `requestIdleCallback` 调度包装，补充"准备/生成/就绪"进度文案。
- P-3：书架流式渲染：骨架屏占位 + 每书就绪立即插入，首屏骨架 < 100ms。

---

## [1.9.3] - 2026-03-11

### fix
- F-1：`storage.js` `_get/_set/_remove` 接入 `chrome.runtime.lastError` reject（P1 清零）。
- F-2：`bookMeta` 写入引入 `_bookMetaQueue` 串行队列（P2 清零）。
- F-3：`getAllHighlights()` 扩展为全量 key 扫描补全（P2 清零）。
- F-4：`reader.js` 全部 `style.display` 迁移为 class 控制（P2 清零，transform 豁免）。
- BUG-B：修复 Chrome Extension popup `display:none` 元素 `.click()` 失效问题。

### test
- F-5：补充故障注入 + 并发写 + 数据覆盖 + style.* 静态回归测试套件。
