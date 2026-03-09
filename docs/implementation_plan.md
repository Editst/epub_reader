# v1.2.4 严重 BUG 紧急修复方案 (IndexedDB 数据库降级拒绝错误)

## 🚨 问题定位
* **故障现象1**：点击主页书籍报错 `Uncaught (in promise) VersionError: The requested version (2) is less than the existing version (3).`，导致书籍完全无法加载。
* **故障现象2**：主页和弹窗（Popup）中所有书籍的封面全部丢失。

## 🔍 深度病灶剖析 (Root Cause Analysis)
这是典型的**数据库版本分裂（Schema Versioning Splinter）**问题，由我们在 v1.2.2 进行的底盘存储大改造直接引发。

在 v1.2.2 的架构升级中，为了突破存储极限，我们将高达百万字节的 `Locations`（书籍进度地图）从 Chrome 的限制缓存中搬迁进了 `IndexedDB` 数据库。为了在现有的数据库中新建 `locations` 数据表，我们在保存进度时执行了数据库升级命令：
`indexedDB.open('EpubReaderDB', 3)` 
这使得整个阅读器底层的 IndexedDB 被永久升级到了 **V3 版本**。

**巨大的隐患在于**：
散落在整个系统中的其他数十处数据库调用代码（包括专门负责读取封面、加载实体文件、主页初始化、Popup弹窗等的代码），在历史上被硬编码为了 `indexedDB.open('EpubReaderDB', 2)`。由于浏览器 IndexedDB 具备严格的安全降级保护机制，当这些老旧的代码尝试用 V2 的身份去请求已经进化为 V3 的数据库时，底层直接拦截并抛出了致命错误 (`VersionError`)。
这就是为什么您的封面不显示了（读封面报错），以及主页点不开旧书的原因（读取实体文件报错）。

## 🛠️ 终极拔根修复方案
我们不再打任何局部补丁，而是立刻进行全球范围的**数据库代码清洗与版本统配**：

1. **版本维度大一统 (Version Alignment)**：
   全局扫描 `home.js`、`popup.js`、`reader.js` 以及核心引擎 `storage.js` 中的每一次 `indexedDB.open` 调用。将所有硬编码的 `2` 统一升级拔高至 `3`。

2. **建表自愈机制补完 (Schema Healing)**：
   原来写在 `onupgradeneeded` 升级钩子里的只包含创建 `files` 和 `covers` 两个旧表的代码。这会造成如果一个新用户安装插件，从某些页面触发了数据库新建，会导致 `locations` 表漏建的致命死循环。
   我将为全域每一个升级钩子强制补齐第三块代码块：
   `if (!db.objectStoreNames.contains('locations')) db.createObjectStore('locations', { keyPath: 'id' });`
   确保无论从哪个入口启动，数据库的三架马车 (`files`, `covers`, `locations`) 都能坚固地同时落地。

请审阅此方案并授权执行，我将立即进入 `EXECUTION` 模式实施全球大扫除。
