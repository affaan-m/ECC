---
name: agent-payment-x402
description: 将 x402 支付执行添加到 AI 代理中，具备每任务预算、支出控制和非托管钱包。通过 agentwallet-sdk 支持 Base，通过 OKX Payments / OKX 代理支付协议支持 X Layer，并通过上游 x402 包与基于结算器的结算支持 Solana 及多网络 EVM。
origin: community
---

# 代理支付执行 (x402)

让 AI 代理能够进行策略门控的支付并内置支出控制。使用 x402 HTTP 支付协议和 MCP 工具，使代理能够为外部服务、API 或其他代理付费，无托管风险。

## 使用场景

适用于：代理需要支付 API 调用、购买服务、与其他代理结算、强制执行每任务支出限额，或管理非托管钱包。与 cost-aware-llm-pipeline 和 security-review 技能自然搭配。

## 决策树

根据代理是购买对付费 API 的访问权，还是向他人收费，选择集成路径：

| 需求 | 推荐路径 |
|------|------------------|
| 代理为 Base 或其他 agentwallet 支持链上的 402 门控 API 付费 | 使用 `agentwallet-sdk` 作为 MCP 支付服务器，并配置严格的支出策略 |
| 代理为 X Layer 上的 402 门控 API 付费 | 使用 `okx/onchainos-skills` 中的 OKX 代理支付协议；`okx-x402-payment` 是已弃用的旧别名 |
| 代理为 Solana 或其他 x402 v2 网络上的 402 门控 API 付费 | 用上游的 `@x402/fetch` 或 `@x402/axios` 包包装代理的 HTTP 客户端并注册 EVM/SVM 方案；由资源服务器的结算器验证和结算 |
| API 在 Solana 或多个网络上向代理收费（TypeScript、Python 或 Go） | 使用来自 `x402-foundation/x402` 的上游 x402 中间件 —— TypeScript 用 `@x402/express`、`@x402/hono`、`@x402/next` 或 `@x402/fastify`，Python 用 `x402`，Go 用 `github.com/x402-foundation/x402/go/v2` |
| TypeScript API 向代理收费 | 使用面向 Express、Hono、Fastify 或 Next.js 的 OKX Payments TypeScript 卖家 SDK 文档 |
| Go API 向代理收费 | 使用面向 Gin、Echo 或 `net/http` 的 OKX Payments Go 卖家 SDK 文档 |
| Rust API 向代理收费 | 使用面向 Axum 的 OKX Payments Rust 卖家 SDK 文档 |
| Java API 向代理收费 | 使用面向 Spring Boot 2/3、Java EE 或 Jakarta 的 OKX Payments Java 卖家 SDK 文档 |
| Python API 向代理收费 | 实现前先检查当前 OKX Payments 仓库；可能尚无 Python 卖家指南 |

## 支持的网络

- `agentwallet-sdk`：在生产使用前，通过包文档确认当前网络覆盖范围。Base Sepolia 是最安全的开发默认值；Base 主网是原始技能所述的生产路径。
- OKX Payments / X Layer：当前卖家文档面向 X Layer（`eip155:196`）和 USDT0 结算。由于支付包和结算器行为可能快速变化，生成生产代码前请获取当前 SDK 文档。
- 上游 x402 包：设计上即多网络 —— 一条路由可以同时提供 Base 和 Solana，由买方选择。包默认使用 `x402.org` 结算器，它仅限测试网（Base Sepolia `eip155:84532`、Solana 开发网 `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`，以及 Stellar、Aptos、Hedera、XRPL 测试网），不适用于主网路由。主网（Solana 为 `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`）请选择自结算、自行运行结算器，或从上游结算器列表中挑选托管方案——参见选项 C 中的结算器对比。生产前请在结算器的 `/supported` 端点确认实时覆盖范围，而不要在此硬编码。

## 工作原理

### x402 协议
x402 将 HTTP 402（需要付款）扩展为机器可协商的流程。当服务器返回 `402` 时，代理的支付工具会协商价格、检查预算、签署交易，并仅在编排器设定的策略与确认边界内重试。

### 支出控制
每次支付工具调用都会强制执行 `SpendingPolicy`：
- **每任务预算** — 单次代理操作的最大支出
- **每会话预算** — 整个会话的累计限额
- **白名单接收方** — 限制代理可支付的地址/服务
- **速率限制** — 每分钟/小时的最大交易数

### 非托管钱包
代理通过 ERC-4337 智能账户持有自己的密钥。编排器在委托前设置策略；代理只能在限定范围内支出。无资金池，无托管风险。

## MCP 集成

支付层暴露标准 MCP 工具，可无缝接入任何 Claude Code 或代理框架设置。

> **安全提示**：务必锁定包版本。此工具管理私钥——未锁定的 `npx` 安装会引入供应链风险。

### 选项 A：agentwallet-sdk（Base / 多链）

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
| `send_payment` | 向地址或 ENS 发送付款 |
| `check_spending` | 查询剩余预算 |
| `list_transactions` | 所有付款的审计追踪 |

> **注意**：支出策略由**编排器**在委托给代理之前设置——而非代理本身。这可防止代理自行提高支出限额。通过编排层或任务前钩子中的 `set_policy` 配置策略，切勿将其作为代理可调用工具。

### 选项 B：OKX 代理支付协议（X Layer）

将此路径用于 X Layer x402、多方支付（MPP）、会话支付、收费和 A2A 收费流程。

对于买方代理流程：

1. 安装或引用当前的 `okx/onchainos-skills` 仓库。
2. 使用 `skills/okx-agent-payments-protocol/SKILL.md` 作为调度器。
3. 将 `skills/okx-x402-payment/SKILL.md` 视为已弃用的兼容别名，而非规范技能。
4. 在钱包状态检查或支付操作前要求明确的用户确认。不要将支付执行隐藏在通用工具调用之后。

对于卖方 API 流程，生成代码前先获取最新的语言专用指南：

| 运行时 | 当前指南 |
|---------|---------------|
| TypeScript | `https://raw.githubusercontent.com/okx/payments/main/typescript/SELLER.md` |
| Go | `https://raw.githubusercontent.com/okx/payments/main/go/x402/SELLER.md` |
| Rust | `https://raw.githubusercontent.com/okx/payments/main/rust/x402/SELLER.md` |
| Java | `https://raw.githubusercontent.com/okx/payments/main/java/SELLER.md` |

不要在未检查当前 OKX 仓库的情况下复制旧文档中的示例。当前 OKX 指南使用 `okx-agent-payments-protocol` 作为调度器，且 Java 卖家文档现已可用。

### 选项 C：上游 x402 包（Solana + Base/EVM）

当代理在 Solana、Base 或上游协议实现支持的其他网络上付费（或你的 API 收费）时，使用此路径。位于 [`x402-foundation/x402`](https://github.com/x402-foundation/x402) 的规范 x402 monorepo 正在积极维护，并直接发布客户端和中间件包。与选项 A 和 B 不同，这不是独立的 MCP 服务器——你包装代理自己的 HTTP 客户端，由资源服务器选择的结算器验证并结算。

对于买方代理流程：

1. 从维护中的 [`examples/typescript/clients`](https://github.com/x402-foundation/x402/tree/main/examples/typescript/clients) 示例（fetch、axios、MCP）开始，而不是复制旧文档中的片段。
2. 在签署或提交第一笔付费请求之前要求明确的用户确认，与选项 B 对 OKX 流程的要求完全一致。不要将支付执行隐藏在通用工具调用之后。
3. 锁定包版本（例如 `@x402/fetch@2.22.0`）；上游所有包以相同步调发布版本。
4. 用注册到客户端的 `PaymentPolicy` 强制预算，使检查在每次调用时都针对服务器的真实挑战运行。与你自己传入的数字比较的预算不能证明任何事——金额、资产和网络都来自服务器，因此必须在签名产生之前全部验证。

```typescript
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

// Signer keys belong to the ORCHESTRATOR's env — never hardcoded, never agent-writable.
const evmKey = process.env.EVM_PRIVATE_KEY as `0x${string}`;
const svmKey = process.env.SVM_PRIVATE_KEY;
if (!evmKey || !svmKey) {
  throw new Error("Signer keys are not set — refusing to start payment client");
}

// One client, both network families: the buyer pays whichever chain the 402 offers.
const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(privateKeyToAccount(evmKey)));
client.register("solana:*", new ExactSvmScheme(await createKeyPairSignerFromBytes(base58.decode(svmKey))));

// A PaymentPolicy filters the SERVER's payment requirements before any
// signature is created. Returning an empty array means "nothing here is
// acceptable" and the client refuses to pay rather than falling back.
const ALLOWED_NETWORKS = new Set([
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",      // Solana mainnet
  "eip155:8453",                                   // Base
]);
const MAX_AMOUNT = 10_000n;   // atomic units — 6-decimal USDC, so $0.01

// EVM addresses are case-insensitive, so compare them lowercased. Solana
// addresses are base58 and ARE case-sensitive — never lowercase those, or a
// different account could slip through.
const normalizeAsset = (a: string) => (a.startsWith("0x") ? a.toLowerCase() : a);
const ALLOWED_ASSETS = new Set(
  [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  // USDC, Solana mainnet
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",    // USDC, Base
  ].map(normalizeAsset),
);

client.registerPolicy((_x402Version, requirements) =>
  requirements.filter(r => {
    if (!ALLOWED_NETWORKS.has(r.network)) return false;              // wrong chain
    if (!ALLOWED_ASSETS.has(normalizeAsset(r.asset))) return false;  // wrong token
    try {
      const amount = BigInt(r.amount);
      return amount >= 0n && amount <= MAX_AMOUNT;                   // over budget / negative
    } catch {
      return false;                                                  // unparseable amount
    }
  }),
);

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment("https://api.example.com/data", { method: "GET" });
```

注册该策略后，超预算金额、非预期代币或未注册的链都会故障关闭——所有候选项都被过滤掉，`createPaymentPayload` 会抛出异常而不是签名。开发网 USDC 是 `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`；仅在开发时把它加入 `ALLOWED_ASSETS`。对策略做对抗性测试——分别喂入要求 `5000000` 原子单位的挑战、报价另一种铸币地址的挑战，以及你从未注册的链上的挑战，并断言它们都不会产生签名。在 exact-SVM 方案中，结算器是交易费用支付方，因此买方钱包只需持有 USDC——无需 SOL 支付 gas。

**结算器选择。** 结算器代表资源服务器执行验证和结算，因此这是资源服务器的决定，而非买方的决定。按委托信任由少到多排列：

| 选项 | 适用场景 |
|--------|--------------|
| [进程内自结算](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/self-facilitation) | 你不希望结算路径中有第三方，且能自行持有密钥和 RPC 访问 |
| 自行运行结算器 | 你想要同样的控制力，但在多个服务间共享 |
| [`x402.org` 结算器](https://x402.org/facilitator) | 开发与测试网——它是包的默认值，无需配置，上游明确说明它不适用于主网路由 |
| 托管的生产结算器 | 你希望获得主网覆盖而不必自己运维基础设施 |

选择托管方案时，请从上游文档的[结算器列表](https://docs.x402.org/dev-tools/facilitators)中挑选，而不是照搬这里的名字——该列表有人维护、并不详尽，且覆盖范围会变化。撰写时它包含 Coinbase 的 CDP（对每笔交易执行 KYT/OFAC 筛查）、PayAI、Corbits、Dexter、Solvador 等，其中若干同时覆盖 EVM 与 Solana 主网。无论选择哪一个，上线前都要在其 `/supported` 端点确认实时覆盖范围，并在新增网络时重新确认。

> **披露**：本节由参与 PayAI（所列结算器之一）的人贡献。它只是若干选项之一，上面的自托管与上游默认路径是有意排在前面的。

**卖方侧（API 向代理收费）。** 使用上游中间件；一条路由可以同时提供 Base 和 Solana（可运行版本参见 [`examples/typescript/servers`](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers)）：

| 运行时 | 包 |
|---------|---------|
| Express / Hono / Next.js / Fastify | `@x402/express@2.22.0`、`@x402/hono@2.22.0`、`@x402/next@2.22.0`、`@x402/fastify@2.22.0` |
| Python（FastAPI、Flask） | PyPI 上的 `x402` |
| Go（Gin、Echo、`net/http`） | `github.com/x402-foundation/x402/go/v2` |

**Solana 卖方：`payTo` 地址需要先有代币账户。** exact-SVM 客户端会转账到它为 `payTo` 推导出的*关联代币账户*（ATA），但不会创建它。如果该账户不存在，结算会在模拟阶段失败——402 返回 `transaction_simulation_failed`，看起来像客户端 bug，实际是收款方账户缺失。上线前请检查：

```bash
curl -s https://api.mainnet-beta.solana.com -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getTokenAccountsByOwner",
       "params":["<PAYTO_ADDRESS>",{"mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"},{"encoding":"jsonParsed"}]}' \
  | jq '.result.value | length'   # 0 表示没有 USDC 账户 —— 接受付款前先创建
```

以下任一方式都能创建（由创建者支付少量租金，而非付款方）：

- 向 `payTo` 转一次该代币的任意数量——发送方的转账会创建该账户。
- 用 spl-token CLI：`spl-token create-account <MINT> --owner <PAYTO_ADDRESS>`。
- 在代码中，将 `@solana-program/token` 的 `getCreateAssociatedTokenIdempotentInstruction` 加入你的开通流程——幂等版本可安全重复执行。

这个问题在向新开通的钱包或托管钱包付款时最容易出现，这类钱包往往还没有该资产的 ATA。

**发现。** 实现 x402 集市扩展的结算器会公开 `/discovery/resources` 端点——可在 `https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources` 查询 CDP 目录，在 `https://facilitator.payai.network/discovery/resources` 查询 PayAI 目录。对于 Solana 可付费服务，还有 Solana 基金会的精选目录 [pay.sh](https://pay.sh)。

## 示例

### MCP 客户端中的预算执行

在构建调用 agentpay MCP 服务器的编排器时，在分派付费工具调用前强制执行预算。

> **前提条件**：在添加 MCP 配置前安装包——`npx` 不带 `-y` 会在非交互环境中提示确认，导致服务器挂起：`npm install -g agentwallet-sdk@6.0.0`

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

- **委托前设置预算**：生成子代理时，通过编排层附加 SpendingPolicy。切勿让代理拥有无限支出权限。
- **锁定依赖项**：始终在 MCP 配置中指定确切版本（例如 `agentwallet-sdk@6.0.0`）。部署到生产环境前验证包完整性。
- **审计追踪**：在任务后钩子中使用 `list_transactions` 记录支出内容和原因。
- **故障关闭**：如果支付工具不可达，阻止付费操作——不要回退到无计量访问。
- **配合 security-review**：支付工具是高权限操作。应用与 shell 访问相同的审查标准。
- **先在测试网测试**：开发时使用 Base Sepolia；生产环境切换到 Base 主网。在 Solana 上，先针对 Solana 开发网（`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`）和免费的 x402.org 结算器开发，再转到主网的生产结算器。
- **在 Solana 上注入 USDC 而非 SOL**：exact-SVM 方案让结算器成为交易费用支付方，因此没有 SOL 的钱包也能付费。签署前将每个挑战的 `asset` 与预期的 USDC 铸币地址核对（主网 `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`，开发网 `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`）——一个会支付任意资产的包装客户端是预算上的漏洞。

## 生产参考

- **npm**：[`agentwallet-sdk`](https://www.npmjs.com/package/agentwallet-sdk)
- **合并到 NVIDIA NeMo Agent Toolkit**：[PR #17](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17) — 面向 NVIDIA 代理示例的 x402 支付工具
- **协议规范**：[x402.org](https://x402.org)
- **OKX Payments SDK**：[`okx/payments`](https://github.com/okx/payments) — 面向 X Layer x402 的 TypeScript、Go、Rust 和 Java 卖家集成
- **OKX 代理支付协议技能**：[`okx/onchainos-skills`](https://github.com/okx/onchainos-skills/tree/main/skills/okx-agent-payments-protocol)
- **OKX Payments 概览**：[web3.okx.com/onchainos/dev-docs/payments/overview](https://web3.okx.com/onchainos/dev-docs/payments/overview)
- **上游 x402 monorepo**：[`x402-foundation/x402`](https://github.com/x402-foundation/x402) — TypeScript、Python 和 Go 实现，以及维护中的客户端和服务器示例
- **x402 文档**：[docs.x402.org](https://docs.x402.org)；生产结算器列表位于 [docs.x402.org/dev-tools/facilitators](https://docs.x402.org/dev-tools/facilitators)
- **`@x402` 包**：[npmjs.com/org/x402](https://www.npmjs.com/org/x402) — `@x402/fetch`、`@x402/axios`、`@x402/express`、`@x402/hono`、`@x402/next`、`@x402/fastify`、`@x402/evm`、`@x402/svm`
- **结算器**：[自结算示例](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/self-facilitation)（无第三方）、[x402.org 结算器](https://x402.org/facilitator)（测试网默认）、以及有人维护的[生产列表](https://docs.x402.org/dev-tools/facilitators)
- **发现**：CDP 与 PayAI 集市位于 `/discovery/resources`；Solana 可付费服务见 [pay.sh](https://pay.sh)
