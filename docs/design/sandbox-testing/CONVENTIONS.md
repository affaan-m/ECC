# Sandbox Testing Conventions

Phase 0 records the repository conventions the tiered sandbox implementation
must mirror.

## Repository shape

- Use Node.js 18+ CommonJS for CLI and library code. Entrypoints use
  `#!/usr/bin/env node`, files normally use `'use strict'`, focused logic lives
  under `scripts/lib/` or the feature directory, and direct-run files export
  pure functions behind a `require.main === module` guard.
- Parse arguments explicitly, reject unknown arguments, print actionable
  `Error: ...` messages to stderr, and use non-zero exit codes. Machine output
  is formatted JSON on stdout with no human decoration.
- Spawn subprocesses with argv arrays, `shell: false`, finite timeouts, bounded
  buffers, and explicit environment handling.
- Use AJV with checked-in JSON Schema files and `additionalProperties: false`
  at every public object boundary.
- Add an exact direct YAML parser dependency. A transitive parser is not a
  supported public contract.
- Tests are dependency-light CommonJS files discovered as
  `tests/**/*.test.js`. They use Node `assert`, print `Passed:` and `Failed:`
  totals, and exercise subprocess boundaries with temporary directories.
- Skills use YAML frontmatter with `name` and a trigger-oriented `description`,
  then concise operational Markdown. `skills/` is the canonical workflow
  surface; no command shim is needed for this standalone CLI. Register the
  skill in `manifests/install-modules.json` and refresh the generated catalog.
- Hook declarations live in `hooks/hooks.json`, carry stable `id` and
  `description` fields, and invoke bounded scripts through the existing plugin
  root bootstrap. A sandbox-denial hook may suggest a manifest/escalation but
  must never execute a sandbox run automatically.
- Workflows pin actions by full SHA, use `contents: read`, disable persisted
  checkout credentials, set job timeouts, install with
  `npm ci --ignore-scripts`, and avoid shared caches.
- User documentation belongs under `docs/`; implementation decisions and
  evidence belong under `docs/design/sandbox-testing/`.

## Docker PR salvage boundary

PR #2625 is the predecessor. Phase 0 began on its clean head; after that PR
merged, the sandbox phase commits were rebased onto current `main` before the
hosted probe gate.
Retain its pinned Debian/Ubuntu image inputs, non-root uid/gid 1000 execution,
read-only source mounts, private tmpfs workspaces, offline package preparation,
bounded subprocesses, path confinement, network-off defaults, and truthful
Linux-only claims.

Move reusable base-image definitions and setup into `images/sandbox/`. Replace
Docker Compose lifecycle and Docker-specific `exec` plans with Podman adapter
calls. Do not carry Docker-daemon assumptions, Docker install guidance,
cross-OS simulation claims, named interactive container lifecycle, or the
generic `docker-patterns` ownership of this new workflow.

## Contract decisions required before adapters

The supplied plan contains a few conflicting requirements. The implementation
uses these decisions to preserve its stated safety and fidelity goals:

1. Routing produces an execution plan of target shards, not one backend.
   `any` normalizes to the host OS; `all` expands to Linux, macOS, and Windows;
   explicit OS/architecture lists fan out deterministically.
2. `services` means native service managers/registry and therefore routes to a
   native VM or CI, like `gui` and `native: true`. A rootless Linux container
   is not evidence for launchd, Windows registry, or host systemd behavior.
3. Multi-target results use an aggregate report with child reports. A single
   report schema cannot truthfully represent three backends/OSes in scalar
   `backend`, `tier`, `os`, and `arch` fields.
4. A microsandbox-to-Podman fallback is reported as degraded isolation. It is
   never silent, and routing still defaults network to disabled unless the
   manifest asks for it.
5. The escalation acceptance fixture starts with a manifest that does not
   declare `pkg-install` and then encounters an installer/system-write denial.
   A manifest that declares `pkg-install` correctly routes directly to Tier 1
   and cannot demonstrate Tier 0 escalation.
6. Normal runs never `podman commit` an untrusted container. Snapshot image
   publication is a separate maintainer operation; runs inspect the diff and
   destroy the container.
7. Adapter diagnostics go to stderr. The CLI's stdout contract is exactly one
   JSON document, including for errors and `--dry-run`.
8. `clean-home` is part of the closed capability vocabulary. It means the test
   must not see the host user's installed software, home state, or PATH and
   therefore routes to Tier 1 or above. SRT is isolation around host state, not
   a clean-machine simulator.
9. A strict Tier 1 domain allowlist requires a backend that enforces host-level
   egress policy. It selects Microsandbox when available; otherwise routing
   fails with an actionable error. Podman v1 supports network disabled or
   unrestricted only and cannot be reported as satisfying a domain allowlist.
10. Podman execution is `create`, `start` or `exec`, `diff`, then explicit
    `rm`. `run --rm` cannot preserve a stopped container for diff evidence.
11. Microsandbox snapshots are disk-only. They accelerate repeated pristine
    starts but do not preserve memory, processes, or network state.
12. Windows Sandbox CLI is the preferred local Windows v1 adapter when its
    current Windows edition/version requirements are met. Hyper-V and
    dockur/windows remain detected fallbacks or CI redirects.
13. Mutable GitHub runner labels and images are recorded as observed runtime
    facts. CI is a fresh hosted VM with many preinstalled developer tools, not
    a blank consumer machine.
14. A native Linux request may use Lima from a macOS or Linux host when its
    probed architecture matches. This is a locally available real Linux guest,
    even though the host family differs; it preserves the Tier 2 purpose more
    faithfully than a remote CI redirect.
15. `fs-write` grants Tier 0 writes only inside the invocation working
    directory. The v1 manifest has no path-valued write capability, so allowing
    arbitrary host paths would overgrant every request. Tests that need a
    broader or clean filesystem route to Tier 1 or declare native needs.
16. Tier 0 re-allows reads in the invocation working directory but denies the
    rest of the current user's home and passes only a minimal locale, terminal,
    temporary-directory, system-root, and executable-search environment
    allowlist. The v1 manifest has no secret-injection or host-home-read
    capability, so inheriting the host environment would silently expose
    undeclared authority to first-party or untrusted commands.
17. `network:*` skips SRT and starts at Tier 1. Current SRT accepts explicit
    domain patterns but deliberately rejects a bare wildcard in
    `allowedDomains`, so it cannot truthfully satisfy unrestricted egress.
18. Every report identifies `execution_mode` as `real` or `mock`; aggregate
    reports use `mixed` when their children differ. Mock reports remain useful
    adapter-contract evidence, but cannot be mistaken for isolation evidence.
19. On Windows, ECC resolves npm's `srt.cmd` only from absolute `PATH`
    directories outside the tested workspace. Manifest commands are stored in
    private temporary scripts that SRT may read but the sandbox may not write,
    so neither repository shim lookup nor an outer `cmd.exe` parses untrusted
    manifest text before isolation starts.
20. Tier 1 mounts the invocation directory read-only at `/workspace/source`
    and gives the test an otherwise disposable container filesystem rooted at
    `/workspace`. Reports record both the requested image reference and its
    inspected content ID so a mutable local tag cannot hide the snapshot that
    actually ran.
21. Every Podman run verifies rootless mode immediately before image creation,
    drops all Linux capabilities, bounds processes/CPU/memory, and keeps the
    source mount read-only. First-party tests retain passwordless `sudo` only
    inside that rootless user namespace so package installers behave normally;
    untrusted Podman fallback additionally enables `no-new-privileges` and is
    explicitly reported as degraded from the preferred Microsandbox backend.
22. Layer-diff reports include directory entries and cap every normalized list
    at 1,000 paths. Executable and top-level home dotfile classifications include
    deleted paths; `services_registered` includes only added/changed services,
    while removed services remain explicit in `files_deleted`. Malformed or
    truncated install evidence makes an `install-diff` run an error, never a
    passing partial report.
23. The hardened Tier 1 adapter pins the Microsandbox CLI contract to v0.6.8,
    requires both the exact version and a passing `msb doctor`, and invokes the
    CLI rather than its Node SDK so ECC retains its Node 18 baseline. Its reuse
    primitive is an integrity-checked disk snapshot whose recorded manifest
    digest matches the requested platform manifest, not a live memory fork.
24. An eligible SRT installer/system-write denial permits exactly one Tier 1
    rerun. The final report contains the destination steps, one escalation
    record, the combined duration, and bounded initial-denial evidence in
    `notes`. For `os: any`, the rerun may move from the host process to Linux;
    the manual `escalate` command consumes the prior report without rerunning
    SRT.
25. A Microsandbox startup failure may fall back only to another eligible Tier
    1 backend and must report degraded isolation. Strict domain allowlists fail
    closed because Podman and Docker cannot satisfy them. Microsandbox v0.6.8
    exposes no filesystem-diff API, so its report uses the truthful incomplete
    `install_diff.method: none` contract.
26. `ci-native` is available only when the checked-in matrix workflow sets an
    explicit gate on a GitHub-hosted runner. It represents the terminal CI
    venue (`tier: 3`), runs native commands on that disposable VM, strips
    credential-like environment variables, and never claims the preinstalled
    runner is a blank machine. V1 enforces command timeout but cannot enforce
    CPU, memory, install-diff, or egress isolation on this direct native path.
27. Remote CI artifacts are correlated to one dispatch, bounded, schema
    validated, and matched one-to-one to the requested OS/architecture shards.
    Missing, duplicate, substituted, nested-too-deep, or symbolic-link reports
    fail closed. A Linux verification job independently assembles the same
    normalized aggregate used by the CLI; its artifact name stays outside the
    adapter's per-shard download pattern.

The plan explicitly delegates uncovered decisions to the free, lightweight,
harness-agnostic option. Items 1, 2, 5, 8, 9, 15, 16, 17, 18, and 19 resolve
internal contract contradictions or a missing clean-machine, write-scope, or
evidence-integrity need and are therefore treated as that delegated authority.
Items 20-27 record the corresponding Tier 1 containment, escalation, hardened
backend, CI-native, and evidence choices.
They are surfaced here before code and in the user handoff rather than hidden
in implementation. Every matching code departure from a written routing rule
must include a `DECISION:` comment referring to the applicable item above.
