---
name: parallel-execution-optimizer
description: Speed up a task by turning it into a dependency graph of parallel lanes with a lane matrix, batched reads and checks, write surfaces isolated by file, worktree, branch, or service, and a final verification table. Use when the user wants a task done much faster through parallel work, concurrent agents, batched tool calls, isolated worktrees, or many independent verification lanes without losing correctness.
license: MIT
metadata:
  origin: ECC
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Parallel Execution Optimizer

Use this skill when speed comes from doing independent work at the same time:
repo inspection, file reads, API checks, browser checks, build/test lanes,
deploy readbacks, or multi-worktree implementation passes. Also use it when
homogeneous work repeats unchanged preparation between records, even if the
record operations must remain sequential.

## Core Pattern

Turn urgency into a dependency graph before acting.

1. Define the objective and done signal.
2. Split work into lanes.
3. Mark each lane as parallel, sequential, or gated.
4. Run independent reads/checks together.
5. Keep writes isolated by file, worktree, branch, service, or dataset.
6. Merge only after evidence shows the lanes are compatible.
7. End with a verification table, not a vague speed claim.

## Lane Matrix

Before a large push, write a compact matrix:

```text
Lane | Can run in parallel? | Write surface | Risk | Verification
Repo scan | yes | none | low | rg/git status outputs
Backend patch | maybe | src/api | medium | unit tests
Frontend patch | maybe | app/components | medium | browser screenshot
Deploy readback | after build | remote service | high | live URL + logs
```

Only run lanes in parallel when their write surfaces do not collide.

## Execution Rules

- Batch file reads, searches, status checks, and metadata queries.
- Use isolated worktrees for large unrelated implementation lanes.
- Start long-running tests, builds, backfills, and deploys in separate sessions,
  then poll them deliberately.
- If a lane discovers a blocker that changes the plan, pause dependent lanes
  and update the matrix.
- Never let a background process outlive the turn unless the user explicitly
  asked for a continuing service.
- Do not parallelize destructive commands, migrations, writes to the same table,
  or live customer-impacting deploys without an explicit gate.

## Bounded Homogeneous Work

Reuse preparation when a finite group of records shares accepted invariant
inputs, such as a mapping and tool contract. This reduces repeated discovery
and task setup; it does not require concurrent writes.

1. Define the bounded record set, done signal, accepted mapping/contract version,
   and the dependencies or risks that require replanning.
2. Discover shared sources and prepare invariant inputs once. Record their
   versions and validity conditions; reuse them only while those conditions hold.
3. Before each record's effect, check its current version, permissions,
   prerequisites, and exact intended effect. Shared preparation is not shared
   authorization. Use conditional writes when supported; stop on a conflict.
4. Verify the actual outcome for that record. Carry forward its evidence and
   the remaining-work set after each verified success. An attempted write is
   not a verified success; reconcile an uncertain outcome before any retry.
5. Continue within the same bounded task while the contract and prerequisites
   remain valid. Create a separate task or review when a real dependency,
   changed contract, or risk requires it, rather than after every success.

### Planner/Executor Example

The following is a synthetic walkthrough, not a measured runtime benchmark or
an executed connector test. Records A, B, and C are independent and use the
same accepted mapping M1 and tool contract T1. Writes stay sequential.

```text
Planner:
  group = [A, B, C]
  shared = accepted mapping M1 + tool contract T1 + source references
  verified = {}
  remaining = [A, B, C]

Executor for A:
  confirm shared inputs are still valid
  read A's current version; check permission and prerequisites
  determine exact effect; apply against that version; verify outcome
  carry forward verified = {A: outcome evidence}, remaining = [B, C]

Executor for B, then C:
  reuse shared preparation and carried state
  repeat each record's version, permission, prerequisite, effect, outcome checks
  remove a record from remaining only after verifying its success

Replan:
  if T1 changes to T2, pause dependent work and review the changed contract
  if B's prerequisite fails, leave B unresolved and review that dependency
  preserve A's verified evidence; refresh only inputs invalidated by the change
```

Carry-forward state should identify the group, shared input versions and
validity conditions, per-record verified outcomes, unresolved/uncertain effects,
remaining records, completed-work exclusions, and the next required check. On
resumption, revalidate inputs that may have changed; do not replay completed effects merely because a new
executor takes over. Treat a new user request or changed scope as a new contract.

### Resume After a Connector Change

For a synthetic handoff, suppose A is completed and excluded from further
changes, B failed with a confirmed absence of effects, C was never attempted, and D has an
ambiguous outcome. Carry those per-operation states and evidence into the new
connector route. Keep A excluded. Reconcile D before considering a retry;
rebuild the executable set from unresolved work that is still authorized,
including B and C only after their checks pass. Validate the new tool contract
and preserve the exact intended effects. Do not rebuild the original batch as
executable or erase earlier deviations because a later attempt succeeds.

### Evaluation Criteria

Use the walkthrough to check that ordinary successes advance A → B → C without
repeating unchanged source discovery or full task preparation. Confirm that a
changed contract or failed prerequisite still triggers the relevant review,
per-record checks remain intact, and unverified outcomes stay unresolved. On a
connector change, confirm completed exclusions survive, failed/unattempted work
requires current authorization, and ambiguous effects are reconciled first. Report
what was actually executed separately from this proposed evaluation. Do not infer
latency improvements or ECC/connector fault attribution from this example.

## Output Shape

Use this when reporting:

```text
Parallel execution result:
- Lanes run: 5
- Lanes completed: 4
- Blocked lane: deploy readback, waiting on DNS propagation
- Fast path found: batched repo scan + focused tests
- Verification: lint pass, unit pass, live smoke pass
```

## Failure Modes

- More concurrency that creates conflicting edits.
- Benchmarking the tool instead of the task.
- Treating "fast" as done before correctness is proven.
- Forgetting to poll running sessions.
- Hiding skipped checks behind a success summary.
