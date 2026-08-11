---
name: context-and-decisions
description: >-
  管理项目稳定领域上下文与难回退决策：按需建立边界严格的 CONTEXT.md，并用 docs/adr/README.md 统一索引、一项决策一个 ADR 文件。用于领域术语反复解释、同词异义、架构或数据库选型、认证/部署/数据模型/API 版本策略、需要记录为什么这样做及如何退出时。English triggers: domain context, context governance, architecture decision record, ADR, database decision, architectural decision.
---

# 领域上下文与决策

把“业务里这些词是什么意思”和“为什么选择这个方案”分开管理。没有稳定内容时不要创建空壳。

## `CONTEXT.md`：只管领域语言

在术语反复解释、同词异义或模块边界因语言不清而出错时，使用本 Skill 的 `templates/context.example.md` 懒创建根目录 `CONTEXT.md`。

只记录：

- 领域术语及精确定义；
- 核心概念之间的关系；
- 已确认的歧义与采用口径；
- 仍待业务方确认的歧义。

禁止写入：实现细节、当前状态、任务排期、需求全文、决策理由和历史。对应内容分别回到代码/MAP、STATUS/Issue Tracker、Spec、ADR、LOG。术语必须能和代码、契约或业务证据对照；不能确认就标“待确认”，不要猜。

## `docs/adr/`：一项决策一个文件

首次出现难回退决策时，创建：

- `docs/adr/README.md`：薄索引，只列编号、标题、状态和链接；
- 一项决策一份编号文件（例如 `0001-use-postgresql.md`），套用本 Skill 的 `templates/adr.example.md`。

使用连续四位编号。状态只允许 `proposed`、`accepted`、`deprecated`、`superseded`。ADR 至少包含：Context、Decision、Alternatives、Reason、Consequences、Status、Related、Supersedes。

以下变化默认检查是否需要 ADR：架构边界、数据库或存储、认证授权、部署拓扑、数据模型、API 版本策略、跨模块技术选型。普通实现细节、易回退的小改动和当天临时实验不要写 ADR。

## 决策流程

1. 先读取现有 `CONTEXT.md`、`docs/adr/README.md` 和相关 ADR，避免重复决策。
2. 用真实约束写 Context；列出确实讨论过的 Alternatives，不补写虚构方案。
3. 在 Decision 与 Reason 中区分“选了什么”和“为什么选”。
4. 在 Consequences 中写收益、代价、可逆性、迁移与退出路径；不可逆部分明确标出。
5. 用 Related 链接 Spec/Issue、CONTRACT、TEST-ID、提交或代码位置。
6. 新决策替代旧决策时，新 ADR 填 Supersedes，旧 ADR 改为 `superseded` 并互相链接；不要删除旧记录。
7. 更新 `docs/adr/README.md`，并从 `CLAUDE_MAP.md` 只挂 ADR 索引入口，不枚举每个 ADR。
8. 在 `PROJECT_LOG.md` 追加一条决策事件。

## 排期与任务边界

让 GitHub Issues、Linear 或项目已有 Tracker 成为任务、状态、阻塞和排期的唯一事实源。只有项目没有外部 Tracker 时，才按项目约定使用本地 `.scratch/`；不要把排期塞进 `CONTEXT.md`、ADR、PROJECT_STATUS 或日志数据库。
