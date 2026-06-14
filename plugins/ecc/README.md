# plugins/ecc - Codex Repo-Marketplace Plugin Bundle

This directory is the stable short-slug Codex plugin bundle that
`.agents/plugins/marketplace.json` points at.

Codex installs marketplace plugins into its own cache, so this folder is a
self-contained Codex plugin bundle. The manifest, bundled skills, MCP config,
and presentation assets all live under this plugin root and can be loaded after
Codex copies the directory to `~/.codex/plugins/cache/...`.

## Bundle Contents

| Plugin path | Source of truth |
|---|---|
| `skills/` | Full root `skills/` catalog plus Codex metadata/extras from `.agents/skills/` |
| `.mcp.json` | Root `.mcp.json` |
| `assets/ecc-icon.svg` / `assets/hero.png` | Root `assets/` |

Keep this bundle synchronized whenever the canonical skill surface, Codex
metadata, default MCP config, or presentation assets change.
`tests/plugin-manifest.test.js` compares the bundled runtime surface against the
expected sources so drift fails in CI.

## Install

```bash
codex plugin marketplace add affaan-m/ECC
codex plugin list
```

Codex should show `ecc@ecc` from this bundle. The same repo marketplace also
exposes `everything-codex@ecc` as a Codex-branded alias with identical bundled
runtime content.

The manual sync flow remains useful when you want ECC's global Codex config,
prompt shims, or git hook setup outside plugin mode:

```bash
npm install && bash scripts/sync-ecc-to-codex.sh
```
