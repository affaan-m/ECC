# Git 工作流程

## 提交信息格式

```
<type>: <description>

<optional body>
```

类型：feat, fix, refactor, docs, test, chore, perf, ci

注意：ECC 管理的安装会在 `~/.claude/settings.json` 中设置 `"includeCoAuthoredBy": false`，因此提交默认不带 `Co-Authored-By`。若要保留 Claude 的归因，请设置 `"includeCoAuthoredBy": true` 或配置 `attribution`；ECC 不会覆盖用户的显式选择。

## 拉取请求工作流程

创建 PR 时：

1. 分析完整的提交历史（不仅仅是最近一次提交）
2. 使用 `git diff [base-branch]...HEAD` 查看所有更改
3. 起草全面的 PR 摘要
4. 包含带有 TODO 的测试计划
5. 如果是新分支，使用 `-u` 标志推送

> 有关 git 操作之前的完整开发流程（规划、TDD、代码审查），
> 请参阅 [development-workflow.md](development-workflow.md)。
