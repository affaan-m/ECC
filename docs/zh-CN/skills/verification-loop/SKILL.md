---
name: verification-loop
description: "Claude Code 会话的全面验证系统。"
origin: ECC
---

# 验证循环技能

一个全面的 Claude Code 会话验证系统。

## 何时使用

在以下情况下调用此技能：

* 完成功能或重大代码变更后
* 创建 PR 之前
* 当您希望确保质量门通过时
* 重构之后

## 验证阶段

### 阶段 1：构建验证

```bash
# Check if project builds
npm run build 2>&1 | tail -20
# OR
pnpm build 2>&1 | tail -20
```

如果构建失败，请停止并在继续之前修复。

### 阶段 2：类型检查

```bash
# TypeScript projects
npx tsc --noEmit 2>&1 | head -30

# Python projects
pyright . 2>&1 | head -30
```

报告所有类型错误。在继续之前修复关键错误。

### 阶段 3：代码规范检查

```bash
# JavaScript/TypeScript
npm run lint 2>&1 | head -30

# Python
ruff check . 2>&1 | head -30
```

### 阶段 4：测试套件

```bash
# Run tests with coverage
npm run test -- --coverage 2>&1 | tail -50

# Check coverage threshold
# Target: 80% minimum
```

报告：

* 总测试数：X
* 通过：X
* 失败：X
* 覆盖率：X%

### 阶段 5：安全扫描

```bash
# Check for secrets
grep -rn "sk-" --include="*.ts" --include="*.js" . 2>/dev/null | head -10
grep -rn "api_key" --include="*.ts" --include="*.js" . 2>/dev/null | head -10

# Check for console.log
grep -rn "console.log" --include="*.ts" --include="*.tsx" src/ 2>/dev/null | head -10
```

### 阶段 6：差异审查

```bash
# Show what changed
git diff --stat
git diff HEAD~1 --name-only
```

审查每个更改的文件，检查：

* 意外更改
* 缺失的错误处理
* 潜在的边界情况

## 输出格式

运行所有阶段后，生成验证报告：

```
验证报告
==================

构建:     [通过/失败]
类型:     [通过/失败] (X 处错误)
代码检查:  [通过/失败] (X 条警告)
测试:     [通过/失败] (X/Y 通过，覆盖率 Z%)
安全:     [通过/失败] (X 个问题)
差异:      [X 个文件被修改]

总体:     [就绪/未就绪] 提交 PR

待修复问题:
1. ...
2. ...
```

## 持续模式

对于长时间会话，每 15 分钟或在重大更改后运行验证：

```markdown
设置一个心理检查点：
- 完成每个函数后
- 完成一个组件后
- 在移动到下一个任务之前

运行: /verify

```

## 与钩子的集成

此技能补充 PostToolUse 钩子，但提供更深入的验证。
钩子会立即捕获问题；此技能提供全面的审查。
