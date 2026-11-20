---
name: instinct-enforce
description: Re-check learned instincts on Write, Edit, MultiEdit, and Bash so high-confidence corrections actually block the tool call instead of living only in the SessionStart preamble.
origin: ECC
---

# Instinct Enforce

SessionStart injects the top instincts as text. After compaction, or when the model ignores that preamble, a high-confidence instinct such as `NEVER foo prefix` does not bind `Write` / `Edit` / `Bash`. This skill is the PreToolUse consumer of the same store.

The hook is `scripts/hooks/instinct-enforce.js`, registered on `Write|Edit|MultiEdit|Bash` through `run-with-flags.js`.

## When to Activate

- The user reports ignored corrections ("I told it not to name things that way")
- `/instinct-status` lists instincts that keep being violated mid-session
- Tuning `ECC_INSTINCT_ENFORCE`, `ECC_INSTINCT_ENFORCE_MODE`, or `ECC_INSTINCT_CONFIDENCE_THRESHOLD`
- Dry-running a sample tool payload with `/instinct-enforce`

## How It Works

1. Load project + global instincts from the same roots SessionStart uses (`CLV2_HOMUNCULUS_DIR` / XDG `ecc-homunculus`).
2. Keep instincts with `confidence >=` `ECC_INSTINCT_CONFIDENCE_THRESHOLD` (default `0.7`).
3. Match the tool payload (`file_path`, `command`, `contents` / `new_string`) with no model call:
   - `domain` token appears in the path or command (word boundary), or
   - a quoted identifier from `trigger` or `content` (length >= 4, excluding `when` / `always` / `never` / `the` / `and`) appears in contents, command, or basename, or
   - `content` contains `NEVER <token>` / `do not <token>` / `don't <token>` and `<token>` appears in the payload; generic words such as `use`, `call` or `make` are skipped, so `NEVER use hardcoded secrets` matches on `hardcoded`
4. A block needs a prohibition: a `NEVER <token>` hit, or a quoted identifier written inside the clause that forbids something (`NEVER edit \`config.prod.json\``). A quoted name in `trigger`, or in a clause with no prohibition, is guidance. Every match is checked for a prohibition; `--check` lists the top 3.

| Best-match confidence | Default | Override |
|-----------------------|---------|----------|
| >= 0.85 | block (exit 2) | `ECC_INSTINCT_ENFORCE_MODE=warn` demotes all blocks |
| 0.70-0.84 | warn (`additionalContext`) | `ECC_INSTINCT_ENFORCE_MODE=block` promotes these to block |
| no match | no opinion (empty stdout, exit 0) | |

Disable with `ECC_INSTINCT_ENFORCE=0` / `off` / `false`. Missing store, unreadable file, or stdin parse failure: no opinion. Unexpected failures (project context, an unreadable instinct file, matcher errors) are still reported on stderr so they are not swallowed. The hook never echoes stdin or the tool payload.

## Dry-run

`/instinct-enforce` runs the hook with `--check` against a JSON file of `{tool_name, tool_input}` and prints matches without hook stdin. A tool the hook does not enforce prints `verdict: none` with `reason: <tool> not enforced` (exit 0). A payload with no `tool_name` or no `tool_input` object prints a `reason:` line and exits 1, so a malformed dry run never looks like a clean pass.

```bash
node "$ECC_ROOT/scripts/hooks/instinct-enforce.js" --check ./payload.json
```

## Anti-Patterns

- Do not set the default mode to block-all. SessionStart injects at 0.7; promoting every injected instinct to a hard deny stops ordinary edits.
- Do not fail closed on a missing store or bad stdin. Unreadable input is a no-op.
- Do not add a new stdin-echo wrapper. Use `plugin-hook-bootstrap.js` + `run-with-flags.js`.
- Do not fold this into GateGuard. GateGuard is first-touch facts and destructive git; instincts are user-learned and project-scoped.
- Do not add Codex PreToolUse. `hooks/codex-hooks.json` stays SessionStart-only.

## Related Skills

- `continuous-learning-v2` — learns and stores instincts; `/instinct-status` lists them
- `gateguard` — PreToolUse fact-forcing on first Edit/Write and destructive Bash
