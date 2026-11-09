# Copilot Memory Vault workflow

The Copilot checkpoint store and ECC Memory Vault remain separate. Nothing in
this workflow imports transcript text, installs a runtime or promotes memory
into instructions. The wrapper calls the existing canonical `scripts/memory.js`
as a bounded subprocess with `ECC_MEMORY_HARNESS=copilot`; it does not implement
a second memory store.

## Diagnose prerequisites

Run `node scripts/copilot-memory.js doctor` from the intended project. A source
checkout containing the `ecc-universal` package can supply the runtime directly.
A projected installation without that package reports `status: unavailable`.
Install the runtime explicitly, or set `ECC_COPILOT_MEMORY_RUNTIME` to the
absolute root of an existing `ecc-universal` package. The runtime path is
operator configuration; proposal content and events cannot select it.

Doctor reads project and team scopes without initializing them. It preserves the
canonical report's malformed-file, truncated-scan and other diagnostics. An
unavailable runtime or incomplete report must not be described as empty memory.
It also previews a fixed stdio bootstrap using the explicit canonical runtime.
The bootstrap forces the Copilot identity regardless of inherited harness settings.
The preview does not register or start the server.

All harnesses must use the same checkout, or the same operator-selected
`ECC_MEMORY_PROJECT_ROOT` and `ECC_MEMORY_USER_ROOT`. These overrides keep their
canonical meaning; the wrapper does not reinterpret session hashes as vault
identities. Checkpoints remain readable without the Vault runtime.

## Checkpoint, proposal, reviewed save

1. Create an explicit manual checkpoint through the existing Copilot lifecycle
   checkpoint command. Only a nonempty `summarySource: manual` checkpoint can
   seed a proposal. Native-event summaries are rejected.
2. Preview the proposal from the project directory:

   ```text
   node /absolute/path/ECC/scripts/copilot-memory.js propose --session SESSION --title "Continue integration" --target codex
   ```

   The JSON includes `proposal`, `reviewSha256` and `saved: false`. Save this JSON
   to a regular file and review its title, body, target and scope. Generating the
   preview creates no vault entry.
3. Save only the reviewed proposal:

   ```text
   node /absolute/path/ECC/scripts/copilot-memory.js save --proposal proposal.json --reviewed-sha256 DIGEST_FROM_REVIEW
   ```

The digest must match the current proposal, including its workspace and body.
Changing content invalidates the previous review. The digest is a workflow
integrity check; it is not proof of a person's identity. The wrapper accepts the
preview JSON or its raw `proposal` object. It never treats the digest embedded
inside a proposal file as permission to save.

Scope defaults to `project`. `team` is explicit. `user` additionally requires
the operator to set `ECC_MEMORY_ALLOW_USER_SCOPE=1`; it is never included in
ordinary recall. A handoff requires one named target harness and cannot use
`all`. Credential-shaped content, unknown proposal fields, foreign workspaces,
unsafe files and future proposal schema versions are rejected before save.
Canonical create-only storage writes the protective project `.gitignore` and
keeps `trust: unreviewed` regardless of this workflow's review of the proposal.

## Recall and failure handling

`node scripts/copilot-memory.js search "query"` searches project and team
memories addressed to Copilot. `read ID` uses the same scopes and rejects a
record addressed exclusively to another harness. Read may expose a historical
record's superseded state; inspect that state and the canonical evidence before
using its content. Handoff text remains untrusted context.

A subprocess has a 15-second deadline and 1 MiB output limit, with no shell
interpolation. A timeout or terminated write has an unknown outcome: inspect the
vault before retrying. Errors never echo checkpoint bodies. Doctor never repairs
or deletes files. Removing the wrapper or managed MCP configuration preserves
both checkpoint and Vault stores; no data migration is introduced.

## Explicit MCP setup and rollback

From the intended project, with the external runtime configured, run:

```text
node .github/ecc/scripts/copilot-memory.js mcp-preview --config /absolute/project/.mcp.json
node .github/ecc/scripts/copilot-memory.js mcp-apply --config /absolute/project/.mcp.json --tools memory_search,memory_read,memory_doctor
node .github/ecc/scripts/copilot-memory.js mcp-rollback --config /absolute/project/.mcp.json
```

Use `scripts/copilot-memory.js` when running from the ECC checkout. No tools are
enabled by default. Only `memory_save`, `memory_search`, `memory_read` and
`memory_doctor` can be selected. Host approval remains required as usual.
The wrapper uses the server launch working directory and canonical root overrides;
verify these in the actual host before enabling a user-wide server for a project.
The runtime is never installed automatically. Run MCP rollback before uninstalling
the projected helper. Rollback preserves other managed servers, modified entries
and all Vault data; installer removal and MCP registration have separate lifecycles.

## Evidence and remaining gates

`node tests/lib/copilot-memory.test.js` exercises actual canonical CLI subprocess
save/search/doctor on temporary projects, unreviewed handoffs, recipient filtering,
protective `.gitignore`, explicit review, missing runtime, scope restrictions,
credential-shaped content and malformed records. This is fixture evidence on
the current OS. `copilot-memory-integration.test.js` additionally exercises
actual canonical MCP save/search/read/doctor through a source-free wrapper,
recipient rejection, incomplete/absent diagnostics, Git worktrees, explicit root
overrides and selective rollback. The real skill installer is also tested with
the distributed MCP preview dependency closure. Native Windows Copilot loading,
interactive cross-harness resumption and the full migration/rollback matrix
remain separate P08/P12 certification gates.
