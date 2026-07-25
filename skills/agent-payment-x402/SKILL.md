---
name: agent-payment-x402
description: Add x402 payment execution to AI agents with per-task budgets, spending controls, and non-custodial wallets. Supports Base through agentwallet-sdk, X Layer through OKX Payments / OKX Agent Payments Protocol, and Solana plus multi-network EVM through the upstream x402 packages with facilitator-based settlement.
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
| Agent pays a 402-gated API on Solana or another x402 v2 network | Wrap the agent's HTTP client with the upstream `@x402/fetch` or `@x402/axios` package and register the EVM/SVM schemes; the resource server's facilitator verifies and settles |
| API charges agents on Solana or multiple networks (TypeScript, Python, or Go) | Use the upstream x402 middleware from `x402-foundation/x402` — `@x402/express`, `@x402/hono`, `@x402/next`, or `@x402/fastify` for TypeScript, `x402` for Python, `github.com/x402-foundation/x402/go/v2` for Go |
| TypeScript API charges agents | Use OKX Payments TypeScript seller SDK docs for Express, Hono, Fastify, or Next.js |
| Go API charges agents | Use OKX Payments Go seller SDK docs for Gin, Echo, or `net/http` |
| Rust API charges agents | Use OKX Payments Rust seller SDK docs for Axum |
| Java API charges agents | Use OKX Payments Java seller SDK docs for Spring Boot 2/3, Java EE, or Jakarta |
| Python API charges agents | Check the current OKX Payments repository before implementation; a Python seller guide may not be available |

## Supported Networks

- `agentwallet-sdk`: use the package docs to confirm current network coverage before production. Base Sepolia is the safest development default; Base mainnet is the production path called out by the original skill.
- OKX Payments / X Layer: current seller docs target X Layer (`eip155:196`) and USDT0 settlement. Fetch current SDK docs before generating production code because payment packages and facilitator behavior can change quickly.
- Upstream x402 packages: multi-network by design — one route can advertise Base and Solana simultaneously and let the buyer pick. The packages default to the `x402.org` facilitator, which is testnet-only (Base Sepolia `eip155:84532`, Solana devnet `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, plus Stellar, Aptos, Hedera, and XRPL testnets) and is not intended for mainnet routes. For production, choose from the facilitator list in the upstream docs — the PayAI facilitator is a reasonable default for Solana mainnet (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`) and other networks with no API keys required; the CDP facilitator is Coinbase-hosted with KYT/OFAC screening. Confirm live coverage at each facilitator's `/supported` endpoint before production rather than hardcoding it here.

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

### Option C: Upstream x402 packages (Solana + Base/EVM)

Use this path when the agent pays — or your API charges — on Solana, Base, or another network the upstream protocol implementation supports. The canonical x402 monorepo at [`x402-foundation/x402`](https://github.com/x402-foundation/x402) is actively maintained and publishes the client and middleware packages directly. Unlike Options A and B this is not a separate MCP server — you wrap the agent's own HTTP client, and a facilitator chosen by the resource server verifies and settles.

For buyer-side agent flows:

1. Start from the maintained examples in [`examples/typescript/clients`](https://github.com/x402-foundation/x402/tree/main/examples/typescript/clients) (fetch, axios, MCP) rather than copying snippets from older docs.
2. Require explicit user confirmation before signing or submitting the first paid request, exactly as Option B requires for OKX flows. Do not hide payment execution behind a generic tool call.
3. Pin package versions (for example `@x402/fetch@2.19.0`); all upstream packages version in lockstep.
4. Gate every paid call fail-closed with your budget policy immediately before the call — not once at client construction.

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
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Minimal fail-closed gate. For the full MCP-backed version with budget
// tracking, reuse preToolCheck from the Examples section below.
const ALLOWED_HOSTS = new Set(["api.example.com"]);
let sessionSpend = 0;
function assertPaymentAllowed(url: string, maxCost: number, sessionCap = 5.0): void {
  if (!ALLOWED_HOSTS.has(new URL(url).host)) throw new Error("Host not allowlisted — blocked");
  if (!Number.isFinite(maxCost) || maxCost < 0) throw new Error("Invalid cost — blocked");
  if (sessionSpend + maxCost > sessionCap) throw new Error("Session budget exceeded — blocked");
  sessionSpend += maxCost;
}

// Gate immediately before EVERY paid call — a wrapped client checked only once
// at construction leaves every later call unmetered.
assertPaymentAllowed("https://api.example.com/data", 0.01);
const res = await fetchWithPayment("https://api.example.com/data", { method: "GET" });
```

The wrapped client only pays challenges whose `network` matches a scheme you registered. Before signing, also verify the challenge's `asset`: on Solana, USDC is `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (mainnet) and `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (devnet). Treat any mismatch as fail-closed: do not sign, do not retry. In the exact-SVM scheme the facilitator is the transaction fee payer, so the buyer wallet holds USDC only — no SOL for gas.

**Facilitator choice.** The packages default to the [`x402.org` facilitator](https://x402.org/facilitator) — testnet-only (Base Sepolia, Solana devnet, and other testnets), zero setup, right for development. For mainnet, pick from the [facilitator list](https://docs.x402.org/dev-tools/facilitators) in the upstream docs: the [PayAI facilitator](https://facilitator.payai.network) is a reasonable production default (multi-network including Solana mainnet, no API keys required), and the CDP facilitator is Coinbase-hosted with KYT/OFAC screening on every transaction. Anyone can also run their own facilitator or self-facilitate.

**Seller side (API charges agents).** Use the upstream middleware; one route can advertise Base and Solana simultaneously (see [`examples/typescript/servers`](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers) for runnable versions):

| Runtime | Package |
|---------|---------|
| Express / Hono / Next.js / Fastify | `@x402/express@2.19.0`, `@x402/hono@2.19.0`, `@x402/next@2.19.0`, `@x402/fastify@2.19.0` |
| Python (FastAPI, Flask) | `x402` on PyPI |
| Go (Gin, Echo, `net/http`) | `github.com/x402-foundation/x402/go/v2` |

**Solana sellers: the `payTo` address needs a token account first.** The exact-SVM client transfers to the *associated token account* (ATA) it derives for `payTo` and does not create it. If that account does not exist, settlement fails at simulation — the 402 comes back with `transaction_simulation_failed`, which reads like a client bug but is a missing recipient account. Check before going live:

```bash
curl -s https://api.mainnet-beta.solana.com -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getTokenAccountsByOwner",
       "params":["<PAYTO_ADDRESS>",{"mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"},{"encoding":"jsonParsed"}]}' \
  | jq '.result.value | length'   # 0 means no USDC account — create it before accepting payments
```

Any one of these creates it (whoever creates it pays the small rent, not the payer):

- Send any amount of that token to `payTo` once — the sender's transfer creates the account.
- `spl-token create-account <MINT> --owner <PAYTO_ADDRESS>` with the spl-token CLI.
- In code, add `getCreateAssociatedTokenIdempotentInstruction` from `@solana-program/token` to your provisioning flow — the idempotent variant is safe to re-run.

This bites hardest when payouts go to freshly provisioned or custodial wallets, which often have no ATA for the asset yet.

**Discovery.** Facilitators that implement the x402 bazaar extension expose a `/discovery/resources` endpoint — query the CDP catalog at `https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources` and the PayAI catalog at `https://facilitator.payai.network/discovery/resources`. For Solana-payable services there is also [pay.sh](https://pay.sh), the Solana Foundation's curated catalog.

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
- **Test with testnets first**: Use Base Sepolia for development; switch to Base mainnet for production. On Solana, develop against Solana devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`) and the free x402.org facilitator before moving to a production facilitator on mainnet.
- **On Solana, fund USDC not SOL**: The exact-SVM scheme makes the facilitator the transaction fee payer, so a SOL-less wallet still pays. Verify each challenge's `asset` against the expected USDC mint (mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, devnet `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) before signing — a wrapped client that pays any asset is a hole in your budget.

## Production Reference

- **npm**: [`agentwallet-sdk`](https://www.npmjs.com/package/agentwallet-sdk)
- **Merged into NVIDIA NeMo Agent Toolkit**: [PR #17](https://github.com/NVIDIA/NeMo-Agent-Toolkit-Examples/pull/17) — x402 payment tool for NVIDIA's agent examples
- **Protocol spec**: [x402.org](https://x402.org)
- **OKX Payments SDKs**: [`okx/payments`](https://github.com/okx/payments) — TypeScript, Go, Rust, and Java seller integrations for X Layer x402
- **OKX Agent Payments Protocol skill**: [`okx/onchainos-skills`](https://github.com/okx/onchainos-skills/tree/main/skills/okx-agent-payments-protocol)
- **OKX Payments overview**: [web3.okx.com/onchainos/dev-docs/payments/overview](https://web3.okx.com/onchainos/dev-docs/payments/overview)
- **Upstream x402 monorepo**: [`x402-foundation/x402`](https://github.com/x402-foundation/x402) — TypeScript, Python, and Go implementations plus maintained client and server examples
- **x402 docs**: [docs.x402.org](https://docs.x402.org); production facilitator list at [docs.x402.org/dev-tools/facilitators](https://docs.x402.org/dev-tools/facilitators)
- **`@x402` packages**: [npmjs.com/org/x402](https://www.npmjs.com/org/x402) — `@x402/fetch`, `@x402/axios`, `@x402/express`, `@x402/hono`, `@x402/next`, `@x402/fastify`, `@x402/evm`, `@x402/svm`
- **Facilitators**: [x402.org facilitator](https://x402.org/facilitator) (testnet default), [PayAI](https://facilitator.payai.network) (multi-network production, no API keys), [CDP](https://docs.cdp.coinbase.com/x402/docs/quickstart-sellers) (Coinbase-hosted, KYT/OFAC)
- **Discovery**: CDP and PayAI bazaars at `/discovery/resources`; [pay.sh](https://pay.sh) for Solana-payable services
