---
description: 对当前项目做活文档治理——扫描真实结构，识别或增量更新章程 / 地图 / 状态 / 历史等文档角色，并按需生成 Codex 的 AGENTS.md 薄桥接。
---

调用 **docs-governor** 子 agent 对**当前工作目录的项目**做活文档治理。

**分工**：本命令面向**已有代码**的项目；全新空项目请用 `/governance-init`（day-0 骨架）。

用户参数（可选）：`$ARGUMENTS`
- 不带参数：对整个项目做一次完整治理（侦察 + 识别/更新文档脊柱）。
- 带路径：只针对该子目录/模块更新地图与状态。
- 带 `log: 一句话`：只往 `PROJECT_LOG.md` 追加一条记录，不动其他文件。

执行要求：

1. 先让 docs-governor 侦察项目真实结构，**不要照模板瞎填**。
2. 先读取 `.governance/docs-map.json`（若存在）并识别现有等价载体；已有治理文件**增量更新**，不推翻重写；历史角色只追加。
3. 严守四件套非重叠纪律：每个事实只写一处。
4. 遵循用户和项目现有语言；未指定时默认 English。
5. 项目使用 Codex、已有 `AGENTS.md` 或用户要求跨宿主兼容时：从 `skills/docs-governance/templates/AGENTS.example.md` 生成或增量维护薄桥接，不复制 `CLAUDE.md` / MAP 内容。
6. 若项目是 git 仓且 `.git/hooks/pre-commit` 不存在：问用户要不要装 pre-commit 护栏（`skills/docs-governance/templates/pre-commit.example`，固化"代码改动必须同批带一行流水账"）。
7. 识别可选载体但不强制创建：稳定领域术语 → `CONTEXT.md`；难回退技术决策 → `docs/adr/`；任务与排期 → 项目已有 Issue Tracker。不要把三者塞进 STATUS 或 LOG 数据库。
8. 用 `skills/docs-governance/scripts/project-log-index.py status` 按事件数检查 LOG；超过 200 条只报告并建议先复盘，未经确认不归档。
9. 干完汇报：建/改了哪几份文件、关键内容、怎么验收。不要谎报"完成"。
