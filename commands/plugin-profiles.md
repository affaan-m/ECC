---
description: Generate and manage slim ECC profile plugins - list profiles, plan token impact, generate a plugin, and activate it per project.
argument-hint: "[list | plan <profile> | generate <profile> | activate <plugin-name>]"
---

# Plugin Profiles Command

Manage slim ECC profile plugins from inside Claude Code. Profile plugins cut
the per-session catalog cost (about 30k tokens for the full plugin, about 12k
for `minimal`) while keeping hook runtime parity and on-demand access to the
full skill catalog. See `docs/PLUGIN-PROFILES.md` for the underlying tool.

Run every command below from the ECC plugin root (`${CLAUDE_PLUGIN_ROOT}` when
set, otherwise the everything-claude-code checkout).

## Subcommands

### `/plugin-profiles list`

Run `node scripts/plugin-profiles.js list` and show the available install
profiles with their module counts.

### `/plugin-profiles plan <profile>`

Run `node scripts/plugin-profiles.js plan --profile <profile>` and report the
resolved surface (skills, agents, commands, runtime paths) and the estimated
catalog tokens per session, compared against the full plugin.

### `/plugin-profiles generate <profile>`

1. Run `node scripts/plugin-profiles.js generate --profile <profile>`.
2. Show the generated plugin path and the printed next steps
   (`claude plugin marketplace add ...`, `claude plugin install ...`).
3. Offer the activation step below.

Pass through extra flags the user asks for (`--name`, `--out`, `--modules`,
`--with`, `--without`, `--no-catalog`, `--no-hooks`).

### `/plugin-profiles activate <plugin-name>`

Offer to write the per-project opt-in to `.claude/settings.json` in the
current project:

```json
{
  "enabledPlugins": {
    "ecc@ecc": false,
    "<plugin-name>@ecc-profiles": true
  }
}
```

Merge with any existing `enabledPlugins` block instead of overwriting the
file. ALWAYS show the resulting JSON and get user confirmation before
writing - never change plugin activation silently. Remind the user the
change takes effect on the next session.

## Notes

- Custom selections work too: `generate --modules commands-core --with skill:react-patterns`.
- Regenerate after updating ECC: the plugin is a snapshot, not a live link.
- The generated `ecc-catalog` skill plus the skill-router hook keep the full
  catalog reachable from any slim profile.
