---
name: sandbox-testing
description: Route installer, clean-user, untrusted-code, OS-native, and cross-platform tests through ECC's tiered sandbox CLI. Use when a test must behave like a fresh machine, write outside the workspace, install packages, start services, use a GUI or iOS Simulator, restrict network access, or prove behavior on Linux, macOS, or Windows.
---

# Sandbox Testing

Use ECC's manifest-driven CLI to choose the least expensive isolation venue
that satisfies a test. Declare needs; never select `srt`, Podman,
Microsandbox, Lume, Lima, Tart, or CI directly.

## Decide Whether To Sandbox

Write a manifest when the test changes a user home or system location, installs
software, needs a clean home, runs untrusted code, depends on native OS
behavior, or must cover another OS/architecture. Ordinary unit tests that stay
inside the checkout do not need this workflow.

## Write The Manifest

Create `sandbox.yaml` with only the closed contract below. Unknown keys and
capabilities are errors.

```yaml
name: install-my-tool
needs:
  os: [linux]
  arch: [arm64, x86_64] # optional; defaults to host arch
  capabilities:
    - clean-home
    - pkg-install
    - network:*
  trust: first-party
  native: false
resources:
  cpu: 2
  memory: 2GB
  timeout: 300
steps:
  setup:
    - npm install --global my-tool@1.2.3
  assert:
    - command -v my-tool
    - my-tool --version | grep -q '^1\.2\.3$'
report: install-diff
```

Use the smallest accurate needs:

| Need | Declare |
| --- | --- |
| Write inside the invocation workspace under Tier 0 | `fs-write` |
| A fresh simulated user home | `clean-home` |
| Package manager or system installer | `pkg-install` |
| Daemon, launchd, systemd, or registry | `services` |
| Graphical application or installer | `gui` |
| Xcode Simulator on a macOS CI runner | `ios-simulator` |
| One exact domain | `network:example.com` |
| Subdomains of one domain | `network:*.example.com` |
| Unrestricted egress | `network:*` |

Every install command that invokes npm, pip, Homebrew, apt, dnf, or another
package manager/system installer declares `pkg-install`, including user-global
installs that do not require root.

`os` accepts `linux`, `macos`, `windows`, `any`, or the sole value `all`.
Use `all` for a first-party native OS matrix and declare `network:*` because
hosted native runners cannot disable egress. `trust` is `first-party` or
`untrusted`. Set `native: true` only when a container cannot represent the
behavior. Setup and assertion lists must each contain at least one command.
Use `install-diff` when installed files matter and `exit-only` otherwise.

Do not add a network capability unless the commands need egress. Tier 1 v1
cannot enforce domain-only allowlists on its fallback container backends, so a
strict allowlist can correctly fail closed. Never broaden it silently to
`network:*`.

CI-native v1 accepts only `trust: first-party` plus explicit `network:*`.
Untrusted commands cannot use CI because they execute inside its evidence
boundary; keep them on a local hardened backend. The same rule applies to
Xcode Simulator coverage on the macOS runner.

`fs-write` never grants arbitrary host writes. To test paths outside the
project tree, also declare `clean-home` or `pkg-install` so routing selects a
disposable environment that owns those paths.

Read-only is not confidential: Tier 1 exposes the invocation directory to the
guest at `/workspace/source`. Before combining `trust: untrusted` with any
network capability, create a sanitized staging directory containing only the
test inputs, invoke ECC from that directory, and exclude `.env`, `.npmrc`, Git
credentials/history, private keys, and other secrets.

## Probe, Preview, Run

Resolve the CLI from trusted ECC content. In a trusted ECC source checkout use
`scripts/sandbox/ecc-sandbox`; an npm installation exposes the `ecc-sandbox`
command. A content-only managed install needs the runtime once:

```bash
npm install --global ecc-universal
```

Never execute a repository-local `ecc-sandbox` lookalike from an untrusted
checkout. From a trusted ECC checkout:

```bash
scripts/sandbox/ecc-sandbox probe --refresh
scripts/sandbox/ecc-sandbox run sandbox.yaml --dry-run
scripts/sandbox/ecc-sandbox run sandbox.yaml > sandbox-report.json
scripts/sandbox/ecc-sandbox report sandbox-report.json
```

The CLI writes JSON to stdout, including errors. Preserve that output for the
agent; do not scrape backend logs. A nonzero run status means the JSON report
must be inspected, not discarded. `--dry-run` validates and explains every
route without executing. Use `--local-only` only when remote CI is forbidden,
not as a shortcut around an unavailable target OS.

## Read The Report

Read fields in this order:

1. `result`: `pass` is success, `fail` is a command/assertion failure, and
   `error` is infrastructure, policy, cleanup, or incomplete-evidence failure.
2. For `backend: aggregate`, inspect every `children[]`; the aggregate uses the
   worst child result.
3. Find the first nonzero `steps[].exit`, then failed `assertions[]`. Use only
   the bounded `stdout_tail` and `stderr_tail` fields.
4. Read `escalations[]`. It records at most one automatic or manual reroute;
   never invent an unrecorded retry.
5. For installation claims, require `install_diff.complete: true`. Treat
   `method: scan` or `complete: false` as partial evidence and state that
   limitation.
6. Treat `execution_mode: mock` as adapter-contract evidence, never real
   isolation evidence. Read `notes[]` for degraded isolation, missing setup,
   cleanup, network, or scan limitations.

If the CLI returns `{ "result": "error", "error": ... }` instead of a report,
fix the manifest or prerequisite named by `error.message`; do not interpret it
as a test failure.

## Escalation Semantics

Routing normally starts at the cheapest eligible venue. A recognized SRT
installer/system-write denial may rerun once at Tier 1. A recognized container
native-OS failure may reroute once to a local VM or CI only when the failed
command and output jointly match a known signature and Tier 1 cleanup passed.
The CI attempt runs the unchanged manifest on its native hosted runner. The
final report must contain the single transition in `escalations`. That
one-escalation budget is shared by all shards in the run.

Do not weaken host permissions or retry manually after an isolation denial.
Correct the declared needs and preview again. If an eligible Tier 0 report was
saved before automatic escalation, use:

```bash
scripts/sandbox/ecc-sandbox escalate sandbox-report.json
```

This consumes the existing report and executes only the destination attempt.
A second escalation is deliberately rejected.

## Cost Expectations

| Venue | Typical latency | Use |
| --- | --- | --- |
| Tier 0 process sandbox | milliseconds | scripts and feature probes |
| Tier 1 ephemeral Linux | seconds | clean-user installs and untrusted code |
| Tier 2 local VM | tens of seconds to minutes | explicit native OS behavior |
| Hosted CI matrix | minutes | unavailable OS/arch and iOS Simulator |

Tier 0 and Tier 1 should handle most work. Tier 2 and CI require explicit
native or OS needs. Local backends are free/open-source defaults; hosted runner
billing follows the repository's GitHub plan. If optional Tart is selected,
preserve its Fair Source license notice in the result.

## Finish

Report the selected backend/tier, real versus mock execution, result, first
failing command or assertion, recorded escalation, install-diff completeness,
and actionable notes. Do not claim clean-machine, native, or cross-platform
coverage that the report does not prove.
