# ECC × Itô Compute Integration

Status: **Implemented local CLI bridge; managed inference remains unavailable**

Owner: Affaan Mustafa

Updated: 2026-07-23

## Thesis

The distribution chain remains provider-neutral:

    GPU compute (Itô or another selected provider)
      -> any open-source model
      -> model harness
      -> ECC meta-harness

Itô is ECC's preferred compute sponsor, never an exclusive provider. Owned
hardware, existing clusters, and other providers remain valid.

## Implemented boundary

ECC delegates to the canonical Itô package in
`Ito-Markets/ito-cloud-runtime/cli/ito-compute-cli`. ECC does not maintain a
second API client or response schema.

The wrapper exposes only the canonical CLI's `login`, `auth`, `find`, `status`, and `evals`
operations:

    ecc ito login [--no-browser]
    ecc ito auth
    ecc ito find <all required RFQ constraints>
    ecc ito status
    ecc ito evals --cluster <id> --live-sixtytwo --nodes <list> --config-dir <dir>

The canonical MCP server exposes only `ito_auth`, `ito_find`, and `ito_status`.
ECC includes an opt-in configuration template pointing to the local built MCP
entry. It does not enable the server by default.

The former browser/manual-copy command is retired. `ecc ito login` delegates to
the canonical CLI's device authorization, which opens the Itô verification page
by default and persists a device token in macOS Keychain. `--no-browser`
suppresses that page handoff. ECC itself performs no browser automation and
stores no economic state. `ecc ito auth` is validation-only, never starts
device login, and rejects `--no-browser`.

## Local install

`ito-compute-cli` is unpublished. Install it from the canonical repository:

    git clone https://github.com/Ito-Markets/ito-cloud-runtime.git
    cd ito-cloud-runtime/cli/ito-compute-cli
    npm ci
    npm run check

Set `ECC_ITO_CLI_EXECUTABLE` to the explicit absolute built entry:

    /absolute/path/to/ito-cloud-runtime/cli/ito-compute-cli/dist/bin/ito.js

ECC does not resolve the credential-bearing client through `PATH`; this avoids
forwarding authentication material to an unrelated executable with the same
name.

For MCP, configure `node` with:

    /absolute/path/to/ito-cloud-runtime/cli/ito-compute-cli/dist/bin/ito-mcp.js

Device login forwards only required authorization settings, optional Itô
endpoint overrides, and the minimum process environment; it never inherits
`ITO_API_KEY`. The `auth`, `find`, and `status` commands forward `ITO_API_KEY`
directly when configured; `ITO_AUTH_MODE=legacy` is not required. Device tokens
use macOS Keychain by default. Explicit file fallback retains owner-only 0700
directory and 0600 token-file permissions. ECC does not inspect or log secrets.

## Authority and economics

- `login` starts canonical device authorization, with `--no-browser` available
  when the operator does not want the CLI to open the verification page.
- `auth` validates existing credentials only.
- `find` reads live inventory and submits a live authenticated RFQ. An operator
  or agent must gather every hard topology/economic constraint and obtain
  explicit buyer authority before invoking it.
- `status` reads current RFQ and procurement status.
- `evals` requires both `ITO_ENABLE_SIXTYTWO_LIVE=1` and
  `--live-sixtytwo`, then runs only the canonical CLI's pinned
  `sixtytwo-cli==0.3.33` qualification adapter against an explicit node list
  and existing absolute configuration directory. It receives no `ITO_API_KEY`
  or unrelated cloud/model credentials and cannot rent, launch, recover,
  repair, reset, purchase, or order resources.
- ECC returns the canonical process's stdout, stderr, and exit code unchanged.
- An inventory row or RFQ is not a capacity reservation.
- Only a non-null canonical firm quote is firm.
- After an ambiguous transport error, check `status` before repeating `find`.
- Global ECC dry-run does not create a local success result; the wrapper fails
  closed without invoking the canonical CLI.

All durable RFQ, quote, procurement, and reservation state remains owned by the
Itô platform. ECC adds no shadow store.

## Unsupported in this slice

ECC exposes no quote lock, purchase, workload execution, or inference command.
Node qualification is live-only through the separately gated canonical
adapter; the ECC bridge does not expose its paper fixture mode.

Managed inference remains unavailable. ECC does not claim that Itô created a
model endpoint, deployed a workload, reserved capacity, or moved funds.

### Inference-serving contract

`skills/ito-inference` is the only canonical serving skill; `ito-serve` is
trigger language, not a second installed skill. The current ECC bridge has no
`serve` verb and rejects it before resolving or spawning the canonical client.
The canonical runtime documents `inference` only as an unsupported compatibility
probe, and MCP remains limited to auth, find, and status. Serving requests
therefore stop before login.

A future `serve` operation is not releasable until it verifies a completed
booking and fresh serving eligibility, accepts an immutable reviewed manifest,
requires a short-lived single-use confirmation bound to account, action,
manifest digest, and maximum cost, and atomically reserves a caller-provided
idempotency key. CLI arguments carry only an opaque non-authorizing confirmation
reference; bearer confirmation is resolved and consumed server-side.

Manifest handling must canonicalize the path, reject symlinks, open a regular
file without following links, validate ownership/permissions and bounded size,
and hash bytes from the opened descriptor. The digest must match the value bound
into confirmation before mutation, preventing path-swap and digest-mismatch
attacks. Authentication alone is never workload authority.

The same canonical client must expose structured, tenant-scoped status, logs,
metrics, cancel, and cleanup with bounded timeouts and revocation-aware errors.
After an ambiguous transport failure, callers reconcile by idempotency key
before retrying. ECC must never replace that control plane with root SSH, local
serving scripts, browser automation, or an unreviewed purchase endpoint.

## Skill and install shape

`skills/ito-compute/SKILL.md` is an opt-in workflow installed through:

- module: `ito-compute`
- component: `capability:ito-compute`
- profile: `full`

The skill documents the exact CLI and MCP names and the approval boundary. It
does not bundle the unpublished CLI.

## Publication blocker

The integration works from a local build. Distribution remains blocked until
`ito-compute-cli` has an approved package-publication policy and is published
or replaced by another verified distribution channel. ECC must not claim npm
availability before a registry read confirms it.

The ECC package version remains unchanged in this worktree. Its version bump,
release commit, and publication are intentionally deferred to the release owner
after review.

## Verification

The local contract suite proves:

- only the four supported operations spawn;
- RFQ arguments are forwarded without economic reinterpretation;
- only approved Itô runtime or isolated node-qualification variables cross the
  process boundary;
- unsupported and dry-run paths fail before spawn;
- a missing or relative executable fails closed with local-install guidance;
- canonical output and exit status pass through unchanged;
- the skill, install manifests, npm surface, and opt-in MCP template stay
  aligned.

No test in this integration invokes a live Itô API, submits an RFQ, opens a
browser, or contacts a GPU node.
