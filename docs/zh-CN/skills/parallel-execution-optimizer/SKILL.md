---
name: parallel-execution-optimizer
description: 当用户希望通过并行工作、并发 agents、批量工具调用、隔离 worktree 或多条独立验证通道来大幅加速任务、同时不损失正确性时使用。
origin: ECC
tools: Read, Write, Edit, Bash, Grep, Glob
---

# 并行执行优化器

当速度来自同时处理相互独立的工作时，使用此技能：
仓库巡检、文件读取、API 检查、浏览器检查、构建/测试通道、
部署回读，或多 worktree 的实现批次。

## 核心模式

行动之前，先把紧迫感转化为依赖图。

1. 定义目标和完成信号。
2. 把工作拆分成通道（lane）。
3. 给每条通道标注执行方式：并行、串行或门控。
4. 把相互独立的读取/检查放在一起执行。
5. 让写入按文件、worktree、分支、服务或数据集相互隔离。
6. 只有在证据表明各通道相互兼容后才合并。
7. 以一张验证表收尾，而不是一句模糊的"变快了"。

## 通道矩阵

在大规模推进之前，写一张紧凑的矩阵：

```text
Lane | Can run in parallel? | Write surface | Risk | Verification
Repo scan | yes | none | low | rg/git status outputs
Backend patch | maybe | src/api | medium | unit tests
Frontend patch | maybe | app/components | medium | browser screenshot
Deploy readback | after build | remote service | high | live URL + logs
```

只有当各通道的写入面互不冲突时，才并行运行。

## 执行规则

- 把文件读取、搜索、状态检查和元数据查询批量化。
- 对大型且互不相关的实现通道使用隔离的 worktree。
- 长时间运行的测试、构建、回填和部署放到独立会话中启动，
  然后有节奏地主动轮询。
- 如果某条通道发现了会改变计划的阻塞点，暂停依赖它的通道
  并更新矩阵。
- 除非用户明确要求持续运行的服务，绝不让后台进程存活超过本轮。
- 没有明确门控时，不要并行执行破坏性命令、数据迁移、对同一张表的写入，
  或影响线上客户的部署。

## 输出形态

汇报时使用：

```text
Parallel execution result:
- Lanes run: 5
- Lanes completed: 4
- Blocked lane: deploy readback, waiting on DNS propagation
- Fast path found: batched repo scan + focused tests
- Verification: lint pass, unit pass, live smoke pass
```

## 失败模式

- 更多并发反而制造了相互冲突的编辑。
- 在给工具跑分，而不是在完成任务。
- 在正确性得到证明之前就把"快"当成"做完了"。
- 忘记轮询正在运行的会话。
- 用一句成功摘要掩盖被跳过的检查。
