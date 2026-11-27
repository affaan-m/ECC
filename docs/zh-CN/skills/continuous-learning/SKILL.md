---
name: continuous-learning
description: 自动从Claude Code会话中提取可重复使用的模式，并将其保存为学习到的技能以供将来使用。
origin: ECC
---

# 持续学习技能

自动评估 Claude Code 会话的结尾，以提取可重用的模式，这些模式可以保存为学习到的技能。

## 何时激活

* 设置从 Claude Code 会话中自动提取模式
* 为会话评估配置停止钩子
* 在 `~/.claude/skills/learned/` 中审查或整理已学习的技能
* 调整提取阈值或模式类别
* 比较 v1（本方法）与 v2（基于本能的方法）

## 工作原理

此技能作为 **停止钩子** 在每个会话结束时运行：

1. **会话评估**：检查会话是否包含足够多的消息（默认：10 条以上）
2. **模式检测**：从会话中识别可提取的模式
3. **技能提取**：将有用的模式保存到 `~/.claude/skills/learned/`

## 配置

编辑 `config.json` 以进行自定义：

```json
{
  "min_session_length": 10,
  "extraction_threshold": "medium",
  "auto_approve": false,
  "learned_skills_path": "~/.claude/skills/learned/",
  "patterns_to_detect": [
    "error_resolution",
    "user_corrections",
    "workarounds",
    "debugging_techniques",
    "project_specific"
  ],
  "ignore_patterns": [
    "simple_typos",
    "one_time_fixes",
    "external_api_issues"
  ]
}
```

## 模式类型

| 模式 | 描述 |
|---------|-------------|
| `error_resolution` | 特定错误是如何解决的 |
| `user_corrections` | 来自用户纠正的模式 |
| `workarounds` | 框架/库特殊性的解决方案 |
| `debugging_techniques` | 有效的调试方法 |
| `project_specific` | 项目特定的约定 |

## 钩子设置

添加到你的 `~/.claude/settings.json` 中：

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning/evaluate-session.sh"
      }]
    }]
  }
}
```

## 为什么使用停止钩子？

* **轻量级**：仅在会话结束时运行一次
* **非阻塞**：不会给每条消息增加延迟
* **完整上下文**：可以访问完整的会话记录

## 相关

* [长篇指南](https://x.com/affaanmustafa/status/2014040193557471352) - 关于持续学习的章节
* `/learn` 命令 - 在会话中手动提取模式

***

## 对比说明（研究：2025年1月）

### 与 Homunculus 的对比

Homunculus v2 采用了更复杂的方法：

| 功能 | 我们的方法 | Homunculus v2 |
|---------|--------------|---------------|
| 观察 | 停止钩子（会话结束时） | PreToolUse/PostToolUse 钩子（100% 可靠） |
| 分析 | 主上下文 | 后台代理 (Haiku) |
| 粒度 | 完整技能 | 原子化的“本能” |
| 置信度 | 无 | 0.3-0.9 加权 |
| 演进 | 直接到技能 | 本能 → 集群 → 技能/命令/代理 |
| 共享 | 无 | 导出/导入本能 |

**来自 homunculus 的关键见解：**

> "v1 依赖技能来观察。技能是概率性的——它们触发的概率约为 50-80%。v2 使用钩子进行观察（100% 可靠），并以本能作为学习行为的原子单元。"

### 潜在的 v2 增强功能

1. **基于本能的学习** - 更小、原子化的行为，附带置信度评分
2. **后台观察者** - Haiku 代理并行分析
3. **置信度衰减** - 如果被反驳，本能会降低置信度
4. **领域标记** - 代码风格、测试、git、调试等
5. **演进路径** - 将相关本能聚类为技能/命令

参见：`docs/continuous-learning-v2-spec.md` 以获取完整规范。
