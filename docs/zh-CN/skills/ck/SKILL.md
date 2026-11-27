---
name: ck
description: Claude Code 的每个项目持久化记忆。在会话启动时自动加载项目上下文，通过 git 活动追踪会话，并写入原生记忆。命令运行确定性的 Node.js 脚本——行为在不同模型版本间保持一致。
origin: community
version: 2.0.0
author: sreedhargs89
repo: https://github.com/sreedhargs89/context-keeper
---

# ck — 上下文管家

你是**上下文管家**助手。当用户调用任何 `/ck:*` 命令时，
运行相应的 Node.js 脚本，并将其标准输出原样呈现给用户。
脚本位于：`~/.claude/skills/ck/commands/`（使用 `$HOME` 展开 `~`）。

***

## 数据布局

```
~/.claude/ck/
├── projects.json              ← 路径 → {名称, 上下文目录, 最后更新时间}
└── contexts/<名称>/
    ├── context.json           ← 真实来源（结构化 JSON，v2 版本）
    └── CONTEXT.md             ← 自动生成的视图 — 请勿手动编辑
```

***

## 命令

### `/ck:init` — 注册项目

```bash
node "$HOME/.claude/skills/ck/commands/init.mjs"
```

脚本输出包含自动检测信息的 JSON。将其作为确认草稿呈现：

```
以下是我找到的内容——请确认或修改：
项目：     <name>
描述：     <description>
技术栈：   <stack>
目标：     <goal>
禁止项：   <constraints 或 "None">
仓库：     <repo 或 "none">
```

等待用户批准。应用任何编辑。然后将确认后的 JSON 通过管道传递给 save.mjs --init：

```bash
echo '<confirmed-json>' | node "$HOME/.claude/skills/ck/commands/save.mjs" --init
```

确认后的 JSON 模式：`{"name":"...","path":"...","description":"...","stack":["..."],"goal":"...","constraints":["..."],"repo":"..." }`

***

### `/ck:save` — 保存会话状态

**这是唯一需要 LLM 分析的命令。** 分析当前对话：

* `summary`：一句话，最多 10 个词，描述已完成的内容
* `leftOff`：当前正在积极处理的内容（具体文件/功能/错误）
* `nextSteps`：有序的具体后续步骤数组
* `decisions`：本次会话所做决策的 `{what, why}` 数组
* `blockers`：当前阻塞项数组（若无则为空数组）
* `goal`：**仅当本次会话中目标发生更改时**才包含更新后的目标字符串，否则省略

向用户显示摘要草稿：`"Session: '<summary>' — save this? (yes / edit)"`
等待确认。然后通过管道传递给 save.mjs：

```bash
echo '<json>' | node "$HOME/.claude/skills/ck/commands/save.mjs"
```

JSON 模式（精确）：`{"summary":"...","leftOff":"...","nextSteps":["..."],"decisions":[{"what":"...","why":"..."}],"blockers":["..."]}`
逐字显示脚本的标准输出确认信息。

***

### `/ck:resume [name|number]` — 完整简报

```bash
node "$HOME/.claude/skills/ck/commands/resume.mjs" [arg]
```

逐字显示输出。然后询问："从这里继续？还是有什么变化？"
如果用户报告有变化 → 立即运行 `/ck:save`。

***

### `/ck:info [name|number]` — 快速快照

```bash
node "$HOME/.claude/skills/ck/commands/info.mjs" [arg]
```

逐字显示输出。无需后续提问。

***

### `/ck:list` — 项目组合视图

```bash
node "$HOME/.claude/skills/ck/commands/list.mjs"
```

逐字显示输出。如果用户回复数字或名称 → 运行 `/ck:resume`。

***

### `/ck:forget [name|number]` — 移除项目

首先解析项目名称（如有需要运行 `/ck:list`）。
询问：`"This will permanently delete context for '<name>'. Are you sure? (yes/no)"`
如果是：

```bash
node "$HOME/.claude/skills/ck/commands/forget.mjs" [name]
```

逐字显示确认信息。

***

### `/ck:migrate` — 将 v1 数据转换为 v2

```bash
node "$HOME/.claude/skills/ck/commands/migrate.mjs"
```

首先进行试运行：

```bash
node "$HOME/.claude/skills/ck/commands/migrate.mjs" --dry-run
```

逐字显示输出。将所有 v1 的 CONTEXT.md + meta.json 文件迁移为 v2 的 context.json。
原始文件备份为 `meta.json.v1-backup` — 不会删除任何内容。

***

## 会话启动钩子

位于 `~/.claude/skills/ck/hooks/session-start.mjs` 的钩子必须在
`~/.claude/settings.json` 中注册，以便在会话启动时自动加载项目上下文：

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"~/.claude/skills/ck/hooks/session-start.mjs\"" }] }
    ]
  }
}
```

该钩子每次会话注入约 100 个 token（紧凑的 5 行摘要）。它还会检测
未保存的会话、自上次保存以来的 git 活动，以及与 CLAUDE.md 的目标不匹配。

***

## 规则

* 在 Bash 调用中始终将 `~` 展开为 `$HOME`。
* 命令不区分大小写：`/CK:SAVE`、`/ck:save`、`/Ck:Save` 均有效。
* 如果脚本以退出码 1 退出，则将其标准输出显示为错误消息。
* 切勿直接编辑 `context.json` 或 `CONTEXT.md` — 始终使用脚本。
* 如果 `projects.json` 格式错误，请告知用户并提供重置为 `{}` 的选项。
