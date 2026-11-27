---
name: hipaa-compliance
description: 针对医疗隐私和安全工作的HIPAA特定入口点。当任务明确围绕HIPAA、PHI处理、受保实体、BAA、违规态势或美国医疗合规要求时使用。
origin: ECC direct-port adaptation
version: "1.0.0"
---

# HIPAA 合规

当任务明确涉及美国医疗合规时，以此作为 HIPAA 专用入口。此技能刻意保持精简和规范：

* `healthcare-phi-compliance` 仍是处理 PHI/PII、数据分类、审计日志、加密和泄露防护的主要实施技能。
* `healthcare-reviewer` 仍是当代码、架构或产品行为需要医疗感知的二次审查时的专业审核者。
* `security-review` 仍适用于通用认证、输入处理、密钥、API 和部署加固。

## 使用时机

* 请求明确提及 HIPAA、PHI、受保实体、业务伙伴或 BAA
* 构建或审查存储、处理、导出或传输 PHI 的美国医疗软件
* 评估日志记录、分析、LLM 提示、存储或支持工作流是否产生 HIPAA 暴露风险
* 设计面向患者或临床医生的系统时，需关注最小必要访问和可审计性

## 工作原理

将 HIPAA 视为覆盖在更广泛的医疗隐私技能之上的叠加层：

1. 从 `healthcare-phi-compliance` 开始，获取具体的实施规则。
2. 应用 HIPAA 专用决策门：
   * 这些数据是否为 PHI？
   * 该行为者是否为受保实体或业务伙伴？
   * 供应商或模型提供商在接触数据前是否需要 BAA？
   * 访问权限是否限制在最小必要范围内？
   * 读/写/导出事件是否可审计？
3. 如果任务影响患者安全、临床工作流或受监管的生产架构，则升级至 `healthcare-reviewer`。

## HIPAA 专用防护栏

* 切勿将 PHI 置于日志、分析事件、崩溃报告、提示或客户端可见的错误字符串中。
* 切勿在 URL、浏览器存储、截图或复制的示例负载中暴露 PHI。
* 要求对 PHI 的读写操作进行认证访问、范围授权并保留审计追踪。
* 默认将第三方 SaaS、可观测性、支持工具和 LLM 提供商视为禁止状态，直至明确其 BAA 状态和数据边界。
* 遵循最小必要访问原则：正确的用户应仅看到完成任务所需的最小 PHI 片段。
* 优先使用不透明的内部 ID，而非姓名、病历号、电话号码、地址或其他标识符。

## 示例

### 示例 1：以 HIPAA 为框架的产品需求

用户请求：

> 为我们的临床医生仪表板添加 AI 生成的就诊摘要。我们服务美国诊所，需保持 HIPAA 合规。

响应模式：

* 激活 `hipaa-compliance`
* 使用 `healthcare-phi-compliance` 审查 PHI 流动、日志记录、存储和提示边界
* 在发送任何 PHI 前，验证摘要生成提供商是否受 BAA 覆盖
* 如果摘要影响临床决策，则升级至 `healthcare-reviewer`

### 示例 2：供应商/工具决策

用户请求：

> 我们可以将支持对话记录和患者消息发送到分析平台吗？

响应模式：

* 假设这些消息可能包含 PHI
* 除非分析供应商已获批准处理 HIPAA 约束的工作负载且数据路径已最小化，否则阻止该设计
* 尽可能要求进行脱敏处理或采用非 PHI 事件模型

## 相关技能

* `healthcare-phi-compliance`
* `healthcare-reviewer`
* `healthcare-emr-patterns`
* `healthcare-eval-harness`
* `security-review`
