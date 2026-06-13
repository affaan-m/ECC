# plugins/ecc — Codex Repo-Marketplace Plugin Target

This directory is the plugin folder that `.agents/plugins/marketplace.json`
points at. Codex does not discover plugins whose local marketplace
`source.path` is the marketplace root itself (`./`), so the marketplace entry
must target a concrete plugin subdirectory — verified against Codex CLI
0.137.0 and the official plugin docs (`$REPO_ROOT/plugins/<name>`).

## Single source of truth

Per the repo's no-duplication policy, no skill or MCP content is vendored
here. `.codex-plugin/plugin.json` references the canonical root content with
parent-relative paths:

| Manifest field | Resolves to |
|---|---|
| `skills` | `skills/` at the repo root |
| `mcpServers` | `.mcp.json` at the repo root |
| `interface.composerIcon` / `interface.logo` | `assets/` at the repo root |

The canonical Codex plugin manifest for the repo-root bundle (used by the
official `openai/plugins` directory shape and other harness tooling) remains
at `.codex-plugin/plugin.json`. Keep `name` and `version` in both manifests in
sync — `tests/plugin-manifest.test.js` enforces this and `scripts/release.sh`
bumps both.

## Current Codex plugin-mode status

With this layout, `codex plugin marketplace add affaan-m/ECC` discovers and
installs `ecc@ecc`. Runtime skill loading from repo marketplaces is still
unreliable upstream — Codex copies only the plugin folder into its install
cache, and local/personal marketplace plugins are not always exposed at
runtime (see [openai/codex#26037](https://github.com/openai/codex/issues/26037)
and [affaan-m/ECC#2128](https://github.com/affaan-m/ECC/issues/2128)).

After install, `codex plugin list` is not enough to prove the runtime can load
the referenced skills and assets. From an ECC checkout, run:

```bash
node scripts/codex/check-plugin-cache.js
```

The check inspects the installed cache under `CODEX_HOME` (or `~/.codex`) and
fails if `.codex-plugin/plugin.json` points at files that were not copied into
that cache entry.

Until the upstream discovery issues settle, the supported Codex path is the
manual sync flow documented in the README:

```bash
npm install && bash scripts/sync-ecc-to-codex.sh
```
