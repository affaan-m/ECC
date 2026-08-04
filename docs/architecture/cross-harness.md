# Cross-Harness Architecture

ECC is the reusable workflow layer. Harnesses are execution surfaces.

The goal is to keep the durable parts of agentic work in one repo:

- skills
- rules and instructions
- hooks where the harness supports them
- MCP configuration
- install manifests
- session and orchestration patterns
- durable, harness-neutral memory documents

Claude Code, Codex, OpenCode, Cursor, Gemini, and future harnesses should adapt those assets at the edge instead of requiring a new workflow model for every tool.

For the operator-facing support matrix and scorecard workflow, see
[Harness Adapter Compliance Matrix](harness-adapter-compliance.md).
For the full-stack platform framing and product-integration loop, see
[ECC Platform Value Loop](platform-value-loop.md).

## Portability Model

| Surface | Shared Source | Harness Adapter | Current Status |
|---------|---------------|-----------------|----------------|
| Skills | `skills/*/SKILL.md` | Claude plugin, Codex plugin, `.agents/skills`, Cursor skill copies, OpenCode plugin/config | Supported with harness-specific packaging |
| Rules and instructions | `rules/`, `AGENTS.md`, translated docs | Claude rules install, Codex `AGENTS.md`, Cursor rules, OpenCode instructions | Supported, but not identical across harnesses |
| Hooks | `hooks/hooks.json`, `scripts/hooks/` | Claude native hooks, OpenCode plugin events, Cursor hook adapter | Hook-backed in Claude/OpenCode/Cursor; instruction-backed in Codex |
| MCPs | `.mcp.json`, `mcp-configs/` | Native MCP config import per harness | Supported where the harness exposes MCP |
| Commands | `commands/`, CLI scripts | Claude slash commands, compatibility shims, CLI entrypoints | Supported, but command semantics vary |
| Memory | `.ecc/memory/`, `~/.ecc/memory/` | `ecc memory` CLI or opt-in `ecc-memory-mcp` stdio server | Supported with explicit recall and unreviewed writes |
| Sessions | `ecc2/`, session adapters, orchestration scripts | TUI/daemon, tmux/worktree orchestration, harness-specific runners | Alpha |

## What Travels Unchanged

`SKILL.md` is the most portable unit.

A good ECC skill should:

- use YAML frontmatter with `name`, `description`, and `origin`
- describe when to use the skill
- state required tools or connectors without embedding secrets
- keep examples repo-relative or generic
- avoid harness-only command assumptions unless the section is clearly labeled

The same source skill can be installed into multiple harnesses because it is mostly instructions, constraints, and workflow shape.

## What Gets Adapted

Each harness has different loading and enforcement behavior:

- Claude Code loads plugin assets and has native hook execution.
- Codex reads `AGENTS.md`, plugin metadata, skills, and MCP config, but hook parity is instruction-driven.
- OpenCode has a plugin/event system that can reuse ECC hook logic through an adapter layer.
- Cursor uses its own rule and hook layout, so ECC maintains translated surfaces under `.cursor/`.
- Gemini support is install/instruction oriented and should be treated as a compatibility surface, not as full hook parity.

Adapters should stay thin. The shared behavior belongs in `skills/`, `rules/`, `hooks/`, `scripts/`, and `mcp-configs/`.

## Shared Memory Contract

ECC Memory Vault is the common knowledge-transfer surface for Claude, Codex,
Hermes, Cursor, OpenCode, and other agents. It stores portable
`ecc.memory.v1` Markdown documents in three scopes:

- project: `<repo>/.ecc/memory/project/`
- team: `<repo>/.ecc/memory/team/`
- user: `~/.ecc/memory/`

Every harness must use the same repository working directory or the same
`ECC_MEMORY_PROJECT_ROOT` and `ECC_MEMORY_USER_ROOT` overrides. The deterministic
`ecc memory` CLI is the baseline interface. Harnesses with MCP support may
instead launch `ecc-memory-mcp` and use `memory_save`, `memory_search`,
`memory_read`, and `memory_doctor`. Normal search recall is active-only across
`project` and `team`; a direct ID read can inspect a non-active entry, and
`user` must be requested explicitly. The CLI target flag is a caller-selected
routing filter, not an authorization boundary.

The MCP server is opt-in. Its reference entry lives in
`mcp-configs/mcp-servers.json`; it is intentionally absent from the default
`.mcp.json` so installations do not silently gain a writable context surface
or pay its tool-schema cost. Each MCP process requires a lowercase
`ECC_MEMORY_HARNESS`; this server-bound identity supplies the source harness
and target filter, so a tool caller cannot select another identity. User-scope
MCP access remains blocked unless the operator launches the process with
`ECC_MEMORY_ALLOW_USER_SCOPE=1`.

The trust boundary is consistent across every adapter:

- all first-release vault entries are create-only and always `unreviewed`;
- recalled memory is data, not executable instruction;
- known secret-shaped writes are rejected as a best-effort backstop, and
  readers do not follow symlinks;
- project-scope writes stop if the vault's protective `.gitignore` is altered;
- human acceptance promotes knowledge into a governed repository artifact; it
  never turns memory frontmatter into a self-asserted approval;
- active execution state remains in GitHub or Linear, not only in memory.

`skills/unified-memory/SKILL.md` owns this workflow. Codex and Cursor receive
behavior-identical packaging copies under `.agents/skills/` and
`.cursor/skills/`; Hermes can import the canonical skill. No harness owns a
separate authoritative memory store.

## Hermes Boundary

Hermes is not the public ECC runtime.

Hermes is an operator shell that can consume ECC assets:

- import selected ECC skills into a Hermes skills directory
- use ECC MCP conventions for tool access
- route chat, CLI, cron, and handoff workflows through reusable ECC patterns
- distill repeated local operator work back into sanitized ECC skills

The public repo should ship reusable patterns, not local Hermes state.

Do ship:

- sanitized setup docs
- repo-relative demo prompts
- general operator skills
- examples that do not depend on private credentials

Do not ship:

- OAuth tokens or API keys
- raw `~/.hermes` exports
- personal workspace memory
- private datasets
- local-only automation packs that have not been reviewed

## Worked Example

Use `skills/hermes-imports/SKILL.md` as the same skill source across harnesses.

The workflow is:

1. Author the durable behavior once in `skills/hermes-imports/SKILL.md`.
2. Keep secrets, local paths, and raw operator memory out of the skill.
3. Let each harness adapt how the skill is loaded.
4. Test the source skill and the harness-facing metadata separately.

Claude Code gets the skill through the Claude plugin surface and can enforce related hooks natively.

Codex reads the repo instructions, `.codex-plugin/plugin.json`, and the MCP reference config. The same skill source still describes the workflow, but hook parity is instruction-backed unless Codex adds a native hook surface.

OpenCode gets the skill through the OpenCode package/plugin surface. Event handling can reuse ECC hook logic through the adapter layer, while the skill text stays unchanged.

If a change requires editing three harness copies of the same workflow, the shared source is in the wrong place. Put the workflow back in `skills/`, then adapt only loading, event shape, or command routing at the harness edge.

## Today vs Later

Supported today:

- shared skill source in `skills/`
- Claude Code plugin packaging
- Codex plugin metadata and MCP reference config
- OpenCode package/plugin surface
- Cursor-adapted rules, hooks, and skills
- file-first cross-harness memory through the CLI and opt-in MCP adapter
- `ecc2/` as an alpha Rust control plane

Still maturing:

- exact hook parity across all harnesses
- automated skill sync into Hermes
- release packaging for `ecc2/`
- cross-harness session resume semantics
- optional semantic reranking and governed memory-promotion workflows
- the full platform loop where external products contribute skill packs,
  gated APIs, evals, and case studies back into ECC

## Rule For New Work

When adding a workflow, put the durable behavior in ECC first.

Use harness-specific files only for:

- loading the shared asset
- adapting event shapes
- mapping command names
- handling platform limits

If a workflow only works in one harness, document that boundary directly.
