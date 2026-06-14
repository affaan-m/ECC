# .codex-plugin — Codex Native Plugin for ECC

This directory contains the **Codex plugin manifest** for ECC.

## Structure

```
.codex-plugin/
└── plugin.json   — Codex plugin manifest (name, version, skills ref, MCP ref)
.mcp.json         — MCP server configurations at plugin root (NOT inside .codex-plugin/)
```

## What This Provides

- A repo-root Codex manifest at `.codex-plugin/plugin.json`.
- Self-contained Codex plugin bundles under `plugins/ecc/` and
  `plugins/everything-codex/`.
- **33 Codex-ready skills** in each marketplace bundle, sourced from
  `.agents/skills/`.
- **1 default MCP server** in each marketplace bundle, sourced from the root
  `.mcp.json`.

## Installation

Codex plugin support is marketplace-backed. The repo exposes a repo-scoped
marketplace at `.agents/plugins/marketplace.json`; Codex can add and track that
marketplace source from the CLI:

```bash
# Add the public repo marketplace
codex plugin marketplace add affaan-m/ECC

# Or add a local checkout while developing
codex plugin marketplace add /absolute/path/to/ECC
```

The marketplace exposes two local Codex entries: `ecc` for the stable short
slug and `everything-codex` for the Codex-branded alias. Both entries point at
concrete plugin subdirectories under `plugins/` — Codex does not discover
plugins whose local marketplace `source.path` is the marketplace root (`./`),
so each entry must target a concrete plugin subdirectory (see
[#2128](https://github.com/affaan-m/ECC/issues/2128)).

Those directories are self-contained Codex plugin bundles. Codex installs
marketplace plugins into `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`,
so each bundle carries its own `skills/`, `.mcp.json`, and `assets/` with
manifest paths that stay inside the plugin root. After adding or updating the
marketplace, restart Codex and install or enable `ecc` or `everything-codex`
from the plugin directory.

The manual sync flow remains useful when you want ECC's global Codex config,
prompt shims, or git hook setup outside plugin mode:
`npm install && bash scripts/sync-ecc-to-codex.sh`.

Official Plugin Directory publishing is coming soon. For official OpenAI
plugin-directory review, package this repo under the `openai/plugins`
repository shape: `plugins/ecc/.codex-plugin/plugin.json`,
`plugins/ecc/skills/`, and the supporting README/assets. Until that listing is
accepted, treat the public repo marketplace as the supported Codex distribution
path.

`everything-codex` is an alias entry for Codex presentation; `ecc` remains the
canonical short slug for existing installs and release compatibility.

The installed plugin registers under the short slug `ecc` so tool and command names
stay below provider length limits.

## MCP Servers Included

| Server | Purpose |
|---|---|
| `chrome-devtools` | Interactive browser debugging via Chrome DevTools (CDP sessions, performance traces, console/network inspection) |

The former defaults (`github`, `context7`, `exa`, `memory`, `playwright`, `sequential-thinking`) were retired in the June 2026 connector audit — their jobs are covered by skills wrapping CLIs/REST APIs or by harness-native features. They remain available as opt-in entries in `mcp-configs/mcp-servers.json`. See `docs/MCP-CONNECTOR-POLICY.md` for the policy and the per-connector rationale.

## Notes

- The repo-root `skills/` directory remains the full ECC source surface; the
  marketplace plugin bundles carry the curated Codex runtime surface from
  `.agents/skills/`.
- Do not duplicate skill content inside `.codex-plugin/`; bundle runtime content
  under `plugins/ecc/` and `plugins/everything-codex/`.
- ECC is moving to a skills-first workflow surface. Legacy `commands/` remain for
  compatibility on harnesses that still expect slash-entry shims.
- MCP server credentials are inherited from the launching environment (env vars)
- This manifest does **not** override `~/.codex/config.toml` settings
