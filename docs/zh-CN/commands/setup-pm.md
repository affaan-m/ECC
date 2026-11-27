---
description: 配置您首选的包管理器（npm/pnpm/yarn/bun）
disable-model-invocation: true
---

# 包管理器设置

配置您为此项目或全局偏好的包管理器。

## 使用方式

```bash
# Detect current package manager
node scripts/setup-package-manager.js --detect

# Set global preference
node scripts/setup-package-manager.js --global pnpm

# Set project preference
node scripts/setup-package-manager.js --project bun

# List available package managers
node scripts/setup-package-manager.js --list
```

## 检测优先级

在确定使用哪个包管理器时，会按以下顺序检查：

1. **环境变量**：`CLAUDE_PACKAGE_MANAGER`
2. **项目配置**：`.claude/package-manager.json`
3. **package.json**：`packageManager` 字段
4. **锁文件**：package-lock.json、yarn.lock、pnpm-lock.yaml 或 bun.lockb 的存在
5. **全局配置**：`~/.claude/package-manager.json`
6. **回退方案**：第一个可用的包管理器 (pnpm > bun > yarn > npm)

## 配置文件

### 全局配置

```json
// ~/.claude/package-manager.json
{
  "packageManager": "pnpm"
}
```

### 项目配置

```json
// .claude/package-manager.json
{
  "packageManager": "bun"
}
```

### package.json

```json
{
  "packageManager": "pnpm@8.6.0"
}
```

## 环境变量

设置 `CLAUDE_PACKAGE_MANAGER` 以覆盖所有其他检测方法：

```bash
# Windows (PowerShell)
$env:CLAUDE_PACKAGE_MANAGER = "pnpm"

# macOS/Linux
export CLAUDE_PACKAGE_MANAGER=pnpm
```

## 运行检测

要查看当前包管理器检测结果，请运行：

```bash
node scripts/setup-package-manager.js --detect
```
