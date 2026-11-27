---
name: nanoclaw-repl
description: 操作并扩展NanoClaw v2，这是ECC基于claude -p构建的零依赖会话感知REPL。
origin: ECC
---

# NanoClaw REPL

在运行或扩展 `scripts/claw.js` 时使用此技能。

## 能力

* 持久的、基于 Markdown 的会话
* 使用 `/model` 进行模型切换
* 使用 `/load` 进行动态技能加载
* 使用 `/branch` 进行会话分支
* 使用 `/search` 进行跨会话搜索
* 使用 `/compact` 进行历史压缩
* 使用 `/export` 导出为 md/json/txt 格式
* 使用 `/metrics` 查看会话指标

## 操作指南

1. 保持会话聚焦于任务。
2. 在进行高风险更改前进行分支。
3. 在完成主要里程碑后进行压缩。
4. 在分享或存档前进行导出。

## 扩展规则

* 保持零外部运行时依赖
* 保持以 Markdown 作为数据库的兼容性
* 保持命令处理器的确定性和本地性
