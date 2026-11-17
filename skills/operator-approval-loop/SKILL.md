---
name: operator-approval-loop
description: Operator approval contract with internal filing notices for agent-drafted outbound messages, hashed drafts, epoch-keyed decisions, durable delivery claims and receipts, and a pre-draft baseline gate. Use when an agent drafts messages to external counterparties and a human operator must approve, reject, or steer each send before it leaves.
---

# Operator Approval Loop

An agent that talks to external counterparties should never send on its own
judgment and should keep the operator informed internally. This skill defines
the contract: every outbound draft is filed as an obligation, an operator
decides on the exact text, and a delivery ledger proves what went out.

## When to Use

- An agent drafts replies to customers, suppliers, investors, or partners in
  a shared channel, email, or chat, and a human must approve before send.
- You need an audit trail that links each sent message to the exact draft
  text, the operator who approved it, and the decision time.
- You have seen a stale approval release a rewritten draft, or two workers
  deliver the same approved message twice.
- Drafts keep re-asking counterparties for facts the ledger already holds.

## How It Works

### Objects

| Object | Meaning |
| --- | --- |
| Obligation | One thing we owe a counterparty. Status moves `drafted`, then `approved` or `rejected`, then `sent`. Carries `direction`, `counterparty`, `channel`, and an `updated_at` epoch. |
| Draft | Sidecar row holding the exact draft text, a sha256 of that text, origin coordinates (platform, channel, thread, user), and priority (P0 to P3). One per obligation, replaced on re-file. |
| Decision | An operator's approve or reject, recorded with the operator id, a nonce, and the draft epoch it was made against. |
| Approval snapshot | Immutable text, hash, epoch and destination recorded by the already-authorized decision writer. Missing snapshots cannot grant dispatch. |
| Claim | Durable reservation with a random token and state; at most one active claim per obligation. |
| Delivery | Ledger row proving one send or notice for one (obligation, decision) pair. |

The reference schema is in [references/approval-ledger.sql](references/approval-ledger.sql).

### Filing a draft

1. Clean inputs. Strip control characters, collapse whitespace in single-line
   fields, and enforce length caps (draft, summary, context, counterparty).
   Empty or oversized fields are refused, not truncated silently.
2. Run the baseline gate (below). It may refuse the filing.
3. Hash the draft text with sha256. The hash prefix goes into the summary so
   the approval panel shows which text it is approving.
4. Upsert. If an open drafted obligation already exists for the same
   (counterparty, channel), replace the draft sidecar and advance the
   obligation's `updated_at`. That advance is the epoch rotation: any
   decision keyed to the old epoch can no longer release the new text.
   Otherwise insert a new obligation with status `drafted`.
5. Route the filing receipt only to a configured, verified internal ops
   destination. If the origin is that internal destination, acknowledge there.
   Never-silent means internal reporting, not an automatic external reply.
   Keep draft hashes, approval status, operator identity and workflow metadata
   out of counterparty-visible channels. Unknown or unclassified origins stay
   quiet; a direct message is not automatically internal.

If a verified internal destination is unavailable, retain the filing result
in the internal tool result or operator surface. Never fall back to an external
or unknown origin. A tool result exposed to outsiders is not an internal surface.

Filing a draft does not authorize an external response. Any policy-permitted
clarifying question or neutral response is a separate outbound decision, subject
to the existing mention, channel, draft-only, frozen and never constraints in
counterparty-channel-discipline. It must not disclose internal approval metadata.

### Baseline gate

Before any draft is filed, query the current baseline for the counterparty
(a temporal ledger, contract store, or CRM):

- Signed or delivered contract on record: refuse the filing with the evidence
  and a recommendation. Asking a counterparty about specs after signing is the
  exact failure this gate exists to stop.
- Operator override: `force_despite_signed_contract` lets the filing through
  and stamps `[BASELINE_OVERRIDE_SIGNED_CONTRACT]` into the draft context.
- Gate service unreachable: the filing proceeds and the context is stamped
  `[BASELINE_CHECK_UNAVAILABLE]`. The panel sees that the guard was off.
  Failures never silently disable the gate.
- When facts are available, attach the freshest few to the context as a
  `[BASELINE FACTS: ...]` digest so the draft lands with current truth.

### Deciding

The approval panel lists obligations with status `drafted` and direction
`we_owe_them`. Approve or reject writes a decision row carrying the draft
epoch (`draft_updated_ts`) and flips the obligation status in the same
transaction. A decision whose epoch does not match the current `updated_at`
is stale and must not release anything.

For an already-authorized approve decision, the same transaction inserts an
immutable `obligation_approval_snapshots` row: decision and obligation IDs,
current draft epoch, exact text and SHA-256, platform/channel/thread, and kind
`draft_sent`. The decision writer must establish authorization before writing;
the reference never authenticates an operator or manufactures a decision.
Automatic approval policy is not enabled or expanded by the reference.
Legacy decisions without snapshots require explicit reconciliation or a new
approval; never backfill permission from the current mutable draft.

### Delivering

The SQLite reference is [references/approval_claims.py](references/approval_claims.py).
It grants dispatch permission but never calls transport. Use an existing local
reference database initialized from the SQL fixture; the module does not apply
schema or production migrations. Only a trusted decision writer may populate
approval records. All writers must enable foreign keys and recursive triggers
and honor the schema guards; administrative database tampering is outside this model.

1. Discover bound approved drafts. Discovery is not permission. `claim()` opens
   its own `BEGIN IMMEDIATE` transaction, validates the current approved epoch,
   exact text, computed SHA-256 and full destination against the snapshot, and
   inserts a unique claim before returning its token. A conflict stops the worker
   before transport. Completed receipts cannot be claimed again.
2. `begin_dispatch()` revalidates the binding and atomically changes `claimed`
   to `dispatching` using the token. Only its winning caller receives
   the exact `draft_text` and destination after commit. Never regenerate text, reread a
   mutable sidecar for transport, or reuse the payload for another attempt.
   A nested caller transaction is refused; permission cannot depend on a later
   caller commit. No database transaction remains open across transport.
3. A confirmed successful result goes to `complete()`, which atomically records
   the delivery coordinate, marks the claim delivered and flips the obligation
   to `sent`. Identical completion is a no-op; conflicting coordinates fail.
   The receipt UNIQUE key deduplicates records, not prior external effects.
4. Exceptions, timeouts, worker death after begin-dispatch, or failed receipt
   persistence leave a blocked attempt. `mark_unknown()` records uncertainty.
   Unknown claims never expire, reopen, auto-retry or allow another decision for
   that obligation to bypass them. A trusted caller may use `reconcile()` with
   confirmed successful coordinate and evidence; the module does not verify
   that evidence. An absent receipt is not proof of non-delivery.

The guarantee is one automatic dispatch attempt per approved decision, not
exactly-once external delivery. A crash after begin-dispatch but before transport
can leave zero sends and a held claim. Releasing an unknown outcome for a new
attempt would require fencing the original executor and verifying provider
semantics; this reference deliberately provides no such retry operation.

| Claim state | Allowed next states |
| --- | --- |
| claimed | dispatching or cancelled before dispatch |
| dispatching | delivered or unknown |
| unknown | delivered through trusted reconciliation only |
| delivered, cancelled | terminal; decision key cannot be reused |

While a claim is active, database guards freeze obligation, draft and decision
writes, including replacements. Snapshots and claims cannot be erased. Cancel a
claimed operation with its token before re-filing; the stale token then grants
nothing. After dispatch begins, hold new edits or revocation for reconciliation.
This serializes changes instead of pretending to recall an in-flight operation.

Rejected decisions and legacy rows without draft sidecars/snapshots never enter
this external draft-send path. Report them on the internal operator surface for
manual handling. Internal receipt footers remain internal:
`approved by <operator> · receipt <decision_id> · draft sha256 <prefix>`.
Never alter already-approved external text to append workflow metadata.

Focused local validation uses temporary databases, separate connections and a
simulated attempt counter, not a provider or real message:
`python3 -m unittest discover -s tests/skills -p 'test_approval_delivery_claims.py'`.
The tests require Python 3.11+ with SQLite serialization support; the reference
uses only the standard library. The existing desk-pattern contract checks remain
a separate compatibility check.

### Time-boxed auto-approval (optional)

A draft may carry `auto_send_after` (epoch seconds). A sweep approves drafts
whose deadline passed with no decision, recording operator `auto-ttl`, then
delivery proceeds through the normal path. Operator actions always win: a
decision flips status before the sweep sees it, and a re-file rotates the
epoch and moves or clears the deadline. The sweep re-checks status and epoch
inside the write transaction so a race resolves as a no-op. Drafts without a
deadline stay hard-gated forever.

### Signal linkage

A draft can name the inbound obligation it answers (`signal_obligation_id`).
This is the only truthful link for latency measurement (inbound signal to
drafted response) and lets the SLA scan treat that inbound item as answered.
Reject the filing if the referenced row does not exist.

## Examples

### File a draft

```text
file_request(
  draft="Thanks, we can hold the slot until Friday. Which start date works?",
  counterparty="acme-supplier",
  context="reply to delivery window question",
  origin_platform="slack", origin_channel="#acme-shared",
  origin_thread="1712345678.000100", priority="P1",
  signal_obligation_id=412)
-> {obligation_id: 431, draft_sha256: "9f2c...", refiled: false}
```

The configured, verified internal ops destination sees:
`Draft filed for approval (P1, sha 9f2c8a1b). Waiting on operator.`
The counterparty-visible origin channel receives no filing notice. If no verified
internal destination is available, the receipt stays in the internal tool result
or operator surface, with no external fallback.

### Re-file after a steer

The operator asks for a shorter draft. Filing again for the same
(counterparty, channel) returns `refiled: true`, the sidecar text and hash
change, and `updated_at` advances. An approve clicked on the old panel row
carries the old epoch and is ignored.

### Gate refusal

```text
DeskApprovalError: baseline gate refused this draft: the ledger shows a
signed contract for 'acme-supplier'. Evidence: master agreement executed
2026-08-14. Recommendation: do not ask. Re-file with
force_despite_signed_contract=true if this is genuinely a new thread.
```

### Delivery footer in an internal channel

```text
Confirmed for Friday, start date 2026-09-08.
approved by operator-a · receipt 118 · draft sha256 9f2c8a1b2d3e4f50
```

## Invariants to test

- Filing receipts go only to configured, verified internal ops; the origin
  receives one only when it is that verified internal destination.
- An unknown origin stays quiet. An unavailable internal destination uses the
  internal tool result or operator surface, with no external fallback.
- Same (counterparty, channel) filed twice yields one obligation, two epochs.
- A decision with a stale epoch never results in a delivery row.
- Two concurrent claimants yield one dispatch permission; losers never attempt transport.
- Unknown outcomes and failed receipt persistence never enable an automatic retry.
- Successful completion records the receipt and sent status in one transaction.
- An altered epoch, text, hash or destination cannot acquire or begin a claim.
- Active claims block re-file; only pre-dispatch cancellation can release that hold.
- Gate unavailable stamps the marker; gate signed refuses without force.
- Auto-ttl never fires against text the operator has since re-filed.
