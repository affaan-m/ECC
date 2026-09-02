---
description: Generate and manage slim ECC profile plugin carriers - list profiles, plan the listing ledger and capability decision, generate a receipted plugin, and activate it per project.
argument-hint: "[list | plan <profile> | generate <profile> | activate <plugin-name>]"
---

# Plugin Profiles Command

Manage slim ECC profile plugin carriers from inside Claude Code. A carrier is
a standalone plugin generated from an install selection: it lists only the
selected skills, agents, and commands, keeps the rest of the skill catalog
reachable on demand inside the plugin, and records how it was built in
`ecc-profile.json`. See `docs/PLUGIN-PROFILES.md` for the underlying tool.

Run every command below from the ECC plugin root (`${CLAUDE_PLUGIN_ROOT}` when
set, otherwise the everything-claude-code checkout).

## Subcommands

### `/plugin-profiles list`

Run `node scripts/plugin-profiles.js list` and show the available install
profiles with their module counts.

### `/plugin-profiles plan <profile>`

Run `node scripts/plugin-profiles.js plan --profile <profile>` and report:

- the context selection (skills, agents, commands) and the token ledger with
  its method label and budget verdict;
- the capability selection: whether the hook runtime is off, enabled at a
  profile, or still needs a decision.

If the plan says a hook decision is required, ask the user whether to carry
the hook runtime (`--hooks minimal|standard|strict`) or not (`--hooks off`)
before offering to generate. Never choose for them.

### `/plugin-profiles generate <profile>`

1. Run `node scripts/plugin-profiles.js generate --profile <profile> --dry-run`
   first and show the target path, whether an existing directory would be
   replaced, the ledger, and any blockers.
2. If the dry run lists blockers, resolve them with the user: a hook decision
   (`--hooks ...`), an over-budget ledger (`--budget <n>` or
   `--allow-over-budget`), or a target that is not an unmodified generated
   carrier (`--force`, only with explicit confirmation).
3. Run the real `generate` with the agreed flags and show the generated path,
   the receipt digests, and the printed next steps.
4. Offer the activation step below.

Pass through extra flags the user asks for (`--name`, `--out`, `--modules`,
`--with`, `--without`, `--no-catalog`, `--keep-prev`).

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
- Regenerate after updating ECC: the carrier is a snapshot, not a live link.
- The generated `ecc-catalog` skill indexes the full catalog with paths inside
  the carrier (`on-demand/<skill>/SKILL.md`), so nothing outside the plugin is
  ever referenced.
