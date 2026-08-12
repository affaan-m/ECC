---
name: ito-inference
description: Inspect the availability of model serving on a completed Itô compute booking and, when the canonical backend becomes available, hand off an explicitly confirmed serving manifest. Use after ito-compute has booked GPU nodes and the user asks for an OpenAI-compatible endpoint, ito-serve, hosted Kimi, or self-hosted open-weights inference. ECC implements no serving stack of its own.
metadata:
  origin: ECC
  status: scaffold
  aliases: ito-serve, hosted-open-weights
---

# Itô Inference

`ito-inference` is the sole canonical ECC skill for inference serving on Itô
compute. Requests naming `ito-serve` route here; do not create or install a
second `ito-serve` skill. ECC never SSHes to nodes, downloads weights, launches
an engine, or exposes an endpoint; it never books, reserves, or spends.

## Current production boundary

Managed serving is unavailable today. The ECC bridge exposes only `login`,
`auth`, `find`, `status`, and explicitly gated `evals`. It has no `serve` verb.
The canonical runtime documents `inference` only as an unsupported compatibility
probe; ECC does not invoke or depend on it. The MCP surface exposes only auth,
find, and status. The locally enforceable guarantee is that ECC rejects `serve`
before resolving or spawning the credential-bearing canonical client.

Therefore stop before authentication or any command invocation. Report the
missing capability and return to the originating agent. Never substitute a
local runner, SSH helper, browser workflow, purchase endpoint, or any untracked
local `ito-serve` draft.

## Required entitlement

When serving is implemented, its first gate is a server-verified completed
booking. Harness memory, an RFQ, a quote, node IPs, or SSH access are not proof
of entitlement. The backend must return fresh serving eligibility bound to the
authenticated account, booking, GPU topology, region, fabric, term, and model
policy. Expired, revoked, mismatched, incomplete, or already-released bookings
fail closed before confirmation.

## Future CLI and API contract

The intended command name is `serve`; `inference` may remain only as an
explicitly deprecated compatibility alias after the production contract lands.
The future handoff must be equivalent to:

```sh
ecc ito serve \
  --booking <server-verified-booking-id> \
  --manifest <absolute-reviewed-json-file> \
  --confirmation-ref <opaque-non-authorizing-reference> \
  --idempotency-key <stable-retry-key> \
  --json
```

The reviewed manifest must identify the model revision, engine and version,
quantization, tensor/pipeline topology, endpoint exposure policy, artifact
checksums, storage ceiling, runtime limits, optional TTFT/TPOT objectives, and
maximum incremental cost. No raw API key, SSH key, node password, or bearer
token belongs in arguments, manifests, logs, MCP results, or chat.

The client must canonicalize the manifest path, reject symlinks, open a regular
file without following links, require appropriate ownership and restrictive
permissions, enforce a bounded size, and hash bytes from the opened descriptor.
That digest must exactly equal the digest bound into confirmation before any
workload mutation. A path swap, digest mismatch, oversized file, or mutable
unsafe file fails closed.

The canonical API—not ECC—must own workload creation and return structured JSON
with `ok`, `live_api_contacted`, `notice`, and either `data` or `error`. Serving
data must include stable booking, workload, manifest, and idempotency IDs plus a
state enum; it must not claim an endpoint is live until health and model checks
pass. Errors must include a stable code and safe message without secrets.

## Confirmation and execution gates

Before workload creation, require all of the following:

1. Fresh entitlement and serving eligibility from the canonical backend.
2. A reviewable immutable manifest and deterministic digest.
3. A separate single-use confirmation bound to account, action, manifest, and
   cost, with a short expiry and replay protection. CLI arguments carry only an
   opaque, non-authorizing confirmation reference; the server resolves and
   consumes the bearer capability out of band.
4. A caller-supplied idempotency key reserved atomically with the workload.
5. Server-side fabric, capacity, model-policy, storage, and cost validation.

Authentication is identity, not workload authority. A login, API key, quote,
or completed booking never substitutes for the serving confirmation. Inspection
and plan generation must not create a workload. Cancel and cleanup are separate
mutations with their own scoped confirmation and idempotency boundaries.

## Lifecycle and recovery

The production surface is incomplete until the same canonical client exposes
tenant-scoped status, logs, metrics, cancel, and cleanup operations. Every
operation needs bounded connect and overall timeouts, revocation-aware errors,
and structured output. After an ambiguous transport failure, query status by
the idempotency key before retrying; never create a second workload merely
because the first response was lost. A revoked credential stops polling and
returns control to the originating agent without starting login automatically.

Only report `ready` after endpoint health, model identity, and canary inference
all pass. Report intermediate and terminal failure states honestly. Cleanup must
be observable and must not release or modify the underlying booking unless that
separate economic action was explicitly authorized.

## Proposed backend stages

These stages describe the future backend, not code that exists in ECC:

1. Verify entitlement, topology, fabric, and cost gates.
2. Fetch checksum-pinned weights into backend-managed storage.
3. Emit and validate a reviewable topology/engine plan.
4. Launch through the provider control plane, never direct root SSH from ECC.
5. Warm up, test health and model identity, run an SLO canary, then register the
   endpoint and redacted configuration.

Until every gate and lifecycle operation above exists in the canonical runtime,
this skill remains a fail-closed availability check and documentation handoff.
