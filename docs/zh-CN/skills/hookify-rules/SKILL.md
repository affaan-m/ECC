---
name: hookify-rules
description: 当用户要求创建hookify规则、编写hook规则、配置hookify、添加hookify规则或需要关于hookify规则语法和模式的指导时，应使用此技能。
---

# 编写 Hookify 规则

## 概述

Hookify 规则是带有 YAML 前置元数据的 Markdown 文件，用于定义要监控的模式以及匹配时显示的消息。规则存储在 `.claude/hookify.{rule-name}.local.md` 文件中。

## 规则文件格式

### 基本结构

```markdown
---
name: rule-identifier
enabled: true
event: bash|file|stop|prompt|all
pattern: regex-pattern-here
---

当此规则触发时向 Claude 显示的消息。
可包含 Markdown 格式、警告、建议等内容。
```

### 前置元数据字段

| 字段 | 必填 | 值 | 描述 |
|-------|----------|--------|-------------|
| name | 是 | kebab-case 字符串 | 唯一标识符（动词优先：warn-*、block-*、require-*） |
| enabled | 是 | true/false | 无需删除即可切换 |
| event | 是 | bash/file/stop/prompt/all | 触发规则的钩子事件 |
| action | 否 | warn/block | warn（默认）显示消息；block 阻止操作 |
| pattern | 是* | 正则表达式字符串 | 要匹配的模式（\*或使用 conditions 实现复杂规则） |

### 高级格式（多条件）

```markdown
---
name: warn-env-api-keys
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.env$
  - field: new_text
    operator: contains
    pattern: API_KEY
---

你正在向 .env 文件中添加 API 密钥。请确保该文件已包含在 .gitignore 中！
```

**按事件划分的条件字段：**

* bash：`command`
* file：`file_path`、`new_text`、`old_text`、`content`
* prompt：`user_prompt`

**运算符：** `regex_match`、`contains`、`equals`、`not_contains`、`starts_with`、`ends_with`

所有条件必须同时满足才能触发规则。

## 事件类型指南

### bash 事件

匹配 Bash 命令模式：

* 危险命令：`rm\s+-rf`、`dd\s+if=`、`mkfs`
* 权限提升：`sudo\s+`、`su\s+`
* 权限问题：`chmod\s+777`

### file 事件

匹配编辑/写入/多重编辑操作：

* 调试代码：`console\.log\(`、`debugger`
* 安全风险：`eval\(`、`innerHTML\s*=`
* 敏感文件：`\.env$`、`credentials`、`\.pem$`

### stop 事件

完成检查与提醒。模式 `.*` 始终匹配。

### prompt 事件

匹配用户提示内容以强制执行工作流程。

## 模式编写技巧

### 正则表达式基础

* 转义特殊字符：`.` 转义为 `\.`，`(` 转义为 `\(`
* `\s` 空白字符，`\d` 数字，`\w` 单词字符
* `+` 一个或多个，`*` 零个或多个，`?` 可选
* `|` 或运算符

### 常见陷阱

* **过于宽泛**：`log` 会匹配 "login"、"dialog"——请使用 `console\.log\(`
* **过于具体**：`rm -rf /tmp`——请使用 `rm\s+-rf`
* **YAML 转义**：使用无引号模式；带引号的字符串需要 `\\s`

### 测试

```bash
python3 -c "import re; print(re.search(r'your_pattern', 'test text'))"
```

## 文件组织

* **位置**：项目根目录下的 `.claude/` 目录
* **命名**：`.claude/hookify.{descriptive-name}.local.md`
* **Gitignore**：将 `.claude/*.local.md` 添加到 `.gitignore`

## 命令

* `/hookify [description]` - 创建新规则（无参数时自动分析对话）
* `/hookify-list` - 以表格形式查看所有规则
* `/hookify-configure` - 交互式切换规则开关
* `/hookify-help` - 完整文档

## 快速参考

最小可行规则：

```markdown
---
name: my-rule
enabled: true
event: bash
pattern: dangerous_command
---
此处显示警告信息
```
