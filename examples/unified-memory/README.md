# Cross-harness memory conformance example

Run the existing ECC CLI and local stdio MCP server against one disposable
synthetic vault. The example checks that the same scoped query returns the same
ordered records, scores, excerpts, and provenance for each configured identity.

From an ECC checkout with its runtime dependencies already available:

```sh
node examples/unified-memory/conformance.cjs
```

No model, network, Graphiti service, package installation, or native harness
application is required. The example uses the existing Ajv dependency. It
creates temporary synthetic project, team, and user records, starts bounded
Node subprocesses, and removes the temporary vaults when finished. Existing
vault locations and ambient credential variables are not passed to children.

## What runs

The CLI creates a shared project record, team context, a Codex-targeted record,
a user record, and another project's record. Separate MCP processes configured
as `codex`, `claude`, and `hermes` each perform the same requests. These names
are host configuration in the example, not authenticated sessions in those
applications.

The 21 checks cover:

- Ordered CLI/MCP search parity and reproducibility after process restart.
- Stable IDs, scope, source attribution, timestamps, body, and unreviewed trust.
- Targeted read visibility and separate project roots.
- Rejection of client identity overrides, target-filter overrides, trust
  promotion, and user access without host opt-in.
- Server-stamped Hermes handoff attribution and preserved memory links.
- Explicit user-scope recall after operator opt-in.
- Failed startup when the host provides no identity.
- Source files and Git HEAD unchanged after execution.

Success prints a JSON receipt with individual checks, timestamps, Node version,
source hashes, and the example's digest. Failure returns a nonzero exit status
without printing raw subprocess output or memory content. The source hashes
identify the executed files; Git HEAD alone does not prove that a checkout is
clean. Installed dependencies are reused and are not digest-pinned by this
example. This is focused conformance verification, not a full-suite result or
a deployment receipt.

## Contract and auth boundary

The example reuses `ecc.memory.v1` without adding fields. Project and team are
the default scopes; user recall requires an explicit request and MCP host
opt-in. The host pins `ECC_MEMORY_HARNESS`; clients cannot supply their own
source identity or target filter through tool arguments. All writes remain
`unreviewed` context subordinate to current instructions.

The fixture body contains a synthetic source reference, content digest,
observation time, session ID, and checkpoint ID. This demonstrates preservation
of an evidence pointer. It is a body convention, not a validated provenance
envelope, signed authorship, or a claim that the underlying statement is true.

`targetHarnesses` constrains MCP routing, not same-user filesystem access. The
CLI is an operator interface: direct CLI reads can access a targeted record
without a harness target filter, and the CLI can choose source attribution.
Separate OS accounts or equivalent filesystem isolation are necessary when
local processes are mutually untrusted.

The example provides no unified OAuth, delegated credential lifecycle, plan
token routing, cross-machine synchronization, Graphiti partition policy, or
Hermes MemoryProvider integration. A future backend adapter must preserve the
existing record contract and enforce its authenticated partition policy
separately from routing metadata.

See [the memory vault design](../../docs/design/ecc-memory-vault.md) for the
canonical storage and threat contract.
