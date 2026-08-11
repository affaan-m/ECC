---
description: 阶段收尾时同步项目治理文档：根据实际 diff 查漏补缺脊柱、CONTEXT、ADR、CONTRACT、TESTS 与 REGRESSION，并核对 Issue Tracker 引用。
argument-hint: "[本阶段完成了什么]"
---

调用 **docs-governor** 子 agent，对当前工作目录做一次**阶段收尾同步**。

用户参数（可选）：`$ARGUMENTS`
- 不带参数：根据当前项目状态、最近变更和治理文档做查漏补缺。
- 带一句话：把这句话作为本阶段完成事项，例如 `完成答题点亮链路`。
- 带 `contract`：重点检查本阶段是否需要同步 `CONTRACT.md`。

执行要求：

1. 先读 `living-docs-governance` skill 和 `skills/docs-governance/references/governance-sync-matrix.md`。
2. 盘点本阶段变化：会话上下文、最近修改文件、项目结构、已有四件套。
3. 按矩阵判断应同步哪些文件：
   - 结构变化 → `CLAUDE_MAP.md`
   - 健康/风险/待删 → `PROJECT_STATUS.md`
   - 长期硬规则 → `CLAUDE.md`
   - 有意义事件 → `PROJECT_LOG.md`
   - 接口字段变化 → `CONTRACT.md`
   - 领域术语变化 → `CONTEXT.md`（若已启用）
   - 难回退技术决策 → `docs/adr/`
   - 成功标准与证据 → Spec/Issue + `TESTS.md`
   - 模块行为与下游命令 → `REGRESSION.md`
4. 能确定的当前真相直接增量更新；不确定的列入“待用户确认”，不要编。
5. 对照 `change-impact` 的计划影响与实际 diff，报告超范围改动、未验证项和临时兼容逻辑。
6. `PROJECT_LOG.md` 只追加；只有超过 200 条且用户确认时，才用确定性脚本原样归档。
7. 交付时列出：实际改了哪些文档、每份为什么改、哪些没改、哪些需要人工确认。
