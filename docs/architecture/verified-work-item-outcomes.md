# Verified Work-Item Outcomes

ECC connects the tools that agents already use. A queue selects work; a
workspace or multiplexer hosts sessions; a harness chooses actions; tools make
changes; a validator checks the result. These responsibilities can remain in
different products while sharing an explicit completion contract.

This slice adds opt-in artifact verification to the existing local work-items
store. It gives a failed check, a repair, and a successful check a common
record. It does not introduce another queue, terminal, model runtime, or skill
catalog.

## Position In The Stack

```text
Queue / workspace          select and assign a task
          |
Terminal / multiplexer     host the worker session
          |
Agent harness              choose actions and handle observations
          |
Tools                      inspect, edit, and repair an artifact
          |
ECC verification           check the declared result and record evidence
```

The work-item ID connects task state to its owner and session. The declared
validator connects completion to an artifact check. Queues and session UIs
can consume those records without adopting a new execution environment.
FocusQueue integration is a planned consumer, not a shipped adapter in this
slice. Existing session adapters are described in the
[harness adapter matrix](harness-adapter-compliance.md).

## First Validator

`harness-adapter-documentation/v1` checks a Markdown artifact against ECC's
canonical harness adapter matrix. Its scope is documentation consistency:
the expected matrix markers and contents must match the registered validator's
reference data. A passing result does not prove that each documented harness
was exercised or that an external deployment succeeded.

Validation runs through the registered ECC implementation. A task supplies an
artifact path, not a shell command or a replacement validator. Keep the
checker independent of the artifact being repaired.

## Use The Contract

Run these commands from an ECC checkout. The session must already exist in
the same state database; `sessions-cli.js` lists available IDs. Replace the
example session value with an ID from that output. If using a separate
database, pass the same `--db <path>` to every command, including the session
lookup.

```bash
node scripts/sessions-cli.js --json
ecc_docs_session='existing-session-id'

node scripts/work-items.js upsert adapter-matrix-docs \
  --title 'Keep the harness adapter matrix consistent' \
  --repo-root "$PWD" \
  --verify harness-adapter-documentation/v1 \
  --artifact docs/architecture/harness-adapter-compliance.md

node scripts/work-items.js claim adapter-matrix-docs \
  --owner docs-worker --as agent --session-id "$ecc_docs_session"

node scripts/work-items.js verify adapter-matrix-docs --json
node scripts/work-items.js show adapter-matrix-docs --json
```

Register the contract when creating a new work item, before claiming it.
Existing items cannot acquire a contract, including legacy items that are still
open; use a new work-item ID. The validator, artifact path, and task identity
(`id`, `source`, `sourceId`, `title`, `repoRoot`) remain fixed for that item.

| Check result | Work-item status | Next action |
| --- | --- | --- |
| Success | `done` | Inspect the recorded evidence. |
| Failure | `blocked` | Repair the artifact, then run `verify` again. |
| Unknown | `blocked` | Resolve the check's error, then run `verify` again. |

Failed attempts remain in the record when a later check succeeds. Cancelling
work does not establish success. A manual close cannot substitute for the
registered check on a contracted item.

`verify --json` returns `{ verified, attempt, item }`; a failed or unknown
check exits with status 1 while preserving its receipt. Running `verify` again
always performs a new check and appends a new attempt, even if the artifact
has not changed.

A success-state update, such as `close`, requires a previous successful check
bound to the same task, owner, and session. It also rechecks the current
artifact and validator reference. A failed completion recheck records another
attempt and moves the item to `blocked`; the CLI exits with status 1. A close
without a previous bound success is rejected. After a repair or reassignment,
run `verify` to establish a fresh result.

## Local Receipt

`show --json` exposes `metadata.verification`:

```json
{
  "contract": {
    "verifier": "harness-adapter-documentation/v1",
    "artifact": "docs/architecture/harness-adapter-compliance.md"
  },
  "registeredAt": "2026-11-15T00:00:00.000Z",
  "attempts": []
}
```

The timestamp above is illustrative. Each recorded attempt contains:

| Fields | Meaning |
| --- | --- |
| `schemaVersion` | `ecc.work-item-verification.v1`. |
| `attemptId`, `previousAttemptId` | Unique check ID and previous check ID, or `null` for the first attempt. |
| `kind` | `verification` or `completion-recheck`. |
| `taskId`, `sessionId`, `owner` | Work item and executor attribution. |
| `verifier`, `verifierDigest` | Registered validator ID and SHA-256 of that ID plus its rendered reference matrix. |
| `contractDigest` | SHA-256 binding the repository root, validator ID, and artifact path. |
| `taskDigest` | SHA-256 binding task identity, owner, session, and contract digest. |
| `outcome`, `reasons` | `success`, `failure`, or `unknown`, plus check diagnostics. |
| `artifactDigest` | SHA-256 of the inspected bytes, or `null` when a trustworthy read was unavailable. |
| `durationMs`, `checkedAt` | Local verification duration in milliseconds and ISO timestamp. |

Receipts store hashes and diagnostics, not the artifact body. Diagnostics may
include local file paths; treat the store as local operational data. The
previous-attempt link is an ordering aid, not a tamper-proof audit chain.
`durationMs` measures the check, not total task time. Token usage, monetary
cost, and human interventions are not measured by this receipt.

The artifact must be a regular `.md` file no larger than 1 MiB, addressed by a
relative path within the registered repository root. Path traversal and
symlink artifacts or path components are rejected. A work item retains at
most 1,000 attempts; reaching that limit requires a new work item rather than
silently discarding its history.

## Learning Fits The Same Interface

A future compact execution model could choose a tool, compose a short workflow,
or propose a repair. Deterministic code can still perform file operations,
enforce contracts, and check the result. Both large and small models can use
the same task, tool, and outcome interfaces.

The useful learning signal is whether an action produced the required result,
what failed, and how much recovery it required. This slice records local
verification attempts; it does not train a model, produce a training dataset,
measure model quality, or demonstrate transfer to new environments. Those
experiments need separate baselines, consent and data handling, held-out tasks,
and cost and latency measurements.

## Boundaries

- Verification is opt-in. Existing manual and imported work retains its
  previous lifecycle; a manual `done` status is not a verified outcome.
- The record is local evidence, not remote attestation. A person who can
  modify the local database or ECC implementation can alter its contents.
- An artifact check covers the inspected file at the time of the attempt.
  It is not a claim about all repository files or a permanent guarantee after
  later edits.
- This change does not add hosted execution, authorization, model training,
  a FocusQueue adapter, or automatic repair. The worker performs the repair
  and explicitly requests another check.

## Related Contracts

- [Progress sync](progress-sync-contract.md): queue and handoff sources of truth.
- [Session adapters](session-adapter-contract.md): portable session inspection.
- [Harness construction](../../skills/agent-harness-construction/SKILL.md):
  action spaces, observations, and recovery.
