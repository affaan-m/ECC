# .codex-plugin — Codex Native Plugin for ECC

This directory contains the **Codex plugin manifest** for ECC.

## Structure

```
plugins/ecc/
├── .codex-plugin/plugin.json   — Codex plugin manifest
├── .mcp.json                   — MCP server configurations at plugin root
├── agents/                     — 63 plugin-level agents
├── commands/                   — 79 plugin-level command prompts
└── skills/                     — 251 plugin-level skills
```

## What This Provides

- **251 skills** from `./skills/` — reusable Codex workflows for TDD, security,
  code review, architecture, and more
- **63 agents** from `./agents/` — planner, reviewer, build resolver, security,
  language, and domain specialists
- **79 commands** from `./commands/` — legacy slash-entry prompts packaged for
  Codex-compatible command surfaces
- **6 MCP servers** — GitHub, Context7, Exa, Memory, Playwright, Sequential Thinking

## Installation

Codex plugin support is marketplace-backed. The repo exposes a repo-scoped
marketplace at `.agents/plugins/marketplace.json`; Codex can add and track that
marketplace source from the CLI:

```bash
# Add the public repo marketplace
codex plugin marketplace add affaan-m/ECC

# Or add a local checkout while developing
codex plugin marketplace add /absolute/path/to/ECC

# Install the ECC plugin from that marketplace
codex plugin add ecc@ecc
```

The marketplace entry points at `./plugins/ecc`, a materialized Codex plugin
package generated from the repository sources. Regenerate it before release or
local plugin testing:

```bash
npm run codex:package
```

After adding or updating the marketplace, restart Codex and install or enable
`ecc` from the plugin directory.

Official Plugin Directory publishing is coming soon. For official OpenAI
plugin-directory review, package this repo under the `openai/plugins`
repository shape: `plugins/ecc/.codex-plugin/plugin.json`,
`plugins/ecc/skills/`, and the supporting README/assets. Until that listing is
accepted, treat the public repo marketplace as the supported Codex distribution
path and keep release copy framed as repo-marketplace/manual installation.

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

- The root `skills/`, `agents/`, `commands/`, `.codex-plugin/`, and `.mcp.json`
  files are the source of truth. `plugins/ecc/` is generated from those sources
  by `npm run codex:package`.
- ECC is moving to a skills-first workflow surface. Legacy `commands/` remain for
  compatibility on harnesses that still expect slash-entry shims.
- MCP server credentials are inherited from the launching environment (env vars)
- This manifest does **not** override `~/.codex/config.toml` settings
