---
name: continuous-agent-loop
description: 具有质量门、评估和恢复控制的连续自主代理循环模式。
origin: ECC
---

# 持续代理循环

这是 v1.8+ 的规范循环技能名称。它在保持一个发布版本的兼容性的同时，取代了 `autonomous-loops`。

## 循环选择流程

```text
Start
  |
  +-- 需要严格的 CI/PR 控制？ -- yes --> continuous-pr
  |
  +-- 需要 RFC 分解？ -- yes --> rfc-dag
  |
  +-- 需要探索性并行生成？ -- yes --> infinite
  |
  +-- default --> sequential
```

## 组合模式

推荐的生产栈：

1. RFC 分解 (`ralphinho-rfc-pipeline`)
2. 质量门 (`plankton-code-quality` + `/quality-gate`)
3. 评估循环 (`eval-harness`)
4. 会话持久化 (`nanoclaw-repl`)

## 故障模式

* 循环空转，没有可衡量的进展
* 因相同根本原因而重复重试
* 合并队列停滞
* 无限制升级导致的成本漂移

## 恢复

* 冻结循环
* 运行 `/harness-audit`
* 将范围缩小到失败单元
* 使用明确的验收标准重放
