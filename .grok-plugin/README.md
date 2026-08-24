# .grok-plugin — Grok Build Native Plugin for ECC

This directory is the **Grok Build plugin and marketplace manifest** for ECC.
Component files stay at the repository root (`skills/`, `commands/`, `agents/`,
`hooks/hooks.json`, `.mcp.json`). `.grok-plugin/` only holds Grok's index.

Grok also reads `.claude-plugin/plugin.json`, but Claude's marketplace
`"source": "./"` is rejected by Grok as an empty path. Keep a Grok-specific
catalog here. Do not point Grok at `plugins/ecc/`: Codex already showed that a
thin subdirectory copy drops parent-relative runtime files.

## Install

Published repo (marketplace catalog, then install + enable). Grok plugins stay
off until enabled, and hooks/MCP stay inactive until trusted:

```bash
grok plugin marketplace add affaan-m/ECC
grok plugin install ecc --trust
grok plugin enable ecc
grok plugin validate .
grok inspect
```

Local checkout, including unpublished changes:

```bash
grok plugin install /absolute/path/to/ECC --trust
grok plugin enable ecc
grok plugin validate /absolute/path/to/ECC
grok inspect
```

Do not also run `./install.sh --target claude` (or a full manual Claude copy)
into the same Grok session. Pick one install path per harness.

## Hooks

`--trust` is required for `hooks/hooks.json`. Grok sets `GROK_PLUGIN_ROOT` and
the `CLAUDE_PLUGIN_ROOT` alias, so ECC's existing hook bootstrap can resolve
the plugin root.

Grok does not honor Claude `userConfig`. Hook enablement and profile stay on
environment variables:

```bash
export ECC_HOOKS_ENABLED=true
export ECC_HOOK_PROFILE=standard   # minimal | standard | strict
```

## MCP

Claude plugin installs opt out of root `.mcp.json` with `"mcpServers": {}`.
Grok auto-discovers that file. A trusted ECC install therefore attaches the
default `chrome-devtools` server from `.mcp.json`. Additional connectors stay
opt-in via `mcp-configs/mcp-servers.json`.

## Known limits

- 286 skills are advertised into Grok's skill catalog. Use a smaller working
  set when context footprint matters.
- Agent files load, but ECC agent `tools:` lists use Claude names (`Read`,
  `Bash`). Grok hook matchers map those names; agent frontmatter does not.
- Grok has no plugin `rules/` component. Put always-on constraints in
  `AGENTS.md` or Grok project rules.
