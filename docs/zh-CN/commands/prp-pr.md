---
description: "从当前分支创建包含未推送提交的 GitHub PR — 发现模板、分析更改、推送"
argument-hint: "[base-branch] (default: main)"
---

# 创建拉取请求

> 改编自 Wirasm 的 PRPs-agentic-eng。属于 PRP 工作流系列的一部分。

**输入**：`$ARGUMENTS` — 可选，可包含基础分支名称和/或标志（例如 `--draft`）。

**解析 `$ARGUMENTS`**：

* 提取所有可识别的标志（`--draft`）
* 将剩余的非标志文本视为基础分支名称
* 若未指定，默认基础分支为 `main`

***

## 阶段 1 — 验证

检查前置条件：

```bash
git branch --show-current
git status --short
git log origin/<base>..HEAD --oneline
```

| 检查项 | 条件 | 失败时的操作 |
|---|---|---|
| 不在基础分支上 | 当前分支 ≠ 基础分支 | 停止："请先切换到功能分支。" |
| 工作目录干净 | 无未提交的更改 | 警告："存在未提交的更改。请先提交或暂存。使用 `/prp-commit` 提交。" |
| 存在领先提交 | `git log origin/<base>..HEAD` 不为空 | 停止："`<base>` 前无提交。无需创建 PR。" |
| 无现有 PR | `gh pr list --head <branch> --json number` 为空 | 停止："PR 已存在：#<编号>。使用 `gh pr view <number> --web` 打开。" |

若所有检查通过，继续执行。

***

## 阶段 2 — 发现

### PR 模板

按顺序搜索 PR 模板：

1. `.github/PULL_REQUEST_TEMPLATE/` 目录 — 若存在，列出文件并让用户选择（或使用 `default.md`）
2. `.github/PULL_REQUEST_TEMPLATE.md`
3. `.github/pull_request_template.md`
4. `docs/pull_request_template.md`

若找到，读取并使用其结构作为 PR 正文。

### 提交分析

```bash
git log origin/<base>..HEAD --format="%h %s" --reverse
```

分析提交以确定：

* **PR 标题**：使用带类型前缀的常规提交格式 — `feat: ...`、`fix: ...` 等。
  * 若存在多种类型，使用主导类型
  * 若为单个提交，直接使用其消息
* **变更摘要**：按类型/领域对提交进行分组

### 文件分析

```bash
git diff origin/<base>..HEAD --stat
git diff origin/<base>..HEAD --name-only
```

对变更文件进行分类：源代码、测试、文档、配置、迁移。

### PRP 工件

检查相关的 PRP 工件：

* `.claude/PRPs/reports/` — 实现报告
* `.claude/PRPs/plans/` — 已执行的计划
* `.claude/PRPs/prds/` — 相关 PRD

若存在，在 PR 正文中引用它们。

***

## 阶段 3 — 推送

```bash
git push -u origin HEAD
```

若推送因分歧失败：

```bash
git fetch origin
git rebase origin/<base>
git push -u origin HEAD
```

若变基发生冲突，停止并通知用户。

***

## 阶段 4 — 创建

### 使用模板

若在阶段 2 中找到 PR 模板，使用提交和文件分析填充每个部分。保留所有模板部分 — 若不适用，将部分留为"不适用"而非删除。

### 无模板

使用以下默认格式：

```markdown
## 摘要

<用1-2句话描述此PR的功能及原因>

## 变更内容

<bulleted list of changes grouped by area>

## 文件变更

<table or list of changed files with change type: Added/Modified/Deleted>

## 测试说明

<描述变更的测试方式，或填写"需要测试">

## 相关问题

<关联问题，使用Closes/Fixes/Relates to #N格式，或填写"无">
```

### 创建 PR

```bash
gh pr create \
  --title "<PR title>" \
  --base <base-branch> \
  --body "<PR body>"
  # Add --draft if the --draft flag was parsed from $ARGUMENTS
```

***

## 阶段 5 — 验证

```bash
gh pr view --json number,url,title,state,baseRefName,headRefName,additions,deletions,changedFiles
gh pr checks --json name,status,conclusion 2>/dev/null || true
```

***

## 阶段 6 — 输出

向用户报告：

```
PR #<number>: <标题>
URL: <网址>
分支: <源分支> → <目标分支>
变更: 共<文件数>个文件，新增<添加行数>行，删除<删除行数>行

CI 检查: <状态摘要 或 "待处理" 或 "未配置">

引用的构建产物:
  - <PR 正文中链接的任何 PRP 报告/计划>

后续步骤:
  - gh pr view <编号> --web   → 在浏览器中打开
  - /code-review <编号>       → 审查该 PR
  - gh pr merge <编号>        → 准备就绪后合并
```

***

## 边界情况

* **无 `gh` CLI**：停止并提示："需要 GitHub CLI（`gh`）。安装地址：<https://cli.github.com/>"
* **未认证**：停止并提示："请先运行 `gh auth login`。"
* **需要强制推送**：若远程已分歧且已完成变基，使用 `git push --force-with-lease`（切勿使用 `--force`）。
* **多个 PR 模板**：若 `.github/PULL_REQUEST_TEMPLATE/` 包含多个文件，列出并让用户选择。
* **大型 PR（超过 20 个文件）**：警告 PR 规模。若变更逻辑上可分离，建议拆分。
