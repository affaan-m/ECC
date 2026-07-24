---
name: agent-payment-x402
description: Add x402 payment execution to AI agents with per-task budgets, spending controls, and non-custodial wallets. Supports Base through agentwallet-sdk, X Layer through OKX Payments / OKX Agent Payments Protocol, and Solana through the PayAI facilitator with gasless USDC settlement.
metadata:
  origin: community
---

# Agent Payment Execution (x402)

Enable AI agents to make policy-gated payments with built-in spending controls. Uses the x402 HTTP payment protocol and MCP tools so agents can pay for external services, APIs, or other agents without custodial risk.

## When to Use

Use when: your agent needs to pay for an API call, purchase a service, settle with another agent, enforce per-task spending limits, or manage a non-custodial wallet. Pairs naturally with cost-aware-llm-pipeline and security-review skills.

## Decision Tree

Choose the integration path based on whether your agent is buying access to a paid API or charging others for one:

| Need | Recommended path |
|------|------------------|
| Agent pays a 402-gated API on Base or another agentwallet-supported chain | Use `agentwallet-sdk` as an MCP payment server with strict spending policy |
| Agent pays a 402-gated API on X Layer | Use OKX Agent Payments Protocol from `okx/onchainos-skills`; `okx-x402-payment` is a deprecated legacy alias |
| Agent pays a 402-gated API on Solana | Wrap the agent's HTTP client (Fetch, Axios, or httpx) with an exact-SVM scheme and a Solana signer, settling through the PayAI facilitator; discover payable resources via the PayAI bazaar |
| API charges agents on Solana (TypeScript, Python, or Go) | Add x402 middleware backed by `@payai/facilitator` — `@x402/*` for Express/Hono/Next.js, `x402` for FastAPI, `coinbase/x402/go` for Gin |
| TypeScript API charges agents | Use OKX Payments TypeScript seller SDK docs for Express, Hono, Fastify, or Next.js |
| Go API charges agents | Use OKX Payments Go seller SDK docs for Gin, Echo, or `net/http` |
| Rust API charges agents | Use OKX Payments Rust seller SDK docs for Axum |
| Java API charges agents | Use OKX Payments Java seller SDK docs for Spring Boot 2/3, Java EE, or Jakarta |
| Python API charges agents | Check the current OKX Payments repository before implementation; a Python seller guide may not be available |

## Supported Networks

- `agentwallet-sdk`: use the package docs to confirm current network coverage before production. Base Sepolia is the safest development default; Base mainnet is the production path called out by the original skill.
- OKX Payments / X Layer: current seller docs target X Layer (`eip155:196`) and USDT0 settlement. Fetch current SDK docs before generating production code because payment packages and facilitator behavior can change quickly.
- PayAI facilitator / Solana: settles USDC on Solana mainnet (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`) and Solana devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`). The facilitator sponsors network fees, so payers hold USDC only — no SOL for gas. Use Solana devnet as the development default and Solana mainnet for production. The facilitator is multi-network and also fronts several EVM chains; confirm the live list at its `/supported` endpoint before production rather than hardcoding it here.

## How It Works

### x402 Protocol
x402 extends HTTP 402 (Payment Required) into a machine-negotiable flow. When a server returns `402`, the agent's payment tool negotiates price, checks budget, signs a transaction, and retries only inside the policy and confirmation boundary set by the orchestrator.

### Spending Controls
Every payment tool call enforces a `SpendingPolicy`:
- **Per-task budget** — max spend for a single agent action
- **Per-session budget** — cumulative limit across an entire session
- **Allowlisted recipients** — restrict which addresses/services the agent can pay
- **Rate limits** — max transactions per minute/hour

### Non-Custodial Wallets
Agents hold their own keys via ERC-4337 smart accounts. The orchestrator sets policy before delegation; the agent can only spend within bounds. No pooled funds, no custodial risk.

## MCP Integration

The payment layer exposes standard MCP tools that slot into any Claude Code or agent harness setup.

> **Security note**: Always pin the package version. This tool manages private keys — unpinned `npx` installs introduce supply-chain risk.

### Option A: agentwallet-sdk (Base / multi-chain)

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

### Available Tools (agent-callable)

| Tool | Purpose |
|------|---------|
| `get_balance` | Check agent wallet balance |
| `send_payment` | Send payment to address or ENS |
| `check_spending` | Query remaining budget |
| `list_transactions` | Audit trail of all payments |

> **Note**: Spending policy is set by the **orchestrator** before delegating to the agent — not by the agent itself. This prevents agents from escalating their own spending limits. Configure policy via `set_policy` in your orchestration layer or pre-task hook, never as an agent-callable tool.

### Option B: OKX Agent Payments Protocol (X Layer)

Use this path for X Layer x402, Multi-Party Payment (MPP), session payment, charge, and A2A charge flows.

For buyer-side agent flows:

1. Install or reference the current `okx/onchainos-skills` repository.
2. Use `skills/okx-agent-payments-protocol/SKILL.md` as the dispatcher.
3. Treat `skills/okx-x402-payment/SKILL.md` as a deprecated compatibility alias, not as the canonical skill.
4. Require explicit user confirmation before wallet status checks or payment actions. Do not hide payment execution behind a generic tool call.

For seller-side API flows, fetch the latest language-specific guide before generating code:

| Runtime | Current guide |
|---------|---------------|
| TypeScript | `https://raw.githubusercontent.com/okx/payments/main/typescript/SELLER.md` |
| Go | `https://raw.githubusercontent.com/okx/payments/main/go/x402/SELLER.md` |
| Rust | `https://raw.githubusercontent.com/okx/payments/main/rust/x402/SELLER.md` |
| Java | `https://raw.githubusercontent.com/okx/payments/main/java/SELLER.md` |

Do not copy examples from older docs without checking the current OKX repository. Current OKX guidance uses `okx-agent-payments-protocol` as the dispatcher, and Java seller docs are now available.

### Option C: PayAI facilitator (Solana)

Use this path when the agent pays a 402-gated API that settles on Solana. Unlike Options A and B, the Solana buyer flow is not a separate MCP server — you wrap the agent's own HTTP client with an x402 interceptor that signs a USDC transfer and lets the [PayAI facilitator](https://facilitator.payai.network) verify and settle it. The facilitator is the fee payer, so the agent spends USDC only and needs no SOL for gas.

**Buyer side (agent pays).** Wrap `fetch` with the exact-SVM scheme and a Solana signer (Axios via `@x402/axios` and Python `httpx` via the `x402` package follow the same shape):

```typescript
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

// The signer key belongs to the ORCHESTRATOR's env — never hardcoded, never agent-writable.
const svmKey = process.env.SVM_PRIVATE_KEY;
if (!svmKey) {
  throw new Error("SVM_PRIVATE_KEY is not set — refusing to start payment client");
}

const client = new x402Client();
registerExactSvmScheme(client, {
  signer: await createKeyPairSignerFromBytes(base58.decode(svmKey)),
});

// Gate every paid call fail-closed BEFORE wrapping — enforce per-task / per-session
// budget and an allowlisted host, exactly like preToolCheck in the Examples section.
await assertWithinBudget({ cost: 0.01, host: "api.example.com" });

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const res = await fetchWithPayment("https://api.example.com/data", { method: "GET" });
```

The wrapped client only pays a challenge whose `network` is a Solana CAIP-2 id you registered, whose `asset` is the expected USDC mint, and whose `amount` is within the price you gated on. Treat any mismatch as fail-closed: do not sign, do not retry.

**Discovery.** Find payable Solana resources through the PayAI bazaar instead of hardcoding endpoints:

```bash
curl -s 'https://facilitator.payai.network/discovery/resources' | jq '.'
```

**Seller side (API charges agents).** Add x402 middleware backed by `@payai/facilitator`. Each starter scaffolds a working Solana server or client; pin the version in production rather than tracking `@latest`:

| Runtime | Scaffold |
|---------|----------|
| Express server | `npx @payai/x402-express-starter@latest my-server` |
| Hono server | `npx @payai/x402-hono-starter@latest my-server` |
| Next.js fullstack | `npx @payai/x402-next-starter@latest my-app` |
| Fetch client | `npx @payai/x402-fetch-starter@latest my-client` |
| Axios client | `npx @payai/x402-axios-starter@latest my-client` |

Test end to end for free against the PayAI Echo Merchant at [x402.payai.network](https://x402.payai.network) — it exposes Solana devnet and mainnet paths, refunds tokens, and covers fees — before pointing the agent at a real merchant.

## Examples

### Budget enforcement in an MCP client

When building an orchestrator that calls the agentpay MCP server, enforce budgets before dispatching paid tool calls.

> **Prerequisites**: Install the package before adding the MCP config — `npx` without `-y` will prompt for confirmation in non-interactive environments, causing the server to hang: `npm install -g agentwallet-sdk@6.0.0`

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

## Best Practices

- **Set budgets before delegation**: When spawning sub-agents, attach a SpendingPolicy via your orchestration layer. Never give an agent unlimited spend.
- **Pin your dependencies**: Always specify an exact version in your MCP config (e.g., `agentwallet-sdk@6.0.0`). Verify package integrity before deploying to production.
- **Audit trails**: Use `list_transactions` in post-task hooks to log what was spent and why.
- **Fail closed**: If the payment tool is unreachable, block the paid action — don't fall back to unmetered access.
- **Pair with security-review**: Payment tools are high-privilege. Apply the same scrutiny as shell access.
- **Test with testnets first**: Use Base Sepolia for development; switch to Base mainnet for production. On Solana, use Solana devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`) and the free PayAI Echo Merchant before mainnet.
- **On Solana, fund USDC not SOL**: The PayAI facilitator sponsors network fees, so a SOL-less wallet still pays. Verify each challenge's `asset` is the expected USDC mint before signing — a wrapped client that pays any asset is a hole in your budget.

## Production Reference

- **npm**: [`agentwallet-sdk`](https://www.npmjs.com/package/agentwallet-sdk)
- **Merged into NVIDIA NeMo Agent Toolkit**: [PR #17](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17) — x402 payment tool for NVIDIA's agent examples
- **Protocol spec**: [x402.org](https://x402.org)
- **OKX Payments SDKs**: [`okx/payments`](https://github.com/okx/payments) — TypeScript, Go, Rust, and Java seller integrations for X Layer x402
- **OKX Agent Payments Protocol skill**: [`okx/onchainos-skills`](https://github.com/okx/onchainos-skills/tree/main/skills/okx-agent-payments-protocol)
- **OKX Payments overview**: [web3.okx.com/onchainos/dev-docs/payments/overview](https://web3.okx.com/onchainos/dev-docs/payments/overview)
- **PayAI facilitator (Solana x402)**: [facilitator.payai.network](https://facilitator.payai.network) — multi-network facilitator with gasless Solana USDC settlement; live resource bazaar at `/discovery/resources`
- **PayAI docs**: [docs.payai.network](https://docs.payai.network)
- **PayAI starters and Echo Merchant**: [`@payai` on npm](https://www.npmjs.com/org/payai); free end-to-end testing at [x402.payai.network](https://x402.payai.network)
- **PayAI on GitHub**: [`PayAINetwork`](https://github.com/PayAINetwork)
