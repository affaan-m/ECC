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

The wrapper exposes only the canonical CLI's `auth`, `find`, and `status`
operations:

    ecc ito auth
    ecc ito find <all required RFQ constraints>
    ecc ito status

The canonical MCP server exposes only `ito_auth`, `ito_find`, and `ito_status`.
ECC includes an opt-in configuration template pointing to the local built MCP
entry. It does not enable the server by default.

The former browser/manual-copy command is retired. `ecc ito` performs no
browser navigation and stores no economic state.

## Local install

`ito-compute-cli` is unpublished. Install it from the canonical repository:

    git clone https://github.com/Ito-Markets/ito-cloud-runtime.git
    cd ito-cloud-runtime/cli/ito-compute-cli
    npm ci
    npm run check

Set `ECC_ITO_CLI_EXECUTABLE` to the explicit absolute built entry:

    /absolute/path/to/ito-cloud-runtime/cli/ito-compute-cli/dist/bin/ito.js

ECC does not resolve the credential-bearing client through `PATH`; this avoids
forwarding `ITO_API_KEY` to an unrelated executable with the same name.

For MCP, configure `node` with:

    /absolute/path/to/ito-cloud-runtime/cli/ito-compute-cli/dist/bin/ito-mcp.js

Inject `ITO_API_KEY` with 1Password or the launching environment. ECC forwards
only `ITO_API_KEY`, optional Itô endpoint overrides, and the minimum process
environment. It does not inspect or log the key.

## Authority and economics

- `auth` validates the configured Itô API key.
- `find` reads live inventory and submits a live authenticated RFQ. An operator
  or agent must gather every hard topology/economic constraint and obtain
  explicit buyer authority before invoking it.
- `status` reads current RFQ and procurement status.
- ECC returns the canonical process's stdout, stderr, and exit code unchanged.
- An inventory row or RFQ is not a capacity reservation.
- Only a non-null canonical firm quote is firm.
- After an ambiguous transport error, check `status` before repeating `find`.
- Global ECC dry-run does not create a local success result; the wrapper fails
  closed without invoking the canonical CLI.

All durable RFQ, quote, procurement, and reservation state remains owned by the
Itô platform. ECC adds no shadow store.

## Unsupported in this slice

ECC exposes no quote lock, purchase, workload execution, node qualification,
or inference command. The canonical package contains a separately gated node
qualification adapter, but this ECC bridge intentionally does not expose it.

Managed inference remains unavailable. ECC does not claim that Itô created a
model endpoint, deployed a workload, reserved capacity, or moved funds.

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

- only the three supported operations spawn;
- RFQ arguments are forwarded without economic reinterpretation;
- only approved Itô runtime variables cross the process boundary;
- unsupported and dry-run paths fail before spawn;
- a missing or relative executable fails closed with local-install guidance;
- canonical output and exit status pass through unchanged;
- the skill, install manifests, npm surface, and opt-in MCP template stay
  aligned.

No test in this integration invokes a live Itô API, submits an RFQ, opens a
browser, or contacts a GPU node.
