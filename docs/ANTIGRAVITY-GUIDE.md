# Antigravity Setup and Usage Guide

Google Antigravity 2.0 discovers workspace customizations from the project-local
`.agents/` directory. ECC's Antigravity target installs native rules, workflows,
skills, and custom agents into that directory.

Native Antigravity 2.0 installation requires ECC 2.2.0 or newer. ECC 2.1.0 uses
the legacy `.agent/` adapter and does not provide the native layout described
below.

> [!IMPORTANT]
> **Temporary release status:** npm latest is currently `ecc-universal@2.1.0`.
> ECC 2.2.0 has not been published to npm yet. Until it is published, use a
> current source checkout of `main` for native `.agents` support or wait for the
> release.

<!-- Temporary: remove this release-status paragraph only after `ecc-universal@2.2.0` is published and registry readback succeeds. -->

## Quick start

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

## Official Antigravity references

- [Skills](https://antigravity.google/docs/skills)
- [Rules and workflows](https://antigravity.google/docs/rules-workflows)
- [Custom agents and subagents](https://antigravity.google/docs/subagents)
- [Plugins](https://antigravity.google/docs/plugins)

See [CONTRIBUTING.md](../CONTRIBUTING.md) for ECC contribution guidance and
[SELECTIVE-INSTALL-ARCHITECTURE.md](SELECTIVE-INSTALL-ARCHITECTURE.md) for the
installer lifecycle contract.
