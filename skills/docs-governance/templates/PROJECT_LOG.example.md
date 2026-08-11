# PROJECT_LOG.md —— 流水账（只追加，永不改/删旧行；新条目加到底部）

> 每件有意义的事一行：`## [日期] 类型 | 一句话`
> 类型取值：init / commit / fix / refactor / cleanup / audit / contract
> 按事件头计数；活跃事件超过 200 条时先复盘，经确认后原样归档旧事件，并从 Markdown 重建本地 SQLite 索引。数据库不是事实源，也不管理项目排期。

## [2026-06-09] init | 建立四件套治理文档
## [2026-06-10] cleanup | 删 legacy_parser.py（旧 v1，已记入 STATUS 删除区）
## [2026-06-12] refactor | 同步逻辑从 shell 搬进 services/sync.py
## [2026-06-15] audit | services/report.py 涨到 880 行超红线，标记 P0 待拆
