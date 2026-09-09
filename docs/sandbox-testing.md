# ECC Sandbox Testing

## Purpose

ECC sandbox testing gives a person and an agent one observable workflow for
restricted process tests, clean Linux installs, and native macOS tests. A
strict YAML manifest states what the test needs. The central rule is that the
agent declares needs, never a backend. The router makes the claim, while an
optional expectation fails before provisioning if the selected backend is
surprising.

`ecc-sandbox launch` opens one visible terminal for hands-on Tier 1 testing.
`ecc-sandbox review` opens a visible terminal for scripted verification. A
detached supervisor owns each sandbox, streams the same redacted events to the
window and agent listeners, records phase timings, preserves any verification
evidence, and cleans the resource.

## Build And Verification Workflow

The September 8, 2026 approved direction starts with an isolated build and
verification workflow: stage the required source, run in a disposable workspace,
verify the result outside the worker, export a bounded candidate, and clean up.
A whole-agent environment follows only after its file tools, shell, network,
plugins, and external connections have explicit containment or broker coverage.
The opt-in execution fabric now emits a version 2 plan and job envelope with a
controller-derived execution class, placement, operator, shell-only coverage,
excluded agent surfaces, enforced and missing controls, and bounded resource
observations. Stale telemetry or an observed limit breach stops the worker and
triggers cleanup. See the existing
[execution-fabric design](design/sandbox-testing/EXECUTION-FABRIC.md#approved-direction-isolated-software-work)
for the implemented slice and the remaining trust, credential revocation, and
whole-agent gates. The v1 manifest fields, tier meanings, and operational
examples below remain the current interface.

## Tier 1 User Experience

Tier 1 is a user-facing manual-testing environment as well as an agent testing
backend. Rootless Podman is a good fit for this purpose: it can provide a
disposable Linux user and filesystem, controlled mounts and networking, and a
repeatable CLI environment without installing the feature into the person's
real home. Good Tier 1 uses include isolated backend feature testing,
installer or installation testing, first-run behavior, Linux dependency
testing, and reproducing a clean-user failure. Native macOS, GUI, and service
behavior belong in Tier 2.

The agent must offer, explain, and obtain consent before opening a visible Tier
1 session. The prompt must name the relevant environment properties and the
specific purpose. For example:

> Would you like to launch a Tier 1 rootless Podman sandbox with a clean Linux
> home, a read-only source mount, and networking disabled, for testing the ECC
> installer? y/n

Substitute the actual mount, network, package, and test details for each task.
Do not provision the container before an explicit `y`. A `n` means continue
without the sandbox. Do not use a vague permission request such as "open a
sandbox?" because the user cannot judge what will run or what it can access.

The agent first requests a proposal without consent:

```bash
ecc-sandbox launch sandbox.yaml \
  --purpose "the ECC installer" \
  --terminal terminal.app
```

The command returns `result: consent-required`, `creates_run: false`, a
manifest-bound `proposal_id`, and the exact `consent_prompt`. The agent saves
the proposal ID and repeats the prompt verbatim. If the user answers `n`, the
agent may record the decline with `--consent n`; ECC still creates nothing. If
the user answers `y`, the agent launches the session with:

The manifest-first flow is `ecc-sandbox launch`, a `consent-required` result,
and the same launch with `--consent y --proposal "$proposal_id"` only after the
user agrees. A changed manifest, capability snapshot, route, purpose, or
terminal invalidates the proposal and requires a new question.

```bash
ecc-sandbox launch sandbox.yaml \
  --purpose "the ECC installer" \
  --terminal terminal.app \
  --consent y --proposal "$proposal_id"
```

The resulting loop is:

1. The agent creates and previews a least-privilege manifest that mimics the
   circumstances under test.
2. ECC opens the session in the user's selected supported terminal client.
3. The user can run commands, exercise the installed CLI, or launch an agent in
   the disposable environment. The agent can listen to the same redacted
   output stream without scraping the terminal screen.
4. The agent uses those observations to adjust or edit the feature outside the
   sandbox, then offers to rebuild or rerun the environment as appropriate.
5. ECC stops and removes the owned container when the user exits, stops the
   run, or the bounded lease expires.

The accepted command initially reports `launching`. A 15-second watchdog waits
for the visible terminal process to emit `exploration.started`. If the terminal
adapter accepts the request but the command never checks in, the shared
listener emits `exploration.launch.failed`, changes the run to `error`, and
returns instead of following an inert run indefinitely. A late terminal cannot
start that timed-out session.

Scripted verification and manual interaction have different evidence
authority. `review` produces repeatable evidence with closed stdin. `explore`
creates a fresh interactive replica from the same manifest and setup for
hands-on follow-up to a completed, consented review. `launch` is the direct
manifest-first manual path and does not require a prior review. Exploration
output can guide the user and agent's next iteration, but it cannot be
relabeled as deterministic verification evidence.

The terminal is a replaceable client, not the sandbox owner. Both WezTerm and
macOS Terminal.app are supported, and the user's preference is honored through
`--terminal wezterm` or `--terminal terminal.app`. The aliases `terminal` and
`macos-terminal` also select Terminal.app.

For advanced agent harnesses, the opt-in execution-fabric modules add strict
plans, owned candidate workspaces, quota-aware parallel scheduling, digest-bound
environment reuse, scoped credential leases, normalized trajectories,
independent evaluation, candidate-ref promotion, shadow route ranking, and
deterministic visual-evidence records. Version 2 fabric receipts also state the
execution class separately from placement, enumerate shell-only exclusions,
and disclose resource limits and missing telemetry. They do not change the
default single-run router or apply changes to the caller's branch. See
[`docs/design/sandbox-testing/EXECUTION-FABRIC.md`](design/sandbox-testing/EXECUTION-FABRIC.md).

## Claude Code, Codex, And Kimi Code Agents

Claude Code, Codex, and Kimi Code use the same
`skills/sandbox-testing/SKILL.md` contract and the same installed `ecc-sandbox`
executable. The skill contains no model SDK integration. It teaches each agent
to write a least-privilege manifest, preview routing, start a supervised run,
listen to the redacted journal, and evaluate the sealed report.

- In a native Claude plugin install, invoke `/ecc:sandbox-testing`. Claude's
  optional failure hook may suggest the workflow after a Bash isolation denial,
  but it never starts a run or changes permissions.
- In a native Codex plugin install, invoke `$sandbox-testing`. Codex receives
  the same workflow plus its OpenAI interface metadata. A separate
  `$tier0-demo` skill may be installed during development as a one-purpose local
  shortcut, but it is not required by the shipped workflow.
- In a managed Kimi Code project install, invoke `/skill:sandbox-testing` from
  the skill placed under `.kimi-code/skills/`. Kimi uses the same manifest and
  CLI contract; ECC does not configure Kimi lifecycle hooks or model settings.

Visible interaction is optional. When the user requests a window, or the agent
determines that hands-on inspection would help, it must use `launch` to produce
the explicit Tier 1 consent prompt above. After `y`, compose
`$sandbox-testing` with `$terminal-opener`. The trusted `ecc-sandbox launch`,
`review`, and `explore` commands use that argument-preserving launcher
internally. The agent should not construct an unowned `podman exec` session
itself.

The agent remains the operator outside the sandbox. Scripted workload commands
run with closed stdin and no PTY. The person and agent observe the same
sequence-numbered events, while arbitrary hands-on work goes into a separate
exploration replica that cannot become verification evidence.

## Process Boundary

`review` and `launch` are the public commands that compose a visible session.
They validate the manifest, resolve the route, enforce Tier 1 consent, create a
protected run directory, and launch the required trusted internal roles:

```text
ecc-sandbox _supervise RUN_ID
ecc-sandbox _ui RUN_ID
ecc-sandbox _guard RUN_ID
ecc-sandbox _explore RUN_ID
```

The supervisor alone creates the SRT process, Podman container, or Lume clone.
It runs backend processes with exact argument arrays, `shell: false`, finite
deadlines, bounded streams, and a filtered environment. The guardian receives
an ownership receipt and can clean the exact resource if the supervisor exits.
The UI has no direct backend handle.

The visible launch uses the selected terminal adapter. WezTerm receives the
exact target argument array:

```text
wezterm cli spawn --new-window --cwd ABSOLUTE_CWD -- \
  ABSOLUTE_NODE ABSOLUTE_ECC_SANDBOX _ui RUN_ID
```

Terminal.app receives a private mode-`0700`, self-deleting `.command` wrapper
through `/usr/bin/open -na Terminal.app`. Every target argument is encoded as
one quoted shell word inside that private wrapper. The outer launch arguments
and environment contain no target environment values.

If the mux path is unavailable, the launcher uses the equivalent detached
`wezterm start` argument array. No shell command string is constructed.

The supervisor enters `awaiting-ui` and waits for `ui.ready`. No sandbox
provisioning occurs before that handshake. The window and every `listen`
client then consume the same append-only event journal. Required lifecycle
events include `run.created`, `route.selected`, `sandbox.ready`,
`step.started`, `step.output`, `step.completed`, `evidence.completed`,
`cleanup.completed`, and `run.completed`.

Run state lives under the user's ECC state directory with private directory
and file permissions. The session includes `session.json`, `state.json`,
`events.jsonl`, `metrics.json`, the final `report.json`, and optional recording
artifacts. Output is redacted before it reaches disk, the selected terminal, or
an agent.

## The Three Local Claims

| Tier | Deterministic manifest claim | Backend | Use |
| --- | --- | --- | --- |
| 0 | Host-matching, non-native work without clean-home, package, service, GUI, or unrestricted-network needs | SRT | Restricted scripts and feature probes |
| 1 | Linux, non-native work requiring `clean-home` or `pkg-install` | Rootless Podman | Fresh-user installs and Linux behavior |
| 2 | Apple Silicon macOS with `native: true`, explicit `network:*`, and optionally `services` or `gui` | Lume | Native macOS CLI, installer, and service behavior |

These are claims, not fallback preferences. `--expect-backend` asserts the
router's decision and stops before creating anything when it does not match.
It never forces a route.

The agent's routing job is intentionally small:

1. Translate the behavior being tested into manifest needs.
2. Preview the deterministic route.
3. Assert the expected route, start the scripted review, and listen to its
   journal.
4. Inspect only through fixed profiles, then evaluate the sealed report.

Examples:

| Feature under test | Required claim | Route |
| --- | --- | --- |
| A parser or CLI command that needs the checkout but no fresh user state | Host-matching, non-native, restricted filesystem and named network only | Tier 0 SRT |
| A CLI installer that writes a user home, installs packages, or must prove first-run Linux behavior | Linux, `clean-home` and/or `pkg-install`, non-native | Tier 1 rootless Podman |
| A launch agent, native service, or macOS installer | Apple Silicon macOS, `native: true`, explicit `network:*`, and optionally `services` | Tier 2 Lume |

Do not infer Tier 2 merely because development happens on macOS. Choose it
only when native behavior is part of the claim. Do not keep a test in Tier 0
when it needs disposable home or package-manager state.

Tier 2 v1 requires explicit `network:*` because Lume does not enforce a guest
egress policy. This is a trust acceptance, not a routing hint. If unrestricted
guest egress is unacceptable, the local Tier 2 claim fails closed. Gate 1
verification proves native CLI, installer, and service behavior. A native
display may be used only in a separate exploration replica; GUI interaction
is not yet captured as deterministic verification evidence.

The visible local acceptance fixtures are:

- `examples/sandbox/review-tier0-srt.yaml`
- `examples/sandbox/review-tier1-podman.yaml`
- `examples/sandbox/review-tier2-lume.yaml`

Each runs the same two-second output-producing workload. This makes the live
window easy to observe and separates sandbox overhead from a changing test
payload. It is a smoke comparison rather than a statistical benchmark.

## Install And Probe Once

An npm installation exposes `ecc-sandbox`. Managed ECC content contains the
skill and guide but needs the trusted runtime once:

```bash
npm install --global ecc-universal
ecc-sandbox probe --refresh
```

Tier 1 requires rootless Podman. On macOS, initialize its managed Linux machine
once:

```bash
brew install podman
podman machine init --provider applehv
podman machine start
podman info --format json
```

Choose the visible terminal per launch with `--terminal wezterm` or
`--terminal terminal.app`. Terminal.app ships with macOS. WezTerm remains an
optional supported client.

The probe must report Podman as available and rootless before Tier 1 review.
If a Podman machine reports running but its API is unreachable, stop and report
that local Linux execution is unavailable. Restart that exact machine and use
hosted CI if the API remains unreachable. Malformed machine inventory or
rootless telemetry is an unknown state and must not be diagnosed as a stopped
or rootful machine.
Tier 2 requires the pinned Lume release and one stopped, SSH-ready,
operator-trusted Apple Silicon macOS seed. Follow the exact seed preparation
command reported by `probe`; normal runs clone and later delete a child VM.

Select either supported visible client:

```bash
wezterm --version
osascript -e 'id of application "Terminal"'
```

If the selected terminal cannot launch or its client does not connect within
the handshake deadline, `review` fails before sandbox provisioning and
`launch` fails before Podman provisioning.

## Manifest Contract

The canonical schema is
[`schemas/sandbox-manifest.schema.json`](../schemas/sandbox-manifest.schema.json).
Unknown keys and capabilities fail validation.

```yaml
name: install-my-tool
needs:
  os: [linux]
  capabilities: [clean-home, pkg-install]
  trust: first-party
  native: false
resources:
  cpu: 2
  memory: 2GB
  timeout: 300
steps:
  setup:
    - /workspace/source/install.sh --target codex
  assert:
    - test -f /home/ecc/.codex/ecc-install-state.json
report: install-diff
```

### Capability vocabulary

| Capability | Meaning |
| --- | --- |
| `fs-write` | Write inside the invocation workspace under Tier 0 |
| `clean-home` | Use disposable simulated user state |
| `pkg-install` | Run a package manager or system installer |
| `services` | Exercise a native daemon or service manager |
| `gui` | Exercise graphical or window-server behavior |
| `ios-simulator` | Request Xcode Simulator coverage in a supported remote venue |
| `network:domain` | Allow egress to one exact domain |
| `network:*.domain` | Allow egress to subdomains |
| `network:*` | Allow unrestricted egress |

Every npm, pip, Homebrew, apt, dnf, or system-installer command requires
`pkg-install`, including user-global installs. `fs-write` does not authorize
arbitrary host writes. Use `clean-home` when the test must own paths outside
the project workspace. Set `native: true` only when container semantics cannot
represent the behavior.

Declare the least privilege the workload needs. Never broaden networking to
make a route pass. If a backend cannot enforce the declared boundary, routing
fails closed.

### Source confidentiality

Read-only is not confidential. Tier 1 exposes the invocation directory to the
guest at `/workspace/source`. Before combining untrusted code with egress,
invoke ECC from a sanitized staging directory containing only required inputs.
Exclude `.env`, `.npmrc`, Git credentials and history, private keys, customer
data, and other secrets.

## Preview Before Review

From a trusted checkout:

```bash
ecc-sandbox run sandbox.yaml --dry-run
```

The JSON result names the route and reason without executing commands. Correct
the manifest or prerequisite if it does not make the intended claim. Do not
run a repository-local `ecc-sandbox` lookalike from an untrusted checkout.

## Direct Interactive Tier 1

Use the manifest-first path when the person needs to run arbitrary commands,
CLIs, or agents in the tailored environment while the outside agent monitors:

```bash
ecc-sandbox launch examples/sandbox/review-tier1-podman.yaml \
  --purpose "isolated backend feature behavior" \
  --terminal terminal.app
```

The first call returns the exact question, a `proposal_id`, and creates no run.
After the user answers `y`, repeat it with `--consent y --proposal
"$proposal_id"`. The returned JSON includes `run_id`, `result: launching`, and
a `listener` command. Treat the terminal as open only after that listener emits
`exploration.started`; then follow `exploration.output` while the user works.
If `exploration.launch.failed` appears instead, report that the selected
terminal did not check in. The listener terminates with the failed run and does
not hang.
Closing the shell removes the exact labeled container.

## Visible Reviews

Each accepted command below opens one visible terminal, verifies the expected
backend, streams live redacted output, and records a terminal replay. For Tier
1, first run the same command without `--consent` or `--proposal`, repeat the
returned prompt, and save its `proposal_id` as `proposal_id`.

An accepted review returns `result: launching` and `state: awaiting-ui`. Treat
the visible client as connected only after its listener emits `ui.ready`.

### Tier 0, SRT process boundary

```bash
ecc-sandbox review examples/sandbox/review-tier0-srt.yaml \
  --expect-backend srt --record > /tmp/ecc-tier0-review.json
```

The visible window must show SRT provisioning, both setup output lines two
seconds apart, the assertion, evidence sealing, and cleanup. Tier 0 verifies a
restricted process boundary around the host workspace. It is not a fresh home
or fresh operating system.

### Tier 1, rootless Podman clean user

```bash
ecc-sandbox review examples/sandbox/review-tier1-podman.yaml \
  --purpose "the Tier 1 clean-user review" --consent y \
  --proposal "$proposal_id" \
  --terminal terminal.app --local-only --expect-backend podman --record \
  > /tmp/ecc-tier1-review.json
```

The window must show image verification, container creation and readiness, the
same two-second workload, the clean-home assertion, and removal. The source is
mounted read-only. A passing report is Linux container evidence, not native
macOS or full-machine evidence.

To exercise a meaningful full Claude project install and immediate `doctor`
check, invoke this from the trusted ECC checkout whose installer should be
tested:

```bash
ecc-sandbox review examples/sandbox/review-tier1-claude-installer.yaml \
  --purpose "the full Claude project installer" --consent y \
  --proposal "$proposal_id" \
  --terminal terminal.app --local-only --expect-backend podman --record --no-pause
```

The fixture writes the project installation only inside the disposable
container. A pass requires zero doctor warnings or errors, complete Podman
layer-diff evidence, and successful container removal.

### Tier 2, Lume native macOS

```bash
ecc-sandbox review examples/sandbox/review-tier2-lume.yaml \
  --local-only --expect-backend lume --record \
  > /tmp/ecc-tier2-review.json
```

The window must show provisioning, guest readiness, the same workload, the
Darwin assertion, evidence sealing, cleanup start, and cleanup success. The
final report carries the detailed clone and seed notes. The seed stays stopped. Lume evidence is native
macOS VM evidence, but its seed is operator-managed local state rather than a
content-attested disk image.

### Host resource admission

For a local VM, preview current capacity before opening a review:

```bash
ecc-sandbox preflight examples/sandbox/review-tier2-codex.yaml --local-only
```

This creates no VM. It may compile the bundled COW helper and test cloning a
small disposable file. A ready snapshot does not reserve capacity: actual
execution checks before clone and again before boot, under a shared ECC VM
lease. Automated runs, fabric workers, and Lume exploration all use admission.

The macOS policy requires normal pressure and estimates available RAM from free
and speculative pages plus capped file-backed reclaim credit. It reserves the
larger of 4 GiB or 10% of host RAM, plus the larger of 1 GiB or 20% of requested
guest RAM for VM overhead. Inactive, purgeable, and compressed pages are not
added separately. Disk admission checks the pinned destination filesystem and
requires the larger of 10 GiB or guest RAM plus 4 GiB, plus clone cost. This is
scratch headroom, not a reservation for all future guest writes.

Lume 0.5.1 normally falls back to full copying if APFS cloning fails. ECC either
budgets the entire logical seed or uses its bundled, version-gated COW helper:
per-file `clonefile`, native source/destination locks, fresh machine and network
identities, no full-copy fallback, and cleanup limited to its own destination.
The helper requires Swift tools on the host. Unsupported versions, volumes, or
helper builds use conservative full-copy budgeting. No user bypass weakens the
host reserve or pressure checks.

Refusals produce an error report, human-readable advice, and `host_admissions`
receipts. Interactive journals also emit `resource.admission`. Initial refusal
creates no clone; refusal after cloning cleans the owned clone. Unknown, stale,
and unsupported probes fail closed. macOS is the currently supported host
probe; a native Linux Lima host is refused until it has a verified probe.
Other applications can change resource use after admission, and the guard does
not continuously monitor a running guest or constrain its disk growth. Stop an
active review if host pressure rises.

### Tier 2 Codex developer preset

`review-tier2-codex.yaml` is a reusable prepared-environment recipe for a
disposable Apple Silicon macOS development session with an explicit 2 CPU,
4 GiB lightweight preset. It prepares Apple Command Line Tools if absent, then
installs the current
Codex CLI through OpenAI's standalone installer, creates a local Git security
lab with intentional command-injection and path-traversal flaws, and verifies
the CLI and repository before interactive use. Setup is replayed inside each
fresh clone, so the trusted seed remains credential-free and the user does not
perform installation manually.

```bash
ecc-sandbox review examples/sandbox/review-tier2-codex.yaml \
  --terminal terminal.app --local-only --expect-backend lume \
  --record --no-pause > /tmp/ecc-tier2-codex-review.json

RUN_ID=$(jq -r .run_id /tmp/ecc-tier2-codex-review.json)
ecc-sandbox wait "$RUN_ID"
ecc-sandbox evaluate "$RUN_ID" --json
ecc-sandbox explore "$RUN_ID" --terminal terminal.app
```

The exploration replica opens a native Lume display and an interactive SSH
terminal in the disposable guest. The viewer can appear during boot; the shell
is offered only after every setup step succeeds. Setup failure is reported and
cleanup runs instead. Run `cd ~/security-lab && codex`, choose
Sign in with ChatGPT, and use the prompt in `README.md`. Host Codex credentials,
Git credentials, SSH keys, and API keys are never copied into the guest. Exit
the SSH shell when finished; the guardian stops the viewer and guest, deletes
the exact clone, and clears the resource receipt. Authentication created inside
the clone is destroyed with that clone, so retain the reported VM name if
cleanup ever returns an error and remove it before treating the credential as
discarded.

A requested native desktop requires an operator-prepared, credential-free seed
with macOS onboarding completed for its installed OS version and build. Verify
the disposable clone reaches the desktop before presenting a GUI-ready demo.
SSH access and successful CLI setup establish command-line readiness; a native
viewer may still display Setup Assistant or a login screen. Lume 0.5.1's
[unattended setup patcher](https://github.com/trycua/cua/blob/lume-v0.5.1/libs/lume/src/Unattended/MacOSOfflineSetupPatcher.swift#L250)
records fixed `26.5.2` / `25F84` onboarding markers, so newer guests can require
additional graphical onboarding even when the setup marker already exists.

If the requested desktop remains blocked, notify the user with the observed
screen, the verified CLI capabilities, and the required next step. For example:
"The CLI workspace is ready, but macOS is showing Setup Assistant. The requested
desktop is unavailable until onboarding is completed for this guest version."
Offer preparation of a suitable GUI-ready seed or an explicit CLI-only choice.
Keep the current result labeled as partially ready until the requested desktop
is verified; preserve normal ownership and cleanup for its disposable clone.

## Agent Listening Uses The Same Output

The JSON returned by `review` contains the run ID:

```bash
RUN_ID=$(jq -r .run_id /tmp/ecc-tier1-review.json)
ecc-sandbox listen "$RUN_ID" --follow --format jsonl
```

The selected terminal client and agent listener consume the same append-only,
sequence-numbered, redacted event journal. They see the same lifecycle and
output order. The listener exposes the complete event metadata; the compact UI
renders only the fields useful during live review. The UI never reads a backend
output stream directly, and an agent must not scrape the terminal pane or
backend logs.

Closing or disconnecting a listener changes no run state. Multiple read-only
listeners may attach. Every listener can replay prior events before following
new ones.

## Exact Manual Acceptance Checklist

Run this sequence once for each fixture. Replace `MANIFEST` and `BACKEND` with
`review-tier0-srt.yaml` plus `srt`, `review-tier1-podman.yaml` plus `podman`, or
`review-tier2-lume.yaml` plus `lume`:

```bash
sandbox_manifest=review-tier0-srt.yaml
sandbox_backend=srt
# Tier 1 values: review-tier1-podman.yaml and podman
# Tier 2 values: review-tier2-lume.yaml and lume
review_json=$(ecc-sandbox review "examples/sandbox/$sandbox_manifest" \
  --local-only --expect-backend "$sandbox_backend" --record)
sandbox_run_id=$(printf '%s\n' "$review_json" | jq -r .run_id)
sandbox_run_directory=$(printf '%s\n' "$review_json" | jq -r .run_directory)
printf 'run: %s\n' "$sandbox_run_id"

# In a second terminal, or in the agent's tool session:
ecc-sandbox listen "$sandbox_run_id" --follow --format jsonl
```

In the visible terminal window:

1. Confirm the header names the intended tier and backend.
2. At `ready-paused`, press `i`. Tier 0 must show its SRT policy; Tier 1 must
   show the exact container plus fixed inspect, top, and one-shot stats; Tier 2
   must show the exact clone through a host-side query.
3. Press Enter. Watch `review setup begin`, then `review setup end` two seconds
   later, followed by `review assertion`.
4. At `evidence-paused`, press `i` again. Confirm the sealed evidence summary
   and fixed post-evidence diagnostics.
5. Press Enter. Require `cleanup.completed` with `pass: true`, then
   `run.completed`.
6. Read the deterministic result:

```bash
ecc-sandbox wait "$sandbox_run_id"
ecc-sandbox evaluate "$sandbox_run_id" --json
```

For Tier 1, additionally require a clean `$HOME` of `/home/ecc`, a read-only
source mount, rootless Podman metadata, and no remaining run container. For
Tier 2, require Darwin output, the original seed still stopped, and no
remaining run clone. For Tier 0, require the checkout policy shown by
inspection and no owned process after cleanup.

Use these exact absence checks after `wait`:

```bash
# All tiers: the owned resource ledger must be empty.
test "$(jq '.resources // [] | length' \
  "$sandbox_run_directory/state.json")" -eq 0

# Tier 0: require the empty ownership ledger and successful cleanup event above.
# This receipt is cleared only after the owned process group is verified empty.

# Tier 1: the immutable ownership label must match no container.
test "$(podman ps --all --filter \
  "label=io.ecc.sandbox.run=$sandbox_run_id" --format '{{.ID}}' | wc -l | tr -d ' ')" -eq 0

# Tier 2: use the resource_name from resource.registered while the run is live.
! lume get "ecc-sandbox-lume-${sandbox_run_id#run_}" --format json
lume get "${ECC_SANDBOX_LUME_SEED:-ecc-sandbox-macos-seed}" --format json | jq -e \
  'if type == "array" then .[] else . end | select((.status // .state) == "stopped")'
```

To test closure behavior, repeat a run and close the terminal window at the
ready pause. Reattach within 15 seconds with `ecc-sandbox attach RUN_ID`; if you
do not reattach, require abort and exact cleanup. Closing only the agent
listener must not change the run.

## Verification And Exploration Stay Separate

Verification and exploration have deliberately different authority.

Automated verification commands run without a PTY and with closed stdin. User
keystrokes cannot become command input. A pause occurs only at a safe boundary,
never in the middle of a manifest command.

Use the window controls or equivalent CLI commands:

```bash
ecc-sandbox inspect "$RUN_ID"
ecc-sandbox continue "$RUN_ID"
ecc-sandbox wait "$RUN_ID"
ecc-sandbox evaluate "$RUN_ID" --json
ecc-sandbox stop "$RUN_ID"
```

`inspect` selects a fixed, read-only profile. Tier 0 can show the sanitized SRT
policy and owned process state. Tier 1 can show selected Podman metadata, top,
one-shot resource statistics, and sealed diff summary. Before evidence capture,
Tier 2 inspection stays host-side because logging into the guest can change its
filesystem. Fixed guest diagnostics become available after evidence is sealed
and remain in an inspection channel excluded from verification.

For arbitrary commands or a hands-on shell, create a separate exploration
replica when the user requests interaction or the agent has explained why a
visible terminal is useful:

```bash
ecc-sandbox explore "$RUN_ID"
```

The command returns a new exploration run ID. Its visible PTY output is
redacted into that run's journal, so the agent can listen without scraping the
terminal pane:

```bash
EXPLORATION_RUN_ID=$(ecc-sandbox explore "$RUN_ID" | jq -r .run_id)
ecc-sandbox listen "$EXPLORATION_RUN_ID" --follow --format jsonl
```

Hands-on exploration receives at least 30 minutes as a bounded human lease.
Setup commands keep the manifest timeout, so the command deadline remains
strict without prematurely closing the person's shell.

The replica has its own resource identity, output channel, guardian, and
cleanup lease. It replays setup first. SRT and Podman journal a failed setup as
a warning and still open the shell for inspection. Lume refuses the shell when
setup fails because the promised prepared native workspace is unavailable,
then cleans the owned clone. Exploration can never create, repair, or upgrade
passing verification evidence. Report its observations separately.

## Recording And Optional Video

`--record` writes `review.cast`, a terminal replay built from the same redacted
event frames used by the window and listener. It does not capture the host
screen, unrelated windows, notifications, raw backend output, or exploration
input.

Export an optional video after the run reaches a terminal state:

```bash
ecc-sandbox video "$RUN_ID" --format mp4
```

If the optional local renderer is unavailable, the cast remains valid evidence
and the video command returns an actionable capability error. `video.json`
records the video digest, size, renderer version, and that its source was the
redacted event journal.

## Window Closure And Cleanup

The terminal window is a client, not the lifecycle owner. If the window closes:

- Before its startup handshake, the run aborts without provisioning.
- Closing the window during an automated command lets it continue headlessly.
  An explicit `stop` terminates the owned process group, skips evidence, and
  proceeds directly to cleanup.
- At `ready-paused`, a short reattach grace expires into abort and cleanup.
- At `evidence-paused`, a short grace expires into report finalization and
  cleanup because evidence is already sealed.
- An exploration replica expires and cleans independently.

Reopen the visible client or inspect active runs with:

```bash
ecc-sandbox attach "$RUN_ID"
ecc-sandbox runs --active
ecc-sandbox gc
```

The supervisor and cleanup guardian use exact ownership receipts. SRT cleanup
binds to process identity, Podman cleanup binds to immutable container identity
and labels, and Lume cleanup binds to clone, launcher birth identity, and guest
marker. Cleanup never uses wildcard backend-wide deletion.

## Read Reports And Compare Real Performance

All machine interfaces emit JSON or documented JSONL. `wait` returns the
schema-valid final report; `evaluate` derives a deterministic assessment from
the journal, metrics, report, and cleanup result.

Read evidence in this order:

1. `result`, backend, tier, and `execution_mode`.
2. The first nonzero step and failed assertion.
3. Evidence completeness and cleanup state.
4. Any recorded escalation, of which there may be at most one.
5. Redaction, truncation, inspection, recording, and seed-trust notes.

`execution_mode: mock` proves adapter orchestration only. For installation
claims, require `install_diff.complete: true`. Tier 2 scans are bounded and
best effort, so they remain incomplete and must not support a complete-install
claim.

Performance metrics separate:

- `provision_ms`
- `ready_ms`
- `workload_ms`
- `evidence_ms`
- `cleanup_ms`
- `active_total_ms`
- `review_wait_ms`
- `wall_ms`

Compare `active_total_ms`; human review time belongs in `review_wait_ms`. For a
useful comparison, repeat each fixture at least three times without pauses,
compare medians, and report host state, backend versions, workload, sample
count, and whether a seed or image was already warm.

Use `--no-pause` for those benchmark samples. The terminal window and listener
still show the real run, but ready and evidence boundaries proceed
automatically:

```bash
ecc-sandbox review examples/sandbox/review-tier1-podman.yaml \
  --purpose "the Tier 1 performance sample" --consent y \
  --proposal "$proposal_id" \
  --local-only --expect-backend podman --record --no-pause
```

Use this copy-and-paste loop for one tier, then change the fixture and backend
for the other two:

```bash
sample_file=$(mktemp)
for sample in 1 2 3; do
  review_json=$(ecc-sandbox review examples/sandbox/review-tier1-podman.yaml \
    --purpose "the Tier 1 performance sample" --consent y \
    --proposal "$proposal_id" \
    --local-only --expect-backend podman --record --no-pause)
  run_id=$(printf '%s\n' "$review_json" | jq -r .run_id)
  ecc-sandbox wait "$run_id" >/dev/null
  ecc-sandbox evaluate "$run_id" --json | jq '{
    run_id, active_total_ms: .performance.active_total_ms,
    wall_ms: .performance.wall_ms, review_wait_ms: .performance.review_wait_ms
  }' >> "$sample_file"
done
jq -s 'sort_by(.active_total_ms) as $s |
  {samples: $s, median_active_total_ms: $s[1].active_total_ms}' "$sample_file"
```

`active_total_ms` includes scripted orchestration overhead as well as backend
work. Keep `wall_ms` and `review_wait_ms` in the record, but do not describe
either as sandbox execution time.

## Agent Surface And Evidence Limits

`skills/sandbox-testing/SKILL.md` teaches the same workflow to any agent with
file and shell access. It contains no model SDK calls. Claude's optional
failure hint may suggest this workflow, but it never runs a sandbox, changes
permissions, or widens a manifest.

Current evidence limits are explicit:

- Tier 0 uses host process isolation and cannot prove a fresh machine.
- Tier 1 is Linux container evidence. Its read-only source mount is not a
  confidentiality boundary.
- Tier 2 scans are partial and its local seed is operator trusted.
- Visible output is bounded and redacted; the journal records dropped bytes
  and redaction counts.
- Inspection is excluded from verification evidence and active workload time.
- Exploration is permanently non-evidence.
- A video is a review artifact, not stronger proof than its source journal and
  report.

## Acceptance Contract

Gate 1 is complete only when focused tests and one real run at each local tier
prove all of the following:

- Before visible Tier 1 provisioning, a fresh agent harness presents the
  purpose-specific environment summary and literal `y/n` consent prompt, does
  nothing on `n`, and launches only after `y`.
- Both WezTerm and macOS Terminal.app launch the same supervised user flow and
  honor the user's selection. Evidence for only one terminal is incomplete.
- No sandbox resource starts before the visible client emits `ui.ready`.
- `--expect-backend` rejects a mismatch before provisioning and never changes
  routing.
- Each supported terminal and an agent listener receive identical sequence numbers, redacted
  text, event ordering, and per-event hashes.
- Closing a listener never changes lifecycle state.
- Automated steps use closed stdin, no PTY, a filtered environment, and bounded
  streaming output.
- A user can pause only at a step or evidence boundary.
- Inspection uses a closed read-only profile and remains outside verification
  evidence and active workload time.
- Exploration uses a separate resource identity and can never produce passing
  verification evidence.
- `review.cast` contains only redacted journal frames. Optional video is
  reproducible from the same journal and contains no host-screen capture.
- `review_wait_ms` is excluded from `active_total_ms`.
- Closing the window at every lifecycle state follows the documented reattach,
  finalization, abort, and cleanup behavior.
- Supervisor and guardian crash tests leave no attributable process, rootless
  Podman container, Lume clone, launcher, or helper.
- The final report and deterministic evaluation disclose real versus mock
  execution, evidence completeness, cleanup result, redactions, truncation,
  recording provenance, and backend-specific trust limits.

## Finish

For each run, report the run ID, selected tier/backend, real versus mock mode,
result, first failure, evidence completeness, cleanup result, `active_total_ms`,
`review_wait_ms`, recording path, and any limitations. Then give only the next
manual action the user must take.
