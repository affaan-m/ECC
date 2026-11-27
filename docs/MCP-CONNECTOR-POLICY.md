# MCP Connector Policy

ECC ships exactly one default MCP connector. Everything else is a skill wrapping a CLI or REST API, or an opt-in entry in `mcp-configs/mcp-servers.json`.

## The rule

A default connector earns its slot only if both hold:

1. **Universal** — it applies to essentially every user of a coding agent, on every harness ECC targets.
2. **MCP beats a CLI/API wrapped in a skill** — the job genuinely needs what MCP provides: interactive session state, streaming, an auth handshake, or structured browsing. Stateless request/response work is a skill, not a server. Tool schemas load into every session; each default connector taxes every user's context window whether they use it or not.

The default set stays well under ten. In practice the 2026 field default across serious harnesses is zero to two connectors plus native built-ins.

## Current default set

| Server | Why it passes |
|---|---|
| `chrome-devtools` | Google's official DevTools MCP. Interactive CDP sessions — live debugging, performance traces, console and network inspection on a stateful browser. This is the textbook case where MCP beats a CLI: the value is the held-open session, not a one-shot command. Keyless. |

## The six it replaced (June 2026 audit)

| Former default | Verdict | Replacement |
|---|---|---|
| `github` | drop for skill | `gh` CLI via the `github-ops` skill. `gh` is in every model's training data, composes one-shot commands with minimal token overhead, and auths once via `gh auth login`. The MCP server's ~30 tool schemas taxed every session. |
| `context7` | drop for skill | The `documentation-lookup` skill targeting Context7's public REST API (`/api/v2/libs/search`, `/api/v2/context`). Two stateless calls with a bearer key — no session state to justify a server. |
| `exa` | drop for skill | Harness-native search (Claude Code WebSearch, Codex web_search, Cursor @Web) by default; the `exa-search` skill remains for API-key holders. Also required an API key, which fails the universality test for a default. |
| `memory` | drop entirely | Native harness memory (Claude Code auto-memory directories, Cursor memories, AGENTS.md conventions) plus ECC's instinct/continuous-learning system. The knowledge-graph server solved a 2024 problem harnesses have since absorbed. |
| `playwright` | drop for skill | Microsoft's own `@playwright/cli` agent surface — the vendor itself moved agent workflows off MCP because returning full accessibility trees per step burns context. ECC's e2e skills already drive the CLI. Browser *debugging* (the interactive case) is covered by `chrome-devtools`. |
| `sequential-thinking` | drop entirely | Native extended thinking in every modern harness. The server wrapped no external system — a prompting pattern dressed as a connector. |

All six remain available as opt-in entries in `mcp-configs/mcp-servers.json` for users who want them.

## Opt-out

`ECC_DISABLED_MCPS` filters ECC-generated MCP configs at install/sync time:

```bash
export ECC_DISABLED_MCPS="chrome-devtools"
```

## Adding a connector

Open a PR that argues both prongs of the rule explicitly. "Popular" is not an argument; "the job is stateful and universal" is.
