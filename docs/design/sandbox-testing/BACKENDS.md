# Sandbox Backend Recon

Verified against official upstream material on 2026-08-08.

| Backend | License and maturity | v1 contract |
| --- | --- | --- |
| [SRT](https://github.com/anthropic-experimental/sandbox-runtime) | Apache-2.0; beta research preview; current npm release requires Node.js 20.11+ | macOS Seatbelt, Linux bubblewrap, Windows alpha WFP/ACL support. Windows also needs the one-time elevated `windows-install` provisioning step. ECC owns heuristic denial classification because SRT preserves child exit status. Nested-container mode is explicitly weaker. |
| [Podman](https://github.com/containers/podman) | Apache-2.0; mature | Native Linux containers; macOS/Windows use a Podman machine. Use rootless create/start/diff/remove lifecycle. Diff reports filesystem paths only; v1 network policy is none or unrestricted. |
| [Microsandbox](https://github.com/superradcompany/microsandbox) | Apache-2.0; beta | ECC pins CLI v0.6.8 and requires `msb doctor` to pass. Its OCI-backed disk snapshots seed fresh independent writable runs; they do not capture memory and v0.6.8 exposes no filesystem-diff API. |
| [Lume](https://github.com/trycua/cua/tree/main/libs/lume) | MIT; active; adapter pinned to 0.5.1 | Apple Silicon macOS 13+ host. Create one stopped unattended Tahoe seed from an Apple IPSW, clone per run, execute without a display over its CLI/SSH surface, then delete. Respect the two-concurrent-macOS-guest limit. |
| [Lima](https://github.com/lima-vm/lima) | Apache-2.0; CNCF Incubating; adapter pinned to 2.2.0 | Linux guests on macOS/Linux hosts. Create the stopped seed with `--plain`, clone with `--mount-none`, and use only supported CLI lifecycle operations. |
| [Tart](https://github.com/cirruslabs/tart) | Fair Source 100; not OSI open source; optional adapter pinned to 2.32.1 | Apple Silicon macOS backend only when already installed. Clone a stopped `macos-tahoe-base` seed, run headlessly, execute through Tart Guest Agent, and delete. Emit the license notice on selection; never recommend installing it. |
| [dockur/windows](https://github.com/dockur/windows) | MIT wrapper; Windows guest licensing is separate | Detection-only/experimental in v1 because it needs Linux KVM or nested virtualization, elevated networking devices/capabilities, and large disk images. Prefer native Windows Sandbox or CI. |
| [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) | Hosted service; public-repository usage is free | Terminal fallback for unavailable OSes. Use explicit runner mapping, record actual image/architecture, treat iOS as Xcode Simulator coverage, and never claim physical-device coverage. |

## Current API corrections

- `workflow_dispatch` cannot be exercised end to end until the workflow exists
  on the default branch. Pre-merge tests use adapter mocks and direct reusable
  logic; the pull-request trigger supplies real native-runner and Linux-side
  aggregation evidence before merge, while hosted dispatch remains a post-merge
  gate.
- CI dispatch includes a unique correlation input. The adapter resolves the
  exact run before `gh run watch --exit-status` and artifact download.
- Authenticate the adapter once with `gh auth login`, then verify it with
  `gh auth status --hostname github.com`. The probe reports CI unavailable and
  the router prints this exact remediation when authentication is missing.
- Current explicit hosted mappings are `ubuntu-latest` (Linux x86_64),
  `ubuntu-24.04-arm` (Linux arm64), `macos-15-intel` (macOS x86_64),
  `macos-latest` (macOS arm64), `windows-latest` (Windows x86_64), and
  `windows-11-arm` (Windows arm64). The workflow verifies the observed runner
  OS and architecture before execution so mutable labels cannot silently run
  the wrong shard.
- macOS/Linux VM scan diffs are best-effort system-tool normalization and must
  report `method: scan` plus completeness notes. They are not equivalent to
  Podman layer diffs. Fixed system-tool paths bypass login-profile/PATH changes;
  malformed records make the run an error, while a bounded truncation remains
  explicit partial evidence. The macOS scan excludes volatile per-user
  `Library` content except `LaunchAgents`, while retaining other home files.
- Lume 0.5.1 could not reconstruct the current 300-part
  `macos-tahoe-cua:26.5.2` OCI image during the Phase 7 gate. The supported v1
  bootstrap is `lume create <seed> --os macos --ipsw latest --unattended tahoe
  --cpu 4 --memory 8GB --disk-size 80GB --no-display`; an operator may resolve
  `lume ipsw` and verify/download that Apple IPSW separately when resumability
  is required. ECC then reuses the stopped local seed and does not download an
  OS during normal runs.
- Local VM seeds are operator-trusted stopped state, not content-attested disk
  images. Tagged backend JSON must match guest OS/architecture before clone,
  and reports name the remaining boundary. Lima also requires Linux,
  architecture, and `plain: true`, then reasserts `--plain` and `--mount-none`
  on every child before it starts.
- Lume and Tart share a stale-owner-aware ECC lifecycle lock and count both
  backends' running guests. This serializes ECC macOS VM starts and avoids a
  cross-tool race against Apple's two-running-guest ceiling. Lock acquisition
  is an atomic prepared-directory rename; stale locks fail closed with an exact
  manual recovery path rather than risking concurrent automatic takeover.
- Lume runs display-free under an ECC-owned launcher. Cleanup verifies the
  launcher's birth timestamp and unique clone command, freezes it, recursively
  snapshots descendants by parentage, and binds every helper to PID, birth
  time, and exact command before signaling it. This covers Foundation helpers
  that create their own process groups without letting a recycled numeric PID
  target an unrelated process. Before manifest commands, the adapter records
  the clone's guest address and requires a helper-free stabilization barrier;
  that marker also finds the known VNC-config SSH helper after reparenting.
- Tier 2 adapters configure requested CPU and memory but v1 cannot enforce
  per-domain network policy. Lume, Lima, and Tart are eligible only when the
  manifest explicitly authorizes `network:*`; otherwise routing fails closed
  before a VM starts. Tart's host-only mode exists at the adapter boundary but
  is not claimed as complete no-network isolation.
- Windows Sandbox and Hyper-V are detection plus CI redirect in v1. Their
  local lifecycle and diff surfaces were not sufficiently portable to ship as
  trustworthy adapters; `gh auth login` enables the supported Windows venue.
- `ios-simulator` must be expressible as a capability or target; an `os: macos`
  request alone does not declare simulator needs.
- Current SRT settings use `strictAllowlist: true` for requested domains. Its
  allowlist accepts domain patterns but not a bare `*`, so `network:*` starts at
  Tier 1 instead of claiming SRT can provide unrestricted egress.
