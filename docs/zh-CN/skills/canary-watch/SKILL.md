---
name: canary-watch
description: 使用此技能在部署、合并或依赖升级后监控已部署的URL是否存在回归问题。
origin: ECC
---

# Canary Watch — 部署后监控

## 使用场景

* 部署到生产或预发布环境后
* 合并高风险 PR 后
* 需要验证修复是否生效时
* 发布窗口期间的持续监控
* 依赖升级后

## 工作原理

监控已部署 URL 是否存在回归问题。循环运行，直至手动停止或监控窗口过期。

### 监控内容

```
1. HTTP 状态 — 页面是否返回 200？
2. 控制台错误 — 是否出现之前没有的新错误？
3. 网络故障 — 是否存在失败的 API 调用、5xx 响应？
4. 性能 — LCP/CLS/INP 与基线相比是否有退化？
5. 内容 — 关键元素是否消失？（h1、导航、页脚、CTA）
6. API 健康 — 关键端点是否在 SLA 内响应？
```

### 监控模式

**快速检查**（默认）：单次执行，报告结果

```
/canary-watch https://myapp.com
```

**持续监控**：每 N 分钟检查一次，持续 M 小时

```
/canary-watch https://myapp.com --interval 5m --duration 2h
```

**差异模式**：对比预发布环境与生产环境

```
/canary-watch --compare https://staging.myapp.com https://myapp.com
```

### 告警阈值

```yaml
critical:  # immediate alert
  - HTTP status != 200
  - Console error count > 5 (new errors only)
  - LCP > 4s
  - API endpoint returns 5xx

warning:   # flag in report
  - LCP increased > 500ms from baseline
  - CLS > 0.1
  - New console warnings
  - Response time > 2x baseline

info:      # log only
  - Minor performance variance
  - New network requests (third-party scripts added?)
```

### 通知机制

当超过关键阈值时：

* 桌面通知（macOS/Linux）
* 可选：Slack/Discord Webhook
* 记录至 `~/.claude/canary-watch.log`

## 输出

```markdown
## Canary 报告 — myapp.com — 2026-03-23 03:15 PST

### 状态：健康 ✓

| 检查项 | 结果 | 基线 | 偏差 |
|-------|--------|----------|-------|
| HTTP | 200 ✓ | 200 | — |
| 控制台错误 | 0 ✓ | 0 | — |
| LCP | 1.8s ✓ | 1.6s | +200ms |
| CLS | 0.01 ✓ | 0.01 | — |
| API /health | 145ms ✓ | 120ms | +25ms |

### 未检测到回归问题。部署状态良好。
```

## 集成

配合使用：

* `/browser-qa` 进行部署前验证
* 钩子：在 `git push` 上添加 PostToolUse 钩子，部署后自动检查
* CI：在 GitHub Actions 的部署步骤后运行
