---
name: context-and-decisions
description: >-
  管理项目稳定领域上下文：按需建立边界严格的 CONTEXT.md，并在出现难回退决策时路由到 ECC 现有的 architecture-decision-records skill。用于领域术语反复解释、同词异义、模块边界因语言不清而出错，或需要把领域语义与架构决策分开管理时。English triggers: domain context, context governance, domain terminology, ubiquitous language, architecture decision handoff.
---

# 领域上下文与决策交接

把“业务里这些词是什么意思”和“为什么选择这个方案”分开管理。没有稳定内容时不要创建空壳。

## `CONTEXT.md`：只管领域语言

在术语反复解释、同词异义或模块边界因语言不清而出错时，使用本 Skill 的 `templates/context.example.md` 懒创建根目录 `CONTEXT.md`。

只记录：

- 领域术语及精确定义；
- 核心概念之间的关系；
- 已确认的歧义与采用口径；
- 仍待业务方确认的歧义。

禁止写入：实现细节、当前状态、任务排期、需求全文、决策理由和历史。对应内容分别回到代码/MAP、STATUS/Issue Tracker、Spec、ADR、LOG。术语必须能和代码、契约或业务证据对照；不能确认就标“待确认”，不要猜。

## ADR 交接：复用现有能力

本 Skill 不定义第二套 ADR 目录、编号、状态或模板。首次出现难回退、未来缺少背景会困惑、且存在真实权衡的决策时：

1. 读取并执行 `architecture-decision-records`，采用仓库已有 ADR 位置与格式。
2. 没有既有约定时，也让该 Skill 决定最小落点；不要由本 Skill另起一套。
3. 从 `CONTEXT.md`、项目地图或相关 Spec/Issue 链接到 ADR，而不是复制决策正文。
4. 决策被接受、替代或废弃后，按活文档规则向项目历史追加事件。

普通实现细节、易回退的小改动和当天临时实验不需要 ADR。

## When to Activate

- 领域术语被反复解释或同词异义导致实现偏差。
- 项目需要一个稳定的领域语言入口，但尚无等价文档。
- 上下文整理过程中发现需要交给 `architecture-decision-records` 的长期决策。

## Anti-Patterns

- 把当前任务、排期、需求全文或实现细节复制进 `CONTEXT.md`。
- 为了“完整”创建空白上下文或第二套 ADR 体系。
- 把未确认的业务口径写成事实，或把 ADR 正文复制进地图和日志。

## Related Skills

- `architecture-decision-records`：难回退决策的唯一 ADR 方法论。
- `living-docs-governance`：项目地图、状态和历史的生命周期维护。
- `docs-governance`：跨能力路由与收尾顺序。

## 排期与任务边界

让 GitHub Issues、Linear 或项目已有 Tracker 成为任务、状态、阻塞和排期的唯一事实源。只有项目没有外部 Tracker 时，才按项目约定使用本地 `.scratch/`；不要把排期塞进 `CONTEXT.md`、ADR、PROJECT_STATUS 或日志数据库。
