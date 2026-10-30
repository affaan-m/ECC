# Context profile native and fresh install checks

These opt-in probes exercise real native discovery without creating a model
thread or copying credentials. They are separate from the default unit suite.

```sh
node docker/context-profiles/native-probe.js
node docker/context-profiles/native-probe.js --claude
node docker/context-profiles/native-switch-probe.js
node docker/context-profiles/run-podman.js
```

The first command uses the locally installed Codex executable, a new private
temporary home for each case, a local marketplace, and the native plugin cache.
It starts a new app-server process and calls only `initialize` and `skills/list`.
Lean, Lean with Angular's bundled resources, and Full excluding Python patterns
must expose exactly their selected plugin skill names. Provider-owned system
skills are reported separately. Every installed resource is checked against its
source digest after removing the local marketplace's carrier source.

The Claude command uses the locally installed Claude executable, a private
temporary home, empty setting sources, `plugin validate`, and `plugin details`
with an inline plugin directory. It checks exact Lean/Full-with-exclusion skill
inventories and zero agent, hook, MCP, and LSP components. Reported token costs
are the provider's projections, not measured usage. Manifest attribution and
version warnings remain visible.

The switch probe uses the product's managed store and isolated native adapter for
Full, Lean, and rollback to Full. Preparation creates a separate provider home
and registers the selected carrier, then opens a fresh app-server to verify
discovery. Rollback first restores managed authority, then re-verifies the prior
native home and selects it. The Full Python exclusion and unrelated bytes in the
prior home must survive every transition. Each native pointer binds its managed
store revision, carrier digest, exact provider version, and native executable
SHA-256. Read-only status rechecks receipts, native configuration, cached resource
bytes, and the pinned executable. Existing sessions and host registration remain
unchanged.

The Podman runner runs the normal `npm pack` lifecycle, reports its archive
SHA-256, and builds an isolated consumer from that archive. It installs runtime
dependencies and pinned Codex 0.154.0 during the image build. The final container
runs as the image's unprivileged `node` user, with networking disabled, all Linux
capabilities dropped, no added host mounts, and no copied credentials. It checks
all ten target/profile combinations through the packed public CLI and independent
structural oracle, including exact carrier equality with the source checkout.
It also checks the packed CLI's Full/Lean/rollback lifecycle, idempotency, stale
revision rejection, Auto context loading, Suggest/Manual/dry-run boundaries,
pinned receipt reuse, and no-workflow reset. It then repeats native Codex discovery
and product native preparation/rollback. The packed CLI also prepares a native
generation and verifies an isolated launch dry-run with no provider on PATH.
Test helpers are
copied separately into the image; they are not part of the published package.

An existing compatible Node image can be selected with
`ECC_CONTEXT_NODE_IMAGE=<image-id>`. The default is `node:22-bookworm-slim`.
The task image and private temporary build directory are removed afterward.
Dependency download layers can remain in Podman's ordinary build cache. The
runner never changes host harness configuration or mounts a host home.

The outcome evaluator (`ai-eval.js`) measures graded task success and provider
usage across install arms; see `ai-corpus.json` for the 30-task repair corpus
and `complex-eval/DESIGN.md` for the preregistered three-task complex-task
benchmark (feature build, incident triage, security hardening) with scored
hidden graders, reference solutions, and reproduction instructions.

These checks certify the observed discovery paths for the reported exact provider
versions. They do not certify model invocation, skill workflow outcomes,
implicit provider invocation of Auto, host activation, crash recovery, permission consent, or actual token
savings. CLI-provided system skills still contribute to whole-session context.
