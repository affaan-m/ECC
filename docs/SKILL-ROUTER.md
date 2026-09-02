# Skill Router (opt-in)

A `UserPromptSubmit` hook that scores each prompt against the skill catalog
with offline token matching and injects up to three matching skills as
context for the turn. Installed skills are suggested directly; skills a
generated profile carrier holds on demand are suggested with their path
inside the plugin (`on-demand/<skill>/SKILL.md`). Nothing outside the plugin
is ever referenced.

The router changes what the model sees on every matching prompt, so it is a
separate behavioral feature from profile carriers and is **off by default**.

## Enabling

```bash
# Environment (highest precedence)
export ECC_SKILL_ROUTER=1

# Or the plugin option
CLAUDE_PLUGIN_OPTION_SKILL_ROUTER=1
```

Hook id: `user-prompt:skill-router`. It respects the usual hook controls
(`ECC_HOOKS_ENABLED`, `ECC_HOOK_PROFILE` via its `standard,strict` profile
list, `ECC_DISABLED_HOOKS`) in addition to the explicit opt-in above. Without
the opt-in the hook runs and emits nothing.

## Bounds

- Prompts shorter than 12 characters, slash commands, and `!` commands are
  never routed.
- Routing that takes longer than `ECC_SKILL_ROUTER_BUDGET_MS` (default 150)
  emits nothing and logs the overrun to stderr, so a cold catalog scan can
  never delay prompt submission by more than the budget.
- Output is at most a header plus three bullets. Catalog text is flattened
  to one line with control bytes removed before it reaches the model, so a
  crafted description cannot forge additional bullets or terminal escapes.
- Receipt catalog rows are accepted only when their path is inside
  `skills/` or `on-demand/`; anything else is dropped before scoring.
- The catalog cache lives under `~/.claude/cache` (override:
  `ECC_SKILL_ROUTER_CACHE_DIR`), is written with mode 0600 through an
  exclusive temp file and atomic rename, and never follows a planted symlink.
- Through `run-with-flags.js`, a disabled, dry-run, or missing
  UserPromptSubmit hook emits empty stdout rather than echoing the raw
  payload into context.

## Evidence

`scripts/ci/skill-router-eval.js` scores the router against
`tests/fixtures/skill-router/prompts.json` (52 labelled prompts across
frontend, backend, data, mobile, infra, security, research, and homelab
skill families) and measures latency. A prompt is a hit when any expected
skill appears in the routed top-3.

Measured on the commit that introduced this file (Node v24, Windows 11,
286-skill catalog):

```text
precision@3: 0.962  recall@3: 0.962  (hits 50, routed 52)
latency warm p50/p95: 2.88ms / 3.61ms; cold (3 runs): 70, 70, 70ms
miss: "migrate this component from react to vue" expected ui-to-vue|vue-patterns got react-native-patterns, react-patterns, react-testing
miss: "write pytest tests for the payment module" expected python-testing got agent-payment-x402, django-tdd, fastapi-patterns
```

Caveats, stated plainly: the fixture was written by the router's author, so
it is a regression fixture rather than an independent benchmark; "pytest"
does not tokenize to "python", and prompts that name two ecosystems rank the
one with more skills. Re-run with:

```bash
node scripts/ci/skill-router-eval.js            # human-readable
node scripts/ci/skill-router-eval.js --json     # machine-readable
node scripts/ci/skill-router-eval.js --min-precision 0.9 --min-recall 0.9   # gate
```

## Scoring

Tokens are lowercase alphanumeric runs of three or more characters minus a
small stopword list; long plurals also contribute their singular. A skill-id
token match scores 3, a description token match scores 1; a skill needs a
score of at least 3 to be suggested; ties break alphabetically so output is
deterministic.
