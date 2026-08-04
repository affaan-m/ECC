---
description: 执行带有严格验证循环的实施计划
argument-hint: <path/to/plan.md>
---

> 改编自 Wirasm 的 PRPs-agentic-eng。属于 PRP 工作流系列。

# PRP 实施

按步骤执行计划文件，并进行持续验证。每次更改后立即验证——绝不累积损坏状态。

**核心理念**：验证循环能及早发现错误。每次更改后都运行检查。立即修复问题。

**黄金法则**：如果验证失败，先修复再继续。绝不累积损坏状态。

***

## 阶段 0 — 检测

### 包管理器检测

| 文件存在 | 包管理器 | 运行器 |
|---|---|---|
| `bun.lockb` | bun | `bun run` |
| `pnpm-lock.yaml` | pnpm | `pnpm run` |
| `yarn.lock` | yarn | `yarn` |
| `package-lock.json` | npm | `npm run` |
| `pyproject.toml` 或 `requirements.txt` | uv / pip | `uv run` 或 `python -m` |
| `Cargo.toml` | cargo | `cargo` |
| `go.mod` | go | `go` |

### 验证脚本

检查 `package.json`（或等效文件）中可用的脚本：

```bash
# For Node.js projects
cat package.json | grep -A 20 '"scripts"'
```

记录可用的命令：类型检查、代码检查、测试、构建。

***

## 阶段 1 — 加载

读取计划文件：

```bash
cat "$ARGUMENTS"
```

从计划中提取以下部分：

* **摘要** — 正在构建什么
* **要镜像的模式** — 要遵循的代码约定
* **要更改的文件** — 要创建或修改的内容
* **逐步任务** — 实施顺序
* **验证命令** — 如何验证正确性
* **验收标准** — 完成的定义

如果文件不存在或不是有效的计划：

```
错误：计划文件未找到或无效。
请先运行 /prp-plan <功能描述> 来创建计划。
```

**检查点**：计划已加载。所有部分已识别。任务已提取。

***

## 阶段 2 — 准备

### Git 状态

```bash
git branch --show-current
git status --porcelain
```

### 分支决策

| 当前状态 | 操作 |
|---|---|
| 在功能分支上 | 使用当前分支 |
| 在主分支上，工作区干净 | 创建功能分支：`git checkout -b feat/{plan-name}` |
| 在主分支上，工作区有未暂存更改 | **停止** — 要求用户先暂存或提交 |
| 在此功能的 git 工作树中 | 使用该工作树 |

### 同步远程

```bash
git pull --rebase origin $(git branch --show-current) 2>/dev/null || true
```

**检查点**：位于正确分支。工作区已就绪。远程已同步。

***

## 阶段 3 — 执行

按顺序处理计划中的每个任务。

### 每个任务的循环

对于**逐步任务**中的每个任务：

1. **读取 MIRROR 参考** — 打开任务 MIRROR 字段中引用的模式文件。在编写代码前理解约定。

2. **实施** — 严格按照模式编写代码。应用 GOTCHA 警告。使用指定的 IMPORTS。

3. **立即验证** — 每次文件更改后：
   ```bash
   # 运行类型检查（根据项目调整命令）
   [阶段 0 中的类型检查命令]
   ```
   如果类型检查失败 → 在移动到下一个文件之前修复错误。

4. **跟踪进度** — 记录：`[done] Task N: [task name] — complete`

### 处理偏差

如果实施必须偏离计划：

* 记录**什么**发生了变化
* 记录**为什么**发生变化
* 使用修正后的方法继续
* 这些偏差将在报告中捕获

**检查点**：所有任务已执行。偏差已记录。

***

## 阶段 4 — 验证

运行计划中的所有验证级别。在继续之前修复每个级别的问题。

### 级别 1：静态分析

```bash
# Type checking — zero errors required
[project type-check command]

# Linting — fix automatically where possible
[project lint command]
[project lint-fix command]
```

如果自动修复后仍有代码检查错误，请手动修复。

### 级别 2：单元测试

为每个新函数编写测试（如计划中的测试策略所指定）。

```bash
[project test command for affected area]
```

* 每个函数至少需要一个测试
* 覆盖计划中列出的边缘情况
* 如果测试失败 → 修复实现（而不是测试，除非测试本身有误）

### 级别 3：构建检查

```bash
[project build command]
```

构建必须成功，零错误。

### 级别 4：集成测试（如适用）

```bash
# Start server, run tests, stop server
[project dev server command] &
SERVER_PID=$!

# Wait for server to be ready (adjust port as needed)
SERVER_READY=0
for i in $(seq 1 30); do
  if curl -sf http://localhost:PORT/health >/dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  sleep 1
done

if [ "$SERVER_READY" -ne 1 ]; then
  kill "$SERVER_PID" 2>/dev/null || true
  echo "ERROR: Server failed to start within 30s" >&2
  exit 1
fi

[integration test command]
TEST_EXIT=$?

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true

exit "$TEST_EXIT"
```

### 级别 5：边缘情况测试

运行计划测试策略清单中的边缘情况。

**检查点**：所有 5 个验证级别均通过。零错误。

***

## 阶段 5 — 报告

### 创建实施报告

```bash
mkdir -p .claude/PRPs/reports
```

将报告写入 `.claude/PRPs/reports/{plan-name}-report.md`：

```markdown
# 实现报告：[功能名称]

## 摘要
[已实现的内容]

## 评估与实际对比

| 指标 | 预测（计划） | 实际 |
|---|---|---|
| 复杂度 | [来自计划] | [实际] |
| 信心指数 | [来自计划] | [实际] |
| 变更文件数 | [来自计划] | [实际数量] |

## 已完成任务

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | [任务名称] | [已完成] 完成 | |
| 2 | [任务名称] | [已完成] 完成 | 存在偏差 — [原因] |

## 验证结果

| 级别 | 状态 | 备注 |
|---|---|---|
| 静态分析 | [已完成] 通过 | |
| 单元测试 | [已完成] 通过 | 编写了 N 个测试 |
| 构建 | [已完成] 通过 | |
| 集成测试 | [已完成] 通过 | 或不适用 |
| 边界情况 | [已完成] 通过 | |

## 变更文件

| 文件 | 操作 | 行数 |
|---|---|---|
| `path/to/file` | 新建 | +N |
| `path/to/file` | 更新 | +N / -M |

## 与计划的偏差
[列出所有偏差及其原因，或填写"无"]

## 遇到的问题
[列出所有问题及解决方案，或填写"无"]

## 编写的测试

| 测试文件 | 测试数量 | 覆盖范围 |
|---|---|---|
| `path/to/test` | N 个测试 | [覆盖区域] |

## 后续步骤
- [ ] 通过 `/code-review` 进行代码审查
- [ ] 通过 `/prp-pr` 创建拉取请求
```

### 更新 PRD（如适用）

如果此实施是针对 PRD 阶段的：

1. 将阶段状态从 `in-progress` 更新为 `complete`
2. 添加报告路径作为参考

### 归档计划

```bash
mkdir -p .claude/PRPs/plans/completed
mv "$ARGUMENTS" .claude/PRPs/plans/completed/
```

**检查点**：报告已创建。PRD 已更新。计划已归档。

***

## 阶段 6 — 输出

向用户报告：

```
## 实现完成

- **计划**: [计划文件路径] → 已归档至 completed/
- **分支**: [当前分支名称]
- **状态**: [完成] 所有任务已完成

### 验证摘要

| 检查项 | 状态 |
|---|---|
| 类型检查 | [完成] |
| 代码检查 | [完成] |
| 测试 | [完成] (已编写 N 个) |
| 构建 | [完成] |
| 集成测试 | [完成] 或 不适用 |

### 文件变更
- 创建了 [N] 个文件，更新了 [M] 个文件

### 偏差
[摘要 或 "无 — 完全按计划执行"]

### 产物
- 报告: `.claude/PRPs/reports/{名称}-report.md`
- 已归档计划: `.claude/PRPs/plans/completed/{名称}.plan.md`

### PRD 进度（如适用）
| 阶段 | 状态 |
|---|---|
| 阶段 1 | [完成] 已完成 |
| 阶段 2 | [下一步] |
| ... | ... |

> 下一步：运行 `/prp-pr` 创建拉取请求，或先运行 `/code-review` 审查更改。
```

***

## 处理失败

### 类型检查失败

1. 仔细阅读错误信息
2. 在源文件中修复类型错误
3. 重新运行类型检查
4. 仅在干净后继续

### 测试失败

1. 确定错误是在实现中还是在测试中
2. 修复根本原因（通常是实现）
3. 重新运行测试
4. 仅在全部通过后继续

### 代码检查失败

1. 首先运行自动修复
2. 如果仍有错误，手动修复
3. 重新运行代码检查
4. 仅在干净后继续

### 构建失败

1. 通常是类型或导入问题 — 检查错误信息
2. 修复有问题的文件
3. 重新运行构建
4. 仅在成功后继续

### 集成测试失败

1. 检查服务器是否正确启动
2. 验证端点/路由是否存在
3. 检查请求格式是否与预期匹配
4. 修复并重新运行

***

## 成功标准

* **TASKS\_COMPLETE**：计划中的所有任务均已执行
* **TYPES\_PASS**：零类型错误
* **LINT\_PASS**：零代码检查错误
* **TESTS\_PASS**：所有测试通过，已编写新测试
* **BUILD\_PASS**：构建成功
* **REPORT\_CREATED**：实施报告已保存
* **PLAN\_ARCHIVED**：计划已移至 `completed/`

***

## 后续步骤

* 运行 `/code-review` 在提交前审查更改
* 运行 `/prp-commit` 使用描述性消息提交
* 运行 `/prp-pr` 创建拉取请求
* 如果 PRD 有更多阶段，运行 `/prp-plan <next-phase>`
