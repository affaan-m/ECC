# .codex-plugin — Codex Native Plugin for ECC

This directory contains the **Codex plugin manifest** for ECC.

## Structure

```
.codex-plugin/
└── plugin.json   — Codex plugin manifest (name, version, skills ref, MCP ref)
.mcp.json         — MCP server configurations at plugin root (NOT inside .codex-plugin/)
hooks/codex-hooks.json — Codex-compatible lifecycle hook projection
```

## What This Provides

- **281 skills** from `./skills/` — reusable Codex workflows for TDD, security,
  code review, architecture, and more
- **1 default MCP server** — Chrome DevTools; retired connectors remain opt-in
- **Codex lifecycle hooks** — synchronous command hooks on supported events,
  with explicit review and trust in `/hooks`

## Installation

Codex 0.146.0 and newer use `plugin add`, not `plugin install`. Add ECC's
repository marketplace, install the native plugin, and verify the registration:

```bash
codex plugin marketplace add affaan-m/ECC
codex plugin add ecc@ecc
codex plugin list --json
```

Both add commands are safe to run again. A repeated marketplace add reports
`alreadyAdded: true`, and a repeated plugin add keeps the same enabled plugin
registration. To fetch a newer marketplace snapshot before applying a new ECC
release, run:

```bash
codex plugin marketplace upgrade ecc
codex plugin add ecc@ecc
```

For local development, the same native journey accepts a checkout path:

```bash
codex plugin marketplace add /absolute/path/to/ECC
codex plugin add ecc@ecc
```

ECC's marketplace entry points at the repository root. Codex copies the selected
plugin source into its cache, so the root source keeps `skills/`, `.mcp.json`,
`hooks/`, hook scripts, and presentation assets together. Parent-relative paths
from a thin plugin directory would escape that cache and produce an installed
registration with missing runtime content.

Restart Codex after installation. You can also open `/plugins` in Codex CLI to
inspect, enable, disable, or remove the plugin. The native Codex plugin does not
use Claude's `user`, `project`, or `local` install scopes: its enabled state is
stored once in the active `CODEX_HOME` (normally `~/.codex`) and applies to
Codex sessions using that home.

## Hooks and reconfiguration

The Codex manifest uses the documented `hooks` field to bundle
`./hooks/codex-hooks.json`. This provider-specific projection keeps the
synchronous `SessionStart` bootstrap verified against Codex 0.146. Claude hook
profiles are not Codex hook profiles: handlers that block tools, use unsupported
events, run asynchronously, or fail Codex's hook protocol stay out of the native
bundle. Codex enables hook support by default, but native plugin installation
does not silently authorize commands. Start a new Codex session, open `/hooks`,
then review and trust the ECC hook definition before enabling it.
Codex records trust against each definition's hash, so changed hooks require
review again. Use `/plugins` for plugin enablement and `/hooks` for hook trust;
these are separate controls.

Once the cached skills are available, invoke `$configure-ecc` inside Codex for
ECC's guided configuration. Installing the plugin again is idempotent and does
not create a second scope or duplicate hook registration.

## Native plugin versus legacy managed sync

The commands above are the native Codex plugin path. The deprecated legacy managed sync
(`bash scripts/sync-ecc-to-codex.sh`) is a separate compatibility
path that merges files into `~/.codex`. It is not a native plugin install and
does not create a marketplace registration. Prefer the native path on current
Codex; use the legacy managed sync only when you intentionally need its copied
configuration layer.

New sync runs record a versioned ownership manifest. Inspect or remove that
layer explicitly with `ecc uninstall --legacy-codex-sync --dry-run`, followed
by `ecc uninstall --legacy-codex-sync`. Cleanup never targets conversation
history or native plugin caches. Older pre-manifest installs are cleaned
conservatively and unverifiable files are retained with warnings.

After install, `codex plugin list` is only a registration check. From an ECC
checkout, run the cache check to verify that the installed manifest can resolve
its referenced skills, MCP config, and assets:

```bash
node scripts/codex/check-plugin-cache.js
```

The installed plugin registers under the short slug `ecc` so tool and command names
stay below provider length limits.

## MCP Servers Included

| Server | Purpose |
|---|---|
| `chrome-devtools` | Interactive browser debugging via Chrome DevTools (CDP sessions, performance traces, console/network inspection) |

The former defaults (`github`, `context7`, `exa`, `memory`, `playwright`, `sequential-thinking`) were retired in the June 2026 connector audit — their jobs are covered by skills wrapping CLIs/REST APIs or by harness-native features. They remain available as opt-in entries in `mcp-configs/mcp-servers.json`. See `docs/MCP-CONNECTOR-POLICY.md` for the policy and the per-connector rationale.

## Notes

- The `skills/` directory at the repo root is the source of truth for the Codex
  plugin package; do not duplicate skill content inside `.codex-plugin/`.
- ECC is moving to a skills-first workflow surface. Legacy `commands/` remain for
  compatibility on harnesses that still expect slash-entry shims.
- MCP server credentials are inherited from the launching environment (env vars)
- This manifest does **not** override `~/.codex/config.toml` settings
