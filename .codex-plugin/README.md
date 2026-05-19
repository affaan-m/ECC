# .codex-plugin — Codex Native Plugin for ECC

This directory contains the **Codex plugin manifest** for ECC.

## Structure

```
.codex-plugin/
└── plugin.json   — Codex plugin manifest (name, version, skills ref, MCP ref)
.mcp.json         — MCP server configurations at plugin root (NOT inside .codex-plugin/)
```

## What This Provides

- **200 skills** from `./skills/` — reusable Codex workflows for TDD, security,
  code review, architecture, and more
- **6 MCP servers** — GitHub, Context7, Exa, Memory, Playwright, Sequential Thinking

## Installation

Codex plugin support is currently marketplace-backed. The repo exposes a
repo-scoped marketplace at `.agents/plugins/marketplace.json`; Codex can add and
track that marketplace source from the CLI:

```bash
# Add the public repo marketplace
codex plugin marketplace add affaan-m/ECC

# Or add a local checkout while developing
codex plugin marketplace add /absolute/path/to/ECC
```

The marketplace entry points at the repository root so `.codex-plugin/plugin.json`,
`skills/`, and `.mcp.json` resolve from one shared source of truth. After adding
or updating the marketplace, restart Codex and install or enable `ecc` from the
plugin directory.

Official Plugin Directory publishing is coming soon in Codex. Until self-serve
publishing exists, treat the public repo marketplace as the supported Codex
distribution path and keep release copy framed as repo-marketplace/manual
installation.

The installed plugin registers under the short slug `ecc` so tool and command names
stay below provider length limits.

## MCP Servers Included

| Server | Purpose |
|---|---|
| `github` | GitHub API access |
| `context7` | Live documentation lookup |
| `exa` | Neural web search |
| `memory` | Persistent memory across sessions |
| `playwright` | Browser automation & E2E testing |
| `sequential-thinking` | Step-by-step reasoning |

## Notes

- The `skills/` directory at the repo root is shared between Claude Code (`.claude-plugin/`)
  and Codex (`.codex-plugin/`) — same source of truth, no duplication
- ECC is moving to a skills-first workflow surface. Legacy `commands/` remain for
  compatibility on harnesses that still expect slash-entry shims.
- MCP server credentials are inherited from the launching environment (env vars)
- This manifest does **not** override `~/.codex/config.toml` settings
