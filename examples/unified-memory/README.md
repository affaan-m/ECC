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

The 24 checks cover:

- Ordered CLI/MCP search parity and reproducibility after process restart.
- Stable IDs, scope, source attribution, timestamps, body, and unreviewed trust.
- Targeted read visibility and separate project roots.
- Rejection of client identity overrides, target-filter overrides, trust
  promotion, and user access without host opt-in.
- Server-stamped Hermes handoff attribution, preserved memory links, and evidence
  verification in both CLI-to-MCP and MCP-to-CLI directions.
- Source-content matching against a separate synthetic source catalog, with
  tampered content/digest, missing-source and foreign-context rejection.
- Synthetic private-key marker rejection through CLI and MCP without changing
  the recalled dataset.
- Explicit user-scope recall after operator opt-in.
- Failed startup when the host provides no identity.
- Source files and Git HEAD unchanged after execution.

Success prints a JSON receipt with individual checks, timestamps, Node version,
source hashes, and the example's digest. Failure returns a nonzero exit status
without printing raw subprocess output or memory content. The source hashes
identify the executed files; Git HEAD alone does not prove that a checkout is
clean. Installed dependencies are reused and are not digest-pinned by this
example. This is focused conformance verification, not a full-suite result or
a deployment receipt. The source receipt includes the example verifier digest;
  dependency identity and native-harness integration remain separate checks.

## Contract and auth boundary

The example reuses `ecc.memory.v1` without adding fields. Project and team are
the default scopes; user recall requires an explicit request and MCP host
opt-in. The host pins `ECC_MEMORY_HARNESS`; clients cannot supply their own
source identity or target filter through tool arguments. All writes remain
`unreviewed` context subordinate to current instructions.

The fixture body uses `ecc.memory.example-evidence.v1`, an **example-local**
JSON envelope inside the existing Markdown body. No fields are added to
`ecc.memory.v1`. `evidence.cjs` checks a source reference, content digest,
observation time, session ID and checkpoint ID against an independent,
host-owned in-memory catalog. The envelope text must equal the catalog's exact
source bytes. There is no summary/derivation validation in this example.

The verifier requires an exact workspace and scope match. Context is supplied
by the example host using the selected vault and returned memory scope; it is
not accepted from claims in the envelope. Only bounded `fixture:` identifiers
are supported, with no path/URL lookup, filesystem read, network fallback or
ambient source discovery. Missing evidence fails explicitly. Success returns
`source-content-match`, never a trust promotion. The original observation time
is compared to the catalog, not treated as proof of current factual validity.

This verifies integrity relative to the host's catalog, not signed authorship,
identity authentication, an immutable journal or statement truth. An operator
who rewrites both catalog and memory can create another matching pair. The
catalog is synthetic, process-local and not a durable archive; references do
not promise continued source availability. The verifier does not execute
memory text or make it authoritative. All vault records remain `unreviewed`.

Run the pure in-memory negative and boundary checks separately:

```sh
node examples/unified-memory/evidence.test.cjs
```

These checks cover changed text, recomputed/altered digests, altered timestamps,
session/checkpoint substitutions, missing sources, workspace/scope mismatches,
unknown fields/schema, malformed/oversized envelopes and invalid host inputs.
They start no server and require only Node built-ins. The conformance runner
also saves two deliberately altered synthetic envelopes: core storage accepts
unreviewed context, while this example's verifier rejects those recalled bodies.
The verifier is not automatically enabled in core CLI/MCP save or recall paths.

The private-key rejection fixture is a deliberately incomplete marker containing
no key material. It exercises the existing best-effort secret scanner, not a
complete privacy classifier or permission system. Never substitute private
transcripts, credentials or production records into the public example.

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
