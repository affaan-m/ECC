# .grok-plugin — Grok Build Native Plugin for ECC

This directory is the **Grok Build plugin and marketplace manifest** for ECC.
Component files stay at the repository root (`skills/`, `commands/`, `agents/`,
`hooks/hooks.json`, `.mcp.json`). `.grok-plugin/` only holds Grok's index.

Grok also reads `.claude-plugin/plugin.json`, but Claude's marketplace
`"source": "./"` is rejected by Grok as an empty path. Keep a Grok-specific
catalog here. Do not point Grok at `plugins/ecc/`: Codex already showed that a
thin subdirectory copy drops parent-relative runtime files.

## Install

ECC trusted install is `node scripts/grok-install.js` (`previewInstall` /
`applyInstall` in `scripts/lib/grok-harness-adapter.js`, install target `grok`,
state at `~/.grok/ecc/install-state.json`). That plan is receipt-backed and
requires explicit consent for hooks and each MCP server.

Grok CLI marketplace add / install / enable is **discovery only**.
`grok plugin install --trust` skips Grok's confirmation prompt; it is **not
ECC capability consent** and does not write an ECC receipt. `plugin.json`
sets `mcpServers` and `hooks` to empty strings so that native CLI path does
not attach root `.mcp.json` or `hooks/hooks.json`.

```bash
grok plugin marketplace add affaan-m/ECC
grok plugin install ecc
grok plugin enable ecc
grok plugin validate .
```

Local checkout, including unpublished changes:

```bash
grok plugin install /absolute/path/to/ECC
grok plugin enable ecc
grok plugin validate /absolute/path/to/ECC
```

Do not also run `./install.sh --target claude` (or a full manual Claude copy)
into the same Grok session. Pick one install path per harness.
`./install.sh --target grok` does not copy hooks or root MCP without the same
adapter consent flags.

## Hooks

Grok sets `GROK_PLUGIN_ROOT`. Shared hook code does not read that alias.
`applyInstall` maps it onto `PLUGIN_ROOT` at the installed-tree boundary when
hooks are consented. Without hook consent, the installed copy has no
`hooks/hooks.json`.

Grok does not honor Claude `userConfig`. Hook enablement and profile stay on
environment variables after explicit hook consent:

```bash
export ECC_HOOKS_ENABLED=true
export ECC_HOOK_PROFILE=standard   # minimal | standard | strict
```

## MCP

`.grok-plugin/plugin.json` sets `"mcpServers": ""` so a trusted Grok plugin
install does not attach repo-root `.mcp.json` or `chrome-devtools`. That root
file remains for Claude/Codex. Additional connectors stay opt-in via
`mcp-configs/mcp-servers.json`. Adapter receipts still require explicit
per-server consent before any MCP name is copied into an install plan.

## Known limits

- 286 skills are advertised into Grok's skill catalog. Use a smaller working
  set when context footprint matters.
- Agent files load, but ECC agent `tools:` lists use Claude names (`Read`,
  `Bash`). Grok hook matchers map those names; agent frontmatter does not.
- Grok has no plugin `rules/` component. Put always-on constraints in
  `AGENTS.md` or Grok project rules.
