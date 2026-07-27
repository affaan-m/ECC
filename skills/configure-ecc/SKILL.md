---
name: configure-ecc
description: Install, update, or reconfigure the ECC Claude plugin with an explicit install scope and personal hook preferences.
metadata:
  origin: ECC
---

# Configure Everything Claude Code

Use this skill when the user asks to install, update, or configure ECC for
Claude Code.

## Use the canonical setup command

From an ECC checkout or npm installation:

```bash
ecc setup
```

If `ecc` is not installed yet, bootstrap the same command from npm:

```bash
npx --yes --package ecc-universal ecc setup
```

For non-interactive automation, make every choice explicit:

```bash
ecc setup \
  --mode claude-plugin \
  --scope user \
  --hooks standard \
  --yes
```

Do not clone ECC into a temporary directory or copy plugin components by hand.
The setup command inventories the current installation, adds or refreshes the
official marketplace, and then installs or updates `ecc@ecc`.

## Explain install scope

Before applying a new install, explain the three native Claude scopes:

- `user` — global for this user and available in every project.
- `project` — shared through repository settings for collaborators.
- `local` — private to the current project and not committed.

A fresh non-interactive install requires `--scope`. Repeat setup can detect the
single existing scope and update it. A request for a different scope must use
the separate scope-migration workflow; setup does not create duplicates.

## Explain hook preferences

Hook preferences are personal Claude plugin configuration and do not follow the
plugin install scope:

- `off` — keep ECC skills and commands without running ECC hooks.
- `minimal` — run only the lightest lifecycle and safety automation.
- `standard` — balanced quality and safety automation.
- `strict` — use the strongest checks and reminders.

Use `--hooks off|minimal|standard|strict` to change the preference later.
The command preserves unrelated Claude settings and plugin configuration.

## Safety behavior

Setup stops before mutation when it finds:

- the legacy Everything Claude Code plugin;
- `ecc@ecc` in multiple scopes;
- a manual ECC plugin layout;
- a non-official marketplace using the `ecc` name;
- malformed Claude settings or inventory;
- managed ECC content that overlaps plugin-provided skills, commands, or hooks.

Use `--dry-run --json` for a read-only inventory result. After an install or
update, restart Claude Code or run `/reload-plugins`.
