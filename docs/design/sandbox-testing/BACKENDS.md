# Sandbox Backend Recon

Verified against official upstream material on 2026-08-08.

| Backend | License and maturity | v1 contract |
| --- | --- | --- |
| [SRT](https://github.com/anthropic-experimental/sandbox-runtime) | Apache-2.0; beta research preview | macOS Seatbelt, Linux bubblewrap, Windows alpha WFP/ACL support. ECC owns heuristic denial classification because SRT preserves child exit status. Nested-container mode is explicitly weaker. |
| [Podman](https://github.com/containers/podman) | Apache-2.0; mature | Native Linux containers; macOS/Windows use a Podman machine. Use rootless create/start/diff/remove lifecycle. Diff reports filesystem paths only; v1 network policy is none or unrestricted. |
| [Microsandbox](https://github.com/superradcompany/microsandbox) | Apache-2.0; beta | Current repository moved from earlier organizations. Its current README lists OCI images on Apple Silicon macOS, KVM Linux, and WHP Windows. [Disk snapshots](https://docs.microsandbox.dev/changelog/2026-05-15) can seed fresh independent runs; they do not capture memory and there is no documented filesystem diff. |
| [Lume](https://github.com/trycua/cua/tree/main/libs/lume) | MIT; active | Apple Silicon macOS 13+ host. Pull a versioned seed, clone per run, execute headlessly over its CLI/SSH surface, then delete. Respect the two-concurrent-macOS-guest limit. |
| [Lima](https://github.com/lima-vm/lima) | Apache-2.0; CNCF Incubating | Linux guests on macOS/Linux hosts. Disable default host-home mounts for clean-user fidelity; clone/snapshot only through supported CLI operations. |
| [Tart](https://github.com/openai/tart) | Fair Source 100; not OSI open source | Optional Apple Silicon macOS backend only when already installed. Emit the license notice on selection; never recommend it as the free/open default. |
| [dockur/windows](https://github.com/dockur/windows) | MIT wrapper; Windows guest licensing is separate | Detection-only/experimental in v1 because it needs Linux KVM or nested virtualization, elevated networking devices/capabilities, and large disk images. Prefer native Windows Sandbox or CI. |
| [GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners) | Hosted service; public-repository usage is free | Terminal fallback for unavailable OSes. Use explicit runner mapping, record actual image/architecture, treat iOS as Xcode Simulator coverage, and never claim physical-device coverage. |

## Current API corrections

- `workflow_dispatch` cannot be exercised end to end until the workflow exists
  on the default branch. Pre-merge tests use adapter mocks and direct reusable
  logic; hosted dispatch evidence is a post-merge gate.
- CI dispatch includes a unique correlation input. The adapter resolves the
  exact run before `gh run watch --exit-status` and artifact download.
- macOS/Linux VM scan diffs are best-effort system-tool normalization and must
  report `method: scan` plus completeness notes. They are not equivalent to
  Podman layer diffs.
- `ios-simulator` must be expressible as a capability or target; an `os: macos`
  request alone does not declare simulator needs.
