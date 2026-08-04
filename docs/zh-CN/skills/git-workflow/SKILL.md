---
name: git-workflow
description: Git工作流模式，包括分支策略、提交约定、合并与变基、冲突解决以及适用于各种规模团队的协作开发最佳实践。
origin: ECC
---

# Git 工作流模式

Git 版本控制、分支策略与协作开发的最佳实践。

## 何时启用

* 为新项目设置 Git 工作流
* 决定分支策略（GitFlow、主干开发、GitHub Flow）
* 编写提交信息和 PR 描述
* 解决合并冲突
* 管理发布和版本标签
* 让新团队成员熟悉 Git 实践

## 分支策略

### GitHub Flow（简单，推荐大多数场景使用）

最适合持续部署以及中小型团队。

```
main (protected, always deployable)
  │
  ├── feature/user-auth      → PR → merge to main
  ├── feature/payment-flow   → PR → merge to main
  └── fix/login-bug          → PR → merge to main
```

**规则：**

* `main` 始终可部署
* 从 `main` 创建功能分支
* 准备就绪后发起 Pull Request
* 审核通过且 CI 通过后，合并到 `main`
* 合并后立即部署

### 主干开发（高速度团队）

最适合具备强大 CI/CD 和功能开关的团队。

```
main (主干)
  │
  ├── 短期功能分支（最长1-2天）
  ├── 短期功能分支
  └── 短期功能分支
```

**规则：**

* 所有人直接提交到 `main` 或使用极短生命周期的分支
* 功能开关隐藏未完成的工作
* 合并前必须通过 CI
* 每天多次部署

### GitFlow（复杂，基于发布周期）

适合计划性发布和企业级项目。

```
main (生产发布版本)
  │
  └── develop (集成分支)
        │
        ├── feature/user-auth
        ├── feature/payment
        │
        ├── release/1.0.0    → 合并到 main 和 develop
        │
        └── hotfix/critical  → 合并到 main 和 develop
```

**规则：**

* `main` 仅包含生产就绪代码
* `develop` 是集成分支
* 功能分支从 `develop` 创建，合并回 `develop`
* 发布分支从 `develop` 创建，合并到 `main` 和 `develop`
* 热修复分支从 `main` 创建，合并到 `main` 和 `develop`

### 何时使用哪种策略

| 策略 | 团队规模 | 发布频率 | 最佳适用场景 |
|----------|-----------|-----------------|----------|
| GitHub Flow | 任意 | 持续 | SaaS、Web 应用、初创公司 |
| 主干开发 | 5 人以上有经验 | 每天多次 | 高速度团队、功能开关 |
| GitFlow | 10 人以上 | 计划性 | 企业、受监管行业 |

## 提交信息

### 常规提交格式

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### 类型

| 类型 | 用途 | 示例 |
|------|---------|---------|
| `feat` | 新功能 | `feat(auth): add OAuth2 login` |
| `fix` | 错误修复 | `fix(api): handle null response in user endpoint` |
| `docs` | 文档 | `docs(readme): update installation instructions` |
| `style` | 格式调整，无代码变更 | `style: fix indentation in login component` |
| `refactor` | 代码重构 | `refactor(db): extract connection pool to module` |
| `test` | 添加/更新测试 | `test(auth): add unit tests for token validation` |
| `chore` | 维护任务 | `chore(deps): update dependencies` |
| `perf` | 性能改进 | `perf(query): add index to users table` |
| `ci` | CI/CD 变更 | `ci: add PostgreSQL service to test workflow` |
| `revert` | 回滚之前的提交 | `revert: revert "feat(auth): add OAuth2 login"` |

### 好与坏的示例

```
# 不好：模糊，无上下文
git commit -m "修复了一些东西"
git commit -m "更新"
git commit -m "进行中"

# 好：清晰，具体，解释原因
git commit -m "fix(api): 在 503 服务不可用时重试请求

外部 API 在高峰时段偶尔会返回 503 错误。
添加了指数退避重试逻辑，最多尝试 3 次。

关闭 #123"
```

### 提交信息模板

在仓库根目录创建 `.gitmessage`：

```
# <type>(<scope>): <subject>
# # 类型：feat, fix, docs, style, refactor, test, chore, perf, ci, revert
# 范围：api, ui, db, auth 等
# 主题：祈使语气，无句号，最多50个字符
#
# [可选正文] - 解释原因，而非内容
# [可选脚注] - 破坏性变更，关闭 #issue
```

启用方式：`git config commit.template .gitmessage`

## 合并 vs 变基

### 合并（保留历史）

```bash
# Creates a merge commit
git checkout main
git merge feature/user-auth

# Result:
# *   merge commit
# |\
# | * feature commits
# |/
# * main commits
```

**适用场景：**

* 将功能分支合并到 `main`
* 希望保留完整历史
* 多人共同开发该分支
* 分支已推送，其他人可能基于它开展工作

### 变基（线性历史）

```bash
# Rewrites feature commits onto target branch
git checkout feature/user-auth
git rebase main

# Result:
# * feature commits (rewritten)
# * main commits
```

**适用场景：**

* 用最新的 `main` 更新本地功能分支
* 希望获得线性、干净的历史
* 分支仅存在于本地（未推送）
* 只有你一个人在该分支上工作

### 变基工作流

```bash
# Update feature branch with latest main (before PR)
git checkout feature/user-auth
git fetch origin
git rebase origin/main

# Fix any conflicts
# Tests should still pass

# Force push (only if you're the only contributor)
git push --force-with-lease origin feature/user-auth
```

### 何时不应变基

```
# 切勿变基以下分支：
- 已推送至共享仓库的分支
- 他人已基于其工作的分支
- 受保护分支（main、develop）
- 已合并的分支

# 原因：变基会重写历史，破坏他人的工作
```

## Pull Request 工作流

### PR 标题格式

```
<type>(<scope>): <description>

示例：
feat(auth): add SSO support for enterprise users
fix(api): resolve race condition in order processing
docs(api): add OpenAPI specification for v2 endpoints
```

### PR 描述模板

```markdown
## 内容

简要描述此 PR 的内容。

## 动机

解释动机和背景。

## 实现方式

值得强调的关键实现细节。

## 测试

- [ ] 新增/更新单元测试
- [ ] 新增/更新集成测试
- [ ] 执行手动测试

## 截图（如适用）

UI 变更的前后对比截图。

## 检查清单

- [ ] 代码遵循项目风格指南
- [ ] 完成自我审查
- [ ] 为复杂逻辑添加注释
- [ ] 更新文档
- [ ] 未引入新警告
- [ ] 测试在本地通过
- [ ] 关联问题已链接

关闭 #123
```

### 代码审查清单

**审查者：**

* \[ ] 代码是否解决了所述问题？
* \[ ] 是否处理了所有边界情况？
* \[ ] 代码是否可读且易于维护？
* \[ ] 是否有足够的测试？
* \[ ] 是否存在安全问题？
* \[ ] 提交历史是否干净（必要时已压缩）？

**作者：**

* \[ ] 在请求审查前已完成自我审查
* \[ ] CI 通过（测试、lint、类型检查）
* \[ ] PR 大小合理（理想情况下 <500 行）
* \[ ] 与单个功能/修复相关
* \[ ] 描述清晰解释了变更内容

## 冲突解决

### 识别冲突

```bash
# Check for conflicts before merge
git checkout main
git merge feature/user-auth --no-commit --no-ff

# If conflicts, Git will show:
# CONFLICT (content): Merge conflict in src/auth/login.ts
# Automatic merge failed; fix conflicts and then commit the result.
```

### 解决冲突

```bash
# See conflicted files
git status

# View conflict markers in file
# <<<<<<< HEAD
# content from main
# =======
# content from feature branch
# >>>>>>> feature/user-auth

# Option 1: Manual resolution
# Edit file, remove markers, keep correct content

# Option 2: Use merge tool
git mergetool

# Option 3: Accept one side
git checkout --ours src/auth/login.ts    # Keep main version
git checkout --theirs src/auth/login.ts  # Keep feature version

# After resolving, stage and commit
git add src/auth/login.ts
git commit
```

### 冲突预防策略

```bash
# 1. Keep feature branches small and short-lived
# 2. Rebase frequently onto main
git checkout feature/user-auth
git fetch origin
git rebase origin/main

# 3. Communicate with team about touching shared files
# 4. Use feature flags instead of long-lived branches
# 5. Review and merge PRs promptly
```

## 分支管理

### 命名规范

```
# 功能分支
feature/user-authentication
feature/JIRA-123-payment-integration

# 错误修复
fix/login-redirect-loop
fix/456-null-pointer-exception

# 热修复（生产问题）
hotfix/critical-security-patch
hotfix/database-connection-leak

# 发布版本
release/1.2.0
release/2024-01-hotfix

# 实验/概念验证
experiment/new-caching-strategy
poc/graphql-migration
```

### 分支清理

```bash
# Delete local branches that are merged
git branch --merged main | grep -v "^\*\|main" | xargs -n 1 git branch -d

# Delete remote-tracking references for deleted remote branches
git fetch -p

# Delete local branch
git branch -d feature/user-auth  # Safe delete (only if merged)
git branch -D feature/user-auth  # Force delete

# Delete remote branch
git push origin --delete feature/user-auth
```

### 暂存工作流

```bash
# Save work in progress
git stash push -m "WIP: user authentication"

# List stashes
git stash list

# Apply most recent stash
git stash pop

# Apply specific stash
git stash apply stash@{2}

# Drop stash
git stash drop stash@{0}
```

## 发布管理

### 语义化版本

```
MAJOR.MINOR.PATCH

MAJOR：破坏性变更
MINOR：新功能，向后兼容
PATCH：错误修复，向后兼容

示例：
1.0.0 → 1.0.1（补丁：错误修复）
1.0.1 → 1.1.0（次要：新功能）
1.1.0 → 2.0.0（主要：破坏性变更）
```

### 创建发布

```bash
# Create annotated tag
git tag -a v1.2.0 -m "Release v1.2.0

Features:
- Add user authentication
- Implement password reset

Fixes:
- Resolve login redirect issue

Breaking Changes:
- None"

# Push tag to remote
git push origin v1.2.0

# List tags
git tag -l

# Delete tag
git tag -d v1.2.0
git push origin --delete v1.2.0
```

### 变更日志生成

```bash
# Generate changelog from commits
git log v1.1.0..v1.2.0 --oneline --no-merges

# Or use conventional-changelog
npx conventional-changelog -i CHANGELOG.md -s
```

## Git 配置

### 基本配置

```bash
# User identity
git config --global user.name "Your Name"
git config --global user.email "your@email.com"

# Default branch name
git config --global init.defaultBranch main

# Pull behavior (rebase instead of merge)
git config --global pull.rebase true

# Push behavior (push current branch only)
git config --global push.default current

# Auto-correct typos
git config --global help.autocorrect 1

# Better diff algorithm
git config --global diff.algorithm histogram

# Color output
git config --global color.ui auto
```

### 实用别名

```bash
# Add to ~/.gitconfig
[alias]
    co = checkout
    br = branch
    ci = commit
    st = status
    unstage = reset HEAD --
    last = log -1 HEAD
    visual = log --oneline --graph --all
    amend = commit --amend --no-edit
    wip = commit -m "WIP"
    undo = reset --soft HEAD~1
    contributors = shortlog -sn
```

### Gitignore 模式

```gitignore
# Dependencies
node_modules/
vendor/

# Build outputs
dist/
build/
*.o
*.exe

# Environment files
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# Test coverage
coverage/

# Cache
.cache/
*.tsbuildinfo
```

## 常见工作流

### 开始新功能

```bash
# 1. Update main branch
git checkout main
git pull origin main

# 2. Create feature branch
git checkout -b feature/user-auth

# 3. Make changes and commit
git add .
git commit -m "feat(auth): implement OAuth2 login"

# 4. Push to remote
git push -u origin feature/user-auth

# 5. Create Pull Request on GitHub/GitLab
```

### 用新变更更新 PR

```bash
# 1. Make additional changes
git add .
git commit -m "feat(auth): add error handling"

# 2. Push updates
git push origin feature/user-auth
```

### 同步 Fork 与上游

```bash
# 1. Add upstream remote (once)
git remote add upstream https://github.com/original/repo.git

# 2. Fetch upstream
git fetch upstream

# 3. Merge upstream/main into your main
git checkout main
git merge upstream/main

# 4. Push to your fork
git push origin main
```

### 撤销错误操作

```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Undo last commit pushed to remote
git revert HEAD
git push origin main

# Undo specific file changes
git checkout HEAD -- path/to/file

# Fix last commit message
git commit --amend -m "New message"

# Add forgotten file to last commit
git add forgotten-file
git commit --amend --no-edit
```

## Git 钩子

### 预提交钩子

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Run linting
npm run lint || exit 1

# Run tests
npm test || exit 1

# Check for secrets
if git diff --cached | grep -E '(password|api_key|secret)'; then
    echo "Possible secret detected. Commit aborted."
    exit 1
fi
```

### 预推送钩子

```bash
#!/bin/bash
# .git/hooks/pre-push

# Run full test suite
npm run test:all || exit 1

# Check for console.log statements
if git diff origin/main | grep -E 'console\.log'; then
    echo "Remove console.log statements before pushing."
    exit 1
fi
```

## 反模式

```
# 错误：直接提交到主分支
git checkout main
git commit -m "修复bug"

# 正确：使用功能分支和拉取请求

# 错误：提交机密信息
git add .env  # 包含API密钥

# 正确：添加到.gitignore，使用环境变量

# 错误：巨大的拉取请求（超过1000行）
# 正确：拆分为更小、更聚焦的拉取请求

# 错误："更新"类提交信息
git commit -m "更新"
git commit -m "修复"

# 正确：描述性信息
git commit -m "fix(auth): 解决登录后的重定向循环问题"

# 错误：重写公共历史
git push --force origin main

# 正确：对公共分支使用回退
git revert HEAD

# 错误：长期存在的功能分支（数周/数月）
# 正确：保持分支短期（数天），频繁变基

# 错误：提交生成的文件
git add dist/
git add node_modules/

# 正确：添加到.gitignore
```

## 快速参考

| 任务 | 命令 |
|------|---------|
| 创建分支 | `git checkout -b feature/name` |
| 切换分支 | `git checkout branch-name` |
| 删除分支 | `git branch -d branch-name` |
| 合并分支 | `git merge branch-name` |
| 变基分支 | `git rebase main` |
| 查看历史 | `git log --oneline --graph` |
| 查看变更 | `git diff` |
| 暂存变更 | `git add .` 或 `git add -p` |
| 提交 | `git commit -m "message"` |
| 推送 | `git push origin branch-name` |
| 拉取 | `git pull origin branch-name` |
| 暂存 | `git stash push -m "message"` |
| 撤销上次提交 | `git reset --soft HEAD~1` |
| 回滚提交 | `git revert HEAD` |
