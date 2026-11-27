# /learn - 提取可重用模式

分析当前会话，提取值得保存为技能的任何模式。

## 触发时机

在会话期间的任何时刻，当你解决了一个非平凡问题时，运行 `/learn`。

## 提取内容

寻找：

1. **错误解决模式**
   * 出现了什么错误？
   * 根本原因是什么？
   * 什么方法修复了它？
   * 这对解决类似错误是否可重用？

2. **调试技术**
   * 不明显的调试步骤
   * 有效的工具组合
   * 诊断模式

3. **变通方法**
   * 库的怪癖
   * API 限制
   * 特定版本的修复

4. **项目特定模式**
   * 发现的代码库约定
   * 做出的架构决策
   * 集成模式

## 输出格式

在 `~/.claude/skills/learned/[pattern-name].md` 创建一个技能文件：

```markdown
# [Descriptive Pattern Name]

**Extracted:** [Date]
**Context:** [Brief description of when this applies]

## Problem
[What problem this solves - be specific]

## Solution
[The pattern/technique/workaround]

## Example
[Code example if applicable]

## When to Use
[Trigger conditions - what should activate this skill]
```

## 流程

1. 回顾会话，寻找可提取的模式
2. 识别最有价值/可重用的见解
3. 起草技能文件
4. 在保存前请用户确认
5. 保存到 `~/.claude/skills/learned/`

## 注意事项

* 不要提取琐碎的修复（拼写错误、简单的语法错误）
* 不要提取一次性问题（特定的 API 中断等）
* 专注于那些将在未来会话中节省时间的模式
* 保持技能的专注性 - 一个技能对应一个模式
