# ECC for Qoder

This directory contains ECC's native Qoder plugin manifest. The repository root
is the plugin bundle: Qoder loads the canonical `skills/`, `agents/`, and
`commands/` directories rather than copies maintained under `.qoder-plugin/`.

## Install and verify

ECC's hook runtime requires Node.js 18 or newer on Qoder's non-interactive
`PATH`. From a reviewed checkout:

```bash
qoder plugins validate . --strict
qoder plugins install .
qoder plugins list
```

For Qoder IDE, create a ZIP whose root contains `.qoder-plugin/`, `skills/`,
`agents/`, `commands/`, `hooks/`, `scripts/`, and `.mcp.json`, then use
**Upload Plugin**. Do not upload only `.qoder-plugin/` or an individual
`SKILL.md`; both would omit referenced resources.

## Capability boundary

- Qoder discovers all compatible skills and agents from their canonical root
  directories. `commands/` remains a legacy compatibility surface; workflows
  should prefer their corresponding skills.
- The bundled `chrome-devtools` MCP server uses the same pinned `npx` launch
  contract as Codex. It is downloaded on first use and therefore requires Node,
  npm/npx, and network access.
- Qoder receives only ECC's reviewed `SessionStart` bootstrap. The much broader
  Claude hook profile is not copied: blocking tool hooks, asynchronous stop
  jobs, and Claude-specific matchers have not been asserted to be Qoder-safe.
- The Qoder hook uses `command` plus `args`, `QODER_PLUGIN_ROOT`, and Node's own
  executable for child processes. It does not rely on Bash, `python3`, or shell
  variable expansion, so the launcher contract is portable across native
  Windows, macOS, and Linux when Node 18+ is available.

Qoder plugin installation is separate from ECC's managed installer. Do not
combine it with a manually copied Qoder skill installation.
