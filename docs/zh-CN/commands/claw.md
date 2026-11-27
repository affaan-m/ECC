---
description: 启动 NanoClaw v2 — ECC 的持久、零依赖 REPL，具备模型路由、技能热加载、分支、压缩、导出和指标功能。
---

# Claw 命令

启动一个具有持久化 Markdown 历史记录和操作控制的交互式 AI 代理会话。

## 使用方法

```bash
node scripts/claw.js
```

或通过 npm：

```bash
npm run claw
```

## 环境变量

| 变量 | 默认值 | 描述 |
|----------|---------|-------------|
| `CLAW_SESSION` | `default` | 会话名称（字母数字 + 连字符） |
| `CLAW_SKILLS` | *(空)* | 启动时加载的以逗号分隔的技能列表 |
| `CLAW_MODEL` | `sonnet` | 会话的默认模型 |

## REPL 命令

```text
/help                          显示帮助信息
/clear                         清除当前会话历史
/history                       打印完整对话历史
/sessions                      列出已保存的会话
/model [name]                  显示/设置模型
/load <skill-name>             热加载技能到上下文
/branch <session-name>         分支当前会话
/search <query>                跨会话搜索查询
/compact                       压缩旧轮次，保留近期上下文
/export <md|json|txt> [path]   导出会话
/metrics                       显示会话指标
exit                           退出
```

## 说明

* NanoClaw 保持零依赖。
* 会话存储在 `~/.claude/claw/<session>.md`。
* 压缩会保留最近的回合并写入压缩头。
* 导出支持 Markdown、JSON 回合和纯文本。
