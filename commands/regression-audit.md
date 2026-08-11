---
description: 模块回归审计——改完代码后照 REGRESSION.md 台账跑"本模块+全部下游"的验收命令，退出码终审，防"改一个模块悄悄弄坏其他模块"。带 init 参数时扫 import 关系生成台账草稿。
argument-hint: "[init | 模块名 | 留空=按 git 改动自动定位]"
---

调用 **regression-auditor** 子 agent 对**当前工作目录的项目**做模块回归审计。方法论唯一源在 `skills/module-regression/SKILL.md`。

用户参数：`$ARGUMENTS`

## 三种用法

**1. `/regression-audit`（日常，改完就跑）**
按 `git status -s` / `git diff --name-only` 自动定位本次改动涉及的模块 → 查台账下游 → 跑"本模块 + 全部下游"的验收命令 → 出红绿审计摘要。**任何一条红 = 不可交付**。

**2. `/regression-audit 模块名`**
跳过自动定位，直接对指定模块及其下游做回归。

**3. `/regression-audit init`（首跑建台账）**
项目还没有 `REGRESSION.md` 时：
- 优先调用仓库已有依赖图或构建工具；没有时选择适合当前语言的可复现扫描命令，按模块聚合出“谁依赖谁”，并把命令和未验证边记录进台账；本命令不声称一个通用扫描器能解析所有生态；
- **验收命令留空待填**——先从项目现有 tests/ 和对账脚本里找候选填入并标"待确认"，找不到的模块如实标"缺验收命令"（这是台账缺口，不许编）；
- 生成后提示用户逐模块确认验收命令，并在项目 `CLAUDE.md` 挂指路牌。
- 模板参考 `skills/module-regression/templates/REGRESSION.example.md`。

## 执行要求

1. 台账不存在且不是 init → 报告并建议先跑 init，不要瞎猜依赖关系。
2. 审计员**只跑只报不修**；红了给出哪红、为什么红，修复由主会话完成后**重跑本命令**直到全绿。
3. 全绿后提醒：本次审计结果值得一行 `PROJECT_LOG.md`（有 pre-commit 护栏的项目 commit 时自然会要求）。
4. 汇报用审计摘要表格（模块/命令/退出码/结论），不要谎报"完成"。
