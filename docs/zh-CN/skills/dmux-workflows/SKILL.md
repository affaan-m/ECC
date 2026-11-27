---
name: dmux-workflows
description: 使用dmux（AI代理的tmux窗格管理器）进行多代理编排。跨Claude Code、Codex、OpenCode及其他工具的并行代理工作流模式。适用于并行运行多个代理会话或协调多代理开发工作流时。
origin: ECC
---

# dmux 工作流

使用 dmux（一个用于代理套件的 tmux 窗格管理器）来编排并行的 AI 代理会话。

## 何时激活

* 并行运行多个代理会话时
* 跨 Claude Code、Codex 和其他套件协调工作时
* 需要分而治之并行处理的复杂任务
* 用户提到“并行运行”、“拆分此工作”、“使用 dmux”或“多代理”时

## 什么是 dmux

dmux 是一个基于 tmux 的编排工具，用于管理 AI 代理窗格：

* 按 `n` 创建一个带有提示的新窗格
* 按 `m` 将窗格输出合并回主会话
* 支持：Claude Code、Codex、OpenCode、Cline、Gemini、Qwen

**安装：** `npm install -g dmux` 或参见 [github.com/standardagents/dmux](https://github.com/standardagents/dmux)

## 快速开始

```bash
# Start dmux session
dmux

# Create agent panes (press 'n' in dmux, then type prompt)
# Pane 1: "Implement the auth middleware in src/auth/"
# Pane 2: "Write tests for the user service"
# Pane 3: "Update API documentation"

# Each pane runs its own agent session
# Press 'm' to merge results back
```

## 工作流模式

### 模式 1：研究 + 实现

将研究和实现拆分为并行轨道：

```
Pane 1 (Research): "研究 Node.js 中速率限制的最佳实践。
  检查当前可用的库，比较不同方法，并将研究结果写入
  /tmp/rate-limit-research.md"

Pane 2 (Implement): "为我们的 Express API 实现速率限制中间件。
  先从基本的令牌桶算法开始，研究完成后我们将进一步优化。"

# Pane 1 完成后，将研究结果合并到 Pane 2 的上下文中
```

### 模式 2：多文件功能

在独立文件间并行工作：

```
Pane 1: "创建计费功能的数据库模式和迁移"
Pane 2: "在 src/api/billing/ 中构建计费 API 端点"
Pane 3: "创建计费仪表板 UI 组件"

# 合并所有内容，然后在主面板中进行集成
```

### 模式 3：测试 + 修复循环

在一个窗格中运行测试，在另一个窗格中修复：

```
窗格 1（观察者）：“在监视模式下运行测试套件。当测试失败时，
  总结失败原因。”

窗格 2（修复者）：“根据窗格 1 的错误输出修复失败的测试”
```

### 模式 4：跨套件

为不同任务使用不同的 AI 工具：

```
Pane 1 (Claude Code): "Review the security of the auth module"
Pane 2 (Codex): "Refactor the utility functions for performance"
Pane 3 (Claude Code): "Write E2E tests for the checkout flow"
```

### 模式 5：代码审查流水线

并行审查视角：

```
Pane 1: "审查 src/api/ 中的安全漏洞"
Pane 2: "审查 src/api/ 中的性能问题"
Pane 3: "审查 src/api/ 中的测试覆盖缺口"

# 将所有审查合并为一份报告
```

## 最佳实践

1. **仅限独立任务。** 不要并行化相互依赖输出的任务。
2. **明确边界。** 每个窗格应处理不同的文件或关注点。
3. **策略性合并。** 合并前审查窗格输出以避免冲突。
4. **使用 git worktree。** 对于容易产生文件冲突的工作，为每个窗格使用单独的工作树。
5. **资源意识。** 每个窗格都消耗 API 令牌 —— 将总窗格数控制在 5-6 个以下。

## Git Worktree 集成

对于涉及重叠文件的任务：

```bash
# Create worktrees for isolation
git worktree add -b feat/auth ../feature-auth HEAD
git worktree add -b feat/billing ../feature-billing HEAD

# Run agents in separate worktrees
# Pane 1: cd ../feature-auth && claude
# Pane 2: cd ../feature-billing && claude

# Merge branches when done
git merge feat/auth
git merge feat/billing
```

## 互补工具

| 工具 | 功能 | 使用时机 |
|------|-------------|-------------|
| **dmux** | 用于代理的 tmux 窗格管理 | 并行代理会话 |
| **Superset** | 用于 10+ 并行代理的终端 IDE | 大规模编排 |
| **Claude Code Task 工具** | 进程内子代理生成 | 会话内的程序化并行 |
| **Codex 多代理** | 内置代理角色 | Codex 特定的并行工作 |

## ECC 助手

ECC 现在包含一个助手，用于使用独立的 git worktree 进行外部 tmux 窗格编排：

```bash
node scripts/orchestrate-worktrees.js plan.json --execute
```

示例 `plan.json`：

```json
{
  "sessionName": "skill-audit",
  "baseRef": "HEAD",
  "launcherCommand": "codex exec --cwd {worktree_path} --task-file {task_file}",
  "workers": [
    { "name": "docs-a", "task": "Fix skills 1-4 and write handoff notes." },
    { "name": "docs-b", "task": "Fix skills 5-8 and write handoff notes." }
  ]
}
```

该助手：

* 为每个工作器创建一个基于分支的 git worktree
* 可选择将主检出中的选定 `seedPaths` 覆盖到每个工作器的工作树中
* 在 `.orchestration/<session>/` 下写入每个工作器的 `task.md`、`handoff.md` 和 `status.md` 文件
* 启动一个 tmux 会话，每个工作器一个窗格
* 在每个窗格中启动相应的工作器命令
* 为主协调器保留主窗格空闲

当工作器需要访问尚未纳入 `HEAD` 的脏文件或未跟踪的本地文件（例如本地编排脚本、草案计划或文档）时，使用 `seedPaths`：

```json
{
  "sessionName": "workflow-e2e",
  "seedPaths": [
    "scripts/orchestrate-worktrees.js",
    "scripts/lib/tmux-worktree-orchestrator.js",
    ".claude/plan/workflow-e2e-test.json"
  ],
  "launcherCommand": "bash {repo_root}/scripts/orchestrate-codex-worker.sh {task_file} {handoff_file} {status_file}",
  "workers": [
    { "name": "seed-check", "task": "Verify seeded files are present before starting work." }
  ]
}
```

## 故障排除

* **窗格无响应：** 直接切换到该窗格或使用 `tmux capture-pane -pt <session>:0.<pane-index>` 检查它。
* **合并冲突：** 使用 git worktree 隔离每个窗格的文件更改。
* **令牌使用量高：** 减少并行窗格数量。每个窗格都是一个完整的代理会话。
* **未找到 tmux：** 使用 `brew install tmux` (macOS) 或 `apt install tmux` (Linux) 安装。
