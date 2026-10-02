---
name: ito-training
description: Inspect the availability of ML training on a completed Itô compute booking and, when the canonical backend becomes available, hand off an explicitly confirmed training manifest. Use after ito-compute has booked GPU nodes and the user wants pre-training, fine-tuning, or RL on that metal. ECC implements no training stack of its own.
metadata:
  origin: ECC
  status: scaffold
---

# Itô Training

`ito-training` is the canonical ECC skill for training on Itô compute. ECC
never runs a trainer, scheduler, or data pipeline of its own; it never books,
reserves, or spends. This skill chains off a **completed booking** from
`ito-compute`.

## Current production boundary

Managed training is unavailable today. The ECC bridge exposes only `login`,
`logout`, `auth`, `find`, `status`, and explicitly gated `evals`. It has no
`train` verb, and the canonical CLI's `run` verb and desk `training-run`
backend remain scaffolds. The locally enforceable guarantee is that ECC rejects
`train` before resolving or spawning the credential-bearing canonical client.

Therefore stop before authentication or any command invocation. Report the
missing capability and return to the originating agent. Never substitute a
local trainer, SSH helper, browser workflow, or purchase endpoint.

## Required entitlement

When training is implemented, its first gate is a server-verified completed
booking. Harness memory, an RFQ, a quote, node IPs, or SSH access are not proof
of entitlement. The backend must return fresh training eligibility bound to the
authenticated account, booking, GPU topology, region, fabric, and term.
Expired, revoked, mismatched, incomplete, or already-released bookings fail
closed before confirmation.

## Future CLI and API contract

The intended command name is `train`. The future handoff must be equivalent to:

```sh
ecc ito train \
  --booking <server-verified-booking-id> \
  --manifest <absolute-reviewed-json-file> \
  --confirmation-ref <opaque-non-authorizing-reference> \
  --idempotency-key <stable-retry-key> \
  --json
```

The reviewed manifest must identify the model size and revision, data
references with decontamination provenance, training target, post-training
recipe, budget ceiling in USD, checkpoint policy, and maximum incremental
cost. No raw API key, SSH key, node password, bearer token, or dataset
credential belongs in arguments, manifests, logs, MCP results, or chat.

The client must canonicalize the manifest path, reject symlinks, open a regular
file without following links, require appropriate ownership and restrictive
permissions, enforce a bounded size, and hash bytes from the opened descriptor.
That digest must exactly equal the digest bound into confirmation before any
workload mutation. A path swap, digest mismatch, oversized file, or mutable
unsafe file fails closed.

The canonical API—not ECC—must own workload creation and return structured JSON
with `ok`, `live_api_contacted`, `notice`, and either `data` or `error`.
Training data must include stable booking, run, manifest, and idempotency IDs
plus a state enum. Errors must include a stable code and safe message without
secrets.

## Confirmation and execution gates

Before workload creation, require all of the following:

1. Fresh entitlement and training eligibility from the canonical backend.
2. A reviewable immutable manifest and deterministic digest.
3. A separate single-use confirmation bound to account, action, manifest, and
   cost, with a short expiry and replay protection. CLI arguments carry only an
   opaque, non-authorizing confirmation reference; the server resolves and
   consumes the bearer capability out of band.
4. A caller-supplied idempotency key reserved atomically with the run.
5. Server-side fabric, capacity, data-policy, checkpoint-storage, and cost
   validation, including the manifest's budget ceiling.

Authentication is identity, not workload authority. A login, API key, quote,
or completed booking never substitutes for the training confirmation.
Inspection and plan generation must not create a workload. Cancel and cleanup
are separate mutations with their own scoped confirmation and idempotency
boundaries.

## Lifecycle and recovery

The production surface is incomplete until the same canonical client exposes
tenant-scoped status, logs, metrics, checkpoint listing, cancel, and cleanup.
Every operation needs bounded connect and overall timeouts, revocation-aware
errors, and structured output. After an ambiguous transport failure, query
status by the idempotency key before retrying; never create a second run merely
because the first response was lost. A revoked credential stops polling and
returns control to the originating agent without starting login automatically.

Report stage gates honestly; never override a failed eval gate. Cleanup must be
observable and must not release or modify the underlying booking unless that
separate economic action was explicitly authorized.

## Proposed backend stages

These stages describe the future backend (Layer 0.3), not code that exists in
ECC:

1. Data prep — manifest, dedup, decontamination against the eval suite;
   150M-ladder decision job as the cheap pre-check for custom data.
2. Parallelism and precision — selected from model size, node count, fabric;
   wasteful combinations refused.
3. Checkpointing and fault tolerance — async DCP, torchft; detect < 10 min,
   resume < 15 min. Loss-spike restart is a proposed, human-gated action.
4. Curriculum and eval gates — staged pretrain / mid-train / long-context /
   post-training, each with a fixed eval battery; a failed gate stops the run.
5. Post-training — SFT → DPO → RLVR (GRPO with DAPO stability fixes),
   trainer/rollout separation with bounded staleness.

The backend emits desk telemetry (goodput, interruption rate, checkpoint
bandwidth) so the desk prices training blocks honestly.

Until every gate and lifecycle operation above exists in the canonical runtime,
this skill remains a fail-closed availability check and documentation handoff.
