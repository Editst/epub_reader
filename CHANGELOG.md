# CHANGELOG

所有重要变更记录于此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

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
