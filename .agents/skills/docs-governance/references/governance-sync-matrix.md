# 文档治理变更影响矩阵

阶段收尾或用户说"同步一下 / 整理一下 / 收尾 / 新人能接手"时，用这张表判断本次改动应同步哪些治理文件。

核心纪律：`PROJECT_LOG.md` 是历史，只追加；`CLAUDE_MAP.md` / `PROJECT_STATUS.md` / `CLAUDE.md` 是当前真相，要修正旧事实、合并重复、删除过期内容。

## 代码 / 项目变化 -> 治理文件

| 本次发生的事 | 必须检查 / 更新 |
|---|---|
| 新增、删除、改名顶层目录或核心模块 | `CLAUDE_MAP.md` 顶层结构、跳转表、依赖方向；`PROJECT_LOG.md` 追加结构变更 |
| 新增入口文件、命令、脚本、服务端口 | `CLAUDE_MAP.md` 入口表；README 运行说明；`PROJECT_LOG.md` 追加 |
| 新增或改变测试方式 | `PROJECT_STATUS.md` 测试健康指标；`CLAUDE.md` 验证硬规则（仅当成为长期规则）；`PROJECT_LOG.md` 追加 |
| 指标越过阈值（行数、覆盖率、测试缺失、依赖风险） | `PROJECT_STATUS.md` 指标与 P0/P1 行动；`PROJECT_LOG.md` 追加 audit/fix |
| 故意删除文件、废弃模块、清理备份目录 | `PROJECT_STATUS.md` 删除区（路径、原因、日期、替代物）；`PROJECT_LOG.md` 追加 cleanup |
| 新增硬规则、编码约束、不可违背流程 | `CLAUDE.md`；必要时链接到 docs；`PROJECT_LOG.md` 追加 governance |
| README、docs、代码结构互相矛盾 | 修正当前真相所在文件；不要只在 LOG 里解释；`PROJECT_LOG.md` 可追加 audit/fix |
| 新增环境变量、密钥配置、部署参数 | `CLAUDE.md` 或 README 的配置指路；`PROJECT_STATUS.md` 风险项（如密钥/公网）；`PROJECT_LOG.md` 追加 |
| 新增业务流程、用户动线、页面或视图 | `CLAUDE_MAP.md` 找 X 去这里；README 演示/运行说明（如面向人类用户）；`PROJECT_LOG.md` 追加 |
| 新增 API / 路由 / 前后端字段变化 | `CONTRACT.md`（若存在）；`CLAUDE_MAP.md` 前端入口 / API 封装 / 后端路由位置；`PROJECT_LOG.md` 追加 contract |
| 新增接口但项目尚无 `CONTRACT.md` | 报告建议创建 `CONTRACT.md`；不要把字段细节塞进 `CLAUDE_MAP.md` |
| 领域术语、概念关系或采用口径变化 | `CONTEXT.md`（若已启用）；证据未确认时只列待确认，不改代码口径 |
| 架构、数据库、认证、部署、数据模型或 API 版本等难回退决策 | `docs/adr/` 新建/更新单项 ADR；`docs/adr/README.md` 更新索引；MAP 只挂索引入口；LOG 追加 decision |
| 成功标准、需求或 Bug 变化 | 原始 Spec/Issue 保持唯一来源；`TESTS.md` 关联 TEST-ID/人工出口；不要复制标准 |
| 模块行为或下游依赖变化 | `REGRESSION.md` 的下游与执行命令；相关 TEST-ID；实施后跑本模块和下游 |
| 数据迁移、破坏性接口或高风险发布 | 变更影响报告中的兼容期、迁移/恢复/回滚和不可逆部分；必要时 ADR / CONTRACT |
| 任务负责人、阻塞或项目排期变化 | Issue Tracker；STATUS 只在健康风险变化时更新，LOG 数据库不存排期 |

## 四件套职责回查

| 文档 | 收尾时问自己 |
|---|---|
| `CLAUDE.md` | 本次是否产生长期硬规则？是否有细节应挪到 MAP/STATUS/LOG？ |
| `CLAUDE_MAP.md` | 新人是否能从这里找到入口、模块、测试、关键文件？路径是否真实存在？ |
| `PROJECT_STATUS.md` | 当前风险、健康指标、待删区是否反映真实状态？指标是否量过？ |
| `PROJECT_LOG.md` | 本次有意义的变更是否追加一行？是否避免改旧历史？ |
| `CONTRACT.md` | 前后端字段、类型、枚举、错误码是否只有这里定义一次？ |
| `CONTEXT.md`（可选） | 是否只写稳定领域语言，且与代码/契约证据一致？ |
| `docs/adr/`（可选） | 难回退决策是否一项一文件、状态与索引一致、写明可逆性？ |
| `TESTS.md`（可选） | 成功标准是否链接回 Spec/Issue，证据是否关联 TEST-ID？ |
| `REGRESSION.md`（可选） | 实际受影响模块及下游是否有可执行命令并已运行？ |

## 收尾同步流程

1. 盘点本次改动：优先看会话记录、`git status -s`、最近修改文件、用户明确说过的完成项。
2. 对照上表列出"应更新文档"。
3. 对每份治理文件判断：已同步 / 需要更新 / 需要用户确认。
4. 能确定的当前真相直接更新；不能确定的列入交付摘要的"待确认"。
5. 故意删除或废弃的东西必须进 `PROJECT_STATUS.md` 删除区，避免下个 agent 重建。
6. 最后追加 `PROJECT_LOG.md`，记录这次同步本身或本次阶段成果。
7. 若有变更影响分析，对照实际 diff，报告超范围改动、未验证项和临时兼容逻辑。

## 不要做

- 不要把所有内容都追加到 `CLAUDE.md`；它只放硬规则和路标。
- 不要把接口字段细节放进 `CLAUDE_MAP.md`；字段契约放 `CONTRACT.md`。
- 不要用 `PROJECT_LOG.md` 替代当前状态修正；LOG 只解释历史。
- 不要为了"看起来完整"编造没量过的指标。
- 不要把排期和任务状态搬进 STATUS、LOG 或 SQLite；沿用项目已有 Issue Tracker。
