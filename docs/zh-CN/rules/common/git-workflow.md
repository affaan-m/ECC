# Git 工作流程

## 提交信息格式

```
<type>: <description>

<optional body>
```

类型：feat, fix, refactor, docs, test, chore, perf, ci

注意：若要禁用共同作者归因，请在 `~/.claude/settings.json` 中设置 `"includeCoAuthoredBy": false`；Claude Code 默认会附加 `Co-Authored-By`，而 ECC 不会附带此设置。

## 拉取请求工作流程

创建 PR 时：

1. 分析完整的提交历史（不仅仅是最近一次提交）
2. 使用 `git diff [base-branch]...HEAD` 查看所有更改
3. 起草全面的 PR 摘要
4. 包含带有 TODO 的测试计划
5. 如果是新分支，使用 `-u` 标志推送

> 有关 git 操作之前的完整开发流程（规划、TDD、代码审查），
> 请参阅 [development-workflow.md](development-workflow.md)。
