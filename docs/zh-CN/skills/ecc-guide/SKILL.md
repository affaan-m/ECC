---
name: ecc-guide
description: 在回答之前先读取仓库的实时状态，引导用户了解 ECC 当前的 agents、skills、命令、hooks、规则、安装配置档案以及项目接入流程。
origin: community
---

# ECC 指南

当用户需要帮助来理解、浏览、安装 Everything Claude Code 或在其中做选择时，使用此技能。

## 何时使用

当用户出现以下情况时使用此技能：

- 询问 ECC 包含哪些内容
- 需要帮助查找某个 skill、命令、agent、hook、规则或安装配置档案
- 刚接触本仓库，需要一条引导路径
- 询问"如何用 ECC 做 X？"
- 询问哪些 ECC 组件适合某个项目
- 需要简单了解命令、skills、agents、hooks 和规则之间的关系
- 对安装路径、重复安装、重置/卸载或选择性安装选项感到困惑

## 核心原则

依据当前文件回答，而不是凭记忆。ECC 变化很快，硬编码的目录数量、功能列表和安装说明都会过时。

当 ECC 仓库可用时，先检查相关文件再给出具体答案：

```bash
node scripts/ci/catalog.js --json
find skills -maxdepth 2 -name SKILL.md | sort
find commands -maxdepth 1 -name '*.md' | sort
find agents -maxdepth 1 -name '*.md' | sort
node scripts/install-plan.js --list-profiles
node scripts/install-plan.js --list-components --json
```

只读取回答用户问题所需的最小文件集。

## 仓库地图

- `README.md`：安装路径、卸载/重置指引、对外定位、常见问题
- `AGENTS.md`：贡献者指引和项目结构
- `agent.yaml`：导出的 gitagent 接口和命令列表
- `commands/`：持续维护的斜杠命令兼容垫片
- `skills/*/SKILL.md`：可复用的工作流和领域手册
- `agents/*.md`：用于委派的子代理角色提示词
- `rules/`：语言规则和运行环境规则
- `hooks/README.md`、`hooks/hooks.json`、`scripts/hooks/`：hook 行为和安全门控
- `manifests/install-*.json`：选择性安装的模块、组件、配置档案和目标支持
- `docs/`：运行环境指南、架构笔记、翻译文档、发布文档

## 回复风格

先给答案，再给下一步动作。大多数用户不需要完整的目录倾倒。

良好的首次回复结构：

1. 用什么
2. 为什么合适
3. 要查看的确切文件或命令
4. 一个后续命令或问题

避免：

- 默认列出所有 skill 或命令
- 重复 README 的大段内容
- 在已有 skill 优先路径时仍推荐已退役的命令垫片
- 未检查文件系统就声称某个组件存在
- 在托管安装器支持目标环境时，用手动复制命令代替安装指引

## 常见任务

### 新用户入门

给出一份简短菜单：

- 安装或重置 ECC
- 为项目挑选 skills
- 理解命令与 skills 的区别
- 检查 hooks 和安全行为
- 运行一次运行环境审计
- 查找某个特定工作流

安装/重置指向 `README.md`，项目级接入指向 `/project-init`。

### 功能发现

对于"我该用什么来做 X？"：

1. 搜索 `skills/`、`commands/` 和 `agents/`。
2. 优先把 skills 作为主要工作流入口。
3. 仅当命令是持续维护的兼容垫片、或用户明确想要斜杠命令行为时才使用命令。
4. 当委派有价值时提及 agents。

有用的搜索：

```bash
rg -n "<query>" skills commands agents docs
find skills -maxdepth 2 -name SKILL.md | sort
```

### 安装指引

使用托管安装路径：

```bash
node scripts/install-plan.js --list-profiles
node scripts/install-plan.js --profile minimal --target claude --json
node scripts/install-apply.js --profile minimal --target claude --dry-run
```

针对特定 skill 的安装：

```bash
node scripts/install-plan.js --skills <skill-id> --target claude --json
node scripts/install-apply.js --skills <skill-id> --target claude --dry-run
```

提醒用户不要同时叠加插件安装和完整的手动/档案安装，除非他们有意要重复的组件面。

### 项目接入

当用户想为目标仓库配置 ECC 时，使用 `/project-init`。预期顺序为：

1. 从项目文件检测技术栈
2. 生成一份 dry-run 安装计划
3. 检查现有的 `CLAUDE.md` 和设置文件
4. 在应用更改前先询问
5. 保持生成的指引精简且针对该仓库

### 故障排查

先询问目标运行环境和安装路径，然后检查：

- 插件安装元数据
- `.claude/`、`.cursor/`、`.codex/`、`.gemini/`、`.opencode/`、`.codebuddy/`、`.joycode/` 或 `.qwen/`
- `hooks/hooks.json`
- 安装状态文件
- 相关的命令/skill 文件

针对仓库健康度，建议：

```bash
npm run harness:audit -- --format text
npm run observability:ready
npm test
```

## 输出模板

### 简短推荐

```text
Use <skill-or-command>. It fits because <reason>.

Canonical file: <path>
Verify with: <command>
Next: <one concrete action>
```

### 搜索结果

```text
Best matches:
- <path>: <why it matters>
- <path>: <why it matters>

Recommendation: <which one to use first and why>
```

### 安装计划摘要

```text
Detected: <stack evidence>
Target: <harness>
Plan: <profile/modules/skills>
Dry run: <command>
Would change: <paths>
Needs approval before apply: <yes/no>
```

## 相关入口

- `/project-init`：面向目标仓库的技术栈感知接入计划
- `/harness-audit`：确定性的就绪度评分卡
- `/skill-health`：skill 质量审查
- `/skill-create`：从本地 git 历史生成新 skill
- `/security-scan`：检查 Claude/OpenCode 配置安全性
