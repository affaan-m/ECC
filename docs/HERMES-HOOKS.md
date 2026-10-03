# Hermes Hooks — Native Guards Without the Hook Runtime

Hermes ships its own shell-hook system: a `hooks:` block in `~/.hermes/config.yaml`,
Claude-Code-compatible JSON payloads on stdin, per-tool regex matchers, a
first-use consent allowlist, and `hermes hooks list | test | doctor` for
inspection. ECC's `hooks/hooks.json` is Claude Code format, and the Hermes
install target (`--target hermes`) deliberately does not install the hook
runtime — so Hermes operators get ECC's rules, skills, and commands with no
hooks at all.

This directory ports the two ECC hooks that matter outside Claude Code as
self-contained Hermes-native hooks. No ECC runtime, no `run-with-flags.js`, no
`.pi` extension — just two Python scripts and a config block.

## Why only these two

ECC's hook graph is 24 commands. Most of it is Claude Code-specific
(plugin bootstrap, plan canvas, Claude session transcripts, cost tracking
against Claude's usage API) or duplicates the target harness's own gates.
These two are harness-independent policy:

1. **config-protection** — blocks edits to existing linter/formatter configs
   (`.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `biome.json`, `ruff.toml`,
   `.stylelintrc*`, markdownlint) and lint ratchet baselines. An agent under
   pressure weakens the check instead of fixing the code; this hook refuses
   that path. Creating a config from scratch and reading configs stay allowed.
2. **check-console-log** — warns (stderr, never blocks) when an edited
   TS/JS file now contains `console.log()`. Tests, `.d.ts`, and scripts are
   excluded.

## Install

Preferred — through the ECC installer (module `hermes-hooks`):

```bash
./install.sh --target hermes --modules hermes-hooks --enable-hooks
# or: node scripts/install-apply.js --target hermes --modules hermes-hooks --enable-hooks
```

This lands `hooks/hermes/*.py` under `~/.hermes/hooks/hermes/` and this guide
under `~/.hermes/docs/`. Then register the hooks (the installer deliberately
never edits your `config.yaml`):

```bash
# Scripts are already at ~/.hermes/hooks/hermes/. Point the commands at them —
# Hermes resolves hook commands verbatim, without ~ expansion.
HOOK_DIR="$HOME/.hermes/hooks/hermes"

# Append to ~/.hermes/config.yaml (Hermes wants the mapping keyed by event):
cat >> ~/.hermes/config.yaml <<EOF
hooks:
  pre_tool_call:
    - matcher: "patch|write_file|edit|write|apply_patch|str_replace_editor"
      command: "python3 $HOOK_DIR/ecc-config-protection.py"
      timeout: 10
  post_tool_call:
    - matcher: "patch|write_file|edit|write|apply_patch|str_replace_editor"
      command: "python3 $HOOK_DIR/ecc-check-console-log.py"
      timeout: 10
EOF
```

Restart Hermes (hooks are registered at session start), then approve the
consent prompt on first use of each hook, or pre-approve with:

```bash
hermes hooks test pre_tool_call  --for-tool patch
hermes hooks test post_tool_call --for-tool write_file
```

## Verify

```bash
hermes hooks list     # both hooks, with consent status
hermes hooks doctor   # exec bit, allowlist, timing
```

Payload-level proof — create a protected file first, so the block case has a
real target (the hook only blocks edits to configs that already exist):

```bash
T=$(mktemp -d) && touch "$T/eslint.config.mjs"
echo "{\"hook_event_name\":\"pre_tool_call\",\"tool_name\":\"patch\",\"tool_input\":{\"path\":\"$T/eslint.config.mjs\",\"old_string\":\"a\",\"new_string\":\"b\"}}" \
  | python3 ~/.hermes/hooks/ecc-config-protection.py
# {"decision": "block", "reason": "BLOCKED: modifying eslint.config.mjs ..."}
```

Or run the committed suite, which exercises block, allow, case variants,
dangling symlinks, multi-edit inputs, and fail-open diagnostics:

```bash
node tests/hermes-hooks.test.js
```

## Notes

- Match only the editing tools your Hermes config exposes; the shipped matcher
  covers the common file-edit tool names.
- Hermes matches tool names against the regex with `fullmatch`.
- `post_tool_call` hooks cannot block; stderr is surfaced as a warning line.
- Hooks fail open on malformed payloads by design (a broken hook must not
  brick the agent); the config-protection hook emits its refusal as a JSON
  `decision`, not an exit code, so a parse error can never block.
