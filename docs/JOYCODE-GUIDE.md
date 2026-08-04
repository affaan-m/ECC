# JoyCode Adapter Guide

JoyCode can consume ECC through the selective installer. The adapter installs shared ECC commands, agents, skills, and flattened rules into a project-local `.joycode/` directory.

## Install

Preview the install plan:

```bash
node scripts/install-plan.js --target joycode --profile full
```

Apply it to the current project:

```bash
node scripts/install-apply.js --target joycode --profile full
```

For a smaller install, select modules explicitly:

```bash
node scripts/install-apply.js --target joycode --modules rules-core,commands-core,workflow-quality
```

## Layout

The project adapter writes managed files under:

```text
.joycode/
  agents/
  commands/
  rules/
  skills/
  mcp-configs/
  scripts/
  ecc-install-state.json
```

Rules are flattened into namespaced filenames so a JoyCode project does not receive nested rule directories such as `rules/common/coding-style.md`. Commands, agents, and skills keep the same structure they use elsewhere in ECC.
The full profile also includes shared MCP and setup helper files that other ECC project-local adapters use.

## Uninstall

Use ECC's managed uninstall path instead of deleting files by hand:

```bash
node scripts/uninstall.js --target joycode
```

The uninstall command reads `.joycode/ecc-install-state.json` and removes only files that ECC installed. User-created JoyCode files are preserved.

## Source PR

This adapter salvages the useful project-local JoyCode intent from stale PR #1429 while replacing the standalone shell installer with ECC's current install-state and uninstall machinery.
