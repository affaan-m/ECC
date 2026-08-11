---
name: change-impact
description: >-
  在改代码、数据、接口或治理文档前做有证据的影响分析，并在实施后把计划影响与实际 diff 对照；覆盖代码调用、数据/Schema、API 契约、测试、文档、ADR、部署、迁移和回滚。用于跨模块修改、高风险变更、数据库迁移、认证、公共接口、用户问“会影响哪里”“改之前检查一下”或实施后需要反思偏差时。English triggers: change impact analysis, blast radius, pre-change analysis, migration impact, rollback plan, post-implementation alignment.
---

# 变更影响分析

默认只读。先用真实依赖与现有文档证明影响面，再实施；未知项明确标“未验证”。

## 修改前

依次回答：

1. **代码**：入口、直接调用方、下游消费者、生成物和兼容层会受什么影响？
2. **数据**：Schema、迁移、历史数据、序列化、缓存和幂等键是否变化？
3. **接口**：API、消息、文件格式或 CLI 是否改变？消费者和提供者分别是谁？
4. **测试**：哪些成功标准、TEST-ID、契约测试和回归命令应证明变更正确？
5. **文档**：是否影响 MAP、STATUS、LOG、CONTEXT、ADR、CONTRACT、Spec/Plan、TESTS 或 REGRESSION？
6. **发布**：部署顺序、兼容窗口、数据恢复、回滚命令和不可逆部分是什么？

证据优先取自真实 import/调用、路由、Schema、配置、生成脚本、`git grep`、`git diff` 和可执行测试。不要凭目录名猜依赖。

## 路由规则

- 架构、数据库、认证、部署拓扑或长期技术策略：检查 `context-and-decisions` / ADR。
- 跨端接口：先更新 `contract-first` 管理的唯一契约源，再规划消费者、提供者和联调证据。
- 需求、业务规则、风险或 Bug：让成功标准保留在 Spec/Issue，并用 `test-collaboration` 关联 TEST-ID。
- 模块行为或依赖变化：实施后运行 `module-regression`。
- 数据库迁移、破坏性接口、认证和生产发布：必须写回滚条件、恢复步骤、兼容期和不可逆部分；缺任何一项就标为阻塞，不代替人执行回滚。

## 输出

小改动在回复中给出：影响对象、证据、所需验证、文档同步和未知项。只有跨模块、高风险或用户明确要求留档时，才把报告写入 `docs/impacts/`；写文件前先确认，避免制造一次性文档。

## 实施后对照

完成实现后检查：

1. 实际改动是否解决 Spec/Issue 中的原始问题。
2. 实际 diff 是否超出已声明范围；超出项是否获得授权并补充影响分析。
3. 测试和人工证据是否真正覆盖成功标准，而非只证明命令运行过。
4. CONTEXT、ADR、CONTRACT、TESTS、REGRESSION、MAP、STATUS 和 LOG 是否按实际变化同步。
5. 是否遗留临时代码、兼容逻辑、迁移尾项或后续 Issue。

默认在交付回复中报告对照结论。只有高风险变更或用户要求正式评审时，才保存到 `docs/reviews/`。不要创建通用 `REFLECTION.md`。
