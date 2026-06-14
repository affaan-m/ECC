# Everything Codex Compatibility Layer Design

## Purpose

Add a Codex-specific plugin entry named `everything-codex` while preserving the existing `ecc` plugin entry and release surface. The result should make the Codex plugin directory show a clearer Everything Codex entry without breaking current `ecc@ecc` users, scripts, tests, or documentation.

## Current State

ECC already ships Codex plugin support through:

- `.codex-plugin/plugin.json` as the root Codex manifest.
- `.agents/plugins/marketplace.json` as the repo-scoped Codex marketplace.
- `plugins/ecc/.codex-plugin/plugin.json` as the concrete marketplace plugin target.
- `plugins/ecc/README.md` documenting that Codex marketplace discovery works but runtime skill loading can be fragile when Codex copies only the plugin folder into its install cache.

The existing tests pin several important constraints:

- The canonical plugin slug remains `ecc`.
- The marketplace entry must point at a concrete plugin subdirectory, not `./`.
- The thin `plugins/ecc` target must reuse root `skills/`, `.mcp.json`, and assets instead of vendoring a second copy.
- Release tooling updates the root Codex manifest, the repo marketplace, and the `plugins/ecc` manifest version.

## Chosen Approach

Create `plugins/everything-codex/` as a second thin Codex plugin target. Keep `plugins/ecc/` unchanged as the stable entry. Add a second marketplace entry so the repo marketplace exposes both:

- `ecc@ecc`
- `everything-codex@ecc`

`everything-codex` will use display name `Everything Codex`, but it will reuse the same root content as `plugins/ecc`:

- `skills`: `../../skills/`
- `mcpServers`: `../../.mcp.json`
- `interface.composerIcon`: `../../assets/ecc-icon.svg`
- `interface.logo`: `../../assets/hero.png`

This keeps the compatibility layer small, avoids content duplication, and preserves the current repo-root source of truth.

## Alternatives Considered

1. Rename `ecc` to `everything-codex`.
   - Rejected because it would break the existing marketplace entry, user installs, version tests, and release assumptions.

2. Add only a second marketplace entry pointing to `plugins/ecc`.
   - Rejected because Codex plugin identity comes from the target manifest. A second marketplace entry that points to the same manifest would still present as `ecc`, not as `Everything Codex`.

3. Add a second thin plugin target.
   - Selected because it gives Codex a clear Everything Codex entry while keeping the stable `ecc` path intact.

## File Changes

Create:

- `plugins/everything-codex/.codex-plugin/plugin.json`
- `plugins/everything-codex/README.md`

Modify:

- `.agents/plugins/marketplace.json`
- `package.json`
- `scripts/release.sh`
- `tests/plugin-manifest.test.js`
- `tests/scripts/npm-publish-surface.test.js`
- `.codex-plugin/README.md`
- `README.md`

## Manifest Requirements

The new `plugins/everything-codex/.codex-plugin/plugin.json` must:

- Use `name: "everything-codex"`.
- Match `package.json` version.
- Use the same repository, homepage, license, author, keywords, category, and capabilities as the current Codex manifest unless there is a Codex-specific reason to differ.
- Use `interface.displayName: "Everything Codex"`.
- Mention that it is a Codex-focused entry for ECC workflows in `description`, `shortDescription`, and `longDescription`.
- Reference root assets and root workflow content with parent-relative paths.
- Avoid unsupported manifest fields such as `hooks`.

## Marketplace Requirements

`.agents/plugins/marketplace.json` must contain both local plugin entries:

- Existing `ecc` entry remains first for backward compatibility.
- New `everything-codex` entry is appended.
- Both entries use `source.source: "local"`.
- Both entries use `policy.installation: "AVAILABLE"` and `policy.authentication: "ON_INSTALL"`.
- The new entry uses `source.path: "./plugins/everything-codex"`.
- The new entry uses category `Productivity`.
- Both marketplace entry versions match `package.json`.

## Release Requirements

`scripts/release.sh` must update:

- `.agents/plugins/marketplace.json` entry versions for both `ecc` and `everything-codex`.
- `plugins/ecc/.codex-plugin/plugin.json`.
- `plugins/everything-codex/.codex-plugin/plugin.json`.

The release staging list must include the new manifest and any modified docs or package metadata.

## Package Requirements

`package.json` `files` must include `plugins/everything-codex/` so npm package surface tests and downstream installs include the new Codex entry.

## Documentation Requirements

Docs should describe `everything-codex` as an alias entry, not a replacement:

- `.codex-plugin/README.md` should explain that the repo marketplace exposes both `ecc` and `everything-codex`.
- `plugins/everything-codex/README.md` should mirror the fragility warning from `plugins/ecc/README.md`.
- `README.md` Codex section should mention that `everything-codex` is the Codex-branded entry and `ecc` remains the stable short entry.

Documentation must keep the current guidance that plugin-mode skill loading may be fragile upstream and the manual sync flow remains the supported fallback.

## Testing Requirements

Use test-first implementation.

Add failing tests before implementation that prove:

- The marketplace has an `everything-codex` plugin entry.
- The `everything-codex` marketplace path resolves to a concrete plugin directory with `.codex-plugin/plugin.json`.
- The new manifest name is `everything-codex`.
- The new manifest version matches `package.json` and the marketplace entry.
- The new manifest reuses root `skills/`, `.mcp.json`, and assets.
- The new plugin directory does not vendor `skills/` or `.mcp.json`.
- The README for the new plugin documents the upstream Codex fragility and manual sync fallback.
- `npm pack` surface tests include `plugins/everything-codex/.codex-plugin/plugin.json`.
- Release tests or source assertions cover the new release script version update path.

Run focused tests first, then the broader plugin/package tests:

- `node tests/plugin-manifest.test.js`
- `node tests/scripts/npm-publish-surface.test.js`
- `node tests/run-all.js`

## Risks

Codex currently may copy only the plugin target directory into its install cache. Because both thin plugin entries reference parent-relative root content, runtime skill exposure may remain fragile in fresh sessions. This design does not try to solve that upstream behavior. It preserves the existing warning and manual sync fallback.

Vendoring all skills into `plugins/everything-codex/` would make the plugin target more self-contained, but it would duplicate hundreds of files and conflict with the existing single-source policy pinned by tests. That can be revisited later as a separate packaging design if Codex requires self-contained official directory submissions.

## Acceptance Criteria

- Existing `ecc` plugin behavior and tests continue to pass.
- Codex repo marketplace exposes a second `everything-codex` plugin entry.
- New `everything-codex` manifest presents as `Everything Codex`.
- Version updates stay synchronized across both Codex plugin entries.
- NPM package surface includes the new plugin target.
- Focused and full Node test suites pass.
