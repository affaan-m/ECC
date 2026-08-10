# plugins/ecc — Legacy Codex Thin-Plugin Artifact

This directory is retained as a legacy compatibility artifact. The current
`.agents/plugins/marketplace.json` points at the self-contained repository root,
which Codex 0.146.0 accepts and copies with all referenced runtime content.
Do not point the active marketplace back at this thin directory: its
parent-relative references are valid in a checkout but escape the isolated
plugin cache after installation.

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

The native marketplace now installs from the repository root. A fresh Codex
0.146.0 cache contains the configure skill, shared skills, MCP configuration,
hooks, scripts, and assets, and an authenticated session loads the
`configure-ecc` skill without hook failures.

After install, `codex plugin list` is not enough to prove the runtime can load
the referenced skills and assets. From an ECC checkout, run:

```bash
node scripts/codex/check-plugin-cache.js
```

The check inspects the installed cache under `CODEX_HOME` (or `~/.codex`) and
fails if `.codex-plugin/plugin.json` points at files that were not copied into
that cache entry.

The manual sync flow remains available only as a separate legacy compatibility
path when copied/merged home configuration is explicitly desired:

```bash
npm install && bash scripts/sync-ecc-to-codex.sh
```
