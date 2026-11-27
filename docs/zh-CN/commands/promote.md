---
name: promote
description: 将项目范围内的本能推广到全局范围
command: true
---

# 提升命令

在 continuous-learning-v2 中将本能从项目范围提升到全局范围。

## 实现

使用插件根路径运行本能 CLI：

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" promote [instinct-id] [--force] [--dry-run]
```

或者如果未设置 `CLAUDE_PLUGIN_ROOT`（手动安装）：

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py promote [instinct-id] [--force] [--dry-run]
```

## 用法

```bash
/promote                      # Auto-detect promotion candidates
/promote --dry-run            # Preview auto-promotion candidates
/promote --force              # Promote all qualified candidates without prompt
/promote grep-before-edit     # Promote one specific instinct from current project
```

## 操作步骤

1. 检测当前项目
2. 如果提供了 `instinct-id`，则仅提升该本能（如果存在于当前项目中）
3. 否则，查找跨项目候选本能，这些本能：
   * 出现在至少 2 个项目中
   * 满足置信度阈值
4. 将提升后的本能写入 `~/.claude/homunculus/instincts/personal/`，并设置 `scope: global`
