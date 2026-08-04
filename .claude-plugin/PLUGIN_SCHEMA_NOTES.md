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

* `commands`
* `skills`
* `hooks` (if present)

Even if there is only one entry, **strings are not accepted**.

This applies consistently across all component path fields.

---

## Agent `tools` Frontmatter: USE A SCALAR

The array rule above applies to `plugin.json`, not agent Markdown frontmatter.
Claude Code agent files use a comma-separated scalar for their tool allowlist:

```yaml
tools: Read, Glob, Grep
```

Do not use a YAML sequence such as `tools: [Read, Glob, Grep]`. Omitting the
`tools` field grants the agent access to all tools, but ECC agents declare
explicit allowlists and the repository validator requires the field.

---

## The `agents` Field: DO NOT ADD

> WARNING: **CRITICAL:** Do NOT add an `"agents"` field to `plugin.json`. The Claude Code plugin validator rejects it entirely.

### Why This Matters

The `agents` field is not part of the Claude Code plugin manifest schema. Any form of it -- string path, array of paths, or array of directories -- causes a validation error:

```
agents: Invalid input
```

Agent `.md` files under `agents/` are discovered automatically by convention (similar to hooks). They do not need to be declared in the manifest.

### History

Previously this repo listed agents explicitly in `plugin.json` as an array of file paths. This passed the repo's own schema but failed Claude Code's actual validator, which does not recognize the field. Removed in #1459.

---

## Path Resolution Rules

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

> WARNING: **CRITICAL:** Do NOT add a `"hooks"` field to `plugin.json`. This is enforced by a regression test.

### Why This Matters

Claude Code v2.1+ **automatically loads** `hooks/hooks.json` from any installed plugin by convention. If you also declare it in `plugin.json`, you get:

```
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
- Pre-v2.1: Required explicit `hooks` declaration
- v2.1+: Auto-loads by convention, errors on duplicate

### Current Rule (Enforced by Test)

The test `plugin.json does NOT have explicit hooks declaration` in `tests/hooks/hooks.test.js` prevents this from being reintroduced.

**If you're adding additional hook files** (not `hooks/hooks.json`), those CAN be declared. But the standard `hooks/hooks.json` must NOT be declared.

---

## The `mcpServers` Field: Keep the Empty Opt-Out

ECC keeps `.mcp.json` at the repository root for Codex plugin installs and manual MCP setup.
Claude Code also auto-discovers plugin-root `.mcp.json` files by convention, which would bundle the same MCP servers into Claude plugin installs.
The Claude plugin slug is intentionally short (`ecc`), but this opt-out is still required because legacy installs and strict provider gateways have failed on generated names from longer plugin identifiers.

Keep this field in `.claude-plugin/plugin.json`:

```json
{
  "mcpServers": {}
}
```

This explicit empty object prevents Claude plugin installs from auto-loading ECC's root MCP definitions.
Without the opt-out, strict OpenAI-compatible gateways can reject plugin MCP tool names such as `mcp__plugin_everything-claude-code_github__create_pull_request_review` because they exceed 64 characters.

Users who want the bundled MCP servers should configure them manually from `.mcp.json` or `mcp-configs/mcp-servers.json`.

---

## Known Anti-Patterns

These look correct but are rejected:

* String values instead of arrays
* **Adding `"agents"` in any form** - not a recognized manifest field, causes `Invalid input`
* Missing `version`
* Relying on inferred paths
* Assuming marketplace behavior matches local validation
* **Adding `"hooks": "./hooks/hooks.json"`** - auto-loaded by convention, causes duplicate error
* Removing `"mcpServers": {}` - re-enables root `.mcp.json` auto-discovery for Claude plugin installs and can produce overlong MCP tool names

Avoid cleverness. Be explicit.

---

## Minimal Known-Good Example

```json
{
  "version": "1.1.0",
  "commands": ["./commands/"],
  "skills": ["./skills/"]
}
```

This structure has been validated against the Claude plugin validator.

**Important:** Notice there is NO `"hooks"` field and NO `"agents"` field. Both are loaded automatically by convention. Adding either explicitly causes errors.

---

## Recommendation for Contributors

Before submitting changes that touch `plugin.json`:

1. Ensure all component fields are arrays
2. Include a `version`
3. Do NOT add `agents` or `hooks` fields (both are auto-loaded by convention)
4. Preserve `"mcpServers": {}` unless you are intentionally changing Claude plugin MCP bundling behavior
5. Run:

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
