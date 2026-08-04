---
description: "使用自然语言文件定位快速提交 — 用简单的英语描述要提交的内容"
argument-hint: "[target description] (blank = all changes)"
---

# 智能提交

> 改编自 Wirasm 的 PRPs-agentic-eng。属于 PRP 工作流系列。

**输入**：$ARGUMENTS

***

## 阶段 1 — 评估

```bash
git status --short
```

如果输出为空 → 停止："没有可提交的内容。"

向用户展示变更摘要（新增、修改、删除、未跟踪）。

***

## 阶段 2 — 解析与暂存

解析 `$ARGUMENTS` 以确定暂存内容：

| 输入 | 解析结果 | Git 命令 |
|---|---|---|
| *(空白/空)* | 暂存所有内容 | `git add -A` |
| `staged` | 使用已暂存的内容 | *(不执行 git add)* |
| `*.ts` 或 `*.py` 等 | 暂存匹配的 glob 模式 | `git add '*.ts'` |
| `except tests` | 暂存所有内容，然后取消暂存测试文件 | `git add -A && git reset -- '**/*.test.*' '**/*.spec.*' '**/test_*' 2>/dev/null \|\| true` |
| `only new files` | 仅暂存未跟踪文件 | `git ls-files --others --exclude-standard \| grep . && git ls-files --others --exclude-standard \| xargs git add` |
| `the auth changes` | 从状态/差异中解析 — 查找与认证相关的文件 | `git add <matched files>` |
| 具体文件名 | 暂存这些文件 | `git add <files>` |

对于自然语言输入（如"认证相关的变更"），交叉引用 `git status` 输出和 `git diff` 以识别相关文件。向用户展示你暂存了哪些文件及其原因。

```bash
git add <determined files>
```

暂存后，验证：

```bash
git diff --cached --stat
```

如果未暂存任何内容，停止："没有文件匹配你的描述。"

***

## 阶段 3 — 提交

使用祈使语气编写单行提交信息：

```
{type}: {description}
```

类型：

* `feat` — 新功能或能力
* `fix` — 错误修复
* `refactor` — 代码重构，行为不变
* `docs` — 文档变更
* `test` — 添加或更新测试
* `chore` — 构建、配置、依赖项
* `perf` — 性能改进
* `ci` — CI/CD 变更

规则：

* 祈使语气（"添加功能"而非"已添加功能"）
* 类型前缀后使用小写
* 末尾不加句号
* 不超过 72 个字符
* 描述变更内容，而非方式

```bash
git commit -m "{type}: {description}"
```

***

## 阶段 4 — 输出

向用户报告：

```
Committed: {hash_short}
Message:   {type}: {description}
Files:     {count} 个文件已更改

下一步：
  - git push           → 推送到远程
  - /prp-pr            → 创建拉取请求
  - /code-review       → 推送前进行代码审查
```

***

## 示例

| 你说 | 执行结果 |
|---|---|
| `/prp-commit` | 暂存所有内容，自动生成信息 |
| `/prp-commit staged` | 仅提交已暂存的内容 |
| `/prp-commit *.ts` | 暂存所有 TypeScript 文件，然后提交 |
| `/prp-commit except tests` | 暂存除测试文件外的所有内容 |
| `/prp-commit the database migration` | 从状态中查找数据库迁移文件，暂存它们 |
| `/prp-commit only new files` | 仅暂存未跟踪文件 |
