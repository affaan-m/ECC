# Everything Codex Compatibility Layer Design

## Purpose

Make ECC's Codex plugin mode cache-safe and installable as `every-codex`/`everything-codex` compatible marketplace entries while preserving the stable `ecc` slug. A Codex plugin install must work from the plugin cache without relying on parent directories from the original checkout.

## Current Constraint

Codex marketplace entries point at concrete plugin directories under `plugins/`. Codex copies that plugin directory into its install cache, so manifest paths that point outside the plugin root are not reliable. The previous thin-wrapper design used `../../skills/`, `../../.mcp.json`, and `../../assets/...`; that made discovery possible but did not make runtime loading self-contained.

## Chosen Approach

Keep two marketplace entries:

- `ecc@ecc` for the stable short slug.
- `everything-codex@ecc` for the Codex-branded alias.

Make both target directories self-contained Codex plugin bundles:

- `plugins/<name>/.codex-plugin/plugin.json`
- `plugins/<name>/skills/`
- `plugins/<name>/.mcp.json`
- `plugins/<name>/assets/ecc-icon.svg`
- `plugins/<name>/assets/hero.png`

The bundled `skills/` directory mirrors `.agents/skills/`, which is the curated Codex-native skill surface with `agents/openai.yaml` metadata. The full root `skills/` tree remains the canonical ECC source surface for other harnesses.

## Manifest Requirements

Marketplace plugin manifests must use only plugin-root paths:

- `skills`: `./skills/`
- `mcpServers`: `./.mcp.json`
- `interface.composerIcon`: `./assets/ecc-icon.svg`
- `interface.logo`: `./assets/hero.png`

The `everything-codex` manifest keeps `name: "everything-codex"` and `interface.displayName: "Everything Codex"`. The `ecc` manifest keeps `name: "ecc"` and `interface.displayName: "ECC"`.

## Drift Control

Tests compare each bundle against its source of truth:

- Bundled skill names match `.agents/skills`.
- Each bundled skill includes `SKILL.md` and `agents/openai.yaml`.
- Bundled `.mcp.json` matches the root `.mcp.json`.
- Bundled assets match the root assets.
- User-facing docs describe plugin mode as supported and self-contained, not experimental or fragile.

## Acceptance Criteria

- `node tests/plugin-manifest.test.js` passes.
- `node tests/scripts/npm-publish-surface.test.js` passes.
- Plugin validation passes for `plugins/ecc` and `plugins/everything-codex`.
- `npm pack --dry-run --json` includes each plugin's manifest, skills, MCP config, and assets.
- README and plugin docs present Codex plugin mode as supported, with manual sync framed only as optional global config/prompt setup.
