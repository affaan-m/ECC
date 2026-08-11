# Plugin Manifest Schema Notes

This document captures **undocumented but enforced constraints** of the Claude Code plugin manifest validator.

These rules are based on real installation failures, validator behavior, and comparison with known working plugins.
They exist to prevent silent breakage and repeated regressions.

If you edit `.claude-plugin/plugin.json`, read this first.

---

## Summary (Read This First)

The Claude plugin manifest validator is **strict and opinionated**.
It enforces rules that are not fully documented in public schema references.

The most common failure mode is:

> The manifest looks reasonable, but the validator rejects it with vague errors like
> `agents: Invalid input`

This document explains why.

---

## Required Fields

### `version` (MANDATORY)

The `version` field is required by the validator even if omitted from some examples.

If missing, installation may fail during marketplace install or CLI validation.

Example:

```json
{
  "version": "1.1.0"
}
```

---

## Field Shape Rules

The following fields **must always be arrays**:

* `agents`
* `commands`
* `skills`
* `hooks` (if present)

Even if there is only one entry, **strings are not accepted**.

### Invalid

```json
{
  "agents": "./content/agents"
}
```

### Valid

```json
{
  "agents": ["./content/agents/common/planner.md"]
}
```

This applies consistently across all component path fields.

---

## Path Resolution Rules (Critical)

### Agents MUST use explicit file paths

The validator **does not accept directory paths for `agents`**.

Even the following will fail:

```json
{
  "agents": ["./content/agents/"]
}
```

Instead, you must enumerate agent files explicitly:

```json
{
  "agents": [
    "./content/agents/common/planner.md",
    "./content/agents/common/architect.md",
    "./content/agents/node/node-code-reviewer.md"
  ]
}
```

This is the most common source of validation errors.

### Commands and Skills

* `commands` and `skills` accept directory paths **only when wrapped in arrays**
* Explicit file paths are safest and most future-proof

---

## Validator Behavior Notes

* `claude plugin validate` is stricter than some marketplace previews
* Validation may pass locally but fail during install if paths are ambiguous
* Errors are often generic (`Invalid input`) and do not indicate root cause
* Cross-platform installs (especially Windows) are less forgiving of path assumptions

Assume the validator is hostile and literal.

---

## The `hooks` Field: DO NOT ADD

> ⚠️ **CRITICAL:** Do NOT add a `"hooks"` field to `plugin.json`. This is enforced by a regression test.

### Why This Matters

Claude Code v2.1+ **automatically loads** `hooks/hooks.json` from any installed plugin by convention. If you also declare it in `plugin.json`, you get:

```text
Duplicate hooks file detected: ./hooks/hooks.json resolves to already-loaded file.
The standard hooks/hooks.json is loaded automatically, so manifest.hooks should
only reference additional hook files.
```

### The Flip-Flop History

This has caused repeated fix/revert cycles in this repo:

| Commit | Action | Trigger |
|--------|--------|---------|
| `22ad036` | ADD hooks | Users reported "hooks not loading" |
| `a7bc5f2` | REMOVE hooks | Users reported "duplicate hooks error" (#52) |
| `779085e` | ADD hooks | Users reported "agents not loading" (#88) |
| `e3a1306` | REMOVE hooks | Users reported "duplicate hooks error" (#103) |

**Root cause:** Claude Code CLI changed behavior between versions:

* Pre-v2.1: Required explicit `hooks` declaration
* v2.1+: Auto-loads by convention, errors on duplicate

### Current Rule (Enforced by Test)

The test `plugin.json does NOT have explicit hooks declaration` in `tests/hooks/hooks.test.js` prevents this from being reintroduced.

**If you're adding additional hook files** (not `hooks/hooks.json`), those CAN be declared. But the standard `hooks/hooks.json` must NOT be declared.

---

## Known Anti-Patterns

These look correct but are rejected:

* String values instead of arrays
* Arrays of directories for `agents`
* Missing `version`
* Relying on inferred paths
* Assuming marketplace behavior matches local validation
* **Adding `"hooks": "./hooks/hooks.json"`** - auto-loaded by convention, causes duplicate error

Avoid cleverness. Be explicit.

---

## Minimal Known-Good Example

```json
{
  "version": "1.1.0",
  "agents": [
    "./content/agents/common/planner.md",
    "./content/agents/node/node-code-reviewer.md"
  ],
  "commands": ["./content/commands/"],
  "skills": ["./content/skills/"]
}
```

This structure has been validated against the Claude plugin validator.

**Important:** Notice there is NO `"hooks"` field. The `hooks/hooks.json` file is loaded automatically by convention. Adding it explicitly causes a duplicate error.

---

## Recommendation for Contributors

Before submitting changes that touch `plugin.json`:

1. Use explicit file paths for agents
2. Ensure all component fields are arrays
3. Include a `version`
4. Run:

```bash
claude plugin validate .claude-plugin/plugin.json
```

If in doubt, choose verbosity over convenience.

---

## Why This File Exists

This repository is widely forked and used as a reference implementation.

Documenting validator quirks here:

* Prevents repeated issues
* Reduces contributor frustration
* Preserves plugin stability as the ecosystem evolves

If the validator changes, update this document first.

---

## 2026-08-11: Dual-target restructure (`content/` + `targets/`)

The repo was restructured so a single `content/` tree feeds both a Claude
Code plugin install and a Codex CLI install (`targets/claude/`,
`targets/codex/`, dispatched via `scripts/install.sh --target`). This moved
every component category one level deeper. The rules above are unaffected,
but two things are worth calling out explicitly:

* **Component paths now point into `./content/...`.** `agents`, `commands`,
  and `skills` in `plugin.json` were repathed from the old root-level
  `./agents/`, `./commands/`, `./skills/` to `./content/agents/`,
  `./content/commands/`, `./content/skills/`. The path-resolution rules
  above (agents need explicit file paths; commands/skills accept directory
  paths) are unchanged - only the prefix moved.
* **Agents remain explicit file paths.** The `agents` array in `plugin.json`
  still enumerates every `./content/agents/<lang>/<file>.md` individually;
  the move did not relax the "no directory paths for agents" rule.
* **`hooks` still must not be added to `plugin.json`.** The regression test
  in `tests/hooks/hooks.test.js` covers this at the new path too.
* **`content/hooks/common/hooks.json` is NOT at the auto-load path
  `hooks/hooks.json`.** Claude Code's plugin auto-load convention looks for
  `hooks/hooks.json` relative to the plugin root, literally one level deep.
  Before this restructure, the file already lived at `hooks/common/hooks.json`
  (nested a level deeper than the auto-load path); after the restructure it
  lives at `content/hooks/common/hooks.json` (nested two levels deeper).
  Neither path collides with the auto-load convention, so **plugin hook
  auto-loading behavior is unchanged by the move** - it neither started nor
  stopped triggering the duplicate-detection error described above.
