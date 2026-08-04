---
description: 对抗性双审收敛循环——两个独立模型审查者均需批准后方可发布代码。
---

# 圣诞老人循环

使用圣诞老人方法技能的对立双审收敛循环。两个独立的评审者——不同模型，无共享上下文——必须都返回 NICE 后代码才能发布。

## 目的

针对当前任务输出，运行两个独立的评审者（Claude Opus + 一个外部模型）。两者都必须返回 NICE 后才能推送代码。如果任一返回 NAUGHTY，则修复所有标记的问题，提交，并重新运行全新的评审者——最多 3 轮。

## 用法

```
/santa-loop [file-or-glob | description]
```

## 工作流程

### 步骤 1：确定审查范围

从 `$ARGUMENTS` 确定范围，或回退到未提交的更改：

```bash
git diff --name-only HEAD
```

读取所有已更改的文件以构建完整的审查上下文。如果 `$ARGUMENTS` 指定了路径、文件或描述，则改用该范围。

### 步骤 2：构建评分标准

根据被审查的文件类型构建合适的评分标准。每个标准必须有一个客观的 PASS/FAIL 条件。至少包括：

| 标准 | 通过条件 |
|-----------|---------------|
| 正确性 | 逻辑正确，无错误，处理边界情况 |
| 安全性 | 无秘密、注入、XSS 或 OWASP Top 10 问题 |
| 错误处理 | 显式处理错误，无静默吞没 |
| 完整性 | 所有需求均已满足，无遗漏情况 |
| 内部一致性 | 文件或章节之间无矛盾 |
| 无回归 | 更改不破坏现有行为 |

根据文件类型添加领域特定标准（例如，TypeScript 的类型安全，Rust 的内存安全，SQL 的迁移安全）。

### 步骤 3：双独立审查

使用 Agent 工具**并行**启动两个评审者（两者在单条消息中以便并发执行）。两者都必须完成才能进入裁决门。

每个评审者评估每个评分标准为 PASS 或 FAIL，然后返回结构化 JSON：

```json
{
  "verdict": "PASS" | "FAIL",
  "checks": [
    {"criterion": "...", "result": "PASS|FAIL", "detail": "..."}
  ],
  "critical_issues": ["..."],
  "suggestions": ["..."]
}
```

裁决门（步骤 4）将这些映射为 NICE/NAUGHTY：两者都 PASS → NICE，任一 FAIL → NAUGHTY。

#### 评审者 A：Claude Agent（始终运行）

启动一个 Agent（subagent\_type: `code-reviewer`，model: `opus`），包含完整的评分标准 + 所有被审查的文件。提示必须包括：

* 完整的评分标准
* 所有被审查的文件内容
* "你是一个独立的质量评审者。你没有看到任何其他评审。你的工作是发现问题，而不是批准。"
* 返回上述结构化 JSON 裁决

#### 评审者 B：外部模型（仅当未安装外部 CLI 时回退到 Claude）

首先，检测哪些 CLI 可用：

```bash
command -v codex >/dev/null 2>&1 && echo "codex" || true
command -v gemini >/dev/null 2>&1 && echo "gemini" || true
```

构建评审者提示（与评审者 A 相同的评分标准和说明）并将其写入唯一的临时文件：

```bash
PROMPT_FILE=$(mktemp /tmp/santa-reviewer-b-XXXXXX.txt)
cat > "$PROMPT_FILE" << 'EOF'
... full rubric + file contents + reviewer instructions ...
EOF
```

使用第一个可用的 CLI：

**Codex CLI**（如果已安装）

```bash
codex exec --sandbox read-only -m gpt-5.4 -C "$(pwd)" - < "$PROMPT_FILE"
rm -f "$PROMPT_FILE"
```

**Gemini CLI**（如果已安装且 codex 未安装）

```bash
gemini -p "$(cat "$PROMPT_FILE")" -m gemini-2.5-pro
rm -f "$PROMPT_FILE"
```

**Claude Agent 回退**（仅当 `codex` 和 `gemini` 均未安装时）
启动第二个 Claude Agent（subagent\_type: `code-reviewer`，model: `opus`）。记录一条警告，说明两个评审者共享相同的模型家族——未实现真正的模型多样性，但上下文隔离仍然得到强制执行。

在所有情况下，评审者必须返回与评审者 A 相同的结构化 JSON 裁决。

### 步骤 4：裁决门

* **两者都 PASS** → **NICE** — 继续执行步骤 6（推送）
* **任一 FAIL** → **NAUGHTY** — 合并两个评审者的所有关键问题，去重，继续执行步骤 5

### 步骤 5：修复循环（NAUGHTY 路径）

1. 显示两个评审者的所有关键问题
2. 修复每个标记的问题——仅更改被标记的内容，不进行附带重构
3. 将所有修复提交到单个提交中：
   ```
   fix: 解决圣诞老人循环审查发现的问题（第 N 轮）
   ```
4. 使用**全新的评审者**（无先前轮次的记忆）重新运行步骤 3
5. 重复直到两者都返回 PASS

**最多 3 次迭代。** 如果 3 轮后仍为 NAUGHTY，则停止并呈现剩余问题：

```
圣诞循环升级（超过3次迭代）

3轮后仍存在的问题：
- [列出两位评审员所有未解决的关键问题]

继续前需进行人工审核。
```

不要推送。

### 步骤 6：推送（NICE 路径）

当两个评审者都返回 PASS 时：

```bash
git push -u origin HEAD
```

### 步骤 7：最终报告

打印输出报告（参见下面的输出部分）。

## 输出

```
SANTA VERDICT: [NICE / NAUGHTY (escalated)]

Reviewer A (Claude Opus):   [PASS/FAIL]
Reviewer B ([model used]):  [PASS/FAIL]

Agreement:
  Both flagged:      [issues caught by both]
  Reviewer A only:   [issues only A caught]
  Reviewer B only:   [issues only B caught]

Iterations: [N]/3
Result:     [PUSHED / ESCALATED TO USER]
```

## 备注

* 评审者 A（Claude Opus）始终运行——无论工具如何，保证至少有一个强大的评审者。
* 模型多样性是评审者 B 的目标。GPT-5.4 或 Gemini 2.5 Pro 提供真正的独立性——不同的训练数据、不同的偏见、不同的盲点。仅 Claude 的回退通过上下文隔离仍然提供价值，但失去了模型多样性。
* 使用最强可用模型：Opus 用于评审者 A，GPT-5.4 或 Gemini 2.5 Pro 用于评审者 B。
* 外部评审者使用 `--sandbox read-only`（Codex）运行，以防止审查期间仓库发生变异。
* 每轮使用全新的评审者可以防止先前发现导致的锚定偏差。
* 评分标准是最重要的输入。如果评审者盖章通过或标记主观风格问题，请收紧评分标准。
* 在 NAUGHTY 轮次进行提交，以便即使循环被中断，修复也能被保留。
* 仅在 NICE 后推送——绝不在循环中间推送。
