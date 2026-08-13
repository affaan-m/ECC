---
name: install-ecc-rules
description: Install ECC's rules-core module (all rule directories) into a target project or the global Claude config, using the canonical scripts/install-apply.js --modules flow. Detects the project's tech stack as an informational preview only.
metadata:
  origin: community
---

# Install ECC Rules

Use this skill when a user wants ECC's rule directories (`rules/`) installed into `.claude/rules/ecc/` (project-scoped) or `~/.claude/rules/ecc/` (global), without pulling in the rest of the ECC surface (skills, agents, hooks, platform configs).

## When To Use

Use this skill when the user:

- already has ECC set up (as a plugin, or via `/project-init`) and specifically wants the rule directories installed or refreshed
- asks to "install ECC rules" or "just the rules" for this project
- wants a preview of which rule directories apply to their stack before installing anything

Do not use this skill when the user wants full ECC onboarding (skills, agents, commands, hooks) — use `/project-init` for that instead.

## Core Principle: rules-core is one atomic module

ECC's install-state contract (`manifests/install-modules.json`) does not expose per-language rule selection — the `rules-core` module treats `rules/` as a single unit. This is an explicit unresolved "Open Question" in `docs/SELECTIVE-INSTALL-ARCHITECTURE.md`, not an oversight in this skill.

So this skill works in two layers:

1. **Stack detection is informational only.** It tells the user which installed rule directories are actually relevant to their project (using `config/project-stack-mappings.json`), but it never filters what gets installed.
2. **The install action always installs the whole `rules-core` module**, through the canonical `scripts/install-apply.js --modules rules-core` flow — the same contract `install-plan`, `list-installed`, `doctor`, `repair`, and `uninstall` all understand. This keeps install-state fully consistent instead of inventing a synthetic per-stack module id.

Never hand-copy rule directories with `cp -r` or clone ECC into `/tmp` to work around this — all mutation goes through `scripts/install-apply.js`.

## Workflow

All of this is implemented by `scripts/install-rules.js` (a thin CLI over `scripts/lib/install-rules-selection.js`). Run it from the target project's directory, or pass `--target` to choose scope.

### 1. Preview (always do this first)

```bash
node scripts/install-rules.js --target claude-project --dry-run --json
```

- `--target claude-project` installs into `./.claude` (this project only, the common case)
- `--target claude` installs into `~/.claude` (global, affects every project)

The output includes:

- `detected`: the stacks matched against `config/project-stack-mappings.json`
- `languages`: rule directories relevant to those stacks (informational; not a filter)
- `plan`: the real dry-run plan from `install-apply.js` — operation count, target paths, warnings (e.g. "already exists")

Show the user the detected stack and the plan summary before asking to proceed.

### 2. Confirm and apply

Ask the user to confirm installing `rules-core` (the whole `rules/` tree) at the chosen target. Once confirmed:

```bash
node scripts/install-rules.js --target claude-project --yes
```

Drop `--yes` to let the script's own interactive y/N prompt handle confirmation instead, if running in a TTY.

### 3. Report results

Report the operation count and target root from the result, and surface any warnings (e.g. rules already installed at that target) rather than silently overwriting.

## Safety Rules

- Never install `rules-core` globally (`--target claude`) unless the user explicitly asks for the global scope, or global ECC evidence already exists (`~/.claude/rules/ecc/`). Default to `claude-project`.
- Never bypass `scripts/install-rules.js` / `scripts/install-apply.js` with manual file copying — it breaks install-state consistency (`doctor`, `repair`, `uninstall` all read that state).
- Never skip the dry-run preview step, even when the user says "just install it" — show the plan and detected stack first, then apply.
- If `--dry-run` reports an error (e.g. malformed `config/project-stack-mappings.json`), stop and report it instead of falling back to a manual copy.

## Why this exists alongside `/project-init`

`/project-init` installs the full ECC surface (skills, agents, rules, hooks, platform configs) for onboarding a project onto ECC. This skill is narrower: for a user who already has ECC and specifically wants the rule directories (re)installed or refreshed, with nothing else touched, going through the same canonical `--modules` installer contract that the rest of ECC's install lifecycle relies on.

## Related Surfaces

- `/project-init`: full stack-aware ECC onboarding
- `/ecc-guide`: general navigation of ECC's surface
- `scripts/lib/install-rules-selection.js`: stack detection + plan/apply helpers used by this skill
- `docs/SELECTIVE-INSTALL-ARCHITECTURE.md`: background on why rules-core is atomic
