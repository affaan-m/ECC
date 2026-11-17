# Antigravity Setup and Usage Guide

Google Antigravity 2.0 discovers workspace customizations from the project-local
`.agents/` directory. ECC's Antigravity target installs native rules, workflows,
skills, and custom agents into that directory.

Native Antigravity 2.0 installation requires ECC 2.2.0 or newer. ECC 2.1.0 uses
the legacy `.agent/` adapter and does not provide the native layout described
below.

## Quick start

Verify that 2.2.3 is readable from the registry, then run the pinned package
from the project you want to configure:

```bash
npm view ecc-universal@2.2.3 version
npx ecc-universal@2.2.3 install --profile minimal --target antigravity
```

### Source checkout alternative

```bash
# Run every command below from the project you want to configure.
# Keep the ECC source checkout separate and use its absolute path.
ECC_ROOT="/absolute/path/to/ECC"

# Install the minimal profile
"$ECC_ROOT/install.sh" --profile minimal --target antigravity

# Compatibility syntax: common rules plus only these language packs
"$ECC_ROOT/install.sh" --target antigravity typescript python go
```

PowerShell uses the same project-root working-directory contract:

```powershell
$EccRoot = "C:\absolute\path\to\ECC"

& "$EccRoot\install.ps1" --profile minimal --target antigravity
& "$EccRoot\install.ps1" --target antigravity typescript python go
```

Start a new Antigravity conversation after installing so the agent receives the
updated skill inventory.

## Native install mapping

| ECC source | Antigravity destination | Purpose |
|---|---|---|
| `rules/` | `.agents/rules/` | Workspace rules, flattened with collision-safe names |
| `commands/` | `.agents/workflows/` | User-invoked slash workflows |
| `skills/<name>/` | `.agents/skills/<name>/` | Agent Skills with a required `SKILL.md` |
| `agents/<name>.md` | `.agents/agents/<name>.md` | Custom main agents and subagents |

ECC does not copy the repository's `.agents/` directory wholesale. That source
tree is Codex packaging and contains Codex-specific marketplace metadata. An
Antigravity plugin instead requires `.agents/plugins/<plugin-name>/plugin.json`.

Installed custom agent definitions are adapted to Antigravity's frontmatter:
Claude model tiers become `flash` or `pro`, and Claude tool names become their
Antigravity equivalents. Unsupported tool identifiers are never emitted because
Antigravity warns that invalid tool names can hang custom-agent execution.

Installed rules receive the activation frontmatter Antigravity needs to attach
them: common rules use `trigger: always_on`, and language rules map their
Claude `paths:` scope to `trigger: glob` with matching `globs:`. Rules without
a trigger are present on disk but never loaded.

## Expected project tree

```text
your-project/
└── .agents/
    ├── rules/
    │   ├── common-coding-style.md
    │   └── typescript-testing.md
    ├── workflows/
    │   └── plan.md
    ├── skills/
    │   └── coding-standards/
    │       └── SKILL.md
    ├── agents/
    │   └── code-reviewer.md
    └── ecc-install-state.json
```

## Verify the installation

macOS and Linux:

```bash
node "$ECC_ROOT/scripts/list-installed.js" --target antigravity
node "$ECC_ROOT/scripts/doctor.js" --target antigravity
rg --files .agents/skills -g 'SKILL.md'
rg --files .agents/agents -g '*.md'
```

PowerShell:

```powershell
node "$EccRoot\scripts\list-installed.js" --target antigravity
node "$EccRoot\scripts\doctor.js" --target antigravity
Get-ChildItem .agents\skills -Recurse -Filter SKILL.md
Get-ChildItem .agents\agents -Recurse -Filter *.md
```

In Antigravity, open **Settings > Customizations**, confirm that workspace
skills appear, start a new conversation, and request one by its exact name.

## Existing `.agent/` installations

Antigravity still reads legacy `.agent/rules` and `.agent/skills`, but ECC now
uses the canonical `.agents/` layout. Do not rename `.agent` manually because
ECC install-state contains absolute managed paths.

Rerun the same ECC install command after updating. ECC writes and verifies the
new `.agents/ecc-install-state.json` first, then removes only unchanged files
owned by the valid legacy state. Modified and unmanaged files remain in
`.agent/` and remain discoverable by doctor and uninstall until handled.

Preview lifecycle operations before applying them when desired:

macOS and Linux:

```bash
node "$ECC_ROOT/scripts/doctor.js" --target antigravity
node "$ECC_ROOT/scripts/repair.js" --target antigravity --dry-run
node "$ECC_ROOT/scripts/uninstall.js" --target antigravity --dry-run
```

PowerShell:

```powershell
node "$EccRoot\scripts\doctor.js" --target antigravity
node "$EccRoot\scripts\repair.js" --target antigravity --dry-run
node "$EccRoot\scripts\uninstall.js" --target antigravity --dry-run
```

## Troubleshooting

### Skills do not appear

- A valid skill must be `.agents/skills/<name>/SKILL.md`.
- `.agent/.agents/skills` is an obsolete nested layout from older ECC builds.
- Start a new conversation after changing skill files.

### Rules do not apply

- Confirm the files are directly under `.agents/rules/`.
- Run doctor and inspect any missing or drifted managed-file warning.

### Workflows do not appear

- Confirm the files are under `.agents/workflows/`.
- Invoke a workflow with `/<workflow-name>` after restarting Antigravity.

## Native Plugin and Global Installation (`antigravity-home`)

Antigravity supports global plugins located in `~/.gemini/config/plugins/<name>/`. Installing ECC as a native Antigravity plugin enables:

1. **Global Scope**: ECC rules, skills, agents, workflows, and memory MCP are active across all projects automatically, without requiring a `.agents/` folder in every repository.
2. **Lifecycle Hooks (`hooks.json`)**: Handlers for `PreToolUse` command and file guards, `PostToolUse` edit tracking, and `Stop` formatting and diagnostics using Antigravity's protojson protocol (`{ decision, reason }`).
3. **Shared Memory Vault (`mcp_config.json`)**: Direct integration with `ecc-memory-mcp` across all Antigravity sessions.
4. **Native Plugin Manifest (`plugin.json`)**: Declares the ECC plugin metadata.

### Installing Globally

```bash
# Using install.sh from source
"$ECC_ROOT/install.sh" --target antigravity-home --profile core --enable-hooks
```

PowerShell:

```powershell
& "$EccRoot\install.ps1" --target antigravity-home --profile core --enable-hooks
```

The installer copies the memory server and its runtime dependencies into the
managed target. Only ECC memory is included in the generated MCP configuration;
repository `.mcp.json` commands are not imported automatically. Set
`ECC_DISABLED_MCPS=ecc-memory` during installation to omit that server.
Existing MCP entries are preserved on upgrades, including servers generated by
older ECC versions. Review `mcp_config.json` and remove any unwanted existing
entries explicitly; installation does not delete user configuration.
Generated hook and MCP commands use absolute installed paths,
so they also work when Antigravity runs from another workspace.

Project-local hooks use the same runtime; select `--profile core --enable-hooks`
with `--target antigravity`. Use `--no-hooks` to omit automatic hooks.
On reinstall, `--no-hooks` also deactivates previously installed ECC hooks,
including legacy bridges. Other hook namespaces are preserved. If the managed
`ecc-guard` registration was customized, installation refuses the change;
review that customization before retrying.
Choose a hook profile at installation with the existing environment setting, for
example `ECC_HOOK_PROFILE=minimal "$ECC_ROOT/install.sh" --target antigravity-home --profile core --enable-hooks`.
The installer retains it in managed `ecc/setup.json` for runtime execution.
`ECC_HOOK_PROFILE` overrides that profile; `ECC_DISABLED_HOOKS` disables individual
hook IDs, and `ECC_DRY_RUN=1` suppresses hook execution. These controls also apply
to the Antigravity bridge.

### Global Plugin Structure

```text
~/.gemini/config/
├── workflows/               # Global slash workflows
└── plugins/ecc/
    ├── plugin.json          # Antigravity plugin manifest
    ├── hooks.json           # PreToolUse, PostToolUse, and Stop hooks
    ├── mcp_config.json      # Shared ECC Memory Vault MCP server
    ├── ecc/setup.json       # Managed hook enable/profile configuration
    ├── rules/               # Rules applied to all workspaces
    ├── skills/              # Global Agent Skills
    ├── scripts/             # Hook bridge and memory runtime
    └── node_modules/        # Memory server dependencies
```

### Native validation and limits

Run the optional native check from the ECC source checkout:

```bash
node tests/scripts/antigravity-native-plugin.test.js
```

The test requires an already installed **Antigravity CLI 1.3.5** and skips with an
explicit message if that version is unavailable. It does not download the CLI.
It installs ECC into one temporary home, runs `agy plugin validate`, imports the
local plugin into a separate disposable CLI home with `agy plugin install`, and
checks `agy plugin list --json`.
Every CLI subprocess uses disposable home and configuration directories without
inheriting authentication credentials. The test makes no model requests.

This validates the CLI's local plugin importer and component registration.
CLI 1.2.9 does not list a manually placed `~/.gemini/config/plugins/ecc` plugin
until explicitly imported; its CLI staging location differs from the Antigravity
2.0 and IDE global location. Importing directly from the same home plugin directory
fails in CLI 1.2.9 because its importer attempts to copy onto the source directory.
The test uses separate install and loader homes to exercise the importer without
that collision; this does not establish in-place CLI activation of the home target.

The CLI exposes no standalone tool-event or Stop-event runner. The existing
bridge tests check allowed and denied tool payloads and Stop behavior directly;
they do **not** establish native loader execution. Automatic IDE discovery,
allowed and denied tool execution, and Stop execution still require a real
Antigravity session. In Settings > Customizations, verify ECC appears, then use
a disposable workspace to verify an ordinary command proceeds, a destructive
command is denied before execution, and an edit triggers the expected Stop
formatting or diagnostics. Never use valuable files for the denial check.

## Official Antigravity references

- [Skills](https://antigravity.google/docs/skills)
- [Rules and workflows](https://antigravity.google/docs/rules-workflows)
- [Custom agents and subagents](https://antigravity.google/docs/subagents)
- [Plugins](https://antigravity.google/docs/plugins)
- [Lifecycle hooks](https://antigravity.google/docs/hooks)

See [CONTRIBUTING.md](../CONTRIBUTING.md) for ECC contribution guidance and
[SELECTIVE-INSTALL-ARCHITECTURE.md](SELECTIVE-INSTALL-ARCHITECTURE.md) for the
installer lifecycle contract.
