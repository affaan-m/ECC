---
description: Generate and manage slim ECC profile plugin carriers - list profiles, plan the listing ledger and capability decision, generate a receipted plugin, and activate it per project.
argument-hint: "[list | plan <profile> | generate <profile> | activate <plugin-name>]"
---

# Plugin Profiles Command

Manage slim ECC profile plugin carriers from inside Claude Code. A carrier is
a standalone plugin generated from an install selection: it lists only the
selected skills, agents, and commands, keeps the rest of the skill catalog
reachable on demand inside the plugin, and records how it was built in
`ecc-profile.json`.

This command is a thin entry point over the `plugin-profiles` skill. Follow
that skill for the full workflow and rules.

## What This Command Does

1. `list` - show the available install-profile projections and their module counts.
2. `plan <profile>` - report the context surface, the token ledger with its
   method label and budget verdict, and the capability decision.
3. `generate <profile>` - dry run first, resolve every blocker with the user,
   then generate and show the receipt digests.
4. `activate <plugin-name>` - offer to write the per-project opt-in to
   `.claude/settings.json`, merging rather than overwriting, and only after
   showing the JSON and getting confirmation.

Two things the skill is strict about, repeated here because they are the easy
mistakes: a narrow context selection never authorizes the hook runtime, so
never choose `--hooks` for the user; and the default ledger over-counts, so
"OVER budget" may be a false positive that `--measure provider` clears.

Profile ids (`minimal`, `developer`, `opencode`, ...) are **install-profile
projections**, not context profiles: ECC has no canonical context-profile
registry yet, so every receipt records `registry: install-profiles@unbound`.

## Example

```
User: /plugin-profiles generate opencode

Assistant: (runs plan, then generate --dry-run)
  Ledger 8,323 tokens - OVER the 8,000 budget. That estimate over-counts by
  design; --measure provider would give the real number. No hook runtime in
  this selection, so no capability decision is needed.
  Proceed with --allow-over-budget, raise the budget, or narrow the selection?
User: allow it
Assistant: (generates, reports path + receipt digests, offers activation)
```

## Related

- `plugin-profiles` skill - full workflow, blocker table, receipt reading, rules
- `docs/PLUGIN-PROFILES.md` - design rules, fail-closed behaviour, receipt schema
- Source: `scripts/plugin-profiles.js`, `scripts/lib/plugin-profiles/`
