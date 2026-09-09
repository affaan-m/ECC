---
name: sandbox-testing
description: Route restricted, clean-user, native, and parallel harness tests through ECC's tiered sandbox workflow. Use for isolated execution, candidate workspaces, normalized evidence, visible review, or exploration that must not contaminate verification evidence.
---

# Sandbox Testing

Use ECC's manifest-driven CLI when a test must run with restricted host access,
inside a clean Linux home, or with native macOS behavior. The manifest declares
needs, never a backend. The router makes a deterministic claim decision, and
`--expect-backend` asserts that decision before provisioning. It never selects
or overrides a backend.

Start with the headless path when manual interaction would not add useful
information:

```bash
ecc-sandbox run sandbox.yaml --dry-run
ecc-sandbox run sandbox.yaml
```

Optional visible review or exploration begins when the user requests it, or
when the agent determines that hands-on inspection would help. Tier 1 is
appropriate for isolated backend feature testing, installer testing,
installation testing, first-run behavior, Linux dependency testing, and clean-user failure
reproduction. It is both a user-facing manual-testing environment and an agent
testing backend.

Before opening a visible Tier 1 session, explain the exact environment and ask
for explicit consent using this form:

> Would you like to launch a Tier 1 rootless Podman sandbox with [clean-home,
> source-mount, package, and network details], for testing [specific feature or
> behavior]? y/n

Fill in the brackets with concrete facts. Obtain the exact prompt from the
trusted CLI before asking the user:

```bash
ecc-sandbox launch sandbox.yaml \
  --purpose "isolated backend feature behavior" \
  --terminal terminal.app
```

The response must be `consent-required` with `creates_run: false`. Save its
manifest-bound `proposal_id` and repeat its `consent_prompt` verbatim. Do not
provision anything before an explicit `y`.
If the answer is `n`, continue without the sandbox or pass `--consent n` to
record the no-op result. After `y`, run the same command with `--consent y` and
`--proposal "$proposal_id"`. Never invent, omit, or reuse a proposal after the
manifest, capability snapshot, route, purpose, or terminal changes.
In short, the manifest-first flow is `ecc-sandbox launch` followed by a
`consent-required` response, then the same launch with `--consent y --proposal
"$proposal_id"` only after the user agrees.
Compose `$sandbox-testing` with `$terminal-opener`. The same skill and CLI
contract applies to Claude Code, Codex, and Kimi Code.

Use `launch` for direct hands-on Tier 1 testing from a manifest. Use `review`
when a person should observe or control a scripted verification run, passing
the same `--purpose`, `--consent y`, and `--proposal` contract. After a
completed, consented review, use `explore RUN_ID` for a fresh interactive
follow-up replica. The trusted CLI performs terminal launch and cleanup; never
replace it with a manually assembled `podman exec` lifecycle.

In exploration, the user may run commands, exercise the feature or installer,
and launch an agent that is available inside the disposable environment. The
outside agent should listen to the same redacted journal, monitor the results,
adjust or edit the feature outside the sandbox, and offer to rebuild or rerun
when another iteration is useful.

Honor the user's terminal preference. Both WezTerm and macOS Terminal.app are
supported through `--terminal wezterm` and `--terminal terminal.app`. The
aliases `terminal` and `macos-terminal` select Terminal.app. Never silently
override the user's choice.

Use `review` only when a person benefits from watching, pausing, inspecting, or
recording the run. Ordinary unit tests that already have an adequate local test
boundary do not need a sandbox merely because one is available.

## Choose A Claim

| Claim | Manifest shape | Expected review venue |
| --- | --- | --- |
| Restricted host process | Host-matching, non-native, no clean home, package install, service, or GUI need | Tier 0 process sandbox with SRT |
| Clean Linux user | `os: [linux]`, `native: false`, and `clean-home` or `pkg-install` | Tier 1 rootless Podman container |
| Native Apple Silicon macOS | `os: [macos]`, `arch: [arm64]`, `native: true`, and explicit `network:*` | Tier 2 Lume VM |

Declare the smallest accurate capabilities. `fs-write` permits Tier 0 writes
only inside the invocation workspace. `clean-home` requests disposable user
state. Every package-manager or system-installer command requires
`pkg-install`. `services`, `gui`, and `native: true` request native behavior.
Network capabilities authorize only the named egress. Tier 2 v1 is a special
case: it requires explicit `network:*` because Lume does not enforce guest
egress policy. Treat that as a trust acceptance and fail closed if it is not
acceptable. Never widen a claim merely to make a route succeed.

Read-only is not confidential: Tier 1 exposes the invocation directory at
`/workspace/source`. Before combining untrusted code and egress, invoke ECC
from a sanitized staging directory without `.env`, `.npmrc`, Git credentials,
history, private keys, customer data, or other secrets.

## Choose A Workspace

Workspace isolation is optional for Tier 0. Keep the default in-place workspace
for read-only probes and small trusted tests. For a trusted Tier 0 worker that
writes project files, prefer an opt-in linked worktree so its result can become
an evaluator-gated patch. For untrusted work, prefer an isolated copy because a
linked worktree shares Git administration metadata with the source repository.

The trusted harness creates and removes worktrees outside the sandboxed command.
SRT may block Git operations that follow shared administration paths outside the
worktree. The worker should edit only its owned workspace. The harness should
create the patch, evaluate it, and clean the exact workspace receipt.

Tier 1 already owns a disposable Linux home and package state while mounting the
source read-only. Tier 2 owns a disposable VM. Do not make the host checkout
writable merely to collect a candidate. Writable Tier 1 export or Tier 2 source
transfer requires an explicit driver with bounded artifact and cleanup receipts.
Fail closed when that driver is unavailable.

## Build A Meta-Harness

For parallel or autonomous software work, compose the execution-fabric modules
under `scripts/sandbox/fabric/` while preserving the tier router's authority.
The strict execution plan and additive receipts provide:

- deterministic DAG scheduling with global, per-tier, CPU, memory, and lease
  limits;
- digest-bound warm environment metadata with quarantine before reuse;
- default-deny credential leases with audience, scope, trust, backend, and
  expiry checks;
- bounded redacted trajectories linking commands, tests, artifacts, timing,
  cost, route, environment, and cleanup;
- sealed binary patches, independent evaluator receipts, and candidate-ref-only
  promotion;
- shadow route ranking that can reorder only statically eligible routes;
- fixed native visual evidence whose action transcript, screenshots,
  environment identity, and cleanup are hash-bound.

Keep adaptive routing in shadow mode until real, passing, cleanup-complete
history is representative. Never let history create a route or widen authority.
Never inherit ambient credentials. Exploration output remains non-evidence even
when it is useful for debugging.

The opt-in controller exercises the same hardened path for one or more targets:

```bash
ecc-sandbox fabric sandbox.yaml --plan-only --workspace-mode auto
ecc-sandbox fabric sandbox.yaml --workspace-mode worktree --local-only
ecc-sandbox fabric sandbox.yaml --workspace-mode worktree \
  --candidate-ref refs/heads/ecc/candidates/my-change --local-only
ecc-sandbox fabric sandbox.yaml --workspace-mode isolated-copy --max-parallel 3
```

`auto` keeps ordinary Tier 0 work in place, selects a worktree for trusted
Tier 0 file writes, and selects an isolated copy for untrusted Tier 0 work.
Tier 1 and Tier 2 retain their disposable backend state. The controller emits a
strict plan, normalized sandbox report, workspace receipt, optional patch and
evaluation, trajectory, and cleanup receipt. An explicit `--candidate-ref` may
create only a separately named candidate branch after accepted evaluation. It
never applies a patch to the source branch. Multi-target runs use per-job owned
workspaces and the validated scheduler; promotion remains single-target because
one candidate ref cannot represent several independent artifacts. Every job has
a controller-owned deadline. Expired workers are terminated, their workspace is
cleaned, and dependent jobs are cancelled. Public run, job, and workspace
receipts are strict validated contracts. Mock worktree runs usually produce an
empty candidate and are
truthfully rejected by patch policy because mock commands do not edit files.

See `docs/design/sandbox-testing/EXECUTION-FABRIC.md` for the current contracts,
workspace matrix, CI lanes, and staged shipping boundary.

## Probe And Preview

Resolve `ecc-sandbox` from trusted installed ECC content. A managed content
install needs the trusted runtime once:

```bash
npm install --global ecc-universal
ecc-sandbox probe --refresh
ecc-sandbox run sandbox.yaml --dry-run
```

Read the preview and choose the matching expectation. If the route differs,
fix the manifest or host prerequisite. Do not use an expectation to force it.

For a local VM route, run `ecc-sandbox preflight sandbox.yaml --local-only`
before announcing a launch. Routing dry-run does not measure host headroom.
Preflight creates no VM and is advisory; execution checks again while holding
the shared VM lease, before cloning and immediately before boot. A
`resource.admission` event with `decision: deny` is a launch refusal: tell the
user the stated reason, RAM/disk shortfall when measured, and the next action
(close other workloads, explicitly choose a smaller suitable preset, free disk,
or use another host). Do not keep retrying, silently reduce manifest resources,
or claim a VM opened. Unknown/stale probes and unsupported host platforms also
refuse. Local host resource probes currently support macOS only.

If a requested local VM or container venue is unavailable, explicitly notify
the user and name the supported alternative. A running Podman machine with an
unreachable API is unavailable. Malformed machine inventory or rootless
telemetry is unknown and must not be described as a stopped or rootful machine.
Local Windows VM execution is unsupported in v1; use hosted CI when its exact
commit and workflow identity checks pass.

Storage admission budgets a full logical seed copy unless the pinned Lume
0.5.1 adapter verifies its bundled APFS COW helper. That helper requires host
Swift tools and never falls back to full copying after a COW failure. If it is
unavailable, sufficient space for a full copy plus scratch headroom is required.
Admission estimates reclaimable memory; it cannot reserve RAM against unrelated
apps or guarantee unlimited guest disk growth.

Routing examples:

- A parser or ordinary CLI probe without disposable home state uses Tier 0.
- A user-level installer that writes home state or invokes a package manager
  declares `clean-home` or `pkg-install` and uses Tier 1 rootless Podman.
- A launch agent, native service, or macOS installer declares native macOS
  behavior plus `network:*` and uses Tier 2 Lume. Gate 1 verification does not
  claim deterministic GUI evidence. Use the native-display exploration replica
  for hands-on GUI work and label it non-evidence.

The agent should make this claim decision, launch the scripted workflow,
listen, inspect, and evaluate. It should not manually assemble backend
lifecycle commands during verification.

## Launch Direct Interactive Tier 1

After the user answers `y`, open the tailored manual-testing environment:

```bash
ecc-sandbox launch sandbox.yaml \
  --purpose "isolated backend feature behavior" \
  --terminal terminal.app \
  --consent y --proposal "$proposal_id"
```

The JSON response contains the exploration `run_id` and exact listener
command. Follow the listener while the user runs commands, CLIs, or agents in
the selected terminal. The response says `launching`; claim that the sandbox
opened only after the listener emits `exploration.started`. Use the resulting
`exploration.output` observations to adjust the feature outside the sandbox,
then offer another consented launch when a clean iteration would help. This
flow is always non-evidence.

The launch check-in deadline is 15 seconds. If the terminal adapter returns but
the command never starts, the listener emits `exploration.launch.failed`, the
run becomes `error`, and the follow command terminates. Report that failure and
do not claim the sandbox opened. The timed-out run rejects a late terminal
check-in.

## Open One Visible Review

One command starts the supervised run and opens the selected terminal:

```bash
ecc-sandbox review sandbox.yaml \
  --purpose "the scripted Tier 1 verification" --consent y \
  --proposal "$proposal_id" \
  --terminal terminal.app --expect-backend podman --record
```

The window shows lifecycle state, redacted stdout and stderr, current step,
evidence, and cleanup. The listener reads the complete metadata from that same
journal while the compact window renders selected fields. `evaluate` returns
final phase timings. The sandbox
starts only after the review client connects. A detached supervisor, not the
terminal client, owns the sandbox and its deadline.

The command returns `result: launching`, `state: awaiting-ui`, and `run_id`.
Claim that the visible review connected only after the listener emits
`ui.ready`. An agent consumes the same sequence-numbered, redacted event stream
as the window:

```bash
ecc-sandbox listen RUN_ID --follow --format jsonl
ecc-sandbox evaluate RUN_ID --json
```

Do not scrape a terminal pane or backend logs. Listener disconnects never stop
or mutate a run.

## Verification And Exploration

Verification commands run without a PTY and with closed stdin. User keystrokes
cannot become test input. At a safe `ready-paused` or `evidence-paused`
boundary, use fixed controls or these commands:

```bash
ecc-sandbox inspect RUN_ID
ecc-sandbox continue RUN_ID
ecc-sandbox wait RUN_ID
ecc-sandbox stop RUN_ID
```

Inspection is read-only and backend-specific. Before evidence capture, Lume
inspection remains host-side because guest login can change VM state. After
evidence is sealed, fixed guest diagnostics may run in the separate inspection
channel. Inspection output is excluded from steps, assertions, install diff,
and workload timing.

For an arbitrary shell or hands-on experiment, create an exploration replica
and listen to the new run ID returned by the command:

```bash
ecc-sandbox explore RUN_ID
ecc-sandbox listen EXPLORATION_RUN_ID --follow --format jsonl
```

Hands-on exploration receives at least 30 minutes as a bounded human lease.
Setup commands keep the manifest timeout, so a short workload deadline does
not prematurely close the person's shell.

The replica has a separate resource identity, guardian, private live PTY
journal, and cleanup lease. Its commands can never turn into passing
verification evidence. Never describe exploration output as proof of the
original run.

## Recording And Reattachment

`--record` writes `review.cast` from the same redacted journal shown to the
window and listener. It does not capture the host screen, notifications, raw
backend output, or exploration input. Export is optional:

```bash
ecc-sandbox video RUN_ID --format mp4
ecc-sandbox attach RUN_ID
```

If the window closes during a command, the supervisor continues through
cleanup. At a pause it allows a short reattach grace period, then either aborts
and cleans or finalizes already-sealed evidence and cleans. The window never
owns the process, container, or VM.

List or recover supervised runs with:

```bash
ecc-sandbox runs --active
ecc-sandbox gc
```

Cleanup uses exact ownership receipts. Never substitute a wildcard process,
container, or VM cleanup command.

## Run The Three Visible Acceptances

From a trusted ECC checkout:

```bash
ecc-sandbox review examples/sandbox/review-tier0-srt.yaml \
  --expect-backend srt --record

ecc-sandbox review examples/sandbox/review-tier1-podman.yaml \
  --purpose "the Tier 1 clean-user review" --consent y \
  --proposal "$proposal_id" \
  --terminal terminal.app --local-only --expect-backend podman --record

ecc-sandbox review examples/sandbox/review-tier2-lume.yaml \
  --local-only --expect-backend lume --record
```

For a meaningful Tier 1 installer acceptance, invoke ECC from the trusted
checkout whose installer is under test:

```bash
ecc-sandbox review examples/sandbox/review-tier1-claude-installer.yaml \
  --purpose "the full Claude project installer" --consent y \
  --proposal "$proposal_id" \
  --terminal terminal.app --local-only --expect-backend podman --record --no-pause
```

This installs the full Claude project profile into disposable container state,
runs `doctor`, requires complete layer-diff evidence, and removes the container.

For a native macOS development demo with Codex already prepared before the
interactive shell opens, use the reusable Tier 2 recipe:

```bash
ecc-sandbox review examples/sandbox/review-tier2-codex.yaml \
  --terminal terminal.app --local-only --expect-backend lume \
  --record --no-pause
ecc-sandbox wait RUN_ID
ecc-sandbox explore RUN_ID --terminal terminal.app
```

The lightweight preset explicitly requests 2 CPUs and 4 GiB RAM. Heavier builds
may need a larger manifest and a host that passes its resource admission.
The recipe installs Apple Command Line Tools when absent, installs Codex through OpenAI's standalone installer and creates a
disposable `~/security-lab` Git repository. The exploration replica replays the
setup automatically. The native viewer can appear during boot; the SSH shell
opens only after every setup command succeeds. A setup failure is reported and
the owned clone is cleaned up. The user runs
`cd ~/security-lab && codex` and completes Sign in with ChatGPT inside the
guest. Never copy host Codex, Git, SSH, browser, or API credentials into a seed
or clone. Guest authentication remains disposable state and is only considered
destroyed after exact clone cleanup succeeds.

For a GUI request, require an operator-prepared, credential-free seed whose
onboarding is complete for the installed macOS version and build. Verify the
clone reaches its desktop before claiming the requested environment is ready.
SSH and successful setup steps establish CLI readiness; Setup Assistant or a
login screen can still block the desktop. Lume 0.5.1's unattended patcher uses
fixed `26.5.2` / `25F84` onboarding markers, so an SSH-ready seed alone is
insufficient evidence for a newer guest's desktop readiness.

If graphical onboarding blocks delivery, promptly tell the user which screen
is present, which CLI capabilities passed verification, and that the requested
desktop remains unavailable. Offer preparing a suitable GUI-ready seed or an
explicit CLI-only choice. Keep the result partially ready until graphical
verification succeeds, and retain the clone's normal ownership and cleanup.

The three tier comparison fixtures emit the same two-second workload so the window is visibly live.
It is an overhead smoke test, not a statistically meaningful benchmark. Repeat
each run at least three times with `--no-pause` and compare medians. The visible
window and shared listener remain active while the safe boundaries advance
automatically.

## Evaluate Evidence

Read `result`, backend, tier, and `execution_mode` first. `execution_mode: mock`
proves orchestration only. Find the first nonzero step and failed assertion.
For installation claims, require `install_diff.complete: true`. Tier 2 scans are
bounded and best effort, so they remain incomplete evidence.

Compare `active_total_ms`, not wall time. The metrics keep `review_wait_ms`
separate from provisioning, readiness, workload, evidence, and cleanup. State
the workload and sample count with every performance comparison.

An automatic retry may record at most one escalation. Report it explicitly.
Never respond to a denial by weakening the host sandbox or silently changing
the manifest.

Hosted CI matrix reports may cover an unavailable OS, but they are not the
visible local Tier 0, Tier 1, and Tier 2 acceptance workflow described here.

## Finish

Report the run ID, selected tier/backend, real versus mock execution, result,
first failure, evidence completeness, cleanup result, active timing, review
wait, and recording path. Clearly label all exploration and partial evidence.
