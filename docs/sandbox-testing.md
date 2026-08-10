# ECC Sandbox Testing

## Purpose

ECC sandbox testing lets an agent reproduce installation and user-facing flows
without assuming the developer's real home, tools, or operating system state.
The interface is a strict YAML manifest plus JSON CLI output, so Claude Code,
Codex, OpenCode, Kimi, Cursor, and human scripts use the same contract.

The agent declares needs, never a backend. The router selects the first eligible
venue and can record at most one runtime escalation.

## Venue Model

| Venue | Default backend | Best for | Expected cost |
| --- | --- | --- | --- |
| Tier 0 | SRT | restricted processes and feature probes | milliseconds |
| Tier 1 | rootless Podman | Linux clean-user installs | seconds |
| Tier 1 hardened | Microsandbox | untrusted code or open network | seconds |
| Tier 2 | Lume, Lima, optional Tart | native local OS semantics | tens of seconds to minutes |
| CI | GitHub-hosted native runners | unavailable OS/arch, Windows, iOS Simulator | minutes |

Docker is a detected fallback only. ECC never requires Docker Desktop.
Windows local VM backends are detected in v1 but redirect to CI rather than
claiming incomplete local support. Tart is optional and, when selected, emits
its Fair Source license notice.

## Quick Start

From a trusted ECC checkout:

```bash
scripts/sandbox/ecc-sandbox probe --refresh
scripts/sandbox/ecc-sandbox run examples/sandbox/install-ecc-clean-user.yaml --dry-run
scripts/sandbox/ecc-sandbox run examples/sandbox/install-ecc-clean-user.yaml > sandbox-report.json
scripts/sandbox/ecc-sandbox report sandbox-report.json
```

The demo runs the current checkout's minimal Codex installer in an ephemeral
Linux home, asserts its managed install state and sandbox skill, records the
layer diff, and destroys the container. `/workspace/source` is the read-only
checkout mount inside Tier 1.

All CLI output is JSON. A run exits 0 for `pass`, 1 for `fail`, and 2 for
`error`; redirect stdout even when capturing a nonzero run so the report is not
lost.

An npm installation also exposes `ecc-sandbox` as a binary. ECC managed
content installs copy the skill but not its Node runtime dependencies; install
the trusted runtime once with `npm install --global ecc-universal`. Never run a
repository-local `ecc-sandbox` lookalike from an untrusted checkout. The npm
package includes the matrix workflow as a template, but CI works only after
the target repository checks that workflow in.

## Manifest Contract

The canonical schema is
[`schemas/sandbox-manifest.schema.json`](../schemas/sandbox-manifest.schema.json).
Unknown keys fail validation.

```yaml
name: install-my-plugin
needs:
  os: [linux]
  arch: [arm64, x86_64]
  capabilities:
    - fs-write
    - pkg-install
    - network:npmjs.org
  trust: first-party
  native: false
resources:
  cpu: 2
  memory: 2GB
  timeout: 300
steps:
  setup:
    - npm install --global my-plugin@1.0.0
  assert:
    - command -v my-plugin
report: install-diff
```

### Capability Vocabulary

| Capability | Meaning |
| --- | --- |
| `fs-write` | write inside the invocation workspace under Tier 0 |
| `clean-home` | disposable simulated user home |
| `pkg-install` | package manager or system installer |
| `services` | daemons, launchd, systemd, or registry |
| `gui` | graphical app or installer |
| `ios-simulator` | Xcode Simulator on macOS CI |
| `network:domain` | egress to one exact domain |
| `network:*.domain` | egress to subdomains |
| `network:*` | unrestricted egress |

The vocabulary is closed. `os` values are `linux`, `macos`, `windows`, `any`,
or the sole value `all`; `arch` values are `arm64` and `x86_64`. `trust` is
`first-party` or `untrusted`. `native: true` requires Tier 2 or CI. Resource
memory uses whole `MB` or `GB` units and timeout is seconds.

Every npm, pip, Homebrew, apt, dnf, or other package-manager/system-installer
command requires `pkg-install`, including user-global installs without root.

`fs-write` does not authorize arbitrary writes elsewhere on the host. A test
that needs paths outside the project tree must also declare `clean-home` or
`pkg-install` so the router chooses a disposable environment that owns those
paths.

Declare the least privilege the test actually needs. Tier 1 v1 cannot enforce
domain-only allowlists on Podman/Docker, so those routes fail closed rather
than silently widening egress. Local Tier 2 v1 is eligible only when the
manifest explicitly permits `network:*`, because guest egress cannot yet be
disabled reliably.

CI-native v1 likewise requires `trust: first-party` and explicit `network:*`:
hosted runners cannot preserve disabled or domain-only egress, and untrusted
commands execute inside the runner's evidence boundary. Keep untrusted work on
a local hardened backend. This restriction also covers `os: all` and
`ios-simulator`; never add open network merely to force a route.

### Source Mount Confidentiality

Read-only prevents guest writes; it does not prevent reads. Tier 1 mounts the
entire invocation directory at `/workspace/source`, so code in the guest can
read every file there. Before running untrusted code with any network
capability, invoke ECC from a sanitized staging directory that contains only
the required test inputs. Do not stage `.env`, `.npmrc`, Git credentials or
history, private keys, customer data, or other secrets. If the checkout cannot
be sanitized, keep networking disabled.

## Routing And Escalation

The table-driven router applies this order:

1. SRT for non-native host-OS work without package installs, services, or GUI.
2. Linux Tier 1 when a container can satisfy the needs. Untrusted code or open
   network prefers Microsandbox and may fall back to a reported degraded
   rootless container when policy permits.
3. A matching local Tier 2 VM for explicit native behavior.
4. CI for `os: all` or a target unavailable locally.

`--dry-run` returns each route and its reason without executing it. An SRT
installer/system-write denial can rerun once at Tier 1. A recognized container
native-OS failure can reroute once to Tier 2 or CI only when the failed command
and output jointly match a known signature and Tier 1 cleanup succeeded. CI
then runs the unchanged manifest on its native hosted runner. The final report
records the transition in `escalations`; a second escalation is rejected.
The one-escalation budget is global across every shard in the run.
Remote CI reports are accepted only when their canonical manifest digest,
command prefix, assertion mapping, target, and execution mode match the
dispatch; multi-shard results remain one flat aggregate.

If an eligible SRT denial report was saved without automatic escalation:

```bash
scripts/sandbox/ecc-sandbox escalate sandbox-report.json
```

Never answer a denial by disabling the original host sandbox or broadening
permissions silently. Update the manifest needs and preview the route.

## Reading Reports

The canonical schema is
[`schemas/sandbox-report.schema.json`](../schemas/sandbox-report.schema.json).
Every backend normalizes into the same fields.

- `result: pass` proves all recorded steps and assertions passed.
- `result: fail` means a test command or assertion failed.
- `result: error` means infrastructure, policy, cleanup, or evidence failed.
- `execution_mode: mock` proves adapter orchestration only, not isolation.
- `steps` contain bounded output tails and integer exit codes.
- `assertions` identify each passing or failing assertion.
- `install_diff.complete: true` is required for a complete installation claim.
- `install_diff.method: scan` is best-effort Tier 2 evidence and remains
  incomplete by design.
- `notes` carry setup commands, degraded isolation, network constraints,
  partial scans, and cleanup details.
- `backend: aggregate` contains normalized `children` and reports the worst
  child result.

The `report` subcommand validates an existing report and returns its result:

```bash
scripts/sandbox/ecc-sandbox report sandbox-report.json
```

CLI contract errors use `{ "result": "error", "error": { ... } }`; they are
not schema-valid run reports. Fix the explicit manifest/prerequisite error and
retry the dry run.

## Backend Setup

Probe output reports availability and a one-command fix where possible:

```bash
scripts/sandbox/ecc-sandbox probe --refresh
```

Common setup:

```bash
# macOS
brew install podman
podman machine init
podman machine start

# GitHub CI adapter
gh auth login
```

Do not install Docker Desktop for this workflow. Images use digest-pinned base
references from `images/sandbox/`. Microsandbox, Lume, Lima, and Tart have
exact CLI version gates; follow the probe's reported fix rather than installing
an arbitrary latest version.

For Lume on Apple Silicon, create one stopped SSH-ready seed with the supported
IPSW path shown by the probe. ECC clones and deletes a child for each run. Apple
permits at most two concurrent macOS VMs. The current large OCI Tahoe image is
not the supported seed path because Lume 0.5.1 cannot reconstruct it reliably.

CI requires an authenticated `gh` CLI and the checked-in
`.github/workflows/sandbox-matrix.yml`. Hosted macOS provides Xcode Simulator;
there is no separate iOS guest backend. CI manifests must be first-party and
explicitly accept runner egress with `network:*`. Public-repository runner
usage is free; private-repository billing follows the GitHub plan.

## Optional Hook And Agent Skill

`skills/sandbox-testing/SKILL.md` teaches any file-and-shell-capable agent the
same workflow. It contains no model SDK calls.

Claude Code installations also receive an optional, non-blocking
`PostToolUseFailure` hint. When a failed Bash result matches a high-confidence
sandbox denial, it suggests writing a manifest or reading the existing JSON
report. It never executes a rerun, changes permissions, or substitutes for the
router. Other harnesses do not need the hook; they invoke the CLI directly.

## Limits

- No custom hypervisor, namespace, or diff engine ships in ECC.
- No macOS guests run on non-Apple hosts.
- Tier 1 strict per-domain filtering fails closed when unavailable.
- Tier 1 source mounts are read-only, not confidential; sanitize before
  combining untrusted code with egress.
- Tier 2 scans are bounded, best effort, and marked incomplete.
- CI native runners are disposable but not blank base machines.
- V1 has no GUI automation or screenshot capture.
