---
description: 在不打断或丢失当前任务上下文的情况下，快速回答一个附带问题。回答后自动恢复工作。
---

# 旁述指令

在任务进行中提问，获得即时、聚焦的回答——然后立即从暂停处继续。当前任务、文件和上下文绝不会被修改。

## 何时使用

* 你在 Claude 工作时对某事感到好奇，但又不想打断工作节奏
* 你需要快速解释 Claude 当前正在编辑的代码
* 你想就某个决定征求第二意见或进行澄清，而不会使任务偏离方向
* 在 Claude 继续之前，你需要理解一个错误、概念或模式
* 你想询问与当前任务无关的事情，而无需开启新会话

## 使用方法

```
/aside <your question>
/aside what does this function actually return?
/aside is this pattern thread-safe?
/aside why are we using X instead of Y here?
/aside what's the difference between foo() and bar()?
/aside should we be worried about the N+1 query we just added?
```

## 流程

### 步骤 1：冻结当前任务状态

在回答任何问题之前，先在心里记下：

* 当前活动任务是什么？（正在处理哪个文件、功能或问题）
* 在调用 `/aside` 时，进行到哪一步了？
* 接下来原本要发生什么？

在旁述期间，**不要**触碰、编辑、创建或删除任何文件。

### 步骤 2：直接回答问题

以最简洁但仍完整有用的形式回答问题。

* 先说答案，再说推理过程
* 保持简短——如果需要完整解释，请在任务结束后再提供
* 如果问题涉及当前正在处理的文件或代码，请精确引用（相关时包括文件路径和行号）
* 如果回答问题需要读取文件，就读它——但只读不写

将响应格式化为：

```
ASIDE: [restate the question briefly]

[Your answer here]

— Back to task: [one-line description of what was being done]
```

### 步骤 3：恢复主任务

在给出答案后，立即从暂停的确切点继续执行活动任务。除非旁述回答揭示了阻碍或需要重新考虑当前方法的理由（见边缘情况），否则不要请求恢复许可。

***

## 边缘情况

**未提供问题（`/aside` 后面没有内容）：**
回复：

```
ASIDE: no question provided

What would you like to know? (ask your question and I'll answer without losing the current task context)

— Back to task: [one-line description of what was being done]
```

**问题揭示了当前任务的潜在问题：**
在恢复之前清楚地标记出来：

```
ASIDE: [answer]

WARNING: Note: This answer suggests [issue] with the current approach. Want to address this before continuing, or proceed as planned?
```

等待用户的决定后再恢复。

**问题实际上是任务重定向（而非旁述问题）：**
如果问题暗示要改变正在构建的内容（例如，`/aside actually, let's use Redis instead`），请澄清：

```
ASIDE: That sounds like a direction change, not just a side question.
Do you want to:
  (a) Answer this as information only and keep the current plan
  (b) Pause the current task and change approach
```

等待用户的回答——不要自行假设。

**问题涉及当前打开的文件或代码：**
根据实时上下文回答。如果该文件在会话早期已被读取，直接引用它。如果尚未读取，现在读取它（只读）并在回答时附带文件:行号引用。

**无活动任务（调用 `/aside` 时没有进行中的任务）：**
仍然使用标准包装器，以保持响应格式一致：

```
ASIDE: [restate the question briefly]

[Your answer here]

— Back to task: no active task to resume
```

**问题需要长篇回答：**
简洁地给出核心答案，然后提供：

```
That's the short version. Want a deeper explanation after we finish [current task]?
```

**连续多个 `/aside` 问题：**
依次回答每个问题。在回答完最后一个问题后，恢复主任务。不要在一连串旁述中丢失任务状态。

**旁述回答暗示需要进行代码更改：**
记下所需的更改，但不要在旁述期间进行更改：

```
ASIDE: [answer]

 Worth fixing: [what should be changed]. I'll flag this after the current task unless you want to address it now.
```

**问题含糊不清或过于笼统：**
提出一个澄清性问题——一个能获取回答所需信息的最简短问题。不要提出多个问题。

***

## 示例输出

```
User: /aside what does fetchWithRetry() actually do?

ASIDE: what does fetchWithRetry() do?

fetchWithRetry() (src/api/retry.ts:12) attempts the request up to 3 times with
exponential backoff (250ms → 500ms → 1s). It only retries on 5xx responses and
network errors — 4xx errors are treated as final and not retried.

— Back to task: refactoring the auth middleware in src/middleware/auth.ts
```

```
User: /aside is the approach we're taking thread-safe?

ASIDE: is the current approach thread-safe?

No — the shared cache object in src/cache/store.ts:34 is mutated without locking.
Under concurrent requests this is a race condition. It's low risk in a single-process
Node.js server but would be a real problem with worker threads or clustering.

WARNING: Note: This could affect the feature we're building. Want to address this now or continue and fix it in a follow-up?
```

***

## 注意事项

* 在旁述期间**绝不**修改文件——仅限只读访问
* 旁述是对话暂停，不是新任务——必须始终恢复原始任务
* 保持回答聚焦：目标是快速为用户扫清障碍，而不是进行长篇大论
* 如果旁述引发了更广泛的讨论，请先完成当前任务，除非旁述揭示了阻碍
* 除非明确与任务结果相关，否则旁述内容不会保存到会话文件中
