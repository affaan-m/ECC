---
name: projects
description: 列出已知项目及其本能统计数据
command: true
---

# 项目命令

列出项目注册条目以及每个项目的本能/观察计数，适用于 continuous-learning-v2。

## 实现

使用插件根路径运行本能 CLI：

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" projects
```

或者如果 `CLAUDE_PLUGIN_ROOT` 未设置（手动安装）：

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py projects
```

## 用法

```bash
/projects
```

## 操作步骤

1. 读取 `~/.claude/homunculus/projects.json`
2. 对于每个项目，显示：
   * 项目名称、ID、根目录、远程地址
   * 个人和继承的本能计数
   * 观察事件计数
   * 最后看到的时间戳
3. 同时显示全局本能总数
