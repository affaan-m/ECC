---
description: 通过Claude DevFleet协调并行Claude Code代理——从自然语言规划项目，在隔离的工作树中调度代理，监控进度，并读取结构化报告。
---

# DevFleet — 多智能体编排

通过 Claude DevFleet 编排并行的 Claude Code 智能体。每个智能体在隔离的 git worktree 中运行，并配备完整的工具链。

需要 DevFleet MCP 服务器：`claude mcp add devfleet --transport http http://localhost:18801/mcp`

## 流程

```
用户描述项目
  → plan_project(prompt) → 任务DAG与依赖关系
  → 展示计划，获取批准
  → dispatch_mission(M1) → 代理在工作区中生成
  → M1完成 → 自动合并 → M2自动调度（依赖于M1）
  → M2完成 → 自动合并
  → get_report(M2) → 文件变更、完成内容、错误、后续步骤
  → 向用户报告总结
```

## 工作流

1. **根据用户描述规划项目**：

```
mcp__devfleet__plan_project(prompt="<用户描述>")
```

这将返回一个包含链式任务的项目。向用户展示：

* 项目名称和 ID
* 每个任务：标题、类型、依赖项
* 依赖关系 DAG（哪些任务阻塞了哪些任务）

2. **在派发前等待用户批准**。清晰展示计划。

3. **派发第一个任务**（`depends_on` 为空的任务）：

```
mcp__devfleet__dispatch_mission(mission_id="<first_mission_id>")
```

剩余的任务会在其依赖项完成时自动派发（因为 `plan_project` 创建它们时使用了 `auto_dispatch=true`）。当使用 `create_mission` 手动创建任务时，您必须显式设置 `auto_dispatch=true` 才能启用此行为。

4. **监控进度** — 检查正在运行的内容：

```
mcp__devfleet__get_dashboard()
```

或检查特定任务：

```
mcp__devfleet__get_mission_status(mission_id="<id>")
```

对于长时间运行的任务，优先使用 `get_mission_status` 轮询，而不是 `wait_for_mission`，以便用户能看到进度更新。

5. **读取每个已完成任务的报告**：

```
mcp__devfleet__get_report(mission_id="<mission_id>")
```

对每个达到终止状态的任务调用此工具。报告包含：files\_changed, what\_done, what\_open, what\_tested, what\_untested, next\_steps, errors\_encountered。

## 所有可用工具

| 工具 | 用途 |
|------|---------|
| `plan_project(prompt)` | AI 将描述分解为具有 `auto_dispatch=true` 的链式任务 |
| `create_project(name, path?, description?)` | 手动创建项目，返回 `project_id` |
| `create_mission(project_id, title, prompt, depends_on?, auto_dispatch?)` | 添加任务。`depends_on` 是任务 ID 字符串列表。 |
| `dispatch_mission(mission_id, model?, max_turns?)` | 启动一个智能体 |
| `cancel_mission(mission_id)` | 停止一个正在运行的智能体 |
| `wait_for_mission(mission_id, timeout_seconds?)` | 阻塞直到完成（对于长任务，优先使用轮询） |
| `get_mission_status(mission_id)` | 非阻塞地检查进度 |
| `get_report(mission_id)` | 读取结构化报告 |
| `get_dashboard()` | 系统概览 |
| `list_projects()` | 浏览项目 |
| `list_missions(project_id, status?)` | 列出任务 |

## 指南

* 除非用户明确说"开始吧"，否则派发前始终确认计划
* 报告状态时包含任务标题和 ID
* 如果任务失败，在重试前先读取其报告以了解错误
* 智能体并发数是可配置的（默认：3）。超额的任务会排队，并在有空闲槽位时自动派发。检查 `get_dashboard()` 以了解槽位可用性。
* 依赖关系形成一个 DAG — 切勿创建循环依赖
* 每个智能体在完成时自动合并其 worktree。如果发生合并冲突，更改将保留在 worktree 分支上，以供手动解决。
