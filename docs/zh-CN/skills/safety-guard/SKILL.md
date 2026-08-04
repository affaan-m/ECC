---
name: safety-guard
description: 使用此技能可防止在生产系统上工作或自主运行代理时进行破坏性操作。
origin: ECC
---

# 安全防护 — 防止破坏性操作

## 使用场景

* 在生产系统上工作时
* 代理以全自动模式运行时
* 希望将编辑限制在特定目录时
* 敏感操作期间（迁移、部署、数据变更）

## 工作原理

三种保护模式：

### 模式 1：谨慎模式

在执行破坏性命令前进行拦截并发出警告：

```
已监控的模式：
- rm -rf（特别是 /、~ 或项目根目录）
- git push --force
- git reset --hard
- git checkout .（丢弃所有更改）
- DROP TABLE / DROP DATABASE
- docker system prune
- kubectl delete
- chmod 777
- sudo rm
- npm publish（意外发布）
- 任何带有 --no-verify 的命令
```

检测到时：显示命令功能、请求确认、建议更安全的替代方案。

### 模式 2：冻结模式

将文件编辑锁定到特定目录树：

```
/safety-guard freeze src/components/
```

任何在 `src/components/` 之外的写入/编辑操作都会被阻止并附带说明。适用于希望代理专注于某个区域而不触及无关代码的场景。

### 模式 3：守护模式（谨慎+冻结组合）

双重保护同时生效。为自主代理提供最高安全性。

```
/safety-guard guard --dir src/api/ --allow-read-all
```

代理可读取任何内容，但仅能写入 `src/api/`。破坏性命令在所有位置均被阻止。

### 解锁

```
/safety-guard off
```

## 实现方式

通过 PreToolUse 钩子拦截 Bash、Write、Edit 和 MultiEdit 工具调用。在执行前根据活动规则检查命令/路径。

## 集成方案

* 默认在 `codex -a never` 会话中启用
* 配合 ECC 2.0 的可观测性风险评分
* 所有被阻止的操作记录至 `~/.claude/safety-guard.log`
