---
name: agent-payment-x402
description: 将 x402 支付执行添加到 AI 代理中——通过 MCP 工具实现每任务预算、支出控制和非托管钱包。当代理需要为 API、服务或其他代理付费时使用。
origin: community
---

# 代理支付执行 (x402)

让AI代理能够自主支付并内置消费控制。使用x402 HTTP支付协议和MCP工具，使代理能够为外部服务、API或其他代理支付，无需托管风险。

## 使用场景

适用于：代理需要支付API调用、购买服务、与其他代理结算、强制执行每项任务消费限额，或管理非托管钱包。与成本感知LLM流水线和安全审查技能自然搭配。

## 工作原理

### x402协议

x402将HTTP 402（需要付款）扩展为机器可协商的流程。当服务器返回`402`时，代理的支付工具会自动协商价格、检查预算、签署交易并重试——无需人工干预。

### 消费控制

每次支付工具调用都会强制执行`SpendingPolicy`：

* **每任务预算** — 单次代理操作的最大支出
* **每会话预算** — 整个会话的累计限额
* **白名单接收方** — 限制代理可支付的地址/服务
* **速率限制** — 每分钟/小时的最大交易数

### 非托管钱包

代理通过ERC-4337智能账户持有自己的密钥。编排器在委托前设置策略；代理只能在限定范围内支出。无资金池，无托管风险。

## MCP集成

支付层暴露标准MCP工具，可无缝接入任何Claude Code或代理框架设置。

> **安全提示**：务必锁定包版本。此工具管理私钥——未锁定的`npx`安装会引入供应链风险。

```json
{
  "mcpServers": {
    "agentpay": {
      "command": "npx",
      "args": ["agentwallet-sdk@6.0.0"]
    }
  }
}
```

### 可用工具（代理可调用）

| 工具 | 用途 |
|------|---------|
| `get_balance` | 检查代理钱包余额 |
| `send_payment` | 向地址或ENS发送付款 |
| `check_spending` | 查询剩余预算 |
| `list_transactions` | 所有付款的审计追踪 |

> **注意**：消费策略由**编排器**在委托给代理之前设置——而非代理本身。这防止代理自行提高消费限额。通过编排层或任务前钩子中的`set_policy`配置策略，切勿将其作为代理可调用工具。

## 示例

### MCP客户端中的预算执行

在构建调用agentpay MCP服务器的编排器时，在分派付费工具调用前强制执行预算。

> **前提条件**：在添加MCP配置前安装包——`npx`不带`-y`会在非交互环境中提示确认，导致服务器挂起：`npm install -g agentwallet-sdk@6.0.0`

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  // 1. Validate credentials before constructing the transport.
  //    A missing key must fail immediately — never let the subprocess start without auth.
  const walletKey = process.env.WALLET_PRIVATE_KEY;
  if (!walletKey) {
    throw new Error("WALLET_PRIVATE_KEY is not set — refusing to start payment server");
  }

  // Connect to the agentpay MCP server via stdio transport.
  // Whitelist only the env vars the server needs — never forward all of process.env
  // to a third-party subprocess that manages private keys.
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["agentwallet-sdk@6.0.0"],
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: process.env.NODE_ENV ?? "production",
      WALLET_PRIVATE_KEY: walletKey,
    },
  });
  const agentpay = new Client({ name: "orchestrator", version: "1.0.0" });
  await agentpay.connect(transport);

  // 2. Set spending policy before delegating to the agent.
  //    Always verify success — a silent failure means no controls are active.
  const policyResult = await agentpay.callTool({
    name: "set_policy",
    arguments: {
      per_task_budget: 0.50,
      per_session_budget: 5.00,
      allowlisted_recipients: ["api.example.com"],
    },
  });
  if (policyResult.isError) {
    throw new Error(
      `Failed to set spending policy — do not delegate: ${JSON.stringify(policyResult.content)}`
    );
  }

  // 3. Use preToolCheck before any paid action
  await preToolCheck(agentpay, 0.01);
}

// Pre-tool hook: fail-closed budget enforcement with four distinct error paths.
async function preToolCheck(agentpay: Client, apiCost: number): Promise<void> {
  // Path 1: Reject invalid input (NaN/Infinity bypass the < comparison)
  if (!Number.isFinite(apiCost) || apiCost < 0) {
    throw new Error(`Invalid apiCost: ${apiCost} — action blocked`);
  }

  // Path 2: Transport/connectivity failure
  let result;
  try {
    result = await agentpay.callTool({ name: "check_spending" });
  } catch (err) {
    throw new Error(`Payment service unreachable — action blocked: ${err}`);
  }

  // Path 3: Tool returned an error (e.g., auth failure, wallet not initialised)
  if (result.isError) {
    throw new Error(
      `check_spending failed — action blocked: ${JSON.stringify(result.content)}`
    );
  }

  // Path 4: Parse and validate the response shape
  let remaining: number;
  try {
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    if (!Number.isFinite(parsed?.remaining)) {
      throw new TypeError("missing or non-finite 'remaining' field");
    }
    remaining = parsed.remaining;
  } catch (err) {
    throw new Error(
      `check_spending returned unexpected format — action blocked: ${err}`
    );
  }

  // Path 5: Budget exceeded
  if (remaining < apiCost) {
    throw new Error(
      `Budget exceeded: need $${apiCost} but only $${remaining} remaining`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

## 最佳实践

* **委托前设置预算**：生成子代理时，通过编排层附加SpendingPolicy。切勿让代理拥有无限支出权限。
* **锁定依赖项**：始终在MCP配置中指定确切版本（例如`agentwallet-sdk@6.0.0`）。部署到生产环境前验证包完整性。
* **审计追踪**：在任务后钩子中使用`list_transactions`记录支出内容和原因。
* **故障关闭**：如果支付工具不可达，阻止付费操作——不要回退到无计量访问。
* **配合安全审查**：支付工具是高权限操作。应用与shell访问相同的审查标准。
* **先在测试网测试**：开发时使用Base Sepolia；生产环境切换到Base主网。

## 生产参考

* **npm**：[`agentwallet-sdk`](https://www.npmjs.com/package/agentwallet-sdk)
* **合并到NVIDIA NeMo Agent Toolkit**：[PR #17](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17) — NVIDIA代理示例的x402支付工具
* **协议规范**：[x402.org](https://x402.org)
