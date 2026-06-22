# Architecture Decision Record (ADR) 001: enforceFileLRU 数据淘汰范围设计

## 状态
已确认 (2026-06-22)

## 背景
在发现 `EpubStorage.enforceFileLRU` 逻辑在清理超额 EPUB 文件时，只清理了 `files`、`recentBooks` 和 `bookMeta` 表中的数据，但遗留了 `highlights` (标注)、`bookmarks` (书签)、`covers` (封面) 以及 `locations` (定位) 数据。初期认为这是一个级联删除未实现的 bug（即孤立数据泄漏）。

## 决策
确认**这并非 Bug，而是有意设计**。

`enforceFileLRU` 主要目的是**释放本地存储空间**（尤其是清理占据绝大部分存储的 `files` 文件数据和 `locations` 大块缓存）。而用户在阅读过程中产生的笔记 (highlights)、进度书签 (bookmarks) 属于**高价值数据**。即使用户长时间不看该书导致该书被 LRU 机制淘汰，这些记录也必须被持久保留。

- 当用户再次导入同一本书时，由于数据通过 `bookId` (hash) 挂载，原有的笔记和书签能立即无缝找回。
- 只有通过 `EpubStorage.removeBook` 用户**主动确认**删除书籍时，才会执行彻底的全表级联删除。

## 后果
- 优点：极大保障了用户的数据安全性，即便遭遇磁盘空间不足触发被动回收，用户的心血（高亮笔记）依然存在，也能够被正常导出到 Markdown。
- 缺点：`highlights_` / `bookmarks_` 对应的键会在数据库中持久驻留，即使对应的实体文件不存在。这些文本数据体积非常小（通常每本 KB 级），对性能与空间的负面影响可以忽略不计。

## 备注
在开发和代码审查过程中，需始终区分：
1. **被动淘汰 (LRU)**: 只删源文件与缓存 (`files`, `recentBooks`, `bookMeta`)。
2. **主动删除 (User Action)**: 使用 `removeBook` 彻底清除所有关联记录。
