---
name: stripe-supabase-billing-guard
description: "Deterministic security and financial integrity patterns for Stripe, PostgreSQL/Supabase, and credit-metered AI SaaS backends. Use when authoring or auditing billing migrations, Supabase RLS policies, SECURITY DEFINER RPCs, Stripe webhook routes, or streaming LLM credit deductions."
license: MIT
metadata:
  origin: ECC
---

# Stripe & Supabase Billing Integrity Guard

Prevent silent revenue leaks, cross-tenant Supabase RLS breaches, Stripe webhook replay double-grants, and streaming LLM Denial-of-Wallet race conditions before migrations or route handlers ship.

## When to Activate

- Creating or altering PostgreSQL / Supabase migrations for `users`, `subscriptions`, `wallets`, or `credit_transactions`
- Writing or reviewing Supabase Row-Level Security (`CREATE POLICY`) or `SECURITY DEFINER` RPC functions
- Building or auditing Stripe webhook endpoints (`checkout.session.completed`, `invoice.paid`, `customer.subscription.*`)
- Implementing streaming LLM endpoints (`streamText`, OpenAI/Anthropic SDKs) metered against user credit balances
- Reviewing pull requests that touch pricing, subscriptions, usage ledgers, or multi-tenant billing tables

## Core Patterns

### 1. Integer Minor Units & Non-Blocking Database Constraints

Store and compute all money and credit balances as `INTEGER` or `BIGINT` minor units (cents or credits). Enforce non-negative balances and unconditional webhook idempotency at the schema layer so application bugs cannot corrupt balances.

```sql
-- Add non-negative balance guard without holding ACCESS EXCLUSIVE across a full scan
ALTER TABLE public.wallets
  ADD CONSTRAINT wallets_credits_balance_non_negative
  CHECK (credits_balance >= 0) NOT VALID;

ALTER TABLE public.wallets
  VALIDATE CONSTRAINT wallets_credits_balance_non_negative;

-- Unconditional UNIQUE constraint for Stripe webhook deduplication
-- (avoid partial WHERE indexes for primary idempotency keys)
ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_stripe_event_id_unique
  UNIQUE (stripe_event_id);
```

Store all timestamps in UTC (`timestamptz` / `ISO-8601`). Convert to display timezones only at presentation boundaries.

### 2. Multi-Tenant Supabase RLS & `SECURITY DEFINER` Hardening

Every tenant-owned billing table must enable RLS and bind both `USING` and `WITH CHECK` predicates to `(SELECT auth.uid())` or verified tenant JWT claims.

```sql
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallets_select_own
  ON public.wallets
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
```

Every `SECURITY DEFINER` RPC must pin `search_path` and either revoke client execution or verify `auth.uid()` inside the body:

```sql
CREATE OR REPLACE FUNCTION public.grant_webhook_credits(
  p_user_id uuid,
  p_stripe_event_id text,
  p_credits_delta integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.credit_transactions (user_id, stripe_event_id, credits_delta)
  VALUES (p_user_id, p_stripe_event_id, p_credits_delta)
  ON CONFLICT (stripe_event_id) DO NOTHING;

  IF FOUND THEN
    UPDATE public.wallets
    SET credits_balance = credits_balance + p_credits_delta
    WHERE user_id = p_user_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_webhook_credits(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_webhook_credits(uuid, text, integer)
  TO service_role;
```

### 3. Raw-Body Stripe Webhook Verification & Canonical Invoice Locks

Verify `Stripe-Signature` locally against the raw UTF-8 request body. Avoid synchronous upstream `GET /v1/*` Stripe API calls inside the webhook critical path so transient Stripe `HTTP 503` load-shedding does not drop paid fulfillment.

```typescript
export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const rawBody = await req.text();
  const event = stripe.webhooks.constructEvent(
    rawBody,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET!
  );

  // Deduplicate initial subscription grants on a canonical invoice key
  // so checkout.session.completed + invoice.paid cannot double-grant.
  if (event.type === "invoice.paid") {
    const invoiceId = event.data.object.id;
    const canonicalKey = `invoice:${invoiceId}`;
    await db.rpc("grant_webhook_credits", {
      p_user_id: resolveUserId(event),
      p_stripe_event_id: canonicalKey,
      p_credits_delta: mapPriceToIntegerCredits(event),
    });
  }
  return new Response("ok", { status: 200 });
}
```

### 4. Two-Phase Credit Hold for Streaming LLM Routes

Verify caller authentication and atomically reserve an upper-bound hold before starting the model stream. Settle actual token cost on completion and release unused credits on error or client abort.

```sql
-- Phase 1: atomic pre-flight hold (fails closed when balance is insufficient)
UPDATE public.wallets
SET credits_balance = credits_balance - $1
WHERE user_id = $2
  AND credits_balance >= $1
RETURNING credits_balance;
```

```typescript
const user = await requireAuthenticatedUser(req);
const holdId = await reserveCreditsAtomically(user.id, ESTIMATED_MAX_CREDITS);
if (!holdId) return new Response("Insufficient credits", { status: 402 });

try {
  return streamText({
    model,
    prompt,
    onFinish: async ({ usage }) => {
      const actualCredits = computeIntegerCredits(usage.totalTokens);
      await settleCreditHold(holdId, actualCredits);
    },
  });
} catch (err) {
  await releaseCreditHold(holdId);
  throw err;
}
```

### 5. Required State-Machine Edge-Case Test Matrix

Before merging billing logic, write deterministic tests covering all 7 edge cases:

1. **Duplicate replay & self-echo:** Re-delivering the same `stripe_event_id` or an echo matching current state is a no-op.
2. **Out-of-order delivery:** An older `customer.subscription.updated` arriving after `customer.subscription.deleted` never reactivates access.
3. **Concurrent bursts:** `20x` parallel deliveries of the same paid event grant credits once.
4. **Manual support grants:** Automated reconciliation preserves manual admin adjustments instead of overwriting them.
5. **Overlapping rules (`N >= 3`):** Revoking 3 active grants/discounts in different orders (`1->2->3`, `2->1->3`, `3->2->1`) converges to the exact baseline.
6. **Deleted external entities:** Missing customers/subscriptions are reported cleanly without aborting the batch.
7. **Boundary math:** `100%` discounts or refunds larger than remaining credits never produce negative balances or `NaN`.

## Anti-Patterns

- **Floating-point money:** Using `FLOAT`, `REAL`, `DOUBLE PRECISION`, or `parseFloat()` for prices or credit ledgers causes rounding drift. Use `INTEGER`/`BIGINT` minor units.
- **Permissive RLS policies:** Shipping `USING (true)` or `USING (auth.role() = 'authenticated')` on billing tables exposes every tenant's rows through PostgREST.
- **Unrestricted `SECURITY DEFINER` RPCs:** Omitting `SET search_path` or accepting caller-supplied `p_user_id` without checking `auth.uid()` (or revoking `authenticated` execute) enables cross-tenant privilege escalation.
- **Parsing JSON before HMAC verification:** Calling `await req.json()` inside a Stripe webhook handler breaks raw-body signature validation or skips authentication.
- **Read-modify-write credit updates in JS:** Reading `wallet.credits`, computing `wallet.credits - cost` in Node.js, and writing back creates lost-update and double-spend races under concurrency.
- **Post-stream `onFinish`-only deductions:** Checking balance loosely and deducting credits only inside `onFinish` lets parallel streaming requests bypass credit limits (Denial-of-Wallet).
- **Dual webhook fulfillment without a canonical lock:** Granting credits on both `checkout.session.completed` and `invoice.paid` while deduplicating only by `event.id` double-credits initial subscriptions.

## Pre-Edit Verification Checklist

Before modifying billing schemas, RLS policies, or payment routes:

1. Read every prior migration touching the target table to confirm existing constraints, indexes, and `GRANT`/`REVOKE` statements.
2. Confirm every write path to `wallets` and `credit_transactions` performs atomic SQL updates rather than JS read-modify-write.
3. Verify test fixtures cover duplicate delivery, out-of-order events, concurrent bursts, and `0`/boundary balances.

## Related Skills

- `postgres-patterns` — Indexing, query optimization, and Supabase RLS performance patterns
- `database-migrations` — Safe zero-downtime migration patterns (`NOT VALID`, `CONCURRENTLY`)
- `security-review` — General web and API security review checklist
- `mcp-dependency-review` — Static supply-chain review for `.mcp.json` configurations
- `tdd-workflow` — Test-first discipline for state-machine and edge-case coverage
