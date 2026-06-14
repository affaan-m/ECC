# plugins/everything-codex - Codex-Branded ECC Plugin Target

This directory is a Codex-branded alias for the ECC repo-marketplace plugin.
It lets Codex show an `everything-codex` entry while the original `ecc` entry
remains available for existing installs and short tool namespaces.

## Single source of truth

No skill or MCP content is vendored here. `.codex-plugin/plugin.json`
references the canonical root content with parent-relative paths:

| Manifest field | Resolves to |
|---|---|
| `skills` | `skills/` at the repo root |
| `mcpServers` | `.mcp.json` at the repo root |
| `interface.composerIcon` / `interface.logo` | `assets/` at the repo root |

Keep this manifest version in sync with `package.json`, `.codex-plugin/plugin.json`,
and `plugins/ecc/.codex-plugin/plugin.json`.

## Current Codex plugin-mode status

With this layout, `codex plugin marketplace add affaan-m/ECC` discovers and
installs `everything-codex@ecc` alongside `ecc@ecc`. Runtime skill loading from
repo marketplaces is still unreliable upstream - Codex copies only the plugin
folder into its install cache, and local/personal marketplace plugins are not
always exposed at runtime (see [openai/codex#26037](https://github.com/openai/codex/issues/26037)
and [affaan-m/ECC#2128](https://github.com/affaan-m/ECC/issues/2128)).

Until the upstream discovery issues settle, the supported Codex path is the
manual sync flow documented in the README:

```bash
npm install && bash scripts/sync-ecc-to-codex.sh
```
