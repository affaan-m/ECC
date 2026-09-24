---
name: autonomous-loops
description: "自主Claude代码循环的模式与架构——从简单的顺序管道到基于RFC的多智能体有向无环图系统。"
origin: ECC
---

# 自主循环技能

> 兼容性说明 (v1.8.0): `autonomous-loops` 保留一个发布周期。
> 规范的技能名称现在是 `continuous-agent-loop`。新的循环指南应在此处编写，而此技能继续可用以避免破坏现有工作流。

在循环中自主运行 Claude Code 的模式、架构和参考实现。涵盖从简单的 `claude -p` 管道到完整的 RFC 驱动的多智能体 DAG 编排的一切。

## 何时使用

* 建立无需人工干预即可运行的自主开发工作流
* 为你的问题选择正确的循环架构（简单与复杂）
* 构建 CI/CD 风格的持续开发管道
* 运行具有合并协调的并行智能体
* 在循环迭代中实现上下文持久化
* 为自主工作流添加质量门和清理步骤

## 循环模式谱系

从最简单到最复杂：

| 模式 | 复杂度 | 最适合 |
|---------|-----------|----------|
| [顺序管道](#1-顺序管道-claude--p) | 低 | 日常开发步骤，脚本化工作流 |
| [NanoClaw REPL](#2-nanoclaw-repl) | 低 | 交互式持久会话 |
| [无限智能体循环](#3-无限智能体循环) | 中 | 并行内容生成，规范驱动的工作 |
| [持续 Claude PR 循环](#4-持续-claude-pr-循环) | 中 | 具有 CI 门的跨天迭代项目 |
| [去草率化模式](#5-去草率化模式) | 附加 | 任何实现者步骤后的质量清理 |
| [Ralphinho / RFC 驱动的 DAG](#6-ralphinho--rfc-驱动的-dag-编排) | 高 | 大型功能，具有合并队列的多单元并行工作 |

***

## 1. 顺序管道 (`claude -p`)

**最简单的循环。** 将日常开发分解为一系列非交互式 `claude -p` 调用。每次调用都是一个具有清晰提示的专注步骤。

### 核心见解

> 如果你无法想出这样的循环，那意味着你甚至无法在交互模式下驱动 LLM 来修复你的代码。

`claude -p` 标志以非交互方式运行 Claude Code 并附带提示，完成后退出。链式调用来构建管道：

```bash
#!/bin/bash
# daily-dev.sh — Sequential pipeline for a feature branch

set -e

# Step 1: Implement the feature
claude -p "Read the spec in docs/auth-spec.md. Implement OAuth2 login in src/auth/. Write tests first (TDD). Do NOT create any new documentation files."

# Step 2: De-sloppify (cleanup pass)
claude -p "Review all files changed by the previous commit. Remove any unnecessary type tests, overly defensive checks, or testing of language features (e.g., testing that TypeScript generics work). Keep real business logic tests. Run the test suite after cleanup."

# Step 3: Verify
claude -p "Run the full build, lint, type check, and test suite. Fix any failures. Do not add new features."

# Step 4: Commit
claude -p "Create a conventional commit for all staged changes. Use 'feat: add OAuth2 login flow' as the message."
```

### 关键设计原则

1. **每个步骤都是隔离的** — 每次 `claude -p` 调用都是一个新的上下文窗口，意味着步骤之间没有上下文泄露。
2. **顺序很重要** — 步骤按顺序执行。每个步骤都建立在前一个步骤留下的文件系统状态之上。
3. **否定指令是危险的** — 不要说“不要测试类型系统。”相反，添加一个单独的清理步骤（参见[去草率化模式](#5-去草率化模式)）。
4. **退出代码会传播** — `set -e` 在失败时停止管道。

### 变体

**使用模型路由：**

```bash
# Research with Opus (deep reasoning)
claude -p --model opus "Analyze the codebase architecture and write a plan for adding caching..."

# Implement with Sonnet (fast, capable)
claude -p "Implement the caching layer according to the plan in docs/caching-plan.md..."

# Review with Opus (thorough)
claude -p --model opus "Review all changes for security issues, race conditions, and edge cases..."
```

**使用环境上下文：**

```bash
# Pass context via files, not prompt length
echo "Focus areas: auth module, API rate limiting" > .claude-context.md
claude -p "Read .claude-context.md for priorities. Work through them in order."
rm .claude-context.md
```

**使用 `--allowedTools` 限制：**

```bash
# Read-only analysis pass
claude -p --allowedTools "Read,Grep,Glob" "Audit this codebase for security vulnerabilities..."

# Write-only implementation pass
claude -p --allowedTools "Read,Write,Edit,Bash" "Implement the fixes from security-audit.md..."
```

***

## 2. NanoClaw REPL

**ECC 内置的持久循环。** 一个具有会话感知的 REPL，它使用完整的对话历史同步调用 `claude -p`。

```bash
# Start the default session
node scripts/claw.js

# Named session with skill context
CLAW_SESSION=my-project CLAW_SKILLS=tdd-workflow,security-review node scripts/claw.js
```

### 工作原理

1. 从 `~/.claude/claw/{session}.md` 加载对话历史
2. 每个用户消息都连同完整历史记录作为上下文发送给 `claude -p`
3. 响应被追加到会话文件中（Markdown 作为数据库）
4. 会话在重启后持久存在

### NanoClaw 与顺序管道的选择

| 用例 | NanoClaw | 顺序管道 |
|----------|----------|-------------------|
| 交互式探索 | 是 | 否 |
| 脚本化自动化 | 否 | 是 |
| 会话持久性 | 内置 | 手动 |
| 上下文累积 | 每轮增长 | 每个步骤都是新的 |
| CI/CD 集成 | 差 | 优秀 |

有关完整详情，请参阅 `/claw` 命令文档。

***

## 3. 无限智能体循环

**一个双提示系统**，用于编排并行子智能体以进行规范驱动的生成。由 disler 开发（致谢：@disler）。

### 架构：双提示系统

```
PROMPT 1（协调器）              PROMPT 2（子代理）
┌─────────────────────┐             ┌──────────────────────┐
│ 解析规范文件         │             │ 接收完整上下文        │
│ 扫描输出目录         │  部署       │ 读取分配编号          │
│ 规划迭代             │────────────│ 严格遵循规范          │
│ 分配创作目录         │  N个代理    │ 生成唯一输出          │
│ 管理批次             │             │ 保存至输出目录        │
└─────────────────────┘             └──────────────────────┘
```

### 模式

1. **规范分析** — 编排器读取一个定义要生成内容的规范文件（Markdown）
2. **目录侦察** — 扫描现有输出以找到最高的迭代编号
3. **并行部署** — 启动 N 个子智能体，每个都有：
   * 完整的规范
   * 独特的创意方向
   * 特定的迭代编号（无冲突）
   * 现有迭代的快照（用于确保唯一性）
4. **波次管理** — 对于无限模式，部署 3-5 个智能体的波次，直到上下文耗尽

### 通过 Claude Code 命令实现

创建 `.claude/commands/infinite.md`：

```markdown
从 $ARGUMENTS 中解析以下参数：
1. spec_file — 规范 Markdown 文件的路径
2. output_dir — 保存迭代结果的目录
3. count — 整数 1-N 或 "infinite"

阶段 1： 读取并深入理解规范。
阶段 2： 列出 output_dir，找到最高的迭代编号。从 N+1 开始。
阶段 3： 规划创意方向 — 每个代理获得一个**不同的**主题/方法。
阶段 4： 并行部署子代理（使用 Task 工具）。每个代理接收：
  - 完整的规范文本
  - 当前目录快照
  - 它们被分配的迭代编号
  - 它们独特的创意方向
阶段 5（无限模式）： 以 3-5 个为一波进行循环，直到上下文不足为止。
```

**调用：**

```bash
/project:infinite specs/component-spec.md src/ 5
/project:infinite specs/component-spec.md src/ infinite
```

### 批处理策略

| 数量 | 策略 |
|-------|----------|
| 1-5 | 所有智能体同时运行 |
| 6-20 | 每批 5 个 |
| 无限 | 3-5 个一波，逐步复杂化 |

### 关键见解：通过分配实现唯一性

不要依赖智能体自我区分。编排器**分配**给每个智能体一个特定的创意方向和迭代编号。这可以防止并行智能体之间的概念重复。

***

## 4. 持续 Claude PR 循环

**一个生产级的 shell 脚本**，在持续循环中运行 Claude Code，创建 PR，等待 CI，并自动合并。由 AnandChowdhary 创建（致谢：@AnandChowdhary）。

### 核心循环

```
┌─────────────────────────────────────────────────────┐
│  持续 CLAUDE 迭代                                   │
│                                                     │
│  1. 创建分支 (continuous-claude/iteration-N)       │
│  2. 使用增强提示运行 claude -p                      │
│  3. (可选) 审查者通过 — 单独的 claude -p            │
│  4. 提交更改 (claude 生成提交信息)                  │
│  5. 推送 + 创建 PR (gh pr create)                   │
│  6. 等待 CI 检查 (轮询 gh pr checks)                │
│  7. CI 失败？ → 自动修复通过 (claude -p)             │
│  8. 合并 PR (squash/merge/rebase)                   │
│  9. 返回 main → 重复                                │
│                                                     │
│  限制条件： --max-runs N | --max-cost $X            │
│            --max-duration 2h | 完成信号             │
└─────────────────────────────────────────────────────┘
```

### 安装

> **警告：** 请在审阅代码后，从 continuous-claude 的仓库安装。不要将外部脚本直接管道传入 bash。

### 用法

```bash
# Basic: 10 iterations
continuous-claude --prompt "Add unit tests for all untested functions" --max-runs 10

# Cost-limited
continuous-claude --prompt "Fix all linter errors" --max-cost 5.00

# Time-boxed
continuous-claude --prompt "Improve test coverage" --max-duration 8h

# With code review pass
continuous-claude \
  --prompt "Add authentication feature" \
  --max-runs 10 \
  --review-prompt "Run npm test && npm run lint, fix any failures"

# Parallel via worktrees
continuous-claude --prompt "Add tests" --max-runs 5 --worktree tests-worker &
continuous-claude --prompt "Refactor code" --max-runs 5 --worktree refactor-worker &
wait
```

### 跨迭代上下文：SHARED\_TASK\_NOTES.md

关键创新：一个 `SHARED_TASK_NOTES.md` 文件在迭代间持久存在：

```markdown
## 进展
- [x] 已添加认证模块测试（第1轮）
- [x] 已修复令牌刷新中的边界情况（第2轮）
- [ ] 仍需完成：速率限制测试、错误边界测试

## 后续步骤
- 接下来专注于速率限制模块
- 测试中位于 `tests/helpers.ts` 的模拟设置可以复用
```

Claude 在迭代开始时读取此文件，并在迭代结束时更新它。这弥合了独立 `claude -p` 调用之间的上下文差距。

### CI 失败恢复

当 PR 检查失败时，持续 Claude 会自动：

1. 通过 `gh run list` 获取失败的运行 ID
2. 生成一个新的带有 CI 修复上下文的 `claude -p`
3. Claude 通过 `gh run view` 检查日志，修复代码，提交，推送
4. 重新等待检查（最多 `--ci-retry-max` 次尝试）

### 完成信号

Claude 可以通过输出一个魔法短语来发出“我完成了”的信号：

```bash
continuous-claude \
  --prompt "Fix all bugs in the issue tracker" \
  --completion-signal "CONTINUOUS_CLAUDE_PROJECT_COMPLETE" \
  --completion-threshold 3  # Stops after 3 consecutive signals
```

连续三次迭代发出完成信号会停止循环，防止在已完成的工作上浪费运行。

### 关键配置

| 标志 | 目的 |
|------|---------|
| `--max-runs N` | 在 N 次成功迭代后停止 |
| `--max-cost $X` | 在花费 $X 后停止 |
| `--max-duration 2h` | 在时间过去后停止 |
| `--merge-strategy squash` | squash、merge 或 rebase |
| `--worktree <name>` | 通过 git worktrees 并行执行 |
| `--disable-commits` | 试运行模式（无 git 操作） |
| `--review-prompt "..."` | 每次迭代添加审阅者审核 |
| `--ci-retry-max N` | 自动修复 CI 失败（默认：1） |

***

## 5. 去草率化模式

**任何循环的附加模式。** 在每个实现者步骤之后添加一个专门的清理/重构步骤。

### 问题

当你要求 LLM 使用 TDD 实现时，它对“编写测试”的理解过于字面：

* 测试验证 TypeScript 的类型系统是否有效（测试 `typeof x === 'string'`）
* 对类型系统已经保证的东西进行过度防御的运行时检查
* 测试框架行为而非业务逻辑
* 过多的错误处理掩盖了实际代码

### 为什么不使用否定指令？

在实现者提示中添加“不要测试类型系统”或“不要添加不必要的检查”会产生下游影响：

* 模型对所有测试都变得犹豫不决
* 它会跳过合法的边缘情况测试
* 质量不可预测地下降

### 解决方案：单独的步骤

与其限制实现者，不如让它彻底。然后添加一个专注的清理智能体：

```bash
# Step 1: Implement (let it be thorough)
claude -p "Implement the feature with full TDD. Be thorough with tests."

# Step 2: De-sloppify (separate context, focused cleanup)
claude -p "Review all changes in the working tree. Remove:
- Tests that verify language/framework behavior rather than business logic
- Redundant type checks that the type system already enforces
- Over-defensive error handling for impossible states
- Console.log statements
- Commented-out code

Keep all business logic tests. Run the test suite after cleanup to ensure nothing breaks."
```

### 在循环上下文中

```bash
for feature in "${features[@]}"; do
  # Implement
  claude -p "Implement $feature with TDD."

  # De-sloppify
  claude -p "Cleanup pass: review changes, remove test/code slop, run tests."

  # Verify
  claude -p "Run build + lint + tests. Fix any failures."

  # Commit
  claude -p "Commit with message: feat: add $feature"
done
```

### 关键见解

> 与其添加具有下游质量影响的否定指令，不如添加一个单独的去草率化步骤。两个专注的智能体胜过一个有约束的智能体。

***

## 6. Ralphinho / RFC 驱动的 DAG 编排

**最复杂的模式。** 一个 RFC 驱动的多智能体管道，将规范分解为依赖关系 DAG，通过分层质量管道运行每个单元，并通过智能体驱动的合并队列落地。由 enitrat 创建（致谢：@enitrat）。

### 架构概述

```
RFC/PRD 文档
       │
       ▼
  分解（AI）
  将 RFC 分解为具有依赖关系 DAG 的工作单元
       │
       ▼
┌──────────────────────────────────────────────────────┐
│  RALPH 循环（最多 3 轮）                             │
│                                                      │
│  针对每个 DAG 层级（按依赖关系顺序）：                 │
│                                                      │
│  ┌── 质量流水线（每个单元并行） ───────┐              │
│  │  每个单元在其独立的工作树中：        │              │
│  │  研究 → 规划 → 实现 → 测试 → 评审   │              │
│  │  （深度根据复杂度层级变化）          │              │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌── 合并队列 ─────────────────────────────────┐     │
│  │  变基到主分支 → 运行测试 → 合并或移除       │     │
│  │  被移除的单元携带冲突上下文重新进入         │     │
│  └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### RFC 分解

AI 读取 RFC 并生成工作单元：

```typescript
interface WorkUnit {
  id: string;              // kebab-case identifier
  name: string;            // Human-readable name
  rfcSections: string[];   // Which RFC sections this addresses
  description: string;     // Detailed description
  deps: string[];          // Dependencies (other unit IDs)
  acceptance: string[];    // Concrete acceptance criteria
  tier: "trivial" | "small" | "medium" | "large";
}
```

**分解规则：**

* 倾向于更少、内聚的单元（最小化合并风险）
* 最小化跨单元文件重叠（避免冲突）
* 保持测试与实现在一起（永远不要分开“实现 X” + “测试 X”）
* 仅在实际存在代码依赖关系的地方设置依赖关系

依赖关系 DAG 决定了执行顺序：

```
Layer 0: [unit-a, unit-b]     ← 无依赖，并行运行
Layer 1: [unit-c]             ← 依赖于 unit-a
Layer 2: [unit-d, unit-e]     ← 依赖于 unit-c
```

### 复杂度层级

不同的层级获得不同深度的管道：

| 层级 | 管道阶段 |
|------|----------------|
| **trivial** | implement → test |
| **small** | implement → test → code-review |
| **medium** | research → plan → implement → test → PRD-review + code-review → review-fix |
| **large** | research → plan → implement → test → PRD-review + code-review → review-fix → final-review |

这可以防止对简单更改进行昂贵的操作，同时确保架构更改得到彻底审查。

### 独立的上下文窗口（消除作者偏见）

每个阶段在其自己的智能体进程中运行，拥有自己的上下文窗口：

| 阶段 | 模型 | 目的 |
|-------|-------|---------|
| Research | Sonnet | 读取代码库 + RFC，生成上下文文档 |
| Plan | Opus | 设计实现步骤 |
| Implement | Codex | 按照计划编写代码 |
| Test | Sonnet | 运行构建 + 测试套件 |
| PRD Review | Sonnet | 规范合规性检查 |
| Code Review | Opus | 质量 + 安全检查 |
| Review Fix | Codex | 处理审阅问题 |
| Final Review | Opus | 质量门（仅限大型层级） |

**关键设计：** 审阅者从未编写过它要审阅的代码。这消除了作者偏见——这是自我审阅中遗漏问题的最常见原因。

### 具有驱逐功能的合并队列

质量管道完成后，单元进入合并队列：

```
Unit branch
    │
    ├─ 变基到 main 分支
    │   └─ 冲突？→ 移除（捕获冲突上下文）
    │
    ├─ 运行构建 + 测试
    │   └─ 失败？→ 移除（捕获测试输出）
    │
    └─ 通过 → 快进合并 main 分支，推送，删除分支
```

**文件重叠智能：**

* 非重叠单元并行推测性地落地
* 重叠单元逐个落地，每次重新变基

**驱逐恢复：**
被驱逐时，会捕获完整上下文（冲突文件、差异、测试输出）并反馈给下一个 Ralph 轮次的实现者：

```markdown
## 合并冲突 — 在下一次推送前解决

您之前的实现与另一个已先推送的单元发生了冲突。
请重构您的更改以避免以下冲突的文件/行。

{完整的排除上下文及差异}
```

### 阶段间的数据流

```
research.contextFilePath ──────────────────→ 方案
plan.implementationSteps ──────────────────→ 实施
implement.{filesCreated, whatWasDone} ─────→ 测试, 审查
test.failingSummary ───────────────────────→ 审查, 实施（下一轮）
reviews.{feedback, issues} ────────────────→ 审查修复 → 实施（下一轮）
final-review.reasoning ────────────────────→ 实施（下一轮）
evictionContext ───────────────────────────→ 实施（合并冲突后）
```

### 工作树隔离

每个单元在隔离的工作树中运行（使用 jj/Jujutsu，而不是 git）：

```
/tmp/workflow-wt-{unit-id}/
```

同一单元的管道阶段**共享**一个工作树，在 research → plan → implement → test → review 之间保留状态（上下文文件、计划文件、代码更改）。

### 关键设计原则

1. **确定性执行** — 预先分解锁定并行性和顺序
2. **在杠杆点进行人工审阅** — 工作计划是单一最高杠杆干预点
3. **关注点分离** — 每个阶段在独立的上下文窗口中，由独立的智能体负责
4. **带上下文的冲突恢复** — 完整的驱逐上下文支持智能重试，而非盲目重试
5. **层级驱动的深度** — 琐碎更改跳过研究/审阅；大型更改获得最大审查
6. **可恢复的工作流** — 完整状态持久化到 SQLite；可从任何点恢复

### 何时使用 Ralphinho 与更简单的模式

| 信号 | 使用 Ralphinho | 使用更简单的模式 |
|--------|--------------|-------------------|
| 多个相互依赖的工作单元 | 是 | 否 |
| 需要并行实现 | 是 | 否 |
| 可能出现合并冲突 | 是 | 否（顺序即可） |
| 单文件更改 | 否 | 是（顺序管道） |
| 跨天项目 | 是 | 可能（持续-claude） |
| 规范/RFC 已编写 | 是 | 可能 |
| 对单个事物的快速迭代 | 否 | 是（NanoClaw 或管道） |

***

## 选择正确的模式

### 决策矩阵

```
该任务是否是一个单一的、专注的变更？
├─ 是 → 顺序管道或NanoClaw
└─ 否 → 是否有书面的规范/RFC？
         ├─ 有 → 是否需要并行实现？
         │        ├─ 是 → Ralphinho（DAG编排）
         │        └─ 否 → Continuous Claude（迭代式PR循环）
         └─ 否 → 是否需要同一事物的多种变体？
                  ├─ 是 → 无限代理循环（规范驱动生成）
                  └─ 否 → 顺序管道与去杂乱化
```

### 模式组合

这些模式可以很好地组合：

1. **顺序流水线 + 去草率化** — 最常见的组合。每个实现步骤都进行一次清理。

2. **连续 Claude + 去草率化** — 为每次迭代添加带有去草率化指令的 `--review-prompt`。

3. **任何循环 + 验证** — 在提交前，使用 ECC 的 `/verify` 命令或 `verification-loop` 技能作为关卡。

4. **Ralphinho 在简单循环中的分层方法** — 即使在顺序流水线中，你也可以将简单任务路由到 Haiku，复杂任务路由到 Opus：
   ```bash
   # 简单的格式修复
   claude -p --model haiku "Fix the import ordering in src/utils.ts"

   # 复杂的架构变更
   claude -p --model opus "Refactor the auth module to use the strategy pattern"
   ```

***

## 反模式

### 常见错误

1. **没有退出条件的无限循环** — 始终设置最大运行次数、最大成本、最大持续时间或完成信号。

2. **迭代之间没有上下文桥接** — 每次 `claude -p` 调用都从头开始。使用 `SHARED_TASK_NOTES.md` 或文件系统状态来桥接上下文。

3. **重试相同的失败** — 如果一次迭代失败，不要只是重试。捕获错误上下文并将其提供给下一次尝试。

4. **使用负面指令而非清理过程** — 不要说“不要做 X”。添加一个单独的步骤来移除 X。

5. **所有智能体都在一个上下文窗口中** — 对于复杂的工作流，将关注点分离到不同的智能体进程中。审查者永远不应该是作者。

6. **在并行工作中忽略文件重叠** — 如果两个并行智能体可能编辑同一个文件，你需要一个合并策略（顺序落地、变基或冲突解决）。

***

## 参考资料

| 项目 | 作者 | 链接 |
|---------|--------|------|
| Ralphinho | enitrat | credit: @enitrat |
| Infinite Agentic Loop | disler | credit: @disler |
| Continuous Claude | AnandChowdhary | credit: @AnandChowdhary |
| NanoClaw | ECC | 此仓库中的 `/claw` 命令 |
| Verification Loop | ECC | 此仓库中的 `skills/verification-loop/` |
