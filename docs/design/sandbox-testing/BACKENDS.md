# Sandbox Backend Recon

Verified against official upstream material on 2026-08-08.

| Backend | License and maturity | v1 contract |
| --- | --- | --- |
| [SRT](https://github.com/anthropic-experimental/sandbox-runtime) | Apache-2.0; beta research preview; current npm release requires Node.js 20.11+ | macOS Seatbelt, Linux bubblewrap, Windows alpha WFP/ACL support. Windows also needs the one-time elevated `windows-install` provisioning step. ECC owns heuristic denial classification because SRT preserves child exit status. Nested-container mode is explicitly weaker. |
| [Podman](https://github.com/containers/podman) | Apache-2.0; mature | Native Linux containers; macOS/Windows use a Podman machine. Use rootless create/start/diff/remove lifecycle. Diff reports filesystem paths only; v1 network policy is none or unrestricted. |
| [Microsandbox](https://github.com/superradcompany/microsandbox) | Apache-2.0; beta | ECC pins CLI v0.6.8 and requires `msb doctor` to pass. Its OCI-backed disk snapshots seed fresh independent writable runs; they do not capture memory and v0.6.8 exposes no filesystem-diff API. |
| [Lume](https://github.com/trycua/cua/tree/main/libs/lume) | MIT; active | Apple Silicon macOS 13+ host. Pull a versioned seed, clone per run, execute headlessly over its CLI/SSH surface, then delete. Respect the two-concurrent-macOS-guest limit. |
| [Lima](https://github.com/lima-vm/lima) | Apache-2.0; CNCF Incubating | Linux guests on macOS/Linux hosts. Disable default host-home mounts for clean-user fidelity; clone/snapshot only through supported CLI operations. |
| [Tart](https://github.com/openai/tart) | Fair Source 100; not OSI open source | Optional Apple Silicon macOS backend only when already installed. Emit the license notice on selection; never recommend it as the free/open default. |
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
  Podman layer diffs.
- `ios-simulator` must be expressible as a capability or target; an `os: macos`
  request alone does not declare simulator needs.
- Current SRT settings use `strictAllowlist: true` for requested domains. Its
  allowlist accepts domain patterns but not a bare `*`, so `network:*` starts at
  Tier 1 instead of claiming SRT can provide unrestricted egress.
