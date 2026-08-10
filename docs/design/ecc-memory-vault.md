# ECC Memory Vault

## Capability

An operator can save, inspect, search, and hand off durable context through one
human-readable vault that Claude Code, Codex, Hermes, OpenCode, and other
harnesses can share. Project and team memories live under `.ecc/memory/`; user
memories live under `~/.ecc/memory/`. The same `ecc.memory.v1` documents are
available through the `ecc memory` CLI and an opt-in local stdio MCP server, so
knowledge transfer does not depend on email, one vendor's transcript format, or
one harness's hook support.

## Constraints

- Markdown files are the source of truth. SQLite context graphs, embeddings,
  and hosted systems are indexes or adapters, never the only copy.
- A memory is context, not an instruction. Every first-release vault entry is
  `trust: "unreviewed"` and cannot silently become rules, skills, or policy.
- Reviewed project standards still belong in the repository's canonical rules,
  decision records, runbooks, or other governed documentation. The vault may
  link to those artifacts; it does not replace them.
- The core is local-first, inspectable, and usable without a model, network,
  database server, or embedding provider.
- Writes are create-only. The tool never overwrites an existing memory ID.
  Supersession is represented by a new document with explicit links.
- Known credential shapes and private keys are rejected before a tool writes a
  file. This scan is a best-effort backstop, not a complete secret classifier.
  Memory readers do not follow symbolic links.
- Search is bounded lexical retrieval in the first release. Optional semantic
  adapters may rerank results later without changing the document contract.
- Harness adapters stay thin. Shared behavior belongs in `scripts/`, `skills/`,
  and the MCP server rather than separate Claude/Codex/Hermes stores.
- Procedural memory remains in rules and instincts, subject to their existing
  promotion and validation gates.

### Threat boundary

The first-release runtime defends against hostile vault documents, stable
symlink/path escapes, accidental project-memory commits, cross-harness MCP
identity spoofing, known secret shapes, terminal control data, and bounded
resource exhaustion. Vault roots must remain writable only by the operator.
It is not a security boundary between concurrent processes running as the same
OS user: Node.js does not expose the directory-file-descriptor-relative
`openat2` guarantees needed to eliminate every parent-directory swap race.
Operators who need protection from a malicious local process must use separate
OS accounts, containers, or equivalent filesystem isolation.

## Implementation Contract

### Actors

- **Operator:** owns the vault, reviews files, commits team memories, and
  decides when recalled context becomes governed project truth.
- **Harness agent:** writes unreviewed facts, notes, lessons, and handoffs; reads
  active memories targeted to itself or all harnesses.
- **ECC CLI:** deterministic local create/read/search/doctor interface.
- **ECC Memory MCP:** stdio adapter exposing the same create/read/search/doctor
  operations. It has no review or promotion tool.
- **ECC2 context graph:** optional projection populated from the Markdown
  directory connector for richer relationship and session views.

### Surfaces

```text
<repo>/.ecc/memory/
├── project/
│   ├── contexts/
│   ├── decisions/
│   ├── facts/
│   ├── handoffs/
│   ├── lessons/
│   ├── notes/
│   ├── preferences/
│   └── runbooks/
└── team/
    └── <same kind directories>

~/.ecc/memory/
└── <same kind directories>
```

The project scope is repo-local operator context and receives its own
fail-closed `.gitignore`: initialization and writes stop if the protection file
exists with unexpected content. The team scope is intended to be inspected by
a human before it is committed, but committed vault entries remain unreviewed
context. The user scope follows the operator across repos and is recalled only
when explicitly requested.
`ECC_MEMORY_PROJECT_ROOT` and `ECC_MEMORY_USER_ROOT` may override the two vault
locations explicitly.

### Document contract

Each memory is a Markdown file with strict JSON-valued YAML frontmatter:

```markdown
---
schema: "ecc.memory.v1"
id: "mem_20260726_01k123example"
title: "Authentication migration handoff"
kind: "handoff"
scope: "project"
trust: "unreviewed"
status: "active"
source_harness: "codex"
target_harnesses: ["claude"]
tags: ["auth", "migration"]
links: ["mem_20260725_01kolder"]
created_at: "2026-07-26T20:00:00.000Z"
updated_at: "2026-07-26T20:00:00.000Z"
---

The token rotation tests pass. The remaining task is ...
```

Required fields are schema, ID, title, kind, scope, trust, status, source
harness, targets, tags, links, and timestamps. IDs, kinds, tags, and harness
names use a bounded lowercase slug grammar. Bodies are bounded Markdown text.
Backlinks are derived from other documents' `links` fields.

### States and transitions

```text
tool save ──> active + unreviewed
                  │
                  ├── human verifies evidence
                  │      └──> governed rule, decision record, runbook, or doc
                  │
                  └── new memory links with supersedes relation
                         └──> old item may be marked superseded manually
```

The initial runtime creates active, unreviewed memories only, and normal search
recall returns active entries only. A direct ID read may still retrieve a
non-active entry for inspection. Human review does not change a vault entry's
`trust` field; accepted knowledge is promoted into a governed repository
artifact. The runtime exposes no automated promotion transition. This is
intentional: a shell-capable agent cannot be treated as an independent human
approval boundary.

### Interfaces

CLI:

```text
ecc memory init [--scope project|team|user]
ecc memory save --title <text> [--body-file <path>|--stdin] [metadata flags]
ecc memory handoff --from <harness> --target <harness> --title <text> ...
ecc memory search <query> [--scope ...] [--target-harness ...] [--json]
ecc memory read <id> [--scope ...] [--json]
ecc memory doctor [--json]
```

MCP tools:

```text
memory_save
memory_search
memory_read
memory_doctor
```

The CLI searches active `project` and `team` memories by default. `user` recall
requires an explicit `--scope user`. Its `--target-harness` option is a
caller-selected routing filter, not an authorization boundary.

The MCP server requires a lowercase `ECC_MEMORY_HARNESS` identity at launch.
That server-side identity supplies `source_harness` for writes and constrains
search/read to memories targeted to that harness or `all`; clients cannot
override it in tool arguments. MCP access to `user` scope is disabled unless
the operator also sets `ECC_MEMORY_ALLOW_USER_SCOPE=1`, after which the client
must still request that scope explicitly. MCP writes always produce unreviewed
documents. Structured errors omit stack traces and secret values.

### Failure and recovery

- Invalid metadata, oversized input, duplicate IDs, suspected secrets, and path
  escapes fail before writing.
- A malformed file is reported by `doctor` and excluded from search; it is
  never deleted or rewritten automatically.
- Duplicate IDs and broken links are reported explicitly.
- Symlinks are skipped and reported.
- Missing vault directories are equivalent to an empty vault.
- A failed MCP request returns a bounded error and leaves existing files
  unchanged.

### Observability

The first release reports operation results only. Write acknowledgements omit
the raw body and use a scope-relative vault path; only an explicit read returns
the full body. A later event-sourced ECC2 projection may record content hashes
and operation metadata, but it must not log raw memory bodies or credentials.

## Non-goals

- Building a vector database, hosted sync service, email transport, or new agent
  framework.
- Importing raw Claude/Codex/Hermes transcripts automatically.
- Treating recalled memory as trusted system instructions.
- Auto-promoting memory into skills, rules, instincts, or policy.
- Replacing ECC2 sessions, the context graph, GitHub/Linear work items, or
  governed project documentation.
- Solving cross-machine conflict-free replication in the first release.

## Open Questions

- Whether the team scope should gain a signed promotion manifest that points
  to governed artifacts after the ECC2 append-only event substrate lands.
- Which semantic adapter should be the first optional reranker, and what offline
  evaluation must beat lexical search before it becomes recommended.
- Whether SessionStart should inject links to governed project references or
  keep all recall explicitly task-scoped. The first release keeps recall
  explicit.
- How `.context/` worktree handoffs should materialize from vault handoffs once
  the conductor fork lifecycle is stable.

## Handoff

The local file/CLI/MCP slice is implemented behind explicit CLI or MCP
activation and covered by core, schema, CLI, protocol, packaging, and
cross-harness tests. ECC2 graph sync, automatic session capture, semantic
adapters, governed-reference recall, and event-log promotion belong in
follow-up lanes after real-world retrieval evaluation.
