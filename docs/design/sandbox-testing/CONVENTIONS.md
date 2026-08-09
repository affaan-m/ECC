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

The plan explicitly delegates uncovered decisions to the free, lightweight,
harness-agnostic option. Items 1, 2, 5, 8, and 9 resolve internal contract
contradictions or a missing clean-machine need and are therefore treated as
that delegated authority. They are surfaced here before code and in the user
handoff rather than hidden in implementation. Every matching code departure
from a written routing rule must include a `DECISION:` comment referring to the
applicable item above.
