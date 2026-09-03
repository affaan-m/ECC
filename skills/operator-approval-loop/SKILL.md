---
name: operator-approval-loop
description: Never-silent operator approval contract for agent-drafted outbound messages, with hashed drafts, epoch-keyed decisions, an idempotent delivery ledger, and a pre-draft baseline gate. Use when an agent drafts messages to external counterparties and a human operator must approve, reject, or steer each send before it leaves.
---

# Operator Approval Loop

An agent that talks to external counterparties should never send on its own
judgment and should never go quiet. This skill defines the contract that
makes both true: every outbound draft is filed as an obligation, an operator
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
5. Acknowledge in the origin channel that a draft is filed and awaiting
   approval. Never-silent means the requester always sees that something
   happened, even when the answer is "waiting on the operator".

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

### Delivering

A delivery monitor scans for decided obligations with no delivery row:

1. Send the exact `draft_text` from the sidecar. Never re-derive text from
   the summary or regenerate it.
2. Insert the delivery row keyed by (obligation_id, decision_id). The UNIQUE
   constraint makes this idempotent: if the insert conflicts, someone else
   delivered, so stop without sending.
3. On success flip the obligation to `sent`.
4. In internal channels append a receipt footer:
   `approved by <operator> · receipt <decision_id> · draft sha256 <prefix>`.

Rejected decisions produce a reject notice through the same ledger. Legacy
obligations that have no draft sidecar are reported for a manual notice, not
delivered.

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

Origin channel sees: `Draft filed for approval (P1, sha 9f2c8a1b). Waiting on operator.`

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

- Same (counterparty, channel) filed twice yields one obligation, two epochs.
- A decision with a stale epoch never results in a delivery row.
- Two concurrent deliverers produce exactly one delivery row and one send.
- Gate unavailable stamps the marker; gate signed refuses without force.
- Auto-ttl never fires against text the operator has since re-filed.
