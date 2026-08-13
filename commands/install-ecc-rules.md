---
description: Detect the project's tech stack (informational preview) and install ECC's rules-core module via the canonical scripts/install-apply.js --modules flow.
---

# /install-ecc-rules

Thin compatibility shim for the `install-ecc-rules` skill. Follow `skills/install-ecc-rules/SKILL.md` for the full workflow, safety rules, and rationale — this file only exists so the slash command resolves.

## Usage

```text
/install-ecc-rules
```

No arguments. The underlying flow:

1. Preview: `node scripts/install-rules.js --target claude-project --dry-run --json`
2. Show the user the detected stack (informational only — see the skill for why it never filters the install) and the plan summary.
3. Confirm, then apply: `node scripts/install-rules.js --target claude-project --yes` (or let the script's own interactive prompt handle confirmation).

Use `--target claude` instead of `claude-project` only for a global (`~/.claude`) install, and only when the user explicitly asks for it.

## Related

- `skills/install-ecc-rules/SKILL.md` — canonical workflow and safety rules
- `scripts/install-rules.js` — CLI entry point
- `scripts/lib/install-rules-selection.js` — stack detection + plan/apply helpers
- `/project-init` — full ECC onboarding (skills, agents, rules, hooks) when more than rules-core is wanted
