# Sandbox Testing Conventions

Phase 0 records the repository conventions the tiered sandbox implementation
must mirror.

## Approved Follow-On Direction

The September 8, 2026 approved direction lives in the existing
[execution-fabric design](EXECUTION-FABRIC.md#approved-direction-isolated-software-work).
Its execution classes, orthogonal hosted placement, operator identity,
shell-only coverage, and resource observations now live in strict v2
execution-fabric contracts. The v1 numeric tiers, closed manifest vocabulary,
and routing decisions below remain the current operational contract.
Whole-agent coverage and broader `services` or `gui` meanings still require
separate versioned contracts and conformance evidence. M2 runtime handles must
compose with M3 durable task/attempt authority and Feature Fleet.

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
4. Earlier design work evaluated a microsandbox-to-Podman fallback. The active
   router does not select Microsandbox, so Tier 1 now routes directly to Podman
   and still defaults network to disabled unless the manifest asks for it.
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
9. Tier 1 has only the rootless Podman runtime established by item 38. Podman
   supports network disabled or unrestricted only, so a strict domain allowlist
   fails closed with an actionable routing error and cannot be reported as
   satisfied.
10. Podman execution is `create`, `start` or `exec`, `diff`, then explicit
    `rm`. `run --rm` cannot preserve a stopped container for diff evidence.
11. The earlier Microsandbox prototype treated snapshots as disk-only. That
    prototype remains historical evidence and is not part of the active Tier 1
    route established by item 38.
12. Windows Sandbox and Hyper-V are detected but redirect to CI in v1. Their
    local lifecycle and diff surfaces are not portable enough to claim a
    working adapter; dockur/windows remains detection-only. The probe says so
    directly instead of routing a native Windows request to broken glue.
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
    manifest text before isolation starts. Mock mode may use an inert shim name
    because its injected runner launches no process; real mode never falls back
    to a workspace or relative shim.
20. Tier 1 mounts the invocation directory read-only at `/workspace/source`
    and gives the test an otherwise disposable container filesystem rooted at
    `/workspace`. Reports record both the requested image reference and its
    inspected content ID so a mutable local tag cannot hide the snapshot that
    actually ran.
21. Every Podman run verifies rootless mode immediately before image creation,
    drops all Linux capabilities, bounds processes/CPU/memory, and keeps the
    source mount read-only. First-party tests retain passwordless `sudo` only
    inside that rootless user namespace so package installers behave normally;
    untrusted Podman execution additionally enables `no-new-privileges`.
22. Layer-diff reports include directory entries and cap every normalized list
    at 5,000 paths so ECC's supported full install remains complete. Executable
    and top-level home dotfile classifications include
    deleted paths; `services_registered` includes only added/changed services,
    while removed services remain explicit in `files_deleted`. Malformed or
    truncated install evidence makes an `install-diff` run an error, never a
    passing partial report.
23. The earlier Microsandbox adapter prototype pinned the CLI contract to
    v0.6.8 and tested integrity-checked disk snapshots. It is retained only as
    historical implementation evidence and cannot satisfy active Tier 1 runs.
24. An eligible SRT installer/system-write denial permits exactly one Tier 1
    rerun. The final report contains the destination steps, one escalation
    record, the combined duration, and bounded initial-denial evidence in
    `notes`. For `os: any`, the rerun may move from the host process to Linux;
    the manual `escalate` command consumes the prior report without rerunning
    SRT.
25. Historical prototype reports retain truthful incomplete Microsandbox
    evidence because v0.6.8 exposed no filesystem-diff API. The active router
    never selects that adapter. Strict domain allowlists fail closed because
    Podman cannot satisfy them.
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
28. Lume execution pins CLI 0.5.1 and uses a stopped, SSH-ready, host-local
    clone seed created from an Apple IPSW. Runs are display-free under an
    ECC-owned launcher, share no host directory, bind cleanup to the launcher's
    birth timestamp plus unique clone command, freeze it before recursively
    capturing descendants, and bind each helper's PID, birth time, and exact
    command before signaling it. This includes Foundation helpers that create
    independent process groups. Runs verify Apple's two-running-macOS-guest
    ceiling, stop the owned launcher tree, explicitly stop the guest, and only
    then attempt deletion. Lume combines remote stdout and stderr, so the report
    records
    that limitation. The seed is explicitly operator-trusted local state: ECC
    verifies the tagged JSON identity as stopped macOS/arm64 state but does not
    attest the guest disk. Lume and Tart share one stale-owner-aware host lock,
    and each preflight counts the other backend's running Apple guests before
    clone/start; ECC serializes its own macOS VM lifecycles to close the race.
    The lifecycle lock is published as an atomically exclusive owner file with
    a random token, which is portable across Windows and POSIX. Stale locks fail
    closed for exact manual cleanup instead of being automatically stolen, and
    release removes only the matching token.
    Before executing manifest commands, ECC stores the clone's non-secret guest
    address and requires two helper-free samples. The address marker keeps the
    VNC-config SSH helper discoverable if a launcher crash reparents it to PID 1.
29. Lima execution pins CLI 2.2.0 and clones only a stopped seed originally
    created with `--plain`; the child reasserts `--plain` and `--mount-none`
    before start. This preserves
    a real Linux distribution while withholding the host home, workspace,
    port forwarding, and containerd defaults from a simulated fresh user.
30. Tart execution pins CLI 2.32.1 and is eligible only when already installed
    on Apple Silicon. It clones a stopped guest-agent-enabled base image, runs
    headlessly without host shares or clipboard, can use host-only networking
    internally, and emits the Fair Source 100
    notice on every selected route/report. ECC never recommends Tart as an
    installation step.
31. Tier 2 probes accept exact stable CLI version tokens only; prerelease,
    build-suffixed, or extended tokens do not satisfy a pin. Guest seed JSON
    must match the reported OS and architecture (plus Linux and `plain: true`
    for Lima) before cloning. Readiness probes use only the manifest's remaining
    deadline, and lifecycle cleanup plus host-lock release runs from `finally`.
32. Tier 2 install diffs are bounded before/after scans of selected system and
    user paths. They always report `method: scan` and `complete: false`. Lume
    and Lima v1 cannot disable or restrict guest egress, while Tart host-only
    mode still permits host reachability. All three are therefore eligible only
    when the manifest explicitly authorizes `network:*`; otherwise local
    routing fails closed before VM creation. Strict domain allowlists also fail
    before Tier 2. Scan commands use fixed system-tool paths outside login
    profiles. Malformed evidence makes the report an error; bounded truncation
    is preserved as explicit partial evidence. The macOS scan excludes volatile
    per-user `Library` trees except `LaunchAgents` so first-boot background
    activity does not bury durable install surfaces.
33. Lume 0.5.1's OCI pull path could not reconstruct the current 300-part
    `macos-tahoe-cua:26.5.2` image during the real gate. ECC therefore directs
    the operator to the supported unattended IPSW create path for the one-time
    seed. Normal sandbox runs remain offline with respect to OS acquisition and
    clone only that stopped local seed.
34. The agent surface remains a model-neutral skill plus CLI contract shared by
    Claude Code, Codex, and Kimi Code. Optional visible interaction composes the
    sandbox skill with terminal-opener after a user request or an explained agent
    decision. The Claude-specific failure hook is non-blocking and advisory only;
    it never runs a sandbox, widens permissions, or replaces report parsing. It
    inspects bounded failure output rather than command input, stays silent on
    truncated input, and leaves other harnesses on the same skill/CLI path. Hook
    guidance resolves the CLI only from its trusted absolute installed location;
    a content-only managed install instead names the one-time `ecc-universal`
    runtime command.
    Tier 1's read-only source mount is explicitly not a confidentiality boundary,
    so untrusted code with egress must start from a sanitized staging directory.
35. The shipped demo installs the current checkout's minimal Codex profile into
    a disposable Tier 1 home with networking disabled. This exercises the real
    managed installer and produces a complete bounded layer diff without
    depending on an unpublished npm version or weakening the read-only source
    mount.
36. A failed Tier 1 container may consume the run's single escalation only when
    the failed command and bounded output jointly match a high-confidence
    systemd, Windows registry, or GUI/native-display signature and container
    cleanup succeeded. Routing prefers a satisfying local Tier 2 guest, then CI;
    `--local-only` forbids the latter. The matrix preserves the original manifest
    but forces its explicitly gated disposable runner to `ci-native`, rejects
    child artifacts that already escalated, and records the Tier 1-to-native
    transition only in the final report. This prevents a retry loop back into a
    hosted container and keeps the one-escalation contract global.
37. CI-native v1 accepts only `trust: first-party` manifests that explicitly
    declare `network:*`. Hosted runners cannot preserve disabled or domain-only
    egress, and commands execute inside the runner evidence boundary, so
    untrusted code must remain in a local hardened environment. CI artifacts
    bind to a deterministic manifest digest and the exact allowed command
    transcript; the separately checked-out aggregation job rejects child
    escalations and substituted evidence. One mutable orchestration budget and
    aggregate-report semantic validation enforce at most one escalation across
    every shard, not one per child.
38. Tier 1 has exactly one runtime: rootless Podman. An installed Docker daemon
    is neither probed nor routed. Earlier local Docker results remain historical
    development evidence only and cannot satisfy the acceptance gate.
39. Tier 1 is also a user-facing manual-testing surface. When an agent believes
    visible interaction would help, it must describe the proposed clean home,
    source mount, package access, network policy, and test purpose in a literal
    `y/n` consent prompt before provisioning. After consent, the person may use
    the CLI interactively while the outside agent follows the same redacted
    journal and iterates on the feature. Scripted verification and interactive
    exploration keep separate evidence authority.
40. The visible terminal is user-selectable client infrastructure, not the
    sandbox owner. Initial acceptance requires both WezTerm and macOS
    Terminal.app adapters. Both adapters preserve the selected target arguments
    and filtered environment; Terminal.app uses a private self-deleting command
    wrapper because it has no direct argv execution API.
41. `ecc-sandbox launch MANIFEST --purpose TEXT` is the primary user-facing
    Tier 1 entrypoint. Without `--consent`, it returns the exact prompt with
    `creates_run: false`; `--consent n` remains a no-op; and only `--consent y`
    plus the returned `--proposal` ID creates the non-evidence exploration
    session. The proposal binds the exact manifest digest, capability snapshot,
    route, purpose, and terminal. Any change invalidates consent before state or
    terminal launch. A successful terminal dispatch reports `launching`; only
    the journal's `exploration.started` event proves the visible process checked
    in. A detached 15-second watchdog atomically publishes
    `exploration.launch.failed` before changing an unchecked run to `error`, so
    an agent listener terminates with a diagnostic and a late terminal cannot
    start the expired session.

The plan explicitly delegates uncovered decisions to the free, lightweight,
harness-agnostic option. Items 1, 2, 5, 8, 9, 15, 16, 17, 18, and 19 resolve
internal contract contradictions or a missing clean-machine, write-scope, or
evidence-integrity need and are therefore treated as that delegated authority.
Items 20-41 record the corresponding Tier 1 containment, escalation, hardened
backend, CI-native, VM lifecycle, evidence, and agent-surface choices.
They are surfaced here before code and in the user handoff rather than hidden
in implementation. Every matching code departure from a written routing rule
must include a `DECISION:` comment referring to the applicable item above.
