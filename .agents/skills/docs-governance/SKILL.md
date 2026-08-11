---
name: docs-governance
description: >-
  作为 ECC 文档治理能力的总入口，根据用户意图把任务路由到活文档、领域上下文与 ADR、变更影响、接口契约、测试资产、模块回归或闭环设计能力，并在大型变更中组织正确顺序。用于用户只说“文档治理”“项目治理”“帮我整理项目知识”“改完怎么收尾”而未指定具体 Skill，或需要跨多项治理能力时。English triggers: docs governance router, project knowledge governance, documentation workflow, governance workflow.
---

# 文档治理总路由

先判断意图，再读取并执行对应 Skill。不要在本路由复制各 Skill 的方法论。

## 单项路由

| 用户意图 | 路由到 |
|---|---|
| 初始化、维护、阶段同步、LOG 管理或复盘 | `living-docs-governance` |
| 领域术语、`CONTEXT.md` | `context-and-decisions` |
| 架构或数据库决策、ADR | `architecture-decision-records` |
| 修改前判断牵连面、迁移、回滚、实施后对照 | `change-impact` |
| 前后端或服务间接口 | `contract-first` |
| 测试资产、成功标准证据、Bug→TEST-ID | `test-collaboration` |
| 修改后验证本模块及下游 | `module-regression` |
| 只读文档审计、链接完整性、孤儿文档 | `living-docs-governance` 的审计模式 |
| 设计可判定目标和反馈回路 | `loop-design-check` |

## 大型变更顺序

按需执行，未触发的步骤直接跳过：

1. 用 `change-impact` 形成有证据的影响清单。
2. 若涉及难回退的架构、数据库、认证或部署决策，先用 `architecture-decision-records` 建立或更新 ADR。
3. 若影响跨端接口，先用 `contract-first` 更新唯一契约源。
4. 实施后用 `test-collaboration` 将成功标准、Bug 或风险关联到 TEST-ID 与证据。
5. 用 `module-regression` 执行本模块与下游命令。
6. 用 `living-docs-governance` 做阶段同步，再运行只读文档审计。

## When to Activate

- 用户提出宽泛的“文档治理”“项目知识整理”或长期项目收尾请求。
- 一次变更同时触及上下文、决策、契约、测试或回归中的多个环节。
- 需要判断应该调用哪项治理能力，而不是直接创建一组固定文件。

## Anti-Patterns

- 把本路由当成新方法论，复制相邻 Skill 的详细规则。
- 无视仓库已有文档布局，批量创建固定文件名或空壳目录。
- 把任务状态、业务规则和历史事实复制到多个载体。

## Related Skills

- `living-docs-governance`：项目文档脊柱与生命周期。
- `architecture-decision-records`：ADR 方法论。
- `contract-first`：机器可检查的跨端契约。
- `ai-regression-testing`：关键缺陷的可执行回归测试。
- `change-impact`、`test-collaboration`、`module-regression`：本系统新增的影响、证据与下游回归能力。

## 边界

- 让 `CLAUDE_MAP.md` 管项目知识位置；本 Skill 只管插件能力路由。
- 让 Spec/Issue 管业务成功标准，Issue Tracker 管任务状态和排期；不要复制进路由或数据库。
- 不因为用户说“治理”就一次性创建所有可选文档和目录。先发现现有事实载体，再按预警信号懒创建。
